#!/usr/bin/env node
/* Build data/matrix-<league>.json: a full matchup matrix simulated with PvPoke's own battle engine (vendor/pvpoke, MIT).
   rows = the meta pool ∪ top N ranked ∪ your roster species; cols = the meta pool ∪ top M; scenarios 0-0, 1-1, 2-2 shields.
   Ratings are PvPoke's battle rating (0..1000, floor((hp left + damage dealt) * 500)) with PvPoke's default IVs and movesets,
   so they match pvpoke.com's matrix and battle pages.

     node scripts/build_matrix.mjs --league great [--cols 150] [--rows 300] [--gm /tmp/gamemaster.min.json]
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GM_URL = 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null).filter(Boolean));
const league = args.league || 'great', COLS = +(args.cols || 150), ROWS = +(args.rows || 300);
const SCENARIOS = [[0, 0], [1, 1], [2, 2]];

const app = JSON.parse(fs.readFileSync(path.join(ROOT, `data/app-${league}.json`), 'utf8'));
const cp = app.league.cp, cupName = app.league.cup || 'all';
let gmJson;
if (args.gm && fs.existsSync(args.gm)) gmJson = JSON.parse(fs.readFileSync(args.gm, 'utf8'));
else { const r = await fetch(GM_URL); if (!r.ok) throw new Error('gamemaster ' + r.status); gmJson = await r.json(); if (args.gm) fs.writeFileSync(args.gm, JSON.stringify(gmJson)); }

/* ---- a tiny browser for PvPoke's scripts: jQuery stubs, settings, a synchronous gamemaster "download" ---- */
const $ = () => ({ insertAfter() {}, eq() { return this; } });
let deliverGm = null;
$.ajax = o => { deliverGm = () => o.success(gmJson); };   // GameMaster defines its methods after the ajax call, so deliver the data once getInstance() has returned
$.getJSON = () => {}; $.each = (a, f) => { (Array.isArray(a) ? a : Object.values(a)).forEach((v, i) => f(i, v)); };
const ctx = vm.createContext({
  console: { log() {}, warn() {}, error: console.error }, $, host: 'localhost', webRoot: '', siteVersion: '',
  settings: { gamemaster: 'gamemaster', hardMovesetLinks: false, colorblindMode: false, matrixDirection: 'row' },
  window: { localStorage: { getItem: () => null, setItem() {} } },
  DecisionOption: class DecisionOption { constructor(name, weight) { this.name = name; this.weight = weight; } },
  Math, Date, JSON, Object, Array, Number, String, parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
});
for (const f of ['GameMaster.js', 'Pokemon.js', 'TimelineEvent.js', 'TimelineAction.js', 'ActionLogic.js', 'DamageCalculator.js', 'Battle.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/pvpoke', f), 'utf8'), ctx, { filename: f });
const gm = ctx.GameMaster.getInstance();
if (deliverGm) deliverGm();
if (!gm.data || !gm.data.pokemon) throw new Error('gamemaster did not load in the sandbox');
const battle = new ctx.Battle();
battle.setCP(cp);
const cupDef = (gm.data.cups || []).find(c => c.name === cupName);
if (cupDef && cupName !== 'all') battle.setCup(cupName);
if (cupDef && cupDef.levelCap) battle.setLevelCap(cupDef.levelCap);

/* ---- who fights whom ---- */
const byRank = Object.entries(app.pokemon).sort((a, b) => a[1].rank - b[1].rank).map(([id]) => id);
const uniq = a => [...new Set(a)];
const cols = uniq([...(app.meta || []), ...byRank.slice(0, COLS)]);
let rosterIds = [];
try { const ro = JSON.parse(fs.readFileSync(path.join(ROOT, `data/roster-${league}.json`), 'utf8')); rosterIds = Object.keys(ro.owned || {}).concat(Object.keys(ro.pending || {})); } catch {}
const rows = uniq([...cols, ...byRank.slice(0, ROWS), ...rosterIds.filter(id => app.pokemon[id])]);

