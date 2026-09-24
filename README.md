# pokescan

Pokémon GO screenshot scanner and GO Battle League team planner (Great, Ultra, Little and the featured cups). Runs entirely in the browser,
installable as a PWA: https://martijn-veenstra.github.io/pokescan/

- **Today** tab: the best team you can build from what you own, with lead / swap / closer and a score bar
  against the meta best (tap it for the team page). "Do next" lists only what the Pokémon you actually run
  still need: power-ups, Fast / Charged TM, unlocking the second charged move, pending party members to
  catch or evolve. Everything else (bench power-ups, catches for a hypothetical team, what to park) sits
  behind "N more ideas", so dust goes to the team first. Then your saved parties as one line each, where
  to get wanted Pokémon.
- **Saved teams** (menu): the recommended team, your in-game parties (saved from the builder), a second team with no overlap, and more buildable trios, one line each with score
  and weak-spot counts. Every team opens its own page: roles with the moves used for scoring, members with
  status, the to-dos for its members, the meta Pokémon that beat two or all three (with who to swap to),
  one-member swaps from your roster, the coverage grid (wins / even / loses, faded cells are estimated),
  and rename / delete for saved parties.
- **Roster** tab: one card per Pokémon in the same design as the scan list (CP, IVs, IV%, league rank) with the
  planner's status on it (ready, power-up cost, needs moves, XL gated, evolve → …, in which party); pieces you do
  not hold yet (pending evolutions, wanted, benched) are dashed cards. Tap a status count to filter.
  Tap for rank, cost to the cap, moves, what it beats and loses to, and actions. Owned tiles come from
  scans at or under 1500 CP; add others by name or load the roster committed in the repo.
- **Builder** tab: any three Pokémon, scored live with roles, coverage grid and what you would still need
  to catch; save as a party or add missing members to wanted; best-third suggestions from your roster or
  the meta; the AI review of the complete team, with tappable Pokémon names.
- **Leagues**: the ≡ menu switches the whole app between Great, Ultra and Little League and the GO Battle League
  cups PvPoke currently features (`data/cups.json`, rebuilt daily by `scripts/build_cups.py`): rankings, meta
  teams, the cap used for readiness and power-up targets, search strings and roster tiles all follow.
- **≡ menu** (top left): saved teams, **Meta teams** (the 40 best trios from the top 40 of PvPoke's meta group, scored on
  the device with PvPoke's movesets so the order is PvPoke's view; filters for Pokémon a team *must have* or should
  *leave out* and for teams you can build from what you own; each member's icon carries a ring: green owned, blue
  pending, dimmed not yours; each row says in one line how many of the common Pokémon the team beats, and opens the team
  page for the score, roles and what it loses to), PvPoke's full
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
  The import loader is a Pokéball: it shakes like a catch while files are read, a ring around it fills with progress and on
  completion it stills with a green button and three stars (red and tilted when a file failed). An import started from a
  Pokémon page shows the same loader floating above the bottom bar.
- **The importing card can be opened, and stopped**: a ✕ sits on the card in every state — while a file is being read it
  stops the import where it is (mid-recording included, with nothing drafted from a stopped read), and once the import
  has ended it dismisses the card. Along the bottom an expand button counts what the read has found so far and opens
  the list: every note the pipeline makes, and for a recording each fall and shield the battle reader confirms, as it
  happens rather than only in the import log afterwards. A card whose list is open stays up instead of fading away.
- **How to get** (Pokémon page): concrete routes instead of a bare schedule lookup: catch it (Leek Duck raids, eggs,
  research, events), evolve a pre-evolution (candy cost from the game master in `data/evo.json`, the safe catch CP so it
  stays league-legal, the pre-evolution's own sources, your own copies that would fit), and for Shadow Pokémon the Team
  GO Rocket route with today's grunt and leader lineups (`/api/sources` reads Leek Duck's Rocket lineups page; the
  server keeps the previous parse when the page is unreadable) plus the purification trade-off.
  Evolution routes list what the game asks beyond candy, from the PokeMiners game master through `data/evo.json`: Sinnoh
  and other stones, lure modules, buddy kilometres and hearts, day or night, gender, trade evolutions and the quest
  evolutions (catch or defeat N of a type, Excellent Throws…), plus Eevee's chance branches and nickname trick. Today's
  "Evolve your X" item, the Pokémon page and the scan card's evolution preview carry the short form.
