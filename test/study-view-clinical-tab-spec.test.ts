// Written from docs/legacy-spec/parity/clinical-tab-cases.md (CT; each test names the row it
// checks), without reference to the implementation. The tab's download goes through the per-case
// file functions (lib/study-view-case-files.ts); download-cases.md PC3 is checked for regression.
// Covered elsewhere, not here (route / UI / database):
//   CT1 the tabs; CT5 id links; CT8 no column menu; CT9 no row limit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLINICAL_TAB_ROWS, clinicalCell, clinicalTabColumns, clinicalTabDoc, type TabChart,
} from "../lib/study-view-clinical-tab.ts";
import {
  CASE_FILE_COHORT, caseFileBreaks, caseFileDoc, caseFileFormat, caseFileHeader, caseFileLine, caseFileName,
  type CaseFile,
} from "../lib/study-view-case-files.ts";
import type { AnalysisDoc, CohortDef } from "../lib/types.ts";
import type { TableView } from "../lib/views/table/types.ts";
import type { TableQuery } from "../lib/table-query.ts";

const STUDY = "brca_tcga_pan_can_atlas_2018";
const def: CohortDef = { studies: [STUDY], all: [] };

/** the doc's one view, checked to be the clinical table over the selection, per sample */
function theView(doc: AnalysisDoc): TableView {
  assert.equal(doc.views?.length, 1, "exactly one view");
  const v = doc.views[0];
  assert.equal(v.kind, "table");
  const t = v as TableView;
  assert.deepEqual(t.cohorts, [CASE_FILE_COHORT]);
  assert.equal(t.unit ?? "sample", "sample");
  return t;
}

// ---- clinicalTabColumns (CT2) ----

test("CT2: Patient ID and Sample ID first, then by priority highest first, ties by name", () => {
  const charts: TabChart[] = [
    { attribute: "LOW", name: "Low", priority: 0 },
    { attribute: "ZETA", name: "Zeta", priority: 10 },
    { attribute: "TOP", name: "Top", priority: 2000 },
    { attribute: "ALPHA", name: "Alpha", priority: 10 },
  ];
  assert.deepEqual(clinicalTabColumns(charts), ["patient", "sample", "TOP", "ALPHA", "ZETA", "LOW"]);
});

test("CT2: no charts gives just Patient ID and Sample ID", () => {
  assert.deepEqual(clinicalTabColumns([]), ["patient", "sample"]);
});

test("CT2: the charts given are not reordered", () => {
  const charts: TabChart[] = [
    { attribute: "B", name: "B", priority: 1 },
    { attribute: "A", name: "A", priority: 5 },
  ];
  const copy = structuredClone(charts);
  assert.deepEqual(clinicalTabColumns(charts), ["patient", "sample", "A", "B"]);
  assert.deepEqual(charts, copy);
});

// ---- clinicalTabDoc (CT6, CT7) ----

const COLUMNS = ["patient", "sample", "CANCER_TYPE_DETAILED", "AGE"];

test("CT6/CT7: the tab's doc is the clinical table over the selection, 20 rows a page, with search and sort", () => {
  const query: TableQuery = { search: "lobular", sort: { column: "AGE", desc: true } };
  const doc = clinicalTabDoc(def, STUDY, COLUMNS, query);
  assert.equal(doc.study, STUDY);
  assert.equal(typeof doc.dsl, "string");
  assert.ok(doc.dsl!.length > 0);
  assert.deepEqual(doc.cohorts, { [CASE_FILE_COHORT]: def });
  const v = theView(doc);
  assert.equal(CLINICAL_TAB_ROWS, 20);
  assert.equal(v.rows, CLINICAL_TAB_ROWS);
  assert.deepEqual(v.columns, COLUMNS);
  assert.equal(v.search, "lobular");
  assert.deepEqual(v.sort, { column: "AGE", desc: true });
});

test("CT7: an empty query leaves no search, sort or filters", () => {
  const v = theView(clinicalTabDoc(def, STUDY, COLUMNS, {}));
  assert.deepEqual(v.columns, COLUMNS);
  assert.equal(v.rows, 20);
  assert.equal(v.search, undefined);
  assert.equal(v.sort, undefined);
  assert.equal(v.filters, undefined);
});

