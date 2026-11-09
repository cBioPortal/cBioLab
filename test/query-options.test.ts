// The query page's profile and case-set controls (lib/query-options.ts): each rule ported from
// cbioportal-frontend's QueryStore / CaseSetSelectorUtils / buildDefaultOQLProfile, checked against
// what that code does, and the Results link's round trip.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  selectableProfiles, defaultProfiles, defaultOptions, defaultOql, effectiveKinds, kindsInQuery, readThreshold, resolveQuery,
  heldKinds, defaultCaseSet, caseSetOptions, multiCaseSetCount, studiesWithoutCaseSet, caseSetClause, caseSetProblem, profilesProblem,
  parseCaseIds, optionsProblem, writeOptions, readOptions, completeOptions, chosenQuery, legacyQueryParams, EVERY_STUDY, CUSTOM_CASE_SET, type CaseSetInfo, type QueryOptions,
} from "../lib/query-options.ts";
import type { ProfileInfo } from "../lib/profile-catalog.ts";

const prof = (profile: string, type: string, extra: Partial<ProfileInfo> = {}): ProfileInfo =>
  ({ profile, type, datatype: "Z-SCORE", name: profile, order: 0, study: "brca_tcga", ...extra });
// brca_tcga as the warehouse describes it (show_profile_in_analysis_tab as cbioportal.org's API reports it)
const BRCA: ProfileInfo[] = [
  prof("rppa", "PROTEIN_LEVEL", { analysis: false }), prof("rppa_Zscores", "PROTEIN_LEVEL"),
  prof("protein_quantification_zscores", "PROTEIN_LEVEL"),
  prof("gistic", "COPY_NUMBER_ALTERATION", { datatype: "DISCRETE" }), prof("linear_CNA", "COPY_NUMBER_ALTERATION", { analysis: false }),
  prof("mutations", "MUTATION_EXTENDED", { datatype: "MAF" }),
  prof("methylation_hm450", "METHYLATION", { analysis: false }),
  prof("rna_seq_v2_mrna_median_Zscores", "MRNA_EXPRESSION"), prof("mrna_median_Zscores", "MRNA_EXPRESSION"),
  prof("phosphoprotein_quantification", "GENERIC_ASSAY"),
];
const list = (id: string, category: string, samples: number, study = "brca_tcga", name = id): CaseSetInfo => ({ id, study, name, description: name + " (" + samples + ")", category, samples });
const BRCA_LISTS = [
  list("brca_tcga_all", "all_cases_in_study", 1108, "brca_tcga", "All samples"),
  list("brca_tcga_cnaseq", "all_cases_with_mutation_and_cna_data", 963, "brca_tcga", "Samples with mutation and CNA data"),
  list("brca_tcga_sequenced", "all_cases_with_mutation_data", 982, "brca_tcga", "Samples with mutation data"),
  list("brca_tcga_cna", "all_cases_with_cna_data", 1080, "brca_tcga", "Samples with CNA data"),
  list("brca_tcga_rna_seq_v2_mrna", "all_cases_with_mrna_rnaseq_data", 1100, "brca_tcga", "Samples with mRNA data (RNA Seq V2)"),
  list("brca_tcga_3way_complete", "all_cases_with_mutation_and_cna_and_mrna_data", 960, "brca_tcga", "Complete samples"),
  list("brca_tcga_rppa", "all_cases_with_rppa_data", 892, "brca_tcga", "Samples with protein data (RPPA)"),
];
const opts = (profiles: QueryOptions["profiles"], extra: Partial<QueryOptions> = {}): QueryOptions => ({ profiles, z: "2.0", rppaZ: "2.0", caseSet: "brca_tcga_all", ...extra });
const held = heldKinds(BRCA);