- **Battle log** (menu): the home of battle recordings. Import one and the app reads it on the phone (see below),
  shows what it found — both teams, the result, shields and faints, the timeline — and asks which saved party you
  played, guessing the closest match from the Pokémon it read. Nothing is logged until you press Save, and a pending
  read survives leaving the page. A whole set saves in one go under one party. Each logged battle opens its own page
  with the full timeline and an optional AI review; the rating is typed in or read from an end-of-set screenshot, and
  your record, the leads that trouble you and what you face sit behind a fold.
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
- **AI review** (Pro): any complete team — in the builder or a saved party — offers one structured Claude review
  (verdict, game plan, strengths, weak spots, swaps from your roster) on tap, never by itself; it is cached per trio
  and league so it costs one call, saved-team rows show the verdict, and ⋮ → Refresh review asks again.
  The review also judges the Lead / Swap / Closer order: its **Order** line names the lineup it would run, with the reasons
  from the members' types and the app's role numbers, and one tap applies it to the saved party or the builder slots. A saved
  party's page shows your own order in the hero tiles, with the app's suggestion and a **Use this order** button under them,
  and the ‹ › arrows on a tile's role label move that member one place without leaving the page.
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
- **Pokémon page** (`#/mon/<id>`, every tap on a Pokémon name lands here, owned or not): the head shows name, types,
  weaknesses, meta rank and, for a copy you own, its CP arc, IV and status tiles plus **⟳ Update with a new scan**,
  which hands the next import to that card (power-up, evolution, appraisal, attacks screen) and returns to the page.
  A Pokémon you do not own says so plainly: a **not owned** chip in the head and a dashed *Not in your roster yet* box
  with **＋ Add a scan of this Pokémon** (also in the ⋮ menu). It opens the importer straight from the page; when the
  import finishes you are back on the page with a one-line verdict (added with its CP, a pre-evolution landed instead,
  a different Pokémon was read, or nothing was read).
  Below it two tabs: **PvP** (moves with PvPoke's usage and move counts, roster status and search string, fit with your
  roster, a **Best IVs** table behind a tap (the ranked spreads at the cap with raid / lucky-trade floors and your own copies
  marked), meta teams, loses to / beats, how to get it) and **PvE · raids** (its rank per attacking type and overall from
  `data/pve.json`, the fast + charged pairs by raid damage with your set graded, your highest-CP copy, and what it is
  weak to as a raid boss with a link that ranks your own attackers against it). Scan pages (`#/scan/<key>`) are only
  reached from the Scans list and from "your copy" links.
- **Name a team in the builder**: the slots are Lead, Swap and Closer; with all three filled a name field and Save team sit under the moves; the party
  then shows up under Saved teams, on Today and in the battle log, and the builder is cleared for the next team (the toast opens the saved one).
  This is where a party is created: the builder knows the moves, the roles, the score and the review, so Saved teams only lists them. A team page's
  ⋮ can also save the trio it shows.
- **Getting started and milestones**: a checklist on Today ticks itself off as you import a status screen, an
  appraisal, the attacks, reach three Pokémon under the cap, set your level, save a party, log a battle and sign
  in; each step opens the place to do it. Milestones (scans, exact IVs, attack sets, battles, parties, imports)
  live under the trainer profile with a bar to the next tier; each new tier shows one toast named by its payoff
  ("Roster knows 5 Pokémon · Today can build a team"). A device that already has data records them silently.
