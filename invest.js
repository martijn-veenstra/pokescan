/* PokeScan Invest (#/invest): which of your Pokémon are worth Stardust and Candy, per league and for raids, with the price and the why.
   Builds on planner.js through window.PS; adds its page functions to window.Planner. */
(function () {
'use strict';
const {M, UI, ROSTER, ALT_DATA, ALT_PROM, altData, attr, capT, chip, errorCard, esc, evoDescendants, familyKey, fold, haveOf, icon, kdust, loadPve, nice, nm,
  onView, scanIcon, scanId, ti, tset, unrankedId, when, whenIdle} = PS;
const pve = () => PS.pve();
/* ---------- Invest: which of your Pokémon are worth Stardust and Candy, per league and for raids, with the price and the why ---------- */
const INV_LEAGUES = [['great', 'Great League', 'GL'], ['ultra', 'Ultra League', 'UL']];
function invData(slug, load) {                    // a league's ranking data: the active one is APP, the others once loaded; load = fetch it if missing, then redraw
  if (slug === LEAGUE.slug) return APP;
  if (ALT_DATA[slug]) return ALT_DATA[slug];
  if (load && !ALT_PROM[slug]) altData(slug).then(() => { if (onView() === 'invest') whenIdle(renderInvest); });
  return null;
}
const invMetaW = rank => !rank ? 0 : rank <= 10 ? 1 : rank <= 25 ? 0.9 : rank <= 50 ? 0.75 : rank <= 100 ? 0.5 : rank <= 200 ? 0.25 : 0.05;
const invFitW = p => p >= 99 ? 1 : p >= 97 ? 0.9 : p >= 95 ? 0.75 : p >= 93 ? 0.55 : p >= 90 ? 0.3 : 0.1;
const invRaidW = n => n <= 5 ? 1 : n <= 12 ? 0.8 : n <= 25 ? 0.6 : 0.45;
const INV_MAXBONUS = 1.3 * 1.1;                   // party × meta-team bonus: a species ranked so low that even this cannot lift it to 0.3 is not worth an IV rank
function invCost(cur, to, extra) {               // dust, candy and XL from level cur to level to, plus extras (2nd move, evolution)
  const c = to > cur ? costTo(cur, to) : {dust: 0, candy: 0, xl: 0};
  return {dust: c.dust + (extra.dust || 0), candy: c.candy + (extra.candy || 0), xl: c.xl, to, from: cur};
}
function invVerdict(row, have) {                 // invest / cheap win / save for it / skip / ready, from value, cost and what you have
  const c = row.cost; if (!c || row.value < 0.3) return 'skip';
  const h = have.fam, dh = have.dust;
  row.shortDust = dh != null && c.dust > dh; row.shortCandy = !!(h && h.candy != null && c.candy > h.candy); row.shortXl = c.xl > 0 && !(h && h.xl != null && h.xl >= c.xl);
  if (!c.dust && !c.candy && !c.xl) return 'ready';
  if (row.shortDust || row.shortCandy || row.shortXl) return 'save';
  if (c.dust <= 15000 && !c.xl) return 'cheap';
  return 'invest';
}
let RAIDIX = {pve: null, map: null};
function raidRank(species, shadow) {             // a species' best place among the top attackers of any type: {t, n, x}, from one index per raid data file
  if (RAIDIX.pve !== pve()) { const map = new Map();
    for (const [t, list] of Object.entries(pve().types || {})) list.forEach((x, i) => { if (x.mega) return; const k = x.species + '|' + !!x.shadow, cur = map.get(k); if (!cur || i + 1 < cur.n) map.set(k, {t, n: i + 1, x}); });
    RAIDIX = {pve: pve(), map}; }
  return RAIDIX.map.get(species + '|' + !!shadow) || null;
}
let INVC = {m: null, k: null, rows: null};
function investRows() {                       // cached until the roster, what you have, the loaded leagues or the raid data change
  const m = M(), k = [Object.keys(ALT_DATA).join(), !!pve(), !!PS.evo(), JSON.stringify(ROSTER.have || {}), LEAGUE.slug].join('|');   // the model is rebuilt on every roster change
  if (INVC.m === m && INVC.k === k) return INVC.rows;
  const rows = investRowsCompute(); INVC = {m, k, rows}; return rows;
}
function investRowsCompute() {
  const H = ROSTER.have || {}, dust = H.dust ? H.dust.v : null, rows = [];
  const leagues = INV_LEAGUES.map(([slug, label, abbr]) => ({slug, label, abbr})); if (!leagues.some(l => l.slug === LEAGUE.slug)) leagues.push({slug: LEAGUE.slug, label: LEAGUE.title, abbr: LEAGUE.abbr});
  for (const L0 of leagues) L0.d = invData(L0.slug);
  const inParty = new Set(Object.values(ROSTER.tagged).flat());
  for (const r of results) {
    if (r.superseded || r.bench || !r.cp || !r.combos || !r.combos.length || !DATA.stats[r.species]) continue;
    const best = bestOf2(r), cur = r.level || best[0], [, a, df, s] = best, iconId = scanIcon(r), fam = familyKey((scanId(r) || {}).id || unrankedId(r) || r.species.toLowerCase());
    const have = {dust, fam: haveOf(fam)}, base = {key: r.key, species: r.species, shadow: !!r.shadow, level: cur, ivs: `${a}/${df}/${s}`, fam, iconId};
    const evos = evoDescendants(r.species);
    // PvP: every league the app has data for, for this species and what it evolves into
    for (const L0 of leagues) {
      const d = L0.d; if (!d) continue;
      for (const ev of evos) {
        const id = pvpokeIdFor(ev.sp, ev.sp === r.species ? best[4] : null, r.shadow, d, true); if (!id) continue;
        const e = d.pokemon[id], b = ev.sp === r.species && best[4] ? best[4] : formByTypes(DATA.stats[ev.sp], e.types), cap = d.league.cp;
        if (calcCP(b, a, df, s, cpmAt(cur)) > cap) continue;              // already over this cap
        const team = inParty.has(id) && L0.slug === LEAGUE.slug, meta = (d.metaTeams || []).some(t => t.members.includes(id));
        const row = Object.assign({}, base, {purpose: L0.abbr, plabel: L0.label, slug: L0.slug, id, name: e.name, types: e.types, rank: e.rank, evolve: ev.from ? nm(id) : null});
        if (invMetaW(e.rank) * INV_MAXBONUS < 0.3) {                        // too far down this league's rankings for any IVs to make it worth spending on
          Object.assign(row, {value: invMetaW(e.rank), cost: null, why: [`#${e.rank} in ${L0.label}: too far down the rankings to spend on`]});
          row.verdict = 'skip'; rows.push(row); continue;
        }
        const rk = cap === LEAGUE.cp ? pvpRank(b, a, df, s, cap) : pvpRankOne(b, a, df, s, cap); if (!rk) continue;
        const second = r.secondMove === false && ev.sp === r.species ? (e.thirdMove || [75000, 75]) : null;
        const cost = invCost(cur, rk.lv, {dust: second ? second[0] : 0, candy: (second ? second[1] : 0) + ev.evoCandy});
        const value = invMetaW(e.rank) * invFitW(rk.pct) * (team ? 1.3 : 1) * (meta ? 1.1 : 1);
        const why = [`#${e.rank} in ${L0.label}`, `your IVs rank #${rk.n} (${rk.pct.toFixed(1)}% of ideal)`];
        if (team) why.push('in a saved team'); else if (meta) why.push('in meta teams');
        if (ev.from) why.unshift(`evolve your ${nice(r.species)} into ${nm(id)}`);
        why.push(`reaches ${rk.cp} CP at L${rk.lv}`); if (second) why.push('2nd move locked');
        Object.assign(row, {value, cost, why, second: !!second});
        row.verdict = invVerdict(row, have); rows.push(row);
      }
    }
    // raids: the species' place among the best attackers of a type, its Attack IV, and the next level step
    const hit = pve() && raidRank(r.species, r.shadow);
    if (hit) {
      const b = best[4] || DATA.stats[r.species][0], atkF = (b[0] + a) / (b[0] + 15), to = cur < 30 ? 30 : cur < 35 ? 35 : cur < 40 ? 40 : cur;
      const why = [`#${hit.n} ${capT(hit.t)} raid attacker`, `Attack IV ${a}`, to > cur ? `L${cur} → L${to}: about ${Math.round((cpmAt(to) / cpmAt(cur) - 1) * 100)}% more damage` : 'already at L40'];
      const row = Object.assign({}, base, {purpose: 'Raids', plabel: 'Raids', slug: 'raids', rtype: hit.t, id: hit.x.id, name: hit.x.name, types: hit.x.types, rank: hit.n,
        value: invRaidW(hit.n) * atkF * atkF, cost: invCost(cur, to, {}), why});
      row.verdict = invVerdict(row, have); rows.push(row);
    }
  }
  // one row per species and purpose: your best copy for it, noting how many others there are
  const bestOf = new Map(), dustOf = x => x.cost ? x.cost.dust : Infinity;
  for (const x of rows) { const k = x.purpose + '|' + x.id, cur = bestOf.get(k);
    if (!cur) { bestOf.set(k, Object.assign(x, {others: 0})); continue; }
    cur.others++; if (x.value > cur.value + 0.01 || (Math.abs(x.value - cur.value) <= 0.01 && dustOf(x) < dustOf(cur))) { x.others = cur.others; bestOf.set(k, x); } }
  const out = [...bestOf.values()];
  for (const x of out) x.perDust = x.cost ? x.value / (1 + x.cost.dust / 10000 + x.cost.candy / 50 + x.cost.xl / 10) : 0;
  const ORD = {invest: 0, cheap: 1, save: 2, ready: 3, skip: 4};
  return out.sort((p, q) => ORD[p.verdict] - ORD[q.verdict] || q.perDust - p.perDust);
}
const isSpend = x => x.verdict === 'invest' || x.verdict === 'cheap';
function spendPlan(rows) {                        // the best value per dust that fits your stardust, one spend per copy, candy per family counted down
  const H = ROSTER.have || {}, budget = H.dust ? H.dust.v : null, candy = {}, used = new Set(), plan = [];
  let left = budget;
  for (const x of rows.filter(isSpend).sort((p, q) => q.perDust - p.perDust)) {
    if (used.has(x.key)) continue;
    if (left != null && x.cost.dust > left) continue;
    const h = haveOf(x.fam); if (h && h.candy != null) { const c = candy[x.fam] ?? h.candy; if (x.cost.candy > c) continue; candy[x.fam] = c - x.cost.candy; }
    plan.push(x); used.add(x.key); if (left != null) left -= x.cost.dust;
    if (plan.length >= 5) break;
  }
  return {plan, budget, left, spent: plan.reduce((n, x) => n + x.cost.dust, 0)};
}
const INV_V = {invest: ['Invest now', 'ok'], cheap: ['Cheap win', 'ok'], save: ['Save for it', 'gl'], ready: ['Ready', ''], skip: ['Skip', 'dim']};
function invCostHtml(x) {
  if (!x.cost) return 'not worth powering up';
  const h = haveOf(x.fam), parts = [];
  if (x.cost.dust) parts.push(`${kdust(x.cost.dust)} dust${x.shortDust ? '<span class="bad"> ✗</span>' : ''}`);
  if (x.cost.candy) parts.push(`${x.cost.candy} candy${h && h.candy != null ? (x.shortCandy ? `<span class="bad"> ✗ ${h.candy}</span>` : '<span class="good"> ✓</span>') : ''}`);
  if (x.cost.xl) parts.push(`${x.cost.xl} XL${x.shortXl ? '<span class="bad"> ✗</span>' : ''}`);
  return parts.length ? parts.join(' · ') : 'nothing to spend';
}
const invStep = x => [x.evolve ? `evolve → ${esc(x.evolve)}` : '', x.cost && x.cost.to > x.cost.from ? `L${x.cost.from} → L${x.cost.to}` : '', x.second ? '2nd move' : ''].filter(Boolean).join(' · ');
const invFor = x => esc(x.purpose === 'Raids' ? 'raids' : x.plabel);
function invRow(x) {
  const v = INV_V[x.verdict], what = invStep(x), purpose = x.purpose === 'Raids' ? ti(x.rtype) + 'Raids' : esc(x.purpose);
  return `<div class="inv v-${x.verdict}" onclick="Planner.openScan(${attr(x.key)})">${icon(x.iconId, 'm')}<span class="tx">
    <span class="t1"><b>${esc(x.name)}</b>${tset(x.types)}<span class="chip pp">${purpose}</span><span class="chip ${v[1]}">${v[0]}</span></span>
    <span class="t2">${what ? `${what} · ` : ''}${invCostHtml(x)}</span>
    <span class="t3">${esc(x.why.join(' · '))}${x.others ? ` · <span class="dim">best of your ${x.others + 1} copies</span>` : ''}</span></span></div>`;
}
const planLine = (x, i) => `<b>${esc(x.name)}</b> <span class="dim">${invFor(x)}</span>${invStep(x) ? ' · ' + invStep(x) : ''}<div class="dt">${invCostHtml(x)}</div>`;
function renderInvest() {
  const el = $('invest'); if (!el) return;
  try { el.innerHTML = investInner(); } catch (e) { el.innerHTML = errorCard('Invest', e); }
}
function investInner() {
  if (!APP || !window.PVP) return '<div class="note">Loading battle data…</div>';
  loadPve(); for (const [slug] of INV_LEAGUES) invData(slug, true);   // this page loads the other leagues; Today only uses what is already here
  const rows = investRows(), H = ROSTER.have || {}, sp = spendPlan(rows), f = UI.invF || 'all';
  let h = `<div class="note have">Stardust <input id="idust" inputmode="numeric" placeholder="type it" value="${H.dust ? H.dust.v : ''}" onchange="Planner.setHave(null,'dust',this.value)"> · candy is read off your status screenshots per family${H.dust && !H.dust.hand ? `, dust last read ${when(H.dust.t)}` : ''}</div>`;
  h += `<div class="sec">Spend plan <small>${sp.budget != null ? `best value per dust within your ${kdust(sp.budget)}` : 'best value per dust'}</small></div>`;
  if (!sp.plan.length) h += `<div class="note">${rows.length ? 'Nothing worth spending on right now: the rows below say what you are saving for and what to skip.' : 'Scan your Pokémon (status screen) to see what is worth powering up.'}</div>`;
  else h += `<div class="team card invplan" style="cursor:default">${sp.plan.map((x, i) => `<div class="ip" onclick="Planner.openScan(${attr(x.key)})"><span class="n">${i + 1}</span><span class="tx">${planLine(x)}</span></div>`).join('')}
    <div class="dt" style="margin-top:6px">${sp.budget != null ? `${kdust(sp.spent)} of your ${kdust(sp.budget)} stardust · ${kdust(sp.left)} left over` : 'Type your stardust above and the plan keeps to it.'}</div></div>`;
  const purposes = [...new Set(rows.map(x => x.purpose))], show = rows.filter(x => (f === 'all' || x.purpose === f) && (!UI.invHide || x.verdict !== 'skip'));
  h += `<div class="sec">Your Pokémon <small>${rows.filter(isSpend).length} worth investing in · ${rows.filter(x => x.verdict === 'save').length} to save for</small></div>`;
  h += `<div class="tchips mf">${['all'].concat(purposes).map(k => `<span class="chip ${f === k ? 'sel' : ''}" onclick="Planner.investFilter('${k}')">${k === 'all' ? 'All' : esc(k)}</span>`).join('')}<span class="chip ${UI.invHide ? 'sel' : ''}" onclick="Planner.investHide()">Hide skip</span></div>`;
  h += show.length ? fold(show.map(invRow), 12, {label: n => `${n} more`}) : `<div class="note">Nothing here${f !== 'all' ? ' for this filter' : ''}.</div>`;
  const loading = INV_LEAGUES.some(([slug]) => !invData(slug)) || !pve();
  h += `<div class="dt" style="margin-top:8px">${loading ? 'Still loading the other leagues and the raid data… ' : ''}Worth it = how good the species is there (its rank) × how close your IVs are to ideal for that cap, against the dust, candy and XL it takes. Raids: its place among the best attackers of its type and its Attack IV. One row per species and purpose: your best copy.</div>`;
  return h;
}
function investFilter(k) { UI.invF = k; renderInvest(); }
function investHide() { UI.invHide = !UI.invHide; renderInvest(); }
function investCard() {                           // Today: the top of the spend plan, from the leagues already loaded (Today never fetches other leagues)
  if (!results.some(r => r.cp && !r.superseded)) return '';
  const sp = spendPlan(investRows()); if (!sp.plan.length) return '';
  return `<div class="sec">Where your dust goes <small>${sp.budget != null ? `within your ${kdust(sp.budget)} stardust` : 'best value per dust'}</small></div><div class="team row" onclick="Planner.nav('#/invest')"><span class="tx">${sp.plan.slice(0, 3).map((x, i) => `<div class="dt invtop">${i + 1}. ${planLine(x)}</div>`).join('')}<div class="dt" style="margin-top:4px">the full list: what to invest in, save for or skip ›</div></span><span class="go">›</span></div>`;
}
function investTop() {                            // for Professor Cedar: the rows worth knowing about, in words
  try { return investRows().filter(x => x.verdict !== 'skip').slice(0, 8).map(x => `${x.name} for ${x.plabel}: ${INV_V[x.verdict][0]} · ${x.cost.dust} dust, ${x.cost.candy} candy${x.cost.xl ? `, ${x.cost.xl} XL` : ''} · ${x.why.join(', ')}`); } catch { return undefined; }
}

Object.assign(Planner, {renderInvest, investFilter, investHide, investRows, spendPlan, investCard, investTop});
})();
