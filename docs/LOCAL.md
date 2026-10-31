# Local mode: your own data in cBioLab

`npm run local` runs cBioLab on your own computer against a private database, and opens an
import page where a study becomes data the whole app can explore and analyse.

```
git clone https://github.com/cBioPortal/cBioLab && cd cBioLab && npm ci
npm run local                      # http://127.0.0.1:3120/import
```

No credentials, no warehouse, no `.env.local` needed. The first start downloads a pinned
ClickHouse release (26.8 LTS, a few hundred MB) and cBioPortal's reference data (genes, aliases,
reference genomes, cancer types, datahub's gene panels); later starts take seconds.

## Importing

The import page takes a study three ways:

- **Drop a folder or files**, or choose them. cBioPortal's study format — `meta_*.txt` files, the
  data files they name, a `case_lists/` folder. Files with datahub's standard names
  (`data_clinical_sample.txt`, `data_clinical_patient.txt`, `data_mutations.txt`, `data_cna.txt`,
  `data_sv.txt`, `*.seg`, `data_timeline*.txt`, `data_gene_panel_matrix.txt`) import **without
  meta files**: give the study an id and the meta each would have had is assumed.
- **A folder on this computer**, by path. Read in place; the quickest way for a large study.
- **A public study from datahub**, by id (`acc_tcga`, `msk_impact_2017`, …): the tarball
  cBioPortal publishes for it is downloaded and imported.

From a terminal, the same importer: `npm run import -- <folder>`, `npm run import -- datahub:<id>`,
`npm run import -- --delete <id>` (it finds the database `npm run local` started). `npm run local --
--import datahub:<id>` imports before the app starts.

Each import reports, per file, how many rows were stored and **every row left out, with the reason**
(a filtered classification, an unrecognised gene, a normal-tissue sample, …), the files it did not
import and why, and samples a data file named that no clinical file did. Importing a study again
replaces it.

What imports today: clinical sample and patient data, mutations (MAF), discrete copy number (wide
and long), continuous profiles (log2/linear CNA, expression, z-scores, methylation, RPPA including
phospho-antibodies), structural variants, copy-number segments, timelines, the gene panel matrix,
gene panel definitions and case lists. Not yet: generic assay, GISTIC, MutSig, gene set scores,
resources. Files of those kinds are listed as not imported.

## How it works

Everything lives in `~/.cbiolab` (`CBIOLAB_DATA` overrides): the ClickHouse binary and its data,
the app's own Postgres (PGlite), downloaded datahub studies, uploads. ClickHouse listens on
127.0.0.1 only, with a generated password (`~/.cbiolab/clickhouse/password`).

The database is **cBioPortal's own ClickHouse schema**, created from `schema.sql` and the seed
tables at a pinned commit of `cBioPortal/cbioportal` (`lib/importer/setup.ts`). The importer
(`lib/importer/`) writes cBioPortal's base tables, applying the legacy importer's rules, and then
runs cBioPortal's own `populate_derived_tables.sql` unchanged, so the `*_derived` tables every view
reads are built by exactly the SQL that builds them for cbioportal.org. Each rule that decides
whether a row is stored is a named function with a test (`test/importer.test.ts`); the rules
themselves, with the legacy source lines they copy, were audited in the import session's notes.

Imports run in their own process (`scripts/import-study.ts --json`, started by
`lib/importer/jobs.ts`) so a large MAF never shares the web server's memory, one at a time (each
rebuilds the derived tables). The app runs as `next dev` with `RESULT_CACHE=off` (a cached answer
would outlive the data under it) and its build output in `.next-local`, so it can share a checkout
with a dev server that owns `.next`. The import page and `/api/import` exist only when
`CBIOLAB_LOCAL=1`, which only the launcher sets: a deployment reading a shared warehouse never
writes to it.

OncoKB is licensed, so the local `oncokb_annotation` store is empty: OncoKB-dependent filters
match nothing, and driver calls come only from a study's own `cbp_driver*` columns.

## Schema modes: cBioPortal's tables, the file-shaped tables, or both

