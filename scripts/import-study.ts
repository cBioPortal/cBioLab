// Imports one study into the local database.
//
//   node scripts/import-study.ts <folder>            a study folder (meta files + data files)
//   node scripts/import-study.ts datahub:<study_id>  a public study, downloaded from datahub
//   node scripts/import-study.ts --delete <study_id> removes an imported study
//
// Options: --id <study_id> names a folder that has no meta_study.txt; --json prints progress and
// the result as JSON lines (how the import page runs it, in its own process so a large MAF never
// shares the web server's memory). Reads CLICKHOUSE_* and CBIOLAB_DATA, which `npm run local` sets
// for the page and writes to ~/.cbiolab/local.env for `npm run import` in another terminal.
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const json = args.includes("--json");
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const target = args.find((a, i) => !a.startsWith("--") && !["--id", "--delete"].includes(args[i - 1] ?? ""));
const dataDir = process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab");
// run from a terminal: reach the database `npm run local` started
if (process.env.CBIOLAB_LOCAL !== "1") { try { process.loadEnvFile(path.join(dataDir, "local.env")); } catch { /* not running */ } }
// imported after the environment is complete: lib/ch.ts reads its connection when it loads
const { assertLocal, localConn } = await import("../lib/importer/ch-write.ts");
const { fetchDatahubStudy } = await import("../lib/importer/datahub.ts");
const { deleteStudy, importStudy } = await import("../lib/importer/import-study.ts");

const emit = (o: Record<string, unknown>) => {
  if (json) process.stdout.write(JSON.stringify(o) + "\n");
  else if (o.type === "progress") console.log("· " + String(o.step) + (o.file ? " " + String(o.file) : ""));
};

async function main(): Promise<void> {
  assertLocal();
  const conn = localConn();
  const del = opt("--delete");
  if (del) {
    const removed = await deleteStudy(conn, dataDir, del);
    emit({ type: "result", deleted: removed, studyId: del });
    if (!json) console.log(removed ? "Removed " + del : "No study " + del);
    return;
  }
  if (!target) throw new Error("Usage: node scripts/import-study.ts <folder | datahub:<study_id>> [--id <study_id>] [--json]");
  let dir = target, fallbackId = opt("--id") || path.basename(path.resolve(target));
  if (target.startsWith("datahub:")) {
    fallbackId = target.slice("datahub:".length);
    dir = await fetchDatahubStudy(dataDir, fallbackId, (step) => emit({ type: "progress", step }));
  }
  const result = await importStudy(conn, dataDir, path.resolve(dir), fallbackId, (e) => emit({ type: "progress", ...e }));
  emit({ type: "result", result });
  if (!json) {
    console.log("\nImported " + result.studyId + ": " + result.patients + " patients, " + result.samples + " samples in " + result.seconds + " s");
    for (const f of result.files) {
      const skipped = Object.entries(f.skipped).map(([k, v]) => v + " " + k).join("; ");
      console.log("  " + f.file + " (" + f.kind + "): " + f.stored + " of " + f.read + " rows" + (skipped ? " — not stored: " + skipped : "") + (f.notes.length ? " — " + f.notes.join("; ") : ""));
    }
    for (const n of result.notImported) console.log("  not imported: " + n.file + " — " + n.reason);
    for (const w of result.warnings) console.log("  warning: " + w);
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  if (json) process.stdout.write(JSON.stringify({ type: "error", message }) + "\n");
  else console.error("Import failed: " + message);
  process.exit(1);
});
