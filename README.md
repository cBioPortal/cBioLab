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
| `EXAMPLES_URL` | optional: set on an instance whose database is not the public warehouse, e.g. `https://cbiolab.vercel.app`. The gallery examples are written for the public studies, so the Examples tab then opens each one there (after saying the reader is leaving), instead of running it here. Unset, they run on this instance |
| `PUBLIC_ENV` | optional: the environment variables written into the page for the browser to read, comma-separated (default `EXAMPLES_URL`). Read per request, so one image serves every deployment; a name that looks like a secret (`PASSWORD`, `SECRET`, `KEY`, `TOKEN`, `CREDENTIAL`) is refused |
| `CHAT_PROVIDER` | optional: `anthropic` (with `ANTHROPIC_API_KEY`) or `bedrock` (with `AWS_REGION` and AWS credentials) turns on the Assistant sidebar on a dev server (`next dev`) |
| `CHAT_ON_DEPLOYMENT` | `1` also turns it on in a built deployment (never on Vercel), for signed-in users only |
| `CHAT_MODEL` / `CHAT_EFFORT` | optional: the model id (default Claude Sonnet 5.5, `claude-sonnet-5-5` / `anthropic.claude-sonnet-5-5`) and effort (default `medium`) |

Copy them into `.env.local` for local dev; set them in Vercel Project Settings → Environment Variables for deploys.

## Federation

One analysis can draw on studies held by more than one cBioPortal database, and the prototype
offers that **over MCP**: the database that holds a study answers aggregate queries (and, opted
in, some patient-level ones) through its `/api/mcp`, and this app never queries it directly.
`docs/DATA-BOUNDARY.md` is the design and its rules; this section is how to set it up.

There are two ways to run it:

- **A simulated peer** (the public portal, dev servers, the gate): one deployment holds both
  databases and serves the second one to itself over MCP (`LOOPBACK_PEER`). Every query on that
  database runs only while the app is answering an MCP call as that peer; a direct query on it,
  or one naming its database on the other connection, is refused (`lib/ch.ts`). It exercises
  the real protocol with no second deployment, but it is not separation: one process, one login.
- **A separate peer**: a second cbio-lab instance whose own database is the other one, reached at
  its `/api/mcp` (`PEER_MCP`). This instance then holds no connection to that database at all.

### Settings

| var | where | meaning |
|---|---|---|
| `CLICKHOUSE_LABEL` | any | optional: the name of this instance's own database in the UI (default `primary`) |
| `CLICKHOUSE2_URL`, `_USER`, `_PASSWORD`, `_DB`, `_LABEL` | the deployment holding both databases | the second database (connection id `b`). On its own it is queried directly; with `LOOPBACK_PEER=b` only through the simulated peer |
| `LOOPBACK_PEER` | same | `b`: serve the second database to this app as a simulated peer over MCP |
| `LOOPBACK_PEER_URL` | same | this deployment's own MCP endpoint, e.g. `https://cbiolab.vercel.app/api/mcp`. Unset, `http://127.0.0.1:$PORT/api/mcp` (needs `PORT`) |
| `LOOPBACK_PEER_TOKEN` | same, required where several processes serve the app (Vercel) | a secret of 32+ characters (`openssl rand -hex 24`) that marks the app's calls to itself. Unset, each process makes its own, which works for a single `next dev`/`next start` process only |
| `LOOPBACK_PEER_LABEL` | same | optional: how the peer's studies are labelled, e.g. `GENIE (via MCP)` (default `<CLICKHOUSE2_LABEL> (simulated peer)`) |
| `PEER_MCP` | a coordinator using a separate peer | which studies a peer serves: `study=url` pairs, comma-separated, e.g. `genie_public=http://peer:3000/api/mcp,nsclc_public_genie_bpc=http://peer:3000/api/mcp`. Only the studies listed are taken from that peer |
| `PEER_LABEL` | same | optional: how those studies are labelled (default `peer via MCP`) |
| `MCP_DISCLOSE_PATIENTS` | the peer (for a simulated peer: the deployment) | opt-in patient-level federation, what the peer sends: rules `study:kind+kind`, comma-separated, `*` for every study. Kinds: `timeline`, `alterations` (a bare study means `timeline`). Unset, the peer sends aggregates only |
| `PEER_MCP_PATIENT_LEVEL` | the coordinator (for a simulated peer: the deployment) | the same rules, for what this app accepts. Patient-level data crosses only where both sides allow the study and kind |
| `FEDERATION_HIDE_SQL` | the peer | `1`: do not send the SQL it ran back with its answers (provenance then stops at the peer) |
| `AGGREGATE_ONLY_INSTANCES` / `AGGREGATE_ONLY_STUDIES` | any | connection ids (`a`, `b`) or study ids this deployment treats as aggregate-only: their patients are never listed, as for a peer that does not disclose them |
| `STUDY_DENY` | any | study ids to exclude entirely, comma-separated |
| `STUDY_ALLOW_RESTRICTED` | a deployment entitled to restricted data | `1`: also serve studies named `…-consortium` or `private`, which are otherwise never routed |

