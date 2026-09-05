// Storage for synced state. Postgres when DATABASE_URL is set, an in-memory map otherwise (local dev, tests).
import pg from 'pg';

const DDL = `
CREATE TABLE IF NOT EXISTS state (
  user_id    text        NOT NULL,
  kind       text        NOT NULL,
  data       jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
CREATE TABLE IF NOT EXISTS history (
  id         bigserial   PRIMARY KEY,
  user_id    text        NOT NULL,
  kind       text        NOT NULL,
  data       jsonb       NOT NULL,
  saved_at   timestamptz NOT NULL DEFAULT now()
);`;

export async function openDb(url) {
  if (!url) return memoryDb();
  // TLS only for the public proxy host or when asked for; Railway's private network (*.railway.internal) is plain
  const needSsl = /sslmode=require/.test(url) || (/rlwy\.net/.test(url) && !/railway\.internal/.test(url));
  const pool = new pg.Pool({ connectionString: url, ssl: needSsl ? { rejectUnauthorized: false } : undefined, max: 5 });
  await pool.query(DDL);
  return {
    kind: 'postgres',
    async ping() { await pool.query('SELECT 1'); return true; },
    async get(user, kind) {
      const r = await pool.query('SELECT data, updated_at FROM state WHERE user_id=$1 AND kind=$2', [user, kind]);
      return r.rows[0] ? { data: r.rows[0].data, updatedAt: r.rows[0].updated_at.toISOString() } : null;
    },
    async all(user) {
      const r = await pool.query('SELECT kind, data, updated_at FROM state WHERE user_id=$1', [user]);
      const out = {};
      for (const row of r.rows) out[row.kind] = { data: row.data, updatedAt: row.updated_at.toISOString() };
      return out;
    },
    async put(user, kind, data) {
      const r = await pool.query(
        `INSERT INTO state (user_id, kind, data, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (user_id, kind) DO UPDATE SET data=EXCLUDED.data, updated_at=now() RETURNING updated_at`,
        [user, kind, JSON.stringify(data)]);
      // bounded history of snapshots, for a later "how did my team score over time" view
      await pool.query('INSERT INTO history (user_id, kind, data) VALUES ($1,$2,$3)', [user, kind, JSON.stringify(data)]);
      await pool.query(
        `DELETE FROM history WHERE user_id=$1 AND kind=$2
           AND id NOT IN (SELECT id FROM history WHERE user_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 200)`, [user, kind]);
      return r.rows[0].updated_at.toISOString();
    },
    async clear(user) { await pool.query('DELETE FROM state WHERE user_id=$1', [user]); await pool.query('DELETE FROM history WHERE user_id=$1', [user]); },
    async close() { await pool.end(); },
  };
}

function memoryDb() {
  const m = new Map();
  const key = (u, k) => u + ' ' + k;
  return {
    kind: 'memory',
    async ping() { return true; },
    async get(user, kind) { return m.get(key(user, kind)) || null; },
    async all(user) {
      const out = {};
      for (const [k, v] of m) if (k.startsWith(user + ' ')) out[k.split(' ')[1]] = v;
      return out;
    },
    async put(user, kind, data) { const updatedAt = new Date().toISOString(); m.set(key(user, kind), { data, updatedAt }); return updatedAt; },
    async clear(user) { for (const k of [...m.keys()]) if (k.startsWith(user + ' ')) m.delete(k); },
    async close() {},
  };
}
