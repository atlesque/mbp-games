import { GAMES, anyGameOrigin, originAllowed, redirectAllowed } from './clients.js';
import { sendSignInEmail, signInEmail } from './email.js';
import { DAY, HOUR, HttpError, MIN, cookie, esc, getCookie, hash, json, normalizeEmail, now, pkceChallenge, randomToken, readJson } from './util.js';

// ================= MBP GAMES ACCOUNTS =================
// One account per email, shared by every MBP game. Sign-in is passwordless: the player asks for a link on
// the hosted page (/signin), the emailed link confirms the address, and the tab that asked carries on.
// Games never see the email flow: they send the player to /signin with a PKCE challenge and swap the
// code they get back for a bearer token (/api/token). The admin page (/admin) is for ADMIN_EMAILS.
// (a Worker entry module may only export handlers, so these stay private)
const LINK_TTL = 15 * MIN, CODE_TTL = 2 * MIN, SESSION_TTL = 90 * DAY;
const WEB_COOKIE = 'mbpg_session';
const MAX_SAVE = 64 * 1024;
const LIMITS = { perEmail: [5, 15 * MIN], perIp: [20, HOUR] };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, url);
    if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    let res;
    try {
      res = await route(req, env, url, ctx);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      res = e instanceof HttpError ? json({ error: e.code, message: e.message }, e.status) : json({ error: 'server', message: 'Something went wrong on our side.' }, 500);
    }
    if (cors) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
  // daily: drop expired links, codes and sessions
  async scheduled(evt, env) { await cleanup(env.DB); },
};

// The game-facing endpoints answer the games' own pages; everything else is same-origin only.
const GAME_API = /^\/api\/(token|me|logout|games\/[a-z0-9-]+\/progress)$/;
function corsHeaders(req, url) {
  const origin = req.headers.get('origin');
  if (!origin || !GAME_API.test(url.pathname) || !anyGameOrigin(origin)) return null;
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400', vary: 'Origin' };
}

async function route(req, env, url, ctx) {
  const p = url.pathname, m = req.method;
  // game API (bearer token)
  if (p === '/api/token' && m === 'POST') return exchangeCode(req, env);
  if (p === '/api/me' && m === 'GET') { const { user } = await gameAuth(req, env); return json({ user: publicUser(user) }); }
  if (p === '/api/logout' && m === 'POST') { const t = bearer(req); if (t) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(t)).run(); return json({ ok: true }); }
  const pm = p.match(/^\/api\/games\/([a-z0-9-]+)\/progress$/);
  if (pm && m === 'GET') return getProgress(req, env, pm[1]);
  if (pm && m === 'PUT') return putProgress(req, env, pm[1]);
  // hosted sign-in (cookie on this site)
  if (p.startsWith('/api/') || p.startsWith('/auth/')) { if (m === 'POST') sameOrigin(req, url); }
  if (p === '/api/session' && m === 'GET') return sessionInfo(req, env, url);
  if (p === '/api/signin/start' && m === 'POST') return startSignIn(req, env, url, ctx);
  if (p === '/api/signin/poll' && m === 'POST') return pollSignIn(req, env, url);
  if (p === '/api/signin/continue' && m === 'POST') return continueSignIn(req, env, url);
  if (p === '/api/signout' && m === 'POST') return signOut(req, env);
  if (p === '/api/account' && m === 'GET') return account(req, env);
  if (p === '/auth/link' && m === 'GET') return linkPage(req, env, url);
  if (p === '/auth/link' && m === 'POST') return confirmLink(req, env, url);
  // admin
  if (p.startsWith('/api/admin/')) return admin(req, env, url);
  if (p.startsWith('/api/') || p.startsWith('/auth/')) throw new HttpError(404, 'not_found', 'No such endpoint.');
  return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
}

// cookie-authenticated writes must come from our own pages
function sameOrigin(req, url) {
  if (req.headers.get('origin') !== url.origin) throw new HttpError(403, 'bad_origin', 'That request did not come from this site.');
}

// ---------- users and sessions ----------
const publicUser = u => ({ id: u.id, email: u.email });
const isAdmin = (env, u) => !!u && String(env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,]+/).filter(Boolean).includes(u.email);
const banned = u => new HttpError(403, 'banned', u.ban_reason ? `This account is banned: ${u.ban_reason}` : 'This account is banned.');