### The public portal (Vercel), over MCP

Keep `CLICKHOUSE2_*` and add, for **Production** only (a preview deployment would otherwise call
production's endpoint):

```
LOOPBACK_PEER=b
LOOPBACK_PEER_URL=https://cbiolab.vercel.app/api/mcp
LOOPBACK_PEER_TOKEN=<openssl rand -hex 24, marked Sensitive>
LOOPBACK_PEER_LABEL=GENIE (via MCP)
MCP_DISCLOSE_PATIENTS=*:timeline+alterations
PEER_MCP_PATIENT_LEVEL=*:timeline+alterations
```

Then redeploy. The study picker labels the second database's studies `GENIE (via MCP)`, and a
view's "how these numbers were computed" marks the queries that ran on the peer. Without the last
two lines the peer is aggregate-only: the timeline and alterations views are not drawn over its
studies either.

### Dev servers

`scripts/session-setup.sh` turns the simulated peer on in each session's `serve-<port>.sh`:

```
export PORT=<port> LOOPBACK_PEER=b MCP_DISCLOSE_PATIENTS='*:timeline+alterations' PEER_MCP_PATIENT_LEVEL='*:timeline+alterations'
```

These go in the serve script, **not** `.env.local`: `scripts/gate.sh` builds and serves from the
same folder on its own port, reading `.env.local`, and a `PORT`/`LOOPBACK_PEER` there would send
its loopback calls to the dev server. The gate runs its own federation stage
(`scripts/e2e-federation.cjs`) with the simulated peer whenever `CLICKHOUSE2_*` is set.

### A separate peer

Run a second instance whose `CLICKHOUSE_*` is the other database (and no `CLICKHOUSE2_*`,
`PEER_MCP` or `LOOPBACK_PEER` of its own), with `MCP_DISCLOSE_PATIENTS` if it shares patient-level
data. On this instance, remove `CLICKHOUSE2_*` and set `PEER_MCP` (and `PEER_LABEL`,
`PEER_MCP_PATIENT_LEVEL`). The study list and each study's catalog then come from the peer
(`federated_studies`, `federated_catalog`). Bind the peer where only this instance can reach it:
see the security notes below.

### What a federated study supports

Every view either draws over every patient of its cohorts or is not drawn and says why
(`lib/view-coverage.ts`); the add-view buttons and cohort pickers are disabled with the reason.

| | over MCP, aggregates | over MCP, patient-level (`timeline`, `alterations` shared) |
|---|---|---|
| drawn | compare, survival, cooccurrence, coexpression, clinical, hotspots, attrition, course, sequence; Explore, study list, catalog | the same, plus timeline and alterations |
| not drawn over the peer's studies | oncoprint, clinical data table, mutation table, cox, logistic, risk model, plot, genome, pathways, enrichment, overlap, incidence, cancer types, clonality, paired, diffexpr, correlates, assays, labs, composition | the same |

Measured cost (`docs/DATA-BOUNDARY.md`, "Federation: where it stands"): about +0.3–0.4 s per
analysis for aggregate views on a small study, about +2 s for the patient-level views; on a large
study the database's own time dominates.

### Security notes

- **No caller authentication yet.** Anyone who can reach a peer's `/api/mcp` can call it. On a
  simulated peer the patient-level tools answer only the app itself (the token); a separate peer
  answers anyone, so it must not be reachable from outside.
- The boundary is enforced by the coordinator: a peer's own `run_analysis`, `query_cohort` and
  web API answer patient-level for its own studies to any caller. Fine for public data; a peer
  serving restricted data needs caller authentication and those closed first.
- There is no small-cell suppression: counts are exact.

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
```

`mcp/test-client.mjs` exercises all four tools end to end.

## Run locally

```bash
npm install
npm run dev        # or: npm run build && npm start
```

`e2e.js` is a Playwright suite that exercises the full flow against the live backend
(requires a running server on :3100 and a local Chromium).
