# pokescan

Single-page Pokémon GO screenshot scanner (`index.html`).

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