- **PokeScan Pro**: every AI feature sits behind the Pro plan (`#/pro`, also under You in the menu). The server
  decides the plan per account: the passcode-mode owner and the ids in `PRO_USER_IDS` are Pro, otherwise a plan row
  in the database (`plans` table, written by the payment integration) with an optional expiry; `/api/me` returns
  `plan`, `features` and the checkout link (`PRO_CHECKOUT_URL` with the user id appended as `client_reference_id`,
  price text from `PRO_PRICE`, an optional `PRO_MANAGE_URL` for the customer portal). Free accounts see a locked
  AI-review card that opens the Pro page; `/api/coach` answers 403 `upgrade_required` for them.
  Payments run through a Stripe Payment Link: set `PRO_CHECKOUT_URL` to the link (its after-payment redirect is
  `https://<host>/#/pro/thanks`), add a webhook endpoint `https://<host>/api/stripe/webhook` for
  `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`, and put its
  signing secret in `STRIPE_WEBHOOK_SECRET`. The server verifies the signature itself (no Stripe SDK), writes the
  plan row on a paid checkout and clears it when the subscription ends.
- **Share anything** (Pro): a screenshot the on-device reader cannot place (not a status, appraisal, attacks or profile
  screen) goes to the server's vision endpoint (`POST /api/vision`, a downscaled JPEG, polled via `/api/jobs/:id`,
  `VISION_PER_USER_HOUR` default 20 under `VISION_PER_HOUR` 100). The model says what it is; the app routes it.
  A **battle recording** (Pokémon GO shows no results screen, so record the match) is sampled by the video scanner: a
  dozen small frames spread over the match plus the last four seconds go to the model in one call when the recording
  holds no status screens; the answer is the battle record plus up to three timestamped film-study notes on the
  decisions that decided it. A recording longer than 90 s with no status screen in its first 30 s switches to a light
  battle mode (no pausing for text, the big file plays through); a playback stall keeps the frames seen so far and
  the closing frames are fetched by seeking, so the import never fails on a stall once frames exist. An **end-of-battle screenshot** becomes a battle-log entry with both teams, their lead and the result; the Battles page
  gains "What you face", the species you actually meet with your record against each, and the AI review gets that
  list. A **Team GO Rocket taunt** is matched to Leek Duck's lineups: which Shadow you will meet and whether your
  roster wants it (evolves into a wanted Pokémon, ranks in your league, or skip). Results sit as cards at the top of
  Scans; the import log says "read by Claude" for those files and everything else stays on the device. On Android and
  desktop the app is a Web Share Target (`share_target` in the manifest, files land in a cache and are imported on
  `#/inbox`); on iPhone use Import scans. Free accounts see a Pro teaser instead and nothing leaves the phone.
- **No chat**: the AI never asks or answers questions; it only writes the structured review above, when asked.
  Pokémon names in a review are tappable and fill an open builder slot, or open the Pokémon page.
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
- **Page titles and column help**: every top-level page opens with its own title and a one-line subtitle, so a
  page reached from the drawer says what it is without a lit tab. Above each list of rows (Saved teams, Meta
  teams, Rankings, Raids) and above the Best IVs table sits a column header whose labels each carry an ⓘ: tap
  one and its explanation opens in place, one at a time, no re-render. The footer notes that used to carry
  those explanations were trimmed to what they still add, the data's provenance and the model's caveats.
  The scan cards, the team page's Members list and the battle log keep their own labels and get no header.
- **The battle log is where battles are imported and read back**: a `＋ Import a battle recording` button sits on
  the page (Scans & import still takes them too), each logged battle opens its own page (`#/battle/<id>`) with both
  teams, shields, faints and the full timeline, and a saved party can be attributed to it — the log suggests the
  closest match from the Pokémon it read, and picking one makes the stats and that team's page count the battle.
  Each battle page can ask for an **AI review** of that one match (Pro, on request, at most 5 an hour per account
  via `COACH_BATTLE_PER_HOUR`): Claude reads the timeline and answers in four sections — what happened, the turning
  point, what to do differently, and how the two teams line up.
