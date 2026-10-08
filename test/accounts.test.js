import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { redirectAllowed } from '../src/clients.js';
import { pkceChallenge } from '../src/util.js';
import { makeD1 } from './d1.js';

const APP = 'https://accounts.atlesque.dev', GAME = 'https://mbp-scrum-city.atlesque.dev', BACK = `${GAME}/`;
let env, mails;
beforeEach(() => {
  mails = [];
  env = { DB: makeD1(), ADMIN_EMAILS: 'boss@example.com', MAIL_FROM: 'noreply@atlesque.dev', EMAIL: { send: async m => { mails.push(m); return { messageId: 'x' }; } } };
});

function call(path, { method = 'GET', body, origin, cookie, token, form } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  let data;
  if (form) { data = new URLSearchParams(form); headers['content-type'] = 'application/x-www-form-urlencoded'; } else if (body !== undefined) { data = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  return worker.fetch(new Request(APP + path, { method, headers, body: data }), env, {});
}
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];

// the whole trip: the game sends the player to /signin, they get an email, open the link, the waiting tab carries on
async function signIn(email = 'player@example.com') {
  const verifier = 'v'.repeat(50), challenge = await pkceChallenge(verifier);
  const target = { client: 'scrum-city', redirect_uri: BACK, state: 's1', code_challenge: challenge };
  const start = await call('/api/signin/start', { method: 'POST', origin: APP, body: { email, ...target } });
  expect(start.status).toBe(200);
  const { request, poll } = await start.json();
  expect((await (await call('/api/signin/poll', { method: 'POST', origin: APP, body: { request, poll } })).json()).status).toBe('pending');
  const link = mails.at(-1).text.match(/https:\/\/\S+/)[0];
  const t = new URL(link).searchParams.get('t');
  const page = await call(`/auth/link?t=${t}`);
  expect(await page.text()).toContain('<form method="post"');
  const confirmed = await call('/auth/link', { method: 'POST', origin: APP, form: { t } });
  expect(confirmed.status).toBe(200);
  const done = await call('/api/signin/poll', { method: 'POST', origin: APP, body: { request, poll } });
  const d = await done.json();
  expect(d.status).toBe('done');
  const back = new URL(d.redirect);
  expect(back.origin + back.pathname).toBe(BACK);
  expect(back.searchParams.get('mbpg_state')).toBe('s1');
  const tok = await call('/api/token', { method: 'POST', origin: GAME, body: { code: back.searchParams.get('mbpg_code'), code_verifier: verifier, client: 'scrum-city', redirect_uri: BACK } });
  expect(tok.status).toBe(200);
  return { ...(await tok.json()), cookie: cookieOf(done), code: back.searchParams.get('mbpg_code'), verifier, request, poll };
}

