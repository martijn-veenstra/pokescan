import { test, expect } from '@playwright/test';
import { openApp, importFile } from './helpers.js';

/* "Update this Pokémon" with the user's real screenshots of a Meditite (5/13/12, 173 CP, 48 HP, L10): an appraisal, and
   a status screen scrolled down to the attacks, so the CP is off screen, the name and HP sit high up, and "MEDICHAM MEGA
   ENERGY" is on the card. The attacks used to be dropped as "MEDICHAM cp[] hp? → CP not read, no card". */
test('a scrolled status screen of the card being updated attaches its attacks to that card', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  const errors = await openApp(page, '#/roster');
  const key = await page.evaluate(() => {
    const b = DATA.stats['MEDITITE'][0], lv = 10, m = cpmAt(lv), r = { species: 'MEDITITE', cp: calcCP(b, 5, 13, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 13, 12, b]], appraisal: [5, 13, 12], txt: '', cpCandidates: [] };
    r.key = `MEDITITE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh(); return r.key;
  });
  expect(key).toBe('MEDITITE|173|48|10|');
  await page.evaluate(k => Planner.openScan(k), key);
  await page.evaluate(k => Planner.updateScan(k, 'mon'), key);
  await importFile(page, 'meditite-attacks.png');
  const got = await page.evaluate(() => results.map(r => ({ species: r.species, cp: r.cp, moves: r.moves || null })));
  expect(got).toHaveLength(1);
  expect(got[0].species).toBe('MEDITITE');
  expect(got[0].moves).toEqual(['CONFUSION', 'PSYSHOCK']);                 // not the type label "FIGHTING / PSYCHIC" as a third move
  // the page shows them, although Great League does not rank Meditite: moves, usage and the unlock cost come from Little League
  await page.evaluate(k => Planner.openScan(k), key);
  const mon = page.locator('#mon');
  await expect(mon).toContainText('Moves by meta usage');
  await expect(mon).toContainText('in Little League');
  const sels = mon.locator('.scanhero select.mvsel');
  await expect(sels).toHaveCount(3);
  expect(await sels.nth(0).evaluate(el => el.value)).toBe('CONFUSION');
  expect(await sels.nth(1).evaluate(el => el.value)).toBe('PSYSHOCK');
  await expect(mon.locator('.scanhero')).toContainText(/locked[\s\S]*50\.000 dust · 50 candy/);
  // the Update button sits right under the three move boxes, and the card carries no long explanations
  expect(await mon.locator('.scanhero').evaluate(h => { const v = [...h.querySelectorAll('.kv > .v')], i = v.findIndex(x => x.querySelector('select.mvsel')); return v[i + 3] && !!v[i + 3].querySelector('button.btn.upd'); })).toBe(true);
  await expect(mon.locator('.scanhero button.btn.upd')).toHaveCount(1);
  await expect(mon.locator('.scanhero')).not.toContainText(/Teams are scored with|Correct a misread if this one is|scan the attacks to compare|this card is updated, no second card/);
  await expect(mon.locator('.scanhero')).toContainText(/Best moves\s*Little League/);
  expect(await mon.locator('.use .ur').count()).toBeGreaterThan(2);
  // the page an unranked species gets is a full one: its icon, the PvP / Raids tabs, the roster card, the raid page
  expect(await mon.locator('.scanhero .dh img.pi').first().getAttribute('src')).toMatch(/meditite\.webp$/);
  await expect(mon.locator('.montabs')).toHaveCount(1);
  const roster = mon.locator('.sec:has-text("In your roster") + .team.card');
  await expect(roster).toContainText('Meditite candy');
  await expect(roster.locator('code')).toContainText('meditite');
  await mon.locator('.montabs button:has-text("Raids")').click();
  await expect(mon).toContainText('As a raid attacker', { timeout: 30000 });
  await expect(mon).toContainText('Raid moves');
  await mon.locator('.montabs button:has-text("PvP")').click();
  await expect(mon).toContainText('Moves by meta usage');
  // the appraisal screenshot of the same Pokémon folds into the same card too
  await page.evaluate(k => Planner.updateScan(k, 'mon'), key);
  await importFile(page, 'meditite-appr.png');
  expect(await page.evaluate(() => results.length)).toBe(1);
  expect(await page.evaluate(() => results[0].appraisal)).toEqual([5, 13, 12]);
  expect(errors).toEqual([]);
});

/* Without the update from a card's page: the same scrolled screenshot is still read as a Meditite, not as the Medicham
   whose Mega Energy is listed on it, and the attacks land on the one Meditite card there is. */
test('the Mega Energy line is not taken for the Pokémon name', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  await openApp(page, '#/roster');
  await page.evaluate(() => {
    const b = DATA.stats['MEDITITE'][0], lv = 10, m = cpmAt(lv), r = { species: 'MEDITITE', cp: calcCP(b, 5, 13, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 13, 12, b]], appraisal: [5, 13, 12], txt: '', cpCandidates: [] };
    r.key = `MEDITITE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh();
  });
  await importFile(page, 'meditite-attacks.png');
  const log = await page.locator('#pevl').innerText().catch(() => '');
  expect(log).not.toMatch(/MEDICHAM cp/);
  expect(await page.evaluate(() => results.length)).toBe(1);
  expect(await page.evaluate(() => results[0].moves || [])).toEqual(['CONFUSION', 'PSYSHOCK']);
});

