// The Results page's groups and tabs (app/portal/results-layout.ts): Unaltered is the samples the
// query does not match that are profiled for some queried gene in some selected profile; the
// expression tabs follow cBioPortal's cross-study rule.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { entriesHaveOql, resultsGroups, resultsLayout, linkMutations, samplesLine, svCheckCohort } from "../app/portal/results-layout.ts";
import { arrange } from "../app/portal/page-doc.ts";
import type { View, Clause } from "../lib/types.ts";
import type { SelectedProfile } from "../lib/query-options.ts";

const ALL3 = { every: ["MUTATION", "CNA", "SV"] as const, some: [] as never[] };
const q = (studies: string[], entries: string[], filters: any[] = []) => ({ studies, filters, entries, genes: [...new Set(entries.map((e) => e.split(":")[0].trim()))] });
const qs = (selected: SelectedProfile[], studies: string[], entries: string[], filters: any[] = []) => ({ ...q(studies, entries, filters), selected });
// Unaltered's profiling requirement: its last clause, one `profiled` leaf or an `any` of them
const profiledLeaves = (def: any): any[] => { const last = def.all[def.all.length - 1]; return last.any ? last.any : last.kind === "profiled" ? [last] : []; };
const profiledOf = (def: any) => profiledLeaves(def).map((c: any) => (c.type ?? c.profile) + " " + c.genes.join(","));
const leaf = (type: string, genes: string[]) => ({ kind: "profiled", type, genes, anyGene: true });
const pleaf = (profile: string, genes: string[], ifHeld?: boolean) => ({ kind: "profiled", profile, ...(ifHeld ? { ifHeld } : {}), genes, anyGene: true });
const all3 = () => ({ every: [...ALL3.every], some: [] as never[] });

