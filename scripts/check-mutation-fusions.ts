/**
 * Live check: structural variants (fusions) on the Results → Mutations tab, run against the
 * committed fixture study on connection b — the mutation table (lib/views/mutations/run.ts
 * runMutations over lib/mutation-table.ts mutationRowSource: which SVs join a gene's rows, and each
 * column's value on a fusion row) and the lollipop (lib/federation.ts lollipopCounts, lib/lollipop.ts
 * buildLollipopGene and lib/views/hotspots/run.ts runHotspots: the badges' Fusion driver/VUS tally,
 * the somatic frequency, and what has no stem). Each expected answer is written down by hand from
 * test/fixtures/peer-study/data_sv.txt (22 SVs on FX-P45–FX-P53), data_mutations.txt (BRAF and MYC
 * rows), test/fixtures/peer-oncokb-sv.tsv and the SV `Fusion` rows of peer-oncokb.tsv, by the portal's
 * rule (cbioportal-frontend e9d70fb) and PR E's decisions for cBioLab. Row ids are the spec table's:
 *
 *   W  which SVs join a gene's list: the study's STRUCTURAL_VARIANT profile, the cohort's samples,
 *      site1 or site2 the gene (ResultsViewPageStore.ts 3420-3458, 3553-3579), one row per SV record
 *      (3727-3763), never germline for the driver split (ResultsViewPageStoreUtils.ts 249).
 *   P  the Protein Change text (StoreUtils.ts buildProteinChange 2175-2204), Hugo symbols from the
 *      gene table.
 *   R  each column of a fusion row (ResultsViewPageStore.ts 3726-3761 and the column formatters).
 *   A/X2-X5  the driver call (`drv`: Alteration column, badges) from the pair's no-tumour-type row,
 *      else the stronger partner's gene-level Fusion row; the Annotation cell from the pair's row for
 *      the sample's tumour type, else that same fallback; the two never reconciled; no pin: no call
 *      in the table, every fusion a driver in the lollipop.
 *   X6  a GERMLINE fusion is a driver like any other; its MS cell is the stored status.
 *   B   badges: one Fusion per row, driver/VUS by X2, on site2's gene's tab too (MutationMapper.tsx 323-373).
 *   F   somatic frequency: a sample counts when a fusion's SITE1 is the gene and its status is not
 *      germline (MutationUtils.tsx somaticMutationRate 275-311); the denominator is the cohort's samples.
 *   L/X8  no stem, not in "N mutated" or the no-protein-position disclosure; the caption says so.
 *   X7  a gene with fusions only is still drawn. X9 the suppression floor by (gene, change). X10
 *      both partners queried: under each.
 *
 * Run: node --env-file=.env.local scripts/check-mutation-fusions.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { connById } from "../lib/ch.ts";
import { PatientLevelResolver, type LollipopReport } from "../lib/federation.ts";
import { MUTATION_COLUMNS } from "../lib/mutation-table.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import { runHotspots } from "../lib/views/hotspots/run.ts";
import { buildLollipopGene } from "../lib/lollipop.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { CohortDef } from "../lib/types.ts";
import type { HotspotGene } from "../lib/views/hotspots/types.ts";

const STUDY = "cbiolab_peer_fixture";
/** peer-db.ts stores the SV and gene-level OncoKB rows under this version (and the app's pin) */
const PIN = "fixture";
/** and one SV row (TMPRSS2-ERG in Lung Adenocarcinoma) under this one alone */
const OTHER = "fixture-older";
/** every sample of the fixture study (data_clinical_sample.txt): the somatic frequency's denominator */
const STUDY_SAMPLES = 59;
const LUAD = "Lung Adenocarcinoma", LUSC = "Lung Squamous Cell Carcinoma";

// Genome Nexus's stored release is read at the fixture's pin (no record matches a fusion); the
// protein (length, domains) is asked of an address that refuses at once, so nothing leaves the machine
process.env.GENOME_NEXUS_PIN = "fixture";
process.env.GENOME_NEXUS_GRCH38_PIN = "fixture";
process.env.GENOME_NEXUS_URL = "http://127.0.0.1:9";

let failures = 0, checks = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  checks++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  if (!pass) failures++;
};

const conn = connById("b");
if (!conn) { console.log("FAIL connection b is not configured (npm run peer-db prints its CLICKHOUSE2_* lines)"); process.exit(1); }

