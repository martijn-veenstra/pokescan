/* battlefilm.js — read a GO Battle League recording into a battle log entry, on the phone.

   Why this exists: a battle recording has no status screens, so scanVideo() used to fall through to
   Share.fromFrames() and keep a dozen JPEGs for the Pro vision endpoint. Everything a log entry needs is
   already on screen every frame, in one fixed band: the two HUD cards under the status bar carry both
   active names, their CP, how many Pokémon each side has left (red pokéballs) and how many shields are
   still up (pink hexagons). Counting coloured pixels in that band is free, so the whole battle is read
   on-device and OCR is spent only on the ~10 frames where a name actually changes.

   Wiring (scanner.js, scanVideo): Film.start(dur) next to the snaps setup, then Film.frame(ctx,cv.width,cv.height,t)
   wherever a frame is drawn — in analyse() before its battleMode early return AND in the play loop's battleMode
   branch, because battleMode only turns on for recordings over 90 s and a single battle is often shorter. At the end,
   when no status screen was read, Film.finish() logs the battle and Share.fromFrames still runs: the free read gets
   the entry, Pro vision adds the commentary on top. The two are independent.

   Globals used from scanner.js (plain script scope): getWorker, status, progress, gain, SPECIES, $.
   Planner is used at finish() time only: idByName, nameOf, addBattle. */
