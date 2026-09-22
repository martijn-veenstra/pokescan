import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('the importing card expands to show what the read has found, and stays up while it is being read', async ({ page }) => {
  const errors = await openApp(page, '#/battles');
  await page.evaluate(() => {
    EVT = []; progBox(true); renderEvents();
    status('Video 6s / 212s · 0 new · 1 screens read');
    evt('0:02 battle HUD found — reading the cards');
    evt('0:14 they lost a Pokémon');
  });
  const card = page.locator('#impfloat');
  await expect(card).toBeVisible();
  await expect(page.locator('#fevx'), 'the expand button counts what has been recorded').toHaveText('▸ 2 events recorded');
  await expect(page.locator('#fevl')).toBeHidden();

  await page.locator('#fevx').click();
  await expect(page.locator('#fevl')).toBeVisible();
  await expect(page.locator('#fevl')).toContainText('battle HUD found');
  await expect(page.locator('#fevl')).toContainText('they lost a Pokémon');
  await expect(page.locator('#fevx')).toHaveText('▾ 2 events recorded');

  await page.evaluate(() => evt('0:31 you shielded (1 left)'));     // an open list keeps up with the read
  await expect(page.locator('#fevl')).toContainText('you shielded (1 left)');
  await expect(page.locator('#fevx')).toHaveText('▾ 3 events recorded');

  await page.evaluate(() => endCard());                             // the import ends: the card normally goes away
  await expect(card, 'but not while the events are open').toBeVisible();
  await page.locator('#impfloat .pcx').click();                     // the cross in that state dismisses it
  await expect(card).toBeHidden();

  // the Scans page has its own copy of the same card, with the same two controls
  await page.evaluate(() => { location.hash = '#/scans'; });
  await page.evaluate(() => { progBox(true); status('Scanning IMG_1.png'); });
  await expect(page.locator('#prog')).toBeVisible();
  await expect(page.locator('#prog .pcx')).toBeVisible();
  await expect(page.locator('#pevx')).toHaveText('▸ 3 events recorded');
  await page.locator('#pevx').click();
  await expect(page.locator('#pevl')).toContainText('you shielded (1 left)');
  expect(errors).toEqual([]);
});

test('the cross stops a recording part way through, and the log says it was stopped', async ({ page }) => {
  test.setTimeout(150000);
  await page.addInitScript(() => {
    localStorage.setItem('trainer', '40');
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
    paint(3, 3, 2, 2);
    const stream = cv.captureStream(12), chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start();
    const t0 = Date.now();
    await new Promise(done => {
      const iv = setInterval(() => {
        const el = (Date.now() - t0) / 1000;
        paint(3, el > 10 ? 2 : 3, el > 6 ? 1 : 2, 2);
        if (el > 20) { clearInterval(iv); rec.stop(); }
      }, 80);
      rec.onstop = () => done();
    });
    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'battle.webm', { type: 'video/webm', lastModified: Date.now() });
    window.getWorker = async () => ({ setParameters: async () => {}, recognize: async () => ({ data: { text: 'AZUMARILL' } }) });
    const running = importFilmFiles([file]);
    // let it get into the recording, then press the cross
    await new Promise(r => { const iv = setInterval(() => {
      if (EVT.some(e => /HUD found/.test(e.text))) { clearInterval(iv); r(); } }, 100);
      setTimeout(() => { clearInterval(iv); r(); }, 20000); });
    const before = EVT.length;
    cancelImport();
    const stopping = document.getElementById('fstat').textContent;
    await running;
    return { before, stopping, events: EVT.map(e => e.text), stat: document.getElementById('stat').textContent,
             draft: localStorage.getItem('bdraft'), blog: JSON.parse(localStorage.getItem('blog') || '[]'),
             report: Film.report() };
  });
  expect(res.before, 'the feed filled up while the recording was being read').toBeGreaterThan(1);
  expect(res.events.join('\n'), 'and it read the HUD before being stopped').toMatch(/HUD found/);
  expect(res.stopping, 'the card says so the moment the cross is pressed').toBe('Stopping the import…');
  expect(res.stat, 'and reports where it got to').toMatch(/^Stopped/);
  expect(res.events).toContain('stopped by you');
  expect(res.draft, 'a stopped recording is not read into a draft').toBeNull();
  expect(res.blog.length, 'but the battle log keeps the record of the attempt').toBe(1);
  expect(res.blog[0].msg).toBe('stopped before it finished');
  expect(res.report.frames, 'with the frames it did manage').toBeGreaterThan(0);
  await expect(page.locator('#battles .team.card.draft')).toHaveCount(0);
  await expect(page.locator('#battles .team.card.blog')).toContainText('stopped before it finished');
  expect(errors).toEqual([]);
});