const resolver = (pin: string | null) =>
  new PatientLevelResolver(STUDY, { oncokbPin: pin }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const WHOLE: CohortDef = { all: [] };
const ctxFor = (pin: string | null, def: CohortDef): ViewRun => ({
  doc: { study: STUDY, cohorts: { c: def }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {} } },
  resolvers: { [STUDY]: resolver(pin) },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin, studyProfiles: async () => ({ profiles: [], gaProfiles: [] })
} as unknown as ViewRun);

// ---- the mutation table -----------------------------------------------------------------------

type Value = string | number | null;
type TableRow = { sample: string; values: Value[] };
const col = (id: string) => MUTATION_COLUMNS.findIndex((c) => c.id === id);
const v = (r: TableRow, id: string) => r.values[col(id)];
const table = async (gene: string, pin: string | null, def: CohortDef = WHOLE): Promise<TableRow[] | string> => {
  try {
    const res = await runMutations({ kind: "mutations", gene, cohorts: ["c"], rows: 1000 }, ctxFor(pin, def)) as { mutations?: { rows: TableRow[] }; error?: string };
    if (!res.mutations) return "refused: " + String(res.error || JSON.stringify(res).slice(0, 200));
    return res.mutations.rows;
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 200); }
};
const key = (r: TableRow) => r.sample + " " + String(v(r, "proteinChange"));

/**
 * A fusion row as the table shows it at pin "fixture": [sample, Protein Change, Cancer Type Detailed,
 * Annotation (X3), Alteration (X2), Variant Type (R9, upper-cased), Chromosome (R13, site 1),
 * Start Pos (R14, site 1), MS (X6, as stored), spec rows and why]
 */
