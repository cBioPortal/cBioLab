/**
 * Live check: the Cancer Types Summary follows the query's OQL (lib/views/cancertypes/sql.ts
 * cancerTypesSql with its `oql` argument), as SQL run against the committed fixture study on
 * connection b. Rows are the case table's (C*, PR 5 of the OQL series); the legacy rule is
 * cbioportal-frontend cd8c6df src/shared/lib/alterationCountHelpers.ts (countSampleAlterationOccurences,
 * countPatientAlterationOccurences): a unit's alterations are those its genes' lines want; they are made
 * unique BY ALTERATION TYPE (mutation, copy number, mRNA, protein, structural variant); one type is
 * that kind (copy number by its subtype), more than one is "multiple"; a patient carries the union
 * of their samples'.
 *
 * Every expected count is written down by hand from test/fixtures/peer-study/*.txt:
 * data_clinical_sample.txt (59 samples of 53 patients; CANCER_TYPE "Non-Small Cell Lung Cancer"
 * for 55 samples / 49 patients, "Lung Cancer" for FX-P42 and FX-P48, none for FX-P41 and FX-P47;
 * FX-P01…FX-P04, FX-P43, FX-P49 have two samples each), data_mutations.txt, data_cna.txt (±2 only),
 * data_sv.txt and data_gene_panel_matrix.txt (FX-P31…FX-P40 on PEERFIX_NO_EGFR, the rest on
 * PEERFIX_FULL; both list KRAS, TP53, FAT1, STK11, CDKN2A; structural variants on a whole-exome
 * panel, which lists ALK). The DRIVER rows read test/fixtures/peer-oncokb.tsv and
 * peer-hotspots.tsv, as scripts/check-hotspot-drivers.ts does.
 *
 * The fixture has no mRNA or protein profile, so the EXP / PROT rows (C6, C7, C8) run over scratch
 * copies of the fixture's tables on the same connection, with mRNA and protein z-scores added for
 * a few samples (listed at EXPR below) and the structural-variant panel left out, so that EGFR is
 * unprofiled on FX-P31…FX-P40 but for what the expression rows add.
 *
 * Run: node --env-file=.env.local scripts/check-results-oql.ts (connection b must be the fixture:
 * `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, chWrite, connById } from "../lib/ch.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { cancerTypesSql } from "../lib/views/cancertypes/sql.ts";
import type { DriverSettings } from "../lib/driver-settings.ts";

const STUDY = "cbiolab_peer_fixture";
/** peer-db.ts stores the fixture's OncoKB calls and Genome Nexus records under these */
const ONCOKB = "fixture";
const HOTSPOT_PINS = { hg19: "fixture", hg38: null };

// the groups, by their folded key (lib/event-names.ts clinicalValueFoldSql), and the whole cohort
const NSCLC = "non-small cell lung cancer", LC = "lung cancer", NONE = "", ALL = "\x01all";
const KINDS = ["mutation", "amp", "homdel", "sv", "multiple", "mrnaHigh", "mrnaLow", "protHigh", "protLow"] as const;
type Counts = { profiled: number; altered: number } & Partial<Record<(typeof KINDS)[number], number>>;
type Row = Record<string, unknown>;

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }

type Oql = { lines: string[]; profiles?: string[]; drivers?: DriverSettings; hotspotPins?: { hg19: string | null; hg38: string | null } };
/** cancerTypesSql with `oql`, grouped by CANCER_TYPE, over every sample of the study (the cohort a null definition compiles to) */
async function rowsOf(oql: Oql, unit: "sample" | "patient", db = conn!.db, pin: string | null = null): Promise<Row[]> {
  const genes = [...new Set(oql.lines.map((l) => l.split(":")[0].trim().toUpperCase()))];
  const cohort = compileCohortDef(null, { study: STUDY, db });
  try {
    return (await chQuery<Row>(cancerTypesSql(cohort, STUDY, db, genes, "CANCER_TYPE", pin, "any", unit, oql), conn!)).data;
  } catch (e) {
    ok(oql.lines.join("; ") + " (" + unit + "s) runs", false, (e as Error).message.slice(0, 300));
    return [];
  }
}

