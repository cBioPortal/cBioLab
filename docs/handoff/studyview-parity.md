# Handoff: studyview-parity session (Study View parity on the Explore page)

The work closes cBioPortal Study View gaps on `/lab?tab=explore&study=<id>`, one PR per piece. Every
piece follows invariant 14:
- a cited case table under `docs/legacy-spec/parity/`;
- tests written from it first, by a separate agent, and seen to fail;
- logic in SQL checked against the fixture study;
- planted bugs in `scripts/check-mutants.ts`.

## Done (all merged)

| PR | What | Case table |
|---|---|---|
| #222 | Density chart (Mutation Count vs FGA) as the portal draws it; plot view `range` | `density-cases.md` |
| #257 | Download ▸ Summary Data on every categorical chart; a cut categorical chart reports its `distinct` | `download-cases.md` SD1–SD16 |
| #260 | The empty-selection message; Case Lists, every list counted in samples | `empty-caselists-cases.md`; `scripts/check-case-lists.ts` |
| #261 | Gene tables: every gene (no 500 cap), column sort, the portal's titles and header tooltips, Data download | `gene-tables-cases.md` GR, GT, GS, GH, GD |
| #266 | Gene tables: panels in the Freq tooltip, Union / Intersection with applied rows pinned, the query queue, the alteration-filter indicator | `gene-tables-cases.md` GP, GU, GQ, GI; `scripts/check-gene-panels.ts` |

## Half-done: branch `session/studyview-chart-svg` (one `wip:` commit, off master after #266)

Download ▸ SVG and PDF for the Explore charts (download-cases.md FG1–FG10).

**Built:**
- `lib/study-view-figures.ts`: `pieFigureSvg` (the pie with its legend below) and `barFigureSvg`.
- `chartFileName` gains the `svg` and `pdf` kinds.
- `densityGradientStops()` in `lib/study-view-density.ts`.
- `app/lab/chart-files.ts`: `standaloneSvg`, `densityFigureSvg` (the plot with its HTML legend redrawn inside), and `figureActions` (SVG and PDF entries, PDF through `app/_oncoprint/pdf.ts`).
- The menus are wired:
  - categorical charts: Summary Data, SVG, PDF (a list chart saves as its pie);
  - bars and generic-assay bars;
  - the survival card (via `survivalSvg`);
  - the density card.

**State:**
- `test/study-view-figures-spec.test.ts` (21 tests, written first by an agent) passes with the download tests (53/53), and `tsc` is clean.

**Not done yet:**
- `npx eslint` on the changed files.
- A browser check of every chart's SVG/PDF: open each file, and check that the PDF renders and the density legend sits beside the plot.
- Planted bugs for the figures.
- Ticking STS-DL-1 / STS-SC-5 / STS-KM-6 in `30-study-summary.md`, and the "SVG and PDF of each chart" sub-item in `PORTAL-PARITY.md`.
- The full `npm test` and coverage run.
- The PR.

## Next, in order (PORTAL-PARITY "Study View → summary charts" and "→ filters, actions and tabs")

1. Finish the SVG/PDF branch above.
2. **Per-case downloads:**
   - Full Data for pie and table charts;
   - Data for bar, density and survival charts (download-cases §1–§5 in the legacy findings);
   - the header's "Download clinical data" (STV-AB-4).

   These list patient ids, so they must go through the patient-level path (`/api/table` with the `table` view; docs/DATA-BOUNDARY.md), not the browser's counts.
3. **The Clinical Data tab** (STV-TAB-1, STV-CD-1…9): a table per case of the visible charts' attributes, built on the `table` view kind.
4. **Study header** (STV-HD-2, STV-HD-3): name, description, PubMed link, and the study download.
5. **Add chart** (STV-AC-2, 3, 7, STV-STM-3): the "% samples with data" column, Select all, and turning a chart off clears its filter.
6. **Gene tables, remaining:**
   - MutSig / GISTIC q-values: the warehouse's `mut_sig` (2,846 rows) and `gistic` (3,556) tables hold them for some studies.
   - The panel gene-list modal.
   - The OncoKB cancer-gene icon and filter: data first; the cancer-gene list is read during the annotation sync but not stored.
7. **CN Segments and Plots tabs** (STV-CN-1…3, STV-PL-1).

**Excluded by the user:** pies (on hold), Custom Selection (item 8), the groups manager, virtual studies and saved layouts.

## Open product questions

They are in `~/projects/cbio-next-studyview-parity/QUESTIONS.md`:
1. A chart whose values were cut: Summary Data disabled?
2. Gene-state Summary Data: names or the portal's codes?
3. Case Lists always shown?
4. Gene-table files: keep each count under its own header and the screen's Freq?

## Gotchas

- **Never run `scripts/gate.sh` without the user's yes**; CI runs it. Never `npm run build` / `npm start` in the worktree.
- **The fixture database** (`PEER_DB_PORT=<port> node --env-file=.env.local scripts/peer-db.ts`):
  - It prints `CLICKHOUSE2_*`. Load them with `sed -E 's/^([A-Z0-9_]+)=(.*)$/\1="\2"/'` and `set -a; . file`, because `CLICKHOUSE2_LABEL` has a space.
  - It re-imports when `test/fixtures/peer-study/` changes, subfolders included. A branch older than #260 lacks `case_lists/cases_subset.txt`, and running peer-db from it drops that list, so `check:case-lists` then fails until it is re-run from master.
  - A data folder from before master's OncoKB-SV table must be deleted (`~/.cbiolab-peer/<port>`) and re-created.
- **Planted bugs:**
  - Run them one at a time with `MUTANT_ONLY=<id> npm run check:mutants`.
  - A unit-guarded bug runs only the suites that import its file. Since #257 that includes a dynamic `import("../lib/…")`, as `explore-facets.test.ts` uses.
  - A fixture-guarded one needs the `CLICKHOUSE2_*` variables.
- **Draft limit:** a draft holds at most 8 top-level clauses (`lib/cohort2.ts`). Gene-table Intersection is refused past that (gene-tables-cases GU6).
- **Snapshot tests:**
  - A changed query needs `RECORD_SNAPSHOTS=1 node --env-file=.env.local --test test/view-snapshots*.test.ts`, one shard at a time (memory), or `--test-name-pattern '^snapshot: <name>$'`.
  - Recording rewrites other snapshots with float noise. Restore those and keep only the ones the change meant.
- **Memory:** the machine OOM'd once. Run one headless browser at a time, agents one after another, and `npm test` under coverage alone.
- **Formatting and comments:** number formats live in `lib/chart/format.ts`; tooltips use `data-tip`; no "why I changed this" comments.
