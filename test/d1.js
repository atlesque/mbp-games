// A stand-in for Cloudflare D1 on Node's built-in SQLite, so the Worker can be tested end to end.
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const plain = r => r ? { ...r } : null;
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first(col) { const r = plain(db.prepare(sql).get(...args)); return r && col ? r[col] : r; },
    async all() { return { results: db.prepare(sql).all(...args).map(plain) }; },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    runSync() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
  });
  return {
    prepare: sql => stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try { const out = list.map(s => s.runSync()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    raw: db,
  };
}