/** the row of (gene, group) against the counts written down; a kind not written down is 0 */
function expectRow(tag: string, rows: Row[], gene: string, grp: string, want: Counts) {
  const found = rows.filter((r) => String(r.gene) === gene && String(r.grp) === grp);
  const name = tag + " " + gene + " @ " + (grp === ALL ? "whole cohort" : JSON.stringify(grp));
  if (found.length !== 1) { ok(name, false, found.length + " rows"); return; }
  const r = found[0];
  const fields = grp === ALL ? (["profiled", "altered"] as const) : (["profiled", "altered", ...KINDS] as const);
  const bad = fields.filter((k) => Number(r[k] ?? NaN) !== ((want as Record<string, number>)[k] ?? 0));
  ok(name, !bad.length, bad.map((k) => k + " ours " + String(r[k]) + ", expected " + ((want as Record<string, number>)[k] ?? 0)).join("; "));
}
/** the genes the rows name: the lines' genes and "*", each (group, gene) once (C9) */
function expectGenes(tag: string, rows: Row[], genes: string[]) {
  const got = [...new Set(rows.map((r) => String(r.gene)))].sort();
  ok(tag + " rows name only the lines' genes and \"*\"", JSON.stringify(got) === JSON.stringify([...genes, "*"].sort()), JSON.stringify(got));
  const keys = rows.map((r) => r.gene + "|" + r.grp);
  ok(tag + " one row per group and gene", new Set(keys).size === keys.length, keys.length + " rows, " + new Set(keys).size + " distinct");
}

// ---- C1, C2, C5, C9: each gene's lines alone -----------------------------------------------------
// KRAS: MUT=G12D — G12D on FX-P02-T1, FX-P02-T2, FX-P07-T1, FX-P12-T1, FX-P17-T1 (5 samples, 4 patients);
//   the G12C samples (FX-P01-T1/T2, P06, P10, P11, P16) and every other KRAS mutation are not altered, still profiled (C2).
// CDKN2A: HOMDEL — -2 on FX-P05-T1, FX-P16-T1, FX-P29-T1, FX-P38-T1; its R80* / D84Y mutations (P19, P22, P27, P29) are not wanted.
// Together no sample has both (FX-P16 has G12C, not G12D): 9 samples, 8 patients, mutation or deep deletion alone (C5).
// All are NSCLC. Profiled: both panels list both genes, so every unit.
{
  const lines = ["KRAS: MUT=G12D", "CDKN2A: HOMDEL"];
  const s = await rowsOf({ lines }, "sample");
  expectGenes("C9 [KRAS: MUT=G12D, CDKN2A: HOMDEL] samples:", s, ["KRAS", "CDKN2A"]);
  expectRow("C1/C2 samples:", s, "KRAS", NSCLC, { profiled: 55, altered: 5, mutation: 5 });
  expectRow("C1 samples:", s, "CDKN2A", NSCLC, { profiled: 55, altered: 4, homdel: 4 });
  expectRow("C1/C5 samples:", s, "*", NSCLC, { profiled: 55, altered: 9, mutation: 5, homdel: 4 });
  expectRow("C1 samples:", s, "*", LC, { profiled: 2, altered: 0 });
  expectRow("C1 samples:", s, "*", NONE, { profiled: 2, altered: 0 });
  expectRow("C1 samples:", s, "*", ALL, { profiled: 59, altered: 9 });
  const p = await rowsOf({ lines }, "patient");
  expectRow("C10 patients:", p, "KRAS", NSCLC, { profiled: 49, altered: 4, mutation: 4 });
  expectRow("C10 patients:", p, "CDKN2A", NSCLC, { profiled: 49, altered: 4, homdel: 4 });
  expectRow("C10 patients:", p, "*", NSCLC, { profiled: 49, altered: 8, mutation: 4, homdel: 4 });
  expectRow("C10 patients:", p, "*", ALL, { profiled: 53, altered: 8 });
}

