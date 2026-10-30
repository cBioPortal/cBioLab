// Runs the gallery examples against two local databases and compares what the engine answers:
// the same studies imported in `legacy` mode (cBioPortal's tables) and in `new` mode (the lab_
// tables behind views with cBioPortal's names; lib/importer/lab-schema.ts). Only examples whose
// studies are in both are run. Equal answers mean the app's SQL needs no change for the new schema.
//
//   node scripts/check-schema-modes.ts cbioportal cbioportal_new
//
// Connection details come from ~/.cbiolab/local.env (`npm run local`); each database is run in a
// child process of its own, because lib/ch.ts reads its connection when it loads.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// what differs between two runs of the same analysis for reasons other than the data
const VOLATILE = new Set(["stats", "ms", "sources", "sql", "queries", "query", "compiledSql", "log", "elapsed", "timing", "provenance", "importDate", "built"]);

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).map(([k, x]) => [k, strip(x)]));
  return v;
}

/** The first path at which two values differ, or null. */
function firstDifference(a: unknown, b: unknown, at = ""): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at + "/" + k);
      if (d) return d;
    }
  }
  return `${at}: ${JSON.stringify(a)?.slice(0, 160)} vs ${JSON.stringify(b)?.slice(0, 160)}`;
}

if (process.env.SCHEMA_MODES_CHILD) {
  const { EXAMPLES } = await import("../lib/dsl-reference.ts");
  const { runExamples } = await import("./examples-run.ts");
  const { chQuery, PRIMARY } = await import("../lib/ch.ts");
  const have = new Set((await chQuery<{ s: string }>("SELECT cancer_study_identifier AS s FROM cancer_study", PRIMARY)).data.map((r) => r.s));
  const studiesOf = (doc: unknown) => [...JSON.stringify(doc).matchAll(/"study"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  const wanted = EXAMPLES.filter((e) => (process.env.SCHEMA_MODES_ONLY || "").split(",").includes(e.title) ||
    (!process.env.SCHEMA_MODES_ONLY && studiesOf(e.doc).length > 0 && studiesOf(e.doc).every((s) => have.has(s))));
  const runs = await runExamples(wanted);
  process.stdout.write(JSON.stringify(runs.map((r) => ({ title: r.ex.title, error: r.error ?? null, result: strip(r.result ?? null) }))));
  process.exit(0);
}

const [a, b] = process.argv.slice(2).map((d) => d.replace(/[^A-Za-z0-9_]/g, ""));
if (!a || !b) { console.error("usage: node scripts/check-schema-modes.ts <database> <database>"); process.exit(2); }
const file = path.join(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"), "local.env");
const env = Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const self = fileURLToPath(import.meta.url);
type Run = { title: string; error: string | null; result: unknown };
const run = (db: string, only = ""): Run[] => JSON.parse(execFileSync(process.execPath, [self], {
  env: { ...process.env, ...env, CLICKHOUSE_DB: db, SCHEMA_MODES_CHILD: "1", SCHEMA_MODES_ONLY: only, RESULT_CACHE: "off" },
  maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "inherit"]
}).toString()) as Run[];

const left = run(a);
const right = new Map(run(b, left.map((r) => r.title).join(",")).map((r) => [r.title, r]));
let differ = 0;
for (const l of left) {
  const r = right.get(l.title);
  const d = !r ? "not run on " + b : l.error || r.error ? (l.error === r.error ? null : `error: ${l.error} | ${r.error}`) : firstDifference(l.result, r.result);
  if (d) differ++;
  console.log((d ? "DIFFERS  " : "same     ") + l.title + (d ? "\n         " + d : "") + (l.error && !d ? "  (both: " + l.error.slice(0, 120) + ")" : ""));
}
console.log(`\n${left.length} examples, ${differ} differ`);
process.exit(differ ? 1 : 0);
