import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/* The cloud button turned red whenever the app came back to the foreground: the first request after iOS wakes the app
   fails (network not back, sign-in token not refreshed) and nothing retried until "Sync now". A passing failure is now
   retried quietly, coming back to the app syncs by itself, a real auth error stays red, and the sync box says what
   there is to sync. */
const HEALTH = { ok: true, sync: true, auth: 'passcode', version: 'test' };
const btn = page => page.locator('#syncbtn');
async function connect(page) {
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HEALTH) }));
  await page.route('**/api/state/*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: Date.now() }) }));
  await page.evaluate(async () => { Sync.state.code = 'x'; await Sync.detect(); });
}
const stateOk = r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: {} }) });

test('a network failure is retried quietly: the button never turns red', async ({ page }) => {
  const errors = await openApp(page, '#/today');
  await connect(page);
  let calls = 0;
  await page.route('**/api/state', r => (++calls === 1 ? r.abort('failed') : stateOk(r)));
  const seenErr = [];
  await page.exposeFunction('noteErr', v => seenErr.push(v));
  await page.evaluate(() => { new MutationObserver(() => { if (document.getElementById('syncbtn').classList.contains('err')) window.noteErr(1); }).observe(document.getElementById('syncbtn'), { attributes: true }); });
  await page.evaluate(() => Sync.syncNow());
  await expect.poll(() => calls, { timeout: 10000 }).toBeGreaterThanOrEqual(2);   // retried after the failure
  await expect(btn(page)).toHaveClass(/\bon\b/, { timeout: 10000 });
  expect(seenErr).toEqual([]);
  expect(errors).toEqual([]);
});

test('coming back to the app clears an old error without tapping Sync now', async ({ page }) => {
  await openApp(page, '#/today');
  await connect(page);
  await page.route('**/api/state', r => r.fulfill({ status: 500, body: 'down' }));
  await page.evaluate(() => Sync.syncNow());
  await expect(btn(page)).toHaveClass(/\berr\b/, { timeout: 30000 });          // retried, then shown
  await page.unroute('**/api/state'); await page.route('**/api/state', stateOk);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(btn(page)).toHaveClass(/\bon\b/, { timeout: 10000 });
  await expect(btn(page)).not.toHaveClass(/\berr\b/);
});

test('a wrong passcode stays red; the sync box says what there is to sync', async ({ page }) => {
  await openApp(page, '#/today');
  await connect(page);
  await page.route('**/api/state', r => r.fulfill({ status: 401, body: '{}' }));
  await page.evaluate(() => Sync.syncNow());
  await expect(btn(page)).toHaveClass(/\berr\b/);
  await expect(btn(page)).toHaveAttribute('title', /wrong passcode/);
  await page.unroute('**/api/state'); await page.route('**/api/state', stateOk);
  await page.evaluate(() => Sync.syncNow());                                     // fixed on the server: a sync clears it
  await expect(btn(page)).toHaveClass(/\bon\b/);
  await page.evaluate(() => Sync.toggle());
  await expect(page.locator('#syncbox')).toContainText(/Up to date · last synced \d\d:\d\d/);
  // an edit waiting to go out, then pushed
  await page.unroute('**/api/state/*');
  let release; const held = new Promise(res => { release = res; });
  await page.route('**/api/state/*', async r => { await held; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: Date.now() }) }); });
  await page.evaluate(() => { results.push({ key: 'X|1', species: 'AZUMARILL', cp: 1400, combos: [[20, 1, 1, 1]] }); save(); });
  await expect(page.locator('#syncbox')).toContainText(/Waiting to upload: scans|Syncing/);
  release();
  await expect(page.locator('#syncbox')).toContainText(/Up to date/, { timeout: 10000 });
  await expect(btn(page)).toHaveClass(/\bon\b/);
});