// ---- C3, C4, C10: kinds across lines, and a patient's union --------------------------------------
// FAT1: AMP HOMDEL — 2 on FX-P02-T1, -2 on FX-P02-T2 and FX-P34-T1; FAT1's R1627* mutations are not wanted.
// With KRAS: MUT=G12D, by sample: P02-T1 G12D + FAT1 amp = mutation and copy number: multiple (C3); P02-T2 G12D + FAT1 homdel:
//   multiple; P07, P12, P17 mutation; P34 homdel.
// By patient: FX-P02's samples together are G12D, amp and homdel: two types, multiple. FAT1 alone, FX-P02 is amp and homdel,
//   one type (copy number): counted once, as amp (C4: ours amp before homdel; the portal keeps the first it meets, T1's amp).
{
  const lines = ["KRAS: MUT=G12D", "FAT1: AMP HOMDEL"];
  const s = await rowsOf({ lines }, "sample");
  expectRow("C5 samples:", s, "FAT1", NSCLC, { profiled: 55, altered: 3, amp: 1, homdel: 2 });
  expectRow("C3 samples:", s, "*", NSCLC, { profiled: 55, altered: 6, mutation: 3, homdel: 1, multiple: 2 });
  expectRow("C3 samples:", s, "*", ALL, { profiled: 59, altered: 6 });
  const p = await rowsOf({ lines }, "patient");
  expectRow("C4/C10 patients:", p, "FAT1", NSCLC, { profiled: 49, altered: 2, amp: 1, homdel: 1 });
  expectRow("C3/C10 patients:", p, "*", NSCLC, { profiled: 49, altered: 5, mutation: 3, homdel: 1, multiple: 1 });
  expectRow("C10 patients:", p, "*", ALL, { profiled: 53, altered: 5 });
}

// ---- C9: two lines of one gene count together under it -------------------------------------------
// FAT1: AMP; FAT1: HOMDEL — the same events as above: samples P02-T1 amp, P02-T2 and P34 homdel; patients P02 (amp, C4), P34.
// KRAS: MUT=G12D; KRAS: MUT=G12C — G12D's 5 samples / 4 patients and G12C's 6 samples (P01-T1, P01-T2, P06, P10, P11, P16) / 5 patients.
{
  const fat1 = ["FAT1: AMP", "FAT1: HOMDEL"];
  const s = await rowsOf({ lines: fat1 }, "sample");
  expectGenes("C9 [FAT1: AMP, FAT1: HOMDEL] samples:", s, ["FAT1"]);
  expectRow("C9 samples:", s, "FAT1", NSCLC, { profiled: 55, altered: 3, amp: 1, homdel: 2 });
  expectRow("C9 samples:", s, "*", NSCLC, { profiled: 55, altered: 3, amp: 1, homdel: 2 });
  const p = await rowsOf({ lines: fat1 }, "patient");
  expectRow("C4/C9 patients:", p, "FAT1", NSCLC, { profiled: 49, altered: 2, amp: 1, homdel: 1 });
  expectRow("C4/C9 patients:", p, "*", NSCLC, { profiled: 49, altered: 2, amp: 1, homdel: 1 });
  const kras = ["KRAS: MUT=G12D", "KRAS: MUT=G12C"];
  const ks = await rowsOf({ lines: kras }, "sample");
  expectGenes("C9 [KRAS: MUT=G12D, KRAS: MUT=G12C] samples:", ks, ["KRAS"]);
  expectRow("C9 samples:", ks, "KRAS", NSCLC, { profiled: 55, altered: 11, mutation: 11 });
  const kp = await rowsOf({ lines: kras }, "patient");
  expectRow("C9 patients:", kp, "KRAS", NSCLC, { profiled: 49, altered: 9, mutation: 9 });
}