`npm run local -- --schema <mode>` (or `npm run import -- --schema <mode>`) sets where imports
write; `lib/importer/lab-schema.ts` has the details.

- **legacy** (the default) — cBioPortal's tables, then its derived-table SQL, as above.
- **new** — the file-shaped `lab_` tables only: one per kind of study file, long form, keyed by the
  files' own ids, every row carrying its `study_id`. Views with cBioPortal's table names stand in
  for the tables the app reads, so the app's SQL runs unchanged. Moving a database to `new` drops
  cBioPortal's study tables; going back needs a fresh `CBIOLAB_DATA`.
- **both** — both sets of tables from the same import, with the views named `labv_<name>`, for
  comparing them: `node scripts/check-legacy-diff.ts --prefix labv_ <study>` compares the views with
  cBioPortal's own importer exactly as it compares the legacy tables.

In `new` and `both` modes an import is merged into the `lab_` tables rather than replacing
them: rows are staged, then only rows that are new or changed are written and stored rows the
import no longer has get a deletion marker (`ReplacingMergeTree` versions; the views read
`FINAL`), so importing an unchanged study writes no data rows. `npm run import -- --update
<folder>` (new mode) takes a folder holding some samples of an imported study — their clinical
rows and their lines of the data files — and replaces just those samples, and only the kinds of
data the folder holds (in the profiles it holds): the study's counts and the patients'
SAMPLE_COUNT are then recomputed. Study-level rows — profiles, attributes, case lists — are only
added by an update, never changed or removed, and nor are case-list members.

Two scripts measure the modes against each other. `node scripts/check-schema-modes.ts <db> <db>`
runs every gallery example whose studies both local databases hold and compares the engine's
answers (row order and floating-point noise show up as differences too; read them).
`node scripts/bench-schema.ts load --studies a,b --copies N` imports datahub studies plus renamed
copies, and `bench-schema.ts run` times six cBioLab-shaped queries on cBioPortal's tables, the
`labv_` views and the `lab_` tables directly, with and without `FINAL`. With 5 studies (~36,000
samples) on an 11 GB machine, a query through the views reads about the rows the prebuilt tables
read and takes 1.1–2× their time (one gene's altered samples per study, server-side: 20 ms on the
tables, 35 ms through the views; one gene's expression in one study: 5 ms and 10 ms; `FINAL`
adds 0–4 ms). Most of the difference is ClickHouse planning the view's SQL, a cost per query
rather than per row, which is why the views convert a column only where the conversion changes a
value. Of 46 gallery examples, 27 answer identically through the views,
18 differ only in row order or floating-point digits, and one ran out of ClickHouse's ~4.8 GB
there. Importing into `new` takes about as long as before denormalizing (msk_chord_2024: 212 s
against 218 s; acc_tcga: 30–34 s either way).

The importer applies cBioPortal's rules once: it produces rows for cBioPortal's tables, and
`lib/importer/lab-writer.ts` turns each into its `lab_` row. Rows are written denormalized — each
carries what a query would otherwise join for: the gene's symbol, the sample's patient and panel,
whether the gene is on that panel, the cytoband; clinical rows form the full grid of samples (or
patients) by attributes, with `''` where the file has no value; copy-number events are kept in
`lab_cna_event`, apart from the matrix values, as cBioPortal keeps `sample_cna_event`. The six
derived views the app reads most (`genomic_event_derived`, `mutation_derived`,
`clinical_data_derived`, `sample_derived`, `sample_to_gene_panel_derived`,
`genetic_alteration_derived`) each read one `lab_` table and join nothing (a test holds them to
that); the other derived views are cBioPortal's own derived-table SELECTs over base views that
rebuild `sample`, `mutation`, `genetic_profile`, … with ids computed from natural keys. Gene-keyed
tables sort by `study_id` then gene symbol, so a gene's rows in a study are read without a scan. Shared reference data (genes, aliases,
gene panels, cancer types) stays in cBioPortal's tables in every mode.

