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
CREATE TABLE IF NOT EXISTS plans (
  user_id    text        PRIMARY KEY,
  plan       text        NOT NULL,
  source     text,
  ref        text,
  until      timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
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
    async getPlan(user) {
      const r = await pool.query('SELECT plan, source, ref, until, updated_at FROM plans WHERE user_id=$1', [user]);
      return r.rows[0] ? { plan: r.rows[0].plan, source: r.rows[0].source, ref: r.rows[0].ref, until: r.rows[0].until ? r.rows[0].until.toISOString() : null } : null;
    },
    async setPlan(user, { plan, source = null, ref = null, until = null }) {
      await pool.query(`INSERT INTO plans (user_id, plan, source, ref, until, updated_at) VALUES ($1,$2,$3,$4,$5,now())
                        ON CONFLICT (user_id) DO UPDATE SET plan=EXCLUDED.plan, source=EXCLUDED.source, ref=EXCLUDED.ref, until=EXCLUDED.until, updated_at=now()`, [user, plan, source, ref, until]);
    },
    async findPlanByRef(ref) {                   // Stripe subscription or customer id → user
      const r = await pool.query('SELECT user_id FROM plans WHERE ref=$1 LIMIT 1', [ref]);
      return r.rows[0] ? r.rows[0].user_id : null;
    },
    async migrateUser(from, to) {                // move one user's rows to another id, kind by kind, only the kinds the target lacks; returns the moved kinds
      if (!from || !to || from === to) return [];
      const r = await pool.query(
        `INSERT INTO state (user_id, kind, data, updated_at) SELECT $2, kind, data, updated_at FROM state WHERE user_id=$1
         ON CONFLICT (user_id, kind) DO NOTHING RETURNING kind`, [from, to]);
      const kinds = r.rows.map(x => x.kind);
      if (kinds.length) {
        await pool.query('DELETE FROM state WHERE user_id=$1 AND kind = ANY($2)', [from, kinds]);
        await pool.query('UPDATE history SET user_id=$2 WHERE user_id=$1 AND kind = ANY($3)', [from, to, kinds]);
      }
      return kinds;
    },
    async close() { await pool.end(); },
  };
}

function memoryDb() {
  const m = new Map(), plans = new Map();
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
    async getPlan(user) { return plans.get(user) || null; },
    async setPlan(user, { plan, source = null, ref = null, until = null }) { plans.set(user, { plan, source, ref, until }); },
    async findPlanByRef(ref) { for (const [u, p] of plans) if (p.ref === ref) return u; return null; },
    async migrateUser(from, to) {
      if (!from || !to || from === to) return [];
      const kinds = [];
      for (const k of [...m.keys()]) if (k.startsWith(from + ' ')) {
        const kind = k.slice(from.length + 1); if (m.has(key(to, kind))) continue;
        m.set(key(to, kind), m.get(k)); m.delete(k); kinds.push(kind);
      }
      return kinds;
    },
    async close() {},
  };
}
