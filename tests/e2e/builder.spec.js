import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/* Builder picking: an empty slot opens the rankings in pick mode, a tap there fills the slot and returns to the builder;
   unranked Pokémon can be picked and scored; "From your roster" is a wrapping grid, not a sideways-scrolling row. */
const slots = page => page.evaluate(() => JSON.parse(localStorage.getItem('build') || '{}').slots);
const seed = species => {                        // one scan per species, at the highest level that stays under 1500 CP
  results.length = 0;
  for (const sp of species) { const b = DATA.stats[sp][0];
    let lv = 1; for (let l = 1; l <= 40; l += 0.5) if (calcCP(b, 10, 10, 10, cpmAt(l)) <= 1500) lv = l;
    const m = cpmAt(lv), r = { species: sp, cp: calcCP(b, 10, 10, 10, m), hp: calcHP(b, 10, m), level: lv, dust: null, combos: [[lv, 10, 10, 10, b]], appraisal: [10, 10, 10], txt: '', cpCandidates: [], seenAt: Date.now() };
    r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; results.push(r); }
  save(); Planner.refresh();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('build'); localStorage.removeItem('roster'); });
});

test('an empty slot opens the rankings in pick mode; a tap fills the slot and returns to the builder', async ({ page }) => {
  const errors = await openApp(page, '#/builder');
  await page.locator('#builder .role.slot.empty').nth(1).click();
  await expect(page.locator('#view-rank')).toHaveClass(/\bon\b/);
  await expect(page.locator('#rank .pickbar')).toContainText('Pick the Swap');
  await page.fill('#rankq', 'azumarill');
  await page.locator('#rank .rank .rb', { hasText: 'Azumarill' }).first().click();
  await expect(page.locator('#view-builder')).toHaveClass(/\bon\b/);
  expect((await slots(page))[1]).toBe('azumarill');
  await expect(page.locator('#builder .role.slot').nth(1)).toContainText('Azumarill');
  // outside pick mode a ranking row opens the Pokémon page, as before
  await page.evaluate(() => Planner.nav('#/rank'));
  await expect(page.locator('#rank .pickbar')).toHaveCount(0);
  await page.locator('#rank .rank .rb').first().click();
  await expect(page.locator('#view-mon')).toHaveClass(/\bon\b/);
  expect(errors).toEqual([]);
});

test('a Pokémon the league does not rank can be picked and scored', async ({ page }) => {
  const errors = await openApp(page, '#/builder');
  await page.evaluate(() => Planner.setLeague('retro-1500'));
  await expect.poll(() => page.evaluate(() => APP.league.slug)).toBe('retro-1500');
  await page.evaluate(() => Planner.nav('#/builder'));
  await page.locator('#builder .role.slot.empty').first().click();
  await page.fill('#rankq', 'dewpider');
  const row = page.locator('#rank .rank', { hasText: 'Dewpider' }).first();
  await expect(row).toContainText('not ranked');
  await row.locator('.rb').click();
  await expect(page.locator('#view-builder')).toHaveClass(/\bon\b/);
  expect((await slots(page))[0]).toBe('dewpider');
  await expect(page.locator('#builder .role.slot').first()).toContainText(/Dewpider[\s\S]*not ranked/);
  await page.evaluate(() => { Planner.fillSlot(APP.meta[0]); Planner.fillSlot(APP.meta[1]); });
  await expect(page.locator('#builder .hero')).toContainText('This team');
  await expect(page.locator('#builder')).toContainText(/Dewpider isn.t ranked in Retro Cup: its matchups are estimated from types/);
  // the typed box takes an unranked name too
  await page.evaluate(() => Planner.clearSlots());
  await page.fill('#slotid', 'Araquanid'); await page.locator('#builder .add button:has-text("Add")').click();
  expect((await slots(page))[0]).toBe('araquanid');
  expect(errors).toEqual([]);
});

test('From your roster is a wrapping grid with the unranked scans in it', async ({ page }) => {
  const errors = await openApp(page, '#/builder');
  await page.evaluate(seed, ['AZUMARILL', 'MEDICHAM', 'ALTARIA', 'LANTURN', 'SKARMORY', 'REGISTEEL', 'SWAMPERT', 'WHISCASH', 'STUNFISK', 'MEDITITE']);
  await page.evaluate(() => Planner.nav('#/builder'));
  const grid = page.locator('#builder .pgrid');
  await expect(grid.locator('.ptile')).toHaveCount(8);
  expect(await grid.evaluate(g => g.scrollWidth <= g.clientWidth + 1)).toBe(true);        // no sideways scrolling
  await page.locator('#builder button:has-text("Show all 10")').click();
  await expect(grid.locator('.ptile')).toHaveCount(10);
  await expect(grid.locator('.ptile', { hasText: 'Meditite' })).toContainText('not ranked');   // an unranked scan is in the grid too
  await grid.locator('.ptile', { hasText: 'Meditite' }).click();
  expect((await slots(page))[0]).toBe('meditite');
  expect(errors).toEqual([]);
});

test('the roster grid filters on near the cap and on an unlocked 2nd move, and remembers it', async ({ page }) => {
  const errors = await openApp(page, '#/builder');
  await page.evaluate(() => {
    results.length = 0;
    const add = (sp, iv, lv, moves, second) => { const b = DATA.stats[sp][0], m = cpmAt(lv);
      const r = { species: sp, cp: calcCP(b, ...iv, m), hp: calcHP(b, iv[2], m), level: lv, dust: null, combos: [[lv, ...iv, b]], appraisal: iv, txt: '', cpCandidates: [], moves, secondMove: second };
      r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; results.push(r); };
    add('AZUMARILL', [0, 15, 15], 40, ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'], true);   // at the cap, 2nd move unlocked
    add('MEDICHAM', [15, 15, 15], 40, ['COUNTER', 'ICE_PUNCH'], false);               // near the cap, no 2nd move
    add('MEDITITE', [5, 13, 12], 10, ['CONFUSION', 'PSYSHOCK'], false);               // unranked here and far from the cap
    save(); Planner.refresh(); Planner.nav('#/builder');
  });
  const grid = page.locator('#builder .pgrid'), chips = page.locator('#builder .bfilt');
  await expect(grid.locator('.ptile')).toHaveCount(3);
  await chips.locator('.chip', { hasText: 'Near 1500' }).click();
  await expect(grid.locator('.ptile')).toHaveCount(2);
  await expect(grid).not.toContainText('Meditite');
  await chips.locator('.chip', { hasText: '2nd move' }).click();
  await expect(grid.locator('.ptile')).toHaveCount(1);
  await expect(grid).toContainText('Azumarill');
  await expect(chips).toContainText('1 of 3');
  await page.reload(); await page.waitForFunction(() => window.Planner && typeof APP !== 'undefined' && APP);
  await page.evaluate(() => Planner.nav('#/builder'));
  await expect(page.locator('#builder .pgrid .ptile')).toHaveCount(1);         // remembered
  await page.locator('#builder .bfilt .chip', { hasText: 'Near 1500' }).click();
  await page.locator('#builder .bfilt .chip', { hasText: '2nd move' }).click();
  await expect(page.locator('#builder .pgrid .ptile')).toHaveCount(3);
  expect(errors).toEqual([]);
});
