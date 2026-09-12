/* PokeScan planner — Today view, coverage drill-down and roster board.
   Uses globals from index.html: results, save, render, DATA, APP, PVP, $, calcCP, calcHP, cpmAt,
   pvpRank, costTo, maxLevelUnderCap, pct, bestOf2, planFor, refixScan, toggleFav, toggleBench, shareFile, status, pvpokeIdFor, evoBaseStats, showTab. */
(function () {
'use strict';
const ROSTER = Object.assign({owned: {}, pending: {}, candidates: {}, tagged: {}, moves: {}, exclude: [], done: {}, snooze: {}, log: [], seen: {}},
                             JSON.parse(localStorage.getItem('roster') || '{}'));
const UI = {selected: null, showAll: false, expect: null, mon: null, scan: null, monFrom: 'roster',
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
  return {best, base: best[4] || DATA.stats[r.species][0], id: pvpokeIdFor(r.species, best[4] || DATA.stats[r.species][0], r.shadow)};
}
function movesFor(r, id) {                     // moves used for scoring: what is on the Pokémon, padded with PvPoke's set while the 2nd charged move is unknown
  const m = ((r && r.moves && r.moves.length) ? r.moves : (ROSTER.moves[id] || detectMoves(id, r && r.txt))).filter(Boolean);
  if (m.length === 2 && !(r && r.secondMove === false) && APP.pokemon[id]) { const extra = APP.pokemon[id].moveset.slice(1).find(x => !m.includes(x)); if (extra) return m.concat(extra); }
  return m;
}
function hasSecond(r, id) {                    // false only with evidence (NEW ATTACK seen or one charged move set by hand); unknown counts as unlocked so nobody is nagged without proof
  if (r && r.secondMove === false) return false;
  if (r && r.secondMove === true) return true;
  return (r && r.moves && r.moves.length) ? r.moves.filter(Boolean).length >= 3 || r.secondMove === undefined : movesFor(r, id).length >= 3;
}
function rosterOwned() {
  const own = {};
  if (!APP) return own;
  for (const r of results) {
    const s = scanId(r); if (!s || !s.id || !r.cp || r.cp > LEAGUE.cp || r.bench || ROSTER.exclude.includes(s.id)) continue;
    const {best, base, id} = s;
    // a pre-evolution whose evolution fits under the cap is a pending piece, not a team member
    if ((APP.pokemon[id].evo || []).some(ev => { const eb = APP.pokemon[ev] && evoBaseStats(ev);
        return eb && calcCP(eb, best[1], best[2], best[3], cpmAt(best[0])) <= LEAGUE.cp; })) continue;
    const gl = pvpRank(base, best[1], best[2], best[3], LEAGUE.cp);
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
      const eb = evoBaseStats(evo); if (!eb || calcCP(eb, s.best[1], s.best[2], s.best[3], cpmAt(s.best[0])) > LEAGUE.cp) continue;
      const rk = pvpRank(eb, s.best[1], s.best[2], s.best[3], LEAGUE.cp);
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
  const ri = rosterInput(), L = PVP.fromRoster(APP, ri, mxFor()), rep = L.report(ri, 10);
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
    if (calcCP(evo, a, d, s, m) <= LEAGUE.cp) { if (cpre > maxOk) maxOk = cpre; } else if (cpre < minBad) minBad = cpre;
  }
  if (minBad === Infinity) return capCache[k] = null;   // every copy of the pre-evolution stays legal after evolving: no catch cap to show
  return capCache[k] = {safe: minBad - 1, max: maxOk};
}

/* ---------- analysis helpers ---------- */
function roles(L, team) {
  const sim = L.simRoles ? L.simRoles(team) : null; if (sim) return sim;
  const st = team.map(id => { let losses = 0, sum = 0; for (const o of L.meta) { const r = L.rating(id, o); sum += r; if (r < 400) losses++; } return {id, losses, mean: sum / L.meta.length}; });
  st.sort((a, b) => a.losses - b.losses || b.mean - a.mean);
  const swap = st[0], rest = st.slice(1).sort((a, b) => b.mean - a.mean);
  return [{role: 'Lead', id: rest[1].id}, {role: 'Swap', id: swap.id}, {role: 'Closer', id: rest[0].id}];
}
function coverers(L, team, o) { return team.filter(m => L.rating(m, o) >= 500); }
function nextMoves(m) {
  const {L, rep, own, auto, ri} = m, out = [];
  const best = rep.today[0], bestScore = best ? best.teamScore : 0;
  const inTeam = new Set(best ? best.members.map(x => x.speciesId) : []);
  const inParty = new Set(Object.values(ROSTER.tagged).flat());
  // "focus" items concern the Pokémon you actually run: the recommended team and your saved in-game parties.
  // Everything else (bench power-ups, catches for a hypothetical team) is an idea, kept behind "more" so dust goes where it matters.
  const focus = id => inTeam.has(id) || inParty.has(id);
  const roleOf = id => inTeam.has(id) ? 'in team' : inParty.has(id) ? 'in a party' : 'in a top team';
  for (const o of Object.values(own)) {
    if (o.manual) continue;
    if (o.toLevel > 40 && o.toLevel > o.level) { const c = costTo(o.level, o.toLevel);
      out.push({id: 'park:' + o.id, p: 9, tag: 'skip', cls: 'warn', focus: false, title: `${nm(o.id)} needs L${o.toLevel}`, sub: `${fmt(c.dust)} dust${c.xl ? `, ${c.xl} XL candy` : ''} · park it`}); continue; }
    if (o.toLevel > o.level) { const c = costTo(o.level, o.toLevel), f = focus(o.id);
      out.push({id: 'pu:' + o.id, species: o.id, p: inTeam.has(o.id) ? 0 : f ? 1 : 3, tag: f ? roleOf(o.id) : 'bench', cls: f ? 'ok' : 'dim', focus: f,
                title: `Power up ${nm(o.id)} to L${o.toLevel}`, sub: `${o.cp} → ${o.toCP} CP · ${fmt(c.dust)} dust · ${c.candy} candy${f ? '' : ' · only if you have dust to spare'}`}); }
  }
  // moves: team members should carry PvPoke's moveset and both charged moves
  const teamIds = new Set(rep.today.slice(0, 3).flatMap(t => t.members.map(x => x.speciesId)).concat([...inParty], UI.team ? UI.team.ids : []));
  for (const o of Object.values(own)) {
    if (!teamIds.has(o.id)) continue;
    const e = APP.pokemon[o.id], cur = (o.moves || []).filter(Boolean), rec = e.moveset, role = roleOf(o.id), f = focus(o.id);
    const gain = () => { const ov = Object.assign({}, L.overrides, {[o.id]: rec}); const L2 = new PVP.League(APP, ov, mxFor()); const t = (best ? best.members.map(x => x.speciesId) : null); return t && t.includes(o.id) ? Math.round((L2.evaluate(t).score - best.teamScore) * 10) / 10 : 0; };
    const second = o.manual ? true : hasSecond(o.scan, o.id);
    if (!second) { const c = e.thirdMove || [75000, 75], wantC = rec.slice(1).find(m => !cur.includes(m)) || rec[2], d = gain();
      out.push({id: 'move2:' + o.id, species: o.id, p: inTeam.has(o.id) ? 1 : 3, tag: d > 0 ? '+' + d.toFixed(0) : role, cls: d > 0 ? 'gold' : 'ok', delta: d, focus: f,
                title: `Unlock the 2nd charged move on ${nm(o.id)}`, sub: `${fmt(c[0])} dust · ${c[1]} candy · then set ${mvName(wantC)}${e.buddy ? ` · or walk it ${e.buddy} km as buddy first` : ''}`}); }
    if (cur[0] && cur[0] !== rec[0]) { const d = gain();
      out.push({id: 'tm:fast:' + o.id, species: o.id, p: inTeam.has(o.id) ? 1 : 3, tag: d > 0 ? '+' + d.toFixed(0) : role, cls: d > 0 ? 'gold' : 'ok', delta: d, focus: f,
                title: `Fast TM ${nm(o.id)}: ${mvName(cur[0])} → ${mvName(rec[0])}`, sub: `PvPoke's fast move for it${d > 0 ? ` · lifts your team by ${d.toFixed(1)}` : ''} · Elite TM if it is a legacy move`}); }
    const missingC = rec.slice(1).filter(m => !cur.slice(1).includes(m));
    if (second && cur.length >= 3 && missingC.length) { const d = gain(), drop = cur.slice(1).find(m => !rec.includes(m));
      out.push({id: 'tm:charged:' + o.id, species: o.id, p: inTeam.has(o.id) ? 1 : 3, tag: d > 0 ? '+' + d.toFixed(0) : role, cls: d > 0 ? 'gold' : 'ok', delta: d, focus: f,
                title: `Charged TM ${nm(o.id)}: ${drop ? mvName(drop) + ' → ' : ''}${mvName(missingC[0])}`, sub: `PvPoke runs ${rec.slice(1).map(mvName).join(' + ')}${d > 0 ? ` · lifts your team by ${d.toFixed(1)}` : ''} · Elite TM if it is a legacy move`}); }
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
    if (inParty.has(id)) { sub = `${nm(id)} is in your party${sub.startsWith('lifts') ? ' · ' + sub : ''}`; }
    out.push({id: 'get:' + id, species: a ? a.fromId : (pre || id), p: inParty.has(id) ? 0 : delta > 0 ? 1 : 5, tag: inParty.has(id) ? 'in a party' : delta > 0 ? '+' + delta.toFixed(0) : 'no gain', cls: inParty.has(id) ? 'ok' : delta > 0 ? 'gold' : 'dim', focus: inParty.has(id), title, sub, delta, faded: delta <= 0 && !inParty.has(id)});
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
function hint(s, r, kind) {                    // remember which archived card this new scan probably continues, so the card can offer a one-tap merge
  if (s.lineageHint) { s.lineageHint.multi = true; return; }
  s.lineageHint = {key: r.key, species: r.species, cp: r.cp, kind};
}
function lineageMerge(newKey) {               // "Yes, same Pokémon": fold the new scan into the old card (one card, CP history) instead of keeping an archived copy
  const s = results.find(x => x.key === newKey), h = s && s.lineageHint, t = h && results.find(x => x.key === h.key);
  if (!s || !t) { lineageDismiss(newKey); return; }
  const sid = scanId(s), mv = s.moves && s.moves.length && sid && sid.id ? {id: sid.id, fast: s.moves[0], charged: s.moves.slice(1).filter(Boolean), second: s.secondMove, found: true} : null;
  const wasOpen = UI.scan === s.key;
  if (!updateCard(t, s, mv)) { status('Those two do not share an IV spread; kept as separate cards'); lineageDismiss(newKey); return; }
  results.splice(results.indexOf(s), 1);
  for (const e of ROSTER.log) if (e.evidence === s.key) e.evidence = t.key;
  save(); render(); refresh(); status(`${nm(scanId(t).id || t.species)}: one card, ${h.cp} → ${t.cp} CP`);
  if (wasOpen) nav('#/scan/' + encodeURIComponent(t.key));
}
function lineageDismiss(newKey) { const s = results.find(x => x.key === newKey); if (s) { delete s.lineageHint; save(); render(); if (UI.scan === s.key) renderMon(); } }
function onNewScan(s) {                        // called by the scanner after a new card is stored (or an appraisal completes one)
  if (!APP || !s.combos || !s.combos.length || !s.cp) return;
  const sid = scanId(s), newId = sid && sid.id, newLv = lvl(s);
  for (const r of results) {
    if (r === s || r.superseded || !r.combos || !r.combos.length || !r.cp) continue;
    const rid = (scanId(r) || {}).id, oldLv = lvl(r);
    if (!shareIVs(r, s)) continue;
    if (r.species === s.species && s.cp > r.cp && (!oldLv || !newLv || newLv >= oldLv)) {          // power-up
      r.superseded = {by: s.key, why: `powered up to L${newLv ?? '?'}`, t: Date.now()};
      hint(s, r, 'powerup');
      logEntry({kind: 'powerup', id: 'pu:' + rid, title: `${nm(rid || s.species)} powered up ${r.cp} → ${s.cp} CP`, evidence: s.key});
    } else if (rid && newId && (APP.pokemon[rid] || {}).evo && APP.pokemon[rid].evo.includes(newId) && (!oldLv || !newLv || newLv >= oldLv)) {   // evolution
      r.superseded = {by: s.key, why: `evolved into ${nm(newId)}`, t: Date.now()};
      hint(s, r, 'evolution');
      logEntry({kind: 'evolve', id: 'get:' + newId, title: `${nm(rid)} evolved into ${nm(newId)}`, evidence: s.key});
    }
  }
  if (newId && (ROSTER.candidates[newId] !== undefined || ROSTER.pending[newId] !== undefined) && s.cp <= LEAGUE.cp) {
    logEntry({kind: 'catch', id: 'get:' + newId, title: `${nm(newId)} caught, ${s.cp} CP`, evidence: s.key});
    delete ROSTER.candidates[newId]; delete ROSTER.pending[newId];
  } else if (newId) {
    for (const evo of (APP.pokemon[newId].evo || [])) if (ROSTER.candidates[evo] !== undefined) {
      const eb = evoBaseStats(evo), b = sid.best;
      if (eb && calcCP(eb, b[1], b[2], b[3], cpmAt(b[0])) <= LEAGUE.cp) logEntry({kind: 'catch', id: 'get:' + evo, title: `${nm(newId)} caught for ${nm(evo)}, ${s.cp} CP`, evidence: s.key});
    }
  }
  saveRoster(); dirty = true;
}
function updateScan(key) {                     // "Update this Pokémon": the next import belongs to this card (power-up, evolution, appraisal, attacks)
  const r = results.find(x => x.key === key); if (!r) return;
  UI.updateKey = key; status(`Updating ${nice(r.species)} ${r.cp} CP: pick its new screenshots`);
  nav('#/scans'); $('file').click();
}
function updateDone(card) { const k = UI.updateKey; UI.updateKey = null; if (card) { UI.scan = card.key; openScan(card.key); } else if (k && results.some(x => x.key === k)) openScan(k); }
function onUpdated(target, old) {              // called by the scanner after updateCard()
  dirty = true; if (UI.scan && !results.some(x => x.key === UI.scan)) UI.scan = target.key;
  const sid = scanId(target), id = sid && sid.id;
  if (old.species !== target.species) logEntry({kind: 'evolve', id: 'get:' + id, title: `${nice(old.species)} evolved into ${nm(id || target.species)}`, evidence: target.key});
  else if (target.cp > old.cp) logEntry({kind: 'powerup', id: 'pu:' + id, title: `${nm(id || target.species)} powered up ${old.cp} → ${target.cp} CP`, evidence: target.key});
  saveRoster();
}
function scanProof(moveId) {                   // "Scan proof" on a next move: remember what should clear, open the importer
  const m = M(), mv = openMoves(m).find(x => x.id === moveId);
  UI.expect = {id: moveId, title: mv ? mv.title : moveId, before: openMoves(m).map(x => x.id)};
  nav('#/scans'); $('file').click();
}
function beforeImport() { UI.before = openMoves(M()).map(x => ({id: x.id, title: x.title})); UI.touched = []; }
function onMovesScan(r) {                       // a moves screen updated a card
  dirty = true; if (UI.touched && !UI.touched.includes(r.key)) UI.touched.push(r.key);
}
function afterImport(newScans) {               // called by the scanner when an import finishes
  dirty = true; const m = M(), after = new Set(openMoves(m).map(x => x.id));
  const ex = UI.expect; UI.expect = null;
  const ev0 = newScans[0] ? newScans[0].key : (UI.touched || [])[0] || null;
  for (const b of UI.before || []) if (!after.has(b.id) && /^(tm:|move2:|pu:)/.test(b.id) && (!ex || ex.id !== b.id) && !ROSTER.log.some(e => e.id === b.id && e.evidence)) logEntry({kind: 'proof', id: b.id, title: b.title, evidence: ev0});
  UI.before = null;
  if (ex) {
    if (!after.has(ex.id)) {
      if (!ROSTER.log.some(e => e.id === ex.id && e.evidence)) logEntry({kind: 'proof', id: ex.id, title: ex.title, evidence: ev0});
      status(`✓ ${ex.title} — cleared by this scan`);
    } else {
      const sp = newScans.find(r => r.species) || null, mv = openMoves(m).find(x => x.id === ex.id);
      let why = 'the scan did not change it';
      if (sp && mv && mv.id.startsWith('get:')) { const evo = mv.id.slice(4), sid = scanId(sp);
        if (sid && sid.id && (APP.pokemon[sid.id].evo || []).includes(evo)) { const eb = evoBaseStats(evo), b = sid.best, cp = eb ? calcCP(eb, b[1], b[2], b[3], cpmAt(b[0])) : 0;
          why = cp > LEAGUE.cp ? `${nm(sid.id)} would be ${cp} CP as ${nm(evo)}, over the cap` : 'the scan could not be solved'; }
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
function showScanKey(key) { const r = results.find(x => x.key === key); if (!r) return; nav('#/scans'); $('filter').value = r.superseded ? 'arch' : 'all'; $('q').value = r.species; render(); }

/* ---------- rendering: Today ---------- */
const chip = (t, cls) => `<span class="chip ${cls || ''}">${esc(t)}</span>`;
const few = (list, n) => list.length <= (n || 3) ? list.join(', ') : `${list.slice(0, n || 3).join(', ')} and ${list.length - (n || 3)} more`;
const attr = v => esc(JSON.stringify(v === undefined ? null : v));   // a JS literal inside an HTML attribute
function teamRow(m, ids, name, extra) {         // one compact line per team; tap opens the team page
  const {L} = m, ev = L.evaluate(ids), missing = ids.filter(id => ownership(m, id) !== 'owned');
  const weak = ev.holes.length || ev.shared.length
    ? [ev.holes.length ? `<b>${ev.holes.length} unanswered</b>` : '', ev.shared.length ? `${ev.shared.length} beat two of three` : ''].filter(Boolean).join(' · ')
    : '<span class="good">covers the meta</span>';
  const members = ids.map(id => esc(nm(id))).join(' / '), rv = reviewFor(ids);
  return `<div class="team row" onclick="Planner.openTeam(${attr(ids)},${attr(name)})"><span class="sc">${ev.score.toFixed(0)}</span><span class="tx"><span class="nm">${name ? esc(name) : members}</span><div class="dt">${name ? members + ' · ' : ''}${weak}${rv ? `<div class="ai">✦ ${esc(verdictOf(rv))}</div>` : ''}${missing.length ? ` · ${missing.length} not owned` : ''}${extra ? ' · ' + extra : ''}</div></span><span class="go">›</span></div>`;
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
function hintFor(x) {                           // availability phrase for a "get" item
  if (!x.id.startsWith('get:') || !window.Sources || !Sources.ready()) return '';
  const id = x.id.slice(4), hnt = Sources.hint(family(id).map(nm), {shadow: /_shadow$/.test(id)});
  if (hnt) return ` · <span class="good">${esc(hnt)}</span>`;
  const pre = family(id)[1]; if (pre && /_shadow$/.test(id)) return ` · <span class="dim">Shadow ${esc(nm(pre))} from Team GO Rocket, then evolve</span>`;
  return '';
}
function moveCard(x) {
  const menu = ctxMenu([
    x.species && x.tag !== 'skip' ? ['Scan proof', `Planner.scanProof('${x.id}')`] : null,
    x.species ? ['Open ' + nm(x.species), `Planner.openMon('${x.species}')`] : null,
    [x.tag === 'skip' ? 'Dismiss' : 'Done without proof', `Planner.markDone('${x.id}')`],
    ['Snooze 7 days', `Planner.snooze('${x.id}')`],
  ]);
  return `<div class="team move ${x.faded || x.tag === 'skip' ? 'faded' : ''}"><div class="mvt"><span class="nm">${esc(x.title)}</span><div class="dt">${esc(x.sub)}${hintFor(x)}</div></div><div class="side">${chip(x.tag, x.cls === 'dim' ? '' : x.cls)}${menu}</div></div>`;
}
function renderTodayInner(el) {
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading PvPoke data…</div>'; return; }
  const m = M(), {L, rep, own} = m, best = rep.today[0];
  const bm = APP.benchmark || {best: 721, median: 521};
  let h = `<div class="note">PvPoke ${esc(APP.league.title)} · gamemaster ${esc(APP.gamemasterTimestamp.slice(0, 10))} · ${Object.keys(own).length} owned, ${Object.keys(m.ri.pending).length} pending, ${Object.keys(m.ri.candidates).length} wanted</div>`;
  h += changesCard(m);
  if (!best) {
    h += `<div class="empty"><b>No team yet.</b><br>Scan at least three Pokémon at or under ${LEAGUE.cp} CP, add them by name in Roster, or load the saved roster from its ⋮ menu.</div>`;
    el.innerHTML = h; return;
  }
  const ids = best.members.map(x => x.speciesId), rl = roles(L, ids);
  const pctBar = Math.max(4, Math.min(100, (best.teamScore - 300) / (bm.best - 300) * 100)), medPos = (bm.median - 300) / (bm.best - 300) * 100;
  const shared = best.sharedWeaknesses.filter(n => !best.unansweredMeta.includes(n));
  h += `<div class="hero" onclick="Planner.openTeam(${attr(ids)},null)">
    <div class="sec" style="margin:0 0 10px">Run this team <small>best of ${rep.todayAll.length >= 12 ? '12+' : rep.todayAll.length} buildable · tap for details</small></div>
    <div class="roles">${rl.map(r => { const mv = L.movesOf(r.id); return `<div class="role"><span class="rl">${r.role}</span><span class="rn">${esc(nm(r.id))}</span><span class="rm">${esc(mvName(mv[0]))} · ${esc(mvName(mv[1]))}</span></div>`; }).join('')}</div>
    <div class="scorebar"><span class="big">${best.teamScore.toFixed(0)}</span><div class="track"><div class="fill" style="width:${pctBar}%"></div><div class="tick" style="left:${medPos}%"></div></div><span class="dim">meta best ${bm.best.toFixed(0)}</span></div>
    <div class="dim" style="font-size:12px;margin-top:8px">${best.unansweredMeta.length ? `No answer to ${chip(few(best.unansweredMeta), 'warn')}. ` : 'Covers every meta Pokémon. '}${shared.length ? `${shared.length} meta Pokémon beat two of three.` : ''}</div>
  </div>`;
  // next moves: what the Pokémon you actually run still need; everything else is an idea behind "more"
  const all = nextMoves(m), open = all.filter(x => !x.done && !x.snoozed), snoozed = all.filter(x => x.snoozed);
  const primary = open.filter(x => x.focus && !x.faded && x.tag !== 'skip'), rest = open.filter(x => !primary.includes(x));
  h += `<div class="sec">Do next <small>for the team above and your parties</small></div>`;
  if (primary.length) h += primary.map(moveCard).join('');
  else h += `<div class="note">${open.length ? 'Nothing open for the Pokémon you run: they are at the cap and carry the right moves.' : 'Nothing to do right now.'}</div>`;
  if (rest.length || snoozed.length) {
    const kinds = [[rest.filter(x => x.id.startsWith('pu:')).length, 'bench power-ups'], [rest.filter(x => x.id.startsWith('get:')).length, 'catches and evolutions'], [rest.filter(x => /^(tm:|move2:)/.test(x.id)).length, 'move changes'], [rest.filter(x => x.id.startsWith('park:')).length, 'to park'], [snoozed.length, 'snoozed']].filter(k => k[0]).map(k => `${k[0]} ${k[1]}`);
    h += `<div class="more" onclick="Planner.toggleMore()">${UI.showAll ? '▾' : '▸'} <b>${rest.length + snoozed.length} more ideas</b> · ${esc(kinds.join(', '))}<br><span style="font-size:12px">Not for the Pokémon you run, so no dust needed here unless you want to.</span></div>`;
    if (UI.showAll) { h += rest.map(moveCard).join(''); h += snoozed.map(x => `<div class="team move faded"><div class="mvt"><span class="nm">${esc(x.title)}</span><div class="dt">snoozed until ${when(ROSTER.snooze[x.id])}</div></div><div class="side">${ctxMenu([['Unsnooze', `Planner.unsnooze('${x.id}')`], ['Done without proof', `Planner.markDone('${x.id}')`]])}</div></div>`).join(''); }
  }
  if (ROSTER.log.length) {
    h += `<div class="sec">Recently completed</div>` + ROSTER.log.slice(0, 4).map(e => `<div class="team move done"><span class="tick ${e.evidence ? 'full' : 'hollow'}">${e.evidence ? '✓' : '○'}</span><div class="mvt"><span class="nm">${esc(e.title)}</span><div class="dt">${when(e.t)}${e.evidence ? ` · <a href="#" onclick="Planner.showScanKey('${esc(e.evidence)}');return false">scan</a>` : e.kind === 'manual' ? ` · without proof · <a href="#" onclick="Planner.undoDone('${e.id}');return false">undo</a>` : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div></div>`).join('');
  }
  // parties: one line each, the rest lives on the Teams page
  const parties = Object.entries(ROSTER.tagged).filter(([, v]) => v.length === 3 && v.every(x => APP.pokemon[x]));
  h += `<div class="sec">Your in-game parties <small>tap one for weak spots and to-dos</small></div>`;
  h += parties.map(([name, v]) => teamRow(m, v, name)).join('');
  h += `<div class="team row" onclick="Planner.nav('#/teams')"><span class="tx"><span class="nm">${parties.length ? 'All teams' : 'No parties saved yet'}</span><div class="dt">${parties.length ? 'second team, more from your roster, add a party' : 'add the three Pokémon of a battle party, or save one from the builder'}</div></span><span class="go">›</span></div>`;
  h += wantedCard(m);
  h += coachCard(m);
  h += `<div class="note">Heuristic, not a simulation: PvPoke's published matchups where available, type effectiveness and ranking score otherwise. Roles are a guess: the member with the fewest hard losses is the swap, the strongest remaining one closes.</div>`;
  el.innerHTML = h;
}

/* ---------- a species in the meta teams: member of one, or the best trios it forms with two meta partners ---------- */
function metaFit(m, id) {
  const {L} = m, teams = APP.metaTeams || [], bm = APP.benchmark || {best: 721};
  const inTeams = teams.map((t, i) => ({t, i})).filter(x => x.t.members.includes(id));
  let h = `<div class="sec">In meta teams <small>${inTeams.length ? `${inTeams.length} of the ${teams.length} derived meta teams` : `none of the ${teams.length} derived meta teams`}</small></div>`;
  if (inTeams.length) return h + inTeams.slice(0, 3).map(x => teamRow(m, x.t.members, null, `meta #${x.i + 1}`)).join('') + (inTeams.length > 3 ? `<div class="note">… and ${inTeams.length - 3} more under Meta › Meta teams.</div>` : '');
  // best trios with two partners from the top 40 of the meta
  const pool = APP.meta.slice(0, 40).filter(p => p !== id && PVP.baseSpecies(p) !== PVP.baseSpecies(id));
  const best = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    if (PVP.baseSpecies(pool[i]) === PVP.baseSpecies(pool[j])) continue;
    const ids = [id, pool[i], pool[j]]; best.push({ids, score: L.evaluate(ids).score});
  }
  best.sort((a, b) => b.score - a.score);
  if (!best.length) return h + `<div class="note">Not enough meta partners to build a trio.</div>`;
  const top = best[0], ref = teams[0] ? teams[0].score : bm.best;
  h += `<div class="note">Best trio with ${esc(nm(id))} and two meta partners scores ${top.score.toFixed(0)}; the best meta team scores ${ref.toFixed(0)}. ${top.score >= ref - 15 ? 'It keeps up with the meta teams.' : top.score >= ref - 40 ? 'Usable, but a step below the meta teams.' : 'The meta teams do clearly better without it.'}</div>`;
  return h + best.slice(0, 3).map(x => teamRow(m, x.ids, null, `${(x.score - ref).toFixed(0)} vs meta #1`)).join('');
}

/* ---------- CP meter: the in-game arc, drag the knob to a level for the power-up cost ---------- */
const MR = 86, MCX = 100, MCY = 104;
function meterGeom(lv, maxLv) { const f = Math.max(0, Math.min(1, (lv - 1) / (maxLv - 1))), th = Math.PI * (1 - f); return {x: MCX + MR * Math.cos(th), y: MCY - MR * Math.sin(th)}; }
function meterArc(lv, maxLv, from) { const a = meterGeom(from || 1, maxLv), p = meterGeom(lv, maxLv); return lv <= (from || 1) ? '' : `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${MR} ${MR} 0 0 1 ${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }
function meterInfo(r, best, lv) {
  const bb = best[4] || DATA.stats[r.species][0], cur = best[0], cp = calcCP(bb, best[1], best[2], best[3], cpmAt(lv));
  if (lv <= cur) return {cp: r.cp || cp, txt: `L${cur} · drag the knob for power-up costs`, over: false};
  const c = costTo(cur, lv);
  return {cp, txt: `L${cur} → L${lv} · ${fmt(c.dust)} dust · ${c.candy} candy${c.xl ? ` · ${c.xl} XL candy` : ''}${cp > LEAGUE.cp ? ` · over the ${LEAGUE.abbr} cap` : ''}`, over: cp > LEAGUE.cp};
}
function cpMeter(r, best) {
  const maxLv = maxL() / 2, cur = best[0], lv = UI.meter && UI.meter.key === r.key ? Math.max(cur, Math.min(maxLv, UI.meter.lv)) : cur;
  const bb = best[4] || DATA.stats[r.species][0], gl = pvpRank(bb, best[1], best[2], best[3], LEAGUE.cp);
  const capLv = Math.min(gl.lv, maxLv), p0 = meterGeom(cur, maxLv), pk = meterGeom(lv, maxLv), pc = meterGeom(capLv, maxLv), info = meterInfo(r, best, lv);
  const out = (p, d) => { const dx = p.x - MCX, dy = p.y - MCY, n = Math.hypot(dx, dy) || 1; return {x: MCX + dx / n * (MR + d), y: MCY + dy / n * (MR + d)}; };
  const a = out(pc, -6), b = out(pc, 6), l = out(pc, 14);
  return `<div class="meter" id="meter" data-key="${esc(r.key)}"><svg viewBox="0 0 200 120" onpointerdown="Planner.meterDown(event)">
    <path class="track" d="M ${MCX - MR} ${MCY} A ${MR} ${MR} 0 0 1 ${MCX + MR} ${MCY}"/>
    <path class="fill" id="mfill" d="${meterArc(Math.min(lv, capLv), maxLv)}"/><path class="fill over" id="mover" d="${meterArc(lv, maxLv, capLv)}"/>
    <line class="capt" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/><text class="capl" x="${l.x.toFixed(1)}" y="${(l.y + 3).toFixed(1)}" text-anchor="middle">${LEAGUE.cp}</text>
    <circle class="cur" cx="${p0.x.toFixed(1)}" cy="${p0.y.toFixed(1)}" r="3.5"/>
    <circle class="knob" id="mknob" cx="${pk.x.toFixed(1)}" cy="${pk.y.toFixed(1)}" r="7"/>
    <text class="lbl" x="100" y="72" text-anchor="middle">CP</text><text class="cp" id="mcp" x="100" y="102" text-anchor="middle">${info.cp}</text>
    <text class="lv" x="${MCX - MR}" y="117" text-anchor="middle">L1</text><text class="lv" x="${MCX + MR}" y="117" text-anchor="middle">L${maxLv}</text>
  </svg><div class="mi ${info.over ? 'over' : ''}" id="minfo">${esc(info.txt)}</div></div>`;
}
function meterLevel(ev, svg) {
  const rc = svg.getBoundingClientRect(), k = 200 / rc.width, x = (ev.clientX - rc.left) * k, y = (ev.clientY - rc.top) * k;
  let th = Math.atan2(MCY - y, x - MCX); if (th < 0) th = x < MCX ? Math.PI : 0;
  return 1 + Math.round((1 - th / Math.PI) * (maxL() / 2 - 1) * 2) / 2;
}
function meterDown(ev) {
  const svg = ev.currentTarget, el = svg.parentElement, key = el.dataset.key, r = results.find(x => x.key === key); if (!r || !r.combos.length) return;
  const best = bestOf2(r); ev.preventDefault(); try { svg.setPointerCapture(ev.pointerId); } catch {}
  const apply = e => { const lv = Math.max(best[0], meterLevel(e, svg)); UI.meter = {key, lv}; meterPaint(el, r, best, lv); };
  apply(ev);
  const move = e => apply(e), up = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
}
function meterPaint(el, r, best, lv) {
  const maxLv = maxL() / 2, p = meterGeom(lv, maxLv), info = meterInfo(r, best, lv), k = el.querySelector('#mknob'), mi = el.querySelector('#minfo');
  const bb = best[4] || DATA.stats[r.species][0], capLv = Math.min(pvpRank(bb, best[1], best[2], best[3], LEAGUE.cp).lv, maxLv);
  el.querySelector('#mfill').setAttribute('d', meterArc(Math.min(lv, capLv), maxLv)); el.querySelector('#mover').setAttribute('d', meterArc(lv, maxLv, capLv));
  k.setAttribute('cx', p.x.toFixed(1)); k.setAttribute('cy', p.y.toFixed(1));
  el.querySelector('#mcp').textContent = info.cp; mi.textContent = info.txt; mi.classList.toggle('over', info.over);
}

/* ---------- Pokémon GO search strings ---------- */
const FORM_FILTER = {shadow: 'shadow', galarian: 'galar', alolan: 'alola', hisuian: 'hisui', paldean: 'paldea'};
const baseName = id => nm(id).replace(/\s*\(.*\)\s*$/, '').trim();
const formFilters = id => id.split('_').slice(1).map(p => FORM_FILTER[p]).filter(Boolean);
function searchFor(id) {                       // "+ninetales&shadow&cp-1500": the whole evolution family, this form, GL-eligible copies
  return ['+' + baseName(id).toLowerCase()].concat(formFilters(id), 'cp-' + LEAGUE.cp).join('&');
}
function candidateSearch(id) {                 // "jigglypuff&cp-479": wild pre-evolutions that evolve into a GL-legal copy
  const pre = (APP.prevo || {})[id]; if (!pre || !DATA.stats[pre.split('_')[0].toUpperCase()]) return null;
  const sc = safeCap(pre, id); if (!sc) return null;
  return {q: [baseName(pre).toLowerCase()].concat(formFilters(pre), 'cp-' + sc.safe).join('&'), pre, cap: sc.safe};
}
function teamSearch(ids) { return ids.map(id => '+' + baseName(id).toLowerCase()).join(',') + '&cp-' + LEAGUE.cp; }
async function copyText(q, btn) {
  try { await navigator.clipboard.writeText(q); }
  catch { const ta = document.createElement('textarea'); ta.value = q; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); }
  if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t; }, 1500); }
  status('Copied: ' + q);
}
const searchRow = (label, q, sub) => `<div class="srch"><span class="lb">${esc(label)}</span><span class="tx"><code>${esc(q)}</code>${sub ? `<div class="dt">${sub}</div>` : ''}</span><button onclick="Planner.copyText(${attr(q)},this)">Copy</button></div>`;
function searchBlock(ids) {                    // for a team page: one string for the team, one per member, plus catch strings for missing members
  const rows = [searchRow('Team', teamSearch(ids), `every member's evolution family under ${LEAGUE.cp} CP`)];
  for (const id of ids) {
    rows.push(searchRow(nm(id), searchFor(id)));
    const c = candidateSearch(id); if (c) rows.push(searchRow('catch', c.q, `${esc(nm(c.pre))} that evolves into a GL-legal ${esc(nm(id))}`));
  }
  return `<div class="team srchs" style="cursor:default">${rows.join('')}</div>
    <div class="note">Paste into the search box of your Pokémon storage. <b>+name</b> lists the whole evolution family, so a pre-evolution you can still evolve shows up too; <b>&amp;shadow</b>, <b>&amp;galar</b> filter the form; <b>cp-${LEAGUE.cp}</b> keeps it to ${esc(LEAGUE.title)} copies. The team string cannot filter forms per member, so a normal Ninetales also matches a Shadow slot.</div>`;
}

/* ---------- Teams page and team detail ---------- */
function renderTeams() {
  const el = $('teams'); if (!el) return;
  try { renderTeamsInner(el); } catch (e) { el.innerHTML = errorCard('Teams', e); }
}
function secondTeam(m, ids) {                   // best trio sharing no species with the given one: owned first, then pending pieces
  const {L} = m, base = new Set(ids.map(PVP.baseSpecies));
  const poolOwned = Object.keys(m.ri.owned).filter(p => !base.has(PVP.baseSpecies(p)));
  const poolAll = poolOwned.concat(Object.keys(m.ri.pending).filter(p => !base.has(PVP.baseSpecies(p))));
  return L.bestTrios(poolOwned, 1)[0] || L.bestTrios(poolAll, 1)[0] || null;
}
function renderTeamsInner(el) {
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading PvPoke data…</div>'; return; }
  const m = M(), {rep} = m, best = rep.today[0];
  const parties = Object.entries(ROSTER.tagged).filter(([, v]) => v.length === 3 && v.every(x => APP.pokemon[x]));
  let h = '';
  if (best) {
    const ids = best.members.map(x => x.speciesId);
    h += `<div class="sec">Recommended <small>best of ${rep.todayAll.length >= 12 ? '12+' : rep.todayAll.length} buildable from your roster</small></div>` + teamRow(m, ids, null, 'run this one');
  } else h += `<div class="empty"><b>No team yet.</b><br>Scan at least three Pokémon at or under ${LEAGUE.cp} CP, or add them by name in Roster.</div>`;
  h += `<div class="sec">Your in-game parties <small>as you built them in the game</small></div>`;
  h += parties.length ? parties.map(([name, v]) => teamRow(m, v, name)).join('') : `<div class="note">None yet. Add the three Pokémon of a battle party below, or build one under Meta › Builder and save it.</div>`;
  h += `<div class="add"><input id="tagname" placeholder="name" style="min-width:70px;flex:.6"><input id="tag1" list="species" placeholder="1"><input id="tag2" list="species" placeholder="2"><input id="tag3" list="species" placeholder="3"><button onclick="Planner.addTag()">Add</button></div>`;
  if (best) {
    const ids = best.members.map(x => x.speciesId), second = secondTeam(m, ids);
    if (second) {
      const sids = second.members.map(x => x.speciesId), extra = sids.filter(id => !m.own[id]).map(nm);
      h += `<div class="sec">Second team, no overlap <small>for rotating</small></div>` + teamRow(m, sids, null, extra.length ? `once you have ${esc(extra.join(', '))}` : '');
    }
    const others = rep.todayAll.filter(t => t.members.map(x => x.speciesId).join() !== ids.join() && (!second || t.members.map(x => x.speciesId).join() !== second.members.map(x => x.speciesId).join()));
    if (others.length) {
      const shown = UI.teamsAll ? others : others.slice(0, 5);
      h += `<div class="sec">More from your roster <small>other buildable trios, best first</small></div>` + shown.map(t => teamRow(m, t.members.map(x => x.speciesId), null)).join('');
      if (others.length > 5) h += `<div class="note" style="cursor:pointer" onclick="Planner.toggleTeamsAll()">${UI.teamsAll ? '▾ show fewer' : `▸ show ${others.length - 5} more`}</div>`;
    }
  }
  h += `<div class="note">Score = mean best matchup rating against the meta, minus 12 per unanswered meta Pokémon and 6 per one that beats two members. Meta best is about ${Math.round((APP.benchmark || {best: 721}).best)}. Tap a team for its roles, weak spots, swaps and what its members still need.</div>`;
  el.innerHTML = h;
}
function toggleTeamsAll() { UI.teamsAll = !UI.teamsAll; renderTeams(); }
const PAGES = ['today', 'builder', 'teams', 'team', 'roster', 'meta', 'rank', 'raids', 'scans', 'mon', 'matchups', 'battles'];
const PAGE_LABEL = {today: 'Today', builder: 'Builder', teams: 'Teams', team: 'Team', roster: 'Roster', meta: 'Meta teams', rank: 'Rankings', raids: 'Raids', scans: 'Scans', matchups: 'Matchups', battles: 'Battle log'};
const onView = () => PAGES.find(k => $('view-' + k) && $('view-' + k).classList.contains('on'));
function openTeam(ids, name) {
  if (!APP || !ids || ids.length !== 3 || !ids.every(id => APP.pokemon[id])) return;
  const cur = onView(); if (cur && cur !== 'team') UI.teamFrom = cur === 'mon' ? (UI.monFrom || 'teams') : cur;
  UI.team = {ids: ids.slice(), name: name || null};
  nav(teamHash(ids, name));
}
const teamHash = (ids, name) => '#/team/' + ids.join('+') + (name ? '/' + encodeURIComponent(name) : '');
const teamLink = (ids, name) => location.origin + location.pathname + teamHash(ids, name);
function teamText(m, ids, name) {               // plain text for chats: members with moves, search string, link
  const L = m.L, ev = L.evaluate(ids);
  return [(name ? name + ' — ' : '') + `${esc(LEAGUE.title)} team, score ${ev.score.toFixed(0)}`,
          ...ids.map(id => { const mv = L.movesOf(id); return `• ${nm(id)} — ${mv.filter(Boolean).map(mvName).join(' · ')}`; }),
          `Search: ${teamSearch(ids)}`, teamLink(ids, name)].join('\n');
}
async function shareTeam(ids, name) {
  const url = teamLink(ids, name || null), title = (name || ids.map(nm).join(' / ')) + ' · PokeScan';
  if (navigator.share) { try { await navigator.share({title, url}); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  copyText(url); status('Link copied');
}
function closeTeam() { back('#/' + (UI.teamFrom || 'teams')); }
function renderTeam() {
  const el = $('team'); if (!el || !UI.team) return;
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading PvPoke data…</div>'; return; }
  if (!UI.team.ids.every(id => APP.pokemon[id])) { el.innerHTML = '<div class="note">Unknown team.</div>'; return; }
  try { el.innerHTML = teamInner(M(), UI.team.ids, UI.team.name); } catch (e) { el.innerHTML = errorCard('team', e); }
}
function savedName(ids, name) {                 // the party this trio is saved as, if any
  const key = ids.slice().sort().join();
  if (name && ROSTER.tagged[name] && ROSTER.tagged[name].slice().sort().join() === key) return name;
  return (Object.entries(ROSTER.tagged).find(([, v]) => v.slice().sort().join() === key) || [null])[0];
}
function teamInner(m, ids, name) {
  const {L, rep, own} = m, ev = L.evaluate(ids), d = L.describe(ids, ev), rl = roles(L, ids), th = threats(L, ids, ev), sw = bestSwaps(L, ids, m, ev);
  const saved = savedName(ids, name), best = rep.today[0];
  const isBest = best && best.members.map(x => x.speciesId).slice().sort().join() === ids.slice().sort().join();
  const metaRank = (APP.metaTeams || []).findIndex(t => t.members.slice().sort().join() === ids.slice().sort().join()) + 1;
  const back = PAGE_LABEL[UI.teamFrom] || 'Teams';
  const cov = attr(ids), bm = APP.benchmark || {best: 721, median: 521};
  const pctBar = Math.max(4, Math.min(100, (ev.score - 300) / (bm.best - 300) * 100)), medPos = (bm.median - 300) / (bm.best - 300) * 100;
  const menu = ctxMenu([
    ['Coverage grid', `Planner.coverage(${cov})`],
    ['Try in builder', `Planner.goBuilder(${cov})`],
    ['Copy Pokémon GO search', `Planner.copyText(${attr(teamSearch(ids))})`],
    ['Copy as text', `Planner.copyText(${attr(teamText(m, ids, saved))})`],
    ['Share link…', `Planner.shareTeam(${cov}, ${attr(saved || '')})`],
    saved ? ['Rename party…', `Planner.renameTeam(${attr(saved)})`] : ['Save as in-game party…', `Planner.saveTeam(${cov})`],
    saved ? ['Delete party', `Planner.deleteTeam(${attr(saved)})`, true] : null,
  ]);
  let h = `<div class="monhead"><button class="back" onclick="Planner.closeTeam()">‹ ${back}</button><div class="chips" style="margin:0">${saved ? chip('in-game party', 'gl') : ''}${isBest ? chip('recommended', 'ok') : ''}${metaRank ? chip('meta team #' + metaRank, 'meta1') : ''}</div>${menu}</div>`;
  h += `<div class="hero" style="cursor:default">
    <div class="sec" style="margin:0 0 10px">${esc(saved || name || ids.map(nm).join(' / '))} <small>${isBest ? 'best from your roster' : saved ? 'your in-game party' : metaRank ? `meta team #${metaRank}` : name ? 'shared team' : 'team'}</small></div>
    <div class="roles">${rl.map(r => { const mv = L.movesOf(r.id); return `<div class="role" onclick="Planner.openMon('${r.id}')" style="cursor:pointer"><span class="rl">${r.role}</span><span class="rn">${esc(nm(r.id))}</span><span class="rm">${esc(mvName(mv[0]))} · ${esc(mvName(mv[1]))}</span></div>`; }).join('')}</div>
    <div class="scorebar"><span class="big">${ev.score.toFixed(0)}</span><div class="track"><div class="fill" style="width:${pctBar}%"></div><div class="tick" style="left:${medPos}%"></div></div><span class="dim">meta best ${bm.best.toFixed(0)}</span></div>
    <div class="dim" style="font-size:12px;margin-top:8px">${d.unansweredMeta.length ? `No answer to ${chip(few(d.unansweredMeta), 'warn')}. ` : 'Covers every meta Pokémon. '}${d.sharedWeaknesses.length ? `${d.sharedWeaknesses.length} meta Pokémon beat two of three: ${esc(few(d.sharedWeaknesses))}.` : ''}</div>
    <div style="font-size:13px;margin-top:8px">${esc(needLine(m, ids))}</div>
  </div>`;
  // members
  h += `<div class="sec">Members <small>role · moves used for scoring · status</small></div><div class="team members" style="cursor:default">` + rl.map(r => {
    const mv = L.movesOf(r.id), st = ownership(m, r.id), o = own[r.id];
    const status = st === 'owned' ? (o && !o.manual ? (o.toLevel > 40 && o.toLevel > o.level ? `needs L${o.toLevel}, XL candy` : o.toLevel > o.level ? `${o.cp} CP · power up to L${o.toLevel}` : `${o.cp} CP · ready`) : 'owned, not scanned') : st === 'pending' ? 'pending: you are building it' : st === 'wanted' ? 'on your wanted list' : 'not in your roster';
    return `<div class="mb"><span class="rl">${r.role}</span><span class="mn"><b onclick="Planner.openMon('${r.id}')">${esc(nm(r.id))}</b> <span class="dim">#${APP.pokemon[r.id].rank}</span><div class="dt">${mv.map(mvName).map(esc).join(' · ')} · ${esc(status)}</div></span>${ownChip(st) || chip('missing', 'warn')}</div>`;
  }).join('') + '</div>';
  // to-dos for these members
  const todo = openMoves(m).filter(x => (x.species && ids.includes(x.species)) || (x.id.startsWith('get:') && ids.includes(x.id.slice(4))) || (x.id.startsWith('park:') && ids.includes(x.id.slice(5))));
  { const rr = teamRecord(ids); if (rr) h += `<div class="team card" style="cursor:default"><div class="sec" style="margin:0 0 4px">Your record <small>GO Battle League, logged by you</small></div><div><b style="font-family:Sora,sans-serif;font-size:18px;color:var(--green)">${rec(rr)}</b>${rr.worst.length ? ` <span class="dim">· trouble leads: ${rr.worst.map(x => `${esc(nm(x.id))} ${rec(x)}`).join(', ')}</span>` : ''} <a href="#" class="dim" style="font-size:12px" onclick="Planner.nav('#/battles');return false">log</a></div></div>`; }
  h += reviewCard(ids, !!saved);
  h += `<div class="sec">To do for this team</div>`;
  h += todo.length ? todo.map(moveCard).join('') : `<div class="note">Nothing open: the members you own are at the cap and carry the right moves.</div>`;
  // weak spots
  const tl = L.mx ? L.threatList(ids, 10) : null;
  h += `<div class="sec">Weak spots <small>meta Pokémon that beat two or all three${tl ? ` · <b>${tl.count} of ${tl.pool}</b> simulated opponents beat all three` : ''}</small></div>`;
  if (tl && tl.count) h += `<div class="team" style="cursor:default"><div class="chips">${tl.threats.map(t => `<span class="chip warn" onclick="Planner.openMon('${t.id}')" style="cursor:pointer">${esc(nm(t.id))} <span style="opacity:.7">${t.ratings.map(r => Math.round(r)).join('/')}</span></span>`).join('')}</div><div class="dt" style="margin-top:6px">PvPoke-simulated (1-1 shields): every member rates under 500 against these. <a href="#" onclick="Planner.nav('#/matchups');return false">Open Matchups</a> to see them per shield scenario.</div></div>`;
  if (!th.length) h += `<div class="note">None: every meta Pokémon loses to at least two of your three.</div>`;
  else h += `<div class="team" style="cursor:default">` + th.slice(0, 8).map(r => `<div class="thr"><b style="cursor:pointer" onclick="Planner.openMon('${r.id}')">${esc(nm(r.id))}</b> <span>#${r.rank}</span> · ${r.hole ? 'beats all three, nobody answers it' : `beats ${esc(r.beats.map(nm).join(' and '))}`}${r.answer ? ` · <span class="good">swap to ${esc(nm(r.answer))}</span>` : ''}</div>`).join('') + (th.length > 8 ? `<div class="thr">… ${th.length - 8} more in the coverage grid</div>` : '') + '</div>';
  // search strings
  h += `<div class="sec">Search in Pokémon GO <small>find them in your storage</small></div>` + searchBlock(ids);
  // swaps
  const swaps = sw.filter(x => x.delta > 0).slice(0, 4);
  if (swaps.length) h += `<div class="sec">If you swap one member <small>from what you own or are building</small></div><div class="swaps">` + swaps.map(x => `<div class="swap" style="cursor:pointer" onclick="Planner.openTeam(${attr(ids.map(id => id === x.out ? x.in : id))},null)"><span class="dim">${esc(nm(x.out))} → ${esc(nm(x.in))}${x.pending ? ' (pending)' : ''}</span><span class="up">+${x.delta}${x.fixed.length ? ' · fixes ' + esc(x.fixed.slice(0, 2).join(', ')) : ''}${x.opened.length ? ' · opens ' + esc(x.opened.slice(0, 2).join(', ')) : ''}</span></div>`).join('') + '</div>';
  else if (sw.length) h += `<div class="note">No single swap from your roster scores higher than this team.</div>`;
  return h;
}
function saveTeam(ids) { const name = prompt('Name for this party', ids.map(nm).join(' / ')); if (!name) return; ROSTER.tagged[name] = ids.slice(); saveRoster(); if (UI.team) UI.team.name = name; refresh(); status(`Saved "${name}" under your in-game parties`); }
function renameTeam(old) { const name = prompt('New name', old); if (!name || name === old || !ROSTER.tagged[old]) return; ROSTER.tagged[name] = ROSTER.tagged[old]; delete ROSTER.tagged[old]; if (UI.team) UI.team.name = name; saveRoster(); refresh(); }
function deleteTeam(name) { if (!ROSTER.tagged[name] || !confirm(`Delete the party "${name}"? Your Pokémon stay in the roster.`)) return; delete ROSTER.tagged[name]; saveRoster(); refresh(); closeTeam(); }

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
  const byId = list => { const g = new Map(); for (const e of list) { if (!g.has(e.id)) g.set(e.id, []); g.get(e.id).push(e); } return [...g.entries()]; };
  const now = byId(all.filter(e => e.now)).sort((a, b) => APP.pokemon[a[0]].rank - APP.pokemon[b[0]].rank);
  const later = byId(all.filter(e => !e.now)).sort((a, b) => Math.min(...a[1].map(e => e.sort)) - Math.min(...b[1].map(e => e.sort)));
  if (now.length) h += `<div class="team" style="cursor:default"><div class="nm">Available now</div>${now.map(([id, es]) => availBlock(id, es, {status: ownership(m, id)})).join('')}</div>`;
  h += `<div class="team" style="cursor:default"><div class="nm">Coming up <span class="dim" style="font-weight:400;font-size:12px">announced raids and events</span></div>${later.length ? later.slice(0, 6).map(([id, es]) => availBlock(id, es, {status: ownership(m, id)})).join('') : '<div class="thr">Nothing announced yet for your wanted list. Raid rotations are usually published one to three weeks ahead.</div>'}</div>`;
  const none = ids.filter(id => !all.some(e => e.id === id));
  if (none.length) h += `<div class="note">Nothing scheduled for ${none.map(id => `<a href="#" onclick="Planner.openMon('${id}');return false">${esc(nm(id))}</a>`).join(', ')}: wild spawns, trades or GBL rewards.</div>`;
  h += `<div class="note">Leek Duck schedule via ScrapedDuck, updated ${when(src.updated())}. Only events with a published boss or spawn list can be matched. Remote OK = regular raid you can join with a Remote Raid Pass; Shadow raids are in person only.</div>`;
  return h;
}
if (window.Sources) Sources.onChange(() => { renderToday(); if (UI.mon) renderMon(); });

/* ---------- AI coach (server-side Claude API, only when the server has a key and sync is connected) ---------- */
const COACH = Object.assign({q: '', text: '', hash: '', t: 0, busy: false, error: '', secs: 0, showCtx: false}, JSON.parse(localStorage.getItem('coach') || '{}'));
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
    battles: battleSummaryText(null) || undefined,
    scoring: 'Team score = mean best matchup rating vs the meta (PvPoke published matchups, type effectiveness otherwise) minus 12 per unanswered meta Pokémon and 6 per meta Pokémon that beats two members. Meta best is about ' + Math.round((APP.benchmark || {best: 721}).best) + '.',
  };
}
function coachHash(o) { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); }
function coachCard(m) {
  if (!window.Sync || !Sync.available() || !Sync.signedIn()) return '';
  if (!Sync.coachAvailable()) return `<div class="sec">Coach <small>off on your server</small></div><div class="team coach"><div class="dt">The server reports no coach (<code>coach:false</code> in /api/health). Set <code>ANTHROPIC_API_KEY</code> on the Railway service and deploy the staged variable change; then tap re-check.</div><div class="acts small"><button onclick="Sync.detect().then(()=>Planner.renderToday())">Re-check</button></div></div>`;
  const fresh = COACH.text && COACH.hash === coachHash(coachContext(m));
  return `<div class="sec">Coach <small>Claude reads your roster and the meta</small></div>
    <div class="team coach"><div class="nm">Ask the coach</div><div class="dt">Team ideas from what you own, what to build next and what to fear. Uses the numbers above, nothing from your phone leaves except this roster summary.</div>
    <div class="add" style="margin-top:8px"><input id="coachq" placeholder="optional question, e.g. which lead for Azumarill teams?" value="${esc(COACH.q)}" style="flex:1;min-width:160px"><button onclick="Planner.askCoach()" ${COACH.busy ? 'disabled' : ''}>${COACH.busy ? `Thinking… ${COACH.secs ? COACH.secs + 's' : ''}` : fresh ? 'Ask again' : 'Ask the coach'}</button></div>
    ${COACH.busy ? '<div class="note">Claude is reading your roster; this takes 20 to 90 seconds. You can switch tabs, the answer is kept.</div>' : ''}
    ${COACH.error ? `<div class="note" style="color:#F59A8B">⚠ ${esc(COACH.error)}</div>` : ''}
    <div class="note" style="cursor:pointer" onclick="Planner.toggleCoachCtx()">${COACH.showCtx ? '▾ hide' : '▸ show'} what is sent to Claude</div>
    ${COACH.showCtx ? `<div class="note">The server adds a fixed instruction: Great League coach for a casual player, answer under 350 words with 2–3 teams from what you own (lead / swap / closer), what to build next, what to watch out for, only Pokémon from this summary. Then your question and this summary:</div><pre class="ctx">${esc(JSON.stringify(coachContext(m), null, 1))}</pre>` : ''}
    ${COACH.text ? `<div class="ans">${linkNames(mdLite(COACH.text))}</div><div class="note" style="margin-top:6px">${when(COACH.t)}${fresh ? '' : ' · your roster changed since this answer'}</div>` : ''}</div>`;
}
let NAMERX = null;
function linkNames(html) {                     // wrap Pokémon names in coach answers: tap adds to the builder (when it has an open slot) or opens the page
  if (!APP) return html;
  if (!NAMERX) { const byName = {}; for (const [id, e] of Object.entries(APP.pokemon)) if (!byName[e.name] || APP.pokemon[byName[e.name]].rank > e.rank) byName[e.name] = id;
    NAMERX = {map: byName, rx: new RegExp('(^|[^\\w])(' + Object.keys(byName).sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\w])', 'g')}; }
  return html.split(/(<[^>]+>)/).map((seg, i) => i % 2 ? seg : seg.replace(NAMERX.rx, (m0, pre, name) => `${pre}<a href="#" class="pn" onclick="Planner.pickName('${NAMERX.map[name]}');return false">${name}</a>`)).join('');
}
function pickName(id) {
  if (!APP.pokemon[id]) return;
  if (onView() === 'builder' && !UI.build.slots.includes(id) && UI.build.slots.includes(null)) { fillSlot(id); status(`${nm(id)} added to the builder`); window.scrollTo(0, 0); return; }
  openMon(id);
}
function mdLite(t) {                          // minimal markdown: paragraphs, bullets, bold
  const blocks = esc(t).replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) return '<ul>' + lines.map(l => `<li>${l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}</li>`).join('') + '</ul>';
    return `<p>${lines.join('<br>')}</p>`;
  }).join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^<p>(#+\s*)(.+?)<\/p>/gm, '<p><b>$2</b></p>');
}
function toggleCoachCtx() { COACH.showCtx = !COACH.showCtx; renderToday(); }

/* builder coach: the same server call with the slots, their weak spots and the app's candidates attached */
const BCOACH = Object.assign({thread: [], reviews: {}, busy: false, error: '', secs: 0}, JSON.parse(localStorage.getItem('bcoach') || '{}'));
BCOACH.reviews = BCOACH.reviews || {}; BCOACH.reviewBusy = {}; BCOACH.reviewFailed = {};
if (!Array.isArray(BCOACH.thread)) BCOACH.thread = [];
const saveBCoach = () => { const keep = Object.entries(BCOACH.reviews).sort((a, b) => b[1].t - a[1].t).slice(0, 30); localStorage.setItem('bcoach', JSON.stringify({thread: BCOACH.thread.slice(-8), reviews: Object.fromEntries(keep)})); };

/* ---------- always-on AI review: every complete team gets one structured review, cached per trio and league ---------- */
const reviewKey = ids => ids.slice().sort().join('+') + '|' + LEAGUE.slug;
const reviewFor = ids => BCOACH.reviews[reviewKey(ids)] || null;
const coachOn = () => !!(window.Sync && Sync.available() && Sync.signedIn() && Sync.coachAvailable());
function parseReview(text) {                   // the review prompt asks for **Verdict** / **Strengths** / **Weak spots** / **Swaps**
  const out = {}, re = /\*\*(Verdict|Strengths|Weak spots|Swaps)\*\*:?\s*/gi, parts = text.split(re);
  if (parts.length < 3) return {Verdict: text.trim()};
  for (let i = 1; i < parts.length; i += 2) out[parts[i][0].toUpperCase() + parts[i].slice(1).toLowerCase()] = (parts[i + 1] || '').trim();
  return out;
}
const verdictOf = rv => { const v = (parseReview(rv.text).Verdict || rv.text).replace(/\*\*/g, '').split(/\n/)[0]; return v.length > 140 ? v.slice(0, 137) + '…' : v; };
async function autoReview(ids) {
  if (!coachOn() || !APP || ids.length !== 3 || !ids.every(id => APP.pokemon[id])) return;
  const key = reviewKey(ids);
  if (BCOACH.reviews[key] || BCOACH.reviewBusy[key] || BCOACH.reviewFailed[key]) return;
  BCOACH.reviewBusy[key] = true;
  const paint = () => { const v = onView(); if (v === 'builder') renderMeta('build'); if (v === 'team') renderTeam(); if (v === 'teams') renderTeams(); };
  try {
    const m = M(), L = builderLeague(m), ctx = builderContext(m, L, ids);
    const text = await Sync.coach(ctx, '', null, 'review');
    BCOACH.reviews[key] = {t: Date.now(), text, slots: ids.slice()}; saveBCoach();
  } catch (e) { BCOACH.reviewFailed[key] = (e && e.message) || 'no answer'; }
  delete BCOACH.reviewBusy[key]; paint();
}
function refreshReview(ids) { const key = reviewKey(ids); delete BCOACH.reviews[key]; delete BCOACH.reviewFailed[key]; saveBCoach(); autoReview(ids); const v = onView(); if (v === 'builder') renderMeta('build'); if (v === 'team') renderTeam(); }
function reviewCard(ids, auto) {                // the card; auto = ask Claude by itself when there is no review yet (builder and saved parties), else offer a button
  if (!coachOn() || ids.length !== 3) return '';
  const key = reviewKey(ids), rv = BCOACH.reviews[key], busy = BCOACH.reviewBusy[key], failed = BCOACH.reviewFailed[key];
  if (!rv && auto && !busy && !failed) setTimeout(() => autoReview(ids), 0);
  const head = extra => `<div class="sec" style="display:flex;justify-content:space-between;align-items:center;margin:0 0 6px"><span>AI review <small>${extra}</small></span>${rv ? ctxMenu([['Refresh review', `Planner.refreshReview(${attr(ids)})`]]) : ''}</div>`;
  if (busy || (!rv && auto && !failed)) return `<div class="team card" style="cursor:default">${head('thinking, 20 to 90 seconds')}<div class="dt">Claude is judging this team: roles, weak spots and swaps from your roster.</div></div>`;
  if (!rv && failed) return `<div class="team card" style="cursor:default">${head('not available')}<div class="dt">⚠ ${esc(failed)} · <a href="#" onclick="Planner.refreshReview(${attr(ids)});return false">try again</a></div></div>`;
  if (!rv) return `<div class="team card" style="cursor:default">${head('')}<div class="dt"><a href="#" onclick="Planner.refreshReview(${attr(ids)});return false">Get an AI review</a> of this team: roles, weak spots and swaps from your roster.</div></div>`;
  const sec = parseReview(rv.text), order = ['Verdict', 'Strengths', 'Weak spots', 'Swaps'];
  const body = order.filter(k => sec[k]).map(k => k === 'Verdict' ? `<div class="verdict">${linkNames(mdLite(sec[k]))}</div>` : `<div class="rsec"><b>${k}</b>${linkNames(mdLite(sec[k]))}</div>`).join('');
  return `<div class="team card review" style="cursor:default">${head(when(rv.t))}${body}</div>`;
}
function clearBuilderCoach() { BCOACH.thread = []; BCOACH.error = ''; saveBCoach(); renderMeta(); }
function builderContext(m, L, filled) {
  const ctx = coachContext(m), ev = L.evaluate(filled);
  const distinct = p => !filled.includes(p) && new Set(filled.concat(p).map(PVP.baseSpecies)).size === filled.length + 1;
  const cand = pool => pool.map(p => { const e2 = L.evaluate(filled.concat(p)); return {p, score: e2.score, fixes: ev.holes.filter(o => !e2.holes.includes(o))}; }).sort((a, b) => b.score - a.score).slice(0, 6)
    .map(x => `${nm(x.p)} (#${APP.pokemon[x.p].rank}${ownership(m, x.p) ? ', ' + ownership(m, x.p) : ''}) → team ${x.score.toFixed(0)}, answers ${x.fixes.slice(0, 4).map(nm).join(', ') || 'nothing new'}`);
  const mine = Object.keys(m.ri.owned).concat(Object.keys(m.ri.pending)).filter(distinct);
  ctx.builder = {
    slots: filled.map(id => `${nm(id)} (#${APP.pokemon[id].rank}, ${L.movesOf(id).map(mvName).join('/')}${ownership(m, id) ? ', ' + ownership(m, id) : ', not owned'})`),
    openSlots: 3 - filled.length,
    scoreSoFar: ev.score, weakSpots: ev.holes.slice(0, 15).map(o => `${nm(o)} #${APP.pokemon[o].rank}`),
    twoOfThreeLoseTo: filled.length === 3 ? ev.shared.slice(0, 10).map(nm) : undefined,
    candidatesFromRoster: filled.length < 3 ? cand(mine) : undefined,
    candidatesFromMeta: filled.length < 3 ? cand(APP.meta.slice(0, 60).filter(distinct)) : undefined,
  };
  const hist = battleSummaryText(filled.length === 3 ? filled : null); if (hist) ctx.builder.history = hist;
  delete ctx.nextMoves;
  return ctx;
}
function builderCoachCard(m, L, filled) {
  if (!window.Sync || !Sync.available() || !Sync.signedIn() || !Sync.coachAvailable()) return '';
  const key = filled.slice().sort().join('+');
  const bubbles = BCOACH.thread.map(x => `<div class="msg me"><div class="b">${esc(x.q || (x.slots && x.slots.length === 3 ? 'Judge this team' : 'Complete this team'))}</div><div class="dt">${esc((x.slots || []).map(nm).join(' / '))}${x.key !== key ? ' · earlier slots' : ''}</div></div>
    <div class="msg ai"><div class="b ans">${linkNames(mdLite(x.a))}</div><div class="dt">${when(x.t)}</div></div>`).join('');
  return `<div class="sec" id="bcoach" style="display:flex;justify-content:space-between;align-items:center"><span>AI suggestion <small>${filled.length === 3 ? 'judging this team' : 'completing the team'}</small></span>${BCOACH.thread.length ? `<a href="#" class="dim" style="font-size:12px" onclick="Planner.clearBuilderCoach();return false">clear</a>` : ''}</div>
    <div class="team coach chat">${bubbles || '<div class="dt">The ✦ button sends Claude the slots, their weak spots, the candidates above and your roster summary. Tap a Pokémon name in the answer to add it to the builder.</div>'}
    ${BCOACH.busy ? '<div class="msg ai"><div class="b dim">Thinking… 20 to 90 seconds. You can switch tabs, the answer is kept.</div></div>' : ''}
    ${BCOACH.error ? `<div class="note" style="color:#F59A8B">⚠ ${esc(BCOACH.error)}</div>` : ''}
    <div class="add" style="margin-top:8px"><input id="bcoachq" placeholder="${BCOACH.thread.length ? 'follow-up question…' : 'a question, e.g. a lead that beats Azumarill?'}" style="flex:1;min-width:160px" onkeydown="if(event.key==='Enter')Planner.askBuilderCoach()"><button onclick="Planner.askBuilderCoach()" ${BCOACH.busy ? 'disabled' : ''}>Send</button></div></div>`;
}
async function askBuilderCoach() {
  const m = M(), L = builderLeague(m), filled = UI.build.slots.filter(Boolean); if (!filled.length) return;
  const ctx = builderContext(m, L, filled), q = ($('bcoachq') || {value: ''}).value.trim();
  const last = BCOACH.thread[BCOACH.thread.length - 1];
  const question = q && last ? `Earlier you advised (for the slots ${(last.slots || []).map(nm).join(' / ')}):\n${last.a.slice(0, 1500)}\n\nFollow-up question: ${q}` : q;
  BCOACH.busy = true; BCOACH.error = ''; BCOACH.secs = 0; renderMeta();
  try {
    const text = await Sync.coach(ctx, question, secs => { BCOACH.secs = secs; const b = document.querySelector('#meta .btn.ai'); if (b) b.textContent = `✦ Thinking… ${secs}s`; }, 'builder');
    BCOACH.thread.push({q, a: text, t: Date.now(), slots: filled.slice(), key: filled.slice().sort().join('+')}); BCOACH.thread = BCOACH.thread.slice(-8); saveBCoach();
  } catch (e) { BCOACH.error = e.message || String(e); }
  BCOACH.busy = false; renderMeta();
  const el = $('bcoach'); if (el && $('view-meta').classList.contains('on')) el.scrollIntoView({behavior: 'smooth', block: 'start'});
}
async function askCoach() {
  const m = M(), ctx = coachContext(m), q = ($('coachq') || {value: ''}).value.trim();
  COACH.q = q; COACH.busy = true; COACH.error = ''; COACH.secs = 0; renderToday();
  try {
    const text = await Sync.coach(ctx, q, secs => { COACH.secs = secs; const b = document.querySelector('#today .coach button'); if (b) b.textContent = `Thinking… ${secs}s`; });
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
    rows.map(o => `<div class="cr ${ev.shared.includes(o) || ev.holes.includes(o) ? 'tint' : ''}"><span>${esc(nm(o))} <span class="dim">#${APP.pokemon[o].rank}</span></span>${team.map(t => `<i class="${cls(L.rating(t, o))} ${L.source(t, o) === 'est' ? 'est' : ''}" title="${Math.round(L.rating(t, o))}"></i>`).join('')}</div>`).join('') +
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
    else { const rd = readiness(m, o.id); if (rd.ready) { st = 'ready'; txt = 'ready'; } else { st = 'moves'; const k = rd.items[0].k; txt = k === 'scan' ? 'scan the attacks' : k === 'move2' ? 'unlock 2nd move' : k === 'check' ? 'check 2nd move' : 'needs a TM'; } }
    out.push({id: o.id, st, txt, bar, sub: `#${APP.pokemon[o.id].rank}${o.cp ? ' · ' + o.cp + ' CP' : ''}`, iv: o.ivs ? o.ivs.join('/') : null, teams: inTeams(o.id)});
  }
  for (const [id, a] of Object.entries(auto)) out.push({id, st: 'pending', txt: `evolve ${a.from}`, sub: `#${APP.pokemon[id].rank} · fits to L${a.toLevel}`});
  for (const id of Object.keys(ROSTER.pending)) if (!own[id] && !auto[id] && APP.pokemon[id]) out.push({id, st: 'pending', txt: 'pending', sub: `#${APP.pokemon[id].rank}`});
  for (const id of Object.keys(ri.candidates)) { const pre = (APP.prevo || {})[id], sc = pre && DATA.stats[pre.split('_')[0].toUpperCase()] ? safeCap(pre, id) : null;
    out.push({id, st: 'wanted', txt: sc ? `${nm(pre)} ≤ ${sc.safe} CP` : 'wanted', sub: `#${APP.pokemon[id].rank}`}); }
  for (const id of ROSTER.exclude) if (APP.pokemon[id]) out.push({id, st: 'bench', txt: 'benched', sub: `#${APP.pokemon[id].rank}`});
  const order = {ready: 0, power: 1, moves: 2, manual: 3, pending: 4, wanted: 5, xl: 6, bench: 7};
  out.sort((a, b) => order[a.st] - order[b.st] || APP.pokemon[a.id].rank - APP.pokemon[b.id].rank);
  return out;
}
function movesRow(id, moves, handler) {
  const e = APP.pokemon[id]; handler = handler || `Planner.setMove('${id}',SLOT,this.value)`;
  const withCur = (list, slot) => moves[slot] && !list.includes(moves[slot]) ? [moves[slot], ...list] : list;
  const sel = (slot, list0) => { const list = withCur(list0, slot); return `<select onchange="${handler.replace('SLOT', slot)}">${list.map(mv => `<option value="${mv}" ${moves[slot] === mv ? 'selected' : ''}>${esc(mvName(mv))}</option>`).join('')}</select>`; };
  const third = `<select onchange="${handler.replace('SLOT', 2)}"><option value="" ${!moves[2] ? 'selected' : ''}>no 2nd move</option>${withCur(e.charged, 2).map(mv => `<option value="${mv}" ${moves[2] === mv ? 'selected' : ''}>${esc(mvName(mv))}</option>`).join('')}</select>`;
  return `<div class="mv">${sel(0, e.fast)}${sel(1, e.charged)}${third}</div>`;
}
function knownMoves(r, id) {                // moves we actually know: read from a screenshot or set by hand; null when neither
  if (r && r.moves && r.moves.length) return r.moves;
  if (ROSTER.moves[id] && ROSTER.moves[id].length) return ROSTER.moves[id];
  return null;
}
function moveRows(id, moves, handler, placeholder) {  // Fast / Charged / 2nd charged as three full-width rows; moves null = nothing known yet
  const e = APP.pokemon[id]; handler = handler || `Planner.setMove('${id}',SLOT,this.value)`;
  const unknown = !moves; moves = moves || []; placeholder = placeholder || 'not scanned';
  const use = e.use || {}, tag = mv => use[mv] ? ` (${use[mv]}%)` : '';
  const withCur = (list, slot) => moves[slot] && !list.includes(moves[slot]) ? [moves[slot], ...list] : list;
  const sel = (slot, list0, none) => `<select class="mvsel ${unknown ? 'empty' : ''}" onchange="${handler.replace('SLOT', slot)}">${unknown ? `<option value="" selected disabled>— ${placeholder} —</option>` : ''}${none && !unknown ? `<option value="" ${!moves[slot] ? 'selected' : ''}>no 2nd charged move</option>` : none ? `<option value="">no 2nd charged move</option>` : ''}${withCur(list0, slot).map(mv => `<option value="${mv}" ${moves[slot] === mv ? 'selected' : ''}>${esc(mvName(mv))}${tag(mv)}</option>`).join('')}</select>`;
  return [['Fast', sel(0, e.fast)], ['Charged', sel(1, e.charged)], ['2nd charged', sel(2, e.charged, true)]];
}
function moveUsage(id, cur) {               // collapsible ranked table: how often PvPoke's simulations run each move
  const e = APP.pokemon[id], use = e.use || {}, mine = new Set((cur || []).filter(Boolean)), set = new Set(e.moveset);
  if (!Object.keys(use).length) return '';
  const rows = (list, label) => {
    const ranked = list.filter(m => use[m] !== undefined).sort((a, b) => (use[b] || 0) - (use[a] || 0));
    if (!ranked.length) return '';
    return `<div class="uh">${label}</div>` + ranked.map((m, i) => `<div class="ur ${mine.has(m) ? 'mine' : ''}"><span class="n">${i + 1}</span><span class="nm">${mine.has(m) ? '<em class="y">✓</em> ' : ''}${esc(mvName(m))}${set.has(m) ? ' <em class="s">★</em>' : ''}</span><span class="bar"><i style="width:${Math.max(3, use[m])}%"></i></span><span class="pc">${use[m]}%</span></div>`).join('');
  };
  return `<div class="note" style="margin:6px 0 0;cursor:pointer" onclick="Planner.toggleUse()">${UI.moveUse ? '▾' : '▸'} Best moves by PvPoke usage</div>` +
    (UI.moveUse ? `<div class="use">${rows(e.fast, 'Fast')}${rows(e.charged, 'Charged')}<div class="dim" style="font-size:11.5px;margin-top:8px"><em class="y">✓</em> on this copy · <em class="s">★</em> in the moveset behind rank #${e.rank} · % = share of PvPoke's simulated battles using the move</div></div>` : '');
}
function toggleUse() { UI.moveUse = !UI.moveUse; renderMon(); }

/* ---------- readiness: a copy is ready for GL when it sits at the cap level and carries PvPoke's moves ---------- */
function readiness(m, id) {
  const o = m.own[id]; if (!o) return null;
  const e = APP.pokemon[id], items = [];
  if (o.manual) return {ready: false, items: [{k: 'scan', t: 'Scan it', s: 'no screenshot yet: IVs, level and moves are unknown'}]};
  if (o.toLevel > o.level) { const c = costTo(o.level, o.toLevel);
    items.push(o.toLevel > 40 ? {k: 'xl', t: `Needs L${o.toLevel} for the cap`, s: `${fmt(c.dust)} dust · ${c.xl} XL candy · usually not worth it`}
                              : {k: 'pu', t: `Power up to L${o.toLevel}`, s: `${o.cp} → ${o.toCP} CP · ${fmt(c.dust)} dust · ${c.candy} candy`}); }
  const known = knownMoves(o.scan, id), rec = e.moveset;
  if (!known) items.push({k: 'scan', t: 'Scan the attacks', s: 'moves not known yet: screenshot the status screen scrolled down to the attacks'});
  else {
    const cur = known.filter(Boolean), missing = rec.slice(1).filter(x => !cur.slice(1).includes(x));
    if (cur[0] && cur[0] !== rec[0]) items.push({k: 'tm', t: `Fast TM: ${mvName(cur[0])} → ${mvName(rec[0])}`, s: 'PvPoke\'s fast move · Elite TM if it is a legacy move'});
    if (o.scan.secondMove === false) { const c = e.thirdMove || [75000, 75]; items.push({k: 'move2', t: 'Unlock the 2nd charged move', s: `${fmt(c[0])} dust · ${c[1]} candy${e.buddy ? ` · or walk ${e.buddy} km as buddy` : ''} → then set ${mvName(missing[0] || rec[2])}`}); }
    else if (cur.length < 3 && o.scan.secondMove !== true) items.push({k: 'check', t: 'Check the 2nd charged move', s: 'the NEW ATTACK button was not in the shot: screenshot the attacks with it visible, or pick the move by hand'});
    else if (missing.length) { const drop = cur.slice(1).find(x => !rec.includes(x)); items.push({k: 'tm', t: `Charged TM: ${drop ? mvName(drop) + ' → ' : ''}${mvName(missing[0])}`, s: `PvPoke runs ${rec.slice(1).map(mvName).join(' + ')} · Elite TM if it is a legacy move`}); }
  }
  return {ready: !items.length, items};
}
function todoList(m, id) {
  const rd = readiness(m, id); if (!rd) return '';
  if (rd.ready) return `<div class="todo ok"><span class="okc">✓</span> Ready for ${esc(LEAGUE.title)}: at the cap with PvPoke's moves.</div>`;
  return `<ul class="todo">${rd.items.map(x => `<li class="${x.k}"><b>${esc(x.t)}</b><span>${esc(x.s)}</span></li>`).join('')}</ul>`;
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
function bundleAvail(list, species) {          // fold a species' entries into at most one line per channel
  const out = [], uniq = a => [...new Set(a.filter(Boolean))];
  const forms = uniq(list.map(e => e.name)).filter(n => n !== species);
  const grp = k => list.filter(e => e.kind === k);
  const flags = es => `${es.some(e => e.remote) ? ' · <span class="good">remote OK</span>' : es.some(e => e.kind === 'raid') ? ' · in person' : ''}${es.some(e => e.shiny) ? ' ✨' : ''}`;
  const asForm = es => { const f = uniq(es.map(e => e.name)).filter(n => n !== species); return f.length && f.length === uniq(es.map(e => e.name)).length ? `<span class="dim">as ${esc(f.join('/'))}:</span> ` : ''; };
  const raids = grp('raid');
  if (raids.length) {
    const parts = uniq(raids.map(e => `${e.what}${e.when && e.when !== 'in raids now' ? ` <span>${esc(e.when)}</span>` : ''}`));
    out.push({label: 'Raids', now: raids.some(e => e.now), html: asForm(raids) + parts.join(' · ') + flags(raids) + (raids.some(e => /mega/i.test(e.what)) ? ' <span class="dim">· Mega raid gives the normal form</span>' : '')});
  }
  const eggs = grp('egg');
  if (eggs.length) {
    const kms = uniq(eggs.map(e => (String(e.what + ' ' + e.note).match(/(\d+)\s*km/i) || [])[1])).map(Number).sort((a, b) => a - b);
    const sync = eggs.some(e => /adventure sync/i.test(e.what + ' ' + e.note)), gift = eggs.some(e => /gift/i.test(e.what + ' ' + e.note));
    out.push({label: 'Eggs', now: eggs.some(e => e.now), html: asForm(eggs) + (kms.length ? kms.map(k => k + ' km').join(', ') + ' eggs' : uniq(eggs.map(e => e.what)).join(' · ')) + (sync ? ' <span class="dim">(Adventure Sync)</span>' : '') + (gift ? ' <span class="dim">(gifts)</span>' : '') + flags(eggs)});
  }
  const wild = grp('event');
  if (wild.length) out.push({label: 'Wild', now: wild.some(e => e.now), html: asForm(wild) + uniq(wild.map(e => `${esc(e.what.replace(/^wild spawns\s*\((.*)\)$/i, '$1 spawns'))}${e.when ? ` <span>${esc(e.when)}</span>` : ''}`)).join(' · ') + flags(wild)});
  const res = grp('research');
  if (res.length) out.push({label: 'Research', now: true, html: asForm(res) + uniq(res.map(e => `“${esc(e.when)}”`)).join(', ') + flags(res)});
  const rk = grp('rocket');
  if (rk.length) out.push({label: 'Rocket', now: true, html: asForm(rk) + uniq(rk.map(e => esc(e.what))).join(' · ') + ' <span class="dim">· in person, Shadow</span>'});
  return out;
}
/* ---------- How to get a Pokémon: catch it, evolve a pre-evolution (candy, safe catch CP, its sources), or Team GO Rocket for shadows ---------- */
let EVO = JSON.parse(localStorage.getItem('evo') || 'null');
async function loadEvo() {
  try { const r = await fetch('data/evo.json?v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''), {cache: 'no-cache'}); if (r.ok) { EVO = await r.json(); localStorage.setItem('evo', JSON.stringify(EVO)); if (UI.mon && onView() === 'mon') renderMon(); } } catch {}
}
const evoBase = id => id.replace(/_shadow$/, '');
function evoCandy(preId, toId) {              // candy to evolve pre → to, from the game master (shadow ids share the base species' entry)
  const lst = EVO && EVO.evolve && EVO.evolve[evoBase(preId)]; if (!lst) return null;
  const hit = lst.find(x => x.to === evoBase(toId)) || (lst.length === 1 ? lst[0] : null); return hit ? hit.candy : null;
}
function ownedCopies(preId) {                  // your live scans of this species that fit the league after evolving
  const sp = evoBase(preId).split('_')[0].toUpperCase(), sh = /_shadow$/.test(preId);
  return results.filter(r => !r.superseded && r.species === sp && !!r.shadow === sh && r.combos && r.combos.length && r.cp);
}
function howToGet(m, id) {
  const e = APP.pokemon[id], name = e.name, shadow = /_shadow$/.test(id), fam = family(id);
  const ready = window.Sources && Sources.ready(), srcOf = pid => ready ? Sources.forSpecies([nm(pid)], {shadow}).filter(x => x.kind !== 'rocket') : null;   // Rocket lineups get their own card below
  const block = (label, now, html) => `<div class="avl ${now ? 'now' : ''}"><span class="lb">${label}</span><span class="tx">${html}</span></div>`;
  const routes = [];
  // 1 · catch it as it is
  const direct = srcOf(id);
  if (direct && direct.length) routes.push({live: true, order: 0, html: `<div class="rt"><div class="rh">Catch it <small>as ${esc(name)}</small></div>${bundleAvail(direct, name).map(l => block(l.label, l.now, l.html)).join('')}</div>`});
  // 2 · evolve a pre-evolution
  fam.slice(1).forEach((pre, i) => {
    const to = fam[i], candy = evoCandy(pre, to), sc = DATA.stats[evoBase(pre).split('_')[0].toUpperCase()] ? safeCap(pre, to) : null, cs = candidateSearch(to);
    const src = srcOf(pre), lines = src && src.length ? bundleAvail(src, nm(pre)).map(l => block(l.label, l.now, l.html)).join('') : '';
    const mine = ownedCopies(pre).map(r => { const b = bestOf2(r), eb = evoBaseStats(to); const cp = eb ? calcCP(eb, b[1], b[2], b[3], cpmAt(b[0])) : null; return {r, cp}; }).filter(x => x.cp && x.cp <= LEAGUE.cp).sort((a, b) => b.cp - a.cp);
    let facts = `<div class="rf">${shadow ? 'Shadow evolution keeps the Shadow bonus · ' : ''}${candy ? `<b>${candy}</b> candy` : 'candy cost unknown'}${sc ? ` · catch one ≤ <b>${sc.safe}</b> CP so it stays under ${LEAGUE.cp} as ${esc(nm(to))} <span class="dim">(${sc.safe + 1}–${sc.max} CP only with the right IVs)</span>` : sc === null && DATA.stats[evoBase(pre).split('_')[0].toUpperCase()] ? ' · any copy stays legal after evolving' : ''}</div>`;
    if (mine.length) facts += `<div class="rf good">You have a ${esc(nm(pre))} at ${mine[0].r.cp} CP: evolved it is about ${mine[0].cp} CP as ${esc(nm(to))}.</div>`;
    if (cs && !shadow) facts += `<div class="srchi" style="margin-top:4px"><code>${esc(cs.q)}</code><button onclick="Planner.copyText(${attr(cs.q)},this)">Copy</button></div>`;
    routes.push({live: !!lines, order: 1 + i, html: `<div class="rt"><div class="rh">Evolve <b>${esc(nm(pre))}</b> → ${esc(nm(to))}</div>${facts}${lines || (shadow ? '' : `<div class="rf dim">${ready ? `${esc(nm(pre))} is not in raids, eggs, research or announced events right now; wild spawns are not listed.` : 'Loading the schedule…'}</div>`)}</div>`});
  });
  // 3 · shadows: Team GO Rocket
  if (shadow) {
    const targets = fam.slice().reverse(), lineups = ready ? Sources.rocket() : [], hits = [];
    for (const lu of lineups) lu.slots.forEach((slot, si) => { for (const n of slot) for (const t of targets) if (n.toLowerCase().replace(/\s*\(.*\)$/, '') === nm(evoBase(t)).toLowerCase().replace(/\s*\(.*\)$/, '')) hits.push({who: lu.who, slot: lu.slots.length > 1 ? si + 1 : null, quote: lu.quote, t, catchable: !lu.encounter || lu.encounter === si + 1}); });
    hits.sort((a, b) => b.catchable - a.catchable);
    const pu = EVO && EVO.purify && EVO.purify[evoBase(fam[fam.length - 1])], base = APP.pokemon[evoBase(id)];
    let html = `<div class="rf">Shadow Pokémon come from <b>Team GO Rocket</b>: beat a grunt or leader whose lineup has ${targets.map(t => `Shadow ${esc(nm(evoBase(t)))}`).join(' or ')}, catch it${fam.length > 1 ? ', then evolve' : ''}.</div>`;
    if (hits.length) html += `<div class="chips" style="margin:6px 0 2px">${hits.map(h => `<span class="chip ${h.catchable ? 'ok' : ''}" title="${esc(h.quote || '')}${h.catchable ? '' : ' · in the lineup, but not the encounter you catch'}">${esc(h.who)}${h.slot ? ` · slot ${h.slot}` : ''} <span style="opacity:.7">${esc(nm(evoBase(h.t)))}${h.catchable ? '' : ' · not catchable'}</span></span>`).join('')}</div><div class="rf dim">${hits.some(h => h.catchable) ? 'Green = the encounter you get after winning.' : 'Only the marked encounter slot can be caught; these lineups have it in another slot.'} Lineups today, from Leek Duck${Sources.rocketAt ? ' (' + when(Sources.rocketAt()) + ')' : ''}; grunt lineups rotate every few weeks.</div>`;
    else html += `<div class="rf dim">${lineups.length ? `Not in today's grunt or leader lineups.` : 'Lineups rotate; '}<a href="https://leekduck.com/rocket-lineups/" target="_blank" rel="noopener">Leek Duck's Rocket lineups</a> show who has it right now.</div>`;
    if (pu) html += `<div class="rf dim">Purifying (${fmt(pu.dust)} dust · ${pu.candy} candy) makes it the normal form${base ? `: meta #${base.rank} instead of #${e.rank}` : ''}.</div>`;
    routes.push({live: hits.some(h => h.catchable), order: hits.length ? -1 : 9, html: `<div class="rt"><div class="rh">Team GO Rocket</div>${html}</div>`});
  }
  routes.sort((a, b) => (b.live - a.live) || (a.order - b.order));
  let h = `<div class="sec">How to get ${esc(name)} <small>Leek Duck schedule · game master</small></div>`;
  if (!routes.length) h += `<div class="note">${ready ? `Not in raids, eggs, research or announced events right now. Wild spawns are not listed.` : (window.Sources && Sources.error() ? 'Schedule not available: ' + esc(Sources.error()) : 'Loading the raid and egg schedule…')}</div>`;
  else h += `<div class="team avb" style="cursor:default">${routes.map(r => r.html).join('')}</div>`;
  return h;
}
function availBlock(id, list, opts) {          // a species block for Today: name, then its bundled channels
  opts = opts || {};
  const lines = bundleAvail(list, nm(id));
  return `<div class="avb" onclick="Planner.openMon('${id}')"><div class="avh"><b>${esc(nm(id))}</b><span class="dim">#${APP.pokemon[id].rank}${opts.status ? ' · ' + opts.status : ''}</span></div>` +
    lines.map(l => `<div class="avl ${l.now ? 'now' : ''}"><span class="lb">${l.label}</span><span class="tx">${l.html}</span></div>`).join('') + '</div>';
}
function availLines(list, species) {           // the same bundle, for a Pokémon page
  return bundleAvail(list, species).map(l => `<div class="avl ${l.now ? 'now' : ''}"><span class="lb">${l.label}</span><span class="tx">${l.html}</span></div>`).join('');
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
function openMon(id) {
  if (!APP || !APP.pokemon[id]) return;
  nav('#/mon/' + id);
}
function openScan(key) {                       // a scanned card's own page: this copy first, then the species
  if (!results.some(x => x.key === key)) return;
  nav('#/scan/' + encodeURIComponent(key));
}
function closeMon() { back('#/' + (UI.monFrom === 'team' && UI.team ? 'team' : (UI.monFrom === 'team' ? 'teams' : (UI.monFrom || 'roster')))); }

/* ---------- router: every page has a hash, so Back, deep links and share links all work ---------- */
function nav(hash) {                           // go to a page; same hash = re-render
  drawer(false);
  if (location.hash === hash) { route(); return; }
  const d = ((history.state && history.state.d) || 0) + 1;
  location.hash = hash;
  try { history.replaceState({d}, ''); } catch {}
}
function back(fallback) {                      // Back within the app when there is app history, else the page we came from
  if (history.state && history.state.d > 0) history.back(); else nav(fallback || '#/today');
}
function route() {
  const seg = (location.hash || '').replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  const p = seg[0] || localStorage.getItem('tab') || 'today', cur = onView();
  const leave = () => { if (cur && cur !== 'mon' && cur !== 'team') { UI.monFrom = cur; } if (cur && cur !== 'team') UI.teamFrom = cur === 'mon' ? (UI.monFrom || 'teams') : cur; };
  if (p === 'mon' && seg[1]) { if (cur !== 'mon') leave(); UI.mon = seg[1]; UI.scan = null; showView('mon'); window.scrollTo(0, 0); return; }
  if (p === 'scan' && seg[1]) {
    const key = seg.slice(1).join('/'), r = results.find(x => x.key === key);
    if (!r) { nav('#/scans'); return; }
    if (cur !== 'mon') leave();
    const sid = scanId(r); UI.scan = key; UI.mon = sid && sid.id && APP && APP.pokemon[sid.id] ? sid.id : null;
    showView('mon'); window.scrollTo(0, 0); return;
  }
  if (p === 'team' && seg[1]) {
    const ids = seg[1].split('+').filter(Boolean);
    if (ids.length !== 3) { nav('#/teams'); return; }
    if (cur !== 'team') leave();
    UI.team = {ids, name: seg[2] || null}; showView('team'); window.scrollTo(0, 0); return;
  }
  if (p === 'mon' || p === 'scan' || p === 'team') { nav('#/' + (localStorage.getItem('tab') || 'today')); return; }
  const page = PAGES.includes(p) ? p : 'today';
  if (['builder', 'meta', 'rank', 'raids'].includes(page)) UI.metaPanel = {builder: 'build', meta: 'teams', rank: 'rank', raids: 'raids'}[page];
  UI.mon = null; UI.scan = null; UI.team = null;
  showView(page);
  if (page !== cur) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------- Battle log: GO Battle League results by hand (three taps) or from end-of-set screenshots; rating over time ---------- */
let BATTLES = JSON.parse(localStorage.getItem('battles') || '[]');
const BL = Object.assign({team: 'builder', lead: null, q: ''}, JSON.parse(localStorage.getItem('bl') || '{}'));
const saveBL = () => localStorage.setItem('bl', JSON.stringify(BL));
const saveBattles = () => { BATTLES.sort((a, b) => a.t - b.t); localStorage.setItem('battles', JSON.stringify(BATTLES)); if (window.Sync) Sync.touch('battles'); };
function mergeBattles(list) {                 // sync: append entries this device has not seen (by id)
  const have = new Set(BATTLES.map(b => b.id)); let n = 0;
  for (const b of list || []) if (b && b.id && !have.has(b.id)) { BATTLES.push(b); have.add(b.id); n++; }
  if (n) { BATTLES.sort((a, b) => a.t - b.t); localStorage.setItem('battles', JSON.stringify(BATTLES)); dirty = true; }
  return n > 0;
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function blTeamIds() { if (BL.team !== 'builder' && ROSTER.tagged[BL.team]) return ROSTER.tagged[BL.team].slice(); return UI.build.slots.filter(Boolean); }
function logBattle(result) {
  const ids = blTeamIds(); if (ids.length !== 3) { status('Pick a team of three first'); return; }
  BATTLES.push({id: newId(), t: Date.now(), league: LEAGUE.slug, team: BL.team === 'builder' ? null : BL.team, ids, lead: BL.lead || null, result, src: 'tap'});
  BL.lead = null; saveBL(); saveBattles(); renderBattles(); status(result === 'W' ? 'Win logged' : 'Loss logged');
}
function logRating(v, extra) {
  const rating = parseInt(v); if (!(rating > 0 && rating < 5000)) { status('Rating must be a number like 2150'); return; }
  BATTLES.push(Object.assign({id: newId(), t: Date.now(), league: LEAGUE.slug, rating, src: 'rating'}, extra || {}));
  saveBattles(); renderBattles(); status(`Rating ${rating} saved`);
}
function delBattle(id) { BATTLES = BATTLES.filter(b => b.id !== id); saveBattles(); renderBattles(); }
async function importBattle(files) {
  if (!files || !files.length || typeof readBattle !== 'function') return;
  let n = 0;
  for (const f of files) {
    try {
      status('Reading ' + f.name + '…');
      const r = await readBattle(f);
      if (!r) { status(`${f.name}: no rating or set result found; log it by hand`); continue; }
      const ids = blTeamIds();
      BATTLES.push({id: newId(), t: f.lastModified || Date.now(), league: LEAGUE.slug, rating: r.rating, delta: r.delta, set: r.wins !== undefined ? {w: r.wins, l: r.losses} : undefined, team: BL.team === 'builder' ? null : BL.team, ids: ids.length === 3 ? ids : undefined, src: 'ocr'});
      n++; status(`${f.name}: ${r.rating ? 'rating ' + r.rating : ''}${r.wins !== undefined ? ` · ${r.wins}/5 wins` : ''}`);
    } catch (e) { status(`${f.name}: ${e.message || e}`); }
  }
  if (n) { saveBattles(); renderBattles(); }
}
const wl = arr => { const o = {w: 0, l: 0}; for (const b of arr) { if (b.result === 'W') o.w++; else if (b.result === 'L') o.l++; if (b.set) { o.w += b.set.w; o.l += b.set.l; } } return o; };
const rec = o => `${o.w}-${o.l}`;
const teamKey = ids => ids.slice().sort().join('+');
function battleStats(league) {
  const all = BATTLES.filter(b => !league || b.league === league), fights = all.filter(b => b.result || b.set);
  const byTeam = {}, byLead = {}, byMember = {};
  for (const b of fights) {
    if (b.ids) { const k = teamKey(b.ids); (byTeam[k] = byTeam[k] || {ids: b.ids, name: b.team, list: []}).list.push(b); for (const id of b.ids) (byMember[id] = byMember[id] || []).push(b); }
    if (b.lead && b.result) (byLead[b.lead] = byLead[b.lead] || []).push(b);
  }
  const ratings = all.filter(b => b.rating).sort((a, b) => a.t - b.t);
  return {all, fights, total: wl(fights), ratings, now: ratings.length ? ratings[ratings.length - 1] : null,
    teams: Object.values(byTeam).map(t => Object.assign(t, wl(t.list))).sort((a, b) => (b.w + b.l) - (a.w + a.l)),
    leads: Object.entries(byLead).map(([id, list]) => Object.assign({id}, wl(list))).sort((a, b) => (a.w / (a.w + a.l)) - (b.w / (b.w + b.l)) || (b.w + b.l) - (a.w + a.l)),
    members: Object.entries(byMember).map(([id, list]) => Object.assign({id}, wl(list))).sort((a, b) => (b.w + b.l) - (a.w + a.l))};
}
function teamRecord(ids) {                     // for team pages and the coach: this trio's real results in the current league
  const st = battleStats(LEAGUE.slug), k = teamKey(ids), t = st.teams.find(x => teamKey(x.ids) === k); if (!t) return null;
  const leads = {}; for (const b of t.list) if (b.lead && b.result) { (leads[b.lead] = leads[b.lead] || {w: 0, l: 0})[b.result === 'W' ? 'w' : 'l']++; }
  const worst = Object.entries(leads).map(([id, o]) => Object.assign({id}, o)).filter(x => x.l >= x.w).sort((a, b) => (b.l - b.w) - (a.l - a.w)).slice(0, 3);
  return {w: t.w, l: t.l, worst};
}
function battleSummaryText(ids) {
  const r = ids ? teamRecord(ids) : null, st = battleStats(LEAGUE.slug);
  if (!st.fights.length && !st.ratings.length) return null;
  const out = {};
  if (r) out.thisTeam = `${rec(r)} in GO Battle League${r.worst.length ? '; loses to leads: ' + r.worst.map(x => `${nm(x.id)} ${rec(x)}`).join(', ') : ''}`;
  out.overall = `${rec(st.total)} over ${st.fights.length} logged battles/sets`;
  if (st.teams.length) out.teams = st.teams.slice(0, 4).map(t => `${t.name || t.ids.map(nm).join(' / ')}: ${rec(t)}`);
  if (st.leads.length) out.worstLeads = st.leads.filter(x => x.w + x.l >= 2).slice(0, 5).map(x => `${nm(x.id)}: ${rec(x)}`);
  if (st.now) { const weekAgo = st.ratings.filter(b => b.t < Date.now() - WEEK).pop(); out.rating = `${st.now.rating} now${weekAgo ? `, ${weekAgo.rating} a week ago` : ''}`; }
  return out;
}
function sparkline(points) {
  if (points.length < 2) return '';
  const W = 300, H = 44, min = Math.min(...points), max = Math.max(...points), span = Math.max(max - min, 20);
  const xs = points.map((v, i) => `${(i / (points.length - 1) * W).toFixed(1)},${(H - 4 - (v - min) / span * (H - 8)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${xs.join(' ')}"/><circle cx="${xs[xs.length - 1].split(',')[0]}" cy="${xs[xs.length - 1].split(',')[1]}" r="3"/></svg>`;
}
function renderBattles() {
  const el = $('battles'); if (!el) return;
  try { el.innerHTML = battlesInner(); } catch (e) { el.innerHTML = errorCard('Battle log', e); }
}
function battlesInner() {
  if (!APP || !window.PVP) return '<div class="note">Loading PvPoke data…</div>';
  const m = M(), L = builderLeague(m), st = battleStats(LEAGUE.slug), ids = blTeamIds();
  let h = '';
  // rating
  const pts = st.ratings.slice(-40).map(b => b.rating);
  h += `<div class="team card" style="cursor:default"><div class="sec" style="margin:0 0 4px;display:flex;justify-content:space-between;align-items:center"><span>Rating <small>${esc(LEAGUE.title)}</small></span>${st.ratings.length ? ctxMenu([['Delete last rating', `Planner.delBattle(${attr(st.now.id)})`, true]]) : ''}</div>
    ${st.now ? `<div style="display:flex;align-items:baseline;gap:10px"><span class="big" style="font-family:Sora,sans-serif;font-weight:800;font-size:30px;color:var(--green)">${st.now.rating}</span><span class="dim" style="font-size:12px">${when(st.now.t)}${(() => { const wk = st.ratings.filter(b => b.t < st.now.t - WEEK).pop(); return wk ? ` · ${st.now.rating - wk.rating >= 0 ? '+' : ''}${st.now.rating - wk.rating} vs a week ago` : ''; })()}</span></div>${sparkline(pts)}` : '<div class="dt">No rating yet. After a set, type the rating the game shows or import the end-of-set screenshot.</div>'}
    <div class="add" style="margin:8px 0 0"><input id="blrating" type="number" inputmode="numeric" placeholder="rating after your set" style="flex:1;min-width:120px"><button onclick="Planner.logRating(document.getElementById('blrating').value)">Save</button><button onclick="document.getElementById('bfile').click()" style="background:var(--card);color:var(--ink);border:1px solid var(--line)">Screenshot…</button></div>
    <div class="dt" style="margin-top:6px">Screenshot: the end-of-set screen (x/5 and rating) or the post-battle rating screen. Whatever is legible is saved; the rest you can tap in below.</div></div>`;
  // log a battle
  const teams = [['builder', 'Builder']].concat(Object.keys(ROSTER.tagged).map(n => [n, n]));
  h += `<div class="sec">Log a battle <small>team · their lead · result</small></div>`;
  h += `<div class="tchips">${teams.map(([k, l]) => `<span class="chip ${BL.team === k ? 'ok' : ''}" onclick="Planner.blTeam(${attr(k)})">${esc(l)}</span>`).join('')}</div>`;
  if (ids.length !== 3) h += `<div class="note">Pick a saved party, or fill the builder with the three you run.</div>`;
  else {
    const pool = L.pool(), q = BL.q.toLowerCase(), hits = q ? pool.filter(o => nm(o).toLowerCase().includes(q) || o.includes(q)).slice(0, 8) : [];
    const recent = []; for (const b of BATTLES.slice().reverse()) if (b.lead && !recent.includes(b.lead) && APP.pokemon[b.lead]) { recent.push(b.lead); if (recent.length >= 8) break; }
    h += `<div class="team" style="cursor:default"><div class="dt" style="margin-bottom:4px">${ids.map(nm).map(esc).join(' / ')}</div>
      <div class="add" style="margin:4px 0"><input id="blq" placeholder="their lead (optional): search…" value="${esc(BL.q)}" oninput="Planner.blSearch(this.value)"></div>
      ${hits.length ? `<div class="tchips">${hits.map(o => `<span class="chip ${BL.lead === o ? 'ok' : ''}" onclick="Planner.blLead('${o}')">${esc(nm(o))}</span>`).join('')}</div>` : recent.length ? `<div class="tchips">${recent.map(o => `<span class="chip ${BL.lead === o ? 'ok' : ''}" onclick="Planner.blLead('${o}')">${esc(nm(o))}</span>`).join('')}</div>` : ''}
      ${BL.lead ? `<div class="dt" style="margin:4px 0">Their lead: <b style="color:var(--ink)">${esc(nm(BL.lead))}</b> <a href="#" class="dim" onclick="Planner.blLead(null);return false">clear</a></div>` : ''}
      <div class="wl"><button class="win" onclick="Planner.logBattle('W')">Win</button><button class="loss" onclick="Planner.logBattle('L')">Loss</button></div></div>`;
  }
  // stats
  if (st.fights.length) {
    h += `<div class="sec">Results <small>${rec(st.total)} · ${st.fights.length} logged</small></div>`;
    h += `<div class="team card" style="cursor:default">${kv([
      ['Teams', st.teams.slice(0, 5).map(t => `<div style="cursor:pointer" onclick="Planner.openTeam(${attr(t.ids)},${attr(t.name || null)})"><b>${rec(t)}</b> ${esc(t.name || t.ids.map(nm).join(' / '))}</div>`).join('') || '—'],
      ['Their leads', st.leads.length ? st.leads.slice(0, 6).map(x => `<div style="cursor:pointer" onclick="Planner.openMon('${x.id}')"><b>${rec(x)}</b> vs ${esc(nm(x.id))}${x.l > x.w ? ' <span class="chip warn">trouble</span>' : ''}</div>`).join('') : '<span class="dim">log the lead to see who gives you trouble</span>'],
      ['Members', st.members.slice(0, 6).map(x => `<b>${rec(x)}</b> ${esc(nm(x.id))}`).join('<br>') || '—'],
    ])}</div>`;
  }
  // recent
  const recentB = st.all.slice().reverse().slice(0, 12);
  if (recentB.length) h += `<div class="sec">Recent</div>` + recentB.map(b => `<div class="team row" style="cursor:default"><span class="sc" style="color:${b.result === 'W' ? 'var(--green)' : b.result === 'L' ? '#F59A8B' : 'var(--dim)'}">${b.result || (b.set ? `${b.set.w}/5` : b.rating ? '★' : '·')}</span><span class="tx"><span class="nm">${b.rating ? `rating ${b.rating}${b.delta ? ` (${b.delta > 0 ? '+' : ''}${b.delta})` : ''}` : b.set ? `set ${b.set.w}-${b.set.l}` : `${b.lead ? 'vs ' + esc(nm(b.lead)) + ' lead' : 'battle'}`}</span><div class="dt">${when(b.t)}${b.ids ? ' · ' + esc(b.team || b.ids.map(nm).join(' / ')) : ''}${b.src === 'ocr' ? ' · from screenshot' : ''}</div></span>${ctxMenu([['Delete', `Planner.delBattle(${attr(b.id)})`, true]])}</div>`).join('');
  h += `<div class="note">Everything here is yours: the log lives on this device and follows your account when sync is on. Team pages and the AI review use these records next to the meta numbers.</div>`;
  return h;
}
function blTeam(k) { BL.team = k; saveBL(); renderBattles(); }
function blLead(id) { BL.lead = id; BL.q = ''; saveBL(); renderBattles(); }
function blSearch(v) { BL.q = v; saveBL(); const pos = $('blq') && $('blq').selectionStart; renderBattles(); const q = $('blq'); if (q) { q.focus(); if (pos != null) q.setSelectionRange(pos, pos); } }

/* ---------- Matchups page: your team against one opponent per shield scenario, and "their lead is X" ---------- */
const MU = Object.assign({team: 'builder', opp: null, mode: 'matchup', q: '', recent: []}, JSON.parse(localStorage.getItem('mu') || '{}'));
const saveMU = () => localStorage.setItem('mu', JSON.stringify(MU));
function muTeamIds(m) {
  if (MU.team !== 'builder' && ROSTER.tagged[MU.team]) return ROSTER.tagged[MU.team].slice();
  return UI.build.slots.filter(Boolean);
}
function renderMatchups() {
  const el = $('matchups'); if (!el) return;
  try { el.innerHTML = matchupsInner(); } catch (e) { el.innerHTML = errorCard('Matchups', e); }
}
function matchupsInner() {
  if (!APP || !window.PVP) return '<div class="note">Loading PvPoke data…</div>';
  const m = M(), L = builderLeague(m), ids = muTeamIds(m), mx = L.mx;
  const cls = r => r >= 500 ? 'w' : r < 400 ? 'l' : 'e';
  let h = `<div class="note">${mx ? `Battles simulated with PvPoke's engine for ${mx.rows.length} × ${mx.cols.length} Pokémon in ${esc(LEAGUE.title)} (${esc(String(mx.gamemasterTimestamp || '').slice(0, 10))}), with PvPoke's default IVs and movesets, three shield scenarios. Same numbers as pvpoke.com.` : matrixBad ? `The simulated matrix for ${esc(LEAGUE.title)} disagrees with PvPoke's published matchups (median ${matrixBad} points), so it is switched off here: ratings below are PvPoke's published matchups where known, else a type estimate (one scenario).` : `No simulated matrix for ${esc(LEAGUE.title)} yet: ratings below are PvPoke's published matchups where known, else a type estimate (one scenario).`}</div>`;
  const teams = [['builder', 'Builder']].concat(Object.keys(ROSTER.tagged).map(n => [n, n]));
  h += `<div class="sec">Your team</div><div class="tchips">${teams.map(([k, l]) => `<span class="chip ${MU.team === k ? 'ok' : ''}" onclick="Planner.muTeam(${attr(k)})">${esc(l)}</span>`).join('')}</div>`;
  if (ids.length < 1) return h + `<div class="empty"><b>No team picked.</b><br>Fill the builder or save an in-game party, then come back.</div>`;
  h += `<div class="team" style="cursor:default"><div class="chips">${ids.map(id => `<span class="chip" onclick="Planner.openMon('${id}')" style="cursor:pointer">${esc(nm(id))} <span style="opacity:.7">${esc(L.movesOf(id).filter(Boolean).map(mvName).join(' · '))}</span></span>`).join('')}</div></div>`;
  h += `<div class="tabs sub seg" style="margin:10px 0 6px"><button class="${MU.mode === 'matchup' ? 'on' : ''}" onclick="Planner.muMode('matchup')">One opponent</button><button class="${MU.mode === 'lead' ? 'on' : ''}" onclick="Planner.muMode('lead')">Their lead</button></div>`;
  const pool = L.pool(), q = MU.q.toLowerCase();
  const hits = q ? pool.filter(o => nm(o).toLowerCase().includes(q) || o.includes(q)).slice(0, 8) : [];
  h += `<div class="add" style="margin:6px 0"><input id="muq" placeholder="opponent: search ${pool.length} ${mx ? 'simulated' : 'meta'} Pokémon" value="${esc(MU.q)}" oninput="Planner.muSearch(this.value)"></div>`;
  if (hits.length) h += `<div class="tchips">${hits.map(o => `<span class="chip ${MU.opp === o ? 'ok' : ''}" onclick="Planner.muOpp('${o}')">${esc(nm(o))} <span style="opacity:.7">#${APP.pokemon[o].rank}</span></span>`).join('')}</div>`;
  else if (MU.recent.length) h += `<div class="tchips">${MU.recent.filter(o => APP.pokemon[o]).map(o => `<span class="chip ${MU.opp === o ? 'ok' : ''}" onclick="Planner.muOpp('${o}')">${esc(nm(o))}</span>`).join('')}</div>`;
  const opp = MU.opp && APP.pokemon[MU.opp] ? MU.opp : null;
  if (!opp) return h + `<div class="note">Pick an opponent to see how each of your ${ids.length === 1 ? 'Pokémon does' : 'Pokémon do'} against it.</div>`;
  const rows = L.matchup(ids, opp), scen = mx ? mx.scenarios : ['1-1'];
  const oppMoves = mx && mx.moves[opp] ? mx.moves[opp] : APP.pokemon[opp].moveset;
  h += `<div class="sec">${MU.mode === 'lead' ? 'Their lead' : 'Against'} <b style="color:var(--ink)">${esc(nm(opp))}</b> <small>#${APP.pokemon[opp].rank} · ${esc(oppMoves.map(mvName).join(' · '))}</small></div>`;
  h += `<div class="mut" style="grid-template-columns:1fr repeat(${scen.length},minmax(52px,64px))"><div class="mh"></div>${scen.map(sc => `<div class="mh">${sc === '0-0' ? 'no shields' : sc === '1-1' ? '1 shield each' : sc === '2-2' ? '2 shields each' : sc}</div>`).join('')}` +
    rows.map(r => `<div class="mn" onclick="Planner.openMon('${r.id}')"><b>${esc(nm(r.id))}</b><small>${r.verdict === 'wins' ? '<span class="good">wins regardless</span>' : r.verdict === 'loses' ? '<span class="bad">loses</span>' : 'shield-dependent'}${r.source === 'sim-default' ? ' · <span title="simulated with PvPoke\'s moveset, yours differs">PvPoke moveset</span>' : r.source === 'est' ? ' · estimated' : ''}</small></div>${scen.map(sc => `<div class="mc ${cls(r.ratings[sc])}">${Math.round(r.ratings[sc])}</div>`).join('')}`).join('') + `</div>`;
  if (MU.mode === 'lead' && ids.length === 3) {
    const rl = roles(L, ids), lead = rl.find(x => x.role === 'Lead').id, byId = Object.fromEntries(rows.map(r => [r.id, r]));
    const r11 = id => byId[id].ratings['1-1'] ?? Object.values(byId[id].ratings)[0], r22 = id => byId[id].ratings['2-2'] ?? r11(id);
    const others = ids.filter(id => id !== lead).sort((a, b) => r11(b) - r11(a)), best = others[0];
    let advice;
    if (r11(lead) >= 500 && r22(lead) >= 500) advice = `<b>Stay in</b> with ${esc(nm(lead))}: it wins with or without shields.`;
    else if (r11(lead) >= 500) advice = `<b>Stay in</b> with ${esc(nm(lead))} but expect a shield battle: it wins 1-1 (${Math.round(r11(lead))}) and loses 2-2 (${Math.round(r22(lead))}), so bait or shield once.`;
    else if (r11(best) >= 500) advice = `<b>Swap to ${esc(nm(best))}</b> (${Math.round(r11(best))} in 1-1${r22(best) >= 500 ? ', also wins 2-2' : ', but you will need a shield'}). ${esc(nm(lead))} loses this one (${Math.round(r11(lead))}).`;
    else advice = `<b>Nobody wins this</b> cleanly: ${esc(nm(best))} does best (${Math.round(r11(best))}). Farm energy, save shields for the back line.`;
    h += `<div class="team card" style="cursor:default"><div class="sec" style="margin:0 0 4px">If they lead ${esc(nm(opp))}</div><div style="font-size:14px;line-height:1.45">${advice}</div><div class="dt" style="margin-top:6px">Your lead is ${esc(nm(lead))} (${rl.find(x => x.role === 'Lead').why || 'from the team roles'}). These are 1v1 ratings with equal shields and no energy carried over; the real answer also depends on their back line.</div></div>`;
  }
  h += `<div class="note">Rating 0–1000 like PvPoke: 500 is even, above wins. ${mx ? 'Cells come from PvPoke\'s battle engine run for this league; a "PvPoke moveset" note means the simulation used PvPoke\'s default moves while yours differ.' : ''}</div>`;
  return h;
}
function muTeam(k) { MU.team = k; saveMU(); renderMatchups(); }
function muMode(k) { MU.mode = k; saveMU(); renderMatchups(); }
function muSearch(v) { MU.q = v; saveMU(); const pos = $('muq') && $('muq').selectionStart; renderMatchups(); const q = $('muq'); if (q) { q.focus(); if (pos !== null && pos !== undefined) q.setSelectionRange(pos, pos); } }
function muOpp(id) { MU.opp = id; MU.q = ''; MU.recent = [id].concat(MU.recent.filter(x => x !== id)).slice(0, 6); saveMU(); renderMatchups(); }

/* ---------- matchup matrix (data/matrix-<league>.json, simulated with PvPoke's engine by scripts/build_matrix.mjs) ---------- */
let MATRIX = null, matrixSlug = null, matrixLoading = false, matrixBad = null;
const mxFor = () => (MATRIX && MATRIX.league === LEAGUE.slug) ? MATRIX : null;
async function loadMatrix() {
  if (matrixLoading || !APP || matrixSlug === LEAGUE.slug) return;
  matrixLoading = true; const slug = LEAGUE.slug;
  matrixBad = null;
  try { const r = await fetch(`data/matrix-${slug}.json?v=` + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''), {cache: 'no-cache'}); MATRIX = r.ok ? await r.json() : null; }
  catch { MATRIX = null; }
  if (MATRIX && MATRIX.check && MATRIX.check.median > 30) { matrixBad = MATRIX.check.median; MATRIX = null; }   // the simulation disagrees with PvPoke's published numbers for this league: do not trust it
  matrixSlug = slug; matrixLoading = false;
  if (LEAGUE.slug === slug) refresh();
}

/* ---------- meta changes (data/changes.json, written by scripts/diff_app_data.py): what moved for the Pokémon you own ---------- */
let CHANGES = null;
async function loadChanges() {
  try { const r = await fetch('data/changes.json?v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''), {cache: 'no-cache'}); if (r.ok) { CHANGES = ((await r.json()) || {}).entries || []; if (onView() === 'today') renderToday(); } } catch {}
}
function changesFor(m) {
  if (!CHANGES || !APP) return [];
  const mine = id => !!m.own[id] || m.ri.pending[id] !== undefined, out = [], names = ms => ms.map(mvName).join(' · ');
  for (const e of CHANGES) {
    if (e.league !== LEAGUE.slug) continue;
    for (const c of e.moveset || []) if (mine(c.id) && APP.pokemon[c.id]) out.push({k: `${e.date}|mv|${c.id}`, date: e.date, id: c.id, txt: `<b>${esc(nm(c.id))}</b>: PvPoke's best moves are now ${esc(names(c.to))} <span class="dim">(were ${esc(names(c.from))})</span>`});
    for (const id of e.newMeta || []) if (mine(id) && APP.pokemon[id]) out.push({k: `${e.date}|in|${id}`, date: e.date, id, txt: `<b>${esc(nm(id))}</b> entered the meta group <span class="dim">(now #${APP.pokemon[id].rank})</span>`});
    for (const id of e.leftMeta || []) if (mine(id) && APP.pokemon[id]) out.push({k: `${e.date}|out|${id}`, date: e.date, id, txt: `<b>${esc(nm(id))}</b> left the meta group <span class="dim">(now #${APP.pokemon[id].rank})</span>`});
    for (const c of e.rank || []) if (mine(c.id) && APP.pokemon[c.id]) out.push({k: `${e.date}|rk|${c.id}`, date: e.date, id: c.id, txt: `<b>${esc(nm(c.id))}</b> moved from #${c.from} to #${c.to}`});
  }
  return out.filter(x => !ROSTER.seen[x.k]).sort((a, b) => b.date.localeCompare(a.date));
}
function changesCard(m) {
  const ch = changesFor(m); if (!ch.length) return '';
  return `<div class="team card"><div class="sec" style="display:flex;justify-content:space-between;align-items:center;margin:0 0 4px"><span>Meta changed for your Pokémon <small>PvPoke data of ${esc(ch[0].date)}</small></span>${ctxMenu([['Dismiss these', `Planner.dismissChanges(${attr(ch.map(x => x.k))})`]])}</div>` +
    ch.slice(0, 6).map(x => `<div class="dt" style="margin:5px 0;cursor:pointer" onclick="Planner.openMon('${x.id}')">${x.txt}</div>`).join('') + (ch.length > 6 ? `<div class="dim" style="font-size:12px">… and ${ch.length - 6} more</div>` : '') + `</div>`;
}
function dismissChanges(keys) { for (const k of keys) ROSTER.seen[k] = Date.now(); saveRoster(); renderToday(); }

/* ---------- leagues: data/cups.json lists Great / Ultra / Little plus the cups PvPoke currently features ---------- */
let CUPS = JSON.parse(localStorage.getItem('cups') || 'null');
const DEFAULT_CUPS = [{slug: 'great', title: 'Great League', cp: 1500, kind: 'league'}, {slug: 'ultra', title: 'Ultra League', cp: 2500, kind: 'league'}, {slug: 'little', title: 'Little League', cp: 500, kind: 'league'}];
async function loadCups() {
  try { const r = await fetch('data/cups.json?v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''), {cache: 'no-cache'}); if (r.ok) { const j = await r.json(); if (j && j.leagues && j.leagues.length) { CUPS = j.leagues; localStorage.setItem('cups', JSON.stringify(CUPS)); paintDrawer(); } } } catch {}
}
function setLeague(slug) { drawer(false); if (typeof window.setLeague === 'function') window.setLeague(slug); }

/* ---------- side drawer ---------- */
const DRAWER = [['Play', [['today', 'Today', '☀'], ['builder', 'Builder', '▦'], ['teams', 'Saved teams', '★'], ['matchups', 'Matchups', '⚑'], ['battles', 'Battle log', '◔']]],
                ['Meta', [['meta', 'Meta teams', '♛'], ['rank', 'Rankings', '#'], ['raids', 'Raids', '⚔']]],
                ['Collection', [['roster', 'Roster', '◎'], ['scans', 'Scans & import', '⌗']]]];
function drawer(open) { const d = $('drawer'); if (!d) return; d.classList.toggle('open', !!open); if (open) paintDrawer(); }
function paintDrawer() {
  const el = $('dr'), d = $('drawer'); if (!el || !d || !d.classList.contains('open')) return;
  const cur = onView(), on = {mon: UI.monFrom, team: UI.teamFrom}[cur] || cur;
  let h = `<div class="ttl">Menu <span class="x" onclick="Planner.drawer(false)">✕</span></div>`;
  for (const [g, items] of DRAWER) h += `<div class="grp">${g}</div>` + items.map(([k, label, ic]) => `<a href="#/${k}" class="${on === k ? 'on' : ''}" onclick="Planner.nav('#/${k}');return false"><span class="ic">${ic}</span>${label}</a>`).join('');
  const cups = CUPS || DEFAULT_CUPS, curL = LEAGUE.slug;
  h += `<div class="grp">League</div>` + cups.map(c => `<a href="#" class="${c.slug === curL ? 'on' : ''}" onclick="Planner.setLeague('${c.slug}');return false"><span class="ic">${c.kind === 'cup' ? '◆' : '◇'}</span>${esc(c.title)}<small>${c.cp} CP</small></a>`).join('');
  h += `<div class="grp">You</div><a href="#" onclick="Planner.drawer(false);toggleProfile();return false"><span class="ic">☺</span>Trainer profile</a>`;
  if (window.Sync && Sync.available()) { const hl = Sync.health() || {}; h += `<a href="#" onclick="Planner.drawer(false);Sync.toggle();return false"><span class="ic">☁</span>${hl.auth === 'clerk' ? 'Account' : 'Sync'}<small>${Sync.signedIn() ? (hl.auth === 'clerk' && window.Auth ? esc(Auth.email() || 'signed in') : 'connected') : hl.auth === 'clerk' ? 'sign in' : 'off'}</small></a>`; }
  h += `<a href="#" onclick="Planner.drawer(false);toggleHelp();return false"><span class="ic">?</span>Help &amp; glossary</a>`;
  h += `<div class="ft">PokeScan v${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}${APP && APP.generatedAt ? ` · PvPoke data ${esc(String(APP.generatedAt).slice(0, 10))}` : ''}</div>`;
  el.innerHTML = h;
}
function renderMon() {
  const el = $('mon'); if (!el || (!UI.mon && !UI.scan)) return;
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading PvPoke data…</div>'; return; }
  if (UI.mon && !APP.pokemon[UI.mon]) { UI.mon = null; if (!UI.scan) { el.innerHTML = '<div class="note">Unknown Pokémon.</div>'; return; } }
  try {
    const m = M(), r = UI.scan ? results.find(x => x.key === UI.scan) : null;
    if (UI.scan && !r) { UI.scan = null; if (!UI.mon) { closeMon(); return; } }
    el.innerHTML = (r ? scanSection(m, r) : '') + (UI.mon ? monInner(m, UI.mon, !!r) : '');
  } catch (e) { el.innerHTML = errorCard('detail', e); }
}
const nice = sp => (sp || '?').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const kv = rows => `<div class="kv">${rows.filter(r => r && r[1] !== '' && r[1] != null).map(([k, v]) => `<span class="k">${k}</span><span class="v ${k ? '' : 'cont'}">${v}</span>`).join('')}</div>`;
function ctxMenu(items) {                      // ⋮ button with a dropdown; items: [label, onclick, danger?]
  const rows = items.filter(Boolean).map(([l, fn, danger]) => `<button class="${danger ? 'danger' : ''}" onclick="${fn}">${l}</button>`).join('');
  if (!rows) return '';
  return `<div class="ctx" onclick="event.stopPropagation()"><button class="dots" aria-label="More" onclick="Planner.toggleMenu(this)">⋮</button><div class="menu" hidden onclick="this.hidden=true">${rows}</div></div>`;
}
function toggleMenu(btn) { const menu = btn.nextElementSibling, open = !menu.hidden; document.querySelectorAll('.ctx .menu').forEach(m => m.hidden = true); menu.hidden = open; }
document.addEventListener('click', () => document.querySelectorAll('.ctx .menu').forEach(m => m.hidden = true));
function toggleGloss() { UI.gloss = !UI.gloss; renderMon(); }
function scanSection(m, r) {
  const idx = results.indexOf(r), best = r.combos.length ? bestOf2(r) : null, ps = r.combos.map(pct);
  const lo = ps.length ? Math.min(...ps) : 0, hi = ps.length ? Math.max(...ps) : 0;
  const back = PAGE_LABEL[UI.monFrom] || 'Back';
  const key = esc(r.key), rm = `Planner.renderMon()`;
  const menu = ctxMenu([
    [r.fav ? '☆ Remove favourite' : '★ Favourite', `toggleFav(${idx});${rm}`],
    [r.bench ? 'Unbench' : 'Bench (keep, but not for teams)', `toggleBench(${idx});${rm}`],
    r.superseded ? ['Unarchive', `results[${idx}].superseded=null;save();render();Planner.refresh();${rm}`] : ['Archive', `results[${idx}].superseded={why:'archived by hand',t:Date.now()};save();render();Planner.refresh();${rm}`],
    [r.shadow ? 'Mark as normal / purified' : 'Mark as Shadow', `toggleShadow(${idx});${rm}`],
    ['Update this Pokémon…', `Planner.updateScan('${key}')`],
    ['Correct a misread…', `Planner.editScan('${key}')`],
    ['Delete scan', `Planner.deleteScan('${key}')`, true],
  ]);
  let h = lineageBanner(r) + `<div class="monhead"><button class="back" onclick="Planner.closeMon()">‹ ${back}</button><div class="chips" style="margin:0">${r.superseded ? chip('archived') : ''}${r.bench ? chip('benched') : ''}${r.shadow ? chip('shadow', 'ul') : ''}${r.apMismatch ? chip('appraisal ≠ CP/HP', 'warn') : ''}${r.cpInferred ? chip('CP inferred', 'gl') : ''}</div>${menu}</div>`;
  h += `<div class="scanhero"><div class="dh" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><span class="nm" style="font-family:Sora,sans-serif;font-weight:700;font-size:20px">${r.fav ? '<span class="star on">★</span>' : ''}${esc(nice(r.species))}</span><span class="dim"><b style="color:var(--ink)">${r.cp ?? '?'}</b> CP · ${r.hp ?? '?'} HP · L${r.level ?? '?'}</span></div>`;
  const rows = [];
  if (best) {
    const bb = best[4] || DATA.stats[r.species][0], gl = pvpRank(bb, best[1], best[2], best[3], LEAGUE.cp), ul = pvpRank(bb, best[1], best[2], best[3], LEAGUE.cp === 2500 ? 1500 : 2500);
    const barRow = (l, v) => `<span>${l}</span><span class="tr"><i class="${v === 15 ? 'max' : ''}" style="width:${v / 15 * 100}%"></i></span><span class="iv">${v}</span>`;
    h += `<div class="bars">${barRow('Atk', best[1])}${barRow('Def', best[2])}${barRow('HP', best[3])}</div>`;
    h += `<div class="kpis"><div><small>IV%</small><b>${lo === hi ? hi.toFixed(1) : lo.toFixed(0) + '–' + hi.toFixed(0)}%</b><span class="sub">${best[1] + best[2] + best[3]} of 45</span></div><div><small>GL rank</small><b>#${gl.n}</b><span class="sub">${gl.pct.toFixed(1)}%</span></div><div><small>UL rank</small><b>#${ul.n}</b><span class="sub">${ul.pct.toFixed(1)}%</span></div></div>`;
    let st;
    const cpMax = calcCP(bb, best[1], best[2], best[3], cpmAt(maxL() / 2));
    if (r.cp > LEAGUE.cp) st = `${chip(`over the ${LEAGUE.abbr} cap`, 'warn')} <span class="dim">cannot battle in ${esc(LEAGUE.title)}</span>`;
    else if (cpMax < LEAGUE.cp) st = `${chip(`caps at ${cpMax} CP`, 'warn')} <span class="dim">stays under ${LEAGUE.cp} even at L${maxL() / 2}: evolve it, see below</span>`;
    else if (gl.lv > 40) st = `${chip(`needs L${gl.lv}`, 'warn')} <span class="dim">XL candy · ${gl.cp} CP at the cap</span>`;
    else if (gl.lv > best[0]) { const c = costTo(best[0], gl.lv); st = `${chip(`power up to L${gl.lv}`, 'ul')} <span class="dim">${fmt(c.dust)} dust · ${c.candy} candy → ${gl.cp} CP</span>`; }
    else st = `${chip(`ready for ${LEAGUE.abbr}`, 'meta1')} <span class="dim">${gl.cp} CP at L${gl.lv}, no power-up needed</span>`;
    rows.push(['Status', st]);
    if (r.combos.length > 1) rows.push(['Spreads', `${r.combos.length} fit this CP and HP, best shown. An appraisal pins it down.<div class="alts" style="margin-top:4px">${r.combos.map(c => `L${c[0]}  ${c[1]}/${c[2]}/${c[3]}  ${pct(c).toFixed(1)}%`).join('\n')}</div>`]);
  } else rows.push(['Status', `${chip('no match', 'warn')} <span class="dim">no IV spread fits this CP and HP; use ⋮ → Correct a misread</span>`]);
  const mv = movesRowForScan(r, idx), sid0 = scanId(r); let usage = '';
  if (mv) {
    const id0 = sid0.id, e0 = APP.pokemon[id0], known = knownMoves(r, id0), cur = known ? known.filter(Boolean) : [], rec = e0.moveset;
    const second = r.secondMove === false ? false : (r.secondMove === true || (r.moves && r.moves.filter(Boolean).length >= 3)) ? true : null;   // null: never scanned or set
    const tips = [];
    if (cur[0] && cur[0] !== rec[0]) tips.push(`Fast TM to <b>${esc(mvName(rec[0]))}</b>`);
    const missingC = rec.slice(1).filter(m => !cur.slice(1).includes(m));
    if (second && missingC.length) tips.push(`Charged TM to <b>${esc(mvName(missingC[0]))}</b>`);
    rows.push(...moveRows(id0, known, `Planner.setScanMove(${idx},SLOT,this.value)`));
    rows.push(['', `<div class="dim" style="font-size:12px">${r.movesSeen ? '<span class="okc">✓</span> moves read from a screenshot' : known ? 'set by hand' : 'not scanned yet: screenshot the status screen scrolled to the attacks, or pick them. Teams are scored with PvPoke\'s moveset until then.'}</div>`]);
    usage = moveUsage(id0, cur);
    const unlockTxt = `${e0.thirdMove ? `${fmt(e0.thirdMove[0])} dust · ${e0.thirdMove[1]} candy` : ''}${e0.buddy ? ` · or walk ${e0.buddy} km as buddy` : ''}`;
    rows.push(['2nd move', second === true ? `<span class="okc">✓</span> unlocked` : second === false ? `${chip('locked', 'ul')} <span class="dim">${unlockTxt} → set <b>${esc(mvName(missingC[0] || rec[2]))}</b></span>` : `<span class="dim">${r.movesSeen ? 'one charged move read, but the NEW ATTACK button was not in the shot: screenshot the attacks with that button visible, or pick the 2nd move in the third box' : 'not known yet: scan the attacks, or pick it in the third box'}${unlockTxt ? ` · unlocking costs ${unlockTxt}` : ''}</span>`]);
    rows.push(['PvPoke', !known ? `runs ${esc(rec.map(mvName).join(' · '))} <span class="dim">· scan the attacks to compare</span>` : tips.length ? tips.join(' · ') : `<span class="okc">✓</span> runs ${esc(rec.map(mvName).join(' · '))}`]);
  }
  if (best) { const plan = planFor(r, best); const lines = plan ? plan.replace(/^<div class="plan">|<\/div>$/g, '').split('<br>').filter(l => !/2nd charged move/.test(l)) : [];
    if (lines.length) rows.push(['Evolve', `<div class="plan" style="margin:0">${lines.join('<br>')}</div>`]); }
  rows.push(['Source', `${r.appraisal ? '<span class="okc">✓</span> IVs from the appraisal screen' : 'IVs solved from CP, HP and level'}${r.cpInferred ? ' · CP inferred from the appraisal' : ''}`]);
  if (sid0 && sid0.id) {                        // the other form's standing: a shadow ranks differently from its purified/normal twin
    const isSh = /_shadow$/.test(sid0.id), alt = isSh ? sid0.id.replace(/_shadow$/, '') : sid0.id + '_shadow', ea = APP.pokemon[alt], e0 = APP.pokemon[sid0.id];
    if (r.shadow && !isSh) rows.push(['Shadow', `marked as Shadow; PvPoke ranks only the normal ${esc(nm(sid0.id))} in ${esc(LEAGUE.title)}, so that is what the planner uses`]);
    else if (ea && e0) rows.push(['Shadow', isSh ? `shadow copy, meta #${e0.rank} · purified it would be the normal ${esc(nm(alt))}, meta #${ea.rank}` : `normal copy, meta #${e0.rank} · the Shadow form ranks meta #${ea.rank} <span class="dim">(⋮ → Mark as Shadow if this one is)</span>`]);
  }
  if (r.history && r.history.length) rows.push(['History', r.history.slice().reverse().map(h => `${when(h.t)}: ${h.species !== r.species ? esc(nice(h.species)) + ' · ' : ''}${h.cp} CP · L${h.level ?? '?'}`).join('<br>') + `<div class="dim" style="font-size:12px">now ${r.cp} CP · L${r.level ?? '?'}</div>`]);
  h += kv(rows) + usage + (sid0 && sid0.id && APP.pokemon[sid0.id] ? raidUsage(sid0.id, knownMoves(r, sid0.id) || []) : '');
  h += `<div class="note" style="margin:10px 0 0;cursor:pointer" onclick="Planner.toggleGloss()">${UI.gloss ? '▾' : 'ⓘ'} What do IV%, ${LEAGUE.abbr} rank and ${LEAGUE.cp === 2500 ? 'GL' : 'UL'} rank mean?</div>`;
  const g0 = best ? pvpRank(best[4] || DATA.stats[r.species][0], best[1], best[2], best[3], LEAGUE.cp) : null;
  if (UI.gloss) h += `<div class="gloss"><b>IVs</b> Attack / Defence / HP, 0–15 each. <b>IV%</b> their sum out of 45. <b>${LEAGUE.abbr} rank</b> where this spread sits among the 4096 possible spreads of ${esc(nice(r.species))} at the ${LEAGUE.cp} cap (#1 is the perfect ${esc(LEAGUE.title)} copy); the percentage is its stat product relative to #1. <b>${LEAGUE.cp === 2500 ? "GL" : "UL"}</b> the same at ${LEAGUE.cp === 2500 ? 1500 : 2500}. Poké Genie shows the same rank; its "Rank %" is the share of spreads below this one ${g0 ? ` (${(100 - g0.n / 40.96).toFixed(1)}% here)` : ''} and its "Stat Prod" is our percentage. Ranks assume L50 unless the Best Buddy boost is on in Profile.</div>`;
  h += `</div>`;
  if (UI.mon) h += `<div class="sec">${esc(nm(UI.mon))} in the meta</div>`;
  else h += `<div class="note">${esc(nice(r.species))} is not in PvPoke's ${esc(LEAGUE.title)} rankings, so there is no meta page for it.</div>`;
  return h;
}
function editScan(key) {
  const r = results.find(x => x.key === key); if (!r) return;
  $('sheet').innerHTML = `<div class="box"><h2><span>Correct a misread</span><span class="x" onclick="Planner.closeSheet()">✕</span></h2>
    <p class="dim" style="margin:0 0 10px;font-size:13px">Fix what the scanner read and solve the IVs again. The appraisal, if any, stays attached.</p>
    <div class="kv"><span class="k">Species</span><span class="v"><input id="esp" list="species" value="${esc(r.species || '')}" style="width:100%"></span>
    <span class="k">CP</span><span class="v"><input id="ecp" inputmode="numeric" value="${r.cp || ''}" style="width:100%"></span>
    <span class="k">HP</span><span class="v"><input id="ehp" inputmode="numeric" value="${r.hp || ''}" style="width:100%"></span>
    <span class="k">Level</span><span class="v"><input id="elv" inputmode="decimal" placeholder="blank = unknown" value="${r.level || ''}" style="width:100%"></span></div>
    <div class="acts" style="margin-top:14px"><button class="primary" onclick="Planner.resolveScan('${esc(key)}');Planner.closeSheet()">Re-solve</button><button onclick="Planner.closeSheet()">Cancel</button></div></div>`;
  $('sheet').classList.add('open');
}
function resolveScan(key) {
  const r = results.find(x => x.key === key); if (!r) return;
  const newKey = refixScan(r, {species: $('esp').value, cp: $('ecp').value, hp: $('ehp').value, level: $('elv').value});
  UI.scan = newKey; const sid = scanId(r); UI.mon = sid && sid.id && APP.pokemon[sid.id] ? sid.id : null;
  refresh(); renderMon();
}
function deleteScan(key) {
  const i = results.findIndex(x => x.key === key); if (i < 0) return;
  if (!confirm(`Delete this ${nice(results[i].species)} scan?`)) return;
  results.splice(i, 1); save(); render(); refresh(); UI.scan = null; UI.mon = null;
  nav('#/scans');
}
function monInner(m, id, noHead) {
  const {L, own, auto, ri, rep} = m, e = APP.pokemon[id], o = own[id], a = auto[id], st = ownership(m, id), benched = ROSTER.exclude.includes(id);
  const known = o ? (o.manual ? (ROSTER.moves[id] || null) : knownMoves(o.scan, id)) : (ROSTER.moves[id] || ri.pending[id] || null);
  const moves = known || e.moveset;
  const rec = e.moveset, notRec = known ? known.filter(Boolean).filter(mv => !rec.includes(mv)) : [];
  const back = PAGE_LABEL[UI.monFrom] || 'Back';
  const rm = 'Planner.renderMon()';
  const menu = ctxMenu([
    ['Try in builder', `Planner.goBuilder('${id}')`],
    o && o.scan && !noHead ? ['Update your copy…', `Planner.updateScan('${esc(o.scan.key)}')`] : null,
    o && o.scan && !noHead ? ["Open the best copy's scan", `Planner.openScan('${esc(o.scan.key)}')`] : null,
    !st && !benched ? ['Add to wanted', `Planner.want('${id}',true)`] : null,
    !st && !benched ? ['Add as pending (building it)', `Planner.addAs('pending','${id}')`] : null,
    !st && !benched ? ['I own one (no scan)', `Planner.addAs('owned','${id}')`] : null,
    st === 'wanted' ? ['Got it: move to pending', `Planner.addAs('pending','${id}')`] : null,
    st === 'pending' && !a ? ['Built it: move to owned', `Planner.addAs('owned','${id}')`] : null,
    o && !benched && !noHead ? ['Bench (keep out of teams)', `Planner.bench('${id}');${rm}`] : null,
    a && !benched ? ['Not evolving it (bench)', `Planner.bench('${id}');${rm}`] : null,
    benched ? ['Unbench', `Planner.unbench('${id}');${rm}`] : null,
    o && o.manual ? ['Remove from roster', `Planner.dropMon('owned','${id}')`, true] : null,
    ROSTER.pending[id] !== undefined && !o ? ['Remove from pending', `Planner.dropMon('pending','${id}')`, true] : null,
    ROSTER.candidates[id] !== undefined && !o ? ['Remove from wanted', `Planner.dropMon('candidates','${id}')`, true] : null,
  ]);
  let h = noHead ? '' : `<div class="monhead"><button class="back" onclick="Planner.closeMon()">‹ ${back}</button><div class="chips" style="margin:0">${ownChip(st)}${benched ? chip('benched') : ''}${a ? chip('evolves from your ' + a.from, 'gl') : ''}</div></div>`;
  h += `<div class="detail" style="gap:8px"><div class="dh"><span class="nm" style="font-size:20px">${esc(e.name)}</span><span style="display:flex;align-items:center;gap:8px"><span class="dim">meta #${e.rank} · ${e.score}</span>${menu}</span></div>`;
  if (!noHead && o) h += todoList(m, id);
  const weak = weakTo(id);
  h += `<div class="typerow"><span class="chips" style="margin:0">${e.types.map(t => chip(t, 't-' + t)).join('')}</span></div><div class="typerow"><span class="dim">weak to</span><span class="chips" style="margin:0">${weak.length ? weak.map(t => chip(t, 'weak')).join('') : '<span class="dim">nothing</span>'}</span></div>`;
  const teamsIn = rep.todayAll.filter(t => t.members.some(x => x.speciesId === id)).length;
  const pre = (APP.prevo || {})[id], sc = pre && DATA.stats[pre.split('_')[0].toUpperCase()] ? safeCap(pre, id) : null;
  if (!noHead && o && !o.manual && o.scan && o.scan.combos && o.scan.combos.length) h += cpMeter(o.scan, bestOf2(o.scan));   // your best copy: the in-game arc, drag for power-up costs
  if (!noHead && o && !o.manual) {                // three tiles for your best copy
    const c = costTo(o.level, o.toLevel), appraised = o.scan && o.scan.appraisal;
    const status = o.toLevel > o.level ? (o.toLevel > 40 ? [`needs L${o.toLevel}`, 'XL candy needed'] : [`power up to L${o.toLevel}`, `${fmt(c.dust)} dust · ${c.candy} candy`]) : ['ready for GL', `${o.cp} CP at L${o.level}`];
    h += `<div class="kpis"><div><small>IVs</small><b>${o.ivs.join('/')}${appraised ? ' <span class="okc">✓</span>' : ''}</b><span class="sub">${appraised ? 'from the appraisal' : 'solved from CP and HP'}</span></div><div><small>GL rank</small><b>#${o.glRank}</b><span class="sub">${o.glPct.toFixed(1)}% stat product</span></div><div><small>Status</small><b>${status[0]}</b><span class="sub">${status[1]}</span></div></div>`;
  } else if (!noHead && o && o.manual) h += `<div class="note" style="margin:0">Added by hand, no scan: import a screenshot of this Pokémon for its IVs, level and moves.</div>`;
  else if (!noHead && a) h += `<div class="note" style="margin:0">Evolves from your <b>${esc(a.from)}</b>: ${a.cpNow} CP as ${esc(e.name)}, fits to L${a.toLevel}, IV rank #${a.glRank}.</div>`;
  else if (!noHead && !o && sc) h += `<div class="note" style="margin:0">Catch a <b>${esc(nm(pre))}</b> ≤ <b>${sc.safe}</b> CP: it evolves into a GL-legal ${esc(e.name)} (${sc.safe + 1}–${sc.max} CP only with the right IVs).</div>`;
  h += `</div>`;
  if (!noHead) {
    // moves card
    const cur = (known || []).filter(Boolean), secondOpen = !known || cur.length < 3;
    const src = known ? (o ? (o.scan && o.scan.movesSeen ? 'read from your screenshot' : 'set by hand') : 'set for planning') : (o && !o.manual ? 'not scanned yet' : 'not set yet');
    const mrows = moveRows(id, known, null, o && !o.manual ? 'not scanned' : 'not set');
    mrows.push(['PvPoke', !known ? `planning uses <b>${esc(rec.map(mvName).join(' · '))}</b> until the moves are known` : notRec.length ? `recommends <b>${esc(rec.map(mvName).join(' · '))}</b>` : `<span class="okc">✓</span> your moves match PvPoke's set`]);
    const cnt = PVP.counts ? PVP.counts(APP.moves, cur.length ? cur : rec) : null;
    if (cnt && cnt.charged.length) mrows.push(['Counts', `<b>${esc(mvName(cnt.fast))}</b> ${cnt.gain} energy per ${cnt.turns} turn${cnt.turns > 1 ? 's' : ''} → ${cnt.charged.map(c => `<b>${esc(mvName(c.id))}</b> in ${c.first} <span class="dim">(${c.seq}, ${c.turns} turns)</span>`).join(' · ')}`]);
    if (secondOpen && e.thirdMove) mrows.push(['Unlock', `2nd charged move: ${fmt(e.thirdMove[0])} dust · ${e.thirdMove[1]} candy${e.buddy ? ` · or walk ${e.buddy} km as buddy` : ''}`]);
    h += `<div class="sec">Moves <small>${src}</small></div><div class="team card" style="cursor:default">${kv(mrows)}${moveUsage(id, known || [])}${raidUsage(id, known || [])}</div>`;
    // roster card
    const rrows = [
      ['Status', `${st ? ownChip(st) : benched ? chip('benched') : '<span class="dim">not in your roster</span>'}${benched && st ? ' ' + chip('benched') : ''}${o && o.manual ? ' <span class="dim">added by hand</span>' : ''}`],
      ['In teams', `${teamsIn} of ${rep.todayAll.length} buildable from your roster`],
    ];
    rrows.push(['Search', `<span class="srchi"><code>${esc(searchFor(id))}</code><button onclick="Planner.copyText(${attr(searchFor(id))},this)">Copy</button></span><div class="dim" style="font-size:12px">Pokémon GO storage search: the evolution family under ${LEAGUE.cp} CP; the catch string for a pre-evolution is under How to get</div>`]);
    h += `<div class="sec">In your roster</div><div class="team card" style="cursor:default">${kv(rrows)}</div>`;
  }
  // roster fit
  const fit = rosterFit(m, id), best = rep.today[0];
  h += `<div class="sec">With your roster <small>${fit.owned ? `in ${fit.inTeams} of ${fit.of} buildable teams` : 'if you add it'}</small></div>`;
  if (!fit.owned && fit.delta !== null) h += `<div class="team" style="cursor:default"><span class="sc ${fit.delta > 0 ? '' : 'dim'}">${fit.delta > 0 ? '+' + fit.delta : fit.delta}</span><span class="nm">${fit.delta > 0 ? `Lifts your best team from ${best.teamScore.toFixed(0)} to ${fit.top.teamScore.toFixed(0)}` : `Best team with it scores ${fit.top.teamScore.toFixed(0)}, your current best is ${best.teamScore.toFixed(0)}`}</span><div class="dt">${fit.answers.length ? `Answers ${esc(fit.answers.map(nm).join(', '))}, which your best team ${best.unansweredMeta.length ? 'lacks' : 'struggles with'}.` : 'Does not fix a weak spot of your current best team.'}</div></div>`;
  else if (!fit.owned) h += `<div class="note">Own at least two other Pokémon under the cap to see teams with it.</div>`;
  if (fit.owned && fit.answers.length) { const inBest = best && best.members.some(x => x.speciesId === id);
    h += `<div class="note">${inBest ? `In your best team it is the one answer to ${esc(fit.answers.map(nm).join(', '))}: keep it for those.` : `Answers ${esc(fit.answers.map(nm).join(', '))}, which your best team struggles with.`}</div>`; }
  if (fit.teams.length) h += fit.teams.map(t => teamRow(m, t.members.map(x => x.speciesId), null)).join('');
  else if (fit.owned) h += `<div class="note">Not in any of the top ${fit.of} teams from what you own.</div>`;
  if (fit.owned && fit.partners.length) h += `<div class="note">Best partners: ${fit.partners.map(p => `<a href="#" onclick="Planner.openMon('${p}');return false">${esc(nm(p))}</a>`).join(', ')}</div>`;
  h += metaFit(m, id);
  // matchups against the meta
  const rated = L.meta.filter(x => x !== id).map(x => ({o: x, r: L.rating(id, x)}));
  const wins = rated.filter(x => x.r >= 500).sort((p, q) => q.r - p.r), losses = rated.filter(x => x.r < 400).sort((p, q) => APP.pokemon[p.o].rank - APP.pokemon[q.o].rank);
  const mchip = x => `<span class="chip ${x.r >= 500 ? 'meta1' : 'warn'}" style="cursor:pointer" onclick="Planner.openMon('${x.o}')">${esc(nm(x.o))} <span style="opacity:.7">#${APP.pokemon[x.o].rank}</span></span>`;
  h += `<div class="sec">Against the meta <small>${wins.length} wins · ${rated.length - wins.length - losses.length} even · ${losses.length} losses of ${rated.length}</small></div>`;
  h += `<div class="team" style="cursor:default"><div class="nm" style="font-size:13px">Loses to <span class="dim">most dangerous first</span></div><div class="chips">${losses.slice(0, 10).map(mchip).join('') || '<span class="dim">nothing in the meta beats it clearly</span>'}</div>
    <div class="nm" style="font-size:13px;margin-top:10px">Beats</div><div class="chips">${wins.slice(0, 10).map(mchip).join('') || '<span class="dim">no clear wins</span>'}</div>
    <div class="note" style="margin:8px 0 0">Ratings: PvPoke's published matchups where available, type effectiveness and rank otherwise. Tap a name for its page.</div></div>`;
  if (!o) h += howToGet(m, id);                // how to get it: catch, evolve (with candy and safe CP), Team GO Rocket for shadows
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
  const lbl = {ready: 'ready', power: 'powering up', moves: 'need moves', manual: 'not scanned', pending: 'pending', wanted: 'wanted', xl: 'XL gated', bench: 'benched'};
  const clsOf = {ready: 'ok', power: 'gold', moves: 'gold', manual: '', pending: 'gl', wanted: '', xl: 'warn', bench: ''};
  let h = `<div class="chips" style="margin:0 0 10px">${Object.entries(counts).map(([k, v]) => chip(`${v} ${lbl[k]}`, clsOf[k])).join('')}</div>`;
  const live = results.filter(r => !r.superseded).length;
  h += `<div class="team row" onclick="Planner.nav('#/scans')"><span class="tx"><span class="nm">Scans &amp; import</span><div class="dt">${live ? `${live} scanned Pokémon · add screenshots or a recording` : 'no scans yet · import status screenshots to fill this roster'}</div></span>${ctxMenu([['Export roster JSON', 'Planner.exportRoster()'], ['Load saved roster', 'Planner.loadRepoRoster()'], ['Clear all scans…', 'clearAll()', true]])}</div>`;
  h += `<div class="add" style="margin:0 0 10px"><input id="rosterq" placeholder="Search your roster" value="${esc(UI.rosterQ || '')}" oninput="Planner.rosterSearch(this.value)"></div>`;
  const q = (UI.rosterQ || '').trim().toLowerCase();
  const shown = q ? ts.filter(t => nm(t.id).toLowerCase().includes(q) || t.id.includes(q) || t.st.includes(q) || (APP.pokemon[t.id].types || []).some(x => x.includes(q))) : ts;
  if (q && !shown.length) h += `<div class="note">Nothing in your roster matches “${esc(q)}”. Search by name, type or status (ready, power, pending, wanted).</div>`;
  h += `<div class="tiles">${shown.map(t => `<div class="tile ${t.st}" onclick="Planner.openMon('${t.id}')"><b>${esc(nm(t.id))}</b>${t.iv ? `<span class="ivl">${t.iv}</span>` : ''}<small>${esc(t.sub)}</small>${t.bar !== null && t.bar !== undefined ? `<div class="pb"><div style="width:${Math.round(t.bar * 100)}%"></div></div>` : ''}<span class="st">${esc(t.txt)}</span></div>`).join('')}
    <div class="tile add" onclick="Planner.toggleAdd()"><b>+</b><span class="st">add</span></div></div>`;
  h += `<div class="add" id="addrow" style="${UI.adding ? '' : 'display:none'}"><input id="addid" list="species" placeholder="species id, e.g. lickilicky"><select id="addkind"><option value="owned">owned</option><option value="pending">pending</option><option value="candidates">wanted</option></select><button onclick="Planner.add()">Add</button></div>`;
  h += `<div class="note">Your in-game parties and the teams you can build are under <a href="#" onclick="Planner.nav('#/teams');return false">Saved teams</a>.</div>`;
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
  return new PVP.League(APP, ov, mxFor());
}
function needLine(m, ids) {
  const parts = ids.map(id => { const st = ownership(m, id);
    if (st === 'owned') return null;
    if (st === 'pending') return `${nm(id)} is pending`;
    const pre = (APP.prevo || {})[id], sc = pre && DATA.stats[pre.split('_')[0].toUpperCase()] ? safeCap(pre, id) : null;
    return sc ? `catch a ${nm(pre)} ≤ ${sc.safe} CP for ${nm(id)}` : `find a ${nm(id)}`; }).filter(Boolean);
  return parts.length ? `You still need: ${parts.join(' · ')}.` : 'You own all three.';
}
const META_PAGES = {build: 'builder', teams: 'meta', rank: 'rank', raids: 'raids'};
function renderMeta(k) {                        // the four pages that used to be Meta sub-tabs; no argument = whichever of them is visible
  const key = k || Object.keys(META_PAGES).find(x => META_PAGES[x] === onView()); if (!key) return;
  const el = $(META_PAGES[key]); if (!el) return;
  try { renderMetaInner(el, key); } catch (e) { el.innerHTML = errorCard(PAGE_LABEL[META_PAGES[key]], e); }
}
function renderMetaInner(el, key) {
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading PvPoke data…</div>'; return; }
  const m = M();
  el.innerHTML = key === 'build' ? renderBuilder(m, builderLeague(m)) : key === 'teams' ? renderMetaTeams(m) : key === 'raids' ? renderRaids(m) : renderRankings(m);
}
function renderBuilder(m, L) {
  const slots = UI.build.slots, filled = slots.filter(Boolean);
  let h = `<div class="note">Pick any three Pokémon: from the rankings, a meta team, or your roster. Scored with the same heuristic as Today.</div>`;
  h += `<div class="roles">` + slots.map((id, i) => id ? `<div class="role slot"><span class="rl">Slot ${i + 1}</span><span class="rn" onclick="Planner.openMon('${id}')" style="cursor:pointer">${esc(nm(id))}</span><span class="rm">#${APP.pokemon[id].rank}${ownership(m, id) ? ' · ' + ownership(m, id) : ''}</span><span class="x" onclick="Planner.setSlot(${i},null)">✕</span></div>`
    : `<div class="role slot empty" onclick="Planner.metaPanel('rank')"><span class="rl">Slot ${i + 1}</span><span class="rn dim">+</span><span class="rm">pick from rankings</span></div>`).join('') + `</div>`;
  h += `<div class="add" style="margin-top:8px"><input id="slotid" list="species" placeholder="or type a species id"><button onclick="Planner.addSlotFromInput()">Add</button>${filled.length ? `<button onclick="Planner.clearSlots()" style="background:var(--card);color:var(--dim);border:1px solid var(--line)">Clear</button>` : ''}</div>`;
  if (filled.length) {                         // one tap: the coach completes or judges what is in the slots
    const can = window.Sync && Sync.available() && Sync.signedIn() && Sync.coachAvailable();
    h += can ? `<button class="btn ai" onclick="Planner.askBuilderCoach()" ${BCOACH.busy ? 'disabled' : ''}>${BCOACH.busy ? `✦ Thinking… ${BCOACH.secs ? BCOACH.secs + 's' : ''}` : `✦ Generate AI suggestion <span class="sub">${filled.length === 3 ? 'judge this team' : `complete it from ${3 - filled.length === 1 ? 'the open slot' : 'the open slots'}`}</span>`}</button>`
             : `<button class="btn sec" disabled style="margin:10px 0 0">✦ Generate AI suggestion <span class="sub">${window.Sync && Sync.available() && Sync.signedIn() ? 'the server has no coach key' : 'connect sync (cloud button) to use the coach'}</span></button>`;
  }
  // per-slot move choice
  if (filled.length) h += filled.map(id => `<div class="own"><div class="h"><b>${esc(nm(id))}</b><span>${L.movesOf(id).map(mvName).map(esc).join(' · ')}</span></div>${movesRow(id, L.movesOf(id), `Planner.setBuildMove('${id}',SLOT,this.value)`)}</div>`).join('');
  if (filled.length === 3) {
    const ev = L.evaluate(filled), d = L.describe(filled, ev), bm = APP.benchmark || {best: 721, median: 521};
    const pctBar = Math.max(4, Math.min(100, (ev.score - 300) / (bm.best - 300) * 100)), medPos = (bm.median - 300) / (bm.best - 300) * 100;
    const rl = roles(L, filled);
    const missing = filled.filter(id => !ownership(m, id));
    const bmenu = ctxMenu([['Coverage grid', `Planner.coverageWith(${attr(filled)})`], ['Save as in-game party…', `Planner.saveBuildAsTeam()`], missing.length ? [`Add ${missing.length} missing to wanted`, `Planner.wantMissing()`] : null, ['Copy Pokémon GO search', `Planner.copyText(${attr(teamSearch(filled))})`], ['Clear slots', `Planner.clearSlots()`, true]]);
    h += `<div class="hero" onclick="Planner.coverageWith(${attr(filled)})">
      <div class="sec" style="margin:0 0 8px;display:flex;justify-content:space-between;align-items:center"><span>This team <small>tap for coverage</small></span>${bmenu}</div>
      <div class="scorebar" style="margin-top:0"><span class="big">${ev.score.toFixed(0)}</span><div class="track"><div class="fill" style="width:${pctBar}%"></div><div class="tick" style="left:${medPos}%"></div></div><span class="dim">meta best ${bm.best.toFixed(0)}</span></div>
      <div class="dim" style="font-size:12px;margin-top:8px">${rl.map(r => `${r.role}: <b style="color:var(--ink)">${esc(nm(r.id))}</b>`).join(' · ')}</div>
      <div class="dim" style="font-size:12px;margin-top:6px">${d.unansweredMeta.length ? `No answer to ${chip(d.unansweredMeta.join(', '), 'warn')}. ` : 'Covers every meta Pokémon. '}${d.sharedWeaknesses.length ? `Two lose to ${esc(d.sharedWeaknesses.join(', '))}.` : ''}</div>
      ${L.mx ? `<div class="dim" style="font-size:12px;margin-top:6px">${(() => { const tl = L.threatList(filled, 6); return `<b style="color:var(--ink)">${tl.count} of ${tl.pool}</b> simulated opponents beat all three${tl.count ? ': ' + esc(tl.threats.map(t => nm(t.id)).join(', ')) + (tl.count > 6 ? '…' : '') : ''}`; })()}</div>` : ''}
      <div style="font-size:13px;margin-top:8px">${esc(needLine(m, filled))}</div></div>`;
    h += reviewCard(filled, true);
    h += builderCoachCard(m, L, filled);
  } else {
    const ev = filled.length ? L.evaluate(filled) : null;
    const distinct = p => !filled.includes(p) && new Set(filled.concat(p).map(PVP.baseSpecies)).size === filled.length + 1;
    // your roster, one tap to add
    const mine = Object.keys(m.ri.owned).concat(Object.keys(m.ri.pending)).filter(distinct).sort((a, b) => APP.pokemon[a].rank - APP.pokemon[b].rank);
    h += `<div class="sec">From your roster <small>tap to add</small></div>`;
    h += mine.length ? `<div class="tchips">${mine.map(p => `<span class="chip ${m.ri.owned[p] ? 'ok' : 'gl'}" onclick="Planner.fillSlot('${p}')">${esc(nm(p))}</span>`).join('')}</div>` : `<div class="note">Nothing left in your roster to add.</div>`;
    if (filled.length) {
      // weak spots of what is in the slots so far
      const holes = ev.holes.slice().sort((a, b) => APP.pokemon[a].rank - APP.pokemon[b].rank);
      h += `<div class="sec">Weak spots so far <small>${holes.length ? `${holes.length} of ${L.meta.length} meta Pokémon unanswered` : 'every meta Pokémon is answered'}</small></div>`;
      if (holes.length) h += `<div class="team" style="cursor:default"><div class="chips">${holes.slice(0, 12).map(o => `<span class="chip warn" onclick="Planner.openMon('${o}')" style="cursor:pointer">${esc(nm(o))} <span style="opacity:.7">#${APP.pokemon[o].rank}</span></span>`).join('')}${holes.length > 12 ? `<span class="chip">+${holes.length - 12} more</span>` : ''}</div></div>`;
      // suggestions: what to add next, from your roster or from the meta
      const pool = UI.buildPool === 'meta' ? APP.meta.slice(0, 60).filter(distinct) : mine;
      const sug = pool.map(p => { const e2 = L.evaluate(filled.concat(p)); const fixes = ev.holes.filter(o => !e2.holes.includes(o)); return {p, score: e2.score, fixes, left: e2.holes.length}; })
        .sort((a, b) => b.score - a.score).slice(0, 6);
      h += `<div class="sec" style="display:flex;justify-content:space-between;align-items:center"><span>Add next <small>${filled.length === 2 ? 'completes the team' : 'best partner'}</small></span><span class="tabs sub seg"><button class="${UI.buildPool !== 'meta' ? 'on' : ''}" onclick="Planner.buildPool('roster')">Your roster</button><button class="${UI.buildPool === 'meta' ? 'on' : ''}" onclick="Planner.buildPool('meta')">Meta</button></span></div>`;
      if (!sug.length) h += `<div class="note">${UI.buildPool === 'meta' ? 'No meta Pokémon left to add.' : 'Nothing in your roster fits; switch to Meta to see what to catch.'}</div>`;
      else h += sug.map(x => `<div class="team row" onclick="Planner.fillSlot('${x.p}')"><span class="sc">${x.score.toFixed(0)}</span><span class="tx"><span class="nm">${esc(nm(x.p))} <span class="dim">#${APP.pokemon[x.p].rank}</span> ${ownChip(ownership(m, x.p))}</span><div class="dt">${x.fixes.length ? `answers <span class="good">${esc(few(x.fixes.map(nm)))}</span>` : 'answers nothing new'}${x.left ? ` · ${x.left} still unanswered` : ' · covers the whole meta'}</div></span><span class="go">+</span></div>`).join('');
      h += `<div class="note">Score = the team so far plus this Pokémon, on the same scale as Today. "Answers" lists the meta Pokémon that would no longer go unanswered.</div>`;
      h += builderCoachCard(m, L, filled);
    }
  }
  return h;
}
function renderMetaTeams(m) {
  const teams = APP.metaTeams || [];
  if (!teams.length) return '<div class="note">No derived meta teams in the data file yet.</div>';
  return `<div class="note">The ${teams.length} best trios from the top 40 of PvPoke's meta group, scored with the same heuristic. Tap one for its page: roles, weak spots, what you still need, Pokémon GO search strings, and Try in builder / Coverage in its ⋮ menu.</div>` +
    teams.map((t, i) => teamRow(m, t.members, null, `meta #${i + 1}`)).join('');
}
function renderRankings(m) {
  const q = UI.rankQ.toLowerCase(), ty = UI.rankType;
  const all = Object.entries(APP.pokemon).sort((a, b) => a[1].rank - b[1].rank)
    .filter(([id, e]) => (!q || e.name.toLowerCase().includes(q) || id.includes(q)) && (!ty || e.types.includes(ty)));
  const shown = all.slice(0, UI.rankLimit);
  let h = `<div class="add"><input id="rankq" placeholder="Search ${Object.keys(APP.pokemon).length} ranked Pokémon" value="${esc(UI.rankQ)}" oninput="Planner.rankSearch(this.value)"><select onchange="Planner.rankType(this.value)"><option value="">any type</option>${TYPES18.map(t => `<option value="${t}" ${ty === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  h += `<div class="note">PvPoke ${esc(APP.league.title)} overall rankings · gamemaster ${esc(APP.gamemasterTimestamp.slice(0, 10))} · ${all.length} match${all.length === 1 ? '' : 'es'}</div>`;
  h += shown.map(([id, e]) => `<div class="rank"><span class="rk">#${e.rank}</span><div class="rb" onclick="Planner.openMon('${id}')" style="cursor:pointer"><div class="rn"><b>${esc(e.name)}</b> <span class="dim">${e.score}</span> ${ownChip(ownership(m, id))}</div><div class="dt">${e.types.join(' / ')} · ${e.moveset.map(mvName).map(esc).join(' · ')}</div></div>
    <div class="ra">${ctxMenu([['Add to builder', `Planner.fillSlot('${id}')`], ownership(m, id) ? null : ['Add to wanted', `Planner.want('${id}')`], ['Copy Pokémon GO search', `Planner.copyText(${attr(searchFor(id))})`]])}</div></div>`).join('');
  if (all.length > shown.length) h += `<div class="note" style="cursor:pointer" onclick="Planner.rankMore()">▸ show ${Math.min(100, all.length - shown.length)} more</div>`;
  return h;
}
function metaPanel(k) { nav('#/' + (META_PAGES[k] || 'builder')); }
function buildPool(k) { UI.buildPool = k; renderMeta(); }
function goBuilder(idOrIds) {                  // from a Pokémon or team page: load the builder
  if (Array.isArray(idOrIds)) { UI.build.slots = idOrIds.slice(0, 3); saveBuild(); } else { let i = UI.build.slots.indexOf(null); if (!UI.build.slots.includes(idOrIds)) { if (i < 0) i = 2; UI.build.slots[i] = idOrIds; saveBuild(); } }
  nav('#/builder');
}

/* ---------- Raids: best PvE attackers per type, from data/pve.json (built weekly from the game master) ---------- */
let PVE = null, pveLoading = null, pveError = '';
function loadPve() {
  if (PVE || pveLoading) return;
  pveLoading = fetch('data/pve.json?v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''), {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(d => { PVE = d; }).catch(e => { pveError = e.message || String(e); }).finally(() => { pveLoading = null; renderMeta(); if (UI.mon || UI.scan) renderMon(); });
}
/* raid moveset rating: neutral cycle DPS of every fast + charged pair at L40, as a share of the best pair (Poké Genie's "Moveset Rating") */
const CPM40 = 0.7903, RAID_BOSS_DEF = (200 + 15) * CPM40;
function gmMove(m) {
  if (!PVE || !PVE.pvemoves) return null;
  const x = PVE.pvemoves[m] || PVE.pvemoves[m + '_FAST'];
  if (x) return x;
  if (m.startsWith('HIDDEN_POWER') && PVE.pvemoves.HIDDEN_POWER_FAST) return Object.assign({}, PVE.pvemoves.HIDDEN_POWER_FAST, {t: (APP.moves[m] || {}).t});
  return null;
}
function raidCombos(id) {
  const e = APP.pokemon[id], b = evoBaseStats(id); if (!e || !b || !PVE) return [];
  const atk = (b[0] + 15) * CPM40, dmg = (p, stab) => Math.floor(0.5 * p * atk / RAID_BOSS_DEF * (stab ? 1.2 : 1)) + 1;
  const out = [];
  for (const f of e.fast) { const fm = gmMove(f); if (!fm || fm.e <= 0) continue;
    for (const c of e.charged) { const cm = gmMove(c); if (!cm || cm.e >= 0) continue;
      const n = -cm.e / fm.e, dps = (dmg(fm.p, e.types.includes(fm.t)) * n + dmg(cm.p, e.types.includes(cm.t))) / (fm.d * n + cm.d);
      out.push({f, c, dps}); } }
  out.sort((a, b) => b.dps - a.dps);
  const top = out.length ? out[0].dps : 1;
  return out.map(x => Object.assign(x, {pct: Math.round(100 * x.dps / top)}));
}
const raidGrade = p => p >= 90 ? 'A' : p >= 75 ? 'B' : p >= 60 ? 'C' : 'D';
function raidUsage(id, cur) {                  // collapsible table under the PvP usage box
  if (!PVE) { loadPve(); return ''; }
  const rows = raidCombos(id); if (!rows.length) return '';
  cur = (cur || []).filter(Boolean);
  const mine = x => x.f === cur[0] && cur.slice(1).includes(x.c);
  const yours = rows.filter(mine), best = yours.length ? yours.reduce((a, b) => b.pct > a.pct ? b : a) : null;
  const head = best ? `${best.pct}% · grade ${raidGrade(best.pct)}` : cur.length ? 'your set is not rated' : '';
  return `<div class="note" style="margin:6px 0 0;cursor:pointer" onclick="Planner.toggleRaidUse()">${UI.raidUse ? '▾' : '▸'} Raid moves by damage${head ? ` <span class="dim">· yours ${esc(head)}</span>` : ''}</div>` +
    (UI.raidUse ? `<div class="use raid">${rows.slice(0, 10).map((x, i) => `<div class="ur ${mine(x) ? 'mine' : ''}"><span class="n">${i + 1}</span><span class="nm"><span class="f">${mine(x) ? '<em class="y">✓</em> ' : ''}${esc(mvName(x.f))}</span><span class="c">+ ${esc(mvName(x.c))}</span></span><span class="bar"><i style="width:${x.pct}%"></i></span><span class="pc">${x.pct}% <em class="s">${raidGrade(x.pct)}</em></span></div>`).join('')}<div class="dim" style="font-size:11.5px;margin-top:8px">Neutral damage per second against a raid boss at L40, best pair = 100%, like Poké Genie's Moveset Rating. Which type you need depends on the boss: see Meta › Raids.</div></div>` : '');
}
function toggleRaidUse() { UI.raidUse = !UI.raidUse; renderMon(); }
function pveOwned(e) {                          // your scanned copies of this species (any CP): a mega or shadow counts through its base species
  const mine = results.filter(r => r.species === e.species && !r.superseded && r.cp);
  if (!mine.length) return null;
  return mine.reduce((a, b) => b.cp > a.cp ? b : a);
}
function pveSearch(e) {
  const base = e.name.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
  return ['+' + base].concat(formFilters(e.id)).join('&');
}
/* ---------- a specific boss: who in YOUR storage does best against it (your level, IVs and scanned moves) ---------- */
const RAID_BOSS_ATK = (250 + 15) * CPM40, RAID_BOSS_DMG = 100, RAID_BOSS_DUR = 2.5;
function bossInfo(key) {                        // key: PvPoke id, or "raid:<name>" from the live raid list
  if (!key) return null;
  if (key.startsWith('raid:')) { const r = (window.Sources && Sources.raids ? Sources.raids() : []).find(x => 'raid:' + x.name === key); if (!r) return null;
    const id = Object.keys(APP.pokemon).find(k => nm(k).toLowerCase() === r.name.toLowerCase()) || null; return {key, id, name: r.name, types: r.types, tier: r.tier}; }
  const e = APP.pokemon[key] || APP.unranked[key]; if (!e) return null;
  return {key, id: APP.pokemon[key] ? key : null, name: e.name, types: e.types || []};
}
function bossWeak(types) { return TYPES18.map(t => ({t, e: PVP.eff(t, types)})).filter(x => x.e > 1).sort((a, b) => b.e - a.e); }
function myRaidAttackers(bossTypes, limit) {
  const out = [];
  for (const r of results) {
    if (r.superseded || !r.cp || !r.combos || !r.combos.length || !DATA.stats[r.species]) continue;
    const sid = scanId(r), e = sid && sid.id ? APP.pokemon[sid.id] : null; if (!e) continue;
    const best = sid.best, b = sid.base, cpm = cpmAt(best[0]);
    const atk = (b[0] + best[1]) * cpm, def = (b[1] + best[2]) * cpm, hp = calcHP(b, best[3], cpm);
    const incoming = (0.5 * RAID_BOSS_DMG * RAID_BOSS_ATK / def + 1) / RAID_BOSS_DUR;
    const known = (r.moves || []).filter(Boolean), fasts = known[0] ? [known[0]] : e.fast, chargeds = known.length > 1 ? known.slice(1) : e.charged;
    const dmg = (p, t) => Math.floor(0.5 * p * atk / RAID_BOSS_DEF * (e.types.includes(t) ? 1.2 : 1) * PVP.eff(t, bossTypes)) + 1;
    let top = null;
    for (const f of fasts) { const fm = gmMove(f); if (!fm || fm.e <= 0) continue;
      for (const c of chargeds) { const cm = gmMove(c); if (!cm || cm.e >= 0) continue;
        const n = -cm.e / fm.e, dps = (dmg(fm.p, fm.t) * n + dmg(cm.p, cm.t)) / (fm.d * n + cm.d), tdo = hp / incoming * dps, er = dps ** 3 * tdo;
        if (!top || er > top.er) top = {f, c, dps, tdo, er}; } }
    if (top) out.push(Object.assign({key: r.key, id: sid.id, species: r.species, level: best[0], cp: r.cp, movesKnown: known.length > 1, shadow: !!r.shadow}, top));
  }
  out.sort((a, b) => b.er - a.er);
  return out.slice(0, limit || 8);
}
function pickBoss(key) { UI.boss = key || null; UI.bossQ = ''; renderMeta('raids'); }
function bossSearch(v) { UI.bossQ = v; const pos = $('bossq') && $('bossq').selectionStart; renderMeta('raids'); const q = $('bossq'); if (q) { q.focus(); if (pos != null) q.setSelectionRange(pos, pos); } }
function bossSection(m) {
  const live = window.Sources && Sources.raids ? Sources.raids() : [], boss = bossInfo(UI.boss);
  let h = `<div class="sec">Pick a boss <small>your storage against it</small></div>`;
  const q = (UI.bossQ || '').toLowerCase();
  h += `<div class="add" style="margin:4px 0 6px"><input id="bossq" placeholder="search any Pokémon…" value="${esc(UI.bossQ || '')}" oninput="Planner.bossSearch(this.value)">${boss ? `<button onclick="Planner.pickBoss(null)" style="background:var(--card);color:var(--dim);border:1px solid var(--line)">Clear</button>` : ''}</div>`;
  if (q) { const hits = Object.keys(APP.pokemon).concat(Object.keys(APP.unranked)).filter(k => nm(k).toLowerCase().includes(q)).slice(0, 8);
    h += hits.length ? `<div class="tchips">${hits.map(k => `<span class="chip" onclick="Planner.pickBoss('${k}')">${esc(nm(k))}</span>`).join('')}</div>` : `<div class="note">No Pokémon named like that in this league's data.</div>`; }
  else if (live.length) h += `<div class="tchips">${live.filter(r => /5-Star|Mega|3-Star/.test(r.tier)).slice(0, 12).map(r => `<span class="chip ${UI.boss === 'raid:' + r.name ? 'ok' : ''}" onclick="Planner.pickBoss(${attr('raid:' + r.name)})" title="${esc(r.tier)}">${esc(r.name)} <span style="opacity:.7">${esc(r.tier.replace(' Raids', '').replace('-Star', '★'))}</span></span>`).join('')}</div>`;
  else h += `<div class="note">Type a boss name. The current raid bosses appear here when the schedule has loaded.</div>`;
  if (!boss) return h;
  const weak = bossWeak(boss.types), mine = myRaidAttackers(boss.types, 8), maxEr = mine.length ? mine[0].er : 1;
  h += `<div class="team card" style="cursor:default"><div class="sec" style="margin:0 0 6px;display:flex;justify-content:space-between;align-items:center"><span>${esc(boss.name)} <small>${boss.tier ? esc(boss.tier) + ' · ' : ''}${boss.types.map(t => esc(t)).join(' / ') || 'types unknown'}</small></span>${boss.id ? ctxMenu([['Open page', `Planner.openMon('${boss.id}')`]]) : ''}</div>
    <div class="dt" style="margin-bottom:6px">Weak to</div><div class="chips">${weak.length ? weak.map(w => `<span class="chip t-${w.t}">${w.t}${w.e > 2 ? ' ×2.56' : ''}</span>`).join('') : '<span class="dim">nothing known</span>'}</div></div>`;
  h += `<div class="sec">Your best attackers <small>${mine.length ? 'from your scans, at their own level and IVs' : 'none of your scans can be rated'}</small></div>`;
  if (!mine.length) h += `<div class="note">Scan the Pokémon you would bring: the attackers list below shows what to aim for.</div>`;
  else h += mine.map((x, i) => `<div class="rank pve" onclick="Planner.openScan(${attr(x.key)})" style="cursor:pointer"><span class="rk">#${i + 1}</span><div class="rb"><div class="rn"><b>${esc(nm(x.id))}</b> <span class="dim">L${x.level} · ${x.cp} CP</span>${x.movesKnown ? '' : ' <span class="chip">best possible moves</span>'}</div><div class="dt">${esc(mvName(x.f))} · ${esc(mvName(x.c))}</div>
      <div class="pvb"><span class="lb">DPS</span><span class="bar"><i style="width:${Math.round(x.dps / mine[0].dps * 100)}%"></i></span><span class="v">${x.dps.toFixed(1)}</span><span class="lb">TDO</span><span class="bar"><i class="t" style="width:${Math.round(x.tdo / Math.max(...mine.map(y => y.tdo)) * 100)}%"></i></span><span class="v">${Math.round(x.tdo)}</span></div></div></div>`).join('');
  const bestGlobal = weak.length ? [].concat(...weak.map(w => (PVE.types[w.t] || []).slice(0, 8).map(r => Object.assign({}, r, {vs: w.t})))).sort((a, b) => b.er - a.er).filter((r, i, a) => a.findIndex(x => x.id === r.id) === i).slice(0, 6) : [];
  if (bestGlobal.length) h += `<div class="sec">Best in the game against it <small>same model, level 40</small></div><div class="team" style="cursor:default"><div class="chips">${bestGlobal.map(r => `<span class="chip ${pveOwned(r) ? 'ok' : ''}">${esc(r.name)} <span style="opacity:.7">${r.dps.toFixed(0)} dps</span></span>`).join('')}</div><div class="dt" style="margin-top:6px">Green = you own the species. Your own list above uses your copies' real level, IVs and (when scanned) moves; the boss is the tier-5 stand-in of the model.</div></div>`;
  return h;
}
function renderRaids(m) {
  if (!PVE) { loadPve(); return `<div class="note">${pveError ? 'Raid data not available: ' + esc(pveError) : 'Loading the raid attacker rankings…'}</div>`; }
  const type = UI.pveType || 'overall', basic = !!UI.pveBasic;
  const rows0 = type === 'overall' ? PVE.overall : (PVE.types[type] || []);
  const rows = (basic ? rows0.filter(r => !r.mega && !r.shadow) : rows0).slice(0, 20);
  const mv = id => (PVE.moves[id] || {n: id}).n;
  let h = `<div class="note">Best raid attackers when the boss is weak to the type, computed from the game master (${esc(PVE.generated || '')}). <b>DPS</b> damage per second, <b>TDO</b> total damage before fainting, both at level 40 against a typical tier-5 boss. Ranked by DPS³ × TDO, the usual raid metric.</div>`;
  h += bossSection(m);
  h += `<div class="sec">Best attackers by type</div>`;
  h += `<div class="tchips">${['overall'].concat(TYPES18).map(t => `<span class="chip ${t === type ? 'sel' : ''} ${t !== 'overall' ? 't-' + t : ''}" onclick="Planner.pveType('${t}')">${t === 'overall' ? 'Top' : t}</span>`).join('')}</div>`;
  h += `<div class="note" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span>${type === 'overall' ? 'Top attackers across all types (Normal left out: nothing is weak to it)' : `Best <b>${esc(type)}</b> attackers`}</span><label class="tog"><input type="checkbox" ${basic ? 'checked' : ''} onchange="Planner.pveBasic(this.checked)"> no megas / shadows</label></div>`;
  if (!rows.length) return h + `<div class="note">No entries.</div>`;
  const maxDps = Math.max(...rows.map(r => r.dps)), maxTdo = Math.max(...rows.map(r => r.tdo));
  h += rows.map((r, i) => {
    const own = pveOwned(r), page = APP.pokemon[r.id] ? r.id : APP.pokemon[r.species.toLowerCase()] ? r.species.toLowerCase() : null;
    const menu = ctxMenu([page ? ['Open page', `Planner.openMon('${page}')`] : null, ['Copy Pokémon GO search', `Planner.copyText(${attr(pveSearch(r))})`], own ? ['Open your scan', `Planner.openScan(${attr(own.key)})`] : null]);
    const legacy = new Set(r.legacy || []);
    const moveTxt = [r.fast, r.charged].map(id => `${esc(mv(id))}${legacy.has(id) ? ' <span class="dim">(Elite TM)</span>' : ''}`).join(' · ') + (r.offType ? ' <span class="dim">· off-type fast move</span>' : '');
    return `<div class="rank pve"><span class="rk">#${i + 1}</span><div class="rb"><div class="rn"><b>${esc(r.name)}</b>${type === 'overall' && r.type ? ` <span class="dim">${esc(r.type)}</span>` : ''} ${own ? chip('yours · ' + own.cp + ' CP', 'ok') : ''}</div><div class="dt">${moveTxt}</div>
      <div class="pvb"><span class="lb">DPS</span><span class="bar"><i style="width:${Math.round(r.dps / maxDps * 100)}%"></i></span><span class="v">${r.dps.toFixed(1)}</span><span class="lb">TDO</span><span class="bar"><i class="t" style="width:${Math.round(r.tdo / maxTdo * 100)}%"></i></span><span class="v">${r.tdo}</span></div></div><div class="ra">${menu}</div></div>`;
  }).join('');
  h += `<div class="note">Model: ${esc(PVE.model ? PVE.model.attacker : '')}; boss ${esc(PVE.model ? PVE.model.boss : '')}. No dodging, weather or friendship. Megas need Mega Energy and last 8 hours; "yours" matches your scans by species, so a normal copy also lights up a Shadow or Mega row. Data: PokeMiners game master, rebuilt weekly.</div>`;
  return h;
}
function pveType(t) { UI.pveType = t; renderMeta(); }
function pveBasic(v) { UI.pveBasic = !!v; renderMeta(); }
function rosterSearch(v) { UI.rosterQ = v; const pos = $('rosterq') && $('rosterq').selectionStart; renderRoster(); const q = $('rosterq'); if (q) { q.focus(); if (pos != null) q.setSelectionRange(pos, pos); } }
function rankSearch(v) { UI.rankQ = v; UI.rankLimit = 50; const pos = $('rankq') && $('rankq').selectionStart; renderMeta(); const q = $('rankq'); if (q) { q.focus(); if (pos != null) q.setSelectionRange(pos, pos); } }
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
function refresh() { dirty = true; if (APP && matrixSlug !== LEAGUE.slug) loadMatrix(); renderToday(); renderTeams(); renderRoster(); renderMeta(); paintDrawer(); if (onView() === 'matchups') renderMatchups(); if (onView() === 'battles') renderBattles(); if (UI.mon && $('view-mon').classList.contains('on')) renderMon(); if (UI.team && $('view-team').classList.contains('on')) renderTeam(); }
function markDirty() { dirty = true; }
function toggleAdd() { UI.adding = !UI.adding; renderRoster(); if (UI.adding) $('addid').focus(); }
function add() { const id = $('addid').value.trim().toLowerCase(), kind = $('addkind').value;
  if (!APP.pokemon[id]) { $('addid').value = ''; $('addid').placeholder = 'unknown species id'; return; }
  ROSTER[kind][id] = null; ROSTER.exclude = ROSTER.exclude.filter(x => x !== id); UI.adding = false; saveRoster(); refresh(); openMon(id); }
function drop(kind, id) { delete ROSTER[kind][id]; saveRoster(); refresh(); }
function bench(id) { if (ROSTER.owned[id] !== undefined) delete ROSTER.owned[id]; else if (!ROSTER.exclude.includes(id)) ROSTER.exclude.push(id); saveRoster(); refresh(); }
function unbench(id) { ROSTER.exclude = ROSTER.exclude.filter(x => x !== id); saveRoster(); refresh(); }
function place(cur, slot, val) {           // set a slot; if the move sits in the other charged slot, swap them; '' = no second move
  const other = slot === 1 ? 2 : slot === 2 ? 1 : -1;
  if (val && other > 0 && cur[other] === val) cur[other] = cur[slot];
  cur[slot] = val;
  while (cur.length && !cur[cur.length - 1]) cur.pop();
  return cur;
}
function setMove(id, slot, val) {
  const m = M(), o = m.own[id];
  const base = o && o.scan ? (knownMoves(o.scan, id) || APP.pokemon[id].moveset) : (ROSTER.moves[id] || m.ri.pending[id] || APP.pokemon[id].moveset);
  const cur = place(base.slice(), slot, val);
  if (o && o.scan) { o.scan.moves = cur; o.scan.secondMove = cur.length >= 3; save(); render(); } else ROSTER.moves[id] = cur;
  saveRoster(); refresh();
}
function addTag() { const name = $('tagname').value.trim(), team = [1, 2, 3].map(i => $('tag' + i).value.trim().toLowerCase());
  if (!name || team.some(t => !APP.pokemon[t])) { status(name ? 'Use species ids from the list for all three' : 'Give the party a name'); return; }
  ROSTER.tagged[name] = team; saveRoster(); refresh(); openTeam(team, name); }
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
function showScan(species) { nav('#/scans'); const q = $('q'); if (q) { q.value = species; render(); } }
function movesRowForScan(r, idx) {      // used by the Scans view: manual move selection on a card
  const s = scanId(r); if (!s || !s.id || !APP) return '';
  return movesRow(s.id, movesFor(r, s.id), `Planner.setScanMove(${idx},SLOT,this.value)`);
}
function setScanMove(idx, slot, val) {
  const r = results[idx], s = scanId(r); if (!s || !s.id) return;
  const base = (knownMoves(r, s.id) || APP.pokemon[s.id].moveset).slice();   // first pick on an unscanned card: the other slots take PvPoke's moves
  r.moves = place(base, slot, val); r.secondMove = r.moves.length >= 3; save(); render(); refresh(); if (UI.scan === r.key) renderMon();
}
function speciesOptions() { return Object.keys(APP.pokemon).map(id => `<option value="${id}">`).join(''); }

window.Planner = {nav, route, back, drawer, paintDrawer, setLeague, shareTeam, teamLink, dismissChanges, refreshReview, reviewFor, renderMatchups, muTeam, muMode, muSearch, muOpp, pickBoss, bossSearch, renderBattles, logBattle, logRating, delBattle, importBattle, blTeam, blLead, blSearch, mergeBattles, get BATTLES() { return BATTLES; }, lineageMerge, lineageDismiss, refresh, markDirty, copyText, renderToday, renderTeams, renderTeam, openTeam, closeTeam, saveTeam, renameTeam, deleteTeam, toggleTeamsAll, renderRoster, renderMeta, renderMon, openMon, openScan, closeMon, dropMon, addAs, resolveScan, deleteScan, beforeImport, onMovesScan, editScan, toggleMenu, toggleGloss, toggleUse, coverage, coverageWith, closeSheet,
                  metaPanel, buildPool, goBuilder, rosterSearch, pveType, pveBasic, toggleRaidUse, meterDown, rankSearch, rankType, rankMore, setSlot, fillSlot, addSlotFromInput, clearSlots, tryTeam, setBuildMove, want, wantMissing, saveBuildAsTeam, toggleAdd, add, drop, bench, unbench,
                  onNewScan, afterImport, updateScan, updateDone, onUpdated, updateKey: () => UI.updateKey || null, scanProof, markDone, snooze, unsnooze, undoDone, toggleMore, showScanKey,
                  askCoach, askBuilderCoach, clearBuilderCoach, pickName, toggleCoachCtx, setMove, setScanMove, addTag, dropTag, exportRoster, loadRepoRoster, showScan, movesRowForScan, speciesOptions, rosterInput, ROSTER, scanId, movesFor};
route(); loadCups(); loadChanges(); loadEvo();
})();
