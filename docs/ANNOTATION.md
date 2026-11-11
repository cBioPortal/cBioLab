# Annotation stores

**The app never calls an annotation service.** Everything a result says about a variant beyond
the study's own data — OncoKB's oncogenicity and levels, Genome Nexus's HGVSc, ClinVar and SIGNAL
today, and the sources still to come (gnomAD, dbSNP and functional-impact predictions; CIViC;
transcripts, Pfam domains, PTMs and structures) — is resolved **offline**, by `npm run annotate`,
into a version-pinned store in ClickHouse, and read from there at query time. So a result never
depends on whether a service answered in time, every annotation it shows names the release it
came from, and no variant leaves the warehouse while someone is waiting for an answer.

## Where it is stored

Every source's annotations live in one ClickHouse database, `annotation`, apart from the portal's:

| table | holds | read by |
|---|---|---|
| `annotation.oncokb` | OncoKB, licensed: mutations by protein change, gene-level copy-number calls | those granted `SELECT` on this table — the licence |
| `annotation.variant` | every public source, one row per (source, release, genomic variant): the variant's coordinates as the warehouse spells them, the source's annotation as JSON in `data` | everyone with the app's read access |
| `annotation.sync_run` | every source's sync runs, by `source` and `version` | everyone with the app's read access |

A licensed source has a table of its own, so its licence is a `GRANT` on that table; public
sources share `annotation.variant`, so adding one needs no new table. The database is separate
from the portal's, so a portal dump never holds annotations, licensed or not; a dump of
`annotation` itself must leave out the licensed tables. The app reads these names from
`lib/annotation-store.ts`, the sync from `packages/annotation-sync/src/store.ts` and its sources;
`test/annotation-store.test.ts` holds the two, and the migrations in
`packages/annotation-sync/sql/`, to each other.

### Genome Nexus

Genome Nexus runs one service per reference genome, each with its own releases, so each is a source:
`genome_nexus` (GRCh37, `v1.genomenexus.org`, the studies on hg19) and `genome_nexus_grch38`
(`grch38.genomenexus.org`, hg38). A sync asks each distinct variant of its studies' mutations as
cBioPortal asks it — `POST /annotation/genomic` with `annotation_summary`, `clinvar` and (GRCh37
only: the GRCh38 service has none) `signal`, MSKCC isoform overrides — and stores, per variant:
every transcript's consequence summary (HGVSc, HGVSp, consequence, SIFT/PolyPhen); each gene's
canonical transcript (`/ensembl/canonical-transcript/hgnc`, asked once per gene per sync), because the
portal's HGVSc is on the canonical transcript of the gene the mutation is listed under and a third of
variants lie in two genes; ClinVar's record; and SIGNAL's entries. A variant the service cannot
annotate is stored with its error, so it is not asked again. The release is the server version, its
VEP cache and its ClinVar release (`2.2.3-vep116-clinvar20260208`); GRCh38's service reports its VEP
as `NA` (it asks Ensembl), so its rows are pinned to less than GRCh37's.

The mutation table (`lib/mutation-table.ts`, `lib/variant-annotation.ts`) joins each study's
mutations to its own genome's source at that source's pin, the newest release a sync stored
(`GENOME_NEXUS_PIN`, `GENOME_NEXUS_GRCH38_PIN` override it), and reads HGVSc, ClinVar and SIGNAL off
the JSON; HGVSg it builds from the mutation's coordinates, as the portal does. Its caveat names the
pins and the studies no sync has covered. Before the first sync there is no pin, and the table
leaves the store alone.

The public warehouse holds about 6.0M distinct GRCh37 variants and 3.1M GRCh38 ones (November 2026).
They are stored at about 0.2 KB each, compressed (2.5–3 KB as JSON), so about 2 GB in all. At the
public services' pace measured on one study (about 60 variants a second, the canonical-transcript
calls included) a first full sync takes about two days; later ones ask only for new variants.

## How a store works

- **Version-pinned.** Every row carries the source's release (`oncokb_version` for OncoKB) and the
  table is partitioned by it. Releases are appended, never overwritten: a figure annotated against
  a release re-renders against it for good, readers pin `WHERE <version> = '<pin>'`, and retiring a
  release is `ALTER TABLE … DROP PARTITION`.
- **A licensed source's table is a GRANT.** OncoKB is readable by an identity that has `SELECT` on
  `annotation.oncokb` and by no other; revoking the grant is one statement, and readers then degrade
  loudly to unannotated results. The portal import never writes there.
- **Diffed, resumable syncs.** A sync takes a study's distinct keys from the warehouse
  (`genomic_event_derived`), subtracts what the store already holds for the release — in ClickHouse,
  one query — and asks the service for the rest in polite batches. Re-running, or a key shared by
  several studies, never asks twice. Ten failed batches in a row stop the run (a token or rate
  problem, not a data problem).
