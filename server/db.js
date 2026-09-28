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
CREATE TABLE IF NOT EXISTS stripe_events (
  id          text        PRIMARY KEY,
  type        text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS history (
  id         bigserial   PRIMARY KEY,
  user_id    text        NOT NULL,
  kind       text        NOT NULL,
  data       jsonb       NOT NULL,
  saved_at   timestamptz NOT NULL DEFAULT now()
);`;

export async function openDb(url, log = null) {
  if (!url) return memoryDb();
  // Railway's private network (*.railway.internal) is plain; the public proxy or sslmode=require gets TLS.
  // TLS verifies the server certificate: PG_CA_CERT supplies a CA when the server uses a private one,
  // and PG_INSECURE_TLS=1 is a local-only escape hatch that skips verification (never set it in production).
  const needSsl = /sslmode=require/.test(url) || (/rlwy\.net/.test(url) && !/railway\.internal/.test(url));
  let ssl, mode = 'no TLS (private network or local)';
  if (needSsl) {
    if (process.env.PG_INSECURE_TLS === '1') { ssl = { rejectUnauthorized: false }; mode = 'INSECURE TLS (certificate not checked; PG_INSECURE_TLS=1)'; }
    else if (process.env.PG_CA_CERT) { ssl = { ca: process.env.PG_CA_CERT, rejectUnauthorized: true }; mode = 'verified TLS (PG_CA_CERT)'; }
    else { ssl = { rejectUnauthorized: true }; mode = 'verified TLS (system CAs)'; }
  }
  (log?.info ?? console.log).call(log ?? console, `postgres: ${mode}`);
  const pool = new pg.Pool({ connectionString: url, ssl, max: 5 });
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
    async put(user, kind, data, base) {         // base (ISO string or undefined): compare-and-set; null result = conflict
      let r;                                    // updated_at is truncated to ms: node-postgres parses timestamps into JS Dates, and the client echoes that ms-precision value as base
      if (base !== undefined) {                 // atomic: the row only changes when it still is the version the client saw
        r = base === null
          ? await pool.query(`INSERT INTO state (user_id, kind, data, updated_at) VALUES ($1,$2,$3,date_trunc('milliseconds', now())) ON CONFLICT (user_id, kind) DO NOTHING RETURNING updated_at`, [user, kind, JSON.stringify(data)])
          : await pool.query(`UPDATE state SET data=$3, updated_at=date_trunc('milliseconds', now()) WHERE user_id=$1 AND kind=$2 AND updated_at=$4 RETURNING updated_at`, [user, kind, JSON.stringify(data), base]);
        if (!r.rows[0]) return null;
      } else {
        r = await pool.query(
          `INSERT INTO state (user_id, kind, data, updated_at) VALUES ($1,$2,$3,date_trunc('milliseconds', now()))
           ON CONFLICT (user_id, kind) DO UPDATE SET data=EXCLUDED.data, updated_at=date_trunc('milliseconds', now()) RETURNING updated_at`,
          [user, kind, JSON.stringify(data)]);
      }
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
    async seenEvent(id, type) {                  // idempotency: true when this Stripe event was already processed
      const r = await pool.query('INSERT INTO stripe_events (id, type) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING RETURNING id', [id, type]);
      return !r.rows[0];
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
  const m = new Map(), plans = new Map(), events = new Map();
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
    async put(user, kind, data, base) {
      const cur = m.get(key(user, kind));
      if (base !== undefined && (cur ? cur.updatedAt : null) !== base) return null;   // compare-and-set, like the Postgres store
      let t = Date.now();                                                             // monotonic: two writes in one ms must still differ, or a stale base would pass the check
      if (cur && Date.parse(cur.updatedAt) >= t) t = Date.parse(cur.updatedAt) + 1;
      const updatedAt = new Date(t).toISOString();
      m.set(key(user, kind), { data, updatedAt });
      return updatedAt;
    },
    async clear(user) { for (const k of [...m.keys()]) if (k.startsWith(user + ' ')) m.delete(k); },
    async getPlan(user) { return plans.get(user) || null; },
    async setPlan(user, { plan, source = null, ref = null, until = null }) { plans.set(user, { plan, source, ref, until }); },
    async findPlanByRef(ref) { for (const [u, p] of plans) if (p.ref === ref) return u; return null; },
    async seenEvent(id, type) { if (events.has(id)) return true; events.set(id, type); return false; },
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
