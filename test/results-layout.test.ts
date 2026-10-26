// The Results page's groups and tabs (app/portal/results-layout.ts): Unaltered is the profiled
// patients the query does not match, profiled only for data every queried study holds; the
// expression tabs follow cBioPortal's cross-study rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resultsGroups, resultsLayout } from "../app/portal/results-layout.ts";

const ALL3 = { every: ["MUTATION", "CNA", "SV"] as const, some: [] as never[] };
const q = (studies: string[], entries: string[], filters: any[] = []) => ({ studies, filters, entries, genes: [...new Set(entries.map((e) => e.split(":")[0].trim()))] });
const profiledOf = (def: any) => def.all.filter((c: any) => c.kind === "profiled").map((c: any) => c.type + " " + c.genes.join(","));

test("Unaltered requires profiling for each line's gene and data type; Altered does not", () => {
  const { cohorts } = resultsGroups(q(["s"], ["KRAS", "TP53: MUT", "ERBB2: AMP"]), { every: [...ALL3.every], some: [] });
  // one clause per data type, naming every gene that needs it, so a long query stays within a cohort's 8 clauses
  assert.deepEqual(profiledOf(cohorts.Unaltered), ["MUTATION KRAS,TP53", "CNA KRAS,ERBB2", "SV KRAS"]);
  assert.equal(cohorts.Unaltered.all!.length, 4, "not the query, then three profiled clauses");
  assert.deepEqual(cohorts.Altered.all, [{ kind: "oql", q: "KRAS; TP53: MUT; ERBB2: AMP" }], "the query is one OQL clause, its lines joined by ';'");
  assert.deepEqual(profiledOf(cohorts.Altered), []);
  assert.equal(cohorts.Queried.all!.length, 0);
});

test("a data type the studies do not hold is not required (brca_tcga has no structural variants)", () => {
  const { cohorts } = resultsGroups(q(["brca_tcga"], ["KRAS"]), { every: ["MUTATION", "CNA"], some: [] });
  assert.deepEqual(profiledOf(cohorts.Unaltered), ["MUTATION KRAS", "CNA KRAS"]);
});

test("every group keeps the selection: its studies and Explore's filters", () => {
  const F = { kind: "clinical", attribute: "SEX", values: ["Female"] };
  const { cohorts } = resultsGroups(q(["a", "b"], ["KRAS"], [F]), { every: ["MUTATION"], some: ["CNA"] });
  for (const def of Object.values(cohorts)) { assert.deepEqual((def as any).studies, ["a", "b"]); assert.deepEqual(def.all![0], F); }
  assert.equal((resultsGroups(q(["a"], ["KRAS"]), { every: ["MUTATION"], some: [] }).cohorts.Altered as any).study, "a");
});

const data = (over: Partial<Parameters<typeof resultsLayout>[1]> = {}) =>
  ({ expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE"], numeric: ["MUTATION_COUNT"], expressionAcross: true, held: { every: ["MUTATION", "CNA"], some: ["SV"] }, ...over } as Parameters<typeof resultsLayout>[1]);
const titles = (l: ReturnType<typeof resultsLayout>) => l.tabs.map((t) => t.title);
const plotY = (l: ReturnType<typeof resultsLayout>) => (l.doc.views!.find((v: any) => v.kind === "plot") as any)?.y;

test("a twelve-gene query fits a cohort's limits: 8 clauses, and no group past 8 lines", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => "G" + i);
  const { cohorts } = resultsGroups(q(["s"], twelve), { every: ["MUTATION", "CNA", "SV"], some: [] });
  for (const def of Object.values(cohorts)) {
    assert.ok(def.all!.length <= 8, String(def.all!.length));
    assert.ok(def.all!.every((c: any) => !c.any && !c.not?.any), "no any-group to overflow");
  }
});

test("every tab draws the queried patients; only Comparison/Survival compares Altered with Unaltered", () => {
  const l = resultsLayout(q(["a"], ["KRAS", "TP53"]), data());
  const drawn = l.tabs.flatMap((t) => (t.sub ? t.sub.flatMap((x) => x.views) : t.views!).map((i) => [t.title, (l.doc.views![i] as any).cohorts.join("+")]));
  for (const [tab, cohorts] of drawn) assert.equal(cohorts, tab === "Comparison/Survival" ? "Altered+Unaltered" : "Queried", tab);
});

test("co-expression is for one study; expression in Plots across studies only where the rule allows", () => {
  assert.ok(titles(resultsLayout(q(["a"], ["KRAS", "TP53"]), data())).includes("Co-expression"));
  const two = resultsLayout(q(["a", "b"], ["KRAS", "TP53"]), data());
  assert.ok(!titles(two).includes("Co-expression"));
  assert.equal(plotY(two).source, "profile");
  const refused = resultsLayout(q(["a", "b"], ["KRAS", "TP53"]), data({ expressionAcross: false }));
  assert.equal(plotY(refused).source, "clinical");
  assert.ok(refused.left.some((l) => /cannot be compared across the selected studies/.test(l)));
  assert.ok(two.left.some((l) => /structural-variant profiling/.test(l)), "a type only some studies hold is named");
});

test("each kind of generic assay is a sub-tab of Comparison/Survival, comparing Altered with Unaltered", () => {
  const l = resultsLayout(q(["a"], ["KRAS"]), data({ assays: [{ label: "Mutational signature", profile: "mutational_signatures_contribution_SBS" }, { label: "Arm-level copy number", profile: "armlevel_cna" }] }));
  const comp = l.tabs.find((t) => t.title === "Comparison/Survival")!;
  const sub = comp.sub!.filter((s) => s.title === "Mutational signature" || s.title === "Arm-level copy number");
  assert.deepEqual(sub.map((s) => (l.doc.views![s.views[0]] as any).profileType), ["mutational_signatures_contribution_SBS", "armlevel_cna"]);
  for (const s of sub) assert.deepEqual((l.doc.views![s.views[0]] as any).cohorts, ["Altered", "Unaltered"]);
  assert.ok(!resultsLayout(q(["a"], ["KRAS"]), data()).tabs.find((t) => t.title === "Comparison/Survival")!.sub!.some((s) => /signature/i.test(s.title)));
});

test("a study's mutational signatures compare on single-base contributions first", async () => {
  const { assayComparisonProfiles } = await import("../app/portal/study-known.ts");
  const sig = (profile: string, order: number) => ({ profile, type: "GENERIC_ASSAY", datatype: "LIMIT-VALUE", name: profile, assayType: "MUTATIONAL_SIGNATURE", order });
  const picked = assayComparisonProfiles([sig("mutational_signatures_counts_SBS", 1), sig("mutational_signatures_contribution_DBS", 2),
    sig("mutational_signatures_contribution_ID", 3), sig("mutational_signatures_contribution_SBS", 4)]);
  assert.deepEqual(picked.map((p) => p.profile), ["mutational_signatures_contribution_SBS"]);
});
