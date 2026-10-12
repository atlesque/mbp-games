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
// make these events' clocks run out now (the more listed first, the more overdue), with no quiet stretch left
function due(f, ...ids) {
  const state = f.saved.get('events'); state.quiet = 0; ids.forEach((id, i) => { state.left[id] = -1000 * (ids.length - i); }); f.saved.set('events', state);
}
const last = ws => ws.sent.filter(m => m.t === 'events').at(-1);
it('persists the clocks, broadcasts identical incidents and resumes after hibernation', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  const f = fixture(), a = await f.join(), b = await f.join();
  await f.room.webSocketMessage(a, JSON.stringify({ t: 's', w: 1, al: 1, x: 50, z: 20, y: 0 }));
  expect(f.saved.get('events')).toBeTruthy();
  due(f, 'godzilla');
  const revived = new GameRoom(f.ctx, {}); await revived.alarm();
  const packet = last(a);
  expect(packet.active.map(e => e.id)).toEqual(['godzilla']);
  expect(last(b)).toEqual(packet);
  expect(packet.active[0].x).toBe(50);
  const c = await f.join(); expect(last(c).active).toEqual(packet.active);
});
it('runs one incident at a time, holds the other clocks and leaves a quiet stretch before the next', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  const f = fixture(), a = await f.join();
  await f.room.webSocketMessage(a, JSON.stringify({ t: 's', w: 1, al: 1, x: 0, z: 0, y: 0 }));
  due(f, 'tsunami', 'godzilla');
  const held = f.saved.get('events').left.fireworks;
  await f.room.alarm();
  expect(last(a).active.map(e => e.id)).toEqual(['tsunami']);
  const end = last(a).active[0].end;
  vi.setSystemTime(end - 1000); await f.room.alarm();
  expect(last(a).active.map(e => e.id)).toEqual(['tsunami']);
  expect(f.saved.get('events').left.fireworks).toBe(held);
  vi.setSystemTime(end); await f.room.alarm();
  const quiet = f.saved.get('events').quiet;
  expect(last(a).active).toEqual([]);
  expect(quiet - end).toBeGreaterThanOrEqual(20000); expect(quiet - end).toBeLessThanOrEqual(40000);
  expect(f.storage.setAlarm).toHaveBeenLastCalledWith(quiet);
  expect(f.saved.get('events').left.fireworks).toBe(held);
  vi.setSystemTime(quiet - 1); await f.room.alarm();
  expect(last(a).active).toEqual([]);
  vi.setSystemTime(quiet); await f.room.alarm();
  expect(last(a).active.map(e => e.id)).toEqual(['godzilla']);
});
it('keeps the clocks waiting while nobody is out in the city', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  const f = fixture(), a = await f.join();
  const left = f.saved.get('events').left.cashrain;
  vi.setSystemTime(1000000 + 600000); await f.room.alarm();
  expect(f.saved.get('events').left.cashrain).toBe(left);
  expect(f.storage.setAlarm).toHaveBeenLastCalledWith(Date.now() + 5000);
  await f.room.webSocketMessage(a, JSON.stringify({ t: 's', w: 0 }));
  expect(last(a).active).toEqual([]);
});
it('rejects forged snapshots, shares boss health and keeps cash until it has landed', async () => {
  const f = fixture(), a = await f.join(), b = await f.join();
  await f.room.webSocketMessage(a, JSON.stringify({ t: 'events', active: [] }));
  expect(b.sent.filter(m => m.t === 'events')).toHaveLength(1);
  await f.room.webSocketMessage(a, JSON.stringify({ t: 's', w: 1, al: 1, x: 0, z: 0, y: 0 }));
  due(f, 'godzilla'); await f.room.alarm();
  const boss = last(a).active.find(e => e.id === 'godzilla');
  await f.room.webSocketMessage(a, JSON.stringify({ t: 'evhit', key: boss.key, d: 100 }));
  expect(last(b).active.find(e => e.key === boss.key).hp).toBe(11900);
  for (let i = 0; i < 12; i++) await f.room.webSocketMessage(a, JSON.stringify({ t: 'evhit', key: boss.key, d: 1000 }));
  expect(last(b).active).toEqual([]);
  due(f, 'cashrain'); await f.room.alarm();
  const cash = last(a).active.find(e => e.id === 'cashrain');
  // Cannot collect before the warning and falling animation finish.
  await f.room.webSocketMessage(a, JSON.stringify({ t: 'evcash', key: cash.key, i: 0 }));
  expect(a.sent.some(m => m.t === 'evaward')).toBe(false);
});
it('enforces one abduction target and one cash payout, and stops empty rooms', async () => {
  vi.useFakeTimers(); vi.setSystemTime(2000000);
  const f = fixture(), a = await f.join(), b = await f.join();
  const tell = (ws, m) => f.room.webSocketMessage(ws, JSON.stringify(m));
  await tell(a, { t: 's', w: 1, al: 1, x: 50, z: 0, y: 0 });
  due(f, 'ufo'); await f.room.alarm();
  const ufo = last(a).active.find(e => e.id === 'ufo');
  vi.setSystemTime(Date.now() + 12000);
  await tell(b, { t: 'evgrab', key: ufo.key });
  expect(f.saved.get('events').active.find(e => e.id === 'ufo').capture).toBeUndefined();
  await tell(a, { t: 'evgrab', key: ufo.key });
  expect(last(b).active.find(e => e.id === 'ufo').capture).toMatchObject({ x: 50, z: 0, at: 4 });
  vi.setSystemTime(ufo.end); await f.room.alarm();
  vi.setSystemTime(f.saved.get('events').quiet);
  due(f, 'cashrain'); await f.room.alarm();
  const cash = last(a).active.find(e => e.id === 'cashrain');
  const { cashLayout } = await import('../src/event-random.js');
  const bundle = cashLayout(cash.x, cash.z, cash.seed)[0];
  vi.setSystemTime(cash.start + 12000);
  await tell(a, { t: 's', w: 1, al: 1, x: bundle.x, z: bundle.z, y: 0, v: { m: 'car' } });
  await tell(b, { t: 's', w: 1, al: 1, x: bundle.x, z: bundle.z, y: 0 });
  await tell(a, { t: 'evcash', key: cash.key, i: 0 });
  await tell(b, { t: 'evcash', key: cash.key, i: 0 });
  expect(a.sent.filter(m => m.t === 'evaward')).toHaveLength(1);
  expect(b.sent.filter(m => m.t === 'evaward')).toHaveLength(0);
  vi.setSystemTime(cash.end); await f.room.alarm();
  const left = f.saved.get('events').left;
  expect(left.cashrain).toBeGreaterThanOrEqual(35000); expect(left.cashrain).toBeLessThanOrEqual(70000);
  await f.room.webSocketError(a); await f.room.webSocketError(b);
  expect(f.saved.has('events')).toBe(false); expect(f.storage.deleteAlarm).toHaveBeenCalled();
});
