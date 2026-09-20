import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('Meta teams: the 40 best trios in PvPoke order, must-have / leave-out / buildable filters, ownership rings', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.removeItem('roster'); localStorage.removeItem('scans'); localStorage.removeItem('metaf'); } });   // clear once, not again on the reload below
  const errors = await openApp(page, '#/meta');
  const rows = page.locator('#meta .team.row');
  await expect(rows).toHaveCount(40);
  // the live ranking equals the data file's (uncapped) list, and the badge is the rank, not the score
  const first3 = await page.evaluate(() => Planner.metaTrios().slice(0, 3).map(t => t.ids.slice().sort().join()));
  const data3 = await page.evaluate(() => APP.metaTeams.slice(0, 3).map(t => t.members.slice().sort().join()));
  expect(first3).toEqual(data3);
  await expect(rows.nth(0).locator('.sc')).toHaveText('#1');
  await expect(rows.nth(1).locator('.sc')).toHaveText('#2');
  await expect(rows.nth(0).locator('.trio img.pi')).toHaveCount(3);
  await expect(rows.nth(0).locator('.trio img.pi.nt')).toHaveCount(3);          // nothing owned yet
  // must have Tinkaton
  await page.locator('#meta .mf .chip:has-text("must have")').click();
  await page.fill('#metaq', 'Tinkaton'); await page.locator('#meta .add button:has-text("Add")').click();
  await expect(page.locator('#meta .mf .chip.f')).toContainText('Tinkaton');
  expect(await page.evaluate(() => [...document.querySelectorAll('#meta .team.row .trio img')].length > 0 && [...document.querySelectorAll('#meta .team.row')].every(r => r.querySelector('.trio img[src$="tinkaton.webp"]')))).toBe(true);
  await expect(page.locator('#meta .note').nth(1)).toContainText(/with Tinkaton/);
  // leave out Mimikyu (Busted) by its display name
  await page.locator('#meta .mf .chip:has-text("leave out")').click();
  await page.fill('#metaq', 'Mimikyu (Busted)'); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => [...document.querySelectorAll('#meta .team.row')].every(r => !r.querySelector('.trio img[src$="mimikyu.webp"]')))).toBe(true);
  await expect(page.locator('#meta .note').nth(1)).toContainText(/with Tinkaton, without Mimikyu/);
  // every row says, in one line, how many common Pokémon the team beats
  await expect(page.locator('#meta .team.row').first().locator('.dt')).toContainText(/Beats (all )?\d+( of \d+)? common Pokémon|Beats all \d+ of the common Pokémon/);
  // filters survive a reload
  await page.reload(); await page.waitForFunction(() => window.Planner && APP);
  await expect(page.locator('#meta .mf .chip.f')).toHaveCount(2);
  // only teams I can build: with one owned Azumarill there is none
  await page.locator('#meta .mf .chip:has-text("only teams I can build")').click();
  await expect(page.locator('#meta')).toContainText(/No trio from the top 40/);
  await page.locator('#meta a:has-text("Clear the filters")').click();
  await expect(rows).toHaveCount(40);
  // ownership rings: an owned Melmetal shows a green ring in the first row
  await page.evaluate(() => { const b = DATA.stats['MELMETAL'][0], lv = 8, m = cpmAt(lv); const r = { species: 'MELMETAL', cp: calcCP(b, 10, 14, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 10, 14, 15, b]], appraisal: [10, 14, 15], txt: '', cpCandidates: [] }; r.key = `MELMETAL|${r.cp}|${r.hp}|${lv}|`; results.push(r); save(); render(); Planner.refresh(); });
  await expect(rows.nth(0).locator('.trio img.pi.ow[src$="melmetal.webp"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
