# pokescan

Pokémon GO screenshot scanner and Great League team planner. Runs entirely in the browser,
installable as a PWA: https://martijn-veenstra.github.io/pokescan/

- **Today** tab: the best team you can build from what you own, with lead / swap / closer, a score bar
  against the meta best, its threats, ranked next moves (power-ups, evolutions, catches with a safe CP,
  what to park), a second team with no overlap, and other teams grouped by shared core. Tap a team for
  the coverage grid (wins / even / loses against the meta, faded cells are estimated) and swap suggestions.
- **Roster** tab: every Pokémon as a status tile (ready, powering up, pending, wanted, XL gated, benched).
  Tap for rank, cost to the cap, moves, what it beats and loses to, and actions. Owned tiles come from
  scans at or under 1500 CP; add others by name or load the roster committed in the repo.
- **Meta** tab: a team builder (any three Pokémon, scored live with roles, coverage grid and what you
  would still need to catch; save as a party or add missing members to wanted; best-third suggestions),
  the derived meta teams with "Try in builder", and PvPoke's full rankings with search, type filter and
  one-tap slot / want actions.
- **Scans** tab: one button imports screenshots or a screen recording; the app solves level and IVs and
  shows Great/Ultra League rank and percentage, power-up cost, evolution preview and second-move cost.
  Appraisal screenshots pin the exact IVs (on their own they make a complete card). Set the moves on
  each card, favourite, bench, search and filter. A recording is read once per screen you pause on, a
  frame that takes too long is skipped, and a bad frame never aborts the rest of the video.
- **Profile** button (header): trainer name, level and Best Buddy boost, or read name and level from a
  screenshot of your in-game trainer profile (also recognised when it is mixed into a normal import).
  Export CSV, Backup, Restore and Clear live here too.
- **Saved parties** (Today and Roster) list their weak spots: the meta Pokémon that nobody on the party
  beats or that beat two of the three, with rank, who they beat, who to swap to, and the best one-member
  fix from your roster.
- **Coach** (Today, server only): with `ANTHROPIC_API_KEY` set on the server and sync connected, a card
  sends a compact roster and meta summary to Claude and shows team suggestions, what to build next and
  what to fear. Answers are cached until the roster changes; the server rate-limits questions.

Files: `index.html` (scanner and shell), `planner.js` (Today, coverage and roster views), `pvp.js` (trio heuristic, shared with Node), `sw.js` + `manifest.webmanifest`
(PWA), `data/app-great.json` (bundled PvPoke data), `vendor/tesseract/` (bundled text recognition, so scanning works offline and without a CDN). `.github/workflows/update-data.yml` regenerates all
data files every Monday and commits them, so the app updates itself.

## Bundled app data

`scripts/build_app_data.py` writes `data/app-great.json`: rankings with recommended movesets, published
matchups/counters, move names and types, the curated meta group, evolutions and second-move cost. The
page loads this file (offline via the service worker) instead of calling PvPoke live.

## PvPoke rankings JSON

`data/pvpoke-rankings.json` is a flattened JSON list of the PvPoke rankings shown at
<https://pvpoke.com/rankings/> (Great, Ultra, Master and Little League, "overall" category; Little League is PvPoke's "little" cup).
It is generated from the JSON files PvPoke publishes in its open-source repository, which are
the same files the website renders.

Regenerate it with (Python 3, no dependencies):

```sh
python3 scripts/generate_pvpoke_rankings.py            # all leagues -> data/pvpoke-rankings.json
python3 scripts/generate_pvpoke_rankings.py --leagues great --limit 100 --pretty -o gl-top100.json
```

Output shape:

```json
{
  "source": "https://pvpoke.com/rankings/",
  "gamemasterTimestamp": "2026-09-01 18:36:39",
  "generatedAt": "2026-09-04T16:22:00Z",
  "leagues": {
    "great": {
      "title": "Great League", "cp": 1500, "count": 1145,
      "rankings": [
        {
          "rank": 1, "speciesId": "lickilicky", "name": "Lickilicky", "dex": 463,
          "types": ["normal"], "score": 93.7, "rating": 650,
          "fastMove": "ROLLOUT", "chargedMoves": ["BODY_SLAM", "SHADOW_BALL"],
          "moveNames": ["Rollout", "Body Slam", "Shadow Ball"],
          "scenarioScores": {"leads": 86.8, "closers": 86.4, "switches": 91.2,
                             "chargers": 94.5, "attackers": 81, "consistency": 88.4},
          "stats": {"product": 2124, "atk": 105.7, "def": 125.5, "hp": 160},
          "editorScore": 95
        }
      ]
    }
  }
}
```

