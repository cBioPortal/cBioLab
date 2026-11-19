/**
 * Live check: the Results → Mutations table's remaining columns and the portal's Mutation Type labels
 * (PR G), run against the committed fixture study on connection b through the mutations view
 * (lib/views/mutations/run.ts runMutations over lib/mutation-table.ts mutationRowSource and
 * lib/table-query.ts). Each expected value is written down by hand from
 * test/fixtures/peer-study/data_mutations.txt (Center, Validation_Status, n_alt_count, n_ref_count,
 * Variant_Type, Variant_Classification), data_cna.txt (the study's DISCRETE profile), data_sv.txt,
 * data_clinical_sample.txt (CANCER_TYPE), meta_study.txt (the study's name) and the Genome Nexus
 * records of test/fixtures/peer-hotspots.tsv (its `annotation` column: `canonical` and
 * `transcripts[].exon`), by the portal's rule (cbioportal-frontend e9d70fb) and PR G's decisions
 * for cBioLab. Row ids are the spec table's:
 *
 *   G  Gene: the row's gene; a fusion row site 1's symbol, '' when site 1 has none (GeneColumnFormatter, RVS 3749-3754).
 *   ST Study of Origin: the study's name.  CT Cancer Type: the sample's CANCER_TYPE.
 *   CN Copy #: the discrete CNA of (sample, gene) in the study's DISCRETE profile, as its label; NA → '';
 *      a fusion row reads site 1's gene (CN18); sorted by the number, searched by the label (Y4, CN12, CN13).
 *   VS Validation Status: the raw value (Y5); fusion rows ''.  CTR Center: raw; fusion rows 'N/A' (CTR3).
 *   AFN Allele Freq (N): alt / (alt + ref), 4 decimals below 0.01 else 2; null for 0, 0/0 or a missing count (Y6).
 *   RN the normal read counts: the integer when > 0, else null (Y7).
 *   EX Exon: the canonical transcript's `n/total` (Y3); '' when that transcript has none or there is no record;
 *      sorted by the number before '/'.
 *   VT Variant Type upper-cased for mutation rows too (Y8).
 *   T  Mutation Type: the row's value is the raw stored text (Y1, T23); search (T21), value lists and
 *      value filters (T22) and the sort (T20) run on the portal's label.
 *   O  the column order (O2, for the ids PR G adds, at the places its interface names); Y9 every new column hidden by default but copyNumber, which the portal shows (MUT-COL-38).
 *   Y10 missing values sort last both ways.
 *   N1-N5 Allele Freq (T) and the read counts as the portal writes them (MUT-STM-5/6): the vaf text is ''
 *      for none, 4 decimals below 0.01, else 2 with trailing zeros; the vaf value is that same text
 *      (null for none); altCount / refCount null when 0 or less.
 *   S1 the Protein Change and Chromosome sort keys (MUT-STM-9, lib/mutation-sort.ts proteinChangeSortSql /
 *      chromosomeSortSql) run in ClickHouse over literal inputs give the portal's values
 *      (ProteinChangeUtils calcProteinChangeSortValue; ChromosomeColumnFormatter extractSortValue).
 *   S2 sorted by Protein Change: by position, then the letters' character codes (KRAS G12C < G12D < G12V
 *      < G13D < Q61H, PTEN D92N < R130G < R130Q < X200_splice, EGFR in full); descending is the
 *      reverse, a change with no number (MUTATED) last both ways.
 *   S3 sorted by Chromosome: by the number, so PTEN's "chr10" row ties with its "10" rows and the
 *      tiebreak (sample id) orders all of them, both ways.
 *
 * Run: node --env-file=.env.local scripts/check-mutation-columns.ts (connection b must be the
 * fixture: `npm run peer-db` prints its CLICKHOUSE2_* lines).
 */
import { chQueryRows, connById } from "../lib/ch.ts";
import { PatientLevelResolver } from "../lib/federation.ts";
import * as mutationTable from "../lib/mutation-table.ts";
import { MUTATION_COLUMNS, MUTATION_DEFAULT_COLUMNS } from "../lib/mutation-table.ts";
import { chromosomeSortSql, proteinChangeSortSql } from "../lib/mutation-sort.ts";
import { sq } from "../lib/compiler.ts";
import { runMutations } from "../lib/views/mutations/run.ts";
import type { ViewRun } from "../lib/views/run.ts";
import type { CohortDef } from "../lib/types.ts";
import type { ColumnFilter } from "../lib/table-query.ts";

const STUDY = "cbiolab_peer_fixture";
/** meta_study.txt's name */
const STUDY_NAME = "cBioLab peer fixture (synthetic)";
const NSCLC = "Non-Small Cell Lung Cancer";

// Genome Nexus's stored release is read at the fixture's pin; the protein (length, domains) is asked
// of an address that refuses at once, so nothing leaves the machine
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

