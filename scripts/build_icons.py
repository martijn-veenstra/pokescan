#!/usr/bin/env python3
"""Build the Pokémon icon set: one 96×96 WebP per PvPoke speciesId under icons/pokemon/, from the game's own renders in the
PokeMiners asset dump (https://github.com/PokeMiners/pogo_assets, Images/Pokemon - 256x256/Addressable Assets).

    python3 scripts/build_icons.py                # every species in the PvPoke gamemaster; skips icons that already exist
    python3 scripts/build_icons.py --force        # redraw everything
    python3 scripts/build_icons.py --check        # exit 1 when more than 3 % of the ids in data/app-*.json have no icon

PokeMiners names files pm{dex}[.f{FORM}][.s].icon.png. The form part is not always PvPoke's suffix (fTEN_PERCENT for
zygarde_10, fPOMPOM for oricorio_pom_pom, fGALARIAN_STANDARD for darmanitan_galarian_standard) and some species only exist
with a form (Mimikyu is fBUSTED / fDISGUISED, Indeedee fFEMALE / fMALE), so each id tries a list of candidate names until one
answers 200. Shadow ids (…_shadow) get the normal render: the game draws the purple aura over the same model (the .s files in
the dump are the shiny colourings, not shadows), and the app adds a purple glow in CSS. Raw downloads are cached under
.cache/pokeminers/.
The icon files are committed; the weekly data workflow runs this script so new species get theirs.
"""
import argparse
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_pvpoke_rankings import GAMEMASTER_URL, fetch_json  # noqa: E402

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons" / "pokemon"
CACHE = ROOT / ".cache" / "pokeminers"
BASE_URL = "https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/Pokemon%20-%20256x256/Addressable%20Assets/"
SIZE, PAD = 96, 4

# PvPoke id suffix -> PokeMiners form names to try, in order (the plain upper-cased suffix is always tried first)
ALIASES = {
    "alolan": ["ALOLA", "ALOLAN"], "galarian": ["GALARIAN", "GALAR"], "hisuian": ["HISUIAN", "HISUI"], "paldean": ["PALDEAN", "PALDEA"],
    "10": ["TEN_PERCENT"], "50": ["FIFTY_PERCENT"], "complete": ["COMPLETE"], "pom_pom": ["POMPOM"], "pau": ["PAU"],
    "plant": ["PLANT", "PLANT_CLOAK"], "sandy": ["SANDY", "SANDY_CLOAK"], "trash": ["TRASH", "TRASH_CLOAK"],
    "mega": ["MEGA"], "mega_x": ["MEGA_X"], "mega_y": ["MEGA_Y"], "primal": ["PRIMAL"],
    "galarian_standard": ["GALARIAN_STANDARD", "GALARIAN"], "galarian_zen": ["GALARIAN_ZEN"],
    "single_strike": ["SINGLE_STRIKE"], "rapid_strike": ["RAPID_STRIKE"], "full_belly": ["FULL_BELLY"], "hangry": ["HANGRY"],
    "dusk_mane": ["DUSK_MANE"], "dawn_wings": ["DAWN_WINGS"], "ultra": ["ULTRA"],
    "5th_anniversary": ["FIFTH_ANNIVERSARY", "ANNIVERSARY"], "pop_star": ["POP_STAR"], "rock_star": ["ROCK_STAR"],
}
# when pm{dex}.icon.png itself is missing the species only exists with a form: the default forms to try
DEFAULT_FORMS = ["NORMAL", "ORDINARY", "INCARNATE", "ALTERED", "STANDARD", "AVERAGE", "BUSTED", "DISGUISED", "MALE", "FEMALE",
                 "A", "ARIA", "RED", "PLANT", "WEST", "SPRING", "OVERCAST", "LAND", "SHIELD", "MIDDAY", "SOLO", "AMPED", "ICE",
                 "FULL_BELLY", "SINGLE_STRIKE", "ZERO", "HERO", "TWO_SEGMENT", "CURLY", "GREEN_PLUMAGE", "FAMILY_OF_FOUR",
                 "CHEST", "COUNTERFEIT", "SUNNY", "BAILE", "MEADOW", "NATURAL", "SPIKY_EARED", "TEN_PERCENT", "COMBAT",
                 "WEST_SEA", "RED_STRIPED", "00", "UNOWN_A", "SPRING", "PLANT_CLOAK"]


