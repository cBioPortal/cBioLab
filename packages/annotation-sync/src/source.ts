// What an annotation source is to the sync (lib/annotation-sync/sync.ts): its store, the keys it
// annotates, where they come from in the warehouse, and how one batch of them is resolved. A source
// is read only from its store at query time; the outside service is asked here, offline, and never
// by the app (docs/ANNOTATION.md).
import type { Conn, Row } from "@cbiolab/clickhouse";

/** The source's release a sync pins every row it writes to. */
export interface Release {
  /** the pinnable identifier, written to the store's version column (e.g. OncoKB's `v4.28`) */
  version: string;
  /** anything else worth recording with the rows (an API version), by store column */
  extra: Row;
}

export interface AnnotationSource {
  /** short id: the CLI's argument, and the prefix of its writer's environment variables (`ONCOKB_WRITER_USER`) */
  id: string;
  /** how results name it */
  label: string;
  /**
   * its table in the annotation database (store.ts), `annotation.<name>`: a licensed source's alone,
   * so a licence is a GRANT on that table; public sources may share one
   */
  table: string;
  /** the column in `table` holding the release */
  versionColumn: string;
  /** the columns of `table` that identify one annotated key; the warehouse query returns these */
  keyColumns: string[];
  /** CREATE statements for `table`, idempotent (the database and sync_run are store.ts's) */
  ddl: string[];
  /**
   * whose writer the sync writes as: `<WRITER>_WRITER_USER` / `_PASSWORD` (default `<writer>_writer`).
   * Default the source's own id — a licensed source has a writer of its own; public sources share `annotation`.
   */
  writer?: string;
  /** environment variables a sync of this source cannot run without (a licence token) */
  needs: string[];
  /** keys per request to the outside service, and the pause between requests */
  batchSize: number;
  batchDelayMs: number;
  /**
   * A SELECT returning the distinct keys (`keyColumns`, as Strings) of one study, or of every study
   * when `study` is null, from the warehouse database `portalDb`. It may return more columns, which
   * reach `annotate` with each key (Genome Nexus: the genes the variant is listed under).
   */
  keySpace(portalDb: string, study: string | null): string;
  /** The source's current release, asked of the service. */
  release(): Promise<Release>;
  /** The store rows for `keys`, in any order, without the version column or `release.extra`. */
  annotate(keys: Row[]): Promise<Row[]>;
  /**
   * Re-asks the service for `n` stored keys of `version` and returns one line per disagreement: a
   * resolution bug, or a service that has moved past the release. Optional.
   */
  verify?(conn: Conn, version: string, n: number): Promise<{ checked: number; mismatches: string[] }>;
}