type Fusion = [string, string, string, string, string, string, string, number, string, string];
const FUSIONS: Fusion[] = [
  ["FX-P45-T1", "EML4-ALK Fusion", LUAD, "Oncogenic · Level 2", "Fusion · Driver", "FUSION", "2", 42522656, "SOMATIC",
    "P1 X2 the pair's no-tumour-type row (Oncogenic); X3 its Lung Adenocarcinoma row"],
  ["FX-P46-T1", "EML4-ALK Fusion", LUAD, "Oncogenic · Level 2", "Fusion · Driver", "FUSION", "2", 42522656, "SOMATIC", "W8 the same fusion in another patient"],
  ["FX-P47-T1", "EML4-ALK Fusion", "", "Likely Oncogenic · Level 3A", "Fusion · Driver", "FUSION", "2", 42522656, "SOMATIC",
    "A7 both cancer-type values blank: the study's cancer type's row for the cell; X2 still the no-tumour-type row"],
  ["FX-P48-T1", "EML4-ALK Fusion", "", "Oncogenic · Level 4", "Fusion · Driver", "FUSION", "2", 42522656, "SOMATIC", "A7 CANCER_TYPE only: the no-tumour-type row for the cell too"],
  ["FX-P49-T1", "EML4-ALK Fusion", LUAD, "Oncogenic · Level 2", "Fusion · Driver", "FUSION", "2", 42522656, "SOMATIC", "W8 one patient's first sample"],
  ["FX-P49-T2", "EML4-ALK Fusion", LUSC, "Likely Neutral", "Fusion · Driver", "FUSION", "2", 42522656, "SOMATIC",
    "W8 the same patient's second sample, a row of its own; X4 a Likely Neutral cell on a driver row"],
  ["FX-P46-T1", "FGFR2 intragenic", LUAD, "Resistance", "Fusion · Driver", "DUPLICATION", "10", 123243211, "SOMATIC",
    "P3 site1 = site2: one gene; A3 X2 its no-tumour-type row says Resistance, a driver"],
  ["FX-P50-T1", "BRCA2 intragenic", LUAD, "Likely Oncogenic", "Fusion · Driver", "DELETION", "13", 32914000, "SOMATIC", "P7 one gene, class DELETION; X2 the no-tumour-type row"],
  ["FX-P51-T1", "BRCA2 intragenic", LUAD, "Likely Oncogenic", "Fusion · Driver", "DELETION", "13", 32915000, "GERMLINE",
    "X6 W10 a GERMLINE fusion still gets the call and is a driver; MS shows the stored status"],
  ["FX-P50-T1", "MET intragenic", LUAD, "Likely Oncogenic · Level 3B", "Fusion · VUS", "DUPLICATION", "7", 116300000, "SOMATIC",
    "W6 P8 site1 empty: site2's gene; R13 R14 still site 1's chromosome and position; A2 X2 no no-tumour-type row and MET has no gene-level Fusion row: VUS"],
  ["FX-P50-T1", "ROS1 intragenic", LUAD, "Oncogenic · Level 1", "Fusion · VUS", "FUSION", "6", 117650000, "SOMATIC", "P7 one gene, class FUSION"],
  ["FX-P51-T1", "RB1 intragenic", LUAD, "Likely Oncogenic", "Fusion · VUS", "DEL", "13", 48900000, "SOMATIC", "P7 class DEL is no intergenic class"],
  ["FX-P50-T1", "RB1 intergenic", LUAD, "Likely Oncogenic", "Fusion · VUS", "INTERGENIC", "13", 48880000, "SOMATIC", "P4 class Intergenic, any case; R9 upper-cased"],
  ["FX-P51-T1", "SMAD4 intragenic", LUAD, "Inconclusive", "Fusion · VUS", "DELETION", "18", 48580000, "SOMATIC", "P7 class Deletion; R9 upper-cased"],
  ["FX-P50-T1", "SMAD4 intergenic", LUAD, "Inconclusive", "Fusion · VUS", "NA", "18", 48560000, "SOMATIC", "P5 class NA and event info smad4-Intergenic (case-insensitive)"],
  ["FX-P51-T1", "NOTCH1 intragenic", LUAD, "Unknown", "Fusion · VUS", "NA", "9", 139400000, "SOMATIC", "P6 class NA, any other event info"],
  ["FX-P52-T1", "KIF5B-RET Fusion", LUAD, "Oncogenic · Level 1", "Fusion · VUS", "INVERSION", "10", 32317000, "SOMATIC",
    "X4 the no-tumour-type row says Likely Neutral (VUS) while the cell says Oncogenic"],
  ["FX-P52-T1", "TTN-MUC16 Fusion", LUAD, "", "Fusion · VUS", "TRANSLOCATION", "2", 179400000, "SOMATIC",
    "X3 the pair's row stored empty: a blank cell; X2 fallback TTN's gene-level Unknown: VUS"],
  ["FX-P52-T1", "MESD-TMPRSS2 Fusion", LUAD, "", "Fusion · VUS", "FUSION", "15", 81280000, "SOMATIC",
    "P10 the gene table's MESD, not the file's MESDC2; no row of any kind: blank, VUS"],
  ["FX-P53-T1", "TMPRSS2-ERG Fusion", LUAD, "Oncogenic · Level 4", "Fusion · Driver", "DELETION", "21", 42870000, "SOMATIC",
    "X2 X3 no pair row at the pin: partner ERG's gene-level Fusion row for both"],
  ["FX-P53-T1", "TPM3-NTRK1 Fusion", LUAD, "Unknown", "Fusion · Driver", "FUSION", "1", 154140000, "SOMATIC",
    "X4 the cell is the pair's Unknown; the driver call falls back to NTRK1's gene-level Oncogenic"],
  ["FX-P53-T1", "KIAA1549-BRAF Fusion", LUAD, "Likely Oncogenic · Level 3B", "Fusion · Driver", "FUSION", "7", 138550000, "SOMATIC",
    "X3 the pair's tumour-type row, not its no-tumour-type Oncogenic one"]
];
const fusion = (sample: string, change: string) => FUSIONS.find((f) => f[0] === sample && f[1] === change);
const EML4_ALK = ["FX-P45-T1", "FX-P46-T1", "FX-P47-T1", "FX-P48-T1", "FX-P49-T1", "FX-P49-T2"].map((s) => s + " EML4-ALK Fusion");

