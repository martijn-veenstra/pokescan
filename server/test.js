// API tests: run against the in-memory store, or against Postgres when DATABASE_URL is set.
import assert from 'node:assert/strict';
import { buildServer } from './index.js';

const fakeCoach = async ({ context, question }) => ({ text: `**Run this:** Azumarill / Tinkaton / Quagsire\n\n- question was: ${question}\n- context bytes: ${context.length}`, model: 'fake', usage: { in: 1, out: 1 } });
// fake Leek Duck: ScrapedDuck JSON plus one event page in Leek Duck's markup (GO Fest with rotating Mega raids)
const GOFEST_HTML = `<html><body><div class="page-content"><h2 class="event-section-header" id="raids">Raids</h2>
<h3>Mega Raids · Saturday</h3><div class="pkmn-list-flex"><div class="pkmn-list-item"><div class="pkmn-list-img"><img src="x.png"></div><span class="pkmn-name">Mega Altaria</span><img class="shiny-icon" src="s.png"></div>
<div class="pkmn-list-item"><div class="pkmn-list-img"><img src="y.png"></div><span class="pkmn-name">Mega Glalie</span></div></div>
<h2 class="event-section-header" id="spawns">Wild Encounters</h2><div class="pkmn-list-flex"><div class="pkmn-list-item"><span class="pkmn-name">Swablu</span><img class="shiny-icon"></div></div>
<h2 class="event-section-header" id="shiny">Shiny</h2><div class="pkmn-list-flex"><div class="pkmn-list-item"><span class="pkmn-name">Altaria</span></div></div></div></body></html>`;
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
r = await app.inject({ method: 'POST', url: '/api/coach', headers: H, payload: { question: 'x' } });
assert.equal(r.statusCode, 400, 'coach needs a context');
r = await app.inject({ method: 'POST', url: '/api/coach', headers: H, payload: { context: { owned: ['Azumarill'] }, question: 'which lead?' } });
assert.equal(r.statusCode, 200);
assert.ok(r.json().text.includes('which lead?'), 'coach answer flows back');
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

r = await app.inject({ method: 'GET', url: '/' });
assert.equal(r.statusCode, 200);
assert.ok(r.body.includes('PokeScan'));
r = await app.inject({ method: 'GET', url: '/pvp.js' });
assert.equal(r.statusCode, 200);
r = await app.inject({ method: 'GET', url: '/data/app-great.json' });
assert.equal(r.statusCode, 200);
r = await app.inject({ method: 'GET', url: '/some/deep/link' });
assert.equal(r.statusCode, 200, 'SPA fallback');
r = await app.inject({ method: 'GET', url: '/api/missing' });
assert.equal(r.statusCode, 404);

await app.db.clear('default');
await app.close();
console.log(`all API tests passed (storage: ${app.db.kind})`);
