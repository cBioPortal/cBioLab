# Testing

What each suite checks, how to run it, and how the gate and CI put them together.
[`CLAUDE.md`](../CLAUDE.md) holds the rules; this is the detail behind them.

## While iterating

- **`npm test`** — unit suites, no database needed (the patient-data boundary, the stats used by
  federated views, cohort-definition semantics, clinical-course semantics, and the SVG figure
  renderers, plots, gene tracks, template parameters, the panel-aware denominator, and the
  property tests of `test/properties.test.ts`).
- **`npm run test:db`** (~15 s, in `scripts/gate.sh`) runs the stores' Postgres SQL,
  `db/migrations`, their runner and their triggers on an in-process Postgres (PGlite,
  `test/postgres.db-test.ts`), and the stored-id-set request boundary on it
  (`test/request-boundary.db-test.ts`: reading a request's sets, saving a pasted list, locking
  cohorts, against a stand-in warehouse that records which instance each statement and id table
  went to). A store promise belongs in `test/support/store-contracts.ts`, which runs there and on
  `lib/db.ts`'s own fallback. Stored links and id lists: [LINKS.md](LINKS.md), "Testing it" — which
  layer each suite covers, and the e2e helpers (`linkMax`, `holdLinks`, `failStore`) that steer a
  page's links without touching the server.
- **`npm run test:python`** — the Python port's suite (below).
- **`npx eslint <files you touched>`** — the full `npm run lint` takes ~2 min.
- `npm run report:coverage && npm run check:coverage` — the unit suites' coverage and its rules (below).
- **`E2E_PORT=<your next dev port> E2E_ONLY=<areas> node e2e.cjs`** — only the e2e areas you are
  working on (file names in `test/e2e/`, e.g. `view-kinds,riskmodel`), against your running `next dev`.
  The whole suite runs in the gate.

## Coverage rules — new code is tested

CI's `coverage` job runs `npm run report:coverage` (node's coverage of `npm test`) and then
`npm run check:coverage` (`scripts/check-coverage.ts`), which fails on any of:

- **Changed lines poorly covered.** Of a PR's changed lines in `lib/` and `mcp/` (against
  `COVERAGE_BASE`, default `origin/master`; a kind's `doc.ts` is left out), at least 80% of the
  executable ones and 70% of the branches on them must run under `npm test`. A patch with fewer than
  10 of either is not held to a percentage. Lines is the stricter column here: V8 reports no branches
  inside a function that never ran, so the branch figure only speaks for code that did.
- **A new file in `lib/` or `mcp/` that no unit test loads.** Node leaves such a file out of its
  totals altogether. A file of types only never runs and is left out.
- **An area below its floor.** `test/fixtures/coverage-floor.json` holds each area's branch and
  function coverage; falling more than a quarter point below fails. When coverage rises, raise the
  floors with `UPDATE_COVERAGE_FLOOR=1 npm run check:coverage` and commit the file; lowering one is a
  decision a reviewer sees in the diff.

Code a unit test cannot reach (a ClickHouse write, a network call) is better given a seam a test
can drive than an exemption. Where it truly cannot, mark it with node's own comments,
`/* node:coverage ignore next <n> */` or a `/* node:coverage disable */` … `/* node:coverage enable */`
pair, so the exemption is in the code a reviewer reads.

## Every settled view kind is drawn by a browser check

A view kind is in some e2e area's `covers` export (`test/e2e/*.cjs`) unless it says why not: a
`preview` kind, or a provisional one whose `kind.ts` gives an `e2ePending` reason (the new kinds
whose design may still change). `test/e2e-coverage.test.ts` (in `npm test`) fails on a kind that is
neither covered nor exempt, and on one that is both. `test/e2e/view-kinds.cjs` draws each kind it
covers from its gallery snapshot example and requires every card drawn, with no error and no JS
error; an area that checks a kind more closely (`riskmodel.cjs`, the oncoprint in
`analysis-page.cjs`) covers it instead. Promoting a kind removes its exemption and adds it to a
`covers` list in the same change.

## View snapshots — every view kind's output is pinned

