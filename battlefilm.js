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
const NAME_CHANGE = 0.34;       // ink-profile distance that means a different name is in the card
const MAX_OCR = 30, MAX_BANNERS = 60;              // across the recording; one match is easily 50 banners
const MIN_ROWS = 8;             // samples a battle needs before it counts as one at all
const MISS_MAX = 12;            // calibrate() reads a fifth of the screen: after this many misses, try every 8th sample
const MISS_EVERY = 8;

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
  return {bins, ink: tot};
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
function start(dur) {
  S = {dur, cal: null, pending: null, rows: [], shots: [], banners: [], ends: [],
       last: {my: null, opp: null}, lastT: -9, gapT: -9, frames: 0, miss: 0};
}
function stop() { LAST = report(); S = null; }     // scanVideo failed or finished: drop the queued crops, keep the diagnostics
const seen = () => !!(S && S.rows.length >= MIN_ROWS);
let LAST = null;                                   // the last read's diagnostics, so a failed import can say why
function report() {
  if (!S) return LAST;
  return {frames: S.frames, cal: !!S.cal, miss: S.miss, rows: S.rows.length, shots: S.shots.length,
          banners: S.banners.length, good: S.rows.length >= MIN_ROWS ? splitRows(S.rows).length : 0,
          entries: 0, dur: Math.round(S.dur)};
}

function frame(ctx, W, H, t) {
  if (!S || t - S.lastT < SAMPLE_MIN) return;
  S.lastT = t; S.frames++;
  if (!S.cal) {                                            // two calibrations that agree, then it is frozen
    // an ordinary swipe recording never calibrates, and calibrate() reads a fifth of the screen: back off rather
    // than pay for it on every sample, but keep trying so a battle that starts late is still caught
    if (S.miss >= MISS_MAX && S.frames % MISS_EVERY) return offCard(ctx, W, H, t);
    const c = calibrate(ctx, W, H);
    if (!c) { S.miss++; return offCard(ctx, W, H, t); }
    if (S.pending && Math.abs(S.pending.my.x - c.my.x) < W * 0.01 && Math.abs(S.pending.row - c.row) < H * 0.01) { S.cal = c; S.miss = 0; }
    else { S.pending = c; return offCard(ctx, W, H, t); }
  }
  const row = S.cal.row, w = S.cal.w;
  const myMon = count(ctx, S.cal.my, BALLS, isRed, true, row, w);
  const oppMon = count(ctx, S.cal.opp, BALLS, isRed, false, row, w);
  if (myMon < 1 || oppMon < 1) return offCard(ctx, W, H, t);   // a charged-move animation, a switch sheet, the end
  S.rows.push({t, myMon, oppMon,
    mySh: count(ctx, S.cal.my, SHIELDS, isPink, true, row, w),
    oppSh: count(ctx, S.cal.opp, SHIELDS, isPink, false, row, w)});
  for (const side of ['my', 'opp']) {
    const c = S.cal[side], mine = side === 'my', nr = rect(c, 0.02, 0.60, mine, row, w), p = profile(ctx, nr);
    if (p.ink < 40) continue;
    if (profileDist(p, S.last[side]) > NAME_CHANGE && S.shots.length < MAX_OCR)
      S.shots.push({t, side, name: grab(ctx, nr, 3), cp: grab(ctx, rect(c, 0.60, 0.98, mine, row, w), 3)});
    S.last[side] = p;
  }
}

