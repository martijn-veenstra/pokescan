import { test, expect } from '@playwright/test';
import { openApp, importFile } from './helpers.js';

/* One card per physical Pokémon. Identity was species + CP + HP; the status screen's weight and height now tell copies
   apart (they differ per Pokémon and stay the same over power-ups). The user's Porygon: 810 CP, 97 HP, 40,33 kg, 0,81 m. */
const live = page => page.evaluate(() => results.filter(r => !r.superseded).map(r => ({ key: r.key, cp: r.cp, hp: r.hp, wt: r.wt, ht: r.ht, history: (r.history || []).map(h => h.cp), impKind: r.impKind || null })));
async function fresh(page) {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  const errors = await openApp(page, '#/roster');
  await page.evaluate(() => { results.length = 0; save(); Planner.refresh(); });
  return errors;
}

test('the same screenshot twice is one card; the import says what it did', async ({ page }) => {
  const errors = await fresh(page);
  await importFile(page, 'porygon-status.png');
  let cards = await live(page);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ cp: 810, hp: 97, wt: 40.33, ht: 0.81, impKind: 'new' });
  await expect(page.locator('#stat')).toContainText('1 new');
  await expect(page.locator('.mon .chip.impnew')).toHaveCount(1);              // the roster card says it is new
  await importFile(page, 'porygon-status.png');
  cards = await live(page);
  expect(cards).toHaveLength(1);
  await expect(page.locator('#stat')).toContainText('0 new · 1 already in your roster');
  await expect(page.locator('.mon .chip.impnew')).toHaveCount(0);              // not new any more
  // its page shows the weight and height
  await page.evaluate(k => Planner.openScan(k), cards[0].key);
  await expect(page.locator('#mon .scanhero')).toContainText('40,33 kg · 0,81 m');
  expect(errors).toEqual([]);
});

test('a second copy with the same CP and HP but another weight gets its own card', async ({ page }) => {
  const errors = await fresh(page);
  await importFile(page, 'porygon-status.png');
  await page.evaluate(() => { const r = results[0]; r.wt = 38.1; save(); });   // the copy already in the roster weighs 38,10 kg
  await importFile(page, 'porygon-status.png');
  const cards = await live(page);
  expect(cards).toHaveLength(2);
  expect(cards.map(c => c.wt).sort()).toEqual([38.1, 40.33]);
  expect(new Set(cards.map(c => c.key)).size).toBe(2);
  await expect(page.locator('#stat')).toContainText('1 new');
  await expect(page.locator('.mon .cp', { hasText: '38,10 kg' })).toHaveCount(1);   // twins in the list say which is which
  await expect(page.locator('.mon .cp', { hasText: '40,33 kg' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the same weight and height at a lower CP: the screenshot is a power-up of that card', async ({ page }) => {
  const errors = await fresh(page);
  await importFile(page, 'porygon-status.png');
  await page.evaluate(() => {                     // turn the card into the same Porygon two levels earlier
    const r = results[0], lv = r.combos[0][0] - 2, m = cpmAt(lv);
    r.combos = r.combos.map(c => [lv, c[1], c[2], c[3], c[4]]);
    const c = r.combos[0]; r.cp = calcCP(c[4] || DATA.stats.PORYGON[0], c[1], c[2], c[3], m); r.hp = calcHP(c[4] || DATA.stats.PORYGON[0], c[3], m); r.level = lv;
    r.key = `PORYGON|${r.cp}|${r.hp}|${lv}|`; r.impKind = null; r.impAt = null; save(); Planner.refresh();
  });
  const before = (await live(page))[0];
  expect(before.cp).toBeLessThan(810);
  await importFile(page, 'porygon-status.png');
  const cards = await live(page);
  expect(cards).toHaveLength(1);
  expect(cards[0].cp).toBe(810);
  expect(cards[0].history).toContain(before.cp);
  expect(cards[0].impKind).toBe('updated');
  await expect(page.locator('#stat')).toContainText('1 updated');
  await expect(page.locator('.mon .chip.impup')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a card scanned before weights were read still matches, and gets the weight', async ({ page }) => {
  const errors = await fresh(page);
  await importFile(page, 'porygon-status.png');
  await page.evaluate(() => { const r = results[0]; delete r.wt; delete r.ht; save(); });
  await importFile(page, 'porygon-status.png');
  const cards = await live(page);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ wt: 40.33, ht: 0.81 });
  expect(errors).toEqual([]);
});
