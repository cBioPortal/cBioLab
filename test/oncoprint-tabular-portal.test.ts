// The oncoprint's Tabular download and order file (ONC-DL-3, ONC-DL-4) against the case table cited to
// legacy cbioportal-frontend cd8c6df, written without the implementation in view:
//   TD  = src/shared/components/oncoprint/tabularDownload.ts (getTabularDownloadData 12-252, file name 255-282)
//   RVO = src/shared/components/oncoprint/ResultsViewOncoprint.tsx (order file 1046-1085, tabular 1086-1120)
//   DU  = src/shared/components/oncoprint/DataUtils.ts (fillGeneticTrackDatum 161-249, mutRenderPriority 42-55)
// The portal writes one row group per alteration kind (CLINICAL, CNA, MUTATIONS, MRNA, PROTEIN,
// STRUCTURAL_VARIANT, then one per heatmap type), a row per gene in each, and one display value per
// cell. Rows marked "ours" are deliberate divergences, asserted as ours.
//
// Contracts are built through the engine (events in, TSV out) except for the column-order cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tabular from "../lib/oncoprint-tabular.ts";
import { assembleContract, normalizeDisplay, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";
import type { Contract } from "../lib/types.ts";

type Ev = EventRow & { driver?: boolean };
type Clinical = { attr: string; values: Map<string, string>; name?: string };
type Heatmap = AssembleInput["heatmap"][number] & { profileKind?: string };
interface Fixture {
  cols?: string[];
  genes?: AssembleInput["genes"];
  events?: Ev[];
  clinical?: Clinical[];
  heatmap?: Heatmap[];
  derived?: { label: string; pids: Set<string> }[];
  /** annotation on (default) or off (display.annotate "none") */
  annotate?: boolean;
  /** columns no panel covers: every gene not profiled there */
  unprofiled?: string[];
  unit?: "patient" | "sample";
  studies?: string[];
  studyOf?: Map<string, string>;
}

const members = (genes: AssembleInput["genes"]): string[] =>
  genes.flatMap((g) => (typeof g === "string" ? [g] : (g as { genes: string[] }).genes));

function build(f: Fixture): Contract {
  const cols = f.cols ?? ["A", "B"], genes = f.genes ?? ["TP53"], all = members(genes);
  const annotate = f.annotate ?? true;
  const c = assembleContract({
    genes, groups: [{ name: "all", pids: cols }], studies: f.studies ?? ["s"], ...(f.studyOf ? { studyOf: f.studyOf } : {}),
    events: f.events ?? [],
    coverage: cols.filter((p) => !(f.unprofiled ?? []).includes(p)).map((pid) => ({ pid, genes: all })),
    // annotation off: the driver callback calls nothing a driver, as lib/annotation.ts does
    isDriver: (r) => annotate && !!(r as Ev).driver, annotationSource: "t",
    clinical: (f.clinical ?? []) as AssembleInput["clinical"], heatmap: (f.heatmap ?? []) as AssembleInput["heatmap"],
    derived: f.derived ?? [], sort: [{ track: "id", dir: "asc" }], lineGap: 0,
    ...(f.unit ? { unit: f.unit } : {}),
    display: normalizeDisplay(annotate ? {} : { annotate: "none" })
  });
  assert.equal(c.display.annotate !== "none", annotate, "fixture: annotation " + (annotate ? "on" : "off"));
  return c;
}

const toTsv = (c: Contract, order?: number[]): string =>
  (tabular.contractToTsv as (c: Contract, order?: number[]) => string)(c, order);

/** the TSV's lines as cells; every line ends in \n (T30), so the text minus its last \n splits clean */
function parse(tsv: string): string[][] {
  assert.ok(tsv.endsWith("\n"), "the file ends in \\n");
  return tsv.slice(0, -1).split("\n").map((l) => l.split("\t"));
}

/** the row `name` of group `type`, as column id -> value; fails when there is no such row */
function rowOf(tsv: string, type: string, name: string): Record<string, string> {
  const [header, ...rows] = parse(tsv);
  const hits = rows.filter((r) => r[0] === name && r[1] === type);
  assert.equal(hits.length, 1, `one row '${name}' of type '${type}'; rows: ${rows.map((r) => r[0] + " | " + r[1]).join("; ")}`);
  assert.equal(hits[0].length, header.length, "the row has a cell per header column");
  return Object.fromEntries(header.slice(2).map((id, i) => [id, hits[0][i + 2]]));
}

/** one cell: column `col` of row `name` in group `type` */
function cellOf(tsv: string, type: string, name: string, col: string): string {
  const row = rowOf(tsv, type, name);
  assert.ok(col in row, `column ${col} is in the header: ${Object.keys(row).join(",")}`);
  return row[col];
}

const GENETIC = ["CNA", "MUTATIONS", "MRNA", "PROTEIN", "STRUCTURAL_VARIANT"];
const mut = (pid: string, mt: string, driver = false, gene = "TP53"): Ev => ({ pid, gene, vt: "mutation", mt, driver });
const cna = (pid: string, v: number, driver = false, gene = "TP53"): Ev => ({ pid, gene, vt: "cna", cna: v, driver });
const sv = (pid: string, driver = false, gene = "TP53"): Ev => ({ pid, gene, vt: "structural_variant", driver });
const values = (o: Record<string, string>) => new Map(Object.entries(o));
const hmValues = (gene: string, o: Record<string, number>) => new Map(Object.entries(o).map(([p, v]): [string, number] => [p + "|" + gene, v]));

const MISSENSE = "Missense_Mutation", TRUNC = "Nonsense_Mutation", INFRAME = "In_Frame_Del", SPLICE = "Splice_Site",
  PROMOTER = "Promoter", OTHER = "Translation_Start_Site";

// ---- T1-T4: the layout -------------------------------------------------------------------------

test("T1: header is track_name, track_type, then one id per drawn column in the drawn order (TD 225-233)", () => {
  const c = build({ cols: ["P3", "P1", "P2"] });
  const [header] = parse(toTsv(c));
  assert.deepEqual(header, ["track_name", "track_type", ...c.columns]);
  assert.equal(c.columns.length, 3);
  // a hand-built contract whose columns are in no sorted order: the header keeps the contract's order
  const hand = { ...c, columns: ["Z", "A", "M"] } as Contract;
  assert.deepEqual(parse(toTsv(hand))[0], ["track_name", "track_type", "Z", "A", "M"]);
});

test("T2: row groups in order: CLINICAL, CNA, MUTATIONS, MRNA, PROTEIN, STRUCTURAL_VARIANT (a row per gene each), heatmap types in order first met, DERIVED last (TD 30-37, 236-250)", () => {
  const c = build({
    genes: ["TP53", "KRAS"],
    events: [mut("A", MISSENSE), cna("B", 2, false, "KRAS")],
    clinical: [{ attr: "SEX", name: "Sex", values: values({ A: "Female", B: "Male" }) }],
    heatmap: [
      { profileType: "mrna_zscore", profileKind: "MRNA_EXPRESSION Z-SCORE", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 1, B: -1 }) },
      { profileType: "methylation_hm450", profileKind: "METHYLATION CONTINUOUS", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 0.5 }) }],
    derived: [{ label: "Any driver", pids: new Set(["A"]) }]
  });
  const rows = parse(toTsv(c)).slice(1).map((r) => [r[0], r[1]]);
  assert.deepEqual(rows, [
    ["Sex", "CLINICAL"],
    ...GENETIC.flatMap((g) => [["TP53", g], ["KRAS", g]]),
    ["TP53", "HEATMAP MRNA_EXPRESSION Z-SCORE"],
    ["TP53", "HEATMAP METHYLATION CONTINUOUS"],
    ["Any driver", "DERIVED"]
  ]);
});

