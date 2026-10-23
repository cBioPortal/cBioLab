// Table 1 of the risk model (lib/views/riskmodel/table1.ts buildTable1, lib/views/riskmodel/run.ts riskTable1):
// each risk group's makeup, counted from patients by position. Synthetic patients, so every count
// can be read off — above all the panel-aware denominator: a patient whose panels do not cover a
// gene is not profiled for it, never unaltered.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildTable1, table1DefaultCandidates, TABLE1_DEFAULT_ATTRIBUTES, TABLE1_DEFAULT_MAX_VALUES, type Table1Input, type Table1Patient } from "../lib/views/riskmodel/table1.ts";
import { riskTable1, RiskRefusal, type RiskFit, type RiskGrouping, type RiskFitArgs } from "../lib/views/riskmodel/run.ts";
import { chiSquareTest } from "../lib/stats.ts";
import type { RiskTable1Row } from "../lib/views/riskmodel/types.ts";

const patient = (o: Partial<Table1Patient> = {}): Table1Patient => ({ panels: ["IMPACT468"], genes: [], d: [], r: [], u: [], ...o });

/** Two groups of patients; attributes and genes as given. */
function input(patients: Table1Patient[], o: Partial<Table1Input> = {}): Table1Input {
  const half = Math.ceil(patients.length / 2);
  return {
    study: "s", reportedOn: "held-out scores", measure: "any",
    groups: [{ name: "Low risk", members: patients.map((_, i) => i).slice(0, half) }, { name: "High risk", members: patients.map((_, i) => i).slice(half) }],
    patients, attributes: [], attributesDefault: false, genes: [], genesDefault: false,
    panelGenes: new Map([["IMPACT468", new Set(["KEAP1", "TP53"])], ["IMPACT341", new Set(["TP53"])]]),
    model: { genes: [], covariates: [], strata: null, outcome: ["OS_MONTHS", "OS_STATUS"] },
    ...o,
  };
}
const row = (rows: RiskTable1Row[], name: string) => rows.find((x) => x.name === name)!;

describe("gene rows: the panel-aware denominator", () => {
  test("a patient whose panels omit the gene is not profiled, not unaltered; whole-exome covers every gene", () => {
    const ps = [
      patient({ genes: ["KEAP1"] }), patient(), patient({ panels: ["IMPACT341"] }), patient({ panels: ["IMPACT341"] }),   // low: 1 of 2 profiled
      patient({ panels: ["WES"], genes: ["KEAP1"] }), patient({ genes: ["KEAP1"] }), patient({ panels: ["IMPACT341"] }), patient(),   // high: 2 of 3 profiled
    ];
    const t = buildTable1(input(ps, { genes: ["KEAP1"] })).table;
    const k = row(t.rows, "KEAP1") as Extract<RiskTable1Row, { kind: "gene" }>;
    assert.deepEqual(k.perGroup, [{ altered: 1, profiled: 2, notProfiled: 2 }, { altered: 2, profiled: 3, notProfiled: 1 }]);
    assert.equal(k.p, chiSquareTest([[1, 1], [2, 1]]).p, "tested on mutated vs not among the profiled only");
  });

  test("a gene on one panel among several is counted over that panel's patients only, not the group", () => {
    // the dangerous edit: dividing by the group's size. Every patient here is on IMPACT341, which lacks KEAP1
    const ps = Array.from({ length: 6 }, () => patient({ panels: ["IMPACT341"] }));
    const t = buildTable1(input(ps, { genes: ["KEAP1"] })).table;
    const k = row(t.rows, "KEAP1") as Extract<RiskTable1Row, { kind: "gene" }>;
    assert.deepEqual(k.perGroup.map((c) => c.profiled), [0, 0]);
    assert.equal(k.p, null);
    assert.match(String(k.untested), /sequenced on a panel covering it/);
  });

  test("a symbol resolves case-insensitively, once; one on no panel and mutated in nobody is set aside by name", () => {
    const ps = [patient({ genes: ["KEAP1"] }), patient(), patient(), patient({ genes: ["KEAP1"] })];
    const t = buildTable1(input(ps, { genes: ["keap1", "KEAP1", "NOTAGENE"] })).table;
    assert.deepEqual(t.rows.map((x) => x.kind + ":" + x.name), ["gene:KEAP1", "skipped:NOTAGENE"]);
    assert.deepEqual(t.describe.genes, ["KEAP1", "NOTAGENE"]);
  });
});

