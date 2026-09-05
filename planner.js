/* PokeScan planner — Today view, coverage drill-down and roster board.
   Uses globals from index.html: results, save, render, DATA, APP, PVP, $, calcCP, calcHP, cpmAt,
   pvpRank, costTo, maxLevelUnderCap, pct, shareFile, status, pvpokeIdFor, evoBaseStats, showTab. */
(function () {
'use strict';
const CAP = 1500;
const ROSTER = Object.assign({owned: {}, pending: {}, candidates: {}, tagged: {}, moves: {}, exclude: [], done: {}, snooze: {}, log: []},
                             JSON.parse(localStorage.getItem('roster') || '{}'));
const UI = {selected: null, showAll: false, expect: null, mon: null, monFrom: 'roster',
            build: JSON.parse(localStorage.getItem('build') || '{"slots":[null,null,null],"moves":{}}'), metaPanel: 'build', rankQ: '', rankType: '', rankLimit: 50};
const saveBuild = () => localStorage.setItem('build', JSON.stringify(UI.build));
const TYPES18 = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
const WEEK = 7 * 864e5;
const when = t => new Date(t).toLocaleDateString('nl-NL', {day: 'numeric', month: 'short'});
let dirty = true, model = null;
const saveRoster = () => { localStorage.setItem('roster', JSON.stringify(ROSTER)); if (window.Sync) Sync.touch('roster'); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const nm = id => (APP.pokemon[id] || APP.unranked[id] || {name: id}).name;
const mvName = m => (APP.moves[m] || {n: m}).n;
const fmt = n => n.toLocaleString('nl');
const bestOf = r => r.combos.reduce((a, b) => pct(b) > pct(a) ? b : a);
const norm = t => (t || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/ +/g, ' ').trim();

/* ---------- roster derived from scans ---------- */
function detectMoves(id, txt) {
  const e = APP.pokemon[id], t = ' ' + norm(txt) + ' ';
  const has = m => APP.moves[m] && t.includes(' ' + norm(APP.moves[m].n) + ' ');
  const fast = e.fast.filter(has), ch = e.charged.filter(has);
  if (!txt || (!fast.length && !ch.length)) return e.moveset.slice();
  const ms = [fast[0] || e.moveset[0], ...ch.slice(0, 2)];
  for (const m of e.moveset.slice(1)) if (ms.length < 3 && !ms.includes(m)) ms.push(m);
  return ms;
}
function scanId(r) {
  if (!r.combos || !r.combos.length || !DATA.stats[r.species]) return null;
  const best = bestOf(r);
  return {best, base: best[4] || DATA.stats[r.species][0], id: pvpokeIdFor(r.species, best[4] || DATA.stats[r.species][0])};
}
function movesFor(r, id) { return (r && r.moves && r.moves.length) ? r.moves : (ROSTER.moves[id] || detectMoves(id, r && r.txt)); }
function rosterOwned() {
  const own = {};
  if (!APP) return own;
  for (const r of results) {
    const s = scanId(r); if (!s || !s.id || !r.cp || r.cp > CAP || r.bench || ROSTER.exclude.includes(s.id)) continue;
    const {best, base, id} = s;
    // a pre-evolution whose evolution fits under the cap is a pending piece, not a team member
    if ((APP.pokemon[id].evo || []).some(ev => { const eb = APP.pokemon[ev] && evoBaseStats(ev);
        return eb && calcCP(eb, best[1], best[2], best[3], cpmAt(best[0])) <= CAP; })) continue;
    const gl = pvpRank(base, best[1], best[2], best[3], CAP);
    if (!own[id] || gl.n < own[id].glRank)
      own[id] = {id, key: r.key, glRank: gl.n, glPct: gl.pct, cp: r.cp, level: best[0], toLevel: gl.lv, toCP: gl.cp,
                 ivs: [best[1], best[2], best[3]], txt: r.txt, scan: r, moves: movesFor(r, id)};
  }
  for (const [id, mv] of Object.entries(ROSTER.owned))
    if (!own[id] && APP.pokemon[id] && !ROSTER.exclude.includes(id)) own[id] = {id, manual: true, moves: ROSTER.moves[id] || mv || APP.pokemon[id].moveset.slice()};
  return own;
}
function autoEvolutions(own) {
  const out = {};
  for (const r of results) {
    const s = scanId(r); if (!s || !s.id || r.bench) continue;
    for (const evo of (APP.pokemon[s.id].evo || [])) {
      if (!APP.pokemon[evo] || own[evo] || ROSTER.exclude.includes(evo)) continue;
      const eb = evoBaseStats(evo); if (!eb || calcCP(eb, s.best[1], s.best[2], s.best[3], cpmAt(s.best[0])) > CAP) continue;
      const rk = pvpRank(eb, s.best[1], s.best[2], s.best[3], CAP);
      if (!out[evo] || rk.n < out[evo].glRank) out[evo] = {from: APP.pokemon[s.id].name, fromId: s.id, glRank: rk.n, glPct: rk.pct, level: s.best[0], toLevel: rk.lv, toCP: rk.cp, cpNow: calcCP(eb, s.best[1], s.best[2], s.best[3], cpmAt(s.best[0]))};
    }
  }
  return out;
}
function rosterInput() {
  const own = rosterOwned(), auto = autoEvolutions(own);
  const pending = {}; for (const k of Object.keys(auto)) pending[k] = ROSTER.moves[k] || null;
  for (const [k, v] of Object.entries(ROSTER.pending)) if (!own[k]) pending[k] = ROSTER.moves[k] || v || null;
  const owned = {}; for (const o of Object.values(own)) owned[o.id] = o.moves;
  const candidates = {}; for (const k of Object.keys(ROSTER.candidates)) if (!own[k] && !(k in pending)) candidates[k] = ROSTER.moves[k] || null;
  return {league: 'great', owned, pending, candidates, tagged: ROSTER.tagged, _own: own, _auto: auto};
}
function compute() {
  const ri = rosterInput(), L = PVP.fromRoster(APP, ri), rep = L.report(ri, 10);
  const ownedIds = Object.keys(ri.owned);
  rep.todayAll = L.bestTrios(ownedIds, 12);
  rep.gains = L.marginal(Object.keys(ri.pending).concat(Object.keys(ri.candidates)), ownedIds);
  model = {ri, L, rep, own: ri._own, auto: ri._auto};
  dirty = false;
  return model;
}
const M = () => (dirty || !model) ? compute() : model;

/* ---------- evolve-safe CP cap for a wild pre-evolution (IV-agnostic) ---------- */
const capCache = {};
function baseFor(id) {
  const forms = DATA.stats[id.split('_')[0].toUpperCase()]; if (!forms) return null;
  const info = APP.pokemon[id] || APP.unranked[id] || {types: []}, want = info.types.slice().sort().join('/');
  return forms.find(f => [f[3], f[4]].filter(Boolean).map(t => t.toLowerCase()).sort().join('/') === want) || forms[0];
}
function safeCap(preId, evoId) {
  const k = preId + '>' + evoId; if (capCache[k]) return capCache[k];
  const pre = baseFor(preId), evo = evoBaseStats(evoId); if (!pre || !evo) return null;
  let minBad = Infinity, maxOk = 0;
  for (let a = 0; a < 16; a++) for (let d = 0; d < 16; d++) for (let s = 0; s < 16; s++) for (let l = 2; l <= 70; l++) {
    const m = cpmAt(l / 2), cpre = calcCP(pre, a, d, s, m);
    if (calcCP(evo, a, d, s, m) <= CAP) { if (cpre > maxOk) maxOk = cpre; } else if (cpre < minBad) minBad = cpre;
  }
  return capCache[k] = {safe: minBad - 1, max: maxOk};
}

/* ---------- analysis helpers ---------- */
function roles(L, team) {
  const st = team.map(id => { let losses = 0, sum = 0; for (const o of L.meta) { const r = L.rating(id, o); sum += r; if (r < 400) losses++; } return {id, losses, mean: sum / L.meta.length}; });
  st.sort((a, b) => a.losses - b.losses || b.mean - a.mean);
  const swap = st[0], rest = st.slice(1).sort((a, b) => b.mean - a.mean);
  return [{role: 'Lead', id: rest[1].id}, {role: 'Swap', id: swap.id}, {role: 'Closer', id: rest[0].id}];
}
function coverers(L, team, o) { return team.filter(m => L.rating(m, o) >= 500); }
function cores(trios) {
  const pairs = {};
  for (const t of trios) { const ids = t.members.map(m => m.speciesId);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const k = [ids[i], ids[j]].sort().join('+'); (pairs[k] = pairs[k] || []).push(t); } }
  const list = Object.entries(pairs).filter(([, ts]) => ts.length >= 2).sort((a, b) => b[1][0].teamScore - a[1][0].teamScore);
  const used = new Set(), out = [];
  for (const [k, ts] of list) {
    const mine = ts.filter(t => !used.has(t)); if (mine.length < 2) continue;
    mine.forEach(t => used.add(t));
    const ids = k.split('+');
    out.push({core: ids, best: mine[0].teamScore, thirds: mine.map(t => ({id: t.members.find(m => !ids.includes(m.speciesId)).speciesId, delta: Math.round((t.teamScore - mine[0].teamScore) * 10) / 10, team: t}))});
  }
  const rest = trios.filter(t => !used.has(t));
  return {cores: out, rest};
}
function nextMoves(m) {
  const {L, rep, own, auto, ri} = m, out = [];
  const best = rep.today[0], bestScore = best ? best.teamScore : 0;
  const inTeam = new Set(best ? best.members.map(x => x.speciesId) : []);
  for (const o of Object.values(own)) {
    if (o.manual) continue;
    if (o.toLevel > 40 && o.toLevel > o.level) { const c = costTo(o.level, o.toLevel);
      out.push({id: 'park:' + o.id, p: 9, tag: 'skip', cls: 'warn', title: `${nm(o.id)} needs L${o.toLevel}`, sub: `${fmt(c.dust)} dust${c.xl ? `, ${c.xl} XL candy` : ''} · park it`}); continue; }
    if (o.toLevel > o.level) { const c = costTo(o.level, o.toLevel);
      out.push({id: 'pu:' + o.id, species: o.id, p: inTeam.has(o.id) ? 0 : 3, tag: inTeam.has(o.id) ? 'in team' : 'bench', cls: inTeam.has(o.id) ? 'ok' : 'dim',
                title: `Power up ${nm(o.id)} to L${o.toLevel}`, sub: `${o.cp} → ${o.toCP} CP · ${fmt(c.dust)} dust · ${c.candy} candy`}); }
  }
  for (const g of rep.gains) {
    const delta = Math.round((g.bestTrio.teamScore - bestScore) * 10) / 10;
    const id = g.speciesId, a = auto[id], pre = (APP.prevo || {})[id];
    let title, sub = `lifts your best team to ${g.bestTrio.teamScore.toFixed(1)}`;
    if (a) { const c = costTo(a.level, a.toLevel); title = `Evolve your ${a.from} → ${nm(id)}`; sub += ` · fits to L${a.toLevel} · ${fmt(c.dust)} dust after evolving`; }
    else if (id in ri.pending) { title = `Get ${nm(id)}`; }
    else if (pre && DATA.stats[pre.split('_')[0].toUpperCase()]) { const sc = safeCap(pre, id); title = sc ? `Catch a ${nm(pre)} ≤ ${sc.safe} CP` : `Catch a ${nm(pre)}`; if (sc) sub += ` · ${sc.safe + 1}–${sc.max} CP only with the right IVs`; }
    else title = `Catch ${nm(id)}`;
    if (delta <= 0) sub = `best trio with it ${g.bestTrio.teamScore.toFixed(1)}, below your current team`;
    out.push({id: 'get:' + id, species: a ? a.fromId : (pre || id), p: delta > 0 ? 1 : 5, tag: delta > 0 ? '+' + delta.toFixed(0) : 'no gain', cls: delta > 0 ? 'gold' : 'dim', title, sub, delta, faded: delta <= 0});
  }
  out.sort((a, b) => a.p - b.p || (b.delta || 0) - (a.delta || 0));
  const now = Date.now();
  for (const x of out) { x.done = !!ROSTER.done[x.id]; x.snoozed = ROSTER.snooze[x.id] > now; }
  return out;
}
function openMoves(m) { return nextMoves(m).filter(x => !x.done && !x.snoozed); }

/* ---------- evidence: supersession of old scans, completion log ---------- */
function ivSet(r) { return new Set(r.combos.map(c => c.slice(1, 4).join('/'))); }
function shareIVs(a, b) { const A = ivSet(a); for (const x of ivSet(b)) if (A.has(x)) return true; return false; }
function lvl(r) { return r.level || (r.combos.length ? Math.max(...r.combos.map(c => c[0])) : null); }
function logEntry(e) { ROSTER.log.unshift(Object.assign({t: Date.now()}, e)); ROSTER.log = ROSTER.log.slice(0, 50); }
function onNewScan(s) {                        // called by the scanner after a new card is stored (or an appraisal completes one)
  if (!APP || !s.combos || !s.combos.length || !s.cp) return;
  const sid = scanId(s), newId = sid && sid.id, newLv = lvl(s);
  for (const r of results) {
    if (r === s || r.superseded || !r.combos || !r.combos.length || !r.cp) continue;
    const rid = (scanId(r) || {}).id, oldLv = lvl(r);
    if (!shareIVs(r, s)) continue;
    if (r.species === s.species && s.cp > r.cp && (!oldLv || !newLv || newLv >= oldLv)) {          // power-up
      r.superseded = {by: s.key, why: `powered up to L${newLv ?? '?'}`, t: Date.now()};
      logEntry({kind: 'powerup', id: 'pu:' + rid, title: `${nm(rid || s.species)} powered up ${r.cp} → ${s.cp} CP`, evidence: s.key});
    } else if (rid && newId && (APP.pokemon[rid] || {}).evo && APP.pokemon[rid].evo.includes(newId) && (!oldLv || !newLv || newLv >= oldLv)) {   // evolution
      r.superseded = {by: s.key, why: `evolved into ${nm(newId)}`, t: Date.now()};
      logEntry({kind: 'evolve', id: 'get:' + newId, title: `${nm(rid)} evolved into ${nm(newId)}`, evidence: s.key});
    }
  }
  if (newId && (ROSTER.candidates[newId] !== undefined || ROSTER.pending[newId] !== undefined) && s.cp <= CAP) {
    logEntry({kind: 'catch', id: 'get:' + newId, title: `${nm(newId)} caught, ${s.cp} CP`, evidence: s.key});
    delete ROSTER.candidates[newId]; delete ROSTER.pending[newId];
  } else if (newId) {
    for (const evo of (APP.pokemon[newId].evo || [])) if (ROSTER.candidates[evo] !== undefined) {
      const eb = evoBaseStats(evo), b = sid.best;
      if (eb && calcCP(eb, b[1], b[2], b[3], cpmAt(b[0])) <= CAP) logEntry({kind: 'catch', id: 'get:' + evo, title: `${nm(newId)} caught for ${nm(evo)}, ${s.cp} CP`, evidence: s.key});
    }
  }
  saveRoster(); dirty = true;
}
function scanProof(moveId) {                   // "Scan proof" on a next move: remember what should clear, open the importer
  const m = M(), mv = openMoves(m).find(x => x.id === moveId);
  UI.expect = {id: moveId, title: mv ? mv.title : moveId, before: openMoves(m).map(x => x.id)};
  showTab('scans'); $('file').click();
}
function afterImport(newScans) {               // called by the scanner when an import finishes
  dirty = true; const m = M(), after = new Set(openMoves(m).map(x => x.id));
  const ex = UI.expect; UI.expect = null;
  if (ex) {
    if (!after.has(ex.id)) {
      if (!ROSTER.log.some(e => e.id === ex.id && e.evidence)) logEntry({kind: 'proof', id: ex.id, title: ex.title, evidence: newScans[0] ? newScans[0].key : null});
      status(`✓ ${ex.title} — cleared by this scan`);
    } else {
      const sp = newScans.find(r => r.species) || null, mv = openMoves(m).find(x => x.id === ex.id);
      let why = 'the scan did not change it';
      if (sp && mv && mv.id.startsWith('get:')) { const evo = mv.id.slice(4), sid = scanId(sp);
        if (sid && sid.id && (APP.pokemon[sid.id].evo || []).includes(evo)) { const eb = evoBaseStats(evo), b = sid.best, cp = eb ? calcCP(eb, b[1], b[2], b[3], cpmAt(b[0])) : 0;
          why = cp > CAP ? `${nm(sid.id)} would be ${cp} CP as ${nm(evo)}, over the cap` : 'the scan could not be solved'; }
        else if (sid && sid.id) why = `that is a ${nm(sid.id)}, not what this item needs`; }
      status(`Scan added, but "${ex.title}" is still open: ${why}`);
    }
    saveRoster();
  }
  for (const id of Object.keys(ROSTER.done)) if (!after.has(id)) delete ROSTER.done[id];   // tidy manual ticks once the state caught up
  refresh();
}
function markDone(id, note) { const m = M(), mv = nextMoves(m).find(x => x.id === id);
  ROSTER.done[id] = {t: Date.now(), note: note || ''}; logEntry({kind: 'manual', id, title: mv ? mv.title : id, evidence: null, note: note || ''}); saveRoster(); refresh(); }
function snooze(id) { ROSTER.snooze[id] = Date.now() + WEEK; saveRoster(); refresh(); }
function unsnooze(id) { delete ROSTER.snooze[id]; saveRoster(); refresh(); }
function undoDone(id) { delete ROSTER.done[id]; ROSTER.log = ROSTER.log.filter(e => !(e.id === id && e.kind === 'manual')); saveRoster(); refresh(); }
function toggleMore() { UI.showAll = !UI.showAll; renderToday(); }
function showScanKey(key) { const r = results.find(x => x.key === key); if (!r) return; showTab('scans'); $('filter').value = r.superseded ? 'arch' : 'all'; $('q').value = r.species; render(); }

/* ---------- rendering: Today ---------- */
const chip = (t, cls) => `<span class="chip ${cls || ''}">${esc(t)}</span>`;
function teamLine(t, title) {
  const dt = [t.unansweredMeta.length ? `no answer to <b>${esc(t.unansweredMeta.join(', '))}</b>` : 'covers the whole meta',
              t.sharedWeaknesses.length ? `two lose to ${esc(t.sharedWeaknesses.join(', '))}` : ''].filter(Boolean).join(' · ');
  return `<div class="team" onclick="Planner.coverage(${JSON.stringify(t.members.map(m => m.speciesId)).replace(/"/g, '&quot;')})"><span class="sc">${t.teamScore.toFixed(1)}</span><span class="nm">${title ? esc(title) + ': ' : ''}${t.members.map(m => `${esc(m.name)} <span class="dim">#${m.rank}</span>`).join(' / ')}</span><div class="dt">${dt}</div></div>`;
}
function bestSwaps(L, team, m, ev) {         // one-member swaps from owned/pending pieces, best first
  const {ri} = m; ev = ev || L.evaluate(team);
  const pool = Object.keys(ri.owned).concat(Object.keys(ri.pending)).filter(p => !team.includes(p));
  const swaps = [];
  for (let i = 0; i < 3; i++) for (const p of pool) {
    if (PVP.baseSpecies(p) === PVP.baseSpecies(team[i])) continue;
    const t2 = team.slice(); t2[i] = p; if (new Set(t2.map(PVP.baseSpecies)).size < 3) continue;
    const e2 = L.evaluate(t2), delta = Math.round((e2.score - ev.score) * 10) / 10;
    const fixed = ev.shared.concat(ev.holes).filter(o => !e2.shared.includes(o) && !e2.holes.includes(o)).map(nm);
    const opened = e2.holes.filter(o => !ev.holes.includes(o)).map(nm);
    swaps.push({out: team[i], in: p, delta, fixed, opened, pending: !(p in ri.owned)});
  }
  return swaps.sort((a, b) => b.delta - a.delta);
}
function threats(L, team, ev) {               // meta Pokémon this team should fear, worst first
  ev = ev || L.evaluate(team);
  const rows = [];
  for (const o of L.meta) {
    const hole = ev.holes.includes(o), shared = ev.shared.includes(o);
    if (!hole && !shared) continue;
    const beats = team.filter(t => L.rating(t, o) < 400), answer = team.filter(t => L.rating(t, o) >= 500);
    rows.push({id: o, rank: APP.pokemon[o].rank, hole, beats, answer: answer.sort((a, b) => L.rating(b, o) - L.rating(a, o))[0] || null});
  }
  return rows.sort((a, b) => (b.hole - a.hole) || a.rank - b.rank);
}
function partyCard(L, t, m, opts) {           // a saved party with its weaknesses and the meta Pokémon that exploit them
  opts = opts || {};
  const ids = t.members.map(x => x.speciesId), ev = L.evaluate(ids), th = threats(L, ids, ev), sw = bestSwaps(L, ids, m, ev)[0];
  const cov = JSON.stringify(ids).replace(/"/g, '&quot;');
  let h = `<div class="team" onclick="Planner.coverage(${cov})"><span class="sc">${t.teamScore.toFixed(1)}</span><span class="nm">${esc(t.name)}: ${t.members.map(x => `${esc(x.name)} <span class="dim">#${x.rank}</span>`).join(' / ')}</span>`;
  if (opts.remove) h += `<span class="x" onclick="event.stopPropagation();Planner.dropTag('${esc(t.name).replace(/'/g, "\\'")}')">✕</span>`;
  h += `<div class="dt">${th.length ? `${ev.holes.length} unanswered · ${ev.shared.length} beat two of three` : 'covers the whole meta, nothing beats two of your three'}</div>`;
  for (const r of th.slice(0, opts.max || 5)) {
    h += `<div class="thr"><b style="cursor:pointer" onclick="event.stopPropagation();Planner.openMon('${r.id}')">${esc(nm(r.id))}</b> <span>#${r.rank}</span> · ${r.hole ? `beats all three${r.answer ? '' : ', nobody answers it'}` : `beats ${esc(r.beats.map(nm).join(' and '))}`}${r.answer ? ` · <span class="good">swap to ${esc(nm(r.answer))}</span>` : ''}</div>`;
  }
  if (th.length > (opts.max || 5)) h += `<div class="thr">… ${th.length - (opts.max || 5)} more, tap for the full grid</div>`;
  if (sw && sw.delta > 0) h += `<div class="thr">Fix: swap ${esc(nm(sw.out))} → <span class="good">${esc(nm(sw.in))}</span>${sw.pending ? ' (pending)' : ''} for +${sw.delta}${sw.fixed.length ? ', covers ' + esc(sw.fixed.slice(0, 2).join(', ')) : ''}</div>`;
  return h + '</div>';
}
function errorCard(where, e) {
  console.error(e);
  return `<div class="empty"><b>The ${where} view hit an error.</b><br><span style="font-family:ui-monospace,monospace;font-size:12px">${esc(e && e.message || e)}</span><br><br>
    <button class="btn sec" style="margin:0" onclick="location.reload()">Reload</button>
    <button class="btn sec" style="margin:0" onclick="localStorage.removeItem('roster');location.reload()">Reset planner data</button></div>`;
}
function renderToday() {
  const el = $('today'); if (!el) return;
  try { renderTodayInner(el); } catch (e) { el.innerHTML = errorCard('Today', e); }
}
function renderTodayInner(el) {
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading PvPoke data…</div>'; return; }
  const m = M(), {L, rep, own} = m, best = rep.today[0];
  const bm = APP.benchmark || {best: 721, median: 521};
  let h = `<div class="note">PvPoke ${esc(APP.league.title)} · gamemaster ${esc(APP.gamemasterTimestamp.slice(0, 10))} · ${Object.keys(own).length} owned, ${Object.keys(m.ri.pending).length} pending, ${Object.keys(m.ri.candidates).length} wanted</div>`;
  if (!best) {
    h += `<div class="empty"><b>No team yet.</b><br>Scan at least three Pokémon at or under 1500 CP, add them by name in Roster, or tap <b>Load saved roster</b> there.</div>`;
    el.innerHTML = h; return;
  }
  const ids = best.members.map(x => x.speciesId), rl = roles(L, ids);
  const pctBar = Math.max(4, Math.min(100, (best.teamScore - 300) / (bm.best - 300) * 100)), medPos = (bm.median - 300) / (bm.best - 300) * 100;
  const threats = best.unansweredMeta.map(n => ({n, hole: true})).concat(best.sharedWeaknesses.filter(n => !best.unansweredMeta.includes(n)).map(n => ({n})));
  const holeIds = L.meta.filter(o => best.unansweredMeta.includes(nm(o)) || best.sharedWeaknesses.includes(nm(o)));
  const keep = holeIds.map(o => { const c = coverers(L, ids, o); return c.length ? `${nm(c[0])} for ${nm(o)}` : null; }).filter(Boolean);
  h += `<div class="hero" onclick="Planner.coverage(${JSON.stringify(ids).replace(/"/g, '&quot;')})">
    <div class="sec" style="margin:0 0 10px">Run this team <small>best of ${rep.todayAll.length >= 12 ? '12+' : rep.todayAll.length} buildable · tap for coverage</small></div>
    <div class="roles">${rl.map(r => { const mv = L.movesOf(r.id); return `<div class="role"><span class="rl">${r.role}</span><span class="rn">${esc(nm(r.id))}</span><span class="rm">${esc(mvName(mv[0]))} · ${esc(mvName(mv[1]))}</span></div>`; }).join('')}</div>
    <div class="scorebar"><span class="big">${best.teamScore.toFixed(0)}</span><div class="track"><div class="fill" style="width:${pctBar}%"></div><div class="tick" style="left:${medPos}%"></div></div><span class="dim">meta best ${bm.best.toFixed(0)}</span></div>
    <div class="dim" style="font-size:12px;margin-top:8px">${best.unansweredMeta.length ? `No answer to ${chip(best.unansweredMeta.join(', '), 'warn')}. ` : 'Covers every meta Pokémon. '}${threats.filter(t => !t.hole).length ? 'Watch out for' : ''}</div>
    ${threats.filter(t => !t.hole).length ? `<div class="chips" style="margin-top:6px">${threats.filter(t => !t.hole).map(t => chip(t.n, 'warn')).join('')}</div>` : ''}
    ${keep.length ? `<div class="dim" style="font-size:12px;margin-top:8px">They beat two of three. Keep ${esc(keep.slice(0, 3).join(', '))}.</div>` : ''}
  </div>`;
  const all = nextMoves(m), open = all.filter(x => !x.done && !x.snoozed);
  const primary = open.filter(x => !x.faded && x.tag !== 'skip'), noGain = open.filter(x => x.faded || x.tag === 'skip'), snoozed = all.filter(x => x.snoozed);
  const hintFor = x => { if (!x.id.startsWith('get:') || !window.Sources || !Sources.ready()) return ''; const id = x.id.slice(4); const hnt = Sources.hint(family(id).map(nm), {shadow: /_shadow$/.test(id)}); return hnt ? ` · <span class="good">${esc(hnt)}</span>` : ''; };
  const moveCard = x => `<div class="team move ${x.faded || x.tag === 'skip' ? 'faded' : ''}"><div class="mvt"><span class="nm">${esc(x.title)}</span><div class="dt">${esc(x.sub)}${hintFor(x)}</div>
      <div class="acts small">${x.species && x.tag !== 'skip' ? `<button onclick="Planner.scanProof('${x.id}')">Scan proof</button>` : ''}<button onclick="Planner.markDone('${x.id}')">${x.tag === 'skip' ? 'Dismiss' : 'Done anyway'}</button><button onclick="Planner.snooze('${x.id}')">Snooze 7d</button></div></div>${chip(x.tag, x.cls === 'dim' ? '' : x.cls)}</div>`;
  if (open.length || snoozed.length) {
    h += `<div class="sec">Next moves <small>ordered by team gain per resource</small></div>` + primary.map(moveCard).join('');
    if (noGain.length || snoozed.length) h += `<div class="note" style="cursor:pointer" onclick="Planner.toggleMore()">${UI.showAll ? '▾ hide' : '▸ show'} ${noGain.length} with no gain${snoozed.length ? ` · ${snoozed.length} snoozed` : ''}</div>`;
    if (UI.showAll) { h += noGain.map(moveCard).join(''); h += snoozed.map(x => `<div class="team move faded"><div class="mvt"><span class="nm">${esc(x.title)}</span><div class="dt">snoozed until ${when(ROSTER.snooze[x.id])} · <a href="#" onclick="Planner.unsnooze('${x.id}');return false">unsnooze</a></div></div></div>`).join(''); }
  }
  if (ROSTER.log.length) {
    h += `<div class="sec">Recently completed</div>` + ROSTER.log.slice(0, 5).map(e => `<div class="team move done"><span class="tick ${e.evidence ? 'full' : 'hollow'}">${e.evidence ? '✓' : '○'}</span><div class="mvt"><span class="nm">${esc(e.title)}</span><div class="dt">${when(e.t)}${e.evidence ? ` · <a href="#" onclick="Planner.showScanKey('${esc(e.evidence)}');return false">scan</a>` : e.kind === 'manual' ? ` · without proof · <a href="#" onclick="Planner.undoDone('${e.id}');return false">undo</a>` : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div></div>`).join('');
  }
  // second team: the best trio that shares no species with the recommended one (owned first, then pending pieces)
  const base = new Set(ids.map(PVP.baseSpecies));
  const poolOwned = Object.keys(m.ri.owned).filter(p => !base.has(PVP.baseSpecies(p)));
  const poolAll = poolOwned.concat(Object.keys(m.ri.pending).filter(p => !base.has(PVP.baseSpecies(p))));
  const second = L.bestTrios(poolOwned, 1)[0] || L.bestTrios(poolAll, 1)[0];
  if (second) {
    const extra = second.members.filter(x => !own[x.speciesId]).map(x => x.name);
    h += `<div class="sec">Second team, no overlap <small>for rotating</small></div>` + teamLine(second) + (extra.length ? `<div class="note">* ${esc(extra.join(', '))} once you have it.</div>` : '');
  }
  const {cores: cs, rest} = cores(rep.todayAll.filter(t => t.members.map(x => x.speciesId).join() !== ids.join()));
  if (cs.length || rest.length) {
    h += `<div class="sec">Other teams <small>grouped by shared core · third slot vs the core's best</small></div>`;
    for (const c of cs) h += `<div class="core"><div class="ch"><span class="nm">${c.core.map(nm).map(esc).join(' + ')}</span><span class="sc">${c.best.toFixed(0)}</span></div><div class="thirds">${c.thirds.map(t => `<div class="third ${t.delta === 0 ? 'best' : ''}" onclick="Planner.coverage(${JSON.stringify(t.team.members.map(x => x.speciesId)).replace(/"/g, '&quot;')})"><span>${esc(nm(t.id))}</span><small>${t.delta === 0 ? 'best' : t.delta}</small></div>`).join('')}</div></div>`;
    for (const t of rest.slice(0, 3)) h += teamLine(t);
  }
  if (rep.tagged.length) h += `<div class="sec">Your in-game parties <small>weak spots and who exploits them</small></div>` + rep.tagged.map(t => partyCard(L, t, m)).join('');
  h += wantedCard(m);
  h += coachCard(m);
  h += `<div class="note">Heuristic, not a simulation: PvPoke's published matchups where available, type effectiveness and ranking score otherwise. Roles are a guess: the member with the fewest hard losses is the swap, the strongest remaining one closes.</div>`;
  el.innerHTML = h;
}

