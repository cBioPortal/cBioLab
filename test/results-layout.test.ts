// The Results page's groups and tabs (app/portal/results-layout.ts): Unaltered is the samples the
// query does not match that are profiled for some queried gene in some selected profile; the
// expression tabs follow cBioPortal's cross-study rule.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resultsGroups, resultsLayout, linkMutations, samplesLine, svCheckCohort } from "../app/portal/results-layout.ts";
import { PROFILED_MAX_GENES, type View, type Clause } from "../lib/types.ts";

const ALL3 = { every: ["MUTATION", "CNA", "SV"] as const, some: [] as never[] };
const q = (studies: string[], entries: string[], filters: any[] = []) => ({ studies, filters, entries, genes: [...new Set(entries.map((e) => e.split(":")[0].trim()))] });
const qk = (kinds: ("MUTATION" | "CNA" | "SV")[], studies: string[], entries: string[], filters: any[] = []) => ({ ...q(studies, entries, filters), kinds });
// Unaltered's profiling requirement: its last clause, one `profiled` leaf or an `any` of them
const profiledLeaves = (def: any): any[] => { const last = def.all[def.all.length - 1]; return last.any ? last.any : last.kind === "profiled" ? [last] : []; };
const profiledOf = (def: any) => profiledLeaves(def).map((c: any) => c.type + " " + c.genes.join(","));
const leaf = (type: string, genes: string[]) => ({ kind: "profiled", type, genes, anyGene: true });

describe("Unaltered: not the query, and not wholly unprofiled (filteredUnalteredAndProfiledSamples, totallyUnprofiledSamples)", () => {
  test("a bare gene, no options: profiled for it in mutation, copy number or structural variants — one `any` of three leaves", () => {
    const { cohorts } = resultsGroups(q(["s"], ["KRAS"]), { every: [...ALL3.every], some: [] });
    assert.deepEqual(cohorts.Unaltered.all, [
      { not: { kind: "oql", q: "KRAS" } },
      { any: [leaf("MUTATION", ["KRAS"]), leaf("CNA", ["KRAS"]), leaf("SV", ["KRAS"])] }
    ]);
  });

  test("every leaf names every queried gene, whatever a line's own alteration type: any gene, any kind", () => {
    const { cohorts } = resultsGroups(q(["s"], ["KRAS", "TP53: MUT", "ERBB2: AMP"]), { every: [...ALL3.every], some: [] });
    assert.deepEqual(profiledLeaves(cohorts.Unaltered), ["MUTATION", "CNA", "SV"].map((t) => leaf(t, ["KRAS", "TP53", "ERBB2"])));
    assert.deepEqual(cohorts.Unaltered.all![0], { not: { kind: "oql", q: "KRAS; TP53: MUT; ERBB2: AMP" } });
    assert.equal(cohorts.Unaltered.all!.length, 2, "not the query, then the profiled requirement");
  });

  test("the query page's selected profiles decide the kinds: mutations only is one leaf, no `any` group", () => {
    const { cohorts } = resultsGroups(qk(["MUTATION"], ["s"], ["KRAS", "TP53"]), { every: [...ALL3.every], some: [] });
    assert.deepEqual(cohorts.Unaltered.all, [{ not: { kind: "oql", q: "KRAS; TP53" } }, leaf("MUTATION", ["KRAS", "TP53"])]);
    const two = resultsGroups(qk(["MUTATION", "CNA"], ["s"], ["KRAS"]), { every: [...ALL3.every], some: [] }).cohorts;
    assert.deepEqual(profiledOf(two.Unaltered), ["MUTATION KRAS", "CNA KRAS"]);
  });

  test("a kind no queried study holds is left out (brca_tcga has no structural variants)", () => {
    const { cohorts } = resultsGroups(q(["brca_tcga"], ["KRAS"]), { every: ["MUTATION", "CNA"], some: [] });
    assert.deepEqual(profiledOf(cohorts.Unaltered), ["MUTATION KRAS", "CNA KRAS"]);
  });

  test("a kind only some studies hold is still checked, and named in no note", () => {
    const { cohorts } = resultsGroups(q(["a", "b"], ["KRAS"]), { every: ["MUTATION"], some: ["CNA"] });
    assert.deepEqual(profiledOf(cohorts.Unaltered), ["MUTATION KRAS", "CNA KRAS"]);
    const l = resultsLayout(q(["a", "b"], ["KRAS", "TP53"]), data({ held: { every: ["MUTATION", "CNA"], some: ["SV"] } }));
    assert.deepEqual(profiledOf(l.doc.cohorts!.Unaltered), ["MUTATION KRAS,TP53", "CNA KRAS,TP53", "SV KRAS,TP53"]);
    assert.ok(!l.left.some((x) => /only some of the selected studies hold/.test(x)), l.left.join(" | "));
  });

  test("forty genes over three kinds: at most " + PROFILED_MAX_GENES + " genes a leaf, two leaves a kind, six in the `any`", () => {
    const forty = Array.from({ length: 40 }, (_, i) => "G" + i);
    const { cohorts } = resultsGroups(q(["s"], forty), { every: [...ALL3.every], some: [] });
    const leaves = profiledLeaves(cohorts.Unaltered);
    assert.equal(leaves.length, 6);
    for (const t of ["MUTATION", "CNA", "SV"]) {
      const ofKind = leaves.filter((c) => c.type === t);
      assert.equal(ofKind.length, 2, t);
      assert.ok(ofKind.every((c) => c.genes.length <= PROFILED_MAX_GENES && c.anyGene === true), t);
      assert.deepEqual(ofKind.flatMap((c) => c.genes), forty, t + ": every gene once, in order");
    }
    for (const def of Object.values(cohorts)) assert.ok(def.all!.length <= 8, String(def.all!.length));
  });

  test("a query needing more than 8 profiled leaves is refused, naming the limit", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => "G" + i);
    assert.throws(() => resultsGroups(q(["s"], hundred), { every: [...ALL3.every], some: [] }), /8 clauses[\s\S]*100 genes over 3 data types/);
    // two kinds of the same genes fit: 4 + 4
    assert.equal(profiledLeaves(resultsGroups(qk(["MUTATION", "CNA"], ["s"], hundred), { every: [...ALL3.every], some: [] }).cohorts.Unaltered).length, 8);
  });

  test("an expression or protein line is not checked for profiling, and the page says so", () => {
    const l = resultsLayout(q(["a"], ["KRAS", "EGFR: EXP>=2"]), data());
    const note = l.left.find((x) => /EGFR: EXP/.test(x));
    assert.ok(note, l.left.join(" | "));
    assert.match(note!, /mutation, copy-number and (SV|structural-variant) profiles only/);
    assert.match(note!, /in neither group/);
    assert.deepEqual(profiledOf(l.doc.cohorts!.Unaltered), ["MUTATION KRAS,EGFR", "CNA KRAS,EGFR", "SV KRAS,EGFR"]);
    assert.ok(!resultsLayout(q(["a"], ["KRAS", "TP53"]), data()).left.some((x) => /profiles only/.test(x)), "no EXP/PROT line, no note");
  });

  test("Altered is the query as one OQL clause and Queried the selection, with no profiling requirement", () => {
    const F = { kind: "clinical", attribute: "SEX", values: ["Female"] };
    const { cohorts } = resultsGroups(q(["s"], ["KRAS", "TP53: MUT", "ERBB2: AMP"], [F]), { every: [...ALL3.every], some: [] });
    assert.deepEqual(cohorts.Altered.all, [F, { kind: "oql", q: "KRAS; TP53: MUT; ERBB2: AMP" }], "the query is one OQL clause, its lines joined by ';'");
    assert.deepEqual(cohorts.Queried.all, [F]);
    assert.equal(cohorts.Unaltered.all![0], F);
  });
});

