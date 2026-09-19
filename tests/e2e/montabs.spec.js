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
  // the raids page lists your copy and opens the species page, not the scan page
  await page.evaluate(() => { Planner.pickBoss('tinkaton'); Planner.nav('#/raids'); });
  await expect(page.locator('#raids')).toContainText('Azumarill');
  expect(errors).toEqual([]);
});
