// API tests: run against the in-memory store, or against Postgres when DATABASE_URL is set.
import assert from 'node:assert/strict';
import { buildServer } from './index.js';

const app = await buildServer({ passcode: 'test-code', logger: false });
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
