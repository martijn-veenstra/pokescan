import { test, expect } from '@playwright/test';
import { openApp, seedOnce, roster } from './helpers.js';

// one scan per [species, level, a, d, s]
const seed = list => {
  results.length = 0;
  for (const [sp, lv, a, d, s] of list) { const b = DATA.stats[sp][0], m = cpmAt(lv);
    const r = { species: sp, cp: calcCP(b, a, d, s, m), hp: calcHP(b, s, m), level: lv, dust: null, combos: [[lv, a, d, s, b]], appraisal: [a, d, s], txt: '', cpCandidates: [], seenAt: Date.now() };
    r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; results.push(r); }
  save(); Planner.refresh();
};
const SEED = [['SWAMPERT', 15, 0, 14, 14], ['AZUMARILL', 20, 15, 0, 0], ['MEDICHAM', 20, 5, 15, 14], ['LUCARIO', 20, 15, 15, 15]];

test.beforeEach(async ({ page }) => { await seedOnce(page, { roster: null }); });

test('Invest: verdicts per league and for raids, with the cost and the why', async ({ page }) => {
  const errors = await openApp(page, '#/today');
  await page.evaluate(seed, SEED);
  await page.evaluate(() => Planner.nav('#/invest'));
  await expect(page.locator('#view-invest .ptitle')).toContainText('Invest');
  // the other leagues and the raid data load, then every purpose is there
  await expect.poll(() => page.evaluate(() => [...new Set(Planner.investRows().map(x => x.purpose))].sort().join()), { timeout: 20000 }).toBe('GL,Raids,UL');
  const rows = await page.evaluate(() => Planner.investRows().map(x => ({ name: x.name, p: x.purpose, v: x.verdict, dust: x.cost && x.cost.dust, xl: x.cost && x.cost.xl, why: x.why.join(' · ') })));
  const row = (n, p) => rows.find(x => x.name === n && x.p === p);
  expect(['invest', 'cheap']).toContain(row('Swampert', 'GL').v);            // #78 in GL, rank-1 IVs, L15 → L19: no XL
  expect(row('Swampert', 'GL').why).toMatch(/your IVs rank #1 \(100\.0% of ideal\)/);
  expect(row('Azumarill', 'GL').v).toBe('skip');                             // 15/0/0 is far from ideal for Great League
  expect(row('Medicham', 'GL').v).toBe('save');                              // needs XL to L50
  expect(row('Medicham', 'GL').xl).toBeGreaterThan(0);
  expect(row('Lucario', 'Raids').why).toMatch(/Fighting raid attacker · Attack IV 15 · L20 → L30/);
  // the page: rows with their verdict and cost; filters
  await page.evaluate(() => Planner.renderInvest());
  await expect(page.locator('#invest .inv').first()).toBeVisible();
  await expect(page.locator('#invest .inv:has-text("Medicham")').first()).toContainText('Save for it');
  await page.locator('#invest .tchips .chip:text-is("Raids")').click();
  expect(await page.locator('#invest .inv').evaluateAll(els => els.every(e => /Raids/.test(e.textContent)))).toBe(true);
  await page.locator('#invest .tchips .chip:text-is("All")').click();
  await page.locator('#invest .tchips .chip:text-is("Hide skip")').click();
  await expect(page.locator('#invest .inv.v-skip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Invest: the spend plan keeps to your stardust and your candy', async ({ page }) => {
  const errors = await openApp(page, '#/today');
  await page.evaluate(seed, SEED);
  await page.evaluate(() => Planner.nav('#/invest'));
  await expect.poll(() => page.evaluate(() => Planner.investRows().some(x => x.purpose === 'UL')), { timeout: 20000 }).toBe(true);
  // no stardust known: a plan by value, and a line asking for the number
  await expect(page.locator('#invest .invplan')).toContainText('Type your stardust above');
  // 12k stardust: the plan fits it and says what is left
  await page.fill('#idust', '12000'); await page.locator('#idust').dispatchEvent('change');
  await page.evaluate(() => Planner.renderInvest());
  const plan = await page.evaluate(() => Planner.spendPlan(Planner.investRows()));
  expect(plan.spent).toBeLessThanOrEqual(12000);
  if (plan.plan.length) await expect(page.locator('#invest .invplan')).toContainText('left over');
  // Mudkip candy read as 3: Swampert's power-up becomes something to save for
  await page.evaluate(() => { Planner.setHave('MUDKIP', 'candy', '3'); Planner.renderInvest(); });
  expect(await page.evaluate(() => Planner.investRows().find(x => x.name === 'Swampert' && x.purpose === 'GL').verdict)).toBe('save');
  // Today points at the plan
  await page.evaluate(() => { Planner.setHave(null, 'dust', '500000'); Planner.nav('#/today'); Planner.renderToday(); });
  await expect(page.locator('#today .team.row:has-text("the full list")')).toBeVisible();
  await page.locator('#today .team.row:has-text("the full list")').click();
  await expect(page).toHaveURL(/#\/invest/);
  expect(errors).toEqual([]);
});