test("T3: a gene with nothing of a kind (MRNA, PROTEIN never loaded) still has its row in all five genetic groups, cells empty (TD 94-112)", () => {
  const tsv = toTsv(build({ cols: ["A", "B"] }));
  for (const g of GENETIC) assert.deepEqual(rowOf(tsv, g, "TP53"), { A: "", B: "" }, g);
});

test("T4: genes in gene-track order; the row's name is the track's label, an unlabelled merged row's 'TP53 / KRAS' (TD 92-96)", () => {
  const c = build({ genes: ["KRAS", { genes: ["TP53", "EGFR"] }, "BRAF"], events: [mut("A", MISSENSE, false, "EGFR")] });
  const tsv = toTsv(c);
  for (const g of GENETIC) {
    const names = parse(tsv).slice(1).filter((r) => r[1] === g).map((r) => r[0]);
    assert.deepEqual(names, ["KRAS", "TP53 / EGFR", "BRAF"], g);
  }
  assert.equal(cellOf(tsv, "MUTATIONS", "TP53 / EGFR", "A"), "Missense Mutation (putative passenger)");
});

test("T4: a labelled merged row is named by the track's label (TD 92-96; the portal's datum trackLabel is the symbols joined, DU 330/376)", () => {
  const c = build({ genes: [{ label: "RAS", genes: ["KRAS", "NRAS"] }], events: [cna("A", 2, false, "NRAS")] });
  const label = c.tracks.find((t) => t.kind === "gene")!.label;
  assert.equal(label, "RAS", "fixture: the engine keeps the label");
  assert.equal(cellOf(toTsv(c), "CNA", "RAS", "A"), "Amplification");
});

