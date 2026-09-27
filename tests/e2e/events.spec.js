import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/* The Today page lists the events running now and coming up, with their bonuses and Pokémon: a generic event read from its
   page, a Community Day, a Spotlight Hour whose Pokémon feeds a wanted one, raid rotations folded into one entry, the GO
   Battle League week as one line; a city-only safari is left out. */
const iso = h => new Date(Date.now() + h * 3600e3).toISOString();
const SOURCES = { t: Date.now(), raids: [], eggs: [], research: [], rocket: { t: Date.now(), lineups: [] }, events: [
  { eventID: 'harvest', name: 'Harvest Festival: Applin Picking', eventType: 'event', heading: 'Event', image: '', start: iso(-24), end: iso(48),
    extraData: { generic: {}, page: { about: 'The harvest is in: Grass-type Pokémon appear more often and Applin debuts in the wild.', bonuses: ['2× Catch Candy', 'Increased Hatch Stardust'], spawns: [{ name: 'Applin', shiny: true, group: '' }, { name: 'Oddish', shiny: false, group: '' }], raids: [{ name: 'Mega Venusaur', shiny: true, group: 'Mega Raids' }], eggs: [], research: ['Catch 10 Grass-type Pokémon'] } } },
  { eventID: 'r5', name: 'Xurkitree in 5-star Raid Battles', eventType: 'raid-battles', heading: 'Raid Battles', start: iso(-30), end: iso(60), extraData: { raidbattles: { bosses: [{ name: 'Xurkitree', canBeShiny: false }] } } },
  { eventID: 'rm', name: 'Mega Malamar in Mega Raids', eventType: 'raid-battles', heading: 'Raid Battles', start: iso(-30), end: iso(60), extraData: { raidbattles: { bosses: [{ name: 'Mega Malamar', canBeShiny: true }] } } },
  { eventID: 'gbl', name: 'Ultra League and Retro Cup | Twilight Trails', eventType: 'go-battle-league', start: iso(-30), end: iso(60), extraData: { generic: {} } },
  { eventID: 'safari', name: 'Munich, Germany - Pokémon GO City Safari', eventType: 'city-safari', start: iso(-5), end: iso(20), extraData: { generic: {} } },
  { eventID: 'spot', name: 'Marill Spotlight Hour', eventType: 'pokemon-spotlight-hour', heading: 'Pokémon Spotlight Hour', start: iso(72), end: iso(73), extraData: { spotlight: { name: 'Marill', canBeShiny: true, bonus: '2× Transfer Candy', list: [{ name: 'Marill', canBeShiny: true }] } } },
  { eventID: 'cd', name: 'Zorua Community Day', eventType: 'community-day', heading: 'Community Day', start: iso(120), end: iso(123),
    extraData: { communityday: { spawns: [{ name: 'Zorua' }], bonuses: [{ text: '3× Catch XP' }, { text: '3-hour Incense' }] } } },
  { eventID: 'far', name: 'Far Away Fest', eventType: 'event', start: iso(24 * 40), end: iso(24 * 41), extraData: null },
] };

test('Today shows live and upcoming events with their bonuses, Pokémon and what they mean for you', async ({ page }) => {
  await page.route('**/api/sources*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SOURCES) }));
  await page.addInitScript(() => { localStorage.removeItem('sources');
    localStorage.setItem('roster', JSON.stringify({ tagged: {}, candidates: { azumarill: null }, pending: {}, exclude: [], moves: {}, log: [] })); });
  const errors = await openApp(page, '#/today');
  await page.evaluate(() => Sources.load(true));
  await expect.poll(() => page.evaluate(() => Sources.ready())).toBe(true);
  await page.evaluate(() => Planner.renderToday());
  const today = page.locator('#today');
  await expect(today.locator('.sec:has-text("Events")')).toHaveCount(1);
  await expect(today.locator('.evleague')).toContainText('GO Battle League Ultra League and Retro Cup');
  const live = today.locator('details.ev.live');
  await expect(live).toHaveCount(2);                                            // the Harvest Festival and one entry for all live raid rotations
  const harvest = live.filter({ hasText: 'Harvest Festival' });
  await expect(harvest.locator('.evtop .chip.bon')).toHaveText(['2× Catch Candy', 'Increased Hatch Stardust']);
  await expect(harvest).toContainText('Applin ✨');
  await expect(harvest.locator('summary .evabout')).toHaveText('The harvest is in: Grass-type Pokémon appear more often and Applin debuts in the wild.');   // what the event is about, next to its bonuses
  const raids = live.filter({ hasText: 'Raids now' });
  await expect(raids).toContainText('Xurkitree');
  await expect(raids).toContainText('Mega Malamar');
  await expect(raids.locator('summary .evabout')).toHaveText('Raid bosses at gyms now: 1 five-star and 1 Mega.');
  await expect(today).not.toContainText('City Safari');
  await expect(today).not.toContainText('Far Away Fest');                       // beyond two weeks
  const soon = today.locator('details.ev:not(.live)');
  await expect(soon.nth(0)).toContainText('Marill Spotlight Hour');
  await expect(soon.nth(0)).toContainText('2× Transfer Candy');
  await expect(soon.nth(0).locator('.evfor')).toContainText('wanted: Azumarill');   // Marill candy feeds the wanted Azumarill
  await soon.nth(0).locator('summary .nm').click();
  await expect(soon.nth(0).locator('.evbody .evabout')).toHaveText('Marill spawns far more often for one hour, with 2× Transfer Candy.');
  const cd = soon.filter({ hasText: 'Zorua Community Day' });
  await cd.locator('summary .nm').click();
  await expect(cd.locator('.evbody .evabout')).toHaveText('Zorua spawns everywhere for 3 hours, with the bonuses below.');
  await expect(cd.locator('.evbody .chip.bon')).toHaveText(['3× Catch XP', '3-hour Incense']);
  await expect(cd.locator('.evbody')).toContainText('Zorua');
  await harvest.locator('summary .nm').click();
  await expect(harvest.locator('.evbody')).toContainText('Catch 10 Grass-type Pokémon');
  await expect(harvest.locator('.evbody .evgrp')).toContainText('Mega Raids');
  // an open event stays open when Today redraws
  await page.evaluate(() => Planner.renderToday());
  await expect(today.locator('details.ev[data-ev="cd"]')).toHaveAttribute('open', '');
  expect(errors).toEqual([]);
});
