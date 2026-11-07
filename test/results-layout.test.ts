// The Results page's groups and tabs (app/portal/results-layout.ts): Unaltered is the profiled
// patients the query does not match, profiled only for data every queried study holds; the
// expression tabs follow cBioPortal's cross-study rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resultsGroups, resultsLayout, linkMutations, svCheckCohort } from "../app/portal/results-layout.ts";
import type { View } from "../lib/types.ts";

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

test("before the profiles are known, the page lays out the tabs that need nothing else, under the same names", () => {
  const full = resultsLayout(q(["a"], ["KRAS", "TP53"]), data({ svs: false }));
  const first = resultsLayout(q(["a"], ["KRAS", "TP53"]), data({ expr: null, cna: null, clinical: [], numeric: [], partial: true }));
  assert.equal(first.partial, true);
  assert.equal(full.partial, undefined);
  assert.deepEqual(titles(first), ["Oncoprint", "Cancer Types Summary", "Mutual Exclusivity", "Mutations", "Comparison/Survival", "CN Segments", "Pathways", "Download"]);
  assert.ok(!first.left.some((l) => /Co-expression|Plots/.test(l)), "what the profiles decide is not said before they are known");
  // every view laid out first is the same view, under the same name, once the page is whole
  first.names.forEach((n, i) => assert.deepEqual(full.doc.views![full.names.indexOf(n)], first.doc.views![i], n));
  assert.deepEqual(first.doc.cohorts, full.doc.cohorts);
});

test("the Download tab comes last, over the queried samples, with the query's lines as written", () => {
  const l = resultsLayout(q(["a"], ["KRAS", "TP53"]), data());
  assert.equal(l.tabs[l.tabs.length - 1].title, "Download");
  const v = l.doc.views![l.tabs[l.tabs.length - 1].views![0]] as unknown as { kind: string; oql: string[]; cohorts: string[] };
  assert.deepEqual([v.kind, v.cohorts], ["datafiles", ["Queried"]]);
  assert.deepEqual(v.oql, q(["a"], ["KRAS", "TP53"]).entries);
});

test("the Mutations tab: stems selected on the lollipop filter the table to those protein positions, and back", () => {
  const lp = { kind: "hotspots", genes: ["KRAS"], cohorts: ["Queried"] } as unknown as View;
  const tb = { kind: "mutations", gene: "KRAS", cohorts: ["Queried"] } as unknown as View;
  const f = (vs: View[]) => (vs[1] as unknown as { filters?: Record<string, unknown> }).filters;
  const c = (vs: View[]) => (vs[0] as unknown as { codons?: Record<string, number[]> }).codons;
  const picked = linkMutations([{ ...lp, codons: { KRAS: [12, 13] } } as View, tb], 0);
  assert.deepEqual(f(picked), { proteinPos: { values: ["12", "13"] } });
  assert.equal(f(linkMutations([lp, picked[1]], 0)), undefined, "clearing the selection clears the table's filter");
  const both = linkMutations([{ ...lp, codons: { KRAS: [12] }, hide: ["missense.vus"] } as View, tb], 0);
  assert.deepEqual(Object.keys(f(both)!).sort(), ["alteration", "proteinPos"], "the grid and the stems each filter their own column");
  // from the table: a value filter on Protein Position selects those stems; removing it clears them
  assert.deepEqual(c(linkMutations([lp, { ...tb, filters: { proteinPos: { values: ["61", "12"] } } } as View], 1)), { KRAS: [12, 61] });
  assert.equal(c(linkMutations([{ ...lp, codons: { KRAS: [12] } } as View, tb], 1)), undefined);
  // a range on the column is not a set of codons: the plot keeps its selection
  assert.deepEqual(c(linkMutations([{ ...lp, codons: { KRAS: [12] } } as View, { ...tb, filters: { proteinPos: { min: 10, max: 20 } } } as View], 1)), { KRAS: [12] });
});

test("the Structural Variants tab: shown after Mutations once the queried patients are known to carry a call, one gene at a time", () => {
  const Q = q(["a"], ["ALK", "ROS1: FUSION"]);
  // asked: the page is not whole yet, and says nothing of the tab
  const asking = resultsLayout(Q, data());
  assert.equal(asking.partial, true);
  assert.ok(!titles(asking).includes("Structural Variants") && !asking.left.some((l) => /Structural Variants/.test(l)));
  // none: left out, and said so; no data: likewise; a failed check is named as one
  assert.ok(resultsLayout(Q, data({ svs: false })).left.includes("Structural Variants (no structural variant in the queried genes)"));
  assert.equal(resultsLayout(Q, data({ svs: false })).partial, undefined);
  assert.ok(resultsLayout(Q, data({ held: { every: ["MUTATION"], some: [] } })).left.includes("Structural Variants (no structural-variant data)"));
  assert.equal(resultsLayout(Q, data({ held: { every: ["MUTATION"], some: [] } })).partial, undefined, "a study without structural variants waits for nothing");
  assert.ok(resultsLayout(Q, data({ svs: null })).left.some((l) => /could not check/.test(l)));
  // some: right after Mutations, the queried patients, the first gene, chips over every gene
  const l = resultsLayout(Q, data({ svs: true }));
  assert.equal(titles(l)[titles(l).indexOf("Mutations") + 1], "Structural Variants");
  const tab = l.tabs.find((t) => t.title === "Structural Variants")!;
  const sv = l.doc.views![tab.views![0]] as any;
  assert.deepEqual([sv.kind, sv.genes, sv.cohorts], ["sv", ["ALK"], ["Queried"]]);
  assert.deepEqual(tab.chooser!.options, ["ALK", "ROS1"]);
  assert.equal(tab.chooser!.value([sv]), "ALK");
  const next = tab.chooser!.apply([{ ...sv, sort: { column: "gene2" }, search: "EML4" }], "ROS1")[0] as any;
  assert.deepEqual([next.genes, next.sort, next.search], [["ROS1"], undefined, undefined], "a new gene starts the table's query over");
  assert.equal(tab.chooser!.value([{ ...sv, genes: undefined }]), "ALK");
});

test("the Structural Variants check: the queried patients, with Explore's filters, with a call in any queried gene", () => {
  const F = { kind: "clinical", attribute: "SEX", values: ["Female"] };
  assert.deepEqual(svCheckCohort(q(["a"], ["ALK", "RET: MUT"], [F])), { study: "a", all: [F, { kind: "oql", q: "ALK: FUSION; RET: FUSION" }] });
  assert.deepEqual((svCheckCohort(q(["a", "b"], ["ALK"])) as any).studies, ["a", "b"]);
});