// ---- T5-T14: a gene cell's text ----------------------------------------------------------------

test("T5: mutation, annotation on: the class drawn with its driver call; 'Truncating mutation' lower-case m; Promoter no suffix (TD 46-58, DU 242)", () => {
  const cases: [Ev, string][] = [
    [mut("A", MISSENSE, true), "Missense Mutation (putative driver)"],
    [mut("B", MISSENSE, false), "Missense Mutation (putative passenger)"],
    [mut("C", INFRAME, true), "Inframe Mutation (putative driver)"],
    [mut("D", INFRAME, false), "Inframe Mutation (putative passenger)"],
    [mut("E", TRUNC, true), "Truncating mutation (putative driver)"],
    [mut("F", TRUNC, false), "Truncating mutation (putative passenger)"],
    [mut("G", PROMOTER, true), "Promoter Mutation"],
    [mut("H", PROMOTER, false), "Promoter Mutation"]
  ];
  const tsv = toTsv(build({ cols: cases.map(([e]) => e.pid), events: cases.map(([e]) => e) }));
  for (const [e, want] of cases) assert.equal(cellOf(tsv, "MUTATIONS", "TP53", e.pid), want, e.mt + (e.driver ? " driver" : " VUS"));
});

test("T6: mutation, annotation off: no suffix (TD 60-69)", () => {
  const cases: [Ev, string][] = [
    [mut("A", MISSENSE, true), "Missense Mutation"],
    [mut("B", MISSENSE, false), "Missense Mutation"],
    [mut("C", TRUNC, true), "Truncating mutation"],
    [mut("D", INFRAME, false), "Inframe Mutation"],
    [mut("E", PROMOTER, false), "Promoter Mutation"]
  ];
  const tsv = toTsv(build({ annotate: false, cols: cases.map(([e]) => e.pid), events: cases.map(([e]) => e) }));
  for (const [e, want] of cases) assert.equal(cellOf(tsv, "MUTATIONS", "TP53", e.pid), want, String(e.mt));
});

test("T7: VUS truncating + driver missense, annotation on: 'Missense Mutation (putative driver)', drivers first (DU 42-55)", () => {
  const tsv = toTsv(build({ cols: ["A"], events: [mut("A", TRUNC, false), mut("A", MISSENSE, true)] }));
  assert.equal(cellOf(tsv, "MUTATIONS", "TP53", "A"), "Missense Mutation (putative driver)");
});

test("T8: VUS missense + VUS truncating: one value, 'Truncating mutation (putative passenger)' (DU 42-55)", () => {
  const tsv = toTsv(build({ cols: ["A"], events: [mut("A", MISSENSE, false), mut("A", TRUNC, false)] }));
  assert.equal(cellOf(tsv, "MUTATIONS", "TP53", "A"), "Truncating mutation (putative passenger)");
});

