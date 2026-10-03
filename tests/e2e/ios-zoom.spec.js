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

// double-tap zoom is off (a quick second tap on an answer or a chip must not zoom the page); pinch-zoom stays allowed
test('no double-tap zoom on a touch device, pinch-zoom still allowed', async ({ page }) => {
  const errors = await openApp(page, '#/quiz');
  const ta = sel => page.evaluate(s => { const el = document.querySelector(s); return el ? getComputedStyle(el).touchAction : 'missing'; }, sel);
  expect(await ta('html')).toBe('manipulation');
  expect(await ta('body')).toBe('manipulation');
  expect(await ta('#quiz .qopt')).toBe('manipulation');
  expect(await ta('#quiz .qlv button')).toBe('manipulation');
  expect(await ta('#menubtn')).toBe('manipulation');
  expect(await ta('#navbar button')).toBe('manipulation');
  await page.evaluate(() => Planner.nav('#/today'));
  expect(await ta('#today [onclick]')).toBe('manipulation');
  // the CP meter is dragged: it keeps touch-action none
  await page.evaluate(() => { const b = DATA.stats['AZUMARILL'][0], lv = 20, m = cpmAt(lv); const r = { species: 'AZUMARILL', cp: calcCP(b, 5, 14, 14, m), hp: calcHP(b, 14, m), level: lv, combos: [[lv, 5, 14, 14, b]], txt: '', cpCandidates: [] }; r.key = 'AZUMARILL|' + r.cp; results.length = 0; results.push(r); save(); Planner.refresh(); Planner.openScan(r.key); });
  expect(await ta('#meter svg')).toBe('none');
  // and the viewport does not forbid zooming
  const vp = await page.getAttribute('meta[name=viewport]', 'content');
  expect(vp).not.toMatch(/user-scalable\s*=\s*(no|0)/);
  expect(vp).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/);
  expect(errors).toEqual([]);
});
