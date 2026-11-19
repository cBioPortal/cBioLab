// Explore's filter bar as the Study View's (lib/study-view-pills.ts): pills grouped and named by
// chart (STV-FB-3), the interval text (STV-FB-4), its editable ends, and each pill's ×.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ALL_LEAVES, editInterval, filterGroups, intervalEnds, intervalText, leafInterval, removePill, geneTablePills, removeOqlLine, joinedByAnd } from "../lib/study-view-pills.ts";
import { naClause } from "../lib/explore-selection.ts";
import type { ClinicalLeaf, CohortDef } from "../lib/types.ts";

const age = (range: ClinicalLeaf["range"]): ClinicalLeaf => ({ kind: "clinical", attribute: "AGE", range });
const sex: ClinicalLeaf = { kind: "clinical", attribute: "SEX", op: "=", value: "Female" };
const race: ClinicalLeaf = { kind: "clinical", attribute: "RACE", values: ["White", "Asian"] };
const oql = { kind: "oql", q: "KRAS: MUT" } as unknown as ClinicalLeaf;
const names: Record<string, string> = { AGE: "Diagnosis Age", SEX: "Sex", RACE: "Race Category" };
const labelOf = (a: string) => names[a];

describe("interval text (STV-FB-4)", () => {
  const t = (r: ClinicalLeaf["range"]) => intervalText(leafInterval(age(r))!);
  test("a bar's (start, end] reads as the portal writes it", () => assert.equal(t({ gt: 50, lte: 60 }), "50 < x ≤ 60"));
  test("a discrete run is closed at both ends", () => assert.equal(t({ gte: 1, lte: 3 }), "1 ≤ x ≤ 3"));
  test("open ends", () => {
    assert.equal(t({ gt: 90 }), "> 90");
    assert.equal(t({ gte: 90 }), "≥ 90");
    assert.equal(t({ lte: 35 }), "≤ 35");
    assert.equal(t({ lt: 35 }), "< 35");
  });
  test("one value alone", () => assert.equal(intervalText(leafInterval({ kind: "clinical", attribute: "AGE", op: "=", value: 7 })!), "7"));
  test("a word or a value list has no interval", () => {
    assert.equal(leafInterval(sex), null);
    assert.equal(leafInterval(race), null);
  });
});

describe("groups (STV-FB-3)", () => {
  const d: CohortDef = { all: [race, { any: [age({ gt: 50, lte: 55 }), age({ gt: 70, lte: 75 })] }, oql as never, naClause("SEX")] };
  const g = filterGroups(d, labelOf);
  test("each chart's filter is named by the chart, in the draft's order", () => {
    assert.deepEqual(g.map((x) => x.kind === "chart" ? x.label : x.kind), ["Race Category", "Diagnosis Age", "other", "Sex"]);
  });
  test("a value list is a pill per value; OR'd ranges one pill, the first range's start to the last's end, as the portal writes it", () => {
    assert.deepEqual(g[0].kind === "chart" && g[0].pills.map((p) => p.kind === "value" && p.value), ["White", "Asian"]);
    // STV-FB-4 (intervalFiltersDisplayValue), the user's answer of 2026-11-19: one pill, though it reads wider than the filter
    assert.deepEqual(g[1].kind === "chart" && g[1].pills.map((p) => p.kind === "interval" && [p.leaf, intervalText(p.interval)]), [[ALL_LEAVES, "50 < x ≤ 75"]]);
  });
  test("NA is the chart's one pill", () => assert.deepEqual(g[3].kind === "chart" && g[3].pills, [{ kind: "na" }]));
  test("an attribute with no chart name keeps its id", () => {
    const [x] = filterGroups({ all: [{ kind: "clinical", attribute: "TMB", op: "=", value: "High" }] }, labelOf);
    assert.equal(x.kind === "chart" && x.label, "TMB");
  });
  test("a clause no clinical chart owns is left to the generic pills", () => {
    const [x] = filterGroups({ all: [{ kind: "clinical", attribute: "AGE", op: ">", value: 3 }] }, labelOf);
    assert.equal(x.kind, "other");
  });
});

