import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// Switching league must never break a page: a Builder and a saved team holding Pokémon a cup does not allow
// (Medicham and Altaria in Mega Color Cup) are marked, not crashed on. Every league the app has, the main pages.
test('every league: Builder, Today, Game plan, Invest and the team page render without an error', async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(() => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1;
    localStorage.setItem('build', JSON.stringify({ slots: ['medicham', 'azumarill', 'chesnaught_mega'], moves: {} }));
    localStorage.setItem('roster', JSON.stringify({ tagged: { Rain: ['azumarill', 'medicham', 'altaria'] }, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] })); } });
  const errors = await openApp(page, '#/today');
  const slugs = await page.evaluate(async () => (await (await fetch('data/cups.json')).json()).leagues.map(l => l.slug));
  expect(slugs.length).toBeGreaterThan(3);
  const broken = [];
  for (const slug of slugs) {
    await page.evaluate(s => Planner.setLeague(s), slug);
    await expect.poll(() => page.evaluate(() => APP.league.slug), { timeout: 20000 }).toBe(slug);
    for (const h of ['#/builder', '#/today', '#/matchups', '#/invest', '#/team/azumarill+medicham+altaria/Rain']) {
      await page.evaluate(x => Planner.nav(x), h);
      const err = await page.evaluate(() => { const v = document.querySelector('.view.on'); return v && /hit an error/.test(v.innerText) ? v.innerText.slice(0, 160) : ''; });
      if (err) broken.push(`${slug} ${h}: ${err}`);
    }
  }
  expect(broken).toEqual([]);
  // the Builder says why a slot is not scored
  await page.evaluate(() => Planner.setLeague('colormega-1500'));
  await expect.poll(() => page.evaluate(() => APP.league.slug)).toBe('colormega-1500');
  await page.evaluate(() => Planner.nav('#/builder'));
  await expect(page.locator('#builder')).toContainText(/Medicham isn.t allowed in Mega Color Cup/);
  await expect(page.locator('#builder .role.slot')).toContainText(['not allowed here']);
  expect(errors).toEqual([]);
});
