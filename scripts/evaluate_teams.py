#!/usr/bin/env python3
"""Score hand-picked teams (e.g. from a video or Twitter) against the PvPoke meta.

Reads a team file like data/community-teams-great.json, scores every team with
the same heuristic as generate_pvpoke_team_comps.py, shows where each team
would land among the derived top teams, and for teams missing a member
suggests the best third Pokemon from the meta pool.

Usage:
    python3 scripts/evaluate_teams.py data/community-teams-great.json
    python3 scripts/evaluate_teams.py data/community-teams-great.json -o data/community-teams-great-analysis.json
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_pvpoke_rankings import GAMEMASTER_URL, LEAGUES, fetch_json, rankings_url  # noqa: E402
from generate_pvpoke_team_comps import GROUP_URL, League, base_species  # noqa: E402


def team_ids(team):
    return [m["speciesId"] for m in team["members"]]


def suggest_third(league, pair, pool):
    best = None
    for cand in pool:
        if base_species(cand) in {base_species(p) for p in pair}:
            continue
        ev = league.evaluate(pair + [cand])
        if best is None or ev["score"] > best[0]:
            best = (ev["score"], cand, ev)
    return best


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("teams_file")
    ap.add_argument("-o", "--output")
    ap.add_argument("--comps", default="data/pvpoke-team-comps.json", help="derived top teams to compare against")
    ap.add_argument("--pool", type=int, default=40)
    args = ap.parse_args(argv)

    spec = json.load(open(args.teams_file, encoding="utf-8"))
    slug = spec["league"]
    cp, title, cup = LEAGUES[slug]

    # Video movesets override PvPoke's recommended movesets for the video Pokemon only.
    overrides = {}
    for t in spec["teams"]:
        for m in t["members"]:
            if m.get("moves"):
                overrides[m["speciesId"]] = m["moves"]

    gm = fetch_json(GAMEMASTER_URL)
    entries = fetch_json(rankings_url(cp, cup))
    group = fetch_json(GROUP_URL.format(league=slug))
    league = League(slug, gm, entries, group, move_overrides=overrides)
    pool = [g["speciesId"] for g in league.meta[: args.pool]]

    # Score distribution of every trio from the meta pool, for a fair percentile.
    import itertools
    all_scores = []
    for trio in itertools.combinations(pool, 3):
        if len({base_species(x) for x in trio}) == 3:
            all_scores.append(league.evaluate(list(trio))["score"])
    all_scores.sort()

    def percentile(score):
        """Share of all pool trios this team scores at or above (0-100)."""
        import bisect
        return round(100.0 * bisect.bisect_left(all_scores, score) / len(all_scores), 1)

    derived = []
    if os.path.exists(args.comps):
        derived = json.load(open(args.comps, encoding="utf-8"))["leagues"][slug]["teams"]
    derived_scores = [t["teamScore"] for t in derived]

    def position(score):
        """1-based position this score would take in the derived top list, or None if below it."""
        better = sum(1 for s in derived_scores if s > score)
        return better + 1 if derived_scores and score >= derived_scores[-1] else None

    results = []
    for t in spec["teams"]:
        ids = team_ids(t)
        members = []
        for m in t["members"]:
            lab = league.label(m["speciesId"])
            lab["role"] = m.get("role")
            lab["inMetaGroup"] = m["speciesId"] in {g["speciesId"] for g in league.meta}
            if m.get("note"):
                lab["note"] = m["note"]
            members.append(lab)
        r = {"id": t["id"], "name": t["name"], "members": members}
        if len(ids) == 3:
            ev = league.evaluate(ids)
            r.update({
                "teamScore": ev["score"], "coverage": ev["coverage"],
                "positionInDerivedTop": position(ev["score"]),
                "percentileOfPoolTrios": percentile(ev["score"]),
                "unansweredMeta": [league.entry[o]["speciesName"] for o in ev["holes"]],
                "sharedWeaknesses": [league.entry[o]["speciesName"] for o in ev["sharedWeaknesses"]],
            })
            alts = []
            for m in t["members"]:
                for alt in m.get("alternatives", []):
                    alt_ids = [alt if x == m["speciesId"] else x for x in ids]
                    ev2 = league.evaluate(alt_ids)
                    alts.append({"replace": m["speciesId"], "with": alt, "teamScore": ev2["score"],
                                 "unansweredMeta": [league.entry[o]["speciesName"] for o in ev2["holes"]]})
            if alts:
                r["alternatives"] = alts
        else:
            r["incomplete"] = t.get("incomplete")
            best = suggest_third(league, ids, pool)
            if best:
                score, cand, ev = best
                r["suggestedThird"] = {"speciesId": cand, "name": league.entry[cand]["speciesName"],
                                       "rank": league.rank[cand], "teamScore": score,
                                       "unansweredMeta": [league.entry[o]["speciesName"] for o in ev["holes"]]}
        results.append(r)

    out = {
        "league": slug, "title": title,
        "source": spec.get("source"),
        "gamemasterTimestamp": gm.get("timestamp"),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "derivedTopScoreRange": [derived_scores[0], derived_scores[-1]] if derived_scores else None,
        "poolTrioScoreRange": [all_scores[0], all_scores[-1]],
        "poolTrioMedian": all_scores[len(all_scores) // 2],
        "poolTrios": len(all_scores),
        "method": "Same heuristic as generate_pvpoke_team_comps.py, using the video's movesets for the video Pokemon.",
        "teams": results,
    }
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print(f"wrote {args.output}", file=sys.stderr)

    # Console summary
    print(f"{title}: derived top-{len(derived_scores)} team scores {out['derivedTopScoreRange']}; "
          f"{len(all_scores)} pool trios, median {out['poolTrioMedian']}, range {out['poolTrioScoreRange']}")
    for r in results:
        names = ", ".join(f"{m['name']} (#{m['rank']})" for m in r["members"])
        if "teamScore" in r:
            pos = r["positionInDerivedTop"]
            print(f"\n{r['id']:>2}. {r['name']}\n    {names}\n    score {r['teamScore']}  "
                  f"(better than {r['percentileOfPoolTrios']}% of pool trios; "
                  f"{'would be #' + str(pos) + ' in derived list' if pos else 'below derived top 25'})\n"
                  f"    unanswered: {', '.join(r['unansweredMeta']) or '-'}\n"
                  f"    shared weaknesses: {', '.join(r['sharedWeaknesses']) or '-'}")
            for a in r.get("alternatives", []):
                print(f"    alt {a['replace']} -> {a['with']}: score {a['teamScore']}")
        else:
            s = r.get("suggestedThird")
            print(f"\n{r['id']:>2}. {r['name']} (incomplete: {r['incomplete']})\n    {names}")
            if s:
                print(f"    best third from meta pool: {s['name']} (#{s['rank']}) -> score {s['teamScore']}")


if __name__ == "__main__":
    main()
