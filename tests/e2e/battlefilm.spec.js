import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/* No video fixture exists — and a recording is the user's to supply — so this drives Film's own API with synthetic
   HUD frames painted onto a canvas: two light cards under the status bar, red pokéballs for Pokémon left and pink
   hexagons for shields, exactly the band locate() looks for. OCR is stubbed the way share.spec.js stubs vision. */
const HARNESS = () => {
  const W = 390, H = 844;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // slot centres as a fraction of card width, mirrored for the opponent — the same geometry battlefilm.js uses
  const BALLS = [0.092, 0.225, 0.368], SHIELDS = [0.568, 0.686];
  window.__paint = (myMon, oppMon, mySh, oppSh, tag) => {
    ctx.fillStyle = '#1d3b6e'; ctx.fillRect(0, 0, W, H);                  // the battlefield behind the HUD
    const cards = [{ x: 8, w: 178, mine: true }, { x: W - 8 - 178, w: 178, mine: false }];
    const y = Math.round(H * 0.06), h = Math.round(H * 0.055);
    for (const c of cards) {
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(c.x, y, c.w, h);            // the light card locate() hunts for
      ctx.fillStyle = '#202020'; ctx.font = 'bold 13px sans-serif';       // a name, so the ink profile changes on a switch
      const label = c.mine ? (tag || 'AZUMARILL') : 'MEDICHAM';
      ctx.fillText(label, c.mine ? c.x + 5 : c.x + c.w - 5 - ctx.measureText(label).width, y + 15);
      const row = y + Math.round(h * 0.72);
      const pip = (fx, n, i, colour) => { if (i >= n) return; const f = c.mine ? fx : 1 - fx;
        ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(c.x + f * c.w, row, Math.round(0.042 * c.w), 0, 7); ctx.fill(); };
      BALLS.forEach((f, i) => pip(f, c.mine ? myMon : oppMon, i, '#e0322a'));
      SHIELDS.forEach((f, i) => pip(f, c.mine ? mySh : oppSh, i, '#f062c8'));
    }
    return ctx;
  };
  // between two battles there is no HUD, and the closing screen shows the verdict in big type
  window.__gap = (word) => {
    ctx.fillStyle = '#10182a'; ctx.fillRect(0, 0, W, H);
    if (word) { ctx.fillStyle = '#ffffff'; ctx.font = 'bold 44px sans-serif'; ctx.fillText(word, 40, Math.round(H * 0.34)); }
    return ctx;
  };
  window.__ctx = () => ctx;
  window.__size = [W, H];
};

