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
the web UI and MCP clients all read and write. The server compiles it to
ClickHouse SQL; clients never send SQL. Live at https://cohort-lab.vercel.app (UI at
`/lab`, MCP at `/api/mcp`, project rationale at `/rationale`).

## Architecture map

- **`lib/cohort2.ts`** — DSL v2 cohort compiler: `{all:[clause]}`, clause = leaf | `{any:[...]}`
  | `{not:leaf}`; leaf kinds: `oql`, `clinical`, `event` (v1 timeline sub-DSL), `patients`,
  `profiled`, `caseList`, `genomicData`, `genericAssay` (+deprecated `alteration`→OQL).
- **`lib/oql.ts`** — the honest OQL subset; `DRIVER` joins the version-pinned OncoKB store.
- **`lib/compiler.ts`** — v1 timeline/event sub-DSL (BEFORE/DURING/NOT_FOLLOWED_BY,
  observability guard, priorGuard, derived treatment lines).
- **`lib/analysis.ts`** — `runAnalysis(doc)`: evaluates cohorts (per-study; cross-study
  federation via study-qualified member ids), runs views (compare/survival/oncoprint).
- **`lib/oncoprint.ts`** — spec → rows (ClickHouse fetch); **`lib/oncoprint-assemble.ts`** — rows →
  render contract, pure (bitmask cells, NOT_PROFILED=-1, panel-aware denominators, staircase +
  declarative `sort`, clinical tracks incl. numeric heat, `heatmap` molecular tracks incl. synthetic
  `VAF`). `lib/oncoprint-local.ts` builds assembler input from Oncoprinter-style TSVs;
  `lib/oncoprint-binary.ts` is the OPB1 wire format. Renderers are dumb and share
  **`lib/oncoprint-style.ts`** (THE visual decisions: palette, glyph bands, mutation priority, legend,
  `cellLayers`) and **`lib/oncoprint-lod.ts`** (level-of-detail bucketing): `lib/oncoprint-svg.ts`
  (server SVG: web app, `/provenance`, CLI), `app/_oncoprint/` (browser canvas + the shared `OncoprintFigure`),
  `python/cohortlab` (numpy/matplotlib,
  reads the generated `style.json`; `npm run style:gen`, drift fails `npm test`).
  `scripts/oncoprint-cli.ts` and `python -m cohortlab` wrap all of this for local tables, and
  `/oncoprint-lab/import` does the same in the browser (`POST /api/oncoprint/local`).
  `lib/oncoprint-cluster.ts` orders columns by a Ward dendrogram for the `cluster:<profile>`
  sort key; `lib/oncoprint-detail.ts` answers one column at a time for tooltips. **`lib/view-svg.ts`** — the same contract for every other view kind (survival,
  hotspots, compare, cooccurrence, coexpression, clinical); used by MCP `run_analysis`
  for its figures (the oncoprint's image included).
- **`lib/views-more.ts`** — the view kinds added after the first thirteen (`attrition`, `genome`,
  …). `runAnalysis` evaluates cohorts and resolvers as for every view and hands them to
  `runMoreView`; their SQL lives in **`lib/federation-more.ts`** (re-exported by
  `lib/federation.ts`, so the boundary suite sweeps it) and runs through the resolvers'
  `moreAggregate`/`moreMeta` — present on every local participant, absent on a remote peer, which
  those views name as left out. Figures: **`lib/view-svg-more.ts`**; cards: `app/lab/more-views.tsx`.
- **`lib/event-names.ts`** — **THE only place timeline event names are normalized.** Case-fold and
  trim, nothing else; measured to be complete for event types and attribute keys (zero residual
  collisions). Folds are disclosed in the caveat, never silent. Do not fork it. Every timeline
  match in SQL — event type, attribute key, attribute value — goes through its `foldedEqualsSql` /
  `foldedInSql`, which fold column and literal with the same SQL function.
- **`lib/treatment-lines.ts`** — **THE definition of a treatment line**, shared by the `sequence`
  view, the DSL's "Treatment line (derived)" (and MCP `derive_treatment_lines`) and the `lines`
  derived metric: systemic-therapy records (class = SUBTYPE, else TREATMENT_TYPE, on
  `SYSTEMIC_LINE_CLASSES`) grouped by the gap rule. Never build lines anywhere else;
  `test/treatment-lines.test.ts` asserts every caller's line-building SQL is identical.
- **`lib/params.ts`** — template parameters. A value that is EXACTLY `"$name"` is replaced by
  `doc.params.name`; no interpolation, no expressions, no chaining, keys never substituted. The
  resolved document is an ordinary one, so everything downstream stays as strictly typed as
  before (`AnalysisDoc` = resolved, `TemplateDoc` = as authored). `runAnalysis` is the boundary.
  Also `parameterize()`, the one-click lift of study + a shared gene list.
- **`lib/explore.ts`** — faceted study exploration, single + federated (`buildExploreFederated`).
- **`app/lab/page.tsx`** — the app: Explore (study checkboxes + facets) / Cohorts /
  Analysis / Examples. The standalone query-builder (`/`) and interactive oncoprint (`/oncoprint`)
  demo pages were retired once the Analysis app subsumed them; `/` now redirects to `/lab`.
- **WebMCP (`lib/webmcp.ts`)** — every page's tools for the researcher's assistant in the
  browser (Claude in the Chrome sidebar): registered with `document.modelContext` and published
  as `window.cohortLab`. The analysis page's (`app/lab/agent-tools.ts`) read and edit the
  document; edits are run by the engine and reach the page only if accepted. **The app never
  calls a model** — there is no server-side model route; don't add one.
- **`mcp/tools.ts`** — MCP registry: `describe_dsl`, `run_analysis`, `render_oncoprint` (+v1
  event tools). MCP returns oncoprints as a static image rendered from the server SVG; the
  interactive figure is the web app's, not a third renderer.
- **`lib/dsl-reference.ts`** — **THE single source of truth for DSL documentation.**
- **Hypothesis campaigns** (`/campaign`, MCP `campaign_*`) — this tool as the referee for an AI
  hypothesis generator. **`lib/hypothesis.ts`** (pure, browser-safe): a hypothesis is a document
  plus ONE declared primary result and a direction; `withSplit` restricts it to one half;
  `extractPrimary` reads the deciding number; campaign-wide BH and the replication rule.
  **`lib/campaign.ts`**: the Postgres ledger (`db/migrations/0002_campaigns.sql`) and the procedure
  (feasibility from cohort sizes only → lock → discovery half → one correction → survivors on the
  validation half). **The app never calls a model**: hypotheses are written by the
  researcher's AI assistant in the browser (Claude in the Chrome sidebar) through the campaign
  page's tools — WebMCP plus `window.cohortLab` (`app/campaign/[id]/agent-tools.ts`) — or by
  any MCP client. Do not add a server-side model call. The held-out half is the
  engine's `split` leaf (`lib/cohort2.ts`): a salted hash of the patient id inside ClickHouse,
  salt pinned by `test/cohort.test.ts` — changing it reshuffles every reported result.
  **A locked campaign is immutable at the database level** (triggers); never work around them in
  application code.

## Docs worth reading before changing things

- [`docs/DATA-BOUNDARY.md`](docs/DATA-BOUNDARY.md) — the patient-data rule and how it is enforced.
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — measured comparison against cbioportal.org, how
  Explore scales with study count, and **the panel-aware denominator rule that outranks all of
  it**: a sample whose gene panel omits a gene is NOT PROFILED for it, never wild-type, so a
  frequency is `altered ÷ samples profiled for THAT gene`. Dividing by a study or selection total
  does not error — it silently reports every gene as rarer than it is. Both halves are additive
  over samples, which is what makes pooling safe; averaging per-study percentages is never safe.
  Guarded by `test/denominator.test.ts` and `npm run check:denominators` (in the e2e gate).
  Read before claiming this project is "fast": on a cached single chart the portal is ~20x
  quicker (those measurements predate the result cache of invariant 11, which answers only
  exact repeats), and our advantage is data movement (36x less to the
  browser), not speed. Also records the ~20,000-id ceiling on explicit patient lists.

## Invariants — do not break these

1. **Loud rejection, never silent approximation.** Anything the data can't honestly answer
   (unsupported OQL token, unknown attribute/profile/study, VAF without allele counts) throws
   a specific error listing what IS available.
2. **Provenance everywhere.** Every result carries its definition readback, compiled SQL, and a
   shareable `?doc=`/`?spec=` link. Two levels: the document panel shows each cohort's compiled
   SQL, and every view shows the aggregate queries that produced its numbers (resolvers log what
   they run; a peer returns its own log, marked as having executed there). OncoKB annotations are version-pinned (pin echoed in results).
3. **Compilers are single-study; federation happens at the analysis layer** with study-qualified
   ids. Cross-study: overlap is deliberately NOT deduplicated, vocabularies NOT harmonized —
   and views/captions must say so.
4. **Docs are generated.** Never hand-edit `docs/dsl.md`. Change `lib/dsl-reference.ts`, run
   `npm run docs:gen`, commit both. `EXAMPLES` there is also what the app's **Examples tab**
   renders, so one edit updates the doc, the MCP `describe_dsl` tool, and the gallery at once —
   and the docs gate already proves every gallery entry runs. `npm run docs:check` (part of e2e) fails on drift and
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
   `UPDATE_GOLDEN=1` to accept an intentional change).
