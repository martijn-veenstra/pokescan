import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/* No video fixture exists — and a recording is the user's to supply — so this drives Film's own API with synthetic
   HUD frames painted onto a canvas: two light cards under the status bar, red pokéballs for Pokémon left and pink
   hexagons for shields, which is what calibrate() measures the cards from. OCR is stubbed the way share.spec.js stubs vision. */
const HARNESS = () => {
  const W = 390, H = 844;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // slot centres as a fraction of card width, mirrored for the opponent — the same geometry battlefilm.js uses
  const BALLS = [0.092, 0.225, 0.368], SHIELDS = [0.568, 0.686];
  window.__paint = (myMon, oppMon, mySh, oppSh, tag, keepBg) => {
    if (!keepBg) { ctx.fillStyle = '#1d3b6e'; ctx.fillRect(0, 0, W, H); }   // the battlefield behind the HUD
    const cards = [{ x: 8, w: 148, mine: true }, { x: W - 8 - 148, w: 148, mine: false }];
    const y = Math.round(H * 0.06), h = Math.round(H * 0.055);
    for (const c of cards) {
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(c.x, y, c.w, h);            // the card behind the pips
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

  // calibrate() measures both cards from the three pokéballs a side, and they mirror each other
  const found = await page.evaluate(() => { const c = window.__paint(3, 3, 2, 2); const f = Film.calibrate(c, ...window.__size); return f && { w: f.w, row: f.row, myX: f.my.x, oppX: f.opp.x }; });
  expect(found, 'calibrate() measured the HUD from the pips').toBeTruthy();
  expect(found.oppX, 'the opponent card sits to the right of yours').toBeGreaterThan(found.myX);
  expect(found.w, 'and the card width is about the painted 148px').toBeGreaterThan(130);
  expect(found.w).toBeLessThan(165);

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
    // three readers share one worker: names (letters), CP (digits) and the move banners (letters plus ' ,!').
    // Only the name reader may take from the queue, or a banner read steals the next battle's name.
    window.getWorker = async () => { let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        recognize: async () => ({ data: { text: wl.includes('!') ? '' : wl.includes('Z') ? (window.__names.shift() || 'AZUMARILL') : '1500' } }) }; };
    Film.start(120);
    let t = 0;
    const step = (mine, om, msh, osh, tag) => { const c = window.__paint(mine, om, msh, osh, tag); Film.frame(c, ...window.__size, t); t += 0.5; };
    for (let i = 0; i < 12; i++) step(3, 3, 2, 2);            // the opening
    for (let i = 0; i < 8; i++) step(3, 3, 1, 2);             // you shield
    for (let i = 0; i < 8; i++) step(3, 2, 1, 2);             // they lose one
  });
  expect(await page.evaluate(() => Film.seen())).toBe(true);
  expect(await page.evaluate(() => Film.shotCount()), 'a name crop was queued for each side').toBeGreaterThanOrEqual(2);
  // the read becomes a draft, not a log entry: saving it is the player's move
  const draftLen = await page.evaluate(async () => { const out = await Film.finish({ lastModified: Date.now() }); return (out || []).length; });
  expect(draftLen).toBe(1);
  expect(await page.evaluate(() => Planner.BATTLES.length), 'nothing is logged until saved').toBe(0);
  const entry = await page.evaluate(() => { Planner.saveDrafts(); return Planner.BATTLES[Planner.BATTLES.length - 1] || null; });
  expect(entry, 'saving puts it in the log').toBeTruthy();
  expect(entry.src).toBe('film');
  expect(entry.myNames.length).toBeGreaterThan(0);
  expect(entry.oppNames).toContain('Medicham');
  expect(entry.shields.me).toBe(1);                            // one of two used
  expect(entry.fainted.opp).toBe(1);
  expect(entry.film.join('\n')).toMatch(/you shielded|they lost/);
  expect(entry.filmData.events.filter(e => /Mon$/.test(e.what)).length, 'nothing fainted in this scripted battle but theirs').toBe(1);
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

