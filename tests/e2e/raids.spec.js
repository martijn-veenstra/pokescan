import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('Raids: pick a boss and rank your own scans against it', async ({ page }) => {
  const errors = await openApp(page, '#/raids');
  await page.evaluate(() => { const mk = (sp, i, lv, a, d, s, moves) => { const b = DATA.stats[sp][i || 0], m = cpmAt(lv); const r = { species: sp, cp: calcCP(b, a, d, s, m), hp: calcHP(b, s, m), level: lv, dust: null, combos: [[lv, a, d, s, b]], appraisal: [a, d, s], txt: '', cpCandidates: [], moves, secondMove: moves && moves.length > 2 }; r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; return r; };
    results.length = 0; results.push(mk('AZUMARILL', 0, 38, 8, 15, 15, ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH']), mk('MEDICHAM', 0, 40, 5, 14, 15, null), mk('ALTARIA', 0, 28, 0, 14, 13, ['DRAGON_BREATH', 'SKY_ATTACK'])); save(); render(); Planner.refresh(); });
  await expect(page.locator('#raids')).toContainText('Pick a boss');
  await page.fill('#bossq', 'dragoni');
  await page.click('#raids .tchips .chip:has-text("Dragonite")');
  await expect(page.locator('#raids .team.card')).toContainText('Dragonite');
  await expect(page.locator('#raids .team.card .chips')).toContainText('ice ×2.56');
  const rows = page.locator('#raids .rank.pve').filter({ has: page.locator('.rk') });
  await expect(page.locator('#raids .sec:has-text("Your best attackers")')).toBeVisible();
  const mine = await page.locator('#raids .sec:has-text("Your best attackers") ~ .rank.pve').allTextContents();
  expect(mine.length).toBeGreaterThanOrEqual(3);
  expect(mine[0]).toMatch(/Azumarill|Medicham/);           // the Ice users beat Altaria against a Dragon/Flying boss
  expect(mine.find(t => t.includes('Medicham'))).toContain('best possible moves');
  expect(mine.find(t => t.includes('Azumarill'))).not.toContain('best possible moves');
  await expect(page.locator('#raids')).toContainText('Best in the game against it');
  await page.click('#raids button:has-text("Clear")');
  await expect(page.locator('#raids .team.card')).toHaveCount(0);
  expect(errors).toEqual([]);
});