describe("Unaltered: not the query, and not wholly unprofiled (filteredUnalteredAndProfiledSamples, totallyUnprofiledSamples)", () => {
  test("no options: profiled for a queried gene in mutation, copy number or structural variants — one `any` of three leaves (row 1)", () => {
    const F = { kind: "clinical", attribute: "SEX", values: ["Female"] };
    const { cohorts } = resultsGroups(q(["s"], ["KRAS"], [F]), all3());
    assert.deepEqual(cohorts.Unaltered.all, [
      F,
      { not: { kind: "oql", q: "KRAS" } },
      { any: [leaf("MUTATION", ["KRAS"]), leaf("CNA", ["KRAS"]), leaf("SV", ["KRAS"])] }
    ]);
  });

  test("every leaf names every queried gene, whatever a line's own alteration type: any gene, any kind", () => {
    const { cohorts } = resultsGroups(q(["s"], ["KRAS", "TP53: MUT", "ERBB2: AMP"]), all3());
    assert.deepEqual(profiledLeaves(cohorts.Unaltered), ["MUTATION", "CNA", "SV"].map((t) => leaf(t, ["KRAS", "TP53", "ERBB2"])));
    assert.deepEqual(cohorts.Unaltered.all![0], { not: { kind: "oql", q: "KRAS; TP53: MUT; ERBB2: AMP" } });
    assert.equal(cohorts.Unaltered.all!.length, 2, "not the query, then the profiled requirement");
  });

  test("no options: a kind only some studies hold still counts; a kind no study holds is left out (row 2)", () => {
    const some = resultsGroups(q(["a", "b"], ["KRAS"]), { every: ["MUTATION", "CNA"], some: ["SV"] }).cohorts;
    assert.deepEqual(profiledOf(some.Unaltered), ["MUTATION KRAS", "CNA KRAS", "SV KRAS"]);
    const two = resultsGroups(q(["brca_tcga"], ["KRAS"]), { every: ["MUTATION", "CNA"], some: [] }).cohorts;
    assert.deepEqual(profiledOf(two.Unaltered), ["MUTATION KRAS", "CNA KRAS"]);
    const l = resultsLayout(q(["a", "b"], ["KRAS", "TP53"]), data({ held: { every: ["MUTATION", "CNA"], some: ["SV"] } }));
    assert.deepEqual(profiledOf(l.doc.cohorts!.Unaltered), ["MUTATION KRAS,TP53", "CNA KRAS,TP53", "SV KRAS,TP53"]);
    assert.ok(!l.left.some((x) => /only some of the selected studies hold/.test(x)), l.left.join(" | "));
  });

  test("one selected profile is one leaf naming it, no `any` group (row 3)", () => {
    const { cohorts } = resultsGroups(qs([{ profile: "mutations" }], ["s"], ["KRAS", "TP53"]), all3());
    assert.deepEqual(cohorts.Unaltered.all, [{ not: { kind: "oql", q: "KRAS; TP53" } }, pleaf("mutations", ["KRAS", "TP53"])]);
  });

  test("mutations and mRNA selected: two leaves in an `any`, the mRNA one counting a sample with RNA but no sequencing (row 4)", () => {
    const { cohorts } = resultsGroups(qs([{ profile: "mutations" }, { profile: "rna_seq_v2_mrna" }], ["coadread_tcga"], ["KRAS"]), all3());
    assert.deepEqual(cohorts.Unaltered.all![1], { any: [pleaf("mutations", ["KRAS"]), pleaf("rna_seq_v2_mrna", ["KRAS"])] });
  });

  test("mRNA-only options: one mRNA leaf, never a missing profiling clause (row 5)", () => {
    const { cohorts } = resultsGroups(qs([{ profile: "rna_seq_v2_mrna" }], ["s"], ["KRAS: EXP>=2"]), all3());
    assert.deepEqual(cohorts.Unaltered.all, [{ not: { kind: "oql", q: "KRAS: EXP>=2" } }, pleaf("rna_seq_v2_mrna", ["KRAS"])]);
  });

  test("selected profiles naming none Unaltered can check: the held kinds' type leaves, and the page says so (row 6)", () => {
    const { cohorts } = resultsGroups(qs([], ["a", "b"], ["KRAS"]), { every: ["MUTATION", "CNA"], some: [] });
    assert.deepEqual(profiledLeaves(cohorts.Unaltered), [leaf("MUTATION", ["KRAS"]), leaf("CNA", ["KRAS"])]);
    const l = resultsLayout(qs([], ["a", "b"], ["KRAS"]), data());
    assert.deepEqual(profiledOf(l.doc.cohorts!.Unaltered), ["MUTATION KRAS", "CNA KRAS", "SV KRAS"]);
    assert.ok(l.left.some((x) => /The selected profiles name none Unaltered can check, so it checks the .* data instead/.test(x)), l.left.join(" | "));
    assert.ok(!resultsLayout(q(["a"], ["KRAS"]), data()).left.some((x) => /name none Unaltered can check/.test(x)), "no options: no note");
  });

  test("nothing selectable and no kind held: one MUTATION type leaf (Unaltered matches nobody), not no clause (row 7)", () => {
    const none = { every: [] as never[], some: [] as never[] };
    for (const Q of [qs([], ["s"], ["KRAS"]), q(["s"], ["KRAS"])]) {
      const { cohorts } = resultsGroups(Q, none);
      assert.deepEqual(cohorts.Unaltered.all, [{ not: { kind: "oql", q: "KRAS" } }, leaf("MUTATION", ["KRAS"])], JSON.stringify((Q as { selected?: unknown }).selected));
    }
  });

  test("several studies, mRNA chosen: its leaf is read in each study holding it (row 8)", () => {
    const { cohorts } = resultsGroups(qs([{ type: "MUTATION" }, { profile: "rna_seq_v2_mrna_median_all_sample_Zscores", ifHeld: true }], ["a", "b"], ["KRAS"]), all3());
    assert.deepEqual(cohorts.Unaltered.all![1], { any: [leaf("MUTATION", ["KRAS"]), pleaf("rna_seq_v2_mrna_median_all_sample_Zscores", ["KRAS"], true)] });
  });

  test("one leaf per selected profile with every queried gene, however many genes: no chunking", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => "G" + i);
    const sel: SelectedProfile[] = [{ profile: "mutations" }, { profile: "gistic" }, { profile: "rna_seq_v2_mrna" }, { profile: "rppa_Zscores" }];
    const leaves = profiledLeaves(resultsGroups(qs(sel, ["s"], twelve), all3()).cohorts.Unaltered);
    assert.deepEqual(leaves, sel.map((p) => pleaf((p as { profile: string }).profile, twelve)));
    const forty = Array.from({ length: 40 }, (_, i) => "G" + i);
    const { cohorts } = resultsGroups(q(["s"], forty), all3());
    assert.deepEqual(profiledLeaves(cohorts.Unaltered), ["MUTATION", "CNA", "SV"].map((t) => leaf(t, forty)));
    assert.doesNotThrow(() => resultsGroups(q(["s"], Array.from({ length: 100 }, (_, i) => "G" + i)), all3()));
  });

  test("an EXP line reading a selected profile needs no note (row 9)", () => {
    const Q = { ...qs([{ profile: "mutations" }, { profile: "rna_seq_v2_mrna_median_Zscores" }], ["a"], ["KRAS", "EGFR: EXP>=2"]), exp: "rna_seq_v2_mrna_median_Zscores" };
    assert.ok(!resultsLayout(Q, data()).left.some((x) => /EGFR: EXP/.test(x)), resultsLayout(Q, data()).left.join(" | "));
    assert.ok(!resultsLayout(q(["a"], ["KRAS", "TP53"]), data()).left.some((x) => /Unaltered checks profiling/.test(x)), "no EXP/PROT line, no note");
  });

  test("an EXP line whose profile is not selected is named, with the selection in words (row 9)", () => {
    const Q = { ...qs([{ profile: "mutations" }], ["a"], ["KRAS", "EGFR: EXP>=2"]), exp: "rna_seq_v2_mrna_median_Zscores" };
    const l = resultsLayout(Q, data());
    assert.ok(l.left.some((x) => /Unaltered checks profiling in the selected profiles \(mutations\), not for EGFR: EXP/.test(x)), l.left.join(" | "));
    // the defaults the studies hold, in words
    const d = resultsLayout(q(["a"], ["KRAS", "EGFR: EXP>=2"]), data({ held: { every: ["MUTATION", "CNA"], some: ["SV"] } }));
    const note = d.left.find((x) => /Unaltered checks profiling in the selected profiles/.test(x));
    assert.ok(note, d.left.join(" | "));
    assert.match(note!, /selected profiles \([^)]*\bmutation\b[^)]*\bcopy number\b[^)]*\bstructural variants\b[^)]*\), not for EGFR: EXP/);
    assert.deepEqual(profiledOf(d.doc.cohorts!.Unaltered), ["MUTATION KRAS,EGFR", "CNA KRAS,EGFR", "SV KRAS,EGFR"]);
  });

  test("Altered is the query as one OQL clause and Queried the selection, with no profiling requirement (row 10)", () => {
    const F = { kind: "clinical", attribute: "SEX", values: ["Female"] };
    for (const Q of [q(["s"], ["KRAS", "TP53: MUT", "ERBB2: AMP"], [F]), qs([{ profile: "mutations" }], ["s"], ["KRAS", "TP53: MUT", "ERBB2: AMP"], [F])]) {
      const { cohorts } = resultsGroups(Q, all3());
      assert.deepEqual(cohorts.Altered.all, [F, { kind: "oql", q: "KRAS; TP53: MUT; ERBB2: AMP" }], "the query is one OQL clause, its lines joined by ';'");
      assert.deepEqual(cohorts.Queried.all, [F]);
      assert.equal(cohorts.Unaltered.all![0], F);
    }
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

const svLayout = () => resultsLayout(q(["a"], ["ALK", "ROS1: FUSION"]), data({ svs: true }));

test("SV-1 the Structural Variants tab is titled \"Structural Variants\" with a \"Beta!\" badge, and no other tab has a badge", () => {
  const l = svLayout();
  const tab = l.tabs.find((t) => t.title === "Structural Variants")!;
  assert.equal(tab.title, "Structural Variants");
  assert.equal((tab as { badge?: string }).badge, "Beta!");
  for (const t of l.tabs.filter((x) => x !== tab)) assert.equal((t as { badge?: string }).badge, undefined, `${t.title} has no badge`);
});

test("SV-5 the Structural Variants tab shows the experimental-feature alert above the table", () => {
  const l = svLayout();
  const tab = l.tabs.find((t) => t.title === "Structural Variants")!;
  const views = tab.views!.map((i) => l.doc.views![i]);
  const expected = "This is an experimental feature. The structural variant gene and event info annotations might not always be correct. If you are interested in improving SV annotation and visualization together, please reach out on cbioportal@googlegroups.com";
  assert.equal(tab.banner!.text([]), expected);
  assert.equal(tab.banner!.text(views), expected);
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

test("SV-1 the page keeps a tab's badge beside its name (arrange carries it through)", () => {
  const layout = arrange({ study: "s" } as never, [{ title: "Structural Variants", views: [], badge: "Beta!" }, { title: "Download", views: [] }], []);
  assert.equal(layout.tabs[0].badge, "Beta!");
  assert.equal(layout.tabs[0].title, "Structural Variants");
  assert.equal(layout.tabs[1].badge, undefined);
});

test("Comparison/Survival › Genomic Alterations is one table over every alteration type, Altered against Unaltered (CMM-AT-2, CMM-RV)", () => {
  const l = resultsLayout(q(["a"], ["KRAS"]), data());
  const ga = l.tabs.find((t) => t.title === "Comparison/Survival")!.sub!.find((s) => s.title === "Genomic Alterations")!;
  assert.equal(ga.views?.length, 1, "one table, not one per alteration type");
  const view = l.doc.views![ga.views![0]] as any;
  assert.equal(view.kind, "enrichment");
  assert.equal(view.alteration, "any");
  assert.deepEqual(view.cohorts, ["Altered", "Unaltered"]);
  assert.equal(view.minAltered, 1, "every gene tested is listed");
});

describe("Oncoprint: Show OQL filters starts as the typed query says (ResultsViewOncoprint 528, ONC-VI-6)", () => {
  const oncoprint = (l: ReturnType<typeof resultsLayout>) => l.doc.views!.find((v) => v.kind === "oncoprint") as unknown as { genes: string[]; display?: { showOql?: boolean } };
  test("bare genes written out by the profiles: rows carry the line, the toggle starts off", () => {
    const o = oncoprint(resultsLayout({ ...q(["s"], ["KRAS: MUT", "TP53: MUT"]), typedOql: false }, data()));
    assert.deepEqual(o.genes, ["KRAS: MUT", "TP53: MUT"]);
    assert.deepEqual(o.display, { showOql: false });
  });
  test("a typed OQL line: the toggle starts on", () => {
    assert.deepEqual(oncoprint(resultsLayout({ ...q(["s"], ["KRAS: MUT", "TP53"]), typedOql: true }, data())).display, { showOql: true });
  });
  test("not said: the engine's default (on only when a row has OQL)", () => {
    assert.equal(oncoprint(resultsLayout(q(["s"], ["KRAS", "TP53"]), data())).display, undefined);
  });
  test("entriesHaveOql reads OQL, not a bare gene or a merged row", () => {
    assert.equal(entriesHaveOql(["KRAS", "TP53"]), false);
    assert.equal(entriesHaveOql(["[KRAS NRAS]"]), false);
    assert.equal(entriesHaveOql(["KRAS", "TP53: MUT"]), true);
  });
});
