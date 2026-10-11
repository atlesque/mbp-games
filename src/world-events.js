import { EVENTS, INTENSITY } from './world-event-data.js';
const range = ([a, b]) => (a + Math.random() * (b - a)) * 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const road = x => clamp(Math.round(x / 50) * 50, -200, 200);
const hp = { ufo: 600, godzilla: 12000, invasion: 3500 };
export function newEvents(now) {
  return { next: Object.fromEntries(Object.entries(EVENTS).map(([id, def]) => [id, now + range(INTENSITY[def.intensity].initial)])), active: [] };
}
export function finishEvent(state, e, now) {
  state.active = state.active.filter(a => a.key !== e.key);
  state.next[e.id] = now + range(INTENSITY[EVENTS[e.id].intensity].cooldown);
}
export function advanceEvents(state, now, players) {
  for (const e of [...state.active]) if (now >= e.end) finishEvent(state, e, now);
  const present = players.filter(p => p.pos?.w && p.pos.al && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z));
  for (const [id, def] of Object.entries(EVENTS)) {
    if (state.active.some(e => e.id === id) || state.next[id] > now) continue;
    // Empty/title-only rooms don't launch disasters; try when a player returns.
    if (!present.length) { state.next[id] = now + 5000; continue; }
    const target = present[Math.floor(Math.random() * present.length)], { x, z } = target.pos;
    state.active.push({ id, key: crypto.randomUUID(), seed: Math.floor(Math.random() * 4294967296), start: now, end: now + (def.warning + def.duration) * 1000,
      x: id === 'volcano' ? 232 : id === 'ufo' ? x : road(x),
      z: id === 'volcano' ? clamp(z, -160, 160) : id === 'ufo' ? z : ['godzilla', 'tornado', 'meteors', 'tsunami'].includes(id) ? clamp(z - 65, -175, 80) : clamp(road(z), -150, 150),
      target: target.id, hp: hp[id], collected: [] });
  }
}
