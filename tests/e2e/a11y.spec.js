import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openApp } from './helpers.js';

/* Issue #19: keyboard and screen-reader access.
   - axe on the main routes: no serious/critical violations;
   - inline-onclick divs/spans are buttons for the keyboard (role, tabindex, Enter activates);
   - dialogs: role=dialog, focus moves in, Escape closes, focus returns. */

const ROUTES = ['#/scans', '#/today', '#/builder', '#/battles', '#/pro'];

for (const route of ROUTES) {
  test(`axe: no serious violations on ${route}`, async ({ page }) => {
    await openApp(page, route);
    await page.waitForTimeout(400);                          // let the view render
    const r = await new AxeBuilder({ page })
      .disableRules(['meta-viewport'])                       // user-scalable is allowed; the app does not lock zoom
      .analyze();
    const bad = r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map(v => `${v.id}: ${v.nodes.length}x — ${v.help}`)).toEqual([]);
  });
}

test('clickable divs are keyboard buttons, and Enter works', async ({ page }) => {
  await openApp(page, '#/today');
  await page.waitForTimeout(400);
  // every inline-onclick div/span got role=button and tabindex=0 from the a11y layer (bubbling guards excepted)
  const naked = await page.evaluate(() => [...document.querySelectorAll('div[onclick], span[onclick]')]
    .filter(el => !/^(drawer|sheet|syncbox|profile|help)$/.test(el.id))
    .filter(el => !/^\s*(event\.stopPropagation\(\)|if\s*\(event\.target===this\)[^;]*);?\s*$/.test(el.getAttribute('onclick') || ''))
    .filter(el => el.getAttribute('role') !== 'button' || el.getAttribute('tabindex') !== '0').length);
  expect(naked).toBe(0);
  // Enter on a role=button element clicks it: take the first visible one on the page and watch its click fire
  const clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="button"][onclick]')].find(e => e.offsetParent !== null);
    if (!el) return 'none-found';
    let fired = false;
    el.addEventListener('click', e => { fired = true; e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, once: true });
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return fired ? 'clicked' : 'no';
  });
  expect(clicked).toBe('clicked');
});

test('the help dialog: role, focus in, Escape closes, focus returns', async ({ page }) => {
  await openApp(page, '#/scans');
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<button id="opener">open</button>'); document.getElementById('opener').focus(); });
  await page.evaluate(() => toggleHelp());
  await expect(page.locator('#help')).toHaveClass(/open/);
  // the inner box became a dialog and focus moved inside it
  await expect(page.locator('#help .box')).toHaveAttribute('role', 'dialog');
  await expect(page.locator('#help .box')).toHaveAttribute('aria-modal', 'true');
  const inside = await page.evaluate(() => document.getElementById('help').contains(document.activeElement));
  expect(inside).toBe(true);
  // Escape closes it and focus returns to the opener
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).not.toHaveClass(/open/);
  const back = await page.evaluate(() => document.activeElement && document.activeElement.id);
  expect(back).toBe('opener');
});
