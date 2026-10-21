# cbio-lab

Prototype for **cohort-level temporal queries over cBioPortal clinical timeline events** (msk_chord_2024).
Users define cohorts by relationships between events — "progression within 180 days of starting immunotherapy",
"first chemo NOT followed by progression in a year" — and the server compiles that DSL to ClickHouse SQL.

## Architecture

- `app/lab/` — the analysis app (Explore, cohorts, the analysis page, examples); `/` redirects there
- `app/api/*` — API routes; the browser sends DSL JSON only, never SQL
- `lib/analysis.ts` — `runAnalysis(doc)`: evaluates the cohorts and hands each view to its runner (`lib/views/`)
- `lib/cohort2.ts`, `lib/oql.ts`, `lib/compiler.ts` — the cohort DSL → ClickHouse SQL compilers (clauses,
  OQL, and the timeline sub-DSL's BEFORE/DURING/NOT_FOLLOWED_BY relations, guards and treatment lines)
- `lib/ch.ts` — server-side ClickHouse HTTP client; credentials come from env and never reach the client

The full map, with the invariants, is in [`CLAUDE.md`](CLAUDE.md).

## The DSL

The query language is documented in [`docs/dsl.md`](docs/dsl.md) — selectors, temporal
relations, guards, derived treatment-line events, semantics, and worked examples with real
msk_chord_2024 counts. It is generated from `lib/dsl-reference.ts`, which MCP clients also read
through the `describe_dsl` tool.

## Environment variables

Every setting is in **[`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)**, grouped by what it controls:
data, federation, sign-in and saved data, the site, the assistant, performance, building, and
the test and check scripts. To run locally you need only `CLICKHOUSE_URL`, `CLICKHOUSE_USER`,
`CLICKHOUSE_PASSWORD` and `CLICKHOUSE_DB` in `.env.local`; on Vercel they go in Project
Settings → Environment Variables.

## Federation

One analysis can draw on studies held by more than one cBioPortal database, and the prototype
offers that **over MCP**: the database that holds a study answers aggregate queries (and, opted
in, some patient-level ones) through its `/api/mcp`, and this app never queries it directly.
`docs/DATA-BOUNDARY.md` is the design and its rules.

There are two ways to run it:

- **A simulated peer** (the public portal, dev servers, the gate): one deployment holds both
  databases and serves the second one to itself over MCP (`LOOPBACK_PEER`). Every query on that
  database runs only while the app is answering an MCP call as that peer; a direct query on it,
  or one naming its database on the other connection, is refused (`lib/ch.ts`). It exercises
  the real protocol with no second deployment, but it is not separation: one process, one login.
- **A separate peer**: a second cbio-lab instance whose own database is the other one, reached at
  its `/api/mcp` (`PEER_MCP`). This instance then holds no connection to that database at all.

Its settings, and how to set it up for the public portal, dev servers and a separate peer, are
in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md#federation).

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

### Seeing it work

Every federated call is logged at both ends (`lib/federation-log.ts`), in the server's output
(on Vercel, the project's runtime logs) — the study and tool, never a patient:

```
[federation →] federated_aggregates study=nsclc_public_genie_bpc peer=https://cbiolab.vercel.app/api/mcp (this app, as its simulated peer) 214ms ok 0.9 kB
[federation ←] federated_aggregates study=nsclc_public_genie_bpc caller=this app (answered as its simulated peer) 89ms HTTP 200 answered 1.1 kB
[federation ←] federated_patient_timeline study=nsclc_public_genie_bpc (patient-level) caller=outside 461ms HTTP 200 REFUSED
```

`→` is this app asking a peer, `←` its `/api/mcp` answering; `caller=outside` is anyone else.

The answer says so too. Every analysis result lists its `sources` — each database of this
deployment and each peer, with the peer's address, the name and build it reports about itself, when
it answered, and when each study's data was imported there — and each view's `participation`
points into that list. The Analysis tab shows it under the cohorts ("Data from: …"), and MCP's
`run_analysis` text says it as well. An
analysis answered from the result cache makes no calls, so it logs none. A `[boundary]` line means
a query reached the simulated peer's database directly and was refused (`lib/ch.ts`) — a bug.

### Security notes

- **No caller authentication yet.** Anyone who can reach a peer's `/api/mcp` can call it. On a
  simulated peer the patient-level tools answer only the app itself (the token); a separate peer
  answers anyone, so it must not be reachable from outside.
- The boundary is enforced by the coordinator: a peer's own `run_analysis`, `query_cohort` and
  web API answer patient-level for its own studies to any caller. Fine for public data; a peer
  serving restricted data needs caller authentication and those closed first.
- There is no small-cell suppression: counts are exact.

## MCP server

The MCP endpoint ships inside the Next.js app at **`/api/mcp`** (`app/api/[transport]/route.ts`
via `mcp-handler`), so a Vercel deploy serves it automatically. `npm run mcp` runs the same tools
as a standalone Streamable HTTP server (default `127.0.0.1:3201/mcp`). Both serve the tools
`mcp/tools.ts` registers: the analysis tools (`describe_dsl`, `run_analysis`, `describe_study`,
`query_cohort`, `derive_treatment_lines`, and `render_oncoprint`, which returns a PNG rendered
server-side from the OncoprintSpec contract via `lib/oncoprint-svg.ts`), the campaign tools
(`campaign_*`), and the `federated_*` tools another instance calls (see Federation, above). Tool schemas are the zod fragments in `mcp/tools.ts`, and
results carry the semantic caveats (observability guard, prior-medication guard, panel-aware
denominators) for the model to surface. Register in Claude Code:

```bash
claude mcp add --transport http cohort-lab https://<your-deployment>/api/mcp
```

## Run locally

```bash
npm install
npm run dev        # or: npm run build && npm start
```

`e2e.js` is a Playwright suite that exercises the full flow against the live backend
(requires a running server on :3100 and a local Chromium).
