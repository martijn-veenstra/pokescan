import { test, expect } from '@playwright/test';
import { openApp, importFile, cards } from './helpers.js';

test('a rescanned power-up offers a one-tap merge into the old card', async ({ page }) => {
  const errors = await openApp(page, '#/scans');
  // an older Stunfisk (Galarian) card at 567 CP with the same IV spread as the 794 CP fixture
  await page.evaluate(() => {
    const b = DATA.stats['STUNFISK'].find(x => (x.form || '').toLowerCase().includes('galar')) || DATA.stats['STUNFISK'][1] || DATA.stats['STUNFISK'][0];
    const lv = 10, m = cpmAt(lv), cp = calcCP(b, 5, 9, 13, m), hp = calcHP(b, 13, m);
    const old = { species: 'STUNFISK', cp, hp, level: lv, dust: null, combos: [[lv, 5, 9, 13, b]], appraisal: [5, 9, 13], txt: '', cpCandidates: [], moves: ['MUD_SHOT', 'ROCK_SLIDE'], secondMove: false, fav: true };
    old.key = `STUNFISK|${cp}|${hp}|${lv}|`;
    results.length = 0; results.push(old); save(); render(); window.OLD = { cp, hp };
  });
  await importFile(page, 'stun-status.png');
  let got = await cards(page);
  expect(got).toHaveLength(2);
  expect(got.find(c => c.cp !== 794).superseded, 'old card archived by the power-up detector').toBe(true);
  await expect(page.locator('#out .lin .q')).toContainText(/Is this your Stunfisk \d+ CP powered up\?/);
  await page.click('#out .lin .yes');
  got = await cards(page);
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ species: 'STUNFISK', cp: 794, hp: 126, ivs: [5, 9, 13], moves: ['METAL_CLAW', 'EARTHQUAKE'], secondMove: false, superseded: false });
  const hist = await page.evaluate(() => results[0].history);
  expect(hist).toHaveLength(1);
  expect(hist[0]).toMatchObject({ species: 'STUNFISK', cp: (await page.evaluate(() => OLD.cp)) });
  expect(await page.evaluate(() => results[0].fav)).toBe(true);
  expect(errors).toEqual([]);
});

test('"No" keeps two cards and removes the offer', async ({ page }) => {
  await openApp(page, '#/scans');
  await page.evaluate(() => {
    const b = DATA.stats['STUNFISK'].find(x => (x.form || '').toLowerCase().includes('galar')) || DATA.stats['STUNFISK'][1] || DATA.stats['STUNFISK'][0];
    const lv = 10, m = cpmAt(lv), cp = calcCP(b, 5, 9, 13, m), hp = calcHP(b, 13, m);
    results.length = 0; results.push({ species: 'STUNFISK', cp, hp, level: lv, dust: null, combos: [[lv, 5, 9, 13, b]], appraisal: [5, 9, 13], txt: '', cpCandidates: [], key: `STUNFISK|${cp}|${hp}|${lv}|` }); save(); render();
  });
  await importFile(page, 'stun-status.png');
  await page.click('#out .lin .no');
  expect(await page.locator('#out .lin').count()).toBe(0);
  expect(await cards(page)).toHaveLength(2);
  expect(await page.evaluate(() => results.some(r => r.lineageHint))).toBe(false);
});
