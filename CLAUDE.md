# cbio-lab — project instructions

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
the web UI and MCP clients all read and write. `cohorts` is a store: **every view names the cohorts it
draws in its own `cohorts` list** (since DSL 2.5 there is no "all cohorts" default — a view without a
list is empty, and the page shows it waiting for one). The analysis page shows the store as a
summary ("Cohorts in this analysis": size, studies, which views draw each); cohorts come in through
a view's "+ Add cohort" (`app/lab/add-cohort-dialog.tsx`: the analysis's own, the library, or
Explore in add mode, which returns the selection to that view). The server compiles it to
ClickHouse SQL; clients never send SQL. Live at https://cbiolab.vercel.app (UI at
`/lab`, MCP at `/api/mcp`, project rationale at `/rationale`).

## Architecture map

The full map, with the reasoning, is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the domain's
terms are defined in [`docs/DOMAIN.md`](docs/DOMAIN.md). Read the section for the area you are
changing first. The parts, and the one place each rule lives:

- **The document → SQL.** `lib/cohort2.ts` compiles cohorts (`{all:[clause]}`; leaf kinds `oql`,
  `clinical`, `event`, `patients`, `profiled`, `caseList`, `genomicData`, `genericAssay`, `upload`);
  `lib/oql.ts` is the OQL subset; `lib/compiler.ts` the v1 timeline sub-DSL; `lib/analysis.ts`
  `runAnalysis(doc)` evaluates cohorts and hands each view to its runner.
- **View kinds** — a folder `lib/views/<kind>/` (`types`, `run`, `sql`, `method`, `figure`, `kind`)
  plus `app/lab/kinds/<kind>.tsx`, and one line in each registry: `lib/views/index.ts` (runners),
  `lib/views/kinds.ts` (descriptors), `app/lab/kinds/index.ts` (page files). **Kinds never import
  each other** (`local/kind-boundary`). Runners combine sites' answers after all are in
  (`askEachSite`). Most kinds' SQL goes through `viewAggregate`/`viewMeta` (`lib/federation-views.ts`).
- **Oncoprint** — `lib/oncoprint.ts` (fetch) → `lib/oncoprint-assemble.ts` (pure contract); every
  renderer reads `lib/oncoprint-style.ts` and `lib/oncoprint-lod.ts` (invariant 8). Other figures:
  `lib/view-svg.ts` through each kind's descriptor, laid out with `lib/chart/`.
- **Table views** — supply a `RowSource`; `lib/table-query.ts` does pagination, search, filters,
  sort, CSV and columns in the database; UI `app/_table/DataTable.tsx`. Never build these per view.
- **Patient views** (`timeline`, `alterations`) — one patient at a time, navigator
  `app/lab/patient-nav.tsx`; opt-in patient-level federation through `lib/disclosure.ts`.
- **THE one place for:** timeline event-name folding — `lib/event-names.ts`; a treatment line —
  `lib/treatment-lines.ts`; template parameters — `lib/params.ts`; splits — `lib/partition-arms.ts`
  and `lib/cohort-partitions.ts`; upgrading an older document — `lib/doc-version.ts`; a setting
  reaching the browser — `lib/public-env.ts`; a page's request — `app/lab/api.ts` with
  `lib/api-schemas.ts`; reading `clinical_data_derived`/`clinical_attribute_meta` —
  `clinicalTable`/`clinicalMetaTable` in `lib/custom-data.ts`; sharing rules — `lib/access.ts`; the
  Postgres client — `lib/db.ts` (migrations `db/migrations/`, run by `lib/migrate.ts`); stored id
  sets — `lib/id-set-store.ts`; DSL documentation — `lib/dsl-reference.ts`.
- **Accounts and stores** — signing in `lib/auth.ts`/`lib/oidc.ts`, people `lib/users.ts`, groups
  `lib/groups.ts`, custom data `lib/custom-store.ts`, saved artifacts `/api/artifacts`.
- **The pages** — `app/lab/page.tsx` wires hooks (`use-*.ts`) and sections; a new action goes in the
  hook for its kind. The homepage is `app/_home/`; shared study chooser and gene editor in
  `app/_studies/`, `app/_genes/`.
