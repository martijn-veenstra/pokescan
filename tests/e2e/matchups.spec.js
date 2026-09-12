import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('the matrix drives roles, threat counts and the Matchups page', async ({ page }) => {
  const errors = await openApp(page, '#/builder');
  await page.evaluate(() => Planner.goBuilder(['azumarill', 'medicham', 'altaria']));
  // matrix loaded → simulated threat count in the builder hero
  await expect(page.locator('#builder .hero')).toContainText(/\d+ of \d+ simulated opponents beat all three/);
  await page.evaluate(() => Planner.nav('#/matchups'));
  await expect(page.locator('#matchups')).toContainText("simulated with PvPoke's engine");
  await expect(page.locator('#matchups .chip.ok')).toContainText('Builder');
  await page.fill('#muq', 'tinka');
  await page.click('#matchups .tchips .chip:has-text("Tinkaton")');
  await expect(page.locator('#matchups .mut .mn')).toHaveCount(3);
  await expect(page.locator('#matchups .mut .mc')).toHaveCount(9);
  const cells = await page.locator('#matchups .mut .mc').allTextContents();
  expect(cells.every(c => /^\d+$/.test(c))).toBe(true);
  await expect(page.locator('#matchups .mut .mn').first()).toContainText(/wins regardless|loses|shield-dependent/);
  // their-lead mode gives one piece of advice
  await page.click('#matchups .tabs.sub.seg button:has-text("Their lead")');
  await expect(page.locator('#matchups .team.card')).toContainText(/Stay in|Swap to|Nobody wins/);
  // recent opponents are remembered, roles come from the simulation
  expect(await page.evaluate(() => JSON.parse(localStorage.mu).recent)).toEqual(['tinkaton']);
  const roles = await page.evaluate(() => { const L = Planner.__L ? Planner.__L() : null; return L; });
  await page.evaluate(() => Planner.openTeam(['azumarill', 'medicham', 'altaria']));
  await expect(page.locator('#team')).toContainText(/simulated opponents beat all three/);
  await expect(page.locator('#team .members')).toContainText(/Lead|Swap|Closer/);
  // move counts on a Pokémon page
  await page.evaluate(() => Planner.openMon('medicham'));
  await expect(page.locator('#mon')).toContainText(/Counts/);
  await expect(page.locator('#mon')).toContainText(/Psycho Cut 9 energy per 2 turns/);
  expect(errors).toEqual([]);
});