describe("the profile selector", () => {
  test("offers the profiles shown in the analysis tab, by kind in the portal's order, each kind by id", () => {
    const g = selectableProfiles(BRCA);
    assert.deepEqual(g.map((x) => x.kind.key), ["mut", "cna", "mrna", "prot"]);
    assert.deepEqual(g.find((x) => x.kind.key === "mrna")!.profiles.map((p) => p.profile), ["mrna_median_Zscores", "rna_seq_v2_mrna_median_Zscores"]);
    assert.deepEqual(g.find((x) => x.kind.key === "prot")!.profiles.map((p) => p.profile), ["protein_quantification_zscores", "rppa_Zscores"]);
    // methylation is not shown in this study's analysis tab, and generic assays are never offered
    assert.ok(!g.some((x) => x.kind.key === "meth"));
  });
  test("one profile per id across several studies", () => {
    const two = [...BRCA, prof("mutations", "MUTATION_EXTENDED", { study: "luad_tcga" })];
    assert.equal(selectableProfiles(two).find((x) => x.kind.key === "mut")!.profiles.length, 1);
  });
  test("starts from mutations, structural variants and copy number; a study with none of them from its first profile", () => {
    assert.deepEqual(defaultProfiles(BRCA, 1), { mut: "mutations", cna: "gistic" });
    assert.deepEqual(defaultProfiles(BRCA, 3), { mut: EVERY_STUDY, cna: EVERY_STUDY });
    assert.deepEqual(defaultProfiles([prof("rna_seq_mrna_median_Zscores", "MRNA_EXPRESSION")], 1), { mrna: "rna_seq_mrna_median_Zscores" });
    assert.deepEqual(defaultOptions(BRCA, 1, "x"), { profiles: { mut: "mutations", cna: "gistic" }, z: "2.0", rppaZ: "2.0", caseSet: "x" });
  });
  test("an empty choice is the portal's submit error", () => {
    assert.equal(profilesProblem(opts({})), "Please select one or more molecular profiles.");
    assert.equal(profilesProblem(opts({ cna: "gistic" })), null);
  });
});

describe("the default alterations of a bare gene", () => {
  test("buildDefaultOQLProfile's tokens, in its order", () => {
    assert.equal(defaultOql(new Set(["mut", "sv", "cna"]), 2, 2), "MUT FUSION AMP HOMDEL");
    assert.equal(defaultOql(new Set(["mrna", "prot"]), 1.5, 2), "EXP>=1.5 EXP<=-1.5 PROT>=2 PROT<=-2");
    assert.equal(defaultOql(new Set(["meth"]), 2, 2), "");
  });
  test("the query's own kinds and structural variants join a one-study choice, as the portal's link and Results page add them", () => {
    const sv = new Set([...held, "sv" as const]);
    assert.deepEqual([...kindsInQuery(["TP53", "KRAS: AMP", "EGFR: EXP>2"])].sort(), ["cna", "mrna"]);
    assert.deepEqual([...effectiveKinds(opts({ mut: "mutations" }), ["TP53", "KRAS: AMP"], 1, sv)].sort(), ["cna", "mut", "sv"]);
    // several studies: the choice alone
    assert.deepEqual([...effectiveKinds(opts({ mut: "*" }), ["TP53", "KRAS: AMP"], 2, sv)].sort(), ["mut"]);
  });
  test("thresholds are read as numbers of 0 or more", () => {
    assert.equal(readThreshold("2.0"), 2);
    assert.equal(readThreshold(" 1.5 "), 1.5);
    assert.equal(readThreshold(".5"), 0.5);
    for (const bad of ["", "-1", "abc", "2e3", "1.2.3"]) assert.equal(readThreshold(bad), null, bad);
  });
});

