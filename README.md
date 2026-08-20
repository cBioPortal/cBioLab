# Cohort Lab

Prototype for **cohort-level temporal queries over cBioPortal clinical timeline events** (msk_chord_2024).
Users define cohorts by relationships between events — "progression within 180 days of starting immunotherapy",
"first chemo NOT followed by progression in a year" — and the server compiles that DSL to ClickHouse SQL.

## Architecture

- `app/page.js` — query-builder UI (selectors, temporal relations, recipes, treatment-lines explorer)
- `app/api/*` — API routes; the browser sends DSL JSON only, never SQL
- `lib/compiler.js` — DSL → ClickHouse SQL compiler (selectors, BEFORE/DURING/NOT_FOLLOWED_BY relations,
  occurrence pinning, observability guard, derived treatment-line events)
- `lib/ch.js` — server-side ClickHouse HTTP client; credentials come from env and never reach the client

## The DSL

The query language is documented in [`docs/dsl.md`](docs/dsl.md) — selectors, temporal
relations, guards, derived treatment-line events, semantics, and worked examples with real
msk_chord_2024 counts. A machine-readable contract is in
[`docs/cohort-query.schema.json`](docs/cohort-query.schema.json) (JSON Schema 2020-12).

## Environment variables

| var | example |
|---|---|
| `CLICKHOUSE_URL` | `https://<host>:8443` |
| `CLICKHOUSE_USER` | read-only user scoped to one database |
| `CLICKHOUSE_PASSWORD` | — |
| `CLICKHOUSE_DB` | `cbioportal_public_librechat_blue` |
| `STUDY_ID` | `msk_chord_2024` |
| `PORTAL_URL` | `https://www.cbioportal.org` |

Copy them into `.env.local` for local dev; set them in Vercel Project Settings → Environment Variables for deploys.

## Run locally

```bash
npm install
npm run dev        # or: npm run build && npm start
```

`e2e.js` is a Playwright suite that exercises the full flow against the live backend
(requires a running server on :3100 and a local Chromium).