/* ---------- wanted Pokémon: where to get them (Today) ---------- */
function wantedCard(m) {
  const {ri, auto} = m;
  const ids = Object.keys(ri.candidates).concat(Object.keys(ri.pending).filter(id => !auto[id])).filter(id => APP.pokemon[id]);
  if (!ids.length) return '';
  const src = window.Sources;
  let h = `<div class="sec">Get your wanted Pokémon <small>raids, eggs, research, events</small></div>`;
  if (!src || !src.ready()) return h + `<div class="note">${src && src.error() ? 'Schedule not available: ' + esc(src.error()) : 'Loading the raid and egg schedule…'}</div>`;
  const all = [];
  for (const id of ids) for (const e of availability(id) || []) all.push(Object.assign({id}, e));
  const now = all.filter(e => e.now), later = all.filter(e => !e.now).sort((a, b) => a.sort - b.sort);
  const line = e => `<div class="thr av ${e.now ? 'now' : ''}" onclick="Planner.openMon('${e.id}')" style="cursor:pointer"><b>${esc(nm(e.id))}</b>${e.name !== nm(e.id) ? ` <span class="dim">as ${esc(e.name)}</span>` : ''} · ${esc(e.what)} <span>${esc(e.when)}</span>${e.remote ? ' · <span class="good">remote OK</span>' : e.kind === 'raid' ? ' · in person' : ''}${e.shiny ? ' · ✨' : ''}${e.note ? ` · <span class="dim">${esc(e.note)}</span>` : ''}</div>`;
  if (now.length) h += `<div class="team" style="cursor:default"><div class="nm">Available now</div>${now.map(line).join('')}</div>`;
  h += `<div class="team" style="cursor:default"><div class="nm">Coming up <span class="dim" style="font-weight:400;font-size:12px">announced raids and events</span></div>${later.length ? later.slice(0, 8).map(line).join('') : '<div class="thr">Nothing announced yet for your wanted list. Raid rotations are usually published one to three weeks ahead.</div>'}</div>`;
  const none = ids.filter(id => !all.some(e => e.id === id));
  if (none.length) h += `<div class="note">Nothing scheduled for ${none.map(id => `<a href="#" onclick="Planner.openMon('${id}');return false">${esc(nm(id))}</a>`).join(', ')}: wild spawns, trades or GBL rewards.</div>`;
  h += `<div class="note">Leek Duck schedule via ScrapedDuck, updated ${when(src.updated())}. Only events with a published boss or spawn list can be matched. Remote OK = regular raid you can join with a Remote Raid Pass; Shadow raids are in person only.</div>`;
  return h;
}
if (window.Sources) Sources.onChange(() => { renderToday(); if (UI.mon) renderMon(); });

