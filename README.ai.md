# Flight Price Radar — AI / agent context

Human-oriented guide: [`README.md`](README.md) (Traditional Chinese).

This file is optimized for **deterministic edits** and **CI alignment**. Treat as **invariants + checklists**, not prose tutorials.

---

## Repository role

- **Normal fares pipeline**: Turso DB + SerpApi Google Flights + Discord alerts on historical top-3 fares per tracked route.
- **Business deals pipeline**: RSS feeds + LLM extraction + Discord (separate job; different workflow).

---

## Critical invariant: seed vs sync

| File | Export / symbol | Role |
|------|-----------------|------|
| `src/scripts/seed-tracked-destinations.ts` | `seedRows` | Local/manual `INSERT OR REPLACE`; does **not** deactivate other DB rows. |
| `src/scripts/sync-tracked-destinations.ts` | `trackedRows` | **Source of truth for GitHub Actions** before `job:normal-fares`: `UPDATE tracked_destinations SET is_active=0` then upsert each row with `is_active=1`. |

**Rule**: After changing tracked routes or dates, **update both arrays to match** (same `id`, airports, dates, cabin, etc.). If only `seedRows` changes, the next CI run **overwrites** DB state from `trackedRows`.

Optional: keep comments in `.github/workflows/normal-fares.yml` (lines under `name:`) in sync with the same routes (documentation only).

---

## How to change airports / dates / route identity

1. Edit **`sync-tracked-destinations.ts`** `trackedRows` (required for CI).
2. Mirror the same objects in **`seed-tracked-destinations.ts`** `seedRows`.
3. Run `npm run build`.
4. Validate locally (if credentials present): `npm run sync:tracked-destinations` then `npm run job:normal-fares`.
5. Commit + push; CI runs sync automatically on normal-fares workflow.

### Airport / destination string format

- Schema: `src/schemas/domain.ts` — `serpApiLocationIdSchema`: `^[A-Za-z0-9/]+(,[A-Za-z0-9/]+)*$` (comma-separated IATA-style tokens allowed).
- Multi-airport example: `TAS,SKD,BHK`.

### Date fields

- ISO dates: `YYYY-MM-DD`.
- Round trip: `departureDateFrom`/`departureDateTo`, `returnDateFrom`/`returnDateTo`.
- SerpApi accepts one outbound/return pair per HTTP call; wide ranges are **subsampled** into multiple slices — see `buildFlexibleSerpApiDateSlices` and `MAX_ROUND_TRIP_DATE_SLICES` in `src/clients/serpapi.ts`.

### LON expansion

- `src/jobs/normal-fares.ts` — `airportSearchExpansions`: origin `LON` expands to multiple London airport codes for SerpApi queries.

---

## Execution surfaces

### npm scripts (from `package.json`)

| Script | Entry (compiled) |
|--------|------------------|
| `npm run build` | `tsc` → `dist/` |
| `npm run sync:tracked-destinations` | `dist/scripts/sync-tracked-destinations.js` |
| `npm run seed:tracked-destinations` | `dist/scripts/seed-tracked-destinations.js` |
| `npm run job:normal-fares` | `dist/scripts/run-normal-fares.js` → `runNormalFaresFromEnvironment` |
| `npm run job:business-deals` | `dist/scripts/run-business-deals.js` |
| `npm start` | `dist/main.js` (scheduler; env cron vars in `.env.example`) |

### GitHub Actions

| Workflow `name:` | File | Schedule (UTC) | Job timeout |
|------------------|------|----------------|-------------|
| `Normal Fares Scanner` | `.github/workflows/normal-fares.yml` | `0 0,12 * * *` | 30 min |
| `Business Deals Scanner` | `.github/workflows/business-deals.yml` | `*/45 * * * *` | 15 min |

Normal fares job env secrets (representative): `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `SERPAPI_API_KEY`, `SCRAPERAPI_KEY`, `DISCORD_WEBHOOK_URL`, `RSS_FEED_URLS`.

**Steps order (normal fares)**: checkout → setup node 22 → `npm ci` → `npm run build` → **`npm run sync:tracked-destinations`** → **`npm run job:normal-fares`**.

Manual dispatch (example): `gh workflow run "Normal Fares Scanner" --repo <owner>/flight-radar`

---

## Log prefixes (debugging “stuck” vs slow)

- `[tracked-destinations-sync]` — DB sync phases + per-row upsert timing.
- `[jobs]` — lease acquire/release; `entering … job body` in `src/jobs/persistent-job-runner.ts`.
- `[normal-fares]` — destination list, per-destination SerpApi start/done timing.
- `[serpapi]` — flexible search slice count; per-slice completion lines when `effectiveSlices.length > 1`.

SerpApi sequential slices can take **many minutes** without indicating deadlock.

---

## Database migrations

Apply in order under `db/migrations/` (e.g. `001_initial_schema.sql`, `002_add_job_scheduler_state.sql`). Tables include `tracked_destinations`, `fare_observations`, `fare_alerts`, `job_scheduler_state`, etc.

---

## Tests

- Command: `npm test` (runs `dist/**/*.test.js`).
- **Must** `npm run build` before tests.

---

## Files to read when touching feature X

| Feature | Primary files |
|---------|----------------|
| Tracked list / CI sync | `src/scripts/sync-tracked-destinations.ts`, `src/scripts/seed-tracked-destinations.ts` |
| SerpApi slices / URL | `src/clients/serpapi.ts` |
| Normal fares job | `src/jobs/normal-fares.ts`, `src/jobs/runtime.ts`, `src/jobs/persistent-job-runner.ts` |
| Business deals | `src/jobs/business-deals.ts`, `.github/workflows/business-deals.yml` |
| Env schema | `src/config/env.ts`, `.env.example` |
| Discord normal fare embed | `src/notifications/normal-fare-embed.ts` |

---

## Do not

- Commit `.env` or live API tokens.
- Change only `seed-tracked-destinations.ts` when CI should reflect new routes (must update `sync-tracked-destinations.ts`).