def species_base(entry):
    """PvPoke id of the plain species: speciesName before ' (' as PvPoke writes ids (lower, non-alphanumerics to _)."""
    name = entry["speciesName"].split(" (")[0]
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def candidates(entry):
    sid, dex = entry["speciesId"], entry["dex"]
    base_id = re.sub(r"_shadow$", "", sid)
    base = species_base(entry)
    rest = base_id[len(base):].strip("_") if base_id.startswith(base) else base_id.split("_", 1)[1] if "_" in base_id else ""
    names = []
    if rest:
        forms = [rest.upper()] + ALIASES.get(rest, []) + [rest.upper().replace("_", "")]
        # a two-token suffix such as galarian_zen: also try the last token alone, then the first
        parts = rest.split("_")
        if len(parts) > 1:
            forms += [parts[-1].upper(), parts[0].upper()] + ALIASES.get(parts[0], [])
        forms.append(f"{base.upper()}_{rest.upper()}")   # a few forms carry the species name: fBURMY_PLANT
        seen = set()
        for f in forms:
            if f not in seen:
                seen.add(f); names.append(f"pm{dex}.f{f}")
    names.append(f"pm{dex}")
    if not rest:
        names += [f"pm{dex}.f{f}" for f in DEFAULT_FORMS]
    return names


def fetch(name):
    """The PokeMiners file bytes, or None on 404; raw downloads and misses are cached."""
    CACHE.mkdir(parents=True, exist_ok=True)
    hit, miss = CACHE / f"{name}.png", CACHE / f"{name}.missing"
    if hit.exists():
        return hit.read_bytes()
    if miss.exists():
        return None
    req = urllib.request.Request(BASE_URL + f"{name}.icon.png", headers={"User-Agent": "pokescan-icons/1.0"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            hit.write_bytes(data)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                miss.write_text("")
                return None
            if attempt:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt:
                raise
    return None


def render(png, out):
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    box = im.getchannel("A").getbbox()
    if box:
        im = im.crop(box)
    inner = SIZE - 2 * PAD
    im.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    canvas.save(out, "WEBP", quality=82, method=6)


def build_one(entry, force):
    sid = entry["speciesId"]
    out = OUT / f"{sid}.webp"
    if out.exists() and not force:
        return sid, "kept", None
    for name in candidates(entry):
        png = fetch(name)
        if png:
            render(png, out)
            return sid, name, None
    return sid, None, "missing"


def check(strict_pct=3.0):
    ids = set()
    for f in (ROOT / "data").glob("app-*.json"):
        d = json.load(open(f, encoding="utf-8"))
        ids.update(d.get("pokemon", {}).keys()); ids.update(d.get("unranked", {}).keys())
    missing = sorted(i for i in ids if not (OUT / f"{i}.webp").exists())
    pct = 100.0 * len(missing) / max(1, len(ids))
    print(f"icons check: {len(ids)} ids in data/app-*.json, {len(missing)} without an icon ({pct:.1f} %)" + (": " + ", ".join(missing[:40]) if missing else ""))
    return 1 if pct > strict_pct else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gamemaster", help="local gamemaster.min.json instead of fetching PvPoke's")
    ap.add_argument("--force", action="store_true", help="redraw icons that already exist")
    ap.add_argument("--check", action="store_true", help="only report ids in data/app-*.json without an icon (exit 1 above 3 %%)")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)
    if args.check:
        return check()
    gm = json.load(open(args.gamemaster, encoding="utf-8")) if args.gamemaster else fetch_json(GAMEMASTER_URL)
    entries = [e for e in gm["pokemon"] if e.get("dex") and e.get("speciesId")]
    # the app's data files carry shadow ids the gamemaster lacks (build_app_data adds _shadow variants): same render as the base
    by_id = {e["speciesId"]: e for e in entries}
    for f in (ROOT / "data").glob("app-*.json"):
        d = json.load(open(f, encoding="utf-8"))
        for sid in list(d.get("pokemon", {})) + list(d.get("unranked", {})):
            base = re.sub(r"_shadow$", "", sid)
            if sid not in by_id and base in by_id:
                by_id[sid] = dict(by_id[base], speciesId=sid); entries.append(by_id[sid])
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.load(open(manifest_path, encoding="utf-8")) if manifest_path.exists() else {"source": BASE_URL, "icons": {}, "missing": []}
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, res in enumerate(pool.map(lambda e: build_one(e, args.force), entries), 1):
            results.append(res)
            if i % 100 == 0:
                print(f"  {i}/{len(entries)}", file=sys.stderr)
    drawn = kept = 0
    missing = set()
    for sid, src, note in results:
        if src == "kept":
            kept += 1; continue
        if src:
            drawn += 1; manifest["icons"][sid] = src
        else:
            missing.add(sid)
    manifest.pop("shadowFallback", None)
    manifest["missing"] = sorted(missing)
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), indent=0, sort_keys=True)
    print(f"icons: {len(entries)} species, {drawn} drawn, {kept} kept, {len(missing)} missing"
          + (": " + ", ".join(sorted(missing)[:60]) if missing else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