test("T7/T8: render priority trunc > splice > inframe > promoter > missense > other among VUS (DU 42-55; ours names splice/other per T9)", () => {
  const order = [TRUNC, SPLICE, INFRAME, PROMOTER, MISSENSE, OTHER];
  const want = ["Truncating mutation (putative passenger)", "Splice Mutation (putative passenger)", "Inframe Mutation (putative passenger)",
    "Promoter Mutation", "Missense Mutation (putative passenger)", "Other Mutation (putative passenger)"];
  // column i holds the classes from i on: the first of them wins
  const cols = order.map((_, i) => "C" + i);
  const events = order.flatMap((_, i) => order.slice(i).map((mt) => mut(cols[i], mt, false)));
  const tsv = toTsv(build({ cols, events }));
  cols.forEach((col, i) => assert.equal(cellOf(tsv, "MUTATIONS", "TP53", col), want[i], order.slice(i).join("+")));
});

test("T9 (ours, documented): splice and other read 'Splice Mutation' / 'Other Mutation' with T5/T6's suffix rule; the portal writes raw splice, other (TD 46-69)", () => {
  const evs = [mut("A", SPLICE, true), mut("B", SPLICE, false), mut("C", OTHER, true), mut("D", OTHER, false)];
  const on = toTsv(build({ cols: ["A", "B", "C", "D"], events: evs }));
  assert.deepEqual(rowOf(on, "MUTATIONS", "TP53"), {
    A: "Splice Mutation (putative driver)", B: "Splice Mutation (putative passenger)",
    C: "Other Mutation (putative driver)", D: "Other Mutation (putative passenger)" });
  const off = toTsv(build({ annotate: false, cols: ["A", "B", "C", "D"], events: evs }));
  assert.deepEqual(rowOf(off, "MUTATIONS", "TP53"), { A: "Splice Mutation", B: "Splice Mutation", C: "Other Mutation", D: "Other Mutation" });
});

test("T10: copy number: 'Amplification', 'Deep Deletion' (TD 40-45)", () => {
  for (const annotate of [true, false]) {
    const tsv = toTsv(build({ annotate, events: [cna("A", 2), cna("B", -2)] }));
    assert.deepEqual(rowOf(tsv, "CNA", "TP53"), { A: "Amplification", B: "Deep Deletion" }, "annotation " + annotate);
  }
});

test("T11 (ours, documented): a driver copy number reads 'Amplification (putative driver)' / 'Deep Deletion (putative driver)', a VUS one plain; the portal writes raw amp_rec, homdel_rec (DU 183-189, TD 40-45)", () => {
  const tsv = toTsv(build({ cols: ["A", "B", "C", "D"], events: [cna("A", 2, true), cna("B", -2, true), cna("C", 2, false), cna("D", -2, false)] }));
  assert.deepEqual(rowOf(tsv, "CNA", "TP53"), {
    A: "Amplification (putative driver)", B: "Deep Deletion (putative driver)", C: "Amplification", D: "Deep Deletion" });
  const off = toTsv(build({ annotate: false, cols: ["A", "B"], events: [cna("A", 2, true), cna("B", -2, true)] }));
  assert.deepEqual(rowOf(off, "CNA", "TP53"), { A: "Amplification", B: "Deep Deletion" }, "annotation off: plain");
});

test("T12 (ours, documented): structural variant reads 'Structural Variant', '(putative driver)' for a driver with annotation on; the portal writes raw sv, sv_rec (DU 218-226, TD 76-78)", () => {
  const on = toTsv(build({ events: [sv("A", true), sv("B", false)] }));
  assert.deepEqual(rowOf(on, "STRUCTURAL_VARIANT", "TP53"), { A: "Structural Variant (putative driver)", B: "Structural Variant" });
  const off = toTsv(build({ annotate: false, events: [sv("A", true), sv("B", false)] }));
  assert.deepEqual(rowOf(off, "STRUCTURAL_VARIANT", "TP53"), { A: "Structural Variant", B: "Structural Variant" });
});