/** [gene, every row (sample + protein change) of its table, why] */
const GENE_ROWS: [string, string[], string][] = [
  ["EML4", EML4_ALK, "W3 site1 the gene; W8 six rows, two of one patient"],
  ["ALK", EML4_ALK, "W3 W4 site2 the gene: the same six rows on its tab"],
  ["FGFR2", ["FX-P46-T1 FGFR2 intragenic"], "W5 site1 = site2: listed once"],
  ["BRCA2", ["FX-P50-T1 BRCA2 intragenic", "FX-P51-T1 BRCA2 intragenic"], "W10 the germline one listed too"],
  ["MET", ["FX-P50-T1 MET intragenic"], "W6 site1 empty, site2 the gene"],
  ["ROS1", ["FX-P50-T1 ROS1 intragenic"], "one gene"],
  ["RB1", ["FX-P51-T1 RB1 intragenic", "FX-P50-T1 RB1 intergenic"], "P4 P7"],
  ["SMAD4", ["FX-P51-T1 SMAD4 intragenic", "FX-P50-T1 SMAD4 intergenic"], "P5 P7"],
  ["NOTCH1", ["FX-P51-T1 NOTCH1 intragenic"], "P6"],
  ["KIF5B", ["FX-P52-T1 KIF5B-RET Fusion"], "W3"],
  ["RET", ["FX-P52-T1 KIF5B-RET Fusion"], "W4"],
  ["TTN", ["FX-P52-T1 TTN-MUC16 Fusion"], "W7 TTN's tab holds its own SV only"],
  ["MUC16", ["FX-P52-T1 TTN-MUC16 Fusion"], "W4"],
  ["TMPRSS2", ["FX-P53-T1 TMPRSS2-ERG Fusion", "FX-P52-T1 MESD-TMPRSS2 Fusion"], "W3 site1 and site2; P2 no reordering (MESD first)"],
  ["ERG", ["FX-P53-T1 TMPRSS2-ERG Fusion"], "W4 the fusion on its site2 gene's tab, its text unchanged"],
  ["TPM3", ["FX-P53-T1 TPM3-NTRK1 Fusion"], "W3"],
  ["NTRK1", ["FX-P53-T1 TPM3-NTRK1 Fusion"], "W4"],
  ["MESD", ["FX-P52-T1 MESD-TMPRSS2 Fusion"], "P10 the gene by its current symbol"],
  ["KIAA1549", ["FX-P53-T1 KIAA1549-BRAF Fusion"], "W3"],
  ["BRAF", ["FX-P10-T1 V600E", "FX-P29-T1 D594G", "FX-P29-T1 G469A", "FX-P29-T1 V600E", "FX-P53-T1 KIAA1549-BRAF Fusion"],
    "W4 a gene with mutations: its four mutation rows and the fusion it is site2 of"],
  ["MYC", ["FX-P29-T1 P57S"], "W3 a gene with no SV: its mutation alone, no fusion row"]
];

/** the columns a fusion row leaves blank: no protein position, no genomic location, no allele counts */
const BLANK: [string, Value, string][] = [
  ["proteinPos", "", "R4"], ["functionalImpact", "", "R6"], ["vaf", null, "R10"], ["altCount", null, "R11"], ["refCount", null, "R11"],
  ["end", null, "R15"], ["ref", "", "R16"], ["var", "", "R16"], ["hgvsg", "", "R17"], ["hgvsc", "", "R18"], ["gnomad", null, "R18"],
  ["clinvar", "", "R18"], ["dbsnp", "", "R18"], ["signal", "", "R18"]
];

const sameRows = (got: string[], want: string[]) => got.length === want.length && [...got].sort().join("|") === [...want].sort().join("|");

for (const [gene, want, why] of GENE_ROWS) {
  const rows = await table(gene, PIN);
  if (typeof rows === "string") { ok(`${gene} table runs`, false, rows); continue; }
  const got = rows.map(key);
  ok(`${gene} rows: ${why}`, sameRows(got, want), "got " + JSON.stringify(got) + ", expected " + JSON.stringify(want));
  for (const r of rows) {
    const f = fusion(r.sample, String(v(r, "proteinChange")));
    if (!f) continue;
    const [sid, change, ct, ann, alt, vt, chr, start, status, fwhy] = f;
    const tag = `${gene} ${sid} ${change}`;
    const shown = { cancerType: v(r, "cancerType"), annotation: v(r, "annotation"), mutationType: v(r, "mutationType"), alteration: v(r, "alteration"),
      variantType: v(r, "variantType"), mutCount: v(r, "mutCount"), chr: v(r, "chr"), start: v(r, "start"), status: v(r, "status") };
    const wantShown = { cancerType: ct, annotation: ann, mutationType: "Fusion", alteration: alt, variantType: vt, mutCount: 0, chr, start, status };
    ok(`${tag}: ${fwhy}; R2 R7 R8 R9 R12-R14 R19`, JSON.stringify(shown) === JSON.stringify(wantShown),
      "ours " + JSON.stringify(shown) + ", expected " + JSON.stringify(wantShown));
    const blanks = BLANK.filter(([id, want]) => v(r, id) !== want).map(([id, , rid]) => rid + " " + id + "=" + JSON.stringify(v(r, id)));
    ok(`${tag}: no protein position or genomic location, so ${BLANK.map((b) => b[2] + " " + b[0]).join(", ")} blank`, blanks.length === 0, blanks.join("; "));
  }
  if (gene === "BRAF") {
    const muts = rows.filter((r) => v(r, "mutationType") !== "Fusion");
    ok("BRAF the four mutation rows keep their own types (Missense_Mutation)", muts.length === 4 && muts.every((r) => v(r, "mutationType") === "Missense_Mutation"),
      JSON.stringify(muts.map((r) => [key(r), v(r, "mutationType")])));
  }
}

