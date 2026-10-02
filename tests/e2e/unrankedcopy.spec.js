import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// A scan of a species the cup does not rank (Melmetal in Mega Color Cup) still gets its icon and the power-up arc,
// and an evolution is recognised from the game's evolution table even when the cup does not rank the pre-evolution (Marill).
test('unranked copies: icon, power-up arc, and evolutions in a cup that ranks neither', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.seeded) { localStorage.setItem('league', 'colormega-1500'); sessionStorage.seeded = 1; } });
  const errors = await openApp(page, '#/scans');
  await expect.poll(() => page.evaluate(() => APP.league.slug)).toBe('colormega-1500');
  await page.waitForFunction(() => window.Planner && Planner.evolvesInto('MARILL', 'AZUMARILL'), null, { timeout: 15000 });
  expect(await page.evaluate(() => [Planner.evolvesInto('AZURILL', 'AZUMARILL'), Planner.evolvesInto('MARILL', 'MEDICHAM'), !!APP.pokemon.melmetal, !!APP.pokemon.marill])).toEqual([true, false, false, false]);

  // Melmetal 1233 CP, L13, 1/11/9: icon in the list, the arc on its page
  await page.evaluate(() => { results.unshift({ key: 'MELMETAL|1233|131|13|', species: 'MELMETAL', cp: 1233, hp: 131, level: 13, combos: [[13, 1, 11, 9]] }); save(); render(); Planner.refresh(); });
  await expect(page.locator('.mon.compact:has-text("Melmetal") img.pi')).toHaveAttribute('src', /melmetal\.webp$/);
  await page.evaluate(() => Planner.openScan('MELMETAL|1233|131|13|'));
  await expect(page.locator('#mon #meter')).toBeVisible();
  await expect(page.locator('#mon #minfo')).toContainText('L13');

  // a Marill, then an Azumarill with the same IVs: offered as one card, merged on Yes
  await page.evaluate(() => {
    const m = { key: 'MARILL|500|90|20|', species: 'MARILL', cp: 500, hp: 90, level: 20, combos: [[20, 0, 15, 15]] };
    results.unshift(m); save();
    const a = { key: 'AZUMARILL|1400|150|20|', species: 'AZUMARILL', cp: 1400, hp: 150, level: 20, combos: [[20, 0, 15, 15]] };
    results.unshift(a); Planner.onNewScan(a); save(); render();
  });
  expect(await page.evaluate(() => results.find(r => r.key === 'AZUMARILL|1400|150|20|').lineageHint.kind)).toBe('evolution');
  expect(await page.evaluate(() => !!results.find(r => r.key === 'MARILL|500|90|20|').superseded)).toBe(true);
  await page.evaluate(() => Planner.openScan('AZUMARILL|1400|150|20|'));
  await expect(page.locator('#mon .lin')).toContainText('Is this your Marill (500 CP) evolved?');
  await page.locator('#mon .lin .yes').click();
  await expect.poll(() => page.evaluate(() => results.filter(r => r.species === 'MARILL' || r.species === 'AZUMARILL').map(r => r.species + ' ' + r.cp + ' ' + (r.history || []).map(h => h.species).join()))).toEqual(['AZUMARILL 1400 MARILL']);
  expect(errors).toEqual([]);
});
