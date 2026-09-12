#!/usr/bin/env python3
"""Summarise /api/sources JSON from stdin: feed sizes and the Team GO Rocket lineups the server parsed from Leek Duck.
Used by the deploy workflow's smoke check (prints a GitHub warning when no lineups came through)."""
import json
import sys

d = json.load(sys.stdin)
r = d.get("rocket") or {}
lus = r.get("lineups") or []
print("sources: raids", len(d.get("raids") or []), "eggs", len(d.get("eggs") or []), "research", len(d.get("research") or []),
      "events", len(d.get("events") or []), "enriched pages", d.get("enriched"))
print("rocket lineups:", len(lus), ("| error: " + d["rocketError"]) if d.get("rocketError") else "")
for l in lus[:8]:
    print("  ", l.get("who"), "|", " / ".join(", ".join(s) for s in l.get("slots", [])))
if not lus:
    print("::warning::no Team GO Rocket lineups parsed from Leek Duck's rocket-lineups page")
