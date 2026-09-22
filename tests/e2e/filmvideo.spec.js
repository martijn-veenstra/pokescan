import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('a recorded battle goes through scanVideo into a draft, even when the status reader misfires', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    localStorage.setItem('trainer', '40');
    localStorage.setItem('roster', JSON.stringify({ tagged: { Rain: ['azumarill', 'medicham', 'altaria'] }, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] }));
    localStorage.removeItem('battles'); localStorage.removeItem('bdraft'); localStorage.removeItem('blog');
  });
  const errors = await openApp(page, '#/battles');
  const res = await page.evaluate(async () => {
    const W = 390, H = 844;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const BALLS = [0.092, 0.225, 0.368], SHIELDS = [0.568, 0.686];
    const paint = (myMon, oppMon, mySh, oppSh) => {
      g.fillStyle = '#1d3b6e'; g.fillRect(0, 0, W, H);
      for (const c of [{ x: 8, w: 148, mine: true }, { x: W - 8 - 148, w: 148, mine: false }]) {
        const y = Math.round(H * 0.06), h = Math.round(H * 0.055);
        g.fillStyle = '#f2f2f2'; g.fillRect(c.x, y, c.w, h);
        g.fillStyle = '#202020'; g.font = 'bold 13px sans-serif';
        const label = c.mine ? 'AZUMARILL' : 'MEDICHAM';
        g.fillText(label, c.mine ? c.x + 5 : c.x + c.w - 5 - g.measureText(label).width, y + 15);
        const row = y + Math.round(h * 0.72);
        const pip = (fx, n, i, col) => { if (i >= n) return; const f = c.mine ? fx : 1 - fx;
          g.fillStyle = col; g.beginPath(); g.arc(c.x + f * c.w, row, Math.round(0.042 * c.w), 0, 7); g.fill(); };
        BALLS.forEach((f, i) => pip(f, c.mine ? myMon : oppMon, i, '#e0322a'));
        SHIELDS.forEach((f, i) => pip(f, c.mine ? mySh : oppSh, i, '#e0b0ff'));
      }
    };
    // record ~8 s of a battle as a real video file the <video> element has to decode
    paint(3, 3, 2, 2);
    const stream = cv.captureStream(12), chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    const t0 = Date.now();
    await new Promise(done => {
      const iv = setInterval(() => {
        const el = (Date.now() - t0) / 1000;
        // 4–10 s: a charged move is being announced, so the game hides the HUD for six seconds — which is both
        // where the banner comes from and the hole that used to cut one match into several battles.
        if (el > 4 && el < 10) { g.fillStyle = '#0b1220'; g.fillRect(0, 0, W, H);
          g.fillStyle = '#ffffff'; g.font = 'bold 22px sans-serif'; g.fillText('Chesnaught used Frenzy Plant!', 20, Math.round(H * 0.26)); }
        else paint(3, el > 10 ? 2 : 3, el > 3 ? 1 : 2, 2);
        if (el > 16) { clearInterval(iv); rec.stop(); }
      }, 80);
      rec.onstop = () => done();
    });
    const blob = new Blob(chunks, { type: 'video/webm' });
    const file = new File([blob], 'battle.webm', { type: 'video/webm', lastModified: Date.now() });
    // the real entry point the battle log's button uses
    window.__names = ['AZUMARILL', 'MEDICHAM'];      // one queue for the whole read, not one per worker call
    window.getWorker = async () => { const names = window.__names; let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        recognize: async () => ({ data: { text: wl.includes('!') ? 'CHESNAUGHT used FRENZY PLANT!' : wl.includes('Z') ? (names.shift() || 'AZUMARILL') : '1500' } }) }; };
    await importFilmFiles([file]);
    return { size: blob.size, report: Film.report(), blog: JSON.parse(localStorage.getItem('blog') || '[]') };
  });
  expect(res.size, 'the browser produced a real video file').toBeGreaterThan(1000);
  expect(res.report, 'the reader calibrated the HUD off the pips in the recording').toMatchObject({ cal: true });
  expect(res.report.entries, 'and turned it into exactly one battle, despite the six second HUD hole').toBe(1);
  expect(res.report.good, 'the splitter saw one battle in the row stream').toBe(1);
  // it became a draft on the battle log, waiting to be saved
  await expect(page.locator('#battles .team.card.draft')).toBeVisible();
  await expect(page.locator('#battles .team.card.draft')).toContainText('vs Medicham');
  // the counts come off the pixels, not from the stub: the shield and the faint painted into the recording
  const drafted = await page.evaluate(() => JSON.parse(localStorage.getItem('bdraft') || '{}').entries[0]);
  expect(drafted.shields.me, 'the shield spent mid-recording was seen').toBe(1);
  expect(drafted.fainted.opp, 'and the Pokémon they lost').toBe(1);
  // the moves: the banner frames while the HUD is hidden are read for "X used Y"
  expect(drafted.moves.length, 'a move was read off a banner').toBeGreaterThan(0);
  expect(drafted.moves[0]).toMatchObject({ species: 'Chesnaught', move: 'Frenzy Plant' });
  expect(drafted.film.join('\n')).toMatch(/Chesnaught used Frenzy Plant/);
  expect(drafted.filmData.moves.length).toBe(drafted.moves.length);
  // recording time, as the reference parse shows it: the later events are not all at 0:00
  const last = drafted.filmData.events[drafted.filmData.events.length - 1];
  expect(last.t, 'the last event carries its real time in the recording').toBeGreaterThan(2);
  // the import log lives here, not on the scans page
  await expect(page.locator('#battles .team.card.blog')).toContainText('1 battle read');
  expect(await page.evaluate(() => (document.getElementById('implog') || {}).innerHTML || ''), 'the scans log is untouched').toBe('');
  expect(errors).toEqual([]);
});

test('a recording with no battle in it says so, on the battle log, instead of failing silently', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    localStorage.setItem('trainer', '40');
    localStorage.removeItem('battles'); localStorage.removeItem('bdraft'); localStorage.removeItem('blog');
  });
  const errors = await openApp(page, '#/battles');
  await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 390; cv.height = 844;
    const g = cv.getContext('2d');
    const stream = cv.captureStream(12), chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    const t0 = Date.now();
    await new Promise(done => {
      const iv = setInterval(() => {                       // a map screen: no HUD anywhere
        g.fillStyle = '#2b6e3b'; g.fillRect(0, 0, 390, 844);
        g.fillStyle = '#7fd4a0'; g.fillRect(40, 300 + ((Date.now() - t0) / 40 % 40), 120, 90);
        if (Date.now() - t0 > 5000) { clearInterval(iv); rec.stop(); }
      }, 80);
      rec.onstop = () => done();
    });
    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'walk.webm', { type: 'video/webm', lastModified: Date.now() });
    await importFilmFiles([file]);
  });
  await expect(page.locator('#battles .team.card.draft'), 'nothing is drafted from a recording with no battle').toHaveCount(0);
  const blog = page.locator('#battles .team.card.blog');
  await expect(blog).toBeVisible();
  await expect(blog, 'and the log says why, in words').toContainText('No battle HUD found');
  await expect(blog).toContainText('HUD not found');       // the raw diagnostics under it
  expect(errors).toEqual([]);
});
