#!/usr/bin/env python3
"""Generate a compact JSON list of PvPoke rankings (https://pvpoke.com/rankings/).

pvpoke.com renders its rankings pages from JSON files that are published in the
open-source PvPoke repository, so this script pulls those files and flattens
them into one easy-to-consume list per league.

Usage:
    python3 scripts/generate_pvpoke_rankings.py            # writes data/pvpoke-rankings.json
    python3 scripts/generate_pvpoke_rankings.py -o out.json
    python3 scripts/generate_pvpoke_rankings.py --leagues great ultra --limit 100

No third-party dependencies (standard library only).
"""
import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone

RAW = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data"
GAMEMASTER_URL = f"{RAW}/gamemaster.min.json"

# League slug -> (CP cap, human title, PvPoke cup). "overall" category is what
# https://pvpoke.com/rankings/ shows by default for each league. Little League
# on pvpoke.com is the "little" cup (pvpoke.com/rankings/little/500/overall/).
LEAGUES = {
    "little": (500, "Little League", "little"),
    "great": (1500, "Great League", "all"),
    "ultra": (2500, "Ultra League", "all"),
    "master": (10000, "Master League", "all"),
}
# Order of the per-scenario scores in each ranking entry's "scores" array
# (matches the Lead / Closer / Switch / Charger / Attacker / Consistency hexagon
# shown on pvpoke.com).
SCENARIOS = ["leads", "closers", "switches", "chargers", "attackers", "consistency"]


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "pokescan-rankings/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def rankings_url(cp, cup="all", category="overall"):
    return f"{RAW}/rankings/{cup}/{category}/rankings-{cp}.json"


def build_league(entries, pokemon_by_id, moves_by_id, limit=None):
    out = []
    for i, e in enumerate(entries):
        if limit and i >= limit:
            break
        p = pokemon_by_id.get(e["speciesId"], {})
        moveset = e.get("moveset") or []
        fast = moveset[:1]
        charged = moveset[1:]
        scores = e.get("scores") or []
        item = {
            "rank": i + 1,
            "speciesId": e["speciesId"],
            "name": e.get("speciesName") or p.get("speciesName"),
            "dex": p.get("dex"),
            "types": [t for t in p.get("types", []) if t and t != "none"],
            "score": e.get("score"),
            "rating": e.get("rating"),
            "fastMove": fast[0] if fast else None,
            "chargedMoves": charged,
            "moveNames": [moves_by_id.get(m, {}).get("name", m) for m in moveset],
            "scenarioScores": {s: scores[k] for k, s in enumerate(SCENARIOS) if k < len(scores)},
            "stats": e.get("stats"),
        }
        if "editorScore" in e:
            item["editorScore"] = e["editorScore"]
        out.append(item)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--output", default="data/pvpoke-rankings.json")
    ap.add_argument("--leagues", nargs="+", choices=sorted(LEAGUES), default=["great", "ultra", "master", "little"])
    ap.add_argument("--limit", type=int, default=None, help="only keep the top N per league")
    ap.add_argument("--pretty", action="store_true", help="indent the output JSON")
    args = ap.parse_args(argv)

    print(f"fetching {GAMEMASTER_URL}", file=sys.stderr)
    gm = fetch_json(GAMEMASTER_URL)
    pokemon_by_id = {p["speciesId"]: p for p in gm["pokemon"]}
    moves_by_id = {m["moveId"]: m for m in gm["moves"]}

    result = {
        "source": "https://pvpoke.com/rankings/",
        "dataSource": RAW,
        "gamemasterTimestamp": gm.get("timestamp"),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "leagues": {},
    }
    for slug in args.leagues:
        cp, title, cup = LEAGUES[slug]
        url = rankings_url(cp, cup)
        print(f"fetching {url}", file=sys.stderr)
        entries = fetch_json(url)
        result["leagues"][slug] = {
            "title": title,
            "cp": cp,
            "cup": cup,
            "count": min(len(entries), args.limit) if args.limit else len(entries),
            "rankings": build_league(entries, pokemon_by_id, moves_by_id, args.limit),
        }
        print(f"  {title}: {len(entries)} pokemon", file=sys.stderr)

    with open(args.output, "w", encoding="utf-8") as f:
        if args.pretty:
            json.dump(result, f, indent=1, ensure_ascii=False)
        else:
            json.dump(result, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    print(f"wrote {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
