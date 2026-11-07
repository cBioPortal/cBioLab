# The `datafiles` view

cBioPortal's Results-page **Download** tab (`src/pages/resultsView/download/` in cbioportal-frontend)
for one cohort and a gene query (`oql`, one OQL entry per line). The Results page draws it as its last
tab, over the queried samples (`app/portal/results-layout.ts`).

What it holds:

- **Counts** (`sql.ts`, `datafilesCountsSql`, through `viewAggregate`): per study, the cohort's samples,
  those the query alters, those it leaves unaltered, and per line the samples it alters among those
  profiled for it. Counts only; added across studies in `run.ts`, never percentages averaged.
- **Files** (`tables.ts`): each a table of the view on `lib/table-query.ts`, named by `table` in
  `POST /api/table` (the CSV) and `POST /api/view-page`. Status tables — `cases` (the case table the card
  shows), `altered`, `unaltered`, `matrix` — and gene-by-sample matrices — `mutations`, `sv`,
  `profile:<profile>` for each molecular profile in `genetic_alteration_derived`. Every row names a sample,
  so they run only through `PatientLevelResolver` (`runRows`); no peer serves them (no `PEER_TABLES` entry).

One rule decides a sample's status against a line, used by both the counts and the tables (`lineCtes`,
`lineProfiled` in `sql.ts`):

- **altered** — it has an event the line's OQL matches: `oqlEventsSql` (`lib/oql.ts`), the cohort OQL
  clause's own conditions, row by row, at sample level;
- **profiled** — its panel covers the line's gene in ANY data type the line reads (mutation, discrete copy
  number, structural variant — those the study holds; `profiledCasesSql`). This is the frequency's
  denominator, as the portal's (`filteredSequencedSampleKeysByGene`);
- **unaltered** (the sample, not the line) — no line alters it AND it is profiled for EVERY line's gene
  in EVERY data type the line reads, as the Results page's Unaltered cohort. The rest are "not profiled".

Deliberate differences from the portal: files are CSV (every table download here is), with the cohort and
study as the first columns; no transposed matrix; the unaltered list and the sample matrix leave out (NP)
samples not profiled for everything the query reads, where the portal counts them unaltered; a line's
denominator is the data types that line reads, not every profile selected; generic-assay profiles are not
offered (the portal offers only those added as oncoprint tracks); the lists open as a cohort in the lab (a
`sampleList` clause, stored as an id set) instead of a virtual study or a new query.
