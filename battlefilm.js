/* battlefilm.js v2 — read a GO Battle League recording into a battle log entry, on the phone.

   Why this exists: a battle recording has no status screens, so scanVideo() used to fall through to
   Share.fromFrames() and keep a dozen JPEGs for the Pro vision endpoint. Everything a log entry needs is
   already on screen every frame, in one fixed band: the two HUD cards carry both active names, their CP,
   how many Pokémon each side has left (red pokéballs) and how many shields are still up (pink hexagons).
   Counting coloured pixels there is free, so the battle is read on-device and OCR is spent only on the
   handful of frames where a name changes or a banner is up.

   v2, after a daylight battle logged only its first Pokémon: the HUD used to be found by looking for two
   wide light bands, which works at night but matches white cloud in a midday sky, so almost every frame
   was thrown away and the log stopped at the first switch. The cards are now found by the pokéballs and
   shield hexagons instead — saturated red and pink never occur in a GO background — measured once from the
   three pokéballs per side and then frozen, because the HUD never moves during a battle.

   Wiring (scanner.js, scanVideo): Film.start(dur) next to the snaps setup, then Film.frame(ctx,cv.width,cv.height,t)
   wherever a frame is drawn — in analyse() before its battleMode early return AND in the play loop's battleMode
   branch. At the end Film.finish() runs whenever Film.seen(), never gated on what the status-screen reader thought it
   saw: a battle recording makes that reader misfire, and gating on it meant this module was never called at all.
   finish() does not write to the log — it hands the battles it read to Planner.draftBattles, and the player saves them.
   A recording of a whole set is split into one battle per gap in the HUD.

   Globals from scanner.js (plain script scope): getWorker, status, progress, gain, SPECIES, APP.
   Planner is used at finish() time only: idByName, partyFor, addBattle. */