/* ---------- AI coach (server-side Claude API, only when the server has a key and sync is connected) ---------- */
const COACH = Object.assign({q: '', text: '', hash: '', t: 0, busy: false, error: ''}, JSON.parse(localStorage.getItem('coach') || '{}'));
const saveCoach = () => localStorage.setItem('coach', JSON.stringify({q: COACH.q, text: COACH.text, hash: COACH.hash, t: COACH.t}));
function coachContext(m) {
  const {L, rep, own, ri} = m;
  const mon = id => { const e = APP.pokemon[id]; const mv = L.movesOf(id); return `${e.name} (#${e.rank}, ${mv.map(mvName).join('/')})`; };
  const team = t => `${t.members.map(x => x.name).join(' / ')} — score ${t.teamScore.toFixed(0)}${t.unansweredMeta.length ? `, no answer to ${t.unansweredMeta.join(', ')}` : ''}${t.sharedWeaknesses.length ? `, two lose to ${t.sharedWeaknesses.join(', ')}` : ''}`;
  const scanned = {}; for (const r of results) { const s = scanId(r); if (!s || !s.id || r.bench || r.superseded) continue; const lv = lvl(r); if (lv && (!scanned[s.id] || scanned[s.id] < lv)) scanned[s.id] = lv; }
  return {
    league: APP.league.title, gamemaster: APP.gamemasterTimestamp.slice(0, 10), trainerLevel: localStorage.getItem('trainer') || null,
    owned: Object.keys(own).filter(id => APP.pokemon[id]).map(id => mon(id) + (scanned[id] ? ` at L${scanned[id]}` : '')),
    pending: Object.keys(ri.pending).filter(id => APP.pokemon[id] && !own[id]).map(mon),
    wanted: Object.keys(ri.candidates).filter(id => APP.pokemon[id]).map(mon),
    bestTeams: rep.today.slice(0, 5).map(team), parties: rep.tagged.map(t => `${t.name}: ${team(t)}`),
    nextMoves: openMoves(m).slice(0, 8).map(x => `${x.title} — ${x.sub}`),
    topMeta: L.meta.slice(0, 30).map(id => `${nm(id)} #${APP.pokemon[id].rank}`),
    scoring: 'Team score = mean best matchup rating vs the meta (PvPoke published matchups, type effectiveness otherwise) minus 12 per unanswered meta Pokémon and 6 per meta Pokémon that beats two members. Meta best is about ' + Math.round((APP.benchmark || {best: 721}).best) + '.',
  };
}
function coachHash(o) { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); }
function coachCard(m) {
  if (!window.Sync || !Sync.available() || !Sync.state.code) return '';
  if (!Sync.coachAvailable()) return `<div class="sec">Coach <small>off on your server</small></div><div class="team coach"><div class="dt">The server reports no coach (<code>coach:false</code> in /api/health). Set <code>ANTHROPIC_API_KEY</code> on the Railway service and deploy the staged variable change; then tap re-check.</div><div class="acts small"><button onclick="Sync.detect().then(()=>Planner.renderToday())">Re-check</button></div></div>`;
  const fresh = COACH.text && COACH.hash === coachHash(coachContext(m));
  return `<div class="sec">Coach <small>Claude reads your roster and the meta</small></div>
    <div class="team coach"><div class="nm">Ask the coach</div><div class="dt">Team ideas from what you own, what to build next and what to fear. Uses the numbers above, nothing from your phone leaves except this roster summary.</div>
    <div class="add" style="margin-top:8px"><input id="coachq" placeholder="optional question, e.g. which lead for Azumarill teams?" value="${esc(COACH.q)}" style="flex:1;min-width:160px"><button onclick="Planner.askCoach()" ${COACH.busy ? 'disabled' : ''}>${COACH.busy ? 'Thinking…' : fresh ? 'Ask again' : 'Ask the coach'}</button></div>
    ${COACH.error ? `<div class="note" style="color:#F59A8B">⚠ ${esc(COACH.error)}</div>` : ''}
    ${COACH.text ? `<div class="ans">${mdLite(COACH.text)}</div><div class="note" style="margin-top:6px">${when(COACH.t)}${fresh ? '' : ' · your roster changed since this answer'}</div>` : ''}</div>`;
}
function mdLite(t) {                          // minimal markdown: paragraphs, bullets, bold
  const blocks = esc(t).replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) return '<ul>' + lines.map(l => `<li>${l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}</li>`).join('') + '</ul>';
    return `<p>${lines.join('<br>')}</p>`;
  }).join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^<p>(#+\s*)(.+?)<\/p>/gm, '<p><b>$2</b></p>');
}
async function askCoach() {
  const m = M(), ctx = coachContext(m), q = ($('coachq') || {value: ''}).value.trim();
  COACH.q = q; COACH.busy = true; COACH.error = ''; renderToday();
  try {
    const text = await Sync.coach(ctx, q);
    COACH.text = text; COACH.hash = coachHash(ctx); COACH.t = Date.now(); saveCoach();
  } catch (e) { COACH.error = e.message || String(e); }
  COACH.busy = false; renderToday();
}

