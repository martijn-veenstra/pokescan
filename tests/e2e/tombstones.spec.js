import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// Issue #11: per-record timestamps and tombstones — deletes stick, the newest edit wins, offline edits survive a reload.

const SCAN = (key, extra) => Object.assign({ key, species: 'AZUMARILL', cp: 1487, combos: [[100, 15, 15, 15]] }, extra);   // used in Node context only

test('a delete sticks against a stale push, a newer edit wins, an older one loses', async ({ page }) => {
  // no real server in the way, and no sync until the test turns it on: every answer below is the test's own, and no background
  // retry can take a one-time answer meant for syncNow()
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sync: false, version: 'test' }) }));
  await openApp(page, '#/scans');
  // seed one scan and let the ledger baseline it (updatedAt 0: pre-ledger data)
  await page.evaluate(rec => { results.push(rec); save(); }, SCAN('AZUMARILL|1487'));
  expect(await page.evaluate(() => results.length)).toBe(1);

  // delete it: the ledger keeps a tombstone with the delete's timestamp
  await page.evaluate(() => { results.splice(0, 1); save(); });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shadow')).scans['AZUMARILL|1487'].del)).toBe(1);

  // a stale device pushes the same record back (updatedAt 0, older than the tombstone): it stays deleted
  await page.route('**/api/state', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { scans: { data: [Object.assign(SCAN('AZUMARILL|1487'), { updatedAt: 0 })], updatedAt: '2026-01-01T00:00:00.000Z' } } }) }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sync: true, auth: 'passcode', version: 'test' }) }));
  await page.evaluate(async () => { Sync.state.code = 'x'; await Sync.detect(); });
  await page.evaluate(async () => { try { await window.Sync.syncNow(); } catch {} });
  expect(await page.evaluate(() => results.filter(r => r.key === 'AZUMARILL|1487').length)).toBe(0);   // still deleted

  // a NEWER remote edit (fresh timestamp) does come through, replacing the tombstone
  const now = Date.now() + 60000;
  await page.unroute('**/api/state');
  await page.route('**/api/state', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { scans: { data: [Object.assign(SCAN('AZUMARILL|1487', { cp: 1500 }), { updatedAt: now })], updatedAt: '2026-01-02T00:00:00.000Z' } } }) }), { times: 1 });
  await page.evaluate(async () => { try { await window.Sync.syncNow(); } catch {} });
  expect(await page.evaluate(() => { const r = results.find(r => r.key === 'AZUMARILL|1487'); return r && r.cp; })).toBe(1500);

  // an OLDER remote copy of a record we just edited does not overwrite the local edit
  await page.evaluate(() => { const r = results.find(r => r.key === 'AZUMARILL|1487'); r.cp = 1600; save(); });
  await page.route('**/api/state', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { scans: { data: [Object.assign(SCAN('AZUMARILL|1487', { cp: 1400 }), { updatedAt: 5 })], updatedAt: '2026-01-03T00:00:00.000Z' } } }) }), { times: 1 });
  await page.evaluate(async () => { try { await window.Sync.syncNow(); } catch {} });
  expect(await page.evaluate(() => results.find(r => r.key === 'AZUMARILL|1487').cp)).toBe(1600);
});

test('an edit made offline survives a reload and is pushed once online', async ({ page }) => {
  await page.route('**/api/**', r => r.abort('internetdisconnected'));   // really unreachable: the local test server must not take the push first
  await openApp(page, '#/scans');
  // the app started with the server unreachable: touch() still records the change
  await page.evaluate(rec => { results.push(rec); save(); }, SCAN('MEDICHAM|1499'));
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('sync') || '{}').dirty || []);
  expect(persisted).toContain('scans');
  // reload within the debounce: dirty came from localStorage, not memory
  await page.reload();
  await page.waitForFunction(() => typeof APP !== 'undefined' && APP && APP.pokemon && window.Planner, null, { timeout: 30000 });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('sync') || '{}').dirty || []);
  expect(after).toContain('scans');
  // the server comes online (passcode mode): flush pushes the queued kinds
  const puts = [];
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sync: true, auth: 'passcode', version: 'test' }) }));
  await page.route('**/api/state', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"state":{}}' }));
  await page.route('**/api/state/*', r => { puts.push(new URL(r.request().url()).pathname); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: new Date().toISOString() }) }); });
  await page.evaluate(async () => { Sync.state.code = 'x'; await Sync.detect(); await Sync.flush(); });
  expect(puts.some(p => p.endsWith('/scans'))).toBe(true);
  // pushed: the queue is empty again
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('sync') || '{}').dirty || []).length)).toBe(0);
});
