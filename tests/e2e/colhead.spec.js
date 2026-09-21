import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('page titles: every top-level page names itself', async ({ page }) => {
  const errors = await openApp(page);
  const titles = {
    today: 'Today', builder: 'Builder', teams: 'Saved teams', roster: 'Roster', scans: 'Scans & import',
    meta: 'Meta teams', rank: 'Rankings', raids: 'Raids', matchups: 'Matchups', battles: 'Battle log', pro: 'PokeScan Pro',
  };
  for (const [k, title] of Object.entries(titles)) {
    await page.evaluate(h => Planner.nav(h), '#/' + k);
    const t = page.locator(`#view-${k} .ptitle`);
    await expect(t, k).toBeVisible();
    expect((await t.evaluate(el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim())), k).toBe(title);
  }
  // exactly one title is on screen at a time, and the Pro hero no longer prints the name twice
  expect(await page.locator('.view.on .ptitle').count()).toBe(1);
  expect(await page.locator('#pro .eyebrow').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('column headers: labels over each column, with the explanation behind the ⓘ', async ({ page }) => {
  const errors = await openApp(page, '#/teams');
  // three Great League pieces, so the page actually has a team list to head
  await page.evaluate(() => { results.length = 0;
    for (const sp of ['AZUMARILL', 'MEDICHAM', 'ALTARIA']) { const b = DATA.stats[sp][0], lv = 20, m = cpmAt(lv);
      const r = { species: sp, cp: calcCP(b, 10, 14, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 10, 14, 15, b]], appraisal: [10, 14, 15], txt: '', cpCandidates: [] };
      r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; results.push(r); }
    save(); render(); Planner.refresh(); });
  const head = page.locator('#teams .colhead').first();
  await expect(head).toBeVisible();
  expect(await head.locator('.ch').allTextContents()).toEqual(['Scoreⓘ', 'Lineupⓘ', 'Teamⓘ']);
  const help = head.locator('.chx');
  await expect(help).toBeHidden();
  await head.locator('.ch.c1 .chq').click();                  // Score
  await expect(help).toContainText(/0–1000/);
  await head.locator('.ch.c2 .chq').click();                  // opening another column replaces it
  await expect(help).toContainText(/green ring/);
  await head.locator('.ch.c2 .chq').click();                  // tapping the open one closes it
  await expect(help).toBeHidden();

  // the header inflates no row count anywhere
  await page.evaluate(() => Planner.nav('#/meta'));
  await expect(page.locator('#meta .team.row')).toHaveCount(40);
  await expect(page.locator('#meta .colhead .ch').first()).toHaveText(/^#/);
  await page.evaluate(() => Planner.nav('#/rank'));
  expect(await page.locator('#rank .rank').count()).toBeGreaterThan(20);
  expect(await page.locator('#rank .colhead .ch').allTextContents()).toEqual(['#ⓘ', 'Pokémonⓘ']);
  await page.evaluate(() => Planner.nav('#/raids'));
  await expect(page.locator('#raids .colhead').last().locator('.ch.ce')).toContainText('DPS · TDO');
  expect(errors).toEqual([]);
});

test('Best IVs: each column of the table explains itself, in place of the footer note', async ({ page }) => {
  const errors = await openApp(page, '#/mon/clefable');
  await page.locator('#mon .ivc').click();
  const th = page.locator('#mon .ivt thead th');
  await expect(th).toHaveCount(5);
  await expect(page.locator('#mon .ivw .chx')).toBeHidden();
  await th.nth(1).locator('.chq').click();                    // IVs
  await expect(page.locator('#mon .ivw .chx')).toContainText(/Attack \/ Defence \/ HP/);
  await expect(page.locator('#mon .ivt tbody .chx')).toHaveCount(0);   // the line lives after the table, not inside it
  await expect(page.locator('#mon')).not.toContainText('Of 4,096 possible spreads.');
  // still ten spreads, in the same column order
  const rows = page.locator('#mon .ivt tbody tr:not([hidden]):not(.xmore-row):not(.sep)');
  await expect(rows).toHaveCount(10);
  await expect(rows.first().locator('td').first()).toHaveText('#1');
  expect(errors).toEqual([]);
});
