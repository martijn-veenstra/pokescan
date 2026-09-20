import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('Best IVs: the ranked spreads behind a tap, raid and lucky floors, your own copies marked', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.removeItem('scans'); localStorage.removeItem('ivfloor'); });
  const errors = await openApp(page, '#/mon/clefable');
  const mon = page.locator('#mon');
  // collapsed by default, and the summary already names the #1 spread
  await expect(mon.locator('.ivc')).toHaveCount(1);
  await expect(mon.locator('.ivc')).toContainText(/Rank #1 is \d+\/\d+\/\d+ · \d+ CP at L[\d.]+/);
  await expect(mon.locator('.ivt')).toHaveCount(0);
  await mon.locator('.ivc').click();
  const rows = mon.locator('.ivt tbody tr:not([hidden]):not(.xmore-row):not(.sep)');
  await expect(rows).toHaveCount(10);
  await expect(rows.first().locator('td').first()).toHaveText('#1');
  await expect(rows.first().locator('td').last()).toHaveText('100.0');
  // show more
  await mon.locator('.ivt .xmore-row td').click();
  await expect(mon.locator('.ivt tbody tr:not([hidden]):not(.xmore-row):not(.sep)')).toHaveCount(30);
  // the 10+ floor: every IV at least 10, and the best such spread is no longer #1
  await mon.locator('.ivc .chip:has-text("10+")').click();
  await expect(mon).toContainText(/Best you can get with 10\+ IVs: rank #\d+/);
  const ivs = await mon.locator('.ivt tbody tr:not(.xmore-row):not(.sep) td:nth-child(2) b').allTextContents();
  expect(ivs.length).toBeGreaterThan(0);
  for (const t of ivs) for (const v of t.split('/').map(Number)) expect(v).toBeGreaterThanOrEqual(10);
  expect(await mon.locator('.ivt tbody tr').first().locator('td').first().textContent()).not.toBe('#1');
  // an owned Clefairy: shown as yours, with its rank as Clefable
  await page.evaluate(() => { const b = DATA.stats['CLEFAIRY'][0], lv = 20, m = cpmAt(lv); const r = { species: 'CLEFAIRY', cp: calcCP(b, 10, 14, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 10, 14, 15, b]], appraisal: [10, 14, 15], txt: '', cpCandidates: [] }; r.key = `CLEFAIRY|${r.cp}|${r.hp}|${lv}|`; results.push(r); save(); render(); Planner.refresh(); Planner.renderMon(); });
  await expect(mon.locator('.ivc')).toContainText(/Your Clefairy 10\/14\/15 \(\d+ CP\) is #\d+/);
  await expect(mon.locator('.ivt tr.mine')).toHaveCount(1);
  await expect(mon.locator('.ivt tr.mine')).toContainText('yours');
  // the floor persists across Pokémon, the open state does not
  await page.evaluate(() => Planner.openMon('azumarill'));
  await expect(mon.locator('.ivt')).toHaveCount(0);
  await mon.locator('.ivc').click();
  await expect(mon.locator('.ivc .chip.sel')).toContainText('10+');
  expect(errors).toEqual([]);
});
