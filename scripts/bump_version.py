#!/usr/bin/env python3
"""Bump the app version everywhere it is written: index.html (?v= query strings and the header line), scanner.js APP_VERSION,
sw.js cache VERSION and package.json. Usage: python3 scripts/bump_version.py 9.43"""
import json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
new = sys.argv[1]
pkg = json.loads((ROOT / "package.json").read_text())
old = re.match(r"\d+\.\d+", pkg["version"]).group(0)
if old == new:
    sys.exit(f"already at {new}")
def sub(path, pattern, repl, count=0):
    p = ROOT / path; t = p.read_text(); n, k = re.subn(pattern, repl, t, count=count)
    if not k: sys.exit(f"nothing to replace in {path} for {pattern}")
    p.write_text(n); return k
k = sub("index.html", r"\?v=" + re.escape(old) + r"\b", f"?v={new}")
sub("index.html", r"· v" + re.escape(old) + r"</div>", f"· v{new}</div>")
sub("scanner.js", r"const APP_VERSION='" + re.escape(old) + "'", f"const APP_VERSION='{new}'")
sub("sw.js", r"const VERSION = 'pokescan-v" + re.escape(old) + "'", f"const VERSION = 'pokescan-v{new}'")
pkg["version"] = new + ".0"
(ROOT / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
lock = ROOT / "package-lock.json"
if lock.exists():
    sub("package-lock.json", r'"version": "' + re.escape(old) + r'\.0"', f'"version": "{new}.0"', count=2)
print(f"{old} → {new} ({k} script tags)")
