// Building and editing a split's arms (lib/partition-arms.ts): arms from an attribute's values, a
// gene, or OQL queries; moving, removing and merging arms; removing a split with what is nested
// under it; Explore's selection turned into arms for every kind of clause a chart can hold; and the
// flat ↔ tree form of a document's splits. Pure functions, so every test reads their results.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  chooseArmValues, partitionFromValues, partitionFromGene, partitionFromOql, armLabel, uniqueName,
  moveArm, removeArm, canMergeArms, mergeArms, descendantPartitions, withoutPartition,
  armsFromSelection, renamePartitionChild, splitKey, flattenSplits, withoutSplitTrees,
  unflattenSplits, editSplits, renameInViews, viewIsEmpty, SPLIT_BY_DEFAULT_MIN_COUNT
} from "../lib/partition-arms.ts";
import type { Clause, CohortDef, Leaf, PartitionDef } from "../lib/types.ts";

const clin = (attribute: string, v: string): Clause => ({ kind: "clinical", attribute, values: [v] });
const oql = (q: string): Leaf => ({ kind: "oql", q });

describe("arms from an attribute's values", () => {
  test("the most frequent values get arms, ties alphabetical, and the rest are pooled and listed", () => {
    const values = [{ v: "b", n: 20 }, { v: "a", n: 20 }, { v: "c", n: 50 }, { v: "rare", n: 3 }, { v: "none", n: 0 }];
    const { def, pooled } = partitionFromValues("LUAD", "SEX", values, { maxArms: 3 });
    assert.deepEqual(def.arms.map((a) => a.name), ["c", "a"], "at most maxArms-1 arms, leaving room for the remainder");
    assert.deepEqual(def.arms[0].where, { kind: "clinical", attribute: "SEX", values: ["c"] });
    assert.deepEqual(pooled, ["b", "rare"], "a value with no patients is in neither");
    assert.deepEqual(def.source, { attribute: "SEX", minCount: SPLIT_BY_DEFAULT_MIN_COUNT, otherValues: ["b", "rare"] });
    assert.equal(def.of, "LUAD");
    assert.equal(def.split, "SEX");
  });

  test("with nothing pooled the source lists no other values", () => {
    const { def, pooled } = partitionFromValues("C", "X", [{ v: "a", n: 30 }, { v: "b", n: 12 }]);
    assert.deepEqual(pooled, []);
    assert.equal("otherValues" in def.source!, false);
  });

  test("refused, naming the threshold, when no value is held by enough patients", () => {
    assert.throws(() => partitionFromValues("C", "X", [{ v: "a", n: 4 }], { minCount: 5 }),
      /no value of X is held by at least 5 patients in “C”/);
  });

  test("chooseArmValues: below minCount a frequent value is pooled, not given an arm", () => {
    const r = chooseArmValues([{ v: "x", n: 9 }, { v: "y", n: 10 }], 8, 10);
    assert.deepEqual(r.own.map((x) => x.v), ["y"]);
    assert.deepEqual(r.pooled.map((x) => x.v), ["x"]);
  });
});

describe("arms from a gene, or OQL", () => {
  test("a gene: one 'mutated' arm, the remainder named wild-type, the symbol normalised", () => {
    const d = partitionFromGene("LUAD", " kras ");
    assert.equal(d.split, "KRAS");
    assert.deepEqual(d.arms, [{ name: "KRAS mutated", where: { kind: "oql", q: "KRAS: MUT" } }]);
    assert.equal(d.other, "KRAS wild-type");
    assert.deepEqual(d.source, { gene: "KRAS" });
  });

  test("a gene that is not a symbol is refused by name", () => {
    assert.throws(() => partitionFromGene("C", "KRAS; DROP"), /'KRAS; DROP' is not a valid gene symbol/);
    assert.throws(() => partitionFromGene("C", ""), /not a valid gene symbol/);
  });

  test("OQL: one arm per non-blank query, in order, named by its query", () => {
    const d = partitionFromOql("C", [" KRAS: MUT=G12C ", "", "EGFR: AMP"]);
    assert.deepEqual(d.arms.map((a) => a.name), ["KRAS: MUT=G12C", "EGFR: AMP"]);
    assert.deepEqual(d.arms[1].where, { kind: "oql", q: "EGFR: AMP" });
    assert.deepEqual(d.source, { oql: ["KRAS: MUT=G12C", "EGFR: AMP"] });
    assert.throws(() => partitionFromOql("C", [" ", ""]), /at least one OQL query/);
  });
});