test('the counts decide where a battle ends, not a gap in the HUD', async ({ page }) => {
  const errors = await openApp(page, '#/battles');
  const out = await page.evaluate(() => {
    const row = (t, a, b, c, d) => ({ t, myMon: a, oppMon: b, mySh: c, oppSh: d });
    // one real match: 3v3, then faints and shields fall and never come back. The HUD vanishes for a charged move
    // somewhere in the middle, which used to cut this into several battles.
    const one = [];
    for (let t = 0; t < 60; t += 0.5) one.push(row(t, 3, 3, 2, 2));
    for (let t = 66; t < 88; t += 0.5) one.push(row(t, 3, 2, 2, 2));       // a six second hole in the samples
    for (let t = 88; t < 205; t += 0.5) one.push(row(t, 1, 1, 0, 0));
    // a genuine set: each battle starts back at a full 3-a-side
    const set = [];
    for (let k = 0; k < 3; k++) { const base = k * 100;
      for (let t = 0; t < 40; t += 0.5) set.push(row(base + t, 3, 3, 2, 2));
      for (let t = 40; t < 80; t += 0.5) set.push(row(base + t, 2, 1, 1, 0)); }
    // a pip occluded for a single sample must not split the battle, nor become a faint
    const flick = [];
    for (let t = 0; t < 40; t += 0.5) flick.push(row(t, 3, 3, 2, 2));
    flick.push(row(40, 2, 3, 2, 2));
    for (let t = 40.5; t < 80; t += 0.5) flick.push(row(t, 3, 3, 2, 2));
    return { one: Film.splitRows(one).length, set: Film.splitRows(set).length,
             flicker: Film.splitRows(flick).length, flickerEvents: Film.events(flick).length,
             // a recording that starts mid-match reports only the falls it saw, not an assumed 3-a-side start
             midStart: Film.events([row(0, 2, 2, 1, 1), row(1, 2, 2, 1, 1), row(2, 2, 2, 1, 1)]).length };
  });
  expect(out.one, 'one match with a six second HUD hole is one battle').toBe(1);
  expect(out.set, 'three battles that each restart at 3-a-side are three').toBe(3);
  expect(out.flicker, 'a one sample flicker splits nothing').toBe(1);
  expect(out.flickerEvents, 'and is not a faint either').toBe(0);
  expect(out.midStart, 'a recording that starts mid-match invents no faints or shields').toBe(0);
  expect(errors).toEqual([]);
});

test('a daylight battle still calibrates: bright cloud above the cards no longer swallows the HUD', async ({ page }) => {
  const errors = await openApp(page, '#/battles');
  await page.evaluate(HARNESS);
  const out = await page.evaluate(() => {
    const [W, H] = window.__size, ctx = window.__ctx();
    // v1 found the HUD by looking for two wide light bands, so a midday sky matched and every frame was discarded.
    // Paint exactly that: near-white low-saturation cloud across the whole band the reader looks at.
    const sky = () => {
      ctx.fillStyle = '#eef2f5'; ctx.fillRect(0, 0, W, Math.round(H * 0.30));
      ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.arc(W * 0.3, H * 0.10, 70, 0, 7); ctx.fill();
      ctx.fillStyle = '#fdfdfe'; ctx.beginPath(); ctx.arc(W * 0.75, H * 0.16, 90, 0, 7); ctx.fill();
    };
    window.__names = ['AZUMARILL', 'MEDICHAM'];
    window.getWorker = async () => { let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        recognize: async () => ({ data: { text: wl.includes('!') ? '' : wl.includes('Z') ? (window.__names.shift() || 'AZUMARILL') : '1500' } }) }; };
    Film.start(120);
    let t = 0;
    for (let i = 0; i < 20; i++) { ctx.fillStyle = '#1d3b6e'; ctx.fillRect(0, 0, W, H); sky(); window.__paint(3, 3, 2, 2, null, true); Film.frame(ctx, W, H, t); t += 0.5; }
    return {report: JSON.parse(JSON.stringify(Film.report()))};
  });
  expect(out.report.cal, 'the pips are found through the cloud').toBe(true);
  expect(out.report.rows, 'and the battle is sampled instead of thrown away').toBeGreaterThan(15);
  expect(await page.evaluate(async () => { const o = await Film.finish({ lastModified: Date.now() }); return o && o.length; })).toBe(1);
  expect(errors).toEqual([]);
});