async function findOrCreateUser(db, email) {
  let u = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (u) return u;
  const id = crypto.randomUUID(), t = now();
  await db.prepare('INSERT INTO users (id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING').bind(id, email, t, t).run();
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}
async function newSession(db, userId, kind, client = null) {
  const token = randomToken(), t = now();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, kind, client, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await hash(token), userId, kind, client, t, t, t + SESSION_TTL).run();
  return token;
}
async function sessionUser(db, token, kind) {
  if (!token) return null;
  const h = await hash(token);
  const row = await db.prepare('SELECT s.token_hash, s.expires_at, s.last_used_at, s.client, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.kind = ?').bind(h, kind).first();
  if (!row || row.expires_at < now()) return null;
  // touch at most once an hour so a busy player doesn't write on every request
  if (now() - row.last_used_at > HOUR) await db.batch([
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').bind(now(), h),
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now(), row.id),
  ]);
  return { user: row, client: row.client };
}
const bearer = req => { const a = req.headers.get('authorization') || ''; return a.startsWith('Bearer ') ? a.slice(7).trim() : null; };
async function gameAuth(req, env) {
  const s = await sessionUser(env.DB, bearer(req), 'game');
  if (!s) throw new HttpError(401, 'signed_out', 'Sign in again.');
  if (s.user.banned_at) throw banned(s.user);
  return s;
}
async function webUser(req, env) {
  const s = await sessionUser(env.DB, getCookie(req, WEB_COOKIE), 'web');
  return s ? s.user : null;
}
const webCookie = token => cookie(WEB_COOKIE, token, SESSION_TTL / 1000);

