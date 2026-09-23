import { test, expect } from '@playwright/test';
import { openApp, importFile } from './helpers.js';

test('switching league changes cap, rankings and roster readiness', async ({ page }) => {
  const errors = await openApp(page, '#/rank');
  await expect(page.locator('#leaguelbl')).toHaveText('Great League');
  // an Azumarill at 1457 CP: under the GL cap, far under the UL cap
  await page.evaluate(() => { const b = DATA.stats['AZUMARILL'][0], lv = 38, m = cpmAt(lv); const r = { species: 'AZUMARILL', cp: calcCP(b, 8, 15, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 8, 15, 15, b]], appraisal: [8, 15, 15], txt: '', cpCandidates: [] }; r.key = `AZUMARILL|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); render(); Planner.refresh(); });
  await page.click('#menubtn');
  const leagues = await page.locator('#dr a').evaluateAll(els => els.map(e => e.textContent.trim()).filter(t => /CP$/.test(t)));
  expect(leagues.join(' | ')).toMatch(/Great League1500 CP.*Ultra League2500 CP.*Little League500 CP/);
  expect(leagues.length).toBeGreaterThanOrEqual(3);
  await page.click('#dr a:has-text("Ultra League")');
  await expect(page.locator('#leaguelbl')).toHaveText('Ultra League');
  await expect.poll(() => page.evaluate(() => APP.league.cp)).toBe(2500);
  expect(await page.evaluate(() => localStorage.getItem('league'))).toBe('ultra');
  await expect(page.locator('#rank')).toContainText('Ultra League overall rankings');
  await page.evaluate(() => Planner.nav('#/roster'));
  await expect(page.locator('#board')).toContainText(/powering up|XL gated/);
  expect(await page.evaluate(() => document.querySelector('#filter option[value=gl]').text)).toBe('UL eligible (≤2500)');
  // a featured cup, when the index has one
  const cup = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('cups') || '[]').find(x => x.kind === 'cup'); return c ? c.slug : null; });
  if (cup) {
    await page.evaluate(s => Planner.setLeague(s), cup);
    await expect.poll(() => page.evaluate(() => APP.league.slug)).toBe(cup);
    await expect(page.locator('#leaguelbl')).not.toHaveText('Ultra League');
  }
  await page.evaluate(() => Planner.setLeague('great'));
  await expect(page.locator('#leaguelbl')).toHaveText('Great League');
  await expect.poll(() => page.evaluate(() => APP.league.cp)).toBe(1500);
  // reload keeps the choice
  await page.evaluate(() => localStorage.setItem('league', 'little'));
  await page.reload();
  await page.waitForFunction(() => typeof APP !== 'undefined' && APP && APP.league && APP.league.slug === 'little', null, { timeout: 30000 });
  await expect(page.locator('#leaguelbl')).toHaveText('Little League');
  expect(errors).toEqual([]);
});

/* The roster is kept across leagues, so switching to a cup leaves Pokémon in it that the cup's data does not have.
   A wanted Tinkaton in the Retro Cup made every scan import fail with "undefined is not an object (evaluating
   'APP.pokemon[id].rank')", because the roster tiles read the rank of each wanted Pokémon unchecked. */
test('a cup that lacks some of your wanted and pending Pokémon still imports scans and shows every page', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    localStorage.setItem('league', 'retro-1500');
    localStorage.setItem('roster', JSON.stringify({ tagged: { Rain: ['azumarill', 'medicham', 'altaria'] }, owned: { tinkaton: null },
      candidates: { tinkaton: null, azumarill: null, medicham: null }, pending: { mimikyu: null }, exclude: ['mimikyu_busted'], moves: {}, log: [] }));
  });
  const errors = await openApp(page, '#/scans');
  expect(await page.evaluate(() => [APP.league.slug, !!APP.pokemon.tinkaton, !!APP.pokemon.azumarill]), 'the cup really lacks them').toEqual(['retro-1500', false, false]);
  await importFile(page, 'cram-appr.png');
  const log = await page.evaluate(() => document.getElementById('implog').innerText);
  expect(log, 'the scan is read, not failed').not.toMatch(/failed/);
  expect(await page.evaluate(() => results.some(r => r.species === 'CRAMORANT'))).toBe(true);
  for (const h of ['#/roster', '#/today', '#/builder', '#/teams', '#/battles', '#/rank', '#/meta']) {
    await page.evaluate(h => Planner.nav(h), h);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => [...document.querySelectorAll('.view.on .empty b')].map(b => b.textContent).filter(t => /hit an error/.test(t))), `${h} renders`).toEqual([]);
  }
  expect(errors).toEqual([]);
});