const resolver = new PatientLevelResolver(STUDY, { oncokbPin: null }, { id: conn.id, mode: "patient-level", label: "fixture", conn });
const WHOLE: CohortDef = { all: [] };
const ctxFor = (values?: string): ViewRun => ({
  doc: { study: STUDY, cohorts: { c: WHOLE }, views: [] },
  cohorts: { c: { studies: [STUDY], perStudy: {} } },
  resolvers: { [STUDY]: resolver },
  vNames: ["c"], vStudies: [STUDY],
  participationFor: () => ({}),
  pin: null, studyProfiles: async () => ({ profiles: [], gaProfiles: [] }),
  ...(values ? { values } : {})
} as unknown as ViewRun);

type Value = string | number | null;
type TableRow = { sample: string; values: Value[] };
type Query = { columns?: string[]; search?: string; filters?: Record<string, ColumnFilter>; sort?: { column: string; desc?: boolean } };
type Result = { mutations?: { rows: TableRow[]; shown?: string[]; values?: { values?: { value: string; n: number }[] } }; error?: string };

const col = (id: string) => MUTATION_COLUMNS.findIndex((c) => c.id === id);
const v = (r: TableRow, id: string): Value | undefined => (col(id) < 0 ? undefined : r.values[col(id)]);
const run = async (gene: string, q: Query = {}, values?: string): Promise<Result | string> => {
  try {
    const res = await runMutations({ kind: "mutations", gene, cohorts: ["c"], rows: 1000, ...q }, ctxFor(values)) as Result;
    if (!res.mutations) return "refused: " + String(res.error || JSON.stringify(res).slice(0, 200));
    return res;
  } catch (e) { return "threw: " + String((e as Error).message).slice(0, 200); }
};
const table = async (gene: string, q: Query = {}): Promise<TableRow[] | string> => {
  const r = await run(gene, q);
  return typeof r === "string" ? r : r.mutations!.rows;
};
const show = (x: unknown) => JSON.stringify(x === undefined ? "<no such column>" : x);

// ---- O, Y9: the columns ----------------------------------------------------------------------

const NEW: [string, string, string | RegExp, boolean | null][] = [
  // [id, name, header tooltip (exact, or a pattern for one with a legend), numeric (null: not checked)]
  ["gene", "Gene", "HUGO gene symbol", false],
  ["studyOfOrigin", "Study of Origin", "Study of Origin", false],
  ["cancerTypeAll", "Cancer Type", /./, false],
  ["copyNumber", "Copy #", /^Putative copy number call for the gene in this sample\. Hover over a value for details\./, null],
  ["validationStatus", "VS", /^Validation Status \(VS\): whether the mutation was confirmed by an independent validation experiment\./, false],
  ["center", "Center", "Center that sequenced or called the mutation", false],
  ["vafNormal", "Allele Freq (N)", "Variant allele frequency in the matched normal sample (variant reads / total reads)", true],
  ["normalAltCount", "Variant Reads (Normal)", "Number of reads supporting the variant allele in the matched normal sample", true],
  ["normalRefCount", "Ref Reads (Normal)", "Number of reads supporting the reference allele in the matched normal sample", true],
  ["exon", "Exon", "Exon affected by the mutation, from the Genome Nexus annotation of the selected transcript", false],
];
for (const [id, name, tip, numeric] of NEW) {
  const c = MUTATION_COLUMNS.find((x) => x.id === id);
  ok(`O2 column ${id} "${name}" exists`, !!c && c.name === name, c ? "name " + JSON.stringify(c.name) : "missing");
  if (!c) continue;
  ok(`${id} header tooltip is the portal's`, typeof tip === "string" ? c.tip === tip : tip.test(c.tip || ""), JSON.stringify(c.tip));
  if (numeric !== null) ok(`${id} numeric ${numeric}`, c.numeric === numeric, String(c.numeric));
  if (id === "copyNumber") ok("Y9 copyNumber shown by default (in MUTATION_DEFAULT_COLUMNS, MUT-COL-38)", MUTATION_DEFAULT_COLUMNS.includes(id), MUTATION_DEFAULT_COLUMNS.join(","));
  else ok(`Y9 ${id} hidden by default (not in MUTATION_DEFAULT_COLUMNS)`, !MUTATION_DEFAULT_COLUMNS.includes(id), MUTATION_DEFAULT_COLUMNS.join(","));
}
const legend = (id: string, words: string[]) => {
  const tip = MUTATION_COLUMNS.find((c) => c.id === id)?.tip || "";
  const missing = words.filter((w) => !tip.includes(w));
  ok(`${id} header tooltip carries the legend in words`, missing.length === 0, "missing " + JSON.stringify(missing));
};
legend("copyNumber", ["Amp", "High-level amplification", "Gain", "Low-level gain", "Diploid", "No copy number change",
  "ShallowDel", "Shallow (possibly heterozygous) deletion", "DeepDel", "Deep (possibly homozygous) deletion"]);
