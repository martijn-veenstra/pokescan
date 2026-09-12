# pokescan

Pokémon GO screenshot scanner and GO Battle League team planner (Great, Ultra, Little and the featured cups). Runs entirely in the browser,
installable as a PWA: https://martijn-veenstra.github.io/pokescan/

- **Today** tab: the best team you can build from what you own, with lead / swap / closer and a score bar
  against the meta best (tap it for the team page). "Do next" lists only what the Pokémon you actually run
  still need: power-ups, Fast / Charged TM, unlocking the second charged move, pending party members to
  catch or evolve. Everything else (bench power-ups, catches for a hypothetical team, what to park) sits
  behind "N more ideas", so dust goes to the team first. Then your saved parties as one line each, where
  to get wanted Pokémon, and the coach.
- **Saved teams** (menu): the recommended team, your in-game parties (add one by name and three species, or save
  one from the builder), a second team with no overlap, and more buildable trios, one line each with score
  and weak-spot counts. Every team opens its own page: roles with the moves used for scoring, members with
  status, the to-dos for its members, the meta Pokémon that beat two or all three (with who to swap to),
  one-member swaps from your roster, the coverage grid (wins / even / loses, faded cells are estimated),
  and rename / delete for saved parties.
- **Roster** tab: every Pokémon as a status tile (ready, powering up, pending, wanted, XL gated, benched).
  Tap for rank, cost to the cap, moves, what it beats and loses to, and actions. Owned tiles come from
  scans at or under 1500 CP; add others by name or load the roster committed in the repo.
- **Builder** tab: any three Pokémon, scored live with roles, coverage grid and what you would still need
  to catch; save as a party or add missing members to wanted; best-third suggestions from your roster or
  the meta; an AI coach conversation with tappable Pokémon names.
- **Leagues**: the ≡ menu switches the whole app between Great, Ultra and Little League and the GO Battle League
  cups PvPoke currently features (`data/cups.json`, rebuilt daily by `scripts/build_cups.py`): rankings, meta
  teams, the cap used for readiness and power-up targets, search strings and roster tiles all follow.
- **≡ menu** (top left): saved teams, the derived meta teams (each opens a team page), PvPoke's full
  rankings with search and type filter, **Raids** (the best PvE attackers per type: DPS, TDO, Elite TM
  moves, megas and shadows toggle, computed by `scripts/build_pve_data.py` from the PokeMiners game
  master, with your scanned copies marked), scans, trainer profile, sync and help. Every page has a
  `#/…` URL, so Back, bookmarks and shared links work.
