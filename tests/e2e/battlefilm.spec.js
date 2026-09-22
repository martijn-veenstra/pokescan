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
  window.__paint = (myMon, oppMon, mySh, oppSh, tag, keepBg, otag, ocp, dx) => {
    if (!keepBg) { ctx.fillStyle = '#1d3b6e'; ctx.fillRect(0, 0, W, H); }   // the battlefield behind the HUD
    const cards = [{ x: 8, w: 148, mine: true }, { x: W - 8 - 148, w: 148, mine: false }];
    const y = Math.round(H * 0.06), h = Math.round(H * 0.055);
    for (const c of cards) {
      ctx.fillStyle = '#f2f2f2'; ctx.fillRect(c.x, y, c.w, h);            // the card behind the pips
      ctx.fillStyle = '#202020'; ctx.font = 'bold 13px sans-serif';       // a name, so the ink profile changes on a switch
      const label = c.mine ? (tag || 'AZUMARILL') : (otag || 'MEDICHAM');
      ctx.fillText(label, (c.mine ? c.x + 5 : c.x + c.w - 5 - ctx.measureText(label).width) + (dx || 0), y + 15);
      // the CP sits at the far end of the same band, mirrored on their card: it is half of what tells two cards apart
      ctx.font = 'bold 11px sans-serif';
      const cp = String(c.mine ? 1500 : (ocp || 1476));
      ctx.fillText(cp, c.mine ? c.x + c.w - 6 - ctx.measureText(cp).width : c.x + 6, y + 15);
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

test('a switch the cards never spelled out is still logged, from the move it announced', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('battles'); localStorage.removeItem('bdraft'); localStorage.removeItem('roster'); });
  const errors = await openApp(page, '#/battles');
  await page.evaluate(HARNESS);
  const out = await page.evaluate(async () => {
    // the opponent's second Pokémon never comes back legible — the third name read is rubbish — but the game
    // announces its charged move, which is the only place its name appears at all
    window.__names = ['AZUMARILL', 'MEDICHAM', 'xx'];
    window.getWorker = async () => { let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        // the announcement as a blurred banner really comes back: the species survives, the move barely does
        recognize: async () => ({ data: { text: wl.includes('!') ? 'BASTIODON usec S dge' : wl.includes('Z') ? (window.__names.shift() || 'xx') : '1500' } }) }; };
    Film.start(120);
    let t = 0;
    const step = (mine, om, msh, osh, tag, otag, ocp, dx) => { const c = window.__paint(mine, om, msh, osh, tag, false, otag, ocp, dx); Film.frame(c, ...window.__size, t); t += 0.5; };
    // the opening: both leads read once each. The text jitters by a pixel between frames, as a compressed
    // recording's does — that must not read as a switch, or the OCR budget is gone before the battle starts
    for (let i = 0; i < 12; i++) step(3, 3, 2, 2, null, null, null, i % 2);
    for (let i = 0; i < 8; i++) step(3, 2, 2, 2, null, null, null, i % 2);   // they lose one
    const shotsBefore = Film.shotCount();
    // their switch to a name of almost the same length — the case the old detector scored below its threshold and
    // missed entirely. One crop, and the stub reads it as rubbish
    for (let i = 0; i < 8; i++) step(3, 2, 2, 2, null, 'BASTIODON', 1402);
    // the HUD hides for the animation; only the middle frame has the words up, and that is the one to read
    Film.frame(window.__gap(), ...window.__size, t); t += 0.5;
    Film.frame(window.__gap('BASTIODON used STONE EDGE'), ...window.__size, t); const bannerT = t; t += 0.5;
    Film.frame(window.__gap(), ...window.__size, t); t += 0.5;
    for (let i = 0; i < 8; i++) step(3, 2, 1, 2, null, 'BASTIODON', 1402);
    const shots = Film.shotCount(), banners = Film.report().banners;
    const entries = await Film.finish({ lastModified: Date.now() });
    return { shotsBefore, shots, banners, bannerT, e: entries && entries[0] };
  });
  expect(out.shotsBefore, 'a settled card is read once per side, however much the text jitters').toBe(2);
  expect(out.shots, 'and the switch adds exactly one more crop').toBe(3);
  expect(out.e, 'the battle was read').toBeTruthy();
  expect(out.e.oppNames, 'the Pokémon only its banner named still joins their team').toContain('Bastiodon');
  expect(out.banners, 'one crop per gap in the HUD, not one per frame of it').toBe(1);
  const mv = out.e.moves.find(m => /Bastiodon/i.test(m.species));
  expect(mv, 'and its move is kept').toBeTruthy();
  expect(mv.move, '"S dge" is still Stone Edge against the four moves Bastiodon has').toBe('Stone Edge');
  expect(mv.t, 'the frame that was read is the one with the words on it').toBe(out.bannerT);
  expect(mv.by, 'attributed to the side whose name crop could not be read').toBe('opp');
  expect(out.e.film.join('\n')).toMatch(/they sent Bastiodon/);
  expect(errors).toEqual([]);
});