test("a density drag's ranges have no pill, as the portal's (STV-FB-3b); the same range from a bar keeps its pill", () => {
  const drag = { kind: "clinical", attribute: "AGE", range: { gte: 50, lte: 60 }, chart: "density:AGE|MUTATION_COUNT" } as ClinicalLeaf;
  const [g, h] = filterGroups({ all: [drag, age({ gte: 50, lte: 60 })] }, labelOf, new Set(["density:AGE|MUTATION_COUNT"]));
  assert.equal(g.kind, "hidden");
  assert.equal(h.kind, "chart");
});

// invariant 1 (Reviewer, #473): a drag's filter whose chart is not drawn (after a reload, a study
// change, or the chart unchecked) must still show, so it reads as an ordinary range pill
test("a density drag's ranges are a pill again when their chart is not drawn", () => {
  const drag = { kind: "clinical", attribute: "AGE", range: { gte: 50, lte: 60 }, chart: "density:AGE|MUTATION_COUNT" } as ClinicalLeaf;
  for (const drawn of [new Set<string>(), new Set(["density:FRACTION_GENOME_ALTERED|MUTATION_COUNT"])]) {
    const [g] = filterGroups({ all: [drag] }, labelOf, drawn);
    assert.equal(g.kind, "chart");
    assert.deepEqual(g.kind === "chart" && g.pills.map((p) => p.kind === "interval" && intervalText(p.interval)), ["50 ≤ x ≤ 60"]);
  }
  assert.equal(filterGroups({ all: [drag] }, labelOf)[0].kind, "chart", "no charts said drawn: every pill shows");
});

describe("several ranges of one chart, one pill (STV-FB-4)", () => {
  const d: CohortDef = { all: [sex, { any: [age({ gt: 70, lte: 75 }), age({ gt: 50, lte: 55 })] }] };
  test("the pill runs from the lowest start to the highest end, each end's own bound kept", () => {
    const [, g] = filterGroups(d, labelOf);
    assert.deepEqual(g.kind === "chart" && g.pills.map((p) => p.kind === "interval" && intervalText(p.interval)), ["50 < x ≤ 75"]);
    const open = filterGroups({ all: [{ any: [age({ lte: 35 }), age({ gte: 60, lte: 65 }), { kind: "clinical", attribute: "AGE", op: "=", value: 80 } as ClinicalLeaf] }] }, labelOf)[0];
    assert.deepEqual(open.kind === "chart" && open.pills.map((p) => p.kind === "interval" && intervalText(p.interval)), ["≤ 80"], "an open start stays open; a point is its own end");
  });
  test("its × removes the chart's whole filter", () => {
    assert.deepEqual(removePill(d, 1, { kind: "interval", leaf: ALL_LEAVES, interval: { kind: "range", lo: 50, loIn: false, hi: 75, hiIn: true } }).all, [sex]);
  });
  test("an edited end makes the filter that one interval, as the portal's edit does", () => {
    const r = editInterval(d, 1, ALL_LEAVES, "hi", "60");
    assert.ok("draft" in r);
    assert.deepEqual(r.draft.all, [sex, age({ gt: 50, lte: 60 })]);
    assert.deepEqual(intervalEnds(r.draft, 1, ALL_LEAVES), [50, 60], "the edited filter's ends, for the chart's custom bins");
    assert.deepEqual(intervalEnds(d, 1, ALL_LEAVES), [50, 75]);
  });
  test("ranges mixed with a value list keep a pill each", () => {
    const mixed = filterGroups({ all: [{ any: [age({ gt: 50, lte: 55 }), { kind: "clinical", attribute: "AGE", values: ["unknown"] } as ClinicalLeaf] }] }, labelOf)[0];
    assert.equal(mixed.kind === "chart" && mixed.pills.length, 2);
  });
});