test("T13: a germline mutation reads as the same somatic one: no germline mark (TD does not read disp_germ)", () => {
  const tsv = toTsv(build({ events: [{ ...mut("A", MISSENSE, false), germ: true }, mut("B", MISSENSE, false)] }));
  const row = rowOf(tsv, "MUTATIONS", "TP53");
  assert.equal(row.B, "Missense Mutation (putative passenger)");
  assert.equal(row.A, row.B);
});

test("T14: a cell not profiled for the gene is empty in every genetic group (DU; TD 112-116)", () => {
  const c = build({ cols: ["A", "B"], unprofiled: ["B"], events: [mut("A", MISSENSE, true)] });
  const gene = c.tracks.find((t) => t.kind === "gene")!;
  assert.ok(gene.cells[c.columns.indexOf("B")] < 0, "fixture: B is not profiled");
  const tsv = toTsv(c);
  for (const g of GENETIC) assert.equal(cellOf(tsv, g, "TP53", "B"), "", g);
  assert.equal(cellOf(tsv, "MUTATIONS", "TP53", "A"), "Missense Mutation (putative driver)");
});

test("T15: two gene tracks with the same label: one row per group, values joined ', ' (TD 104-141)",
  { skip: "the engine refuses two gene tracks with one label ('gene list: two tracks are both labelled …'), so the case cannot arise" }, () => {});

// ---- T16-T19: clinical rows --------------------------------------------------------------------

test("T16: categorical clinical row: named by the attribute's display name, type CLINICAL, the value as text, no value '' (TD 145-188)", () => {
  const c = build({ cols: ["A", "B", "C"], clinical: [{ attr: "CANCER_TYPE", name: "Cancer Type", values: values({ A: "Breast Cancer", B: "Melanoma" }) }] });
  const t = c.tracks.find((x) => x.kind === "clinical")! as { label: string; name?: string };
  assert.equal(t.label, "CANCER_TYPE", "the track's label stays the attribute id");
  assert.equal(t.name, "Cancer Type", "the track carries the display name");
  assert.deepEqual(rowOf(toTsv(c), "CLINICAL", "Cancer Type"), { A: "Breast Cancer", B: "Melanoma", C: "" });
});

test("T17: numeric clinical row: the value as a number (float32 as drawn), no value '' (TD 180-186)", () => {
  const cols = Array.from({ length: 13 }, (_, i) => "P" + String(i + 1).padStart(2, "0"));
  // twelve distinct numbers make the attribute numeric; P13 has none
  const vals: Record<string, string> = Object.fromEntries(cols.slice(0, 12).map((p, i) => [p, String(i * 10 + 3)]));
  vals.P01 = "61.7"; vals.P02 = "0.1";
  const c = build({ cols, clinical: [{ attr: "AGE", name: "Diagnosis Age", values: values(vals) }] });
  assert.ok(c.tracks.find((t) => t.label === "AGE")!.numeric, "fixture: AGE is numeric");
  const row = rowOf(toTsv(c), "CLINICAL", "Diagnosis Age");
  assert.equal(row.P01, "61.7");
  assert.equal(row.P02, "0.1");
  assert.equal(row.P05, "43");
  assert.equal(row.P13, "");
});

test("T18: the mutation spectrum: one row per category '<display name> (<category>)', its counts, no data '' (TD 23-25, 151-177)", () => {
  const c = build({ cols: ["A", "B"], clinical: [{ attr: "MUTATION_SPECTRUM", name: "Mutation spectrum", values: values({ A: "1,2,3,4,5,6" }) }] });
  const tsv = toTsv(c);
  const cats = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
  const names = parse(tsv).slice(1).filter((r) => r[1] === "CLINICAL").map((r) => r[0]);
  assert.deepEqual(names, cats.map((k) => `Mutation spectrum (${k})`));
  cats.forEach((k, i) => assert.deepEqual(rowOf(tsv, "CLINICAL", `Mutation spectrum (${k})`), { A: String(i + 1), B: "" }, k));
});

