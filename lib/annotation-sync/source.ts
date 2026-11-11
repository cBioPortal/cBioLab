// What an annotation source is to the sync (lib/annotation-sync/sync.ts): its store, the keys it
// annotates, where they come from in the warehouse, and how one batch of them is resolved. A source
// is read only from its store at query time; the outside service is asked here, offline, and never
// by the app (docs/ANNOTATION.md).
import type { ChConn } from "../ch.ts";
import type { Row } from "../importer/ch-write.ts";

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
  /** its own database: a licence is a GRANT on it, and the portal import never writes there */
  db: string;
  /** the annotation table in `db` */
  table: string;
  /** the column in `table` and in `db`.sync_run holding the release */
  versionColumn: string;
  /** the columns of `table` that identify one annotated key; the warehouse query returns these */
  keyColumns: string[];
  /** CREATE statements for `db`, `table` and `db`.sync_run, idempotent */
  ddl: string[];
  /** environment variables a sync of this source cannot run without (a licence token) */
  needs: string[];
  /** keys per request to the outside service, and the pause between requests */
  batchSize: number;
  batchDelayMs: number;
  /**
   * A SELECT returning the distinct keys (`keyColumns`, as Strings) of one study, or of every study
   * when `study` is null, from the warehouse database `portalDb`.
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
  verify?(conn: ChConn, version: string, n: number): Promise<{ checked: number; mismatches: string[] }>;
}