test("every group keeps the selection: its studies and Explore's filters", () => {
  const F = { kind: "clinical", attribute: "SEX", values: ["Female"] };
  const { cohorts } = resultsGroups(q(["a", "b"], ["KRAS"], [F]), { every: ["MUTATION"], some: ["CNA"] });
  for (const def of Object.values(cohorts)) { assert.deepEqual((def as any).studies, ["a", "b"]); assert.deepEqual(def.all![0], F); }
  assert.equal((resultsGroups(q(["a"], ["KRAS"]), { every: ["MUTATION"], some: [] }).cohorts.Altered as any).study, "a");
});

const data = (over: Partial<Parameters<typeof resultsLayout>[1]> = {}) =>
  ({ expr: "rna_seq_v2_mrna", cna: "gistic", clinical: ["AGE", "OS_MONTHS", "OS_STATUS"], numeric: ["MUTATION_COUNT"], expressionAcross: true, held: { every: ["MUTATION", "CNA"], some: ["SV"] }, ...over } as Parameters<typeof resultsLayout>[1]);
const titles = (l: ReturnType<typeof resultsLayout>) => l.tabs.map((t) => t.title);
const plotY = (l: ReturnType<typeof resultsLayout>) => (l.doc.views!.find((v: any) => v.kind === "plot") as any)?.y;

test("a twelve-gene query fits a cohort's limits: 8 clauses, and no group past 8 lines", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => "G" + i);
  const { cohorts } = resultsGroups(q(["s"], twelve), { every: ["MUTATION", "CNA", "SV"], some: [] });
  for (const def of Object.values(cohorts)) assert.ok(def.all!.length <= 8, String(def.all!.length));
  assert.deepEqual(profiledOf(cohorts.Unaltered), ["MUTATION", "CNA", "SV"].map((t) => t + " " + twelve.join(",")), "one leaf a kind, every gene in it");
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
  assert.ok(!two.left.some((l) => /only some of the selected studies hold/.test(l)), "a type only some studies hold is checked, not named");
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

