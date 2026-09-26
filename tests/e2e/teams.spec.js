import { test, expect } from '@playwright/test';
import { openApp, importFile } from './helpers.js';

/* The resources a status screen shows (stardust, the family's candy and XL) are read, with the user's real Meditite
   screenshot: the icons next to the numbers used to come out as extra digits. */
test('a status screen gives your stardust and that family\'s candy and XL', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('roster'));
  await openApp(page, '#/roster');
  await importFile(page, 'meditite-attacks.png');
  expect(await page.evaluate(() => Planner.ROSTER.have)).toMatchObject({ dust: { v: 99340 }, fam: { MEDITITE: { candy: 45, xl: 13 } } });
  await importFile(page, 'stun-status.png');
  expect(await page.evaluate(() => Planner.ROSTER.have)).toMatchObject({ dust: { v: 417289 }, fam: { MEDITITE: { candy: 45, xl: 13 }, STUNFISK: { candy: 79, xl: 7 } } });
  await importFile(page, 'mimikyu-status.png');   // a single-digit candy count and XL next to a grey candy icon
  expect(await page.evaluate(() => Planner.ROSTER.have)).toMatchObject({ dust: { v: 411829 }, fam: { MIMIKYU: { candy: 1, xl: 5 }, STUNFISK: { candy: 79, xl: 7 } } });
});

/* Saved teams sorts what you can run by what it still costs: Ready now (at the cap with the right moves), Affordable
   (the power-ups fit your stardust and candy), All. A trio that needs more candy than you have says how much. */
test('Saved teams: ready now, affordable and all, with what each team still needs', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.removeItem('tfilt'); });
  await openApp(page, '#/teams');
  const lick = await page.evaluate(() => {
    const mk = (sp, id, low) => { const b = DATA.stats[sp][0], rk = pvpRank(b, 0, 15, 15, 1500), lv = low ? 15 : rk.lv, m = cpmAt(lv);
      const r = { species: sp, cp: calcCP(b, 0, 15, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 0, 15, 15, b]], appraisal: [0, 15, 15], txt: '', cpCandidates: [],
        moves: APP.pokemon[id].moveset.slice(), secondMove: true, movesSeen: Date.now() }; r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; return r; };
    results.length = 0;
    results.push(mk('AZUMARILL', 'azumarill'), mk('ALTARIA', 'altaria'), mk('MEDICHAM', 'medicham'), mk('LICKILICKY', 'lickilicky', true));
    save();
    Planner.ROSTER.have = { dust: { v: 5000000, t: Date.now() }, fam: { MARILL: { candy: 500, xl: 500 }, SWABLU: { candy: 500, xl: 500 }, MEDITITE: { candy: 500, xl: 500 }, LICKITUNG: { candy: 3, xl: 0 } } };
    Planner.refresh(); return Planner.nameOf('lickilicky');
  });
  const teams = page.locator('#teams');
  await expect(teams).toContainText('Best you can run');
  await expect(teams).not.toContainText('Second team');
  expect(await teams.locator('#hdust').inputValue()).toBe('5000000');
  // Affordable (the default): the Lickilicky trios need more candy than there is, so they are not what you can run
  await expect(teams.locator('.tchips .chip.sel')).toContainText('Affordable');
  const first = teams.locator('.team.row').first();
  await expect(first).not.toContainText(lick);
  await expect(first).not.toContainText('short:');
  // …and they are what is worth building next, with how much candy is missing
  await expect(teams).toContainText('Worth building next');
  await expect(teams).toContainText(new RegExp(`short: ${lick} \\d+ more candy`));
  // Ready now: everything shown is at the cap with its moves
  await teams.locator('.tchips .chip:has-text("Ready now")').click();
  await expect(teams.locator('.team.row').first()).toContainText('ready now');
  // All: the Lickilicky trios are listed, with what they cost and what is short
  await teams.locator('.tchips .chip:has-text("All")').click();
  await expect(teams).toContainText(new RegExp(`${lick} L15 → [\\d.]+`));
  // with the candy typed in by hand it becomes affordable
  await page.evaluate(() => Planner.setHave('LICKITUNG', 'candy', '999'));
  await page.evaluate(() => Planner.setHave('LICKITUNG', 'xl', '999'));
  await teams.locator('.tchips .chip:has-text("Affordable")').click();
  await expect(teams).not.toContainText('short:');
  expect(await page.evaluate(() => localStorage.getItem('tfilt'))).toBe('afford');
});

/* Candy nobody has read is not affordable: a trio whose power-ups need it is listed as unknown, not as runnable */
test('a trio whose candy is not known is not affordable', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.removeItem('tfilt'); });
  await openApp(page, '#/teams');
  await page.evaluate(() => {
    const mk = (sp, id, lv) => { const b = DATA.stats[sp][0], m = cpmAt(lv); const r = { species: sp, cp: calcCP(b, 0, 15, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 0, 15, 15, b]], appraisal: [0, 15, 15], txt: '', cpCandidates: [], moves: APP.pokemon[id].moveset.slice(), secondMove: true, movesSeen: Date.now() }; r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; return r; };
    results.length = 0; results.push(mk('AZUMARILL', 'azumarill', 15), mk('ALTARIA', 'altaria', 15), mk('MEDICHAM', 'medicham', 15)); save();
    Planner.ROSTER.have = {}; Planner.refresh();
  });
  const teams = page.locator('#teams');
  await expect(teams.locator('.tchips .chip.sel')).toHaveText(/Affordable\s*0/);
  await expect(teams).toContainText('No trio is affordable on what the app knows');
  await expect(teams).toContainText('The best you can build');
  await expect(teams.locator('.work .unk').first()).toContainText('candy');
  await expect(teams.locator('.work .unk').first()).toContainText('not known');
  // with the candy and stardust known and enough, the same trio is affordable
  await page.evaluate(() => { for (const k of ['MARILL', 'SWABLU', 'MEDITITE']) { Planner.setHave(k, 'candy', '999'); Planner.setHave(k, 'xl', '999'); } Planner.setHave(null, 'dust', '9000000'); });
  await expect(teams.locator('.tchips .chip.sel')).toHaveText(/Affordable\s*1/);
  await expect(teams.locator('.team.row').first()).toContainText('you have it');
});