// The HUD is hidden exactly when something is being announced: a charged move, a switch-in, a shield. Those
// frames are useless for counting, which makes them the free place to grab the banner — no detector needed.
function offCard(ctx, W, H, t) {
  if (!S || !S.cal) return;                        // nothing to attribute these frames to yet
  // v2 kept end screens only after halfway through the recording, which in a set is after four battles have already
  // ended: they are kept throughout and assigned to the battle they follow, so every battle reads its own result
  S.ends.push({t, img: grab(ctx, [0, Math.round(H * 0.22), W, Math.round(H * 0.34)], 1)});
  if (S.ends.length > 24) S.ends.shift();
  if (t - S.gapT < 1.2 || S.banners.length >= MAX_BANNERS) return;
  S.gapT = t;
  S.banners.push({t, img: grab(ctx, [0, Math.round(H * 0.20), W, Math.round(H * 0.28)], 0.8)});
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
const matchSpecies = raw => closest(raw, SPECIES);
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
  const cur = {myMon: f.myMon !== undefined ? f.myMon : 3, oppMon: f.oppMon !== undefined ? f.oppMon : 3,
               mySh: f.mySh !== undefined ? f.mySh : 2, oppSh: f.oppSh !== undefined ? f.oppSh : 2}, run = {}, out = [];
  for (const r of rows) for (const k of Object.keys(cur)) {
    const v = r[k];
    if (v >= cur[k]) { run[k] = null; continue; }
    const p = run[k];
    run[k] = (p && p.v === v) ? {v, n: p.n + 1} : {v, n: 1};
    if (run[k].n >= HOLD) { out.push({t: r.t, what: k, from: cur[k], to: v}); cur[k] = v; run[k] = null; }
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
const clock = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
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

async function readSeg(g, file, onStep) {
  const P = window.Planner, reads = [];
  for (const sh of g.shots) {
    onStep();
    const sp = matchSpecies(await ocr(sh.name, LETTERS, 7));
    if (!sp) continue;
    const cp = parseInt((await ocr(sh.cp, '0123456789CP cp', 7)).replace(/\D/g, ''), 10) || null;
    reads.push({t: sh.t, side: sh.side, species: sp, cp});
  }
  const teamOf = s2 => { const out = [];
    for (const r of reads) if (r.side === s2 && !out.some(x => x.species === r.species)) out.push(r);
    return out; };
  const my = teamOf('my'), opp = teamOf('opp');
  if (!my.length || !opp.length) return null;
  const whose = sp => my.some(x => x.species === sp) ? 'my' : opp.some(x => x.species === sp) ? 'opp' : null;

  const moves = [];                                        // "Chesnaught used Frenzy Plant!" then "BLOCKED!"
  for (const b of g.banners) {
    onStep();
    const txt = (await ocr(b.img, LETTERS + ' ,!', 6)).replace(/\s+/g, ' ').trim();
    if (/BLOCKED/i.test(txt)) { const m = moves[moves.length - 1]; if (m && b.t - m.t < 6) m.blocked = true; continue; }
    const hit = /([A-Za-z]{4,})\s+used\s+([A-Za-z][A-Za-z ]{2,})/.exec(txt);
    if (!hit) continue;
    const sp = matchSpecies(hit[1]); if (!sp) continue;
    const move = closest(hit[2], movesFor(sp)) || hit[2].trim();
    if (moves.some(m => m.species === title(sp) && m.move === move && b.t - m.t < 4)) continue;
    moves.push({t: b.t, by: whose(sp), species: title(sp), move, blocked: false});
  }

  const ev = events(g.rows), last = g.rows[g.rows.length - 1] || {};
  let result = null;
  for (const e of g.ends.slice().reverse()) {
    onStep();
    const r = verdict((await ocr(e.img, '', 11)).toUpperCase());
    if (r) { result = r; break; }
  }
  if (!result) result = last.myMon === 0 ? 'L' : last.oppMon === 0 ? 'W' : null;

  const nameOf = r => title(r.species), id = n => (P && P.idByName ? P.idByName(n) : null);
  const myIds = my.map(r => id(nameOf(r))).filter(Boolean), oppIds = opp.map(r => id(nameOf(r))).filter(Boolean);
  const film = [];
  for (const r of reads) film.push({t: r.t, text: `${clock(r.t)} ${r.side === 'my' ? 'you sent' : 'they sent'} ${nameOf(r)}${r.cp ? ' (' + r.cp + ')' : ''}`});
  for (const e of ev) film.push({t: e.t, text: `${clock(e.t)} ${LABEL[e.what]}${/Sh$/.test(e.what) ? ` (${e.to} left)` : ''}`});
  for (const m of moves) film.push({t: m.t, text: `${clock(m.t)} ${m.species} used ${m.move}${m.blocked ? ' — blocked' : ''}`});
  film.sort((a, b) => a.t - b.t);
  const relMoves = moves.map(m => ({t: Math.round(m.t * 10) / 10, by: m.by, species: m.species, move: m.move, blocked: m.blocked}));

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
    shields: {me: 2 - (last.mySh !== undefined ? last.mySh : 2), opp: 2 - (last.oppSh !== undefined ? last.oppSh : 2)},
    fainted: {me: 3 - (last.myMon || 0), opp: 3 - (last.oppMon || 0)},
    moves: relMoves,
    film: film.slice(0, FILM_MAX).map(f => f.text),
    // everything the read found, kept as data and not only as sentences: the AI review and any later screen can use it
    filmData: {
      reads: reads.map(r => ({t: Math.round(r.t * 10) / 10, side: r.side, species: r.species, cp: r.cp})),
      events: ev.map(e => ({t: Math.round(e.t * 10) / 10, what: e.what, from: e.from, to: e.to})),
      moves: relMoves,
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
  LAST = report();
  if (!seen()) { S = null; return null; }
  const ranges = splitRows(S.rows);
  const segs = ranges.map(([i0, i1], k) => sliceFor(S.rows, i0, i1, ranges[k + 1] ? S.rows[ranges[k + 1][0]].t : undefined));
  const P = window.Planner;
  status(segs.length > 1 ? `Reading ${segs.length} battles from the recording…` : 'Reading the battle from the recording…');
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
  gain('note', many ? `${out.length} battles read from the recording, waiting to be saved · ${nm2} moves`
                    : `battle read from the recording: ${one.myNames.join(' / ')} vs ${one.oppNames.join(' / ')} · ${nm2} moves`);
  status(many ? `${out.length} battles read · check the team and save them`
              : `${one.result === 'W' ? '✓ Win' : one.result === 'L' ? '✕ Loss' : 'Battle'} vs ${one.oppNames.join(' / ')} read · check the team and save it`);
  return out;
}

window.Film = {start, stop, frame, finish, seen, report, calibrate, events, matchSpecies, movesFor,
               shotCount: () => (S ? S.shots.length : 0), splitRows,
               segCount: () => (S && S.rows.length >= MIN_ROWS ? splitRows(S.rows).length : 0)};
})();