test("T19: a clinical attribute whose display name is its id, or has none, is named by the id", () => {
  const c = build({ clinical: [
    { attr: "SEX", name: "SEX", values: values({ A: "Male" }) },
    { attr: "OS_STATUS", values: values({ A: "1:DECEASED" }) }] });
  const tsv = toTsv(c);
  assert.equal(cellOf(tsv, "CLINICAL", "SEX", "A"), "Male");
  assert.equal(cellOf(tsv, "CLINICAL", "OS_STATUS", "A"), "1:DECEASED");
});

// ---- T20-T24: heatmap and derived rows ---------------------------------------------------------

test("T20: a molecular-profile heatmap row: named by the gene, type 'HEATMAP <type> <datatype>', the value as a number, no value '' (TD 191-222)", () => {
  const c = build({ cols: ["A", "B", "C"], heatmap: [
    { profileType: "mrna_zscore", profileKind: "MRNA_EXPRESSION Z-SCORE", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 1.5, B: -0.25 }) },
    { profileType: "methylation_hm450", profileKind: "METHYLATION CONTINUOUS", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 0.75 }) },
    { profileType: "rppa_zscore", profileKind: "PROTEIN_LEVEL Z-SCORE", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { C: 2 }) }] });
  const hm = c.tracks.filter((t) => t.kind === "heatmap") as { profileKind?: string }[];
  assert.deepEqual(hm.map((t) => t.profileKind), ["MRNA_EXPRESSION Z-SCORE", "METHYLATION CONTINUOUS", "PROTEIN_LEVEL Z-SCORE"], "the tracks carry profileKind");
  const tsv = toTsv(c);
  assert.deepEqual(rowOf(tsv, "HEATMAP MRNA_EXPRESSION Z-SCORE", "TP53"), { A: "1.5", B: "-0.25", C: "" });
  assert.deepEqual(rowOf(tsv, "HEATMAP METHYLATION CONTINUOUS", "TP53"), { A: "0.75", B: "", C: "" });
  assert.deepEqual(rowOf(tsv, "HEATMAP PROTEIN_LEVEL Z-SCORE", "TP53"), { A: "", B: "", C: "2" });
});

test("T20: a heatmap value is written at the digits it was given (1.234567, not float32 noise) (TD 214-218)", () => {
  const c = build({ cols: ["A"], heatmap: [
    { profileType: "mrna_zscore", profileKind: "MRNA_EXPRESSION Z-SCORE", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 1.234567 }) }] });
  assert.equal(cellOf(toTsv(c), "HEATMAP MRNA_EXPRESSION Z-SCORE", "TP53", "A"), "1.234567");
});

test("T21: a generic-assay heatmap row: named by the entity, type 'HEATMAP GENERIC_ASSAY LIMIT-VALUE' (TD 191-222)", () => {
  const c = build({ cols: ["A", "B"], heatmap: [
    { profileType: "mutational_signature", profileKind: "GENERIC_ASSAY LIMIT-VALUE", assay: true, genes: ["SBS1"], isVaf: false,
      values: hmValues("SBS1", { A: 0.5 }) }] });
  assert.deepEqual(rowOf(toTsv(c), "HEATMAP GENERIC_ASSAY LIMIT-VALUE", "SBS1"), { A: "0.5", B: "" });
});

test("T22: two heatmap profiles of different types are two groups in drawn order; the same type is one group (TD 202-205)", () => {
  const c = build({ genes: ["TP53", "KRAS"], heatmap: [
    { profileType: "mrna_zscore", profileKind: "MRNA_EXPRESSION Z-SCORE", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 1 }) },
    { profileType: "methylation_hm450", profileKind: "METHYLATION CONTINUOUS", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 0.5 }) },
    { profileType: "mrna_zscore_all", profileKind: "MRNA_EXPRESSION Z-SCORE", genes: ["KRAS"], isVaf: false, values: hmValues("KRAS", { B: -1 }) }] });
  const drawn = c.tracks.filter((t) => t.kind === "heatmap").length;
  assert.equal(drawn, 3, "fixture: three heatmap tracks");
  const rows = parse(toTsv(c)).slice(1).filter((r) => r[1].startsWith("HEATMAP")).map((r) => [r[0], r[1]]);
  assert.deepEqual(rows, [
    ["TP53", "HEATMAP MRNA_EXPRESSION Z-SCORE"], ["KRAS", "HEATMAP MRNA_EXPRESSION Z-SCORE"],
    ["TP53", "HEATMAP METHYLATION CONTINUOUS"]]);
});

