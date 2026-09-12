#!/usr/bin/env python3
"""Build data/pve.json: the best raid attackers per attacking type, computed from the public Pokémon GO game master.

PvPoke covers PvP only. For raids the numbers that matter are DPS (damage per second) and TDO (total damage before
fainting), which we can compute ourselves from the game master published by PokeMiners (move power, duration and
energy; base stats; shadow, mega and regional forms; Elite TM-only moves).

Model (the usual GamePress-style estimate, no dodging, no weather):
  attacker      level 40, 15/15/15 IVs; shadow = attack x1.2, defence x0.8333; mega = the mega's own stats and types
  boss          a typical tier-5: base attack 250, base defence 200 at raid CPM, hitting with a neutral 100-power
                move every 2.5 s
  damage        floor(0.5 * power * atk / def * STAB) + 1, STAB 1.2 when the move shares a type with the attacker
  cycle DPS     (fast damage * n + charged damage) / (fast duration * n + charged duration), n = charged energy / fast energy
  TDO           attacker HP / incoming DPS * DPS
  ranking       DPS^3 * TDO ("ER"), the metric GamePress uses; both DPS and TDO are stored for display

Per type only combinations where the charged move has that type count; the fast move of the same type is preferred
and an off-type fast move is flagged. Type effectiveness is left out because it is identical for every attacker of a
type. The boss is assumed to be weak to the type (x1.6 on moves of that type, neutral on an off-type fast move), so
the lists mean "best attackers when the boss is weak to X", like Pokebattler's and GamePress's type lists. The
overall list leaves out Normal, since no boss is weak to it.

    python3 scripts/build_pve_data.py                 # data/pve.json
"""
import json
import math
import sys
import urllib.request
from pathlib import Path

GM_URL = "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json"
OUT = Path(__file__).resolve().parent.parent / "data" / "pve.json"
CPM40 = 0.7903
BOSS_ATK = (250 + 15) * CPM40
BOSS_DEF = (200 + 15) * CPM40
BOSS_POWER, BOSS_DUR = 100, 2.5
TOP_PER_TYPE = 40
TOP_OVERALL = 40
TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic",
         "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"]
REGIONAL = {"ALOLA": "alolan", "GALARIAN": "galarian", "HISUIAN": "hisuian", "PALDEA": "paldean"}
SPECIAL_FORM = {"MEWTWO_A": "armored"}
NOISE_FORMS = {"NORMAL", "PURIFIED", "SHADOW", "COSTUME", "COPY", "FALL", "WINTER", "SUMMER", "SPRING", "HOLIDAY",
               "GOFEST", "GOTOUR", "CHOSEN", "PARTY", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP",
               "OCT", "NOV", "DEC", "ORIGINAL", "PHD", "HALLOWEEN", "ETERNAMAX", "GIGANTAMAX", "DYNAMAX", "S", "T", "U", "V", "W", "X", "Y", "Z"}
SE = 1.6
EXCLUDED_MOVES = {"FRUSTRATION", "RETURN", "STRUGGLE", "SPLASH", "TRANSFORM", "YAWN"}


def fetch_json(url):
    print("fetching", url, file=sys.stderr)
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def pretty(word):
    return " ".join(w.capitalize() for w in word.lower().split("_")).replace("Mr Mime", "Mr. Mime").replace("Mime Jr", "Mime Jr.").replace("Ho Oh", "Ho-Oh").replace("Porygon Z", "Porygon-Z")


def move_name(mid):
    return pretty(mid[:-5] if mid.endswith("_FAST") else mid)


def form_suffix(pokemon_id, form):
    """PvPoke-style id suffix for a game-master form, or None when the form is cosmetic."""
    if not form or form == pokemon_id:
        return ""
    if form in SPECIAL_FORM:
        return SPECIAL_FORM[form]
    suffix = form[len(pokemon_id) + 1:] if form.startswith(pokemon_id + "_") else form
    if any(ch.isdigit() for ch in suffix):
        return None
    parts = suffix.split("_")
    if any(p in NOISE_FORMS for p in parts):
        return "" if parts == ["NORMAL"] else None
    if suffix in REGIONAL:
        return REGIONAL[suffix]
    return suffix.lower()


def damage(power, atk, dfn, stab, eff=1.0):
    return math.floor(0.5 * power * atk / dfn * (1.2 if stab else 1.0) * eff) + 1


