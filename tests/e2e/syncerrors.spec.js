import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// Issue #22: when sync starts failing the app says so once (a toast), and says so again when it recovers.

test('a failing push toasts once, recovery toasts too', async ({ page }) => {
  await openApp(page, '#/scans');
  // passcode mode, healthy server, signed in
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, sync: true, auth: 'passcode', version: 'test' }) }));
  await page.route('**/api/state', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"state":{}}' }));
  let fail = true;
  let puts = 0;
  await page.route('**/api/state/*', r => {
    puts++;
    if (fail) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: new Date().toISOString() }) });
  });
  await page.evaluate(async () => { Sync.state.code = 'x'; await Sync.detect(); });

  // an edit triggers a push; the server fails on every attempt (3 quiet retries first, then the error shows)
  await page.evaluate(() => { results.push({ key: 'T|1', species: 'AZUMARILL', cp: 1, combos: [] }); save(); Sync.touch('scans'); });
  const toastEl = page.locator('#toast');
  await expect(toastEl).toHaveClass(/on/, { timeout: 60000 });
  await expect(toastEl).toContainText('Sync is failing', { timeout: 1000 });
  await expect(toastEl).toContainText('Your data is safe on this device');

  // wait out the toast, heal the server, next flush succeeds → the recovery toast
  await page.waitForFunction(() => !document.getElementById('toast').classList.contains('on'), null, { timeout: 15000 });
  fail = false;
  await page.evaluate(async () => { await Sync.flush(); });
  await expect(toastEl).toHaveClass(/on/, { timeout: 15000 });
  await expect(toastEl).toContainText('Sync is back');
  expect(puts).toBeGreaterThan(1);
});