9. **The document holds anything that changes what a reader sees; the browser holds the rest.**
   If a setting would change a shared link, the server-rendered SVG, the CLI or the Python
   package, it belongs in the view — that is why the oncoprint's viewing options are a `display`
   object and not React state. Zoom, scroll, hover, an open menu and a drag selection describe a
   viewport or a moment, not a figure, and stay out. A menu that mixes the two says which is
   which (see the display popover's "this browser only" group).
10. **The patient-data boundary** (`docs/DATA-BOUNDARY.md`) — aggregate-only and remote
   participants never emit or receive patient identifiers, and the guarantee is a *missing
   method* rather than a flag. Views degrade and say so rather than silently narrowing.
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
   - **Arguments are the key.** A cached function takes only serializable arguments and computes
     everything else itself; a function passed in cannot be called. Anything that changes the
     answer must be an argument.
   - Entries are gzipped JSON as base64 text (`pack`): Runtime Cache refuses items over 2 MB,
     and has handed typed arrays back corrupted.
   - `next/cache` exists only under Next, so the stdio MCP server, CLI and tests run the engine
     uncached; `registerTools` takes the engine to use.

## UI conventions — the layout system

Added by a design audit of the analysis page; `scripts/layout-metrics.cjs` measures whether it
still holds, against a running server.

- **One scale, in `app/globals.css`.** Seven type steps (`--t-xs` … `--t-2xl`), seven spacing
  steps (`--s0` … `--s6`), four radii, one control height (`--ctl-h`). Nothing declares a font
  size or a border radius outside it — the app once had 36 distinct font sizes, five of them
  meaning "small text".
- **One header per view: `ViewHead`.** Title, then this view's actions, then its status chips,
  then remove, on one baseline. Every view kind renders through it; a view that builds its own
  header is a bug, because the timing chip and the close control then move between cards.
- **Toolbars are labelled zones, not a row of controls** (`.viewtb` / `.tbz` / `.tbl`). A zone
  holds one kind of control and **never wraps inside itself**, so a pair like the zoom triple
  cannot be split by a line break; zones wrap as units and the divider is where the break
  happens. Where a view has both kinds, `data` (re-runs a query) sits left of `view` (instant).
- **One idiom per job.** `.tbbtn` for a button or a disclosure, `.tbfield` for a labelled select,
  `.chk` for a checkbox. Underlined link-buttons are not a fourth kind of control.
- **Apparatus goes in `.vfoot`.** Legend, methodology caveats and provenance stay on the page and
  a step down in weight, so they read as apparatus rather than as findings.
- **Server-rendered figures share the palette.** `lib/svg-kit.ts` owns `palette()`, `SERIES` and
  the frame/caption helpers, for `lib/view-svg.ts` and `lib/view-svg-more.ts` alike; a renderer
  that invents a colour is drifting from every other view.
- **Geometry stays inline, styling does not.** A tooltip's position and a legend swatch's colour
  are data computed from the drawing; borders, padding and type are classes.

## UI conventions — waiting, and never hiding what isn't shown

Every screen answers "is this current?" and "is this everything?" without the reader having to
ask. These hold for every view kind, and for the chat/MCP figures that share its renderers.

- **A settings change that waits on the server shows the view waiting.** The header and its
  controls stay visible and usable, so the reader sees what they just changed and can change it
  again; the figure area below is covered by a skeleton with an "updating…" spinner until the
  new answer lands (`Updating` in `app/lab/page.tsx`, `.view-updating`). A stale figure left on
  screen reads as the new answer. The same cover goes over every view during a full document
  run, and over the oncoprint's plot during its own contract fetch. A change applied in the
  browser alone (the oncoprint's display options, zoom) is instant and gets none.
- **A control whose options come from a fetch shows a loader while it is in flight** — `Waiting`
  ("loading attributes…") in place of the select, a spinner on a menu's summary. Loading, empty
  and failed are three different states and each must say which it is: an empty select during a
  fetch reads as "this study has none". A button gated on fetched data (the add-view buttons'
  `why`) waits with a spinner via its `loading` predicate rather than guessing either way.
- **A loader must be tied to a request that will end it.** Before showing "loading…", make sure
  something is actually fetching (that is why the clinical-attribute catalog loads for any
  result, not only once a plot exists) and that failure clears it (`.finally`), or the spinner
  never stops. A failed lookup reads as unknown, never as "none" (`survivalEndpoints: null`).
- **A disabled control says why** in its title — what it is waiting for, or what the data lacks
  ("genie_public has no survival data…"), never an instruction to go somewhere else to make it
  work. The exception is an action that belongs to a *saved* analysis — editing a cohort, adding
  or editing a view's note: it is **hidden**, not disabled, until the analysis is saved
  (`analysisSaved`, `CohortEditMenu`'s `canEdit`), by the user's choice.
- **First render is a skeleton shaped like what it stands in for** (`.skeleton-view`,
  `.skeleton-cohort`), so the page doesn't collapse to a spinner and jump back to full height.
- **Nothing is dropped without saying so — in the engine, the renderers, or the UI.** A figure
  that cannot fit everything widens and scrolls (`frame(…, grown)` keeps a `min-width`), pools the
  remainder into a disclosed "other", or refuses; it never draws the first N. Captions are never
  cut — they are where the caveats live. A view states what its inputs left out (a plot's
  coverage: "145,220 of 289,869 samples have a value on both axes…"). The oncoprint legend's
  "+N more" and the sequence view's pooled "other" are the pattern to copy.
- **A request past a limit is refused with the limit named** ("a compare view takes at most 20
  genes; this asks for 25"), never cut to its first N, in the engine (`overLimit` in
  `lib/analysis.ts`) and in the UI (ticked cohorts, event pills).
- **An errored view keeps its header** (`drawsOwnHead`), so it can still be removed or moved
  without editing the JSON.
- **Keystrokes stay in the field.** A text field on the analysis page must not keep what is being
  typed in page state: `AnalysisPage` is one very large component, so every keystroke re-renders
  every view card, the oncoprint and the inlined figures (a dialog's textarea measured ~350 ms a
  key). Use `DraftText` — local state, the page reads a ref on save — or a small component that
  owns its own draft. An edit that re-runs nothing must still `syncUrl`, or it is lost on refresh.
- **Verify waiting states by holding the request.** A loader that flashes past in a normal run
  proves nothing; in Playwright, `page.route()` the endpoint and hold it, check the loader is on
  screen and the controls are still usable, then release it and check the loader is gone.

## Workflows

- Build: `npm run build`. Dev serve: `npx next start -p <port>`.
- Test: `npm test` — unit suites, no database needed (the patient-data boundary, the stats used by
  federated views, cohort-definition semantics, clinical-course semantics, and the SVG figure
  renderers, plots, gene tracks, template parameters and the panel-aware denominator;
  252 checks across 40 suites).
  `node e2e.cjs` — 81 checks (Playwright + docs gate + the boundary suite + the
  denominator gate).
  Secrets come from `.env.local` at runtime; never hardcode them anywhere, including tests.
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
  under the `cBioPortal` org — advancing it is a publishing act, not a bookkeeping step, and
  there is no CI, so the only gate is a person deciding the work is ready. When they do say so,
  merge the feature branch (`--no-ff`) rather than fast-forwarding, so the branch is legible in
  the history, and delete it afterwards.
- **What e2e actually proves.** `node e2e.cjs` drives a local `npx next start -p 3100` against
  the **built working tree** — `.next` from the last `npm run build` — not against a commit and
  not against production. So: rebuild before running it, and if the tree is dirty you are
  testing uncommitted code. It needs live ClickHouse credentials from `.env.local`, which is
  also why it cannot run in CI as written.
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
