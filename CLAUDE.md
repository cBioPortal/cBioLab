# Cohort Lab — project instructions

> **New session? Read `HANDOFF.local.md` in this directory FIRST** (gitignored; machine/ops
> specifics, credentials locations, pending work, and working-style notes that must not live
> in this public repo).
>
> **Before touching federation, explore, or MCP tools, read
> [`docs/DATA-BOUNDARY.md`](docs/DATA-BOUNDARY.md).** Patient-level data must never leave the
> database that holds it except to a participant entitled to it. That rule outranks any feature
> request; it is enforced by `test/boundary.test.ts` (`npm run test:boundary`), and those tests
> are mutation-verified to actually fail when the boundary is weakened.

## What this is

A working demonstration that a cBioPortal-class tool can be rebuilt around **one declarative
JSON object** — the *Analysis document* (`{study, cohorts: {name: def}, views: [...]}`) — that
the web UI, the in-app chat, and MCP clients all read and write. The server compiles it to
ClickHouse SQL; clients never send SQL. Live at https://cohort-lab.vercel.app (UI at
`/analysis`, MCP at `/api/mcp`, oncoprint spec demo at `/oncoprint`).

## Architecture map

- **`lib/cohort2.ts`** — DSL v2 cohort compiler: `{all:[clause]}`, clause = leaf | `{any:[...]}`
  | `{not:leaf}`; leaf kinds: `oql`, `clinical`, `event` (v1 timeline sub-DSL), `patients`,
  `profiled`, `caseList`, `genomicData`, `genericAssay` (+deprecated `alteration`→OQL).
- **`lib/oql.ts`** — the honest OQL subset; `DRIVER` joins the version-pinned OncoKB store.
- **`lib/compiler.ts`** — v1 timeline/event sub-DSL (BEFORE/DURING/NOT_FOLLOWED_BY,
  observability guard, priorGuard, derived treatment lines).
- **`lib/analysis.ts`** — `runAnalysis(doc)`: evaluates cohorts (per-study; cross-study
  federation via study-qualified member ids), runs views (compare/survival/oncoprint).
- **`lib/oncoprint.ts`** — spec → render contract (bitmask cells, NOT_PROFILED=-1, panel-aware
  denominators, staircase + declarative `sort`, clinical tracks incl. numeric heat, `heatmap`
  molecular tracks incl. synthetic `VAF`). Renderers are dumb: **`lib/oncoprint-svg.ts`**
  (server), `app/oncoprint/page.tsx` (canvas), `mcp/apps/oncoprint-html.ts` (MCP App iframe).
- **`lib/explore.ts`** — faceted study exploration, single + federated (`buildExploreFederated`).
- **`app/analysis/page.tsx`** — the app: Explore (study checkboxes + facets) / Cohorts / Analysis / Examples.
- **`app/api/chat/route.ts`** — Claude tool-use loop (`update_document`, `get_catalog`).
- **`mcp/tools.ts`** — MCP registry: `describe_dsl`, `run_analysis`, `render_oncoprint` (+v1
  event tools); `mcp/apps/` = optional MCP-Apps interactive oncoprint (additive; user considers
  it premature — don't invest further without being asked).
- **`lib/dsl-reference.ts`** — **THE single source of truth for DSL documentation.**

## Invariants — do not break these

1. **Loud rejection, never silent approximation.** Anything the data can't honestly answer
   (unsupported OQL token, unknown attribute/profile/study, VAF without allele counts) throws
   a specific error listing what IS available.
2. **Provenance everywhere.** Every result carries its definition readback, compiled SQL, and a
   shareable `?doc=`/`?spec=` link. OncoKB annotations are version-pinned (pin echoed in results).
3. **Compilers are single-study; federation happens at the analysis layer** with study-qualified
   ids. Cross-study: overlap is deliberately NOT deduplicated, vocabularies NOT harmonized —
   and views/captions must say so.
4. **Docs are generated.** Never hand-edit `docs/dsl.md`. Change `lib/dsl-reference.ts`, run
   `npm run docs:gen`, commit both. `EXAMPLES` there is also what the app's **Examples tab**
   renders, so one edit updates the doc, the MCP `describe_dsl` tool, and the gallery at once —
   and the docs gate already proves every gallery entry runs. `npm run docs:check` (part of e2e) fails on drift and
   EXECUTES every documented example against the live compiler. The chat prompt grammar and the
   MCP `describe_dsl` tool render from the same module.
5. **SQL injection surface**: cohort SQL passes between modules only via the `PIDS_SQL` Symbol
   (JSON can't forge Symbol keys). Keep it that way.
6. **Track labels are sort keys** — engine and UI derive them from the shared
   `lib/profile-names.ts`; never fork that logic.
7. Methodology caveats (panel-aware denominators, left truncation, prior-treatment guard,
   `observed:true` on absence queries) are attached by the engine, not left to prose.
8. **The patient-data boundary** (`docs/DATA-BOUNDARY.md`) — aggregate-only and remote
   participants never emit or receive patient identifiers, and the guarantee is a *missing
   method* rather than a flag. Views degrade and say so rather than silently narrowing.
   Never add an id-returning path to `AggregateResolver` / `RemoteAggregateResolver`.

## Workflows

- Build: `npm run build`. Dev serve: `npx next start -p <port>`.
- Test: `npm test` — unit suites, no database needed (the patient-data boundary and the stats used by
  federated views;
  62 checks across 2 suites). `node e2e.cjs` — 45 checks (Playwright + docs gate + the boundary suite).
  Secrets come from `.env.local` at runtime; never hardcode them anywhere, including tests.
- Every feature: build → verify with real numbers (screenshots via Playwright; cross-check
  counts against known values) → run e2e → commit → push `analysis`. **Stop there.**
- **`master` is human-gated.** Never fast-forward or merge to `master` on your own initiative;
  do it only when the user says so in that session. `master` is the deploy branch of a repo
  under the `cBioPortal` org — advancing it is a publishing act, not a bookkeeping step, and
  there is no CI, so the only gate is a person deciding the work is ready.
- **What e2e actually proves.** `node e2e.cjs` drives a local `npx next start -p 3100` against
  the **built working tree** — `.next` from the last `npm run build` — not against a commit and
  not against production. So: rebuild before running it, and if the tree is dirty you are
  testing uncommitted code. It needs live ClickHouse credentials from `.env.local`, which is
  also why it cannot run in CI as written.
- Commit style: author is the user; end messages with the Claude co-author trailer. One commit
  per feature with a body that explains semantics and what was verified.