/* Both in one import, as the user did it, and in the league they plan for (Retro Cup, where Meditite is not ranked either) */
test('the appraisal and the scrolled status screen in one import, in Retro Cup', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.setItem('league', 'retro-1500'); });
  await openApp(page, '#/roster');
  await page.evaluate(() => { const b = DATA.stats['MEDITITE'][0], lv = 10, m = cpmAt(lv), r = { species: 'MEDITITE', cp: calcCP(b, 5, 13, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 13, 12, b]], appraisal: [5, 13, 12], txt: '', cpCandidates: [] }; r.key = `MEDITITE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh(); });
  await page.setInputFiles('#file', ['tests/fixtures/meditite-appr.png', 'tests/fixtures/meditite-attacks.png']);
  await page.waitForFunction(() => /^Done/.test(document.getElementById('stat').textContent), null, { timeout: 180000 });
  expect(await page.evaluate(() => results.map(r => [r.species, r.cp, r.moves]))).toEqual([['MEDITITE', 173, ['CONFUSION', 'PSYSHOCK']]]);
});

/* "Update this Pokémon" with the user's status screenshot of a Lickilicky that learned Earthquake: the fast move sits in
   the card region, the charged moves below it. The card used to keep its old Hyper Beam, because a read that found only
   the fast move never looked at the bottom of the screen. */
test('an updated status screen replaces the charged moves below the card region', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  const errors = await openApp(page, '#/roster');
  const key = await page.evaluate(() => {
    const b = DATA.stats['LICKILICKY'][0];
    for (let lv = 1; lv <= 50; lv += 0.5) { const m = cpmAt(lv);
      for (let a = 0; a < 16; a++) for (let d = 0; d < 16; d++) for (let s = 0; s < 16; s++) {
        if (calcCP(b, a, d, s, m) !== 1468 || calcHP(b, s, m) !== 159) continue;
        const r = { species: 'LICKILICKY', cp: 1468, hp: 159, level: lv, dust: null, combos: [[lv, a, d, s, b]], txt: '', cpCandidates: [], moves: ['ROLLOUT', 'SHADOW_BALL', 'HYPER_BEAM'] };
        r.key = `LICKILICKY|1468|159|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh(); return r.key;
      } }
    return null;
  });
  expect(key).not.toBeNull();
  await page.evaluate(k => Planner.openScan(k), key);
  await page.evaluate(k => Planner.updateScan(k, 'mon'), key);
  await importFile(page, 'lickilicky-status.png');
  const got = await page.evaluate(() => results.filter(r => !r.superseded).map(r => ({ species: r.species, cp: r.cp, moves: r.moves || null })));
  expect(got).toHaveLength(1);
  expect(got[0].species).toBe('LICKILICKY');
  expect(got[0].moves).toEqual(['ROLLOUT', 'SHADOW_BALL', 'EARTHQUAKE']);
  expect(errors).toEqual([]);
});

/* The user's Porygon: the status screenshot makes the card, "Update with a new scan" with the appraisal screenshot pins its
   IVs. The update used to end on the generic Porygon page ("not owned", "Not in your roster yet"): a pre-evolution whose
   evolution fits the cap is not an owned team member. It now returns to the card, and the species page lists the scan. */
test('updating a pre-evolution card returns to that card; its species page lists the scan', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  const errors = await openApp(page, '#/roster');
  await page.evaluate(() => { results.length = 0; save(); Planner.refresh(); });
  await importFile(page, 'porygon-status.png');
  const card = await page.evaluate(() => results.filter(r => !r.superseded).map(r => ({ key: r.key, species: r.species, cp: r.cp, hp: r.hp, appraisal: r.appraisal || null })));
  expect(card).toHaveLength(1);
  expect(card[0]).toMatchObject({ species: 'PORYGON', cp: 810, hp: 97 });
  await page.evaluate(k => Planner.openScan(k), card[0].key);
  await expect(page.locator('#mon button:has-text("Update with a new scan")').first()).toBeVisible();
  await page.evaluate(k => Planner.updateScan(k, 'mon'), card[0].key);
  await importFile(page, 'porygon-appraisal.png');
  const after = await page.evaluate(() => results.filter(r => !r.superseded).map(r => ({ key: r.key, cp: r.cp, appraisal: r.appraisal || null })));
  expect(after).toHaveLength(1);
  expect(after[0].appraisal).toEqual([4, 14, 9]);
  await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toBe('#/scan/' + after[0].key);   // back on the card
  await expect(page.locator('#mon .scanhero')).toContainText('810');
  await expect(page.locator('#mon')).not.toContainText('Not in your roster yet');
  // the species page knows the scan
  await page.evaluate(() => Planner.openMon('porygon'));
  const mon = page.locator('#mon');
  await expect(mon).not.toContainText('Not in your roster yet');
  await expect(mon.locator('.monhead .chips')).not.toContainText('not owned');
  await expect(mon.locator('.yourscans')).toContainText(/Your Porygon[\s\S]*810 CP · L18 · 4\/14\/9/);
  await mon.locator('.yourscans .team.row').first().click();
  await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toBe('#/scan/' + after[0].key);
  expect(errors).toEqual([]);
});