legend("validationStatus", ["Valid", "Confirmed by an independent validation method", "Wildtype", "Validation found the wildtype allele",
  "Unknown", "Not validated, or validation status unknown"]);
{
  const mt = MUTATION_COLUMNS.find((c) => c.id === "mutationType")?.tip || "";
  ok("T24 Mutation Type's header tooltip is the portal's", mt.startsWith("Consequence of the mutation on the protein (variant classification)."), JSON.stringify(mt.slice(0, 120)));
  legend("mutationType", ["Single amino acid substitution", "In-frame: adds or removes amino acids without a frameshift", "Truncates the protein",
    "Premature stop codon", "Loss of the stop codon", "Loss of the start codon", "Frameshift: shifts the reading frame",
    "Frameshift deletion: shifts the reading frame", "Frameshift insertion: shifts the reading frame",
    "In-frame insertion: adds amino acids without a frameshift", "In-frame deletion: removes amino acids without a frameshift",
    "Affects a splice site", "Gene fusion", "No change to the amino acid sequence"]);
  const vt = MUTATION_COLUMNS.find((c) => c.id === "variantType")?.tip || "";
  ok("VT4 Variant Type's header tooltip is the portal's", vt.startsWith("Type of change at the DNA level (variant type)."), JSON.stringify(vt.slice(0, 120)));
  legend("variantType", ["Single Nucleotide Polymorphism", "Di-Nucleotide Polymorphism", "Tri-Nucleotide Polymorphism",
    "Oligo-Nucleotide Polymorphism", "Insertion", "Deletion"]);
}

// O2 at the places the interface names: Gene, Study of Origin, Cancer Type first; each other new
// column straight after its neighbour; the existing columns keep their order
const ids = MUTATION_COLUMNS.map((c) => c.id);
const NEW_IDS = NEW.map((n) => n[0]);
ok("O2 Gene, Study of Origin, Cancer Type are the first three columns, then Sample ID",
  ids.slice(0, 4).join(",") === "gene,studyOfOrigin,cancerTypeAll,sample", ids.slice(0, 4).join(","));
for (const [after, id] of [["variantType", "copyNumber"], ["status", "validationStatus"], ["validationStatus", "center"], ["vaf", "vafNormal"],
  ["refCount", "normalAltCount"], ["normalAltCount", "normalRefCount"], ["mutCount", "exon"]]) {
  ok(`O2 ${id} directly after ${after}`, ids.indexOf(id) >= 0 && ids.indexOf(id) === ids.indexOf(after) + 1, ids.join(","));
}
const BEFORE = ["sample", "cancerType", "proteinChange", "proteinPos", "annotation", "functionalImpact", "mutationType", "alteration", "variantType",
  "vaf", "altCount", "refCount", "mutCount", "chr", "start", "end", "ref", "var", "hgvsg", "hgvsc", "status", "gnomad", "clinvar", "dbsnp", "signal"];
ok("O5 the existing columns keep their order (Protein Position and Alteration where they are)",
  ids.filter((i) => !NEW_IDS.includes(i)).join(",") === BEFORE.join(","), ids.filter((i) => !NEW_IDS.includes(i)).join(","));

{
  const res = await run("TP53");
  const shown = typeof res === "string" ? null : res.mutations!.shown;
  ok("Y9 a view naming no columns shows none of the new ones but copyNumber", !!shown && NEW_IDS.every((i) => i === "copyNumber" || !shown.includes(i)), typeof res === "string" ? res : JSON.stringify(shown));
  ok("Y9 a view naming no columns shows copyNumber (MUT-COL-38)", !!shown && shown.includes("copyNumber"), typeof res === "string" ? res : JSON.stringify(shown));
}

// ---- each column's values, row by row ----------------------------------------------------------

