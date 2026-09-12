#!/usr/bin/env python3
"""Build the compact data file the web app loads (data/app-<league>.json).

Everything the page needs offline for one league: PvPoke rankings with
recommended moveset, published matchups/counters, move names and types,
the curated meta group, evolutions and second-move cost. The trio heuristic
in pvp.js consumes exactly this file.

Usage:
    python3 scripts/build_app_data.py                 # data/app-great.json
    python3 scripts/build_app_data.py --league ultra
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_pvpoke_rankings import GAMEMASTER_URL, LEAGUES, RAW, fetch_json, rankings_url  # noqa: E402
from generate_pvpoke_team_comps import League  # noqa: E402

GROUP_URL = RAW + "/groups/{league}.json"
THIRD_MOVE_CANDY = {10000: 25, 50000: 50, 75000: 75, 100000: 100}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", choices=sorted(LEAGUES), default="great")
    ap.add_argument("-o", "--output")
    # a GO Battle League cup instead of an open league: PvPoke cup slug + CP cap (+ optional title, meta group and output slug)
    ap.add_argument("--cup", help="PvPoke cup slug, e.g. willpower")
    ap.add_argument("--cp", type=int, help="CP cap of the cup, e.g. 1500")
    ap.add_argument("--title", help="display title, e.g. 'Willpower Cup'")
    ap.add_argument("--group", help="PvPoke meta group name (defaults to the cup slug; top 40 of the rankings when the group does not exist)")
    ap.add_argument("--slug", help="output slug: data/app-<slug>.json (defaults to <cup>-<cp>)")
    ap.add_argument("--rules", nargs="*", default=None, help="rule lines shown in the app")
    ap.add_argument("--gamemaster", help="path of an already downloaded gamemaster.min.json")
    args = ap.parse_args(argv)
    if args.cup:
        cp, cup = args.cp or 1500, args.cup
        slug = args.slug or f"{cup}-{cp}"
        title = args.title or f"{cup.title()} Cup"
        group_name = args.group or cup
    else:
        cp, title, cup = LEAGUES[args.league]
        slug, group_name = args.league, args.league
    out_path = args.output or f"data/app-{slug}.json"

    gm = json.load(open(args.gamemaster, encoding="utf-8")) if args.gamemaster else fetch_json(GAMEMASTER_URL)
    entries = fetch_json(rankings_url(cp, cup))
    try:
        group = fetch_json(GROUP_URL.format(league=group_name))
    except Exception as e:                      # no curated group for this cup: the top of its own rankings is the meta
        print(f"no meta group {group_name} ({e}); using the top 40 of the rankings", file=sys.stderr)
        group = [{"speciesId": e["speciesId"]} for e in entries[:40]]
    gm_pokemon = {p["speciesId"]: p for p in gm["pokemon"]}
    gm_moves = {m["moveId"]: m for m in gm["moves"]}

    ranked = {e["speciesId"] for e in entries}
    seen, meta = set(), []
    for g in group:
        if g["speciesId"] in ranked and g["speciesId"] not in seen:
            seen.add(g["speciesId"])
            meta.append(g["speciesId"])
    rank = {e["speciesId"]: i + 1 for i, e in enumerate(entries)}
    meta.sort(key=rank.get)

    used_moves = set()
    pokemon = {}
    for i, e in enumerate(entries):
        p = gm_pokemon.get(e["speciesId"], {})
        fast = [m["moveId"] for m in e.get("moves", {}).get("fastMoves", [])] or p.get("fastMoves", [])
        charged = [m["moveId"] for m in e.get("moves", {}).get("chargedMoves", [])] or p.get("chargedMoves", [])
        used_moves.update(e.get("moveset", []), fast, charged)
        # how often PvPoke's simulations pick each move, as a share of its slot (fast moves among fast, charged among charged)
        use = {}
        for key in ("fastMoves", "chargedMoves"):
            lst = e.get("moves", {}).get(key, [])
            tot = sum((m.get("uses") or 0) for m in lst) or 1
            for m in lst:
                if m.get("uses"):
                    use[m["moveId"]] = round(100 * m["uses"] / tot)
        entry = {
            "name": e.get("speciesName") or p.get("speciesName"),
            "dex": p.get("dex"),
            "types": [t for t in p.get("types", []) if t and t != "none"],
            "rank": i + 1,
            "score": e.get("score"),
            "moveset": e.get("moveset", []),
            "fast": fast,
            "charged": charged,
            "use": use,
            "matchups": [[m["opponent"], m["rating"]] + ([m["opRating"]] if "opRating" in m else [])
                         for m in e.get("matchups", [])],
            "counters": [[c["opponent"], c["rating"]] + ([c["opRating"]] if "opRating" in c else [])
                         for c in e.get("counters", [])],
        }
        evos = [x for x in p.get("family", {}).get("evolutions", []) if x in gm_pokemon]
        if evos:
            entry["evo"] = evos
        if p.get("thirdMoveCost"):
            entry["thirdMove"] = [p["thirdMoveCost"], THIRD_MOVE_CANDY.get(p["thirdMoveCost"], 0)]
        if p.get("buddyDistance"):
            entry["buddy"] = p["buddyDistance"]
        pokemon[e["speciesId"]] = entry

    # Evolutions may point at species outside the rankings (e.g. over the cap); keep a name for them.
    extra = {}
    for e in pokemon.values():
        for evo in e.get("evo", []):
            if evo not in pokemon and evo not in extra:
                gp = gm_pokemon[evo]
                extra[evo] = {"name": gp["speciesName"], "types": [t for t in gp["types"] if t != "none"]}

    # Benchmark for the score bar: best and median trio score over the top 40 of the meta group.
    league = League(slug, gm, entries, group)
    scores = sorted(ev["score"] for ev, _ in ((league.evaluate(list(t)), t)
                    for t in __import__("itertools").combinations([g["speciesId"] for g in league.meta[:40]], 3)
                    if len({x.replace("_shadow", "") for x in t}) == 3))
    benchmark = {"best": scores[-1], "median": scores[len(scores) // 2], "trios": len(scores)}
    prevo = {}
    for gp in gm["pokemon"]:                       # any pre-evolution, ranked or not (Sentret is not)
        if "shadow" in gp["speciesId"]:
            continue
        for evo in gp.get("family", {}).get("evolutions", []):
            if evo in pokemon:
                prevo.setdefault(evo, gp["speciesId"])
    # a ranked Shadow evolves from the Shadow of its pre-evolution (Ninetales (Shadow) <- Vulpix (Shadow)); PvPoke only lists non-shadow families
    for evo in list(pokemon):
        if evo.endswith("_shadow") and evo[:-7] in prevo:
            prevo.setdefault(evo, prevo[evo[:-7]] + "_shadow")
    for pre in set(prevo.values()):
        if pre not in pokemon and pre not in extra:
            base = pre[:-7] if pre.endswith("_shadow") else pre
            gp = gm_pokemon.get(pre) or gm_pokemon.get(base)
            if not gp:
                continue
            extra[pre] = {"name": gp["speciesName"] + (" (Shadow)" if pre.endswith("_shadow") and "Shadow" not in gp["speciesName"] else ""), "types": [t for t in gp["types"] if t != "none"]}

    # Derived meta teams (data/pvpoke-team-comps.json, produced by generate_pvpoke_team_comps.py)
    meta_teams = []
    comps_path = "data/pvpoke-team-comps.json"
    comps = []
    if os.path.exists(comps_path):
        with open(comps_path, encoding="utf-8") as f:
            comps = json.load(f).get("leagues", {}).get(slug, {}).get("teams", [])
    if not comps:                                # cups are not in the comps file: derive their teams here with the same heuristic
        comps, _ = league.best_teams(25, 40)
    for t in comps:
        meta_teams.append({"score": t["teamScore"], "members": [m["speciesId"] for m in t["members"]],
                           "holes": t.get("unansweredMeta", []), "shared": t.get("sharedWeaknesses", [])})

    result = {
        "league": {"slug": slug, "title": title, "cp": cp, "cup": cup, **({"rules": args.rules} if args.rules else {})},
        "benchmark": benchmark,
        "metaTeams": meta_teams,
        "prevo": prevo,
        "source": "https://pvpoke.com/rankings/",
        "gamemasterTimestamp": gm.get("timestamp"),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        # n name, t type, e energy (fast: gain per use, charged: cost as a negative number), tr turns per fast move, p power
        "moves": {m: {"n": gm_moves[m]["name"], "t": gm_moves[m]["type"], "p": gm_moves[m].get("power", 0),
                      "e": gm_moves[m].get("energyGain", 0) or -abs(gm_moves[m].get("energy", 0)),
                      **({"tr": max(1, round(gm_moves[m]["cooldown"] / 500))} if gm_moves[m].get("energyGain") else {})}
                  for m in sorted(used_moves) if m in gm_moves},
        "meta": meta,
        "pokemon": pokemon,
        "unranked": extra,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    print(f"wrote {out_path}: {len(pokemon)} pokemon, {len(meta)} meta, {len(result['moves'])} moves, "
          f"{os.path.getsize(out_path) // 1024} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