- **A stalled recording keeps being read**: a 400 MB file played at 2× can starve the decoder, and playback dies part
  way. The importer drops to real time on the first stall, and when playback gives up for good it carries on reading
  the battle by seeking, so a stall no longer truncates the entry silently. The log names the span it managed
  (`read 2–37s of 205s`) and says what is missing when the coverage is partial.
- **Which party you played** is one line on the battle (and on a draft), not a chip per saved party: a row of bare
  names became unreadable past two teams, and a name alone does not say which trio it is. Tapping it opens a sheet
  where every party shows its Pokémon, how much of what the recording read is in it, and which fits best.
- **Anything read from a recording can be deleted**: every row in the battle log carries a ⋮ with Delete (it used
  to be there only for rows with nothing to open, so a battle read from a recording could only be deleted from a
  link at the bottom of its own page), a battle's own page has the same on its card, and a deleted battle is held
  for one tap on the toast to put it back rather than behind a confirm dialog. A single line of **Last imports**
  can be removed on its own instead of clearing the lot.
- **When a read finds nothing, the battle log says why**: every import from that page leaves an entry under
  **Last imports** — how many frames were sampled, whether the two HUD cards were found at all, how many battles
  and names came out — so a recording the reader cannot use explains itself instead of failing silently. Those
  entries live on the battle log, not in the Scans import log.
- **Reading the moves off the banners**: the game announces a charged move for a moment at the start of its
  animation, so a crop taken on a timer mostly caught the animation and not the words — a three-minute match with
  fifty gaps in the HUD yielded one move. Every frame of a gap is now scored for how much white type it carries over
  a dark overlay and the best one is kept, so each gap costs the same single OCR but on the frame where the words
  were up. The text itself is matched against what is known rather than against everything: the species against the
  six Pokémon already read off the cards, the move against that species' own four or five, by how many letters
  survive in order — lists short enough that "S dge" is unambiguously Stone Edge, where a strict edit distance
  dropped it.
- **A daylight battle's moves, and battle imports kept off Scans** (v10.3): replayed against a second real recording
  (a daylight loss, Lickilicky / Cramorant / Altaria vs Clodsire / Raichu / Skeledirge), which came back with five of
  its fifteen announced moves. Over bright sky the plate is pale and its letters stand only ~75 grey levels off it, so
  every Clodsire plate scored just under the bar: the plate detector now counts edges from 55. The plate also stays up
  for many seconds with one sentence after another on it ("NICE!", "Lickilicky used Shadow Ball!", "Attack incoming!"),
  so the clearest frame of every second is kept instead of one per stretch, and each crop is cut to the width of the
  words so the sky beside the plate does not turn into letters. The evening recording still reads all eight of its
  moves. An import started from the battle log goes straight to the battle reader (the screenshot reader never sees it,
  so it cannot touch a scan card) and its card floats on every page but Scans & import. The Pro page's feature-row
  style no longer leaks a second divider into the importing card.
- **How to get a wild-only Pokémon, and no other apps named on screen** (v10.2): the How to get card knew only what the
  event schedule lists (raids, eggs, research, events, Rocket lineups), so a Pokémon that just spawns in the wild
  (Oranguru) got "not in raids, eggs, research or announced events" and nothing more. A species with nothing to evolve
  from now gets a **Catch it in the wild** route with the weather that boosts its types, plus Incense, Lures and trading;
  one the game master marks legendary, mythical or an Ultra Beast (`evo.json` → `klass`) says raids, research and events
  instead, and the classic babies say eggs. The screens no longer name the sites and projects the data comes from —
  rankings, matchups, the event schedule and the Rocket lineups are described in the app's own words, and the links
  out to lineup pages are gone. This README keeps the credits.