/** [gene tab, sample, protein change, expected values by column id, why] — every row with that key */
type Want = [string, string, string, Record<string, Value>, string];
const TP53 = { gene: "TP53", studyOfOrigin: STUDY_NAME, cancerTypeAll: NSCLC };
const WANT: Want[] = [
  ["TP53", "FX-P01-T1", "R273H", { ...TP53, copyNumber: "Diploid", validationStatus: "Valid", center: "broad.mit.edu", vafNormal: 0.02, normalAltCount: 7,
    normalRefCount: 350, exon: "", variantType: "SNP", mutationType: "Missense_Mutation" },
  "G ST CT; CN5 0 → Diploid; VS raw; CTR raw; AFN 7/357 = 0.0196 → 0.02; RN; EX no record; T Y1 the raw type"],
  ["TP53", "FX-P03-T1", "R175H", { ...TP53, validationStatus: "Untested", center: ".", vafNormal: 0.0036, normalAltCount: 1, normalRefCount: 280 },
    "VS5 raw 'Untested'; CTR2 '.' as stored; AFN4 1/281 = 0.00356 → 4 decimals below 0.01"],
  ["TP53", "FX-P05-T1", "R248Q", { validationStatus: "Unknown", center: "NA", vafNormal: null, normalAltCount: null, normalRefCount: 428 },
    "VS4 raw; CTR a blank Center is stored NA; AFN5 0 alt reads → null; RN4 0 → null"],
  ["TP53", "FX-P07-T1", "R273H", { copyNumber: "ShallowDel", validationStatus: "VALIDATED", center: "FIXTURE", vafNormal: null, normalAltCount: null, normalRefCount: 301 },
    "CN6 -1 → ShallowDel; VS2 raw any case; AFN6 the alt count missing → null"],
  ["TP53", "FX-P09-T1", "R175H", { vafNormal: 0.25, normalAltCount: 128, normalRefCount: 385, validationStatus: "NA" },
    "AFN4 128/513 = 0.2495 → 0.25; VS a file without the value stores NA, shown raw"],
  ["TP53", "FX-P10-T1", "R273H", { vafNormal: null, normalAltCount: null, normalRefCount: null }, "AFN6 0/0 → null; RN4 0 → null"],
  ["TP53", "FX-P21-T1", "SP1", { variantType: "SNP" }, "VT1 Y8 a mutation row's variant type upper-cased (stored 'snp')"],
  ["TP53", "FX-P24-T1", "SP9", { variantType: "DNP" }, "VT1 DNP"],
  ["TP53", "FX-P30-T1", "R175H", { copyNumber: "ShallowDel" }, "CN6"],
  ["KRAS", "FX-P08-T1", "G12V", { gene: "KRAS", studyOfOrigin: STUDY_NAME, cancerTypeAll: NSCLC, copyNumber: "Gain", center: "FIXTURE" }, "G; CN4 1 → Gain"],
  ["KRAS", "FX-P01-T1", "G12C", { copyNumber: "Diploid" }, "CN5"],
  ["EGFR", "FX-P23-T1", "L858R", { copyNumber: "Amp" }, "CN3 2 → Amp"],
  ["EGFR", "FX-P33-T1", "L858R", { copyNumber: "" }, "CN10 NA in the profile → ''"],
  ["EGFR", "FX-P22-T1", "E746_A750del", { variantType: "DEL", mutationType: "In_Frame_Del" }, "VT DEL; T Y1 raw"],
  ["EGFR", "FX-P24-T1", "SP10fs", { variantType: "INS", mutationType: "Frame_Shift_Ins" }, "VT INS; T Y1 raw"],
  ["EGFR", "FX-P44-T1", "EGFR-SEPT14", { mutationType: "Fusion", variantType: "NA", copyNumber: "Diploid" }, "T13 a MAF row typed Fusion keeps its raw type; VT a blank Variant_Type is stored NA"],
  ["EGFR", "FX-P44-T1", "MUTATED", { mutationType: "Splice_Region" }, "T Y1 raw"],
  ["CDKN2A", "FX-P29-T1", "D84Y", { copyNumber: "DeepDel", gene: "CDKN2A" }, "CN7 -2 → DeepDel"],
  ["MYC", "FX-P29-T1", "P57S", { copyNumber: "Diploid", exon: "" }, "CN5; EX5 a record with no transcripts"],
  ["H3-3A", "FX-P29-T1", "G35R", { copyNumber: "" }, "CN10 a gene the profile does not hold"],
  ["STK11", "FX-P39-T1", "Q37*", { mutationType: "nonsense" }, "T Y1 the raw type, lower case kept"],
  ["STK11", "FX-P29-T1", "F354L", { exon: "8/10" }, "EX3 Y3 the canonical transcript's n/total"],
  ["STK11", "FX-P29-T1", "X200_splice", { exon: "" }, "EX5 the canonical transcript has no exon (Splice_Site); no record (Splice_Region)"],
  ["STK11", "FX-P10-T1", "Q37*", { exon: "" }, "EX6 no Genome Nexus record"],
  ["ATM", "FX-P29-T1", "A1100S", { exon: "17/63" }, "EX3 the canonical transcript's exon, not the first transcript's (5/62)"],
  ["ATM", "FX-P29-T1", "R2000C", { exon: "9/63", mutationType: "" }, "EX3; T18 a row with no type: ''"],
  ["ATM", "FX-P29-T1", "R1500C", { exon: "31/63" }, "EX3"],
  ["NF1", "FX-P29-T1", "R304Q", { exon: "" }, "EX5 the record's only transcript is not the gene's canonical one"],
  ["BRAF", "FX-P29-T1", "D594G", { exon: "15/18", copyNumber: "Diploid" }, "EX3"],
];

const tabs = new Map<string, TableRow[] | string>();
const tab = async (gene: string) => { if (!tabs.has(gene)) tabs.set(gene, await table(gene)); return tabs.get(gene)!; };

for (const [gene, sample, change, want, why] of WANT) {
  const rows = await tab(gene);
  const name = `${gene} ${sample} ${change}: ${why}`;
  if (typeof rows === "string") { ok(name, false, rows); continue; }
  const hits = rows.filter((r) => r.sample === sample && v(r, "proteinChange") === change);
  if (!hits.length) { ok(name, false, "no such row"); continue; }
  const bad: string[] = [];
  for (const r of hits) for (const [id, w] of Object.entries(want)) if (v(r, id) !== w) bad.push(id + " " + show(v(r, id)) + " (expected " + JSON.stringify(w) + ")");
  ok(name, bad.length === 0, bad.join("; "));
}

