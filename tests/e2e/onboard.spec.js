import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const seed = (page, species, n) => page.evaluate(([species, n]) => {
  results.length = 0;
  for (const s of species.slice(0, n)) { const b = DATA.stats[s][0], lv = 25, m = cpmAt(lv); const r = { species: s, cp: calcCP(b, 10, 14, 13, m), hp: calcHP(b, 13, m), level: lv, dust: null, combos: [[lv, 10, 14, 13, b]], appraisal: [10, 14, 13], txt: '', cpCandidates: [] }; r.key = `${s}|${r.cp}|${r.hp}|${lv}|`; results.push(r); }
  save(); render(); Planner.refresh();
}, [species, n]);
const SP = ['AZUMARILL', 'MEDICHAM', 'ALTARIA', 'TINKATON', 'SKARMORY', 'SABLEYE'];

test('getting-started checklist ticks itself off and milestones toast once', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('cleared')) { localStorage.removeItem('onboard'); localStorage.removeItem('milestones'); localStorage.removeItem('scans'); sessionStorage.setItem('cleared', '1'); } });   // once, not again on reload
  const errors = await openApp(page, '#/today');
  const today = page.locator('#today');
  // zero scans: the checklist leads, step 1 is next, the old instructions are gone
  await expect(today.locator('.team.card.start')).toContainText('Getting started');
  await expect(today.locator('.step.next b')).toHaveText('Import a status screenshot');
  await expect(today.locator('.step.done')).toHaveCount(0);
  await expect(today).toContainText('The checklist above says what to scan next');
  // the first check only baselines: no toast on an app that just loaded
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.getElementById('toast').classList.contains('on'))).toBe(false);
  // one scan with an appraisal: two steps tick, one toast for the biggest new milestone
  await seed(page, SP, 1);
  await expect(today.locator('.step.done')).toHaveCount(2);
  await expect(today.locator('.step.next b')).toHaveText('Scan the attacks');
  await expect(page.locator('#toast')).toHaveClass(/on/);
  await expect(page.locator('#toast')).toContainText(/Roster knows 1 Pokémon|1 exact-IV Pokémon/);
  // five scans: Today builds a team, the 5-tier fires with its payoff, the profile sheet shows progress
  await seed(page, SP, 5);
  await expect(today.locator('.step.done')).toHaveCount(3);
  await expect(page.locator('#toast')).toContainText('Roster knows 5 Pokémon · Today can build a team');
  await page.evaluate(() => toggleProfile());
  await expect(page.locator('#mstones')).toContainText('5 / 15');
  await expect(page.locator('#mstones')).toContainText('10 more scans and the builder has real choices');
  await expect(page.locator('#mstones .ms')).toHaveCount(6);
  await page.evaluate(() => toggleProfile());
  // hide persists across reload; the help sheet brings it back
  await page.click('#today .team.card.start .ctx .dots');
  await page.click('#today .team.card.start .menu button:has-text("Hide")');
  await expect(today.locator('.team.card.start')).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => typeof APP !== 'undefined' && APP && APP.pokemon && window.Planner, null, { timeout: 30000 });
  await expect(page.locator('#today .team.card.start')).toHaveCount(0);
  await page.evaluate(() => Planner.showStart());
  await expect(page.locator('#today .team.card.start')).toContainText('3 of 7');
  // an existing device with data gets no toast on load: unlocked tiers were recorded, not announced
  expect(await page.evaluate(() => document.getElementById('toast').classList.contains('on'))).toBe(false);
  expect(errors).toEqual([]);
});
