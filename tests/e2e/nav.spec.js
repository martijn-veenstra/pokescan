import { test, expect } from '@playwright/test';
import { openApp, view } from './helpers.js';

test('bottom bar, drawer and hash routes', async ({ page }) => {
  const errors = await openApp(page);
  expect((await view(page)).view).toBe('view-today');

  await page.click('#tab-builder');
  await expect.poll(() => view(page)).toEqual({ view: 'view-builder', hash: '#/builder', bar: 'tab-builder' });
  expect(await page.locator('#builder .role.slot').count()).toBe(3);

  await page.click('#tab-roster');
  await expect.poll(() => view(page)).toEqual({ view: 'view-roster', hash: '#/roster', bar: 'tab-roster' });

  await page.click('#menubtn');
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  const items = await page.locator('#dr a').evaluateAll(els => els.map(e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()));
  expect(items).toEqual(expect.arrayContaining(['Today', 'Builder', 'Saved teams', 'Meta teams', 'Rankings', 'Raids', 'Roster', 'Scans & import', 'Trainer profile', 'Help & glossary']));
  await expect(page.locator('#dr a.on').first(), 'current page highlighted (the league entry is highlighted too)').toHaveText(/Roster/);

  await page.click('#dr a[href="#/rank"]');
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  await expect.poll(() => view(page)).toEqual({ view: 'view-rank', hash: '#/rank', bar: '' });
  expect(await page.locator('#rank .rank').count()).toBeGreaterThan(20);

  await page.evaluate(() => Planner.openMon('azumarill'));
  await expect.poll(() => view(page)).toMatchObject({ view: 'view-mon', hash: '#/mon/azumarill' });
  await expect(page.locator('#mon .back')).toHaveText(/Rankings/);
  await page.click('#mon .back');
  await expect.poll(() => view(page)).toMatchObject({ view: 'view-rank', hash: '#/rank' });

  await page.evaluate(() => Planner.openTeam(['azumarill', 'medicham', 'altaria']));
  await expect.poll(() => view(page)).toMatchObject({ view: 'view-team', hash: '#/team/azumarill+medicham+altaria' });
  await expect(page.locator('#team')).toContainText('Azumarill / Medicham / Altaria');

  await page.evaluate(() => Planner.goBuilder(['azumarill', 'medicham', 'altaria']));
  await expect.poll(() => view(page)).toMatchObject({ view: 'view-builder', hash: '#/builder' });
  expect(await page.evaluate(() => JSON.parse(localStorage.build).slots)).toEqual(['azumarill', 'medicham', 'altaria']);
  expect(errors).toEqual([]);
});

test('deep link to a Pokémon page and Back falls back to Today', async ({ page }) => {
  const errors = await openApp(page, '#/mon/azumarill');
  await expect(page.locator('#view-mon')).toHaveClass(/on/);
  await expect(page.locator('#mon')).toContainText('Azumarill');
  await page.click('#mon .back');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/today');
  expect(errors).toEqual([]);
});