// ---- fusion rows -----------------------------------------------------------------------------

/** [gene tab, sample, protein change, Gene, Cancer Type, Variant Type, why] */
const FUSIONS: [string, string, string, string, string, string, string][] = [
  ["EML4", "FX-P45-T1", "EML4-ALK Fusion", "EML4", NSCLC, "FUSION", "G3 site 1's symbol"],
  ["EML4", "FX-P47-T1", "EML4-ALK Fusion", "EML4", "", "FUSION", "CT no CANCER_TYPE: ''"],
  ["EML4", "FX-P48-T1", "EML4-ALK Fusion", "EML4", "Lung Cancer", "FUSION", "CT the sample's own CANCER_TYPE"],
  ["ALK", "FX-P45-T1", "EML4-ALK Fusion", "EML4", NSCLC, "FUSION", "G3 site 1's symbol on site 2's tab too"],
  ["MET", "FX-P50-T1", "MET intragenic", "", NSCLC, "DUPLICATION", "G3 site 1 has no gene: ''"],
  ["BRAF", "FX-P53-T1", "KIAA1549-BRAF Fusion", "KIAA1549", NSCLC, "FUSION",
    "G3; CN18 Copy # is site 1's gene (KIAA1549, not profiled: ''), not the tab's BRAF (0 in that sample: Diploid)"],
];
const FUSION_BLANK: Record<string, Value> = {
  studyOfOrigin: STUDY_NAME, copyNumber: "", validationStatus: "", center: "N/A", vafNormal: null, normalAltCount: null, normalRefCount: null, exon: "", mutationType: "Fusion"
};
for (const [gene, sample, change, g, ct, vt, why] of FUSIONS) {
  const rows = await tab(gene);
  const name = `${gene} fusion ${sample} ${change}: ${why}; ST; VS6 CTR3 AFN8 RN4 EX10 blank or N/A; Y2 Fusion`;
  if (typeof rows === "string") { ok(name, false, rows); continue; }
  const r = rows.find((x) => x.sample === sample && v(x, "proteinChange") === change);
  if (!r) { ok(name, false, "no such row"); continue; }
  const want: Record<string, Value> = { ...FUSION_BLANK, gene: g, cancerTypeAll: ct, variantType: vt };
  const bad = Object.entries(want).filter(([id, w]) => v(r, id) !== w).map(([id, w]) => id + " " + show(v(r, id)) + " (expected " + JSON.stringify(w) + ")");
  ok(name, bad.length === 0, bad.join("; "));
}

// ---- T21 T22: search, value list and value filter on the Mutation Type label -------------------

// STK11's 12 rows: 8 Nonsense (7 Nonsense_Mutation, FX-P39-T1 stored 'nonsense'), 2 Missense_Mutation,
// Splice_Site and Splice_Region
const STK11_N = 12;
const count = async (gene: string, q: Query) => { const r = await table(gene, q); return typeof r === "string" ? r : r.length; };
for (const [q, n, why] of [
  ["missense", 2, "T21 the label 'Missense' contains it"],
  ["Missense_Mutation", 0, "T21 the raw type is not searched"],
  ["mutation", 0, "T21 no label contains 'mutation'"],
  ["nonsense", 8, "T21 'Nonsense', both spellings"],
  ["splice", 2, "T21 'Splice', both Splice_Site and Splice_Region"],
] as [string, number, string][]) {
  const got = await count("STK11", { columns: ["sample", "mutationType"], search: q });
  ok(`STK11 search "${q}" over Sample ID and Mutation Type: ${n} rows (${why})`, got === n, String(got));
}
{
  const all = await count("STK11", {});
  ok(`fixture: STK11 has ${STK11_N} rows`, all === STK11_N, String(all));
}
{
  const res = await run("STK11", {}, "mutationType");
  const vals = typeof res === "string" ? res : (res.mutations!.values?.values || []).map((x) => x.value + ":" + x.n).sort().join(", ");
  ok("T22 Mutation Type's value list is the labels: Missense 2, Nonsense 8, Splice 2", vals === "Missense:2, Nonsense:8, Splice:2", String(vals));
}
for (const [values, n, why] of [
  [["Nonsense"], 8, "the label, both spellings"],
  [["Nonsense_Mutation"], 0, "the raw type is not a value"],
  [["Missense", "Splice"], 4, "two labels"],
] as [string[], number, string][]) {
  const got = await count("STK11", { filters: { mutationType: { values } } });
  ok(`T22 STK11 filter Mutation Type in ${JSON.stringify(values)}: ${n} rows (${why})`, got === n, String(got));
}
{
  const got = await count("TP53", { columns: ["sample", "copyNumber"], search: "shallowdel" });
  ok("CN13 TP53 search 'shallowdel' over Sample ID and Copy #: 4 rows (FX-P07, FX-P19, FX-P30 ×2)", got === 4, String(got));
  const none = await count("TP53", { columns: ["sample", "copyNumber"], search: "-1" });
  ok("CN13 the number is not searched: '-1' matches no row", none === 0, String(none));
}

