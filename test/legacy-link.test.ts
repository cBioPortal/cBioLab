// "Open in cBioPortal" (lib/legacy-link.ts): a portal page's state as the legacy frontend's URL, every
// tab title mapped, and the cases with no honest link refused with the reason.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { legacyLink, portalHold, PATIENT_TABS, RESULTS_TABS, COMPARISON_SUBTABS, LEGACY_URL_MAX, type PortalHold } from "../lib/legacy-link.ts";
import { assayTypeOfGroup } from "../lib/profile-catalog.ts";
import { restrictedByName } from "../lib/federation.ts";
import type { Clause } from "../lib/types.ts";

const P = "https://www.cbioportal.org";
const on: PortalHold = { portal: P };
const held = (...ids: string[]) => Object.fromEntries(ids.map((i) => [i, on]));
const results = (studies: string[], entries: string[], filters: Clause[] = []) => ({ page: "results" as const, studies, entries, filters });
const href = (l: ReturnType<typeof legacyLink>) => { assert.ok(l.href, l.tip); return new URL(l.href); };

describe("the Results page on cBioPortal", () => {
  test("one study: its _all case list, the genes one OQL line each, the tab in the path", () => {
    const u = href(legacyLink(results(["brca_tcga"], ["KRAS", "TP53: MUT"]), { tab: "Mutations" }, held("brca_tcga")));
    assert.equal(u.origin + u.pathname, P + "/results/mutations");
    assert.equal(u.searchParams.get("cancer_study_list"), "brca_tcga");
    assert.equal(u.searchParams.get("case_set_id"), "brca_tcga_all");
    assert.equal(u.searchParams.get("gene_list"), "KRAS\nTP53: MUT");
    assert.equal(u.searchParams.get("case_ids"), null);
    // spaces as %20, never "+", which the portal's case_ids reads as a separator
    assert.ok(!/\+/.test(u.search) && /TP53%3A%20MUT/.test(u.search));
  });
  test("several studies: cancer_study_list a,b and case_set_id=all, which the portal reads as each study's _all", () => {
    const u = href(legacyLink(results(["a", "b"], ["TP53"]), { tab: "Oncoprint" }, held("a", "b")));
    assert.equal(u.pathname, "/results/oncoprint");
    assert.equal(u.searchParams.get("cancer_study_list"), "a,b");
    assert.equal(u.searchParams.get("case_set_id"), "all");
  });
  test("every Results tab title maps to the portal's tab id", () => {
    const want: Record<string, string> = { "Oncoprint": "oncoprint", "Cancer Types Summary": "cancerTypesSummary", "Mutual Exclusivity": "mutualExclusivity",
      "Plots": "plots", "Mutations": "mutations", "Structural Variants": "structuralVariants", "Co-expression": "coexpression",
      "Comparison/Survival": "comparison/overlap", "CN Segments": "cnSegments", "Download": "download" };
    assert.deepEqual(Object.keys(RESULTS_TABS).sort(), Object.keys(want).sort());
    for (const [title, id] of Object.entries(want)) {
      const l = legacyLink(results(["s"], ["TP53"]), { tab: title }, held("s"));
      assert.equal(href(l).pathname, "/results/" + id, title);
      assert.ok(!/no tab like/.test(l.tip), title);
    }
  });
  test("Comparison/Survival's sub-tabs, a generic-assay one by its type", () => {
    const sub = (s: string | undefined) => href(legacyLink(results(["s"], ["TP53"]), { tab: "Comparison/Survival", sub: s }, held("s"))).pathname;
    assert.equal(sub(undefined), "/results/comparison/overlap");
    for (const [title, t] of Object.entries(COMPARISON_SUBTABS)) assert.equal(sub(title), "/results/comparison/" + t.id);
    assert.equal(sub("Survival"), "/results/comparison/survival");
    assert.equal(sub("Genomic Alterations"), "/results/comparison/alterations");
    assert.equal(sub("Mutational signature"), "/results/comparison/generic_assay_mutational_signature");
    assert.equal(sub("Arm-level copy number"), "/results/comparison/generic_assay_armlevel_cna");
    assert.equal(sub("Some new assay"), "/results/comparison/generic_assay_some_new_assay");
    assert.match(legacyLink(results(["s"], ["TP53"]), { tab: "Comparison/Survival", sub: "Clinical" }, held("s")).tip, /Comparison\/Survival › Clinical tab/);
  });
  test("the Mutations and Structural Variants tabs carry the chosen gene; other tabs do not", () => {
    const g = (tab: string) => href(legacyLink(results(["s"], ["TP53", "KRAS"]), { tab, gene: "KRAS" }, held("s"))).searchParams.get("mutations_gene");
    assert.equal(g("Mutations"), "KRAS");
    assert.equal(g("Structural Variants"), "KRAS");
    assert.equal(g("Plots"), null);
  });
  test("no tab, or a tab the portal lacks, opens OncoPrint and the tip says so", () => {
    assert.equal(href(legacyLink(results(["s"], ["TP53"]), {}, held("s"))).pathname, "/results/oncoprint");
    const l = legacyLink(results(["s"], ["TP53"]), { tab: "Something New" }, held("s"));
    assert.equal(href(l).pathname, "/results/oncoprint");
    assert.match(l.tip, /OncoPrint tab — cBioPortal has no tab like “Something New”/);
  });
  test("filters: a case list maps to case_set_id (shorthand prefixed), explicit samples to case_ids", () => {
    const one = (f: Clause, studies = ["brca_tcga"]) => legacyLink(results(studies, ["TP53"], [f]), {}, held(...studies));
    assert.equal(href(one({ kind: "caseList", id: "sequenced" } as Clause)).searchParams.get("case_set_id"), "brca_tcga_sequenced");
    assert.equal(href(one({ kind: "caseList", id: "brca_tcga_cnaseq" } as Clause)).searchParams.get("case_set_id"), "brca_tcga_cnaseq");
    const u = href(one({ kind: "sampleList", ids: ["a:S1", "b:S2"] } as Clause, ["a", "b"]));
    assert.equal(u.searchParams.get("case_ids"), "a:S1+b:S2");
    assert.equal(u.searchParams.get("case_set_id"), null);
    assert.match(u.search, /case_ids=a%3AS1%2Bb%3AS2/);
  });
  test("filters the portal's link cannot say are refused, never dropped", () => {
    const refused = (fs: Clause[], studies = ["s"]) => {
      const l = legacyLink(results(studies, ["TP53"], fs), {}, held(...studies));
      assert.equal(l.href, null);
      return l.tip;
    };
    assert.match(refused([{ kind: "clinical", attribute: "SEX", values: ["Female"] } as Clause]), /clinical filter.*different set of samples/);
    assert.match(refused([{ kind: "caseList", id: "x" } as Clause, { kind: "caseList", id: "y" } as Clause]), /2 filters/);
    assert.match(refused([{ kind: "caseList", id: "sequenced" } as Clause], ["a", "b"]), /case list across several studies/);
    assert.match(refused([{ kind: "sampleList", set: "uuid" } as Clause]), /stored or cross-study sample list/);
    assert.match(refused([{ kind: "sampleList", ids: ["other:S1"] } as Clause]), /sample list/);
    assert.match(refused([{ kind: "patientList", ids: ["s:P1"] } as Clause]), /patientList filter/);
  });
  test("a sample list past the link's length is refused with the limit named", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => "s:SAMPLE-" + i);
    const l = legacyLink(results(["s"], ["TP53"], [{ kind: "sampleList", ids } as Clause]), {}, held("s"));
    assert.equal(l.href, null);
    assert.match(l.tip, new RegExp(LEGACY_URL_MAX.toLocaleString("en-US")));
  });
});

