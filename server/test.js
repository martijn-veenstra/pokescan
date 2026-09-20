// API tests: run against the in-memory store, or against Postgres when DATABASE_URL is set.
process.env.PRECOMPRESSED = '1';               // the static handler serves .br/.gz siblings only in production or with this flag
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './index.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fakeCoach = async ({ context }) => { await new Promise(r => setTimeout(r, 150)); return { text: `**Verdict** Solid core.\n\n**Strengths**\n- context had ${Object.keys(JSON.parse(context)).join(',') || 'nothing'}\n\n**Weak spots**\n- Tinkaton\n\n**Swaps**\n- none`, model: 'fake', usage: { in: 1, out: 1 } }; };
// fake Leek Duck: ScrapedDuck JSON plus one event page in Leek Duck's markup (GO Fest with rotating Mega raids)
const GOFEST_HTML = `<html><body><div class="page-content"><h2 class="event-section-header" id="raids">Raids</h2>
<h3>Mega Raids · Saturday</h3><div class="pkmn-list-flex"><div class="pkmn-list-item"><div class="pkmn-list-img"><img src="x.png"></div><span class="pkmn-name">Mega Altaria</span><img class="shiny-icon" src="s.png"></div>
<div class="pkmn-list-item"><div class="pkmn-list-img"><img src="y.png"></div><span class="pkmn-name">Mega Glalie</span></div></div>
<h2 class="event-section-header" id="spawns">Wild Encounters</h2><div class="pkmn-list-flex"><div class="pkmn-list-item"><span class="pkmn-name">Swablu</span><img class="shiny-icon"></div></div>
<h2 class="event-section-header" id="shiny">Shiny</h2><div class="pkmn-list-flex"><div class="pkmn-list-item"><span class="pkmn-name">Altaria</span></div></div></div></body></html>`;
const ROCKET_HTML = `<html><body><div class="page-content"><div class="rocket-lineups">
<div class="rocket-profile" style="--x:1"><div class="employee-info"><span class="photo"><img src="boss.png" alt="Giovanni" /></span><span class="name-title-wrapper"><div class="name">Giovanni</div><div class="title">Team GO Rocket Boss</div></span><span class="quote"><span class="quote-decor">&ldquo;</span><span class="quote-text">I will not tolerate your interference.</span><span class="quote-decor">&rdquo;</span></span></div>
<div class="lineup-info"><div class="slot "><span class="number">1</span><span class="shadow-pokemon-wrapper"><span class="shadow-pokemon" data-pokemon="Persian" data-type1="normal"><span class="image-wrapper"><img class="pokemon-image" src="pm53.png" alt="Persian" /></span></span></span></div>
<div class="slot "><span class="number">2</span><span class="shadow-pokemon-wrapper"><span class="shadow-pokemon" data-pokemon="Kangaskhan"><img class="pokemon-image" alt="Kangaskhan" /></span><span class="shadow-pokemon" data-pokemon="Rhyperior"><img class="pokemon-image" alt="Rhyperior" /></span></span></div>
<div class="slot encounter"><span class="encounter-icon"><svg><use href="#poke-ball" /></svg></span><span class="number">3</span><span class="shadow-pokemon-wrapper"><span class="shadow-pokemon" data-pokemon="Reshiram"><svg class="shiny-icon"></svg><img class="pokemon-image" alt="Reshiram" /></span></span></div></div></div>
<div class="rocket-profile"><div class="employee-info"><span class="name-title-wrapper"><div class="name">Cliff</div><div class="title">Team GO Rocket Leader</div></span><span class="quote"><span class="quote-text">My strength comes from my loyalty to Team GO Rocket.</span></span></div>
<div class="lineup-info"><div class="slot encounter"><span class="number">1</span><span class="shadow-pokemon-wrapper"><span class="shadow-pokemon" data-pokemon="Vulpix"><img class="pokemon-image" alt="Vulpix" /></span></span></div><div class="slot "><span class="number">2</span><span class="shadow-pokemon-wrapper"><span class="shadow-pokemon" data-pokemon="Snorlax"></span></span></div></div></div>
<div class="rocket-profile"><div class="employee-info"><span class="name-title-wrapper"><div class="name">Grunt</div><div class="title">Team GO Rocket Grunt</div></span><span class="type">Fire</span><span class="quote"><span class="quote-text">Do you know how hot Pokémon fire attacks can get?</span></span></div>
<div class="lineup-info"><div class="slot encounter"><span class="number">1</span><span class="shadow-pokemon-wrapper"><span class="shadow-pokemon" data-pokemon="Vulpix"></span><span class="shadow-pokemon" data-pokemon="Growlithe"></span></span></div><div class="slot "><span class="number">2</span><span class="shadow-pokemon-wrapper"><span class="shadow-pokemon" data-pokemon="Ninetales"></span></span></div><div class="slot "><span class="number">3</span><span class="shadow-pokemon-wrapper"><span class="shadow-pokemon" data-pokemon="Arcanine"></span></span></div></div></div>
</div></div></body></html>`;
const soon = new Date(Date.now() + 3600e3).toISOString(), later = new Date(Date.now() + 26 * 3600e3).toISOString();
const fakeFetch = async (url) => {
  const json = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  if (url.endsWith('raids.json')) return json([{ name: 'Mega Beedrill', tier: 'Mega Raids', canBeShiny: true }]);
  if (url.endsWith('eggs.json')) return json([]);
  if (url.endsWith('research.json')) return json([]);
  if (url.endsWith('events.json')) return json([
    { eventID: 'gofest', name: 'GO Fest: Mega Finale', eventType: 'pokemon-go-fest', link: 'https://leekduck.example/events/gofest/', start: soon, end: later, extraData: { generic: {} } },
    { eventID: 'old', name: 'Old Fest', eventType: 'event', link: 'https://leekduck.example/events/old/', start: '2020-01-01T00:00:00.000', end: '2020-01-02T00:00:00.000', extraData: null },
    { eventID: 'mega', name: 'Mega Beedrill in Mega Raids', eventType: 'raid-battles', link: 'https://leekduck.example/events/mega/', start: soon, end: later, extraData: { raidbattles: { bosses: [{ name: 'Mega Beedrill' }] } } },
  ]);
  if (url.includes('/events/gofest/')) return { ok: true, status: 200, text: async () => GOFEST_HTML };
  if (url.includes('rocket-lineups')) return { ok: true, status: 200, text: async () => ROCKET_HTML };
  return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
};
const app = await buildServer({ passcode: 'test-code', logger: false, coach: fakeCoach, sourcesFetch: fakeFetch });
const H = { authorization: 'Bearer test-code', 'content-type': 'application/json' };
await app.db.clear('default');