describe('MBP Games sign-in', () => {
  it('signs a new player in by email link and hands the game a token', async () => {
    const s = await signIn();
    expect(s.user.email).toBe('player@example.com');
    expect(mails[0].to).toBe('player@example.com');
    expect(mails[0].subject).toBe('Sign in to MBP - Scrum City');
    const me = await call('/api/me', { token: s.token, origin: GAME });
    expect((await me.json()).user.email).toBe('player@example.com');
    expect(me.headers.get('access-control-allow-origin')).toBe(GAME);
  });
  it('uses a link, a poll and a code only once', async () => {
    const s = await signIn();
    expect((await (await call('/api/signin/poll', { method: 'POST', origin: APP, body: { request: s.request, poll: s.poll } })).json()).status).toBe('used');
    const again = await call('/api/token', { method: 'POST', origin: GAME, body: { code: s.code, code_verifier: s.verifier, client: 'scrum-city', redirect_uri: BACK } });
    expect(again.status).toBe(400);
  });
  it('needs the PKCE verifier to swap a code', async () => {
    const verifier = 'w'.repeat(50);
    await call('/api/signin/start', { method: 'POST', origin: APP, body: { email: 'a@b.co', client: 'scrum-city', redirect_uri: BACK, code_challenge: await pkceChallenge(verifier) } });
    const t = new URL(mails[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('t');
    const conf = await call('/auth/link', { method: 'POST', origin: APP, form: { t } });
    // already signed in on the accounts site: one click back to the game
    const cont = await call('/api/signin/continue', { method: 'POST', origin: APP, cookie: cookieOf(conf), body: { client: 'scrum-city', redirect_uri: BACK, code_challenge: await pkceChallenge(verifier) } });
    const code = new URL((await cont.json()).redirect).searchParams.get('mbpg_code');
    const bad = await call('/api/token', { method: 'POST', origin: GAME, body: { code, code_verifier: 'x'.repeat(50), client: 'scrum-city', redirect_uri: BACK } });
    expect(bad.status).toBe(400);
  });
  it('only sends players back to the game\'s own pages', async () => {
    expect(redirectAllowed('scrum-city', 'https://mbp-scrum-city.atlesque.dev/?x=1')).toBe(true);
    expect(redirectAllowed('scrum-city', 'https://abc123.mbp-scrum-city.pages.dev/')).toBe(true);
    expect(redirectAllowed('scrum-city', 'https://evil.example/')).toBe(false);
    expect(redirectAllowed('scrum-city', 'https://mbp-scrum-city.atlesque.dev.evil.example/')).toBe(false);
    const res = await call('/api/signin/start', { method: 'POST', origin: APP, body: { email: 'a@b.co', client: 'scrum-city', redirect_uri: 'https://evil.example/', code_challenge: 'c'.repeat(43) } });
    expect(res.status).toBe(400);
    expect(mails).toHaveLength(0);
  });
  it('refuses sign-in requests from other sites and answers CORS only for games', async () => {
    const res = await call('/api/signin/start', { method: 'POST', origin: 'https://evil.example', body: { email: 'a@b.co' } });
    expect(res.status).toBe(403);
    expect((await call('/api/me', { method: 'OPTIONS', origin: GAME })).status).toBe(204);
    expect((await call('/api/me', { method: 'OPTIONS', origin: 'https://evil.example' })).status).toBe(403);
  });
  it('limits how many emails one address can ask for', async () => {
    for (let i = 0; i < 5; i++) expect((await call('/api/signin/start', { method: 'POST', origin: APP, body: { email: 'spam@b.co' } })).status).toBe(200);
    expect((await call('/api/signin/start', { method: 'POST', origin: APP, body: { email: 'spam@b.co' } })).status).toBe(429);
  });
});

describe('progress sync', () => {
  const save = money => ({ v: 2, money, weapons: { owned: { pistol: true, smg: true }, lvl: {}, ammo: {}, found: {} }, stats: { kills: 3 } });
  it('starts empty, saves, and refuses a write built on an old copy', async () => {
    const { token } = await signIn();
    const p = '/api/games/scrum-city/progress';
    expect(await (await call(p, { token, origin: GAME })).json()).toMatchObject({ data: null, rev: 0 });
    expect(await (await call(p, { method: 'PUT', token, origin: GAME, body: { data: save(900), rev: 0 } })).json()).toMatchObject({ rev: 1 });
    const stale = await call(p, { method: 'PUT', token, origin: GAME, body: { data: save(1), rev: 0 } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ rev: 1, data: { money: 900 } });
    expect(await (await call(p, { method: 'PUT', token, origin: GAME, body: { data: save(1200), rev: 1 } })).json()).toMatchObject({ rev: 2 });
    expect(await (await call(p, { token, origin: GAME })).json()).toMatchObject({ rev: 2, data: { money: 1200 } });
  });
  it('needs a token and a game page', async () => {
    const { token } = await signIn();
    expect((await call('/api/games/scrum-city/progress', { origin: GAME })).status).toBe(401);
    expect((await call('/api/games/scrum-city/progress', { token, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('/api/games/nope/progress', { token, origin: GAME })).status).toBe(404);
  });
});

describe('admin', () => {
  it('lists players, resets a game, and bans', async () => {
    const player = await signIn('player@example.com');
    await call('/api/games/scrum-city/progress', { method: 'PUT', token: player.token, origin: GAME, body: { data: { v: 2, money: 4200, weapons: { owned: { fist: true, pistol: true, minigun: true } }, stats: { kills: 9 } }, rev: 0 } });
    const boss = await signIn('boss@example.com');
    // a player is not an admin
    expect((await call('/api/admin/players', { cookie: player.cookie })).status).toBe(403);
    const list = await (await call('/api/admin/players', { cookie: boss.cookie })).json();
    const row = list.players.find(p => p.email === 'player@example.com');
    expect(row.games[0].summary).toEqual({ money: 4200, weapons: ['pistol', 'minigun'], kills: 9 });
    // writes need our own page as the origin
    expect((await call(`/api/admin/players/${row.id}/reset`, { method: 'POST', cookie: boss.cookie, origin: 'https://evil.example', body: { game: 'scrum-city' } })).status).toBe(403);
    expect((await call(`/api/admin/players/${row.id}/reset`, { method: 'POST', cookie: boss.cookie, origin: APP, body: { game: 'scrum-city' } })).status).toBe(200);
    // the game's next save conflicts and gets the fresh start
    const after = await call('/api/games/scrum-city/progress', { method: 'PUT', token: player.token, origin: GAME, body: { data: { v: 2, money: 5000 }, rev: 1 } });
    expect(after.status).toBe(409);
    expect(await after.json()).toMatchObject({ data: null, rev: 2 });
    await call(`/api/admin/players/${row.id}/ban`, { method: 'POST', cookie: boss.cookie, origin: APP, body: { reason: 'cheating' } });
    const me = await call('/api/me', { token: player.token, origin: GAME });
    expect(me.status).toBe(403);
    expect(await me.json()).toMatchObject({ error: 'banned', message: 'This account is banned: cheating' });
    expect((await call('/api/signin/start', { method: 'POST', origin: APP, body: { email: 'player@example.com' } })).status).toBe(403);
    const detail = await (await call(`/api/admin/players/${row.id}`, { cookie: boss.cookie })).json();
    expect(detail.player.history.map(h => h.action)).toEqual(['ban', 'reset']);
    await call(`/api/admin/players/${row.id}/unban`, { method: 'POST', cookie: boss.cookie, origin: APP, body: {} });
    expect((await call('/api/me', { token: player.token, origin: GAME })).status).toBe(200);
  });
});