(function () {
'use strict';

const SAMPLE_MIN = 0.45;        // s of video time between samples
const HOLD = 3;                 // samples a lower count must persist before it counts as a real change
/* The ink profile is smoothed before it is compared, and compared at a much lower distance, because measuring it
   showed the old test could not do its job: two different names of similar length (MEDICHAM vs BASTIODON) scored
   0.27 against a threshold of 0.34, so an opponent's switch registered as no change at all and their second and
   third Pokémon never reached the log — while the same card nudged by one pixel scored 0.25, which is why the
   threshold had to be that high. Smoothing collapses the jitter (0.07) without collapsing the difference (0.15). */
const NAME_CHANGE = 0.09;       // smoothed ink-profile distance that means a different name is in the card
const RE_READ = 20;             // s: read each card again anyway, so a switch the profile missed is caught within this
// A switched-in card slides into place over about half a second, and every frame of that slide reads as another
// name change. Grabbing each one filled the OCR queue with blurred halves of a name — a battle spent its whole
// budget on its first two switches, which is why an opponent's second and third Pokémon never made the log. Wait
// for the profile to hold, then take exactly one crop of it.
const NAME_HOLD = 2;
const MAX_OCR = 44, MAX_BANNERS = 90;              // gaps in the HUD kept, across the recording; one match is easily 50
/* v9.93 kept a single frame per gap — the one that scored best as text — and when that was the wrong frame, the move
   was gone. The v2 reader grabbed the fixed announcement band on a timer instead, and read moves this one missed. Both
   are kept now: the best-scoring line, and the band at the start of the gap and every second after, a few per gap.
   They are read in turn only until one of them gives a move, so a gap usually still costs one OCR. Stored as JPEG,
   because a recording's worth of full-width canvases is more memory than a phone gives a page. */
const TIMED = [0.20, 0.48], TIMED_EVERY = 1.0, TIMED_PER_GAP = 4, MAX_TIMED = 220;
const MIN_ROWS = 8;             // samples a battle needs before it counts as one at all
/* calibrate() reads a fifth of the screen, so after this many misses it is tried on every other sample only. It used to
   be every 8th: with two agreeing calibrations needed, a battle whose HUD came up 9 s in was first read at 0:17, after
   the opponent's lead had already switched out — the log then opened on the wrong Pokémon. And once a candidate is
   pending, the very next sample confirms it, whatever the back-off says. */
const MISS_MAX = 12;
const MISS_EVERY = 2;
const TIMER = 225;              // s of battle: a GBL match that lasts this long ended on the clock, not on a faint

// slot centres as a fraction of card width, player side; the opponent card is an exact mirror
const BALLS = [0.092, 0.225, 0.368], SHIELDS = [0.568, 0.686];
const PIP_R = 0.042;            // pip box half-size, as a fraction of card width
let S = null;

const isRed  = (r, g, b) => r > 150 && r - g > 70 && r - b > 60;                 // pokéball: a Pokémon still in
const isPink = (r, g, b) => r > 140 && b > 140 && (r - g > 35 || b - g > 35);    // hexagon: a shield still up

/* ---------- geometry: measure the cards from the pips once, then freeze ---------- */
function calibrate(ctx, W, H) {
  const y0 = Math.round(H * 0.02), bh = Math.round(H * 0.20);
  const d = ctx.getImageData(0, y0, W, bh).data;
  const at = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  let row = -1, rv = 5;
  for (let y = 0; y < bh; y += 2) {                        // the row carrying the most pip colour
    let v = 0;
    for (let x = 0; x < W; x += 3) { const p = at(x, y); if (isRed(p[0], p[1], p[2]) || isPink(p[0], p[1], p[2])) v++; }
    if (v > rv) { rv = v; row = y; }
  }
  if (row < 0) return null;
  const runs = []; let s = -1, kind = null;                // coloured stretches along that row
  for (let x = 0; x <= W; x++) {
    const p = x < W ? at(x, row) : [0, 0, 0];
    const k = x < W && isRed(p[0], p[1], p[2]) ? 'R' : x < W && isPink(p[0], p[1], p[2]) ? 'P' : null;
    if (k !== kind) {
      if (s >= 0 && x - s > W * 0.012) runs.push({x: (s + x) / 2, kind});
      s = k ? x : -1; kind = k;
    }
  }
  const ballsOn = side => runs.filter(r => r.kind === 'R' && (side === 'my' ? r.x < W * 0.5 : r.x > W * 0.5)).map(r => r.x);
  const my = ballsOn('my'), opp = ballsOn('opp');
  if (my.length < 3 || opp.length < 3) return null;        // only calibrate while nobody has fainted yet
  const cwMy = (my[2] - my[0]) / 0.276, cwOpp = (opp[opp.length - 1] - opp[opp.length - 3]) / 0.276;
  if (Math.abs(cwMy - cwOpp) > W * 0.03) return null;
  const w = (cwMy + cwOpp) / 2;
  if (w < W * 0.33 || w > W * 0.42) return null;
  return {row: y0 + row, w, my: {x: my[0] - 0.092 * w, w}, opp: {x: opp[opp.length - 1] + 0.092 * w - w, w}};
}

const box = (c, fx, mine, row, w) => {                     // pip box around a slot centre, mirrored for the opponent
  const f = mine ? fx : 1 - fx;
  return [Math.round(c.x + (f - PIP_R) * c.w), Math.round(row - PIP_R * w),
          Math.round(2 * PIP_R * c.w), Math.round(2 * PIP_R * w)];
};
const rect = (c, x0f, x1f, mine, row, w) => {              // name (0.02–0.60) or CP (0.60–0.98), just above the pips
  const a = mine ? x0f : 1 - x1f, b = mine ? x1f : 1 - x0f;
  const y = Math.round(row - 0.19 * w), y2 = Math.round(row - 0.055 * w);
  return [Math.round(c.x + a * c.w), y, Math.round((b - a) * c.w), Math.max(6, y2 - y)];
};
function lit(ctx, bx, test) {                              // fraction of a pip box in that colour
  const d = ctx.getImageData(bx[0], bx[1], bx[2], bx[3]).data;
  let n = 0, hit = 0;
  for (let i = 0; i < d.length; i += 8) { n++; if (test(d[i], d[i + 1], d[i + 2])) hit++; }
  return n ? hit / n : 0;
}
const count = (ctx, c, fracs, test, mine, row, w) =>
  fracs.reduce((k, f) => k + (lit(ctx, box(c, f, mine, row, w), test) > 0.3 ? 1 : 0), 0);

function profile(ctx, r) {                                 // 24-bin ink profile: cheap "is this still the same name"
  const d = ctx.getImageData(r[0], r[1], r[2], r[3]).data, bins = new Float32Array(24);
  let tot = 0;
  for (let y = 0; y < r[3]; y += 2) for (let x = 0; x < r[2]; x += 2) {
    const i = (y * r[2] + x) * 4, v = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    if (v < 150) { bins[Math.min(23, (x / r[2] * 24) | 0)]++; tot++; }
  }
  if (tot > 0) for (let i = 0; i < 24; i++) bins[i] /= tot;
  return {bins: smooth(smooth(bins)), ink: tot};
}
// a 1px shift of the same text moves as much ink between neighbouring bins as a different word does; two passes of
// a [1 2 1] blur leave the shape of the word and drop that
function smooth(b) {
  const o = new Float32Array(24);
  for (let i = 0; i < 24; i++) o[i] = (b[Math.max(0, i - 1)] + 2 * b[i] + b[Math.min(23, i + 1)]) / 4;
  return o;
}
function profileDist(a, b) {
  if (!a || !b) return 1;
  if (a.ink < 40 || b.ink < 40) return a.ink === b.ink ? 0 : 1;
  let s = 0; for (let i = 0; i < 24; i++) s += Math.abs(a.bins[i] - b.bins[i]);
  return s / 2;
}
function grab(ctx, r, scale) {                             // upscaled greyscale crop, ready for Tesseract
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(r[2] * scale)); c.height = Math.max(8, Math.round(r[3] * scale));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.filter = 'grayscale(1) contrast(1.35)';
  g.drawImage(ctx.canvas, r[0], r[1], r[2], r[3], 0, 0, c.width, c.height);
  return c;
}

/* ---------- per frame ---------- */
const newGap = () => ({score: 0, t: 0, img: null, timed: [], tt: null});
const jpeg = c => c.toDataURL('image/jpeg', 0.9);
function start(dur) {
  S = {dur, cal: null, pending: null, rows: [], shots: [], banners: [], ends: [],
       name: {my: {p: null, n: 0, shot: false, t: -99, t0: 0, first: true}, opp: {p: null, n: 0, shot: false, t: -99, t0: 0, first: true}},
       gap: newGap(), timedN: 0, lastT: -9, frames: 0, miss: 0, cur: null, run: {}};
}
// the loader card shows the read as it happens: hand each finding to scanner.js's feed, if it is listening
const say = s => { try { if (window.filmEvent) window.filmEvent(s); } catch (e) {} };
function stop() { LAST = report(); S = null; }     // scanVideo failed or finished: drop the queued crops, keep the diagnostics
const seen = () => !!(S && S.rows.length >= MIN_ROWS);
let LAST = null;                                   // the last read's diagnostics, so a failed import can say why
function report() {
  if (!S) return LAST;
  const first = S.rows[0], last = S.rows[S.rows.length - 1];
  return {frames: S.frames, cal: !!S.cal, miss: S.miss, rows: S.rows.length, shots: S.shots.length,
          banners: S.banners.length, good: S.rows.length >= MIN_ROWS ? splitRows(S.rows).length : 0,
          entries: 0, dur: Math.round(S.dur),
          seen0: first ? Math.round(first.t) : 0, seen1: last ? Math.round(last.t) : 0};
}

function frame(ctx, W, H, t) {
  if (!S || t - S.lastT < SAMPLE_MIN) return;
  S.lastT = t; S.frames++;
  if (!S.cal) {                                            // two calibrations that agree, then it is frozen
    // an ordinary swipe recording never calibrates, and calibrate() reads a fifth of the screen: back off rather
    // than pay for it on every sample, but keep trying so a battle that starts late is still caught
    if (!S.pending && S.miss >= MISS_MAX && S.frames % MISS_EVERY) return offCard(ctx, W, H, t);
    const c = calibrate(ctx, W, H);
    if (!c) { S.miss++; return offCard(ctx, W, H, t); }
    if (S.pending && Math.abs(S.pending.my.x - c.my.x) < W * 0.01 && Math.abs(S.pending.row - c.row) < H * 0.01) { S.cal = c; S.miss = 0; say(`${clock(t)} battle HUD found — reading the cards`); }
    else { S.pending = c; return offCard(ctx, W, H, t); }
  }
  const row = S.cal.row, w = S.cal.w;
  const myMon = count(ctx, S.cal.my, BALLS, isRed, true, row, w);
  const oppMon = count(ctx, S.cal.opp, BALLS, isRed, false, row, w);
  if (myMon < 1 || oppMon < 1) return offCard(ctx, W, H, t);   // a charged-move animation, a switch sheet, the end
  flushGap();                                                  // the HUD is back: that gap's announcement is settled
  S.rows.push({t, myMon, oppMon,
    mySh: count(ctx, S.cal.my, SHIELDS, isPink, true, row, w),
    oppSh: count(ctx, S.cal.opp, SHIELDS, isPink, false, row, w)});
  live(S.rows[S.rows.length - 1]);
  for (const side of ['my', 'opp']) {
    const c = S.cal[side], mine = side === 'my', nr = rect(c, 0.02, 0.60, mine, row, w), p = profile(ctx, nr);
    if (p.ink < 40) continue;
    const st = S.name[side];
    // t0: when this name first showed. A switch is logged at that moment, not NAME_HOLD samples later; a periodic
    // re-read is logged at its own time, since whatever it finds may have come in at any point since the last one
    if (profileDist(p, st.p) > NAME_CHANGE) { st.p = p; st.n = 1; st.shot = false; st.t0 = t; st.first = true; }
    else { st.n++; if (t - st.t >= RE_READ) st.shot = false; }
    if (st.shot || st.n < NAME_HOLD || S.shots.length >= MAX_OCR) continue;
    st.shot = true; st.t = t;
    S.shots.push({t: st.first ? st.t0 : t, side, name: grab(ctx, nr, 3), cp: grab(ctx, rect(c, 0.60, 0.98, mine, row, w), 3)});
    st.first = false;
    say(`${clock(t)} reading the name on ${mine ? 'your' : 'their'} card`);
  }
}

/* The counts as they arrive, under the same HOLD rule events() applies afterwards, so the loader can report a fall
   the moment it is certain instead of only once the whole recording has been read. Reporting only: the entry is
   still built from the full row stream in events(), which is what a later re-read has to agree with. */
function live(r) {
  if (!S.cur) { S.cur = {myMon: r.myMon, oppMon: r.oppMon, mySh: r.mySh, oppSh: r.oppSh}; S.run = {}; return; }
  for (const k of Object.keys(S.cur)) {
    const v = r[k];
    if (v >= S.cur[k]) { S.run[k] = null; continue; }
    const p = S.run[k];
    S.run[k] = (p && p.v === v) ? {v, n: p.n + 1} : {v, n: 1};
    if (S.run[k].n >= HOLD) {
      S.cur[k] = v; S.run[k] = null;
      say(`${clock(r.t)} ${LABEL[k]}${/Sh$/.test(k) ? ` (${v} left)` : ''}`);
    }
  }
}

// The HUD is hidden exactly when something is being announced: a charged move, a switch-in, a shield. Those
// frames are useless for counting, which makes them the free place to grab the banner — no detector needed.
/* Where the announcement is looked for. v2 took a fixed band and kept a frame only when that band was mostly dark
   (mean < 150): a daylight battle has bright sky behind the words, so no frame ever passed, no banner was queued and
   a whole match logged zero moves. The HUD is hidden during the announcement, so the band now starts right under the
   status bar, and the words are found as what they are — a line of hard white strokes — wherever they sit in it. */
const BANNER = [0.06, 0.55];
const LINE_H = 0.032;                              // one line of the announcement, as a fraction of screen height
const SCAN_W = 360;                                // the band is measured on a copy this wide: cheap at any resolution
let SCAN = null;

/* The strongest line of type in the band: rows are scored by how many hard edges they carry that touch near-white
   (a stroke of the white lettering against the dark outline or overlay). Sky and cloud are smooth, a Pokémon model
   has soft shading: neither scores like a sentence does. Returns the line's centre as a fraction of H, and a score. */
function textLine(ctx, W, H) {
  const y0 = Math.round(H * BANNER[0]), bh = Math.round(H * (BANNER[1] - BANNER[0]));
  const sw = Math.min(SCAN_W, W), sh = Math.max(8, Math.round(bh * sw / W));
  if (!SCAN) SCAN = document.createElement('canvas');
  if (SCAN.width !== sw || SCAN.height !== sh) { SCAN.width = sw; SCAN.height = sh; }
  const g = SCAN.getContext('2d', {willReadFrequently: true});
  g.drawImage(ctx.canvas, 0, y0, W, bh, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data, rows = new Float32Array(sh);
  for (let y = 0; y < sh; y++) {
    let n = 0, pv = -1;
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4, v = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
      if (pv >= 0 && Math.abs(v - pv) > 80 && Math.max(v, pv) > 200) n++;
      pv = v;
    }
    rows[y] = n / sw;
  }
  const win = Math.max(2, Math.round(LINE_H * H * sh / bh));
  let best = 0, at = -1, sum = 0;
  for (let y = 0; y < sh; y++) {
    sum += rows[y]; if (y >= win) sum -= rows[y - win];
    if (y >= win - 1 && sum > best) { best = sum; at = y - win / 2 + 0.5; }
  }
  const score = best / win;
  return at < 0 ? {score: 0, y: 0} : {score: score >= 0.025 ? score : 0, y: BANNER[0] + (at / sh) * (BANNER[1] - BANNER[0])};
}

/* The crop OCR gets: full width, two lines tall around the line found, upscaled, in colour. It is turned into
   something Tesseract reads only when it is read (inkOf / inverted), so the many frames that beat each other within
   one gap cost a drawImage each and nothing more. */
function bannerCrop(ctx, W, H, yc) {
  const h = Math.round(H * LINE_H * 2.4), y = Math.max(0, Math.min(H - h, Math.round(yc * H - h / 2)));
  const scale = Math.max(0.8, Math.min(2.5, 1100 / W));
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(ctx.canvas, 0, y, W, h, 0, 0, c.width, c.height);
  return c;
}
/* The lettering as black ink on white. A plain "white is ink" threshold makes a midday sky ink too — the words are
   white against bright sky there, legible only because of their dark outline (or the dark overlay behind them). So a
   pixel is ink when it is white AND a dark pixel lies within about half a stroke of it: the inside of every letter
   qualifies, open sky and cloud do not. */
function inkOf(src) {
  const w = src.width, h = src.height, g0 = src.getContext('2d', {willReadFrequently: true});
  const id = g0.getImageData(0, 0, w, h), p = id.data, n = w * h;
  const white = new Uint8Array(n), dark = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const r = p[i], gg = p[i + 1], b = p[i + 2], v = (r * 3 + gg * 6 + b) / 10;
    white[j] = v > 185 && Math.max(r, gg, b) - Math.min(r, gg, b) < 70 ? 1 : 0;
    dark[j] = v < 110 ? 1 : 0;
  }
  const R = Math.max(2, Math.round(h / 2.4 * 0.13));       // about half a stroke of one line of the type
  const tmp = new Uint8Array(n), near = new Uint8Array(n);
  for (let y = 0; y < h; y++) {                             // box dilation of the dark mask, rows then columns
    let run = 0; const o = y * w;
    for (let x = 0; x < w + R; x++) {
      if (x < w) run += dark[o + x];
      if (x - 2 * R - 1 >= 0) run -= dark[o + x - 2 * R - 1];
      const at = x - R; if (at >= 0 && at < w) tmp[o + at] = run > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h + R; y++) {
      if (y < h) run += tmp[y * w + x];
      if (y - 2 * R - 1 >= 0) run -= tmp[(y - 2 * R - 1) * w + x];
      const at = y - R; if (at >= 0 && at < h) near[at * w + x] = run > 0 ? 1 : 0;
    }
  }
  /* And the sky right against the outline is white and next to dark too, which drew every letter as a white shape
     in a black blob. What is outside the lettering can be reached from the edge of the crop without crossing the
     outline; the inside of a letter cannot. Behind a dark plate nothing is reachable and every white pixel is type. */
  const out0 = new Uint8Array(n), stack = [];
  const seed = j => { if (!out0[j] && !dark[j]) { out0[j] = 1; stack.push(j); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const j = stack.pop(), x = j % w;
    if (x > 0) seed(j - 1); if (x < w - 1) seed(j + 1); if (j >= w) seed(j - w); if (j < n - w) seed(j + w);
  }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const go = out.getContext('2d'), od = go.createImageData(w, h), q = od.data;
  for (let i = 0, j = 0; j < n; i += 4, j++) { const v = white[j] && near[j] && !out0[j] ? 0 : 255; q[i] = q[i + 1] = q[i + 2] = v; q[i + 3] = 255; }
  go.putImageData(od, 0, 0);
  return out;
}
function inverted(src) {                                    // white type on anything, as dark type: the second try
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.filter = 'grayscale(1) invert(1) contrast(1.4)';
  g.drawImage(src, 0, 0);
  return c;
}

function offCard(ctx, W, H, t) {
  if (!S || !S.cal) return;                        // nothing to attribute these frames to yet
  // v2 kept end screens only after halfway through the recording, which in a set is after four battles have already
  // ended: they are kept throughout and assigned to the battle they follow, so every battle reads its own result
  S.ends.push({t, img: grab(ctx, [0, Math.round(H * 0.22), W, Math.round(H * 0.34)], 1)});
  if (S.ends.length > 24) S.ends.shift();
  // The move is announced for a moment at the start of the animation, so a crop taken on a timer mostly catches the
  // animation and not the words. Every frame of a gap is scored and the best one kept, pushed when the HUD comes
  // back: one OCR per gap, on the frame where the words were up.
  const ln = textLine(ctx, W, H);
  const G = S.gap;
  if (ln.score > G.score) { G.score = ln.score; G.t = t; G.img = bannerCrop(ctx, W, H, ln.y); }
  // and the v2 way: the fixed band, greyscale, from the first frame of the gap and then every second
  if (G.timed.length < TIMED_PER_GAP && S.timedN < MAX_TIMED && (G.tt === null || t - G.tt >= TIMED_EVERY)) {
    G.tt = t; S.timedN++;
    G.timed.push({t, url: jpeg(grab(ctx, [0, Math.round(H * TIMED[0]), W, Math.round(H * (TIMED[1] - TIMED[0]))], Math.min(0.8, 700 / W)))});
  }
}
function flushGap() {
  if (!S) return;
  const G = S.gap;
  if ((G.img || G.timed.length) && S.banners.length < MAX_BANNERS) {
    const t = G.img ? G.t : G.timed[0].t;
    S.banners.push({t, img: G.img ? jpeg(G.img) : null, timed: G.timed});
    if (S.banners.length % 5 === 0) say(`${clock(t)} ${S.banners.length} announcements grabbed to read for moves`);
  }
  S.gap = newGap();
}
const toCanvas = url => new Promise(res => {            // a stored crop back into something OCR and inkOf can read
  const im = new Image();
  im.onload = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0); res(c); };
  im.onerror = () => res(null);
  im.src = url;
});

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
function closest(raw, list) {                              // OCR text → the nearest entry in a list, or null
  const s = String(raw || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (s.length < 3) return null;
  let best = null, bd = 99;
  for (const item of list) {
    const d = lev(s, String(item).replace(/[^A-Za-z]/g, '').toUpperCase());
    if (d < bd) { bd = d; best = item; }
    if (!d) break;
  }
  return bd <= Math.max(1, Math.round(s.length * 0.25)) ? best : null;
}
function lcs(a, b) {                                        // length of the longest run of letters kept in order
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = new Uint16Array(n + 1), cur = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    const sw = prev; prev = cur; cur = sw;
  }
  return prev[n];
}
const bare = s => String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();
/* The announcement is large type over a moving battlefield, and it comes back from OCR as anything from
   "CHESNAUGHT used FRENZY PLANT" to "S dge" for Stone Edge — far past what closest() will forgive. But by the time
   the banners are read both teams are known, so the species is matched against those six and the move against that
   species' own four or five. Lists that short make "the letters that survived, in order" evidence enough, as long
   as one candidate wins clearly. */
