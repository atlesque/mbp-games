import { DurableObject } from 'cloudflare:workers';

// ================= MULTIPLAYER ROOM =================
// One shared city per game: a Durable Object that relays what each player sends to everyone else in it. It keeps
// no game state of its own (each player's game is the authority on its own player), so it only runs while a message
// is passing through. The sockets use the WebSocket Hibernation API: between messages, and as soon as the last
// player leaves, the object hibernates and costs nothing. Keep it that way: no alarms, timers or accept().
//
// Messages are small JSON objects with a type `t`. From a player:
//   hello { name }           first, once: the name shown over their head (cleaned up and cut to NAME_MAX)
//   s     { ... }            their state (where they are, what they hold or ride): relayed to everyone else as is
//   shot / boom / kill       relayed to everyone else
//   hit / vhit { to, ... }   damage for one other player (their body, or the vehicle they drive): sent to them only
// To a player:
//   welcome { id, max, players: [{ id, name }] }, join { id, name }, leave { id }, and the relayed messages with `id`
//   (and for hit / vhit, `from`) naming the player who sent them.
// A full room answers `full` and closes with FULL_CODE. The plain text 'ping' is answered 'pong' without waking the room.
export const MAX_PLAYERS = 16, NAME_MAX = 16, MSG_MAX = 2048, FULL_CODE = 4001;
const RELAY = new Set(['s', 'shot', 'boom', 'kill']), DIRECT = new Set(['hit', 'vhit']);

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
      return;
    }
    if (!me.id) return;
    if (RELAY.has(m.t)) { this.broadcast({ ...m, id: me.id }, ws); return; }
    if (DIRECT.has(m.t)) {
      const to = this.players().find(p => p.id === m.to);
      if (to && to.ws !== ws) try { to.ws.send(JSON.stringify({ ...m, from: me.id })); } catch (e) {}
    }
  }

  async webSocketClose(ws, code) { this.left(ws); try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (e) {} }
  async webSocketError(ws) { this.left(ws); }
  left(ws) {
    const a = ws.deserializeAttachment();
    if (a && a.id && !a.gone) { ws.serializeAttachment({ ...a, gone: true }); this.broadcast({ t: 'leave', id: a.id }, ws); }
  }
}
