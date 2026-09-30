# cbio-lab

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

### Site password

`proxy.ts` puts the whole site behind one shared password (`lib/site-auth.ts`). There are no
per-user accounts; everyone who signs in shares the same saved cohorts and workspaces.

| var | meaning |
|---|---|
| `SITE_PASSWORD` | the password. Unset → no gate (local dev, e2e); on a Vercel deployment an unset password answers 503 rather than serving the site open |
| `AUTH_SECRET` | signs the 30-day session cookie; any long random string (`openssl rand -hex 32`). Changing it or the password signs everyone out |
| `SITE_API_TOKEN` | optional. `Authorization: Bearer <token>` is accepted on `/api/*` for scripts and the Python client (`COHORTLAB_TOKEN`). When set it is also **required** on `/api/mcp`; when unset `/api/mcp` stays open, so MCP connectors that cannot sign in keep working |

Set all three for both Production and Preview. Sign out with `POST /api/logout`.

## MCP server

The MCP endpoint ships inside the Next.js app at **`/api/mcp`** (`app/api/[transport]/route.js`
via `mcp-handler`), so a Vercel deploy serves it automatically. `npm run mcp` runs the same tools
as a standalone Streamable HTTP server (default `127.0.0.1:3201/mcp`). Both expose four
tools to LLM clients: `describe_study`, `query_cohort` (the DSL), `derive_treatment_lines`, and
`render_oncoprint` (returns a PNG image block rendered server-side from the OncoprintSpec
contract via `lib/oncoprint-svg.js`). Tool schemas mirror `docs/cohort-query.schema.json`, and
results carry the semantic caveats (observability guard, prior-medication guard, panel-aware
denominators) for the model to surface. Register in Claude Code:

```bash
claude mcp add --transport http cohort-lab https://<your-deployment>/api/mcp
# with SITE_API_TOKEN set on the deployment:
claude mcp add --transport http cohort-lab https://<your-deployment>/api/mcp --header "Authorization: Bearer <token>"
```

`mcp/test-client.mjs` exercises all four tools end to end.

## Run locally

```bash
npm install
npm run dev        # or: npm run build && npm start
```

`e2e.js` is a Playwright suite that exercises the full flow against the live backend
(requires a running server on :3100 and a local Chromium).
