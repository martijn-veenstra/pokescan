import { test, expect } from '@playwright/test';
import { openApp, seedOnce, roster } from './helpers.js';

// A cup with type rules gets a conditions card: the allowed types, the meta's types and move types, and what that means.
test('cup conditions: Mega Color Cup rules, its meta and the advice that follows; Great League folds it away', async ({ page }) => {
  await seedOnce(page, { league: 'colormega-1500' });
  const errors = await openApp(page, '#/meta');
  await expect.poll(() => page.evaluate(() => APP.league.slug)).toBe('colormega-1500');
  const card = page.locator('#meta .cupc');
  await expect(card).toHaveAttribute('open', '');
  await expect(card).toContainText('Cup conditions');
  await expect(card.locator('.crules .chip.tc')).toHaveText(['grass', 'fire', 'water', 'electric']);
  await expect(card).toContainText('Mega-Evolved Pokémon are eligible');
  await expect(card).toContainText(/Water is everywhere: \d+ of the \d+ most common Pokémon/);
  await expect(card).toContainText(/Best typings to bring: /);
  await expect(card).toContainText(/Moves that pay off: /);
  await expect(card.locator('.cbar').first()).toContainText('Water');
  // the coach gets the same conditions
  const c = await page.evaluate(() => Planner.cupConditions());
  expect(c.only).toEqual(['grass', 'fire', 'water', 'electric']);
  expect(c.def[0].types.some(t => c.only.includes(t))).toBe(true);   // the best typing is one the cup allows (Grass/Steel: Ferrothorn)
  expect(c.def.slice(0, 8).some(x => x.types.includes('dragon'))).toBe(true);   // and the Dragon pairs that resist all four allowed types are near the top
  // Game plan points at it in one line
  await page.evaluate(() => Planner.nav('#/matchups'));
  await expect(page.locator('#matchups .cupline')).toContainText('Mega Color Cup: only');
  // an open league: the card is there, folded, and has no rules line
  await page.evaluate(() => Planner.setLeague('great'));
  await expect.poll(() => page.evaluate(() => APP.league.slug)).toBe('great');
  await page.evaluate(() => Planner.nav('#/meta'));
  await expect(page.locator('#meta .cupc')).not.toHaveAttribute('open', '');
  await expect(page.locator('#meta .cupc')).toContainText('League conditions');
  await expect(page.locator('#matchups .cupline')).toHaveCount(0);
  expect(errors).toEqual([]);
});
