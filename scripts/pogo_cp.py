#!/usr/bin/env python3
"""CP, level and power-up cost helpers for Pokemon GO PvP planning.

Base stats and the CP multiplier table are read from index.html (the same
data the scanner uses) and the power-up cost table matches its costTo().

Subcommands:
  cost SPECIES ATK DEF STA FROM TO          stardust/candy to power up FROM -> TO
  target SPECIES ATK DEF STA [--cap 1500]   level, CP and PvP rank at the league cap
  evolve-cap PRE EVO [--cap 1500]           which PRE-evolution CPs can still be
                                            evolved and stay under the cap
Examples:
  python3 scripts/pogo_cp.py cost mimikyu 15 15 12 15 23.5
  python3 scripts/pogo_cp.py target forretress 0 15 15
  python3 scripts/pogo_cp.py evolve-cap lickitung lickilicky --ivs 0 15 15
"""
import argparse
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_HTML = os.path.join(HERE, "..", "index.html")

# Official per-level power-up costs (index of level L covers L -> L+0.5 and L+0.5 -> L+1).
UP_CANDY = [1]*10 + [2]*10 + [3]*5 + [4]*5 + [6, 6, 8, 8, 10, 10, 12, 12, 15] + [0]*11
UP_DUST = [200, 200, 400, 400, 600, 600, 800, 800, 1000, 1000, 1300, 1300, 1600, 1600, 1900, 1900,
           2200, 2200, 2500, 2500, 3000, 3000, 3500, 3500, 4000, 4000, 4500, 4500, 5000, 5000,
           6000, 6000, 7000, 7000, 8000, 8000, 9000, 9000, 10000, 10000, 11000, 11000, 12000, 12000,
           13000, 13000, 14000, 14000, 15000]
UP_XL = [10, 10, 12, 12, 15, 15, 17, 17, 20, 20]

_DATA = None


def data():
    global _DATA
    if _DATA is None:
        html = open(INDEX_HTML, encoding="utf-8").read()
        m = re.search(r'<script id="pogodata" type="application/json">(.*?)</script>', html, re.S)
        _DATA = json.loads(m.group(1))
    return _DATA


def base_stats(species, form=0):
    """(atk, def, sta) for a species name like 'lickitung' or 'STUNFISK_GALARIAN'."""
    key = species.upper().replace(" ", "_")
    forms = data()["stats"].get(key)
    if forms is None:
        # PvPoke ids put the form after the species (stunfisk_galarian); try dropping it
        forms = data()["stats"].get(key.split("_")[0])
    if forms is None:
        sys.exit(f"unknown species: {species}")
    return tuple(forms[form][:3])


def cpm(level):
    t = data()["cpm"]
    i = int(math.floor(level)) - 1
    if level == math.floor(level):
        return t[i]
    return math.sqrt((t[i] ** 2 + t[i + 1] ** 2) / 2)


def cp(base, ivs, level):
    m = cpm(level)
    return max(10, math.floor((base[0] + ivs[0]) * math.sqrt(base[1] + ivs[1]) * math.sqrt(base[2] + ivs[2]) * m * m / 10))


def stat_product(base, ivs, level):
    m = cpm(level)
    return (base[0] + ivs[0]) * m * (base[1] + ivs[1]) * m * math.floor((base[2] + ivs[2]) * m)


def half_levels(lo=1.0, hi=51.0):
    n = int(round((hi - lo) * 2))
    return [lo + i / 2 for i in range(n + 1)]


def max_level_under_cap(base, ivs, cap, max_level=50.0):
    best = None
    for lv in half_levels(1.0, max_level):
        if cp(base, ivs, lv) <= cap:
            best = lv
        else:
            break
    return best


def powerup_cost(frm, to):
    dust = candy = xl = 0
    for step in range(int(frm * 2), int(to * 2)):
        idx = step // 2 - 1
        dust += UP_DUST[idx] if idx < len(UP_DUST) else 0
        c = UP_CANDY[idx] if idx < len(UP_CANDY) else 0
        if c > 0:
            candy += c
        else:
            xl += UP_XL[idx - 39] if 0 <= idx - 39 < len(UP_XL) else 20
    return {"dust": dust, "candy": candy, "xl": xl}


def pvp_rank(base, ivs, cap, max_level=50.0):
    """1-based rank of this IV spread among all 4096 at the cap (PvPoke-style, by stat product)."""
    prods = []
    for a in range(16):
        for d in range(16):
            for s in range(16):
                lv = max_level_under_cap(base, (a, d, s), cap, max_level)
                prods.append((stat_product(base, (a, d, s), lv) if lv else 0, (a, d, s)))
    prods.sort(reverse=True)
    mine = stat_product(base, ivs, max_level_under_cap(base, ivs, cap, max_level))
    rank = 1 + sum(1 for p, _ in prods if p > mine)
    return rank, prods[0]


