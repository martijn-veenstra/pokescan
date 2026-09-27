# PokeScan pre-launch review (September 2026)

This review covers security, privacy, cost, code quality and operations for v10.20. Section 1 lists what
is fixed on this branch. Section 2 lists what is still open, most urgent first.

## 1. Fixed on this branch

| # | Issue | Fix |
|---|---|---|
| F1 | **Server source and `.git` were downloadable.** With `@fastify/static` 8.3, `GET /data/..%2Fserver/db.js`, `/data/..%2Fpackage.json` and `/data/..%2F.git%2Fconfig` returned the files (this is advisory GHSA-x428-ghpx-8j92 among others; `npm audit` rated it high). The Docker image leaves out `.git`, but everything else in the repository was exposed, including server code, tests, scripts and the Dockerfile. | Upgraded to `@fastify/static` ^10.1.5, whose `setHeaders` now receives `reply`. `allowedPath` is now an **allowlist**: the app's top-level files plus `data/`, `icons/` and `vendor/`. Regression tests are in `server/test.js`. |
| F2 | No security headers. | Every response now sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy`, plus HSTS in production. A CSP is still open (O6). |
| F3 | **Stored XSS in the import log.** File names, and notes containing Claude vision output such as a Rocket quote "as written", went into `innerHTML` unescaped (`scanner.js` `renderLog`). | These fields are now escaped (`escHTML`). |
| F4 | **XSS through `onclick` arguments.** Scan keys were HTML-escaped inside `'…'` JS strings, but the browser decodes `&#39;` before it runs the handler. A crafted backup JSON, or a synced record, could therefore run script. | The ⋮ menu, re-solve, evidence and undo links in `planner.js`, and the scan card and lineage banner in `scanner.js`, now pass a JSON literal via `attr()`. |
| F5 | Third-party schedule text (the raid tier and egg type from ScrapedDuck) was rendered unescaped. | Escaped in `bundleAvail`. |
| F6 | The account box rendered the e-mail, server error text and import messages unescaped. | Escaped. |
| F7 | **Unbounded history growth.** Every sync PUT stored a full snapshot and kept 200 per kind; with an 8 MB body limit that is up to 6.4 GB per account, and any free sign-up could fill the database. The trim query also ran `NOT IN` without an index. | At most one snapshot per user and kind per hour, the last 50 kept. Added indexes on `history(user_id, kind, id)` and `plans(ref)`. Tested against Postgres 16. |
| F8 | **No way to erase data (GDPR art. 17).** | Added `DELETE /api/state`, which removes state and history for the caller only, and "Delete my synced data from the server" in the account box. The plan row stays because it is the billing record. |
| F9 | The service worker deleted the ~17 MB Tesseract cache on every deploy, because the cache name contained the app version. | Uses a fixed `pokescan-vendor-tess5` cache. The `share-inbox` cache also survives updates now. |
| F10 | Offline, the service worker served `index.html` for script requests. The page asks for `planner.js?v=10.20`, but precache holds `planner.js`. | Offline lookup uses `ignoreSearch`, and only navigations fall back to `index.html`. |

## 2. Open, most urgent first

### Must decide or fix before launch

**O1. Legal and IP: the paid tier uses Pokémon assets and branding.** The app ships about 1,700 renders of
Nintendo / The Pokémon Company artwork (`icons/pokemon/`, from PokeMiners) and is called "Poke"Scan, and Pro is
sold at €4.99 a month. Free fan tools are usually tolerated; paid ones attract takedowns, both from the
rights holders and from app-store and Stripe policies.
- Add a "not affiliated with Niantic, Nintendo or The Pokémon Company" notice.
- Consider a name without "Poké".
- Consider generic icons, or keep the renders off the paid feature pages.
- The server also scrapes leekduck.com with a spoofed Safari user agent (`server/sources.js` `get()`). Ask
  Leek Duck for permission, or use an honest user agent and respect their terms.

**O2. Privacy policy, terms and consent are missing.** Nothing in the app mentions privacy or terms. The help text
still says everything stays on the phone, yet Pro sends screenshots (which may show trainer names) and
roster summaries to Anthropic, and Clerk and Stripe process personal data. For an EU (NL) audience you need:
- a privacy policy naming Clerk, Stripe, Anthropic, Railway, Google Fonts and GitHub;
- terms of sale for Pro, including the EU 14-day withdrawal right for digital services;
- a clear notice at the first AI upload that the image leaves the device;
- corrected help text.

**O3. Google Fonts leaks every visitor's IP to Google** (`index.html:16-17`). German courts have ruled this a
GDPR violation (LG München, 2022). Self-host the Sora font files under `vendor/`.

**O4. Account switching uploads the previous user's data.** When another person signs in on the same browser,
`onUser` (`sync.js`) resets only the sync bookkeeping, then pulls, merges and pushes the local copy, so user A's
scans, roster and battles land in user B's account. Pick one:
- keep local data per user id;
- clear local data on sign-out;
- ask before merging an anonymous local copy into an account.

Sign-out also leaves `bcoach`, `shares`, `scanlog`, `tname` and the share inbox behind.

**O5. The AI cost exposure is larger than one subscription pays for.**
- Rough cost per call on `claude-opus-5` ($5 / $25 per MTok): a team review with 15k tokens in and 1.5k out is
  about $0.11; a vision read of up to 16 frames is about $0.05–0.10.