let r = await app.inject({ method: 'GET', url: '/api/health' });
assert.equal(r.statusCode, 200);
assert.equal(r.json().sync, true);
console.log('health', r.json());

r = await app.inject({ method: 'GET', url: '/api/state' });
assert.equal(r.statusCode, 401, 'no passcode -> 401');
r = await app.inject({ method: 'GET', url: '/api/state', headers: { authorization: 'Bearer wrong' } });
assert.equal(r.statusCode, 401);
r = await app.inject({ method: 'POST', url: '/api/auth', headers: H });
assert.equal(r.statusCode, 200);

r = await app.inject({ method: 'GET', url: '/api/state/scans', headers: H });
assert.equal(r.json().data, null);
r = await app.inject({ method: 'PUT', url: '/api/state/scans', headers: H, payload: { data: [{ key: 'MIMIKYU|1134', cp: 1134 }] } });
assert.equal(r.statusCode, 200);
const v1 = r.json().updatedAt;
assert.ok(v1);

r = await app.inject({ method: 'PUT', url: '/api/state/scans', headers: H, payload: { data: [], baseUpdatedAt: '1970-01-01T00:00:00.000Z' } });
assert.equal(r.statusCode, 409, 'stale base -> conflict');
assert.equal(r.json().current.data[0].cp, 1134);

r = await app.inject({ method: 'PUT', url: '/api/state/scans', headers: H, payload: { data: [{ key: 'A' }, { key: 'B' }], baseUpdatedAt: v1 } });
assert.equal(r.statusCode, 200);
r = await app.inject({ method: 'GET', url: '/api/state', headers: H });
assert.equal(r.json().state.scans.data.length, 2);