// ---- clinicalCell (CT3, CT4) ----

test("CT3: an empty value is missing", () => {
  assert.equal(clinicalCell(""), "missing");
});

test("CT4: a value starting http:// or https:// is a link", () => {
  assert.equal(clinicalCell("http://x.org"), "url");
  assert.equal(clinicalCell("https://x.org/a?b"), "url");
});

test("CT4: anything else is text (the pattern is case-sensitive and anchored)", () => {
  for (const v of ["HTTP://x", "www.x.org", "ftp://x", " https://x", "NA"]) {
    assert.equal(clinicalCell(v), "text", v);
  }
});

// ---- the tab's download (CT10-CT12) ----

const tab = (studies: number): CaseFile => ({
  kind: "tab", columns: COLUMNS, query: { search: "lobular", sort: { column: "AGE", desc: true } }, studies,
});

test("CT10: one study's file is <study>_clinical_data.tsv, several studies' combined_study_clinical_data.tsv", () => {
  assert.equal(caseFileName(tab(1), "", [STUDY]), `${STUDY}_clinical_data.tsv`);
  assert.equal(caseFileName(tab(2), "", [STUDY, "msk_impact_2017"]), "combined_study_clinical_data.tsv");
});

test("CT12: the file's doc is every row the search keeps, in the sort, per sample, unfiltered", () => {
  const doc = caseFileDoc(tab(1), def, STUDY);
  assert.equal(doc.study, STUDY);
  assert.deepEqual(doc.cohorts, { [CASE_FILE_COHORT]: def });
  const v = theView(doc);
  assert.deepEqual(v.columns, COLUMNS);
  assert.equal(v.search, "lobular");
  assert.deepEqual(v.sort, { column: "AGE", desc: true });
  assert.equal(v.filters, undefined);
});

test("CT11: the tab's format is the table layout, a study column only for several studies, headers by name", () => {
  const one = caseFileFormat(tab(1));
  assert.deepEqual(one.table, { studyColumn: false });
  assert.equal(one.header, "names");
  const two = caseFileFormat(tab(2));
  assert.deepEqual(two.table, { studyColumn: true });
  assert.equal(two.study, "Cancer Study");
  assert.equal(two.header, "names");
});

const HEADER_COLUMNS = [
  { id: "patient", name: "Patient ID" },
  { id: "sample", name: "Sample ID" },
  { id: "CANCER_TYPE_DETAILED", name: "Cancer Type Detailed" },
];

test("CT11: one study's header has no study column", () => {
  assert.equal(caseFileHeader(HEADER_COLUMNS, caseFileFormat(tab(1))), "Patient ID\tSample ID\tCancer Type Detailed");
});

test("CT11: several studies' header puts Cancer Study third", () => {
  assert.equal(caseFileHeader(HEADER_COLUMNS, caseFileFormat(tab(2))),
    "Patient ID\tSample ID\tCancer Study\tCancer Type Detailed");
});

test("CT12: a line has no study column for one study, and a missing value stays empty", () => {
  assert.equal(caseFileLine("brca", ["P1", "S1", "", "55"], caseFileFormat(tab(1))), "P1\tS1\t\t55");
});

test("CT12: several studies' line puts the study third", () => {
  assert.equal(caseFileLine("brca", ["P1", "S1", "", "55"], caseFileFormat(tab(2))), "P1\tS1\tbrca\t\t55");
});

test("CT12: every line, the header and the last included, ends in CRLF", () => {
  assert.deepEqual(caseFileBreaks(caseFileFormat(tab(1))), { before: "", after: "\r\n" });
});

// ---- regression: the chart files (download-cases.md PC3) ----

test("PC3 (regression): the chart files' lines are joined by \\n, none after the last", () => {
  assert.deepEqual(caseFileBreaks(caseFileFormat({ kind: "clinical" })), { before: "\n", after: "" });
});

test("PC3 (regression): with no format a line starts with its study and a missing value is NA", () => {
  assert.equal(caseFileLine("s", ["", "x"]), "s\tNA\tx");
});
