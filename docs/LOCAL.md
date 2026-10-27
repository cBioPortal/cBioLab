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
and long), continuous profiles (log2/linear CNA, expression, z-scores, methylation, RPPA without
phospho-antibodies), structural variants, copy-number segments, timelines, the gene panel matrix,
gene panel definitions and case lists. Not yet: generic assay, GISTIC, MutSig, gene set scores,
resources, phospho-protein antibodies. Files of those kinds are listed as not imported.

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

## Where it differs from cBioPortal's importer, on purpose

- A sample a data file names that no clinical file lists is **created** (with a patient of the
  same id) and reported, where the legacy importer aborts.
- `_sequenced`, `_cna`, `_cnaseq` and `_sv` case lists are generated when a study does not supply
  them (cBioPortal generates only `_all`).
- `MUTATION_COUNT` is written for every sample profiled for mutations — `0` when none were found —
  and counts only the mutation profile itself.
- Mutation events are per study, not shared across studies (first study wins in cBioPortal).
- A file that fails to import is reported and the rest of the study imports.

## Parity with cbioportal.org

`node --env-file=.env.local scripts/check-import-parity.ts <study> …` compares a locally imported
study with the same study in the public warehouse, derived table by derived table (needs the
warehouse credentials in `.env.local`). As of this writing:

- **acc_tcga** — identical except RPPA (phospho-antibodies not imported) and `sequenced` (92 vs 90:
  the warehouse's `sample_derived.sequenced` matches sample ids across studies, a legacy bug).
- **lgg_ucsf_2014** — identical, timelines included.
- **msk_impact_2017** — differs by ~1,300 of 78,000 mutations whose protein change datahub has
  since re-annotated (same positions, another transcript): the warehouse was loaded from older files.
- **mpnst_mskcc** — 4 mutations more locally, all rows whose gene resolves only through an alias;
  the alias tables agree today, so most likely the gene table changed after the warehouse load.