test('the clock prints whole minutes, not 0:60', async ({ page }) => {
  const errors = await openApp(page, '#/battles');
  const lines = await page.evaluate(() => {
    window.getWorker = async () => ({ setParameters: async () => {}, recognize: async () => ({ data: { text: '' } }) });
    return Film.events([{ t: 58.4, myMon: 3, oppMon: 3, mySh: 2, oppSh: 2 }, { t: 59.4, myMon: 3, oppMon: 3, mySh: 2, oppSh: 1 },
      { t: 59.6, myMon: 3, oppMon: 3, mySh: 2, oppSh: 1 }, { t: 59.8, myMon: 3, oppMon: 3, mySh: 2, oppSh: 1 }]).map(e => e.t);
  });
  expect(lines.length).toBe(1);
  expect(errors).toEqual([]);
});

/* The battle from the bug report, replayed from the clean parse of the recording (Great League, a loss):
   Chesnaught / Cramorant / Mimikyu against Bastiodon (who switched out to Medicham straight away) / Medicham / Sableye.
   What the log used to make of it: the first read at 0:17 because calibration backed off to every 8th sample during
   the intro — so the Bastiodon lead was never seen — "you sent Chesnaught" three times (the 20 s re-reads), zero moves
   (the banner filter wanted a dark band, the battle was in daylight) and "fainted: you 2" in a 3–2 loss. */
