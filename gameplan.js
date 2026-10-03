/* PokeScan Game plan (#/matchups): one of your teams against the meta, their leads, your logged record, the teams you met, and what beats it.
   Builds on planner.js through window.PS; adds its page functions to window.Planner. */
(function () {
'use strict';
const {M, UI, ROSTER, attr, battleStats, bestSwaps, builderLeague, chip, coverText, cupCard, errorCard, esc, gpName, icon, nice, nm, teamKey, teamOf, trio, tset, typeWhy} = PS;
/* ---------- Game plan: one of your teams against the meta, their leads, your logged record, the teams you met, and what beats it ---------- */
const MU = Object.assign({team: null, lead: null}, JSON.parse(localStorage.getItem('mu') || '{}'));
const saveMU = () => localStorage.setItem('mu', JSON.stringify({team: MU.team, lead: MU.lead}));
function gpTeams(st) {                          // saved parties, most played first, then the Builder
  const played = ids => { const t = teamOf(st, ids); return t ? t.w + t.l : 0; };
  const out = Object.entries(ROSTER.tagged).filter(([, v]) => v && v.length).map(([n, v]) => ({key: n, label: n, ids: v.slice(0, 3), n: played(v.slice(0, 3))}));
  out.sort((a, b) => b.n - a.n);
  return out.concat([{key: 'builder', label: 'Builder', ids: UI.build.slots.filter(Boolean), n: 0}]);
}
function leadPlan(L, ids, opp) {                 // their lead against your party: stay, stay and shield, swap, or nobody wins
  const lead = ids[0], r11 = id => L.rating(id, opp, '1-1'), r22 = id => L.rating(id, opp, L.mx && L.mx.scen.has('2-2') ? '2-2' : '1-1');
  const best = ids.slice(1).sort((a, b) => r11(b) - r11(a))[0];
  if (r11(lead) >= 500 && r22(lead) >= 500) return {kind: 'stay', who: lead, short: 'Stay in', why: `${nm(lead)} wins with or without shields`};
  if (r11(lead) >= 500) return {kind: 'stay', who: lead, short: 'Stay, shield once', why: `${nm(lead)} wins 1-1 (${Math.round(r11(lead))}) but loses 2-2 (${Math.round(r22(lead))})`};
  if (best && r11(best) >= 500) return {kind: 'swap', who: best, short: `Swap to ${nm(best)}`, why: `wins 1-1 (${Math.round(r11(best))})${r22(best) >= 500 ? ' and 2-2' : ', needs a shield'}`};
  return {kind: 'none', who: best || lead, short: 'Nobody wins', why: `${nm(best || lead)} does best (${Math.round(r11(best || lead))}): save shields for the back line`};
}
function trioVsTrio(L, mine, theirs) {           // the average 1-1 rating over every pair: 500 is even
  let s = 0, n = 0; for (const a of mine) for (const o of theirs) { s += L.rating(a, o, '1-1'); n++; }
  return n ? s / n : 500;
}
const simCall = v => v >= 520 ? {t: 'favoured', c: 'ok'} : v < 480 ? {t: 'unfavoured', c: 'warn'} : {t: 'even', c: ''};
function gpCurrent(teams) {                     // the chosen team: a saved party, the Builder, or a meta team picked to compare with
  const mt = /^meta:(\d+)$/.exec(MU.team || ''), t = mt && (APP.metaTeams || [])[+mt[1]];
  if (t) return {key: MU.team, label: `Meta team #${+mt[1] + 1}`, ids: t.members.slice(0, 3), n: 0, meta: true};
  return teams.find(x => x.key === MU.team && x.ids.length) || teams.find(x => x.ids.length) || teams[teams.length - 1];
}
function gpFacts(L, t, st) {                      // "played 2–1 · score 505" for a team row
  const u = t.ids.filter(id => L.pokemon[id]), rec = teamOf(st, t.ids), out = [];
  if (rec && rec.w + rec.l) out.push(`played ${rec.w}–${rec.l}`);
  if (u.length) out.push(`score ${L.evaluate(u).score.toFixed(0)}`);
  if (u.length < t.ids.length) out.push(`${t.ids.length - u.length} not allowed here`);
  return out.join(' · ');
}
function gpHead(L, cur, st) {                     // the chosen team as one card; tapping it opens the team chooser
  const ids = cur.ids, out = ids.filter(id => !L.pokemon[id]);
  if (!ids.length) return `<div class="gphead" onclick="Planner.muPick()"><span class="tx"><b>${esc(cur.label)}</b><div class="dt">empty</div></span><span class="gpchg">Choose team</span></div>`;
  return `<div class="gphead" onclick="Planner.muPick()"><span class="trio">${ids.map(id => icon(id, 'm' + (L.pokemon[id] ? '' : ' nt'))).join('')}</span>
    <span class="tx"><b>${esc(cur.label)}</b><div class="dt">${esc(ids.map(gpName).join(' · '))}</div><div class="dt">${esc(gpFacts(L, cur, st))}</div></span><span class="gpchg">Change</span></div>` +
    (out.length ? `<div class="note">${esc(out.map(gpName).join(' and '))} ${out.length === 1 ? "isn't" : "aren't"} allowed in ${esc(LEAGUE.title)}${out.length < ids.length ? `: the plan below uses the other ${ids.length - out.length === 1 ? 'one' : ids.length - out.length}` : ''}.</div>` : '') +
    (ids.some(id => L.pokemon[id] && !APP.pokemon[id]) ? `<div class="note">${esc(ids.filter(id => L.pokemon[id] && !APP.pokemon[id]).map(nm).join(' and '))}: not ranked here, estimated from types.</div>` : '');
}
function muPick() {                               // the team chooser: your parties, the Builder, and the meta teams to compare with
  const m = M(), st = battleStats(LEAGUE.slug), teams = gpTeams(st), metas = (APP.metaTeams || []).slice(0, 8);
  const L = builderLeague(m, teams.flatMap(t => t.ids)), cur = gpCurrent(teams);
  const row = t => `<div class="prow ${t.key === cur.key ? 'on' : ''}" onclick="Planner.muTeam(${attr(t.key)});Planner.closeSheet()">${t.ids.length ? `<span class="trio">${t.ids.map(id => icon(id, 's' + (L.pokemon[id] ? '' : ' nt'))).join('')}</span>` : ''}<span class="tx"><b>${esc(t.label)}</b><div class="dt">${t.ids.length ? esc(t.ids.map(gpName).join(' / ')) : 'empty: pick three in the Builder first'}</div>${t.ids.length ? `<div class="dt">${esc(gpFacts(L, t, st))}</div>` : ''}</span>${t.key === cur.key ? '<span class="tick">✓</span>' : ''}</div>`;
  const saved = teams.filter(t => t.key !== 'builder'), b = teams.find(t => t.key === 'builder');
  $('sheet').innerHTML = `<div class="box"><h2><span>Choose a team</span><span class="x" onclick="Planner.closeSheet()">✕</span></h2>
    <div class="uh">Your teams</div><div class="plist">${saved.length ? saved.map(row).join('') : '<div class="dt">No saved teams yet: build one and save it in the Builder.</div>'}</div>
    <div class="uh" style="margin-top:12px">Builder</div><div class="plist">${b.ids.length ? row(b) : `<div class="prow" onclick="Planner.closeSheet();Planner.nav('#/builder')"><span class="tx"><b>Open the Builder</b><div class="dt">try any three Pokémon, then come back here</div></span></div>`}</div>
    ${metas.length ? `<div class="uh" style="margin-top:12px">Meta teams <small class="dim">to compare against what you meet</small></div><div class="plist">${metas.map((t, i) => row({key: 'meta:' + i, label: `Meta team #${i + 1}`, ids: t.members.slice(0, 3)})).join('')}</div>` : ''}</div>`;
  $('sheet').classList.add('open');
}
function renderMatchups() {
  const el = $('matchups'); if (!el) return;
  try { el.innerHTML = matchupsInner(); } catch (e) { el.innerHTML = errorCard('Game plan', e); }
}
function matchupsInner() {
  if (!APP || !window.PVP) return '<div class="note">Loading battle data…</div>';
  const m = M(), st = battleStats(LEAGUE.slug), teams = gpTeams(st);
  const L = builderLeague(m, teams.flatMap(t => t.ids));
  const cur = gpCurrent(teams);
  let h = gpHead(L, cur, st) + cupCard(false);
  if (!cur.ids.length) return h + `<div class="empty"><b>No team yet.</b><br>Fill the <a href="#" onclick="Planner.nav('#/builder');return false">Builder</a> or save an in-game party, then come back.</div>`;
  const ids = cur.ids, use = ids.filter(id => L.pokemon[id]);
  if (!use.length) return h + `<div class="note">Nobody in this team can enter ${esc(LEAGUE.title)}. Pick another team or switch league.</div>`;
  h += gpMeta(m, L, use);
  if (use.length > 1) h += gpLeads(L, use, st);
  h += gpRecord(L, ids, use, st);
  h += gpMet(L, cur, use, teams, st);
  h += gpThreats(m, L, use, st);
  h += `<div class="note">Ratings 0–1000, 500 is even. ${L.mx ? `Simulated battles for ${esc(LEAGUE.title)} with the default IVs, three shield scenarios.` : `No battle simulation for ${esc(LEAGUE.title)} yet: published matchup ratings where known, else a type estimate.`}</div>`;
  return h;
}
function gpMeta(m, L, use) {                     // card 1: the team score, its place among the meta teams, and the one swap that gains most
  const ev = L.evaluate(use), metas = (APP.metaTeams || []).filter(t => t.members.every(x => L.pokemon[x])).map(t => L.evaluate(t.members).score);
  const rank = 1 + metas.filter(s => s > ev.score).length, all = metas.concat([ev.score]), lo = Math.min(...all), hi = Math.max(...all), pos = s => hi > lo ? (s - lo) / (hi - lo) * 100 : 50;
  let h = `<div class="sec">Against the meta <small>${use.length < 3 ? `${use.length} of 3 members` : 'the same score as Today'}</small></div><div class="hero" style="cursor:default">`;
  h += `<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span class="big" style="font-family:Sora,sans-serif;font-weight:800;font-size:30px;color:var(--green)">${ev.score.toFixed(0)}</span>`;
  h += metas.length ? `<span class="gprk"><b>#${rank} of ${metas.length + 1}</b> next to the ${metas.length} meta teams</span>` : '';
  h += `</div>`;
  if (metas.length) h += `<div class="gpbar">${metas.map(s => `<i style="left:${pos(s).toFixed(1)}%"></i>`).join('')}<b style="left:${pos(ev.score).toFixed(1)}%"></b></div><div class="dt" style="display:flex;justify-content:space-between"><span>${lo.toFixed(0)}</span><span>meta teams · yours in green</span><span>${hi.toFixed(0)}</span></div>`;
  h += `<div class="dim" style="font-size:12px;margin-top:6px">${coverText(ev, L)}${ev.holes.length ? `; no answer to ${esc(ev.holes.slice(0, 5).map(nm).join(', '))}${ev.holes.length > 5 ? '…' : ''}` : ''}.</div>`;
  // the one change from your roster that gains most: the Builder's swap search for a full team, the best fill for a short one
  let best = null;
  if (use.length === 3) { const sw = bestSwaps(L, use, m, ev).find(x => !x.pending && L.pokemon[x.in]); if (sw) best = {s: ev.score + sw.delta, c: sw.in, out: sw.out}; }
  else if (use.length === 2) { const base = new Set(use.map(PVP.baseSpecies));
    for (const c of Object.keys(m.ri.owned)) if (L.pokemon[c] && !base.has(PVP.baseSpecies(c))) { const sc = L.evaluate(use.concat([c])).score; if (!best || sc > best.s) best = {s: sc, c, out: null}; } }
  if (best && (use.length < 3 || best.s - ev.score >= 1)) h += `<div style="font-size:13px;margin-top:8px">Best change from your roster: <b>${best.out ? `${esc(nm(best.out))} → ${esc(nm(best.c))}` : `add ${esc(nm(best.c))}`}</b> <span class="dim">(${best.s.toFixed(0)}${use.length === 3 ? `, +${(best.s - ev.score).toFixed(0)}` : ''})</span></div>`;
  else if (use.length >= 2) h += `<div class="dim" style="font-size:12px;margin-top:8px">No single swap from your roster scores higher.</div>`;
  return h + `</div>`;
}
function gpLeads(L, use, st) {                   // card 2: the leads you meet (from your log first, then the meta), one line of advice each
  const seen = Object.fromEntries(st.leads.map(x => [x.id, x.w + x.l]));
  const logged = Object.keys(seen).filter(id => L.pokemon[id] && !use.includes(id)).sort((a, b) => seen[b] - seen[a]);
  const leads = [...new Set(logged.concat(L.meta.filter(id => !use.includes(id))))].slice(0, 12);
  const scen = L.mx ? L.mx.scenarios : ['1-1'], cls = r => r >= 500 ? 'w' : r < 400 ? 'l' : 'e';
  let h = `<div class="sec">Their lead <small>you lead ${esc(nm(use[0]))} · tap a row for the shield table</small></div><div class="team card gpleads" style="cursor:default">`;
  for (const o of leads) {
    const p = leadPlan(L, use, o), open = MU.lead === o;
    h += `<div class="gpl gk-${p.kind}" onclick="Planner.muLead('${o}')">${icon(o, 'xs')}<span class="gn">${esc(nm(o))}<span class="gt">${tset(L.pokemon[o].types)}</span>${seen[o] ? ` <span class="chip">×${seen[o]}</span>` : ''}</span><span class="ga"><b>${esc(p.short)}</b><small>${esc(p.why)}</small>${typeWhy(L, p.who, o)}</span></div>`;
    if (open) {
      const rows = L.matchup(use, o);
      h += `<div class="mut" style="grid-template-columns:1fr repeat(${scen.length},minmax(48px,60px))"><div class="mh"></div>${scen.map(sc => `<div class="mh">${sc === '0-0' ? 'no shields' : sc === '1-1' ? '1 each' : sc === '2-2' ? '2 each' : sc}</div>`).join('')}` +
        rows.map(r => `<div class="mn" onclick="Planner.openMon('${r.id}')"><b>${icon(r.id, 'xs')}${esc(nm(r.id))}</b><small>${r.verdict === 'wins' ? '<span class="good">wins regardless</span>' : r.verdict === 'loses' ? '<span class="bad">loses</span>' : 'shield-dependent'}${r.source === 'est' ? ' · estimated' : ''}</small></div>${scen.map(sc => `<div class="mc ${cls(r.ratings[sc])}">${Math.round(r.ratings[sc])}</div>`).join('')}`).join('') + `</div>`;
    }
  }
  return h + `<div class="dt" style="margin-top:6px">${logged.length ? `${logged.length} of these come from your battle log, most met first; the rest are the meta.` : 'Ordered by the meta. Leads you log in the Battle log move to the top.'} 1v1 ratings with equal shields; the real answer also depends on their back line.</div></div>`;
}
function gpRecord(L, ids, use, st) {             // card 3: this team's logged results per lead, next to what the simulation expects
  const t = teamOf(st, ids);
  let h = `<div class="sec">Your record with this team <small>${esc(LEAGUE.title)}</small></div>`;
  if (!t || !(t.w + t.l)) return h + `<div class="note">No battles logged with this team yet. Import a recording or share the end-of-battle screen in the <a href="#" onclick="Planner.nav('#/battles');return false">Battle log</a> and pick this team: its results per lead show up here.</div>`;
  const rows = t.leads;
  h += `<div class="team card" style="cursor:default"><div style="display:flex;align-items:baseline;gap:10px"><span class="big" style="font-family:Sora,sans-serif;font-weight:800;font-size:26px">${t.w}–${t.l}</span><span class="dim" style="font-size:12px">${t.w + t.l ? Math.round(t.w / (t.w + t.l) * 100) : 0}% won</span></div>`;
  for (const r of rows.slice(0, 8)) {
    let note = '';
    if (L.pokemon[r.id] && use.length > 1) { const p = leadPlan(L, use, r.id);
      if (r.l > r.w && p.kind !== 'none') note = `the simulation says ${p.kind === 'swap' ? `${nm(p.who)} wins this: swap to it` : `${nm(p.who)} wins this: stay in`}`;
      else if (r.l > r.w) note = 'nobody in the team wins it in the simulation either';
      else if (r.w > r.l && p.kind === 'none') note = 'you beat it more than the simulation expects'; }
    h += `<div class="dt" style="margin-top:6px"><b style="color:var(--ink)">vs ${esc(nm(r.id))} lead ${r.w}–${r.l}</b>${note ? ` · <span class="${r.l > r.w ? 'bad' : ''}">${esc(note)}</span>` : ''}</div>`;
  }
  if (!rows.length) h += `<div class="dt" style="margin-top:6px">Log their lead with each battle to see which leads give this team trouble.</div>`;
  return h + `</div>`;
}
function gpMet(L, cur, use, teams, st) {         // card 4: your teams against the opponent trios you actually met
  const met = st.fights.filter(b => b.result && b.opp && b.opp.length).sort((a, b) => b.t - a.t).slice(0, 40)
    .map(b => ({b, opp: b.opp.filter(o => L.pokemon[o])})).filter(x => x.opp.length);
  let h = `<div class="sec">Against the teams you met <small>${met.length ? `${met.length} logged battle${met.length === 1 ? '' : 's'} with their team read` : 'from your battle log'}</small></div>`;
  if (!met.length) return h + `<div class="note">Share your end-of-battle screens in the <a href="#" onclick="Planner.nav('#/battles');return false">Battle log</a>: once their teams are logged, every team of yours is simulated against the teams you actually meet.</div>`;
  // every team of yours, simulated against those trios, next to what it really did
  const rows = (cur.meta ? teams.concat([cur]) : teams).map(t => { const u = t.ids.filter(id => L.pokemon[id]); if (!u.length) return null;
    const rec = teamOf(st, t.ids), wins = met.filter(x => trioVsTrio(L, u, x.opp) >= 500).length;
    return {t, wins, rec: rec && rec.w + rec.l ? `${rec.w}–${rec.l}` : null}; }).filter(Boolean).sort((a, b) => b.wins - a.wins);
  h += `<div class="team card" style="cursor:default"><div class="uh">Your teams against them</div>`;
  h += rows.map((r, i) => `<div class="gpt${r.t === cur ? ' on' : ''}" onclick="Planner.muTeam(${attr(r.t.key)})"><span class="gn">${esc(r.t.label)}${i === 0 && rows.length > 1 && r.wins > rows[1].wins ? ' <span class="chip ok">best against what you meet</span>' : ''}</span><span class="gs">sim ${r.wins} of ${met.length}</span><span class="gr">${r.rec ? `played ${r.rec}` : '<span class="dim">not played</span>'}</span></div>`).join('');
  h += `<div class="dt" style="margin-top:6px">Sim: simulated as favoured (average 1-1 rating over the nine pairs of 500 or more) against that many of the teams you met. Played: what that team really did.</div></div>`;
  // the chosen team against each of those trios, newest first
  const mine = teamKey(cur.ids);
  h += `<div class="team card" style="cursor:default"><div class="uh">${esc(cur.label)} against each</div>`;
  for (const x of met.slice(0, 10)) {
    const v = trioVsTrio(L, use, x.opp), c = simCall(v), withThis = x.b.ids && teamKey(x.b.ids) === mine, res = withThis ? x.b.result : null;
    const flag = res === 'L' && c.t === 'favoured' ? 'the simulation favoured you: check the lead' : res === 'W' && c.t === 'unfavoured' ? 'won an unfavoured one' : '';
    h += `<div class="gpm"><span class="gi">${x.opp.map(o => icon(o, 'xs')).join('')}<span class="gn">${esc(x.opp.map(nm).join(' / '))}</span></span><span class="chip ${c.c}">${c.t} ${Math.round(v)}</span>${res ? `<span class="chip ${res === 'W' ? 'ok' : 'warn'}">${res === 'W' ? 'won' : res === 'L' ? 'lost' : 'draw'}</span>` : '<span class="dim" style="font-size:11.5px">other team</span>'}${flag ? `<div class="dt">${esc(flag)}</div>` : ''}</div>`;
  }
  // the opponents you meet most, one by one
  const faced = st.faced.filter(f => L.pokemon[f.id] && !use.includes(f.id)).slice(0, 10);
  if (faced.length) { const ans = faced.filter(f => Math.max(...use.map(a => L.rating(a, f.id, '1-1'))) >= 500);
    h += `<div class="uh" style="margin-top:10px">The Pokémon you meet most</div><div class="dt">This team answers <b style="color:var(--ink)">${ans.length} of ${faced.length}</b></div><div class="chips" style="margin-top:4px">${faced.map(f => `<span class="chip ${ans.includes(f) ? 'ok' : 'warn'}" onclick="Planner.openMon('${f.id}')" style="cursor:pointer">${esc(nm(f.id))} <span style="opacity:.7">×${f.n}</span></span>`).join('')}</div>`; }
  return h + `</div>`;
}
function gpThreats(m, L, use, st) {              // card 5: what beats every member, the ones you meet first, and who in your roster answers it
  const tl = L.threatList(use, 40); if (!tl.count) return `<div class="sec">Threats</div><div class="note">No common Pokémon beats all ${use.length === 1 ? 'of it' : use.length === 2 ? 'both of yours' : 'three of yours'}.</div>`;
  const met = Object.fromEntries(st.faced.map(f => [f.id, f.n]));
  const list = tl.threats.slice().sort((a, b) => (met[b.id] || 0) - (met[a.id] || 0) || a.worst - b.worst).slice(0, 6);
  const owned = Object.keys(m.ri.owned).filter(c => L.pokemon[c] && !use.includes(c));
  let h = `<div class="sec">Threats <small>beat ${use.length === 1 ? 'it' : use.length === 2 ? 'both' : 'all three'} · ${tl.count} of ${tl.pool}</small></div><div class="team card" style="cursor:default">`;
  for (const t of list) {
    const ans = owned.map(c => ({c, r: L.rating(c, t.id, '1-1')})).filter(x => x.r >= 500).sort((a, b) => b.r - a.r).slice(0, 2);
    h += `<div class="gpm"><span class="gi" onclick="Planner.openMon('${t.id}')" style="cursor:pointer">${icon(t.id, 'xs')}<span class="gn">${esc(nm(t.id))}</span>${tset(L.pokemon[t.id].types)}</span>${met[t.id] ? `<span class="chip warn">met ×${met[t.id]}</span>` : ''}<div class="dt">${ans.length ? `answer from your roster: ${ans.map(x => `<b style="color:var(--ink)">${esc(nm(x.c))}</b> ${Math.round(x.r)}`).join(', ')}` : 'nothing you own beats it'}</div>${ans.length ? typeWhy(L, ans[0].c, t.id) : typeWhy(L, use.slice().sort((a, b) => L.rating(b, t.id) - L.rating(a, t.id))[0], t.id)}</div>`;
  }
  return h + `</div>`;
}
function muTeam(k) { MU.team = k; MU.lead = null; saveMU(); renderMatchups(); }
function muLead(id) { MU.lead = MU.lead === id ? null : id; saveMU(); renderMatchups(); }

Object.assign(Planner, {renderMatchups, muTeam, muLead, muPick});
})();