- The per-user caps (10 reviews and 20 vision calls per hour) let one Pro user spend about $2–3 an hour, far
  more than €4.99 a month.
- The global caps (30 and 100 an hour) mean three heavy users lock everyone else out.
- The counters live in memory, so they reset on every deploy or restart and are never pruned.

Recommendations:
- Add daily and monthly per-user quotas stored in Postgres.
- Record `usage` per user in a table so you can see real cost per subscriber.
- Consider `claude-sonnet-5` for the vision classification (a product decision: it costs about 60% less).
- The model ids, the `server-side-fallback-2026-07-01` / `fallbacks: 'default'` pair and the refusal handling
  are all correct as written.

**O6. Set `APP_ORIGIN` in production.** Without it Clerk's `authorizedParties` check is skipped
(`server/index.js`), so a session token minted for another origin on the same Clerk instance is accepted.
Consider failing start-up when `CLERK_SECRET_KEY` is set and `APP_ORIGIN` is not.

**O7. Content-Security-Policy.** There is none. The roughly 150 inline `onclick=` handlers, and `toast()`, which
runs `(0,eval)(onclick)` (`scanner.js`), prevent a strict one. As a first step, ship
`Content-Security-Policy-Report-Only` with `script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev <your
Clerk domain> blob: 'wasm-unsafe-eval'`, then move handlers to `addEventListener` over time. Also pin ClerkJS to
an exact version (`auth.js` loads `@clerk/clerk-js@5`).

### Important: data integrity

**O8. Sync merge is "union, local wins"** (`sync.js` `applyRemote`):
- Deletes come back: a delete on one device is undone by another device's 409 merge.
- Edits to fields that are already set are overwritten by the stale device.
- The `seen`, `have` and parts of the `build` roster blocks are last-writer-wins.
- The server's `baseUpdatedAt` check is not atomic: it does a read, then an upsert. Use
  `UPDATE … WHERE updated_at = $base`.

The fix is per-record `updatedAt` plus deletion markers (tombstones), with tests for two devices.

**O9. Offline and racing edits are dropped:**
- `touch()` does nothing when the app started offline.
- `dirty` lives only in memory, so a reload within 1.5 s loses it.
- A flush that is already running swallows the next timer.
- An edit made during a PUT is lost by `dirty.delete` after the `await`.

**O10. Storage robustness:**
- About 17 top-level `JSON.parse(localStorage…)` calls are unguarded, so one corrupt key breaks a whole module.
- No `setItem` handles a full quota.
- There is no schema version or migration framework.

Add one `store.js` with `load(key, fallback)`, quota handling and a version. Consider IndexedDB for scans and
battles.

**O11. The server accepts any JSON as state** (up to 8 MB per kind). Validate the shape per kind, or at least
cap each kind at about 5 MB. The client can never hold more than that in localStorage anyway.

### Operations

**O12. Tests run only on push to `main`, straight before deploy.** Add a `pull_request` workflow with
`npm test` and the end-to-end tests.

**O13. The daily data workflow's commits never deploy.** `update-data.yml` pushes with `GITHUB_TOKEN`, which by
design does not trigger `deploy-railway.yml`. Run the deploy from the data job, or give it a PAT or app token.

**O14. The Postgres test path is broken by leftover state.** `server/test.js` in `DATABASE_URL` mode fails on a
reused database: the plans table is never cleared, and `app3` shares rows with earlier apps. Truncate the
tables at start.

**O15. Monitoring.** Nothing reports errors or tracks uptime beyond the deploy smoke check. Add Sentry or a
similar service (with PII scrubbing), and an uptime check on `/api/health`.

**O16.** `pg` uses `ssl: { rejectUnauthorized: false }` for the public proxy host. Prefer the private network,
which the app already supports, or pin Railway's CA.

**O17. The Stripe webhook is only half hardened:**
- It keeps only the last `v1=` signature, which breaks during a secret rotation.
- It does not handle `invoice.payment_failed`.
- A missed `customer.subscription.deleted` leaves `until: null`, so the account is Pro forever.
- Set `until` on checkout, from the subscription's period end.

**O18.** (Done on this branch) The committed `scripts/__pycache__/*.pyc` files are removed from git.

### Code quality and UX

**O19. Size.** `planner.js` is one 303 KB IIFE with about 300 functions; `scanner.js` leaks 20+ globals that
planner depends on; the version string lives in three places. Suggested order: `store.js`, then sync with
tombstones, then ES modules with planner split per route, then a single build-time version stamp.

**O20. Accessibility.**
- About 150 clickable `<div>` and `<span>` elements have no role, `tabindex` or key handler.
- Modals have no `role="dialog"`, focus trap or Escape to close.
- There are no `:focus-visible` styles.
- A lot of 10–11 px text sits on the dark background and probably fails contrast.

**O21. First paint.**
- `tesseract.min.js` blocks rendering in `<head>` but is needed only for OCR; `defer` it or load it lazily.
- The app fetches `app-<league>.json` (812 KB) with `cache: 'no-cache'` on every start.
- `getWorker()` can start two Tesseract workers when it is called twice at once; store the promise.

**O22. PWA.**
- There is no "update available" prompt, so an open tab can mix old JS with a new service worker.
- The manifest uses a single `"any maskable"` icon, and its description still says "Great League".
- `drainInbox` deletes a shared file before importing it, so a failed import loses the file.

**O23. Error UX.** Sync errors show only on the cloud button. The global `unhandledrejection` handler labels
every failure "import failed", including sync and coach errors.
