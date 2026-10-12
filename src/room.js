import { DurableObject } from 'cloudflare:workers';
import { newEvents, advanceEvents, finishEvent, nextDeadline } from './world-events.js';
import { cashLayout } from './event-random.js';
import { EVENTS } from './world-event-data.js';

// ================= MULTIPLAYER ROOM =================
// One shared city per game. Player movement remains client-owned. World incidents are server-owned, take turns
// (src/world-events.js), persist across hibernation and are driven by a single alarm at the next deadline.
// The alarm is removed and incident state reset when the room empties.
//
// Messages are small JSON objects with a type `t`. From a player:
//   hello { name }           first, once: the name shown over their head (cleaned up and cut to NAME_MAX)
//   anything else { t, ... } relayed to everyone else as is (their state, shots, blasts, the people in their part of
//                            the city), or with a `to` naming another player, sent to that one player only (a hit).
//                            The room doesn't need to know a game's message types, so a game can add one without a
//                            deploy here. Types are short lowercase words; the room's own (welcome, join, leave, full)
//                            can't be sent.
// To a player:
//   welcome { id, max, players: [{ id, name }] }, join { id, name }, leave { id }, and the relayed messages with `id`
//   (and for one sent to them only, `from`) naming the player who sent them.
// A full room answers `full` and closes with FULL_CODE. The plain text 'ping' is answered 'pong' without waking the room.
export const MAX_PLAYERS = 16, NAME_MAX = 16, MSG_MAX = 2048, FULL_CODE = 4001;
const TYPE = /^[a-z]{1,8}$/, RESERVED = new Set(['hello', 'welcome', 'join', 'leave', 'full', 'events', 'evaward']);

export function cleanName(n) {
  const s = String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return s || 'Guest';
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // keep-alive pings never wake the object (and aren't billed)
    if (globalThis.WebSocketRequestResponsePair) ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    // count the players already in (this socket included); the one who makes it seventeen is turned away
    if (this.ctx.getWebSockets().length > MAX_PLAYERS) {
      server.send(JSON.stringify({ t: 'full', max: MAX_PLAYERS }));
      server.close(FULL_CODE, 'The city is full');
    } else server.serializeAttachment({ id: null, name: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  // everyone in the room who has said hello, as { ws, id, name }
  players() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment(); if (a && a.id && !a.gone) out.push({ ws, ...a }); }
    return out;
  }
  broadcast(msg, except) {
    const text = JSON.stringify(msg);
    for (const p of this.players()) if (p.ws !== except) { try { p.ws.send(text); } catch (e) {} }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MSG_MAX) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const me = ws.deserializeAttachment();
    if (!me) return; // turned away (full)
    if (m.t === 'hello') {
      if (me.id) return;
      const others = this.players();
      const id = crypto.randomUUID().slice(0, 8), name = cleanName(m.name);
      ws.serializeAttachment({ id, name });
      ws.send(JSON.stringify({ t: 'welcome', id, max: MAX_PLAYERS, players: others.map(p => ({ id: p.id, name: p.name })) }));
      this.broadcast({ t: 'join', id, name }, ws);
      await this.events();
      return;
    }
    if (!me.id) return;
    if (!TYPE.test(m.t) || RESERVED.has(m.t)) return;
    if (m.t === 's') {
      const pos = { w: m.w === 1, al: m.al === 1, x: m.x, y: m.y, z: m.z, v: !!m.v };
      ws.serializeAttachment({ ...me, pos });
    }
    if (['evhit', 'evgrab', 'evcash'].includes(m.t)) { await this.eventAction(ws, me, m); return; }
    if (m.to === undefined) { this.broadcast({ ...m, id: me.id }, ws); return; }
    const to = this.players().find(p => p.id === m.to);
    if (to && to.ws !== ws) try { to.ws.send(JSON.stringify({ ...m, from: me.id })); } catch (e) {}
  }

  async webSocketClose(ws, code) { await this.left(ws); try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (e) {} }
  async webSocketError(ws) { await this.left(ws); }
  async events() {
    const now = Date.now(), saved = await this.ctx.storage.get('events'), state = saved?.left ? saved : newEvents(now);
    advanceEvents(state, now, this.players());
    await this.saveEvents(state, now);
    const packet = { t: 'events', now, active: state.active };
    this.broadcast(packet);
  }
  async saveEvents(state, now) {
    await this.ctx.storage.put('events', state);
    await this.ctx.storage.setAlarm(Math.max(now + 100, nextDeadline(state, now, this.players())));
  }
  async alarm() {
    if (!this.players().length) { await this.ctx.storage.delete('events'); return; }
    await this.events();
  }
  async eventAction(ws, me, m) {
    const state = await this.ctx.storage.get('events'), now = Date.now();
    const e = state?.active.find(e => e.key === m.key);
    if (!e || now >= e.end) return;
    if (m.t === 'evhit' && me.pos?.w && me.pos.al && Number.isFinite(e.hp) && Number.isFinite(m.d) && m.d > 0) {
      e.hp -= Math.min(m.d, 1000);
      if (e.hp <= 0) finishEvent(state, e, now);
    } else if (m.t === 'evgrab' && e.id === 'ufo' && e.target === me.id && !e.capture) {
      const pos = me.pos, t = (now - e.start) / 1000 - EVENTS.ufo.warning;
      if (!pos?.w || !pos.al || !Number.isFinite(pos.x) || !Number.isFinite(pos.z) || pos.y >= 4 || !Number.isFinite(pos.y) || t < 0 || t >= 9 || Math.hypot(pos.x - e.x, pos.z - e.z) > 4.5) return;
      e.capture = { at: t, x: pos.x, z: pos.z, y: pos.y };
    } else if (m.t === 'evcash' && e.id === 'cashrain' && Number.isInteger(m.i) && m.i >= 0 && m.i < 12 && !e.collected.includes(m.i)) {
      const pos = me.pos, bundle = cashLayout(e.x, e.z, e.seed)[m.i];
      if (now < e.start + (EVENTS.cashrain.warning + (bundle.height - 1.5) / 5) * 1000 || !pos?.w || !pos.al || pos.y >= 2 || !Number.isFinite(pos.y) || !Number.isFinite(pos.x) || !Number.isFinite(pos.z) || Math.hypot(pos.x - bundle.x, pos.z - bundle.z) >= 1.2) return;
      e.collected.push(m.i);
      // Persist the claim before granting it; duplicate/retried requests cannot pay twice.
      await this.saveEvents(state, now);
      ws.send(JSON.stringify({ t: 'evaward', key: e.key, i: m.i, value: 25 }));
      this.broadcast({ t: 'events', now, active: state.active }); return;
    } else return;
    await this.saveEvents(state, now);
    this.broadcast({ t: 'events', now, active: state.active });
  }
  async left(ws) {
    const a = ws.deserializeAttachment();
    if (a && a.id && !a.gone) { ws.serializeAttachment({ ...a, gone: true }); this.broadcast({ t: 'leave', id: a.id }, ws); }
    if (!this.players().length) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.delete('events'); }
  }
}
