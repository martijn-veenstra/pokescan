import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const ROSTER = parties => JSON.stringify({ tagged: parties, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] });
const fight = (id, result, team, ids, lead, opp, ago) => ({ id, t: Date.now() - ago * 60000, league: 'great', result, src: 'share', team, ids, lead, opp });

test('Game plan: meta rank, leads, record and the teams you met, from the battle log', async ({ page }) => {
  await page.addInitScript(([r, b]) => { if (!sessionStorage.seeded) { localStorage.setItem('roster', r); localStorage.setItem('battles', b); sessionStorage.seeded = 1; } }, [
    ROSTER({ Rain: ['azumarill', 'medicham', 'altaria'], Steel: ['registeel', 'swampert', 'lickilicky'] }),
    JSON.stringify([
      fight('g1', 'L', 'Rain', ['azumarill', 'medicham', 'altaria'], 'tinkaton', ['tinkaton', 'cramorant', 'clodsire'], 30),
      fight('g2', 'L', 'Rain', ['azumarill', 'medicham', 'altaria'], 'tinkaton', ['tinkaton', 'corviknight', 'florges'], 20),
      fight('g3', 'W', 'Steel', ['registeel', 'swampert', 'lickilicky'], 'tinkaton', ['tinkaton', 'mimikyu', 'thievul'], 10),
    ]),
  ]);
  const errors = await openApp(page, '#/matchups');
  await expect(page.locator('#view-matchups .ptitle')).toContainText('Game plan');
  // the most played party is picked first
  await expect(page.locator('#matchups .tchips .chip.ok')).toContainText('Rain');
  // 1. against the meta: a score and a rank among the meta teams
  await expect(page.locator('#matchups .hero')).toContainText(/#\d+ of \d+/);
  const [n, of] = (await page.locator('#matchups .gprk b').textContent()).match(/\d+/g).map(Number);
  expect(n).toBeLessThanOrEqual(of);
  await expect(page.locator('#matchups .hero')).toContainText(/Beats \d+ of \d+ common Pokémon/);
  // 2. lead cheat sheet: 12 rows, the lead met three times in the log first
  await expect(page.locator('#matchups .gpl')).toHaveCount(12);
  await expect(page.locator('#matchups .gpl').first()).toContainText('Tinkaton');
  await expect(page.locator('#matchups .gpl').first()).toContainText('×3');
  for (const t of await page.locator('#matchups .gpl .ga b').allTextContents()) expect(t).toMatch(/^(Stay in|Stay, shield once|Swap to .+|Nobody wins)$/);
  // 5. a row opens the shield table
  await page.locator('#matchups .gpl').first().click();
  await expect(page.locator('#matchups .gpleads .mut .mn')).toHaveCount(3);
  await expect(page.locator('#matchups .gpleads .mut .mc')).toHaveCount(9);
  // 3. the record with this team, per lead
  await expect(page.locator('#matchups')).toContainText(/vs Tinkaton lead 0–2/);
  // 4. the teams you met: both parties, played and simulated
  await expect(page.locator('#matchups')).toContainText('3 logged battles with their team read');
  await expect(page.locator('#matchups .gpt')).toHaveCount(2);       // Rain and Steel; the empty Builder is left out
  await expect(page.locator('#matchups .gpt:has-text("Rain")')).toContainText(/sim \d of 3/);
  await expect(page.locator('#matchups .gpt:has-text("Rain")')).toContainText('played 0–2');
  await expect(page.locator('#matchups .gpt:has-text("Steel")')).toContainText('played 1–0');
  await expect(page.locator('#matchups .gpm:has(.chip:text-matches("favoured|even|unfavoured"))')).toHaveCount(3);
  await expect(page.locator('#matchups .gpm:has-text("lost")')).toHaveCount(2);
  await expect(page.locator('#matchups .gpm:has-text("other team")')).toHaveCount(1);
  // switching team from the ranking
  await page.locator('#matchups .gpt:has-text("Steel")').click();
  await expect(page.locator('#matchups .tchips .chip.ok')).toContainText('Steel');
  await expect(page.locator('#matchups')).toContainText(/vs Tinkaton lead 1–0/);
  expect(errors).toEqual([]);
});

test('Game plan: no battles logged, and a party member the cup does not allow', async ({ page }) => {
  await page.addInitScript(r => { if (!sessionStorage.seeded) { localStorage.setItem('roster', r); localStorage.setItem('battles', '[]'); sessionStorage.seeded = 1; } },
    ROSTER({ Rain: ['azumarill', 'medicham', 'altaria'] }));
  const errors = await openApp(page, '#/matchups');
  await expect(page.locator('#matchups')).toContainText('No battles logged with this team yet');
  await expect(page.locator('#matchups')).toContainText('once their teams are logged');
  // Mega Color Cup does not allow Medicham or Altaria: the page used to crash on them
  await page.evaluate(() => Planner.setLeague('colormega-1500'));
  await expect.poll(() => page.evaluate(() => APP.league.slug)).toBe('colormega-1500');
  await page.evaluate(() => Planner.nav('#/matchups'));
  await expect(page.locator('#matchups')).toContainText(/not allowed in/);
  await expect(page.locator('#matchups')).not.toContainText('hit an error');
  await expect(page.locator('#matchups .hero')).toContainText(/Beats \d+ of \d+/);
  expect(errors).toEqual([]);
});
