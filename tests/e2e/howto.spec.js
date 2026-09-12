import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const SOURCES = { t: Date.now(), raids: [{ name: 'Ninetales', tier: '3-Star Raids', canBeShiny: false }], eggs: [{ name: 'Vulpix', eggType: '2 km', canBeShiny: true }], research: [], events: [],
  rocket: { t: Date.now(), lineups: [{ who: 'Fire-type Grunt', type: 'fire', quote: 'Do you know how hot Pokémon fire attacks can get?', encounter: 1, slots: [['Vulpix', 'Growlithe'], ['Ninetales'], ['Arcanine']] }, { who: 'Cliff', type: null, quote: '', encounter: 1, slots: [['Aerodactyl'], ['Vulpix']] }, { who: 'Water-type Grunt', type: 'water', quote: '', slots: [['Marill'], ['Azumarill']] }] } };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/sources*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SOURCES) }));
  await page.route('**/api/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sync: false, sources: true }) }));
  await page.addInitScript(() => { localStorage.removeItem('sources'); localStorage.removeItem('evo'); });
});

test('Ninetales (Shadow): evolve a Shadow Vulpix from Team GO Rocket', async ({ page }) => {
  const errors = await openApp(page, '#/mon/ninetales_shadow');
  await page.evaluate(() => { results.length = 0; save(); Planner.refresh(); Planner.renderMon(); });
  await page.evaluate(() => Sources.load(true));
  await expect.poll(() => page.evaluate(() => Sources.ready())).toBe(true);
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('evo'))).toBe(true);
  await page.evaluate(() => Planner.renderMon());
  const card = page.locator('#mon .sec:has-text("How to get Ninetales (Shadow)") + .avb');
  await expect(card).toContainText('Team GO Rocket');
  await expect(card).toContainText('Fire-type Grunt · slot 1');
  await expect(card).toContainText('Cliff · slot 2');
  await expect(card).toContainText('not catchable');
  await expect(card).toContainText('Evolve Vulpix (Shadow) → Ninetales (Shadow)');
  await expect(card).toContainText('50 candy');
  await expect(card).toContainText('Shadow evolution keeps the Shadow bonus');
  await expect(card).toContainText(/Purifying \(3.000 dust · 3 candy\) makes it the normal form: meta #\d+ instead of #\d+/);
  const order = await card.locator('.rh').allTextContents();
  expect(order[0]).toContain('Team GO Rocket');
  expect(errors).toEqual([]);
});

test('Ninetales: catch it in raids or evolve a Vulpix from eggs', async ({ page }) => {
  const errors = await openApp(page, '#/mon/ninetales');
  await page.evaluate(() => { results.length = 0; save(); Planner.refresh(); });
  await page.evaluate(() => Sources.load(true));
  await expect.poll(() => page.evaluate(() => Sources.ready() && !!localStorage.getItem('evo'))).toBe(true);
  await page.evaluate(() => Planner.renderMon());
  const card = page.locator('#mon .sec:has-text("How to get Ninetales") + .avb');
  await expect(card).toContainText('Catch it');
  await expect(card).toContainText('3-Star Raids');
  await expect(card).toContainText('Evolve Vulpix → Ninetales');
  await expect(card).toContainText('2 km eggs');
  await expect(card).toContainText(/catch one ≤ \d+ CP so it stays under 1500 as Ninetales/);
  await expect(card).not.toContainText('Team GO Rocket');
  await expect(card.locator('code')).toContainText(/vulpix&cp-\d+/);
  expect(errors).toEqual([]);
});