- **Agents** — WebMCP tools `lib/webmcp.ts` / `app/lab/agent-tools.ts`; MCP server `mcp/tools.ts`.
  **The chat sidebar is the app's only model call and is just another WebMCP client** — never give it
  a private way in. **The campaign engine (`lib/campaign.ts`, `lib/hypothesis.ts`) never calls a
  model**, and a locked campaign is immutable at the database level.

## Docs worth reading before changing things

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the full map of the code (indexed above).
- [`docs/DOMAIN.md`](docs/DOMAIN.md) — what the domain's words mean (profiled, off-panel, uncalled,
  driver, split, anchor, patient-level), and where each rule behind them lives.
- [`docs/UI.md`](docs/UI.md) — the layout system and the waiting rules, before any UI change.
- [`docs/DATA-BOUNDARY.md`](docs/DATA-BOUNDARY.md) — the patient-data rule and how it is enforced.
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — measured comparison against cbioportal.org, how
  Explore scales with study count, and **the panel-aware denominator rule that outranks all of
  it**: a sample whose gene panel omits a gene is NOT PROFILED for it, never wild-type, so a
  frequency is `altered ÷ samples profiled for THAT gene`. Dividing by a study or selection total
  does not error — it silently reports every gene as rarer than it is. The numerator counts only
  calls a covering panel made: an off-panel call (`off_panel`) is in neither side, as on
  cBioPortal (§1 there). Both halves are additive
  over samples, which is what makes pooling safe; averaging per-study percentages is never safe.
  Guarded by `test/denominator.test.ts` and `npm run check:denominators` (a stage of `scripts/gate.sh`); over
  studies profiled differently (panel, several panels, whole-exome), `npm run check:pooled`
  (histograms, the OncoPrint) and `check:portal`'s mixed selection, filtered and not, are gate stages.
  Read before claiming this project is "fast": on a cached single chart the portal is ~20x
  quicker (those measurements predate the result cache of invariant 11, which answers only
  exact repeats), and our advantage is data movement (36x less to the
  browser), not speed. Also records the ceiling on inline id lists (~12,000 sample ids) and the
  stored id sets that remove it.

## Invariants — do not break these

1. **Loud rejection, never silent approximation.** Anything the data can't honestly answer
   (unsupported OQL token, unknown attribute/profile/study, VAF without allele counts) throws
   a specific error listing what IS available.
