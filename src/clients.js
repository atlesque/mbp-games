// ================= GAMES =================
// Every game that signs players in with an MBP Games account. A game's id is also its client id.
// `origins` are the pages allowed to send players here and receive them back (and to call the API);
// `summary` turns a save into the few numbers the admin page shows.
export const GAMES = {
  'scrum-city': {
    name: 'MBP - Scrum City',
    url: 'https://mbp-scrum-city.atlesque.dev/',
    origins: [
      'https://mbp-scrum-city.atlesque.dev',
      'https://mbp-scrum-city.pages.dev',
      /^https:\/\/[a-z0-9-]+\.mbp-scrum-city\.pages\.dev$/, // Cloudflare Pages previews
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ],
    summary(d) {
      const w = (d && d.weapons) || {};
      const owned = Object.keys(w.owned || {}).filter(id => w.owned[id] && id !== 'fist');
      return { money: d && typeof d.money === 'number' ? d.money : null, weapons: owned, kills: d && d.stats ? d.stats.kills || 0 : 0 };
    },
  },
};

export function originAllowed(game, origin) {
  const g = GAMES[game];
  return !!(g && origin && g.origins.some(o => typeof o === 'string' ? o === origin : o.test(origin)));
}
// any game's origin, for CORS on endpoints that are not tied to one game
export function anyGameOrigin(origin) {
  return Object.keys(GAMES).some(id => originAllowed(id, origin));
}
export function redirectAllowed(game, uri) {
  let u;
  try { u = new URL(uri); } catch (e) { return false; }
  return !u.username && !u.password && !u.hash && originAllowed(game, u.origin);
}