def build(gm):
    moves = {}
    for t in gm:
        ms = t.get("data", {}).get("moveSettings")
        if not ms or not isinstance(ms.get("movementId"), str) or "power" not in ms or ms.get("energyDelta") is None or ms["movementId"] in EXCLUDED_MOVES:
            continue
        moves[ms["movementId"]] = {"type": ms["pokemonType"].replace("POKEMON_TYPE_", "").lower(), "power": ms["power"],
                                   "dur": ms["durationMs"] / 1000.0, "energy": ms["energyDelta"]}
    mons = {}

    def add(mid, name, species, types, stats, fast, charged, legacy, shadow=False, mega=False):
        if mid in mons or stats["baseAttack"] < 100:
            return
        mons[mid] = {"id": mid, "name": name, "species": species, "types": types, "stats": stats, "fast": fast, "charged": charged,
                     "legacy": legacy, "shadow": shadow, "mega": mega}

    for t in gm:
        ps = t.get("data", {}).get("pokemonSettings")
        if not ps or "stats" not in ps or not ps["stats"].get("baseAttack"):
            continue
        pid = ps["pokemonId"]
        suf = form_suffix(pid, ps.get("form", ""))
        if suf is None:
            continue
        base_id = pid.lower() + ("_" + suf if suf else "")
        types = [x.replace("POKEMON_TYPE_", "").lower() for x in [ps.get("type"), ps.get("type2")] if x]
        fast = [m for m in ps.get("quickMoves", []) + ps.get("eliteQuickMove", []) if isinstance(m, str) and m in moves]
        charged = [m for m in ps.get("cinematicMoves", []) + ps.get("eliteCinematicMove", []) if isinstance(m, str) and m in moves]
        legacy = [m for m in ps.get("eliteQuickMove", []) + ps.get("eliteCinematicMove", []) if isinstance(m, str) and m in moves]
        if not fast or not charged:
            continue
        form_label = f" ({pretty(suf)})" if suf else ""
        name = pretty(pid) + form_label
        add(base_id, name, pid, types, ps["stats"], fast, charged, legacy)
        if "shadow" in ps:
            add(base_id + "_shadow", pretty(pid) + (f" ({pretty(suf)}, Shadow)" if suf else " (Shadow)"), pid, types, ps["stats"], fast, charged, legacy, shadow=True)
        for ev in ps.get("tempEvoOverrides", []) or []:
            tid, st = ev.get("tempEvoId", ""), ev.get("stats")
            if not st or not st.get("baseAttack") or not tid.startswith("TEMP_EVOLUTION_"):
                continue
            kind = tid.replace("TEMP_EVOLUTION_", "").lower()          # mega, mega_x, mega_y, primal
            mtypes = [x.replace("POKEMON_TYPE_", "").lower() for x in [ev.get("typeOverride1"), ev.get("typeOverride2")] if x] or types
            add(base_id + "_" + kind, f"{pretty(pid)} ({pretty(kind)})", pid, mtypes, st, fast, charged, legacy, mega=True)

    rows_by_type = {t: [] for t in TYPES}
    for mon in mons.values():
        st = mon["stats"]
        atk = (st["baseAttack"] + 15) * CPM40 * (1.2 if mon["shadow"] else 1.0)
        dfn = (st["baseDefense"] + 15) * CPM40 * (0.8333 if mon["shadow"] else 1.0)
        hp = math.floor((st["baseStamina"] + 15) * CPM40)
        incoming = (0.5 * BOSS_POWER * BOSS_ATK / dfn + 1) / BOSS_DUR
        for ctype in TYPES:
            best = None
            for c in mon["charged"]:
                cm = moves[c]
                if cm["type"] != ctype or cm["energy"] >= 0:
                    continue
                dc = damage(cm["power"], atk, BOSS_DEF, ctype in mon["types"], SE)
                for f in mon["fast"]:
                    fm = moves[f]
                    if fm["energy"] <= 0:
                        continue
                    n = -cm["energy"] / fm["energy"]
                    off = fm["type"] != ctype
                    df = damage(fm["power"], atk, BOSS_DEF, fm["type"] in mon["types"], 1.0 if off else SE)
                    dps = (df * n + dc) / (fm["dur"] * n + cm["dur"])
                    tdo = hp / incoming * dps
                    er = dps ** 3 * tdo
                    if best is None or er > best["er"]:
                        best = {"er": er, "dps": dps, "tdo": tdo, "fast": f, "charged": c, "off": off}
            if best:
                rows_by_type[ctype].append({"id": mon["id"], "name": mon["name"], "species": mon["species"], "types": mon["types"],
                                            "fast": best["fast"], "charged": best["charged"], "offType": best["off"],
                                            "legacy": [m for m in (best["fast"], best["charged"]) if m in mon["legacy"]],
                                            "shadow": mon["shadow"], "mega": mon["mega"],
                                            "dps": round(best["dps"], 1), "tdo": round(best["tdo"]), "er": round(best["er"])})
    out_types = {}
    used_moves = set()
    for t in TYPES:
        rows = sorted(rows_by_type[t], key=lambda r: -r["er"])[:TOP_PER_TYPE]
        for r in rows:
            used_moves.update([r["fast"], r["charged"]])
        out_types[t] = rows
    overall = sorted((r for t, rows in rows_by_type.items() if t != "normal" for r in rows), key=lambda r: -r["er"])
    seen, top = set(), []
    for r in overall:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        top.append(dict(r, type=[m for m in [moves[r["charged"]]["type"]]][0]))
        if len(top) >= TOP_OVERALL:
            break
    for r in top:
        used_moves.update([r["fast"], r["charged"]])
    return {"types": out_types, "overall": top,
            "moves": {m: {"n": move_name(m), "t": moves[m]["type"]} for m in sorted(used_moves)},
            # every move's PvE numbers, so the app can rate any Pokémon's own moveset for raids (type, power, duration s, energy)
            "pvemoves": {m: {"t": v["type"], "p": v["power"], "d": v["dur"], "e": v["energy"]} for m, v in sorted(moves.items())},
            "model": {"attacker": "L40 15/15/15, shadow atk x1.2 / def x0.83", "boss": "tier-5 stand-in: 250 atk / 200 def, neutral 100-power move every 2.5 s",
                      "rank": "DPS^3 x TDO, boss weak to the type (x1.6)", "source": GM_URL}}