test("an arm's label: trimmed, '(blank)' for nothing, cut to 80 characters with an ellipsis", () => {
  assert.equal(armLabel("  IV "), "IV");
  assert.equal(armLabel("   "), "(blank)");
  const long = armLabel("x".repeat(100));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith("…"));
  assert.equal(armLabel("y".repeat(80)), "y".repeat(80));
});

test("uniqueName: the base if free, else the first free numbered one", () => {
  assert.equal(uniqueName("A", ["B"]), "A");
  assert.equal(uniqueName("A", ["A", "A 2", "A 4"]), "A 3");
});

describe("editing arms", () => {
  const def = (): PartitionDef => ({ of: "C", split: "s", arms: [
    { name: "a", where: clin("X", "a") }, { name: "b", where: clin("X", "b") }, { name: "k", where: oql("KRAS: MUT") }] });

  test("move: an arm to a new position; a target out of range changes nothing", () => {
    assert.deepEqual(moveArm(def(), 0, 2).arms.map((a) => a.name), ["b", "k", "a"]);
    const d = def();
    assert.equal(moveArm(d, 0, 3), d);
    assert.equal(moveArm(d, 0, -1), d);
  });

  test("remove: the arm at that index only", () => {
    assert.deepEqual(removeArm(def(), 1).arms.map((a) => a.name), ["a", "k"]);
  });

  test("merging two values of one attribute keeps one clinical leaf listing both", () => {
    const m = mergeArms(def(), 0, 1);
    assert.deepEqual(m.arms.map((a) => a.name), ["a + b", "k"]);
    assert.deepEqual(m.arms[0].where, { kind: "clinical", attribute: "X", values: ["a", "b"] });
  });

  test("merging arms of different kinds gives an 'any' at the first arm's position", () => {
    const m = mergeArms(def(), 2, 0);
    assert.deepEqual(m.arms.map((a) => a.name), ["b", "k + a"]);
    assert.deepEqual(m.arms[1].where, { any: [oql("KRAS: MUT"), clin("X", "a")] });
  });

  test("an arm already an 'any' contributes its leaves", () => {
    const d: PartitionDef = { of: "C", split: "s", arms: [{ name: "e", where: { any: [oql("A: MUT"), oql("B: MUT")] } }, { name: "f", where: oql("C: MUT") }] };
    assert.deepEqual(mergeArms(d, 0, 1).arms[0].where, { any: [oql("A: MUT"), oql("B: MUT"), oql("C: MUT")] });
  });

  test("a negated arm, the same arm twice, a missing arm, or more than 8 conditions cannot be merged", () => {
    const leaves = (n: number, p: string) => Array.from({ length: n }, (_, i) => oql(p + i + ": MUT"));
    const d: PartitionDef = { of: "C", split: "s", arms: [
      { name: "n", where: { not: oql("A: MUT") } }, { name: "x", where: oql("B: MUT") },
      { name: "five", where: { any: leaves(5, "F") as never } }, { name: "four", where: { any: leaves(4, "G") as never } }] };
    assert.equal(canMergeArms(d, 0, 1), false);
    assert.equal(canMergeArms(d, 1, 1), false);
    assert.equal(canMergeArms(d, 1, 9), false);
    assert.equal(canMergeArms(d, 2, 3), false, "5 + 4 conditions is past 8");
    assert.equal(canMergeArms(d, 1, 2), true);
    assert.throws(() => mergeArms(d, 0, 1), /cannot be merged/);
  });
});

