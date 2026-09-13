import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('the builder names and saves a complete team as an in-game party', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  const errors = await openApp(page, '#/builder');
  await page.evaluate(() => Planner.tryTeam(['cramorant', 'quagsire', 'tinkaton']));
  const b = page.locator('#builder');
  await expect(b.locator('#buildname')).toBeVisible();
  // empty name: nothing saved, the field asks for one
  await b.locator('button:has-text("Save team")').click();
  expect(await page.evaluate(() => Object.keys(Planner.ROSTER.tagged).length)).toBe(0);
  await expect(b.locator('#buildname')).toHaveAttribute('placeholder', 'give it a name first');
  // name + Enter saves it; the row turns into the saved-team link; Today and Saved teams know it
  await b.locator('#buildname').fill('Rain');
  await b.locator('#buildname').press('Enter');
  expect(await page.evaluate(() => Planner.ROSTER.tagged.Rain)).toEqual(['cramorant', 'quagsire', 'tinkaton']);
  await expect(b).toContainText('Saved as Rain');
  await expect(page.locator('#toast')).toContainText('Rain saved');
  await b.locator('.team.row:has-text("Saved as Rain")').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/team\//);
  await expect(page.locator('#team')).toContainText('Rain');
  await page.evaluate(() => Planner.nav('#/teams'));
  await expect(page.locator('#teams')).toContainText('Rain');
  expect(errors).toEqual([]);
});
