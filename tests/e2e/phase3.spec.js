import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const seed = () => { const b = DATA.stats["NINETALES"][0], lv = 22, m = cpmAt(lv); const r = { species: 'NINETALES', cp: calcCP(b, 4, 15, 14, m), hp: calcHP(b, 14, m), level: lv, dust: null, combos: [[lv, 4, 15, 14, b]], appraisal: [4, 15, 14], txt: '', cpCandidates: [] }; r.key = `NINETALES|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); render(); Planner.refresh(); return r.key; };

test('a scan can be marked as Shadow and then maps to the shadow ranking', async ({ page }) => {
  const errors = await openApp(page, '#/scans');
  const key = await page.evaluate(seed);
  const before = await page.evaluate(() => Planner.scanId(results[0]).id);
  expect(before).toBe('ninetales');
  await page.evaluate(k => Planner.openScan(k), key);
  await expect(page.locator('#mon')).toContainText('Shadow');
  await page.click('#mon .monhead .ctx .dots');
  await page.click('#mon .monhead .ctx .menu button:has-text("Mark as Shadow")');
  await expect.poll(() => page.evaluate(() => Planner.scanId(results[0]).id)).toBe('ninetales_shadow');
  await expect(page.locator('#mon .monhead .chips')).toContainText('shadow');
  await expect(page.locator('#mon')).toContainText(/shadow copy, meta #\d+/);
  await page.click('#mon .monhead .ctx .dots');
  await page.click('#mon .monhead .ctx .menu button:has-text("Mark as normal")');
  await expect.poll(() => page.evaluate(() => Planner.scanId(results[0]).id)).toBe('ninetales');
  expect(errors).toEqual([]);
});

test('team pages have a shareable link and a text export', async ({ page }) => {
  const errors = await openApp(page, '#/today');
  const link = await page.evaluate(() => Planner.teamLink(['azumarill', 'medicham', 'altaria'], 'My party'));
  expect(link).toMatch(/\/index\.html#\/team\/azumarill\+medicham\+altaria\/My%20party$/);
  await page.goto(link);
  await page.waitForFunction(() => typeof APP !== 'undefined' && APP && APP.pokemon && document.querySelector('#team .monhead'), null, { timeout: 30000 });
  await expect(page.locator('#team')).toContainText('My party');
  await page.click('#team .monhead .ctx .dots');
  const items = await page.locator('#team .monhead .ctx .menu button').allTextContents();
  expect(items).toEqual(expect.arrayContaining(['Copy as text', 'Share link…']));
  expect(errors).toEqual([]);
});

test('Today shows meta changes for owned Pokémon and can dismiss them', async ({ page }) => {
  await page.route('**/data/changes.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [
    { date: '2026-09-10', league: 'great', moveset: [{ id: 'ninetales', from: ['EMBER', 'WEATHER_BALL_FIRE', 'PSYSHOCK'], to: ['EMBER', 'WEATHER_BALL_FIRE', 'SCORCHING_SANDS'] }], newMeta: ['ninetales'], leftMeta: [], rank: [] },
    { date: '2026-09-10', league: 'ultra', moveset: [{ id: 'medicham', from: ['COUNTER'], to: ['PSYCHO_CUT'] }], newMeta: [], leftMeta: [], rank: [] },
  ] }) }));
  const errors = await openApp(page, '#/today');
  await page.evaluate(seed);
  await expect(page.locator('#today .team.card')).toContainText('Meta changed for your Pokémon');
  await expect(page.locator('#today .team.card')).toContainText('Ninetales');
  await expect(page.locator('#today .team.card')).not.toContainText('Medicham');
  await page.click('#today .team.card .ctx .dots');
  await page.click('#today .team.card .ctx .menu button:has-text("Dismiss")');
  await expect(page.locator('#today .team.card')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(Planner.ROSTER.seen).length)).toBe(2);
  expect(errors).toEqual([]);
});
