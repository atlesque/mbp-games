// ================= GAMES =================
// Every game that signs players in with an Atlesque account. A game's id is also its client id.
// `origins` are the pages allowed to send players here and receive them back (and to call the API);
// `summary` turns a save into the few numbers the hub and admin page show.
// `currency` is the number in the save an admin can top up, and what to call it.
// `maxSave` (bytes) raises the default 64 KB save limit for a game whose save is a whole library.
export const GAMES = {
  'expedition-33-guide': {
    name: 'Clair Obscur: Expedition 33 Guide',
    url: 'https://coe33.atlesque.dev/',
    origins: [
      'https://coe33.atlesque.dev',
      'https://clair-obscur-expedition-33-guide.pages.dev',
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ],
    maxSave: 256 * 1024,
    summary(d) {
      const runs = d?.save?.playthroughs;
      return { playthroughs: Array.isArray(runs) ? runs.length : 0 };
    },
  },
  'scrum-city': {
    name: 'MBP - Scrum City',
    url: 'https://mbp-scrum-city.atlesque.dev/',
    origins: [
      'https://mbp-scrum-city.atlesque.dev',
      'https://mbp-scrum-city.pages.dev',
      /^https:\/\/[a-z0-9-]+\.mbp-scrum-city\.pages\.dev$/, // Cloudflare Pages previews
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ],
    currency: { key: 'money', label: 'money' },
    summary(d) {
      const w = (d && d.weapons) || {};
      const owned = Object.keys(w.owned || {}).filter(id => w.owned[id] && id !== 'fist');
      return { money: d && typeof d.money === 'number' ? d.money : null, weapons: owned, kills: d && d.stats ? d.stats.kills || 0 : 0,
        // five star heat highscore: whole seconds spent at five stars, ever
        fiveStar: d && d.stats ? Math.floor(d.stats.fiveStar || 0) : 0 };
    },
  },
  wingrid: {
    name: 'Wingrid',
    url: 'https://wingrid.atlesque.dev/',
    origins: [
      'https://wingrid.atlesque.dev',
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ],
    // free play credits only, nothing here is real money
    currency: { key: 'credits', label: 'credits' },
    summary(d) {
      const s = (d && d.stats) || {};
      return { credits: d && typeof d.credits === 'number' ? d.credits : null, spins: s.spins || 0, biggestWin: s.biggestWin || 0, features: s.features || 0 };
    },
  },
  // the team's draw-and-guess game; signing in is optional (guests play too), the save only holds totals for the hub
  sketch: {
    name: 'Sketch',
    url: 'https://sketch.atlesque.dev/',
    origins: [
      'https://sketch.atlesque.dev',
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ],
    summary(d) {
      const s = (d && d.stats) || {};
      return { games: s.games || 0, wins: s.wins || 0, points: s.points || 0 };
    },
  },
  chordstand: {
    name: 'Chordstand',
    url: 'https://chordstand.atlesque.dev/',
    origins: [
      'https://chordstand.atlesque.dev',
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ],
    // the save is the player's whole song library (compressed), so it gets more room than a game's
    maxSave: 1024 * 1024,
    summary(d) {
      return { songs: d && typeof d.songs === 'number' ? d.songs : 0 };
    },
  },
};

export const maxSave = game => (GAMES[game] && GAMES[game].maxSave) || 64 * 1024;

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
