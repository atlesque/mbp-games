import { afterEach, expect, it, vi } from 'vitest';
import { GameRoom } from '../src/room.js';
function fixture(saved = new Map()) {
  const sockets = [], storage = { get: async k => saved.get(k), put: async (k,v) => saved.set(k, structuredClone(v)), setAlarm: vi.fn(), deleteAlarm: vi.fn(), delete: async k => saved.delete(k) };
  const ctx = { storage, getWebSockets: () => sockets, setWebSocketAutoResponse() {} };
  const room = new GameRoom(ctx, {});
  async function join() {
    let att = { id: null }; const ws = { sent: [], send(s) { this.sent.push(JSON.parse(s)); }, serializeAttachment(a) { att = a; }, deserializeAttachment: () => att };
    sockets.push(ws); await room.webSocketMessage(ws, JSON.stringify({ t: 'hello' })); return ws;
  }
  return { room, join, storage, saved, sockets, ctx };
}
afterEach(() => vi.useRealTimers());
it('persists independent server timers, broadcasts identical incidents and resumes after hibernation', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  const f = fixture(), a = await f.join(), b = await f.join();
  await f.room.webSocketMessage(a, JSON.stringify({ t: 's', w: 1, al: 1, x: 50, z: 20, y: 0 }));
  const state = f.saved.get('events');
  expect(state).toBeTruthy(); state.next.godzilla = state.next.tsunami = Date.now();
  f.saved.set('events', state);
  const revived = new GameRoom(f.ctx, {}); await revived.alarm();
  const packet = a.sent.filter(m => m.t === 'events').at(-1);
  expect(packet.active.map(e => e.id)).toEqual(expect.arrayContaining(['godzilla', 'tsunami']));
  expect(b.sent.filter(m => m.t === 'events').at(-1)).toEqual(packet);
  expect(packet.active.find(e => e.id === 'godzilla').x).toBe(50);
  const c = await f.join(); expect(c.sent.filter(m => m.t === 'events').at(-1).active).toEqual(packet.active);
});
it('rejects forged snapshots, shares boss health and awards a cash bundle only once', async () => {
  const f = fixture(), a = await f.join(), b = await f.join();
  await f.room.webSocketMessage(a, JSON.stringify({ t: 'events', active: [] }));
  expect(b.sent.filter(m => m.t === 'events')).toHaveLength(1);
  await f.room.webSocketMessage(a, JSON.stringify({ t: 's', w: 1, al: 1, x: 0, z: 0, y: 0 }));
  const state = f.saved.get('events'); state.next.godzilla = state.next.cashrain = Date.now(); f.saved.set('events', state);
  await f.room.alarm();
  const active = a.sent.filter(m => m.t === 'events').at(-1).active, boss = active.find(e => e.id === 'godzilla'), cash = active.find(e => e.id === 'cashrain');
  await f.room.webSocketMessage(a, JSON.stringify({ t: 'evhit', key: boss.key, d: 100 }));
  expect(b.sent.filter(m => m.t === 'events').at(-1).active.find(e => e.key === boss.key).hp).toBe(11900);
  // Cannot collect before the warning and falling animation finish.
  await f.room.webSocketMessage(a, JSON.stringify({ t: 'evcash', key: cash.key, i: 0 }));
  expect(a.sent.some(m => m.t === 'evaward')).toBe(false);
});
it('keeps major cooldowns independent, enforces one abduction target and one cash payout, and stops empty rooms', async () => {
  vi.useFakeTimers(); vi.setSystemTime(2000000);
  const f = fixture(), a = await f.join(), b = await f.join();
  const tell = (ws, m) => f.room.webSocketMessage(ws, JSON.stringify(m));
  await tell(a, { t: 's', w: 1, al: 1, x: 50, z: 0, y: 0 });
  const state = f.saved.get('events');
  state.next.ufo = state.next.cashrain = state.next.godzilla = state.next.tsunami = Date.now();
  f.saved.set('events', state); await f.room.alarm();
  let packet = a.sent.filter(m => m.t === 'events').at(-1);
  const ufo = packet.active.find(e => e.id === 'ufo'), cash = packet.active.find(e => e.id === 'cashrain');
  vi.setSystemTime(Date.now() + 12000);
  await tell(b, { t: 'evgrab', key: ufo.key });
  expect(f.saved.get('events').active.find(e => e.id === 'ufo').capture).toBeUndefined();
  await tell(a, { t: 'evgrab', key: ufo.key });
  expect(b.sent.filter(m => m.t === 'events').at(-1).active.find(e => e.id === 'ufo').capture).toMatchObject({ x: 50, z: 0, at: 4 });
  const { cashLayout } = await import('../src/event-random.js');
  const bundle = cashLayout(cash.x, cash.z, cash.seed)[0];
  await tell(a, { t: 's', w: 1, al: 1, x: bundle.x, z: bundle.z, y: 0, v: { m: 'car' } });
  await tell(b, { t: 's', w: 1, al: 1, x: bundle.x, z: bundle.z, y: 0 });
  await tell(a, { t: 'evcash', key: cash.key, i: 0 });
  await tell(b, { t: 'evcash', key: cash.key, i: 0 });
  expect(a.sent.filter(m => m.t === 'evaward')).toHaveLength(1);
  expect(b.sent.filter(m => m.t === 'evaward')).toHaveLength(0);
  vi.setSystemTime(2060000); await f.room.alarm();
  const next = f.saved.get('events').next;
  expect(next.godzilla - Date.now()).toBeGreaterThanOrEqual(120000);
  expect(next.godzilla - Date.now()).toBeLessThanOrEqual(240000);
  await f.room.webSocketError(a); await f.room.webSocketError(b);
  expect(f.saved.has('events')).toBe(false); expect(f.storage.deleteAlarm).toHaveBeenCalled();
});