- **Team reviews are asked for, never spent by themselves** (v10.1): the review used to start on its own for every
  complete trio in the builder and every saved party, so saving a few teams used up the account's hourly Pro reviews
  without the player asking. Each card now offers "Review this team" and sends nothing until it is tapped. The
  paywall and the limits are the server's: `/api/coach` is Pro only (403 `upgrade_required` otherwise), at most
  `COACH_PER_USER_HOUR` (10) reviews an hour per account — of which `COACH_BATTLE_PER_HOUR` (5) may be battle reviews
  — and `COACH_PER_HOUR` (30) across the server. A refresh keeps the review there was until the new one lands, so a
  refresh that hits the limit says so under the old review instead of leaving an empty card.
- **A game plan in the team review, and linked Pokémon on battle pages** (v10.0): the AI review of a team opens with a
  **Game plan** under the verdict — three short beats, Open / Mid-game / Close: what the lead does with shields, when to
  switch and who takes the awkward matchups, who finishes. A review cached before it existed says so and offers a
  refresh instead of spending a new review by itself. On a battle page every Pokémon — the two teams, the move chips
  and the names in the timeline — is a link: one of yours opens your own scanned copy (IVs, level, where it stands on
  your roster), falling back to its species page when it has no scan; one of theirs opens the species page. Which side
  a name in the timeline is on comes from the sentence ("you sent", "their …"), so a mirror match links correctly.
- **A cup without some of your Pokémon** (v9.99): the roster is kept across leagues, so after switching to a cup the
  wanted and pending lists can name Pokémon the cup's data does not have (Tinkaton in the Retro Cup). Those went
  straight to the roster tiles, which read their rank unchecked, and every scan import failed with "undefined is not an
  object (evaluating 'APP.pokemon[id].rank')". They now sit out in a league that lacks them, and every rank read goes
  through one helper that shows "–" instead of throwing.
- **A whole set in one recording** (v9.98): tested by reading the real match three times over as one recording —
  three entries, each with all six Pokémon, all eight moves and its own victory. What had to change: the card reads
  had a budget of 44 for the whole recording and ran out in the third battle (now 150); each battle's closing screens
  are kept with that battle rather than in a rolling window of the last 40 frames that the next battle's charged-move
  gaps pushed out (a stretch without the HUD that ends within 12 s is a charged move and its frames are dropped); and
  every crop is stored as a JPEG, so a set's worth costs a few MB instead of hundreds. The live feed says when the
  next battle starts. Timeline stamps stay recording time.
- **v9.97, from the same match read on the phone**: a shield is placed right after the move it stopped, and which move
  was blocked comes only from the counts — a "BLOCKED!" read out of a later gap had marked Torch Song blocked. The
  result is read off the closing screens with the white-text threshold too, from the last 40 frames instead of 24,
  and a "YOU WIN!" / "GOOD EFFORT" caught by the banner readers counts when those miss it. The loader's line under
  the ball follows the recording (it stayed on "Video 24s / 166s"), and its event list shows the newest first and
  adds lines in place, so scrolling back while a recording is read no longer jumps.