describe("the query the options ask for", () => {
  test("no options, or the default choice, leave the entries as typed (any alteration)", () => {
    assert.deepEqual(resolveQuery(null, ["TP53"], 1, held), { entries: ["TP53"] });
    assert.deepEqual(resolveQuery(opts({ mut: "mutations", cna: "gistic" }), ["TP53", "KRAS: G12D"], 1, held), { entries: ["TP53", "KRAS: G12D"] });
    assert.deepEqual(resolveQuery(opts({}), ["TP53"], 1, held), { entries: ["TP53"] });
  });
  test("mutations alone write a bare gene out as MUT; an explicit entry is kept", () => {
    // KRAS: AMP brings copy number in (the portal adds its profile), which with mutations is every kind brca_tcga holds: any alteration
    assert.deepEqual(resolveQuery(opts({ mut: "mutations" }), ["TP53", "KRAS: AMP"], 1, held).entries, ["TP53", "KRAS: AMP"]);
    const sv = new Set([...held, "sv" as const, "mrna" as const]);
    assert.deepEqual(resolveQuery(opts({ mut: "mutations" }), ["TP53", "KRAS: EXP>2"], 1, sv).entries, ["TP53: MUT FUSION EXP>=2 EXP<=-2", "KRAS: EXP>2"]);
    assert.deepEqual(resolveQuery(opts({ mut: "mutations" }), ["TP53", "PTEN"], 1, held).entries, ["TP53: MUT", "PTEN: MUT"]);
  });
  test("mRNA and protein add their thresholds and pin their profiles", () => {
    const r = resolveQuery(opts({ mut: "mutations", cna: "gistic", mrna: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores" }, { z: "1.5" }), ["TP53"], 1, held);
    assert.deepEqual(r, { entries: ["TP53: MUT AMP HOMDEL EXP>=1.5 EXP<=-1.5 PROT>=2 PROT<=-2"], exp: "rna_seq_v2_mrna_median_Zscores", prot: "rppa_Zscores" });
  });
  test("refuses what cannot be honoured, loudly", () => {
    assert.match(resolveQuery(opts({ mrna: "mrna_median_Zscores" }, { z: "high" }), ["TP53"], 1, held).error!, /mRNA z-score threshold must be a number/);
    assert.match(resolveQuery(opts({ meth: "methylation_hm450" }), ["TP53"], 1, held).error!, /give TP53 no alterations/);
    assert.match(resolveQuery(opts({ mut: "*" }), ["TP53"], 1, held).error!, /for several studies/);
    assert.match(resolveQuery(opts({ mut: "mutations" }), ["TP53"], 2, held).error!, /chooses data types/);
    assert.match(resolveQuery(opts({ mrna: "*" }), ["TP53"], 2, held).error!, /does not filter by mRNA expression/);
    // methylation alone with an explicit entry is fine: nothing bare needs a default
    assert.equal(resolveQuery(opts({ meth: "methylation_hm450" }), ["TP53: MUT"], 1, held).error, undefined);
  });
});

describe("case sets", () => {
  test("the default follows the profiles, as defaultSelectedSampleListId", () => {
    const d = (p: QueryOptions["profiles"]) => defaultCaseSet("brca_tcga", p, BRCA_LISTS);
    assert.equal(d({ mut: "mutations", cna: "gistic" }), "brca_tcga_cnaseq");
    assert.equal(d({ mut: "mutations" }), "brca_tcga_sequenced");
    assert.equal(d({ cna: "gistic" }), "brca_tcga_cna");
    assert.equal(d({ mrna: "rna_seq_v2_mrna_median_Zscores" }), "brca_tcga_rna_seq_v2_mrna");
    assert.equal(d({ mrna: "mrna_median_Zscores" }), "brca_tcga_all"); // brca has no _mrna list in this fixture
    assert.equal(d({ mut: "mutations", mrna: "mrna_median_Zscores" }), "brca_tcga_3way_complete");
    assert.equal(d({ prot: "rppa_Zscores" }), "brca_tcga_rppa");
    assert.equal(d({ mut: "mutations", prot: "rppa_Zscores" }), "brca_tcga_all");
    // the _cna_seq / _complete spellings some studies use
    const alt = [list("x_all", "all_cases_in_study", 5, "x"), list("x_cna_seq", "all_cases_with_mutation_and_cna_data", 3, "x"), list("x_complete", "", 2, "x")];
    assert.equal(defaultCaseSet("x", { mut: "m", cna: "c" }, alt), "x_cna_seq");
    assert.equal(defaultCaseSet("x", { cna: "c", mrna: "z" }, alt), "x_complete");
  });
  test("one study's lists by name with their sizes, then the user-defined list", () => {
    const o = caseSetOptions(["brca_tcga"], BRCA_LISTS);
    assert.equal(o[0].label, "All samples (1108)");
    assert.equal(o.at(-1)!.id, CUSTOM_CASE_SET);
    assert.equal(o.at(-1)!.label, "User-defined Case List");
    assert.deepEqual(o.map((x) => x.name).slice(0, -1), [...o.map((x) => x.name).slice(0, -1)].sort());
  });
  test("several studies: the categories that hold samples, each summed across the studies", () => {
    const lists = [...BRCA_LISTS, list("gbm_all", "all_cases_in_study", 10, "gbm", "All"), list("gbm_seq", "all_cases_with_mutation_data", 4, "gbm")];
    const o = caseSetOptions(["brca_tcga", "gbm"], lists);
    assert.deepEqual(o.map((x) => x.label), ["All (1118)", "Cases with mutations data (986)", "Cases with copy number alterations data (1080)",
      "Cases with both mutations and copy number alterations data (963)", "User-defined Case List"]);
    assert.equal(multiCaseSetCount("w_cna", ["gbm"], lists), 0);
    assert.deepEqual(studiesWithoutCaseSet("w_cna", ["brca_tcga", "gbm"], lists), ["gbm"]);
    assert.deepEqual(studiesWithoutCaseSet("all", ["brca_tcga", "gbm"], lists), []);
  });
  test("each case set as the clause every cohort keeps", () => {
    assert.equal(caseSetClause(null, ["brca_tcga"]), null);
    assert.equal(caseSetClause(opts({}, { caseSet: "brca_tcga_all" }), ["brca_tcga"]), null);
    assert.deepEqual(caseSetClause(opts({}, { caseSet: "brca_tcga_sequenced" }), ["brca_tcga"]), { kind: "caseList", id: "brca_tcga_sequenced" });
    assert.deepEqual(caseSetClause(opts({}, { caseSet: "w_mut" }), ["a", "b"]), { kind: "caseList", category: "all_cases_with_mutation_data" });
    assert.equal(caseSetClause(opts({}, { caseSet: "all" }), ["a", "b"]), null);
    const set = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
    assert.deepEqual(caseSetClause(opts({}, { caseSet: CUSTOM_CASE_SET, cases: { set, level: "patient", n: 3 } }), ["a"]),
      { kind: "patientList", set, label: "User-defined Case List", n: 3 });
    assert.equal(caseSetClause(opts({}, { caseSet: CUSTOM_CASE_SET }), ["a"]), null);
  });
  test("problems with a case set", () => {
    assert.equal(caseSetProblem(opts({}, { caseSet: CUSTOM_CASE_SET }), ["a"]), "Please enter at least one ID in your custom case set.");
    assert.match(caseSetProblem(opts({}, { caseSet: "brca_tcga_all" }), ["a", "b"])!, /several studies takes one of/);
    assert.match(caseSetProblem(opts({}, { caseSet: "gbm_all" }), ["brca_tcga"])!, /not one of brca_tcga's/);
    assert.equal(caseSetProblem(opts({}, { caseSet: "w_mut" }), ["a", "b"]), null);
  });
  test("typed ids are read as the portal reads them, with its errors", () => {
    assert.deepEqual(parseCaseIds(" TCGA-A1 \n brca_tcga:TCGA-A2  TCGA-A1", ["brca_tcga"], "sample"), { ids: ["brca_tcga:TCGA-A1", "brca_tcga:TCGA-A2"] });
    assert.deepEqual(parseCaseIds("TCGA-A1", ["a", "b"], "patient"), { error: "No study specified for patient id: TCGA-A1, and more than one study selected for query." });
    assert.deepEqual(parseCaseIds("gbm:X", ["brca_tcga"], "sample"), { error: "Study gbm is not selected." });
    assert.deepEqual(parseCaseIds("a:b:c", ["a"], "sample"), { error: "Input error for entity: a:b:c." });
    assert.deepEqual(parseCaseIds("   ", ["a"], "sample"), { ids: [] });
  });
});

describe("what cBioLab cannot honour yet", () => {
  test("a bad threshold, and one of several copy-number profiles of a study, are refused by name", () => {
    const gbm = [prof("mutations", "MUTATION_EXTENDED"), prof("cna_rae", "COPY_NUMBER_ALTERATION", { name: "RAE" }), prof("cna_consensus", "COPY_NUMBER_ALTERATION", { name: "Consensus" })];
    assert.match(optionsProblem(opts({ cna: "cna_rae" }), gbm, 1)!, /2 copy number profiles \(Consensus; RAE\)[\s\S]*cannot query one alone yet/);
    assert.equal(optionsProblem(opts({ mut: "mutations" }), gbm, 1), null);
    assert.equal(optionsProblem(opts({ mut: "mutations", cna: "gistic" }), BRCA, 1), null);
    assert.equal(optionsProblem(opts({ cna: "*" }), gbm, 2), null);
    assert.match(optionsProblem(opts({ prot: "rppa_Zscores" }, { rppaZ: "x" }), BRCA, 1)!, /protein z-score threshold/);
    assert.match(chosenQuery(opts({ cna: "cna_rae" }, { caseSet: "gbm_all" }), { profiles: gbm.map((p) => ({ ...p, study: "gbm" })), caseSets: [] }, ["gbm"], ["TP53"]).error!, /cannot query one alone/);
  });
});

describe("the Results link", () => {
  test("round-trips every option", () => {
    const set = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
    for (const o of [
      opts({ mut: "mutations", cna: "gistic", mrna: "rna_seq_v2_mrna_median_Zscores" }, { z: "1.5", caseSet: "brca_tcga_sequenced" }),
      opts({ prot: "rppa_Zscores" }, { rppaZ: "3", caseSet: "brca_tcga_rppa" }),
      opts({ mut: "*", sv: "*" }, { caseSet: "w_mut" }),
      opts({ mut: "mutations" }, { caseSet: CUSTOM_CASE_SET, cases: { set, level: "patient", n: 12 } }),
    ]) {
      const p = new URLSearchParams();
      writeOptions(p, o);
      const back = readOptions(new URLSearchParams(p.toString()));
      assert.equal(back.error, undefined);
      // a threshold is written only for the kind it belongs to
      assert.deepEqual(back.options, { ...o, z: o.profiles.mrna ? o.z : "2.0", rppaZ: o.profiles.prot ? o.rppaZ : "2.0" });
    }
  });
  test("a link without options has none; bad values are refused", () => {
    assert.deepEqual(readOptions(new URLSearchParams("study=a&genes=TP53")), { options: null });
    assert.match(readOptions(new URLSearchParams("mut=a b")).error!, /not a profile id/);
    assert.match(readOptions(new URLSearchParams("case_set=a;b")).error!, /not a case set id/);
    assert.match(readOptions(new URLSearchParams("case_set=-1&cases=nope")).error!, /stored id set/);
  });
  test("a link naming only a case set gets the default profiles; one naming only profiles gets all cases", () => {
    const a = readOptions(new URLSearchParams("case_set=brca_tcga_sequenced")).options!;
    assert.deepEqual(completeOptions(a, BRCA, ["brca_tcga"]).profiles, { mut: "mutations", cna: "gistic" });
    const b = readOptions(new URLSearchParams("mut=mutations")).options!;
    assert.equal(completeOptions(b, BRCA, ["brca_tcga"]).caseSet, "brca_tcga_all");
    assert.equal(completeOptions(b, BRCA, ["a", "b"]).caseSet, "all");
  });
});

describe("the Results page's reading of its options", () => {
  const data = { profiles: BRCA, caseSets: BRCA_LISTS, unavailable: [] };
  test("no options: the query as typed, every case", () => {
    assert.deepEqual(chosenQuery(null, data, ["brca_tcga"], ["TP53"]), { waiting: false, entries: ["TP53"], clause: null, summary: null, notes: [] });
    assert.equal(chosenQuery(opts({ mut: "mutations" }), null, ["brca_tcga"], ["TP53"]).waiting, true);
  });
  test("profiles, case set and the header's words", () => {
    const c = chosenQuery(opts({ mut: "mutations", mrna: "rna_seq_v2_mrna_median_Zscores" }, { z: "1.5", caseSet: "brca_tcga_sequenced" }), data, ["brca_tcga"], ["TP53", "KRAS: G12D"]);
    assert.deepEqual(c.entries, ["TP53: MUT EXP>=1.5 EXP<=-1.5", "KRAS: G12D"]);
    assert.equal(c.exp, "rna_seq_v2_mrna_median_Zscores");
    assert.deepEqual(c.clause, { kind: "caseList", id: "brca_tcga_sequenced" });
    assert.deepEqual(c.summary, { caseSet: "Samples with mutation data (982)", profiles: "mutations, rna_seq_v2_mrna_median_Zscores (z-score threshold ±1.5)" });
    assert.match(c.notes.join(" "), /stands for MUT EXP>=1\.5 EXP<=-1\.5/);
  });
  test("a user-defined list and several studies' case sets in words; what cannot be used is an error", () => {
    const set = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
    assert.equal(chosenQuery(opts({ mut: "mutations" }, { caseSet: CUSTOM_CASE_SET, cases: { set, level: "patient", n: 1 } }), data, ["brca_tcga"], ["TP53"]).summary!.caseSet,
      "User-defined Case List (1 patient)");
    const lists = [...BRCA_LISTS, list("gbm_all", "all_cases_in_study", 10, "gbm")];
    const m = chosenQuery(opts({ mut: "*", cna: "*" }, { caseSet: "w_cna" }), { ...data, caseSets: lists, unavailable: [{ study: "p", why: "p is a peer's" }] }, ["brca_tcga", "gbm"], ["TP53"]);
    assert.equal(m.summary!.profiles, "Mutation, Copy Number");
    assert.deepEqual(m.clause, { kind: "caseList", category: "all_cases_with_cna_data" });
    assert.match(m.notes.join(" "), /leaves out gbm[\s\S]*p is a peer's/);
    assert.match(chosenQuery(opts({ mut: "mutations" }, { caseSet: "gbm_all" }), data, ["brca_tcga"], ["TP53"]).error!, /not one of brca_tcga's/);
    assert.match(chosenQuery(opts({ meth: "x" }), data, ["brca_tcga"], ["TP53"]).error!, /no alterations/);
  });
  test("the portal's own parameters for the link", () => {
    assert.equal(legacyQueryParams(null, data, ["brca_tcga"], ["TP53"]), null);
    assert.match((legacyQueryParams(opts({}), null, ["brca_tcga"], ["TP53"]) as { why: string }).why, /waiting/);
    const p = legacyQueryParams(opts({ mut: "mutations", mrna: "mrna_median_Zscores" }, { caseSet: "brca_tcga_sequenced" }), data, ["brca_tcga"], ["TP53", "KRAS: AMP"]) as { params: [string, string][] };
    assert.deepEqual(p.params, [["profileFilter", "mutations,gistic,mrna_median_Zscores"], ["case_set_id", "brca_tcga_sequenced"], ["Z_SCORE_THRESHOLD", "2.0"]]);
    const m = legacyQueryParams(opts({ prot: "*" }, { caseSet: "w_mut", rppaZ: "3" }), data, ["a", "b"], ["TP53"]) as { params: [string, string][] };
    assert.deepEqual(m.params, [["profileFilter", "protein_quantification_zscores,rppa_Zscores"], ["case_set_id", "w_mut"], ["RPPA_SCORE_THRESHOLD", "3"]]);
    assert.match((legacyQueryParams(opts({}, { caseSet: CUSTOM_CASE_SET }), data, ["a"], ["TP53"]) as { why: string }).why, /user-defined case list/);
  });
});

describe("the query options server's SQL", () => {
  test("every list of the studies, counted, never listed", async () => {
    const { caseSetsSql } = await import("../lib/query-options-server.ts");
    const sql = caseSetsSql("cbio", ["brca_tcga", "gbm_tcga"]);
    assert.match(sql, /uniqExact\(sll\.sample_id\) AS samples/);
    assert.match(sql, /cs\.cancer_study_identifier IN \('brca_tcga', 'gbm_tcga'\)/);
    assert.match(sql, /GROUP BY study, id/);
    const { profileNotesSql } = await import("../lib/query-options-server.ts");
    assert.match(profileNotesSql("cbio", ["brca_tcga"]), /show_profile_in_analysis_tab[\s\S]*IN \('brca_tcga'\)/);
  });
});
