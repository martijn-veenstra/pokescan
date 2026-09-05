// PokeScan server: serves the static app and a small passcode-protected sync API backed by Postgres.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';
import { openDb } from './db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const PASSCODE = process.env.PASSCODE || '';
const KINDS = new Set(['scans', 'roster', 'appr']);
const USER = 'default';                       // one passcode = one user, for now
const MAX_BYTES = 8 * 1024 * 1024;

export async function buildServer({ dbUrl = process.env.DATABASE_URL, passcode = PASSCODE, logger = true } = {}) {
  const app = Fastify({ logger, bodyLimit: MAX_BYTES });
  // accept an empty JSON body (POST /api/auth sends none)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body)); } catch (e) { e.statusCode = 400; done(e); }
  });
  const db = await openDb(dbUrl);
  app.decorate('db', db);

  const hash = s => createHash('sha256').update(String(s)).digest();
  const okCode = given => !!passcode && !!given && timingSafeEqual(hash(given), hash(passcode));
  const auth = async (req, reply) => {
    if (!passcode) return reply.code(503).send({ error: 'sync_not_configured', message: 'Set the PASSCODE variable on the server to enable sync.' });
    const h = req.headers.authorization || '';
    if (!okCode(h.startsWith('Bearer ') ? h.slice(7) : '')) return reply.code(401).send({ error: 'bad_passcode' });
  };

  app.get('/api/health', async () => {
    let dbOk = false;
    try { dbOk = await db.ping(); } catch { dbOk = false; }
    return { ok: true, db: dbOk, storage: db.kind, sync: !!passcode, version: process.env.npm_package_version || 'dev' };
  });
  app.post('/api/auth', { preHandler: auth }, async () => ({ ok: true }));
  app.get('/api/state', { preHandler: auth }, async () => ({ user: USER, state: await db.all(USER) }));
  app.get('/api/state/:kind', { preHandler: auth }, async (req, reply) => {
    if (!KINDS.has(req.params.kind)) return reply.code(404).send({ error: 'unknown_kind' });
    return (await db.get(USER, req.params.kind)) || { data: null, updatedAt: null };
  });
  app.put('/api/state/:kind', { preHandler: auth }, async (req, reply) => {
    const { kind } = req.params;
    if (!KINDS.has(kind)) return reply.code(404).send({ error: 'unknown_kind' });
    const body = req.body || {};
    if (!('data' in body)) return reply.code(400).send({ error: 'missing_data' });
    // optimistic concurrency: a client that last saw an older version gets the current one back instead of overwriting it
    const cur = await db.get(USER, kind);
    if (body.baseUpdatedAt !== undefined && cur && body.baseUpdatedAt !== cur.updatedAt) {
      return reply.code(409).send({ error: 'conflict', current: cur });
    }
    const updatedAt = await db.put(USER, kind, body.data);
    return { ok: true, updatedAt };
  });

  // Static app. API routes above win; unknown paths fall back to index.html so the PWA start_url always resolves.
  await app.register(fastifyStatic, {
    root: ROOT, prefix: '/', index: ['index.html'], cacheControl: true, maxAge: 0,
    setHeaders(res, filePath) {
      if (/[\\/]vendor[\\/]/.test(filePath) || /\.(png|woff2?)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
    return reply.sendFile('index.html');
  });
  app.addHook('onClose', async () => db.close());
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const app = await buildServer();
  app.listen({ port: PORT, host: '0.0.0.0' })
    .then(() => app.log.info(`PokeScan on :${PORT} (storage ${app.db.kind}, sync ${PASSCODE ? 'on' : 'OFF: set PASSCODE'})`))
    .catch(e => { console.error(e); process.exit(1); });
}