function pick(raw, list) {
  const s = bare(raw);
  if (s.length < 3 || !list || !list.length) return null;
  const scored = list.map(x => { const t = bare(x); return {x, r: t ? lcs(s, t) / Math.max(s.length, t.length) : 0}; })
                     .sort((a, b) => b.r - a.r);
  if (scored[0].r < 0.4) return null;
  if (scored[1] && scored[1].r > scored[0].r * 0.75) return null;   // two fit equally well: say nothing
  return scored[0].x;
}
const matchSpecies = raw => closest(raw, SPECIES);
const allMoveNames = () => (typeof APP === 'object' && APP && APP.moves ? Object.values(APP.moves).map(m => m.n) : []);
const isUsed = w => { const u = w.toUpperCase(); return lev(u, 'USED') <= 1 || (u.length <= 6 && lcs(u, 'USED') >= 3); };
// DATA.stats keys carry the form: MIMIKYU_BUSTED, GALARIAN_STUNFISK. idByName() strips punctuation and collapses
// spaces, so "Mimikyu Busted" finds "Mimikyu (Busted)"; the raw key with its underscore finds nothing.
const title = s => String(s).toLowerCase().split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function movesFor(species) {                               // this species' own moves, as display names
  const P = window.Planner, id = P && P.idByName ? P.idByName(title(species)) : null;
  const e = id && typeof APP === 'object' && APP && APP.pokemon ? APP.pokemon[id] : null;
  const ids = e ? (e.charged || []).concat(e.fast || []) : [];
  return ids.map(m => (APP.moves && APP.moves[m] ? APP.moves[m].n : String(m).replace(/_/g, ' ')));
}

