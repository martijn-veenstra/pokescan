# pokescan

Single-page Pokémon GO screenshot scanner (`index.html`).

## PvPoke rankings JSON

`data/pvpoke-rankings.json` is a flattened JSON list of the PvPoke rankings shown at
<https://pvpoke.com/rankings/> (Great, Ultra, Master and Little League, "overall" category).
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
