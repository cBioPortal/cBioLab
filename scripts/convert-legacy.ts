// Builds a new-schema database from a database in cBioPortal's own schema on the same ClickHouse
// server (lib/importer/from-legacy.ts). The destination is CLICKHOUSE_DATABASE.
//
//   node scripts/convert-legacy.ts --from <db> --setup          creates the destination (reference tables, lab_ tables, views)
//   node scripts/convert-legacy.ts --from <db> <study_id> …     converts the named studies
//   node scripts/convert-legacy.ts --from <db> --changed        converts the studies new or re-imported in <db> since the
//                                                               last run, and removes those <db> no longer has
//
// Reads CLICKHOUSE_* and CBIOLAB_DATA as scripts/import-study.ts does.
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const studies = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--from");
const dataDir = process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab");
if (process.env.CBIOLAB_LOCAL !== "1") { try { process.loadEnvFile(path.join(dataDir, "local.env")); } catch { /* not running */ } }
const { assertLocal, localConn } = await import("../lib/importer/ch-write.ts");
const { changedStudies, convertStudy, removeConverted, setupFromLegacy } = await import("../lib/importer/from-legacy.ts");

async function main(): Promise<void> {
  assertLocal();
  const conn = localConn();
  const source = opt("--from");
  if (!source) throw new Error("Usage: node scripts/convert-legacy.ts --from <db> [--setup] [--changed] [study_id …]");
  if (source === conn.db) throw new Error("--from names the destination database (CLICKHOUSE_DATABASE); convert into another one");
  const log = (m: string) => console.log("· " + m);
  if (args.includes("--setup")) await setupFromLegacy(conn, dataDir, source, log);
  const todo = [...studies];
  if (args.includes("--changed")) {
    for (const c of await changedStudies(conn, source)) {
      if (c.change !== "removed") todo.push(c.studyId);
      else if (await removeConverted(conn, c.studyId)) console.log("Removed " + c.studyId);
    }
  }
  let failed = 0;
  for (const [i, id] of todo.entries()) {
    console.log(`[${i + 1}/${todo.length}] ${id}`);
    try {
      const r = await convertStudy(conn, source, id, log);
      const counts = Object.entries(r.rows).filter(([, n]) => n).map(([t, n]) => `${t.replace(/^lab_/, "")} ${n}`).join(", ");
      console.log(`Converted ${id} in ${r.seconds.toFixed(1)} s: ${counts}`);
      if (r.skipped.length) console.log("  not converted (generic assay profiles, which the lab_ tables do not hold yet): " + r.skipped.join(", "));
    } catch (e) {
      failed++;
      console.error(`Failed ${id}: ` + (e instanceof Error ? e.message : String(e)));
    }
  }
  if (failed) process.exit(1);
}

main().catch((e: unknown) => {
  console.error("Conversion failed: " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
