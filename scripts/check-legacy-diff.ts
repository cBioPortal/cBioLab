// Compares a study as cBioLab's importer stored it with the same study loaded by cBioPortal's own
// importer (cbioportal-core) from the same files, row by row, on every table the app reads. The
// legacy database is the reference: a row on one side only is an importer difference, never
// source drift, because both sides read identical files.
//
//   LEGACY_CLICKHOUSE=127.0.0.1:18301 LEGACY_CLICKHOUSE_PASSWORD=… \
//     node scripts/check-legacy-diff.ts [--prefix labv_] [--database cbioportal] [--rows 5] acc_tcga [more studies]
//
// The local database comes from ~/.cbiolab/local.env (`npm run local`), and reads the legacy one
// through ClickHouse's remote() over its native port, so only differing rows leave the server.
// --prefix compares the legacy tables with local tables or views of that prefix (labv_sample_derived
// against sample_derived, say); --database names another local database than local.env's. docs/LOCAL.md describes running the legacy importer.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chQuery, type ChConn } from "../lib/ch.ts";

function localConn(): ChConn {
  const file = path.join(process.env.CBIOLAB_DATA || path.join(os.homedir(), ".cbiolab"), "local.env");
  const env = Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  return { id: "local", url: env.CLICKHOUSE_URL, user: env.CLICKHOUSE_USER, password: env.CLICKHOUSE_PASSWORD, db: env.CLICKHOUSE_DB, label: "local" };
}

// allocated integer ids: two imports number rows differently by construction
const IDS = new Set(["internal_id", "patient_internal_id", "sampleInternalId", "clinical_event_id", "patient_id", "genetic_entity_id"]);

/** Each compared table and the condition that selects one study's rows in it. */
const TABLES: Record<string, string> = {
  sample_derived: "cancer_study_identifier = {s}",
  clinical_data_derived: "cancer_study_identifier = {s}",
  genomic_event_derived: "cancer_study_identifier = {s}",
  mutation_derived: "studyId = {s}",
  sample_to_gene_panel_derived: "cancer_study_identifier = {s}",
  genetic_alteration_derived: "cancer_study_identifier = {s}",
  generic_assay_data_derived: "startsWith(profile_stable_id, concat({s}, '_'))",
  clinical_event_derived: "cancer_study_identifier = {s}",
  clinical_event_data_derived: "cancer_study_identifier = {s}"
};

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const prefix = opt("--prefix", "").replace(/[^A-Za-z0-9_]/g, "");
const show = Number(opt("--rows", "3"));
const database = opt("--database", "").replace(/[^A-Za-z0-9_]/g, "");
const studies = args.filter((a) => /^[A-Za-z0-9_.-]+$/.test(a));
const legacyHost = (process.env.LEGACY_CLICKHOUSE || "127.0.0.1:18301").replace(/[^A-Za-z0-9_.:-]/g, "");
const legacyPassword = process.env.LEGACY_CLICKHOUSE_PASSWORD;
if (!studies.length || legacyPassword === undefined) {
  console.error("usage: LEGACY_CLICKHOUSE=host:port LEGACY_CLICKHOUSE_PASSWORD=… node scripts/check-legacy-diff.ts [--prefix lab_] [--rows N] <study>…");
  process.exit(2);
}
const lit = (s: string) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const legacy = (dbTable: string) => `remote(${lit(legacyHost)}, ${dbTable}, 'default', ${lit(legacyPassword)})`;

const conn = { ...localConn(), ...(database ? { db: database } : {}) };
let differing = 0;
for (const study of studies) {
  console.log("== " + study);
  for (const [table, cond] of Object.entries(TABLES)) {
    const cols = (await chQuery<{ name: string }>(
      `SELECT name FROM ${legacy("system.columns")} WHERE database = 'cbioportal' AND table = ${lit(table)} ORDER BY position`, conn))
      .data.map((r) => r.name).filter((c) => !IDS.has(c));
    const sel = cols.map((c) => "toString(`" + c + "`) AS `" + c + "`").join(", ");
    const where = cond.replaceAll("{s}", lit(study));
    const a = `SELECT ${sel} FROM ${legacy("cbioportal." + table)} WHERE ${where}`;
    const b = `SELECT ${sel} FROM ${conn.db}.${prefix}${table} WHERE ${where}`;
    const n = (await chQuery<{ l: string; c: string; ol: string; oc: string }>(
      `SELECT (SELECT count() FROM (${a})) AS l, (SELECT count() FROM (${b})) AS c, ` +
      `(SELECT count() FROM (${a} EXCEPT ALL ${b})) AS ol, (SELECT count() FROM (${b} EXCEPT ALL ${a})) AS oc`, conn)).data[0];
    const differs = Number(n.ol) > 0 || Number(n.oc) > 0;
    if (differs) differing++;
    console.log(`${(prefix + table).padEnd(36)} legacy ${String(n.l).padStart(9)}  cbiolab ${String(n.c).padStart(9)}  ` +
      `only-legacy ${String(n.ol).padStart(7)}  only-cbiolab ${String(n.oc).padStart(7)}  ${differs ? "DIFFERS" : "identical"}`);
    if (show > 0 && differs) {
      for (const [side, q] of [["legacy", `${a} EXCEPT ALL ${b}`], ["cbiolab", `${b} EXCEPT ALL ${a}`]] as const) {
        const rows = (await chQuery<Record<string, string>>(`SELECT * FROM (${q}) LIMIT ${show}`, conn)).data;
        for (const r of rows) console.log("    " + side.padEnd(8) + cols.map((c) => c + "=" + r[c]).join(" "));
      }
    }
  }
}
process.exit(differing ? 1 : 0);