Verified: the `labv_` views (in `both` mode) and the views of a `new`-mode database match the legacy
tables row for row on every compared table for lgg_ucsf_2014, acc_tcga, mpnst_mskcc,
msk_impact_2017 and msk_chord_2024; the legacy tables match cBioPortal's own importer with a single
difference (msk_impact_2017's 5 shared-event mutations, below). An update of one sample's files
leaves every `lab_` table as a fresh import of the edited study would.

## Where it differs from cBioPortal's importer, on purpose

- A sample a data file names that no clinical file lists is **created** (with a patient of the
  same id) and reported, where the legacy importer aborts.
- `_sequenced`, `_cna`, `_cnaseq` and `_sv` case lists are generated when a study does not supply
  them (cBioPortal generates only `_all`).
- `MUTATION_COUNT` is written for every sample profiled for mutations — `0` when none were found —
  and counts only the mutation profile itself.
- Mutation events are per study, not shared across studies (first study wins in cBioPortal).
- A file that fails to import is reported and the rest of the study imports.

## Checking against cBioPortal's own importer

The reference for the importer is cBioPortal's own importer (`cBioPortal/cbioportal-core`) run on
the same files into a second database; comparing with cbioportal.org instead mixes importer
differences with files that changed on datahub since the warehouse was loaded.
`scripts/check-legacy-diff.ts` compares the two row by row on every table the app reads (allocated
integer ids aside), inside ClickHouse through `remote()`, and prints rows found on one side only.

Running the legacy importer, in short:

1. Build it: `mvn clean package -DskipTests` in a clone of cbioportal-core (the jar lands at the
   clone's root, where its scripts look for it); `pip install -r requirements.txt` in a venv.
2. Start ClickHouse **24.5** (`clickhouse/clickhouse-server:24.5` in Docker; its JDBC driver fails
   silently against newer servers), create database `cbioportal`, and load the same `schema.sql`
   and seed parquets that `lib/importer/setup.ts` pins.
3. `PORTAL_HOME` names a folder holding `application.properties` (`spring.datasource.url=
   jdbc:clickhouse://127.0.0.1:<http port>/cbioportal`, user, password). Load the datahub gene
   panels with `org.mskcc.cbio.portal.scripts.ImportGenePanel --data <file>`, then each study with
   `python -m importer.metaImport -s <study> -n -o --no-derive-tables` from `scripts/`.
4. Build the derived tables with `clickhouse client … --queries-file populate_derived_tables.sql
   --param_optimize_backoff_secs 0` (metaImport's own step needs `CLICKHOUSE_HOST`,
   `CLICKHOUSE_NATIVE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DB` and a
   `clickhouse` binary on `PATH`).
5. `LEGACY_CLICKHOUSE=127.0.0.1:<native port> LEGACY_CLICKHOUSE_PASSWORD=… node
   scripts/check-legacy-diff.ts <study> …`

Result: lgg_ucsf_2014, acc_tcga (CNA, expression, methylation, RPPA with phospho-antibodies,
segments) and mpnst_mskcc are identical in every table. msk_impact_2017 differs in 5 of 78,178
mutations, only in `refseqMrnaId`: cBioPortal shares one mutation event across studies, so those
five carry the transcript of the identical mutation lgg_ucsf_2014 loaded first (its output depends
on import order); here each study keeps its own.

## Parity with cbioportal.org

`node --env-file=.env.local scripts/check-import-parity.ts <study> …` compares a locally imported
study with the same study in the public warehouse, derived table by derived table (needs the
warehouse credentials in `.env.local`). As of this writing:

- **acc_tcga** — identical except `sequenced` (92 vs 90:
  the warehouse's `sample_derived.sequenced` matches sample ids across studies, a legacy bug).
- **lgg_ucsf_2014** — identical, timelines included.
- **msk_impact_2017** — differs by ~1,300 of 78,000 mutations whose protein change datahub has
  since re-annotated (same positions, another transcript): the warehouse was loaded from older files.
- **mpnst_mskcc** — identical since MAF rows whose `Entrez_Gene_Id` is `NA` are dropped, as the
  legacy importer drops them.