## Best team comps (derived)

PvPoke does not publish a ranked list of teams (its Team Builder simulates the team you enter,
and its training-mode team pools are years out of date). `data/pvpoke-team-comps.json` is therefore
**derived** from PvPoke data: for each league, every trio from the top 40 of PvPoke's curated meta
group is scored against the whole meta group. Pairings use PvPoke's published simulated
matchup/counter ratings where available, and a type-effectiveness + ranking-score estimate otherwise.

```sh
python3 scripts/generate_pvpoke_team_comps.py                 # top 25 teams per league
python3 scripts/generate_pvpoke_team_comps.py --top 50 --pool 30 --leagues great
```

Per team: `teamScore`, `coverage` (mean best-member rating across the meta, 0-1000 scale, 500 = even),
`members` (with rank, score, moveset), `unansweredMeta` (meta Pokémon no member is rated above 500
against) and `sharedWeaknesses` (meta Pokémon that clearly beat two or more members).
Treat it as a shortlist to verify in PvPoke's Team Builder, not as a simulation result.

## Checking hand-picked teams against the meta

`scripts/evaluate_teams.py` scores teams from any source (a video, Twitter) with the same heuristic
and shows how they compare with the top-ranked Pokémon: member ranks, team score, the percentile
against every trio from the top 40 of the meta group, the position it would take in the derived
top 25, unanswered meta Pokémon, shared weaknesses, alternatives, and a suggested third member
for incomplete teams.

```sh
python3 scripts/evaluate_teams.py data/community-teams-great.json -o data/community-teams-great-analysis.json
```

`data/community-teams-great.json` holds ten Great League teams transcribed from a community video
(with the video's movesets); `data/community-teams-great-analysis.json` is the scored result.

## Your own roster

`scripts/generate_roster_team_comps.py` runs the same trio heuristic over `data/roster-great.json`
(owned / pending / candidates / tagged) and writes `data/roster-team-comps-great.json` with the best
trios buildable today, with pending pieces, with candidate pickups, the marginal value of each
candidate, the score of each tagged in-game party, and the best two teams with no species in common.

```sh
python3 scripts/generate_roster_team_comps.py --pretty
```

## CP, level and power-up maths

`scripts/pogo_cp.py` uses the base stats and CP multiplier table embedded in `index.html`.

```sh
python3 scripts/pogo_cp.py cost mimikyu 15 15 12 15 23.5        # stardust and candy from level 15 to 23.5
python3 scripts/pogo_cp.py target forretress 0 15 15            # level, CP and PvP rank at the 1500 cap
python3 scripts/pogo_cp.py evolve-cap lickitung lickilicky      # which Lickitung CPs still fit under 1500 after evolving
python3 scripts/pogo_cp.py evolve-cap sentret furret --ivs 4 14 13
```

`evolve-cap` without IVs gives an IV-agnostic answer for a wild catch: a CP that is always safe,
a band where IVs decide, and a CP above which the evolution cannot fit under the cap.

## Running your own server (Railway)

`server/index.js` serves the app and a passcode-protected sync API backed by Postgres, so scans, roster,
parties and the completion log follow you between devices. Without `DATABASE_URL` it uses an in-memory
store; without `PASSCODE` the API answers 503 and the app behaves like the static copy.

```sh
npm install
PASSCODE=choose-one DATABASE_URL=postgres://... npm start     # http://localhost:8080
npm test                                                      # API tests (uses DATABASE_URL when set)
```

Deploy: `Dockerfile` + `railway.json`. `.github/workflows/deploy-railway.yml` runs the tests and
`railway up` on every push to main. It needs the repository secret `RAILWAY_TOKEN` (a Railway project
token) and optionally the variable `RAILWAY_SERVICE` (default `pokescan`). On the Railway service set
`DATABASE_URL` (reference to the Postgres service) and `PASSCODE`. Optionally set `ANTHROPIC_API_KEY`
to enable the coach (`POST /api/coach`, passcode-protected, at most `COACH_PER_HOUR` questions per hour,
default 30; `/api/health` reports `coach: true`).
