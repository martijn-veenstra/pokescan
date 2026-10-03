import { test, expect } from '@playwright/test';
import { openApp, seedOnce, roster } from './helpers.js';

// The bottom bar must stay on the bottom edge of what you see, on every page and at any scroll position.
const navBox = page => page.evaluate(() => { const r = document.getElementById('navbar').getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight, shown: getComputedStyle(document.getElementById('navbar')).display !== 'none' }; });

test('the bottom bar sits on the bottom edge on every page, scrolled or not', async ({ page }) => {
  await seedOnce(page, { roster: roster({ Rain: ['azumarill', 'medicham', 'altaria'] }) });
  const errors = await openApp(page, '#/today');
  // nothing between the bar and the page may turn position:fixed into position-relative-to-a-box
  expect(await page.evaluate(() => { const out = []; for (let p = document.getElementById('navbar').parentElement; p; p = p.parentElement) { const s = getComputedStyle(p);
    if (s.transform !== 'none' || s.filter !== 'none' || (s.contain || '').match(/paint|layout|strict|content/) || s.willChange.match(/transform|filter/)) out.push(p.tagName + (p.id ? '#' + p.id : '')); } return out; })).toEqual([]);
  for (const h of ['#/today', '#/builder', '#/teams', '#/matchups', '#/battles', '#/meta', '#/rank', '#/raids', '#/roster', '#/invest', '#/mon/azumarill', '#/pro']) {
    await page.evaluate(x => Planner.nav(x), h);
    for (const y of [0, 600, 1e6]) {
      await page.evaluate(v => window.scrollTo(0, v), y);
      const b = await navBox(page);
      expect(b.shown, `${h} at ${y}`).toBe(true);
      expect(Math.abs(b.bottom - b.vh), `${h} at ${y}: bar bottom ${b.bottom} vs screen ${b.vh}`).toBeLessThanOrEqual(1);
    }
  }
  expect(errors).toEqual([]);
});

// iOS 26 Safari misplaces bottom-fixed elements while its toolbar moves; on iPhone the bar follows the visual viewport instead.
test.describe('on an iPhone', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' });
  test('the bar follows the visible part of the page and steps aside for the keyboard', async ({ page }) => {
    const errors = await openApp(page, '#/today');
    // where Safari says the visible part of the page is, the bar's bottom edge goes
    await page.evaluate(() => pinNav({ offsetTop: 0, height: 844 }));
    expect((await navBox(page)).bottom).toBe(844);
    await page.evaluate(() => pinNav({ offsetTop: 120, height: 700 }));         // toolbar mid-animation: the visible part is shifted
    let b = await navBox(page); expect(b.bottom).toBe(820); expect(b.shown).toBe(true);
    // the keyboard takes the bottom of the screen: the bar hides instead of covering the field, and comes back after
    await page.evaluate(() => pinNav({ offsetTop: 0, height: 480 }));
    expect((await navBox(page)).shown).toBe(false);
    await page.evaluate(() => pinNav({ offsetTop: 0, height: 844 }));
    b = await navBox(page); expect(b.shown).toBe(true); expect(b.bottom).toBe(844);
    // the real event path is wired up: a scroll repositions it from visualViewport
    await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(100);
    b = await navBox(page); expect(Math.abs(b.bottom - b.vh)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
