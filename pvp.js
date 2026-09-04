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

  class League {
    constructor(data, overrides) {
      this.data = data;
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
    movesOf(id) { return (this.overrides[id] && this.overrides[id].length) ? this.overrides[id] : this.pokemon[id].moveset; }
    moveTypes(id) { return this.movesOf(id).filter(m => this.moves[m]).map(m => this.moves[m].t); }
    rating(atk, dfn) {
      const key = atk + '|' + dfn;
      if (this.cache.has(key)) return this.cache.get(key);
      let r;
      if (this.pub.has(key)) r = this.pub.get(key);
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

  function fromRoster(data, roster) {
    const overrides = {};
    for (const blk of ['owned', 'pending', 'candidates'])
      for (const [k, v] of Object.entries(roster[blk] || {})) if (v && v.length) overrides[k] = v;
    return new League(data, overrides);
  }

  return {League, fromRoster, trios, baseSpecies, eff, CHART};
});
