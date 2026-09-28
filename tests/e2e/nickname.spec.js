import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/* The in-game nickname for a scanned Pokémon, 12 characters at most (the game's limit): the name cut to fit, the IVs as
   dark circled numbers, the IV % in superscript and the level circled. The user's Quagsire 5/15/12 L28 reads
   "Quagsi❺⓯⓬⁷¹㉘". Other styles: the league rank, or the IVs only; a custom template with tokens. */
test('a scan card offers an in-game nickname with the IVs, and other styles', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.removeItem('roster'); localStorage.removeItem('nick'); } });   // once, not again on the reload
  const errors = await openApp(page, '#/roster');
  const key = await page.evaluate(() => {
    const b = DATA.stats['QUAGSIRE'][0], lv = 28, m = cpmAt(lv);
    const r = { species: 'QUAGSIRE', cp: calcCP(b, 5, 15, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 15, 12, b]], appraisal: [5, 15, 12], txt: '', cpCandidates: [] };
    r.key = `QUAGSIRE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh(); return r.key;
  });
  expect(key).toBe('QUAGSIRE|1488|161|28|');                                      // the screenshot's CP and HP
  await page.evaluate(k => Planner.openScan(k), key);
  const nick = page.locator('#mon .nick');
  await expect(nick).toHaveText('Quagsi❺⓯⓬⁷¹㉘');
  expect([...(await nick.textContent())].length).toBeLessThanOrEqual(12);
  // the league rank style
  await page.locator('#mon select.nicksel').selectOption('rank');
  await expect(page.locator('#mon .nick')).toHaveText(/^Quag.*#\d+❺⓯⓬$|^Qua.*#\d+❺⓯⓬$/);
  expect([...(await page.locator('#mon .nick').textContent())].length).toBeLessThanOrEqual(12);
  // IVs only
  await page.locator('#mon select.nicksel').selectOption('ivs');
  await expect(page.locator('#mon .nick')).toHaveText('❺⓯⓬⁷¹');
  // a custom template, remembered after a reload
  await page.locator('#mon select.nicksel').selectOption('custom');
  await page.fill('#mon input.nicktpl', '{ivs} {name}');
  await page.locator('#mon input.nicktpl').press('Enter');
  await expect(page.locator('#mon .nick')).toHaveText('❺⓯⓬ Quagsire');
  await page.reload(); await page.waitForFunction(() => window.Planner && typeof APP !== 'undefined' && APP);
  await page.evaluate(k => Planner.openScan(k), key);
  await expect(page.locator('#mon .nick')).toHaveText('❺⓯⓬ Quagsire');
  await expect(page.locator('#mon')).not.toContainText(/Poke ?Genie/i);
  expect(errors).toEqual([]);
});