const mons = new Map(), movesUsed = {};
function mon(id) {
  if (mons.has(id)) return mons.get(id);
  const p = new ctx.Pokemon(id, 0, battle);
  if (!p || !p.speciesId) { mons.set(id, null); return null; }
  p.initialize(cp);
  const ms = app.pokemon[id].moveset || [];
  if (ms[0]) p.selectMove('fast', ms[0]);
  if (ms[1]) p.selectMove('charged', ms[1], 0);
  if (ms[2]) p.selectMove('charged', ms[2], 1);
  movesUsed[id] = [p.fastMove && p.fastMove.moveId, ...(p.chargedMoves || []).map(m => m.moveId)].filter(Boolean);
  mons.set(id, p); return p;
}
function fight(a, b, shields) {
  battle.setNewPokemon(a, 0, false); battle.setNewPokemon(b, 1, false);
  a.reset(); b.reset(); a.setShields(shields); b.setShields(shields); a.startEnergy = 0; b.startEnergy = 0;
  battle.simulate();
  return Math.max(0, Math.min(1000, Math.floor((a.hp / a.stats.hp + (b.stats.hp - b.hp) / b.stats.hp) * 500)));
}

const colIdx = new Map(cols.map((c, i) => [c, i])), rowIdx = new Map(rows.map((r, i) => [r, i]));
const data = new Uint16Array(rows.length * cols.length * SCENARIOS.length);
const at = (r, c, s) => (r * cols.length + c) * SCENARIOS.length + s;
const t0 = Date.now(); let n = 0;
for (let r = 0; r < rows.length; r++) {
  const a = mon(rows[r]); if (!a) continue;
  for (let c = 0; c < cols.length; c++) {
    const b = mon(cols[c]); if (!b) continue;
    if (rows[r] === cols[c]) { for (let s = 0; s < SCENARIOS.length; s++) data[at(r, c, s)] = 500; continue; }
    const rc = colIdx.get(rows[r]), cr = rowIdx.get(cols[c]);            // both in the pool and the mirror cell is done: symmetric
    if (rc !== undefined && cr !== undefined && cr < r) { for (let s = 0; s < SCENARIOS.length; s++) data[at(r, c, s)] = 1000 - data[at(cr, rc, s)]; continue; }
    for (let s = 0; s < SCENARIOS.length; s++) { data[at(r, c, s)] = fight(a, b, SCENARIOS[s][0]); n++; }
  }
  if (r % 25 === 0) process.stderr.write(`  ${r}/${rows.length} rows, ${n} battles, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
process.stderr.write(`${n} battles in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

/* ---- sanity check against PvPoke's published matchups (overall rankings, 1-1 shields is their headline scenario) ---- */
const diffs = [];
for (const id of rows.slice(0, 60)) {
  const e = app.pokemon[id]; if (!e || !rowIdx.has(id)) continue;
  for (const [opp, rating] of e.matchups || []) { if (!colIdx.has(opp)) continue; diffs.push(Math.abs(data[at(rowIdx.get(id), colIdx.get(opp), 1)] - rating)); }
}
diffs.sort((a, b) => a - b);
const median = diffs.length ? diffs[Math.floor(diffs.length / 2)] : null;
process.stderr.write(`check vs published matchups: ${diffs.length} cells, median |diff| ${median}, 90th pct ${diffs.length ? diffs[Math.floor(diffs.length * 0.9)] : '-'}\n`);
if (median !== null && median > 30) process.stderr.write(`WARNING: the matrix disagrees with PvPoke's published matchups (median diff ${median}); the app ignores a matrix whose check.median is above 30\n`);

const out = {
  league, cp, cup: cupName, rev: fs.existsSync(path.join(ROOT, 'vendor/pvpoke/REVISION')) ? fs.readFileSync(path.join(ROOT, 'vendor/pvpoke/REVISION'), 'utf8').trim() : null,
  gamemasterTimestamp: gmJson.timestamp || app.gamemasterTimestamp, generatedAt: new Date().toISOString().slice(0, 19) + 'Z',
  scenarios: SCENARIOS.map(s => s.join('-')), cols, rows, moves: Object.fromEntries(rows.map(id => [id, movesUsed[id] || []])),
  check: { cells: diffs.length, median }, data: Buffer.from(data.buffer).toString('base64'),
};
const outPath = path.join(ROOT, `data/matrix-${league}.json`);
fs.writeFileSync(outPath, JSON.stringify(out));
process.stderr.write(`wrote data/matrix-${league}.json: ${rows.length}×${cols.length}×${SCENARIOS.length}, ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB\n`);