describe("a pill's ×", () => {
  test("a value leaves its list; the last two become one value, the last one the filter", () => {
    const d: CohortDef = { all: [{ ...race, values: ["White", "Asian", "Black"] }, sex] };
    const [g] = filterGroups(d, labelOf);
    if (g.kind !== "chart") throw new Error("chart");
    const d1 = removePill(d, 0, g.pills[1]);
    assert.deepEqual(d1.all![0], { ...race, values: ["White", "Black"] });
    const d2 = removePill(d1, 0, { kind: "value", leaf: 0, value: "White" });
    assert.deepEqual(d2.all![0], { kind: "clinical", attribute: "RACE", op: "=", value: "Black" });
    assert.deepEqual(removePill(d2, 0, { kind: "value", leaf: 0, value: "Black" }).all, [sex]);
  });
  test("a range leaves its OR; the one left stands alone", () => {
    const d: CohortDef = { all: [{ any: [age({ gt: 50, lte: 55 }), age({ gt: 70, lte: 75 })] }] };
    assert.deepEqual(removePill(d, 0, { kind: "interval", leaf: 0, interval: { kind: "range", loIn: false, hiIn: true } }).all, [age({ gt: 70, lte: 75 })]);
  });
  test("NA removes its clause", () => {
    assert.deepEqual(removePill({ all: [sex, naClause("RACE")] }, 1, { kind: "na" }).all, [sex]);
  });
});

describe("editing an interval's end", () => {
  const d: CohortDef = { all: [sex, age({ gt: 50, lte: 60 })] };
  const ok = (r: ReturnType<typeof editInterval>) => { if ("why" in r) throw new Error(r.why); return r.draft.all![1]; };
  test("start and end take the typed number, keeping each side's bound", () => {
    assert.deepEqual(ok(editInterval(d, 1, 0, "lo", "52.5")), age({ gt: 52.5, lte: 60 }));
    assert.deepEqual(ok(editInterval(d, 1, 0, "hi", " 70 ")), age({ gt: 50, lte: 70 }));
  });
  test("a start past the end swaps them", () => {
    assert.deepEqual(ok(editInterval(d, 1, 0, "lo", "65")), age({ gt: 60, lte: 65 }));
    assert.deepEqual(ok(editInterval(d, 1, 0, "hi", "40")), age({ gt: 40, lte: 50 }));
  });
  test("start = end, empty and non-numbers are refused", () => {
    assert.ok("why" in editInterval(d, 1, 0, "lo", "60"));
    assert.ok("why" in editInterval(d, 1, 0, "lo", ""));
    assert.ok("why" in editInterval(d, 1, 0, "hi", "abc"));
    assert.ok("why" in editInterval(d, 0, 0, "lo", "3"));
  });
  test("an open end stays open", () => {
    assert.deepEqual(ok(editInterval({ all: [sex, age({ gt: 90 })] }, 1, 0, "lo", "80")), age({ gt: 80 }));
  });
  test("one value is replaced; one range of an OR is edited in place", () => {
    assert.deepEqual(ok(editInterval({ all: [sex, { kind: "clinical", attribute: "AGE", op: "=", value: 3 }] }, 1, 0, "point", "4")),
      { kind: "clinical", attribute: "AGE", op: "=", value: 4 });
    const two: CohortDef = { all: [sex, { any: [age({ gt: 50, lte: 55 }), age({ gt: 70, lte: 75 })] }] };
    assert.deepEqual(ok(editInterval(two, 1, 1, "hi", "80")), { any: [age({ gt: 50, lte: 55 }), age({ gt: 70, lte: 80 })] });
  });
});

