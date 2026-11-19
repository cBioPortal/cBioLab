// The OncoPrint's "case list order" (ONC-SO-3), from the legacy source (cbioportal-frontend @ cd8c6df):
//   RVO = src/shared/components/oncoprint/ResultsViewOncoprint.tsx: sortOrder 1776-1800 (sample
//         columns in givenSampleOrder; patient columns the uniq of those samples' patients),
//         caseListSortPossible 795-800 (offered only when the query names samples by id);
//   RVPS = src/pages/resultsView/ResultsViewPageStore.ts givenSampleOrder 2960-2989 (the samples
//         sorted by their index in the typed specification);
//   OC = src/shared/components/oncoprint/controls/OncoprintControls.tsx 795-815 (the radio, disabled
//         while not possible).
// Cases:
//   CL1  a typed list is stored with each study's ids in the order given, once each; other sets sorted
//   CL2  the cohort's list: the first sampleList / patientList of its all, a stored set's or inline
//        ids for the study; none, or a lock's part, gives no order
//   CL3  sample columns of a sample list: the typed position; patient columns: their first sample's
//   CL4  a patient list: patient columns at their position, sample columns at their patient's
//   CL5  a column the list does not reach is left out (sorts last)
//   CL6  sort "caseList" orders the columns so, unlisted last; "-caseList" reverses the listed ones
//   CL7  without a list the key is refused, saying why; with one the contract says it is on offer
//   CL8  the browser cannot apply it (the contract holds no list), so choosing it re-runs the view
//        and the figure keeps the engine's order, as a clustering
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import * as sets from "../lib/id-sets.ts";
import * as cl from "../lib/oncoprint-case-list.ts";
import * as vd from "../app/_oncoprint/view-data.ts";
import * as te from "../app/_oncoprint/track-edits.ts";
import { assembleContract, type AssembleInput, type EventRow } from "../lib/oncoprint-assemble.ts";

const s = sets as unknown as Record<string, any>;
const c = cl as unknown as Record<string, any>;

describe("CL1: a typed list keeps the order typed", () => {
  test("ordered: ids once each, in the order given; studies sorted; empty studies dropped", () => {
    assert.deepEqual(s.tidyIdSet({ b: ["S10", "S2", "S10", "S1"], a: ["X3", "X1"], c: [] }, true), { a: ["X3", "X1"], b: ["S10", "S2", "S1"] });
  });
  test("any other set (a lock's, from a query) is sorted", () => {
    assert.deepEqual(s.tidyIdSet({ b: ["S2", "S1", "S2"] }), { b: ["S1", "S2"] });
  });
});

const SET = "0b6f9c1e-1111-4222-8333-944455556666";
const loaded = (perStudy: Record<string, string[]>) => [{ id: SET, name: "User-defined Case List", level: "sample" as const, count: 3, perStudy }];

describe("CL2: the cohort's list", () => {
  test("a stored set's ids for the study, in its order", async () => {
    const got = await sets.withIdSets(loaded({ st: ["S3", "S1", "S2"], other: ["Z"] }), new Map(), async () =>
      c.caseListOf({ all: [{ kind: "sampleList", set: SET, label: "User-defined Case List" }] }, "st"));
    assert.deepEqual(got, { level: "sample", ids: ["S3", "S1", "S2"] });
  });
  test("inline ids, those of the study, bare", () => {
    assert.deepEqual(c.caseListOf({ all: [{ kind: "patientList", ids: ["st:P2", "x:P9", "st:P1"] }] }, "st"), { level: "patient", ids: ["P2", "P1"] });
  });
  test("the first list clause; a clause beside it does not matter", () => {
    const dsl = { all: [{ kind: "clinical", attribute: "SEX", values: ["Male"] }, { kind: "sampleList", ids: ["st:B", "st:A"] }, { kind: "sampleList", ids: ["st:A", "st:B"] }] };
    assert.deepEqual(c.caseListOf(dsl, "st"), { level: "sample", ids: ["B", "A"] });
  });
  test("no list, a lock's part, no all: none", () => {
    assert.equal(c.caseListOf({ all: [{ kind: "caseList", id: "st_all" }] }, "st"), null);
    assert.equal(c.caseListOf({ all: [{ kind: "sampleList", set: SET, part: "arm:x / a" }] }, "st"), null);
    assert.equal(c.caseListOf(null, "st"), null);
  });
});

