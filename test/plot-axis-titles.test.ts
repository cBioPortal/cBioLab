// A plot axis's title as the portal writes it (PLT-DT-19; cbioportal-frontend cd8c6df
// PlotsTabUtils.tsx getAxisLabel): a profile axis is named "GENE: <what it reads>" from the study's
// own description of the profile, and an axis given directly keeps the name it has always had.
// Case table: rows T1–T6; T7–T10 run live in scripts/check-plot-stats.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProfileInfo } from "../lib/profile-catalog.ts";
import { resolveProfileAxis } from "../lib/plot-profile.ts";
import { axisLabel, type PlotAxis } from "../lib/plot.ts";

const P = (profile: string, type: string, datatype: string, name: string): ProfileInfo => ({ profile, type, datatype, name, order: 0 });
const studies = [{ study: "coadread_tcga_pan_can_atlas_2018", catalog: [
  P("mutations", "MUTATION_EXTENDED", "MAF", "Mutations"),
  P("structural_variants", "STRUCTURAL_VARIANT", "SV", "Structural variants"),
] }];
const titled = (a: PlotAxis) => axisLabel(resolveProfileAxis(a, "x", studies));

test("T1 a mutation profile by mutation type is titled with the profile's own name", () => {
  const r = resolveProfileAxis({ source: "profile", profile: "mutations", gene: "kras" }, "x", studies);
  assert.deepEqual(r, { source: "alteration", gene: "KRAS", by: "mutationType", label: "KRAS: Mutations" });
  assert.equal(axisLabel(r), "KRAS: Mutations");
});

test("T2 a mutation profile by mutated is titled Mutated vs Wild Type", () => {
  assert.equal(titled({ source: "profile", profile: "mutations", gene: "kras", by: "mutated" }), "KRAS: Mutated vs Wild Type");
});

test("T3 a mutation profile by driver is titled Driver vs VUS Mutations", () => {
  assert.equal(titled({ source: "profile", profile: "mutations", gene: "kras", by: "driver" }), "KRAS: Driver vs VUS Mutations");
});

test("T4 a structural-variant profile is titled Variant vs No Variant", () => {
  assert.equal(titled({ source: "profile", profile: "structural_variants", gene: "TCF7L2" }), "TCF7L2: Variant vs No Variant");
});

test("T5 an alteration axis given directly, with no label, keeps its own name", () => {
  assert.equal(axisLabel({ source: "alteration", gene: "KRAS", by: "mutationType" }), "KRAS mutation type");
});

test("T6 a clinical axis with no display name known is titled by its attribute id", () => {
  assert.equal(axisLabel({ source: "clinical", attribute: "MUTATION_COUNT" }), "MUTATION_COUNT");
});
