// ================= HELPERS =================
export const now = () => Date.now();
export const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
// tokens are only ever stored as their hash
export async function hash(token) {
  return [...await sha256(token)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// PKCE S256: the challenge is base64url(sha256(verifier))
export async function pkceChallenge(verifier) { return b64url(await sha256(verifier)); }

export function normalizeEmail(e) {
  if (typeof e !== 'string') return null;
  e = e.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export async function readJson(req, max = 128 * 1024) {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'too_large', 'That is too much data.');
  try { const d = JSON.parse(text || '{}'); if (d && typeof d === 'object') return d; } catch (e) {}
  throw new HttpError(400, 'bad_json', 'Expected a JSON body.');
}

export function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  for (const part of c.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return null;
}
export const cookie = (name, value, maxAgeSec) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
