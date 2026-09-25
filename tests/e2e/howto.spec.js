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

test('Umbreon and Gallade: the evolution conditions from the game master, in plain words', async ({ page }) => {
  const errors = await openApp(page, '#/mon/umbreon');
  await page.evaluate(() => { results.length = 0; save(); Planner.refresh(); });
  await page.evaluate(() => Sources.load(true));
  await expect.poll(() => page.evaluate(() => Sources.ready() && !!localStorage.getItem('evo'))).toBe(true);
  await page.evaluate(() => Planner.renderMon());
  const card = page.locator('#mon .sec:has-text("How to get Umbreon") + .avb');
  await expect(card).toContainText('Evolve Eevee → Umbreon');
  await expect(card).toContainText('25 candy');
  await expect(card).toContainText(/Also needed: walk 10 km with it as your buddy · evolve at night/);
  await expect(card).toContainText(/Name it Tamao before evolving/);
  // Gallade: an item and a gender
  await page.evaluate(() => Planner.openMon('gallade'));
  const g = page.locator('#mon .sec:has-text("How to get Gallade") + .avb');
  await expect(g).toContainText('Evolve Kirlia → Gallade');
  await expect(g).toContainText(/Also needed: a Sinnoh Stone · it must be male/);
  // an owned Eevee: Today's "Do next" evolve item carries the short form
  await page.evaluate(() => { const b = DATA.stats['EEVEE'][0], lv = 20, m = cpmAt(lv); const r = { species: 'EEVEE', cp: calcCP(b, 15, 15, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 15, 15, 15, b]], appraisal: [15, 15, 15], txt: '', cpCandidates: [] }; r.key = `EEVEE|${r.cp}|${r.hp}|${lv}|`; results.push(r); save(); render(); Planner.refresh(); });
  const short = await page.evaluate(() => Planner.evoShort(Planner.evoBranch('eevee', 'umbreon')));
  expect(short).toBe('walk 10 km as buddy, evolve at night');
  expect(await page.evaluate(() => Planner.evoShort(Planner.evoBranch('kadabra', 'alakazam')))).toBe('trade first or pay the candy');
  expect(await page.evaluate(() => Planner.evoShort(Planner.evoBranch('eevee', 'vaporeon')))).toBe('');
  expect(errors).toEqual([]);
});

/* A Pokémon that only spawns in the wild used to get "not in raids, eggs, research or announced events right now. Wild
   spawns are not listed" and nothing else, which read as if there were no way to get it at all. */
test('Oranguru: a wild spawn says so, with the weather that boosts it; a legendary says raids and research', async ({ page }) => {
  const errors = await openApp(page, '#/mon/oranguru');
  await page.evaluate(() => { results.length = 0; save(); Planner.refresh(); });
  await page.evaluate(() => Sources.load(true));
  await expect.poll(() => page.evaluate(() => Sources.ready() && !!localStorage.getItem('evo'))).toBe(true);
  await page.evaluate(() => Planner.renderMon());
  const card = page.locator('#mon .sec:has-text("How to get Oranguru") + .avb');
  await expect(card).toContainText('Catch it in the wild');
  await expect(card, 'Normal and Psychic: partly cloudy and windy').toContainText('Partly cloudy and Windy weather');
  await expect(card).toContainText('trade');
  await expect(page.locator('#mon')).not.toContainText('Wild spawns are not listed');
  await page.evaluate(() => Planner.openMon('registeel'));
  const leg = page.locator('#mon .sec:has-text("How to get Registeel") + .avb');
  await expect(leg).toContainText('Raids, research and events');
  await expect(leg).toContainText('Legendary');
  await expect(leg).not.toContainText('Catch it in the wild');
  expect(errors).toEqual([]);
});

/* The app names no other app or site on screen: rankings, matchups, the schedule and the lineups are its own words. */
test('no page names another app or site', async ({ page }) => {
  const errors = await openApp(page, '#/today');
  await page.evaluate(() => Sources.load(true));
  const rx = /pvpoke|leek ?duck|scrapedduck|pokeminers|pokebattler|silph|gamepress|pok[eé] ?genie/i;
  const seen = [];
  for (const h of ['#/today', '#/builder', '#/teams', '#/roster', '#/meta', '#/rank', '#/raids', '#/scans', '#/matchups', '#/battles', '#/pro', '#/mon/oranguru', '#/mon/ninetales_shadow', '#/mon/azumarill']) {
    await page.evaluate(h => Planner.nav(h), h);
    await page.waitForTimeout(300);
    const text = await page.evaluate(() => document.querySelector('.view.on').innerText + ' ' + [...document.querySelectorAll('.view.on a[href]')].map(a => a.href).join(' '));
    const m = text.match(rx); if (m) seen.push(`${h}: ${text.slice(Math.max(0, m.index - 60), m.index + 40)}`);
  }
  // the Raids tab of a species page too (its raid-moves note used to name another app)
  await page.evaluate(() => Planner.monTab('pve'));
  for (const h of ['#/mon/azumarill', '#/mon/oranguru']) {
    await page.evaluate(h => Planner.nav(h), h);
    await expect(page.locator('#mon')).toContainText('Raid moves');
    const text = await page.evaluate(() => document.querySelector('.view.on').innerText);
    const m = text.match(rx); if (m) seen.push(`${h} Raids: ${text.slice(Math.max(0, m.index - 60), m.index + 40)}`);
  }
  await page.evaluate(() => Planner.monTab('pvp'));
  // the help sheet and the menu too
  const help = await page.evaluate(() => document.body.innerText);
  const hm = help.match(rx); if (hm) seen.push(`body: ${help.slice(Math.max(0, hm.index - 60), hm.index + 40)}`);
  expect(seen).toEqual([]);
  expect(errors).toEqual([]);
});