// W2: only the cohort's samples — FX-P49-T2 out, the patient's other sample in
const fewer: CohortDef = { all: [{ kind: "sampleList", ids: ["FX-P45-T1", "FX-P46-T1", "FX-P47-T1", "FX-P48-T1", "FX-P49-T1"].map((s) => STUDY + ":" + s) }] };
const fewerSize = await resolver(PIN).lollipopCounts(fewer, ["ALK"], 1).then((r) => r.cohortSamples, (e: Error) => e.message);
ok("W2 fixture: the smaller cohort is those five samples", fewerSize === 5, String(fewerSize));
const alkFew = await table("ALK", PIN, fewer);
ok("W2 a cohort without FX-P49-T2: ALK's tab lists the five other EML4-ALK rows",
  typeof alkFew !== "string" && sameRows(alkFew.map(key), EML4_ALK.filter((k) => !k.startsWith("FX-P49-T2"))),
  typeof alkFew === "string" ? alkFew : JSON.stringify(alkFew.map(key)));

// the pin decides which release is read: TMPRSS2-ERG's Lung Adenocarcinoma row exists at OTHER alone,
// and nothing else (no gene-level row, no no-tumour-type row) is stored there
const ergOld = await table("ERG", OTHER);
const ergRow = typeof ergOld === "string" ? null : ergOld.find((r) => key(r) === "FX-P53-T1 TMPRSS2-ERG Fusion");
ok(`pin ${OTHER}: ERG's TMPRSS2-ERG cell is that release's Likely Neutral, and no driver (X2 X3)`,
  !!ergRow && v(ergRow, "annotation") === "Likely Neutral" && v(ergRow, "alteration") === "Fusion · VUS",
  ergRow ? JSON.stringify([v(ergRow, "annotation"), v(ergRow, "alteration")]) : String(ergOld).slice(0, 200));

// X5: no pin — no call in the table; the Alteration column reads every row a driver, as for mutations
for (const gene of ["ALK", "TMPRSS2", "FGFR2"]) {
  const rows = await table(gene, null);
  if (typeof rows === "string") { ok(`X5 ${gene} table with no pin runs`, false, rows); continue; }
  const fus = rows.filter((r) => v(r, "mutationType") === "Fusion");
  const wantN = GENE_ROWS.find((g) => g[0] === gene)![1].length;
  ok(`X5 no pin: ${gene}'s ${wantN} fusion rows have an empty Annotation and read "Fusion · Driver"`,
    fus.length === wantN && fus.every((r) => v(r, "annotation") === "" && v(r, "alteration") === "Fusion · Driver"),
    JSON.stringify(fus.map((r) => [key(r), v(r, "annotation"), v(r, "alteration")])));
}

// ---- the lollipop -----------------------------------------------------------------------------

const LOLLIPOP_GENES = ["EML4", "ALK", "FGFR2", "BRCA2", "MET", "ROS1", "RB1", "SMAD4", "NOTCH1", "KIF5B", "RET", "TTN", "MUC16",
  "TMPRSS2", "ERG", "TPM3", "NTRK1", "MESD", "KIAA1549", "BRAF"];
const counts = async (pin: string | null, minCount = 1): Promise<LollipopReport | string> => {
  try { return await resolver(pin).lollipopCounts(WHOLE, LOLLIPOP_GENES, minCount); } catch (e) { return "threw: " + String((e as Error).message).slice(0, 200); }
};

