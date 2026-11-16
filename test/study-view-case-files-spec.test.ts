// Written from docs/legacy-spec/parity/download-cases.md, "Per-case files (PC)" (each test names
// the row it checks) and SD2 for how a chart's name becomes a file name, without reference to the
// implementation.
// Covered elsewhere, not here (route / UI / database):
//   PC1  which charts offer Full Data / Data, and the header's "Download clinical data" button
//   PC6  a bar chart's Data name is the caller's chartFileName(name, "data"); its rows are PC4/PC5's
//   PC9  attribute order and the 200-attribute cap; PC10 row order; PC11 several studies in one file
//   PC12 studies that may not list patients; PC13 the header alone; PC14 a download cut short
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASE_FILE_COHORT, caseFileDoc, caseFileFormat, caseFileHeader, caseFileLine, caseFileName,
  type CaseFile,
} from "../lib/study-view-case-files.ts";
import type { AnalysisDoc, CohortDef } from "../lib/types.ts";
import type { TableView } from "../lib/views/table/types.ts";

const STUDY = "brca_tcga_pan_can_atlas_2018";
const def: CohortDef = { studies: [STUDY], all: [{ kind: "clinical", attribute: "SEX", values: ["Female"] }] };

const fullSample: CaseFile = { kind: "full", attribute: "CANCER_TYPE_DETAILED", per: "sample" };
const fullPatient: CaseFile = { kind: "full", attribute: "SEX", per: "patient" };
const density: CaseFile = { kind: "density", x: "FRACTION_GENOME_ALTERED", y: "MUTATION_COUNT" };
const survival: CaseFile = { kind: "survival", status: "OS_STATUS", months: "OS_MONTHS" };
const clinical: CaseFile = { kind: "clinical" };
const ALL: CaseFile[] = [fullSample, fullPatient, density, survival, clinical];

const PATIENT = { id: "patient", name: "Patient ID" };
const SAMPLE = { id: "sample", name: "Sample ID" };

/** the doc's one view, checked to be the clinical table over the selection */
function theView(doc: AnalysisDoc): TableView {
  assert.equal(doc.views?.length, 1, "exactly one view");
  const v = doc.views[0];
  assert.equal(v.kind, "table");
  const t = v as TableView;
  assert.deepEqual(t.cohorts, [CASE_FILE_COHORT]);
  return t;
}
const unitOf = (v: TableView) => v.unit ?? "sample";
const HAS_VALUE = { op: "notEquals", value: "" };
/** a numeric column takes only a range: every finite number, which leaves a missing value out */
const HAS_NUMBER = { min: -Number.MAX_VALUE };

// ---- caseFileName (PC2, SD2) ----

test("PC2: Full Data is the chart's name then .full.txt", () => {
  assert.equal(caseFileName(fullSample, "Cancer Type Detailed", [STUDY]), "Cancer_Type_Detailed.full.txt");
  assert.equal(caseFileName(fullPatient, "Sex", [STUDY]), "Sex.full.txt");
});

test("PC2/SD2: spaces and tabs in the name become _, other characters are kept", () => {
  assert.equal(caseFileName(fullSample, "TP53: Mutations (%)", [STUDY]), "TP53:_Mutations_(%).full.txt");
  assert.equal(caseFileName(fullSample, "a\tb  c", [STUDY]), "a_b__c.full.txt");
});

test("PC2: density Data is the chart's name then .txt", () => {
  assert.equal(caseFileName(density, "Mutation Count vs Fraction Genome Altered", [STUDY]),
    "Mutation_Count_vs_Fraction_Genome_Altered.txt");
});

test("PC2: survival Data is the chart's name then .txt", () => {
  assert.equal(caseFileName(survival, "Overall Survival", [STUDY]), "Overall_Survival.txt");
});

test("PC2: clinical data of one study is <study>_clinical_data.tsv, whatever the chart name", () => {
  assert.equal(caseFileName(clinical, "", [STUDY]), `${STUDY}_clinical_data.tsv`);
  assert.equal(caseFileName(clinical, "Some Name", ["acc_tcga"]), "acc_tcga_clinical_data.tsv");
});

test("PC2: clinical data of several studies is combined_study_clinical_data.tsv", () => {
  assert.equal(caseFileName(clinical, "", [STUDY, "acc_tcga"]), "combined_study_clinical_data.tsv");
});

