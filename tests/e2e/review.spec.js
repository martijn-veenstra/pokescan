import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const REVIEW = '**Verdict** A solid safe-swap core around Azumarill.\n\n**Strengths**\n- Medicham leads and pressures shields\n- Azumarill is the safe swap\n\n**Weak spots**\n- Tinkaton beats all three: swap to Medicham and bait\n\n**Swaps**\n- Altaria → Corsola (Galarian) (to catch or build): answers Tinkaton';

test('a complete team in the builder gets one AI review, cached per trio', async ({ page }) => {
  const posts = [];
  await page.route('**/api/**', route => {
    const u = route.request().url(), m = route.request().method();
    if (u.endsWith('/api/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, coach: true, version: 'test' }) });
    if (u.endsWith('/api/auth')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (u.endsWith('/api/coach') && m === 'POST') { posts.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: REVIEW }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"default","state":{}}' });
  });
  await page.addInitScript(() => { localStorage.setItem('sync', JSON.stringify({ code: 'test', last: {}, base: {} })); localStorage.removeItem('bcoach'); });
  const errors = await openApp(page, '#/builder');
  await page.evaluate(async () => { await Sync.detect(); Planner.clearSlots(); });
  await page.evaluate(() => Planner.goBuilder(['azumarill', 'medicham', 'altaria']));
  await expect(page.locator('#builder .team.card.review')).toContainText('A solid safe-swap core');
  await expect(page.locator('#builder .team.card.review .rsec')).toHaveCount(3);
  expect(posts).toHaveLength(1);
  expect(posts[0].mode).toBe('review');
  expect(posts[0].context.builder.slots).toHaveLength(3);
  expect(posts[0].context.builder.weakSpots.length).toBeGreaterThan(0);
  // the same trio again: no new call; a different trio: one more
  await page.evaluate(() => Planner.nav('#/today'));
  await page.evaluate(() => Planner.nav('#/builder'));
  await expect(page.locator('#builder .team.card.review')).toContainText('A solid safe-swap core');
  expect(posts).toHaveLength(1);
  await page.evaluate(() => Planner.goBuilder(['azumarill', 'medicham', 'tinkaton']));
  await expect.poll(() => posts.length).toBe(2);
  // saved party rows carry the verdict, team page shows the review
  await page.evaluate(() => { Planner.ROSTER.tagged['Core'] = ['azumarill', 'medicham', 'altaria']; Planner.refresh(); Planner.nav('#/teams'); });
  await expect(page.locator('#teams .team.row .ai').first()).toContainText('A solid safe-swap core');
  await page.evaluate(() => Planner.openTeam(['azumarill', 'medicham', 'altaria'], 'Core'));
  await expect(page.locator('#team .team.card.review')).toContainText('Strengths');
  expect(posts).toHaveLength(2);
  // Refresh review asks again
  await page.click('#team .team.card.review .ctx .dots');
  await page.click('#team .team.card.review .ctx .menu button:has-text("Refresh review")');
  await expect.poll(() => posts.length).toBe(3);
  expect(errors).toEqual([]);
});