/* ---------- coverage overlay (B) ---------- */
function coverage(team) { const m = M(); coverageFor(m.L, team, m); }
function coverageFor(L, team, m) {
  try { coverageInner(L, team, m); } catch (e) { $('sheet').innerHTML = `<div class="box">${errorCard('coverage', e)}</div>`; $('sheet').classList.add('open'); }
}
function coverageInner(L, team, m) {
  const {own, ri} = m, ev = L.evaluate(team);
  const rows = L.meta.filter((o, i) => i < 15 || ev.holes.includes(o) || ev.shared.includes(o));
  const cls = r => r >= 500 ? 'w' : r < 400 ? 'l' : 'e';
  const swaps = bestSwaps(L, team, m, ev);
  const grid = `<div class="cov"><div class="cr head"><span>Meta threat</span>${team.map(t => `<span>${esc(nm(t))}</span>`).join('')}</div>` +
    rows.map(o => `<div class="cr ${ev.shared.includes(o) || ev.holes.includes(o) ? 'tint' : ''}"><span>${esc(nm(o))} <span class="dim">#${APP.pokemon[o].rank}</span></span>${team.map(t => `<i class="${cls(L.rating(t, o))} ${(L.isPublished ? L.isPublished(t, o) : true) ? '' : 'est'}" title="${Math.round(L.rating(t, o))}"></i>`).join('')}</div>`).join('') +
    `<div class="legend"><span><i class="w"></i>wins</span><span><i class="e"></i>even</span><span><i class="l"></i>loses</span><span><i class="w est"></i>faded = estimated from typing</span><span class="dim">${rows.length} of ${L.meta.length}</span></div></div>`;
  const readout = `${ev.holes.length ? `<b>${esc(ev.holes.map(nm).join(', '))}</b> ${ev.holes.length > 1 ? 'have' : 'has'} no green cell: nobody on this team beats ${ev.holes.length > 1 ? 'them' : 'it'}. ` : 'Every row has a green cell, so nothing is unanswered. '}${ev.shared.length ? `Tinted rows beat two of your three: if your lead meets one, swap straight to the one green Pokémon.` : ''}`;
  const sw = swaps.slice(0, 4).map(s => `<div class="swap"><span class="dim">Swap ${esc(nm(s.out))} → ${esc(nm(s.in))}${s.pending ? ' (pending)' : ''}</span><span class="${s.delta >= 0 ? 'up' : 'down'}">${s.delta >= 0 ? '+' : ''}${s.delta}${s.fixed.length ? ' · fixes ' + esc(s.fixed.slice(0, 2).join(', ')) : ''}${s.opened.length ? ' · opens ' + esc(s.opened.slice(0, 2).join(', ')) : ''}</span></div>`).join('');
  $('sheet').innerHTML = `<div class="box"><h2><span>${team.map(nm).map(esc).join(' / ')} <span class="sc">${ev.score.toFixed(1)}</span></span><span class="x" onclick="Planner.closeSheet()">✕</span></h2>${grid}<div class="team" style="margin-top:10px"><div class="nm">Read-out</div><div class="dt" style="font-size:13px;color:var(--ink)">${readout}</div></div>${sw ? `<div class="sec">If you swap one member</div><div class="swaps">${sw}</div>` : ''}</div>`;
  $('sheet').classList.add('open');
}
function closeSheet() { $('sheet').classList.remove('open'); }