describe("rows the groups differ in by construction", () => {
  const ps = Array.from({ length: 40 }, (_, i) => patient({
    genes: i >= 20 && i % 2 ? ["KEAP1"] : i % 5 === 0 ? ["TP53"] : [],
    d: [i < 20 ? "never" : i % 3 ? "former" : "never", String(i % 4 ? "female" : "male"), i < 20 ? "0:living" : "1:deceased"],
    r: [i < 20 ? "Never" : i % 3 ? "Former" : "Never", String(i % 4 ? "Female" : "Male"), i < 20 ? "0:LIVING" : "1:DECEASED"], u: [1, 1, 1],
  }));
  const meta = { numeric: false, patient: true };
  const t = buildTable1(input(ps, {
    attributes: [{ name: "SMOKING", meta: { id: "SMOKING", ...meta } }, { name: "SEX", meta: { id: "SEX", ...meta } }, { name: "OS_STATUS", meta: { id: "OS_STATUS", ...meta } }],
    genes: ["KEAP1", "TP53"], model: { genes: ["KEAP1"], covariates: ["SMOKING"], strata: "SEX", outcome: ["OS_MONTHS", "OS_STATUS"] },
  })).table;

  test("the model's genes and covariates are 'in the model', its endpoint 'outcome', its stratum 'stratum'", () => {
    assert.deepEqual(t.rows.map((x) => x.name + "=" + ("role" in x ? x.role : "")), ["SMOKING=in the model", "SEX=stratum", "OS_STATUS=outcome", "KEAP1=in the model", "TP53=null"]);
  });

  test("they keep a p-value but get no q-value and stay out of the Benjamini–Hochberg family; the stratum stays in", () => {
    for (const n of ["SMOKING", "OS_STATUS", "KEAP1"]) {
      const x = row(t.rows, n) as Exclude<RiskTable1Row, { kind: "skipped" }>;
      assert.ok(x.p != null && x.q == null, n);
    }
    assert.equal(t.tested, 2, "SEX and TP53");
    // with two rows in the family, the larger p is its own q
    const sex = row(t.rows, "SEX") as Exclude<RiskTable1Row, { kind: "skipped" }>, tp53 = row(t.rows, "TP53") as Exclude<RiskTable1Row, { kind: "skipped" }>;
    assert.equal(Math.max(sex.q!, tp53.q!), Math.max(sex.p!, tp53.p!));
  });

  test("categories fold, and show their commonest spelling", () => {
    const smoking = row(t.rows, "SMOKING") as Extract<RiskTable1Row, { kind: "cat" }>;
    assert.deepEqual(smoking.levels.map((l) => l.value).sort(), ["Former", "Never"]);
    assert.deepEqual(smoking.missing, [0, 0]);
  });
});

describe("clinical rows", () => {
  test("numbers: medians per group and Kruskal–Wallis; a value that is not a number is missing", () => {
    const ps = [10, 20, 30, 40, 50, 60, 70, 80].map((v, i) => patient({ d: [i === 1 ? "na" : String(v)], r: [String(v)], u: [i === 7 ? 2 : 1] }));
    const t = buildTable1(input(ps, { attributes: [{ name: "AGE", meta: { id: "AGE", numeric: true, patient: false } }] }));
    const age = row(t.table.rows, "AGE") as Extract<RiskTable1Row, { kind: "num" }>;
    assert.deepEqual(age.perGroup.map((c) => [c.n, c.median, c.missing]), [[3, 30, 1], [4, 65, 0]]);
    assert.equal(age.test, "Kruskal-Wallis");
    assert.equal(age.multiValued, 1);
    assert.equal(age.per, "sample");
    assert.equal(t.histograms.filter((h) => h.row === "attribute:AGE").reduce((s, h) => s + h.n, 0), 7);
  });

  test("an attribute the study does not have is set aside by name, and one with no values among these patients too", () => {
    const ps = [patient({ d: ["", ""], r: ["", ""], u: [0, 0] }), patient({ d: ["", ""], r: ["", ""], u: [0, 0] })];
    const t = buildTable1(input(ps, { attributes: [{ name: "NOPE", meta: null }, { name: "EMPTY", meta: { id: "EMPTY", numeric: false, patient: true } }] })).table;
    assert.deepEqual(t.rows.map((x) => x.kind === "skipped" ? x.skipped : ""), ["not a clinical attribute of s", "no value recorded for these patients"]);
  });
});

