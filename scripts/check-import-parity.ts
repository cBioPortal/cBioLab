// Compares a study as `npm run local` imported it with the same study in the public warehouse,
// table by table, on the derived tables every view reads. A difference is either an importer bug,
// a legacy behaviour deliberately not copied, or the study's files having changed on datahub since
// the warehouse loaded them (the same mutation re-annotated, say) — the output says which numbers
// differ, not which of these it is.
//
//   node --env-file=.env.local scripts/check-import-parity.ts acc_tcga [more studies]
//
// The public warehouse comes from CLICKHOUSE_* (.env.local); the local database from
// ~/.cbiolab/local.env, which `npm run local` writes.
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

const publicConn: ChConn = {
  id: "a", url: process.env.CLICKHOUSE_URL || "", user: process.env.CLICKHOUSE_USER || "", password: process.env.CLICKHOUSE_PASSWORD || "",
  db: (process.env.CLICKHOUSE_DB || "").replace(/[^A-Za-z0-9_]/g, ""), label: "public"
};

/** name → statement returning rows of (k, n) for one study, in database `db` */
const CHECKS = (db: string, s: string): string[] => {
  const q = "'" + s.replace(/[^A-Za-z0-9_.-]/g, "") + "'";
  return [
    `SELECT 'samples' k, count() n FROM ${db}.sample_derived WHERE cancer_study_identifier = ${q}`,
    `SELECT 'samples sequenced' k, sum(sequenced) n FROM ${db}.sample_derived WHERE cancer_study_identifier = ${q}`,
    `SELECT 'samples with segments' k, sum(copy_number_segment_present) n FROM ${db}.sample_derived WHERE cancer_study_identifier = ${q}`,
    `SELECT concat('clinical rows, ', type) k, count() n FROM ${db}.clinical_data_derived WHERE cancer_study_identifier = ${q} GROUP BY type`,
    `SELECT concat('clinical values, ', type) k, countIf(attribute_value != '') n FROM ${db}.clinical_data_derived WHERE cancer_study_identifier = ${q} GROUP BY type`,
    `SELECT concat('events, ', variant_type) k, count() n FROM ${db}.genomic_event_derived WHERE cancer_study_identifier = ${q} GROUP BY variant_type`,
    `SELECT concat('off-panel events, ', variant_type) k, countIf(off_panel) n FROM ${db}.genomic_event_derived WHERE cancer_study_identifier = ${q} GROUP BY variant_type`,
    `SELECT concat('CNA events ', toString(cna_alteration)) k, count() n FROM ${db}.genomic_event_derived WHERE cancer_study_identifier = ${q} AND variant_type = 'cna' GROUP BY cna_alteration`,
    `SELECT concat('profile values, ', profile_type) k, count() n FROM ${db}.genetic_alteration_derived WHERE cancer_study_identifier = ${q} GROUP BY profile_type`,
    `SELECT concat('profiled, ', alteration_type, ' ', gene_panel_id) k, count() n FROM ${db}.sample_to_gene_panel_derived WHERE cancer_study_identifier = ${q} GROUP BY alteration_type, gene_panel_id`,
    `SELECT 'mutations' k, count() n FROM ${db}.mutation_derived WHERE studyId = ${q}`,
    `SELECT 'timeline events' k, count() n FROM ${db}.clinical_event_derived WHERE cancer_study_identifier = ${q}`,
    `SELECT 'timeline values' k, count() n FROM ${db}.clinical_event_data_derived WHERE cancer_study_identifier = ${q}`,
    `SELECT 'sum MUTATION_COUNT' k, sum(toInt64OrZero(attribute_value)) n FROM ${db}.clinical_data_derived WHERE cancer_study_identifier = ${q} AND attribute_name = 'MUTATION_COUNT'`,
    `SELECT 'samples with MUTATION_COUNT' k, countIf(attribute_value != '') n FROM ${db}.clinical_data_derived WHERE cancer_study_identifier = ${q} AND attribute_name = 'MUTATION_COUNT'`,
    `SELECT 'sum FGA x 10^4' k, toInt64(round(sum(toFloat64OrZero(attribute_value)) * 10000)) n FROM ${db}.clinical_data_derived WHERE cancer_study_identifier = ${q} AND attribute_name = 'FRACTION_GENOME_ALTERED'`,
    `SELECT 'clinical attributes' k, count() n FROM ${db}.clinical_attribute_meta m JOIN ${db}.cancer_study c ON c.cancer_study_id = m.cancer_study_id WHERE c.cancer_study_identifier = ${q}`,
    `SELECT concat('case list ', l.stable_id) k, count() n FROM ${db}.sample_list l JOIN ${db}.sample_list_list ll ON ll.list_id = l.list_id JOIN ${db}.cancer_study c ON c.cancer_study_id = l.cancer_study_id WHERE c.cancer_study_identifier = ${q} GROUP BY l.stable_id`
  ];
};

async function counts(conn: ChConn, study: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const sql of CHECKS(conn.db, study)) {
    const r = await chQuery<{ k: string; n: string }>(sql, conn);
    for (const row of r.data) out.set(row.k, String(row.n));
  }
  return out;
}

async function main(): Promise<void> {
  const studies = process.argv.slice(2);
  if (!studies.length) throw new Error("Name a study: node --env-file=.env.local scripts/check-import-parity.ts <study> …");
  const local = localConn();
  let differ = 0;
  for (const s of studies) {
    const [p, l] = await Promise.all([counts(publicConn, s), counts(local, s)]);
    console.log("\n" + s);
    for (const k of [...new Set([...p.keys(), ...l.keys()])].sort()) {
      const same = p.get(k) === l.get(k);
      if (!same) differ++;
      console.log((same ? "  same " : "  DIFF ") + k.padEnd(52) + " public " + (p.get(k) ?? "—").padStart(10) + "   local " + (l.get(k) ?? "—").padStart(10));
    }
  }
  console.log("\n" + differ + " difference" + (differ === 1 ? "" : "s"));
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