/* ---------- assembling the log ---------- */
/* counts only ever fall inside a battle; a fall must hold to be real. The baseline is what the first sample actually
   showed — assuming a fresh 3-a-side made a recording that starts mid-match report faints and shields it never saw. */
function events(rows) {
  const f = rows[0] || {};
  let prevT = null;
  const cur = {myMon: f.myMon !== undefined ? f.myMon : 3, oppMon: f.oppMon !== undefined ? f.oppMon : 3,
               mySh: f.mySh !== undefined ? f.mySh : 2, oppSh: f.oppSh !== undefined ? f.oppSh : 2}, run = {}, out = [];
  for (const r of rows) {
    for (const k of Object.keys(cur)) {
      const v = r[k];
      if (v >= cur[k]) { run[k] = null; continue; }
      const p = run[k];
      // A faint or a shield happens while the HUD is hidden, and the lower count is only seen once it comes back. So
      // the event is dated to when the HUD went (the last sample that still showed the old count, plus one step) —
      // which puts a faint before the Pokémon that replaces it — and `seen` keeps when the new count first showed.
      run[k] = (p && p.v === v) ? {v, n: p.n + 1, t: p.t, seen: p.seen}
        : {v, n: 1, seen: r.t, t: prevT !== null && r.t - prevT > 1 ? prevT + SAMPLE_MIN : r.t};
      if (run[k].n >= HOLD) { out.push({t: run[k].t, seen: run[k].seen, what: k, from: cur[k], to: v}); cur[k] = v; run[k] = null; }
    }
    prevT = r.t;
  }
  return out;
}