// ---------- hosted sign-in ----------
// What the sign-in page is about to do: which game sent the player, where they go back to, and whether
// they are already signed in on this site (then it's one click).
function readTarget(q) {
  const client = q.client || null;
  if (!client) {
    const next = typeof q.next === 'string' && /^\/[a-z0-9/_-]*$/i.test(q.next) ? q.next : '/';
    return { client: null, next };
  }
  if (!GAMES[client]) throw new HttpError(400, 'bad_client', 'That game is not one of ours.');
  if (!redirectAllowed(client, q.redirect_uri)) throw new HttpError(400, 'bad_redirect', 'That page is not allowed to sign in with MBP Games.');
  if (typeof q.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) throw new HttpError(400, 'bad_challenge', 'The game sent an invalid sign-in request.');
  return { client, redirect_uri: q.redirect_uri, state: typeof q.state === 'string' ? q.state.slice(0, 200) : '', code_challenge: q.code_challenge };
}
async function sessionInfo(req, env, url) {
  const q = Object.fromEntries(url.searchParams);
  const target = readTarget(q), u = await webUser(req, env);
  const g = target.client && GAMES[target.client];
  return json({ user: u && !u.banned_at ? publicUser(u) : null, admin: isAdmin(env, u), game: g ? { id: target.client, name: g.name, url: g.url } : null });
}
// where the player goes once signed in: back to the game with a one-time code, or a page on this site
async function finishTarget(db, user, t) {
  if (!t.client) return t.next || '/';
  const code = randomToken();
  await db.prepare('INSERT INTO auth_codes (code_hash, user_id, client, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await hash(code), user.id, t.client, t.redirect_uri, t.code_challenge, now() + CODE_TTL).run();
  const u = new URL(t.redirect_uri);
  u.searchParams.set('mbpg_code', code); u.searchParams.set('mbpg_state', t.state || '');
  return u.toString();
}

async function startSignIn(req, env, url, ctx) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, 'bad_email', 'That does not look like an email address.');
  const target = readTarget(body), db = env.DB, t = now();
  const ip = req.headers.get('cf-connecting-ip') || '';
  const existing = await db.prepare('SELECT banned_at, ban_reason FROM users WHERE email = ?').bind(email).first();
  if (existing && existing.banned_at) throw banned(existing);
  const byEmail = await db.prepare('SELECT COUNT(*) AS n FROM magic_links WHERE email = ? AND created_at > ?').bind(email, t - LIMITS.perEmail[1]).first('n');
  const byIp = ip ? await db.prepare('SELECT COUNT(*) AS n FROM magic_links WHERE ip = ? AND created_at > ?').bind(ip, t - LIMITS.perIp[1]).first('n') : 0;
  if (byEmail >= LIMITS.perEmail[0] || byIp >= LIMITS.perIp[0]) throw new HttpError(429, 'slow_down', 'Too many sign-in emails. Wait a few minutes and try again.');
  const id = crypto.randomUUID(), token = randomToken(), poll = randomToken();
  await db.prepare(`INSERT INTO magic_links (id, token_hash, poll_hash, email, client, redirect_uri, state, code_challenge, ip, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, await hash(token), await hash(poll), email, target.client, target.client ? target.redirect_uri : target.next,
    target.state || null, target.code_challenge || null, ip, t, t + LINK_TTL).run();
  const link = `${url.origin}/auth/link?t=${token}`;
  try {
    await sendSignInEmail(env, email, signInEmail({ link, gameName: target.client && GAMES[target.client].name, minutes: LINK_TTL / MIN }));
  } catch (e) {
    console.error('sign-in email failed', e && e.code, e && e.message);
    await db.prepare('DELETE FROM magic_links WHERE id = ?').bind(id).run();
    throw new HttpError(502, 'email_failed', 'We could not send the email. Check the address and try again.');
  }
  return json({ request: id, poll, expiresAt: t + LINK_TTL });
}
const linkTarget = l => l.client ? { client: l.client, redirect_uri: l.redirect_uri, state: l.state, code_challenge: l.code_challenge } : { client: null, next: l.redirect_uri };

// The tab that asked for the link polls here. Once the link is opened (on any device), the first poll
// signs this browser in too and hands back where to go.
async function pollSignIn(req, env) {
  const body = await readJson(req), db = env.DB;
  if (typeof body.request !== 'string' || typeof body.poll !== 'string') throw new HttpError(400, 'bad_request', 'Missing request.');
  const l = await db.prepare('SELECT * FROM magic_links WHERE id = ?').bind(body.request).first();
  if (!l || l.poll_hash !== await hash(body.poll)) throw new HttpError(404, 'unknown', 'That sign-in request is gone. Ask for a new link.');
  if (l.finished_at) return json({ status: 'used' });
  if (!l.confirmed_at) return json({ status: l.expires_at < now() ? 'expired' : 'pending' });
  const claimed = await db.prepare('UPDATE magic_links SET finished_at = ? WHERE id = ? AND finished_at IS NULL').bind(now(), l.id).run();
  if (!claimed.meta.changes) return json({ status: 'used' });
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(l.user_id).first();
  if (!user || user.banned_at) throw banned(user || {});
  const redirect = await finishTarget(db, user, linkTarget(l));
  return json({ status: 'done', redirect, user: publicUser(user) }, 200, { 'set-cookie': webCookie(await newSession(db, user.id, 'web')) });
}

// already signed in on this site: straight back to the game
async function continueSignIn(req, env) {
  const body = await readJson(req);
  const user = await webUser(req, env);
  if (!user) throw new HttpError(401, 'signed_out', 'Sign in first.');
  if (user.banned_at) throw banned(user);
  return json({ redirect: await finishTarget(env.DB, user, readTarget(body)), user: publicUser(user) });
}

async function signOut(req, env) {
  const t = getCookie(req, WEB_COOKIE);
  if (t) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(t)).run();
  return json({ ok: true }, 200, { 'set-cookie': cookie(WEB_COOKIE, '', 0) });
}

// the hub: who you are and the games you've played
async function account(req, env) {
  const u = await webUser(req, env);
  if (!u) return json({ user: null });
  const rows = (await env.DB.prepare('SELECT game, data, rev, updated_at FROM progress WHERE user_id = ? ORDER BY updated_at DESC').bind(u.id).all()).results;
  return json({ user: publicUser(u), banned: !!u.banned_at, admin: isAdmin(env, u), games: rows.map(r => gameRow(r)) });
}
function gameRow(r) {
  const g = GAMES[r.game], d = r.data ? JSON.parse(r.data) : null;
  return { game: r.game, name: g ? g.name : r.game, url: g ? g.url : null, rev: r.rev, updatedAt: r.updated_at, summary: d && g ? g.summary(d) : null };
}

// The emailed link. Opening it only shows a button: mail scanners that fetch every link must not use it up.
async function linkPage(req, env, url) {
  const token = url.searchParams.get('t') || '';
  const l = token && await env.DB.prepare('SELECT * FROM magic_links WHERE token_hash = ?').bind(await hash(token)).first();
  if (!l || l.expires_at < now() || l.confirmed_at) return page('Link expired', `<h1>This link has run out</h1><p>Sign-in links work once, for ${LINK_TTL / MIN} minutes. Go back to the game and ask for a new one.</p>`, 410);
  const game = l.client && GAMES[l.client];
  return page('Sign in', `<h1>Sign in${game ? ` to ${esc(game.name)}` : ''}</h1><p>as <b>${esc(l.email)}</b></p>
<form method="post" action="/auth/link"><input type="hidden" name="t" value="${esc(token)}"><button class="btn" autofocus>Sign in</button></form>
<p class="small">This also confirms your email address for your MBP Games account.</p>`);
}
async function confirmLink(req, env) {
  const form = await req.formData(), token = String(form.get('t') || ''), db = env.DB;
  const l = token && await db.prepare('SELECT * FROM magic_links WHERE token_hash = ?').bind(await hash(token)).first();
  if (!l || l.expires_at < now()) return page('Link expired', `<h1>This link has run out</h1><p>Go back to the game and ask for a new one.</p>`, 410);
  const user = await findOrCreateUser(db, l.email);
  if (user.banned_at) return page('Banned', `<h1>This account is banned</h1>${user.ban_reason ? `<p>${esc(user.ban_reason)}</p>` : ''}`, 403);
  const ok = await db.prepare('UPDATE magic_links SET confirmed_at = ?, user_id = ? WHERE id = ? AND confirmed_at IS NULL').bind(now(), user.id, l.id).run();
  if (!ok.meta.changes) return page('Already used', `<h1>This link was already used</h1><p>Go back to the game; it should have carried on by itself.</p>`, 410);
  const game = l.client && GAMES[l.client];
  const back = game ? `<p class="small">Closed it already? <a href="${esc(game.url)}">Open ${esc(game.name)}</a> and sign in again; you won't need another email in this browser.</p>` : `<p><a class="btn" href="${esc(l.redirect_uri || '/')}">Continue</a></p>`;
  return page('Signed in', `<h1>You're in</h1><p>Signed in as <b>${esc(user.email)}</b>.${game ? ` Go back to the ${esc(game.name)} tab: it carries on by itself.` : ''}</p>${back}`, 200,
    { 'set-cookie': webCookie(await newSession(db, user.id, 'web')) });
}
function page(title, body, status = 200, headers = {}) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · MBP Games</title><link rel="stylesheet" href="/style.css?v=1"></head><body><main class="card"><p class="brand">MBP Games</p>${body}</main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin', ...headers } });
}