r = await app.inject({ method: 'PUT', url: '/api/state/nope', headers: H, payload: { data: 1 } });
assert.equal(r.statusCode, 404);

r = await app.inject({ method: 'GET', url: '/api/health' });
assert.equal(r.json().coach, true, 'health reports the coach');
r = await app.inject({ method: 'POST', url: '/api/coach', payload: { context: {} } });
assert.equal(r.statusCode, 401, 'coach needs the passcode');
r = await app.inject({ method: 'POST', url: '/api/coach', headers: H, payload: { mode: 'review' } });
assert.equal(r.statusCode, 400, 'coach needs a context');
r = await app.inject({ method: 'POST', url: '/api/coach', headers: H, payload: { context: { builder: { slots: ['a', 'b', 'c'] } }, mode: 'review' } });
assert.equal(r.statusCode, 202, 'review answers with a job at once');
const jobId = r.json().jobId; assert.ok(jobId);
r = await app.inject({ method: 'GET', url: '/api/coach/' + jobId, headers: H });
assert.equal(r.json().status, 'running');
await new Promise(res => setTimeout(res, 300));
r = await app.inject({ method: 'GET', url: '/api/coach/' + jobId, headers: H });
assert.equal(r.json().status, 'done');
assert.ok(r.json().text.includes('**Verdict**'), 'review flows back through the job');
assert.ok(r.json().text.includes('context had builder'), 'the context reaches the model');
r = await app.inject({ method: 'POST', url: '/api/coach', headers: H, payload: { context: { builder: { slots: ['a', 'b', 'c'] } } } });
assert.equal(r.statusCode, 202, 'mode defaults to review');
r = await app.inject({ method: 'POST', url: '/api/coach', headers: H, payload: { context: {}, mode: 'builder' } });
assert.equal(r.statusCode, 400, 'the conversational modes are gone');
r = await app.inject({ method: 'POST', url: '/api/coach', headers: H, payload: { context: {}, question: 'which lead?', mode: 'roster' } });
assert.equal(r.statusCode, 400, 'no questions');
r = await app.inject({ method: 'GET', url: '/api/coach/nope', headers: H });
assert.equal(r.statusCode, 404);
r = await app.inject({ method: 'GET', url: '/api/coach/' + jobId });
assert.equal(r.statusCode, 401, 'job needs the passcode');
const noCoach = await buildServer({ passcode: 'test-code', logger: false, coach: null });
r = await noCoach.inject({ method: 'GET', url: '/api/health' });
assert.equal(r.json().coach, false);
r = await noCoach.inject({ method: 'POST', url: '/api/coach', headers: H, payload: { context: {} } });
assert.equal(r.statusCode, 503, 'no key -> 503');
await noCoach.close();

r = await app.inject({ method: 'GET', url: '/api/sources' });
assert.equal(r.statusCode, 200);
const src = r.json();
assert.equal(src.raids[0].name, 'Mega Beedrill');
const gofest = src.events.find(e => e.eventID === 'gofest');
assert.deepEqual(gofest.extraData.page.raids.map(x => x.name), ['Mega Altaria', 'Mega Glalie'], 'GO Fest raid bosses parsed from the event page');
assert.equal(gofest.extraData.page.raids[0].shiny, true);
assert.equal(gofest.extraData.page.raids[0].group, 'Mega Raids · Saturday');
assert.deepEqual(gofest.extraData.page.spawns.map(x => x.name), ['Swablu']);
assert.ok(!src.events.find(e => e.eventID === 'old').extraData, 'past events are not fetched');
assert.ok(!src.events.find(e => e.eventID === 'mega').extraData.page, 'structured events are left alone');
assert.equal(src.enriched, 1);
console.log('sources', { enriched: src.enriched, gofest: gofest.extraData.page });
assert.ok(src.rocket && src.rocket.lineups.length === 3, 'three Rocket lineups parsed');
const fire = src.rocket.lineups.find(l => /Fire/.test(l.who));
assert.deepEqual(fire.slots, [['Vulpix', 'Growlithe'], ['Ninetales'], ['Arcanine']], 'slots kept apart');
assert.equal(fire.type, 'fire'); assert.equal(fire.encounter, 1, 'the encounter slot is the catchable one'); assert.ok(/hot Pokémon fire/.test(fire.quote), 'grunt quote kept');
const gio = src.rocket.lineups.find(l => l.who === 'Giovanni');
assert.deepEqual(gio.slots, [['Persian'], ['Kangaskhan', 'Rhyperior'], ['Reshiram']]); assert.equal(gio.encounter, 3); assert.equal(gio.title, 'Team GO Rocket Boss');
assert.deepEqual(src.rocket.lineups.find(l => l.who === 'Cliff').slots, [['Vulpix'], ['Snorlax']]);
assert.equal(app.sources.parseRocketPage('<html><body>nothing</body></html>'), null, 'unrecognised page → null');

