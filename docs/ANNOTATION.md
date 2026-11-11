# Annotation stores

**The app never calls an annotation service.** Everything a result says about a variant beyond
the study's own data — OncoKB's oncogenicity and levels today, and the sources still to come
(Genome Nexus's HGVS, ClinVar, gnomAD, dbSNP, SIGNAL and functional-impact predictions; CIViC;
transcripts, Pfam domains, PTMs and structures) — is resolved **offline**, by `npm run annotate`,
into a version-pinned store in ClickHouse, and read from there at query time. So a result never
depends on whether a service answered in time, every annotation it shows names the release it
came from, and no variant leaves the warehouse while someone is waiting for an answer.

## How a store works

Each source has its own database, written by a sync and read by the app:

- **Version-pinned.** Every row carries the source's release (`oncokb_version` for OncoKB) and the
  table is partitioned by it. Releases are appended, never overwritten: a figure annotated against
  a release re-renders against it for good, readers pin `WHERE <version> = '<pin>'`, and retiring a
  release is `ALTER TABLE … DROP PARTITION`.
- **Its own database, so access is a GRANT.** A licensed source (OncoKB) is readable by an
  identity that has `SELECT` on its database and by no other; revoking the grant is one statement,
  and readers then degrade loudly to unannotated results. The portal import never writes there, so a
  portal dump never holds licensed data.
- **Diffed, resumable syncs.** A sync takes a study's distinct keys from the warehouse
  (`genomic_event_derived`), subtracts what the store already holds for the release — in ClickHouse,
  one query — and asks the service for the rest in polite batches. Re-running, or a key shared by
  several studies, never asks twice. Ten failed batches in a row stop the run (a token or rate
  problem, not a data problem).
- **Audited.** Every run appends a row to the source's `sync_run`: study, release, keys in the
  study, already stored, annotated now, failed, and a note (`complete`, `partial — re-run to resume`,
  `aborted …`). `--all` adds a `__portal__` row saying how much of every study's key space is
  stored. The app reads `sync_run` to say which studies a release covers.

## Running a sync

```
npm run annotate -- oncokb --study msk_chord_2024   # one study
npm run annotate -- oncokb --all                    # every study, then the portal-wide row
npm run annotate -- oncokb --verify 300 --release v7.5   # re-ask the service for 300 keys stored for v7.5
npm run annotate -- oncokb --all --create           # also create the store, as a user allowed to
```

The sync writes as the source's **writer**, never as the app: `<SOURCE>_WRITER_USER` (default
`<source>_writer`) and `<SOURCE>_WRITER_PASSWORD` on `CLICKHOUSE_URL` / `CLICKHOUSE_DB`. While
`npm run local` is running it writes to the local instance instead, which owns its whole database
and creates the stores when it is set up. OncoKB also needs `ONCOKB_TOKEN`
([register](https://www.oncokb.org/account/register)); `ONCOKB_BASE`, `ONCOKB_BATCH_SIZE` (250) and
`ONCOKB_BATCH_DELAY_MS` (300) are optional. The command exits 2 when a run aborts or leaves keys
unannotated, so a scheduled sync fails visibly.

A new release of a source: run the sync again. Its rows land in a new partition, and readers move
to it when their pin does (`ONCOKB_PIN`, or the newest release in the store).

## Setting up a store on a shared warehouse (administrator, once)

```sql
-- the store: the source's own statements (packages/annotation-sync/src/sources/<source>.ts `ddl`),
-- or `npm run annotate -- <source> --create` as a user allowed to create them

-- its writer: the only identity that can fill it; it reads the warehouse and writes nowhere else
CREATE USER IF NOT EXISTS oncokb_writer IDENTIFIED BY '<a strong password>';
GRANT SELECT, INSERT ON oncokb_annotation.* TO oncokb_writer;
GRANT SELECT ON <warehouse database>.* TO oncokb_writer;

-- licensing a reader is a grant on the store; revoking it is one statement
GRANT SELECT ON oncokb_annotation.* TO cohort_lab_ro;
-- REVOKE SELECT ON oncokb_annotation.* FROM cohort_lab_ro;
```

## The code

The sync is a package of its own, `@cbiolab/annotation-sync` (`packages/annotation-sync/`), as the
importer is (`@cbiolab/importer`): both are tools run against a database, not parts of the app, and
both reach ClickHouse through `@cbiolab/clickhouse`, a client of their own. **The app never imports
the sync** — `test/boundary.test.ts` fails if `app/`, `lib/` or `mcp/` does — which is how "no
annotation service at run time" is held. In `src/`:

- `source.ts` — what a source is: its database, table, version column and key columns, its
  `CREATE` statements, the warehouse query for its keys, how it reads the service's release and
  resolves a batch, and optionally how it verifies stored rows against the live service.
- `sync.ts` — the source-independent part: the diff, the batches, the failure rule, `sync_run`.
- `sources/<source>.ts` — one file per source. `sources/oncokb.ts` holds the OncoKB client.
- `index.ts` — the list of sources, the writer connection, and every store's `CREATE` statements,
  which a new local database runs (`packages/importer/src/setup.ts`), so its stores exist, empty.
- `bin/annotate.ts` — the command (`npm run annotate`), and the package's `cbiolab-annotate`.

Readers: `lib/annotation.ts` (the pin, which studies are synced, the driver index) and the SQL that
joins the OncoKB store at the pin (`lib/oql.ts`'s `DRIVER`, the mutation and SV tables, the
actionability and clonality views).

### Adding a source

1. A file in `packages/annotation-sync/src/sources/` exporting an `AnnotationSource`, listed in
   `ANNOTATION_SOURCES`. Its database is its own; a licensed source's especially.
2. Unit tests against the stand-in ClickHouse (`@cbiolab/clickhouse/testing`) and a stubbed
   service, as `packages/annotation-sync/test/annotation-sync.test.ts` does for OncoKB.
3. The readers: whatever joins the store does so at a pin, the pin is echoed in the result's
   sources, and a study the release does not cover is said to be missing (invariant 2).

The OncoKB store was filled by the standalone `cBioPortal/oncokb-annotation-pipeline` before this
moved here; the schema, key space and audit rows are unchanged, so the existing store and its
`sync_run` history carry on as they are.