test("T23 (ours, documented): a VAF heatmap row is type 'HEATMAP MUTATION_EXTENDED VAF' (the portal has none)", () => {
  const c = build({ cols: ["A", "B"], heatmap: [{ profileType: "VAF", genes: ["TP53"], isVaf: true, values: hmValues("TP53", { A: 0.5 }) }] });
  const rows = parse(toTsv(c)).slice(1).filter((r) => r[1].startsWith("HEATMAP"));
  assert.deepEqual(rows.map((r) => r[1]), ["HEATMAP MUTATION_EXTENDED VAF"]);
  assert.deepEqual(rowOf(toTsv(c), "HEATMAP MUTATION_EXTENDED VAF", rows[0][0]), { A: "0.5", B: "" });
});

test("T24 (ours, documented): a derived-event row is type DERIVED, yes/no, after the heatmap groups", () => {
  const c = build({ cols: ["A", "B"], derived: [{ label: "Treated", pids: new Set(["B"]) }],
    heatmap: [{ profileType: "mrna_zscore", profileKind: "MRNA_EXPRESSION Z-SCORE", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 1 }) }] });
  const tsv = toTsv(c);
  assert.deepEqual(rowOf(tsv, "DERIVED", "Treated"), { A: "no", B: "yes" });
  const types = parse(tsv).slice(1).map((r) => r[1]);
  assert.ok(types.indexOf("DERIVED") > types.indexOf("HEATMAP MRNA_EXPRESSION Z-SCORE"), types.join(","));
  assert.equal(types[types.length - 1], "DERIVED");
});

// ---- T25-T30: columns, files -------------------------------------------------------------------

test("T25: Show unaltered off: only the drawn (altered) columns, in every row and the header (RVO getIdOrder() visible)", () => {
  const c = build({ cols: ["A", "B", "C", "D"], events: [mut("B", MISSENSE), cna("D", 2)],
    clinical: [{ attr: "SEX", name: "Sex", values: values({ A: "F", B: "M", C: "F", D: "M" }) }] });
  const drawn = ["B", "D"].map((p) => c.columns.indexOf(p));
  assert.ok(drawn.every((i) => i >= 0), "fixture");
  const tsv = toTsv(c, drawn);
  const rows = parse(tsv);
  assert.deepEqual(rows[0], ["track_name", "track_type", "B", "D"]);
  for (const r of rows) assert.equal(r.length, 4, r.join("|"));
  assert.deepEqual(rowOf(tsv, "CLINICAL", "Sex"), { B: "M", D: "M" });
  assert.deepEqual(rowOf(tsv, "MUTATIONS", "TP53"), { B: "Missense Mutation (putative passenger)", D: "" });
  assert.deepEqual(rowOf(tsv, "CNA", "TP53"), { B: "", D: "Amplification" });
});

