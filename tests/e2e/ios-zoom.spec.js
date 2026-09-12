import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// iOS Safari zooms the page when a focused text field or select renders under 16px; on a touch device every such control must be 16px
test.use({ isMobile: true, hasTouch: true });

const smallControls = page => page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
  .filter(el => !['checkbox', 'radio', 'file', 'range', 'hidden'].includes(el.type) && el.getClientRects().length)
  .map(el => ({ id: el.id || el.className || el.tagName, size: parseFloat(getComputedStyle(el).fontSize) }))
  .filter(c => c.size < 16));

test('no text field or select is under 16px on a touch device', async ({ page }) => {
  const errors = await openApp(page, '#/scans');
  await page.evaluate(() => { const b = DATA.stats['AZUMARILL'][0], lv = 38, m = cpmAt(lv); const r = { species: 'AZUMARILL', cp: calcCP(b, 8, 15, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 8, 15, 15, b]], appraisal: [8, 15, 15], txt: '', cpCandidates: [] }; r.key = `AZUMARILL|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); render(); Planner.refresh(); });
  expect(await smallControls(page)).toEqual([]);
  for (const hash of ['#/roster', '#/builder', '#/mon/azumarill', '#/battles', '#/matchups']) {
    await page.evaluate(h => Planner.nav(h), hash);
    await page.waitForTimeout(300);
    expect(await smallControls(page), hash).toEqual([]);
  }
  await page.evaluate(() => Planner.toggleAdd && Planner.nav('#/roster'));
  await page.click('#menubtn');
  expect(await smallControls(page), 'drawer').toEqual([]);
  expect(errors).toEqual([]);
});
