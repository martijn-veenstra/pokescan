import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('battle log: three-tap battles, rating, stats, team record and coach context', async ({ page }) => {
  const puts = [];
  await page.route('**/api/**', route => {
    const u = new URL(route.request().url()), m = route.request().method();
    if (u.pathname === '/api/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sync: true, auth: 'passcode', coach: false }) });
    if (u.pathname.startsWith('/api/state/') && m === 'PUT') { puts.push({ kind: u.pathname.split('/').pop(), data: JSON.parse(route.request().postData()).data }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: new Date().toISOString() }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"state":{}}' });
  });
  await page.addInitScript(() => { localStorage.setItem('sync', JSON.stringify({ code: 'test', last: {}, base: {} })); localStorage.removeItem('battles'); localStorage.removeItem('bl'); });
  const errors = await openApp(page, '#/battles');
  await page.evaluate(async () => { await Sync.detect(); Planner.ROSTER.tagged['Core'] = ['azumarill', 'medicham', 'altaria']; Planner.refresh(); Planner.nav('#/battles'); });
  await expect(page.locator('#battles')).toContainText('Log a battle');
  await page.click('#battles .tchips .chip:has-text("Core")');
  await page.fill('#blq', 'tinka');
  await page.click('#battles .tchips .chip:has-text("Tinkaton")');
  await expect(page.locator('#battles')).toContainText('Their lead: Tinkaton');
  await page.click('#battles .wl .loss');
  await page.click('#battles .tchips .chip:has-text("Tinkaton")');
  await page.click('#battles .wl .loss');
  await page.click('#battles .wl .win');                        // no lead this time
  await expect(page.locator('#battles')).toContainText('1-2 · 3 logged');
  await expect(page.locator('#battles')).toContainText(/0-2.*Tinkaton/);
  await expect(page.locator('#battles')).toContainText('trouble');
  await page.fill('#blrating', '2143');
  await page.click('#battles .add button:has-text("Save")');
  await expect(page.locator('#battles .team.card .big')).toHaveText('2143');
  await page.fill('#blrating', '2210');
  await page.click('#battles .add button:has-text("Save")');
  await expect(page.locator('#battles .spark')).toBeVisible();
  // team page shows the record, coach context carries the history
  await page.evaluate(() => Planner.openTeam(['azumarill', 'medicham', 'altaria'], 'Core'));
  await expect(page.locator('#team')).toContainText('Your record');
  await expect(page.locator('#team')).toContainText(/1-2.*Tinkaton 0-2/);
  const ctx = await page.evaluate(() => { const B = Planner.BATTLES; return { n: B.length, kinds: B.map(b => b.src) }; });
  expect(ctx.n).toBe(5);
  await expect.poll(() => puts.some(p => p.kind === 'battles' && p.data.length === 5), { timeout: 10000 }).toBe(true);
  await page.evaluate(() => Planner.nav('#/battles'));
  await page.click('#battles .team.row .ctx .dots');
  await page.click('#battles .team.row .ctx .menu button:has-text("Delete")');
  expect(await page.evaluate(() => Planner.BATTLES.length)).toBe(4);
  expect(errors).toEqual([]);
});
