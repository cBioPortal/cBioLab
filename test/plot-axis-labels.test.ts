// A plot axis's categories as the portal writes them (PLT-DT-3, DT-4, DT-5, DT-9, DT-11;
// docs/legacy-spec/04-plots.md §3, cbioportal-frontend cd8c6df PlotsTabUtils.tsx): their order,
// which of them read as "nothing here", and their colours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryOrder } from "../lib/views/plot/run.ts";
import { isAbsent } from "../lib/plot-draw.ts";
import { categoryColor, type PlotAxis } from "../lib/plot.ts";

const order = (axis: PlotAxis, labels: string[]) => {
  const f = categoryOrder(axis);
  assert.ok(f, "the axis has a category order");
  return f(labels);
};

test("U1 Mutation Type: classes, then Multiple, No mutation, Not profiled (PLT-DT-3)", () => {
  assert.deepEqual(order({ source: "alteration", gene: "KRAS", by: "mutationType" }, ["Not profiled", "No mutation", "Missense", "Multiple", "Truncating"]),
    ["Missense", "Truncating", "Multiple", "No mutation", "Not profiled"]);
});

test("U2 Mutated vs Wild-type: Mutated, No mutation, Not profiled (PLT-DT-4)", () => {
  assert.deepEqual(order({ source: "alteration", gene: "KRAS", by: "mutated" }, ["No mutation", "Not profiled", "Mutated"]),
    ["Mutated", "No mutation", "Not profiled"]);
});

test("U3 Driver vs VUS: Driver, VUS, No mutation, Not profiled (PLT-DT-5)", () => {
  assert.deepEqual(order({ source: "alteration", gene: "KRAS", by: "driver" }, ["No mutation", "VUS", "Driver", "Not profiled"]),
    ["Driver", "VUS", "No mutation", "Not profiled"]);
});

test("U4 Variant vs No Variant: With, No, Not profiled for structural variants (PLT-DT-9)", () => {
  assert.deepEqual(order({ source: "alteration", gene: "KRAS", by: "sv" },
    ["Not profiled for structural variants", "No Structural Variants", "With Structural Variants"]),
  ["With Structural Variants", "No Structural Variants", "Not profiled for structural variants"]);
});

test("U5 discrete copy number: Deep Deletion, Shallow Deletion, Diploid, Gain, Amplification (PLT-DT-11)", () => {
  assert.deepEqual(order({ source: "molecular", profileType: "x", gene: "KRAS", discrete: true }, ["Gain", "Deep Deletion", "Diploid", "Amplification", "Shallow Deletion"]),
    ["Deep Deletion", "Shallow Deletion", "Diploid", "Gain", "Amplification"]);
});

test("U6 the portal's and the model's 'nothing here' labels are absent", () => {
  for (const l of ["No mutation", "No Structural Variants", "Not profiled for structural variants", "Not mutated", "No structural variant", "Not profiled"])
    assert.equal(isAbsent(l), true, l);
});

test("U7 an alteration is not absent", () => {
  for (const l of ["With Structural Variants", "Mutated", "Deep Deletion"])
    assert.equal(isAbsent(l), false, l);
});

test("U8 the portal's copy-number labels keep the colours the old labels had", () => {
  // categoryColor("Deep deletion") and categoryColor("Shallow deletion") before the relabel
  assert.equal(categoryColor("Deep Deletion"), "#0000ff");
  assert.equal(categoryColor("Shallow Deletion"), "#0072B2");
});
