import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { FULL_CODE, GameRoom, MAX_PLAYERS, cleanName } from '../src/room.js';

// A hibernating room without the runtime: sockets keep their attachment and what was sent to them.
function fakeSocket() {
  let att = null;
  return {
    sent: [], closed: null,
    send(t) { this.sent.push(JSON.parse(t)); },
    close(code) { this.closed = code; },
    serializeAttachment(a) { att = structuredClone(a); },
    deserializeAttachment() { return att; },
    last(t) { return this.sent.filter(m => m.t === t).at(-1); },
  };
}
function fakeRoom() {
  const sockets = [];
  const ctx = { acceptWebSocket: ws => sockets.push(ws), getWebSockets: () => sockets.filter(ws => ws.closed == null), setWebSocketAutoResponse() {} };
  const room = new GameRoom(ctx, {});
  // what fetch() does with a new socket, without a real WebSocketPair
  room.connect = async (name) => {
    const ws = fakeSocket(); ctx.acceptWebSocket(ws);
    if (ctx.getWebSockets().length > MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); ws.close(FULL_CODE); return ws; }
    ws.serializeAttachment({ id: null, name: null });
    if (name !== undefined) await room.webSocketMessage(ws, JSON.stringify({ t: 'hello', name }));
    return ws;
  };
  return room;
}

describe('multiplayer room', () => {
  it('welcomes a player with who is already there and tells the others', async () => {
    const room = fakeRoom();
    const a = await room.connect('Alex'), b = await room.connect('Bo');
    const wa = a.last('welcome'), wb = b.last('welcome');
    expect(wa.players).toEqual([]);
    expect(wb.players).toEqual([{ id: wa.id, name: 'Alex' }]);
    expect(wb.max).toBe(16);
    expect(a.last('join')).toEqual({ t: 'join', id: wb.id, name: 'Bo' });
  });

  it('relays state to everyone else, and a hit only to the player it is for', async () => {
    const room = fakeRoom();
    const a = await room.connect('A'), b = await room.connect('B'), c = await room.connect('C');
    const ida = a.last('welcome').id, idb = b.last('welcome').id;
    await room.webSocketMessage(a, JSON.stringify({ t: 's', x: 1, z: 2 }));
    expect(b.last('s')).toEqual({ t: 's', x: 1, z: 2, id: ida });
    expect(c.last('s')).toEqual({ t: 's', x: 1, z: 2, id: ida });
    expect(a.last('s')).toBeUndefined();
    await room.webSocketMessage(a, JSON.stringify({ t: 'hit', to: idb, d: 20, z: 'head' }));
    expect(b.last('hit')).toEqual({ t: 'hit', to: idb, d: 20, z: 'head', from: ida });
    expect(c.last('hit')).toBeUndefined();
  });

  it('ignores players who have not said hello, unknown types and oversized messages', async () => {
    const room = fakeRoom();
    const a = await room.connect('A'), lurker = await room.connect();
    await room.webSocketMessage(lurker, JSON.stringify({ t: 's', x: 9 }));
    await room.webSocketMessage(a, JSON.stringify({ t: 'nope' }));
    await room.webSocketMessage(a, JSON.stringify({ t: 's', pad: 'x'.repeat(3000) }));
    await room.webSocketMessage(a, 'not json');
    expect(a.sent.map(m => m.t)).toEqual(['welcome']);
    expect(lurker.sent).toEqual([]);
  });

  it('takes sixteen players and turns the seventeenth away', async () => {
    const room = fakeRoom(), in16 = [];
    for (let i = 0; i < MAX_PLAYERS; i++) in16.push(await room.connect('P' + i));
    expect(in16.every(ws => ws.last('welcome'))).toBe(true);
    const late = await room.connect('Late');
    expect(late.closed).toBe(FULL_CODE);
    expect(late.last('full')).toBeTruthy();
    // one leaves, so the next one gets in
    in16[0].closed = 1000; await room.webSocketClose(in16[0], 1000);
    expect(in16[1].last('leave')).toEqual({ t: 'leave', id: in16[0].last('welcome').id });
    expect((await room.connect('Next')).last('welcome')).toBeTruthy();
  });

  it('cleans names', () => {
    expect(cleanName('  <b>Neo</b>  ')).toBe('bNeo/b');
    expect(cleanName('')).toBe('Guest');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
  });

  it('only lets the game\'s own pages in', async () => {
    const env = { ROOMS: { idFromName: n => n, get: () => ({ fetch: async () => new Response('room') }) } };
    const ask = (path, origin) => worker.fetch(new Request('https://accounts.atlesque.dev' + path, { headers: { upgrade: 'websocket', ...(origin ? { origin } : {}) } }), env, {});
    expect((await ask('/mp/scrum-city', 'https://evil.example')).status).toBe(403);
    expect((await ask('/mp/nope', 'https://mbp-scrum-city.atlesque.dev')).status).toBe(404);
    expect(await (await ask('/mp/scrum-city', 'https://mbp-scrum-city.atlesque.dev')).text()).toBe('room');
  });
});