// ---- caseFileFormat (PC4, PC7, PC8, PC9) ----

test("PC4: Full Data has Study ID and attribute names", () => {
  assert.deepEqual(caseFileFormat(fullSample), { study: "Study ID", header: "names" });
  assert.deepEqual(caseFileFormat(fullPatient), { study: "Study ID", header: "names" });
});

test("PC7: density Data has Cancer Study and attribute names", () => {
  assert.deepEqual(caseFileFormat(density), { study: "Cancer Study", header: "names" });
});

test("PC8: survival Data has Study ID and attribute ids", () => {
  assert.deepEqual(caseFileFormat(survival), { study: "Study ID", header: "ids" });
});

test("PC9: clinical data has Study ID and attribute names", () => {
  assert.deepEqual(caseFileFormat(clinical), { study: "Study ID", header: "names" });
});

// ---- caseFileHeader (PC3, PC4, PC7, PC8, PC9) ----

test("PC4: Full Data header for a sample attribute: Study ID, Patient ID, Sample ID, the attribute's name", () => {
  const h = caseFileHeader([PATIENT, SAMPLE, { id: "CANCER_TYPE_DETAILED", name: "Cancer Type Detailed" }],
    { study: "Study ID", header: "names" });
  assert.equal(h, "Study ID\tPatient ID\tSample ID\tCancer Type Detailed");
});

test("PC4: Full Data header for a patient attribute has no Sample ID", () => {
  const h = caseFileHeader([PATIENT, { id: "SEX", name: "Sex" }], { study: "Study ID", header: "names" });
  assert.equal(h, "Study ID\tPatient ID\tSex");
});

test("PC7: density header starts with Cancer Study and names x then y", () => {
  const cols = [PATIENT, SAMPLE, { id: "FRACTION_GENOME_ALTERED", name: "Fraction Genome Altered" },
    { id: "MUTATION_COUNT", name: "Mutation Count" }];
  assert.equal(caseFileHeader(cols, { study: "Cancer Study", header: "names" }),
    "Cancer Study\tPatient ID\tSample ID\tFraction Genome Altered\tMutation Count");
});

test("PC8: survival header writes attributes by id, the id columns still by name", () => {
  const cols = [PATIENT, { id: "OS_STATUS", name: "Overall Survival Status" }, { id: "OS_MONTHS", name: "Overall Survival (Months)" }];
  assert.equal(caseFileHeader(cols, { study: "Study ID", header: "ids" }), "Study ID\tPatient ID\tOS_STATUS\tOS_MONTHS");
});

test("PC9: clinical header: the study column then every column given, in order", () => {
  const cols = [PATIENT, SAMPLE, { id: "SEX", name: "Sex" }, { id: "AGE", name: "Diagnosis Age" },
    { id: "CANCER_TYPE_DETAILED", name: "Cancer Type Detailed" }];
  assert.equal(caseFileHeader(cols, { study: "Study ID", header: "names" }),
    "Study ID\tPatient ID\tSample ID\tSex\tDiagnosis Age\tCancer Type Detailed");
});

test("PC3: the header has no line ending", () => {
  const h = caseFileHeader([PATIENT, { id: "SEX", name: "Sex" }], { study: "Study ID", header: "names" });
  assert.ok(!/[\r\n]/.test(h), JSON.stringify(h));
});

// ---- caseFileLine (PC3, PC11) ----

test("PC3: a line is the study then the values, tab-separated, no line ending", () => {
  assert.equal(caseFileLine(STUDY, ["TCGA-A1-A0SB", "TCGA-A1-A0SB-01", "Breast Invasive Ductal Carcinoma"]),
    `${STUDY}\tTCGA-A1-A0SB\tTCGA-A1-A0SB-01\tBreast Invasive Ductal Carcinoma`);
});

test("PC3: a missing (empty) value is written NA", () => {
  assert.equal(caseFileLine(STUDY, ["TCGA-A1-A0SB", "", "12.5"]), `${STUDY}\tTCGA-A1-A0SB\tNA\t12.5`);
  assert.equal(caseFileLine(STUDY, ["TCGA-A1-A0SB", ""]), `${STUDY}\tTCGA-A1-A0SB\tNA`);
});

test("PC3: a tab, CR or LF inside a value becomes one space each", () => {
  assert.equal(caseFileLine(STUDY, ["P1", "a\tb", "c\nd", "e\r\nf", "g\rh"]), `${STUDY}\tP1\ta b\tc d\te  f\tg h`);
});

