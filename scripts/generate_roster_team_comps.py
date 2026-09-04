#!/usr/bin/env python3
"""Rank 3-Pokemon teams you can actually build, using the same heuristic as
generate_pvpoke_team_comps.py but drawn from your own roster instead of the
top of the meta.

Input is a roster file (default data/roster-<league>.json) with four blocks:

  owned       speciesId -> moveset (or null for PvPoke's recommended moves)
  pending     Pokemon one item/evolution away (e.g. Lickilicky before the stone)
  candidates  wild pickups you are considering
  tagged      named teams to score as-is (e.g. the parties tagged in-game)

Output has four sections:

  today       best trios from owned only
  pending     best trios from owned + pending
  candidates  best trios from owned + pending + candidates
  marginal    per candidate: rank, and the best trio that includes it, so you
              can see which pickup moves the needle
  tagged      score of each named team

Usage:
    python3 scripts/generate_roster_team_comps.py
    python3 scripts/generate_roster_team_comps.py --league great --top 10 --pretty
"""
import argparse
import itertools
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_pvpoke_rankings import GAMEMASTER_URL, LEAGUES, RAW, fetch_json, rankings_url  # noqa: E402
from generate_pvpoke_team_comps import League, base_species  # noqa: E402

GROUP_URL = RAW + "/groups/{league}.json"


def trios(pool):
    for team in itertools.combinations(pool, 3):
        if len({base_species(s) for s in team}) == 3:
            yield team


def describe(league, team, ev):
    return {
        "teamScore": ev["score"],
        "coverage": ev["coverage"],
        "members": [league.label(s) for s in team],
        "unansweredMeta": [league.entry[o]["speciesName"] for o in ev["holes"]],
        "sharedWeaknesses": [league.entry[o]["speciesName"] for o in ev["sharedWeaknesses"]],
    }


def best_from(league, pool, top):
    scored = [(league.evaluate(t), t) for t in trios(pool)]
    scored.sort(key=lambda r: -r[0]["score"])
    return [dict(rank=i + 1, **describe(league, t, ev)) for i, (ev, t) in enumerate(scored[:top])]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", choices=sorted(LEAGUES), default="great")
    ap.add_argument("-r", "--roster", help="roster json (default data/roster-<league>.json)")
    ap.add_argument("-o", "--output", help="output json (default data/roster-team-comps-<league>.json)")
    ap.add_argument("--top", type=int, default=10, help="teams to keep per section")
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args(argv)

    roster_path = args.roster or f"data/roster-{args.league}.json"
    out_path = args.output or f"data/roster-team-comps-{args.league}.json"
    with open(roster_path, encoding="utf-8") as f:
        roster = json.load(f)

    cp, title, cup = LEAGUES[args.league]
    print(f"fetching PvPoke data for {title}", file=sys.stderr)
    gm = fetch_json(GAMEMASTER_URL)
    entries = fetch_json(rankings_url(cp, cup))
    group = fetch_json(GROUP_URL.format(league=args.league))

    owned = roster.get("owned", {})
    pending = roster.get("pending", {})
    candidates = roster.get("candidates", {})
    overrides = {k: v for blk in (owned, pending, candidates) for k, v in blk.items() if v}
    league = League(args.league, gm, entries, group, overrides)

    known = set(league.entry)
    for blk in (owned, pending, candidates):
        for sid in list(blk):
            if sid not in known:
                print(f"  warning: {sid} not in PvPoke {title} rankings, skipped", file=sys.stderr)
                blk.pop(sid)

    p_owned = list(owned)
    p_pending = p_owned + list(pending)
    p_all = p_pending + list(candidates)

    marginal = []
    for c in candidates:
        best = max(((league.evaluate(t), t) for t in trios(p_pending + [c]) if c in t),
                   key=lambda r: r[0]["score"], default=None)
        if best:
            marginal.append({"speciesId": c, "name": league.entry[c]["speciesName"],
                             "rank": league.rank[c], "score": league.entry[c]["score"],
                             "bestTrio": describe(league, best[1], best[0])})
    marginal.sort(key=lambda m: -m["bestTrio"]["teamScore"])

    tagged = []
    for name, team in roster.get("tagged", {}).items():
        if all(s in known for s in team) and len(team) == 3:
            tagged.append(dict(name=name, **describe(league, team, league.evaluate(team))))

    result = {
        "league": args.league,
        "title": title,
        "roster": roster_path,
        "gamemasterTimestamp": gm.get("timestamp"),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": "Same heuristic as generate_pvpoke_team_comps.py, restricted to the roster file. "
                  "Team scores are comparable with data/pvpoke-team-comps.json and the community-teams analysis.",
        "today": best_from(league, p_owned, args.top),
        "pending": best_from(league, p_pending, args.top),
        "candidates": best_from(league, p_all, args.top),
        "marginal": marginal,
        "tagged": tagged,
    }

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1 if args.pretty else None,
                  separators=None if args.pretty else (",", ":"), ensure_ascii=False)
        f.write("\n")

    def line(t):
        return f"{t['teamScore']:6.1f}  " + " / ".join(m["name"] for m in t["members"])
    print(f"\n{title} — today", file=sys.stderr)
    for t in result["today"][:5]:
        print("  " + line(t), file=sys.stderr)
    print("marginal value of candidates", file=sys.stderr)
    for m in marginal:
        print(f"  {m['name']:<14} #{m['rank']:<4} {line(m['bestTrio'])}", file=sys.stderr)
    print(f"wrote {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
