// The patient view's alteration tables' default columns, from the legacy portal's rules
// (docs/legacy-spec/40-patient-summary.md PAT-MT-1, PAT-MT-2, PAT-CNA-3, PAT-CNA-4, PAT-SV-3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { alterationDefaults, ALTERATION_COLUMNS } from "../lib/patient-alterations.ts";
import { mutationTypeLabelSql } from "../lib/mutation-type.ts";

test("D1 (PAT-MT-2): mutations with 1 sample in view have no Samples column and show Copy #", () => {
  assert.deepEqual(alterationDefaults("mutations", 1), ["gene", "proteinChange", "annotation", "mutationType", "vaf", "copy", "freq"]);
});

test("D2 (PAT-MT-2): mutations with 2+ samples in view show Samples and not Copy #", () => {
  const want = ["samples", "gene", "proteinChange", "annotation", "mutationType", "vaf", "freq"];
  assert.deepEqual(alterationDefaults("mutations", 2), want);
  assert.deepEqual(alterationDefaults("mutations", 4), want);
});

test("D3 (PAT-CNA-4, PAT-SV-3): cna and sv show Samples only with 2+ samples in view", () => {
  for (const t of ["cna", "sv"] as const) {
    assert.ok(!alterationDefaults(t, 1).includes("samples"), t + " with 1");
    assert.equal(alterationDefaults(t, 3)[0], "samples", t + " with 3");
  }
});

test("O1 (PAT-MT-2): mutation columns are in the portal's display order", () => {
  const ids = ALTERATION_COLUMNS.mutations.map((c) => c.id);
  const at = (id: string) => { const i = ids.indexOf(id); assert.ok(i >= 0, id); return i; };
  assert.ok(at("mutationType") < at("vaf"));
  for (const id of ["altCount", "refCount"]) { assert.ok(at("vaf") < at(id)); assert.ok(at(id) < at("copy")); assert.ok(at(id) < at("freq")); }
  assert.ok(at("vaf") < at("copy") && at("vaf") < at("freq"));
});

test("L1 (PAT-MT-1): Mutation Type is searched, filtered and sorted by the portal's label", () => {
  const col = ALTERATION_COLUMNS.mutations.find((c) => c.id === "mutationType")!;
  const label = mutationTypeLabelSql("mutationType");
  // every text column's expression is wrapped as ifNull(toString(<expr>), ''), so `text` holds the label inside that wrapper
  assert.equal(col.text, "ifNull(toString(" + label + "), '')");
  assert.ok(col.order!.includes(label), String(col.order));
});
