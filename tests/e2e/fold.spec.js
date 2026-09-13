import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('"+N more" lists open and close in place', async ({ page }) => {
  const errors = await openApp(page, '#/mon/azumarill');
  // Against the meta: a top pick has more than ten clear wins or losses, so one of the two rows is folded
  const tog = page.locator('#mon .chips .chip.xmore').first();
  await expect(tog).toBeVisible();
  const label = await tog.textContent();
  expect(label).toMatch(/^\+\d+ more$/);
  const hidden = tog.locator('xpath=preceding-sibling::span[contains(@class,"xm")][1]');
  const total = await hidden.locator('.chip').count();
  expect(total).toBeGreaterThan(0);
  await expect(hidden).toBeHidden();
  await tog.click();
  await expect(hidden).not.toBeHidden();
  await expect(hidden.locator('.chip').first()).toBeVisible();
  await expect(tog).toHaveText('fewer');
  expect(page.url()).toContain('#/mon/azumarill');   // the tap did not open a Pokémon page
  await tog.click();
  await expect(hidden).toBeHidden();
  await expect(tog).toHaveText(label);
  // Meta teams page: the "N more meta teams" fold under a Pokémon's teams uses the block toggle
  await page.evaluate(() => Planner.nav('#/raids'));
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
