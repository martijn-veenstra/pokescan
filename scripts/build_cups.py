#!/usr/bin/env python3
"""Build the app data for every league the app offers: Great, Ultra and Little League plus the GO Battle League cups PvPoke
currently features (gamemaster `formats` with showFormat and rankings), and write data/cups.json as the index the app's
league picker reads. App files of cups that are no longer featured are removed.

    python3 scripts/build_cups.py            # data/app-great.json, app-ultra.json, app-little.json, app-<cup>-<cp>.json, cups.json
"""
import glob
import json
import os
import sys
import tempfile
import urllib.error
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_app_data  # noqa: E402
from generate_pvpoke_rankings import GAMEMASTER_URL, LEAGUES, fetch_json, rankings_url  # noqa: E402

STANDARD = ["great", "ultra", "little"]
SKIP_CUPS = {"all", "little", "custom", "catch", "premier", "championshipseries"}   # open leagues, placeholders and unranked formats
MAX_CP = 2500                                                                        # no Master League tiers in the app


def main():
    gm = fetch_json(GAMEMASTER_URL)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(gm, f)
        gm_path = f.name
    index = []
    for slug in STANDARD:
        cp, title, cup = LEAGUES[slug]
        build_app_data.main(["--league", slug, "--gamemaster", gm_path])
        index.append({"slug": slug, "title": title, "short": title.replace(" League", ""), "cp": cp, "cup": cup, "kind": "league", "file": f"data/app-{slug}.json"})
    featured = [f for f in gm.get("formats", []) if f.get("showFormat") and not f.get("hideRankings") and f.get("cup") not in SKIP_CUPS and f.get("cp", 0) <= MAX_CP]
    for fmt in featured:
        cup, cp = fmt["cup"], fmt["cp"]
        slug = f"{cup}-{cp}"
        try:
            fetch_json(rankings_url(cp, cup))                    # only cups PvPoke has actually ranked
        except urllib.error.HTTPError as e:
            print(f"skipping {fmt['title']}: no rankings ({e.code})", file=sys.stderr)
            continue
        rules = fmt.get("rules") or []
        argv = ["--cup", cup, "--cp", str(cp), "--title", fmt["title"], "--slug", slug, "--gamemaster", gm_path]
        if fmt.get("meta"):
            argv += ["--group", fmt["meta"]]
        if rules:
            argv += ["--rules", *rules]
        build_app_data.main(argv)
        index.append({"slug": slug, "title": fmt["title"], "short": fmt["title"].replace(" Cup", "").replace(" League", ""), "cp": cp, "cup": cup, "kind": "cup", "rules": rules, "file": f"data/app-{slug}.json"})
    os.unlink(gm_path)
    keep = {e["file"] for e in index}
    for f in glob.glob("data/app-*.json"):
        if f not in keep:
            print(f"removing {f}: no longer featured", file=sys.stderr)
            os.remove(f)
    out = {"generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "gamemasterTimestamp": gm.get("timestamp"), "leagues": index}
    with open("data/cups.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("wrote data/cups.json: " + ", ".join(f"{e['title']} ({e['cp']})" for e in index), file=sys.stderr)


if __name__ == "__main__":
    main()