const verdict = txt => {                                   // the end screen is big, blurred type: match words loosely
  for (const w of txt.split(/[^A-Z]+/)) {
    if (w.length < 4) continue;
    if (lev(w, 'VICTORY') <= 2) return 'W';
    if (lev(w, 'EFFORT') <= 2 || lev(w, 'DEFEAT') <= 2) return 'L';
    if (lev(w, 'DRAW') <= 1) return 'D';
  }
  return null;
};
const clock = t => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };   // round the whole thing, or 59.6 s prints as 0:60
const LABEL = {mySh: 'you shielded', oppSh: 'they shielded', myMon: 'you lost a Pokémon', oppMon: 'they lost a Pokémon'};
const FILM_MAX = 80;                                       // BATTLES syncs whole: keep each timeline bounded

/* one segment of the recording — one battle — into a log entry, or null when its names could not be read */
/* One recording holds one battle unless the counts go back UP: Pokémon left and shields left only ever fall during
   a match, so a return to a full 3-a-side is the one certain sign the next battle has started. A gap in the HUD is
   not — the HUD is hidden during every charged-move animation, which is exactly where the banners come from.
   Returns index ranges into rows, one per battle. */
function splitRows(rows) {
  const out = [];
  let i0 = 0, fell = false, up = 0;
  const low = {myMon: rows[0] ? rows[0].myMon : 3, oppMon: rows[0] ? rows[0].oppMon : 3};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // a confirmed fall: the same lower count for HOLD samples in a row, the rule events() uses
    for (const k of ['myMon', 'oppMon']) {
      if (r[k] < low[k]) {
        let n = 0; for (let j = i; j < rows.length && j < i + HOLD; j++) if (rows[j][k] === r[k]) n++;
        if (n >= HOLD) { low[k] = r[k]; fell = true; }
      }
    }
    if (fell && r.myMon === 3 && r.oppMon === 3) {
      up++;
      if (up >= HOLD) {                              // a full 3v3 that holds, after something had already fallen
        const start = i - up + 1;
        if (start - i0 >= MIN_ROWS) out.push([i0, start - 1]);
        i0 = start; fell = false; up = 0; low.myMon = 3; low.oppMon = 3;
      }
    } else up = 0;
  }
  if (rows.length - i0 >= MIN_ROWS) out.push([i0, rows.length - 1]);
  return out.length ? out : [[0, rows.length - 1]];
}

/* The card reads, as who was on the field when. A card is read again every RE_READ seconds to catch a switch the ink
   profile missed, and each of those used to be logged as another send-out — "you sent Chesnaught" three times while
   Chesnaught never left. Only a change of Pokémon on a side is a stint; a read of the one already there only fills
   in a CP. A side can field three Pokémon, so a species that is read less than the three most-read ones is a misread
   of the card and goes, rather than becoming a fourth team member and a switch that never happened. */