/** [gene, Fusion badge driver, VUS, somatic samples, why] at pin "fixture", minCount 1 */
type Badge = [string, number, number, number, string];
const BADGES: Badge[] = [
  ["EML4", 6, 0, 6, "B3 one per row (six); F1 six samples with EML4 as site1"],
  ["ALK", 6, 0, 0, "B4 counted on site2's tab; F2 not in its frequency"],
  ["FGFR2", 1, 0, 1, "X10 W5 once under the gene; a driver by Resistance (A3); F1 one sample"],
  ["BRCA2", 2, 0, 1, "X6 the germline row a driver in the badge; F3 not in the somatic frequency (FX-P50-T1 only)"],
  ["MET", 0, 1, 0, "B4; F2 site2 only (site1 empty)"],
  ["ROS1", 0, 1, 1, "B1"],
  ["RB1", 0, 2, 2, "B3 two rows, two samples"],
  ["SMAD4", 0, 2, 2, "B3"],
  ["NOTCH1", 0, 1, 1, "B1"],
  ["KIF5B", 0, 1, 1, "X4 VUS by the no-tumour-type row, though the cell is Oncogenic"],
  ["RET", 0, 1, 0, "B4 F2"],
  ["TTN", 0, 1, 1, "B1"],
  ["MUC16", 0, 1, 0, "B4 F2"],
  ["TMPRSS2", 1, 1, 1, "B4 X10 TMPRSS2-ERG (site1, driver) and MESD-TMPRSS2 (site2, VUS); F1 F2 only FX-P53-T1 counts"],
  ["ERG", 1, 0, 0, "B4 X10 the same TMPRSS2-ERG under its other partner; F2"],
  ["TPM3", 1, 0, 1, "X4 a driver by NTRK1's gene-level row"],
  ["NTRK1", 1, 0, 0, "B4 F2"],
  ["MESD", 0, 1, 1, "F1"],
  ["KIAA1549", 1, 0, 1, "F1"],
  ["BRAF", 1, 0, 2, "B4 the fusion BRAF is site2 of; F2 the frequency stays its two mutated samples (FX-P10-T1, FX-P29-T1)"]
];
const MUTATED: Record<string, { mutated: number; mutations: number; positions: number[] }> = {
  // BRAF's own: FX-P10 V600E; FX-P29 D594G, G469A, V600E (data_mutations.txt)
  BRAF: { mutated: 2, mutations: 4, positions: [469, 594, 600] }
};

const geneOf = (rep: LollipopReport, gene: string): HotspotGene => buildLollipopGene(gene, [rep], null);

const atPin = await counts(PIN);
if (typeof atPin === "string") ok("lollipopCounts at the pin runs", false, atPin);
else {
  ok("F4 the denominator is the cohort's samples, fusions or not", atPin.cohortSamples === STUDY_SAMPLES, String(atPin.cohortSamples));
  const fusionTypes = atPin.types.filter((t) => t.mtype === "Fusion");
  ok("L1 every fusion type row has no codon (pos null)", fusionTypes.length > 0 && fusionTypes.every((t) => t.pos === null),
    JSON.stringify(fusionTypes.filter((t) => t.pos !== null)));
  const fusionChanges = atPin.changes.filter((c) => / Fusion$| intragenic$| intergenic$/.test(c.change));
  ok("L1 L2 X8 no fusion is a protein change (no stem, no height, not in N mutated)", fusionChanges.length === 0, JSON.stringify(fusionChanges));
  for (const [gene, drv, vus, somatic, why] of BADGES) {
    const g = geneOf(atPin, gene);
    const m = MUTATED[gene] || { mutated: 0, mutations: 0, positions: [] };
    const got = { fusion: g.tally.fusion, somaticSamples: g.somaticSamples, mutated: g.mutated, mutations: g.mutations, unpositioned: g.unpositioned, positions: g.positions.map((p) => p.pos) };
    const want = { fusion: { driver: drv, vus }, somaticSamples: somatic, mutated: m.mutated, mutations: m.mutations, unpositioned: 0, positions: m.positions };
    ok(`pin ${PIN}: ${gene} tally.fusion ${drv}/${vus}, somaticSamples ${somatic}, mutated ${m.mutated}, unpositioned 0: ${why}; L2 X8`,
      JSON.stringify(got) === JSON.stringify(want), "ours " + JSON.stringify(got) + ", expected " + JSON.stringify(want));
  }
  const braf = geneOf(atPin, "BRAF");
  const brafMut = Object.entries(braf.tally).filter(([k]) => k !== "fusion").reduce((n, [, t]) => n + t.driver + t.vus, 0);
  ok("L2 BRAF's other badges still count its four mutation rows", brafMut === 4, JSON.stringify(braf.tally));
}

