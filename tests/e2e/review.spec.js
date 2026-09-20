import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const REVIEW = '**Verdict** A solid safe-swap core around Azumarill.\n\n**Strengths**\n- Medicham leads and pressures shields\n- Azumarill is the safe swap\n\n**Weak spots**\n- Tinkaton beats all three: swap to Medicham and bait\n\n**Swaps**\n- Altaria → Corsola (Galarian) (to catch or build): answers Tinkaton\n\n**Order**\nLead: Medicham · Swap: Azumarill · Closer: Altaria\nMedicham pressures shields early; Azumarill is the safest switch; Altaria closes with shields down.';

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
  await expect(page.locator('#builder .team.card.review .rsec')).toHaveCount(4);
  expect(posts).toHaveLength(1);
  expect(posts[0].mode).toBe('review');
  expect(posts[0].context.builder.slots).toHaveLength(3);
  // the order the player runs and the app's own role numbers travel with the request
  expect(posts[0].context.builder.lineup.map(x => x.slot)).toEqual(['Lead', 'Swap', 'Closer']);
  expect(posts[0].context.builder.lineup[0].types.length).toBeGreaterThan(0);
  expect(posts[0].context.builder.lineupKnown).toBe(true);
  expect(posts[0].context.builder.appRoles.map(x => x.role).sort()).toEqual(['Closer', 'Lead', 'Swap']);
  // the builder's own slots differ from the review's order: one tap reorders them
  await expect(page.locator('#builder .team.card.review .rsec:has-text("Order") button:has-text("Reorder the slots")')).toBeVisible();
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
  // the party page shows the saved order as Lead / Swap / Closer, and the review's Order line can be applied in one tap
  await expect(page.locator('#team .hero .role').first()).toContainText('Azumarill');
  await expect(page.locator('#team .hero .sec small')).toContainText('your order');
  await expect(page.locator('#team .team.card.review .rsec:has-text("Order")')).toContainText('Lead: Medicham · Swap: Azumarill · Closer: Altaria');
  await page.click('#team .team.card.review .rsec:has-text("Order") button:has-text("Use this order")');
  await expect.poll(() => page.evaluate(() => Planner.ROSTER.tagged['Core'].join())).toBe('medicham,azumarill,altaria');
  await expect(page.locator('#team .hero .role').first()).toContainText('Medicham');
  await expect(page.locator('#team .hero .role .rl').first()).toContainText('Lead');
  await expect(page.locator('#team .team.card.review .rsec:has-text("Order") button')).toHaveCount(0);
  expect(posts).toHaveLength(2);                    // same trio: the cached review stays
  // the ‹ › arrows on the hero tiles move a member one place, in the saved order
  await page.click('#team .hero .role:nth-child(2) .rl .mvs:has-text("‹")');
  await expect.poll(() => page.evaluate(() => Planner.ROSTER.tagged['Core'].join())).toBe('azumarill,medicham,altaria');
  await expect(page.locator('#team .hero .role').first()).toContainText('Azumarill');
  await page.click('#team .hero .role:nth-child(3) .rl .mvs:has-text("‹")');
  await expect.poll(() => page.evaluate(() => Planner.ROSTER.tagged['Core'].join())).toBe('azumarill,altaria,medicham');
  expect(posts).toHaveLength(2);
  // Refresh review asks again
  await page.click('#team .team.card.review .ctx .dots');
  await page.click('#team .team.card.review .ctx .menu button:has-text("Refresh review")');
  await expect.poll(() => posts.length).toBe(3);
  expect(errors).toEqual([]);
});