// ---------- game API ----------
async function exchangeCode(req, env) {
  const body = await readJson(req), db = env.DB;
  if (typeof body.code !== 'string' || typeof body.code_verifier !== 'string') throw new HttpError(400, 'bad_request', 'Missing code.');
  const h = await hash(body.code);
  const c = await db.prepare('SELECT * FROM auth_codes WHERE code_hash = ?').bind(h).first();
  if (!c || c.expires_at < now() || c.client !== body.client || c.redirect_uri !== body.redirect_uri || c.code_challenge !== await pkceChallenge(body.code_verifier))
    throw new HttpError(400, 'bad_code', 'That sign-in has expired. Try again.');
  const used = await db.prepare('DELETE FROM auth_codes WHERE code_hash = ?').bind(h).run();
  if (!used.meta.changes) throw new HttpError(400, 'bad_code', 'That sign-in has expired. Try again.');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(c.user_id).first();
  if (user.banned_at) throw banned(user);
  return json({ token: await newSession(db, user.id, 'game', c.client), user: publicUser(user), expiresAt: now() + SESSION_TTL });
}

function checkGame(req, game) {
  if (!GAMES[game]) throw new HttpError(404, 'unknown_game', 'No such game.');
  const origin = req.headers.get('origin');
  if (origin && !originAllowed(game, origin)) throw new HttpError(403, 'bad_origin', 'This page cannot save for that game.');
}
const progressBody = r => ({ data: r && r.data ? JSON.parse(r.data) : null, rev: r ? r.rev : 0, updatedAt: r ? r.updated_at : null });
async function getProgress(req, env, game) {
  checkGame(req, game);
  const { user } = await gameAuth(req, env);
  const r = await env.DB.prepare('SELECT data, rev, updated_at FROM progress WHERE user_id = ? AND game = ?').bind(user.id, game).first();
  return json(progressBody(r));
}
// A write names the rev it was built on. If someone else wrote since (another device, or an admin reset),
// nothing is written and the current copy comes back with 409, for the game to adopt.
async function putProgress(req, env, game) {
  checkGame(req, game);
  const { user } = await gameAuth(req, env);
  const body = await readJson(req, MAX_SAVE + 1024);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new HttpError(400, 'bad_data', 'Expected a save object.');
  const data = JSON.stringify(body.data), rev = Number.isInteger(body.rev) ? body.rev : 0, t = now(), db = env.DB;
  if (data.length > MAX_SAVE) throw new HttpError(413, 'too_large', 'That save is too big.');
  const res = rev === 0
    ? await db.prepare('INSERT INTO progress (user_id, game, data, rev, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT (user_id, game) DO NOTHING').bind(user.id, game, data, t, t).run()
    : await db.prepare('UPDATE progress SET data = ?, rev = rev + 1, updated_at = ? WHERE user_id = ? AND game = ? AND rev = ?').bind(data, t, user.id, game, rev).run();
  await db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(t, user.id).run();
  if (res.meta.changes) return json({ rev: rev + 1, updatedAt: t });
  const cur = await db.prepare('SELECT data, rev, updated_at FROM progress WHERE user_id = ? AND game = ?').bind(user.id, game).first();
  return json({ error: 'conflict', ...progressBody(cur) }, 409);
}