test("T26: the page's sort: columns in the order drawn on screen (RVO)", () => {
  const c = build({ cols: ["A", "B", "C"], events: [mut("A", MISSENSE), cna("C", -2)],
    heatmap: [{ profileType: "mrna_zscore", profileKind: "MRNA_EXPRESSION Z-SCORE", genes: ["TP53"], isVaf: false, values: hmValues("TP53", { A: 1, B: 2, C: 3 }) }] });
  const order = ["C", "A", "B"].map((p) => c.columns.indexOf(p));
  const rows = parse(toTsv(c, order));
  assert.deepEqual(rows[0], ["track_name", "track_type", "C", "A", "B"]);
  assert.deepEqual(rows.find((r) => r[1] === "MUTATIONS")!.slice(2), ["", "Missense Mutation (putative passenger)", ""]);
  assert.deepEqual(rows.find((r) => r[1] === "CNA")!.slice(2), ["Deep Deletion", "", ""]);
  assert.deepEqual(rows.find((r) => r[1].startsWith("HEATMAP"))!.slice(2), ["3", "1", "2"]);
  // a hand-built contract: order is indices into its columns, absent = all in contract order
  const hand = { study: "s", unit: "patient", groups: [{ name: "all", start: 0, count: 3 }], columns: ["X", "Y", "Z"],
    tracks: [{ kind: "derivedEvent", label: "D", cells: [1, 0, 1] }], conventions: {}, display: normalizeDisplay({}) } as unknown as Contract;
  assert.deepEqual(parse(toTsv(hand, [2, 1]))[1], ["D", "DERIVED", "yes", "no"]);
  assert.deepEqual(parse(toTsv(hand))[0].slice(2), ["X", "Y", "Z"]);
});

test("T27: file names PATIENT_DATA_oncoprint.tsv / SAMPLE_DATA_oncoprint.tsv (TD 268-269)", () => {
  const fn = (tabular as Record<string, unknown>).tabularFileName as (u: string) => string;
  assert.equal(typeof fn, "function", "lib/oncoprint-tabular.ts exports tabularFileName");
  assert.equal(fn("patient"), "PATIENT_DATA_oncoprint.tsv");
  assert.equal(fn("sample"), "SAMPLE_DATA_oncoprint.tsv");
});

test("T28: order file: 'Patient order in the Oncoprint is:' / 'Sample …', one id per line in drawn order; OncoPrintPatients.txt / OncoPrintSamples.txt (RVO 1046-1085)", () => {
  const t = tabular as Record<string, unknown>;
  const name = t.orderFileName as (u: string) => string, text = t.orderFileText as (u: string, ids: string[]) => string;
  assert.equal(typeof name, "function", "lib/oncoprint-tabular.ts exports orderFileName");
  assert.equal(typeof text, "function", "lib/oncoprint-tabular.ts exports orderFileText");
  assert.equal(name("patient"), "OncoPrintPatients.txt");
  assert.equal(name("sample"), "OncoPrintSamples.txt");
  assert.equal(text("patient", ["P2", "P10", "P1"]), "Patient order in the Oncoprint is:\nP2\nP10\nP1\n");
  assert.equal(text("sample", ["S1"]), "Sample order in the Oncoprint is:\nS1\n");
});

test("T29 (ours, documented): across studies the column ids are '<study>_<id>', unique; the portal writes the bare id", () => {
  const cols = ["s1_P1", "s2_P1"];
  const c = build({ cols, studies: ["s1", "s2"], studyOf: new Map(cols.map((p): [string, string] => [p, p.split("_")[0]])),
    events: [mut("s2_P1", MISSENSE)] });
  const tsv = toTsv(c);
  const header = parse(tsv)[0].slice(2);
  assert.deepEqual([...header].sort(), cols);
  assert.equal(new Set(header).size, header.length, "unique");
  assert.deepEqual(rowOf(tsv, "MUTATIONS", "TP53"), { s1_P1: "", s2_P1: "Missense Mutation (putative passenger)" });
});

test("T30: '\\n' after every line, the last included; no blank lines (TD 247)", () => {
  const tsv = toTsv(build({ events: [mut("A", MISSENSE)], clinical: [{ attr: "SEX", values: values({ A: "F" }) }] }));
  assert.ok(tsv.endsWith("\n") && !tsv.endsWith("\n\n"));
  assert.ok(!tsv.includes("\r"));
  const lines = tsv.slice(0, -1).split("\n");
  assert.ok(lines.length >= 7, "header + clinical + five genetic rows");
  for (const l of lines) assert.notEqual(l, "");
});

test("T31: Python port (see python/tests/test_tabular_portal.py)", { skip: "a Python test: python/tests/test_tabular_portal.py" }, () => {});
