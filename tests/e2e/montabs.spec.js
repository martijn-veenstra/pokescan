import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('a Pokémon you do not own gets the species page with PvP and PvE tabs; an owned one adds Update with a new scan', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.removeItem('scans'); });
  const errors = await openApp(page, '#/mon/tinkaton');
  const mon = page.locator('#mon');
  // not owned: no scan section, PvP tab by default with the moves, meta matchups and how to get it
  await expect(mon.locator('.montabs button.on')).toHaveText('PvP');
  await expect(mon).toContainText('Moves');
  await expect(mon).toContainText('Against the meta');
  await expect(mon).toContainText('How to get Tinkaton');
  await expect(mon.locator('button:has-text("Update with a new scan")')).toHaveCount(0);
  expect(await page.evaluate(() => location.hash)).toBe('#/mon/tinkaton');
  // not owned is said plainly: a chip in the head, a box with the scan that adds it, the same in the ⋮ menu
  await expect(mon.locator('.monhead .chip.warn')).toHaveText('not owned');
  await expect(mon.locator('.notown')).toContainText('Not in your roster yet');
  await expect(mon.locator('.ctx .menu button:has-text("Add a scan of this Pokémon")')).toHaveCount(1);
  await mon.locator('.notown button:has-text("Add a scan of this Pokémon")').click();
  expect(await page.evaluate(() => Planner.scanTarget())).toBe('tinkaton');
  expect(await page.evaluate(() => location.hash)).toBe('#/mon/tinkaton');
  // the import brings a different Pokémon: back on the page, told so, still not owned
  await page.evaluate(() => { const b = DATA.stats['MEDICHAM'][0], lv = 40, m = cpmAt(lv); const r = { species: 'MEDICHAM', cp: calcCP(b, 15, 15, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 15, 15, 15, b]], appraisal: [15, 15, 15], txt: '', cpCandidates: [] }; r.key = `MEDICHAM|${r.cp}|${r.hp}|${lv}|`; results.push(r); save(); render(); Planner.nav('#/scans'); Planner.afterImport([r]); });
  await expect(page.locator('#toast')).toContainText('That was Medicham, not Tinkaton');
  expect(await page.evaluate(() => location.hash)).toBe('#/mon/tinkaton');
  expect(await page.evaluate(() => Planner.scanTarget())).toBe(null);
  await expect(mon.locator('.notown')).toBeVisible();
  // the import brings Tinkaton itself: added, and the page turns into the owned one
  await page.evaluate(() => { Planner.scanFor('tinkaton'); const b = DATA.stats['TINKATON'][0], lv = 13, m = cpmAt(lv); const r = { species: 'TINKATON', cp: calcCP(b, 10, 15, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 10, 15, 15, b]], appraisal: [10, 15, 15], txt: '', cpCandidates: [] }; r.key = `TINKATON|${r.cp}|${r.hp}|${lv}|`; results.push(r); save(); render(); Planner.nav('#/scans'); Planner.afterImport([r]); });
  await expect(page.locator('#toast')).toContainText('Tinkaton added to your roster');
  expect(await page.evaluate(() => location.hash)).toBe('#/mon/tinkaton');
  await expect(mon.locator('.notown')).toHaveCount(0);
  await expect(mon.locator('.monhead .chip.ok')).toHaveText('owned');
  await expect(mon.locator('button:has-text("Update with a new scan")')).toBeVisible();
  // PvE tab: raid moves by damage, the attacker ranking, the boss weaknesses
  await mon.locator('.montabs button:has-text("PvE")').click();
  await expect(mon.locator('.montabs button.on')).toContainText('PvE');
  await expect(mon).toContainText('As a raid attacker');
  await expect(mon).toContainText('Raid moves');
  await expect(mon.locator('.use.raid .ur').first()).toBeVisible();
  await expect(mon).toContainText('When it is the boss');
  await expect(mon).toContainText(/fire|ground|poison/);
  await expect(mon).not.toContainText('Against the meta');
  // the tab sticks across Pokémon; back to PvP
  await page.evaluate(() => Planner.openMon('azumarill'));
  await expect(mon.locator('.montabs button.on')).toContainText('PvE');
  await mon.locator('.montabs button:has-text("PvP")').click();
  // an owned copy: the update button is there and hands the next import to that card
  await page.evaluate(() => { const b = DATA.stats['AZUMARILL'][0], lv = 30, m = cpmAt(lv); const r = { species: 'AZUMARILL', cp: calcCP(b, 8, 15, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 8, 15, 15, b]], appraisal: [8, 15, 15], txt: '', cpCandidates: [] }; r.key = `AZUMARILL|${r.cp}|${r.hp}|${lv}|`; results.push(r); save(); render(); Planner.refresh(); Planner.openMon('azumarill'); });
  await expect(mon.locator('button:has-text("Update with a new scan")')).toBeVisible();
  await mon.locator('button:has-text("Update with a new scan")').click();
  expect(await page.evaluate(() => Planner.updateKey())).toMatch(/^AZUMARILL\|/);
  expect(await page.evaluate(() => location.hash)).toBe('#/mon/azumarill');
  // while that import runs the Pokémon page shows the same loader as Scans, floating above the bottom bar
  await page.evaluate(() => { progBox(true); progress(0.4); status('Scanning IMG_1.png'); });
  await expect(page.locator('#impfloat')).toBeVisible();
  await expect(page.locator('#fstat')).toHaveText('Scanning IMG_1.png');
  await expect(page.locator('#impfloat .pball')).toHaveClass(/on/);         // the Pokéball shakes while reading
  expect(await page.evaluate(() => document.querySelector('#impfloat .pball').dataset.pct)).toBe('40');
  await page.evaluate(() => { progress(1); pballState('done'); });
  await expect(page.locator('#impfloat .pball')).toHaveClass(/done/);       // caught: stars, green button
  expect(await page.evaluate(() => document.querySelector('#impfloat .pball').dataset.pct)).toBe('100');
  await page.evaluate(() => pballState('on'));
  await page.evaluate(() => Planner.nav('#/scans'));
  await expect(page.locator('#impfloat')).toBeHidden();        // on Scans the page's own bar shows, not the floating one
  await expect(page.locator('#prog')).toBeVisible();
  await page.evaluate(() => { progBox(false); Planner.openMon('azumarill'); });
  await expect(page.locator('#impfloat')).toBeHidden();
  // the raids page lists your copy and opens the species page, not the scan page
  await page.evaluate(() => { Planner.pickBoss('tinkaton'); Planner.nav('#/raids'); });
  await expect(page.locator('#raids')).toContainText('Azumarill');
  expect(errors).toEqual([]);
});