test('Film reads a battle off the HUD: both cards, the pip counts, the timeline and one logged entry', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('battles'); localStorage.removeItem('roster'); });
  const errors = await openApp(page, '#/battles');
  await page.evaluate(HARNESS);

  // locate() finds both cards in the band, and they mirror each other
  const found = await page.evaluate(() => { const c = window.__paint(3, 3, 2, 2); const f = Film.locate(c, ...window.__size); return f && { myW: f.my.w, oppW: f.opp.w, sameRow: f.my.y === f.opp.y, apart: f.opp.x > f.my.x }; });
  expect(found, 'locate() found the two HUD cards').toBeTruthy();
  expect(found.sameRow && found.apart).toBe(true);
  expect(Math.abs(found.myW - found.oppW)).toBeLessThanOrEqual(4);

  // a fall in a count only becomes an event once it has held (HOLD samples), so one flickering frame is ignored
  const ev = await page.evaluate(() => Film.events([
    { t: 1, myMon: 3, oppMon: 3, mySh: 2, oppSh: 2 }, { t: 2, myMon: 3, oppMon: 3, mySh: 1, oppSh: 2 },
    { t: 3, myMon: 3, oppMon: 3, mySh: 2, oppSh: 2 },                                  // a flicker: must not count
    { t: 4, myMon: 3, oppMon: 3, mySh: 1, oppSh: 2 }, { t: 5, myMon: 3, oppMon: 3, mySh: 1, oppSh: 2 },
    { t: 6, myMon: 3, oppMon: 3, mySh: 1, oppSh: 2 }, { t: 7, myMon: 3, oppMon: 2, mySh: 1, oppSh: 2 },
    { t: 8, myMon: 3, oppMon: 2, mySh: 1, oppSh: 2 }, { t: 9, myMon: 3, oppMon: 2, mySh: 1, oppSh: 2 }]));
  expect(ev.map(e => e.what)).toEqual(['mySh', 'oppMon']);
  expect(ev[0].from).toBe(2); expect(ev[0].to).toBe(1);

  // OCR text the app has to forgive: the HUD is small and blurred
  expect(await page.evaluate(() => [Film.matchSpecies('AZUMARlLL'), Film.matchSpecies('MEDlCHAM'), Film.matchSpecies('zz')]))
    .toEqual(['AZUMARILL', 'MEDICHAM', null]);

  // a whole battle: names are read once each, then the opponent loses one and we run out of shields
  await page.evaluate(async () => {
    // stubbed reader, like share.spec.js stubs vision: the letter whitelist gets a name, the digit one a CP.
    // Shots queue in frame order and each sample walks ['my','opp'], so the names come back in that order.
    window.__names = ['AZUMARILL', 'MEDICHAM'];
    window.getWorker = async () => { let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        recognize: async () => ({ data: { text: wl.includes('Z') ? (window.__names.shift() || 'AZUMARILL') : '1500' } }) }; };
    Film.start(120);
    let t = 0;
    const step = (mine, om, msh, osh, tag) => { const c = window.__paint(mine, om, msh, osh, tag); Film.frame(c, ...window.__size, t); t += 0.5; };
    for (let i = 0; i < 12; i++) step(3, 3, 2, 2);            // the opening
    for (let i = 0; i < 8; i++) step(3, 3, 1, 2);             // you shield
    for (let i = 0; i < 8; i++) step(3, 2, 1, 2);             // they lose one
  });
  expect(await page.evaluate(() => Film.seen())).toBe(true);
  expect(await page.evaluate(() => Film.shotCount()), 'a name crop was queued for each side').toBeGreaterThanOrEqual(2);
  const entry = await page.evaluate(async () => { await Film.finish({ lastModified: Date.now() }); return Planner.BATTLES[Planner.BATTLES.length - 1] || null; });
  expect(entry, 'the battle was logged').toBeTruthy();
  expect(entry.src).toBe('film');
  expect(entry.myNames.length).toBeGreaterThan(0);
  expect(entry.oppNames).toContain('Medicham');
  expect(entry.shields.me).toBe(1);                            // one of two used
  expect(entry.fainted.opp).toBe(1);
  expect(entry.film.join('\n')).toMatch(/you shielded|they lost/);
  expect(entry.filmData.events.length).toBeGreaterThan(0);     // the structured read is kept, not only the sentences
  expect(entry.filmData.samples).toBeGreaterThan(20);

  // the log says where it came from, and the row opens the battle's own page with the timeline on it
  await page.evaluate(() => Planner.renderBattles());
  const row = page.locator('#battles .team.row', { hasText: 'read from your recording' }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/battle\//);
  await expect(page.locator('#battle .filmt')).toBeVisible();
  await expect(page.locator('#battle')).toContainText('Shields');
  await expect(page.locator('#battle .back')).toContainText('Battle log');
  expect(errors).toEqual([]);
});

test('a set recording splits on the end screens: one entry per battle', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('battles'); localStorage.removeItem('roster'); });
  const errors = await openApp(page, '#/battles');
  await page.evaluate(HARNESS);
  const n = await page.evaluate(async () => {
    const names = ['AZUMARILL', 'MEDICHAM', 'REGISTEEL', 'ALTARIA'];      // battle 1: my/opp, battle 2: my/opp
    window.getWorker = async () => { let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        recognize: async c => ({ data: { text: wl.includes('Z') ? (names.shift() || 'AZUMARILL') : (c.width > 300 ? 'VICTORY' : '1500') } }) }; };
    Film.start(240);
    let t = 0;
    const hud = (mine, om, msh, osh, tag) => { Film.frame(window.__paint(mine, om, msh, osh, tag), ...window.__size, t); t += 0.5; };
    const gap = word => { Film.frame(window.__gap(word), ...window.__size, t); t += 0.5; };
    for (let i = 0; i < 14; i++) hud(3, 3, 2, 2, 'AZUMARILL');            // battle one
    for (let i = 0; i < 8; i++) hud(3, 2, 1, 2, 'AZUMARILL');
    for (let i = 0; i < 16; i++) gap(i > 2 && i < 10 ? 'VICTORY' : '');    // the end screen, then the wait for the next
    for (let i = 0; i < 14; i++) hud(3, 3, 2, 2, 'REGISTEEL');            // battle two
    for (let i = 0; i < 8; i++) hud(2, 3, 2, 1, 'REGISTEEL');
    return Film.segCount();
  });
  expect(n, 'the gap between battles split the recording in two').toBe(2);
  const logged = await page.evaluate(async () => { const out = await Film.finish({ lastModified: Date.now() }); return (out || []).map(e => ({ my: e.myNames, opp: e.oppNames, shields: e.shields, fainted: e.fainted, first: e.film[0] })); });
  expect(logged).toHaveLength(2);
  expect(logged[0].my).toContain('Azumarill');
  expect(logged[1].my).toContain('Registeel');
  expect(logged[0].fainted.opp).toBe(1);                                   // battle one: they lost one
  expect(logged[1].fainted.me).toBe(1);                                    // battle two: you lost one
  expect(logged[1].first, "the second battle's clock restarts, it does not continue the recording's").toMatch(/^0:0/);
  expect(await page.evaluate(() => Planner.BATTLES.filter(b => b.src === 'film').length)).toBe(2);
  expect(errors).toEqual([]);
});