describe("removing a split", () => {
  const doc = () => ({
    partitions: {
      "C / k": { of: "C", split: "k", arms: [{ name: "mut", where: oql("KRAS: MUT") }] },
      "C / k / mut / sex": { of: "C / k / mut", split: "sex", arms: [{ name: "F", where: clin("SEX", "F") }] },
      "C / k / mut / sex / F / st": { of: "C / k / mut / sex / F", split: "st", arms: [{ name: "IV", where: clin("ST", "IV") }] },
      "D / g": { of: "D", split: "g", arms: [{ name: "x", where: oql("EGFR: MUT") }] },
    } as Record<string, PartitionDef>,
    views: [
      { kind: "km", cohorts: ["C / k"] },
      { kind: "km", cohorts: ["C / k / mut / sex / F", "D"] },
      { kind: "km", cohorts: ["C / k / mut"] },
      { kind: "notes" },
    ],
  });

  test("descendants: every split nested, at any depth, under a child of the named one", () => {
    assert.deepEqual(descendantPartitions(doc().partitions, "C / k").sort(), ["C / k / mut / sex", "C / k / mut / sex / F / st"]);
    assert.deepEqual(descendantPartitions(doc().partitions, "D / g"), []);
  });

  test("the split and its descendants go; a view naming the split shows the cohort it split, and one left with nothing goes", () => {
    const { doc: out, removed } = withoutPartition(doc(), "C / k");
    assert.deepEqual(removed.sort(), ["C / k", "C / k / mut / sex", "C / k / mut / sex / F / st"]);
    assert.deepEqual(Object.keys(out.partitions!), ["D / g"]);
    assert.deepEqual(out.views, [{ kind: "km", cohorts: ["C"] }, { kind: "km", cohorts: ["D"] }, { kind: "notes" }]);
  });

  test("removing the last split drops the partitions key; an unknown one is refused listing what there is", () => {
    const one = { partitions: { "D / g": doc().partitions["D / g"] }, views: [] };
    assert.equal("partitions" in withoutPartition(one, "D / g").doc, false);
    assert.throws(() => withoutPartition(one, "nope"), /no partition “nope”; have D \/ g/);
    assert.throws(() => withoutPartition({ views: [] }, "x"), /have none/);
  });
});

describe("Explore's selection as arms, for every clause a chart holds", () => {
  test("an equality on the chart's attribute is one arm; an op-only comparison and an op-less clause", () => {
    const r = armsFromSelection({ all: [
      { kind: "clinical", attribute: "AGE", op: "=", value: 60 } as Clause,
      { kind: "clinical", attribute: "AGE", op: ">", value: 70 } as Clause,
    ] }, { kind: "clinical", attribute: "AGE" })!;
    assert.deepEqual(r.arms.map((a) => a.name), ["60", "> 70"]);
    assert.deepEqual(r.arms[0].where, { kind: "clinical", attribute: "AGE", values: [60] });
    assert.deepEqual(r.arms[1].where, { kind: "clinical", attribute: "AGE", op: ">", value: 70 });
  });

  test("a clause of the chart's attribute with nothing selectable stays in the base", () => {
    const odd = { kind: "clinical", attribute: "AGE", percentile: 0.5 } as unknown as Clause;
    assert.equal(armsFromSelection({ all: [odd] }, { kind: "clinical", attribute: "AGE" }), null);
  });

  test("ranges are labelled by their bounds, inclusive or not", () => {
    const r = armsFromSelection({ all: [
      { kind: "clinical", attribute: "T", range: { gte: 1, lt: 5 } } as Clause,
      { kind: "clinical", attribute: "T", range: { lte: 0 } } as Clause,
      { kind: "clinical", attribute: "T", range: {} } as Clause,
    ] }, { kind: "clinical", attribute: "T" })!;
    assert.deepEqual(r.arms.map((a) => a.name), ["≥ 1 and < 5", "≤ 0", "any"]);
  });

  test("an assay chart: each selected value an arm, each range an arm, other clauses kept", () => {
    const base = { kind: "genericAssay", profileType: "armlevel_cna", entity: "8q" };
    const r = armsFromSelection({ all: [
      { ...base, values: ["Gain", "Loss"] } as Clause,
      { ...base, range: { gt: 0.5 } } as Clause,
      { ...base, measured: true } as Clause,
      oql("TP53: MUT"),
    ] }, { kind: "assay", profileType: "armlevel_cna", entity: "8q" })!;
    assert.deepEqual(r.arms.map((a) => a.name), ["Gain", "Loss", "> 0.5"]);
    assert.deepEqual(r.arms[0].where, { ...base, values: ["Gain"] });
    assert.deepEqual(r.base.all, [{ ...base, measured: true }, oql("TP53: MUT")]);
  });

  test("arms with the same label are numbered apart", () => {
    const r = armsFromSelection({ all: [clin("X", "a"), clin("X", "a")] }, { kind: "clinical", attribute: "X" })!;
    assert.deepEqual(r.arms.map((a) => a.name), ["a", "a 2"]);
  });

  test("more than 8 items selected is refused, naming the count", () => {
    const all = [{ kind: "clinical", attribute: "X", values: Array.from({ length: 9 }, (_, i) => "v" + i) } as Clause];
    assert.throws(() => armsFromSelection({ all }, { kind: "clinical", attribute: "X" }), /at most 8 arms, and 9 items are selected/);
  });
});