function stintsOf(reads) {
  const out = {my: [], opp: []};
  for (const side of ['my', 'opp']) {
    const mine = reads.filter(r => r.side === side).sort((a, b) => a.t - b.t);
    const n = {}; for (const r of mine) n[r.species] = (n[r.species] || 0) + 1;
    const keep = Object.keys(n).sort((a, b) => n[b] - n[a] || mine.findIndex(r => r.species === a) - mine.findIndex(r => r.species === b)).slice(0, 3);
    for (const r of mine) {
      if (!keep.includes(r.species)) continue;
      const L = out[side], last = L[L.length - 1];
      if (last && last.species === r.species) { if (!last.cp && r.cp) last.cp = r.cp; continue; }
      L.push({t: r.t, side, species: r.species, cp: r.cp});
    }
  }
  return out;
}
// who was on that side at t: the last stint that had started by then
const activeAt = (st, side, t) => { let cur = null; for (const x of st[side]) { if (x.t <= t) cur = x; else break; } return cur; };
const chargedFor = species => {
  const P = window.Planner, id = P && P.idByName ? P.idByName(title(species)) : null;
  const e = id && typeof APP === 'object' && APP && APP.pokemon ? APP.pokemon[id] : null;
  return e ? (e.charged || []).map(m => (APP.moves && APP.moves[m] ? APP.moves[m].n : String(m).replace(/_/g, ' '))) : [];
};
/* A move name somewhere in the words, when the sentence around it did not survive: the best run of one to three
   words against a short list. Only ever used against the charged moves of the two Pokémon on the field at that moment,
   so the bar can be high and a tie still says nothing. */
function findIn(words, list) {
  let best = null, br = 0, second = 0;
  for (const x of list) {
    const t = bare(x); if (t.length < 3) continue;
    let r = 0;
    // a fragment counts when nearly all of it is in the name and it covers at least half the name: "ne Edg" is Stone Edge
    for (let i = 0; i < words.length; i++) for (let k = 1; k <= 3 && i + k <= words.length; k++) {
      const w = bare(words.slice(i, i + k).join('')), l = w.length >= 3 ? lcs(w, t) : 0;
      if (l && l / w.length >= 0.8) r = Math.max(r, l / t.length);
    }
    if (r > br) { second = br; br = r; best = x; } else if (r > second) second = r;
  }
  return br >= 0.5 && second < br * 0.8 ? best : null;
}

