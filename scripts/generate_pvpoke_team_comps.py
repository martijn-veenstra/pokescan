#!/usr/bin/env python3
"""Derive "best team comps" (3-Pokemon teams) per league from PvPoke data.

PvPoke (https://pvpoke.com) does not publish a ranked list of teams; its Team
Builder simulates whatever team you enter in the browser. This script builds
one from the data PvPoke does publish:

  * the overall rankings (score, recommended moveset, top matchups/counters)
  * the curated meta group per league (data/groups/<league>.json), which is
    the default opponent pool PvPoke's Team Builder scores against

For every candidate trio drawn from the meta group, each member is scored
against every Pokemon in the meta group. Where PvPoke publishes a simulated
battle rating for that pairing (in "matchups"/"counters"), that rating is
used. Otherwise the rating is estimated from type effectiveness of both
sides' movesets plus the difference in ranking score. A team's coverage is
the average, over the meta, of its best member's rating; teams lose points
for every meta Pokemon none of them handles and for stacking the same
weaknesses.

The result is a heuristic, not a PvPoke simulation. Treat it as a shortlist.

Usage:
    python3 scripts/generate_pvpoke_team_comps.py               # -> data/pvpoke-team-comps.json
    python3 scripts/generate_pvpoke_team_comps.py --top 50 --leagues great ultra
"""
import argparse
import itertools
import json
import math
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_pvpoke_rankings import GAMEMASTER_URL, LEAGUES, RAW, fetch_json, rankings_url  # noqa: E402

GROUP_URL = RAW + "/groups/{league}.json"

# Pokemon GO type chart: multiplier for attack type -> defending type.
SE, NVE, IMM = 1.6, 0.625, 0.390625
CHART = {
    "normal":   {"rock": NVE, "steel": NVE, "ghost": IMM},
    "fire":     {"grass": SE, "ice": SE, "bug": SE, "steel": SE, "fire": NVE, "water": NVE, "rock": NVE, "dragon": NVE},
    "water":    {"fire": SE, "ground": SE, "rock": SE, "water": NVE, "grass": NVE, "dragon": NVE},
    "electric": {"water": SE, "flying": SE, "electric": NVE, "grass": NVE, "dragon": NVE, "ground": IMM},
    "grass":    {"water": SE, "ground": SE, "rock": SE, "fire": NVE, "grass": NVE, "poison": NVE, "flying": NVE, "bug": NVE, "dragon": NVE, "steel": NVE},
    "ice":      {"grass": SE, "ground": SE, "flying": SE, "dragon": SE, "fire": NVE, "water": NVE, "ice": NVE, "steel": NVE},
    "fighting": {"normal": SE, "ice": SE, "rock": SE, "dark": SE, "steel": SE, "poison": NVE, "flying": NVE, "psychic": NVE, "bug": NVE, "fairy": NVE, "ghost": IMM},
    "poison":   {"grass": SE, "fairy": SE, "poison": NVE, "ground": NVE, "rock": NVE, "ghost": NVE, "steel": IMM},
    "ground":   {"fire": SE, "electric": SE, "poison": SE, "rock": SE, "steel": SE, "grass": NVE, "bug": NVE, "flying": IMM},
    "flying":   {"grass": SE, "fighting": SE, "bug": SE, "electric": NVE, "rock": NVE, "steel": NVE},
    "psychic":  {"fighting": SE, "poison": SE, "psychic": NVE, "steel": NVE, "dark": IMM},
    "bug":      {"grass": SE, "psychic": SE, "dark": SE, "fire": NVE, "fighting": NVE, "poison": NVE, "flying": NVE, "ghost": NVE, "steel": NVE, "fairy": NVE},
    "rock":     {"fire": SE, "ice": SE, "flying": SE, "bug": SE, "fighting": NVE, "ground": NVE, "steel": NVE},
    "ghost":    {"psychic": SE, "ghost": SE, "dark": NVE, "normal": IMM},
    "dragon":   {"dragon": SE, "steel": NVE, "fairy": IMM},
    "dark":     {"psychic": SE, "ghost": SE, "fighting": NVE, "dark": NVE, "fairy": NVE},
    "steel":    {"ice": SE, "rock": SE, "fairy": SE, "fire": NVE, "water": NVE, "electric": NVE, "steel": NVE},
    "fairy":    {"fighting": SE, "dragon": SE, "dark": SE, "fire": NVE, "poison": NVE, "steel": NVE},
}