describe("the default attributes", () => {
  test("the stratum and covariates come first, survival endpoints' columns never", () => {
    assert.deepEqual(table1DefaultCandidates(["OS_STATUS", "STAGE", "AGE", "PFS_MONTHS", "SEX"], { covariates: ["AGE"], strata: "SEX" }), ["SEX", "AGE", "STAGE"]);
  });

  test("one with a single value, none, or too many categories is left out with why; at most the default count are kept", () => {
    const names = ["CONST", "WIDE", "EMPTY", ...Array.from({ length: TABLE1_DEFAULT_ATTRIBUTES + 2 }, (_, k) => "A" + k)];
    const ps = Array.from({ length: 30 }, (_, i) => patient({
      d: names.map((n) => n === "CONST" ? "x" : n === "WIDE" ? "v" + i : n === "EMPTY" ? "" : String(i % 2)),
      r: names.map(() => "v"), u: names.map(() => 1),
    }));
    const t = buildTable1(input(ps, { attributesDefault: true, attributes: names.map((name) => ({ name, meta: { id: name, numeric: false, patient: true } })) })).table;
    assert.deepEqual(t.omitted.map((o) => o.name), ["CONST", "WIDE", "EMPTY"]);
    assert.match(t.omitted[1].why, new RegExp("takes 30 values here \\(a default takes at most " + TABLE1_DEFAULT_MAX_VALUES + "\\)"));
    assert.deepEqual(t.describe.attributes, names.slice(3, 3 + TABLE1_DEFAULT_ATTRIBUTES));
    assert.equal(t.defaults.attributes, true);
  });
});

describe("Table 1 reads the fit's own patients", () => {
  // a resolver that answers the rows query and the metadata, as a patient-level participant would
  const rowsOf = (months: number[]) => months.map((m, i) => ({ m, ev: i % 2, half: 0, panels: ["IMPACT468"], genes: i % 3 ? [] : ["KEAP1"], d0: i % 2 ? "a" : "b", r0: i % 2 ? "A" : "B", u0: 1 }));
  const resolver = (rows: Record<string, unknown>[]) => ({
    queries: [] as { label: string; sql: string }[],
    viewRows: async () => rows,
    viewMeta: async (label: string) => label === "riskmodel:panels" ? [{ panel: "IMPACT468", genes: ["KEAP1"] }] : [{ id: "X", datatype: "STRING", patient: 1, priority: 1 }],
  });
  const fit = (months: number[]) => ({
    n: months.length, validated: false, features: [{ gene: "KEAP1", selected: 1, meanCoef: 1, hr: 2.7, mutated: 2 }],
    subjects: { time: months, entry: months.map(() => 0), event: months.map((_, i) => (i % 2) as 0 | 1), stratum: months.map(() => 0) },
  }) as unknown as RiskFit;
  const grouping = { groups: [{ name: "Low risk" }, { name: "High risk" }], members: [[0, 1, 2], [3, 4, 5]] } as unknown as RiskGrouping;
  const args = { study: "s", def: { all: [] }, compile: { oncokbPin: null, profiles: [], gaProfiles: [] },
    view: { kind: "riskmodel", endpoint: "OS", minMutated: 5, runs: 1 } } as unknown as RiskFitArgs;
  const months = [1, 2, 3, 4, 5, 6];

  test("the same rows give each group its members' values", async () => {
    const t = await riskTable1(resolver(rowsOf(months)) as never, args, fit(months), grouping, { attributes: ["X"] });
    const x = row(t.table.rows, "X") as Extract<RiskTable1Row, { kind: "cat" }>;
    assert.deepEqual(x.levels.map((l) => [l.value, ...l.counts]), [["A", 1, 2], ["B", 2, 1]]);
  });

  test("rows that are not the fit's patients, in the fit's order, are refused rather than described", async () => {
    await assert.rejects(riskTable1(resolver(rowsOf([1, 2, 3, 4, 6, 5])) as never, args, fit(months), grouping, {}), (e) => e instanceof RiskRefusal && /matched to the model's patients/.test(e.message));
    await assert.rejects(riskTable1(resolver(rowsOf(months.slice(1))) as never, args, fit(months), grouping, {}), RiskRefusal);
  });
});
