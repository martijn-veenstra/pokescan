// PokeScan server: serves the static app and a small passcode-protected sync API backed by Postgres.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { verifyToken as clerkVerifyToken } from '@clerk/backend';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { timingSafeEqual, createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDb } from './db.js';
import { makeCoach } from './coach.js';
import { makeVision } from './vision.js';
import { makeSources } from './sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const PASSCODE = process.env.PASSCODE || '';
const KINDS = new Set(['scans', 'roster', 'appr', 'battles']);
const COACH_PER_USER_HOUR = Number(process.env.COACH_PER_USER_HOUR) || 10;
const COACH_BATTLE_PER_HOUR = Number(process.env.COACH_BATTLE_PER_HOUR) || 5;   // battle reviews are one per match, so they get a smaller cap inside the per-account budget
const VISION_PER_HOUR = Number(process.env.VISION_PER_HOUR) || 100, VISION_PER_USER_HOUR = Number(process.env.VISION_PER_USER_HOUR) || 20;
const MAX_BYTES = 8 * 1024 * 1024;
const COACH_PER_HOUR = Number(process.env.COACH_PER_HOUR) || 30;
const VERSION = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return 'dev'; } })();

/* Accounts: with CLERK_SECRET_KEY set, every /api call carries a Clerk session token and the user id is its subject; each user
   has their own state and coach budget. Without it the old single-user PASSCODE mode stays (local dev, tests). */
