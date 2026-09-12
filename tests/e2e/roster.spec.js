import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('a scanned pre-evolution that PvPoke does not rank shows on the roster under its own name', async ({ page }) => {
  const errors = await openApp(page, '#/scans');
  // a Jigglypuff at L6: unranked in Great League itself, but it evolves into a legal Wigglytuff
  await page.evaluate(() => { const b = DATA.stats['JIGGLYPUFF'][0], lv = 6, m = cpmAt(lv); const r = { species: 'JIGGLYPUFF', cp: calcCP(b, 3, 12, 9, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 3, 12, 9, b]], appraisal: [3, 12, 9], txt: '', cpCandidates: [] }; r.key = `JIGGLYPUFF|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); render(); Planner.refresh(); });
  await expect(page.locator('#out .mon').first()).toContainText(/Jigglypuff[\s\S]*evolve → Wigglytuff/);
  await page.evaluate(() => Planner.nav('#/roster'));
  const board = page.locator('#board');
  await expect(board).toContainText('1 pending');
  // the roster shows the scanned Jigglypuff itself (one card, the same as under Scans), not a ghost Wigglytuff
  await expect(board.locator('.mon .name:has-text("Jigglypuff")')).toHaveCount(1);
  await expect(board.locator('.mon.ghost')).toHaveCount(0);
  await expect(board).toContainText(/evolve → Wigglytuff #\d+/);
  // searching by either name finds it
  await page.fill('#rosterq', 'Jig');
  await expect(board.locator('.mon .name:has-text("Jigglypuff")')).toHaveCount(1);
  await page.fill('#rosterq', 'wiggly');
  await expect(board.locator('.mon .name:has-text("Jigglypuff")')).toHaveCount(1);
  await page.fill('#rosterq', 'azumarill');
  await expect(board).toContainText('Nothing in your roster matches.');
  expect(errors).toEqual([]);
});