// ---- sorting -----------------------------------------------------------------------------------

const sorted = async (gene: string, column: string, desc: boolean) => {
  const r = await table(gene, { sort: { column, ...(desc ? { desc: true } : {}) } });
  return typeof r === "string" ? r : r.map((x) => v(x, column));
};
/** the fixture's raw types and their labels, written down here, not read from the code */
const LABEL: Record<string, string> = { Missense_Mutation: "Missense", Nonsense_Mutation: "Nonsense", nonsense: "Nonsense", Splice_Site: "Splice", Splice_Region: "Splice" };
for (const desc of [false, true]) {
  const got = await sorted("STK11", "mutationType", desc);
  const labels = typeof got === "string" ? got : got.map((x) => LABEL[String(x)] ?? "?" + String(x)).join(",");
  const groups = [["Missense", 2], ["Nonsense", 8], ["Splice", 2]] as [string, number][];
  const want = (desc ? [...groups].reverse() : groups).flatMap(([l, n]) => Array(n).fill(l)).join(",");
  ok(`T20 STK11 sorted by Mutation Type ${desc ? "descending" : "ascending"}: by the label (raw 'nonsense' among the Nonsense rows, not after Splice_Site)`,
    labels === want, String(labels));
}

const CN_RANK: Record<string, number> = { DeepDel: -2, ShallowDel: -1, Diploid: 0, Gain: 1, Amp: 2 };
/** values in order with the blanks (null or '') last, the rest monotone by `rank` */
const ordered = (got: (Value | undefined)[], rank: (x: Value) => number, desc: boolean) => {
  const firstBlank = got.findIndex((x) => x == null || x === "");
  const head = firstBlank < 0 ? got : got.slice(0, firstBlank);
  const tail = firstBlank < 0 ? [] : got.slice(firstBlank);
  const mono = head.every((x, i) => i === 0 || (desc ? rank(head[i - 1] as Value) >= rank(x as Value) : rank(head[i - 1] as Value) <= rank(x as Value)));
  return mono && tail.every((x) => x == null || x === "");
};
for (const desc of [false, true]) {
  const got = await sorted("EGFR", "copyNumber", desc);
  const pass = typeof got !== "string" && got.every((x) => x === "" || (typeof x === "string" && x in CN_RANK)) &&
    ordered(got, (x) => CN_RANK[String(x)], desc) && got.filter((x) => x === "Amp").length === 2 && got.filter((x) => x === "").length >= 3 &&
    got.includes("Diploid");
  ok(`CN12 Y4 EGFR sorted by Copy # ${desc ? "descending" : "ascending"}: by the number (Diploid ${desc ? "after" : "before"} Amp), NA last`,
    pass, typeof got === "string" ? got : JSON.stringify(got));
}
{
  const got = await sorted("TP53", "copyNumber", false);
  ok("CN12 TP53 ascending: the four ShallowDel rows first, then Diploid", typeof got !== "string" &&
    got.slice(0, 4).every((x) => x === "ShallowDel") && got.slice(4).every((x) => x === "Diploid"), typeof got === "string" ? got : JSON.stringify(got));
}
for (const [desc, head] of [[false, ["9/63", "17/63", "31/63"]], [true, ["31/63", "17/63", "9/63"]]] as [boolean, string[]][]) {
  const got = await sorted("ATM", "exon", desc);
  ok(`EX7 Y3 ATM sorted by Exon ${desc ? "descending" : "ascending"}: by the number before '/' (${head.join(", ")}), blanks last`,
    typeof got !== "string" && got.slice(0, 3).join(",") === head.join(",") && got.slice(3).every((x) => x === "" || x == null),
    typeof got === "string" ? got : JSON.stringify(got));
}
for (const [desc, head] of [[false, [0.0036, 0.02, 0.25]], [true, [0.25, 0.02, 0.0036]]] as [boolean, number[]][]) {
  const got = await sorted("TP53", "vafNormal", desc);
  ok(`Y6 Y10 TP53 sorted by Allele Freq (N) ${desc ? "descending" : "ascending"}: ${head.join(", ")}, then the rows without one (0, 0/0, missing)`,
    typeof got !== "string" && got.slice(0, 3).join(",") === head.join(",") && got.length > 3 && got.slice(3).every((x) => x == null),
    typeof got === "string" ? got : JSON.stringify(got));
}

// ---- N1-N5: Allele Freq (T) and the read counts as the portal writes them -------------------------