r = await app.inject({ method: 'GET', url: '/' });
assert.equal(r.statusCode, 200);
assert.ok(r.body.includes('PokeScan'));
r = await app.inject({ method: 'GET', url: '/pvp.js' });
assert.equal(r.statusCode, 200);
r = await app.inject({ method: 'GET', url: '/data/app-great.json' });
assert.equal(r.statusCode, 200);
{ // precompressed siblings (scripts/precompress.mjs) are served when the client accepts them, the plain file otherwise
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/precompress.mjs')], { stdio: 'ignore' });
  r = await app.inject({ method: 'GET', url: '/data/app-great.json', headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(r.statusCode, 200); assert.equal(r.headers['content-encoding'], 'br', 'Brotli sibling served');
  assert.ok(r.rawPayload.length < 200 * 1024, `brotli body is ${r.rawPayload.length} bytes`);
  r = await app.inject({ method: 'GET', url: '/planner.js', headers: { 'accept-encoding': 'gzip' } });
  assert.equal(r.headers['content-encoding'], 'gzip', 'gzip sibling served');
  r = await app.inject({ method: 'GET', url: '/data/app-great.json' });
  assert.equal(r.headers['content-encoding'], undefined, 'plain file without accept-encoding'); assert.ok(JSON.parse(r.body).pokemon);
}
r = await app.inject({ method: 'GET', url: '/icons/pokemon/melmetal.webp' });
assert.equal(r.statusCode, 200); assert.equal(r.headers['content-type'], 'image/webp'); assert.ok(/immutable/.test(r.headers['cache-control']), 'icons are immutable');
r = await app.inject({ method: 'GET', url: '/some/deep/link' });
assert.equal(r.statusCode, 200, 'SPA fallback');
r = await app.inject({ method: 'GET', url: '/api/missing' });
assert.equal(r.statusCode, 404);
for (const p of ['/server/index.js', '/scripts/build_matrix.mjs', '/tests/e2e/helpers.js', '/package.json', '/.gitignore']) {
  r = await app.inject({ method: 'GET', url: p });
  assert.ok(r.statusCode === 200 && r.body.includes('PokeScan') && r.headers['content-type'].includes('text/html'), `${p} is not served as a file (SPA fallback instead)`);
}
r = await app.inject({ method: 'GET', url: '/api/health' });
assert.equal(r.json().auth, 'passcode');

await app.db.clear('default');
await app.close();
console.log(`all API tests passed (storage: ${app.db.kind})`);

// ---- accounts mode: a fake token verifier stands in for Clerk ----
const users = { 'tok-alice': { sub: 'user_alice' }, 'tok-bob': { sub: 'user_bob' } };
const seenHints = [], seenFrames = [];
const fakeVision = async ({ image, mediaType, images, hint }) => { seenHints.push(hint); if (images) seenFrames.push(images.map(f => f.t)); await new Promise(r => setTimeout(r, 60)); return { data: { kind: 'battle_end', confidence: 0.9, battle: { result: 'loss', myTeam: ['Azumarill', 'Medicham', 'Altaria'], oppTeam: ['Tinkaton', 'Cresselia', 'Clodsire'], myLead: 'Azumarill', oppLead: 'Tinkaton', myFainted: 3, oppFainted: 1, ratingAfter: null, ratingDelta: null }, rocket: null, summary: 'GO Battle League loss' }, model: 'fake', usage: { in: 1, out: 1 } }; };
const app2 = await buildServer({ passcode: '', logger: false, coach: fakeCoach, vision: fakeVision, sourcesFetch: fakeFetch, verifyToken: async t => { if (!users[t]) throw new Error('bad'); return users[t]; }, clerkPublishableKey: 'pk_test_x', ownerMigrateFrom: '', proUserIds: ['user_alice'], proCheckoutUrl: 'https://pay.example/pro', stripeWebhookSecret: 'whsec_test' });
const A = { authorization: 'Bearer tok-alice', 'content-type': 'application/json' }, B = { authorization: 'Bearer tok-bob', 'content-type': 'application/json' };
r = await app2.inject({ method: 'GET', url: '/api/health' });
assert.equal(r.json().auth, 'clerk'); assert.equal(r.json().sync, true); assert.equal(r.json().clerkPublishableKey, 'pk_test_x');
r = await app2.inject({ method: 'GET', url: '/api/state', headers: { authorization: 'Bearer nope' } });
assert.equal(r.statusCode, 401, 'bad token rejected');
r = await app2.inject({ method: 'GET', url: '/api/me', headers: A });
assert.equal(r.json().userId, 'user_alice'); assert.equal(r.json().plan, 'pro', 'alice is comped via proUserIds');
assert.deepEqual(r.json().features, ['sync', 'pro', 'coach']); assert.equal(r.json().pro.checkoutUrl, 'https://pay.example/pro?client_reference_id=user_alice');
r = await app2.inject({ method: 'GET', url: '/api/me', headers: B });
assert.equal(r.json().plan, 'free'); assert.deepEqual(r.json().features, ['sync'], 'bob is on the free plan');
r = await app2.inject({ method: 'POST', url: '/api/coach', headers: B, payload: { context: { x: 1 } } });
assert.equal(r.statusCode, 403, 'AI review is a Pro feature'); assert.equal(r.json().error, 'upgrade_required');
await app2.db.setPlan('user_bob', { plan: 'pro', source: 'paid', ref: 'sub_1', until: new Date(Date.now() + 86400e3).toISOString() });
r = await app2.inject({ method: 'GET', url: '/api/me', headers: B });
assert.equal(r.json().plan, 'pro', 'a plan row makes bob pro'); assert.equal(r.json().planSource, 'paid');
await app2.db.setPlan('user_bob', { plan: 'pro', source: 'paid', ref: 'sub_1', until: new Date(Date.now() - 1000).toISOString() });
r = await app2.inject({ method: 'GET', url: '/api/me', headers: B });
assert.equal(r.json().plan, 'free', 'an expired plan row is free again');
assert.equal(await app2.db.findPlanByRef('sub_1'), 'user_bob');
await app2.db.setPlan('user_bob', { plan: 'pro', source: 'paid', ref: 'sub_1', until: null });
// share anything: the vision endpoint is Pro-only, takes a base64 image and answers through a job
{
  const img = Buffer.alloc(400, 1).toString('base64');
  await app2.db.setPlan('user_bob', { plan: 'free' });
  r = await app2.inject({ method: 'POST', url: '/api/vision', headers: B, payload: { image: img, mediaType: 'image/png' } });
  assert.equal(r.statusCode, 403, 'vision is a Pro feature');
  r = await app2.inject({ method: 'POST', url: '/api/vision', headers: A, payload: { mediaType: 'image/png' } });
  assert.equal(r.statusCode, 400, 'needs an image');
  r = await app2.inject({ method: 'POST', url: '/api/vision', headers: A, payload: { image: img, mediaType: 'image/png', hint: 'VICTORY' } });
  assert.equal(r.statusCode, 202); const vj = r.json().jobId;
  let out; for (let i = 0; i < 40 && !(out && out.status === 'done'); i++) { await new Promise(x => setTimeout(x, 50)); out = (await app2.inject({ method: 'GET', url: '/api/jobs/' + vj, headers: A })).json(); }
  assert.equal(out.status, 'done'); assert.equal(out.data.kind, 'battle_end'); assert.deepEqual(out.data.battle.oppTeam, ['Tinkaton', 'Cresselia', 'Clodsire']);
  assert.ok(seenHints.includes('VICTORY'), 'the on-device text reaches the model as a hint');
  r = await app2.inject({ method: 'GET', url: '/api/jobs/' + vj, headers: B }); assert.equal(r.statusCode, 404, 'jobs are private');
  // a recording: several frames in one call
  r = await app2.inject({ method: 'POST', url: '/api/vision', headers: A, payload: { images: [{ image: img, mediaType: 'image/jpeg', t: 3 }] } });
  assert.equal(r.statusCode, 400, 'a recording needs at least two frames');
  r = await app2.inject({ method: 'POST', url: '/api/vision', headers: A, payload: { images: [{ image: img, mediaType: 'image/jpeg', t: 3 }, { image: img, mediaType: 'image/jpeg', t: 90 }, { image: img, t: 178 }] } });
  assert.equal(r.statusCode, 202);
  let fo; for (let i = 0; i < 40 && !(fo && fo.status === 'done'); i++) { await new Promise(x => setTimeout(x, 50)); fo = (await app2.inject({ method: 'GET', url: '/api/jobs/' + r.json().jobId, headers: A })).json(); }
  assert.equal(fo.status, 'done'); assert.deepEqual(seenFrames[seenFrames.length - 1], [3, 90, 178], 'frames reach the model in order with their times');
  r = await app2.inject({ method: 'GET', url: '/api/health' }); assert.equal(r.json().vision, true);
  await app2.db.setPlan('user_bob', { plan: 'pro', source: 'paid', ref: 'sub_1', until: null });
}
// the payment webhook: signed events flip the plan, unsigned ones are refused
{
  const { createHmac: hmac } = await import('node:crypto');
  const sign = (body, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${hmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const post = (payload, sig) => app2.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', ...(sig ? { 'stripe-signature': sig } : {}) }, payload });
  const paid = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', client_reference_id: 'user_dave', customer: 'cus_1', subscription: 'sub_dave', payment_status: 'paid', status: 'complete' } } });
  r = await post(paid, null); assert.equal(r.statusCode, 400, 'no signature');
  r = await post(paid, sign(paid, 'whsec_wrong')); assert.equal(r.statusCode, 400, 'wrong secret');
  r = await post(paid, sign(paid, 'whsec_test', Math.floor(Date.now() / 1000) - 3600)); assert.equal(r.statusCode, 400, 'stale timestamp');
  r = await post(paid, sign(paid)); assert.equal(r.statusCode, 200);
  assert.deepEqual(await app2.db.getPlan('user_dave'), { plan: 'pro', source: 'stripe', ref: 'sub_dave', until: null }, 'a paid checkout makes dave pro');
  const cancelled = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_dave', status: 'canceled' } } });
  r = await post(cancelled, sign(cancelled)); assert.equal(r.statusCode, 200);
  assert.equal((await app2.db.getPlan('user_dave')).plan, 'free', 'a cancelled subscription drops to free');
  const renewed = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_dave', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 } } });
  r = await post(renewed, sign(renewed)); assert.equal(r.statusCode, 200);
  const p = await app2.db.getPlan('user_dave'); assert.equal(p.plan, 'pro', 'an active subscription is pro again'); assert.ok(p.until && new Date(p.until) > new Date(), 'with an expiry after the paid period');
  const unknown = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_nobody', status: 'canceled' } } });
  r = await post(unknown, sign(unknown)); assert.equal(r.statusCode, 200, 'unknown subscriptions are ignored');
  await app2.db.setPlan('user_dave', { plan: 'free' });
}
r = await app2.inject({ method: 'PUT', url: '/api/state/scans', headers: A, payload: { data: [{ key: 'a' }] } });
assert.equal(r.statusCode, 200);
r = await app2.inject({ method: 'GET', url: '/api/state', headers: B });
assert.deepEqual(r.json().state, {}, 'bob does not see alice');
r = await app2.inject({ method: 'GET', url: '/api/state/scans', headers: A });
assert.deepEqual(r.json().data, [{ key: 'a' }]);
r = await app2.inject({ method: 'POST', url: '/api/coach', headers: A, payload: { context: { x: 1 } } });
assert.equal(r.statusCode, 202);
const aliceJob = r.json().jobId;
r = await app2.inject({ method: 'GET', url: '/api/coach/' + aliceJob, headers: B });
assert.equal(r.statusCode, 404, 'jobs are private');
for (let i = 0; i < 9; i++) r = await app2.inject({ method: 'POST', url: '/api/coach', headers: A, payload: { context: { x: 1 } } });
r = await app2.inject({ method: 'POST', url: '/api/coach', headers: A, payload: { context: { x: 1 } } });
assert.equal(r.statusCode, 429, 'per-user budget (10/hour)');
r = await app2.inject({ method: 'POST', url: '/api/coach', headers: B, payload: { context: { x: 1 } } });
assert.equal(r.statusCode, 202, 'bob still has budget');
// migration of the passcode era's rows: kind by kind, never over a kind the account already has
await app2.db.put('default', 'roster', { owned: { azumarill: null } });
await app2.db.put('default', 'scans', [{ key: 'old' }]);
await app2.db.put('user_carol', 'scans', [{ key: 'mine' }]);
assert.deepEqual(await app2.db.migrateUser('default', 'user_carol'), ['roster'], 'only the missing kind moves');
assert.deepEqual((await app2.db.get('user_carol', 'roster')).data, { owned: { azumarill: null } });
assert.deepEqual((await app2.db.get('user_carol', 'scans')).data, [{ key: 'mine' }], 'existing kind untouched');
assert.deepEqual((await app2.db.get('default', 'scans')).data, [{ key: 'old' }], 'unmoved kind stays with the passcode account');
assert.deepEqual(await app2.db.migrateUser('default', 'user_carol'), [], 'idempotent');
// the in-app import: signed in, prove the passcode, only in accounts mode with a passcode still set
r = await app2.inject({ method: 'POST', url: '/api/migrate', headers: A, payload: { passcode: 'x' } });
assert.equal(r.statusCode, 409, 'no passcode on this server → nothing to import');
const app3 = await buildServer({ passcode: 'secret', logger: false, coach: fakeCoach, sourcesFetch: fakeFetch, verifyToken: async t => { if (!users[t]) throw new Error('bad'); return users[t]; }, clerkPublishableKey: 'pk_test_x', ownerMigrateFrom: '' });
r = await app3.inject({ method: 'GET', url: '/api/health' });
assert.equal(r.json().auth, 'clerk'); assert.equal(r.json().passcodeData, true, 'health says passcode-era data may exist');
await app3.db.put('default', 'roster', { owned: { medicham: null } });
await app3.db.put('default', 'battles', [{ t: 1 }]);
r = await app3.inject({ method: 'POST', url: '/api/migrate', headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, payload: { passcode: 'secret' } });
assert.equal(r.statusCode, 401, 'needs a signed-in account');
r = await app3.inject({ method: 'POST', url: '/api/migrate', headers: A, payload: { passcode: 'wrong' } });
assert.equal(r.statusCode, 403, 'wrong passcode');
r = await app3.inject({ method: 'GET', url: '/api/state', headers: A });
assert.deepEqual(r.json().state, {}, 'nothing moved on a wrong passcode');
r = await app3.inject({ method: 'POST', url: '/api/migrate', headers: A, payload: { passcode: 'secret' } });
assert.equal(r.statusCode, 200); assert.deepEqual(r.json().moved.sort(), ['battles', 'roster']);
r = await app3.inject({ method: 'GET', url: '/api/state/roster', headers: A });
assert.deepEqual(r.json().data, { owned: { medicham: null } }, 'alice now owns the passcode era roster');
r = await app3.inject({ method: 'POST', url: '/api/migrate', headers: A, payload: { passcode: 'secret' } });
assert.deepEqual(r.json().moved, [], 'second import finds nothing');
for (let i = 0; i < 3; i++) r = await app3.inject({ method: 'POST', url: '/api/migrate', headers: A, payload: { passcode: 'wrong' } });
assert.equal(r.statusCode, 429, 'five attempts per hour per account');
await app3.db.clear('user_alice'); await app3.close();
await app2.db.clear('user_alice'); await app2.db.clear('user_bob'); await app2.db.clear('user_carol'); await app2.db.clear('default');
await app2.close();
console.log('accounts-mode tests passed');