test('the reported battle reads back like the recording: each switch once, the moves, and the last faint', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => { localStorage.removeItem('battles'); localStorage.removeItem('bdraft'); localStorage.removeItem('roster'); });
  const errors = await openApp(page, '#/battles');
  const out = await page.evaluate(async () => {
    const W = 390, H = 844;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const BALLS = [0.092, 0.225, 0.368], SHIELDS = [0.568, 0.686];
    // each Pokémon's card is painted on its own grey, so the stubbed OCR can tell which name a crop holds
    const MON = { CHESNAUGHT: [165, 1465], BASTIODON: [175, 1491], CRAMORANT: [185, 1490], MEDICHAM: [195, 1476], MIMIKYU: [205, 1480], SABLEYE: [215, 1476] };
    const sky = () => {                                   // a midday battlefield: bright sky, a cloud, the ground
      const gr = ctx.createLinearGradient(0, 0, 0, H * 0.6); gr.addColorStop(0, '#bfe0ff'); gr.addColorStop(1, '#eef7ff');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fbfdff'; ctx.beginPath(); ctx.arc(W * 0.7, H * 0.22, 80, 0, 7); ctx.fill();
      ctx.fillStyle = '#7cc26a'; ctx.fillRect(0, H * 0.6, W, H * 0.4);
      ctx.fillStyle = '#8a6d3b'; ctx.beginPath(); ctx.arc(W * 0.5, H * 0.45, 60, 0, 7); ctx.fill();   // a Pokémon
    };
    const hud = (me, them, myMon, oppMon, mySh, oppSh) => {
      sky();
      const y = Math.round(H * 0.06), h = Math.round(H * 0.055);
      for (const c of [{ x: 8, w: 148, mine: true, n: me }, { x: W - 8 - 148, w: 148, mine: false, n: them }]) {
        const [grey, cp] = MON[c.n];
        ctx.fillStyle = `rgb(${grey},${grey},${grey})`; ctx.fillRect(c.x, y, c.w, h);
        ctx.fillStyle = '#202020'; ctx.font = 'bold 13px sans-serif';
        ctx.fillText(c.n, c.mine ? c.x + 5 : c.x + c.w - 5 - ctx.measureText(c.n).width, y + 15);
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(String(cp), c.mine ? c.x + c.w - 6 - ctx.measureText(String(cp)).width : c.x + 6, y + 15);
        const row = y + Math.round(h * 0.72);
        const pip = (fx, n, i, col) => { if (i >= n) return; const f = c.mine ? fx : 1 - fx;
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(c.x + f * c.w, row, Math.round(0.042 * c.w), 0, 7); ctx.fill(); };
        BALLS.forEach((f, i) => pip(f, c.mine ? myMon : oppMon, i, '#e0322a'));
        SHIELDS.forEach((f, i) => pip(f, c.mine ? mySh : oppSh, i, '#f062c8'));
      }
    };
    // the announcement: white type with a dark outline straight over the bright sky, no dark band behind it
    const words = s => { sky(); ctx.font = 'bold 22px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#1a1a1a'; ctx.fillStyle = '#ffffff';
      const x = (W - ctx.measureText(s).width) / 2; ctx.strokeText(s, x, H * 0.17); ctx.fillText(s, x, H * 0.17); };
    const intro = () => { ctx.fillStyle = '#2a2350'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#f4d23c'; ctx.fillRect(40, H * 0.4, W - 80, 60); };
    const end = () => { ctx.fillStyle = '#10182a'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('GOOD EFFORT', 40, H * 0.36); };

    // what OCR returns: the name and CP off the card's grey, the banner from a queue — but only if the crop it was
    // handed really is black lettering on white, i.e. the sky did not turn into ink
    const BANNERS = [], inkSeen = [];
    const mode = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = {};
      for (let i = 0; i < d.length; i += 16) n[d[i]] = (n[d[i]] || 0) + 1;
      return +Object.keys(n).sort((a, b) => n[b] - n[a])[0]; };
    const grey2mon = v => { const g = Object.entries(MON).map(([k, [gr]]) => [k, Math.min(255, (gr - 128) * 1.35 + 128)]);
      return g.sort((a, b) => Math.abs(a[1] - v) - Math.abs(b[1] - v))[0][0]; };
    window.getWorker = async () => { let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        recognize: async c => {
          if (wl.includes('!')) {
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let black = 0, bw = true;
            for (let i = 0; i < d.length; i += 4) { if (d[i] !== 0 && d[i] !== 255) { bw = false; break; } if (!d[i]) black++; }
            if (!bw) return { data: { text: '' } };            // the inverted fallback: never needed here
            const f = black / (d.length / 4); inkSeen.push(f);
            return { data: { text: f > 0.01 && f < 0.3 ? (BANNERS.shift() || '') : '' } };
          }
          if (!wl) return { data: { text: 'GOOD EFFORT' } };
          const m = grey2mon(mode(c));
          return { data: { text: wl.includes('Z') ? m : String(MON[m][1]) } };
        } }; };

    Film.start(210);
    let t = 0;
    const run = (until, paint) => { while (t < until - 1e-6) { paint(); Film.frame(ctx, W, H, t); t += 0.5; } };
    const gapWith = (s, until) => { const t0 = t; run(until, () => (t - t0 > 0.6 && t - t0 < 1.4 ? words(s) : sky())); };
    const state = { me: 'CHESNAUGHT', them: 'BASTIODON', myMon: 3, oppMon: 3, mySh: 2, oppSh: 2 };
    const on = until => run(until, () => hud(state.me, state.them, state.myMon, state.oppMon, state.mySh, state.oppSh));
    run(12, intro);                                              // matchmaking and the intro: no HUD for 12 s
    on(17);
    state.them = 'MEDICHAM'; on(28);                            // their lead switches out at once
    BANNERS.push('CHESNAUGHT used FRENZY PLANT!'); gapWith('CHESNAUGHT used FRENZY PLANT!', 31);
    state.oppSh = 1; on(43);                                    // they shield it
    BANNERS.push('MEDICHAM used ICE PUNCH!'); gapWith('MEDICHAM used ICE PUNCH!', 46);
    on(56);
    BANNERS.push('CHESNAUGHT used FRENZY PLANT!'); gapWith('CHESNAUGHT used FRENZY PLANT!', 59);
    run(62, sky);                                               // Medicham faints: the HUD is gone for the animation
    state.oppMon = 2; state.them = 'BASTIODON'; on(67);
    run(70, sky);                                               // Chesnaught faints
    state.myMon = 2; state.me = 'CRAMORANT'; on(84);
    BANNERS.push('ne Edg!'); gapWith('BASTIODON used STONE EDGE!', 87);   // the name lost to blur: the move alone
    state.mySh = 1; on(96);                                     // you shield it
    BANNERS.push('CRAMORANT used DIVE!'); gapWith('CRAMORANT used DIVE!', 99);
    on(114);
    state.me = 'MIMIKYU'; on(142);                              // you switch, nobody fainted
    BANNERS.push('MIMIKYU used PLAY ROUGH!'); gapWith('MIMIKYU used PLAY ROUGH!', 145);
    run(148, sky);                                              // Bastiodon faints
    state.oppMon = 1; state.them = 'SABLEYE'; on(165);
    BANNERS.push('MIMIKYU used PLAY ROUGH!'); gapWith('MIMIKYU used PLAY ROUGH!', 168);
    state.oppSh = 0; on(170);                                   // their last shield
    run(173, sky);                                              // Mimikyu faints
    state.myMon = 1; state.me = 'CRAMORANT'; on(189);
    BANNERS.push('SABLEYE used FOUL PLAY!'); gapWith('SABLEYE used FOUL PLAY!', 192);
    state.mySh = 0; on(196);                                    // your last shield
    run(199, sky);                                              // Cramorant faints: the HUD never comes back
    run(206, end);
    const entries = await Film.finish({ lastModified: Date.now() });
    return { e: entries && entries[0], inkSeen };
  });
  const e = out.e;
  expect(e, 'the battle was read').toBeTruthy();
  const film = e.film.join('\n');
  expect(e.result).toBe('L');
  expect(e.oppNames, 'their lead, seen for five seconds after a twelve second intro').toEqual(['Bastiodon', 'Medicham', 'Sableye']);
  expect(e.myNames).toEqual(['Chesnaught', 'Cramorant', 'Mimikyu']);
  expect(e.fainted, 'the last faint, which the HUD never shows, is counted in a loss').toEqual({ me: 3, opp: 2 });
  expect(e.shields).toEqual({ me: 2, opp: 2 });
  // every Pokémon is sent once per stint on the field: the re-reads every 20 s add nothing
  expect((film.match(/Chesnaught \(/g) || []).length, film).toBe(1);
  expect((film.match(/sent Cramorant|switched to Cramorant/g) || []).length, 'Cramorant twice: in after Chesnaught, back after Mimikyu').toBe(2);
  expect(film).toMatch(/0:1[23] they sent Bastiodon \(1491\)/);
  expect(film).toMatch(/0:17 they switched to Medicham \(1476\)/);
  expect(film).toMatch(/you switched to Mimikyu/);
  expect(film).toMatch(/their Medicham fainted/);
  expect(film).toMatch(/your Chesnaught fainted/);
  expect(film).toMatch(/their Bastiodon fainted/);
  expect(film).toMatch(/your Mimikyu fainted/);
  expect(film, 'the last faint closes the timeline').toMatch(/your Cramorant fainted/);
  expect(film).toMatch(/good effort/);
  // the moves, read over a daylight sky
  expect(out.inkSeen.length, 'every announcement was grabbed (and the closing screen)').toBeGreaterThanOrEqual(8);
  expect(e.filmData.unread, 'and every one of them read').toEqual([]);
  const mv = e.moves.map(m => `${m.by} ${m.species} ${m.move}${m.blocked ? ' x' : ''}`);
  expect(mv).toEqual(['my Chesnaught Frenzy Plant x', 'opp Medicham Ice Punch', 'my Chesnaught Frenzy Plant',
    'opp Bastiodon Stone Edge x', 'my Cramorant Dive', 'my Mimikyu Play Rough', 'my Mimikyu Play Rough x', 'opp Sableye Foul Play x']);
  expect(film).toMatch(/you shielded Stone Edge \(1 left\)/);
  expect(film).toMatch(/they shielded Play Rough \(0 left\)/);
  // in the order it happened: the move, then the shield or the faint it caused, then who came in
  const at = re => e.film.findIndex(l => re.test(l));
  expect(at(/Chesnaught used Frenzy Plant — blocked/)).toBeLessThan(at(/they shielded Frenzy Plant/));
  expect(at(/0:5\d Chesnaught used Frenzy Plant$/)).toBeLessThan(at(/their Medicham fainted/));
  expect(at(/their Medicham fainted/)).toBeLessThan(at(/1:0\d they sent Bastiodon/));
  expect(errors).toEqual([]);
});

