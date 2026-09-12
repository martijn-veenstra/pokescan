#!/usr/bin/env python3
"""Print the structure of a saved HTML page: size, the most common class names, and a tag-collapsed snippet around the
first Team GO Rocket lineup, so a scraper can be written from a CI log when the site is not reachable locally."""
import collections
import re
import sys

html = open(sys.argv[1], encoding="utf-8", errors="replace").read() if len(sys.argv) > 1 else sys.stdin.read()
print(f"page: {len(html)} bytes, title: {re.search(r'<title>(.*?)</title>', html, re.S | re.I).group(1).strip()[:80] if re.search(r'<title>', html, re.I) else '-'}")
classes = collections.Counter(c for m in re.finditer(r'class="([^"]+)"', html) for c in m.group(1).split())
print("classes:", ", ".join(f"{c}×{n}" for c, n in classes.most_common(60)))
ids = collections.Counter(m.group(1) for m in re.finditer(r'\bid="([^"]+)"', html))
print("ids:", ", ".join(f"{c}×{n}" for c, n in ids.most_common(30)))
m = re.search(r'(?i)grunt|rocket', html[html.lower().find("<body") if "<body" in html.lower() else 0:])
anchor = re.search(r'(?i)class="[^"]*(?:lineup|grunt|rocket-|profile)[^"]*"', html)
at = anchor.start() if anchor else (m.start() if m else 0)
snippet = html[at:at + 6000]
snippet = re.sub(r"<script[\s\S]*?</script>", "", snippet)
snippet = re.sub(r"\s+", " ", snippet)
print("snippet:", snippet[:5000])
