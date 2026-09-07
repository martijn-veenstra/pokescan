#!/usr/bin/env python3
"""Exit 0 when the regenerated data files differ from the committed ones in anything but their timestamps, 1 otherwise.

The generators stamp every output with generatedAt / generated, so a plain `git diff` is never empty and the weekly
workflow would commit a no-op every run. This compares the JSON with those keys removed.

    python3 scripts/data_changed.py && git commit ...
"""
import json
import subprocess
import sys

VOLATILE = {"generatedAt", "generated"}


def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k not in VOLATILE}
    if isinstance(o, list):
        return [strip(x) for x in o]
    return o


def main():
    files = subprocess.run(["git", "diff", "--name-only", "--", "data"], capture_output=True, text=True, check=True).stdout.split()
    changed = []
    for f in files:
        old = subprocess.run(["git", "show", f"HEAD:{f}"], capture_output=True, text=True)
        try:
            before = strip(json.loads(old.stdout)) if old.returncode == 0 else None
            after = strip(json.load(open(f, encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            changed.append(f)
            continue
        if before != after:
            changed.append(f)
    if changed:
        print("changed:", ", ".join(changed))
        return 0
    print("only timestamps changed" if files else "no changes")
    return 1


if __name__ == "__main__":
    sys.exit(main())
