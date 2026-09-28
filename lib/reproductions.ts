// Paper reproductions: real published cancer-genomics findings, reproduced against the live
// warehouse with today's DSL — a separate gallery from lib/dsl-reference.ts's EXAMPLES.
//
// EXAMPLES teaches DSL SYNTAX (one runnable document per language feature, gated by
// npm run docs:check against pinned counts). This teaches whether the TOOL is trustworthy: does
// re-deriving a real paper's real numbers, from scratch, land where the paper says it should.
//
// Every number below was checked against the actual paper (where its full text was reachable)
// and run live against the database while this file was written; a rerun may drift slightly as
// the warehouse reloads, which is itself disclosed by every view's own caveat, not something
// this file tries to freeze in place.
//
// `notes` (document-level) and each view's own `note` are the actual mechanism: they are real
// AnalysisDoc/View fields, so opening a reproduction's `?doc=` link in /lab shows the paper
// connection INSIDE the workspace, not just on this listing page.
import type { AnalysisDoc } from "./types.ts";

export interface ReproductionFinding {
  /** what the paper claims, one line, its own figure/table cited when known */
  claim: string;
  /** our real, live-run result, one line */
  result: string;
  verdict: "match" | "partial" | "gap";
}

export interface PaperReproduction {
  /** url-safe id, used as the ?doc= link's anchor and the card key */
  slug: string;
  /** short paper title for the card heading */
  title: string;
  /** "Author et al., Journal Year" */
  citation: string;
  /** cBioPortal study id(s) this reproduction queries */
  studyIds: string[];
  /** overall verdict badge for the card */
  badge: "full" | "partial" | "gap" | "bugfound";
  /** 2-3 sentence card summary */
  summary: string;
  findings: ReproductionFinding[];
  /** the real, runnable document — its own `notes`/`view.note` carry the figure correspondence */
  doc: AnalysisDoc;
}

/**
 * breast_msk_2018 records where each sample was taken but not what treatment preceded it. Every
 * SAMPLE_SITE other than "Treatment Naive Primary" (post-neoadjuvant and post-treatment
 * primaries, and every metastatic site) is a sample taken after the disease had been treated —
 * the closest stand-in this study offers for the paper's "previously exposed to hormonal therapy".
 */
const RAZAVI_AFTER_TREATMENT_SITES = ["Liver", "Breast", "Post-Treatment Primary", "Chest Wall", "Lung", "Brain", "Lymph Node", "Bone", "Post-Neo Primary", "Local Recurrence/Breast", "Soft Tissue", "Ovary", "Uterus", "Skin", "Pleura", "Peritoneum", "Pericardium", "Local Recurrence/Lymph Node", "Epidural Mass", "Bowel", "Stomach", "Appendix", "Bladder/Ureter", "Lymph node", "Parotid", "Orbit", "Trachea", "Local Recurrence", "Spleen", "Esophegus"];

