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
 * The Mutual Exclusivity section (M*, PR 6) runs lib/federation.ts pairCountsSql over the query's
 * tracks the same way: a track with OQL is altered where its line matches, a bare one by any
 * alteration; its counts are written down from the same files, and its EXP / PROT rows (M7) read the
 * scratch copies before they are dropped.
 *
 * The Pathways section (P*, PR 7) runs lib/views/pathwaymap/sql.ts lineCountsSql over the query's
 * lines: one row per gene of the lines that carry OQL, its samples the gene's lines (together) match
 * AND profiled for the gene on a mutation, copy-number or structural-variant panel, as
 * lib/federation.ts geneCountsSql's 'any' row counts profiled (run beside it for that comparison).
 *
 * The Download section (L*, PR 8) runs lib/views/datafiles/sql.ts lineCtes — each sample of the cohort a
 * line alters, the CTE the counts, the lists, the matrix and the case table all read — with the view's
 * driver settings, over every sample of the study.
 *
 * The Mutations section (U*, PR 9) runs lib/oql.ts oqlMutationFilterSql — the condition on a gene's
 * mutation_derived rows that the Mutations tab's lollipop and table keep — ANDed into a SELECT of that
 * gene's rows of the study, and compares the rows kept (sample and protein change) with the rows written
 * down from data_mutations.txt.
 *
 * Run: node --env-file=.env.local scripts/check-results-oql.ts (connection b must be the fixture:
 * `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQuery, chWrite, connById } from "../lib/ch.ts";
import { compileCohortDef } from "../lib/cohort2.ts";
import { cancerTypesSql } from "../lib/views/cancertypes/sql.ts";
import { lineCtes, type StudyOpts } from "../lib/views/datafiles/sql.ts";
import { pairCountsSql, geneCountsSql, lollipopChangesSql } from "../lib/federation.ts";
import { oqlMutationFilterSql } from "../lib/oql.ts";
import { mutationStudySql, sq } from "../lib/compiler.ts";
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

// ==== Mutual Exclusivity: pairCountsSql over the query's tracks (M*, PR 6 of the OQL series) ======
// Legacy: cbioportal-frontend cd8c6df src/pages/resultsView/ResultsViewPageStoreUtils.ts 473-597
// getSampleAlteredMap — per line, a sample is ALTERED where the line's OQL-filtered data holds it,
// UNPROFILED where not profiled for the line's gene, else UNALTERED; 599-619 getSingleGeneResultKey
// names the track. Profiled is ours, as before the change: on a mutation panel covering both genes
// (MEX-STM-1). Every sample of the fixture is on PEERFIX_FULL or PEERFIX_NO_EGFR (FX-P31…FX-P40);
// both list KRAS, TP53, STK11, so 59 samples are profiled for any pair of those; EGFR only the 49
// not on PEERFIX_NO_EGFR. neither = profiled − both − onlyA − onlyB.
//
// The expected counts below are read off the fixture files, sample by sample:
//   TP53 (bare: any mutation, ±2 copy number, structural variant; its copy number is −1 only, no SV):
//     mutated FX-P01-T1, P03-T1, P05, P07, P09, P10, P11, P13, P15, P17, P19, P21, P24, P27, P30, P33, P36 — 17
//   KRAS (bare): mutated P01-T1/T2, P02-T1/T2, P03-T1/T2, P04-T1/T2, P05…P20 — 24 (its copy number is +1 only)
//   KRAS G12D: P02-T1, P02-T2, P07, P12, P17 — 5;  KRAS G12C: P01-T1, P01-T2, P06, P10, P11, P16 — 6
//   EGFR mutated on its panel: P21…P28, P41, P42, P43-T1/T2, P44 — 13 (P33, P35, P37's L858R are on
//     PEERFIX_NO_EGFR: unprofiled); EGFR amplified (2): P23, P26, both also mutated
type PairOql = { oncokbPin?: string | null; profiles?: string[]; pins?: { EXP?: string; PROT?: string; ifHeld?: boolean };
  drivers?: DriverSettings; hotspotPins?: { hg19: string | null; hg38: string | null } };
type Cells = { profiled: number; both: number; onlyA: number; onlyB: number; neither: number };
/** pairCountsSql with `oql`, over every sample of the study, one row per pair by its track names */
async function pairsOf(tag: string, pairs: [string, string][], oql: PairOql | undefined, db = conn!.db): Promise<Row[]> {
  const cohort = compileCohortDef(null, { study: STUDY, db });
  try {
    return (await chQuery<Row>(pairCountsSql(cohort, pairs, STUDY, db, oql as never), conn!)).data;
  } catch (e) {
    ok(tag + " runs", false, (e as Error).message.slice(0, 300));
    return [];
  }
}
function expectPair(tag: string, rows: Row[], a: string, b: string, want: Cells) {
  const found = rows.filter((r) => String(r.ga) === a && String(r.gb) === b);
  const name = tag + " " + a + " / " + b;
  if (found.length !== 1) { ok(name, false, found.length + " rows; got pairs " + JSON.stringify(rows.map((r) => [r.ga, r.gb]))); return; }
  const r = found[0];
  const got: Cells = { profiled: Number(r.profiled), both: Number(r.both), onlyA: Number(r.only_a), onlyB: Number(r.only_b),
    neither: Number(r.profiled) - Number(r.both) - Number(r.only_a) - Number(r.only_b) };
  const bad = (Object.keys(want) as (keyof Cells)[]).filter((k) => got[k] !== want[k]);
  ok(name, !bad.length, bad.map((k) => k + " ours " + got[k] + ", expected " + want[k]).join("; "));
}

// ---- M1, M2, M3: tracks with OQL, bare tracks, and two tracks of one gene, in one query ----------
// KRAS: MUT=G12D / TP53 (M1): both P07, P17 = 2; only G12D P02-T1, P02-T2, P12 = 3; only TP53 17 − 2 = 15; neither 59 − 20 = 39.
// KRAS / TP53 (M2, bare: as before the change): both P01-T1, P03-T1, P05, P07, P09, P10, P11, P13, P15, P17, P19 = 11;
//   only KRAS 24 − 11 = 13; only TP53 P21, P24, P27, P30, P33, P36 = 6; neither 59 − 30 = 29.
// KRAS / KRAS: MUT=G12D (M2/M3, a bare and an OQL track of one gene): both 5; only KRAS 19; only G12D 0; neither 35.
// KRAS: MUT=G12D / KRAS: MUT=G12C (M3): both 0; 5; 6; neither 48.
{
  const pairs: [string, string][] = [["KRAS: MUT=G12D", "TP53"], ["KRAS", "TP53"], ["KRAS", "KRAS: MUT=G12D"], ["KRAS: MUT=G12D", "KRAS: MUT=G12C"]];
  const rows = await pairsOf("M1/M2/M3", pairs, {});
  ok("M1 one row per pair, named by its tracks", rows.length === pairs.length && pairs.every(([a, b]) => rows.some((r) => r.ga === a && r.gb === b)),
    JSON.stringify(rows.map((r) => [r.ga, r.gb])));
  expectPair("M1:", rows, "KRAS: MUT=G12D", "TP53", { profiled: 59, both: 2, onlyA: 3, onlyB: 15, neither: 39 });
  expectPair("M2:", rows, "KRAS", "TP53", { profiled: 59, both: 11, onlyA: 13, onlyB: 6, neither: 29 });
  expectPair("M2/M3:", rows, "KRAS", "KRAS: MUT=G12D", { profiled: 59, both: 5, onlyA: 19, onlyB: 0, neither: 35 });
  expectPair("M3:", rows, "KRAS: MUT=G12D", "KRAS: MUT=G12C", { profiled: 59, both: 0, onlyA: 5, onlyB: 6, neither: 48 });
  // a bare pair counts as it did before the change, without `oql`
  expectPair("M2 (no oql argument):", await pairsOf("M2 (no oql)", [["KRAS", "TP53"]], undefined), "KRAS", "TP53",
    { profiled: 59, both: 11, onlyA: 13, onlyB: 6, neither: 29 });
}

// ---- M3, M5: two tracks of EGFR, and profiled by the line's gene ---------------------------------
// EGFR: AMP / EGFR: MUT (M3): profiled 49 (EGFR's panel); both P23, P26 = 2; only AMP 0; only MUT 11; neither 36.
// EGFR: MUT / TP53 (M5): profiled 49; TP53 among them 17 − P33, P36 = 15; both P21, P24, P27 = 3; only EGFR 10;
//   only TP53 12; neither 24. FX-P33 (L858R and R248Q) is not in it: its panel omits EGFR, so it is unprofiled, not "both".
// EGFR: AMP / KRAS: MUT=G12D (M5): profiled 49 (G12D's samples all on PEERFIX_FULL); both 0; 2; 5; neither 42.
{
  const rows = await pairsOf("M3/M5", [["EGFR: AMP", "EGFR: MUT"], ["EGFR: MUT", "TP53"], ["EGFR: AMP", "KRAS: MUT=G12D"]], {});
  expectPair("M3:", rows, "EGFR: AMP", "EGFR: MUT", { profiled: 49, both: 2, onlyA: 0, onlyB: 11, neither: 36 });
  expectPair("M5:", rows, "EGFR: MUT", "TP53", { profiled: 49, both: 3, onlyA: 10, onlyB: 12, neither: 24 });
  expectPair("M5:", rows, "EGFR: AMP", "KRAS: MUT=G12D", { profiled: 49, both: 0, onlyA: 2, onlyB: 5, neither: 42 });
}

// ---- M6: DRIVER in a track follows the driver settings -------------------------------------------
// STK11: MUT_DRIVER — OncoKB Q37*: P10, P12, P16, P18, P27, P31, P37, P39 (8); Cancer Hotspots: P29's X200_splice (1).
// With KRAS: MUT=G12C (6), all 59 profiled:
//   OncoKB (no settings, or hotspots off): both P10, P16 = 2; only STK11 6; only G12C 4; neither 47.
//   hotspots only: both 0; 1; 6; neither 52.     OncoKB and hotspots: both 2; 7; 4; neither 46.
{
  const pair: [string, string][] = [["STK11: MUT_DRIVER", "KRAS: MUT=G12C"]];
  const cases: [string, PairOql, Cells][] = [
    ["no settings: OncoKB at the pin", { oncokbPin: ONCOKB }, { profiled: 59, both: 2, onlyA: 6, onlyB: 4, neither: 47 }],
    ["OncoKB only", { oncokbPin: ONCOKB, drivers: { hotspots: false } }, { profiled: 59, both: 2, onlyA: 6, onlyB: 4, neither: 47 }],
    ["hotspots only", { oncokbPin: ONCOKB, drivers: { oncokb: false }, hotspotPins: HOTSPOT_PINS }, { profiled: 59, both: 0, onlyA: 1, onlyB: 6, neither: 52 }],
    ["OncoKB and hotspots", { oncokbPin: ONCOKB, drivers: {}, hotspotPins: HOTSPOT_PINS }, { profiled: 59, both: 2, onlyA: 7, onlyB: 4, neither: 46 }],
  ];
  for (const [tag, oql, want] of cases) expectPair("M6 " + tag + ":", await pairsOf("M6 " + tag, pair, oql), pair[0][0], pair[0][1], want);
}

// ---- M7: EXP / PROT tracks, over the scratch copies above (EXPR) ---------------------------------
// KRAS: EXP>=2 — P07 (2.5), P21 (3), P26 (2); TP53 holds P07, P21: both 2; only EXP 1; only TP53 15; neither 41 (59 profiled:
//   the mutation panels are kept in the copies).
// KRAS: PROT<=-2 — P25 (−3), P02-T1 (−2.5), neither in TP53: both 0; 2; 17; neither 40.
// KRAS: MUT=G12D EXP>=2 (one line, either) — P02-T1, P02-T2, P07, P12, P17, P21, P26 = 7; with TP53 P07, P17, P21:
//   both 3; 4; 14; neither 38.
{
  const oql: PairOql = { profiles: ["mutations", "cna", "structural_variants", EXP_PROFILE, PROT_PROFILE] };
  const rows = await pairsOf("M7", [["KRAS: EXP>=2", "TP53"], ["KRAS: PROT<=-2", "TP53"], ["KRAS: MUT=G12D EXP>=2", "TP53"]], oql, scratch);
  expectPair("M7:", rows, "KRAS: EXP>=2", "TP53", { profiled: 59, both: 2, onlyA: 1, onlyB: 15, neither: 41 });
  expectPair("M7:", rows, "KRAS: PROT<=-2", "TP53", { profiled: 59, both: 0, onlyA: 2, onlyB: 17, neither: 40 });
  expectPair("M7:", rows, "KRAS: MUT=G12D EXP>=2", "TP53", { profiled: 59, both: 3, onlyA: 4, onlyB: 14, neither: 38 });
  // the profile pinned by name reads the same values
  const pinned = await pairsOf("M7 pinned", [["KRAS: EXP>=2", "TP53"]], { ...oql, pins: { EXP: EXP_PROFILE } }, scratch);
  expectPair("M7 (EXP pinned):", pinned, "KRAS: EXP>=2", "TP53", { profiled: 59, both: 2, onlyA: 1, onlyB: 15, neither: 41 });
}

// ==== Pathways: lineCountsSql over the query's lines (P*, PR 7 of the OQL series) ================
// Legacy: cbioportal-frontend cd8c6df src/pages/resultsView/pathwayMapper/ResultsViewPathwayMapper.tsx
// 113-137 (per query line, getAlterationData over the line's OQL-filtered data) and
// src/shared/components/oncoprint/OncoprintUtils.ts 928-958 (altered AND sequenced for the gene, over
// those sequenced for it in any selected profile); 139-172 the other pathway genes, any alteration
// (geneCountsSql, unchanged). Ours counts samples, as the view does today.
// Profiled, on connection b: every sample's structural-variant panel is WES, which lists every gene
// here, so all 59 samples are profiled for KRAS, TP53, EGFR, FAT1, STK11 (geneCountsSql: 59 each).
// In the scratch copies (no structural-variant panel), EGFR is profiled on PEERFIX_FULL only: 49.
// The per-gene sample sets are the ones written down above (C*, M*), and:
//   EGFR mutated: P21…P28 (8), P33, P35, P37 (L858R, called off their PEERFIX_NO_EGFR mutation panel,
//     genomic_event_derived.off_panel; profiled for EGFR by WES), P41, P42, P43-T1, P43-T2, P44 (5) — 16.
//   geneCountsSql's EGFR altered is 13: its ALTERED_COND leaves out off-panel calls.
type LineOql = { oncokbPin?: string | null; profiles?: string[]; pins?: { EXP?: string; PROT?: string; ifHeld?: boolean };
  drivers?: DriverSettings; hotspotPins?: { hg19: string | null; hg38: string | null } };
let lineCountsSql: ((c: string, study: string, db: string, lines: string[], oql: LineOql) => string) | null = null, lineCountsMissing = "";
try { lineCountsSql = (await import("../lib/views/pathwaymap/sql.ts" as string)).lineCountsSql as never; if (typeof lineCountsSql !== "function") throw new Error("no export lineCountsSql"); }
catch (e) { lineCountsSql = null; lineCountsMissing = (e as Error).message.slice(0, 200); }
/** lineCountsSql over every sample of the study */
async function linesOf(tag: string, lines: string[], oql: LineOql, db = conn!.db): Promise<Row[]> {
  if (!lineCountsSql) { ok(tag + " runs", false, "lineCountsSql: " + lineCountsMissing); return []; }
  const cohort = compileCohortDef(null, { study: STUDY, db });
  try {
    return (await chQuery<Row>(lineCountsSql(cohort, STUDY, db, lines, oql), conn!)).data;
  } catch (e) {
    ok(tag + " runs", false, (e as Error).message.slice(0, 300));
    return [];
  }
}
/** geneCountsSql's 'any' row per gene: profiled and altered as the view counts every other gene */
async function geneAnyOf(genes: string[], db = conn!.db): Promise<Map<string, { profiled: number; altered: number }>> {
  const cohort = compileCohortDef(null, { study: STUDY, db });
  const rows = (await chQuery<Row>(geneCountsSql(cohort, genes, STUDY, null, db), conn!)).data;
  return new Map(rows.filter((r) => r.vtype === "any").map((r) => [String(r.gene), { profiled: Number(r.profiled), altered: Number(r.altered) }]));
}
/** the gene's one row against the count written down, and within the samples profiled for it; no row reads as 0 only where 0 is expected */
function expectLine(tag: string, rows: Row[], gene: string, want: number, any?: Map<string, { profiled: number; altered: number }>) {
  const found = rows.filter((r) => String(r.gene) === gene);
  const name = tag + " " + gene;
  if (found.length > 1) { ok(name, false, found.length + " rows"); return; }
  const got = found.length ? Number(found[0].altered) : 0;
  ok(name + " altered " + want, got === want && (found.length === 1 || want === 0), found.length ? "ours " + got : "no row");
  const p = any?.get(gene);
  if (p && found.length) ok(name + " altered within geneCountsSql's profiled (" + p.profiled + ")", got <= p.profiled, "ours " + got);
}
function expectNoLine(tag: string, rows: Row[], gene: string) {
  const found = rows.filter((r) => String(r.gene) === gene);
  ok(tag + " no row for " + gene + " (a bare line: geneCountsSql counts it)", !found.length, JSON.stringify(found));
}

// ---- P1, P3: a line with OQL, and a bare line ------------------------------------------------------
// KRAS: AMP MUT=G12D — KRAS's copy number is +1 only (no amplification); G12D on P02-T1, P02-T2, P07, P12, P17: 5 of 59.
// TP53 is bare: no row (P3). A line spelling out the default, TP53: MUT AMP HOMDEL FUSION, matches geneCountsSql's 17;
//   KRAS: MUT likewise its 24 (no off-panel KRAS call, no ±2, no structural variant).
{
  const any = await geneAnyOf(["KRAS", "TP53", "EGFR", "FAT1", "STK11"]);
  ok("P1 geneCountsSql profiles all 59 samples for KRAS, TP53, EGFR, FAT1, STK11 (WES)", ["KRAS", "TP53", "EGFR", "FAT1", "STK11"].every((g) => any.get(g)?.profiled === 59),
    JSON.stringify([...any]));
  const rows = await linesOf("P1/P3", ["KRAS: AMP MUT=G12D", "TP53"], {});
  expectLine("P1 [KRAS: AMP MUT=G12D, TP53]:", rows, "KRAS", 5, any);
  expectNoLine("P3 [KRAS: AMP MUT=G12D, TP53]:", rows, "TP53");
  ok("P3 one row per gene with OQL, and no other", rows.length === 1, JSON.stringify(rows));
  const dflt = await linesOf("P3", ["TP53: MUT AMP HOMDEL FUSION", "KRAS: MUT"], {});
  expectLine("P3 the default spelled out equals geneCountsSql's altered:", dflt, "TP53", any.get("TP53")!.altered, any);
  expectLine("P3 KRAS: MUT equals geneCountsSql's altered:", dflt, "KRAS", any.get("KRAS")!.altered, any);
  ok("P3 (hand count) geneCountsSql's TP53 / KRAS altered are 17 / 24", any.get("TP53")!.altered === 17 && any.get("KRAS")!.altered === 24,
    any.get("TP53")!.altered + " / " + any.get("KRAS")!.altered);
  const bare = await linesOf("P3 bare only", ["TP53", "KRAS"], {});
  ok("P3 bare lines only: no rows", bare.length === 0 && !!lineCountsSql, JSON.stringify(bare));
}

// ---- P4: two lines of one gene, counted together ----------------------------------------------------
// KRAS: MUT=G12D; KRAS: MUT=G12C — 5 + 6 = 11 (no sample has both). FAT1: AMP; FAT1: HOMDEL — P02-T1 amp, P02-T2 and P34 homdel: 3.
// EGFR: AMP; EGFR: MUT — amp P23, P26 (both mutated too) ∪ the 16 mutated: 16 (off-panel P33, P35, P37 included: they match
//   and are profiled for EGFR, by WES — as the portal counts a sequenced, mutated sample; geneCountsSql's bare EGFR is 13).
{
  const any = await geneAnyOf(["KRAS", "FAT1", "EGFR"]);
  const rows = await linesOf("P4", ["KRAS: MUT=G12D", "KRAS: MUT=G12C", "FAT1: AMP", "FAT1: HOMDEL"], {});
  ok("P4 one row per gene, not per line", rows.length === 2, JSON.stringify(rows));
  expectLine("P4 [KRAS: MUT=G12D, KRAS: MUT=G12C]:", rows, "KRAS", 11, any);
  expectLine("P4 [FAT1: AMP, FAT1: HOMDEL]:", rows, "FAT1", 3, any);
  const egfr = await linesOf("P4 EGFR", ["EGFR: AMP", "EGFR: MUT"], {});
  expectLine("P4 [EGFR: AMP, EGFR: MUT]:", egfr, "EGFR", 16, any);
  expectLine("P4 [EGFR: AMP] alone:", await linesOf("P4 EGFR: AMP", ["EGFR: AMP"], {}), "EGFR", 2, any);
}

// ---- P5: DRIVER in a line follows the driver settings -----------------------------------------------
// STK11: MUT_DRIVER — OncoKB Q37*: P10, P12, P16, P18, P27, P31, P37, P39 (8); Cancer Hotspots: P29's X200_splice (1). All 59 profiled.
{
  const lines = ["STK11: MUT_DRIVER"];
  const cases: [string, LineOql, number][] = [
    ["no settings: OncoKB at the pin", { oncokbPin: ONCOKB }, 8],
    ["OncoKB only", { oncokbPin: ONCOKB, drivers: { hotspots: false } }, 8],
    ["hotspots only", { oncokbPin: ONCOKB, drivers: { oncokb: false }, hotspotPins: HOTSPOT_PINS }, 1],
    ["OncoKB and hotspots", { oncokbPin: ONCOKB, drivers: {}, hotspotPins: HOTSPOT_PINS }, 9],
  ];
  for (const [tag, oql, n] of cases) expectLine("P5 " + tag + ":", await linesOf("P5 " + tag, lines, oql), "STK11", n);
}

// ---- P6: EXP / PROT, over the scratch copies above (EXPR); profiled as today, by the panels -----------
// KRAS: EXP>=2 — P07 (2.5), P21 (3), P26 (2): 3. With KRAS: PROT<=-2 (P25 −3, P02-T1 −2.5): 5. KRAS profiled 59 (mutation panels).
// EGFR: EXP>=2 — P31 (2.1) matches, but P31 is on PEERFIX_NO_EGFR and the copies hold no structural-variant panel: not profiled
//   for EGFR, so 0 (profiled as today; the portal would count P31 as profiled by the mRNA profile — documented).
// EGFR: MUT — the 16 above less P33, P35, P37, which are not profiled for EGFR here: 13 (altered AND profiled).
{
  const profiles = ["mutations", "cna", "structural_variants", EXP_PROFILE, PROT_PROFILE];
  const any = await geneAnyOf(["KRAS", "EGFR"], scratch);
  ok("P6 scratch: geneCountsSql profiles KRAS 59, EGFR 49", any.get("KRAS")?.profiled === 59 && any.get("EGFR")?.profiled === 49, JSON.stringify([...any]));
  expectLine("P6 [KRAS: EXP>=2]:", await linesOf("P6 EXP", ["KRAS: EXP>=2"], { profiles }, scratch), "KRAS", 3, any);
  expectLine("P6 [KRAS: EXP>=2] (EXP pinned):", await linesOf("P6 EXP pinned", ["KRAS: EXP>=2"], { profiles, pins: { EXP: EXP_PROFILE } }, scratch), "KRAS", 3, any);
  expectLine("P4/P6 [KRAS: EXP>=2, KRAS: PROT<=-2]:", await linesOf("P6 EXP PROT", ["KRAS: EXP>=2", "KRAS: PROT<=-2"], { profiles }, scratch), "KRAS", 5, any);
  expectLine("P6 [EGFR: EXP>=2] (P31 not profiled for EGFR):", await linesOf("P6 EGFR EXP", ["EGFR: EXP>=2"], { profiles }, scratch), "EGFR", 0, any);
  expectLine("P1 [EGFR: MUT] (P33, P35, P37 not profiled for EGFR):", await linesOf("P1 EGFR MUT scratch", ["EGFR: MUT"], { profiles }, scratch), "EGFR", 13, any);
}

// ==== Download: lineCtes with the view's driver settings (L*, PR 8 of the OQL series) ===============
// Legacy: cbioportal-frontend cd8c6df src/pages/resultsView/download/DownloadTab.tsx — the lists, matrix and case table
// come from the OQL-filtered data, whose DRIVER is putativeDriver (ResultsViewPageStoreUtils 134-152: OncoKB || hotspots
// || custom, each when its setting is on). PIK3CA: MUT_DRIVER, from data_mutations.txt, peer-oncokb.tsv, peer-hotspots.tsv:
//   E545K (OncoKB Oncogenic, not a hotspot in the fixture) on FX-P02-T1, FX-P10-T1, FX-P16-T1, FX-P18-T1;
//   H1047R and E110del (Cancer Hotspots, not in peer-oncokb.tsv) both on FX-P29-T1. No custom calls or tiers. No PIK3CA copy number.
/** the samples lineCtes says the one line alters, sorted */
async function dlAltered(tag: string, line: string, extra: Partial<StudyOpts> & Record<string, unknown>): Promise<string[] | null> {
  const cohort = compileCohortDef(null, { study: STUDY, db: conn!.db });
  const gene = line.split(":")[0].trim().toUpperCase();
  const o = { study: STUDY, db: conn!.db, pin: ONCOKB, profiles: ["mutations", "cna", "structural_variants"], ...extra } as StudyOpts;
  try {
    const sql = "WITH cohort AS (" + cohort + "),\n" + lineCtes("d", "cohort", [{ line, gene, types: ["MUTATION"] }], o) + "\nSELECT sid FROM d_e0 ORDER BY sid";
    return (await chQuery<Row>(sql, conn!)).data.map((r) => String(r.sid));
  } catch (e) {
    ok(tag + " runs", false, (e as Error).message.slice(0, 300));
    return null;
  }
}
{
  const LINE = "PIK3CA: MUT_DRIVER";
  const ONCO = ["FX-P02-T1", "FX-P10-T1", "FX-P16-T1", "FX-P18-T1"], HOT = ["FX-P29-T1"];
  const OFF: DriverSettings = { oncokb: false, hotspots: false, custom: false, tiers: [] };
  const cases: [string, Record<string, unknown>, string[]][] = [
    ["L4 no drivers: OncoKB at the pin alone", {}, ONCO],
    ["L1 drivers {}: OncoKB or a hotspot (or custom)", { drivers: {}, hotspotPins: HOTSPOT_PINS }, [...ONCO, ...HOT]],
    ["L2 OncoKB off: hotspots (and custom) only", { drivers: { oncokb: false }, hotspotPins: HOTSPOT_PINS }, HOT],
    ["L1 hotspots off: OncoKB alone", { drivers: { hotspots: false }, hotspotPins: HOTSPOT_PINS }, ONCO],
    ["L3 every source off: no sample", { drivers: OFF, hotspotPins: HOTSPOT_PINS }, []],
  ];
  for (const [tag, extra, want] of cases) {
    const got = await dlAltered(tag, LINE, extra);
    if (got) ok("Download " + tag + " [" + LINE + "]: " + (want.join(", ") || "none"), JSON.stringify(got) === JSON.stringify(want), "ours " + (got.join(", ") || "none"));
  }
}

// ==== Mutations: oqlMutationFilterSql (U*, PR 9 of the OQL series) ===============================
// Legacy: cbioportal-frontend cd8c6df src/pages/resultsView/ResultsViewPageStore.ts 3644-3680 — with useOql and mutation
// OQL in the query, the tab's mutations of a gene are those some line of that gene wants (src/shared/lib/oql/oqlfilter.ts
// isDatumWantedByOQL 498-518, isDatumWantedByOQLLine 520-578, isDatumWantedByOQLMUTCommand 870-948 — the change
// compared lower-case, TRUNC every class but missense and in-frame, RANGE overlapping, or contained with `*`, and never
// matching a mutation without a position; standalone DRIVER isDatumWantedByAnyTypeWithModifiersCommand 629-667).
// Rows from data_mutations.txt (and mutation_derived's positions, read from the protein change):
//   KRAS (24, all missense): G12C P01-T1, P01-T2, P06, P10, P11, P16; G12D P02-T1, P02-T2, P07, P12, P17;
//     G12V P03-T1, P03-T2, P08, P13, P18; G13D P04-T1, P04-T2, P09, P14, P19; Q61H P05, P15, P20.
//   TP53 R175H: P03, P09, P15, P21, P30.
//   STK11: Q37* (nonsense, 37) P10, P12, P16, P18, P27, P31, P37, P39; SP8 (missense, 8-9) P27; F354L (missense) P29;
//     X200_splice twice on P29 (Splice_Region and Splice_Site, both the splice class, 200).
//   EGFR: SP3 (3-4) and SP4 (4-5) P21, SP7 (7-8) P27, SP11 (11-12) P25, SP12 (12-13, germline) P28; E746_A750del (in-frame,
//     746-750) P22, P24, P26, P28; T790M P22; S768I (germline) and V769M and C797S and G719A (719) and A289V P44;
//     L858R on 12 samples; SP10fs, P44's Splice_Region row and P44's EGFR-SEPT14 (type Fusion) have no position (-1).
//   PIK3CA: E545K (OncoKB Oncogenic, not a hotspot here) P02-T1, P10, P16, P18; H1047R (missense) and E110del (in-frame),
//     both Cancer Hotspots and not in peer-oncokb.tsv, on P29. STK11 Q37* is OncoKB Likely Oncogenic; SP8 is not listed.
type MutFilterOpts = { study: string; db: string; oncokbPin?: string | null; drivers?: DriverSettings; hotspotPins?: { hg19: string | null; hg38: string | null } };
let mutFilterSql: ((lines: string[], gene: string, o: MutFilterOpts) => string | null) | null = null, mutFilterMissing = "";
try { mutFilterSql = (await import("../lib/oql.ts" as string)).oqlMutationFilterSql as never; if (typeof mutFilterSql !== "function") throw new Error("no export oqlMutationFilterSql"); }
catch (e) { mutFilterSql = null; mutFilterMissing = (e as Error).message.slice(0, 200); }
/** "sample change" of each of the gene's rows the filter keeps, sorted; null when it gives no filter; undefined when it failed (reported) */
async function keptBy(tag: string, lines: string[], gene: string, extra: Partial<MutFilterOpts> = {}): Promise<string[] | null | undefined> {
  if (!mutFilterSql) { ok("Mutations " + tag + " runs", false, "oqlMutationFilterSql: " + mutFilterMissing); return undefined; }
  try {
    const cond = mutFilterSql(lines, gene, { study: STUDY, db: conn!.db, ...extra });
    if (cond === null) return null;
    const sql = "SELECT sampleId, proteinChange FROM " + conn!.db + ".mutation_derived\n" +
      "WHERE " + mutationStudySql(STUDY) + " AND `GENE.hugoGeneSymbol` = " + sq(gene) + "\n  AND (" + cond + ")";
    return (await chQuery<Row>(sql, conn!)).data.map((r) => String(r.sampleId) + " " + String(r.proteinChange)).sort();
  } catch (e) {
    ok("Mutations " + tag + " runs", false, (e as Error).message.slice(0, 300));
    return undefined;
  }
}
/** the rows kept against the rows written down (a filter that keeps them, never null) */
async function expectKept(tag: string, lines: string[], gene: string, want: string[], extra: Partial<MutFilterOpts> = {}) {
  const got = await keptBy(tag, lines, gene, extra);
  if (got === undefined) return;
  const w = [...want].sort();
  ok("Mutations " + tag + " [" + lines.join("; ") + "] " + gene + ": " + (w.length ? w.length + " rows" : "no row"),
    got !== null && JSON.stringify(got) === JSON.stringify(w), got === null ? "ours: null (no filter, every mutation)" : "ours " + (got.join(", ") || "none"));
}
async function expectNoFilter(tag: string, lines: string[], gene: string) {
  const got = await keptBy(tag, lines, gene);
  if (got === undefined) return;
  ok("Mutations " + tag + " [" + lines.join("; ") + "] " + gene + ": no filter (null)", got === null, "ours " + (got ? got.length + " rows" : ""));
}
const rowsOfChange = (change: string, samples: string[]) => samples.map((s) => "FX-" + s + " " + change);
{
  const G12D = rowsOfChange("G12D", ["P02-T1", "P02-T2", "P07-T1", "P12-T1", "P17-T1"]);
  const G13D = rowsOfChange("G13D", ["P04-T1", "P04-T2", "P09-T1", "P14-T1", "P19-T1"]);
  const R175H = rowsOfChange("R175H", ["P03-T1", "P09-T1", "P15-T1", "P21-T1", "P30-T1"]);
  const Q37 = rowsOfChange("Q37*", ["P10-T1", "P12-T1", "P16-T1", "P18-T1", "P27-T1", "P31-T1", "P37-T1", "P39-T1"]);
  const E545K = rowsOfChange("E545K", ["P02-T1", "P10-T1", "P16-T1", "P18-T1"]);
  const P29HOT = ["FX-P29-T1 E110del", "FX-P29-T1 H1047R"];
  const OFF: DriverSettings = { oncokb: false, hotspots: false, custom: false, tiers: [] };

  // U1: a change; compared lower-case (OF 917-925)
  await expectKept("U1", ["KRAS: MUT=G12D"], "KRAS", G12D);
  await expectKept("U1 (lower-case change)", ["KRAS: MUT=g12d"], "KRAS", G12D);
  // U2: AMP wants no mutation; the line's MUT=G12D does
  await expectKept("U2", ["KRAS: AMP MUT=G12D"], "KRAS", G12D);
  // U3: a class, truncating, a range, drivers by the settings
  await expectKept("U3 class", ["STK11: MISSENSE"], "STK11", ["FX-P27-T1 SP8", "FX-P29-T1 F354L"]);
  await expectKept("U3 class", ["STK11: NONSENSE"], "STK11", Q37);
  await expectKept("U3 TRUNC (every class but missense and in-frame)", ["STK11: TRUNC"], "STK11", [...Q37, "FX-P29-T1 X200_splice", "FX-P29-T1 X200_splice"]);
  await expectKept("U3 class (all KRAS calls are missense)", ["KRAS: MISSENSE"], "KRAS",
    [...rowsOfChange("G12C", ["P01-T1", "P01-T2", "P06-T1", "P10-T1", "P11-T1", "P16-T1"]), ...G12D,
      ...rowsOfChange("G12V", ["P03-T1", "P03-T2", "P08-T1", "P13-T1", "P18-T1"]), ...G13D, ...rowsOfChange("Q61H", ["P05-T1", "P15-T1", "P20-T1"])]);
  await expectKept("U3 range, overlapping", ["EGFR: MUT_(748-800)"], "EGFR",
    [...rowsOfChange("E746_A750del", ["P22-T1", "P24-T1", "P26-T1", "P28-T1"]), "FX-P22-T1 T790M", "FX-P44-T1 S768I", "FX-P44-T1 V769M", "FX-P44-T1 C797S"]);
  await expectKept("U3 range, contained (*)", ["EGFR: MUT_(748-800*)"], "EGFR", ["FX-P22-T1 T790M", "FX-P44-T1 S768I", "FX-P44-T1 V769M", "FX-P44-T1 C797S"]);
  await expectKept("U3 open range (no position, -1, never matches)", ["EGFR: MUT_(-10)"], "EGFR", ["FX-P21-T1 SP3", "FX-P21-T1 SP4", "FX-P27-T1 SP7"]);
  await expectKept("U3 range", ["KRAS: MUT_(10-12)"], "KRAS",
    [...rowsOfChange("G12C", ["P01-T1", "P01-T2", "P06-T1", "P10-T1", "P11-T1", "P16-T1"]), ...G12D, ...rowsOfChange("G12V", ["P03-T1", "P03-T2", "P08-T1", "P13-T1", "P18-T1"])]);
  await expectKept("U3 MUT_DRIVER, no settings: OncoKB at the pin", ["PIK3CA: MUT_DRIVER"], "PIK3CA", E545K, { oncokbPin: ONCOKB });
  await expectKept("U3 MUT_DRIVER, OncoKB or a hotspot", ["PIK3CA: MUT_DRIVER"], "PIK3CA", [...E545K, ...P29HOT], { oncokbPin: ONCOKB, drivers: {}, hotspotPins: HOTSPOT_PINS });
  await expectKept("U3 MUT_DRIVER, OncoKB off", ["PIK3CA: MUT_DRIVER"], "PIK3CA", P29HOT, { oncokbPin: ONCOKB, drivers: { oncokb: false }, hotspotPins: HOTSPOT_PINS });
  await expectKept("U3 MUT_DRIVER, hotspots off", ["PIK3CA: MUT_DRIVER"], "PIK3CA", E545K, { oncokbPin: ONCOKB, drivers: { hotspots: false }, hotspotPins: HOTSPOT_PINS });
  await expectKept("U3 MUT_DRIVER, every source off", ["PIK3CA: MUT_DRIVER"], "PIK3CA", [], { oncokbPin: ONCOKB, drivers: OFF, hotspotPins: HOTSPOT_PINS });
  await expectKept("U3 MUT_DRIVER (P27's SP8 is no driver)", ["STK11: MUT_DRIVER"], "STK11", Q37, { oncokbPin: ONCOKB, drivers: { hotspots: false } });
  await expectKept("U3 class and DRIVER (E110del is in-frame)", ["PIK3CA: MISSENSE_DRIVER"], "PIK3CA", [...E545K, "FX-P29-T1 H1047R"], { oncokbPin: ONCOKB, drivers: {}, hotspotPins: HOTSPOT_PINS });
  await expectKept("U3/U9 standalone DRIVER", ["PIK3CA: DRIVER"], "PIK3CA", [...E545K, ...P29HOT], { oncokbPin: ONCOKB, drivers: {}, hotspotPins: HOTSPOT_PINS });
  // U4: KRAS's line is MUT (or bare): every KRAS mutation, so no filter; TP53's line filters TP53
  await expectNoFilter("U4", ["KRAS: MUT", "TP53: MUT=R175H"], "KRAS");
  await expectNoFilter("U4 (bare)", ["KRAS", "TP53: MUT=R175H"], "KRAS");
  await expectKept("U4", ["KRAS: MUT", "TP53: MUT=R175H"], "TP53", R175H);
  // U5: the gene's only line wants no mutation, or the gene has no line: a filter that keeps nothing
  await expectKept("U5", ["KRAS: AMP", "TP53: MUT=R175H"], "KRAS", []);
  await expectKept("U5 (FUSION)", ["KRAS: FUSION", "TP53: MUT=R175H"], "KRAS", []);
  await expectKept("U5 (no line of the gene)", ["TP53: MUT=R175H"], "KRAS", []);
  // U8: any line of the gene
  await expectKept("U8", ["KRAS: MUT=G12D", "KRAS: MUT=G13D"], "KRAS", [...G12D, ...G13D]);
  await expectKept("U8 (a line wanting none beside one wanting G12D)", ["KRAS: MUT=G12D", "KRAS: AMP"], "KRAS", G12D);
}

// U1/U10: the lollipop draws the filtered mutations — KRAS: MUT=G12D's stems are G12D only (5 samples, 4
// patients: FX-P02 has it in two samples), where unfiltered KRAS has G12C (P01 P06 P10 P11 P16), G12D, G12V (P03 P08 P13 P18),
// G13D (P04 P09 P14 P19) and Q61H (P05 P15 P20), in patients
{
  const cohort = compileCohortDef(null, { study: STUDY, db: conn!.db });
  const filter = oqlMutationFilterSql(["KRAS: MUT=G12D"], "KRAS", { study: STUDY, db: conn!.db })!;
  const stems = async (filters?: Record<string, string>) => (await chQuery<{ change: string; n: string }>(
    lollipopChangesSql(cohort, ["KRAS"], STUDY, 1, null, conn!.db, null, filters) as unknown as string, conn!)).data.map((r) => r.change + ":" + r.n).sort().join(" ");
  const on = await stems({ KRAS: filter }), off = await stems();
  ok("Mutations U1/U10 the lollipop's stems under KRAS: MUT=G12D", on === "G12D:4", "ours " + JSON.stringify(on));
  ok("Mutations U6 the lollipop without a filter keeps every KRAS change", off === "G12C:5 G12D:4 G12V:4 G13D:4 Q61H:3", "ours " + JSON.stringify(off));
}

await write("DROP DATABASE IF EXISTS " + scratch);

console.log(`\n${checks - failures}/${checks} results OQL checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