{
  // N1 the vaf text rule (lib/mutation-table.ts VAF_TEXT, which the rows select as vafText) over constant values
  const vafText = (mutationTable as Record<string, unknown>).VAF_TEXT as string | undefined;
  // a 0 frequency never reaches the rule: the row SQL makes vaf NULL when the alt count is 0 or less (N3)
  const N1: [number | null, string][] = [[0.31, "0.31"], [0.5, "0.50"], [0.0098, "0.0098"], [0.00004, "0.0000"], [0.999, "1.00"],
    [0.005, "0.0050"], [0.125, "0.13"], [null, ""]];
  if (!vafText) ok("N1 lib/mutation-table.ts exports VAF_TEXT, the vaf text rule", false, "not exported");
  else {
    let got: string;
    try {
      const sql = "SELECT i, toString(" + vafText + ") AS t FROM (SELECT arrayJoin(arrayEnumerate(xs)) AS i, xs[i] AS vaf FROM (SELECT CAST([" +
        N1.map(([x]) => x === null ? "NULL" : String(x)).join(", ") + "] AS Array(Nullable(Float64))) AS xs)) ORDER BY i";
      const res = await chQueryRows(sql, conn);
      got = JSON.stringify(res.rows.map((r) => r[1] == null ? "" : String(r[1])));
    } catch (e) { got = "threw: " + String((e as Error).message).slice(0, 200); }
    ok("N1 the vaf text over " + JSON.stringify(N1.map((n) => n[0])) + " is " + JSON.stringify(N1.map((n) => n[1])), got === JSON.stringify(N1.map((n) => n[1])), got);
  }
}
{
  // N2 the value is the portal's text of t_alt_count / (t_alt_count + t_ref_count), worked out by hand;
  // the fixture has no tumor ratio below 0.01
  const N2: [string, string, string, string, string][] = [
    ["TP53", "FX-P01-T1", "R273H", "0.13", "79/601 = 0.1314"],
    ["TP53", "FX-P09-T1", "R175H", "0.30", "175/580 = 0.3017, trailing zero kept"],
    ["TP53", "FX-P13-T1", "R273H", "0.10", "68/671 = 0.1013, trailing zero kept"],
    ["KRAS", "FX-P01-T1", "G12C", "0.37", "88/239 = 0.3682"],
  ];
  for (const [gene, sample, change, want, why] of N2) {
    const rows = await tab(gene);
    const name = `N2 ${gene} ${sample} ${change}: vaf is the text ${JSON.stringify(want)} (${why})`;
    if (typeof rows === "string") { ok(name, false, rows); continue; }
    const r = rows.find((x) => x.sample === sample && v(x, "proteinChange") === change);
    const got = r ? v(r, "vaf") : "no such row";
    ok(name, got === want, show(got));
  }
  // its text as N1: TP53's only rows written "0.30" (FX-P09, 0.3017) and "0.10" (FX-P13, 0.1013), trailing zero kept
  for (const [q, n] of [["0.30", 1], ["0.10", 1]] as [string, number][]) {
    const got = await count("TP53", { columns: ["sample", "vaf"], search: q });
    ok(`N2 TP53 search "${q}" over Sample ID and Allele Freq: ${n} row (2 decimals with the trailing zero)`, got === n, String(got));
  }
}
// N3-N5: every tumor row of the fixture has both counts > 0 (t_alt_count 19..317, t_ref_count 96..639); zero,
// negative and missing counts are checked in test/mutation-number-format.test.ts

// ---- S1-S3: the Protein Change and Chromosome sort keys (MUT-STM-9) -----------------------------

