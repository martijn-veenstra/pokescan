import { test, expect } from '@playwright/test';
import { openApp, importFile } from './helpers.js';

/* "Update this Pokémon" with the user's real screenshots of a Meditite (5/13/12, 173 CP, 48 HP, L10): an appraisal, and
   a status screen scrolled down to the attacks, so the CP is off screen, the name and HP sit high up, and "MEDICHAM MEGA
   ENERGY" is on the card. The attacks used to be dropped as "MEDICHAM cp[] hp? → CP not read, no card". */
test('a scrolled status screen of the card being updated attaches its attacks to that card', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  const errors = await openApp(page, '#/roster');
  const key = await page.evaluate(() => {
    const b = DATA.stats['MEDITITE'][0], lv = 10, m = cpmAt(lv), r = { species: 'MEDITITE', cp: calcCP(b, 5, 13, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 13, 12, b]], appraisal: [5, 13, 12], txt: '', cpCandidates: [] };
    r.key = `MEDITITE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh(); return r.key;
  });
  expect(key).toBe('MEDITITE|173|48|10|');
  await page.evaluate(k => Planner.openScan(k), key);
  await page.evaluate(k => Planner.updateScan(k, 'mon'), key);
  await importFile(page, 'meditite-attacks.png');
  const got = await page.evaluate(() => results.map(r => ({ species: r.species, cp: r.cp, moves: r.moves || null })));
  expect(got).toHaveLength(1);
  expect(got[0].species).toBe('MEDITITE');
  expect(got[0].moves).toEqual(['CONFUSION', 'PSYSHOCK']);                 // not the type label "FIGHTING / PSYCHIC" as a third move
  // the appraisal screenshot of the same Pokémon folds into the same card too
  await page.evaluate(k => Planner.updateScan(k, 'mon'), key);
  await importFile(page, 'meditite-appr.png');
  expect(await page.evaluate(() => results.length)).toBe(1);
  expect(await page.evaluate(() => results[0].appraisal)).toEqual([5, 13, 12]);
  expect(errors).toEqual([]);
});

/* Without the update from a card's page: the same scrolled screenshot is still read as a Meditite, not as the Medicham
   whose Mega Energy is listed on it, and the attacks land on the one Meditite card there is. */
test('the Mega Energy line is not taken for the Pokémon name', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  await openApp(page, '#/roster');
  await page.evaluate(() => {
    const b = DATA.stats['MEDITITE'][0], lv = 10, m = cpmAt(lv), r = { species: 'MEDITITE', cp: calcCP(b, 5, 13, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 13, 12, b]], appraisal: [5, 13, 12], txt: '', cpCandidates: [] };
    r.key = `MEDITITE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh();
  });
  await importFile(page, 'meditite-attacks.png');
  const log = await page.locator('#pevl').innerText().catch(() => '');
  expect(log).not.toMatch(/MEDICHAM cp/);
  expect(await page.evaluate(() => results.length)).toBe(1);
  expect(await page.evaluate(() => results[0].moves || [])).toEqual(['CONFUSION', 'PSYSHOCK']);
});

/* Both in one import, as the user did it, and in the league they plan for (Retro Cup, where Meditite is not ranked either) */
test('the appraisal and the scrolled status screen in one import, in Retro Cup', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.setItem('league', 'retro-1500'); });
  await openApp(page, '#/roster');
  await page.evaluate(() => { const b = DATA.stats['MEDITITE'][0], lv = 10, m = cpmAt(lv), r = { species: 'MEDITITE', cp: calcCP(b, 5, 13, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 13, 12, b]], appraisal: [5, 13, 12], txt: '', cpCandidates: [] }; r.key = `MEDITITE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh(); });
  await page.setInputFiles('#file', ['tests/fixtures/meditite-appr.png', 'tests/fixtures/meditite-attacks.png']);
  await page.waitForFunction(() => /^Done/.test(document.getElementById('stat').textContent), null, { timeout: 180000 });
  expect(await page.evaluate(() => results.map(r => [r.species, r.cp, r.moves]))).toEqual([['MEDITITE', 173, ['CONFUSION', 'PSYSHOCK']]]);
});
