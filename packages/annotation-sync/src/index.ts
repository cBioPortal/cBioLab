// The annotation sources the offline sync knows (docs/ANNOTATION.md), and the identity it writes as.
import { envConn, writerConn, type Conn } from "@cbiolab/clickhouse";
import type { AnnotationSource } from "./source.ts";
import { oncokbSource } from "./sources/oncokb.ts";

export const ANNOTATION_SOURCES: AnnotationSource[] = [oncokbSource];

export function annotationSource(id: string): AnnotationSource {
  const s = ANNOTATION_SOURCES.find((x) => x.id === id);
  if (!s) throw new Error("no annotation source '" + id + "' (sources: " + ANNOTATION_SOURCES.map((x) => x.id).join(", ") + ")");
  return s;
}

/** Every source's CREATE statements, for a new local database (lib/importer/setup.ts): its stores exist, empty. */
export function annotationStoreDdl(): string[] {
  return ANNOTATION_SOURCES.flatMap((s) => s.ddl);
}

/**
 * The connection a sync of `src` writes as: in local mode the instance's own user, which owns the
 * whole database; elsewhere the source's writer (@cbiolab/clickhouse `writerConn`), a user granted INSERT on
 * the source's database and SELECT on the warehouse only — never the app's read-only identity.
 */
export function syncConn(src: AnnotationSource, env: Record<string, string | undefined> = process.env): Conn {
  if (env.CBIOLAB_LOCAL === "1") return envConn(env);
  return writerConn(src.id, src.label + " sync (docs/ANNOTATION.md)", env);
}

/** The environment variables `src` needs that are unset, named in one message, or null. */
export function missingNeeds(src: AnnotationSource, env: Record<string, string | undefined> = process.env): string | null {
  const m = src.needs.filter((k) => !env[k]);
  return m.length ? "a " + src.label + " sync needs " + m.join(", ") : null;
}
