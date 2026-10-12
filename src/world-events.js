import { EVENTS, INTENSITY } from './world-event-data.js';
const range = ([a, b]) => Math.round((a + Math.random() * (b - a)) * 1000);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const road = x => clamp(Math.round(x / 50) * 50, -200, 200);
const hp = { ufo: 600, godzilla: 12000, invasion: 3500 };
// Quiet stretch after the last incident ends, before any waiting clock runs again (Scrum City's local mode: rand(20, 40)).
export const QUIET = [20, 40];
// Retry while nobody is out in the city: the clocks wait for a player, like a solo game's do on the title screen.
export const ABSENT_RETRY = 5000;

// Incidents take turns, as in Scrum City's local mode: each event's clock (`left`, ms) only runs while nothing is
// active and the quiet stretch is over, and at most one incident starts at a time (the most overdue one).
// `clock` is when the clocks last ran (or were held).
export function newEvents(now) {
  return { left: Object.fromEntries(Object.entries(EVENTS).map(([id, def]) => [id, range(INTENSITY[def.intensity].initial)])), active: [], quiet: 0, clock: now };
}
export function finishEvent(state, e, now) {
  state.active = state.active.filter(a => a.key !== e.key);
  state.left[e.id] = range(INTENSITY[EVENTS[e.id].intensity].cooldown);
  if (!state.active.length) { state.quiet = now + range(QUIET); state.clock = now; }
}
const present = players => players.filter(p => p.pos?.w && p.pos.al && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z));
export function advanceEvents(state, now, players) {
  for (const e of [...state.active]) if (now >= e.end) finishEvent(state, e, now);
  const here = present(players);
  // Held through an incident, its quiet stretch, and while nobody is out in the city.
  if (state.active.length || now < state.quiet || !here.length) { state.clock = Math.max(state.clock, now); return; }
  const ran = now - Math.max(state.clock, state.quiet);
  state.clock = now;
  let next = null;
  for (const id of Object.keys(EVENTS)) {
    state.left[id] -= ran;
    if (state.left[id] <= 0 && (next === null || state.left[id] < state.left[next])) next = id;
  }
  if (next !== null) startEvent(state, next, now, here[Math.floor(Math.random() * here.length)]);
}
export function startEvent(state, id, now, target) {
  const def = EVENTS[id], { x, z } = target.pos;
  const e = { id, key: crypto.randomUUID(), seed: Math.floor(Math.random() * 4294967296), start: now, end: now + (def.warning + def.duration) * 1000,
    x: id === 'volcano' ? 232 : id === 'ufo' ? x : road(x),
    z: id === 'volcano' ? clamp(z, -160, 160) : id === 'ufo' ? z : ['godzilla', 'tornado', 'meteors', 'tsunami'].includes(id) ? clamp(z - 65, -175, 80) : clamp(road(z), -150, 150),
    target: target.id, hp: hp[id], collected: [] };
  state.active.push(e);
  return e;
}
// When the room should wake next: the end of the running incident, the end of the quiet stretch, the next clock to run
// out, or a retry while nobody is out in the city.
export function nextDeadline(state, now, players) {
  if (state.active.length) return Math.min(...state.active.map(e => e.end));
  if (now < state.quiet) return state.quiet;
  if (!present(players).length) return now + ABSENT_RETRY;
  return now + Math.max(0, Math.min(...Object.values(state.left)));
}