- **Scans** (menu → Scans & import): one button imports screenshots or a screen recording; the app solves level and IVs.
  Each card is one compact row: IVs, IV% (sum out of 45) and GL rank (position among the 4096 IV spreads
  at the 1500 cap, with stat product vs #1), plus one status chip (ready / power-up cost / XL / over cap).
  Tap a card for its page: IV bars, Ultra League rank, all possible spreads, evolution preview, second-move
  cost, moves, bench / archive / delete, and correcting a misread. Appraisal screenshots pin the exact
  IVs (on their own they make a complete card). A recording is read once per screen you pause on, a
  frame that takes too long is skipped, and a bad frame never aborts the rest of the video.
- **One card per Pokémon**: a card is identified by species + CP + HP. Status screens, appraisal screens, attacks
  screens and video frames of the same copy all land on that one card (a CP that lost a digit is recovered from HP
  and the level arc), duplicates are folded after every import and at start-up, and a power-up archives the old card
  in favour of the new one.
- **Update this Pokémon** (⋮ on a scan page or on your copy's Pokémon page): the next import belongs to that card.
- **How to get** (Pokémon page): concrete routes instead of a bare schedule lookup: catch it (Leek Duck raids, eggs,
  research, events), evolve a pre-evolution (candy cost from the game master in `data/evo.json`, the safe catch CP so it
  stays league-legal, the pre-evolution's own sources, your own copies that would fit), and for Shadow Pokémon the Team
  GO Rocket route with today's grunt and leader lineups (`/api/sources` reads Leek Duck's Rocket lineups page; the
  server keeps the previous parse when the page is unreadable) plus the purification trade-off.
- **Battle log** (menu): log GO Battle League battles in three taps (team, their lead, win or loss), type the rating
  after a set or import the end-of-set / rating screenshot (best effort OCR), and see your rating over time, results
  per team, per opposing lead ("trouble") and per member. Team pages show the team's real record; the coach and the AI
  review get the history next to the meta numbers. The log syncs with your account like scans.
- **Raids → Pick a boss**: the bosses in raids right now (Leek Duck) or any Pokémon by name; the page shows its
  weaknesses, ranks **your own scans** against it (real level, IVs and scanned moves; unscanned moves use the best
  possible set and say so) by DPS³ × TDO, and lists the best attackers in the game for its weak types.
- **Matchups** (menu): your builder team or a saved party against any of ~150 simulated opponents per shield scenario
  (0-0, 1-1, 2-2), with a verdict per member and a "their lead is X" mode that says stay / swap / shield. The numbers
  come from `data/matrix-<league>.json`, built daily by `scripts/build_matrix.mjs` with PvPoke's own battle engine
  (`vendor/pvpoke`, MIT) for the meta pool and the top 300 of each league; they match pvpoke.com's matrix and battle
  pages to within a point. The same matrix drives team roles (lead / safe swap / closer), the "N of 150 beat all
  three" threat count on team pages and the builder, and the coverage grid (only cells without a simulation are faded).
  Pokémon pages show move counts (fast moves and turns per charged move) from the game master.
- **AI review**: every complete team in the builder, and every saved party, gets one structured Claude review (verdict,
  strengths, weak spots, swaps from your roster), cached per trio and league so it costs one call; saved-team rows show
  the verdict, ⋮ → Refresh review asks again. Other team pages offer the review on tap.
- **Shadows**: ⋮ → Mark as Shadow on a scan card maps it to PvPoke's shadow ranking (search strings add `&shadow`);
  the card shows how the other form would rank.
- **Meta changes**: `scripts/diff_app_data.py` records moveset changes, meta-group entries/exits and rank jumps in
  `data/changes.json` on every data update; Today shows the ones that touch Pokémon you own, with Dismiss.
- **Share a team**: ⋮ on a team page → Share link (a `#/team/…` URL that opens the same page anywhere) or Copy as text.
- **Lineage offer**: when a new scan looks like a power-up or evolution of a card you already had (same IV spread,
  higher CP or the evolved species), the new card asks "Is this your X powered up?" — one tap folds both into one
  card with a CP history; "No" keeps them apart. Cards also say when the CP was inferred or the moves were never read,
  so nothing guessed is shown as fact.
  A status screen with the same IVs at a higher level, or of its evolution, moves the card to the new CP/HP/level and
  keeps a history line; an appraisal or attacks screen attaches to it. A screenshot whose IVs do not match, or of
  another species, becomes a separate card and the log says why.
- **Coach in the builder**: the ✦ button and a conversation thread (follow-up questions carry the earlier advice);
  Pokémon names in answers are tappable and fill an open builder slot, or open the Pokémon page.
- **Import log** (Scans, under the progress bar): one line per imported file with what it gave (new cards,
  appraisals, moves, profile, screens read) or why it failed, with decoder details for videos. Kept on the
  device, last 40 files.
- **Profile** button (header): trainer name, level and Best Buddy boost, or read name and level from a
  screenshot of your in-game trainer profile (also recognised when it is mixed into a normal import).
  Export CSV, Backup, Restore and Clear live here too.
- **Moves**: screenshot (or record) the status screen scrolled down to the attacks and the moves land on the
  card; "NEW ATTACK" marks the second charged move as locked. Today then lists, for members of your best
  teams and saved parties, the Fast TM / Charged TM towards PvPoke's moveset and "Unlock the 2nd charged
  move" with its dust and candy cost, each with the team-score gain. A rescan of the attacks clears them
  and logs the proof.
- **Pokémon pages**: tap a roster tile, a name in the rankings or a meta team (or "want" in the rankings)
  for a full page: your copy and its IV rank, moves, the teams it makes with your roster and what it would
  lift or fix, what it beats and loses to in the meta, where to get it, and roster actions (wanted, pending,
  owned, bench, remove). The phone's back gesture closes it.
- **Where to get wanted Pokémon**: Today lists raids (with remote eligibility), eggs, field research,
  Community Days, Spotlight Hours and other announced events for every wanted or pending species and its
  pre-evolutions, from Leek Duck's schedule (via the ScrapedDuck JSON on GitHub, cached six hours). The same
  list sits on each Pokémon page and as a hint on catch suggestions. On the PokeScan server, `GET /api/sources`
  additionally reads the Leek Duck event pages of GO Fest, Raid Day and seasonal events (whose raid bosses and
  spawns ScrapedDuck does not publish) and merges those lists in; the GitHub Pages copy only has the JSON feed.
- **Coach** (Today, server only): with `ANTHROPIC_API_KEY` set on the server and sync connected, a card
  sends a compact roster and meta summary to Claude and shows team suggestions, what to build next and
  what to fear. Answers are cached until the roster changes; the server rate-limits questions.

Files: `index.html` (scanner and shell), `planner.js` (Today, coverage, roster and Pokémon pages), `sources.js` (raid/egg/research/event schedule), `pvp.js` (trio heuristic, shared with Node), `sw.js` + `manifest.webmanifest`
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

## Accounts (Clerk)

Set `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` on the server (a Clerk *development* instance works on the Railway URL;
a production instance needs a custom domain for Clerk's CNAME records and your own Google OAuth client) and the app
switches from the single passcode to sign-in with Google or email and password. Every account has its own scans,
roster, parties, battles and coach budget (`COACH_PER_USER_HOUR`, default 10, under the global `COACH_PER_HOUR`).
Set `APP_ORIGIN` (e.g. `https://pokescan-production.up.railway.app`) so tokens minted for another site are refused.
To hand the passcode era's data to your own account, set `OWNER_USER_ID` to your Clerk user id for one deploy; the
server re-keys the rows once (only if the account has none yet) and you can remove the variable. Without Clerk keys
the `PASSCODE` mode keeps working exactly as before; tests and the e2e suite run in that mode.

Setting it up with the Clerk CLI (from your own machine; the CLI needs a browser login):

```bash
npm install -g clerk
clerk auth login
clerk init --app app_3JE08WigyV4pOCuZphrKZJUNkwj   # links this project to the PokeScan Clerk app and writes .env
clerk doctor
npm run start:local                                 # reads .env: the server starts in Clerk mode on http://localhost:8080
```

`.env` is git-ignored. For the live app copy `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from `.env` into the
Railway service's variables (plus `APP_ORIGIN`, and once `OWNER_USER_ID`). In the Clerk dashboard enable Google and
Email + password under User & Authentication.

`auth.js` loads ClerkJS from Clerk's CDN in plain JavaScript (no framework), mounts the sign-in UI in the cloud
button's sheet, and `sync.js` sends a fresh session token with every `/api` call. `GET /api/me` returns the user id
and enabled features. Offline or signed out, the app keeps working on local data and sync pauses.

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