describe("the Patient page on cBioPortal", () => {
  test("a patient: /patient/<tab>?studyId=&caseId=", () => {
    const u = href(legacyLink({ page: "patient", study: "msk_chord_2024", patient: "P-0000012" }, { tab: "Clinical Data" }, held("msk_chord_2024")));
    assert.equal(u.origin + u.pathname, P + "/patient/clinicalData");
    assert.equal(u.searchParams.get("studyId"), "msk_chord_2024");
    assert.equal(u.searchParams.get("caseId"), "P-0000012");
    assert.equal(u.searchParams.get("sampleId"), null);
  });
  test("a sample: sampleId, not caseId", () => {
    const l = legacyLink({ page: "patient", study: "s", sample: "S-1" }, { tab: "Summary" }, held("s"));
    const u = href(l);
    assert.equal(u.pathname, "/patient/summary");
    assert.equal(u.searchParams.get("sampleId"), "S-1");
    assert.equal(u.searchParams.get("caseId"), null);
    assert.match(l.tip, /this sample on cBioPortal \(www\.cbioportal\.org\), on its Summary tab$/);
  });
  test("every Patient tab title maps; Clinical Trials has no portal tab and opens Summary, saying so", () => {
    const want: Record<string, string> = { "Summary": "summary", "Pathways": "pathways", "Clinical Data": "clinicalData", "Genomic Evolution": "genomicEvolution",
      "Mutational Signatures": "mutationalSignatures", "Files & Links": "filesAndLinks" };
    assert.deepEqual(Object.keys(PATIENT_TABS).sort(), Object.keys(want).sort());
    for (const [title, id] of Object.entries(want))
      assert.equal(href(legacyLink({ page: "patient", study: "s", patient: "p" }, { tab: title }, held("s"))).pathname, "/patient/" + id, title);
    const l = legacyLink({ page: "patient", study: "s", patient: "p" }, { tab: "Clinical Trials" }, held("s"));
    assert.equal(href(l).pathname, "/patient/summary");
    assert.match(l.tip, /no tab like “Clinical Trials”/);
  });
});