{
  // S1 each key's SQL over literal inputs; the values are the legacy functions' outputs, written down by hand
  const PC: [string | null, number | null][] = [
    ["V600E", 600.8669], ["V600K", 600.8675], ["A600T", 600.6584], ["V601A", 601.8665], ["V600", 600.86],
    ["G12_G13insX", 12.7195], ["X37_splice", 37.8895], ["*123", 123], ["", null], [null, null], ["Fusion", null],
    ["TMPRSS2-ERG Fusion", 2.8345], ["EGFR-SEPT14 Fusion", 14.8432], ["R130G", 130.8271], ["R130Q", 130.8281],
    ["p.V600E", 600.8669], ["M1?", 1.7763], ["E746_A750del", 746.6995], ["SP10fs", 10.80102], ["SP3", 3], ["1234", 1234],
    ["G12C", 12.7167], ["G12D", 12.7168], ["G12V", 12.7186], ["G13D", 13.7168], ["Q61H", 61.8172],
  ];
  const CHR: [string | null, number | null][] = [
    ["17", 17], ["chr10", 10], ["X", 23], ["x", 23], ["chrX", 23], ["Y", 24], ["chrY", 24], ["XY", 23],
    ["MT", -1], ["M", -1], ["Un", -1], ["", null], [null, null], ["1_KI270706v1_random", 1], ["23", 23],
    ["1", 1], ["2", 2], ["10", 10],
  ];
  // ClickHouse's decimal parse can land one ulp from JavaScript's parseFloat (relative 2e-16 over the
  // warehouse's 936,457 protein changes, none of them reordered), so a value is matched within 1e-12
  const same = (g: number | null, w: number | null) => g === w || (g != null && w != null && Math.abs(g - w) <= 1e-12 * Math.abs(w));
  const evalKey = async (name: string, expr: (x: string) => string, cases: [string | null, number | null][]) => {
    let got: (number | null)[] | string;
    try {
      const sql = "SELECT i, toString(" + expr("x") + ") AS k FROM (SELECT arrayJoin(arrayEnumerate(xs)) AS i, xs[i] AS x FROM (SELECT CAST([" +
        cases.map(([x]) => x === null ? "NULL" : sq(x)).join(", ") + "] AS Array(Nullable(String))) AS xs)) ORDER BY i";
      const res = await chQueryRows(sql, conn);
      got = res.rows.map((r) => r[1] == null ? null : Number(r[1]));
    } catch (e) { got = "threw: " + String((e as Error).message).slice(0, 200); }
    const bad = typeof got === "string" ? [got] :
      cases.flatMap(([x, w], i) => same((got as (number | null)[])[i], w) ? [] : [JSON.stringify(x) + " → " + String((got as (number | null)[])[i]) + " (expected " + String(w) + ")"]);
    ok(`S1 ${name} over ${cases.length} literal inputs gives the portal's sort values`, bad.length === 0, bad.join("; "));
  };
  await evalKey("proteinChangeSortSql", proteinChangeSortSql, PC);
  await evalKey("chromosomeSortSql", chromosomeSortSql, CHR);
}
{
  // S2 sorted by Protein Change. KRAS and PTEN: the changes in order, each change's rows together.
  // EGFR: every row of data_mutations.txt (HGVSp_Short without "p.", a blank one stored MUTATED), by the
  // legacy value: SP3 3, SP4 4, SP7 7, SP10fs 10.80102, SP11 11.8, SP12 12.8, EGFR-SEPT14 14.84,
  // A289V 289.6586, G719A 719.7165, E746_A750del 746.6995 (×4), S768I 768.8373, V769M 769.8677,
  // T790M 790.8477, C797S 797.6783, L858R 858.7682 (×12), L861Q 861.7681, MUTATED null (last)
  const runs = (xs: (Value | undefined)[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);
  const NULLS = ["MUTATED"];
  const EGFR = ["SP3", "SP4", "SP7", "SP10fs", "SP11", "SP12", "EGFR-SEPT14", "A289V", "G719A",
    ...Array(4).fill("E746_A750del"), "S768I", "V769M", "T790M", "C797S", ...Array(12).fill("L858R"), "L861Q", "MUTATED"];
  const WANT_PC: [string, string[], boolean, string][] = [
    ["KRAS", ["G12C", "G12D", "G12V", "G13D", "Q61H"], false, "the G12 rows by their letter, not tied on the codon"],
    ["PTEN", ["D92N", "R130G", "R130Q", "X200_splice"], false, "R130G before R130Q by the letter"],
    ["EGFR", EGFR, true, "every row, MUTATED (no number) last"],
  ];
  for (const [gene, want, full, why] of WANT_PC) {
    for (const desc of [false, true]) {
      const got = await sorted(gene, "proteinChange", desc);
      const head = want.filter((x) => !NULLS.includes(x)), tail = want.filter((x) => NULLS.includes(x));
      const exp = [...(desc ? [...head].reverse() : head), ...tail];
      const seen = typeof got === "string" ? got : JSON.stringify(full ? got : runs(got));
      ok(`S2 ${gene} sorted by Protein Change ${desc ? "descending" : "ascending"}: ${full ? "" : "the changes "}${JSON.stringify(full ? exp : runs(exp))} (${why})`,
        seen === JSON.stringify(full ? exp : runs(exp)), seen);
    }
  }
}
{
  // S3 PTEN's rows are on "10" but FX-P29's R130G on "chr10": all sort as 10, so the tiebreak (sample id)
  // orders them both ways; a text sort would put the chr10 row after every "10" row ascending and before them descending
  for (const desc of [false, true]) {
    const r = await table("PTEN", { sort: { column: "chr", ...(desc ? { desc: true } : {}) } });
    if (typeof r === "string") { ok(`S3 PTEN sorted by Chromosome ${desc ? "descending" : "ascending"}`, false, r); continue; }
    const chrs = r.map((x) => v(x, "chr")), sids = r.map((x) => x.sample);
    const pass = chrs.includes("chr10") && chrs.includes("10") && chrs.every((c) => c === "10" || c === "chr10") &&
      sids.every((s, i) => i === 0 || sids[i - 1] <= s);
    ok(`S3 PTEN sorted by Chromosome ${desc ? "descending" : "ascending"}: "chr10" ties with "10", so the rows are in sample id order`,
      pass, JSON.stringify(r.map((x) => x.sample + " " + String(v(x, "chr")))));
  }
}

console.log(`\n${checks - failures}/${checks} mutation column checks passed`);
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