describe("CL3-CL5: each column's place", () => {
  const samples = new Map([["P1", ["S1a", "S1b"]], ["P2", ["S2"]], ["P3", ["S3"]]]);
  test("CL3 sample list: sample columns at their position, patient columns at their first sample's", () => {
    const list = { level: "sample", ids: ["S2", "S1b", "S3", "S1a"] };
    assert.deepEqual([...c.caseListRanks(list, ["S1a", "S1b", "S2", "S3"], "sample", (x: string) => [x])], [["S1a", 3], ["S1b", 1], ["S2", 0], ["S3", 2]]);
    assert.deepEqual([...c.caseListRanks(list, ["P1", "P2", "P3"], "patient", (x: string) => samples.get(x))], [["P1", 1], ["P2", 0], ["P3", 2]]);
  });
  test("CL4 patient list: patient columns at their position, sample columns at their patient's", () => {
    const list = { level: "patient", ids: ["P3", "P1"] };
    assert.deepEqual([...c.caseListRanks(list, ["P1", "P2", "P3"], "patient", (x: string) => samples.get(x))], [["P1", 1], ["P3", 0]]);
    const owner = new Map([["S1a", "P1"], ["S1b", "P1"], ["S2", "P2"], ["S3", "P3"]]);
    assert.deepEqual([...c.caseListRanks(list, ["S1a", "S1b", "S2", "S3"], "sample", (x: string) => [x], (x: string) => owner.get(x))],
      [["S1a", 1], ["S1b", 1], ["S3", 0]]);
  });
  test("CL5 a column the list does not reach has no place; a repeated id keeps its first", () => {
    assert.deepEqual([...c.caseListRanks({ level: "sample", ids: ["S2", "S9", "S2"] }, ["S1", "S2"], "sample", (x: string) => [x])], [["S2", 0]]);
  });
});

const PIDS = ["P1", "P2", "P3", "P4", "P5"];
const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  genes: ["TP53"],
  groups: [{ name: "all", pids: PIDS }],
  studies: ["s"],
  events: [{ pid: "P5", gene: "TP53", vt: "mutation", mt: "Nonsense_Mutation" } as EventRow, { pid: "P4", gene: "TP53", vt: "mutation", mt: "Nonsense_Mutation" } as EventRow],
  coverage: PIDS.map((pid) => ({ pid, genes: ["TP53"] })),
  isDriver: () => false,
  annotationSource: "fixture",
  clinical: [], heatmap: [], derived: [],
  sort: [{ track: "genomic", dir: "asc" }], lineGap: 90,
  ...over
});

describe("CL6-CL7: the sort key", () => {
  const rank = new Map([["P3", 0], ["P1", 1], ["P5", 2]]);
  test("CL6 caseList: the listed columns in list order, then the rest by the staircase and id", () => {
    const k = assembleContract(base({ sort: [{ track: "caseList", dir: "asc" }], caseListRank: rank } as Partial<AssembleInput>));
    assert.deepEqual(k.columns, ["P3", "P1", "P5", "P4", "P2"]);
  });
  test("CL6 descending reverses the listed columns; unlisted stay last", () => {
    const k = assembleContract(base({ sort: [{ track: "caseList", dir: "desc" }], caseListRank: rank } as Partial<AssembleInput>));
    assert.deepEqual(k.columns, ["P5", "P1", "P3", "P4", "P2"]);
  });
  test("CL7 refused without a list, saying why", () => {
    assert.throws(() => assembleContract(base({ sort: [{ track: "caseList", dir: "asc" }] })), /user-defined case list/);
  });
  test("CL7 the contract offers the order only with a list", () => {
    assert.equal((assembleContract(base({ caseListRank: rank } as Partial<AssembleInput>)).conventions as any).caseList, true);
    assert.equal((assembleContract(base()).conventions as any).caseList, undefined);
  });
});

describe("CL8: applied by the engine", () => {
  const t = te as unknown as Record<string, any>;
  test("caseList, either direction, is an engine sort key; id and a track are not", () => {
    assert.deepEqual(["caseList", "-caseList", "cluster:mrna", "id", "SEX"].map(t.isEngineSortKey), [true, true, true, false, false]);
  });
  test("choosing it changes what decides a re-run; choosing the id does not", () => {
    const v = { kind: "oncoprint", genes: ["KRAS"] };
    const dp = (x: object) => JSON.stringify((vd as any).dataPart(x));
    assert.notEqual(dp({ ...v, sort: ["caseList"] }), dp(v));
    assert.equal(dp({ ...v, sort: ["id"] }), dp(v));
  });
  test("a case-list key survives pruning", () => {
    assert.deepEqual(t.pruneSort({ genes: ["KRAS"], sort: ["caseList", "GONE"] }).sort, ["caseList"]);
  });
});