def build_evo(gm):
    """data/evo.json: evolution candy costs, which species exist as Shadow, purification costs. Ids like PvPoke's (vulpix, vulpix_alolan)."""
    evolve, shadow, purify = {}, set(), {}
    for t in gm:
        ps = t.get("data", {}).get("pokemonSettings")
        if not ps or not isinstance(ps.get("pokemonId"), str):
            continue
        pid = ps["pokemonId"]
        suf = form_suffix(pid, ps.get("form", ""))
        if suf is None:
            continue
        pid_l = pid.lower() + ("_" + suf if suf else "")
        for br in ps.get("evolutionBranch", []) or []:
            if not br.get("evolution") or br.get("temporaryEvolution"):
                continue
            to_suf = form_suffix(br["evolution"], br.get("form", "")) or ""
            to = br["evolution"].lower() + ("_" + to_suf if to_suf else "")
            entry = {"to": to, "candy": br.get("candyCost", 0)}
            if br.get("candyCostPurified"):
                entry["purified"] = br["candyCostPurified"]
            lst = evolve.setdefault(pid_l, [])
            if not any(x["to"] == to for x in lst):
                lst.append(entry)
        if "shadow" in ps:
            shadow.add(pid_l)
            sh = ps["shadow"]
            purify[pid_l] = {"dust": sh.get("purificationStardustNeeded", 0), "candy": sh.get("purificationCandyNeeded", 0)}
    return {"evolve": dict(sorted(evolve.items())), "shadow": sorted(shadow), "purify": dict(sorted(purify.items()))}


def main():
    gm = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else fetch_json(GM_URL)   # optional: a local copy of the game master
    evo = build_evo(gm)
    import datetime as _dt
    evo["generated"] = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")
    evo_path = OUT.parent / "evo.json"
    evo_path.write_text(json.dumps(evo, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote data/evo.json: {len(evo['evolve'])} evolving species, {len(evo['shadow'])} shadow-able, {evo_path.stat().st_size // 1024} KB", file=sys.stderr)
    data = build(gm)
    import datetime
    data["generated"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT.relative_to(OUT.parents[1])}: {sum(len(v) for v in data['types'].values())} rows over {len(data['types'])} types, {len(data['overall'])} overall, {OUT.stat().st_size // 1024} KB", file=sys.stderr)
    for t in ("dragon", "psychic", "ghost", "water"):
        print(f"  {t}: " + ", ".join(f"{r['name']} {r['dps']}/{r['tdo']}" for r in data["types"][t][:5]), file=sys.stderr)


if __name__ == "__main__":
    main()