- **Read against a real recording** (v9.96, an evening battle on an iPhone, 1170×2532, that came back "No battle HUD
  found"): the shield test (red and blue both over 140) also matched a purple evening sky pixel for pixel, so
  calibration locked onto a row of sky. The HUD row is now found from pokéball red alone, and a live shield is the
  pale lavender measured off the recording (≈222,176,236; a spent one is dark grey). The move announcements are a dark
  plate with white type at ~0.32 of the screen height that is up **while the HUD is still on screen** as often as not,
  so the gap-only reader saw four gaps in a whole match; that spot is now watched on every sample, each appearance
  is read once off its clearest frame, and a plain white threshold reads all fifteen plates of that match exactly.
  "YOU WIN!" counts as a win. A move only another form knows settles the form ("Weezing used Sludge!" is Galarian
  Weezing), and a bare card name the app only knows by form ("Lycanroc") stands for its best-ranked form. Four frames
  of that recording are fixtures (`tests/fixtures/film-*.jpg`) read with the real OCR in the e2e suite.
- **The timeline reads like the match** (v9.94, after a daylight loss logged as "you sent Chesnaught" three times,
  no moves and "fainted: you 2"): the log is built from who was on the field when, not from each read of a card.
  A card re-read every 20 s only fills in a CP, so each Pokémon appears once per stint, and a new name is a send-out
  after a faint or a switch without one ("they switched to Medicham"). Faints name the Pokémon ("their Medicham
  fainted") and are dated to when the HUD went, after the move that caused them; a shield the counts saw is tied to
  the charged move just announced ("you shielded Stone Edge", which also marks that move blocked). The last faint of
  a match never shows in the counts — the HUD goes with it — so a loss or win that did not run the clock out counts
  it, and the timeline ends with the result. The HUD search no longer backs off to every 8th sample during the
  intro (calibration needs two agreeing samples, so that put the first read at 0:17 and missed a lead that switched
  out). The banners are found as a line of hard white strokes anywhere under the status bar instead of in a band
  that had to be mostly dark — which a daylight sky never is, so no move was ever read — and turned into black type
  on white only where the white is enclosed by the lettering's outline or plate, so bright sky is not ink. When the
  sentence does not survive, a charged move of one of the two Pokémon on the field anywhere in the words is enough
  ("ne Edg" is Stone Edge). What OCR made of the banners it could not use is kept with the battle (`filmData.unread`).
  The v2 reader's way of grabbing banners is back alongside: v9.93 kept only the one frame per gap that scored best
  as text, and when that was the wrong frame the move was lost, where v2's fixed band on a timer had read it. Each gap
  now keeps both — the best line and the band from the gap's first frame and every second after (stored as JPEG) —
  and reads them in turn until one gives a move. The Pokémon is taken from the word right before "used" first, as v2
  did, so "The opponent's Bastiodon used Stone Edge" is not lost to the words in front of the name.
- **Which Pokémon was on the card**: a switch is spotted by comparing the ink profile of the name, which is
  smoothed before it is compared and compared at a low distance — measured, two different names of similar length
  scored 0.27 against the old threshold of 0.34 and so registered as no change at all, which is how an opponent's
  second and third Pokémon stayed out of the log, while the same card nudged one pixel scored 0.25. Each settled
  card is then read once rather than once per frame, so the OCR budget lasts the whole battle, and every card is
  read again after 20 s in case a switch was still missed. A Pokémon that only its move banner ever named
  (“Bastiodon used Stone Edge”) joins the side whose name crop could not be read nearest that banner.
- **A battle recording reads itself** (`battlefilm.js`, v2): a GO Battle League recording has no status screens, so it
  used to be kept only as a dozen JPEGs for the Pro vision endpoint. Everything a log entry needs is on screen in
  every frame, in one band: the two HUD cards carry both active names, their CP, the red pokéballs for Pokémon left
  and the pink hexagons for shields. Counting those pixels is free, so the battle is read on the phone and OCR is
  spent only on the ~10 frames where a name changes. The entry lands in the battle log with both teams, the result
  from the closing screen, shields and faints, and a minute-by-minute timeline that opens under its row. Pro vision
  still runs on top and adds the film-study commentary — the two are independent. A recording of a whole set is
  split into one entry per battle — on the **counts**, not on a gap in the HUD. Pokémon left and shields left only
  ever fall during a match, so a return to a full three-a-side is the one certain sign the next battle has begun; a
  gap is not, because the HUD is hidden during every charged-move animation. Timeline stamps are recording time.
  The HUD is found by its **pokéballs and shield hexagons** — saturated red and pink that no GO background contains —
  measured once from the three pokéballs a side and then frozen, because the HUD does not move during a battle. The
  first version looked for two wide light bands instead, which matched white cloud in a midday sky and threw a
  daylight battle away after its first Pokémon.
- **The moves used** come off the game's own banners: the HUD is hidden exactly when something is being announced
  ("Chesnaught used Frenzy Plant!", then "BLOCKED!"), so those frames are read for the move and snapped to that
  species' real moveset. Each battle page lists what both sides threw and marks the shielded ones, and the moves
  travel into the AI review so it can talk about the shield trade rather than guess at it.
- **The loader**: the Pokéball that shakes while scans are read (a ring around it, a burst of stars when it lands)
  also runs on the AI review card, the app's other long wait. There is no percentage to show for a review, so the
  ring spins instead of filling and the heading counts the seconds; when the review arrives the ball finishes its
  catch before the card turns into the text. A failed review drops the ball.
- **AI review** (server only): with `ANTHROPIC_API_KEY` set on the server and sync connected, a complete
  team gets one structured review from Claude on request, cached per trio and league; Pro only, rate-limited per account.

Files: `index.html` (scanner and shell), `planner.js` (Today, coverage, roster and Pokémon pages), `sources.js` (raid/egg/research/event schedule), `pvp.js` (trio heuristic, shared with Node), `sw.js` + `manifest.webmanifest`
(PWA), `data/app-great.json` (bundled PvPoke data), `vendor/tesseract/` (bundled text recognition, so scanning works offline and without a CDN). `.github/workflows/update-data.yml` regenerates all
data files every Monday and commits them, so the app updates itself.

## Bundled app data

**Pokémon icons.** Every Pokémon name in cards, rows, hero tiles, builder slots, rankings, raids and page heads carries the
game's own render, sized to the text it sits next to (16 to 56 px). `scripts/build_icons.py` builds `icons/pokemon/<pvpokeId>.webp`
(96 px) from the PokeMiners asset dump (https://github.com/PokeMiners/pogo_assets), trying the form names PvPoke's ids imply;
shadow Pokémon use the normal render with a purple glow drawn by the app, as the game draws its aura. The files are committed; the weekly data workflow adds icons for new species and
`--check` lists the ids in `data/app-*.json` without one. Missing or unknown ids fall back to a grey Pokéball.
The service worker keeps the icons in a cache of their own across versions. The renders are Nintendo / The Pokémon
Company artwork, used as every fan tool does.

`scripts/precompress.mjs` writes Brotli and gzip siblings of the data files, scripts and stylesheet (git-ignored, built into the
Docker image) that `@fastify/static` serves with `preCompressed`: the 800 KB Great League data file goes over the wire as 110 KB.

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
python3 scripts/generate_pvpoke_team_comps.py                 # top 25 teams per league (--cap N limits how often one species appears)
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
To bring the passcode era's data into your account, sign in, open the cloud button and use **Import passcode data**:
enter the server passcode once and the scans, roster, teams and battle log stored under the passcode move to your
account (`POST /api/migrate`; only kinds the account does not have yet, five attempts per hour). The same sheet shows
your Clerk user id with a Copy button. Alternatively set `OWNER_USER_ID` to that id for one deploy and the server does
the same move at boot. Without Clerk keys the `PASSCODE` mode keeps working exactly as before; tests and the e2e suite
run in that mode.

Setting it up with the Clerk CLI (from your own machine; the CLI needs a browser login):

```bash
npm install -g clerk
clerk auth login
clerk init --app app_3JE08WigyV4pOCuZphrKZJUNkwj   # links this project to the PokeScan Clerk app and writes .env
clerk doctor
npm run start:local                                 # reads .env: the server starts in Clerk mode on http://localhost:8080
```

`.env` is git-ignored. For the live app copy `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from `.env` into the
Railway service's variables (plus `APP_ORIGIN`; keep `PASSCODE` until you have imported the old data). In the Clerk dashboard enable Google and
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
to enable the AI review (`POST /api/coach` with `mode: 'review'`, auth-protected, at most `COACH_PER_HOUR` reviews per hour,
default 30; `/api/health` reports `coach: true`).
