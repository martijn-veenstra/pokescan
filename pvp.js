/* PokeScan PvP team heuristic — JavaScript port of scripts/generate_pvpoke_team_comps.py.
   Works in the browser (window.PVP) and in Node (module.exports). Consumes data/app-<league>.json. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SE = 1.6, NVE = 0.625, IMM = 0.390625;
  const CHART = {
    normal:   {rock: NVE, steel: NVE, ghost: IMM},
    fire:     {grass: SE, ice: SE, bug: SE, steel: SE, fire: NVE, water: NVE, rock: NVE, dragon: NVE},
    water:    {fire: SE, ground: SE, rock: SE, water: NVE, grass: NVE, dragon: NVE},
    electric: {water: SE, flying: SE, electric: NVE, grass: NVE, dragon: NVE, ground: IMM},
    grass:    {water: SE, ground: SE, rock: SE, fire: NVE, grass: NVE, poison: NVE, flying: NVE, bug: NVE, dragon: NVE, steel: NVE},
    ice:      {grass: SE, ground: SE, flying: SE, dragon: SE, fire: NVE, water: NVE, ice: NVE, steel: NVE},
    fighting: {normal: SE, ice: SE, rock: SE, dark: SE, steel: SE, poison: NVE, flying: NVE, psychic: NVE, bug: NVE, fairy: NVE, ghost: IMM},
    poison:   {grass: SE, fairy: SE, poison: NVE, ground: NVE, rock: NVE, ghost: NVE, steel: IMM},
    ground:   {fire: SE, electric: SE, poison: SE, rock: SE, steel: SE, grass: NVE, bug: NVE, flying: IMM},
    flying:   {grass: SE, fighting: SE, bug: SE, electric: NVE, rock: NVE, steel: NVE},
    psychic:  {fighting: SE, poison: SE, psychic: NVE, steel: NVE, dark: IMM},
    bug:      {grass: SE, psychic: SE, dark: SE, fire: NVE, fighting: NVE, poison: NVE, flying: NVE, ghost: NVE, steel: NVE, fairy: NVE},
    rock:     {fire: SE, ice: SE, flying: SE, bug: SE, fighting: NVE, ground: NVE, steel: NVE},
    ghost:    {psychic: SE, ghost: SE, dark: NVE, normal: IMM},
    dragon:   {dragon: SE, steel: NVE, fairy: IMM},
    dark:     {psychic: SE, ghost: SE, fighting: NVE, dark: NVE, fairy: NVE},
    steel:    {ice: SE, rock: SE, fairy: SE, fire: NVE, water: NVE, electric: NVE, steel: NVE},
    fairy:    {fighting: SE, dragon: SE, dark: SE, fire: NVE, poison: NVE, steel: NVE},
  };
  const eff = (t, defTypes) => defTypes.reduce((m, d) => m * ((CHART[t] || {})[d] || 1), 1);
  const baseSpecies = id => id.replace('_shadow', '');
  const round1 = x => Math.round(x * 10) / 10;

  function* trios(pool) {
    for (let i = 0; i < pool.length; i++)
      for (let j = i + 1; j < pool.length; j++)
        for (let k = j + 1; k < pool.length; k++) {
          const t = [pool[i], pool[j], pool[k]];
          if (new Set(t.map(baseSpecies)).size === 3) yield t;
        }
  }

  /* data/matrix-<league>.json: ratings simulated with PvPoke's engine for rows × cols × scenarios (0-0, 1-1, 2-2 shields) */
  function decodeMatrix(mx) {
    if (!mx || !mx.data || mx.decoded) return mx || null;
    const b64 = mx.data, bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    mx.arr = new Uint16Array(bytes.buffer); mx.rowIdx = new Map(mx.rows.map((r, i) => [r, i])); mx.colIdx = new Map(mx.cols.map((c, i) => [c, i]));
    mx.scen = new Map(mx.scenarios.map((x, i) => [x, i])); mx.decoded = true; delete mx.data;
    return mx;
  }

  class League {
    constructor(data, overrides, matrix) {
      this.data = data;
      this.mx = decodeMatrix(matrix);
      this.pokemon = data.pokemon;
      this.moves = data.moves;
      this.meta = data.meta.slice();
      this.overrides = Object.assign({}, overrides || {});
      this.pub = new Map();
      for (const [id, e] of Object.entries(this.pokemon)) {
        for (const list of [e.matchups, e.counters]) for (const m of list || []) {
          this.pub.set(id + '|' + m[0], m[1]);
          if (m.length > 2) this.pub.set(m[0] + '|' + id, m[2]);
        }
      }
      for (const [k, r] of [...this.pub.entries()]) {
        const [a, d] = k.split('|');
        if (!this.pub.has(d + '|' + a)) this.pub.set(d + '|' + a, 1000 - r);
      }
      this.cache = new Map();
    }
    has(id) { return !!this.pokemon[id]; }
    isPublished(atk, dfn) { return this.pub.has(atk + '|' + dfn); }
    /* where a rating comes from: 'sim' (matrix, same moveset), 'sim-default' (matrix, PvPoke's moveset while yours differs), 'pub' (PvPoke's published top matchups), 'est' (type heuristic) */
    source(atk, dfn) {
      if (this.simCell(atk, dfn, 1) !== null) return this.movesMatch(atk) && this.movesMatch(dfn) ? 'sim' : 'sim-default';
      return this.pub.has(atk + '|' + dfn) ? 'pub' : 'est';
    }
    movesMatch(id) {                            // does the moveset used for scoring equal the one the matrix was simulated with?
      const mx = this.mx; if (!mx || !mx.moves[id]) return true;
      const a = this.movesOf(id).filter(Boolean), b = mx.moves[id];
      return a[0] === b[0] && a.slice(1).slice().sort().join() === b.slice(1).slice().sort().join();
    }
    simCell(atk, dfn, s) {                      // matrix rating for scenario index s, using the transposed cell when only that exists
      const mx = this.mx; if (!mx) return null;
      const n = mx.scenarios.length, r = mx.rowIdx.get(atk), c = mx.colIdx.get(dfn);
      if (r !== undefined && c !== undefined) return mx.arr[(r * mx.cols.length + c) * n + s];
      const r2 = mx.rowIdx.get(dfn), c2 = mx.colIdx.get(atk);
      if (r2 !== undefined && c2 !== undefined) return 1000 - mx.arr[(r2 * mx.cols.length + c2) * n + s];
      return null;
    }
    scenarioIndex(sc) { const mx = this.mx; if (!mx) return 1; if (sc === undefined) return mx.scen.get('1-1') ?? 0; return typeof sc === 'number' ? sc : (mx.scen.get(sc) ?? 0); }
    pool() { return this.mx ? this.mx.cols : this.meta; }   // the opponents a matrix knows (meta group ∪ top of the rankings), else the meta group
    movesOf(id) { return (this.overrides[id] && this.overrides[id].length) ? this.overrides[id] : this.pokemon[id].moveset; }
    moveTypes(id) { return this.movesOf(id).filter(m => this.moves[m]).map(m => this.moves[m].t); }
    rating(atk, dfn, scenario) {
      const si = this.scenarioIndex(scenario), key = atk + '|' + dfn + (si === this.scenarioIndex() ? '' : '|' + si);
      if (this.cache.has(key)) return this.cache.get(key);
      let r;
      const sim = this.simCell(atk, dfn, si);
      if (sim !== null) r = sim;
      else if (this.pub.has(atk + '|' + dfn)) r = this.pub.get(atk + '|' + dfn);
      else {
        const A = this.pokemon[atk], D = this.pokemon[dfn];
        const off = Math.max(...this.moveTypes(atk).map(t => eff(t, D.types)));
        const dfs = Math.max(...this.moveTypes(dfn).map(t => eff(t, A.types)));
        r = 500 + 250 * Math.log2(off / dfs) + 10 * (A.score - D.score);
        r = Math.max(0, Math.min(1000, r));
      }
      this.cache.set(key, r);
      return r;
    }
    /* Roles from the simulated matrix over the pool: lead = best mean 1-1; safe switch = fewest 1-1 losses under 400; closer = best mean of 0-0 and 2-2. */
    simRoles(team) {
      if (!this.mx || team.length !== 3 || !this.mx.scen.has('0-0') || !this.mx.scen.has('2-2')) return null;
      const pool = this.pool().filter(o => !team.includes(o)), s11 = this.scenarioIndex('1-1'), s00 = this.scenarioIndex('0-0'), s22 = this.scenarioIndex('2-2');
      const stat = team.map(id => { let sum11 = 0, bad = 0, sumClose = 0, n = 0;
        for (const o of pool) { const a = this.simCell(id, o, s11); if (a === null) continue; n++; sum11 += a; if (a < 400) bad++; sumClose += (this.simCell(id, o, s00) + this.simCell(id, o, s22)) / 2; }
        return {id, lead: n ? sum11 / n : 0, bad, close: n ? sumClose / n : 0, n}; });
      if (stat.some(x => !x.n)) return null;
      const left = stat.slice(), pick = (key, asc) => { left.sort((a, b) => asc ? a[key] - b[key] : b[key] - a[key]); return left.shift(); };
      const sw = pick('bad', true), cl = pick('close', false), ld = left[0];
      return [{role: 'Lead', id: ld.id, why: `mean ${ld.lead.toFixed(0)} in 1-1`}, {role: 'Swap', id: sw.id, why: `${sw.bad} hard losses in 1-1`}, {role: 'Closer', id: cl.id, why: `mean ${cl.close.toFixed(0)} with 0 or 2 shields`}];
    }
    /* Pool Pokémon that beat every member (1-1), best first; each with the three ratings from the members' side. */
    threatList(team, limit) {
      const pool = this.pool(), out = [];
      for (const o of pool) { if (team.includes(o)) continue; const rs = team.map(m => this.rating(m, o)); const mx = Math.max(...rs); if (mx < 500) out.push({id: o, ratings: rs, worst: mx}); }
      out.sort((a, b) => a.worst - b.worst);
      return {threats: out.slice(0, limit || 10), count: out.length, pool: pool.length};
    }
    /* One opponent against the team in every scenario: [{id, ratings: {'0-0': r, '1-1': r, '2-2': r}, verdict}] */
    matchup(team, opp) {
      const scen = this.mx ? this.mx.scenarios : ['1-1'];
      return team.map(id => { const ratings = {}; for (const sc of scen) ratings[sc] = this.rating(id, opp, sc);
        const vals = Object.values(ratings), wins = vals.filter(v => v >= 500).length;
        const verdict = wins === vals.length ? 'wins' : wins === 0 ? 'loses' : 'shield-dependent';
        return {id, ratings, verdict, source: this.source(id, opp)}; });
    }
    label(id) {
      const e = this.pokemon[id], ms = this.movesOf(id);
      return {speciesId: id, name: e.name, rank: e.rank, score: e.score, types: e.types,
              fastMove: ms[0], chargedMoves: ms.slice(1), moveNames: ms.map(m => (this.moves[m] || {n: m}).n)};
    }
    evaluate(team) {
      const best = [], holes = [], shared = [];
      for (const o of this.meta) {
        const rs = team.map(p => this.rating(p, o));
        const r = Math.max(...rs);
        best.push(r);
        if (r < 500) holes.push(o);
        if (rs.filter(x => x < 400).length >= 2) shared.push(o);
      }
      const coverage = best.reduce((a, b) => a + b, 0) / best.length;
      const total = coverage - 12 * holes.length - 6 * shared.length;
      return {score: round1(total), coverage: round1(coverage), holes, shared};
    }
    describe(team, ev) {
      ev = ev || this.evaluate(team);
      return {teamScore: ev.score, coverage: ev.coverage, members: team.map(s => this.label(s)),
              unansweredMeta: ev.holes.map(o => this.pokemon[o].name),
              sharedWeaknesses: ev.shared.map(o => this.pokemon[o].name)};
    }
    scoredTrios(pool) {
      const out = [];
      for (const t of trios(pool.filter(p => this.has(p)))) out.push([this.evaluate(t), t]);
      out.sort((a, b) => b[0].score - a[0].score);
      return out;
    }
    bestTrios(pool, top) {
      return this.scoredTrios(pool).slice(0, top).map(([ev, t], i) => Object.assign({rank: i + 1}, this.describe(t, ev)));
    }
    marginal(candidates, basePool) {
      const out = [];
      for (const c of candidates) {
        if (!this.has(c)) continue;
        let best = null;
        for (const t of trios(basePool.filter(p => this.has(p)).concat([c]))) {
          if (!t.includes(c)) continue;
          const ev = this.evaluate(t);
          if (!best || ev.score > best[0].score) best = [ev, t];
        }
        if (best) out.push({speciesId: c, name: this.pokemon[c].name, rank: this.pokemon[c].rank,
                            score: this.pokemon[c].score, bestTrio: this.describe(best[1], best[0])});
      }
      out.sort((a, b) => b.bestTrio.teamScore - a.bestTrio.teamScore);
      return out;
    }
    disjointPairs(pool, top) {
      const scored = this.scoredTrios(pool).slice(0, 60);
      const pairs = [];
      for (let i = 0; i < scored.length; i++) {
        const [e1, t1] = scored[i], b1 = new Set(t1.map(baseSpecies));
        for (let j = i + 1; j < scored.length; j++) {
          const [e2, t2] = scored[j];
          if (t2.some(s => b1.has(baseSpecies(s)))) continue;
          pairs.push({weaker: Math.min(e1.score, e2.score), sum: e1.score + e2.score, t1, e1, t2, e2});
        }
      }
      pairs.sort((a, b) => (b.weaker - a.weaker) || (b.sum - a.sum));
      return pairs.slice(0, top).map((p, i) => ({rank: i + 1, weakerScore: p.weaker, combinedScore: round1(p.sum),
                                                 teams: [this.describe(p.t1, p.e1), this.describe(p.t2, p.e2)]}));
    }
    /* Full roster report, same shape as scripts/generate_roster_team_comps.py output. */
    report(roster, top) {
      top = top || 10;
      const owned = Object.keys(roster.owned || {}).filter(p => this.has(p));
      const pending = owned.concat(Object.keys(roster.pending || {}).filter(p => this.has(p) && !owned.includes(p)));
      const all = pending.concat(Object.keys(roster.candidates || {}).filter(p => this.has(p) && !pending.includes(p)));
      const tagged = [];
      for (const [name, team] of Object.entries(roster.tagged || {}))
        if (team.length === 3 && team.every(s => this.has(s))) tagged.push(Object.assign({name}, this.describe(team)));
      return {
        today: this.bestTrios(owned, top),
        pending: this.bestTrios(pending, top),
        candidates: this.bestTrios(all, top),
        marginal: this.marginal(Object.keys(roster.candidates || {}), pending),
        tagged,
        disjoint: {pending: this.disjointPairs(pending, top), candidates: this.disjointPairs(all, top)},
      };
    }
  }

  function fromRoster(data, roster, matrix) {
    const overrides = {};
    for (const blk of ['owned', 'pending', 'candidates'])
      for (const [k, v] of Object.entries(roster[blk] || {})) if (v && v.length) overrides[k] = v;
    return new League(data, overrides, matrix);
  }
  /* Move counts for a moveset: fast moves and turns to reach each charged move, and the count string ("3-3-2") over a cycle. */
  function counts(moves, movesetIds) {
    const f = moves[movesetIds[0]]; if (!f || !f.e || !f.tr) return null;
    const out = {fast: movesetIds[0], gain: f.e, turns: f.tr, charged: []};
    for (const c of movesetIds.slice(1)) { const m = moves[c]; if (!m || !m.e) continue; const cost = -m.e;
      const first = Math.ceil(cost / f.e), seq = []; let energy = 0;
      for (let i = 0; i < 4; i++) { let n = 0; while (energy < cost) { energy += f.e; n++; } energy -= cost; seq.push(n); }
      out.charged.push({id: c, cost, first, turns: first * f.tr, seq: seq.join('-')}); }
    return out;
  }

  return {League, fromRoster, trios, baseSpecies, eff, CHART, counts, decodeMatrix};
});