// ---- C5: structural variant only, in every group -------------------------------------------------
// ALK: FUSION — EML4-ALK on FX-P45-T1, P46-T1, P49-T1, P49-T2 (NSCLC), P48-T1 (Lung Cancer), P47-T1 (no value).
// ALK is on the structural-variant panel only, which every sample has.
{
  const s = await rowsOf({ lines: ["ALK: FUSION"] }, "sample");
  expectRow("C5 samples:", s, "ALK", NSCLC, { profiled: 55, altered: 4, sv: 4 });
  expectRow("C5 samples:", s, "ALK", LC, { profiled: 2, altered: 1, sv: 1 });
  expectRow("C5 samples:", s, "ALK", NONE, { profiled: 2, altered: 1, sv: 1 });
  expectRow("C5 samples:", s, "*", ALL, { profiled: 59, altered: 6 });
  const p = await rowsOf({ lines: ["ALK: FUSION"] }, "patient");
  expectRow("C5/C10 patients:", p, "ALK", NSCLC, { profiled: 49, altered: 3, sv: 3 });
  expectRow("C5/C10 patients:", p, "*", ALL, { profiled: 53, altered: 5 });
}

// ---- C13: DRIVER in a line follows the view's driver settings ------------------------------------
// STK11: MUT_DRIVER. OncoKB (peer-oncokb.tsv): Q37* Likely Oncogenic — FX-P10, P12, P16, P18, P27, P31, P37, P39 (8 samples);
// F354L Likely Neutral; SP8 and the X200_splice rows not listed. Cancer Hotspots (peer-hotspots.tsv): only FX-P29-T1's
// X200_splice (Splice_Site, Splice_Region) and F354L — 1 sample. No custom calls or tiers in the fixture. All NSCLC.
{
  const lines = ["STK11: MUT_DRIVER"];
  const cases: [string, Oql, number][] = [
    ["no settings: OncoKB at the pin", { lines }, 8],
    ["OncoKB only", { lines, drivers: { hotspots: false } }, 8],
    ["hotspots only", { lines, drivers: { oncokb: false }, hotspotPins: HOTSPOT_PINS }, 1],
    ["OncoKB and hotspots", { lines, drivers: {}, hotspotPins: HOTSPOT_PINS }, 9],
  ];
  for (const [tag, oql, n] of cases)
    expectRow("C13 " + tag + ", samples:", await rowsOf(oql, "sample", conn.db, ONCOKB), "STK11", NSCLC, { profiled: 55, altered: n, mutation: n });
}

// ---- C6, C7, C8: mRNA and protein, over scratch copies with z-scores added ----------------------
const EXP_PROFILE = "rna_seq_v2_mrna_median_Zscores", PROT_PROFILE = "rppa_Zscores";
/** [sample, gene, profile, value] */
const EXPR: [string, string, string, string][] = [
  ["FX-P07-T1", "KRAS", EXP_PROFILE, "2.5"],   // and G12D: multiple (C7)
  ["FX-P21-T1", "KRAS", EXP_PROFILE, "3"],     // mRNA high alone (C6)
  ["FX-P26-T1", "KRAS", EXP_PROFILE, "2"],     // >= 2 at 2: high; P26's EGFR amplification is not wanted by "EGFR: EXP>=2"
  ["FX-P22-T1", "KRAS", EXP_PROFILE, "-2.5"],  // mRNA low
  ["FX-P23-T1", "KRAS", EXP_PROFILE, "1"],     // neither
  ["FX-P01-T1", "KRAS", EXP_PROFILE, "NA"],    // no value
  ["FX-P31-T1", "EGFR", EXP_PROFILE, "2.1"],   // high; P31 is on PEERFIX_NO_EGFR: profiled for EGFR by this value (C8)
  ["FX-P32-T1", "EGFR", EXP_PROFILE, "0.5"],   // likewise profiled, not altered (C8)
  ["FX-P24-T1", "KRAS", PROT_PROFILE, "2.2"],  // protein high
  ["FX-P25-T1", "KRAS", PROT_PROFILE, "-3"],   // protein low
  ["FX-P02-T1", "KRAS", PROT_PROFILE, "-2.5"], // protein low with G12D: multiple; P02-T2 has G12D alone
];
const scratch = "cbiolab_check_results_oql";
const write = (sql: string) => chWrite(sql, conn);
await write("CREATE DATABASE IF NOT EXISTS " + scratch);
const COPY: [string, string][] = [
  ["sample_derived", "cancer_study_identifier = '" + STUDY + "'"],
  ["clinical_data_derived", "cancer_study_identifier = '" + STUDY + "'"],
  ["genomic_event_derived", "cancer_study_identifier = '" + STUDY + "'"],
  ["genetic_alteration_derived", "cancer_study_identifier = '" + STUDY + "'"],
  ["mutation_derived", "studyId = '" + STUDY + "'"],
  // mutation and copy-number panels only: EGFR is then not profiled on FX-P31…FX-P40
  ["sample_to_gene_panel_derived", "cancer_study_identifier = '" + STUDY + "' AND alteration_type != 'STRUCTURAL_VARIANT'"],
  ["gene_panel_to_gene_derived", "gene_panel_id IN ('PEERFIX_FULL', 'PEERFIX_NO_EGFR')"],
];
for (const [t, where] of COPY) {
  await write("CREATE OR REPLACE TABLE " + scratch + "." + t + " AS " + conn.db + "." + t);
  await write("INSERT INTO " + scratch + "." + t + " SELECT * FROM " + conn.db + "." + t + " WHERE " + where);
}
for (const [sid, gene, prof, v] of EXPR)
  await write("INSERT INTO " + scratch + ".genetic_alteration_derived (sample_unique_id, cancer_study_identifier, hugo_gene_symbol, profile_type, alteration_value) VALUES ('" +
    STUDY + "_" + sid + "', '" + STUDY + "', '" + gene + "', '" + prof + "', '" + v + "')");
