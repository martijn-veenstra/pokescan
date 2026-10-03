import { test, expect } from '@playwright/test';
import { openApp, seedOnce, roster } from './helpers.js';

/* iPhone freezes a web app the moment it leaves the screen: the video pauses and will not play again until the app is back.
   That used to look like a stalled video: three nudges, then the read stopped with only the frames seen so far. Now a pause
   while off screen is not a stall, and the read goes on from the same spot when PokeScan is back on screen. */
test('a battle recording keeps reading after the app was in the background', async ({ page }) => {
  test.setTimeout(150000);
  await seedOnce(page, { roster: roster({ Rain: ['azumarill', 'medicham', 'altaria'] }), battles: null, bdraft: null, blog: null });
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
    window.__names = ['AZUMARILL', 'MEDICHAM'];      // one queue for the whole read, not one per worker call
    window.getWorker = async () => { const names = window.__names; let wl = '';
      return { setParameters: async o => { wl = o.tessedit_char_whitelist || ''; },
        recognize: async () => ({ data: { text: wl.includes('!') ? 'CHESNAUGHT used FRENZY PLANT!' : wl.includes('Z') ? (names.shift() || 'AZUMARILL') : '1500' } }) }; };
    // a Pro account would send a recording the phone made nothing of to Claude: one read as a battle must not go (it was logged twice)
    window.__claude = 0; if (window.Share) Share.fromFrames = async () => { window.__claude++; return true; };
    const run = importFilmFiles([file]);
    // as soon as it plays: off screen, the way iOS does it (hidden, paused, and play() refused) for longer than three stall nudges
    const vid = document.getElementById('vid');
    await new Promise(r => { const iv = setInterval(() => { if (!vid.paused && vid.currentTime > 0.5) { clearInterval(iv); r(); } }, 50); });
    const at = vid.currentTime;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    vid.play = () => Promise.reject(new DOMException('not while hidden', 'NotAllowedError')); vid.pause();
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 21000));
    const heldAt = vid.currentTime;
    // back on screen
    delete vid.play; delete document.hidden; delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    await run;
    return { at, heldAt, report: Film.report(), draft: JSON.parse(localStorage.getItem('bdraft') || 'null'), blog: JSON.parse(localStorage.getItem('blog') || '[]') };
  });
  expect(res.heldAt, 'nothing played while off screen').toBeCloseTo(res.at, 0);
  expect(res.report.entries, 'the whole battle was read, not only the part before the pause').toBe(1);
  const d = res.draft.entries[0];
  expect(d.fainted.opp, 'the faint after the pause (10 s in) was seen').toBe(1);
  expect(d.moves.length, 'and the banner after it').toBeGreaterThan(0);
  const log = JSON.stringify(res.blog);
  expect(log).toMatch(/paused 1× while PokeScan was off screen/);
  expect(log).not.toMatch(/stalled/);
  expect(errors).toEqual([]);
});