test("PC3: values are written as given: no quoting, NA stays NA, numbers as text", () => {
  assert.equal(caseFileLine(STUDY, ["P1", 'say "hi", ok', "NA", "0.0312", "1:DECEASED"]),
    `${STUDY}\tP1\tsay "hi", ok\tNA\t0.0312\t1:DECEASED`);
});

test("PC11: each line names its own study", () => {
  assert.equal(caseFileLine("acc_tcga", ["TCGA-OR-A5J1", "Male"]), "acc_tcga\tTCGA-OR-A5J1\tMale");
});

// ---- caseFileDoc (PC4–PC9) ----

test("PC5: every kind's doc is the clinical table over the selection, def passed through", () => {
  for (const f of ALL) {
    const doc = caseFileDoc(f, def, STUDY);
    assert.equal(doc.study, STUDY, f.kind);
    assert.equal(typeof doc.dsl, "string", f.kind);
    assert.ok(doc.dsl!.length > 0, f.kind);
    assert.deepEqual(Object.keys(doc.cohorts), [CASE_FILE_COHORT], f.kind);
    assert.deepEqual(doc.cohorts[CASE_FILE_COHORT], def, f.kind);
    const v = theView(doc);
    assert.equal(v.search, undefined, f.kind);
    assert.equal(v.sort, undefined, f.kind);
  }
});

test("PC4/PC5: Full Data of a sample attribute: per sample, patient + sample + attribute, rows with a value", () => {
  const v = theView(caseFileDoc(fullSample, def, STUDY));
  assert.equal(unitOf(v), "sample");
  assert.deepEqual(v.columns, ["patient", "sample", "CANCER_TYPE_DETAILED"]);
  assert.deepEqual(v.filters, { CANCER_TYPE_DETAILED: HAS_VALUE });
});

test("PC4/PC5: Full Data of a patient attribute: per patient, patient + attribute (no samples count), rows with a value", () => {
  const v = theView(caseFileDoc(fullPatient, def, STUDY));
  assert.equal(v.unit, "patient");
  assert.deepEqual(v.columns, ["patient", "SEX"]);
  assert.deepEqual(v.filters, { SEX: HAS_VALUE });
});

test("PC6: a numeric attribute's Full Data (a bar's Data) keeps the rows with a number", () => {
  const v = theView(caseFileDoc({ kind: "full", attribute: "AGE", per: "patient", numeric: true }, def, STUDY));
  assert.deepEqual(v.columns, ["patient", "AGE"]);
  assert.deepEqual(v.filters, { AGE: HAS_NUMBER });
});

test("PC7: density Data: per sample, patient + sample + x + y, both values required", () => {
  const v = theView(caseFileDoc(density, def, STUDY));
  assert.equal(unitOf(v), "sample");
  assert.deepEqual(v.columns, ["patient", "sample", "FRACTION_GENOME_ALTERED", "MUTATION_COUNT"]);
  assert.deepEqual(v.filters, { FRACTION_GENOME_ALTERED: HAS_NUMBER, MUTATION_COUNT: HAS_NUMBER });
});

test("PC7: density Data after Swap Axes swaps the columns", () => {
  const v = theView(caseFileDoc({ kind: "density", x: "MUTATION_COUNT", y: "FRACTION_GENOME_ALTERED" }, def, STUDY));
  assert.deepEqual(v.columns, ["patient", "sample", "MUTATION_COUNT", "FRACTION_GENOME_ALTERED"]);
});

test("PC8: survival Data: per patient, patient + status + months, every patient (no filters)", () => {
  const v = theView(caseFileDoc(survival, def, STUDY));
  assert.equal(v.unit, "patient");
  assert.deepEqual(v.columns, ["patient", "OS_STATUS", "OS_MONTHS"]);
  assert.ok(v.filters == null || Object.keys(v.filters).length === 0, JSON.stringify(v.filters));
});

test("PC9: clinical data: per sample, every attribute (no columns), no filters", () => {
  const v = theView(caseFileDoc(clinical, def, STUDY));
  assert.equal(unitOf(v), "sample");
  assert.equal(v.columns, undefined);
  assert.equal(v.attributes, undefined);
  assert.ok(v.filters == null || Object.keys(v.filters).length === 0, JSON.stringify(v.filters));
});