// X5: no pin — every fusion a driver in the badges, as every mutation is
const noPin = await counts(null);
if (typeof noPin === "string") ok("lollipopCounts with no pin runs", false, noPin);
else for (const [gene, drv, vus] of BADGES) {
  const g = geneOf(noPin, gene);
  ok(`X5 no pin: ${gene} tally.fusion ${drv + vus}/0`, g.tally.fusion.driver === drv + vus && g.tally.fusion.vus === 0, JSON.stringify(g.tally.fusion));
}

// X9: the floor by (gene, change) patients — EML4-ALK has five patients, BRCA2 intragenic two (FX-P50,
// FX-P51); RB1's intragenic and intergenic are one patient each, as are TMPRSS2's two fusions
const floor2 = await counts(PIN, 2);
if (typeof floor2 === "string") ok("lollipopCounts with minCount 2 runs", false, floor2);
else for (const [gene, drv, vus, why] of [
  ["EML4", 6, 0, "five patients: kept, all six rows"], ["ALK", 6, 0, "the same change under ALK"],
  ["BRCA2", 2, 0, "two patients (one germline): kept"], ["RB1", 0, 0, "two changes, one patient each: both withheld"],
  ["TMPRSS2", 0, 0, "TMPRSS2-ERG and MESD-TMPRSS2, one patient each: withheld"], ["FGFR2", 0, 0, "one patient: withheld"]
] as [string, number, number, string][]) {
  const g = geneOf(floor2, gene);
  ok(`X9 minCount 2: ${gene} tally.fusion ${drv}/${vus}: ${why}`, g.tally.fusion.driver === drv && g.tally.fusion.vus === vus, JSON.stringify(g.tally.fusion));
}

// X7 X8: the view keeps a gene with fusions only, and its caption says what fusions are
const hot = async (genes: string[]) => {
  try { return await runHotspots({ kind: "hotspots", genes, cohorts: ["c"] } as never, ctxFor(PIN, WHOLE)); }
  catch (e) { return { error: "threw: " + String((e as Error).message).slice(0, 200) }; }
};
const hv = await hot(["ERG", "BRAF"]) as { hotspots?: HotspotGene[]; note?: string; error?: string; result?: { error?: string } };
const listed = (hv.hotspots || []).map((h) => h.gene);
ok("X7 a gene with fusions only (ERG) is still drawn, beside BRAF", listed.includes("ERG") && listed.includes("BRAF"), hv.error || hv.result?.error || JSON.stringify(listed));
const erg = (hv.hotspots || []).find((h) => h.gene === "ERG");
ok("X7 ERG: no stems, its Fusion badge 1 driver, somatic frequency 0 of 59 (F2)",
  !!erg && erg.positions.length === 0 && erg.tally.fusion.driver === 1 && erg.tally.fusion.vus === 0 && erg.somaticSamples === 0 && erg.cohortSamples === STUDY_SAMPLES,
  erg ? JSON.stringify({ positions: erg.positions.length, fusion: erg.tally.fusion, somatic: erg.somaticSamples, of: erg.cohortSamples }) : "not listed");
const hvEml4 = await hot(["EML4"]) as { hotspots?: HotspotGene[]; note?: string };
const eml4 = (hvEml4.hotspots || []).find((h) => h.gene === "EML4");
ok("X7 F1 EML4 alone: drawn, somatic frequency 6 of 59", !!eml4 && eml4.somaticSamples === 6 && eml4.mutated === 0 && eml4.unpositioned === 0,
  eml4 ? JSON.stringify({ somatic: eml4.somaticSamples, mutated: eml4.mutated, unpositioned: eml4.unpositioned }) : "not listed");
ok("X8 the caption says fusions count in the badges and frequency but have no stem", /fusion/i.test(hv.note || ""), (hv.note || "").slice(0, 300));
ok("X8 the no-protein-position disclosure does not count fusions (nothing unpositioned here)", !/no protein position/i.test(hv.note || ""), (hv.note || "").slice(0, 300));

console.log(`\n${checks - failures}/${checks} mutation fusion checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
