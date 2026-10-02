import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('the matrix drives roles, threat counts and the Game plan page', async ({ page }) => {
  const errors = await openApp(page, '#/builder');
  await page.evaluate(() => Planner.goBuilder(['azumarill', 'medicham', 'altaria']));
  // matrix loaded → simulated threat count in the builder hero
  await expect(page.locator('#builder .hero')).toContainText(/Beaten by \d+ of the common Pokémon|No common Pokémon beats all three of yours/);
  await page.evaluate(() => Planner.nav('#/matchups'));
  await expect(page.locator('#matchups')).toContainText('Simulated battles for');
  await expect(page.locator('#matchups .gphead b')).toHaveText('Builder');
  // their leads, each with one piece of advice; a row opens the three shield scenarios
  await expect(page.locator('#matchups .gpl .ga b').first()).toHaveText(/Stay in|Stay, shield once|Swap to|Nobody wins/);
  await page.locator('#matchups .gpl:has-text("Tinkaton")').click();
  await expect(page.locator('#matchups .mut .mn')).toHaveCount(3);
  await expect(page.locator('#matchups .mut .mc')).toHaveCount(9);
  const cells = await page.locator('#matchups .mut .mc').allTextContents();
  expect(cells.every(c => /^\d+$/.test(c))).toBe(true);
  await expect(page.locator('#matchups .mut .mn').first()).toContainText(/wins regardless|loses|shield-dependent/);
  expect(await page.evaluate(() => JSON.parse(localStorage.mu).lead)).toBe('tinkaton');
  await page.evaluate(() => Planner.openTeam(['azumarill', 'medicham', 'altaria']));
  await expect(page.locator('#team')).toContainText(/beat all three/);
  await expect(page.locator('#team .members')).toContainText(/Lead|Swap|Closer/);
  // move counts on a Pokémon page
  await page.evaluate(() => Planner.openMon('medicham'));
  await expect(page.locator('#mon')).toContainText(/Counts/);
  await expect(page.locator('#mon')).toContainText(/Psycho Cut 9 energy per 2 turns/);
  expect(errors).toEqual([]);
});