/* ---------- rendering: Roster board (D) ---------- */
function tiles(m) {
  const {own, auto, ri, rep} = m, out = [];
  const inTeams = id => rep.todayAll.filter(t => t.members.some(x => x.speciesId === id)).length;
  for (const o of Object.values(own)) {
    let st, txt, bar = null;
    if (o.manual) { st = 'manual'; txt = 'not scanned'; }
    else if (o.toLevel > 40 && o.toLevel > o.level) { st = 'xl'; txt = `XL gated · L${o.toLevel}`; }
    else if (o.toLevel > o.level) { st = 'power'; const c = costTo(o.level, o.toLevel); txt = `L${o.level} → ${o.toLevel} · ${c.candy} candy`; bar = (o.level - 1) / (o.toLevel - 1); }
    else { st = 'ready'; txt = 'ready'; }
    out.push({id: o.id, st, txt, bar, sub: `#${APP.pokemon[o.id].rank}${o.cp ? ' · ' + o.cp : ''}`, teams: inTeams(o.id)});
  }
  for (const [id, a] of Object.entries(auto)) out.push({id, st: 'pending', txt: `evolve ${a.from}`, sub: `#${APP.pokemon[id].rank} · fits to L${a.toLevel}`});
  for (const id of Object.keys(ROSTER.pending)) if (!own[id] && !auto[id] && APP.pokemon[id]) out.push({id, st: 'pending', txt: 'pending', sub: `#${APP.pokemon[id].rank}`});
  for (const id of Object.keys(ri.candidates)) { const pre = (APP.prevo || {})[id], sc = pre && DATA.stats[pre.split('_')[0].toUpperCase()] ? safeCap(pre, id) : null;
    out.push({id, st: 'wanted', txt: sc ? `${nm(pre)} ≤ ${sc.safe} CP` : 'wanted', sub: `#${APP.pokemon[id].rank}`}); }
  for (const id of ROSTER.exclude) if (APP.pokemon[id]) out.push({id, st: 'bench', txt: 'benched', sub: `#${APP.pokemon[id].rank}`});
  const order = {ready: 0, power: 1, manual: 2, pending: 3, wanted: 4, xl: 5, bench: 6};
  out.sort((a, b) => order[a.st] - order[b.st] || APP.pokemon[a.id].rank - APP.pokemon[b.id].rank);
  return out;
}
function movesRow(id, moves, handler) {
  const e = APP.pokemon[id]; handler = handler || `Planner.setMove('${id}',SLOT,this.value)`;
  const withCur = (list, slot) => moves[slot] && !list.includes(moves[slot]) ? [moves[slot], ...list] : list;
  const sel = (slot, list0) => { const list = withCur(list0, slot); return `<select onchange="${handler.replace('SLOT', slot)}">${list.map(mv => `<option value="${mv}" ${moves[slot] === mv ? 'selected' : ''}>${esc(mvName(mv))}</option>`).join('')}</select>`; };
  return `<div class="mv">${sel(0, e.fast)}${sel(1, e.charged)}${sel(2, e.charged)}</div>`;
}
/* ---------- Pokémon detail page ---------- */
function family(id) {                          // the species and its pre-evolutions, as PvPoke ids (pre-evos may be unranked)
  const out = [id]; let cur = id;
  for (let i = 0; i < 3; i++) { const pre = (APP.prevo || {})[cur]; if (!pre || out.includes(pre)) break; out.push(pre); cur = pre; }
  return out;
}
function availability(id) {                    // where to get this species (or a pre-evolution) now or soon
  if (!window.Sources || !Sources.ready()) return null;
  return Sources.forSpecies(family(id).map(nm), {shadow: /_shadow$/.test(id)});
}
function availLines(list, max) {
  return list.slice(0, max || 6).map(e => `<div class="thr av ${e.now ? 'now' : ''}"><b>${esc(e.name)}</b> · ${esc(e.what)} <span>${esc(e.when)}</span>${e.remote ? ' · <span class="good">remote OK</span>' : e.kind === 'raid' ? ' · in person' : ''}${e.shiny ? ' · ✨' : ''}${e.note ? ` · <span class="dim">${esc(e.note)}</span>` : ''}</div>`).join('');
}
function weakTo(id) {                          // attacking types that hit this Pokémon for more than neutral
  const t = APP.pokemon[id].types; return TYPES18.filter(a => PVP.eff(a, t) > 1).sort((a, b) => PVP.eff(b, t) - PVP.eff(a, t));
}
function rosterFit(m, id) {                    // what this species does for the teams you can build
  const {L, rep, own, ri} = m, ownedIds = Object.keys(ri.owned), best = rep.today[0];
  if (own[id]) {
    const teams = rep.todayAll.filter(t => t.members.some(x => x.speciesId === id));
    const partners = {}; teams.forEach(t => t.members.forEach(x => { if (x.speciesId !== id) partners[x.speciesId] = (partners[x.speciesId] || 0) + 1; }));
    const answers = best ? L.meta.filter(o => (best.unansweredMeta.includes(nm(o)) || best.sharedWeaknesses.includes(nm(o))) && L.rating(id, o) >= 500) : [];
    return {owned: true, teams: teams.slice(0, 3), inTeams: teams.length, of: rep.todayAll.length,
            partners: Object.entries(partners).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]), answers};
  }
  const pool = ownedIds.filter(p => PVP.baseSpecies(p) !== PVP.baseSpecies(id)).concat([id]);
  if (pool.length < 3) return {owned: false, teams: [], delta: null, answers: []};
  const teams = L.bestTrios(pool, 40).filter(t => t.members.some(x => x.speciesId === id)).slice(0, 3);
  const top = teams[0], delta = top && best ? Math.round((top.teamScore - best.teamScore) * 10) / 10 : null;
  const answers = best ? L.meta.filter(o => (best.unansweredMeta.includes(nm(o)) || best.sharedWeaknesses.includes(nm(o))) && L.rating(id, o) >= 500) : [];
  return {owned: false, teams, delta, top, answers};
}
function openMon(id, replace) {
  if (!APP || !APP.pokemon[id]) return;
  const cur = ['today', 'roster', 'meta', 'scans'].find(k => $('view-' + k).classList.contains('on'));
  if (cur) UI.monFrom = cur;
  UI.mon = id;
  if (!replace) { try { history.pushState({mon: id}, ''); } catch {} }
  showTab('mon'); renderMon(); window.scrollTo(0, 0);
}
function closeMon() { if (history.state && history.state.mon) history.back(); else { UI.mon = null; showTab(UI.monFrom || 'roster'); } }
window.addEventListener('popstate', e => {
  if (e.state && e.state.mon && APP && APP.pokemon[e.state.mon]) { UI.mon = e.state.mon; showTab('mon'); renderMon(); }
  else if (UI.mon) { UI.mon = null; showTab(UI.monFrom || 'roster'); }
});
function renderMon() {
  const el = $('mon'); if (!el || !UI.mon) return;
  try { el.innerHTML = monInner(M(), UI.mon); } catch (e) { el.innerHTML = errorCard('detail', e); }
}
function monInner(m, id) {
  const {L, own, auto, ri, rep} = m, e = APP.pokemon[id], o = own[id], a = auto[id], st = ownership(m, id), benched = ROSTER.exclude.includes(id);
  const moves = o ? o.moves : (ROSTER.moves[id] || ri.pending[id] || e.moveset);
  const rec = e.moveset, notRec = moves.filter(mv => !rec.includes(mv));
  const back = {today: 'Today', roster: 'Roster', meta: 'Meta', scans: 'Scans'}[UI.monFrom] || 'Back';
  let h = `<div class="monhead"><button class="back" onclick="Planner.closeMon()">‹ ${back}</button><div class="chips" style="margin:0">${ownChip(st)}${benched ? chip('benched') : ''}${a ? chip('evolves from your ' + a.from, 'gl') : ''}</div></div>`;
  h += `<div class="detail"><div class="dh"><span class="nm" style="font-size:20px">${esc(e.name)}</span><span class="dim">meta #${e.rank} · ${e.score}</span></div>
    <div class="chips" style="margin:0">${e.types.map(t => chip(t)).join('')}${weakTo(id).length ? `<span class="dim" style="font-size:12px;align-self:center">weak to ${esc(weakTo(id).join(', '))}</span>` : ''}</div>`;
  // numbers
  const teamsIn = rep.todayAll.filter(t => t.members.some(x => x.speciesId === id)).length;
  if (o && !o.manual) { const c = costTo(o.level, o.toLevel);
    h += `<div class="kpis"><div><small>Your copy</small><b>${o.cp} CP · L${o.level}</b></div><div><small>IV rank GL</small><b>#${o.glRank} · ${o.glPct.toFixed(1)}%</b></div><div><small>To the cap</small><b>${o.toLevel > o.level ? `L${o.toLevel} · ${(c.dust / 1000).toFixed(1)}k · ${c.candy || c.xl + ' XL'}` : 'ready'}</b></div></div>`;
    h += `<div class="chips" style="margin:0">${chip(`IVs ${o.ivs.join('/')}`, 'gl')}${o.scan && o.scan.appraisal ? chip('✓ appraised', 'meta1') : ''}${o.toLevel > 40 && o.toLevel > o.level ? chip('XL candy needed', 'warn') : ''}${e.thirdMove ? chip(`2nd move ${e.thirdMove[0] / 1000}k · ${e.thirdMove[1]} candy`) : ''}</div>`; }
  else if (a) h += `<div class="kpis"><div><small>From</small><b>${esc(a.from)}</b></div><div><small>After evolving</small><b>${a.cpNow} CP · to L${a.toLevel}</b></div><div><small>IV rank GL</small><b>#${a.glRank} · ${a.glPct.toFixed(1)}%</b></div></div>`;
  else { const pre = (APP.prevo || {})[id], sc = pre && DATA.stats[pre.split('_')[0].toUpperCase()] ? safeCap(pre, id) : null;
    h += `<div class="kpis"><div><small>Status</small><b>${st || (benched ? 'benched' : 'not in roster')}</b></div><div><small>In teams</small><b>${teamsIn} of ${rep.todayAll.length}</b></div>${sc ? `<div><small>Catch ${esc(nm(pre))}</small><b>≤ ${sc.safe} CP</b></div>` : e.thirdMove ? `<div><small>2nd move</small><b>${e.thirdMove[0] / 1000}k · ${e.thirdMove[1]}</b></div>` : '<div><small>Types</small><b>' + esc(e.types.join(' / ')) + '</b></div>'}</div>`; }
  // moves
  h += `<div class="note" style="margin:4px 0 0">Moves${o ? ' on your copy' : ' for planning'}</div>${movesRow(id, moves)}${notRec.length ? `<div class="note" style="margin-top:-4px">PvPoke recommends ${esc(rec.map(mvName).join(' · '))}.</div>` : ''}`;
  // actions
  const acts = [
    o && o.scan ? `<button onclick="Planner.showScan('${esc(o.scan.species)}')">Show scan</button>` : '',
    `<button onclick="Planner.fillSlot('${id}');Planner.closeMon();showTab('meta')">Try in builder</button>`,
    o && !benched ? `<button onclick="Planner.bench('${id}');Planner.renderMon()">Bench</button>` : '',
    benched ? `<button onclick="Planner.unbench('${id}');Planner.renderMon()">Unbench</button>` : '',
    a && !benched ? `<button onclick="Planner.bench('${id}');Planner.renderMon()">Not evolving it</button>` : '',
    !st && !benched ? `<button onclick="Planner.want('${id}',true)">Add to wanted</button><button onclick="Planner.addAs('pending','${id}')">Add as pending</button><button onclick="Planner.addAs('owned','${id}')">I own one</button>` : '',
    st === 'wanted' ? `<button onclick="Planner.addAs('pending','${id}')">Got it, pending</button>` : '',
    st === 'pending' && !a ? `<button onclick="Planner.addAs('owned','${id}')">Built it, owned</button>` : '',
    o && o.manual ? `<button class="danger" onclick="Planner.dropMon('owned','${id}')">Remove from roster</button>` : '',
    ROSTER.pending[id] !== undefined && !o ? `<button class="danger" onclick="Planner.dropMon('pending','${id}')">Remove from pending</button>` : '',
    ROSTER.candidates[id] !== undefined && !o ? `<button class="danger" onclick="Planner.dropMon('candidates','${id}')">Remove from wanted</button>` : '',
    o && !o.manual ? `<span class="note" style="margin:0;align-self:center">Owned through a scan: delete the card on Scans to remove it.</span>` : '',
  ].filter(Boolean).join('');
  h += `<div class="acts">${acts}</div></div>`;
  // roster fit
  const fit = rosterFit(m, id), best = rep.today[0];
  h += `<div class="sec">With your roster <small>${fit.owned ? `in ${fit.inTeams} of ${fit.of} buildable teams` : 'if you add it'}</small></div>`;
  if (!fit.owned && fit.delta !== null) h += `<div class="team" style="cursor:default"><span class="sc ${fit.delta > 0 ? '' : 'dim'}">${fit.delta > 0 ? '+' + fit.delta : fit.delta}</span><span class="nm">${fit.delta > 0 ? `Lifts your best team from ${best.teamScore.toFixed(0)} to ${fit.top.teamScore.toFixed(0)}` : `Best team with it scores ${fit.top.teamScore.toFixed(0)}, your current best is ${best.teamScore.toFixed(0)}`}</span><div class="dt">${fit.answers.length ? `Answers ${esc(fit.answers.map(nm).join(', '))}, which your best team ${best.unansweredMeta.length ? 'lacks' : 'struggles with'}.` : 'Does not fix a weak spot of your current best team.'}</div></div>`;
  else if (!fit.owned) h += `<div class="note">Own at least two other Pokémon under the cap to see teams with it.</div>`;
  if (fit.owned && fit.answers.length) { const inBest = best && best.members.some(x => x.speciesId === id);
    h += `<div class="note">${inBest ? `In your best team it is the one answer to ${esc(fit.answers.map(nm).join(', '))}: keep it for those.` : `Answers ${esc(fit.answers.map(nm).join(', '))}, which your best team struggles with.`}</div>`; }
  if (fit.teams.length) h += fit.teams.map(t => teamLine(t)).join('');
  else if (fit.owned) h += `<div class="note">Not in any of the top ${fit.of} teams from what you own.</div>`;
  if (fit.owned && fit.partners.length) h += `<div class="note">Best partners: ${fit.partners.map(p => `<a href="#" onclick="Planner.openMon('${p}');return false">${esc(nm(p))}</a>`).join(', ')}</div>`;
  // matchups against the meta
  const rated = L.meta.filter(x => x !== id).map(x => ({o: x, r: L.rating(id, x)}));
  const wins = rated.filter(x => x.r >= 500).sort((p, q) => q.r - p.r), losses = rated.filter(x => x.r < 400).sort((p, q) => APP.pokemon[p.o].rank - APP.pokemon[q.o].rank);
  const mchip = x => `<span class="chip ${x.r >= 500 ? 'meta1' : 'warn'}" style="cursor:pointer" onclick="Planner.openMon('${x.o}')">${esc(nm(x.o))} <span style="opacity:.7">#${APP.pokemon[x.o].rank}</span></span>`;
  h += `<div class="sec">Against the meta <small>${wins.length} wins · ${rated.length - wins.length - losses.length} even · ${losses.length} losses of ${rated.length}</small></div>`;
  h += `<div class="team" style="cursor:default"><div class="nm" style="font-size:13px">Loses to <span class="dim">most dangerous first</span></div><div class="chips">${losses.slice(0, 10).map(mchip).join('') || '<span class="dim">nothing in the meta beats it clearly</span>'}</div>
    <div class="nm" style="font-size:13px;margin-top:10px">Beats</div><div class="chips">${wins.slice(0, 10).map(mchip).join('') || '<span class="dim">no clear wins</span>'}</div>
    <div class="note" style="margin:8px 0 0">Ratings: PvPoke's published matchups where available, type effectiveness and rank otherwise. Tap a name for its page.</div></div>`;
  // where to get it
  if (!o) {
    const av = availability(id);
    h += `<div class="sec">Where to get ${esc(e.name)} <small>Leek Duck schedule</small></div>`;
    if (av === null) h += `<div class="note">${window.Sources && Sources.error() ? 'Schedule not available: ' + esc(Sources.error()) : 'Loading the raid and egg schedule…'}</div>`;
    else if (!av.length) h += `<div class="note">Not in raids, eggs, research or announced events right now (checked ${esc(family(id).map(nm).join(', '))}). Wild spawns are not listed.</div>`;
    else h += `<div class="team" style="cursor:default">${availLines(av, 8)}</div>`;
  }
  return h;
}
function dropMon(kind, id) { delete ROSTER[kind][id]; saveRoster(); refresh(); renderMon(); }
function addAs(kind, id) { if (!APP.pokemon[id]) return; for (const k of ['owned', 'pending', 'candidates']) if (k !== kind) delete ROSTER[k][id]; ROSTER[kind][id] = null; ROSTER.exclude = ROSTER.exclude.filter(x => x !== id); saveRoster(); refresh(); renderMon(); }
function renderRoster() {
  const el = $('board'); if (!el) return;
  try { renderRosterInner(el); } catch (e) { el.innerHTML = errorCard('Roster', e); }
}
function renderRosterInner(el) {
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading PvPoke data…</div>'; return; }
  const m = M(), ts = tiles(m);
  const counts = {}; ts.forEach(t => counts[t.st] = (counts[t.st] || 0) + 1);
  const lbl = {ready: 'ready', power: 'powering up', manual: 'not scanned', pending: 'pending', wanted: 'wanted', xl: 'XL gated', bench: 'benched'};
  const clsOf = {ready: 'ok', power: 'gold', manual: '', pending: 'gl', wanted: '', xl: 'warn', bench: ''};
  let h = `<div class="chips" style="margin:0 0 10px">${Object.entries(counts).map(([k, v]) => chip(`${v} ${lbl[k]}`, clsOf[k])).join('')}</div>`;
  h += `<div class="tiles">${ts.map(t => `<div class="tile ${t.st}" onclick="Planner.openMon('${t.id}')"><b>${esc(nm(t.id))}</b><small>${esc(t.sub)}</small>${t.bar !== null && t.bar !== undefined ? `<div class="pb"><div style="width:${Math.round(t.bar * 100)}%"></div></div>` : ''}<span class="st">${esc(t.txt)}</span></div>`).join('')}
    <div class="tile add" onclick="Planner.toggleAdd()"><b>+</b><span class="st">add</span></div></div>`;
  h += `<div class="add" id="addrow" style="${UI.adding ? '' : 'display:none'}"><input id="addid" list="species" placeholder="species id, e.g. lickilicky"><select id="addkind"><option value="owned">owned</option><option value="pending">pending</option><option value="candidates">wanted</option></select><button onclick="Planner.add()">Add</button></div>`;
  h += `<div class="sec">Your in-game parties <small>scored as-is · weak spots</small></div>` + (m.rep.tagged.length ? m.rep.tagged.map(t => partyCard(m.L, t, m, {remove: true, max: 4})).join('') : '<div class="note">None yet. Add the three Pokémon of a battle party below to see what it fears.</div>');
  h += `<div class="add"><input id="tagname" placeholder="name" style="min-width:70px;flex:.6"><input id="tag1" list="species" placeholder="1"><input id="tag2" list="species" placeholder="2"><input id="tag3" list="species" placeholder="3"><button onclick="Planner.addTag()">Add</button></div>`;
  h += `<div class="tools"><button class="btn sec" onclick="Planner.exportRoster()">Export roster JSON</button><button class="btn sec" onclick="Planner.loadRepoRoster()">Load saved roster</button></div>`;
  el.innerHTML = h;
}