async function readSeg(g, file, onStep) {
  const P = window.Planner, reads = [], missed = [];       // missed: a name crop that was taken but could not be read
  for (const sh of g.shots) {
    onStep();
    const sp = matchSpecies(await ocr(sh.name, LETTERS, 7));
    if (!sp) { missed.push({t: sh.t, side: sh.side}); continue; }
    const cp = parseInt((await ocr(sh.cp, '0123456789CP cp', 7)).replace(/\D/g, ''), 10) || null;
    reads.push({t: sh.t, side: sh.side, species: sp, cp: cp >= 10 && cp <= 9999 ? cp : null});
  }
  let st = stintsOf(reads);
  const teamOf = s2 => { const out = [];
    for (const r of st[s2]) if (!out.some(x => x.species === r.species)) out.push(r);
    return out; };
  const my = teamOf('my'), opp = teamOf('opp');
  if (!my.length || !opp.length) return null;

  /* A banner names a Pokémon the cards did not give up: "Bastiodon used Stone Edge" is proof it was on the field,
     even where its own card was never legible. Which side it belongs to comes from the reader's own evidence — the
     name crop it took and failed to read nearest that banner — and the Pokémon then joins that side's team. Without
     this the move is dropped and the opponent's second and third Pokémon never reach the log at all. */
  const known = sp => my.some(x => x.species === sp) ? 'my' : opp.some(x => x.species === sp) ? 'opp' : null;
  const near = t => missed.slice().sort((a, b) => (Math.abs(t - a.t) + (a.t > t ? 60 : 0)) - (Math.abs(t - b.t) + (b.t > t ? 60 : 0)))[0];
  const whose = (sp, t) => {
    const had = known(sp); if (had) return had;
    const m = near(t), side = m ? m.side : 'opp';          // nothing to go on: a name on neither card is theirs
    if ((side === 'my' ? my : opp).length >= 3) return side;
    const entry = {t: m ? m.t : t, side, species: sp, cp: null};
    (side === 'my' ? my : opp).push(entry); reads.push(entry);
    return side;
  };

  const onField = my.concat(opp).map(x => x.species);
  /* one banner's words into {species, move}, {blocked}, or null. First the sentence: "<Pokémon> used <move>", the
     joint matched loosely ("used" survives OCR as usec, uset, uec) and the Pokémon preferably one of the two on the
     field at that moment. Failing that, a charged move of one of those two anywhere in the words — the name part is
     the first thing a blurred banner loses. */
  const parse = (txt, t) => {
    const words = txt.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    if (words.some(w => lev(w.toUpperCase(), 'BLOCKED') <= 2)) return {blocked: true};
    const act = ['my', 'opp'].map(sd => activeAt(st, sd, t + 1)).filter(Boolean).map(x => x.species);
    let j = -1;
    for (let i = 1; i < words.length - 1; i++) if (isUsed(words[i])) { j = i; break; }
    if (j > 0) {
      // the Pokémon is the word right before "used" — the v2 reader took exactly that, and a banner that opens with
      // "The opponent's" buries the name in anything longer — then the last two words, then all of them
      const before = words.slice(0, j), what = words.slice(j + 1).join('');
      let sp = null;
      for (const who2 of [before.slice(-1).join(''), before.slice(-2).join(''), before.join('')]) {
        sp = pick(who2, act) || pick(who2, onField) || matchSpecies(who2);
        if (sp) break;
      }
      if (sp) {
        const own = movesFor(sp), list = own.length ? own : allMoveNames();
        const move = pick(what, list) || closest(what, list) || findIn(words.slice(j + 1), list);
        if (move) return {species: sp, move};
      }
    }
    const opts = [];
    for (const sp of act) for (const m of chargedFor(sp)) opts.push({sp, m});
    const move = findIn(words, [...new Set(opts.map(o => o.m))]);
    if (!move) return null;
    const who = opts.filter(o => o.m === move).map(o => o.sp);
    return new Set(who).size === 1 ? {species: who[0], move} : null;   // both on the field know it: can't say whose
  };

  const moves = [], unread = [];                           // unread: what OCR made of the banners that said nothing
  const WL = LETTERS + " ,!'";
  for (const b of g.banners) {
    onStep();
    // the tries for one gap, cheapest-to-right first: the best line as black ink, the v2 band crops in time order,
    // and the best line inverted. The first that says something settles the gap.
    const best = b.img ? await toCanvas(b.img) : null;
    const tries = [];
    if (best) tries.push({t: b.t, get: () => inkOf(best)});
    for (const x of b.timed || []) tries.push({t: x.t, get: () => toCanvas(x.url)});
    if (best) tries.push({t: b.t, get: () => inverted(best)});
    let got = null, at = b.t, raw = '';
    for (const tr of tries) {
      const img = await tr.get(); if (!img) continue;
      const txt = (await ocr(img, WL, 6)).replace(/\s+/g, ' ').trim();
      if (!raw && txt.replace(/[^A-Za-z]/g, '').length >= 4) raw = txt;
      const p = parse(txt, tr.t);
      if (p && p.blocked) { const m = moves[moves.length - 1]; if (m && tr.t - m.t < 8) m.blocked = true; continue; }
      if (p) { got = p; at = tr.t; break; }
    }
    if (!got) { if (raw && unread.length < 12) unread.push(`${clock(b.t)} ${raw.slice(0, 60)}`); continue; }
    const sp = got.species, move = got.move;
    if (moves.some(m => m.species === title(sp) && m.move === move && at - m.t < 4)) continue;
    moves.push({t: at, by: whose(sp, at), species: title(sp), move, blocked: false});
  }
  st = stintsOf(reads);

  const ev = events(g.rows), first = g.rows[0] || {}, last = g.rows[g.rows.length - 1] || {};
  let result = null, endT = null;
  for (const e of g.ends.slice().reverse()) {
    onStep();
    const r = verdict((await ocr(e.img, '', 11)).toUpperCase());
    if (r) { result = r; endT = e.t; break; }
  }
  // no end screen read: the side that was down to its last Pokémon when the HUD went for good is the one that lost
  if (!result && last.myMon === 1 && last.oppMon > 1) result = 'L';
  if (!result && last.oppMon === 1 && last.myMon > 1) result = 'W';

  /* The last faint is never in the counts: when a side's last Pokémon goes, the HUD goes with it, and a row with
     no pokéball on one side is exactly what frame() throws away as "not the HUD". A loss that did not run the clock
     out is that last Pokémon fainting, so it is added — the log said "fainted: you 2" for a battle lost 3–2. */
  const battleT = (last.t || 0) - (first.t || 0), timedOut = battleT >= TIMER;
  const lastT = (last.t || 0) + 0.5;
  if (!timedOut && result === 'L' && last.myMon === 1) ev.push({t: lastT, what: 'myMon', from: 1, to: 0, end: true});
  if (!timedOut && result === 'W' && last.oppMon === 1) ev.push({t: lastT, what: 'oppMon', from: 1, to: 0, end: true});

  // A charged move and the faint (or shield) it causes share one gap in the HUD, and the gap's start is all the counts
  // can date it to — so it would read as fainting before the move that did it. Anything announced inside the gap
  // came first.
  for (const e of ev) {
    const inGap = moves.filter(m => m.t >= e.t && m.t <= (e.seen || e.t));
    if (inGap.length) e.t = inGap[inGap.length - 1].t + SAMPLE_MIN;
  }
  // a shield the counts saw was spent on the charged move just announced on the other side
  for (const e of ev) {
    if (!/Sh$/.test(e.what)) continue;
    const by = e.what === 'mySh' ? 'opp' : 'my';
    const m = moves.filter(x => x.by === by && x.t >= e.t - 12 && x.t <= (e.seen || e.t) + 1).pop();
    if (m) { m.blocked = true; e.move = m.move; }
  }

  const nameOf = r => title(r.species), id = n => (P && P.idByName ? P.idByName(n) : null);
  const myIds = my.map(r => id(nameOf(r))).filter(Boolean), oppIds = opp.map(r => id(nameOf(r))).filter(Boolean);
  const whoseSide = side => side === 'my' ? 'your' : 'their';
  const faintOf = (side, t) => { const a = activeAt(st, side, t - 1.5); return a ? nameOf(a) : null; };   // on the field before the fall
  const film = [];
  for (const side of ['my', 'opp']) st[side].forEach((r, i) => {
    // after a faint on that side it is a send-out; with nobody fainting, the player chose to switch
    const prev = st[side][i - 1];
    const fell = prev && ev.some(e => e.what === side + 'Mon' && e.t > prev.t && e.t <= r.t + 3);
    const verb = !prev || fell ? (side === 'my' ? 'you sent' : 'they sent') : (side === 'my' ? 'you switched to' : 'they switched to');
    film.push({t: r.t, text: `${clock(r.t)} ${verb} ${nameOf(r)}${r.cp ? ' (' + r.cp + ')' : ''}`});
  });
  for (const e of ev) {
    let text;
    if (/Mon$/.test(e.what)) { const side = e.what.slice(0, -3), nm = faintOf(side, e.t);
      text = nm ? `${whoseSide(side)} ${nm} fainted` : LABEL[e.what]; }
    else text = `${e.what === 'mySh' ? 'you shielded' : 'they shielded'}${e.move ? ' ' + e.move : ''} (${e.to} left)`;
    film.push({t: e.t, text: `${clock(e.t)} ${text}`, o: /Mon$/.test(e.what) ? -1 : 1});   // the faint, then who came in
  }
  for (const m of moves) film.push({t: m.t, text: `${clock(m.t)} ${m.species} used ${m.move}${m.blocked ? ' — blocked' : ''}`});
  film.sort((a, b) => a.t - b.t || (a.o || 0) - (b.o || 0));
  if (result) { const t = endT !== null ? endT : lastT;
    film.push({t, text: `${clock(t)} ${result === 'W' ? 'victory' : result === 'L' ? 'good effort — a loss' : 'a draw'}${timedOut ? ', on the clock' : ''}`}); }
  const relMoves = moves.map(m => ({t: Math.round(m.t * 10) / 10, by: m.by, species: m.species, move: m.move, blocked: m.blocked}));
  const fell = k => ev.filter(e => e.what === k).reduce((n, e) => n + (e.from - e.to), 0);
  // a shield spent in the last second or two of the HUD has no HOLD samples left to confirm it: two closing rows that
  // agree are enough there
  const tail = k => { const a = g.rows[g.rows.length - 1], b = g.rows[g.rows.length - 2];
    return a && b && a[k] === b[k] && first[k] !== undefined ? Math.max(0, first[k] - a[k]) : 0; };
  const used = k => Math.max(fell(k), tail(k));

  return {
    t: ((file && file.lastModified) || Date.now()) + Math.round((g.rows[0] ? g.rows[0].t : 0) * 1000),  // battles in a set keep their order
    result,
    ids: myIds.length === 3 ? myIds : null,                 // a complete trio, which the stats need
    myIds,                                                  // everything the read resolved: this is what matches a saved party
    team: (P && P.partyFor) ? P.partyFor(myIds) : null,
    lead: oppIds[0] || null,
    opp: oppIds,
    oppNames: opp.map(nameOf),
    myNames: my.map(nameOf),
    myLead: myIds[0] || null,
    // from what the counts started at, so a recording that begins mid-match does not charge shields it never saw
    shields: {me: Math.min(2, (2 - (first.mySh !== undefined ? first.mySh : 2)) + used('mySh')),
              opp: Math.min(2, (2 - (first.oppSh !== undefined ? first.oppSh : 2)) + used('oppSh'))},
    fainted: {me: Math.min(3, (3 - (first.myMon || 3)) + fell('myMon')), opp: Math.min(3, (3 - (first.oppMon || 3)) + fell('oppMon'))},
    moves: relMoves,
    film: film.slice(0, FILM_MAX).map(f => f.text),
    // everything the read found, kept as data and not only as sentences: the AI review and any later screen can use it
    filmData: {
      reads: st.my.concat(st.opp).sort((a, b) => a.t - b.t).map(r => ({t: Math.round(r.t * 10) / 10, side: r.side, species: r.species, cp: r.cp})),
      events: ev.map(e => ({t: Math.round(e.t * 10) / 10, what: e.what, from: e.from, to: e.to})),
      moves: relMoves,
      unread,
      samples: g.rows.length, dur: Math.round(g.rows[g.rows.length - 1].t - g.rows[0].t)
    },
    src: 'film'
  };
}