// ---------- admin ----------
async function admin(req, env, url) {
  const me = await webUser(req, env);
  if (!me) throw new HttpError(401, 'signed_out', 'Sign in first.');
  if (!isAdmin(env, me) || me.banned_at) throw new HttpError(403, 'not_admin', 'This account is not an admin.');
  const db = env.DB, p = url.pathname, m = req.method;
  const log = (action, userId, game, detail) => db.prepare('INSERT INTO admin_log (at, admin, action, user_id, game, detail) VALUES (?, ?, ?, ?, ?, ?)').bind(now(), me.email, action, userId, game || null, detail || null).run();
  if (p === '/api/admin/players' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase(), off = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    const where = q ? 'WHERE email LIKE ?' : '', args = q ? [`%${q.replace(/[%_]/g, '')}%`] : [];
    const users = (await db.prepare(`SELECT * FROM users ${where} ORDER BY COALESCE(last_seen_at, created_at) DESC LIMIT 51 OFFSET ?`).bind(...args, off).all()).results;
    const total = await db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).bind(...args).first('n');
    const more = users.length > 50; users.length = Math.min(users.length, 50);
    const prog = users.length ? (await db.prepare(`SELECT user_id, game, data, rev, updated_at FROM progress WHERE user_id IN (${users.map(() => '?').join(',')})`).bind(...users.map(u => u.id)).all()).results : [];
    return json({ total, more, players: users.map(u => ({ ...adminUser(u), games: prog.filter(r => r.user_id === u.id).map(gameRow) })) });
  }
  const pm = p.match(/^\/api\/admin\/players\/([0-9a-f-]{36})(?:\/(reset|ban|unban|signout))?$/);
  if (!pm) throw new HttpError(404, 'not_found', 'No such endpoint.');
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(pm[1]).first();
  if (!u) throw new HttpError(404, 'unknown_player', 'No such player.');
  const action = pm[2];
  if (!action && m === 'GET') {
    const prog = (await db.prepare('SELECT game, data, rev, updated_at FROM progress WHERE user_id = ? ORDER BY updated_at DESC').bind(u.id).all()).results;
    const sessions = await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?').bind(u.id, now()).first('n');
    const history = (await db.prepare('SELECT at, admin, action, game, detail FROM admin_log WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 30').bind(u.id).all()).results;
    return json({ player: { ...adminUser(u), sessions, games: prog.map(r => ({ ...gameRow(r), data: r.data ? JSON.parse(r.data) : null })), history } });
  }
  if (m !== 'POST') throw new HttpError(405, 'method', 'Use POST.');
  sameOrigin(req, url);
  const body = await readJson(req);
  if (action === 'reset') {
    if (!GAMES[body.game]) throw new HttpError(400, 'unknown_game', 'Pick a game to reset.');
    // the row stays with a higher rev, so the game's next save conflicts and adopts the fresh start
    await db.prepare('UPDATE progress SET data = NULL, rev = rev + 1, updated_at = ? WHERE user_id = ? AND game = ?').bind(now(), u.id, body.game).run();
    await log('reset', u.id, body.game);
  } else if (action === 'ban') {
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
    // sessions stay, so the player's game hears "banned" (403) rather than just "signed out"
    await db.prepare('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?').bind(now(), reason || null, u.id).run();
    await log('ban', u.id, null, reason);
  } else if (action === 'unban') {
    await db.prepare('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?').bind(u.id).run();
    await log('unban', u.id);
  } else if (action === 'signout') {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
    await log('signout', u.id);
  }
  return json({ ok: true });
}
const adminUser = u => ({ id: u.id, email: u.email, createdAt: u.created_at, lastSeenAt: u.last_seen_at, bannedAt: u.banned_at, banReason: u.ban_reason });

async function cleanup(db) {
  const t = now();
  await db.batch([
    db.prepare('DELETE FROM magic_links WHERE expires_at < ?').bind(t - DAY),
    db.prepare('DELETE FROM auth_codes WHERE expires_at < ?').bind(t),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
  ]);
}
