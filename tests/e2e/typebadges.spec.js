import { test, expect } from '@playwright/test';
import { openApp, seedOnce, roster } from './helpers.js';

// Type badges next to types and moves, and the type reason behind a lead call and a battle-check line.
test('type badges: chips, moves, the Game plan reasons and the battle check', async ({ page }) => {
  await seedOnce(page, { roster: roster({ Rain: ['azumarill', 'medicham', 'altaria'] }), battles: [] });
  const errors = await openApp(page, '#/matchups');
  expect(await page.locator('#ty-sprite symbol').count()).toBe(18);
  // Game plan: each lead row carries its types and a reason in types
  await expect(page.locator('#matchups .gpl').first().locator('.gt .ty')).not.toHaveCount(0);
  await expect(page.locator('#matchups .gpl .why').first()).toBeVisible();
  const why = await page.locator('#matchups .gpl .why').allTextContents();
  expect(why.every(t => /×|neutral on types/.test(t))).toBe(true);
  expect(await page.locator('#matchups .gpl .why .mvh .ty').count()).toBeGreaterThan(0);
  // species page: its types and weaknesses as badged chips, the moves with their type
  await page.evaluate(() => Planner.openMon('azumarill'));
  await expect(page.locator('#mon .typerow .chip.tc').first()).toContainText('water');
  await expect(page.locator('#mon .typerow .chip.tc .ty').first()).toBeVisible();
  expect(await page.locator('#mon .mvh .ty').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// The party a recording is attributed to is the best match: Chesnaught read on screen counts for a party with Chesnaught (Mega).
test('battle attribution picks the best match, forms included', async ({ page }) => {
  await seedOnce(page, { roster: roster({
    'New idea': ['chesnaught', 'mimikyu', 'cramorant'], 'Color cup': ['chesnaught_mega', 'cramorant', 'toxtricity'], 'First pick': ['cramorant', 'quagsire', 'tinkaton'] }), battles: [] });
  const errors = await openApp(page, '#/battles');
  expect(await page.evaluate(() => Planner.matchParty(['chesnaught', 'cramorant', 'toxtricity']))).toBe('Color cup');
  expect(await page.evaluate(() => Planner.matchParty(['chesnaught', 'mimikyu']))).toBe('New idea');
  expect(await page.evaluate(() => Planner.matchParty(['quagsire']))).toBe('First pick');
  expect(await page.evaluate(() => Planner.matchParty(['tinkaton', 'altaria']))).toBe(null);
  // a draft from a recording starts on the best match
  await page.evaluate(() => Planner.draftBattles([{ result: 'W', src: 'film', myIds: ['chesnaught', 'cramorant', 'toxtricity'], opp: ['swampert'] }]));
  await expect(page.locator('#battles')).toContainText('Color cup');
  expect(errors).toEqual([]);
});