// KRAS: MUT=G12D EXP>=2 EXP<=-2 PROT>=2 PROT<=-2; EGFR: EXP>=2.
// KRAS samples: P02-T1 (G12D + protein low) and P07 (G12D + mRNA high) multiple; P02-T2, P12, P17 mutation; P21, P26 mRNA high;
//   P22 mRNA low; P24 protein high; P25 protein low — 10 of 55. Patients: FX-P02 multiple (its samples' union), the rest as their sample — 9 of 49.
// EGFR: P31 mRNA high. Profiled: 45 NSCLC samples on PEERFIX_FULL + P31, P32 = 47; patients 39 + 2 = 41. Lung Cancer and no value: 2 each, on PEERFIX_FULL.
// Together: 11 samples (KRAS's 10 + P31), 10 patients.
{
  const oql: Oql = { lines: ["KRAS: MUT=G12D EXP>=2 EXP<=-2 PROT>=2 PROT<=-2", "EGFR: EXP>=2"], profiles: ["mutations", "cna", "structural_variants", EXP_PROFILE, PROT_PROFILE] };
  const s = await rowsOf(oql, "sample", scratch);
  expectRow("C6/C7 samples:", s, "KRAS", NSCLC, { profiled: 55, altered: 10, mutation: 3, multiple: 2, mrnaHigh: 2, mrnaLow: 1, protHigh: 1, protLow: 1 });
  expectRow("C6/C8 samples:", s, "EGFR", NSCLC, { profiled: 47, altered: 1, mrnaHigh: 1 });
  expectRow("C8 samples:", s, "EGFR", LC, { profiled: 2, altered: 0 });
  expectRow("C6/C7 samples:", s, "*", NSCLC, { profiled: 55, altered: 11, mutation: 3, multiple: 2, mrnaHigh: 3, mrnaLow: 1, protHigh: 1, protLow: 1 });
  expectRow("C6 samples:", s, "*", ALL, { profiled: 59, altered: 11 });
  const p = await rowsOf(oql, "patient", scratch);
  expectRow("C6/C7/C10 patients:", p, "KRAS", NSCLC, { profiled: 49, altered: 9, mutation: 2, multiple: 2, mrnaHigh: 2, mrnaLow: 1, protHigh: 1, protLow: 1 });
  expectRow("C8/C10 patients:", p, "EGFR", NSCLC, { profiled: 41, altered: 1, mrnaHigh: 1 });
  expectRow("C6/C10 patients:", p, "*", NSCLC, { profiled: 49, altered: 10, mutation: 2, multiple: 2, mrnaHigh: 3, mrnaLow: 1, protHigh: 1, protLow: 1 });
  expectRow("C6/C10 patients:", p, "*", ALL, { profiled: 53, altered: 10 });
}
await write("DROP DATABASE IF EXISTS " + scratch);

console.log(`\n${checks - failures}/${checks} results OQL checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