The view snapshot tests (`test/view-snapshots*.test.ts`, four parallel shards of
`test/support/view-snapshots.ts`; in `npm test`, no database) run one gallery example per kind
through the whole engine against warehouse answers recorded in `test/snapshots/answers/`, and
compare its compiled SQL and queries, computed result, figure and results text with
`test/snapshots/<kind>.{sql,json,svg,txt}`. A diff there is a change to review, not noise:
`UPDATE_SNAPSHOTS=1` accepts output changes, and a changed query needs
`RECORD_SNAPSHOTS=1 node --env-file=.env.local --test test/view-snapshots*.test.ts` (public
warehouse only; the answers hold public studies' patient-level rows).

The cases are the gallery examples marked `snapshot: "<name>"`: a new view kind marks its smallest
example in its `lib/views/<kind>/doc.ts` (a check fails until it does). Each case also runs with its answers
delivered in reverse, and must not change: a runner combines what it asked for after every answer
is in, in the view's order (`askEachSite` in `lib/views/shared.ts`), never inside the callback as
each one lands.

## Documented examples are executed and their counts pinned

`npm run docs:check` (a stage of `scripts/gate.sh`) fails on drift between `lib/dsl-reference.ts`
and `docs/dsl.md`, and EXECUTES every documented example against the live compiler. **Every
example's cohort counts are pinned** in `test/fixtures/example-counts.json` and asserted by the
same gate, so "it still runs" is not mistaken for "it still gives the same answer". A renamed
cohort, a moved number and a pin left behind by a deleted example all fail. After an intentional
change (or a warehouse reload, or a new OncoKB pin) review what moved and re-pin with
`npm run docs:counts`.

## Method records are re-run

`npm run check:methods` (a stage of `scripts/gate.sh`, which runs it with `docs:check` off one run
of the examples: `npm run check:examples`) runs every gallery example's method script and fails on
any number the script does not reproduce, and on any view without a record that is not on its
named exempt list; it was mutation-checked to catch a real drift. The statistics themselves are
pinned against lifelines/statsmodels/scipy/gseapy by `test/*-golden.test.ts` (fixtures from
`python/golden/`, regenerated with `uv run`).

## The Python port is held to the TypeScript

The Python port is pinned by conformance tests (contract JSON, bucket codes) and golden snapshots
(`test/fixtures/oncoprint/golden.svg`, `golden-raster.npz`; `UPDATE_GOLDEN=1` to accept an
intentional change). These are real cross-language checks — `python/tests/test_cohortlab.py`'s
`Conformance` and `LevelOfDetailConformance` classes shell out to `node scripts/oncoprint-cli.ts`
and diff its output against the Python port — and `scripts/gate.sh` runs the whole Python suite
(bootstrapping `python/.venv` on first run), so a TS-only change to the assembler, LOD or binary
format fails the gate if the port drifts. The conformance tests assert `node` is on `PATH` rather
than skipping when it isn't — a missing dependency must fail loud, not silently pass.

## Browser checks (e2e)

`node e2e.cjs` — the browser checks (Playwright) against a running server. They live by area in
`test/e2e/` (one file per area, run in the order `e2e.cjs` lists); a new check goes in its area's
file. The checks that need no server (`check:examples`, `check:denominators`,
`check:genefacets`, `check:values`, `check:splitby-perf`) are stages of `scripts/gate.sh` of their
own, and the boundary suite is in `npm test`.

**What e2e actually proves.** It drives a local `npx next start` against the **built working
tree** — the last build — not against a commit and not against production. So: rebuild before
running it, and if the tree is dirty you are testing uncommitted code. It needs live ClickHouse
credentials for the warehouse from `.env.local`; CI writes that file from repository secrets. The
second database it reads is the fixture study (below), never a warehouse. The e2e scripts get
their browser from `e2e-browser.cjs` (Playwright is a devDependency; `CHROME_PATH` overrides the
Chromium it launches).

## The second database is a committed fixture study

Every check that reads a second database (connection b, `CLICKHOUSE2_*`) reads
**`test/fixtures/peer-study/`**, a small synthetic study (`cbiolab_peer_fixture`: 40 patients, 44
samples, patient ids `FX-P01`…`FX-P40`) in cBioPortal's study-folder format, built to hold what those
checks assert rather than whatever a real warehouse happens to contain:

- **KRAS-mutant patients** (`FX-P01`–`FX-P20`): the federation check's cohort is `KRAS: MUT` across
  msk_chord_2024 and the peer.
- **`FX-P10`, the patient the federation check opens**: mid-list (so prev / next both step to peer
  patients), a dozen mutations with allele counts (so its table sorts by VAF and pages), timeline events.
- **Timelines** (treatment and specimen events) for every patient, and TP53-mutant and wild-type
  patients both, for the timeline, plot and oncoprint checks.
- **Two gene panels**: `FX-P31`–`FX-P40` are on `PEERFIX_NO_EGFR`, and `FX-P33`, `FX-P35`, `FX-P37` are
  EGFR-mutant there — mutated on no panel covering the gene, the case `check:genefacets` exists for.
  `FX-P02` is FAT1-amplified in one sample and FAT1-deleted in the other, its other case.
- **`DEAD` spelled `False`/`FALSE` and `True`/`TRUE`**, for `check:values`.
- **OncoKB calls** for its variants (`test/fixtures/peer-oncokb.tsv`, a hand-written subset of
  OncoKB's public calls; some variants are left unannotated). A peer annotates with its caller's pin,
  so they are stored under the version the app pins (`ONCOKB_PIN`, else the warehouse's latest) and
  under `fixture`.

`npm run peer-db` (`scripts/peer-db.ts`) starts a private ClickHouse for it (the pinned release
`npm run local` uses, data in `CBIOLAB_PEER_DATA`, default `~/.cbiolab-peer/<port>`), imports the
study with `lib/importer`, seeds the OncoKB rows, and prints the `CLICKHOUSE2_*` lines; it is left
running, and a second run takes about a second. `scripts/gate.sh` runs it for the warehouse and e2e
lanes on a port derived from `GATE_PORT` (20000 + `GATE_PORT` % 10000, `PEER_DB_PORT` overrides), so
concurrent gates never share one, exports its `CLICKHOUSE2_*` over `.env.local`'s, and stops it at
the end if it started it. To point a dev server or a single check at it, pass those lines as
environment variables. A change to the checks' expectations of connection b is a change to the
fixture, made in the same commit.

## The gate and CI

`scripts/gate.sh` runs lint, build, unit, database, docs, method, denominator and parity stages,
the Python suite and the e2e suite. It builds to `.next-gate` (`NEXT_DIST_DIR`), so it never
touches a running `next dev`'s `.next`; `GATE_PORT` picks the port of its ephemeral server
(default 3100), so two gates on one machine don't collide.

**The warehouse checks share one run's answers.** They are scripts, outside the Next result cache,
and they ask the same questions of the same studies many times (each builds Explore for the same
few studies, often in a loop): on 2026-10-29 one CI warehouse lane sent 5,947 statements, of which
4,897 repeated one it had already sent — 77% of its ClickHouse time. The gate gives the lane a
folder (`.gate-cache/run-*`, `CH_RUN_CACHE`) where `lib/ch.ts` keeps each answer, keyed by the whole
statement, for the rest of that run, and deletes it when the lane ends; `check:mutants` does the
same for its guard runs. A failed statement is never kept. The e2e server never gets the variable:
it caches through Next.

**CI runs the gate on every PR and push to master** (`.github/workflows/verify.yml`), as parallel
jobs, one lane each (`local`, `warehouse`, `e2e`; the last two start the fixture peer database, with
the ClickHouse binary and cBioPortal's reference files cached), plus `check:mutants` after the warehouse lane,
with `RECORD=1` and `REPORT_DIR` (a folder that starts empty, so a stage that never ran leaves no
stale file), and merges the jobs' folders into the `verification-report` artifact. The planted-bug
check strips `RECORD`/`REPORT_DIR` from its guard runs, so a run against a planted bug never writes
a report.

## The verification report (`/verification`)

`npm run verify` runs every stage (unit tests, `check:methods`, then the three below with
`RECORD=1`), fails on any failing check, and writes `docs/verification/*.json` — the report the
page reads, committed from a passing run. The saved copy is updated by hand; the page links to the
latest CI runs on master. The page is written for bench scientists and PIs and opens by saying what
the suite is and what it depends on (the public cbioportal.org API, the warehouse, the studies
named in the scripts).

- `check:portal` — counts, gene frequencies and filtered cohorts against cbioportal.org's public
  API, exact, no tolerance.
- `check:cohorts` — the cohort algebra (and/or/not, splits, line nesting, held-out halves) as set
  arithmetic over patient ids, and fast-check-generated definitions compared with a reference
  evaluator over the raw rows.
- `check:mutants` — plants each bug in `scripts/check-mutants.ts` into a temp copy and requires a
  check to fail.

The first two are gate stages. A new statistic gets a row in `lib/verification.ts`
(`test/verification.test.ts` fails otherwise); new cohort or count logic should get a planted bug
that proves some check would notice it breaking. A planted bug that cannot change any result on
this warehouse (e.g. `cna >= 1`, when only ±2 is stored) proves nothing — replace it rather than
counting it.
