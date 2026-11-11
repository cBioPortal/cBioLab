// Fills an annotation source's version-pinned store, offline (docs/ANNOTATION.md). The app never
// calls an annotation service; this is the only thing that does.
//
//   npm run annotate -- <source> --study <id>     one study's keys
//   npm run annotate -- <source> --all            every study's, then a portal-wide coverage row
//   npm run annotate -- <source> --verify [n]     re-asks the service for n stored keys (default 300)
//     [--release <version>]                       of that stored release (default: the service's current one)
//   --create                                      also creates the store (as a user allowed to), before syncing
//
// Sources: src/index.ts (`oncokb`). Writes as the source's writer
// (<SOURCE>_WRITER_USER / _PASSWORD on CLICKHOUSE_URL, CLICKHOUSE_DB), or, while `npm run local`
// is running, to the local instance. Exits 2 when a run aborts or leaves keys unannotated.
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const id = args[0];
const dataDir = process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab");
if (!process.env.CLICKHOUSE_URL) {
  try { process.loadEnvFile(path.join(dataDir, "local.env")); } catch { /* not running locally */ }
  try { process.loadEnvFile(".env.local"); } catch { /* none */ }
}
// imported after the environment is complete: some modules read their settings when they load
const { annotationSource, syncConn, missingNeeds } = await import("../src/index.ts");
const { ensureStore, syncKeys, syncStudies, warehouseStudies } = await import("../src/sync.ts");

if (!id || id.startsWith("--")) {
  console.error("usage: npm run annotate -- <source> (--study <id> | --all | --verify [n])");
  process.exit(1);
}
const src = annotationSource(id);
const need = missingNeeds(src);
if (need) { console.error(need); process.exit(1); }
const conn = syncConn(src);
const log = (m: string) => console.log(m);

const release = await src.release();

if (args.includes("--verify")) {
  if (!src.verify) { console.error(src.label + " has no verify step"); process.exit(1); }
  const n = Number(opt("--verify")) || 300;
  const version = opt("--release") || release.version;
  const r = await src.verify(conn, version, n);
  if (!r.checked) { console.error("nothing is stored for " + src.label + " " + version + " (name a stored release with --release <version>)"); process.exit(1); }
  for (const m of r.mismatches) console.log("MISMATCH " + m);
  console.log(`verified ${r.checked} stored keys of ${src.label} ${version} against the live service (${release.version}): ${r.mismatches.length} mismatches` +
    (r.mismatches.length ? " — a resolution bug, or the service has moved past this release" : ""));
  process.exit(r.mismatches.length ? 2 : 0);
}

console.log(src.label + " release " + release.version + " — every row written is pinned to it");
// the writer may INSERT only; an administrator creates a store once (--create), and a local instance owns its own
if (process.env.CBIOLAB_LOCAL === "1" || args.includes("--create")) await ensureStore(conn, src);
const study = opt("--study");
if (study) {
  const r = await syncKeys(conn, src, release, study, log);
  process.exit(r.aborted || r.failed ? 2 : 0);
} else if (args.includes("--all")) {
  const r = await syncStudies(conn, src, release, await warehouseStudies(conn), log);
  process.exit(r.aborted || r.missing ? 2 : 0);
} else {
  console.error("say which keys: --study <id> or --all");
  process.exit(1);
}