def effectiveness(move_type, def_types):
    m = 1.0
    for t in def_types:
        m *= CHART.get(move_type, {}).get(t, 1.0)
    return m


def base_species(species_id):
    return species_id.replace("_shadow", "")


class League:
    def __init__(self, slug, gm, entries, group, move_overrides=None):
        self.slug = slug
        self.move_overrides = dict(move_overrides or {})
        self.pokemon = {p["speciesId"]: p for p in gm["pokemon"]}
        self.moves = {m["moveId"]: m for m in gm["moves"]}
        self.rank = {e["speciesId"]: i + 1 for i, e in enumerate(entries)}
        self.entry = {e["speciesId"]: e for e in entries}
        # Meta pool: PvPoke's curated group (one entry per species; the group
        # can list a species twice with alternate movesets), ordered by ranking.
        seen = set()
        self.meta = []
        for g in group:
            if g["speciesId"] in self.entry and g["speciesId"] not in seen:
                seen.add(g["speciesId"])
                self.meta.append(g)
        self.meta.sort(key=lambda g: self.rank[g["speciesId"]])
        # Published simulated ratings: (attacker, defender) -> rating 0..1000
        self.published = {}
        for e in entries:
            for m in e.get("matchups", []):
                self.published[(e["speciesId"], m["opponent"])] = m["rating"]
                if "opRating" in m:
                    self.published[(m["opponent"], e["speciesId"])] = m["opRating"]
            for c in e.get("counters", []):
                self.published[(e["speciesId"], c["opponent"])] = c["rating"]
                if "opRating" in c:
                    self.published[(c["opponent"], e["speciesId"])] = c["opRating"]
        # Fill in inverses where only one direction is known.
        for (a, d), r in list(self.published.items()):
            self.published.setdefault((d, a), 1000 - r)
        self._cache = {}

    def types(self, sid):
        return [t for t in self.pokemon[sid]["types"] if t and t != "none"]

    def moves_of(self, sid):
        """Moveset used for sid: an override if given, else PvPoke's recommended moveset."""
        return list(self.move_overrides.get(sid) or self.entry[sid]["moveset"])

    def move_types(self, sid):
        return [self.moves[m]["type"] for m in self.moves_of(sid) if m in self.moves]

    def rating(self, atk, dfn):
        """Estimated battle rating (0..1000) of atk vs dfn."""
        key = (atk, dfn)
        if key in self._cache:
            return self._cache[key]
        if key in self.published:
            r = self.published[key]
            source = "pvpoke"
        else:
            off = max(effectiveness(t, self.types(dfn)) for t in self.move_types(atk))
            dfs = max(effectiveness(t, self.types(atk)) for t in self.move_types(dfn))
            r = 500 + 250 * math.log2(off / dfs)
            r += 10 * (self.entry[atk]["score"] - self.entry[dfn]["score"])
            r = max(0, min(1000, r))
            source = "estimate"
        self._cache[key] = r
        return r

    def label(self, sid):
        e = self.entry[sid]
        ms = self.moves_of(sid)
        return {
            "speciesId": sid,
            "name": e["speciesName"],
            "rank": self.rank[sid],
            "score": e["score"],
            "types": self.types(sid),
            "fastMove": ms[0],
            "chargedMoves": ms[1:],
            "moveNames": [self.moves.get(m, {}).get("name", m) for m in ms],
        }

    def evaluate(self, team):
        opponents = [g["speciesId"] for g in self.meta]
        best = []
        holes, handled_by = [], {}
        for o in opponents:
            rs = [(self.rating(p, o), p) for p in team]
            r, who = max(rs)
            best.append(r)
            if r < 500:
                holes.append(o)
            handled_by[o] = who
        coverage = sum(best) / len(best)
        # Shared weaknesses: meta Pokemon clearly beating (rating < 400) two or more members.
        shared = [o for o in opponents if sum(self.rating(p, o) < 400 for p in team) >= 2]
        total = coverage - 12 * len(holes) - 6 * len(shared)
        return {
            "score": round(total, 1),
            "coverage": round(coverage, 1),
            "holes": holes,
            "sharedWeaknesses": shared,
        }

    def best_teams(self, top, pool_size):
        pool = [g["speciesId"] for g in self.meta[:pool_size]]
        results = []
        for team in itertools.combinations(pool, 3):
            if len({base_species(s) for s in team}) < 3:
                continue  # no duplicate species (shadow + regular)
            ev = self.evaluate(team)
            results.append((ev["score"], team, ev))
        results.sort(key=lambda r: -r[0])
        out = []
        for i, (score, team, ev) in enumerate(results[:top]):
            out.append({
                "rank": i + 1,
                "teamScore": ev["score"],
                "coverage": ev["coverage"],
                "members": [self.label(s) for s in team],
                "unansweredMeta": [self.entry[o]["speciesName"] for o in ev["holes"]],
                "sharedWeaknesses": [self.entry[o]["speciesName"] for o in ev["sharedWeaknesses"]],
            })
        return out, pool


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--output", default="data/pvpoke-team-comps.json")
    ap.add_argument("--leagues", nargs="+", choices=sorted(LEAGUES), default=["great", "ultra", "master", "little"])
    ap.add_argument("--top", type=int, default=25, help="teams to keep per league")
    ap.add_argument("--pool", type=int, default=40, help="candidates: top N ranked Pokemon of the meta group")
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args(argv)

    print(f"fetching {GAMEMASTER_URL}", file=sys.stderr)
    gm = fetch_json(GAMEMASTER_URL)
    result = {
        "source": "https://pvpoke.com/rankings/ + https://pvpoke.com/team-builder/ meta groups",
        "dataSource": RAW,
        "gamemasterTimestamp": gm.get("timestamp"),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": (
            "Heuristic, not a PvPoke simulation. Each member is rated against every Pokemon in PvPoke's "
            "curated meta group using PvPoke's published matchup/counter ratings where available and a "
            "type-effectiveness + ranking-score estimate otherwise. teamScore = mean best-member rating "
            "across the meta, minus 12 per unanswered meta Pokemon (no member rated above 500) and 6 per meta "
            "Pokemon that clearly beats (rating below 400) two or more members. Ratings are on PvPoke's 0-1000 battle-rating scale (500 = even)."
        ),
        "leagues": {},
    }
    for slug in args.leagues:
        cp, title, cup = LEAGUES[slug]
        print(f"fetching rankings + meta group for {title}", file=sys.stderr)
        entries = fetch_json(rankings_url(cp, cup))
        group = fetch_json(GROUP_URL.format(league=slug))
        league = League(slug, gm, entries, group)
        teams, pool = league.best_teams(args.top, args.pool)
        result["leagues"][slug] = {
            "title": title,
            "cp": cp,
            "cup": cup,
            "metaGroupSize": len(league.meta),
            "candidatePool": pool,
            "teams": teams,
        }
        print(f"  {title}: {len(teams)} teams from {len(pool)} candidates", file=sys.stderr)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1 if args.pretty else None,
                  separators=None if args.pretty else (",", ":"), ensure_ascii=False)
        f.write("\n")
    print(f"wrote {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
