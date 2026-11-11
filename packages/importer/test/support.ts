// The importer's test helpers, on the stand-in ClickHouse of @cbiolab/clickhouse/testing.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeCh } from "@cbiolab/clickhouse/testing";
import { GeneResolver, type Gene } from "../src/genes.ts";
import { ImportContext, type Progress } from "../src/context.ts";
import type { SchemaMode } from "../src/lab-schema.ts";
import type { DataFile, DataKind, Meta } from "../src/study.ts";

export { fakeCh, type FakeCh } from "@cbiolab/clickhouse/testing";

/** A gene table for GeneResolver: [entrez, hugo, aliases?]; entity ids are the entrez ids. */
export function genes(list: [number, string, string[]?][]): GeneResolver {
  const gs: Gene[] = list.map(([entrez, hugo]) => ({ entrez, hugo, type: "protein-coding", entityId: entrez }));
  return GeneResolver.fromRows(gs, list.flatMap(([entrez, , aliases]) => (aliases ?? []).map((alias) => ({ entrez, alias }))));
}

/** An import context on the fake connection, with its ids loaded (they start at 1). */
export async function importContext(ch: FakeCh, opts: { genes?: GeneResolver; studyId?: string; mode?: SchemaMode; progress?: Progress } = {}): Promise<ImportContext> {
  const ctx = new ImportContext(ch.conn, opts.genes ?? genes([]), opts.studyId ?? "test_study", opts.progress ?? (() => {}), opts.mode ?? "legacy");
  await ctx.loadIds();
  return ctx;
}

/** A data file in a fresh temp folder, as readStudyFolder would describe it. */
export function dataFile(kind: DataKind, text: string, meta: Meta = {}, name = "data_" + kind + ".txt"): DataFile {
  const dir = mkdtempSync(join(tmpdir(), "importer-test-"));
  const file = join(dir, name);
  writeFileSync(file, text);
  return { kind, meta, metaFile: null, file };
}

/** A temp folder holding `files` (name → text), for readStudyFolder and importStudy. */
export function studyDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "importer-study-"));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    if (name.includes("/")) mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}