/* The v2 script read moves the one-best-frame reader lost: when the frame that scored best as text was not the
   announcement (a bigger line elsewhere in the band, the swipe prompt), that gap's move was gone. The fixed band on
   a timer is kept too, and a banner that opens with "The opponent's" still names the right Pokémon. */
test('a move is still read when the best-looking line in the gap is not the announcement', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('battles'); localStorage.removeItem('bdraft'); localStorage.removeItem('roster'); });
  const errors = await openApp(page, '#/battles');
  await page.evaluate(HARNESS);
  const out = await page.evaluate(async () => {
    window.__names = ['AZUMARILL', 'BASTIODON'];
    const seen = { ink: 0, band: 0 };
    window.getWorker = async () => { let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        recognize: async c => {
          if (!wl.includes('!')) return { data: { text: wl.includes('Z') ? (window.__names.shift() || 'AZUMARILL') : '1500' } };
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let bw = true;
          for (let i = 0; i < d.length; i += 4) if (d[i] !== 0 && d[i] !== 255) { bw = false; break; }
          if (bw) { seen.ink++; return { data: { text: 'TAP TAP TAP' } }; }        // the best line: the swipe prompt
          seen.band++; return { data: { text: "The opponent's BASTIODON used STONE EDGE!" } };
        } }; };
    Film.start(60);
    let t = 0;
    const step = () => { const c = window.__paint(3, 3, 2, 2, null, false, 'BASTIODON'); Film.frame(c, ...window.__size, t); t += 0.5; };
    for (let i = 0; i < 12; i++) step();
    const g = window.__ctx(), [W, H] = window.__size;
    for (let i = 0; i < 4; i++) {                          // the gap: a huge prompt low down outscores the small words
      window.__gap();
      g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.fillText("Bastiodon used Stone Edge!", 60, H * 0.24);
      g.font = 'bold 40px sans-serif'; g.lineWidth = 5; g.strokeStyle = '#000'; g.strokeText('TAP TAP TAP', 40, H * 0.5); g.fillText('TAP TAP TAP', 40, H * 0.5);
      Film.frame(g, W, H, t); t += 0.5;
    }
    for (let i = 0; i < 8; i++) step();
    const e = (await Film.finish({ lastModified: Date.now() }))[0];
    return { seen, moves: e.moves };
  });
  expect(out.seen.ink, 'the best line was tried first').toBeGreaterThan(0);
  expect(out.seen.band, 'then the fixed band').toBeGreaterThan(0);
  expect(out.moves.map(m => `${m.by} ${m.species} ${m.move}`)).toEqual(['opp Bastiodon Stone Edge']);
  expect(errors).toEqual([]);
});
