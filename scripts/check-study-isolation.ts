// Finds queries about one study that read other studies' rows, in a database in the new schema
// (lib/importer/lab-schema.ts). Every lab_ table is partitioned by study, so ClickHouse's query
// log says which studies' partitions each query read: a query that names one study and reads
// another's partition scans data that cannot be in its answer, and gets slower with every study
// added, however small its own study is. Typical causes: a view that computes a join key per row
// (the filter on it cannot narrow the read), a subquery over a whole table inside a view.
//
//   node scripts/check-study-isolation.ts --since "2026-11-01 10:00:00" [--db cbioportal_new] [--top 30]
//
// Run the app's queries first (the gallery: scripts/check-schema-modes.ts; pages in a browser),
// then this over the same time window. It needs query_log on (ClickHouse's <query_log> setting).
// Reads CLICKHOUSE_* from ~/.cbiolab/local.env, as scripts/import-study.ts does.
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const dataDir = process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab");
if (!process.env.CLICKHOUSE_URL) { try { process.loadEnvFile(path.join(dataDir, "local.env")); } catch { /* not running */ } }
const { chWrite } = await import("../lib/ch.ts");
const db = opt("--db", process.env.CLICKHOUSE_DB || "cbioportal").replace(/[^A-Za-z0-9_]/g, "");
const since = opt("--since", "").replace(/[^0-9: -]/g, "");
if (!since) throw new Error('--since "YYYY-MM-DD hh:mm:ss" (UTC): the start of the run to check');
const top = Number(opt("--top", "30"));
const conn = { id: "isolation", url: process.env.CLICKHOUSE_URL || "", user: process.env.CLICKHOUSE_USER || "", password: process.env.CLICKHOUSE_PASSWORD || "", db, label: "isolation" };
const rows = async <T,>(sql: string): Promise<T[]> =>
  (await chWrite(sql + "\nFORMAT JSONEachRow", conn, undefined, { output_format_json_quote_64bit_integers: "0" })).split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

await chWrite("SYSTEM FLUSH LOGS", conn);
// partition id -> the study it holds, from every lab_ table's parts
const owner = new Map((await rows<{ id: string; s: string }>(`SELECT DISTINCT partition_id AS id, partition AS s FROM system.parts
  WHERE database = '${db}' AND table LIKE 'lab\\_%'`)).map((r) => [r.id, r.s]));
const studies = [...new Set(owner.values())].sort((a, b) => b.length - a.length);

const log = await rows<{ h: string; q: string; p: string[]; ms: number; r: number }>(`SELECT toString(normalized_query_hash) AS h, query AS q, partitions AS p,
    query_duration_ms AS ms, read_rows AS r
  FROM system.query_log WHERE type = 'QueryFinish' AND event_time >= toDateTime('${since}', 'UTC') AND query_kind = 'Select'
    AND has(databases, '${db}') AND notEmpty(partitions)`);

interface Finding { table: string; others: Set<string>; example: string }
const found = new Map<string, Finding>();
let oneStudy = 0;
for (const e of log) {
  // the studies a query names: a literal that is a study's id, or begins with it and an underscore
  const named = studies.filter((s) => e.q.includes(`'${s}'`) || e.q.includes(`'${s}_`));
  // one study, allowing for ids that begin with another's (acc_tcga, acc_tcga__review)
  const study = named.find((s) => named.every((o) => s.startsWith(o)));
  if (!study) continue;
  oneStudy++;
  for (const p of e.p) {
    const [pdb, table, id] = p.split(".");
    const of = owner.get(id);
    if (pdb !== db || !table.startsWith("lab_") || !of || of === study) continue;
    const key = e.h + "|" + table;
    const f = found.get(key) ?? { table, others: new Set<string>(), example: e.q };
    f.others.add(of);
    found.set(key, f);
  }
}
// how often each query shape ran, and its time
const runs = new Map<string, { n: number; ms: number }>();
for (const e of log) { const r = runs.get(e.h) ?? { n: 0, ms: 0 }; r.n++; r.ms += e.ms; runs.set(e.h, r); }
const list = [...found.entries()].map(([k, f]) => ({ ...f, ...runs.get(k.split("|")[0])! })).sort((a, b) => b.ms - a.ms);

console.log(`${log.length} queries on ${db} since ${since} UTC; ${oneStudy} name one study; ${list.length} (query shape, table) pairs read other studies' partitions\n`);
const byTable = new Map<string, number>();
for (const f of list) byTable.set(f.table, (byTable.get(f.table) ?? 0) + f.n);
console.log("by table (runs of a query that read other studies there): " + [...byTable].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ") + "\n");
for (const f of list.slice(0, top)) {
  const sql = f.example.replace(/\s+/g, " ");
  console.log(`${f.table}: ${f.n} runs, ${(f.ms / 1000).toFixed(1)} s in all; also read ${[...f.others].join(", ")}`);
  console.log("  " + sql.slice(0, 400) + (sql.length > 400 ? " …" : "") + "\n");
}
if (list.length) process.exitCode = 1;