def cmd_cost(a):
    base = base_stats(a.species)
    ivs = (a.atk, a.def_, a.sta)
    c = powerup_cost(a.frm, a.to)
    print(f"{a.species} {ivs}: level {a.frm} (CP {cp(base, ivs, a.frm)}) -> level {a.to} (CP {cp(base, ivs, a.to)})")
    print(f"  stardust {c['dust']:,}   candy {c['candy']}   XL candy {c['xl']}")


def cmd_target(a):
    base = base_stats(a.species)
    ivs = (a.atk, a.def_, a.sta)
    lv = max_level_under_cap(base, ivs, a.cap, a.max_level)
    rank, best = pvp_rank(base, ivs, a.cap, a.max_level)
    print(f"{a.species} {ivs} at cap {a.cap}: level {lv}, CP {cp(base, ivs, lv)}, "
          f"stat product {stat_product(base, ivs, lv):,.0f}, PvP rank #{rank}/4096 (rank 1 is {best[1]})")
    if a.from_level:
        c = powerup_cost(a.from_level, lv)
        print(f"  from level {a.from_level}: stardust {c['dust']:,}, candy {c['candy']}, XL {c['xl']}")


def cmd_evolve_cap(a):
    pre, evo = base_stats(a.pre), base_stats(a.evo)
    levels = half_levels(1.0, a.catch_max_level)
    if a.ivs:
        ivs = tuple(a.ivs)
        lv = max_level_under_cap(evo, ivs, a.cap, a.max_level)
        print(f"{a.pre} {ivs}: {a.evo} stays <= {a.cap} up to level {lv} "
              f"(CP {cp(evo, ivs, lv)}); {a.pre} is CP {cp(pre, ivs, lv)} at that level")
        rank, _ = pvp_rank(evo, ivs, a.cap, a.max_level)
        print(f"  {a.evo} PvP rank for these IVs: #{rank}/4096")
        print(f"  a wild {a.pre} with these IVs is usable if its CP is <= {cp(pre, ivs, lv)}; "
              f"caught lower, it costs power-ups to reach level {lv}")
        return
    # IV-agnostic: which pre-evolution CPs are safe whatever the IVs?
    ok_cps, bad_cps = [], []
    for aa in range(16):
        for dd in range(16):
            for ss in range(16):
                ivs = (aa, dd, ss)
                for lv in levels:
                    c_pre = cp(pre, ivs, lv)
                    (ok_cps if cp(evo, ivs, lv) <= a.cap else bad_cps).append(c_pre)
    safe = min(bad_cps) - 1        # every pre-evo at or below this CP evolves under the cap
    usable = max(ok_cps)           # above this no IV spread can still fit
    print(f"{a.pre} -> {a.evo}, cap {a.cap}, wild catches up to level {a.catch_max_level}:")
    print(f"  CP <= {safe}: always safe to evolve (any IVs)")
    print(f"  CP {safe + 1}..{usable}: depends on IVs, appraise first")
    print(f"  CP > {usable}: {a.evo} will exceed the cap, skip")
    for label, ivs in (("0/15/15", (0, 15, 15)), ("15/15/15", (15, 15, 15))):
        lv = max_level_under_cap(evo, ivs, a.cap, a.max_level)
        print(f"  {label}: {a.evo} maxes at level {lv} = CP {cp(evo, ivs, lv)}; {a.pre} would be CP {cp(pre, ivs, lv)} there")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("cost"); p.add_argument("species"); p.add_argument("atk", type=int); p.add_argument("def_", type=int)
    p.add_argument("sta", type=int); p.add_argument("frm", type=float); p.add_argument("to", type=float); p.set_defaults(f=cmd_cost)
    p = sub.add_parser("target"); p.add_argument("species"); p.add_argument("atk", type=int); p.add_argument("def_", type=int)
    p.add_argument("sta", type=int); p.add_argument("--cap", type=int, default=1500); p.add_argument("--max-level", type=float, default=50.0)
    p.add_argument("--from-level", type=float); p.set_defaults(f=cmd_target)
    p = sub.add_parser("evolve-cap"); p.add_argument("pre"); p.add_argument("evo"); p.add_argument("--cap", type=int, default=1500)
    p.add_argument("--max-level", type=float, default=40.0, help="highest level you can power up to (trainer level + 10, max 40 without XL)")
    p.add_argument("--catch-max-level", type=float, default=35.0, help="wild catches are level <= 30, 35 when weather boosted")
    p.add_argument("--ivs", type=int, nargs=3, metavar=("ATK", "DEF", "STA")); p.set_defaults(f=cmd_evolve_cap)
    a = ap.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