export async function buildServer({ dbUrl = process.env.DATABASE_URL, passcode = PASSCODE, logger = true, coach = makeCoach(process.env.ANTHROPIC_API_KEY), vision = makeVision(process.env.ANTHROPIC_API_KEY), sourcesFetch = fetch,
                                    clerkSecretKey = process.env.CLERK_SECRET_KEY || '', clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || '', appOrigin = process.env.APP_ORIGIN || '',
                                    verifyToken = null, ownerMigrateFrom = process.env.OWNER_USER_ID || '',
                                    proUserIds = (process.env.PRO_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
                                    proCheckoutUrl = process.env.PRO_CHECKOUT_URL || '', proPrice = process.env.PRO_PRICE || '€4.99 / month', proManageUrl = process.env.PRO_MANAGE_URL || '',
                                    stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '', now = () => Date.now() } = {}) {
  if (clerkSecretKey && process.env.NODE_ENV === 'production' && !appOrigin)
    throw new Error('APP_ORIGIN must be set when CLERK_SECRET_KEY is set (Clerk authorizedParties check)');
  const app = Fastify({ logger, bodyLimit: MAX_BYTES });
  // accept an empty JSON body (POST /api/auth sends none)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;                              // the payment webhook is signed over the raw bytes
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body)); } catch (e) { e.statusCode = 400; done(e); }
  });
  const db = await openDb(dbUrl, app.log);
  app.decorate('db', db);
  const sources = makeSources({ fetchImpl: sourcesFetch, db, log: app.log });
  app.decorate('sources', sources);

  const verify = verifyToken || (clerkSecretKey ? async tok => clerkVerifyToken(tok, { secretKey: clerkSecretKey, authorizedParties: appOrigin ? [appOrigin] : undefined }) : null);
  const authMode = verify ? 'clerk' : passcode ? 'passcode' : 'none';
  if (ownerMigrateFrom && db.migrateUser) {         // one-off: hand the passcode era's rows to the owner's Clerk account
    const moved = await db.migrateUser('default', ownerMigrateFrom);
    app.log.info(`migrated ${moved.length ? moved.join(', ') : 'nothing'} from 'default' to ${ownerMigrateFrom}`);
  }
  const hash = s => createHash('sha256').update(String(s)).digest();
  const okCode = given => !!passcode && !!given && timingSafeEqual(hash(given), hash(passcode));
  const auth = async (req, reply) => {
    if (authMode === 'none') return reply.code(503).send({ error: 'sync_not_configured', message: 'Set CLERK_SECRET_KEY (accounts) or PASSCODE (single user) on the server to enable sync.' });
    const h = req.headers.authorization || '', tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (authMode === 'clerk') {
      try { const payload = await verify(tok); if (!payload || !payload.sub) throw new Error('no subject'); req.userId = payload.sub; }
      catch { return reply.code(401).send({ error: 'bad_token' }); }
      return;
    }
    if (!okCode(tok)) return reply.code(401).send({ error: 'bad_passcode' });
    req.userId = 'default';
  };
  /* Plans. 'pro' unlocks every AI feature. Sources, in order: the single-user passcode mode (the owner), PRO_USER_IDS
     (comped accounts), a plan row in the database (written by whatever sells the upgrade). Everything else is 'free'. */
  const planOf = async userId => {
    if (authMode === 'passcode' || proUserIds.includes(userId)) return { plan: 'pro', source: authMode === 'passcode' ? 'owner' : 'comped' };
    const p = db.getPlan ? await db.getPlan(userId) : null;
    if (p && p.plan === 'pro' && (!p.until || new Date(p.until).getTime() > now())) return { plan: 'pro', source: p.source || 'paid' };
    return { plan: 'free', source: null };
  };
  const features = async userId => { const { plan } = await planOf(userId); return ['sync'].concat(plan === 'pro' ? ['pro'] : []).concat(plan === 'pro' && coach ? ['coach'] : []); };
  const requirePro = async (req, reply) => {
    const { plan } = await planOf(req.userId);
    if (plan !== 'pro') return reply.code(403).send({ error: 'upgrade_required', message: 'This is a PokeScan Pro feature.' });
  };

  app.get('/api/health', async (req, reply) => {
    let dbOk = false;
    try { dbOk = await db.ping(); } catch { dbOk = false; }
    const body = { ok: dbOk, db: dbOk, storage: db.kind, sync: authMode !== 'none', auth: authMode, ...(authMode === 'clerk' && clerkPublishableKey ? { clerkPublishableKey } : {}),
                   ...(authMode === 'clerk' && passcode ? { passcodeData: true } : {}), coach: !!coach, vision: !!vision, sources: true, version: VERSION };
    if (!dbOk) { req.log.error({ evt: 'health', db: false }, 'health: database ping failed'); return reply.code(503).send(body); }   // 503: the uptime monitor and Railway's healthcheck both notice
    return body;
  });
  // One-time import of the passcode era's rows into a signed-in account: the passcode proves ownership of that data.
  // Only kinds the account does not have yet move over, so it never overwrites what the account already synced.
  const migrateTries = new Map();
  app.post('/api/migrate', { preHandler: auth }, async (req, reply) => {
    if (authMode !== 'clerk') return reply.code(404).send({ error: 'not_in_accounts_mode' });
    if (!passcode) return reply.code(409).send({ error: 'no_passcode_data', message: 'PASSCODE is not set on the server, so there is no passcode-era data to import.' });
    const now = Date.now(), tries = (migrateTries.get(req.userId) || []).filter(t => t >= now - 3600e3);
    if (tries.length >= 5) return reply.code(429).send({ error: 'rate_limited', message: 'too many attempts; try again in an hour' });
    tries.push(now); migrateTries.set(req.userId, tries);
    if (!okCode((req.body || {}).passcode)) return reply.code(403).send({ error: 'bad_passcode', message: 'that is not the server passcode' });
    const moved = await db.migrateUser('default', req.userId);
    req.log.info(`imported ${moved.length ? moved.join(', ') : 'nothing'} from 'default' to ${req.userId}`);
    return { moved };
  });
  // Public schedule (Leek Duck via ScrapedDuck, event pages enriched server-side). No passcode: nothing personal in it.
  app.get('/api/sources', async (req, reply) => {
    try { const data = await sources.current(); reply.header('cache-control', 'public, max-age=600'); return data; }
    catch (e) { req.log.error({ evt: 'sources', errClass: e.constructor.name, err: e.message }, 'sources refresh failed'); return reply.code(502).send({ error: 'sources_unavailable', message: e.message }); }
  });
  // AI coach: the browser sends a compact roster/meta summary, the server asks Claude. Passcode-protected and rate-limited,
  // because every call costs money on the server owner's API key.
  const asks = [], asksBy = new Map(), battleAsksBy = new Map(), jobs = new Map();
  app.post('/api/coach', { preHandler: [auth, requirePro] }, async (req, reply) => {
    if (!coach) return reply.code(503).send({ error: 'coach_not_configured', message: 'Set ANTHROPIC_API_KEY on the server to enable the coach.' });
    const now = Date.now();
    while (asks.length && asks[0] < now - 3600e3) asks.shift();
    if (asks.length >= COACH_PER_HOUR) return reply.code(429).send({ error: 'rate_limited', message: `at most ${COACH_PER_HOUR} reviews per hour` });
    const mine = (asksBy.get(req.userId) || []).filter(t => t >= now - 3600e3);
    if (authMode === 'clerk' && mine.length >= COACH_PER_USER_HOUR) return reply.code(429).send({ error: 'rate_limited', message: `at most ${COACH_PER_USER_HOUR} reviews per hour per account` });
    mine.push(now); asksBy.set(req.userId, mine);
    const body = req.body || {};
    if (!body.context || typeof body.context !== 'object') return reply.code(400).send({ error: 'missing_context' });
    const context = JSON.stringify(body.context);
    if (context.length > 60000) return reply.code(413).send({ error: 'context_too_large' });
    const mode = body.mode || 'review';
    if (mode !== 'review' && mode !== 'battle') return reply.code(400).send({ error: 'unknown_mode', message: 'the coach writes team reviews and battle reviews' });
    if (mode === 'battle') {                       // a set is five matches: cap them inside the per-account budget
      const bmine = (battleAsksBy.get(req.userId) || []).filter(t => t >= now - 3600e3);
      if (bmine.length >= COACH_BATTLE_PER_HOUR) return reply.code(429).send({ error: 'rate_limited', message: `at most ${COACH_BATTLE_PER_HOUR} battle reviews per hour` });
      bmine.push(now); battleAsksBy.set(req.userId, bmine);
    }
    asks.push(now);
    // The model can take a minute or more; phones drop a fetch after ~60 s. So: answer with a job id at once, let the app poll.
    for (const [id, j] of jobs) if (now - j.t > 3600e3) jobs.delete(id);
    const id = randomUUID(), job = { status: 'running', t: now, userId: req.userId };
    jobs.set(id, job);
    coach({ context, mode }).then(out => {
      if (out.refused) Object.assign(job, { status: 'error', error: 'the model declined to answer' });
      else Object.assign(job, { status: 'done', text: out.text, model: out.model, usage: out.usage });
    }, e => { req.log.error({ evt: 'ai_job', action: mode === 'battle' ? 'coach_battle' : 'coach_review', userId: req.userId, errClass: e.constructor.name, err: e.message }, 'coach job failed'); Object.assign(job, { status: 'error', error: e.message || 'the coach did not answer' }); });
    return reply.code(202).send({ jobId: id, status: 'running' });
  });
  // Share anything: a screenshot the on-device reader could not place goes to the model, which says what it is and what it shows.
  // Pro only; its own hourly budget, separate from reviews. Same job pattern, polled through /api/jobs/:id.
  const looks = [], looksBy = new Map();
  app.post('/api/vision', { preHandler: [auth, requirePro] }, async (req, reply) => {
    if (!vision) return reply.code(503).send({ error: 'vision_not_configured', message: 'Set ANTHROPIC_API_KEY on the server to read screenshots.' });
    const now = Date.now();
    while (looks.length && looks[0] < now - 3600e3) looks.shift();
    if (looks.length >= VISION_PER_HOUR) return reply.code(429).send({ error: 'rate_limited', message: `at most ${VISION_PER_HOUR} screenshots per hour` });
    const mine = (looksBy.get(req.userId) || []).filter(t => t >= now - 3600e3);
    if (authMode === 'clerk' && mine.length >= VISION_PER_USER_HOUR) return reply.code(429).send({ error: 'rate_limited', message: `at most ${VISION_PER_USER_HOUR} screenshots per hour per account` });
    const body = req.body || {}, okType = t => ['image/jpeg', 'image/png', 'image/webp'].includes(t) ? t : 'image/jpeg';
    // one screenshot, or up to 16 frames sampled from a recording (each small: the client downsizes to 768 px)
    let images = null;
    if (Array.isArray(body.images)) {
      images = body.images.filter(f => f && typeof f.image === 'string' && f.image.length >= 100).slice(0, 16).map(f => ({ image: f.image, mediaType: okType(f.mediaType), t: Number.isFinite(f.t) ? f.t : null }));
      if (images.length < 2) return reply.code(400).send({ error: 'missing_image' });
      if (images.reduce((a, f) => a + f.image.length, 0) > 7 * 1024 * 1024) return reply.code(413).send({ error: 'image_too_large', message: 'send fewer or smaller frames' });
    } else {
      if (typeof body.image !== 'string' || body.image.length < 100) return reply.code(400).send({ error: 'missing_image' });
      if (body.image.length > 6 * 1024 * 1024) return reply.code(413).send({ error: 'image_too_large', message: 'send the screenshot downscaled to at most 1568 px' });
    }
    const mediaType = okType(body.mediaType);
    mine.push(now); looksBy.set(req.userId, mine); looks.push(now);
    for (const [id, j] of jobs) if (now - j.t > 3600e3) jobs.delete(id);
    const id = randomUUID(), job = { status: 'running', t: now, userId: req.userId };
    jobs.set(id, job);
    vision({ image: body.image, mediaType, images, hint: typeof body.hint === 'string' ? body.hint : '' }).then(out => {
      if (out.refused) Object.assign(job, { status: 'error', error: 'the model declined to read this screenshot' });
      else Object.assign(job, { status: 'done', data: out.data, model: out.model, usage: out.usage });
    }, e => { req.log.error({ evt: 'ai_job', action: 'vision', userId: req.userId, frames: images ? images.length : 1, errClass: e.constructor.name, err: e.message }, 'vision job failed'); Object.assign(job, { status: 'error', error: e.message || 'the screenshot could not be read' }); });
    return reply.code(202).send({ jobId: id, status: 'running' });
  });
  app.get('/api/jobs/:id', { preHandler: auth }, async (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job || job.userId !== req.userId) return reply.code(404).send({ error: 'unknown_job' });
    return { status: job.status, text: job.text, data: job.data, model: job.model, usage: job.usage, error: job.error };
  });
  app.get('/api/coach/:id', { preHandler: auth }, async (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job || job.userId !== req.userId) return reply.code(404).send({ error: 'unknown_job' });
    return { status: job.status, text: job.text, model: job.model, usage: job.usage, error: job.error };
  });
  app.post('/api/auth', { preHandler: auth }, async () => ({ ok: true }));
  app.get('/api/me', { preHandler: auth }, async req => {
    const { plan, source } = await planOf(req.userId);
    // the checkout page gets the user id as a reference so the payment can be tied back to the account
    const checkoutUrl = proCheckoutUrl && authMode === 'clerk' ? `${proCheckoutUrl}${proCheckoutUrl.includes('?') ? '&' : '?'}client_reference_id=${encodeURIComponent(req.userId)}` : null;
    return { userId: req.userId, auth: authMode, plan, planSource: source, features: await features(req.userId), pro: { price: proPrice, checkoutUrl, manageUrl: proManageUrl || null, coach: !!coach } };
  });
  /* Stripe webhook. The Payment Link carries client_reference_id = the account's user id; a completed checkout writes the plan row,
     a cancelled or lapsed subscription clears it. Signature per Stripe's scheme: header "t=…,v1=…", HMAC-SHA256 over "t.rawBody";
     during a secret rotation the header carries several v1 values and any match accepts. */
  const stripeSignatureOk = (raw, header) => {
    if (!stripeWebhookSecret || !header) return false;
    let t = null; const v1s = [];
    for (const kv of String(header).split(',')) {
      const i = kv.indexOf('='); if (i < 0) continue;
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (k === 't') t = v; else if (k === 'v1') v1s.push(v);
    }
    if (!t || !v1s.length || Math.abs(now() / 1000 - Number(t)) > 300) return false;
    const expect = Buffer.from(createHmac('sha256', stripeWebhookSecret).update(`${t}.${raw}`).digest('hex'));
    return v1s.some(v => { const given = Buffer.from(v); return expect.length === given.length && timingSafeEqual(expect, given); });
  };
  const GRACE = 3 * 86400e3;                     // paid-through date plus 3 days, so a slow renewal invoice does not lock anyone out
  const periodEnd = o => {                       // current_period_end (subscription events) or the invoice line's period end, in ms
    if (o.current_period_end) return o.current_period_end * 1000;
    const line = o.lines && o.lines.data && o.lines.data[0];
    if (line && line.period && line.period.end) return line.period.end * 1000;
    if (o.period_end) return o.period_end * 1000;
    return null;
  };
  const refUser = async o => {                   // an event's subscription, customer or own id → the account it belongs to
    for (const ref of [o.subscription, o.customer, o.id]) if (ref) { const u = await db.findPlanByRef(ref); if (u) return u; }
    return null;
  };
  app.post('/api/stripe/webhook', async (req, reply) => {
    if (!stripeSignatureOk(req.rawBody || '', req.headers['stripe-signature'])) {
      req.log.warn({ evt: 'webhook', src: 'stripe', err: 'bad_signature', hasHeader: !!req.headers['stripe-signature'] }, 'stripe webhook refused');
      return reply.code(400).send({ error: 'bad_signature' });
    }
    const ev = req.body || {}, o = (ev.data && ev.data.object) || {};
    if (ev.id && db.seenEvent && await db.seenEvent(ev.id, ev.type)) { req.log.info(`stripe: duplicate ${ev.id} (${ev.type}) skipped`); return { received: true }; }
    if (ev.type === 'checkout.session.completed' && o.client_reference_id && (o.payment_status === 'paid' || o.status === 'complete')) {
      // paid: Pro until the period end when the session carries it, otherwise a 35-day bound that invoice.paid keeps extending — never for ever
      const until = new Date((periodEnd(o) || now() + 35 * 86400e3) + GRACE).toISOString();
      await db.setPlan(o.client_reference_id, { plan: 'pro', source: 'stripe', ref: o.subscription || o.customer || o.id, until });
      req.log.info(`pro: ${o.client_reference_id} paid via ${o.subscription || o.customer || o.id}, until ${until}`);
    } else if (ev.type === 'invoice.paid') {     // a renewal: extend to the new period end
      const user = await refUser(o), end = periodEnd(o);
      if (user && end) {
        await db.setPlan(user, { plan: 'pro', source: 'stripe', ref: o.subscription || o.customer, until: new Date(end + GRACE).toISOString() });
        req.log.info(`pro: ${user} renewed until ${new Date(end + GRACE).toISOString()}`);
      }
    } else if (ev.type === 'invoice.payment_failed') {   // Pro stays on while Stripe retries; the app can point at the customer portal
      const user = await refUser(o);
      if (user) {
        const p = await db.getPlan(user);
        if (p && p.plan === 'pro') { await db.setPlan(user, { plan: 'pro', source: 'past_due', ref: p.ref, until: p.until }); req.log.info(`pro: ${user} payment failed, marked past_due`); }
      }
    } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
      const user = await refUser(o);
      if (user) {
        const active = ev.type === 'customer.subscription.updated' && ['active', 'trialing', 'past_due'].includes(o.status);
        // an active subscription stays Pro until the end of the period it has paid for; anything else drops to free
        const end = periodEnd(o);
        await db.setPlan(user, { plan: active ? 'pro' : 'free', source: o.status === 'past_due' ? 'past_due' : 'stripe', ref: o.id, until: active && end ? new Date(end + GRACE).toISOString() : null });
        req.log.info(`pro: ${user} subscription ${o.status || 'deleted'} → ${active ? 'pro' : 'free'}`);
      }
    }
    return { received: true };
  });
  // Browser crashes, without Sentry: the app's global error handlers POST a trimmed message here; we only log it.
  // Public but tightly rate-limited per IP; no cookies, no user id, nothing echoed back.
  const clientErrs = new Map();
  app.post('/api/client-error', async (req, reply) => {
    const now2 = Date.now(), seen = (clientErrs.get(req.ip) || []).filter(t => t >= now2 - 3600e3);
    if (seen.length >= 20) return reply.code(429).send({ ok: false });
    seen.push(now2); clientErrs.set(req.ip, seen);
    if (clientErrs.size > 5000) clientErrs.clear();                      // bounded either way
    const b = req.body || {};
    req.log.warn({ evt: 'client_error', msg: String(b.message || '').slice(0, 300), stack: String(b.stack || '').slice(0, 1200), url: String(b.url || '').slice(0, 200), version: String(b.version || '').slice(0, 20) }, 'browser error');
    return { ok: true };
  });

  app.get('/api/state', { preHandler: auth }, async req => ({ user: req.userId, state: await db.all(req.userId) }));
  // GDPR: delete everything stored under this account (state, history snapshots). The confirm phrase guards against an accidental call.
  app.delete('/api/state', { preHandler: auth }, async (req, reply) => {
    if ((req.body || {}).confirm !== 'delete') return reply.code(400).send({ error: 'missing_confirm', message: "send {\"confirm\":\"delete\"}" });
    await db.clear(req.userId);
    req.log.info({ evt: 'gdpr_delete', userId: req.userId }, 'synced data deleted on request');
    return { ok: true };
  });
  app.get('/api/state/:kind', { preHandler: auth }, async (req, reply) => {
    if (!KINDS.has(req.params.kind)) return reply.code(404).send({ error: 'unknown_kind' });
    return (await db.get(req.userId, req.params.kind)) || { data: null, updatedAt: null };
  });
  app.put('/api/state/:kind', { preHandler: auth }, async (req, reply) => {
    const { kind } = req.params;
    if (!KINDS.has(kind)) return reply.code(404).send({ error: 'unknown_kind' });
    const body = req.body || {};
    if (!('data' in body)) return reply.code(400).send({ error: 'missing_data' });
    // optimistic concurrency, atomically in the store: the row only changes when it still is the version the client saw
    if (body.baseUpdatedAt !== undefined) {
      const updatedAt = await db.put(req.userId, kind, body.data, body.baseUpdatedAt === null ? null : String(body.baseUpdatedAt));
      if (updatedAt === null) {                 // someone else wrote first: hand the client the current version to merge
        const cur = await db.get(req.userId, kind);
        return reply.code(409).send({ error: 'conflict', current: cur || { data: null, updatedAt: null } });
      }
      return { ok: true, updatedAt };
    }
    const updatedAt = await db.put(req.userId, kind, body.data);
    return { ok: true, updatedAt };
  });

  // Static app. API routes above win; unknown paths fall back to index.html so the PWA start_url always resolves.
  await app.register(fastifyStatic, {
    root: ROOT, prefix: '/', index: ['index.html'], cacheControl: false,   // Cache-Control is set in setHeaders below (the plugin's own header would overwrite it)
    preCompressed: process.env.NODE_ENV === 'production' || process.env.PRECOMPRESSED === '1',   // file.br / file.gz siblings from scripts/precompress.mjs (Docker build); off in dev so a stale sibling never shadows an edited file
    allowedPath: p => !/^\/(server|scripts|tests|node_modules|\.git|\.github|test-results|playwright-report)(\/|$)/.test(p) && !/\/\.[^/]*$/.test(p) && !/^\/(package(-lock)?\.json|Dockerfile|railway\.json|playwright\.config\.js)$/.test(p),
    setHeaders(res, filePath) {
      if (/[\\/]vendor[\\/]/.test(filePath) || /[\\/]icons[\\/]pokemon[\\/]/.test(filePath) || /\.(png|woff2?)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
    .then(() => app.log.info(`PokeScan on :${PORT} (storage ${app.db.kind}, auth ${process.env.CLERK_SECRET_KEY ? 'clerk' : PASSCODE ? 'passcode' : 'OFF: set CLERK_SECRET_KEY or PASSCODE'}, coach ${process.env.ANTHROPIC_API_KEY ? 'on' : 'off: set ANTHROPIC_API_KEY'})`))
    .catch(e => { console.error(e); process.exit(1); });
}