describe("an interval's numbers after an edit", () => {
  test("its ends, its one value, or none for a word", () => {
    const d: CohortDef = { all: [sex, { any: [age({ gt: 50, lte: 55 }), age({ gte: 70 })] }, { kind: "clinical", attribute: "AGE", op: "=", value: 3 }] };
    assert.deepEqual(intervalEnds(d, 1, 0), [50, 55]);
    assert.deepEqual(intervalEnds(d, 1, 1), [70]);
    assert.deepEqual(intervalEnds(d, 2, 0), [3]);
    assert.deepEqual(intervalEnds(d, 0, 0), []);
    assert.deepEqual(intervalEnds(d, 9, 0), []);
  });
});

// STV-FB-3 #9: a gene table's selection drawn as the portal's filter bar draws it
test("a gene table's selection is a pill per gene, coloured as the oncoprint colours its alteration; any other OQL keeps the generic pill", () => {
  const pills = geneTablePills({ kind: "oql", q: "APC: MUT; KRAS: AMP; CDKN2A: HOMDEL; ALK: FUSION; TP53: MUT_DRIVER", chart: "mutated" });
  assert.deepEqual(pills!.map((p) => [p.gene, p.color]), [["APC", "#008000"], ["KRAS", "#ff0000"], ["CDKN2A", "#0000ff"], ["ALK", "#8b00c9"], ["TP53", "#008000"]]);
  assert.equal(pills![4].line, "TP53: MUT_DRIVER", "the OQL line in its tooltip");
  for (const q of ["KRAS: MUT=G12C", "EGFR: AMP; KRAS: MUT=G12C", "TP53", "KRAS: GAIN", ""])
    assert.equal(geneTablePills({ kind: "oql", q, chart: "mutated" }), null, q);
  // only a gene table's clause, which carries its name: a Gene status chart writes the same text beside "profiled KRAS"
  assert.equal(geneTablePills({ kind: "oql", q: "KRAS: MUT" }), null, "a Gene status chart's clause stays a generic pill");
  assert.equal(geneTablePills({ kind: "clinical", attribute: "SEX" }), null);
});

test("removing a gene takes its line out of the clause, and the clause with its last gene", () => {
  const draft = { all: [{ kind: "clinical", attribute: "SEX", op: "=", value: "Female" }, { kind: "oql", q: "APC: MUT; TP53: MUT", chart: "mutated" }] } as unknown as CohortDef;
  const one = removeOqlLine(draft, 1, "APC: MUT");
  assert.deepEqual(one.all![1], { kind: "oql", q: "TP53: MUT", chart: "mutated" }, "the rest keeps the table's name");
  assert.deepEqual(removeOqlLine(one, 1, "TP53: MUT").all, [draft.all![0]]);
  assert.equal((draft.all![1] as { q: string }).q, "APC: MUT; TP53: MUT", "the draft given is not changed");
});

// STV-FB-2: the words between the bar's groups, as the portal's GroupLogic writes them
test("two generic groups in a row from the same chart are joined by \"and\"; a clinical chart's pill or another chart's group by nothing", () => {
  const draft = { all: [
    { any: [{ kind: "oql", q: "APC: MUT" }, { kind: "oql", q: "TP53: MUT" }] },    // a gene-table selection
    { kind: "oql", q: "KRAS: MUT" },                                                 // another one: "and"
    { kind: "clinical", attribute: "SEX", op: "=", value: "Female" },                // a clinical pill: no word
    { kind: "caseList", id: "coadread_all" },                                        // another chart: no word
    { kind: "caseList", id: "coadread_cna" },                                        // the same chart: "and"
    { kind: "treatment", agents: ["A"] },                                            // treatments per patient
    { kind: "treatment", agents: ["B"], time: "Pre" },                               // per sample: another table
  ] } as unknown as CohortDef;
  const groups = filterGroups(draft, () => undefined);
  assert.deepEqual(joinedByAnd(draft, groups), [false, true, false, false, true, false, false]);
  assert.deepEqual(joinedByAnd(null, []), []);
});