test("CN Segments: every queried sample's segments zoomed to the first gene, a chip per gene and Whole genome; the frequency view beneath", () => {
  const l = resultsLayout(q(["s"], ["ERBB2", "MYC"]), data());
  const tab = l.tabs.find((t) => t.title === "CN Segments")!;
  const vs = tab.views!.map((i) => l.doc.views![i]) as any[];
  assert.deepEqual(vs.map((v) => [v.kind, v.gene, v.cohorts]), [["segments", "ERBB2", ["Queried"]], ["genome", undefined, ["Queried"]]]);
  const ch = tab.chooser!;
  assert.deepEqual(ch.options, ["ERBB2", "MYC", "Whole genome"]);
  assert.deepEqual(ch.locks, ["gene", "region"]);
  assert.equal(ch.value(vs as View[]), "ERBB2");
  const whole = ch.apply(vs as View[], "Whole genome") as any[];
  assert.equal(whole[0].gene, undefined);
  assert.equal(ch.value(whole as View[]), "Whole genome");
  assert.equal((ch.apply(whole as View[], "MYC") as any[])[0].gene, "MYC");
  assert.equal(whole[1], vs[1], "the frequency view is left as it is");
});

describe("the query page's choices in the document", () => {
  test("the mRNA / protein profile reaches the Altered clause and the Download tab; the case set is every group's", () => {
    const layout = resultsLayout;
    const caseSet = { kind: "caseList", id: "s_sequenced" } as Clause;
    const l = layout({ studies: ["s"], filters: [caseSet], entries: ["TP53: MUT EXP>=2 EXP<=-2"], genes: ["TP53"], exp: "rna_seq_v2_mrna_median_Zscores" },
      { expr: null, cna: null, clinical: [], numeric: [], expressionAcross: true, held: { every: ["MUTATION", "CNA"], some: [] }, svs: false });
    const groups = l.doc.cohorts as Record<string, { all: Clause[] }>;
    for (const g of ["Altered", "Unaltered", "Queried"]) assert.deepEqual(groups[g].all[0], caseSet, g);
    assert.deepEqual(groups.Altered.all[1], { kind: "oql", q: "TP53: MUT EXP>=2 EXP<=-2", exp: "rna_seq_v2_mrna_median_Zscores" });
    const dl = (l.doc.views || []).find((v) => (v as { kind: string }).kind === "datafiles") as unknown as { exp?: string; oql: string[] };
    assert.equal(dl.exp, "rna_seq_v2_mrna_median_Zscores");
    assert.deepEqual(dl.oql, ["TP53: MUT EXP>=2 EXP<=-2"]);
    // several studies: the pin applies to each study holding the profile, in the clause and the Download tab alike
    const m = layout({ studies: ["a", "b"], filters: [], entries: ["TP53: MUT EXP>=2 EXP<=-2"], genes: ["TP53"], exp: "rna_seq_v2_mrna_median_all_sample_Zscores", ifHeld: true },
      { expr: null, cna: null, clinical: [], numeric: [], expressionAcross: true, held: { every: ["MUTATION", "CNA"], some: [] }, svs: false });
    assert.deepEqual((m.doc.cohorts as Record<string, { all: Clause[] }>).Altered.all[0], { kind: "oql", q: "TP53: MUT EXP>=2 EXP<=-2", exp: "rna_seq_v2_mrna_median_all_sample_Zscores", ifHeld: true });
    const mdl = (m.doc.views || []).find((v) => (v as { kind: string }).kind === "datafiles") as unknown as { ifHeld?: boolean };
    assert.equal(mdl.ifHeld, true);
  });
});

test("the header's samples line, only when the queried samples outnumber the patients (ONC-RV-1, ONC-STM-2)", () => {
  // msk_impact_2017 TP53 KRAS TERT: the portal's "6494 (59%) of queried samples"
  assert.equal(samplesLine({ queried: 10336, alteredSamples: 6494, queriedSamples: 10945 }), "6,494 (59%) of 10,945 queried samples altered");
  assert.equal(samplesLine({ queried: 594, alteredSamples: 485, queriedSamples: 594 }), null);
  assert.equal(samplesLine({ queried: 594 }), null);
  assert.equal(samplesLine({ queried: 10, alteredSamples: 0, queriedSamples: 12 }), "0 (0%) of 12 queried samples altered");
});

test("Comparison/Survival › Survival: the survival-type table, on the portal's first endpoint, only with survival data (CMP-SV-1, CMP-SV-5)", () => {
  const sub = (l: ReturnType<typeof resultsLayout>) => l.tabs.find((t) => t.title === "Comparison/Survival")!.sub!;
  const survival = (l: ReturnType<typeof resultsLayout>) => { const t = sub(l).find((x) => x.title === "Survival"); return t && l.doc.views![t.views[0]]; };
  assert.deepEqual(survival(resultsLayout(q(["a"], ["KRAS"]), data())), { kind: "survival", types: true, partitions: true, testAnySize: true, cohorts: ["Altered", "Unaltered"] });
  assert.deepEqual(survival(resultsLayout(q(["a"], ["KRAS"]), data({ clinical: ["PFS_MONTHS", "PFS_STATUS"] }))), { kind: "survival", types: true, partitions: true, testAnySize: true, cohorts: ["Altered", "Unaltered"], endpoint: "PFS" });
  assert.equal(survival(resultsLayout(q(["a"], ["KRAS"]), data({ clinical: ["AGE"] }))), undefined);
});