describe("when there is no link", () => {
  test("the Comparison page needs a portal session, so it is disabled with that reason", () => {
    const l = legacyLink({ page: "comparison", study: "s" }, { tab: "Overlap" }, held("s"));
    assert.equal(l.href, null);
    assert.match(l.tip, /session service/);
  });
  test("a study the portal does not hold, or one not known yet, gives the reason", () => {
    const why = { why: "x is held by GENIE, a federation peer, not by www.cbioportal.org" };
    assert.deepEqual(legacyLink(results(["s", "x"], ["TP53"]), {}, { s: on, x: why }), { href: null, tip: why.why });
    assert.match(legacyLink({ page: "patient", study: "s", patient: "p" }, {}, {}).tip, /waiting for the study list/);
  });
  test("a portal address with a trailing slash is used without it", () => {
    assert.ok(legacyLink({ page: "patient", study: "s", patient: "p" }, {}, { s: { portal: "https://p.example/" } }).href!.startsWith("https://p.example/patient/summary?"));
  });
});

describe("which studies the portal holds", () => {
  const ctx = { portal: P + "/", primary: "a", local: false, restricted: false };
  const row = (instance: string, instanceLabel = "x") => ({ id: "brca_tcga", instance, instanceLabel });
  test("the primary connection's study, at the portal's address", () => {
    assert.deepEqual(portalHold(row("a"), ctx), { portal: P });
  });
  test("a peer's, a second connection's, a local import's, a consortium study's: not, and why", () => {
    assert.match((portalHold(row("peer", "GENIE (simulated peer)"), ctx) as { why: string }).why, /held by GENIE \(simulated peer\), a federation peer, not by www\.cbioportal\.org$/);
    assert.match((portalHold(row("b", "GENIE"), ctx) as { why: string }).why, /is in GENIE, not in the database www\.cbioportal\.org serves/);
    assert.match((portalHold(row("a"), { ...ctx, local: true }) as { why: string }).why, /imported into this local cBioLab/);
    assert.match((portalHold(row("a"), { ...ctx, restricted: true }) as { why: string }).why, /consortium or private/);
  });
  test("the consortium/private rule by name, whatever this deployment is entitled to", () => {
    assert.ok(restrictedByName("genie_x", "GENIE Cohort v17.0-consortium"));
    assert.ok(restrictedByName("x_private", ""));
    assert.ok(!restrictedByName("glass_2019", "Glioma Longitudinal Analysis Consortium"));
  });
  test("a generic-assay group label read back as its type", () => {
    assert.equal(assayTypeOfGroup("Mutational signature"), "MUTATIONAL_SIGNATURE");
    assert.equal(assayTypeOfGroup("Genetic ancestry"), "GENETIC_ANCESTRY");
    assert.equal(assayTypeOfGroup("Microbiome signature"), "MICROBIOME_SIGNATURE");
  });
});
