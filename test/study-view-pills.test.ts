// Explore's filter bar as the Study View's (lib/study-view-pills.ts): pills grouped and named by
// chart (STV-FB-3), the interval text (STV-FB-4), its editable ends, and each pill's ×.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { editInterval, filterGroups, intervalText, leafInterval, removePill } from "../lib/study-view-pills.ts";
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
  test("a value list is a pill per value; OR'd ranges a pill per range", () => {
    assert.deepEqual(g[0].kind === "chart" && g[0].pills.map((p) => p.kind === "value" && p.value), ["White", "Asian"]);
    assert.deepEqual(g[1].kind === "chart" && g[1].pills.map((p) => p.kind === "interval" && intervalText(p.interval)), ["50 < x ≤ 55", "70 < x ≤ 75"]);
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
