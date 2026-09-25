import { test, expect } from '@playwright/test';
import { openApp, importFile } from './helpers.js';

test('a scanned pre-evolution that PvPoke does not rank shows on the roster under its own name', async ({ page }) => {
  const errors = await openApp(page, '#/scans');
  // a Jigglypuff at L6: unranked in Great League itself, but it evolves into a legal Wigglytuff
  await page.evaluate(() => { const b = DATA.stats['JIGGLYPUFF'][0], lv = 6, m = cpmAt(lv); const r = { species: 'JIGGLYPUFF', cp: calcCP(b, 3, 12, 9, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 3, 12, 9, b]], appraisal: [3, 12, 9], txt: '', cpCandidates: [] }; r.key = `JIGGLYPUFF|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); render(); Planner.refresh(); });
  await expect(page.locator('#board .mon').first()).toContainText(/Jigglypuff[\s\S]*evolve → Wigglytuff/);
  await page.evaluate(() => Planner.nav('#/roster'));
  const board = page.locator('#board');
  await expect(board).toContainText('1 pending');
  // the roster shows the scanned Jigglypuff itself (one card, the same as under Scans), not a ghost Wigglytuff
  await expect(board.locator('.mon .name:has-text("Jigglypuff")')).toHaveCount(1);
  await expect(board.locator('.mon.ghost')).toHaveCount(0);
  await expect(board).toContainText(/evolve → Wigglytuff #\d+/);
  // searching by either name finds it
  // (the search hides and shows the cards already on the page instead of re-rendering them, so the box keeps focus)
  await page.fill('#rosterq', 'Jig');
  await expect(board.locator('.mon .name:has-text("Jigglypuff")')).toBeVisible();
  await page.fill('#rosterq', 'wiggly');
  await expect(board.locator('.mon .name:has-text("Jigglypuff")')).toBeVisible();
  await page.fill('#rosterq', 'azumarill');
  await expect(board.locator('.mon .name:has-text("Jigglypuff")')).toBeHidden();
  await expect(board.locator('#rosternone')).toBeVisible();
  await expect(board).toContainText('Nothing in your roster matches.');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('rosterq');
  // tapping the card opens the Jigglypuff's own page, not the page of the Wigglytuff it stands in for (that sent a
  // Meditite to a "Medicham · not in your roster yet" page)
  await page.fill('#rosterq', '');
  await board.locator('.mon .name:has-text("Jigglypuff")').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/scan\/JIGGLYPUFF/);
  await expect(page.locator('#mon .scanhero')).toContainText('Jigglypuff');
  await expect(page.locator('#mon .team.evot')).toContainText('Wigglytuff');
  await expect(page.locator('#mon .monhead .back')).toContainText('Roster');
  expect(errors).toEqual([]);
});

/* Scans & import is part of the Roster: one list with every scan, and one page per scanned Pokémon */
test('the roster holds every scan: import button, spare copies, archive, favourites, sorting, one detail page', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.removeItem('rsort'); });
  const errors = await openApp(page, '#/scans');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/scans');
  await expect(page.locator('#view-roster')).toBeVisible();
  await expect(page.locator('#view-roster > button.btn')).toContainText('Import scans');
  await page.evaluate(() => {
    const mk = (sp, a, d, s, lv, extra) => { const b = DATA.stats[sp][0], m = cpmAt(lv); const r = Object.assign({ species: sp, cp: calcCP(b, a, d, s, m), hp: calcHP(b, s, m), level: lv, dust: null, combos: [[lv, a, d, s, b]], appraisal: [a, d, s], txt: '', cpCandidates: [] }, extra || {}); r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; return r; };
    results.length = 0;
    results.push(mk('AZUMARILL', 8, 15, 15, 38), mk('AZUMARILL', 15, 15, 15, 20, { fav: true }), mk('MEDICHAM', 15, 15, 15, 40, { superseded: { why: 'archived by hand', t: 1 } }));
    save(); Planner.refresh();
  });
  const board = page.locator('#board');
  await expect(board.locator('.mon')).toHaveCount(2);                     // the archived Medicham is not listed
  await expect(board).toContainText('1 other scans');
  await expect(board).toContainText('spare copy');
  await expect(board.locator('#count')).toHaveText('2 scanned');
  await board.locator('.chip:has-text("archived")').click();
  await expect(board.locator('.mon')).toHaveCount(1);
  await expect(board.locator('.mon')).toContainText('Medicham');
  await board.locator('.chip:has-text("favourite")').click();
  await expect(board.locator('.mon')).toHaveCount(1);
  await expect(board.locator('.mon')).toContainText('15/15/15');
  await board.locator('.chip:has-text("✕ all")').click();
  // Roster order puts the copy the roster plays (the better Great League rank) first; Best IV% sorts the scans themselves
  await expect(board.locator('.mon').first()).toContainText('8/15/15');
  await page.selectOption('#rsort', 'pct');
  await expect(board.locator('.mon').first()).toContainText('15/15/15');
  expect(await page.evaluate(() => localStorage.getItem('rsort'))).toBe('pct');
  await page.selectOption('#rsort', '');
  // a Pokémon you scanned has one page: the species link lands on the best copy's page, which carries the roster bits too
  const best = await page.evaluate(() => results[0].key);
  await page.evaluate(() => Planner.openMon('azumarill'));
  await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toBe('#/scan/' + best);
  await expect(page.locator('#mon')).toContainText('In your roster');
  await expect(page.locator('#mon')).toContainText('Best IVs for');
  expect(errors).toEqual([]);
});

/* A scanned copy's page has one head: the species' types, weaknesses and meta rank sit in the scan's card, one ⋮ menu
   holds both the scan's and the species' items, and the tabs (PvP, Raids) carry the move lists in cards of their own. */
test('a scan page has one head, one menu, and the move lists in the PvP and Raids tabs', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.setItem('league', 'great'); });
  const errors = await openApp(page, '#/roster');
  const key = await page.evaluate(() => {
    const b = DATA.stats['RHYPERIOR'][0], lv = 30, m = cpmAt(lv); const r = { species: 'RHYPERIOR', cp: calcCP(b, 10, 10, 10, m), hp: calcHP(b, 10, m), level: lv, dust: null, combos: [[lv, 10, 10, 10, b]], appraisal: [10, 10, 10], txt: '', cpCandidates: [], moves: ['MUD_SLAP', 'SUPER_POWER'], movesSeen: true };
    r.key = `RHYPERIOR|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh(); return r.key; });
  await page.evaluate(() => Planner.monTab('pvp'));
  await page.evaluate(k => Planner.openScan(k), key);
  const mon = page.locator('#mon');
  await expect(mon.locator('.scanhero')).toContainText('Rhyperior');
  await expect(mon.locator('.scanhero .typerow').first()).toContainText(/ground[\s\S]*rock/);
  await expect(mon.locator('.scanhero .metar')).toContainText(/meta #\d+/);
  await expect(mon.locator('.scanhero')).toContainText(/weak to[\s\S]*water/);
  await expect(mon.locator('.detail .dh')).toHaveCount(0);                // no second head card
  await expect(mon).not.toContainText('in the meta');
  await expect(mon.locator('.ctx .dots')).toHaveCount(1);                 // one ⋮ menu
  const items = await mon.locator('.monhead .ctx .menu button').allInnerTexts();
  expect(items).toEqual(expect.arrayContaining(['Mark as Shadow', 'Try in builder', 'Add to wanted']));
  expect(items).not.toContain('I own one (no scan)');
  expect(items[items.length - 1]).toBe('Delete scan');
  // PvP: the meta-usage table is open in its own card, the raid list is not here
  await expect(mon.locator('.montabs button')).toHaveText(['PvP', 'Raids']);
  await expect(mon).toContainText('Moves by meta usage');
  expect(await mon.locator('.use .ur').count()).toBeGreaterThan(2);
  await expect(mon).not.toContainText('Raid moves by damage');
  // Raids: the raid moves card, with the scan's own moves ticked
  await mon.locator('.montabs button:has-text("Raids")').click();
  await expect(mon).toContainText('Raid moves');
  await expect(mon).not.toContainText('Moves by meta usage');
  await page.evaluate(() => Planner.monTab('pvp'));
  expect(errors).toEqual([]);
});