/* every battle the recording holds, oldest first, handed to the battle log as drafts. Null when none could be read. */
/* the shots, banners and end frames that belong to one battle: by timestamp, with the end frames that follow it
   (the VICTORY / DEFEAT screen comes after the last HUD sample of the battle it belongs to) */
function sliceFor(rows, i0, i1, nextT) {
  const t0 = rows[i0].t, t1 = rows[i1].t, hi = nextT === undefined ? Infinity : nextT;
  return {rows: rows.slice(i0, i1 + 1),
          shots: S.shots.filter(x => x.t >= t0 && x.t <= t1),
          banners: S.banners.filter(x => x.t >= t0 && x.t < hi),
          ends: S.ends.filter(x => x.t > t1 && x.t < hi)};
}

async function finish(file) {
  if (S) flushGap();                                 // a recording that ends mid-animation still has its last banner
  LAST = report();
  if (!seen()) { S = null; return null; }
  const ranges = splitRows(S.rows);
  const segs = ranges.map(([i0, i1], k) => sliceFor(S.rows, i0, i1, ranges[k + 1] ? S.rows[ranges[k + 1][0]].t : undefined));
  const P = window.Planner;
  status(segs.length > 1 ? `Reading ${segs.length} battles from the recording…` : 'Reading the battle from the recording…');
  say(segs.length > 1 ? `${segs.length} battles in the recording — reading the names and moves` : 'reading the names and moves');
  const total = segs.reduce((n, g) => n + g.shots.length + g.banners.length + g.ends.length, 0);
  let done = 0;
  const onStep = () => progress(done++ / Math.max(1, total));
  const out = [];
  for (const g of segs) {
    let e = null;
    try { e = await readSeg(g, file, onStep); } catch (err) { console.error(err); }
    if (e) out.push(e);
  }
  S = null;
  if (LAST) LAST.entries = out.length;
  if (!out.length) return null;
  if (P && P.draftBattles) P.draftBattles(out);      // nothing is logged yet: the page shows the read and the player saves it
  const one = out[0], many = out.length > 1, nm2 = out.reduce((n, e) => n + (e.moves ? e.moves.length : 0), 0);
  for (const e of out) say(`read: ${e.myNames.join(' / ')} vs ${e.oppNames.join(' / ')}${e.result ? ' · ' + (e.result === 'W' ? 'win' : e.result === 'L' ? 'loss' : 'draw') : ''}`);
  gain('note', many ? `${out.length} battles read from the recording, waiting to be saved · ${nm2} moves`
                    : `battle read from the recording: ${one.myNames.join(' / ')} vs ${one.oppNames.join(' / ')} · ${nm2} moves`);
  status(many ? `${out.length} battles read · check the team and save them`
              : `${one.result === 'W' ? '✓ Win' : one.result === 'L' ? '✕ Loss' : 'Battle'} vs ${one.oppNames.join(' / ')} read · check the team and save it`);
  return out;
}

window.Film = {start, stop, frame, finish, seen, report, calibrate, events, matchSpecies, movesFor, textLine, bannerCrop, inkOf,
               shotCount: () => (S ? S.shots.length : 0), splitRows,
               segCount: () => (S && S.rows.length >= MIN_ROWS ? splitRows(S.rows).length : 0)};
})();