/* ---------- Meta tab: builder, meta teams, rankings ---------- */
function ownership(m, id) {                    // where a species stands in your roster
  if (m.own[id]) return m.own[id].manual ? 'owned' : 'owned';
  if (id in m.ri.pending) return 'pending';
  if (id in m.ri.candidates) return 'wanted';
  return null;
}
const ownChip = st => st ? chip(st, st === 'owned' ? 'ok' : st === 'pending' ? 'gl' : '') : '';
function builderLeague(m) {                    // roster movesets plus the builder's own per-slot choices
  const ov = Object.assign({}, m.L.overrides);
  for (const [id, mv] of Object.entries(UI.build.moves)) if (mv && mv.length) ov[id] = mv;
  return new PVP.League(APP, ov);
}
function needLine(m, ids) {
  const parts = ids.map(id => { const st = ownership(m, id);
    if (st === 'owned') return null;
    if (st === 'pending') return `${nm(id)} is pending`;
    const pre = (APP.prevo || {})[id], sc = pre && DATA.stats[pre.split('_')[0].toUpperCase()] ? safeCap(pre, id) : null;
    return sc ? `catch a ${nm(pre)} ≤ ${sc.safe} CP for ${nm(id)}` : `find a ${nm(id)}`; }).filter(Boolean);
  return parts.length ? `You still need: ${parts.join(' · ')}.` : 'You own all three.';
}
function renderMeta() {
  const el = $('meta'); if (!el) return;
  try { renderMetaInner(el); } catch (e) { el.innerHTML = errorCard('Meta', e); }
}
function renderMetaInner(el) {
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading PvPoke data…</div>'; return; }
  const m = M(), L = builderLeague(m);
  const seg = ['build', 'teams', 'rank'].map(k => `<button class="${UI.metaPanel === k ? 'on' : ''}" onclick="Planner.metaPanel('${k}')">${{build: 'Builder', teams: 'Meta teams', rank: 'Rankings'}[k]}</button>`).join('');
  let h = `<div class="tabs sub">${seg}</div>`;
  if (UI.metaPanel === 'build') h += renderBuilder(m, L);
  else if (UI.metaPanel === 'teams') h += renderMetaTeams(m);
  else h += renderRankings(m);
  el.innerHTML = h;
}
function renderBuilder(m, L) {
  const slots = UI.build.slots, filled = slots.filter(Boolean);
  let h = `<div class="note">Pick any three Pokémon: from the rankings, a meta team, or your roster. Scored with the same heuristic as Today.</div>`;
  h += `<div class="roles">` + slots.map((id, i) => id ? `<div class="role slot"><span class="rl">Slot ${i + 1}</span><span class="rn" onclick="Planner.openMon('${id}')" style="cursor:pointer">${esc(nm(id))}</span><span class="rm">#${APP.pokemon[id].rank}${ownership(m, id) ? ' · ' + ownership(m, id) : ''}</span><span class="x" onclick="Planner.setSlot(${i},null)">✕</span></div>`
    : `<div class="role slot empty" onclick="Planner.metaPanel('rank')"><span class="rl">Slot ${i + 1}</span><span class="rn dim">+</span><span class="rm">pick from rankings</span></div>`).join('') + `</div>`;
  h += `<div class="add" style="margin-top:8px"><input id="slotid" list="species" placeholder="or type a species id"><button onclick="Planner.addSlotFromInput()">Add</button>${filled.length ? `<button onclick="Planner.clearSlots()" style="background:var(--card);color:var(--dim);border:1px solid var(--line)">Clear</button>` : ''}</div>`;
  // per-slot move choice
  if (filled.length) h += filled.map(id => `<div class="own"><div class="h"><b>${esc(nm(id))}</b><span>${L.movesOf(id).map(mvName).map(esc).join(' · ')}</span></div>${movesRow(id, L.movesOf(id), `Planner.setBuildMove('${id}',SLOT,this.value)`)}</div>`).join('');
  if (filled.length === 3) {
    const ev = L.evaluate(filled), d = L.describe(filled, ev), bm = APP.benchmark || {best: 721, median: 521};
    const pctBar = Math.max(4, Math.min(100, (ev.score - 300) / (bm.best - 300) * 100)), medPos = (bm.median - 300) / (bm.best - 300) * 100;
    const rl = roles(L, filled);
    h += `<div class="hero" onclick="Planner.coverageWith(${JSON.stringify(filled).replace(/"/g, '&quot;')})">
      <div class="sec" style="margin:0 0 8px">This team <small>tap for coverage</small></div>
      <div class="scorebar" style="margin-top:0"><span class="big">${ev.score.toFixed(0)}</span><div class="track"><div class="fill" style="width:${pctBar}%"></div><div class="tick" style="left:${medPos}%"></div></div><span class="dim">meta best ${bm.best.toFixed(0)}</span></div>
      <div class="dim" style="font-size:12px;margin-top:8px">${rl.map(r => `${r.role}: <b style="color:var(--ink)">${esc(nm(r.id))}</b>`).join(' · ')}</div>
      <div class="dim" style="font-size:12px;margin-top:6px">${d.unansweredMeta.length ? `No answer to ${chip(d.unansweredMeta.join(', '), 'warn')}. ` : 'Covers every meta Pokémon. '}${d.sharedWeaknesses.length ? `Two lose to ${esc(d.sharedWeaknesses.join(', '))}.` : ''}</div>
      <div style="font-size:13px;margin-top:8px">${esc(needLine(m, filled))}</div></div>`;
    const missing = filled.filter(id => !ownership(m, id));
    h += `<div class="acts"><button onclick="Planner.saveBuildAsTeam()">Save as in-game party</button>${missing.length ? `<button onclick="Planner.wantMissing()">Add ${missing.length} missing to wanted</button>` : ''}</div>`;
  } else if (filled.length === 2) {
    const ownedPool = Object.keys(m.ri.owned).filter(p => !filled.includes(p) && new Set(filled.concat(p).map(PVP.baseSpecies)).size === 3);
    const metaPool = APP.meta.slice(0, 40).filter(p => !filled.includes(p) && new Set(filled.concat(p).map(PVP.baseSpecies)).size === 3);
    const best = pool => pool.map(p => [L.evaluate(filled.concat(p)).score, p]).sort((a, b) => b[0] - a[0]).slice(0, 3);
    const a = best(ownedPool), b = best(metaPool);
    h += `<div class="sec">Best third <small>tap to fill the slot</small></div>`;
    if (a.length) h += `<div class="note">From your roster</div><div class="thirds">${a.map(([sc, p]) => `<div class="third" onclick="Planner.fillSlot('${p}')"><span>${esc(nm(p))}</span><small>${sc.toFixed(0)}</small></div>`).join('')}</div>`;
    h += `<div class="note">From the meta</div><div class="thirds">${b.map(([sc, p]) => `<div class="third" onclick="Planner.fillSlot('${p}')"><span>${esc(nm(p))}</span><small>${sc.toFixed(0)}${ownership(m, p) ? ' · ' + ownership(m, p) : ''}</small></div>`).join('')}</div>`;
  }
  return h;
}
function renderMetaTeams(m) {
  const teams = APP.metaTeams || [];
  if (!teams.length) return '<div class="note">No derived meta teams in the data file yet.</div>';
  return `<div class="note">The ${teams.length} best trios from the top 40 of PvPoke's meta group, scored with the same heuristic. "Try" loads a team into the builder.</div>` +
    teams.map((t, i) => `<div class="team" style="cursor:default"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><span><span class="sc">${t.score.toFixed(1)}</span><span class="nm">${t.members.map(id => `<a href="#" onclick="Planner.openMon('${id}');return false">${esc(nm(id))}</a> <span class="dim">#${APP.pokemon[id] ? APP.pokemon[id].rank : '?'}</span>`).join(' / ')}</span></span><span class="dim" style="font-size:12px;white-space:nowrap">#${i + 1}</span></div>
      <div class="dt">${t.holes.length ? `no answer to <b>${esc(t.holes.join(', '))}</b> · ` : ''}${t.shared.length ? `two lose to ${esc(t.shared.join(', '))} · ` : ''}${esc(needLine(m, t.members))}</div>
      <div class="acts small"><button onclick="Planner.tryTeam(${JSON.stringify(t.members).replace(/"/g, '&quot;')})">Try in builder</button><button onclick="Planner.coverageWith(${JSON.stringify(t.members).replace(/"/g, '&quot;')})">Coverage</button></div></div>`).join('');
}
function renderRankings(m) {
  const q = UI.rankQ.toLowerCase(), ty = UI.rankType;
  const all = Object.entries(APP.pokemon).sort((a, b) => a[1].rank - b[1].rank)
    .filter(([id, e]) => (!q || e.name.toLowerCase().includes(q) || id.includes(q)) && (!ty || e.types.includes(ty)));
  const shown = all.slice(0, UI.rankLimit);
  let h = `<div class="add"><input id="rankq" placeholder="Search ${Object.keys(APP.pokemon).length} ranked Pokémon" value="${esc(UI.rankQ)}" oninput="Planner.rankSearch(this.value)"><select onchange="Planner.rankType(this.value)"><option value="">any type</option>${TYPES18.map(t => `<option value="${t}" ${ty === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  h += `<div class="note">PvPoke ${esc(APP.league.title)} overall rankings · gamemaster ${esc(APP.gamemasterTimestamp.slice(0, 10))} · ${all.length} match${all.length === 1 ? '' : 'es'}</div>`;
  h += shown.map(([id, e]) => `<div class="rank"><span class="rk">#${e.rank}</span><div class="rb" onclick="Planner.openMon('${id}')" style="cursor:pointer"><div class="rn"><b>${esc(e.name)}</b> <span class="dim">${e.score}</span> ${ownChip(ownership(m, id))}</div><div class="dt">${e.types.join(' / ')} · ${e.moveset.map(mvName).map(esc).join(' · ')}</div></div>
    <div class="ra"><button onclick="Planner.fillSlot('${id}')" title="add to builder">slot</button>${ownership(m, id) ? '' : `<button onclick="Planner.want('${id}')" title="add to wanted">want</button>`}</div></div>`).join('');
  if (all.length > shown.length) h += `<div class="note" style="cursor:pointer" onclick="Planner.rankMore()">▸ show ${Math.min(100, all.length - shown.length)} more</div>`;
  return h;
}
function metaPanel(k) { UI.metaPanel = k; renderMeta(); }
function rankSearch(v) { UI.rankQ = v; UI.rankLimit = 50; const el = $('meta'); const pos = $('rankq') && $('rankq').selectionStart; renderMeta(); const q = $('rankq'); if (q) { q.focus(); if (pos != null) q.setSelectionRange(pos, pos); } }
function rankType(v) { UI.rankType = v; UI.rankLimit = 50; renderMeta(); }
function rankMore() { UI.rankLimit += 100; renderMeta(); }
function setSlot(i, id) { UI.build.slots[i] = id; saveBuild(); UI.metaPanel = 'build'; renderMeta(); }
function fillSlot(id) { if (UI.build.slots.includes(id)) { UI.metaPanel = 'build'; renderMeta(); return; }
  let i = UI.build.slots.indexOf(null); if (i < 0) i = 2; setSlot(i, id); }
function addSlotFromInput() { const id = ($('slotid').value || '').trim().toLowerCase(); if (APP.pokemon[id]) fillSlot(id); else { $('slotid').value = ''; $('slotid').placeholder = 'unknown species id'; } }
function clearSlots() { UI.build = {slots: [null, null, null], moves: {}}; saveBuild(); renderMeta(); }
function tryTeam(ids) { UI.build.slots = ids.slice(0, 3); UI.metaPanel = 'build'; saveBuild(); renderMeta(); window.scrollTo(0, 0); }
function setBuildMove(id, slot, val) { const m = M(), L = builderLeague(m); UI.build.moves[id] = place(L.movesOf(id).slice(), slot, val); saveBuild(); renderMeta(); }
function coverageWith(ids) { const m = M(), L = builderLeague(m); coverageFor(L, ids, m); }
function want(id, stay) { if (!APP.pokemon[id]) return; ROSTER.candidates[id] = null; ROSTER.exclude = ROSTER.exclude.filter(x => x !== id); saveRoster(); refresh();
  if (stay) renderMon(); else openMon(id); }
function wantMissing() { for (const id of UI.build.slots) if (id && !ownership(M(), id)) ROSTER.candidates[id] = null; saveRoster(); refresh(); }
function saveBuildAsTeam() { const ids = UI.build.slots.filter(Boolean); if (ids.length !== 3) return;
  const name = prompt('Name for this party', ids.map(nm).join(' / ')); if (!name) return; ROSTER.tagged[name] = ids.slice(); saveRoster(); refresh(); status(`Saved "${name}" under your in-game parties`); }

/* ---------- actions ---------- */
function refresh() { dirty = true; renderToday(); renderRoster(); renderMeta(); if (UI.mon && $('view-mon').classList.contains('on')) renderMon(); }
function markDirty() { dirty = true; }
function toggleAdd() { UI.adding = !UI.adding; renderRoster(); if (UI.adding) $('addid').focus(); }
function add() { const id = $('addid').value.trim().toLowerCase(), kind = $('addkind').value;
  if (!APP.pokemon[id]) { $('addid').value = ''; $('addid').placeholder = 'unknown species id'; return; }
  ROSTER[kind][id] = null; ROSTER.exclude = ROSTER.exclude.filter(x => x !== id); UI.adding = false; saveRoster(); refresh(); openMon(id); }
function drop(kind, id) { delete ROSTER[kind][id]; saveRoster(); refresh(); }
function bench(id) { if (ROSTER.owned[id] !== undefined) delete ROSTER.owned[id]; else if (!ROSTER.exclude.includes(id)) ROSTER.exclude.push(id); saveRoster(); refresh(); }
function unbench(id) { ROSTER.exclude = ROSTER.exclude.filter(x => x !== id); saveRoster(); refresh(); }
function place(cur, slot, val) {           // set a slot; if the move sits in the other charged slot, swap them
  const other = slot === 1 ? 2 : slot === 2 ? 1 : -1;
  if (other > 0 && cur[other] === val) cur[other] = cur[slot];
  cur[slot] = val; return cur;
}
function setMove(id, slot, val) {
  const m = M(), o = m.own[id];
  const cur = place((o ? o.moves : (ROSTER.moves[id] || m.ri.pending[id] || APP.pokemon[id].moveset)).slice(), slot, val);
  if (o && o.scan) { o.scan.moves = cur; save(); render(); } else ROSTER.moves[id] = cur;
  saveRoster(); refresh();
}
function addTag() { const name = $('tagname').value.trim(), team = [1, 2, 3].map(i => $('tag' + i).value.trim().toLowerCase());
  if (!name || team.some(t => !APP.pokemon[t])) return; ROSTER.tagged[name] = team; saveRoster(); refresh(); }
function dropTag(name) { delete ROSTER.tagged[name]; saveRoster(); refresh(); }
function exportRoster() { const ri = rosterInput();
  shareFile('roster-great.json', JSON.stringify({league: 'great', notes: 'Exported from PokeScan. Moves are the ones on the Pokemon; null means PvPoke recommended.',
    owned: ri.owned, pending: ri.pending, candidates: ri.candidates, tagged: ri.tagged}, null, 2), 'application/json'); }
async function loadRepoRoster() {
  try {
    const r = await (await fetch('data/roster-great.json', {cache: 'no-cache'})).json(), scanned = rosterOwned();
    for (const [k, v] of Object.entries(r.owned || {})) if (APP.pokemon[k] && !scanned[k]) ROSTER.owned[k] = v || null;
    for (const [k, v] of Object.entries(r.pending || {})) if (APP.pokemon[k]) ROSTER.pending[k] = v || null;
    for (const k of Object.keys(r.candidates || {})) if (APP.pokemon[k]) ROSTER.candidates[k] = null;
    for (const [k, v] of Object.entries(r.tagged || {})) if (v.length === 3 && v.every(x => APP.pokemon[x])) ROSTER.tagged[k] = v;
    for (const [k, v] of Object.entries(Object.assign({}, r.owned, r.pending))) if (v && v.length && APP.pokemon[k]) ROSTER.moves[k] = v;
    saveRoster(); refresh();
  } catch (e) { status('Could not load data/roster-great.json'); }
}
function showScan(species) { showTab('scans'); const q = $('q'); if (q) { q.value = species; render(); } }
function movesRowForScan(r, idx) {      // used by the Scans view: manual move selection on a card
  const s = scanId(r); if (!s || !s.id || !APP) return '';
  return movesRow(s.id, movesFor(r, s.id), `Planner.setScanMove(${idx},SLOT,this.value)`);
}
function setScanMove(idx, slot, val) {
  const r = results[idx], s = scanId(r); if (!s || !s.id) return;
  r.moves = place(movesFor(r, s.id).slice(), slot, val); save(); render(); refresh();
}
function speciesOptions() { return Object.keys(APP.pokemon).map(id => `<option value="${id}">`).join(''); }

window.Planner = {refresh, markDirty, renderToday, renderRoster, renderMeta, renderMon, openMon, closeMon, dropMon, addAs, coverage, coverageWith, closeSheet,
                  metaPanel, rankSearch, rankType, rankMore, setSlot, fillSlot, addSlotFromInput, clearSlots, tryTeam, setBuildMove, want, wantMissing, saveBuildAsTeam, toggleAdd, add, drop, bench, unbench,
                  onNewScan, afterImport, scanProof, markDone, snooze, unsnooze, undoDone, toggleMore, showScanKey,
                  askCoach, setMove, setScanMove, addTag, dropTag, exportRoster, loadRepoRoster, showScan, movesRowForScan, speciesOptions, rosterInput, ROSTER, scanId, movesFor};
})();