(function () {
'use strict';

const SAMPLE_MIN = 0.45;        // s of video time between samples; the play loop already runs at ~1/3 s
const HOLD = 3;                 // samples a lower count must persist before it counts as a real change
const NAME_CHANGE = 0.34;       // ink-profile distance that means a different name is in the card
const MAX_OCR = 20;             // hard cap on name reads per recording

const MISS_MAX = 12;             // consecutive misses before locate() drops to every 8th sample
const MISS_EVERY = 8;
const GAP = 4;                  // s without a HUD that ends a battle: a set recording holds several
const MIN_ROWS = 8;             // samples a segment needs before it counts as a battle at all
const MAX_OCR_ALL = 80;         // name reads across the whole recording, however many battles it holds

let S = null;

/* ---------- geometry: find the two HUD cards, then work in fractions of a card ---------- */
// slot centres as a fraction of card width, player side; the opponent card is an exact mirror
const BALLS = [0.092, 0.225, 0.368], SHIELDS = [0.568, 0.686];
const PIP_RX = 0.042, PIP_RY = 0.10;

function locate(ctx, W, H) {
  const y0 = Math.round(H * 0.02), y1 = Math.round(H * 0.24), bh = y1 - y0;
  const d = ctx.getImageData(0, y0, W, bh).data;
  const light = (x, y) => { const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    return r > 145 && g > 145 && b > 145 && Math.max(r, g, b) - Math.min(r, g, b) < 55; };
  const runs = y => {                                    // light stretches wider than a fifth of the screen
    const out = []; let s = -1;
    for (let x = 0; x < W; x += 2) {
      const on = light(x, y);
      if (on && s < 0) s = x; else if (!on && s >= 0) { if (x - s > W * 0.2) out.push([s, x]); s = -1; }
    }
    if (s >= 0 && W - s > W * 0.2) out.push([s, W]);
    return out;
  };
  let seed = null;
  for (let y = 0; y < bh; y += 2) {
    const r = runs(y);
    if (r.length >= 2 && r[0][0] < W * 0.14 && r[0][1] < W * 0.55 && r[r.length - 1][1] > W * 0.86 && r[r.length - 1][0] > W * 0.45) { seed = {y, r}; break; }
  }
  if (!seed) return null;
  // the first row that qualifies is the card's soft top edge, where the run is still short: re-measure at
  // the middle of the card, then walk the card's own mid column for its true top and bottom
  let bot = seed.y, mid = (seed.r[0][0] + seed.r[0][1]) / 2 | 0;
  while (bot < bh - 2 && light(mid, bot)) bot += 2;
  const cy = (seed.y + bot) / 2 | 0, r2 = runs(cy);
  const L = r2.length >= 2 ? r2[0] : seed.r[0], R = r2.length >= 2 ? r2[r2.length - 1] : seed.r[seed.r.length - 1];
  const m2 = (L[0] + L[1]) / 2 | 0;
  let top = cy; while (top > 0 && light(m2, top)) top -= 2;
  bot = cy; while (bot < bh - 2 && light(m2, bot)) bot += 2;
  const ch = bot - top;
  if (ch < H * 0.02 || ch > H * 0.10) return null;        // a countdown number or a banner, not the HUD
  return {my:  {x: L[0], y: y0 + top, w: L[1] - L[0], h: ch},
          opp: {x: R[0], y: y0 + top, w: R[1] - R[0], h: ch}};
}

function pipRow(ctx, c) {                                 // the row carrying the pokéballs and hexagons
  const d = ctx.getImageData(c.x, c.y + (c.h * 0.4 | 0), c.w, (c.h * 0.55 | 0)).data;
  const rows = (c.h * 0.55 | 0);
  let best = 0, bv = 0;
  for (let y = 0; y < rows; y++) {
    let v = 0;
    for (let x = 0; x < c.w; x += 2) {
      const i = (y * c.w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      if (isRed(r, g, b) || isPink(r, g, b)) v++;
    }
    if (v > bv) { bv = v; best = y; }
  }
  return c.y + (c.h * 0.4 | 0) + (bv > 4 ? best : (c.h * 0.25 | 0));
}

const box = (c, fx, mine, row) => {                       // pip box around a slot centre, mirrored for the opponent
  const f = mine ? fx : 1 - fx;
  return [Math.round(c.x + (f - PIP_RX) * c.w), Math.round(row - PIP_RY * c.h),
          Math.round(2 * PIP_RX * c.w), Math.round(2 * PIP_RY * c.h)];
};
const rect = (c, x0f, x1f, mine, row) => {                // name (0.02–0.60) or CP (0.60–0.98), mirrored
  const a = mine ? x0f : 1 - x1f, b = mine ? x1f : 1 - x0f;
  const y = Math.round(c.y + 0.06 * c.h), y2 = Math.round(row - 0.13 * c.h);
  return [Math.round(c.x + a * c.w), y, Math.round((b - a) * c.w), Math.max(6, y2 - y)];
};

const isRed  = (r, g, b) => r > 150 && r - g > 70 && r - b > 60;                 // pokéball: a Pokémon still in
const isPink = (r, g, b) => r > 140 && b > 140 && (r - g > 35 || b - g > 35);    // hexagon: a shield still up

function lit(ctx, bx, test) {                             // fraction of a pip box in that colour
  const d = ctx.getImageData(bx[0], bx[1], bx[2], bx[3]).data;
  let n = 0, hit = 0;
  for (let i = 0; i < d.length; i += 8) { n++; if (test(d[i], d[i + 1], d[i + 2])) hit++; }
  return n ? hit / n : 0;
}
const count = (ctx, c, fracs, test, mine, row) => fracs.reduce((k, f) => k + (lit(ctx, box(c, f, mine, row), test) > 0.3 ? 1 : 0), 0);

function profile(ctx, r) {                                // 24-bin ink profile: cheap "is this still the same name"
  const d = ctx.getImageData(r[0], r[1], r[2], r[3]).data, bins = new Float32Array(24);
  let tot = 0;
  for (let y = 0; y < r[3]; y += 2) for (let x = 0; x < r[2]; x += 2) {
    const i = (y * r[2] + x) * 4, v = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    if (v < 150) { bins[Math.min(23, (x / r[2] * 24) | 0)]++; tot++; }
  }
  if (tot > 0) for (let i = 0; i < 24; i++) bins[i] /= tot;
  return {bins, ink: tot};
}
function profileDist(a, b) {
  if (!a || !b) return 1;
  if (a.ink < 40 || b.ink < 40) return a.ink === b.ink ? 0 : 1;
  let s = 0; for (let i = 0; i < 24; i++) s += Math.abs(a.bins[i] - b.bins[i]);
  return s / 2;
}
function grab(ctx, r, scale) {                            // upscaled greyscale crop, ready for Tesseract
  const c = document.createElement('canvas');
  c.width = r[2] * scale; c.height = r[3] * scale;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.filter = 'grayscale(1) contrast(1.35)';
  g.drawImage(ctx.canvas, r[0], r[1], r[2], r[3], 0, 0, c.width, c.height);
  return c;
}

/* ---------- per frame ---------- */
function start(dur) {
  S = {dur, hud: null, row: 0, segs: [], cur: null, lastT: -9, frames: 0, miss: 0, shots: 0};
}
function stop() { S = null; }          // scanVideo failed or finished: let the queued crops go
const newSeg = t => ({rows: [], shots: [], ends: [], last: {my: null, opp: null}, t0: t, lastHud: t});
const allSegs = () => S ? S.segs.concat(S.cur ? [S.cur] : []) : [];
const goodSegs = () => allSegs().filter(g => g.rows.length >= MIN_ROWS);
const seen = () => goodSegs().length > 0;

function frame(ctx, W, H, t) {
  if (!S || t - S.lastT < SAMPLE_MIN) return;
  S.lastT = t; S.frames++;
  let hud = S.hud;
  // look for the cards every sample until they have been missed a dozen times over — a swipe recording is not a
  // battle and locate() reads a fifth of the screen, so back off to every 8th sample rather than give up entirely
  const look = hud ? S.frames % 24 === 0 : (S.miss < MISS_MAX || S.frames % MISS_EVERY === 0);
  if (look) {
    const f = locate(ctx, W, H);
    if (f) { hud = S.hud = f; S.row = pipRow(ctx, f.my); S.miss = 0; } else if (!hud) S.miss++;
  }
  if (!hud) return keepEnd(ctx, W, H, t);
  const row = S.row;
  const myMon = count(ctx, hud.my, BALLS, isRed, true, row), oppMon = count(ctx, hud.opp, BALLS, isRed, false, row);
  if (myMon < 1 || oppMon < 1) return keepEnd(ctx, W, H, t);   // a countdown, a switch sheet or the end screen
  // a recording of a whole set holds several battles, and between them the HUD is gone: a gap that long ends the
  // battle, and the frames caught during it (the VICTORY / DEFEAT screen) belong to the segment that just closed
  if (S.cur && t - S.cur.lastHud > GAP) { S.segs.push(S.cur); S.cur = null; }
  if (!S.cur) S.cur = newSeg(t);
  const g = S.cur; g.lastHud = t;
  g.rows.push({t, myMon, oppMon,
    mySh: count(ctx, hud.my, SHIELDS, isPink, true, row), oppSh: count(ctx, hud.opp, SHIELDS, isPink, false, row)});
  for (const side of ['my', 'opp']) {
    const c = hud[side], mine = side === 'my', nr = rect(c, 0.02, 0.60, mine, row), p = profile(ctx, nr);
    if (p.ink < 40) continue;
    if (profileDist(p, g.last[side]) > NAME_CHANGE && g.shots.length < MAX_OCR && S.shots < MAX_OCR_ALL) {
      g.shots.push({t, side, name: grab(ctx, nr, 3), cp: grab(ctx, rect(c, 0.60, 0.98, mine, row), 3)});
      S.shots++;
    }
    g.last[side] = p;
  }
}
function keepEnd(ctx, W, H, t) {                          // the closing screen decides the result of the battle just played
  if (!S || !S.cur) return;                               // nothing open yet: the recording has not reached a battle
  S.cur.ends.push({t, img: grab(ctx, [0, Math.round(H * 0.22), W, Math.round(H * 0.34)], 1)});
  if (S.cur.ends.length > 4) S.cur.ends.shift();
}

/* ---------- reading the queued crops ---------- */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
async function ocr(canvas, whitelist, psm) {
  const wk = await getWorker();
  await wk.setParameters({tessedit_char_whitelist: whitelist, tessedit_pageseg_mode: String(psm || 7)});
  return ((await wk.recognize(canvas)).data.text || '').trim();
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n);
  let prev = Array.from({length: n + 1}, (_, j) => j), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
function matchSpecies(raw) {                              // OCR text → a species the app knows, or null
  const s = String(raw || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (s.length < 3) return null;
  let best = null, bd = 99;
  for (const sp of SPECIES) {
    const key = sp.replace(/[^A-Z]/g, '');
    const d = lev(s, key);
    if (d < bd) { bd = d; best = sp; }
    if (!d) break;
  }
  return bd <= Math.max(1, Math.round(s.length * 0.25)) ? best : null;
}
// DATA.stats keys carry the form in the key: MIMIKYU_BUSTED, GALARIAN_STUNFISK. idByName() strips punctuation and
// collapses spaces, so "Mimikyu Busted" finds "Mimikyu (Busted)"; the raw key with its underscore finds nothing.
const title = s => String(s).toLowerCase().split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/* ---------- assembling the log ---------- */
function events(rows) {                                   // counts only ever fall; a fall must hold to be real
  const cur = {myMon: 3, oppMon: 3, mySh: 2, oppSh: 2}, run = {}, out = [];
  for (const r of rows) for (const k of Object.keys(cur)) {
    const v = r[k];
    if (v >= cur[k]) { run[k] = null; continue; }
    const p = run[k];
    run[k] = (p && p.v === v) ? {v, n: p.n + 1} : {v, n: 1};
    if (run[k].n >= HOLD) { out.push({t: r.t, what: k, from: cur[k], to: v}); cur[k] = v; run[k] = null; }
  }
  return out;
}

const verdict = txt => {                                  // the end screen is big, blurred type: match words loosely
  for (const w of txt.split(/[^A-Z]+/)) {
    if (w.length < 4) continue;
    if (lev(w, 'VICTORY') <= 2) return 'W';
    if (lev(w, 'EFFORT') <= 2 || lev(w, 'DEFEAT') <= 2) return 'L';
    if (lev(w, 'DRAW') <= 1) return 'D';
  }
  return null;
};
const line = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const LABEL = {mySh: 'you shielded', oppSh: 'they shielded', myMon: 'you lost', oppMon: 'they lost'};
const FILM_MAX = 60;                                      // BATTLES syncs whole: keep each timeline bounded

/* one segment of the recording — one battle — into a log entry, or null when its names could not be read */
async function readSeg(g, file, t0, onShot) {
  const P = window.Planner, reads = [];
  for (const sh of g.shots) {
    onShot();
    const sp = matchSpecies(await ocr(sh.name, LETTERS, 7));
    if (!sp) continue;
    const cp = parseInt((await ocr(sh.cp, '0123456789CP cp', 7)).replace(/\D/g, ''), 10) || null;
    reads.push({t: sh.t, side: sh.side, species: sp, cp});
  }
  // a name must hold for 3 s to be an entry: the opponent's card flashes their first party slot at the buzzer
  const endT = g.lastHud;
  const stable = reads.filter((r, i) => {
    const next = reads.find((x, j) => j > i && x.side === r.side);
    return (next ? next.t - r.t : endT - r.t) >= 3;
  });
  const teamOf = s => { const out = []; for (const r of stable) if (r.side === s && !out.some(x => x.species === r.species)) out.push(r); return out; };
  const my = teamOf('my'), opp = teamOf('opp');
  if (!my.length || !opp.length) return null;

  const ev = events(g.rows), last = g.rows[g.rows.length - 1] || {};
  let result = null;
  for (const e of g.ends.slice().reverse()) {
    const r = verdict((await ocr(e.img, '', 11)).toUpperCase());
    if (r) { result = r; break; }
  }
  if (!result) result = last.myMon === 0 ? 'L' : last.oppMon === 0 ? 'W' : null;

  const nameOf = r => title(r.species), id = n => (P && P.idByName ? P.idByName(n) : null);
  const myIds = my.map(r => id(nameOf(r))).filter(Boolean), oppIds = opp.map(r => id(nameOf(r))).filter(Boolean);
  // times run from the start of this battle, not of the recording, so a set's third battle still reads 0:00 up
  const rel = t => Math.max(0, t - g.t0);
  const film = [];
  for (const r of stable) film.push({t: rel(r.t), text: `${line(rel(r.t))} ${r.side === 'my' ? 'you sent' : 'they sent'} ${nameOf(r)}${r.cp ? ' (' + r.cp + ')' : ''}`});
  for (const e of ev) film.push({t: rel(e.t), text: `${line(rel(e.t))} ${LABEL[e.what]}${/Mon$/.test(e.what) ? ' a Pokémon' : ` (${e.to} left)`}`});
  film.sort((a, b) => a.t - b.t);

  return {
    t: ((file && file.lastModified) || Date.now()) + Math.round(g.t0 * 1000),   // battles in a set keep their order
    result,
    ids: myIds.length === 3 ? myIds : null,          // a complete trio, which the stats need
    myIds,                                           // everything the read did resolve, even a partial team: this is what matches a saved party
    team: (P && P.partyFor) ? P.partyFor(myIds) : null,
    lead: oppIds[0] || null,
    opp: oppIds,
    oppNames: opp.map(nameOf),
    myNames: my.map(nameOf),
    myLead: myIds[0] || null,
    shields: {me: 2 - (last.mySh !== undefined ? last.mySh : 2), opp: 2 - (last.oppSh !== undefined ? last.oppSh : 2)},
    fainted: {me: 3 - (last.myMon || 0), opp: 3 - (last.oppMon || 0)},
    film: film.slice(0, FILM_MAX).map(f => f.text),
    // everything the read found, kept as data and not only as sentences: the AI review and any later screen can use it
    filmData: {
      reads: stable.map(r => ({t: Math.round(rel(r.t) * 10) / 10, side: r.side, species: r.species, cp: r.cp})),
      events: ev.map(e => ({t: Math.round(rel(e.t) * 10) / 10, what: e.what, from: e.from, to: e.to})),
      samples: g.rows.length, dur: Math.round(g.lastHud - g.t0)
    },
    src: 'film'
  };
}

/* every battle the recording holds, logged oldest first. Returns the entries, or null when none could be read. */
async function finish(file) {
  if (!seen()) { S = null; return null; }
  const segs = goodSegs(), P = window.Planner;
  status(segs.length > 1 ? `Reading ${segs.length} battles from the recording…` : 'Reading the battle from the recording…');
  const total = segs.reduce((n, g) => n + g.shots.length, 0);
  let done = 0;
  const onShot = () => progress(done++ / Math.max(1, total));
  const out = [];
  for (const g of segs) {
    let e = null;
    try { e = await readSeg(g, file, g.t0, onShot); } catch (err) { console.error(err); }
    if (!e) continue;
    out.push(e);
  }
  S = null;
  if (!out.length) return null;
  if (P && P.draftBattles) P.draftBattles(out);      // nothing is logged yet: the page shows the read and the player saves it
  const one = out[0], many = out.length > 1;
  gain('note', many ? `${out.length} battles read from the recording, waiting to be saved`
                    : `battle read from the recording: ${one.myNames.join(' / ')} vs ${one.oppNames.join(' / ')}`);
  status(many ? `${out.length} battles read · check the team and save them`
              : `${one.result === 'W' ? '✓ Win' : one.result === 'L' ? '✕ Loss' : 'Battle'} vs ${one.oppNames.join(' / ')} read · check the team and save it`);
  return out;
}

window.Film = {start, stop, frame, finish, seen, locate, events, matchSpecies,
               shotCount: () => allSegs().reduce((n, g) => n + g.shots.length, 0), segCount: () => goodSegs().length};
})();
