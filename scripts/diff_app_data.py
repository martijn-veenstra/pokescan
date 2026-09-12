#!/usr/bin/env python3
"""Record what changed between the committed app data and the freshly regenerated data/app-*.json files, so the app can
tell you "your Medicham's best moves changed": PvPoke moveset changes, Pokémon entering or leaving the meta group, and
big rank moves inside the top 100. Appends one entry per league and day to data/changes.json and keeps eight weeks.

Run after the builders and before committing (the old files are still HEAD):
    python3 scripts/diff_app_data.py
"""
import glob
import json
import os
import subprocess
import sys
from datetime import date, timedelta

OUT = "data/changes.json"
BASE = os.environ.get("DIFF_BASE", "HEAD")          # compare against another commit: DIFF_BASE=<sha> python3 scripts/diff_app_data.py
KEEP_DAYS = 56
RANK_JUMP = 15


def head_version(path):
    r = subprocess.run(["git", "show", f"{BASE}:{path}"], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else None


def main():
    today = date.today().isoformat()
    prev = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"entries": []}
    cutoff = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    entries = [e for e in prev.get("entries", []) if e.get("date", "") >= cutoff]
    for f in sorted(glob.glob("data/app-*.json")):
        old, new = head_version(f), json.load(open(f, encoding="utf-8"))
        if not old or "pokemon" not in old:
            continue
        league = new["league"]["slug"]
        op, np_ = old["pokemon"], new["pokemon"]
        moveset = [{"id": i, "from": op[i].get("moveset", []), "to": e.get("moveset", [])} for i, e in np_.items()
                   if i in op and op[i].get("moveset") and e.get("moveset") and op[i]["moveset"] != e["moveset"]]
        new_meta = [i for i in new.get("meta", []) if i not in old.get("meta", [])]
        left_meta = [i for i in old.get("meta", []) if i not in new.get("meta", []) and i in np_]
        rank = [{"id": i, "from": op[i]["rank"], "to": e["rank"]} for i, e in np_.items()
                if i in op and min(op[i]["rank"], e["rank"]) <= 100 and abs(op[i]["rank"] - e["rank"]) >= RANK_JUMP]
        if not (moveset or new_meta or left_meta or rank):
            continue
        entries = [e for e in entries if not (e["date"] == today and e["league"] == league)]   # rerun on the same day: replace
        entries.append({"date": today, "league": league, "moveset": moveset, "newMeta": new_meta, "leftMeta": left_meta, "rank": rank})
        print(f"{league}: {len(moveset)} moveset changes, +{len(new_meta)}/-{len(left_meta)} meta, {len(rank)} rank jumps", file=sys.stderr)
    entries.sort(key=lambda e: (e["date"], e["league"]))
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"entries": entries}, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {OUT}: {len(entries)} entries", file=sys.stderr)


if __name__ == "__main__":
    main()
