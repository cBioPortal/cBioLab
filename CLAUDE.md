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

- **`lib/cohort2.ts`** — DSL v2 cohort compiler: `{all:[clause]}`, clause = leaf | `{any:[...]}`
  | `{not:leaf}`; leaf kinds: `oql`, `clinical`, `event` (v1 timeline sub-DSL), `patients`,
  `profiled`, `caseList`, `genomicData`, `genericAssay` (+deprecated `alteration`→OQL).
- **`lib/oql.ts`** — the honest OQL subset; `DRIVER` joins the version-pinned OncoKB store.
- **`lib/compiler.ts`** — v1 timeline/event sub-DSL (BEFORE/DURING/NOT_FOLLOWED_BY,
  observability guard, priorGuard, derived treatment lines).
- **`lib/analysis.ts`** — `runAnalysis(doc)`: evaluates cohorts (per-study; cross-study
  federation via study-qualified member ids), then hands each view to its kind's runner.
  **`lib/views/<kind>.ts`** holds one runner per view kind (compare, survival, cox, …), registered
  in `lib/views/index.ts`; each gets the run's context (`ViewRun` in `lib/views/run.ts`: the
  document, evaluated cohorts, resolvers, the view's cohorts and studies) and returns its result;
  `lib/views/shared.ts` holds what several runners use (`overLimit`, `answering`, `refuse`). A new
  view kind is a new runner there, registered in `index.ts` (`RUNNERS` is keyed by `ViewKind`, the
  `View` union's kinds, so a kind without a runner does not compile). A result is a `ViewResult`, a
  union over kinds: the common fields (`ViewResultCommon`) plus its kind's own (`ViewResultFields` in
  `lib/types.ts`, where a new kind declares its fields), so checking `kind` narrows it and reading
  another kind's field does not compile. A drawn result (no `error`, not `empty`) carries its kind's
  main field (`ViewResultMain`; a runner's success path must fill it), and `isDrawn(v)` is the check
  after which that field is read without `!`; a figure takes `DrawnResultOf<"<kind>">`. A refusal or
  error for a kind known only at run time is `plainResult(kind, {…})`. **Kinds never import each other:** a
  kind's runner, figure and `<kind>-<part>.ts` modules import only one another and the shared
  modules (`lib/views/`: run, shared, rows, covariates; `lib/figures/`: common, volcano, bars,
  forest, km) — `local/kind-boundary` in `eslint.config.mjs` enforces it; what two kinds need moves
  into a shared module, listed there. Kinds registered through `drawn()`
  have their figure drawn from the result and a throw reported as the view's error.
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
  sort key; `lib/oncoprint-detail.ts` answers one column at a time for tooltips. **`lib/view-svg.ts`** — the same contract for every other view kind: the dispatcher over
  `lib/figures/<kind>.ts`; used by the page (drawn in the browser) and by MCP `run_analysis`
  for its figures (the oncoprint's image included).
- **View aggregates** — most view kinds after the first few (`genome`, `pathways`, `enrichment`, …)
  query through the resolvers' `viewAggregate`/`viewAggregateMany`/`viewMeta`, whose SQL lives in
  **`lib/federation-views.ts`** (re-exported by `lib/federation.ts`, so the boundary suite sweeps
  it). Every local participant has those methods, a remote peer does not, so such a view is not
  drawn over a peer's studies (`lib/view-coverage.ts`, below invariant 10).
  Figures: **`lib/figures/<kind>.ts`**, one module per kind (the later kinds registered with their
  title in `lib/figures/index.ts`), dispatched by **`lib/view-svg.ts`**; all browser-safe, laid out
  with **`lib/chart/`** (see "Figures" under UI conventions); cards: `app/lab/kind-cards.tsx`.
- **Table views** (`table`, `mutations`, `timeline`'s patient list, `alterations`' list and three tables, and any later view that lists rows) — **every one must
  support the same five things: pagination, search over its text, a filter per column (text
  conditions or a value list for text, a range for numbers), sorting, and a CSV download of every
  row kept — plus choosing the columns shown.** Don't build these per view: a table supplies only a
  `RowSource` (its `rows` CTE and how each column reads off it, beside the table, e.g.
  `lib/mutation-table.ts`) and **`lib/table-query.ts`** does the rest in the database (validation,
  search, filters, sort, page, counts, a column's values for its filter). The query
  (`columns`/`search`/`filters`/`sort`, type `TableQuery`) is part of the view's spec — the page is
  not. The rows name patients, so they run only through `PatientLevelResolver.rowsPage`/
  `rowsCounts`/`rowsValues`/`rowsRank` (asserted in `test/boundary.test.ts`); `lib/views/rows.ts`'s
  `runRows` groups parts per database and pages across them. UI: **`app/_table/DataTable.tsx`**;
  `POST /api/view-page` (a page, or a column's values) and `POST /api/table` (the CSV) serve every
  table view. A view holding several tables (`alterations`) names one with `table` in those
  requests (`RunOpts.table`), and `pagedTable()` in `lib/views/rows.ts` picks it from the result.
- **The `alterations` view** (cBioPortal's patient-view genomic tables, runner `lib/views/alterations.ts`) — one
  patient's Mutations, Copy Number Alterations and Structural Variants as three table views in one card, each
  with its own query under its own spec key (`mutations`, `cna`, `sv`); the top-level query is the patient list's.
  Row sources in **`lib/patient-alterations.ts`** (one row per variant / call / event however many of the
  patient's samples carry it). Local patient-level participants, and a peer whose rules allow `alterations`
  (opt-in patient-level federation, below): the peer pages each table in its own database.
  Its navigator is the timeline's: **`app/lab/patient-nav.tsx`** (‹ prev / next ›, the List/Search dialog,
  ← / →) serves every view that shows one patient of a cohort at a time, stepping by the result's `position`
  (`listPosition()` in `lib/views/rows.ts`).
- **The `timeline` view** (cBioPortal's patient-view Timeline, runner `lib/views/timeline.ts`) — one
  patient's clinical events as tracks, with its cohort's patients (a table view) to pick from. **`lib/timeline-tracks.ts`** is
  the track model, ported from cbioportal-frontend's `cbioportal-clinical-timeline` package and
  `patientView/timeline/timeline_helpers.tsx`: the portal's track order and `trackStructures`
  nesting, lone-"Other" absorption, line charts for all-numeric lab results, numbered sample
  markers, the year axis with empty runs cut. **`lib/timeline-svg.ts`** draws it, browser-safe:
  the lab card (`app/lab/timeline-body.tsx`) and the MCP figure are the same drawing. The queries
  (`lib/patient-timeline.ts`) name a patient, so they run only through
  `PatientLevelResolver.patientTimeline`/`rowsPage`/`rowsRank`. The view reads one cohort; its
  navigator (cohort, the patient list — a `<dialog>` holding the `DataTable` — and ‹ prev / next ›) steps by the result's `position` — the drawn patient's place
  in the list's order (`rankSql`) and its neighbours — setting `patient`. The chosen `patient`, folded `collapsed`
  tracks and `expandGaps` are in the spec; the last two are drawn in the browser (`dataPart`).
  **Opt-in patient-level federation** serves this view and `alterations`, per study and kind of data:
  rules (`lib/disclosure.ts`; `study:timeline+alterations`, `*` for every study) in the peer's
  `MCP_DISCLOSE_PATIENTS` register and gate `federated_patient_rows`/`federated_patient_timeline`, and
  the same rules in the coordinator's `PEER_MCP_PATIENT_LEVEL` decide what it accepts — data crosses
  only where both allow it. The coordinator reaches the peer through `RemotePatientResolver` /
  `RemoteTimelineResolver` (`patientRows()` names a table in `PEER_TABLES`, never SQL; aggregate-only
  for every other view); `runRows`' `remote` option pages a peer's rows beside local databases. A new
  patient view joins by adding a kind, its tables to `PEER_TABLES` and the peer tool, and
  `rowHolders(ctx, kind)`. `LOOPBACK_PEER=b` (`lib/loopback-peer.ts`) serves the second database
  to the app itself as a simulated peer — one app, both databases, federation over real MCP calls;
  the gate runs `scripts/e2e-federation.cjs` that way. See `docs/DATA-BOUNDARY.md`.
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
- **Splits** (`cohorts[name].splits`, and `arms[i].splits` to nest) — a cohort divided into child
  cohorts that are disjoint and add up to it, for comparison. Stored as a tree on the cohort; the
  engine and page work on a flat form keyed `"<cohort> / <split>"` (`flattenSplits` /
  `unflattenSplits` / `editSplits` in **`lib/partition-arms.ts`**, browser-safe, which also builds
  and edits arms and holds the value-ranking rule shared with `splitBy`). **`lib/cohort-partitions.ts`**
  expands each split into ordinary child cohorts (`"<cohort> / <split> / <arm>"`, each `extends` its
  parent) before `extends` resolves: arms are a first-match-wins decision chain, and an arm's condition
  must be decidable first (OQL → profiled for that gene and type, panel-aware; clinical → a value is
  recorded), else the patient goes to a named "Not profiled" / "No … recorded" child, never to
  wild-type or Other. `runAnalysis` counts every child and reports `result.splits[...].conserved`; a
  view's `cohorts` chooses what it draws (`expandSplits`): a cohort's name is the whole cohort, a
  split's name its arms, an arm's name that arm. `proposePartition`
  (`POST /api/partition`) writes arms from the data as explicit clauses, so the document alone decides
  the children. UI: `app/lab/partitions.tsx`, the cohort card's menu, Explore charts' menus.
- **Document versions** — **`lib/doc-version.ts`** is THE place an older document is brought up to
  date. Documents carry `"dsl": DOC_VERSION`; one with an older version (or none) is upgraded where it
  enters — the page on `run()`, the engine in `runAnalysis` — and `result.upgraded` / the page's note
  say what changed; one for a NEWER version is refused, because an older engine would silently ignore
  what it does not know. A change to the document's shape, or to what an unchanged document means,
  bumps DOC_VERSION and adds an upgrade step there; never re-interpret an old shape anywhere else.
- **`lib/explore.ts`** — faceted study exploration, single + federated (`buildExploreFederated`).
- **The `composition` view** (runner `lib/views/composition.ts`, SQL `lib/composition.ts`, figure
  `lib/figures/composition.ts`) — parts of a whole per case (cell types, cell states, signatures):
  a generic-assay profile's entities or 2–16 numeric clinical attributes (`custom:` included). Each
  case's vector is built in the database (`casesCte`); every participant returns only sums
  (`compositionMomentsSql`), and the per-case stacked bars come from `PatientLevelResolver.viewRows`
  alone, without ids. Each cohort is tested against the others pooled, part by part (Welch from
  moments, BH). Gallery example on the bundled SPECTRUM single-cell data (`lib/spectrum-sc-demo.ts`,
  regenerated by `scripts/gen-spectrum-sc-demo.py` from the public CELLxGENE files).
- **Cell Explorer links** (`lib/cell-explorer.ts` browser-safe, `lib/cell-explorer-server.ts`,
  `POST /api/cell-explorer`) — a cohort's patients opened as a donor filter on a study's
  cell-explorer.cbioportal.org dataset (the cohort menu), and a Cell Explorer link or donor ids
  back into a `patientList` cohort ("+ Add cohort" → From Cell Explorer). The study→dataset
  registry is `CELL_EXPLORER_DATASETS`. Both directions name patients, so both answer only from a
  patient-level instance. A link names only the donors Cell Explorer's catalog lists for the dataset.
- **Single-cell summaries for any Cell Explorer dataset** — `scripts/gen-singlecell-summary.py`:
  `propose <slug> <study>` drafts a config (patient and sample columns, the crosswalk to the study's
  ids — direct or through a sample attribute — and candidate label and score columns, dropping columns
  that never vary within a sample); `build <config>` writes per-patient and per-sample custom datasets
  (label shares, mean scores). Reviewed configs live in `scripts/singlecell/`. Paper-specific design
  (a sorting correction, site pooling, cut-offs) stays a dataset's own script, as SPECTRUM's does.
- **Where the examples run** — the gallery examples are written for the public warehouse's studies
  (and their counts are pinned to it), so an instance on another database sets `EXAMPLES_URL`
  (`lib/site.ts`, a public environment variable — below) to a deployment that holds them. The Examples tab then says so, and Run opens a "you are leaving this
  site" dialog and the example on that deployment, in a new tab; the assistant's
  `analysis_load_example` returns that link instead of loading it. Unset, examples run in place.
- **Public environment variables** (`lib/public-env.ts`) — the ONE way a setting reaches the
  browser at run time: `PUBLIC_ENV` names them (default `EXAMPLES_URL`), `app/_env/public-env.tsx`
  writes them into the page per request (`connection()`, inside the lab layout's Suspense), and a
  client reads them with `usePublicEnv()`. Not `NEXT_PUBLIC_*`, which a build bakes in for good;
  not a fetch. A secret-shaped name is refused (`test/public-env.test.ts`).
- **Requests from the pages** go through **`app/lab/api.ts`** (`api.analysis`, `api.explore`,
  `api.oncoprint`, …), never a bare `fetch`: each takes its endpoint's envelope type from
  **`lib/api-schemas.ts`** and attaches the uploads its body uses (`withCustomData`). The routes
  parse the same envelope (`parseBody`), so a change to either side is a type error in the other.
  An envelope checks only the route's own parameters (which view, which page, which uploads) and
  passes the document, definition or spec it carries to the engine — don't grow it into a second
  schema of the DSL. A new endpoint the pages call gets an envelope and an `api` function. The one
  exception is the sign-in and custom-data endpoints (`/api/auth*`, `/api/custom-data/*`): they
  belong to `app/lab/custom-data-client.ts`, which owns that state and which `api.ts` itself
  imports, so it calls them directly — through it, never from a component.
- **Custom data** — a researcher's uploaded annotations, named `custom:<dataset>/<COLUMN>` and
  usable anywhere a clinical attribute is, stored on the server only (below; the browser keeps
  nothing — `app/lab/custom-data-client.ts` attaches references). **`lib/custom-data.ts`**: for
  each request `clinicalTable(db, attrs)` / `clinicalMetaTable(db)` merge the named datasets into the clinical
  tables as ClickHouse external tables. **Every read of `clinical_data_derived` or
  `clinical_attribute_meta` goes through those two functions** — a new reader that names the
  table directly silently ignores uploads. `attrs` is what the statement reads ("all" only when it
  truly reads every attribute), so a statement about built-in attributes gets the plain table and
  ships nothing. `lib/custom-data-server.ts` is the request boundary (patient-level studies only,
  id matching, "save as feature" membership). Results that use uploads bypass the shared cache;
  a document naming an upload the request lacks is refused (`assertCustomDataPresent`).
  **Server-stored custom data** (`lib/custom-store.ts`, the only module touching its tables):
  enabled only where the deployment signs people in, each dataset its saver's. A document pins
  what it uses as `uploads: [{as, dataset, version}]` (added by the page on run); requests send
  `customRefs` and the server loads the pinned, immutable version.
- **Stored id sets** — a cohort given as a long list of ids (`sampleList`/`patientList` with
  `"set": "<id>"` instead of `"ids"`). **`lib/id-set-store.ts`** is the only module touching its
  tables (`db/migrations/0006_id_sets.sql`): owned and shared by `lib/access.ts`, members
  immutable (trigger), soft delete, every read logged. `lib/id-set-import.ts` matches a pasted list
  to the studies' cases before saving (`POST /api/id-sets`; UI: "+ Add cohort" → "From a list of
  ids"). Every engine route passes its body as `uses` to `withRequestCustomData`, which reads the
  sets it names (`lib/id-sets-server.ts`) into **`lib/id-sets.ts`**'s request context; the compiler
  then names one ClickHouse external table per set and study, and `lib/ch.ts` uploads it only to
  the patient-level connection holding that study. A set is not read without a signed-in request
  (MCP, scripts), and an answer that reads one bypasses the result cache (`hasIdSets()`). Inline
  lists are refused by name past `INLINE_ID_SQL_LIMIT` (`lib/cohort2.ts`). In the web app every
  list becomes a set where the reader is signed in (`app/lab/id-sets-client.ts`): oncoprint
  selections and Cell Explorer imports as they enter the document, and any list still inline when a
  cohort or analysis is saved (the page's `persist`/`persistSpaces` wrappers, which give the open
  document the same sets so a re-save stores nothing new). Inline lists stay valid DSL for MCP,
  scripts and signed-out readers.
- **Signing in** (`lib/auth.ts`, the header's Sign in) guards custom data, saved
  cohorts/analyses (`/api/artifacts`) and campaign changes; exploring, analyses, `?doc=` links and
  MCP need none. A deployment has ONE way in: an OpenID Connect provider (`lib/oidc.ts`;
  `AUTH_OIDC_ISSUER`/`_CLIENT_ID`/`_CLIENT_SECRET`, optional `AUTH_OIDC_LABEL`, `AUTH_URL` behind a
  proxy — Google on Vercel, MSK's Keycloak realm `msk` on the private cluster), and/or the
  development sign-in (`AUTH_DEV_LOGIN=1`: any email, no password; refused on Vercel production;
  what `scripts/gate.sh` and session dev servers use). A session is an httpOnly cookie signed with
  `AUTH_SESSION_SECRET` naming the user; stores decide by that user's id. **People** are
  `lib/users.ts` (`db/migrations/0004_users.sql`): a sign-in is found by provider + subject, and
  joins an existing user (e.g. one added by email) only through a provider-VERIFIED email. Rows
  from before accounts have no owner and are seen by nobody until `npm run db:claim-legacy --
  <email>` gives them to someone. The OIDC flow is tested end to end against a stand-in provider
  (`test/oidc.test.ts`).
- **Sharing** (`lib/access.ts` — THE place the rules live; `db/migrations/0005_sharing.sql`): a saved
  cohort, analysis or custom dataset has an owner and a sharing — `visibility` private | group |
  public (everyone signed in to the deployment), ONE `group_id`, and `group_can_edit`. The owner
  alone deletes or reshares, and only with a group they belong to; a stale edit is refused (409,
  `saved_artifacts.version`). Lists filter in SQL (`readableWhere`), single items in code
  (`canRead`/`canWrite`/`canShare`); both stores call it, never a rule of their own. Sharing an
  analysis wider than a custom dataset it pins returns `warnings` naming the dataset — patient-level
  data is never shared but by its own owner, explicitly. **Groups** (`lib/groups.ts`) are run by
  their admins (always at least one); people are added by email, signed in yet or not; deleting a
  group makes what it shared private. The access matrix is in `test/support/store-contracts.ts`
  (`sharingContract`), and `npm run check:access-mutants` (a gate stage) plants six sharing bugs
  into a copy of `lib/access.ts` and requires each to fail it. A change to the rules updates both.
  On the page, the reader's OWN items stay keyed by name (`use-saved.ts`); others' come separately,
  keyed by id, since two people may use one name. UI: `app/lab/share-dialog.tsx` (owner only; from
  the Saved tab's badges and the custom-data manager), the Saved tab's "Shared with you" sections,
  `/groups` (`app/groups/page.tsx`, linked from the signed-in header). Opening someone else's analysis
  gives a working copy that remembers its source (`use-workspace.ts` `sharedOpen`); where the group
  may edit, the workspace dialog's "Save to theirs" saves back from the version opened.
- **The writable store** (`lib/db.ts`, the only Postgres client): saved cohorts and analyses,
  campaigns and custom data. `DATABASE_URL` (or its older name `SUPABASE_DB_URL`) names the
  Postgres; without one, outside Vercel production, `lib/db.ts` runs an in-process Postgres
  (PGlite) itself — in `.data/pglite` under `next dev`, in memory otherwise (so every gate run
  starts empty) — so there is one SQL path and no second, hand-written store to keep in step.
  **Migrations** are `db/migrations/*.sql`, applied in name order by **`lib/migrate.ts`**, which
  records each in `schema_migrations`; every migration must stay re-runnable (`if not exists`,
  `drop trigger if exists`). A configured database is migrated only by `npm run db:migrate`
  (`npm run db:status` lists applied and pending), never by the app — run it before deploying
  code that needs a new migration. The in-process database migrates itself on first use.
- **`app/lab/page.tsx`** — the app: Explore (study checkboxes + facets) / Saved /
  Analysis / Examples. Tabs move out into their own components as they are untangled
  (`saved-tab.tsx`, `examples-tab.tsx`), and each view kind's card is its own component in
  `view-cards.tsx`, reading the page through one `ViewCtx`; Explore's sections (study picker, bar,
  add-chart dialog, facet cards) are `explore-sections.tsx`, reading Explore's state and actions
  from `use-explore-state.ts` (the draft, the selection, add-cohort mode) through `ExploreCtx`; the
  Analysis tab's cohort column, view column, document and genes dialogs are `analysis-sections.tsx`,
  through one `AnalysisCtx`. The page itself holds only its own state and wires the rest: its
  actions are hooks, called in dependency order — `use-tool-actions.ts` (what the AI tools do to
  the document), `use-library.ts` (the Saved and Examples tabs), `use-workspace.ts`,
  `use-cohort-edits.ts`, `use-explore-state.ts`, `use-view-options.ts` (what building a view
  offers), `use-view-edits.ts`; the AI tools' bridge is `useLabTools` in `agent-tools.ts`. A new
  action goes in the hook for its kind, not in the page. State that must outlive a tab switch
  lives in those hooks, not in the tabs, since a tab unmounts when left. Server state goes through React Query, as analyses do
  (`use-analysis.ts`): saved cohorts and analyses are `use-saved.ts`, Explore's facets
  `use-explore.ts` (keyed by everything that decides the answer, so a superseded request is
  cancelled and can never land; `e2e-lab-races.cjs` holds requests to prove it). The standalone query-builder (`/`) and interactive oncoprint (`/oncoprint`)
  demo pages were retired once the Analysis app subsumed them.
- **The homepage (`/`, `app/_home/`)** — cBioPortal's: choose studies, then **Explore selected
  studies** (the lab's Explore, `/lab?tab=explore&study=a,b`) or **Query by gene** (the gene query
  dialog, whose Submit opens the Results page). One study chooser serves it, Explore's picker and
  the Results page's "Modify query" (`app/_studies/study-chooser.tsx`: cancer types, search, the
  data Filters, quick select, select all, rows with their quick-jump icons in `study-actions.tsx`),
  and one gene editor serves every gene entry (`app/_genes/GeneQueryDialog.tsx`: `GeneQueryEditor`,
  in the dialog or in place).
- **WebMCP (`lib/webmcp.ts`)** — every page's tools for the researcher's assistant in the
  browser (Claude in the Chrome sidebar): registered with `document.modelContext` and published
  as `window.cohortLab`. The analysis page's (`app/lab/agent-tools.ts`) read and edit the
  document; edits are run by the engine and reach the page only if accepted.
- **The chat sidebar is the app's only model call, and it is just another WebMCP client**
  (`app/_agent/ChatSidebar.tsx` in the root layout; `/api/chat`; the provider in
  `lib/chat-model.ts`: `CHAT_PROVIDER=anthropic|bedrock`, `CHAT_MODEL`, `CHAT_EFFORT`). **Where it
  runs:** a dev server (`next dev`) with `CHAT_PROVIDER` set; a built deployment only with
  `CHAT_ON_DEPLOYMENT=1`, never on Vercel (no public URL spends the key), and there only for a
  signed-in user — a deployment that signs nobody in has none. The internal instance
  (cbiolab.cbioportal.aws.mskcc.org) uses Bedrock with the credentials file the cluster's SAML job
  refreshes every 3 h; Bedrock reads AWS credentials through the standard chain, re-read on every
  request, so a refreshed file needs no restart. It must work the app exactly as an outside
  assistant (Claude in Chrome, Claude Desktop) does: each request sends the tools the page exposes
  (`window.cohortLab.tools`), the route declares them **without implementations**, and every call
  runs in the browser through `window.cohortLab.call`. **Never give it a private way in** — no
  tools in the route, no reading page state or calling the engine or an API directly. A capability
  it lacks is a new WebMCP tool, which every assistant then gets. Opening a page reloads it, so the conversation lives in
  `sessionStorage` and resumes on the new page's tools. No other route calls a model.
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
  validation half). **The campaign engine never calls a model**: hypotheses are written by the
  researcher's AI assistant through the campaign page's tools — WebMCP plus `window.cohortLab`
  (`app/campaign/agent-tools.ts`), whether that assistant is Claude in Chrome or the app's own
  chat sidebar, which drives the same tools — or by any MCP client. Do not add a model call to
  the campaign code. The held-out half is the
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
   patient ids) and `check:mutants` (plants each bug in `scripts/check-mutants.ts` into a temp copy
   and requires a check to fail). The first two are gate stages. A new statistic gets a row in
   `lib/verification.ts` (`test/verification.test.ts` fails otherwise); new cohort or count logic
   should get a planted bug that proves some check would notice it breaking. A planted bug that
   cannot change any result on this warehouse (e.g. `cna >= 1`, when only ±2 is stored) proves
   nothing — replace it rather than counting it.

## UI conventions — the layout system

Added by a design audit of the analysis page; `scripts/layout-metrics.cjs` measures whether it
still holds, against a running server.

- **A figure is the data alone; anything the reader clicks is HTML beside it.** A selector, a
  legend that filters, a summary with links (the lollipop's gene summary and Driver/VUS × class
  grid, `app/_lollipop/HotspotsBody.tsx`) is a control, not part of the SVG: the figure the server
  draws for MCP and exports carries what those controls show *in words* in its caption — including
  what a selection hides — so an image that travels alone is still complete. A selection that only
  changes what is drawn is kept in the view's spec (so a link reproduces it) but applied in the
  browser from the whole result, so a click re-runs nothing (`dataPart` leaves it out of the
  re-run key). Code the browser draws with must not import server modules — `node:async_hooks`
  in a client bundle fails the whole page — which is why what the plot figure needs from
  `lib/plot.ts` lives in `lib/plot-draw.ts`.
- **One scale, in `app/globals.css`.** Seven type steps (`--t-xs` … `--t-2xl`), seven spacing
  steps (`--s0` … `--s6`), four radii, one control height (`--ctl-h`). Nothing declares a font
  size or a border radius outside it — the app once had 36 distinct font sizes, five of them
  meaning "small text".
- **New UI is Tailwind and shadcn; the app is moving onto them area by area.** The `@theme` in
  `app/globals.css` IS the scale above under Tailwind's names: `text-xs` … `text-2xl` are the
  seven type steps (Tailwind's own sizes are cleared, so an off-scale size does not exist);
  spacing is Tailwind's 4px grid, on which the steps are `1`, `1.5`, `2.5`, `4`, `6`, `9` (prefer
  those; `h-ctl` is the control height); colours use shadcn's semantic names mapped onto the
  palette — `primary` is the teal, `accent` the soft tint, `muted-foreground` the grey text,
  `destructive`, `border`, `ring`. shadcn components live in `app/_ui/` (`npx shadcn add …`,
  configured by `components.json`; the CLI writes `cn` imports as `from "cn"` and tries to
  install an unrelated `cn` package — point them at `@/lib/cn` and revert `package.json`) and are
  this repo's code to edit; join classes with `cn()` from `lib/cn.ts`, never by string
  concatenation (it knows the app's theme names, so a later class overrides an earlier one of
  the same kind). Beside them in `app/_ui/` are the app's own primitives — use these rather than
  rebuilding them: `Choice` (a dropdown from `[value, label]` pairs, where `""` may be a real
  option such as "auto") and `OptionSelect` (the same from `<option>` children) in `choice.tsx`;
  `GearMenu` / `MenuItem` / `closeGearMenu` in `gear-menu.tsx` (a button that opens a popover,
  whose open state can live in the page's `menuOpenRef` store so it survives its card
  remounting); `RemoveBadge` in `remove-badge.tsx` (a listed value a click removes, such as a
  gene); and in `toolbar.ts` the toolbar class strings `TB`, `CHIP`, `FIELD` and the tab classes
  `LINE_TABS` / `LINE_TAB` (page tabs over a rule) and `SEG_TABS` / `SEG_TAB` (a body's own selector). A
  link-looking action is `<Button variant="link" size="inline">`; a toggle chip is an outline
  `Button` with `aria-pressed`. The old stylesheet sits in the `legacy` layer, below Tailwind's
  utilities, so a utility always wins over a legacy rule; its first block restores the browser
  defaults it was written against for legacy markup, wherever it sits (a shadcn dialog
  included), but not for shadcn's own parts (`[data-slot]`) or inside `[data-tw]` — **mark the
  root of each area you convert with `data-tw`**, and delete that area's legacy rules in the
  same commit. Converting must not change what the page shows except where meant: run
  `npm run visual` (baseline first with `-- --update`, from the commit before) and account for
  every diff it reports.
- **e2e finds shadcn parts by role, not by legacy class.** A dialog is `[role=dialog].<its class>`
  (Radix unmounts a closed one, so wait for it rather than for `[open]`); a menu's items are in
  `[data-slot=popover-content]`; a select is `[role=combobox]` and its choices `[role=option]`
  (it is not a native `<select>`, so no `selectOption`); a checkbox is `[role=checkbox]`; a tab is
  `getByRole("tab")`; a removable value is `[data-slot=badge]`; a slider's handle is
  `[data-slot=slider-thumb]`. A dialog's content is portalled to `<body>`, so it is not inside the
  card that opened it. Keep a
  stable class on a component the tests target (`genesbtn`, `cohortgear`, `viewgear`), and keep
  native elements where something outside React reads them while closed — the document dialog
  is a native `<dialog>` so `#docjson` stays in the page.
- **One header per view: `ViewHead`.** Title, then this view's actions, then its status chips,
  then remove, on one baseline. Every view kind renders through it; a view that builds its own
  header is a bug, because the timing chip and the close control then move between cards.
- **Toolbars are labelled zones, not a row of controls** (`.viewtb` / `.tbz` / `.tbl`). A zone
  holds one kind of control and **never wraps inside itself**, so a pair like the zoom triple
  cannot be split by a line break; zones wrap as units and the divider is where the break
  happens. Where a view has both kinds, `data` (re-runs a query) sits left of `view` (instant).
- **One idiom per job.** In a toolbar: an outline `Button` with `TB` for a button, a `GearMenu`
  for a disclosure, a `.tbfield` label around a `Choice`/`OptionSelect` for a labelled select,
  a `.chk` label around a `Checkbox` for a checkbox — all at `h-ctl`.
- **Controls side by side are a toolbar, wherever they sit** — a card's body, a line above a
  figure, a dialog: `.viewtb` > `.tbz`, never a hand-rolled `display: flex` row. The one-height
  rule (`--ctl-h`, one font size) is the controls' own (`TB`, `FIELD`, `Choice size="ctl"`); a
  control built without it sits on another centre line at another height beside the rest. (The
  timeline's controls once shipped that way; e2e's `misalignedControls` checks it.)
- **Look at a UI change, then measure it — "renders without errors" is not done.** Screenshot the
  changed region itself at `deviceScaleFactor: 2` (a whole card at 1× hides a few pixels of
  misalignment) and compare it with the same kind of control in a neighbouring view: centre
  lines, heights, type size, spacing. Then assert the geometry in `e2e.cjs`:
  `misalignedControls(page, scope)` fails any toolbar zone under `scope` whose controls are not
  one `--ctl-h` tall on one centre line. A view that adds a control row calls it.
- **Apparatus goes in `.vfoot`.** Legend, methodology caveats and provenance stay on the page and
  a step down in weight, so they read as apparatus rather than as findings.
- **Figures are drawn in the browser at the card's width, by the renderer MCP uses.** The page
  never inlines an SVG the server drew: `ViewFigure` / `DrawAtWidth` (`app/lab/figure.tsx`)
  measure the card and call `viewToSvg(v, { width })`, and the figure is shown 1:1 — never
  scaled down (unreadable text) or up. Narrower than `MIN_FIGURE_W` it keeps that width and
  scrolls, with a fading edge and a "scroll →" cue. The analysis API therefore sends the page no
  `svg` (`?oncoprint=spec`); MCP and `?figures=svg` draw on demand. A renderer must lay itself
  out for whatever `o.width` it is given — wider means more room, not bigger type.
- **Figures share one layout kit, `lib/chart/`** (re-exported by `lib/svg-kit.ts`), and never
  guess: text is measured from IBM Plex Sans's advance widths (`textWidth`, `ellipsize`,
  `wrapWidth`, `label` — a label cut to its room keeps its full text as a `<title>`); margins
  come from the widest label (`leftAxisWidth`); ticks are round steps or powers of ten
  (`linear` / `log` / `symlog`); axes (`axisLeft`, `axisBottom`, `bandLabels`) thin or turn
  labels rather than overprint them; legends (`legend`, flowing or `grid`) wrap at the width.
  Numbers go through `lib/chart/format.ts` — `fmtInt`, `fmtNum`, `fmtPct`, `fmtP`/`pDigits`,
  `fmtRatio`, `fmtMonths` — in the figures and the HTML tables beside them alike, so a p-value
  reads the same everywhere. Type is `FS.small` / `FS.body` / `FS.title` (10 / 11 / 12), never
  below `MIN_FS`; strokes `SW`; the neutral grey `OTHER`. Series colours are `seriesStyle(i)`:
  Okabe–Ito for six, then the same hues with a dash, so a seventh cohort is never a repeat; the
  page's swatches (`SeriesSwatch`) match. Text on a fill takes `textOn(fill)`. A renderer that
  invents a colour, a size or a tick rule is drifting from every other view. Page CSS never
  reaches figures — the same drawing goes to MCP, exports, the CLI and the Python port — so they
  stay out of the Tailwind migration.
- **A figure's text is linted, at every width a card takes.** `lib/chart/lint.ts` reads a drawn
  SVG back and reports type below `MIN_FS`, text running off the figure, and text printed over
  text. `npm run check:figures` runs every documented example and every stress document
  (`scripts/figure-stress.json`: the largest studies, many cohorts and categories, long names)
  and lints each figure at 560, 936 and 1352px; it must report 0. A new view kind, or a change to
  a renderer, adds a stress document when the existing ones do not reach its crowded case.
- **Geometry stays inline, styling does not.** A tooltip's position and a legend swatch's colour
  are data computed from the drawing; borders, padding and type are classes.

## UI conventions — waiting, and never hiding what isn't shown

Every screen answers "is this current?" and "is this everything?" without the reader having to
ask. These hold for every view kind, and for the chat/MCP figures that share its renderers.

- **A settings change that waits on the server shows the view waiting.** The header and its
  controls stay visible and usable, so the reader sees what they just changed and can change it
  again; the figure area below is covered by a skeleton with an "updating…" spinner until the
  new answer lands (`Updating` in `app/lab/view-cards.tsx`, `.view-updating`). A stale figure left on
  screen reads as the new answer. The same cover goes over every view during a full document
  run, and over the oncoprint's plot during its own contract fetch. A change applied in the
  browser alone (the oncoprint's display options, zoom) is instant and gets none.
- **A control whose options come from a fetch shows a loader while it is in flight** — `Waiting`
  ("loading attributes…") in place of the select, a spinner on a menu's summary. Loading, empty
  and failed are three different states and each must say which it is: an empty select during a
  fetch reads as "this study has none". A button gated on fetched data (the add-view buttons'
  `why`) waits with a spinner via its `loading` predicate rather than guessing either way.
- **Every request a table view makes shows, in the table, that it is running** — a query change
  (search, filter, sort, columns: the view re-runs), another page, the whole document re-running.
  The rows on screen are the last answer, so they are covered ("updating…", "loading page 3…",
  `.dt-wait` in `app/_table/DataTable.tsx`) and the count is dimmed with a spinner beside it; the
  bar, chips and headers stay visible and usable, and an action that would act on the stale
  answer (the download) waits, saying why. Such a view draws its own waiting state, so the page
  must not cover its card (`drawsOwnWaiting` in `app/lab/kind-cards.tsx`, honoured by the lab and
  `PortalTabs`). Its controls show and edit the query **the document holds**, not the last result's,
  so a second edit made while the first is running keeps the first. A page not yet on hand is
  loading from the render that asks for it — never a flash of "no rows" first.
- **A menu, popover or list whose contents load never opens empty.** Its fixed controls (a
  filter's condition and text, a range's inputs) are there and usable at once; where the loaded
  part goes, a `Waiting` loader with skeleton rows stands in until it lands; controls that act on
  it (all / none) are disabled with a title saying what they wait for. Loaded-but-empty says so
  ("no values in the rows kept"), and a failed load names the error and offers retry — three
  states, never one blank box.
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
  key). Give the field a small component that owns its own draft and hands the page the value on
  save — the text dialogs in `app/lab/dialogs.tsx` are the pattern: mounted when opened, they start
  from the values they are given and report the result.
- **One way to change the document.** The analysis page's document lives in `app/lab/doc-store.ts`:
  `docs.set` for an edit, `docs.replace` for a different document (an example, a link, a new
  analysis), `docs.commit` for one the AI tools validated. It gives each view a stable id that keys
  its card and lets a one-view re-run find its slot, and puts every new document in the URL — so an
  edit that re-runs nothing is not lost on refresh. Never set the document any other way.
- **Verify waiting states by holding the request.** A loader that flashes past in a normal run
  proves nothing; in Playwright, `page.route()` the endpoint and hold it, check the loader is on
  screen and the controls are still usable, then release it and check the loader is gone.

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
  `test/postgres.db-test.ts`). A store promise belongs in `test/support/store-contracts.ts`, which
  runs there and on `lib/db.ts`'s own fallback.
  `node e2e.cjs` — the browser checks (Playwright) against a running server. The checks that need
  no server (`check:examples`, `check:denominators`, `check:genefacets`, `check:values`,
  `check:splitby-perf`) are stages of `scripts/gate.sh` of their own, and the boundary suite is in
  `npm test`.
  `npm run report:coverage` — the unit suites' coverage (CI shows it on the reports job).
  **Every view kind's output is pinned** by `test/view-snapshots.test.ts` (in `npm test`, no
  database): one gallery example per kind runs through the whole engine against warehouse answers
  recorded in `test/snapshots/answers/`, and its compiled SQL and queries, computed result, figure
  and results text are compared with `test/snapshots/<kind>.{sql,json,svg,txt}`. A diff there is a
  change to review, not noise: `UPDATE_SNAPSHOTS=1` accepts output changes, and a changed query
  needs `RECORD_SNAPSHOTS=1` with `.env.local` (public warehouse only; the answers hold public
  studies' patient-level rows). A new view kind adds its case there. Each case also runs with its
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