2. **Provenance everywhere.** Every result carries its definition readback, compiled SQL, and a
   shareable `?doc=`/`?spec=` link. Two levels: the document panel shows each cohort's compiled
   SQL, and every view shows the aggregate queries that produced its numbers (resolvers log what
   they run; a peer returns its own log, marked as having executed there). OncoKB annotations are version-pinned (pin echoed in results).
   Every result lists its `sources` (`lib/provenance.ts`): each database and MCP peer, with what a
   peer reports about itself in every answer (name, build, each study's import date), and each
   view's participation points into that list.
3. **Compilers are single-study; federation happens at the analysis layer** with study-qualified
   ids. Cross-study: overlap is deliberately NOT deduplicated, vocabularies NOT harmonized —
   and views/captions must say so.
4. **Docs are generated.** Never hand-edit `docs/dsl.md`. Change `lib/dsl-reference.ts`, run
   `npm run docs:gen`, commit both. `EXAMPLES` there is also what the app's **Examples tab**
   renders, so one edit updates the doc, the MCP `describe_dsl` tool, and the gallery at once —
   and the docs gate already proves every gallery entry runs. `npm run docs:check` (a stage of `scripts/gate.sh`) fails on drift and
   EXECUTES every documented example against the live compiler. The agent grammar (`AGENT_GRAMMAR`,
   served by the WebMCP `dsl_reference` tool) and the MCP `describe_dsl` tool render from the same module.
   **Every example's cohort counts are pinned** in `test/fixtures/example-counts.json` and asserted
   by the same gate, so "it still runs" is not mistaken for "it still gives the same answer". A
   renamed cohort, a moved number and a pin left behind by a deleted example all fail. After an
   intentional change (or a warehouse reload, or a new OncoKB pin) review what moved and re-pin
   with `npm run docs:counts`.
5. **SQL injection surface**: cohort SQL passes between modules only via the `PIDS_SQL` Symbol
   (JSON can't forge Symbol keys). Keep it that way.
6. **Track labels are sort keys** — engine and UI derive them from the shared
   `lib/profile-names.ts`; never fork that logic.
7. Methodology caveats (panel-aware denominators, left truncation, prior-treatment guard,
   `observed:true` on absence queries) are attached by the engine, not left to prose.
8. **Renderers read `lib/oncoprint-style.ts`; they never define a colour, band, priority or legend
   label of their own.** The Python port is pinned by conformance tests (contract JSON, bucket
   codes) and golden snapshots (`test/fixtures/oncoprint/golden.svg`, `golden-raster.npz`;
   `UPDATE_GOLDEN=1` to accept an intentional change). These are real cross-language checks —
   `python/tests/test_cohortlab.py`'s `Conformance` and `LevelOfDetailConformance` classes shell
   out to `node scripts/oncoprint-cli.ts` and diff its output against the Python port — and
   `scripts/gate.sh` runs the whole Python suite (bootstrapping `python/.venv` on first run) as
   part of every gate, so a TS-only change to the assembler, LOD or binary format fails the gate
   if the port drifts. `npm run test:python` runs just that suite while iterating. The
   conformance tests assert `node` is on `PATH` rather than skipping when it isn't — a missing
   dependency must fail loud, not silently pass.
9. **The document holds anything that changes what a reader sees; the browser holds the rest.**
   If a setting would change a shared link, the server-rendered SVG, the CLI or the Python
   package, it belongs in the view — that is why the oncoprint's viewing options are a `display`
   object and not React state. Zoom, scroll, hover, an open menu and a drag selection describe a
   viewport or a moment, not a figure, and stay out. A menu that mixes the two says which is
   which (see the display popover's "this browser only" group).
10. **The patient-data boundary** (`docs/DATA-BOUNDARY.md`) — aggregate-only and remote
   participants never emit or receive patient identifiers, and the guarantee is a *missing
   method* rather than a flag. A view is drawn over every patient of its cohorts or not at all:
   `lib/view-coverage.ts` is the one rule — the engine refuses by it before a view runs, the page
   disables the add-view button and the cohort it applies to — and a new view kind that leaves a
   participant out needs its entry there (`test/view-coverage.test.ts` checks the runners).
   Never add an id-returning path to `AggregateResolver` / `RemoteAggregateResolver`.
11. **Results are cached with `'use cache: remote'`** (`lib/next-cache.ts`; Next 16 Cache
   Components). On Vercel it is Runtime Cache, shared by every function instance; elsewhere it
   is process memory. Analyses, oncoprint contracts, Explore, the study catalog and the study
   list all go through it, from the web routes, `/api/mcp` and chat alike.
   - **A deploy clears it** (Next keys every entry by deployment), a data import or OncoKB
     release does too (`dataVersion()` is an argument of every cached function), and entries
     regenerate after a day.
   - **Only a returned value is stored.** A refusal, a partial answer (an instance that did not
     reply) or an abandoned query must THROW, or it is served to everyone for a day.
   - **Read through `throughCache(cached, direct)`.** A production build replaces the message of
     anything thrown inside a cached function, so when the cached call throws the direct one runs
     and reports the real error. It also covers a cache that cannot be read.
   - **`RESULT_CACHE=off` turns it off.** `throughCache` then runs the direct call on every
     request, so a server answers everything cold — for measuring what a first reader waits for.
     Without a cache handler configured (anywhere but Vercel), the cache is the Node process's own
     50 MB LRU (`cacheMaxMemorySize`): lost on restart, and not shared between replicas.
   - **Arguments are the key.** A cached function takes only serializable arguments and computes
     everything else itself; a function passed in cannot be called. Anything that changes the
     answer must be an argument.
   - Entries are gzipped JSON as base64 text (`pack`): Runtime Cache refuses items over 2 MB,
     and has handed typed arrays back corrupted.
   - `next/cache` exists only under Next, so the stdio MCP server, CLI and tests run the engine
     uncached; `registerTools` takes the engine to use.
12. **Every view states how its numbers were computed, and that statement is checked.** A view's
   result carries a method record (`lib/method.ts`): each step from its queries' rows to its numbers,
   built from the values that computation used, plus a Python script that recomputes the numbers
   with standard libraries. **A change to how a view computes must update its method builder in the
   same commit** — the steps, the script and the `check` values the script must reproduce.
   `npm run check:methods` (a stage of `scripts/gate.sh`, which runs it with `docs:check` off one run
   of the examples: `npm run check:examples`) runs every gallery example's script and
   fails on any number the script does not reproduce, and on any view without a record that is not on
   its named exempt list; it was mutation-checked to catch a real drift. Numbers and settings in a
   record's text come from variables or named constants, never typed in. The statistics themselves
   are pinned against lifelines/statsmodels/scipy/gseapy by `test/*-golden.test.ts`
   (fixtures from `python/golden/`, regenerated with `uv run`).
   **A record's script is also a notebook**: the panel's "download as notebook" posts the document to
   `POST /api/analysis/notebook`, which re-runs it, rebuilds the files the script reads from the view's
   own recorded queries (`lib/method-data.ts` — the same code `check:methods` runs, so the export is
   what was checked; no SQL is ever accepted from a caller) and assembles the `.ipynb`
   (`lib/method-notebook.ts`). A view with rows from a federated peer is refused (403) and the
   notebook is capped at `NOTEBOOK_MAX_BYTES` (413). A new view kind whose script reads a file needs
   its rebuild in `methodFiles`, or the notebook says the file is missing.

13. **`/verification` reports what the checks found; it never restates a claim by hand.** It is the
   report of an automated verification suite meant to run in CI: `npm run verify` runs every stage
   (unit tests, `check:methods`, then the three below with `RECORD=1`), fails on any failing check,
   and writes `docs/verification/*.json` — the report the page reads, committed from a passing run.
   The saved copy is updated by hand; the page links to the latest CI runs on master. CI
   (`.github/workflows/verify.yml`) runs `scripts/gate.sh` as parallel jobs, one lane each (`local`,
   `warehouse`, `e2e`), plus `check:mutants` after the warehouse lane, with `RECORD=1` and
   `REPORT_DIR` (a folder that starts empty, so a stage that never ran leaves no stale file) on every
   PR and push to master, and merges the jobs' folders into the `verification-report` artifact. The planted-bug
   check strips `RECORD`/`REPORT_DIR` from its guard runs, so a run against a planted bug never writes
   a report. The page is written for
   bench scientists and PIs and opens by saying what the suite is and what it depends on (the public
   cbioportal.org API, the warehouse, the studies named in the scripts). The three: `check:portal` (counts, gene frequencies and
   filtered cohorts against cbioportal.org's public API — exact, no tolerance), `check:cohorts` (the
   cohort algebra — and/or/not, splits, line nesting, held-out halves — as set arithmetic over
   patient ids, and fast-check-generated definitions compared with a reference evaluator over the
   raw rows) and `check:mutants` (plants each bug in `scripts/check-mutants.ts` into a temp copy
   and requires a check to fail). The first two are gate stages. A new statistic gets a row in
   `lib/verification.ts` (`test/verification.test.ts` fails otherwise); new cohort or count logic
   should get a planted bug that proves some check would notice it breaking. A planted bug that
   cannot change any result on this warehouse (e.g. `cna >= 1`, when only ±2 is stored) proves
   nothing — replace it rather than counting it.

## UI conventions

The layout system and the waiting rules are [`docs/UI.md`](docs/UI.md) — read it before any UI
change. The ones most often broken:

- **A figure is the data alone; anything the reader clicks is HTML beside it**, and the figure's
  caption says in words what the controls show. Figures are drawn in the browser at the card's
  width by the renderer MCP uses, with `lib/chart/` — never a colour, size or tick rule of their own.
- **One scale** (`app/globals.css`); new UI is Tailwind and shadcn (`app/_ui/`), joined with `cn()`.
  One header per view (`ViewHead`); controls side by side are a toolbar (`.viewtb` > `.tbz`).
- **Every screen answers "is this current?" and "is this everything?"**: a change that waits on the
  server covers the figure with "updating…"; a fetched control shows a loader; loading, empty and
  failed are three states; a disabled control says why; nothing is dropped without saying so; a
  request past a limit is refused with the limit named.
- **Keystrokes stay in the field** (a small component owns the draft); **one way to change the
  document** (`app/lab/doc-store.ts`).
- **Look at a UI change, then measure it** (`misalignedControls` in `e2e.cjs`), and verify waiting
  states by holding the request.

## Code standards — what `npm run lint` enforces

`npm run lint` (ESLint, knip, ruff) is the gate's first stage; its messages say what to fix. What
they can't tell you:
- **API GET handlers call `await connection()` (`next/server`) first.** One that never reads the
  request is prerendered at build time and serves that answer forever ("no login", an empty
  warehouse); `scripts/gate.sh` fails on any prerendered API route outside its allowlist.
- A promise you deliberately don't wait for is marked `void load();` — don't add an `await` just to
  satisfy the rule. Delete code you stop using; don't park it as `void x;` or an `_` name.
- Disable a rule only on the line where it is wrong, with the reason:
  `// eslint-disable-next-line <rule> -- <why>` (Python: `# noqa: <code>` plus a comment). Never
  change `eslint.config.mjs`, `knip.json` or the ruff rules as part of other work.
- Off on purpose, so don't "fix" code for them: `any` / `no-unsafe-*`, complexity, nesting, formatting.
- Accessibility (`jsx-a11y-x`, `app/**/*.tsx`): clickable things are `<button>`s, every input or
  select has a name (label text, `title` or `aria-label`). A native `<dialog>`'s backdrop click is
  the accepted exception: disable on that line, since Escape closes it.
- The Semgrep and jscpd reports (`npm run report:security`, `report:dupes`): user values reach SQL
  only through `sq()` / `PIDS_SQL` (invariant 5), never turn off TLS verification (`lib/db.ts`'s
  `rejectUnauthorized: false` is the one open finding), factor out rather than copy a long block.

## Workflows

- Build: `npm run build`. Dev serve: `npx next start -p <port>`.
- **Every build knows its commit.** `next.config.mjs` stamps it as `GIT_COMMIT`: Vercel's
  `VERCEL_GIT_COMMIT_SHA`, else a `GIT_COMMIT` passed in (the Docker image takes it as a build
  argument — `.git` is not in its context — and CI passes `github.sha`), else `git rev-parse HEAD`
  with `+dirty` for a changed tree; `next dev` says `dev`. `lib/build-info.ts` reads it; every page's
  footer shows it, linked to the commit, and `GET /api/version` returns it. A build that could find no
  commit (a hand-run `docker build` without `--build-arg GIT_COMMIT=…`) reads "unknown", never blank.
- Test: `npm test` — unit suites, no database needed (the patient-data boundary, the stats used by
  federated views, cohort-definition semantics, clinical-course semantics, and the SVG figure
  renderers, plots, gene tracks, template parameters, the panel-aware denominator, and the
  property tests of `test/properties.test.ts`). `npm run test:db` (~15 s, in `scripts/gate.sh`) runs the stores'
  Postgres SQL, `db/migrations`, their runner and their triggers on an in-process Postgres (PGlite,
  `test/postgres.db-test.ts`), and the stored-id-set request boundary on it
  (`test/request-boundary.db-test.ts`: reading a request's sets, saving a pasted list, locking
  cohorts, against a stand-in warehouse that records which instance each statement and id table
  went to). A store promise belongs in `test/support/store-contracts.ts`, which runs there and on
  `lib/db.ts`'s own fallback.
  `node e2e.cjs` — the browser checks (Playwright) against a running server. The checks that need
  no server (`check:examples`, `check:denominators`, `check:genefacets`, `check:values`,
  `check:splitby-perf`) are stages of `scripts/gate.sh` of their own, and the boundary suite is in
  `npm test`.
  `npm run report:coverage` — the unit suites' coverage (CI shows it on the reports job).
  **Every view kind's output is pinned** by the view snapshot tests (`test/view-snapshots*.test.ts`,
  four parallel shards of `test/support/view-snapshots.ts`; in `npm test`, no
  database): one gallery example per kind runs through the whole engine against warehouse answers
  recorded in `test/snapshots/answers/`, and its compiled SQL and queries, computed result, figure
  and results text are compared with `test/snapshots/<kind>.{sql,json,svg,txt}`. A diff there is a
  change to review, not noise: `UPDATE_SNAPSHOTS=1` accepts output changes, and a changed query
  needs `RECORD_SNAPSHOTS=1 node --env-file=.env.local --test test/view-snapshots*.test.ts`
  (public warehouse only; the answers hold public studies' patient-level rows). A new view kind
  adds its case to `CASES` there (a check fails until it does). Each case also runs with its
  answers delivered in reverse, and must not change: a runner combines what it asked for after
  every answer is in, in the view's order (`askEachSite` in `lib/views/shared.ts`), never inside
  the callback as each one lands.
  Secrets come from `.env.local` at runtime; never hardcode them anywhere, including tests.
- Lint: `npm run lint` (~2 min, the gate's first stage) — see "Code standards" above for what it
  holds code to. While iterating, `npx eslint <files you touched>` is enough.
- Every feature: build → verify with real numbers (screenshots via Playwright; cross-check
  counts against known values) → run e2e → commit → push **your own branch**. **Stop there.**
  This is the checkpoint for a *finished* piece of work, not a loop to run after every edit —
  `node e2e.cjs` needs a fresh production build and a real browser, so it's slow. While iterating,
  use `next dev`'s hot reload for visual changes and `npm test` (fast, no build) for logic
  changes; run the full build+e2e gate once, right before commit/push.
- **Branch from `master`, work on a feature branch, and leave the merge to a person.** There is
  no staging trunk: the `analysis` branch was retired once it stopped being a distinct line of
  development and became a second name for `master`. Name a branch after the work, push it, and
  say what is on it.
- **`master` is human-gated.** Never fast-forward or merge to `master` on your own initiative;
  do it only when the user says so in that session. `master` is the deploy branch of a repo
  under the `cBioPortal` org — advancing it is a publishing act, not a bookkeeping step. CI
  (`.github/workflows/verify.yml`, the whole gate) informs that decision; it does not replace the
  person making it. When they do say so,
  merge the feature branch (`--no-ff`) rather than fast-forwarding, so the branch is legible in
  the history, and delete it afterwards.
- **What e2e actually proves.** `node e2e.cjs` drives a local `npx next start -p 3100` against
  the **built working tree** — `.next` from the last `npm run build` — not against a commit and
  not against production. So: rebuild before running it, and if the tree is dirty you are
  testing uncommitted code. It needs live ClickHouse credentials from `.env.local`; CI writes that
  file from repository secrets. The e2e scripts get their browser from `e2e-browser.cjs`
  (Playwright is a devDependency; `CHROME_PATH` overrides the Chromium it launches).
- Commit style: author is the user; end messages with the Claude co-author trailer. One commit
  per feature with a body that explains semantics and what was verified.

## Session folders, branches and ports

One folder per session, one branch per folder, one dev server per folder on a
stable port that always reflects it. Multiple sessions can run concurrently —
each gets its own worktree, branch and port, so they never write the same
files or fight over `.next`.

| | |
|---|---|
| folder | a git worktree — `~/projects/cbio-next-<name>/cohort-lab` (the orchestrator convention in `~/projects/CLAUDE.md`; not a sibling of `~/cBio-next`) |
| branch | `session/<name>`, checked out only there |
| port | `next dev`, kept alive by `serve-<port>.sh`, serving that folder |
| gate port | a per-session port for `scripts/gate.sh`'s ephemeral e2e server (default 3100 — override with `GATE_PORT` so concurrent sessions gating at the same time don't kill each other's server mid-suite) |

`scripts/session-setup.sh <name> <port> [gate-port]` creates it — worktree, branch, dev server,
and a generated `CLAUDE.md` in the project folder with all of the above filled in.
`scripts/gate.sh` runs build + unit + e2e **in the same folder**, building to
`.next-gate` via `NEXT_DIST_DIR` so it never touches the `.next` the dev server
owns. Run it manually before commit/push, not after every edit — see above.

**The rule is about the DIRECTORY, not the folder.** `next dev` and `next build`
both write `.next`, so they must not share it. Serving a production build from a
directory that is also built in is what broke the tailnet instance three times:
each build rewrote the content-hashed chunk filenames and deleted the ones the
running server still referenced, so the client JS 404ed and every interaction
fell back to a server render — with no error anywhere except a failed request in
the browser console. `next dev` plus a separate `distDir` for builds removes the
failure mode instead of managing it.

Side effect worth knowing: a build with `NEXT_DIST_DIR` set makes Next append
`.next-gate/types/**/*.ts` to `tsconfig.json`. It is committed deliberately and
is inert for anyone who does not set the variable.

Current mappings (`tailscale serve`, stable):

| external | local | folder |
|---|---|---|
| `:8446` | 3102 | `/home/ubuntu/cBio-next` |
| `:8447` | 3107 | `/home/ubuntu/projects/cbio-next-oncoprint/cohort-lab` (separate checkout) |

After any change meant to reach a reviewer, **check the URL they will open** —
one curl for the page plus one for a chunk it references. Asserting it works is
not the same as looking.