- **Audited.** Every run appends a row to `annotation.sync_run` (its `source`): study, release, keys in the
  study, already stored, annotated now, failed, and a note (`complete`, `partial — re-run to resume`,
  `aborted …`). `--all` adds a `__portal__` row saying how much of every study's key space is
  stored. The app reads `sync_run` to say which studies a release covers.

## Running a sync

```
npm run annotate -- oncokb --study msk_chord_2024   # one study
npm run annotate -- oncokb --all                    # every study, then the portal-wide row
npm run annotate -- oncokb --verify 300 --release v7.5   # re-ask the service for 300 keys stored for v7.5
npm run annotate -- oncokb --all --create           # also create the store, as a user allowed to
npm run annotate -- genome_nexus --all              # every GRCh37 study's variants
npm run annotate -- genome_nexus_grch38 --all       # every GRCh38 study's
```

The sync writes as the source's **writer**, never as the app: `<SOURCE>_WRITER_USER` (default
`<source>_writer`) and `<SOURCE>_WRITER_PASSWORD` on `CLICKHOUSE_URL` / `CLICKHOUSE_DB`. The public
sources share one, `ANNOTATION_WRITER_USER` (`annotation_writer`) / `ANNOTATION_WRITER_PASSWORD`,
which can write `annotation.variant` and the log and never reaches the licensed tables. While
`npm run local` is running it writes to the local instance instead, which owns its whole database
and creates the stores when it is set up. OncoKB also needs `ONCOKB_TOKEN`
([register](https://www.oncokb.org/account/register)); `ONCOKB_BASE`, `ONCOKB_BATCH_SIZE` (250) and
`ONCOKB_BATCH_DELAY_MS` (300) are optional. The command exits 2 when a run aborts or leaves keys
unannotated, so a scheduled sync fails visibly.

A new release of a source: run the sync again. Its rows land in a new partition, and readers move
to it when their pin does (`ONCOKB_PIN`, or the newest release in the store).

## Setting up the database on a shared warehouse (administrator)

The schema changes are numbered SQL files in `packages/annotation-sync/sql/`, each run once, in
order, by an administrator; each says what it does, checks its own result, and is safe to repeat.
`001-annotation-database.sql` creates `annotation` and copies OncoKB in from the database it used to
have (`oncokb_annotation`), which is dropped only once the code reading `annotation` is deployed.
`002-annotation-variant.sql` creates `annotation.variant` and grants the public sources' writer and
the app what they need there; the writer itself (`CREATE USER`, with a password of your choosing) is
the one step you edit before running it.

```sql
-- a source's writer: the only identity that can fill its table; it reads the warehouse, writes its
-- table and the log, and nothing else
CREATE USER IF NOT EXISTS oncokb_writer IDENTIFIED BY '<a strong password>';
GRANT SELECT, INSERT ON annotation.oncokb TO oncokb_writer;
GRANT SELECT, INSERT ON annotation.sync_run TO oncokb_writer;
GRANT SELECT ON <warehouse database>.* TO oncokb_writer;

-- licensing a reader is a grant on the licensed table; revoking it is one statement
GRANT SELECT ON annotation.oncokb TO cohort_lab_ro;
-- REVOKE SELECT ON annotation.oncokb FROM cohort_lab_ro;
```

A local instance (`npm run local`) creates the database and every table itself, empty.

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
- `sources/<source>.ts` — one file per source. `sources/oncokb.ts` holds the OncoKB client,
  `sources/genome-nexus.ts` the Genome Nexus one (both genomes).
- `index.ts` — the list of sources, the writer connection, and every store's `CREATE` statements,
  which a new local database runs (`packages/importer/src/setup.ts`), so its stores exist, empty.
- `bin/annotate.ts` — the command (`npm run annotate`), and the package's `cbiolab-annotate`.

Readers: `lib/annotation.ts` (the OncoKB pin, which studies are synced, the driver index) and the SQL
that joins the OncoKB store at the pin (`lib/oql.ts`'s `DRIVER`, the mutation and SV tables, the
actionability and clonality views); `lib/variant-annotation.ts` (the Genome Nexus pins and the SQL the
mutation table reads `annotation.variant` with).

### Adding a source

1. A file in `packages/annotation-sync/src/sources/` exporting an `AnnotationSource`, listed in
   `ANNOTATION_SOURCES`. Its database is its own; a licensed source's especially.
2. Unit tests against the stand-in ClickHouse (`@cbiolab/clickhouse/testing`) and a stubbed
   service, as `packages/annotation-sync/test/annotation-sync.test.ts` does for OncoKB.
3. The readers: whatever joins the store does so at a pin, the pin is echoed in the result's
   sources, and a study the release does not cover is said to be missing (invariant 2).

The OncoKB store was filled by the standalone `cBioPortal/oncokb-annotation-pipeline`, in a database
of its own (`oncokb_annotation`), before this moved here; `001-annotation-database.sql` copies its
rows and its `sync_run` history into `annotation` unchanged.