/* "Newest first": a card an import just created or changed comes first; cards from before the timestamp keep list
   order, where the importer puts new cards at the front (the sort used to read that backwards). */
test('Newest first shows the card just imported, and a card an import just changed, on top', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.setItem('rsort', 'new'); });
  const errors = await openApp(page, '#/roster');
  await page.evaluate(() => {
    const mk = (sp, a, d, s, lv) => { const b = DATA.stats[sp][0], m = cpmAt(lv); const r = { species: sp, cp: calcCP(b, a, d, s, m), hp: calcHP(b, s, m), level: lv, dust: null, combos: [[lv, a, d, s, b]], appraisal: [a, d, s], txt: '', cpCandidates: [] }; r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; return r; };
    results.length = 0; results.push(mk('AZUMARILL', 8, 15, 15, 38), mk('MEDICHAM', 15, 15, 15, 20)); save(); Planner.refresh();   // front of the list = newer
  });
  const names = async () => (await page.locator('#board .mon .name').allInnerTexts()).map(t => t.replace(/[☆★\s]+/g, ''));
  await expect.poll(names).toEqual(['Azumarill', 'Medicham']);
  await importFile(page, 'stun-status.png');
  await expect.poll(async () => (await names())[0]).toContain('Stunfisk');
  // an import that changes an older card (here: its moves) moves it to the top
  await page.evaluate(() => { const r = results.find(x => x.species === 'MEDICHAM'); applyMoves(r, { id: 'medicham', fast: 'COUNTER', charged: ['ICE_PUNCH'], second: false }); save(); render(); });
  await expect.poll(async () => (await names())[0]).toContain('Medicham');
  expect(errors).toEqual([]);
});
