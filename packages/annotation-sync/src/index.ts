// The annotation sources the offline sync knows (docs/ANNOTATION.md), and the identity it writes as.
import { envConn, writerConn, type Conn } from "@cbiolab/clickhouse";
import type { AnnotationSource } from "./source.ts";
import { oncokbSource } from "./sources/oncokb.ts";
import { genomeNexusSource, genomeNexusGrch38Source } from "./sources/genome-nexus.ts";
import { STORE_DDL } from "./store.ts";

export { ANNOTATION_DB, SYNC_RUN_TABLE, VARIANT_TABLE } from "./store.ts";

export const ANNOTATION_SOURCES: AnnotationSource[] = [oncokbSource, genomeNexusSource, genomeNexusGrch38Source];

export function annotationSource(id: string): AnnotationSource {
  const s = ANNOTATION_SOURCES.find((x) => x.id === id);
  if (!s) throw new Error("no annotation source '" + id + "' (sources: " + ANNOTATION_SOURCES.map((x) => x.id).join(", ") + ")");
  return s;
}

/** The annotation database's CREATE statements, every source's included, for a new local database (packages/importer/src/setup.ts): it exists, empty. */
export function annotationStoreDdl(): string[] {
  return [...new Set([...STORE_DDL, ...ANNOTATION_SOURCES.flatMap((s) => s.ddl)])];
}

/**
 * The connection a sync of `src` writes as: in local mode the instance's own user, which owns the
 * whole database; elsewhere the source's writer (@cbiolab/clickhouse `writerConn`), a user granted INSERT on
 * the source's table and SELECT on the warehouse only — never the app's read-only identity. Public
 * sources share one writer, `annotation_writer` (their `writer`).
 */
export function syncConn(src: AnnotationSource, env: Record<string, string | undefined> = process.env): Conn {
  if (env.CBIOLAB_LOCAL === "1") return envConn(env);
  return writerConn(src.writer ?? src.id, src.label + " sync (docs/ANNOTATION.md)", env);
}

/** The environment variables `src` needs that are unset, named in one message, or null. */
export function missingNeeds(src: AnnotationSource, env: Record<string, string | undefined> = process.env): string | null {
  const m = src.needs.filter((k) => !env[k]);
  return m.length ? "a " + src.label + " sync needs " + m.join(", ") : null;
}
