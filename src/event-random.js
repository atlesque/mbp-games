// Wire contract: keep this pure helper identical to mbp-games/src/event-random.js.
export function seeded(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function cashLayout(x, z, seed) {
  const random = seeded(seed), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  return Array.from({ length: 12 }, (_, index) => ({ index, x: clamp(x - 4 + random() * 8, -195, 240), z: clamp(z - 18 + random() * 36, -195, 195), height: 15 + random() * 20 }));
}
