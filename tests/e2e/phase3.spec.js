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
  await expect(page.locator('#today .team.card:not(.start)')).toContainText('Meta changed for your Pokémon');
  await expect(page.locator('#today .team.card:not(.start)')).toContainText('Ninetales');
  await expect(page.locator('#today .team.card:not(.start)')).not.toContainText('Medicham');
  await page.click('#today .team.card:not(.start) .ctx .dots');
  await page.click('#today .team.card .ctx .menu button:has-text("Dismiss")');
  await expect(page.locator('#today .team.card:not(.start)')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(Planner.ROSTER.seen).length)).toBe(2);
  expect(errors).toEqual([]);
});

/* IVs do not change on evolving, so a scanned pre-evolution already says where its evolution will rank in every
   league: a Meditite's spread against Medicham's base stats at each cap, and Medicham's own meta rank there. */
test('a scanned Meditite shows where Medicham would rank in every league before it is evolved', async ({ page }) => {
  const errors = await openApp(page, '#/scans');
  const key = await page.evaluate(() => {
    const b = DATA.stats['MEDITITE'][0]; let lv = 1; for (let l = 1; l <= 40; l += 0.5) if (calcCP(b, 5, 13, 12, cpmAt(l)) <= 173) lv = l;
    const m = cpmAt(lv), r = { species: 'MEDITITE', cp: calcCP(b, 5, 13, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 13, 12, b]], appraisal: [5, 13, 12], txt: '', cpCandidates: [] };
    r.key = `MEDITITE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); render(); Planner.refresh(); return r.key;
  });
  await page.evaluate(k => Planner.openScan(k), key);
  const card = page.locator('#mon .team.evot');
  await expect(card).toContainText('Medicham');
  await expect(card).toContainText('CP right after evolving');
  // wait for the rankings of all leagues to load, then compare with the app's own maths
  await expect(card.locator('tbody tr').first()).not.toContainText('…');
  const want = await page.evaluate(async () => {
    const eb = Planner.evoStats('medicham'), out = {};
    const d = await (await fetch('data/pvpoke-rankings.json')).json();
    for (const [k, cp] of [['little', 500], ['great', 1500], ['ultra', 2500]]) {
      const rk = pvpRank(eb, 5, 13, 12, cp), meta = (d.leagues[k].rankings.find(x => x.speciesId === 'medicham') || {}).rank;
      out[k] = { n: rk.n, meta: meta ? '#' + meta : '—', over: calcCP(eb, 5, 13, 12, cpmAt(results[0].level)) > cp };
    }
    return out;
  });
  const rows = await card.locator('tbody tr').allInnerTexts();
  expect(rows[0]).toMatch(/^Little/);
  expect(rows[1]).toMatch(/^Great/);
  expect(rows[2]).toMatch(/^Ultra/);
  for (const [i, k] of ['little', 'great', 'ultra'].entries()) {
    if (want[k].over) { expect(rows[i]).toContain('over the cap'); continue; }
    expect(rows[i], k).toContain('#' + want[k].n);
    expect(rows[i], k).toContain(want[k].meta);
  }
  await card.screenshot({ path: '/tmp/claude-0/-home-user-pokescan/b55cac74-a03b-5534-a7f1-62ddf86efdf8/scratchpad/shot-evo.png' });
  expect(errors).toEqual([]);
});

/* Data that finishes loading in the background redraws the page. It used to close an open ⋮ menu under the tap that
   was about to land on it — the "Mark as normal" step above timed out that way in a slow run. */
test('a background data load does not close an open menu', async ({ page }) => {
  const errors = await openApp(page, '#/scans');
  const key = await page.evaluate(seed);
  await page.evaluate(k => Planner.openScan(k), key);
  await page.click('#mon .monhead .ctx .dots');
  const item = page.locator('#mon .monhead .ctx .menu button:has-text("Mark as Shadow")');
  await expect(item).toBeVisible();
  // the schedule reloads (it notifies the page), and the evolution data arrives again
  await page.evaluate(async () => { await Sources.load(true); });
  await page.waitForTimeout(400);
  await expect(item, 'the menu is still open').toBeVisible();
  await item.click();
  await expect.poll(() => page.evaluate(() => Planner.scanId(results[0]).id)).toBe('ninetales_shadow');
  expect(errors).toEqual([]);
});