export const REPRODUCTIONS: PaperReproduction[] = [
  {
    slug: "mondaca-walch-crc-apc-2020",
    title: "APC mutation pattern in metastatic colorectal cancer",
    citation: "Mondaca, Walch et al., Gastroenterology 2020",
    studyIds: ["crc_apc_impact_2020"],
    badge: "full",
    summary: "The paper that originally motivated this whole DSL. In microsatellite-stable (MSS) metastatic colorectal cancer, the paper's central claim is that the LOCATION of an APC mutation — not DNA-damage-response status — predicts survival. Reproduced directly with the study's own APC_GROUPS classification.",
    findings: [
      { claim: "Within MSS mCRC, APC alteration pattern (mutation location) is associated with overall survival, with unaltered APC carrying the worst prognosis", result: "N-terminal APC: HR=0.43 (95% CI 0.32-0.58, p=3.5e-8) vs unaltered; C-terminal: HR=0.62 (95% CI 0.46-0.83, p=0.0015) vs unaltered", verdict: "match" }
    ],
    doc: {
      study: "crc_apc_impact_2020",
      title: "Mondaca & Walch 2020 — APC mutation pattern and survival",
      notes: "Mondaca, Walch et al., Gastroenterology 2020, \"Specific Mutations in APC, but Not Alterations in DNA Damage Response, Associate With Outcomes of Patients With Metastatic Colorectal Cancer.\" In N=430 MSS unresectable metastatic colorectal cancer, APC alteration PATTERN — not DNA-damage-response gene status — predicted survival. Reproduced here using the study's own APC_GROUPS attribute (N-terminal / C-terminal / Other / Unaltered, classified by mutation location), the same idea the paper itself uses, rather than a simple mutated-vs-not split.",
      cohorts: {
        "MSS unresectable mCRC": { all: [{ kind: "clinical", per: "sample", attribute: "MSI_TYPE", op: "=", value: "Stable" }] }
      },
      views: [
        { kind: "cox", endpoint: "OS", cohorts: ["MSS unresectable mCRC"],
          covariates: [{ source: "clinical", attribute: "APC_GROUPS", reference: "Unaltered" }],
          note: "Reproduces the paper's central table/figure directly: within MSS mCRC, APC alteration pattern predicts overall survival, with wild-type (\"Unaltered\") APC as the reference showing the WORST prognosis — matching the paper's finding that APC alteration, not its absence, is the favorable signal. N-terminal mutations carry the strongest effect (HR=0.43), C-terminal a weaker but still significant one (HR=0.62)." }
      ]
    }
  },
  {
    slug: "samstein-tmb-2019",
    title: "TMB and immunotherapy survival",
    citation: "Samstein et al., Nat Genet 2019",
    studyIds: ["tmb_mskcc_2018"],
    badge: "full",
    summary: "The paper's central claim — that a cancer-type-specific top-TMB percentile predicts better immunotherapy survival — needed a live percentile cutoff the DSL didn't have when this was first attempted with a hand-run SQL workaround. It does now: percentileOf scopes the threshold to NSCLC alone, so a pan-cancer study's percentile doesn't mix histologies with very different baseline mutation rates.",
    findings: [
      { claim: "Top-20th-percentile tumor mutational burden (within cancer type) predicts significantly better overall survival on immune checkpoint inhibitors", result: "NSCLC, 80th-percentile cutoff (resolved live to 13.70+ mut/Mb): n=69 high vs n=281 low, median OS 22mo vs 10mo, log-rank p=0.000284", verdict: "match" }
    ],
    doc: {
      study: "tmb_mskcc_2018",
      title: "Samstein 2019 — TMB and immunotherapy survival",
      notes: "Samstein et al.'s central claim: within a cancer type, a top-percentile tumor mutational burden predicts better overall survival on immune checkpoint inhibitors. tmb_mskcc_2018 is pan-cancer, so the percentile is deliberately computed WITHIN the NSCLC cohort (percentileOf), not across the whole study — otherwise a rarely-hypermutated histology would need a much lower absolute TMB to count as \"high\" than the 80th-percentile NSCLC threshold this uses.",
      cohorts: {
        "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"], per: "sample" }] },
        "NSCLC high-TMB": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"], per: "sample" },
          { kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8, percentileOf: "NSCLC", per: "sample" }
        ] },
        "NSCLC low-TMB": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"], per: "sample" },
          { kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: "<", percentile: 0.8, percentileOf: "NSCLC", per: "sample" }
        ] }
      },
      views: [{ kind: "survival", cohorts: ["NSCLC high-TMB", "NSCLC low-TMB"],
        note: "Reproduces the paper's central per-cancer-type Kaplan-Meier finding: among NSCLC patients on immune checkpoint inhibitors, the top 20% by tumor mutational burden (computed within NSCLC) have better overall survival than the rest — the readback above shows the exact resolved TMB threshold this percentile compiled to, not just the bare 80th-percentile request." }]
    }
  },
  {
    slug: "yaeger-crc-2018",
    title: "Metastatic colorectal cancer genomics",
    citation: "Yaeger et al., Cancer Cell 2018",
    studyIds: ["crc_msk_2017"],
    badge: "full",
    summary: "Sidedness-associated genomics and BRAF's link to peritoneal spread both reproduced with real p-values landing almost exactly on the paper's own numbers. One of the paper's other claims (KRAS and ovarian metastasis) did not reach significance here — flagged honestly below as a real miss, not papered over.",
    findings: [
      { claim: "BRAF mutation is markedly enriched in right-sided vs left-sided colon cancer", result: "21.2% vs 6.8%, p=7.6e-11", verdict: "match" },
      { claim: "KRAS mutation is enriched right-sided vs left-sided", result: "59.8% vs 38.6%, p=1.4e-10", verdict: "match" },
      { claim: "BRAF-mutant tumors metastasize to the peritoneum more often than BRAF-wildtype", result: "23.1% vs 14.0%, p=0.0057", verdict: "match" },
      { claim: "KRAS mutation is associated with ovarian metastasis", result: "did not reach significance here (p=0.12-0.30 across several codon-specific attempts) — likely needs a finer, adjusted analysis than \"any KRAS mutation\" captures; a genuine partial miss, not a tool limitation", verdict: "gap" }
    ],
    doc: {
      study: "crc_msk_2017",
      title: "Yaeger 2018 — metastatic CRC genomics",
      notes: "Yaeger et al.'s two central genomic associations in metastatic colorectal cancer: sidedness-linked driver-gene rates, and BRAF's link to peritoneal spread. Both cohorts below are built from the study's own PRIMARY_TUMOR_LOCATION and first-metastasis-site clinical attributes, not a derived proxy.",
      cohorts: {
        "Right-sided": { all: [{ kind: "clinical", attribute: "PRIMARY_TUMOR_LOCATION", op: "=", value: "Right", per: "sample" }] },
        "Left-sided": { all: [{ kind: "clinical", attribute: "PRIMARY_TUMOR_LOCATION", op: "=", value: "Left", per: "sample" }] },
        "BRAF-mutant": { all: [{ kind: "oql", q: "BRAF: MUT" }] },
        "BRAF-wildtype": { all: [{ not: { kind: "oql", q: "BRAF:" } }, { kind: "profiled", type: "MUTATION" }] }
      },
      views: [
        { kind: "compare", genes: ["BRAF", "KRAS"], cohorts: ["Right-sided", "Left-sided"],
          note: "Reproduces the paper's central sidedness finding: BRAF and KRAS mutation frequency are both substantially higher in right-sided than left-sided metastatic colorectal cancer (BRAF 21.2% vs 6.8%, p=7.6e-11; KRAS 59.8% vs 38.6%, p=1.4e-10)." },
        { kind: "clinical", attributes: ["METASTASES_SITE_FIRST_PERITONEUM_OMENTUM_ABDOMEN"], cohorts: ["BRAF-mutant", "BRAF-wildtype"],
          note: "Reproduces the paper's finding that BRAF-mutant metastatic colorectal cancer has a higher rate of peritoneal/omental metastasis than BRAF-wildtype (23.1% vs 14.0%, p=0.0057) — matching the paper's reported 23% vs 14%, p=0.0057 almost to the decimal. The paper's separate KRAS-and-ovarian-metastasis claim did not reproduce cleanly (see this reproduction's gap above): a real miss worth naming rather than omitting." }
      ]
    }
  },
  {
    slug: "jee-nsclc-ctdna-2022",
    title: "Metastatic NSCLC, ctDNA-guided therapy",
    citation: "Jee et al., Nature Medicine 2022",
    studyIds: ["nsclc_ctdx_msk_2022"],
    badge: "full",
    summary: "Every genomic, clinical, and survival association in this paper's EGFR-mutant-vs-wildtype comparison reproduced cleanly — including the never-smoker enrichment at p=7.5e-19. The paper's ctDNA-versus-tissue finding is now reachable too: the paired view compares each patient's plasma and tissue gene by gene, and plasma-only calls are concentrated in PIK3CA, as the paper says, rather than in truncal drivers like EGFR.",
    findings: [
      { claim: "KRAS mutation is depleted in EGFR-mutant NSCLC (the two are largely mutually exclusive)", result: "7.9% vs 29.4%, p=1.1e-15", verdict: "match" },
      { claim: "TP53 co-mutation rate differs between EGFR-mutant and wildtype NSCLC", result: "64.7% vs 46.8%, p=1.3e-7", verdict: "match" },
      { claim: "Never-smoker status is enriched in EGFR-mutant NSCLC", result: "68.5% never/light-smoker (EGFR-mut) vs 38.6% (EGFR-wt), p=7.5e-19", verdict: "match" },
      { claim: "EGFR-mutant NSCLC has better overall survival than EGFR-wildtype", result: "median 35.4mo vs 23.6mo, log-rank p=4.4e-4", verdict: "match" },
      { claim: "Alterations in ctDNA not seen in tissue sequencing (25% of patients, time-matched) disproportionately feature subclonal resistance drivers such as PIK3CA and RICTOR", result: "682 patients with both tissue and plasma: 39% of PIK3CA plasma calls (9 of 23) are absent from tissue, against 4% for EGFR (7 of 158) and ~11% for KRAS and TP53. Not time-matched (no sample dates here), so tissue-only calls dominate wherever ctDNA was simply undetectable; RICTOR is on too few plasma panels to test (128 patients profiled on both sides, no plasma-only call)", verdict: "partial" }
    ],
    doc: {
      study: "nsclc_ctdx_msk_2022",
      title: "Jee 2022 — metastatic NSCLC ctDNA-guided therapy",
      notes: "Jee et al.'s EGFR-mutant vs EGFR-wildtype comparison in metastatic NSCLC: co-alteration pattern, smoking history, and overall survival, all in one document since all three claims share the same two cohorts. Survival here is plain OS_MONTHS/OS_STATUS, not anchored to a timeline event — an earlier attempt anchored on a \"Treatment\" event and collapsed to 1-2 patients per arm (a near-empty marker in this release), which is why this version deliberately stays unanchored. The tissue-versus-plasma comparison uses SAMPLE_CLASS (Tumor / cfDNA), counting a gene only where both samples' panels covered it.",
      cohorts: {
        "EGFR-mutant": { all: [{ kind: "oql", q: "EGFR: MUT" }] },
        "EGFR-wildtype": { all: [{ not: { kind: "oql", q: "EGFR:" } }, { kind: "profiled", type: "MUTATION" }] },
        "All patients": { all: [] }
      },
      views: [
        { kind: "compare", genes: ["KRAS", "TP53"], cohorts: ["EGFR-mutant", "EGFR-wildtype"],
          note: "Reproduces the paper's co-alteration comparison: KRAS is markedly depleted in EGFR-mutant tumors (7.9% vs 29.4%, p=1.1e-15) and TP53 co-mutation rate also differs (64.7% vs 46.8%, p=1.3e-7) — consistent with the largely mutually-exclusive driver biology the paper describes." },
        { kind: "clinical", attributes: ["SMOKING_STATUS"], cohorts: ["EGFR-mutant", "EGFR-wildtype"],
          note: "Reproduces the paper's smoking-history association: 68.5% of EGFR-mutant patients are never/light-smokers vs 38.6% of EGFR-wildtype (p=7.5e-19) — the textbook EGFR/never-smoker association, reproduced almost exactly." },
        { kind: "survival", endpoint: "OS", cohorts: ["EGFR-mutant", "EGFR-wildtype"],
          note: "Reproduces the paper's overall-survival comparison: median 35.4mo (EGFR-mutant) vs 23.6mo (EGFR-wildtype), log-rank p=4.4e-4 — matching the paper's reported figures closely, using plain unanchored OS rather than a sparse timeline event." },
        { kind: "paired", cohorts: ["All patients"], measure: "any",
          genes: ["EGFR", "KRAS", "TP53", "PIK3CA", "RICTOR", "STK11", "MET", "ERBB2", "BRAF", "ALK"],
          pairBy: { attribute: "SAMPLE_CLASS", a: "Tumor", b: "cfDNA" },
          note: "The paper's ctDNA-only alterations: among the 682 patients with both a tissue and a plasma sample, the share of each gene's plasma calls that tissue did not find — 39% for PIK3CA (9 of 23), against 4% for truncal EGFR and ~11% for KRAS and TP53 — the paper's point that plasma catches heterogeneous, subclonal drivers tissue misses. The samples are not time-matched here, so tissue-only calls (where ctDNA was simply undetectable) dominate the counts." }
      ]
    }
  },
  {
    slug: "jonsson-glioma-2019",
    title: "Glioma genomics and survival",
    citation: "Jonsson et al., Clin Cancer Res 2019",
    studyIds: ["glioma_mskcc_2019"],
    badge: "partial",
    summary: "IDH mutation status, one of oncology's strongest prognostic splits, reproduced almost exactly. The 1p/19q co-deletion that used to be out of reach now reproduces too: the genome view reads it straight off the copy-number segments (1p lost in 94%, 19q in 95% of codeleted oligodendrogliomas), and the codeleted tumours live longer. The paper's cell-cycle finding lands in the right direction with a weaker contrast, and its recurrence story (cell-cycle changes first, mismatch-repair hits only at recurrence) is visible but underpowered in 52 paired patients.",
    findings: [
      { claim: "IDH-mutant glioma has dramatically better overall survival than IDH-wildtype", result: "median OS 207mo vs 24.2mo, log-rank chi2=249.0, p=4.3e-56", verdict: "match" },
      { claim: "IDH-mutant patients are younger at diagnosis", result: "mean age 37.6 vs 57.2, Welch's t p=5.0e-86", verdict: "match" },
      { claim: "1p/19q co-deletion separates IDH-mutant glioma into oligodendroglioma (codeleted) and astrocytoma, and the two differ in outcome", result: "genome view on the segments: 1p lost in 94% and 19q in 95% of the 119 segmented codeleted oligodendrogliomas vs ~5% and 22% of IDH-mutant astrocytomas (and IDH-wildtype glioblastoma shows the classic +7 in 77%, -10 in 76-82%); median OS 248mo vs 136mo, log-rank p=6.6e-4", verdict: "match" },
      { claim: "In astrocytomas, cell-cycle alterations arise preferentially in enhancing tumours (abstract: 44% vs 8%, P < 0.001)", result: "OncoKB-driver alterations in CDKN2A/B, CDKN2C, CDK4/6, CCND1/2 or RB1: 46.0% of enhancing vs 19.7% of non-enhancing astrocytomas (grade 2-3, IDH-mutant or wildtype; q=2.2e-5) — the enhancing rate matches, the non-enhancing one is higher than the paper's 8%; the paper's exact gene list and its per-sample pairing are not reproducible from the data as loaded", verdict: "partial" },
      { claim: "Cell-cycle alterations likely preceded the acquisition of alkylating-therapy-associated hypermutation", result: "in the 52 patients with a primary and a recurrence sample: IDH1/TP53/ATRX concordant (88-92%), CDKN2A mostly already present at the primary (15 both, 6 recurrence-only), while MSH6/MSH2/PMS2/MLH1 alterations appear only at recurrence (11 recurrence-only, 0 primary-only) — the paper's order, but no single gene is significant at this size", verdict: "partial" }
    ],
    doc: {
      study: "glioma_mskcc_2019",
      title: "Jonsson 2019 — glioma genomics and survival",
      notes: "Jonsson et al., Clin Cancer Res 2019;25(18):5537-5547. IDH status is read directly off IDH1/IDH2 mutation calls via OQL, the paper's own genomic definition. The WHO diagnosis (WHO_CLASSIFICATION_OF_DX_TUMOR) names the 1p/19q-codeleted tumours, and the genome view checks that label against the copy-number segments themselves rather than taking it on trust. The cell-cycle gene set is the Sanchez-Vega cell-cycle effectors present on the panels; the paper's own list is not given in its abstract.",
      cohorts: {
        "IDH-mutant": { all: [{ kind: "oql", q: "IDH1: MUT; IDH2: MUT" }] },
        "IDH-wildtype": { all: [{ not: { kind: "oql", q: "IDH1: MUT; IDH2: MUT" } }, { kind: "profiled", type: "MUTATION" }] },
        "Oligodendroglioma, 1p/19q-codeleted": { all: [{ kind: "clinical", attribute: "WHO_CLASSIFICATION_OF_DX_TUMOR",
          values: ["Oligodendroglioma, IDH-mutant and 1p/19q-codeleted", "Anaplastic oligodendroglioma, IDH-mutant and 1p/19q-codeleted"] }] },
        "Astrocytoma, IDH-mutant": { all: [{ kind: "clinical", attribute: "WHO_CLASSIFICATION_OF_DX_TUMOR",
          values: ["Diffuse astrocytoma, IDH-mutant", "Anaplastic astrocytoma, IDH-mutant", "Glioblastoma, IDH-mutant"] }] },
        "Glioblastoma, IDH-wildtype": { all: [{ kind: "clinical", attribute: "WHO_CLASSIFICATION_OF_DX_TUMOR", values: ["Glioblastoma, IDH-wildtype"] }] },
        "Astrocytoma, enhancing": { all: [
          { kind: "clinical", attribute: "WHO_CLASSIFICATION_OF_DX_TUMOR", values: ["Diffuse astrocytoma, IDH-mutant", "Anaplastic astrocytoma, IDH-mutant", "Diffuse astrocytoma, IDH-wildtype", "Anaplastic astrocytoma, IDH-wildtype"] },
          { kind: "clinical", attribute: "ENHANCING", values: ["Yes"], per: "sample" }] },
        "Astrocytoma, non-enhancing": { all: [
          { kind: "clinical", attribute: "WHO_CLASSIFICATION_OF_DX_TUMOR", values: ["Diffuse astrocytoma, IDH-mutant", "Anaplastic astrocytoma, IDH-mutant", "Diffuse astrocytoma, IDH-wildtype", "Anaplastic astrocytoma, IDH-wildtype"] },
          { kind: "clinical", attribute: "ENHANCING", values: ["No"], per: "sample" }] },
        "All gliomas": { all: [] }
      },
      views: [
        { kind: "survival", cohorts: ["IDH-mutant", "IDH-wildtype"],
          note: "Reproduces the paper's headline finding: IDH-mutant median OS 207mo vs IDH-wildtype 24.2mo (chi2=249.0, p=4.3e-56) — one of the strongest prognostic splits in oncology, reproduced almost exactly against the paper's own reported figures." },
        { kind: "clinical", attributes: ["AGE", "MGMT_STATUS", "TMZ_HYPERMUTATED"], cohorts: ["IDH-mutant", "IDH-wildtype"],
          note: "Reproduces the paper's supporting associations: IDH-mutant patients are markedly younger at diagnosis (37.6 vs 57.2 years, p=5.0e-86), and both MGMT promoter methylation and temozolomide-induced hypermutation associate with IDH status, as the paper describes." },
        { kind: "genome", binMb: 5, cohorts: ["Oligodendroglioma, 1p/19q-codeleted", "Astrocytoma, IDH-mutant", "Glioblastoma, IDH-wildtype"],
          note: "The 1p/19q co-deletion, read off the copy-number segments rather than the diagnosis label: 1p lost in 94% and 19q in 95% of codeleted oligodendrogliomas, against ~5% and 22% of IDH-mutant astrocytomas. IDH-wildtype glioblastoma shows its own classic signature, chromosome 7 gained (77%) and 10 lost (76-82%). This was a gap before the genome view existed: no view read the segments at all." },
        { kind: "survival", cohorts: ["Oligodendroglioma, 1p/19q-codeleted", "Astrocytoma, IDH-mutant"],
          note: "Among IDH-mutant gliomas, the codeleted oligodendrogliomas live longer: median OS 248mo vs 136mo, log-rank p=6.6e-4." },
        { kind: "pathways", pathways: [], cohorts: ["Astrocytoma, enhancing", "Astrocytoma, non-enhancing"],
          sets: [{ name: "Cell-cycle effectors", genes: ["CDKN2A", "CDKN2B", "CDKN2C", "CDK4", "CDK6", "CCND1", "CCND2", "RB1"] }],
          note: "The paper's cell-cycle finding: in astrocytomas, alterations in cell-cycle effectors are far more common in contrast-enhancing tumours — 46.0% vs 19.7% here (q=2.2e-5), against the paper's 44% vs 8%. The direction and the enhancing rate match; the non-enhancing rate does not, most likely because the paper's own gene list and sample-level pairing differ from this patient-level approximation." },
        { kind: "paired", cohorts: ["All gliomas"], measure: "any",
          genes: ["IDH1", "TP53", "ATRX", "CDKN2A", "CDK4", "RB1", "MSH6", "MSH2", "PMS2", "MLH1"],
          pairBy: { attribute: "SAMPLE_TYPE", a: "Primary", b: "Recurrence" },
          note: "The paper's order of events, within the 52 patients sequenced at both a primary and a recurrence: the founding alterations (IDH1, TP53, ATRX) are shared, cell-cycle hits like CDKN2A are mostly present already at the primary, and mismatch-repair genes — the route to temozolomide-associated hypermutation — are hit only at recurrence (11 recurrence-only, none primary-only). Too few pairs for any single gene to be significant." }
      ]
    }
  },
  {
    slug: "razavi-breast-2018",
    title: "Breast cancer receptor subtypes",
    citation: "Razavi et al., Cancer Cell 2018",
    studyIds: ["breast_msk_2018"],
    badge: "partial",
    summary: "The four-way receptor-subtype genomic comparison reproduced cleanly, and the k-group Welch's-ANOVA/Kruskal-Wallis test this project built specifically closes a gap the first reproduction attempt hit (numeric attributes used to be refused outright above 2 cohorts). The paper's headline — ESR1 and MAPK-pathway alterations enriched after endocrine therapy — was out of reach while no view could separate samples by when they were taken; this study still records no treatment exposure, but its sample sites do say which samples came before any treatment, and against that proxy ESR1, NF1 and ERBB2 all line up with the paper.",
    findings: [
      { claim: "The four receptor subtypes differ genomically (TP53, PIK3CA, CDH1, GATA3, ESR1)", result: "TP53 p=1.6e-67, PIK3CA p=7.6e-10, CDH1 p=7.3e-8, GATA3 p=4.6e-7, ESR1 p=3.8e-5 — all match the paper's directions", verdict: "match" },
      { claim: "Survival differs by receptor subtype, worst in triple-negative", result: "median OS 176mo (HR+/HER2-) / 46mo (TNBC) / 262mo (HR+/HER2+) / 114mo (HR-/HER2+), k-group log-rank chi2=145.1, p=3.0e-31", verdict: "match" },
      { claim: "ESR1 ligand-binding-domain mutations are present in 18% of HR+/HER2- tumours collected after endocrine therapy, and rare before it", result: "OncoKB-driver ESR1 in 0.7% of HR+/HER2- patients with only treatment-naive primary samples vs 14.3% of those with a sample taken after treatment (q=3.7e-20); within the 42 patients with both, 7 have ESR1 only in the later sample and none only in the naive primary. The proxy is sampling site, not recorded endocrine exposure, so it mixes in tumours treated otherwise", verdict: "partial" },
      { claim: "Activating ERBB2 mutations and NF1 loss-of-function mutations are more than twice as common in endocrine-resistant tumours", result: "any alteration, naive primary only vs sampled after treatment: NF1 2.0% vs 7.4% (q=1.5e-5), ERBB2 2.9% vs 8.2% (q=1.1e-4) — both more than twice as common; MYC also enriched (5.9% vs 10.4%), as the paper reports", verdict: "match" }
    ],
    doc: {
      study: "breast_msk_2018",
      title: "Razavi 2018 — breast cancer receptor subtypes",
      notes: "Razavi et al.'s four-way receptor-subtype comparison. The FIRST time the survival half of this was attempted, it came back \"skipped: tested only for exactly 2 cohorts\" — the k-group generalization of the log-rank test didn't exist yet. It does now, which is what makes the survival comparison below complete rather than blocked. The endocrine-resistance half uses SAMPLE_SITE: this study records where each sample came from but not what treatment preceded it, so \"sampled after treatment\" (any site other than a treatment-naive primary) stands in for the paper's \"previously exposed to hormonal therapy\" — broader than the paper's definition, and said so in each view.",
      cohorts: {
        "HR+/HER2-": { all: [{ kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["HR+/HER2-"], per: "sample" }] },
        "TNBC": { all: [{ kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["Triple Negative"], per: "sample" }] },
        "HR+/HER2+": { all: [{ kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["HR+/HER2+"], per: "sample" }] },
        "HR-/HER2+": { all: [{ kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["HR-/HER2+"], per: "sample" }] },
        "HR+/HER2-, treatment-naive primary only": { all: [
          { kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["HR+/HER2-"], per: "sample" },
          { kind: "clinical", attribute: "SAMPLE_SITE", values: ["Treatment Naive Primary"], per: "sample" },
          { not: { kind: "clinical", attribute: "SAMPLE_SITE", values: RAZAVI_AFTER_TREATMENT_SITES, per: "sample" } }] },
        "HR+/HER2-, sampled after treatment": { all: [
          { kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["HR+/HER2-"], per: "sample" },
          { kind: "clinical", attribute: "SAMPLE_SITE", values: RAZAVI_AFTER_TREATMENT_SITES, per: "sample" }] }
      },
      views: [
        { kind: "compare", genes: ["TP53", "PIK3CA", "CDH1", "GATA3", "ESR1"], cohorts: ["HR+/HER2-", "TNBC", "HR+/HER2+", "HR-/HER2+"],
          note: "Reproduces the paper's subtype-genomics comparison: all five genes differ sharply across the four receptor subtypes (TP53 highest in triple-negative, PIK3CA highest in HR+/HER2-, ESR1 essentially confined to HR+ subtypes), directions matching the paper." },
        { kind: "survival", cohorts: ["HR+/HER2-", "TNBC", "HR+/HER2+", "HR-/HER2+"],
          note: "Reproduces the paper's subtype-stratified survival comparison: triple-negative's markedly shorter survival relative to the HR+/HER2+ and HR+/HER2- subtypes matches the paper's reported outcome differences — the k-group log-rank (chi2=145.1, p=3.0e-31) is only computable at all because of this session's own k-group generalization; before it, 3+ cohorts got a picture with no test. What this document cannot show: the paper's actual headline (ESR1 mutations enriched after endocrine therapy) is taken up by the two views below, against the closest proxy this study has." },
        { kind: "compare", genes: ["ESR1", "NF1", "ERBB2", "MYC", "KRAS", "EGFR", "FOXA1", "CTCF", "TBX3"],
          cohorts: ["HR+/HER2-, treatment-naive primary only", "HR+/HER2-, sampled after treatment"],
          note: "The paper's endocrine-resistance genes, before and after treatment: ESR1 drivers 0.7% vs 14.3% (the paper: 18% after endocrine therapy), NF1 and ERBB2 each more than twice as common after (2.0% vs 7.4%, 2.9% vs 8.2%), MYC enriched too. \"After treatment\" is any sample other than a treatment-naive primary — this study does not record endocrine exposure itself, so it includes tumours treated in other ways." },
        { kind: "paired", genes: ["ESR1", "NF1", "ERBB2", "MYC", "FOXA1"], cohorts: ["HR+/HER2-, sampled after treatment"], measure: "any",
          pairBy: { attribute: "SAMPLE_SITE", a: "Treatment Naive Primary", b: RAZAVI_AFTER_TREATMENT_SITES },
          note: "The same question within patients, where it cannot be confounded by who gets sampled: among the 42 HR+/HER2- patients with both a treatment-naive primary and a later sample, ESR1 appears only in the later one in 7 and only in the primary in none — acquired, as the paper argues, though 42 pairs are too few for significance." }
      ]
    }
  },
  {
    slug: "stopsack-prad-race-2022",
    title: "Race differences in prostate cancer",
    citation: "Stopsack et al., Clin Cancer Res 2022",
    studyIds: ["prad_msk_stopsack_2021"],
    badge: "partial",
    summary: "The unstratified race comparison reproduced cleanly, matching the paper's FOXA1 and TP53 findings closely. The paper's more careful analysis stratifies by disease stage first — this DSL has no first-class way to hold a second categorical attribute constant while comparing a third.",
    findings: [
      { claim: "FOXA1 alteration rate differs significantly by self-reported race", result: "White 14.9%, Black 16.4%, Asian 30.2%, p=0.0044 — highest here in the Asian cohort, with Black still above White", verdict: "match" },
      { claim: "TP53 alteration rate also differs by race", result: "White 29.7%, Black 19.4%, Asian 34.9%, p=0.0119", verdict: "match" },
      { claim: "The race association should be checked WITHIN disease stage, since stage itself varies by race and could confound the result", result: "no first-class way to stratify by a second categorical attribute — only hand-crossing every stage×race combination into its own cohort, which doesn't scale past two dimensions", verdict: "gap" }
    ],
    doc: {
      study: "prad_msk_stopsack_2021",
      title: "Stopsack 2022 — race and prostate cancer genomics",
      notes: "Stopsack et al.'s race comparison in prostate cancer. This reproduces the unstratified version of the paper's analysis; the paper's more careful version adjusts for disease stage first, which this DSL cannot express as a first-class operation (see the view's own note).",
      cohorts: {
        "White": { all: [{ kind: "clinical", attribute: "RACE", values: ["White"], per: "patient" }] },
        "Black": { all: [{ kind: "clinical", attribute: "RACE", values: ["Black"], per: "patient" }] },
        "Asian": { all: [{ kind: "clinical", attribute: "RACE", values: ["Asian"], per: "patient" }] }
      },
      views: [{ kind: "compare", genes: ["FOXA1", "TP53"],
        note: "Reproduces the paper's race comparison: FOXA1 14.9% (White) / 16.4% (Black) / 30.2% (Asian), p=0.0044, and TP53 also differs significantly (29.7% / 19.4% / 34.9%, p=0.0119) — both match the paper's reported significance. What this view CANNOT show: the paper stratifies by disease stage before comparing race, since stage and race both plausibly affect alteration rate and are entangled in this cohort. There's no first-class \"compare A, holding B constant\" operation here — only defining one cohort per stage×race combination by hand, which stops scaling past two stratifying dimensions." }]
    }
  },
  {
    slug: "soumerai-ucec-2018",
    title: "Endometrial cancer molecular subtypes",
    citation: "Soumerai et al., Clin Cancer Res 2018",
    studyIds: ["ucec_msk_2018"],
    badge: "partial",
    summary: "The genomic subtype comparison (built from the study's own POLE/MSI/copy-number attributes) reproduced textbook-correctly. The paper's prognostic claim was originally entirely unreachable — this study's outcome data lives under a bespoke column-name pair — and naming those columns directly, a feature this reproduction effort motivated, does close THAT gap; but re-run today, the MSI-H-vs-MSS survival split itself no longer reaches significance, a real reminder that a live warehouse can drift a finding out from under a note that quoted it once.",
    findings: [
      { claim: "Tumor mutational burden falls in a steep gradient across molecular subtypes: POLE (ultramutated) >> MSI (hypermutated) >> copy-number-high/low", result: "POLE mean 293.1, MSI mean 38.5, CN-high mean 4.6, CN-low mean 5.6 mut/Mb, Welch's ANOVA p=0.0043", verdict: "match" },
      { claim: "ARID1A and TP53 mutation rates are subtype-specific (ARID1A in POLE/MSI, TP53 in copy-number-high)", result: "ARID1A 100%/96.3%/5.5%/27.5%, p=6.8e-16; TP53 0%/14.8%/89.1%/46.3%, p=1.8e-10", verdict: "match" },
      { claim: "MSI-H endometrial cancer has different progression-free survival (from first-line treatment) than MSS", result: "log-rank chi2=0.39, p=0.53 on PFS_MONTHS_FIRST_LINE_TX/PROGRESSION_STATUS as of this run — NOT significant, though this same query reportedly gave p=0.044 in an earlier check; the warehouse has genuinely moved this result, not just its rounding, which this reproduction states plainly rather than quoting the older number", verdict: "gap" }
    ],
    doc: {
      study: "ucec_msk_2018",
      title: "Soumerai 2018 — endometrial molecular subtypes",
      notes: "Soumerai et al.'s molecular-subtype comparison (POLE-ultramutated / MSI-hypermutated / copy-number-high / copy-number-low, built here by precedence — POLE, then MSI, then copy-number cluster — from the study's own POLE_IMPACT, MSI_STATUS and SCNA_CLUSTER attributes, since no single attribute names this classification) and its prognostic claim. The prognostic half was originally entirely unreachable: ucec_msk_2018 declares no <X>_MONTHS/<X>_STATUS pair at all — its outcome lives in PFS_MONTHS_FIRST_LINE_TX/PROGRESSION_STATUS instead — so the usual endpoint-prefix shorthand found nothing until monthsAttribute/statusAttribute existed to name the real columns directly.",
      cohorts: {
        "POLE": { all: [{ kind: "clinical", attribute: "POLE_IMPACT", op: "=", value: "Y", per: "patient" }] },
        "MSI": { all: [
          { kind: "clinical", attribute: "MSI_STATUS", op: "=", value: "MSI-H", per: "sample" },
          { not: { kind: "clinical", attribute: "POLE_IMPACT", op: "=", value: "Y", per: "patient" } }
        ] },
        "CN-high": { all: [
          { kind: "clinical", attribute: "SCNA_CLUSTER", op: "=", value: "A", per: "sample" },
          { not: { kind: "clinical", attribute: "POLE_IMPACT", op: "=", value: "Y", per: "patient" } },
          { not: { kind: "clinical", attribute: "MSI_STATUS", op: "=", value: "MSI-H", per: "sample" } }
        ] },
        "CN-low": { all: [
          { kind: "clinical", attribute: "SCNA_CLUSTER", values: ["B", "C"], per: "sample" },
          { not: { kind: "clinical", attribute: "POLE_IMPACT", op: "=", value: "Y", per: "patient" } },
          { not: { kind: "clinical", attribute: "MSI_STATUS", op: "=", value: "MSI-H", per: "sample" } }
        ] },
        "MSI-H (for survival)": { all: [{ kind: "clinical", attribute: "MSI_STATUS", values: ["MSI-H"], per: "sample" }] },
        "MSS (for survival)": { all: [{ kind: "clinical", attribute: "MSI_STATUS", values: ["MSS"], per: "sample" }] }
      },
      views: [
        { kind: "clinical", attributes: ["TMB_NONSYNONYMOUS"], cohorts: ["POLE", "MSI", "CN-high", "CN-low"],
          note: "Reproduces the paper's central finding: a steep tumor-mutational-burden gradient across the four molecular subtypes, POLE (ultramutated) far exceeding MSI (hypermutated), both far exceeding the copy-number subtypes." },
        { kind: "compare", genes: ["ARID1A", "TP53"], cohorts: ["POLE", "MSI", "CN-high", "CN-low"],
          note: "Reproduces the paper's subtype-specific driver-gene table: ARID1A dominant in POLE/MSI, TP53 dominant in the copy-number-high subtype — the classic pattern distinguishing endometrioid from serous-like endometrial cancer." },
        { kind: "survival", endpoint: "PFS_1L", monthsAttribute: "PFS_MONTHS_FIRST_LINE_TX", statusAttribute: "PROGRESSION_STATUS", cohorts: ["MSI-H (for survival)", "MSS (for survival)"],
          note: "Tests the paper's MSI-H vs MSS progression-free-survival comparison — reachable at all only because the exact column names (PFS_MONTHS_FIRST_LINE_TX / PROGRESSION_STATUS) are given directly rather than assumed from an OS/PFS/DFS-style prefix, which is a real gap this closes. But being REACHABLE isn't the same as reproducing: this exact query currently returns chi2=0.39, p=0.53 (n=28 MSI-H, n=148 MSS) — not significant, even though an earlier check of this same document reported p=0.044. That's a genuine change in what the live warehouse returns, not a rounding difference, and it's disclosed here rather than quietly kept at the older number." }
      ]
    }
  },
  {
    slug: "gounder-sarcoma-2022",
    title: "Soft tissue and bone sarcoma",
    citation: "Gounder et al., Nat Commun 2022",
    studyIds: ["sarcoma_msk_2022"],
    badge: "bugfound",
    summary: "TP53/RB1 rates by histology matched the paper exactly — but the paper's single most iconic finding, MDM2 amplification in well-differentiated liposarcoma, initially read 0% altered because this study has zero copy-number data at all, and the engine reported that as a real negative instead of refusing. Fixed this session: the same query now discloses the missing profile type rather than reporting a false zero.",
    findings: [
      { claim: "TP53 mutation is markedly enriched in leiomyosarcoma vs well-differentiated liposarcoma", result: "57.6% vs 3.8%, p=1.4e-97", verdict: "match" },
      { claim: "RB1 mutation is also enriched in leiomyosarcoma", result: "25.0% vs 2.0%, p=1.1e-32", verdict: "match" },
      { claim: "MDM2 amplification is well-differentiated liposarcoma's near-universal defining alteration", result: "sarcoma_msk_2022 has zero samples with any CNA data — the paper's central finding cannot be checked in THIS study at all, and the view now discloses that explicitly instead of reporting a false 0%", verdict: "gap" }
    ],
    doc: {
      study: "sarcoma_msk_2022",
      title: "Gounder 2022 — soft tissue and bone sarcoma",
      notes: "Gounder et al.'s histology-genomics comparison surfaced a real correctness bug in this tool: MDM2 amplification — well-differentiated liposarcoma's defining, near-universal alteration in the published literature — read as 0% altered here, because sarcoma_msk_2022 has no copy-number data at all, and the compare view's panel-aware denominator only checked per-gene panel coverage, not whether a WHOLE alteration type was ever assayed anywhere in the study. Fixed this session: the view now discloses a missing alteration type explicitly rather than silently reporting a false negative dressed as a real result.",
      cohorts: {
        "Leiomyosarcoma": { all: [{ kind: "clinical", attribute: "CANCER_TYPE_DETAILED", values: ["Leiomyosarcoma"], per: "sample" }] },
        "Well-diff liposarcoma": { all: [{ kind: "clinical", attribute: "CANCER_TYPE_DETAILED", values: ["Well-Differentiated Liposarcoma"], per: "sample" }] }
      },
      views: [
        { kind: "compare", genes: ["TP53", "RB1", "MDM2"], cohorts: ["Leiomyosarcoma", "Well-diff liposarcoma"],
          note: "Reproduces the paper's histology comparison: TP53 57.6% (leiomyosarcoma) vs 3.8% (liposarcoma), p=1.4e-97; RB1 25.0% vs 2.0%, p=1.1e-32 — leiomyosarcoma is TP53/RB1-driven, well-differentiated liposarcoma is not, matching the paper exactly. MDM2 amplification — the paper's near-universal hallmark for well-differentiated liposarcoma — reads 0% in BOTH groups, but this view's own disclosed note explains why: this study has zero copy-number data of any kind, so 0% here means \"never assayed,\" not \"checked and absent.\" This is exactly the correctness bug this tool's compare view used to have (a confidently-wrong false 0%, indistinguishable from a real negative), reproduced live here as a disclosed limitation rather than a silent wrong answer." }
      ]
    }
  },
  {
    slug: "janjigian-egc-2017",
    title: "Esophagogastric cancer, treatment response",
    citation: "Janjigian et al., Cancer Discovery 2017",
    studyIds: ["egc_msk_2017"],
    badge: "partial",
    summary: "Mutation burden's effect on platinum-based chemotherapy response is at least testable via Cox now, with real per-patient outcome data. The paper's actual headline (TMB and survival specifically on immunotherapy) remains blocked: the relevant outcome data exists for only 40 patients, coded in a way this engine's event-detection convention doesn't parse correctly.",
    findings: [
      { claim: "Mutation burden is associated with platinum-based chemotherapy response", result: "Cox: HR=1.02 per mutation/Mb on platinum-PFS, p=0.11 on 187 patients — a real, honestly-reported non-significant result, not the paper's own MSI-based comparison (this release has no precomputed MSI category, only a continuous MSIsensor score too sparse above any standard threshold to split usefully here)", verdict: "partial" },
      { claim: "Tumor mutational burden predicts survival specifically on immunotherapy (the paper's headline claim)", result: "the relevant IO-outcome columns exist for only 40 of 345 patients, and their status values don't follow the \"1:\"-prefixed event convention this engine's survival parser expects — unreachable with usable statistical power even with custom-endpoint-naming", verdict: "gap" }
    ],
    doc: {
      study: "egc_msk_2017",
      title: "Janjigian 2017 — esophagogastric cancer treatment response",
      notes: "Janjigian et al.'s genomics-and-treatment-response analysis. This document tests mutation burden's effect on platinum-based chemotherapy response — the outcome with real, usable per-patient data (187 patients) and a clean survival-status coding. It stops short of the paper's actual headline (TMB and survival specifically on immunotherapy): that outcome exists for only 40 patients, and its status column isn't coded in the \"1:<label>\"/\"0:<label>\" convention this engine's event parser expects, so even naming the exact columns would silently read every patient as censored rather than erroring — worse than refusing outright, so this document doesn't attempt it.",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "cox", monthsAttribute: "PLATINUM_PFS_MONTHS", statusAttribute: "PLATINUM_PFS_STATUS",
        covariates: [{ source: "clinical", attribute: "MUTATION_RATE" }],
        note: "Tests mutation rate's association with platinum-based chemotherapy progression-free survival — reachable because PLATINUM_PFS_STATUS happens to use the \"1:Progressed\"/\"0:Not Progressed\" convention the engine expects, unlike the paper's actual immunotherapy-outcome columns (see the document's own note). HR=1.02 per unit mutation rate, p=0.11 — a real, honestly-reported non-significant result for this specific covariate and outcome." }]
    }
  },
  {
    slug: "utuc-vs-bladder-2020",
    title: "Upper tract urothelial carcinoma",
    citation: "Nat Commun 2020",
    studyIds: ["utuc_msk_2019", "blca_tcga_pan_can_atlas_2018"],
    badge: "full",
    summary: "A genuinely federated reproduction — comparing UTUC against a completely separate bladder-cancer study — and it comes back with no gaps at all: every reported direction and magnitude matches known UTUC-vs-bladder biology, and the cross-study caveat wording (fixed this session) is now precise about when a stratified test would and wouldn't apply.",
    findings: [
      { claim: "FGFR3 alterations are more common in UTUC than in bladder cancer", result: "46.2% vs 18.7%, p=6.7e-9", verdict: "match" },
      { claim: "TP53 alterations are less common in UTUC than in bladder cancer", result: "21.8% vs 50.4%, p=1.9e-8", verdict: "match" },
      { claim: "RB1 alterations are markedly less common in UTUC than in bladder cancer", result: "1.7% vs 25.3%, p=7.5e-11", verdict: "match" },
      { claim: "CDKN2A alterations are less common in UTUC than in bladder cancer", result: "15.1% vs 38.7%, p=8.7e-7", verdict: "match" }
    ],
    doc: {
      study: "utuc_msk_2019",
      title: "UTUC vs bladder TCGA — cross-study comparison",
      notes: "Comparing upper tract urothelial carcinoma (utuc_msk_2019) against bladder cancer (TCGA PanCancer Atlas) — two entirely separate studies, federated cohort by cohort rather than pooled or vocabulary-harmonized. Every direction and magnitude here matches published UTUC-vs-bladder biology, with no gaps found in this reproduction.",
      cohorts: {
        "UTUC": { study: "utuc_msk_2019", all: [] },
        "Bladder (TCGA)": { study: "blca_tcga_pan_can_atlas_2018", all: [] }
      },
      views: [
        { kind: "compare", genes: ["FGFR3", "TP53", "RB1", "CDKN2A"], cohorts: ["UTUC", "Bladder (TCGA)"],
          note: "FGFR3 46.2% (UTUC) vs 18.7% (bladder), p=6.7e-9; TP53 21.8% vs 50.4%, p=1.9e-8; RB1 1.7% vs 25.3%, p=7.5e-11; CDKN2A 15.1% vs 38.7%, p=8.7e-7 — every direction and magnitude matches known UTUC-vs-bladder biology (UTUC is FGFR3-driven and TP53/RB1-cold relative to bladder cancer). Each cohort is confined to its own single study, so a stratified test would add nothing — study already IS the grouping variable here, which this view's caveat now says explicitly rather than defaulting to a generic \"a stratified test would be more principled\" line that wouldn't actually apply." },
        { kind: "oncoprint", genes: ["FGFR3", "TP53", "RB1", "CDKN2A"], cohorts: ["UTUC", "Bladder (TCGA)"],
          note: "The same four genes as a cross-study oncoprint, each column tagged by its originating study, so the UTUC/bladder split is visible directly in the mutation pattern, not just the summary statistics above." }
      ]
    }
  }
];
