import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('Pokémon icons sit next to names: scan cards, the species page head, rankings, builder slots; unknown ids fall back', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('roster'); localStorage.removeItem('scans'); });
  const errors = await openApp(page, '#/scans');
  await page.evaluate(() => {
    const mk = (sp, lv, shadow) => { const b = DATA.stats[sp][0], m = cpmAt(lv); const r = { species: sp, cp: calcCP(b, 10, 14, 15, m), hp: calcHP(b, 15, m), level: lv, dust: null, combos: [[lv, 10, 14, 15, b]], appraisal: [10, 14, 15], txt: '', cpCandidates: [], shadow: shadow || undefined }; r.key = `${sp}|${r.cp}|${r.hp}|${lv}|${shadow ? 's' : ''}`; return r; };
    results.length = 0; results.push(mk('AZUMARILL', 30), mk('FORRETRESS', 25, true)); save(); render(); Planner.refresh();
  });
  const cards = page.locator('#board .mon');
  await expect(cards.nth(0).locator('img.pi.l')).toHaveAttribute('src', /icons\/pokemon\/(azumarill|forretress_shadow)\.webp$/);
  await expect(page.locator('#board img.pi[src$="forretress_shadow.webp"]')).toHaveCount(1);
  await expect(page.locator('#board img.pi[src$="azumarill.webp"]')).toHaveCount(1);
  // the icon files exist and are served as WebP
  const res = await page.request.get('/icons/pokemon/melmetal.webp');
  expect(res.status()).toBe(200); expect(res.headers()['content-type']).toContain('image/webp');
  // species page head: the largest icon
  await page.evaluate(() => Planner.openMon('melmetal'));
  await expect(page.locator('#mon .detail .dh img.pi.xl')).toHaveAttribute('src', /melmetal\.webp$/);
  // rankings rows and builder slots
  await page.evaluate(() => Planner.nav('#/rank'));
  await expect(page.locator('#rank .rank .rn img.pi.m').first()).toBeVisible();
  await page.evaluate(() => { Planner.setSlot(0, 'azumarill'); Planner.nav('#/builder'); });
  await expect(page.locator('#builder .role.slot img.pi.l[src$="azumarill.webp"]')).toHaveCount(1);
  await expect(page.locator('#builder .role.slot.empty img.pi.ph')).toHaveCount(2);
  // a team row shows the trio
  await page.evaluate(() => Planner.nav('#/meta'));
  await expect(page.locator('#meta .team.row .trio img.pi').first()).toBeVisible();
  expect(await page.locator('#meta .team.row').first().locator('.trio img.pi').count()).toBe(3);
  // an unknown id falls back to the grey Pokéball, and a missing file swaps to it on error
  // (inserted at the top of the page and loaded eagerly: a lazy image off screen never loads, so never errors)
  await page.evaluate(() => { document.body.insertAdjacentHTML('afterbegin', `<div id="pit">${Planner.icon('no_such_pokemon', 's')}${Planner.icon(null, 's')}</div>`); document.querySelectorAll('#pit img').forEach(i => { i.loading = 'eager'; }); window.scrollTo(0, 0); });
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#pit img')].map(i => i.src.endsWith('_missing.svg') && i.complete && i.naturalWidth > 0))).toEqual([true, true]);
  expect(errors).toEqual([]);
});