describe("renaming a split's child: the edge cases", () => {
  const doc = () => ({ partitions: { "C / s": { of: "C", split: "s", arms: [{ name: "a", where: clin("X", "a") }] } as PartitionDef }, views: [] });
  test("an unknown split, an over-long name, and a no-op rename", () => {
    assert.throws(() => renamePartitionChild(doc(), "nope", "a", "b"), /no partition “nope”/);
    assert.throws(() => renamePartitionChild(doc(), "C / s", "a", "z".repeat(81)), /at most 80 characters/);
    const d = doc();
    assert.equal(renamePartitionChild(d, "C / s", "a", " a "), d, "the same name, trimmed, changes nothing");
  });
  test("renaming the remainder of a split with no `other` named renames 'Other'", () => {
    const out = renamePartitionChild(doc(), "C / s", "Other", "rest");
    assert.equal(out.partitions["C / s"].other, "rest");
  });
});

describe("the split tree on cohorts and its flat form", () => {
  const cohorts = (): Record<string, CohortDef> => ({
    C: { all: [], splits: { k: {
      arms: [{ name: "mut", where: oql("KRAS: MUT"), splits: { sex: { arms: [{ name: "F", where: clin("SEX", "F") }] } } }],
      other: "wt", otherSplits: { st: { arms: [{ name: "IV", where: clin("ST", "IV") }] } } } } },
    D: { all: [oql("EGFR: MUT")] },
  });

  test("splitKey joins owner and split with ' / '", () => {
    assert.equal(splitKey("C / k / mut", "sex"), "C / k / mut / sex");
  });

  test("flatten keys each split by its owner, nested arm and remainder splits included, arms without their splits", () => {
    const flat = flattenSplits(cohorts());
    assert.deepEqual(Object.keys(flat).sort(), ["C / k", "C / k / mut / sex", "C / k / wt / st"]);
    assert.equal(flat["C / k / wt / st"].of, "C / k / wt");
    assert.equal("splits" in flat["C / k"].arms[0], false);
    assert.throws(() => flattenSplits({ C: { all: [], splits: { bad: null as never } } }), /split “bad” of “C” must be an object/);
  });

  test("withoutSplitTrees strips splits and leaves cohorts without any untouched", () => {
    const c = cohorts();
    const out = withoutSplitTrees(c);
    assert.equal("splits" in out.C, false);
    assert.equal(out.D, c.D);
  });

  test("flatten then unflatten gives the same tree back", () => {
    assert.deepEqual(unflattenSplits(cohorts(), flattenSplits(cohorts())), cohorts());
  });

  test("unflatten refuses a split of nothing, and a split of something that is not an arm", () => {
    const base = { C: { all: [] } } as Record<string, CohortDef>;
    assert.throws(() => unflattenSplits(base, { x: { of: "Nowhere", split: "x", arms: [] } }), /not a cohort or an arm of a split/);
    assert.throws(() => unflattenSplits(base, {
      "C / k": { of: "C", split: "k", arms: [{ name: "a", where: oql("A: MUT") }] },
      "C / k / b / s": { of: "C / k / b", split: "s", arms: [] },
    }), /which is not an arm of “C \/ k”/);
  });

  test("editSplits: removing an arm drops the splits nested under it, and views come back from the edit", () => {
    const doc = { cohorts: cohorts(), views: [{ cohorts: ["C / k"] }] };
    const out = editSplits(doc, ({ partitions, views }) => ({
      partitions: { ...partitions, "C / k": { ...partitions["C / k"], arms: [{ name: "G12C", where: oql("KRAS: MUT=G12C") }] } },
      views: [...views!, { cohorts: ["D"] }],
    }));
    assert.deepEqual(Object.keys(flattenSplits(out.cohorts)).sort(), ["C / k", "C / k / wt / st"]);
    assert.deepEqual(out.views, [{ cohorts: ["C / k"] }, { cohorts: ["D"] }]);
  });
});

test("renameInViews: the name and every name beneath it, nothing else", () => {
  const views = [{ cohorts: ["A", "A / s", "AB", "B"] }, { kind: "notes" }];
  assert.deepEqual(renameInViews(views, "A", "Z"), [{ cohorts: ["Z", "Z / s", "AB", "B"] }, { kind: "notes" }]);
  assert.equal(renameInViews(undefined, "A", "Z"), undefined);
});

test("viewIsEmpty: a view naming no cohorts waits; a splitBy view draws its split's arms", () => {
  assert.equal(viewIsEmpty({ cohorts: [] }), true);
  assert.equal(viewIsEmpty({}), true);
  assert.equal(viewIsEmpty(null), true);
  assert.equal(viewIsEmpty({ cohorts: ["A"] }), false);
  assert.equal(viewIsEmpty({ splitBy: "A / s" }), false);
});
