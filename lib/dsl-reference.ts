// ============================================================================
// THE SINGLE SOURCE OF TRUTH for DSL documentation.
//
// Everything that *describes* the DSL renders from this module:
//   - docs/dsl.md            (generated: npm run docs:gen — never edit by hand)
//   - AGENT_GRAMMAR, the compact grammar the browser assistant reads (the analysis page's
//     dsl_reference WebMCP tool, /api/campaign/format)
//   - the MCP describe_dsl tool (mcp/tools.ts serves renderDslMarkdown())
//
// Each view kind's part — its row of the Views table, its grammar entry, its own examples — is in
// lib/views/<kind>/doc.ts (listed in lib/views/docs.ts); this module assembles them.
//
// The EXAMPLES below are executed against the live compiler by
// `npm run docs:check` (in scripts/gate.sh as `check:examples`), and docs/dsl.md is diffed against
// a regeneration — so a stale doc or a broken example fails the suite.
//
// When you change the DSL (lib/cohort2.ts, lib/oql.ts, lib/compiler.ts,
// lib/analysis.ts views, lib/oncoprint.ts), update this file — or the kind's
// doc.ts — in the same commit and run `npm run docs:gen`.
// ============================================================================

import { DOC_VERSION } from "./doc-version.ts";
import { POINTS_CAP, POINT_RULE_N_MAX } from "./plot-layers.ts";
import { OQL_STATEMENT_CAP } from "./plot-oql.ts";
import type { CustomDataset } from "./custom-data-names.ts";
import type { DslExample } from "./views/kind-doc.ts";
import { KIND_DOCS } from "./views/docs.ts";
import { LUAD_BIOPSY_SITE_DEMO } from "./custom-data-demo.ts";
import { SPECTRUM_SC_DEMO } from "./spectrum-sc-demo.ts";

/** the plot's points cap as the docs print it */
const POINTS_CAP_TEXT = POINTS_CAP.toLocaleString("en-US");
const POINT_RULE_N_MAX_TEXT = String(POINT_RULE_N_MAX);

export const DSL_VERSION = DOC_VERSION;

export type { DslExample } from "./views/kind-doc.ts";

// ---- runnable examples (rendered into the doc AND executed by docs:check) --
// The guide's: the document and cohort language, taught in order. An example written to show off
// one view kind lives in that kind's lib/views/<kind>/doc.ts instead, and follows these.
const GUIDE_EXAMPLES: DslExample[] = [
  {
    title: "Lung adenocarcinoma: a four-view workup",
    demonstrates: "One document, four views: the same two cohorts asked genomically, clinically, temporally and structurally. This is what the analysis document is FOR \u2014 not one chart, but a whole workup that travels as a single object.",
    tags: ["multi-view", "log-rank"],
    note: "EGFR-mutant versus KRAS-mutant lung adenocarcinoma \u2014 the two dominant, mutually exclusive driver classes. Co-alteration frequencies, how the groups differ clinically, how they differ in survival (with a log-rank test), and which driver pairs co-occur within the EGFR arm. Every view is computed from aggregates each site could return without disclosing a patient.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "EGFR-mutant NSCLC": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
          { kind: "oql", q: "EGFR: MUT" }
        ] },
        "KRAS-mutant NSCLC": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
          { kind: "oql", q: "KRAS: MUT" }
        ] }
      },
      views: [
        { kind: "compare", cohorts: ["EGFR-mutant NSCLC", "KRAS-mutant NSCLC"], genes: ["TP53", "STK11", "KEAP1", "RBM10", "ERBB2", "MET"] },
        { kind: "clinical", cohorts: ["EGFR-mutant NSCLC", "KRAS-mutant NSCLC"], attributes: ["SMOKING_PREDICTIONS_3_CLASSES", "CURRENT_AGE_DEID", "TMB_NONSYNONYMOUS", "FRACTION_GENOME_ALTERED"] },
        { kind: "survival", cohorts: ["EGFR-mutant NSCLC", "KRAS-mutant NSCLC"] },
        { kind: "cooccurrence", cohorts: ["EGFR-mutant NSCLC", "KRAS-mutant NSCLC"], genes: ["EGFR", "TP53", "STK11", "KEAP1", "RBM10"] }
      ]
    }
  },
  {
    title: "One cohort, five ways: the colorectal hotspot workup",
    demonstrates: "A single cohort put through five different views at once \u2014 including the lollipop \u2014 to show that the views compose rather than compete. Nothing here is re-queried per chart; each view asks its own aggregate of the same compiled cohort.",
    tags: ["multi-view", "lollipop"],
    note: "Colorectal cancer in MSK-CHORD. Lollipops for the canonical drivers (KRAS codon 12/13, BRAF V600E, PIK3CA E545K/H1047R), which pairs co-occur or exclude each other, which other drivers each group carries, how the mutated and wild-type groups differ clinically, and how they differ in survival. minCount is set so no site returns a change carried by fewer than three patients.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "CRC, KRAS-mutant": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] },
          { kind: "oql", q: "KRAS: MUT" }
        ] },
        "CRC, KRAS wild-type": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] },
          { not: { kind: "oql", q: "KRAS:" } },
          { kind: "profiled", type: "MUTATION", gene: "KRAS" }
        ] }
      },
      views: [
        { kind: "hotspots", cohorts: ["CRC, KRAS-mutant", "CRC, KRAS wild-type"], genes: ["KRAS", "BRAF", "PIK3CA", "TP53"], minCount: 3 },
        { kind: "cooccurrence", cohorts: ["CRC, KRAS-mutant", "CRC, KRAS wild-type"], genes: ["KRAS", "BRAF", "NRAS", "PIK3CA", "TP53", "APC", "SMAD4"] },
        { kind: "compare", cohorts: ["CRC, KRAS-mutant", "CRC, KRAS wild-type"], genes: ["BRAF", "NRAS", "PIK3CA", "APC", "SMAD4"] },
        { kind: "clinical", cohorts: ["CRC, KRAS-mutant", "CRC, KRAS wild-type"], attributes: ["CURRENT_AGE_DEID", "MSI_SCORE", "TMB_NONSYNONYMOUS"] },
        { kind: "survival", cohorts: ["CRC, KRAS-mutant", "CRC, KRAS wild-type"] }
      ]
    }
  },
  {
    title: "Federated end to end: two studies, four views",
    demonstrates: "The full federated story in one document \u2014 cohorts spanning two studies, with every view falling back on aggregates that each site can compute in its own database: pooled gene counts, additive moments, per-site survival triples and per-site 2\u00d72 tables.",
    tags: ["multi-view", "log-rank", "stratified"],
    note: "TP53-mutant versus wild-type across MSK-CHORD and MSK-MET. The log-rank is stratified by study, the co-occurrence test is Cochran\u2013Mantel\u2013Haenszel across the two sites, and the clinical comparison pools counts and moments \u2014 all from per-site aggregates. Run with either study aggregate-only and the numbers do not change.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { studies: ["msk_chord_2024", "msk_met_2021"],
          all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION", gene: "TP53" }] }
      },
      views: [
        { kind: "compare", cohorts: ["TP53 mut", "TP53 wt"], genes: ["KRAS", "PIK3CA", "APC", "EGFR", "CDKN2A"] },
        { kind: "survival", cohorts: ["TP53 mut", "TP53 wt"] },
        { kind: "clinical", cohorts: ["TP53 mut", "TP53 wt"], attributes: ["CURRENT_AGE_DEID", "TMB_NONSYNONYMOUS", "FRACTION_GENOME_ALTERED"] },
        { kind: "cooccurrence", cohorts: ["TP53 mut", "TP53 wt"], genes: ["TP53", "KRAS", "PIK3CA", "APC"] }
      ]
    }
  },
  {
    title: "Genomic status via OQL, compared",
    demonstrates: "The base case the others build on: two cohorts defined genomically, compared gene by gene with panel-aware denominators, then followed to death.",
    tags: ["OQL"],
    note: "STK11 putative drivers vs wild-type (wild-type = NOT any STK11 alteration AND profiled for STK11 mutations; without the profiled clause it would include patients never sequenced for STK11). Two views: co-alteration frequencies and overall survival.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "STK11 driver": { all: [{ kind: "oql", q: "STK11: DRIVER" }] },
        "STK11 wt": { all: [{ not: { kind: "oql", q: "STK11:" } }, { kind: "profiled", type: "MUTATION", gene: "STK11" }] }
      },
      views: [{ kind: "compare", cohorts: ["STK11 driver", "STK11 wt"], genes: ["KEAP1", "KRAS", "TP53"] }, { kind: "survival", cohorts: ["STK11 driver", "STK11 wt"] }]
    }
  },
  {
    title: "Multivariate Cox: gene status alongside a clinical covariate",
    demonstrates: "More than one covariate at once, unlike KM's single categorical split -- fit from real per-patient rows within this one local study, so a continuous or clinical covariate can sit next to a gene's alteration status in the same model.",
    tags: ["forest-plot", "OQL"],
    note: "Overall survival regressed on TP53 mutation status and reported gender, over the whole study. The forest plot reports one hazard ratio per covariate level, each measured against its own reference: a mutated-vs-not covariate always defaults to \"Not mutated\", any other categorical defaults to its most common level.",
    doc: {
      study: "msk_chord_2024",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "cox", cohorts: ["all patients"], covariates: [
        { source: "alteration", gene: "TP53", by: "mutated" },
        { source: "clinical", attribute: "GENDER" }
      ] }]
    }
  },
  {
    title: "Clinical + timeline event composition",
    demonstrates: "A cohort no attribute filter could express \u2014 it depends on the ORDER of events in a patient's timeline.",
    tags: ["timeline-events", "temporal"],
    note: "Never-smokers whose timeline shows progression within 180 days after first immunotherapy. The event leaf is the v1 timeline sub-DSL embedded as a clause.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "never-smoker fast progressors": { all: [
          { kind: "clinical", attribute: "SMOKING_PREDICTIONS_3_CLASSES", values: ["Never"] },
          { kind: "event",
            a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }], occurrence: "FIRST" },
            b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
            rel: { type: "BEFORE", maxDays: 180 } }
        ] }
      },
      views: [{ kind: "compare", cohorts: ["never-smoker fast progressors"], genes: ["STK11", "KEAP1", "TP53"] }]
    }
  },
  {
    title: "Derived filters: enough follow-up to answer the question",
    demonstrates: "Filters computed from the SHAPE of the data instead of a study's own words. Event-type names and attribute keys differ study to study, so anything keyed on them works nowhere in particular; dates and gene symbols are the same everywhere.",
    tags: ["derived", "timeline-events", "temporal"],
    note: "Any question about an outcome is only honest among patients observed long enough to have one. This contrasts patients with at least two years of follow-up past the study's own day 0 against those with under six months — a distinction no clinical attribute in this study records, and one that needs no knowledge of how this study names its events.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "followed 2y+": { all: [{ kind: "derived", metric: "followupMonths", range: { gte: 24 } }] },
        "followed < 6mo": { all: [{ kind: "derived", metric: "followupMonths", range: { lt: 6 } }] }
      },
      views: [
        { kind: "clinical", cohorts: ["followed 2y+", "followed < 6mo"], attributes: ["CANCER_TYPE", "CURRENT_AGE_DEID", "TMB_NONSYNONYMOUS"] },
        { kind: "compare", cohorts: ["followed 2y+", "followed < 6mo"], genes: ["TP53", "KRAS", "PIK3CA"] }
      ]
    }
  },
  {
    title: "Progression on immunotherapy: during, versus absent",
    demonstrates: "Two temporal relations that look similar and mean opposite things. DURING asks whether progression was recorded inside a treatment interval; NOT_FOLLOWED_BY asks whether it was absent for a year afterwards \u2014 and only counts patients whose follow-up actually covers that year.",
    tags: ["timeline-events", "temporal"],
    note: "Patients who progressed while on immunotherapy (1,423) versus those with no progression recorded in the year after starting it (534). The second cohort sets observed:true, so \"no progression\" means the follow-up was there and nothing was recorded \u2014 not that the patient was lost to follow-up. Without that guard the cohort would be far larger and largely meaningless.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "progressed on immunotherapy": { all: [{ kind: "event",
          a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] },
          b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
          rel: { type: "DURING" } }] },
        "no progression within a year": { all: [{ kind: "event",
          a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }], occurrence: "FIRST" },
          b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
          rel: { type: "NOT_FOLLOWED_BY", withinDays: 365, observed: true } }] }
      },
      views: [
        { kind: "compare", cohorts: ["progressed on immunotherapy", "no progression within a year"], genes: ["STK11", "KEAP1", "TP53", "EGFR", "SMARCA4"] },
        { kind: "clinical", cohorts: ["progressed on immunotherapy", "no progression within a year"], attributes: ["TMB_NONSYNONYMOUS", "CURRENT_AGE_DEID", "SMOKING_PREDICTIONS_3_CLASSES"] },
        { kind: "survival", cohorts: ["progressed on immunotherapy", "no progression within a year"] }
      ]
    }
  },
  {
    title: "Derived treatment lines: who reaches a third line?",
    demonstrates: "Treatment lines are not a column in the data \u2014 they are synthesised at query time by interval-merging systemic therapy with a gap rule. The line number is then an ordinary attribute you can filter on, and NOT around a line selector expresses \"never got that far\".",
    tags: ["timeline-events", "temporal", "treatment-lines"],
    note: "Patients who reached a third line of therapy (3,088) versus those who had a first line and never a second (13,620), with lines derived on a 90-day gap. Changing lineGap changes both cohorts \u2014 the line boundary is a modelling choice, made explicit rather than baked into the data. READ THE SURVIVAL CURVE WITH CARE: reaching a third line requires surviving long enough to receive one, so this comparison carries immortal time bias and the modest separation it shows (medians 48.1 vs 43.1 months) is not evidence that more lines help. The engine cannot detect this \u2014 it is a property of how the cohorts were defined, not of the data, which is exactly why the definition travels with the result.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "reached 3rd line": { all: [{ kind: "event",
          a: { eventType: "Treatment line (derived)", attrs: [{ key: "LINE_NO", value: "3" }] },
          rel: { type: "NONE" }, lineGap: 90 }] },
        "first line only": { all: [
          { kind: "event", a: { eventType: "Treatment line (derived)", attrs: [{ key: "LINE_NO", value: "1" }] },
            rel: { type: "NONE" }, lineGap: 90 },
          { not: { kind: "event", a: { eventType: "Treatment line (derived)", attrs: [{ key: "LINE_NO", value: "2" }] },
            rel: { type: "NONE" }, lineGap: 90 } }
        ] }
      },
      views: [
        { kind: "survival", cohorts: ["reached 3rd line", "first line only"] },
        { kind: "clinical", cohorts: ["reached 3rd line", "first line only"], attributes: ["CURRENT_AGE_DEID", "CANCER_TYPE", "TMB_NONSYNONYMOUS"] },
        { kind: "compare", cohorts: ["reached 3rd line", "first line only"], genes: ["TP53", "KRAS", "PIK3CA", "APC"] }
      ]
    }
  },
  {
    title: "Held-out replication: one question, two halves of the patients",
    demonstrates: "The split leaf. The engine divides every study's patients into two fixed halves by a salted hash of the patient id, so a finding made on one half can be checked on patients it never touched \u2014 the replication step a hypothesis campaign (/campaign) automates, and the one a single-dataset analysis usually has to skip.",
    tags: ["split", "replication", "timeline-events"],
    note: "NSCLC patients who progressed within 180 days of first immunotherapy versus those with no progression in the year after it, each divided into the discovery and validation halves. STK11 is altered more often in early failures on both halves; KEAP1 separates the groups on the discovery half only. The halves are the same for every caller and every run, and the salt is pinned by a test, so a result reported on one half can always be re-checked on the other.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "early failure (discovery)": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
          { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }], occurrence: "FIRST" },
            b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "BEFORE", maxDays: 180 } },
          { kind: "split", part: "discovery" }] },
        "durable response (discovery)": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
          { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }], occurrence: "FIRST" },
            b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "NOT_FOLLOWED_BY", withinDays: 365, observed: true } },
          { kind: "split", part: "discovery" }] },
        "early failure (validation)": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
          { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }], occurrence: "FIRST" },
            b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "BEFORE", maxDays: 180 } },
          { kind: "split", part: "validation" }] },
        "durable response (validation)": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
          { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }], occurrence: "FIRST" },
            b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "NOT_FOLLOWED_BY", withinDays: 365, observed: true } },
          { kind: "split", part: "validation" }] }
      },
      views: [
        { kind: "compare", genes: ["STK11", "KEAP1"], cohorts: ["early failure (discovery)", "durable response (discovery)"] },
        { kind: "compare", genes: ["STK11", "KEAP1"], cohorts: ["early failure (validation)", "durable response (validation)"] }
      ]
    }
  },
  {
    title: "True first line: fast progression versus durable control",
    demonstrates: "The prior-treatment guard. \"First line\" ordinarily means first line OBSERVED HERE \u2014 about a fifth of these patients were treated elsewhere first. priorGuard restricts to those flagged treatment-naive, which is the difference between a real first-line claim and an artefact of where the patient was referred from.",
    tags: ["timeline-events", "temporal", "prior-guard"],
    note: "Among treatment-naive patients starting first-line chemotherapy: progression recorded within 180 days (3,319) versus none in that window with follow-up to prove it (6,584). BEFORE takes a window; NOT_FOLLOWED_BY takes the same window and asks for its absence. Drop priorGuard and both cohorts grow by roughly the share of patients pre-treated elsewhere.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "progressed within 180d of 1L chemo": { all: [{ kind: "event",
          a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Chemo" }], occurrence: "FIRST" },
          b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
          rel: { type: "BEFORE", maxDays: 180 }, priorGuard: true }] },
        "no progression within 180d": { all: [{ kind: "event",
          a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Chemo" }], occurrence: "FIRST" },
          b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
          rel: { type: "NOT_FOLLOWED_BY", withinDays: 180, observed: true }, priorGuard: true }] }
      },
      views: [
        { kind: "survival", cohorts: ["progressed within 180d of 1L chemo", "no progression within 180d"] },
        { kind: "compare", cohorts: ["progressed within 180d of 1L chemo", "no progression within 180d"], genes: ["TP53", "KRAS", "SMAD4", "CDKN2A", "MYC"] },
        { kind: "clinical", cohorts: ["progressed within 180d of 1L chemo", "no progression within 180d"], attributes: ["CANCER_TYPE", "FRACTION_GENOME_ALTERED", "CURRENT_AGE_DEID"] }
      ]
    }
  },
  {
    title: "Lab thresholds over time: PSA above 100",
    demonstrates: "A numeric predicate on a repeated measurement. The cohort is defined by a lab value ever crossing a threshold, and its complement is built by wrapping the same selector in NOT alongside \"was measured at all\" \u2014 so the comparison is against patients genuinely tested, not against patients with no PSA record.",
    tags: ["timeline-events", "temporal", "lab-values"],
    note: "PSA recorded above 100 ng/ml at any point (879) versus PSA measured but never above 100 (3,250). The second cohort deliberately requires a PSA test to exist: comparing against everyone else would silently contrast the tested with the untested, which is a selection effect rather than a finding.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "PSA above 100": { all: [{ kind: "event",
          a: { eventType: "Lab_Test", attrs: [{ key: "TEST", value: "PSA" }],
            numeric: { key: "RESULT", op: ">", value: 100 } },
          rel: { type: "NONE" } }] },
        "PSA measured, never above 100": { all: [
          { kind: "event", a: { eventType: "Lab_Test", attrs: [{ key: "TEST", value: "PSA" }] }, rel: { type: "NONE" } },
          { not: { kind: "event",
            a: { eventType: "Lab_Test", attrs: [{ key: "TEST", value: "PSA" }],
              numeric: { key: "RESULT", op: ">", value: 100 } },
            rel: { type: "NONE" } } }
        ] }
      },
      views: [
        { kind: "compare", cohorts: ["PSA above 100", "PSA measured, never above 100"], genes: ["AR", "TP53", "PTEN", "SPOP", "RB1"] },
        { kind: "survival", cohorts: ["PSA above 100", "PSA measured, never above 100"] },
        { kind: "clinical", cohorts: ["PSA above 100", "PSA measured, never above 100"], attributes: ["CURRENT_AGE_DEID", "FRACTION_GENOME_ALTERED", "CANCER_TYPE"] }
      ]
    }
  },
  {
    title: "any / not / genomicData",
    demonstrates: "Boolean structure: OR inside a clause, NOT around a leaf, and a copy-number threshold expressed as a continuous range.",
    tags: ["boolean"],
    note: "Colorectal or pancreatic patients (OR inside one clause), excluding CDKN2A deep deletions expressed as a continuous copy-number threshold.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "CRC/PAAD without CDKN2A loss": { all: [
          { any: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] },
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"] }
          ] },
          { not: { kind: "genomicData", gene: "CDKN2A", profileType: "cna", range: { lte: -2 } } }
        ] }
      },
      views: [{ kind: "compare", cohorts: ["CRC/PAAD without CDKN2A loss"], genes: ["KRAS", "TP53", "APC", "SMAD4"] }]
    }
  },
  {
    title: "Cross-study federation with an oncoprint",
    demonstrates: "One cohort spanning two studies. Overlap is NOT deduplicated and vocabularies are NOT harmonized \u2014 the view says so rather than hiding it.",
    tags: [],
    note: "One cohort unioned across two studies (members are study-qualified; overlap is NOT deduplicated), rendered as a federated oncoprint with a categorical and a numeric clinical track, columns sorted by cancer type then descending age. The \u201cStudy of origin\u201d track is added automatically.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53-mut, CHORD+MET": { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] }
      },
      views: [{ kind: "oncoprint", cohorts: ["TP53-mut, CHORD+MET"], genes: ["TP53", "KRAS", "EGFR"], clinical: ["CANCER_TYPE", "CURRENT_AGE_DEID"], sort: ["CANCER_TYPE", "-CURRENT_AGE_DEID"] }]
    }
  }
,
  {
    title: "Molecular heatmap tracks, sorted by expression",
    demonstrates: "Continuous molecular values as tracks, with the track label doubling as the sort key.",
    tags: ["heatmap", "expression"],
    note: "ERBB2-amplified TCGA breast tumors with an mRNA z-score heatmap under the gene tracks, columns sorted by descending ERBB2 expression. Z-scores render on a fixed diverging \u00b13 ramp; the track label (gene + short profile name) is the sort key.",
    doc: {
      study: "brca_tcga_pan_can_atlas_2018",
      cohorts: {
        "ERBB2 amp": { all: [{ kind: "oql", q: "ERBB2: AMP" }] }
      },
      views: [{ kind: "oncoprint", cohorts: ["ERBB2 amp"], genes: ["ERBB2", "EGFR", "PIK3CA"],
        heatmap: [{ profileType: "rna_seq_v2_mrna_median_Zscores" }],
        sort: ["-ERBB2 mRNA-z"] }]
    }
  },
  {
    title: "A plot of 13,000 samples, drawn as density",
    demonstrates: "The portal's Plots tab fetches every point to the browser. This one counts them in the database and sends the counts, so the same picture draws for a hundred cases or four hundred thousand.",
    tags: ["scale"],
    note: "Tumour mutational burden against fraction of the genome altered, over every sample of a TP53-mutant cohort. The figure is a density field: the samples are counted into a 240x160 grid, and only the occupied cells travel, plus the outliers — the cases in the sparse cells at the fringe, drawn as points. Pearson, Spearman and the fitted line are computed over EVERY sample inside ClickHouse, so they describe the whole cohort rather than the points that happened to be painted last. The second view groups the same measure by TP53 mutation class, as quartiles with Tukey whiskers over a violin, with the values beyond the whiskers drawn as points.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] }
      },
      views: [
        { kind: "plot", cohorts: ["TP53 mut"], unit: "sample",
          x: { source: "clinical", attribute: "MUTATION_COUNT" },
          y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } },
        { kind: "plot", cohorts: ["TP53 mut"], unit: "sample",
          x: { source: "alteration", gene: "TP53", by: "mutationType" },
          y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } }
      ]
    }
  },
  {
    title: "Point layers on a plot: KRAS G12C and STK11 against 25,000 patients",
    demonstrates: "`points` on a plot view: subsets drawn in their own colours over the plotted cohort — here two cohorts, after the outliers — so the cases you care about are visible against a density of everyone else.",
    tags: ["points", "scale"],
    note: "Age against tumour mutational burden for every patient in MSK-CHORD (24,947 with both), drawn as a light-blue density. KRAS G12C (1,113 patients) and STK11-mutant (1,206) are drawn over it as points, each in its own colour. The coefficients and the fitted line are still those of the whole cohort. The second view groups the same measure by cancer type: KRAS G12C is again points, while TP53-mutant patients (13,105) are too many for points, so they are drawn as a narrow box per group beside the cohort's own box, and the caption says why.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "All patients": { all: [] },
        "KRAS G12C": { all: [{ kind: "oql", q: "KRAS: G12C" }] },
        "STK11 mut": { all: [{ kind: "oql", q: "STK11: MUT" }] },
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] }
      },
      views: [
        { kind: "plot", unit: "patient", cohorts: ["All patients"],
          x: { source: "clinical", attribute: "CURRENT_AGE_DEID" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" },
          points: [{ rule: "outliers" }, { cohort: "KRAS G12C" }, { cohort: "STK11 mut" }] },
        { kind: "plot", unit: "patient", cohorts: ["All patients"],
          x: { source: "clinical", attribute: "CANCER_TYPE" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" },
          points: [{ cohort: "KRAS G12C" }, { cohort: "TP53 mut" }] }
      ]
    }
  },
  {
    title: "A cohort layer that reaches beyond the plotted cohort",
    demonstrates: "A cohort layer's cases are the plotted cohort's cases that are also in it. Patients of the layer's cohort outside the plotted cohort are counted in the caption, not drawn.",
    tags: ["points"],
    note: "Non-small cell lung cancer in MSK-CHORD (7,809 patients), with KRAS G12C highlighted. 916 of the 1,113 KRAS G12C patients have a lung sample; the other 197 are outside the plotted cohort, and the caption says so. The second view counts samples instead of patients, so a patient with two sequenced samples is drawn twice.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] },
        "KRAS G12C": { all: [{ kind: "oql", q: "KRAS: G12C" }] }
      },
      views: [
        { kind: "plot", unit: "patient", cohorts: ["NSCLC"],
          x: { source: "clinical", attribute: "CURRENT_AGE_DEID" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" },
          points: [{ cohort: "KRAS G12C" }] },
        { kind: "plot", unit: "sample", cohorts: ["NSCLC"],
          x: { source: "clinical", attribute: "SAMPLE_TYPE" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" },
          points: [{ cohort: "KRAS G12C" }] }
      ]
    }
  },
  {
    title: "Point layers across two studies",
    demonstrates: "Point layers on a federated plot: each study answers for its own cases, and the points are pooled onto one figure.",
    tags: ["points"],
    note: "TCGA lung adenocarcinoma and squamous cell carcinoma pooled (1,053 patients). KRAS-mutant (175) and TP53-mutant (699) patients are drawn over the pooled plot of age against tumour mutational burden; each study returns its own highlighted cases. In the second view, KRAS-mutant patients are drawn over the TMB distribution by sex. If any study in a highlight could not show individual cases, the whole highlight would be drawn as an aggregate, never half points and half cells.",
    doc: {
      study: "luad_tcga_pan_can_atlas_2018",
      cohorts: {
        "Lung (TCGA)": { studies: ["luad_tcga_pan_can_atlas_2018", "lusc_tcga_pan_can_atlas_2018"], all: [] },
        "KRAS mut": { studies: ["luad_tcga_pan_can_atlas_2018", "lusc_tcga_pan_can_atlas_2018"], all: [{ kind: "oql", q: "KRAS: MUT" }] },
        "TP53 mut": { studies: ["luad_tcga_pan_can_atlas_2018", "lusc_tcga_pan_can_atlas_2018"], all: [{ kind: "oql", q: "TP53: MUT" }] }
      },
      views: [
        { kind: "plot", unit: "patient", cohorts: ["Lung (TCGA)"],
          x: { source: "clinical", attribute: "AGE" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" },
          points: [{ cohort: "KRAS mut" }, { cohort: "TP53 mut" }] },
        { kind: "plot", unit: "patient", cohorts: ["Lung (TCGA)"],
          x: { source: "clinical", attribute: "SEX" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" },
          points: [{ cohort: "KRAS mut" }] }
      ]
    }
  },
  {
    title: "OQL on a plot axis: STK11 or KEAP1 mutant lung cancer",
    demonstrates: "An alteration axis written as an OQL query — several genes, Altered when a case matches any of them, or one group per statement — used as a box plot's groups and as a colour.",
    tags: ["OQL"],
    note: "Non-small cell lung cancer in MSK-CHORD (7,809 patients). The first view groups tumour mutational burden by the OQL query `STK11: MUT; KEAP1: MUT`: 1,535 patients are Altered (a mutation in either gene), the same count as a cohort defined by that OQL, and 6,274 are Unaltered. The second view groups by sample type and colours each violin by the same query, counting samples rather than patients. The third gives each statement of `STK11: MUT, KEAP1: MUT, KRAS: G12C` its own group, over samples: 620 KRAS G12C, 459 KEAP1, 377 STK11, 403 with both STK11 and KEAP1 (median TMB 8.6 against 4.1 for the 5,720 with none), the other pairs as their own groups and 109 matching all three. None of these lung samples is on a panel without the three genes, so no group is Not profiled.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] }
      },
      views: [
        { kind: "plot", unit: "patient", cohorts: ["NSCLC"],
          x: { source: "alteration", oql: "STK11: MUT; KEAP1: MUT" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" } },
        { kind: "plot", unit: "sample", cohorts: ["NSCLC"], allPoints: false, points: [],
          x: { source: "clinical", attribute: "SAMPLE_TYPE" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" },
          colorBy: { source: "alteration", oql: "STK11: MUT; KEAP1: MUT" } },
        { kind: "plot", unit: "sample", cohorts: ["NSCLC"],
          x: { source: "alteration", oql: "STK11: MUT, KEAP1: MUT, KRAS: G12C", by: "statement" },
          y: { source: "clinical", attribute: "TMB_NONSYNONYMOUS" } }
      ]
    }
  },
  {
    title: "Plot axes from the study's own profiles: ERBB2 copy number against expression",
    demonstrates: "A `profile` axis: one gene in one of the study's molecular profiles, read as the study describes the profile — discrete copy number as its levels, expression as a number, mutations by type.",
    tags: ["profiles"],
    note: "TCGA breast cancer (PanCancer Atlas), every sample. The first view groups ERBB2 mRNA z-scores (relative to all samples) by ERBB2's GISTIC copy-number call, from Shallow deletion to Amplification: the 122 amplified samples sit far above the rest. The second groups fraction of genome altered by TP53's mutation type from the study's mutation profile; the 18 samples not in that profile are Not profiled, not counted as unmutated.",
    doc: {
      study: "brca_tcga_pan_can_atlas_2018",
      cohorts: { "all samples": { all: [] } },
      views: [
        { kind: "plot", cohorts: ["all samples"], unit: "sample",
          x: { source: "profile", profile: "gistic", gene: "ERBB2" },
          y: { source: "profile", profile: "rna_seq_v2_mrna_median_all_sample_Zscores", gene: "ERBB2" } },
        { kind: "plot", cohorts: ["all samples"], unit: "sample",
          x: { source: "profile", profile: "mutations", gene: "TP53" },
          y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } }
      ]
    }
  },
  {
    title: "Merged gene rows: a pathway as one track",
    demonstrates: "Several genes drawn as one row, the way cBioPortal's [TP53 MDM2 MDM4] does, with the members kept alongside so the pooling is visible.",
    tags: ["merged-tracks"],
    note: "Pancreatic adenocarcinoma. The first row pools TP53, MDM2 and MDM4: it is altered where any of them is, and its denominator is the union of the three genes' panels \u2014 not their intersection, and not the whole cohort. TP53 is drawn again on its own underneath, so the difference the other two make is readable rather than asserted. A row's members are listed in its tooltip and in the contract's `members` field.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "Pancreatic": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"] }] }
      },
      views: [{ kind: "oncoprint", cohorts: ["Pancreatic"],
        genes: [{ label: "TP53 pathway", genes: ["TP53", "MDM2", "MDM4"] }, "TP53", { label: "RAS", genes: ["KRAS", "NRAS", "HRAS"] }, "SMAD4", "CDKN2A"],
        clinical: ["CURRENT_AGE_DEID"] }]
    }
  },
  {
    title: "A federated z-score reference on an oncoprint",
    demonstrates: "The sharpest form of the argument: a site that discloses no patients \u2014 and so draws no columns \u2014 still defines the scale those columns are read against, from three totals per gene.",
    tags: ["heatmap", "z-reference"],
    note: "A heatmap track with reference:\"federation\" is scored against a distribution pooled from EVERY participating study, including instances that disclose no patients and therefore contribute no columns — each returns three totals per gene (n, sum, sum of squares), which is enough to define the reference. Run with luad_tcga_pan_can_atlas_2018 aggregate-only, its patients are absent from the columns while its 510 patients still shape what the drawn columns mean.",
    doc: {
      study: "brca_tcga_pan_can_atlas_2018",
      cohorts: {
        "ERBB2 amp": { studies: ["brca_tcga_pan_can_atlas_2018", "luad_tcga_pan_can_atlas_2018"],
          all: [{ kind: "oql", q: "ERBB2: AMP" }] }
      },
      views: [{ kind: "oncoprint", cohorts: ["ERBB2 amp"], genes: ["ERBB2", "EGFR"],
        heatmap: [{ profileType: "rna_seq_v2_mrna_median_Zscores", reference: "federation" }] }]
    }
  },
  {
    title: "The clinical course: who is still on treatment, and when",
    demonstrates: "Timeline data finally DRAWN rather than only filtered on. The two things that make a temporal chart honest are both enforced by the engine: every patient is lined up on a real clinical landmark rather than a study-specific day 0, and the denominator is who was still under observation \u2014 not the whole cohort.",
    tags: ["timeline-events", "temporal", "anchor", "at-risk"],
    note: "MSK-CHORD, aligned on each patient's FIRST treatment, split by TP53 status. Treatment carries real start/stop dates so it is drawn as a state patients are IN; surgery has no duration, so it is the share with a surgery in that bin \u2014 a distinction read from the data's shape, not from the event's name. Note surgery peaking BEFORE time zero: resection typically precedes first systemic therapy. The at-risk row under the axis is the denominator, and it falls steeply \u2014 a curve read without it would be badly misleading.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] },
        // "wild-type" means PROFILED for mutation and not altered \u2014 without the
        // profiled guard, patients never tested land in the wild-type arm.
        "TP53 wt": { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION", gene: "TP53" }] }
      },
      views: [{
        kind: "course", cohorts: ["TP53 mut", "TP53 wt"], eventTypes: ["treatment", "surgery"],
        anchor: { eventType: "Treatment", occurrence: "FIRST" },
        binMonths: 3, fromMonths: -12, toMonths: 60
      }]
    }
  },
  {
    title: "A reusable workup: one template, retargeted in a single edit",
    demonstrates: "The document as a SAVED WORKSPACE rather than a one-off query. Several figures, the analyst's own notes, and the gene panel and study lifted into parameters \u2014 so running the same workup on a different panel is one edit instead of the same list retyped in every view.",
    tags: ["template", "params", "workspace", "notes", "multi-view"],
    note: "The gene list appears once, in `params`, and every view refers to it as `$genes`; the study likewise. Change either and all three figures follow. The rule is only that a value which is exactly \"$name\" is replaced by that parameter \u2014 no interpolation, no expressions \u2014 so the resolved document is an ordinary one and compiles to exactly the SQL you would get by typing the values in. A `$name` with no declaration is a loud error naming the path, and a parameter declared but never referenced is reported back, which is what catches a rename that missed a reference. `notes` and each view\u2019s `note` travel with the document.",
    doc: {
      params: { study: "msk_chord_2024", genes: ["TP53", "KRAS", "STK11", "KEAP1", "EGFR"] },
      study: "$study",
      title: "NSCLC driver workup",
      notes: "Standard first pass at a driver panel: how often each gene is altered, whether the alterations travel together, and who carries them. Retarget by editing $genes.",
      cohorts: {
        "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] }
      },
      views: [
        { kind: "compare", cohorts: ["NSCLC"], genes: "$genes", note: "Frequencies first \u2014 the headline numbers." },
        { kind: "cooccurrence", cohorts: ["NSCLC"], genes: "$genes", note: "Do these drivers co-occur, or exclude one another?" },
        { kind: "oncoprint", cohorts: ["NSCLC"], genes: "$genes" }
      ]
    }
  },
  {
    title: "What comes after what: lines of therapy, and what ending a path means",
    demonstrates: "The question the clinical-course view CANNOT answer \u2014 that chart asks 'on treatment, yes or no', so a seamless switch between drugs never moves the line. And the reason a sequence diagram usually misleads: most paths end because the RECORD ends, not because the patient stopped, so the two endings are drawn as separate terminals.",
    tags: ["sankey", "temporal", "treatment-lines", "censoring"],
    note: "MSK-CHORD therapy lines by TP53 status, 90-day gap, two panels on one scale. Read the grey blocks first, and read them as TWO things: the darker terminal is patients the study watched for at least a line gap who began no further therapy; the lighter one is patients whose records simply stop, about whom nothing can be concluded. Over half of all paths end censored \u2014 collapsing them together (as a plain Sankey does) would turn record-keeping into an apparent clinical decision. The real signal is in first line: TP53 wild-type receives far more hormone therapy than TP53-mutant, which is what hormone-receptor-positive disease looks like. Lines are the one definition every line count shares: systemic-therapy records only, so 'Prior Medications to MSK' (a provenance marker rather than a therapy), radiation and bone treatment are not lines \u2014 they co-occur with almost everything, so leaving them in would explode the combination space. The caption says which records were used; a document that wants them anyway says so with lineClasses.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION", gene: "TP53" }] }
      },
      views: [{
        kind: "sequence", cohorts: ["TP53 mut", "TP53 wt"], labelKey: "SUBTYPE",
        lineGap: 90, maxSteps: 3, topN: 8
      }]
    }
  },
  {
    title: "Lollipop plot: mutations by protein position, with a suppression floor",
    demonstrates: "Lollipop data, and the one place small cells genuinely bite: minCount is applied by each site BEFORE anything is returned, because a coordinator filtering what it already received is theatre.",
    tags: ["lollipop", "suppression"],
    note: "Hotspots in colorectal cancer, drawn the way cBioPortal's mutation tab draws them: one stem per codon, its height the distinct patient + protein change pairs there, with the protein's Pfam domains on the backbone — so KRAS spikes at codons 12-13 and BRAF at V600. minCount is applied by each site before anything is returned — with it set to 3, a change carried by one or two patients never leaves the database holding it, which is where small-cell suppression belongs.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "CRC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }] }
      },
      views: [{ kind: "hotspots", cohorts: ["CRC"], genes: ["KRAS", "BRAF", "PIK3CA", "TP53"], minCount: 3 }]
    }
  },
  {
    title: "Co-expression from sums alone",
    demonstrates: "A correlation depends on the data only through six running totals, so it federates exactly \u2014 the pooled answer equals the centralized one rather than approximating it.",
    tags: ["federable"],
    note: "Pearson correlation between gene pairs in TCGA breast cancer. A correlation depends on the data only through six running totals, so each site can contribute without transmitting a single expression value — and because the totals add, the federated answer is exact rather than approximate. ERBB2/GRB7 (adjacent on the 17q12 amplicon) comes out near 0.87.",
    doc: {
      study: "brca_tcga_pan_can_atlas_2018",
      cohorts: { "BRCA": { all: [{ kind: "profiled", type: "MUTATION" }] } },
      views: [{ kind: "coexpression", cohorts: ["BRCA"], profileType: "rna_seq_v2_mrna_median_Zscores",
        genes: ["ERBB2", "GRB7", "ESR1", "PGR", "MKI67"] }]
    }
  },
  {
    title: "Clinical attributes compared between cohorts",
    demonstrates: "Welch's t from (n, sum, sum of squares): three additive totals per site, so pooled mean and variance are exact and no individual value is transmitted.",
    tags: ["federable"],
    note: "How TP53-mutant and wild-type tumors differ clinically. Categorical attributes are compared with a chi-squared over the full value vocabulary; numeric ones with Welch's t computed from three additive totals per site (n, sum, sum of squares) rather than from any transmitted value. An attribute the study does not declare is reported as skipped, not silently dropped.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION", gene: "TP53" }] }
      },
      views: [{ kind: "clinical", cohorts: ["TP53 mut", "TP53 wt"], attributes: ["CANCER_TYPE", "SMOKING_PREDICTIONS_3_CLASSES", "CURRENT_AGE_DEID", "TMB_NONSYNONYMOUS", "FRACTION_GENOME_ALTERED"] }]
    }
  },
  {
    title: "Co-occurrence and mutual exclusivity in NSCLC",
    demonstrates: "Four counts per gene pair per site. Denominators are the patients each site's OWN panels profiled for both genes \u2014 something pooled exports get wrong.",
    tags: ["federable"],
    note: "Pairwise associations among lung cancer driver genes. Each site returns four counts per pair — both altered, one, the other, neither — among the patients its own panels profiled for BOTH genes, and nothing else; the coordinator does the inference. Reproduces the textbook pattern: STK11/KEAP1 co-occur, EGFR/KRAS and EGFR/ALK are mutually exclusive.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] }
      },
      views: [{ kind: "cooccurrence", cohorts: ["NSCLC"], genes: ["EGFR", "KRAS", "TP53", "STK11", "KEAP1", "ALK"] }]
    }
  },
  {
    title: "Survival from first chemotherapy, left-truncated",
    demonstrates: "Re-anchoring the survival clock to a timeline event, and the correction that makes it honest. The study measures OS from its own day 0 (first sequencing); anchoring at first chemotherapy moves the clock earlier, so patients are unobservable until day 0 and enter the risk set then — without that, every patient would appear to survive from chemotherapy to sequencing, which is precisely what got them into the study.",
    tags: ["timeline-events", "temporal", "left-truncation", "anchor"],
    note: "TP53-mutant vs wild-type, overall survival measured from each patient's first chemotherapy rather than from sequencing. Patients whose first chemotherapy falls after day 0, or who never had chemotherapy, are excluded rather than given negative follow-up. The result reports how long after the anchor patients became observable, so an anchor that is matching earlier events than intended shows up as a long tail.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION", gene: "TP53" }] }
      },
      views: [{ kind: "survival", cohorts: ["TP53 mut", "TP53 wt"],
        anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Chemo", occurrence: "FIRST" } }]
    }
  },
  {
    title: "Study-stratified survival across two studies",
    demonstrates: "The log-rank statistic is a sum over strata, so sites can BE the strata \u2014 which is better methodology than pooling, not merely more private.",
    tags: ["log-rank", "stratified"],
    note: "TP53-mutant vs wild-type, each cohort spanning two studies. Every site answers with (months, event, n) counts only — no survival time for any individual crosses an instance boundary — and because the log-rank statistic is a sum over strata, those counts are enough to compute the test STRATIFIED by study: each study is compared only against itself. The unstratified pooled p is reported alongside, since the two can disagree when case mix differs between sites.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { studies: ["msk_chord_2024", "msk_met_2021"],
          all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION", gene: "TP53" }] }
      },
      views: [{ kind: "survival", cohorts: ["TP53 mut", "TP53 wt"] }]
    }
  },
  {
    title: "extends: a nested cohort without repeating its parent's filter",
    demonstrates: "A cohort inheriting another's `all` clauses instead of copy-pasting them, so editing the base cohort updates every cohort built on it. `extends` is resolved before compilation, so the compiled SQL and this comparison's counts are identical to writing the APC clause out twice by hand.",
    tags: ["cohort-structure", "extends"],
    note: "APC-mutant colorectal cancer, then the same population restricted to liver metastasis — without re-stating the APC clause. `compare` shows both share the same APC-mutant base, so a difference between them is attributable to the liver-mets split, not to two independently-typed cohort definitions quietly drifting apart.",
    doc: {
      study: "crc_apc_impact_2020",
      cohorts: {
        "APC-mutant": { all: [{ kind: "oql", q: "APC: MUT" }] },
        "APC-mutant, liver mets": { extends: "APC-mutant",
          all: [{ kind: "clinical", attribute: "METASTASIS_LIVER", values: ["Yes"] }] }
      },
      views: [{ kind: "compare", cohorts: ["APC-mutant", "APC-mutant, liver mets"], genes: ["TP53", "KRAS", "PIK3CA"] }]
    }
  },
  {
    title: "Splits: a cohort divided into arms that add up to it",
    demonstrates: "A cohort's `splits` divide it into child cohorts that are disjoint and together exactly the parent: arms are tested in order and the first match wins, patients matching none go to a remainder, and patients an arm cannot be decided for (here, not profiled for KRAS) get their own child instead of being counted as wild-type. The result checks that the children add up to the parent; a view naming the split compares its arms.",
    tags: ["cohort-structure", "splits"],
    note: "Non-small cell lung cancer split by KRAS allele: G12C first, then any other KRAS mutation, then wild-type. Because G12C is tested first, \"other KRAS\" needs no hand-written \"and not G12C\". 916 + 1,278 + 5,615 = 7,809, the whole cohort, with nobody unprofiled for KRAS in this study. STK11 and KEAP1 are enriched in both KRAS-mutant arms and TP53 in wild-type — the known co-mutation pattern — while overall survival does not differ significantly across the three arms (k-group log-rank p≈0.1).",
    doc: {
      study: "msk_chord_2024",
      cohorts: { "NSCLC": {
        all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }],
        splits: { "KRAS allele": { other: "KRAS wild-type", arms: [
          { name: "G12C", where: { kind: "oql", q: "KRAS: G12C" } },
          { name: "other KRAS", where: { kind: "oql", q: "KRAS: MUT" } }
        ] } }
      } },
      views: [
        { kind: "compare", genes: ["STK11", "KEAP1", "TP53"], cohorts: ["NSCLC / KRAS allele"] },
        { kind: "survival", cohorts: ["NSCLC / KRAS allele"] }
      ]
    }
  },
  {
    title: "Median/IQR and a rank-sum test, single-study only",
    demonstrates: "Why a second test earns its place: MSI_SCORE is right-skewed here, so Welch's t (which compares means) calls it significant while the Mann-Whitney rank-sum (which compares typical values) does not — the mean is being pulled by a few high-MSI outliers, not by a real shift in the bulk of each group. Both are shown; neither is hidden in favour of the other.",
    tags: ["median", "rank-sum", "single-study"],
    note: "APC-mutant colorectal cancer, split by liver metastasis. Alongside mean/SD, numeric attributes report an exact median/IQR and a Mann-Whitney U — available here only because both cohorts stay within one study (crc_apc_impact_2020): median and rank are not additive across sites the way (n, Σx, Σx²) is, so this is refused rather than approximated the moment a cohort spans more than one study.",
    doc: {
      study: "crc_apc_impact_2020",
      cohorts: {
        "liver mets": { all: [{ kind: "oql", q: "APC: MUT" }, { kind: "clinical", attribute: "METASTASIS_LIVER", values: ["Yes"] }] },
        "no liver mets": { all: [{ kind: "oql", q: "APC: MUT" }, { kind: "clinical", attribute: "METASTASIS_LIVER", values: ["No"] }] }
      },
      views: [{ kind: "clinical", cohorts: ["liver mets", "no liver mets"], attributes: ["MSI_SCORE", "AGE_AT_MET"] }]
    }
  },
  {
    title: "Cox with a gene-SET covariate: any of three genes, one term",
    demonstrates: "A Cox covariate naming a gene SET (`genes`, not `gene`) instead of one gene at a time — \"is any of TP53/KRAS/PIK3CA mutated\" as a single pathway-style term, the way a paper actually reasons about a gene panel, without fitting one covariate per gene.",
    tags: ["gene-sets", "forest-plot"],
    note: "Every patient in the study, one term: mutated in any of TP53/KRAS/PIK3CA versus none of them. Compiles to a single hugo_gene_symbol IN (...) — the same shape as a single-gene covariate, just with a broader gene list, so it costs nothing extra downstream (dummy-coding, the forest plot, the reference-level override all just work).",
    doc: {
      study: "crc_apc_impact_2020",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "cox", cohorts: ["all patients"], endpoint: "OS", covariates: [{ source: "alteration", genes: ["TP53", "KRAS", "PIK3CA"] }] }]
    }
  },
  {
    title: "Cox stratified by cohort: does a gene's hazard ratio hold up in both arms?",
    demonstrates: "`stratifyByCohort` fits each named cohort as its own independent Cox model instead of pooling them — the right tool when a covariate's EFFECT, not just the case mix, might genuinely differ between cohorts. The forest plot draws one panel per cohort on a shared hazard-ratio scale, so the difference (or agreement) is visible directly rather than averaged away.",
    tags: ["forest-plot", "stratified"],
    note: "APC mutation status regressed on overall survival, separately in the MSI-high and MSS arms of the same study. Pooled, APC reads HR=0.61 (95% CI 0.48-0.78) — a real effect, but stratifying shows it is almost entirely a microsatellite-stable-population effect (MSS: HR=0.54, p<0.0001) that does not reach significance in the small MSI-high arm (HR=0.87, 95% CI 0.31-2.44, n=27) — a pooled fit alone would not have shown that the effect is concentrated in one subgroup.",
    doc: {
      study: "crc_apc_impact_2020",
      cohorts: {
        "MSI-high": { all: [{ kind: "clinical", attribute: "MSI_TYPE", op: "=", value: "Instable" }] },
        "MSS": { all: [{ kind: "clinical", attribute: "MSI_TYPE", op: "=", value: "Stable" }] }
      },
      views: [{ kind: "cox", cohorts: ["MSI-high", "MSS"], covariates: [{ source: "alteration", gene: "APC", by: "mutated" }], stratifyByCohort: true }]
    }
  },
  {
    title: "Logistic regression: does APC status predict MSI-high status?",
    demonstrates: "A `logistic` view: a BINARY outcome regressed on covariates, reported as odds ratios — the same forest-plot shape as `cox`, but for \"did X happen\" rather than \"when did X happen\", so there's no endpoint/months convention. `outcomeEvent` says which observed value of a categorical outcome is the event; every other observed value is disclosed as collapsed into \"not event\" rather than silently merged.",
    tags: ["forest-plot", "odds-ratio"],
    note: "MSI_TYPE = Instable (vs every other observed value: Stable, Indeterminate, Do not report) regressed on APC mutation status. APC-mutant patients have substantially lower odds of MSI-high status (OR=0.28, 95% CI 0.13-0.63, p=0.0018) — consistent with APC-driven CRC typically arising through the chromosomal-instability pathway rather than the mismatch-repair-deficient pathway MSI-high status marks.",
    doc: {
      study: "crc_apc_impact_2020",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "logistic", cohorts: ["all patients"], outcome: { source: "clinical", attribute: "MSI_TYPE" }, outcomeEvent: "Instable",
        covariates: [{ source: "alteration", gene: "APC", by: "mutated" }] }]
    }
  },
  {
    title: "Pan-cancer forest: TP53 mutation and survival in 30 cancer types",
    demonstrates: "A `forest` view: one exposure's hazard ratio fit by Cox regression within each cancer type, then pooled by a DerSimonian–Laird random-effects meta-analysis (and the fixed-effect estimate), with τ², I² and Cochran's Q. Patients not profiled for the gene are left out, never counted as wild type; cancer types under 30 patients or 10 deaths are pooled into one disclosed \"Other\" row, each with its own baseline hazard.",
    tags: ["forest-plot", "meta-analysis", "pan-cancer"],
    note: "TP53 mutation against overall survival across MSK-IMPACT 50K. TP53-mutant patients die sooner in almost every cancer type — prostate (HR 2.5), endometrial (2.9), thyroid (4.1) — but not in glioma (0.86) or melanoma (0.78), where TP53 marks better-prognosis subtypes. Pooled, the random-effects HR is 1.63 (1.42–1.87), but I² is 93%: the cancer types disagree far beyond chance, so the pooled number is an average over different effects, not one effect.",
    doc: {
      study: "msk_impact_50k_2026",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "forest", cohorts: ["all patients"], exposure: { source: "alteration", gene: "TP53" }, strata: "CANCER_TYPE" }]
    }
  },
  {
    title: "Adjusted enrichment: early-onset colorectal cancer, adjusted for MSI and TMB",
    demonstrates: "An `adjusted` view: every gene mutated in at least 5% of the patients profiled for it, compared between two cohorts by a logistic regression of mutated on cohort and covariates (here MSI status and tumour mutation burden), its adjusted odds ratio beside the raw one and the Fisher test, Benjamini–Hochberg q on the adjusted p. Panel-aware per gene: a patient whose panel omits a gene is left out of that gene.",
    tags: ["covariates", "volcano", "early-onset"],
    note: "Colorectal cancers in MSK-IMPACT 50K diagnosed before 50 against at 50 or later. Early-onset tumours carry BRAF less often (7.4% against 12.9%; adjusted OR 0.52) and RNF43 less often (0.66), and TP53 (77% against 72%; 1.31) and TCF7L2 (1.40) more often — 4 of 56 genes at q < 0.05 once MSI status and TMB are adjusted for, as in Cercek et al. (JNCI 2021).",
    doc: {
      study: "msk_impact_50k_2026",
      cohorts: {
        "Early-onset CRC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }, { kind: "clinical", attribute: "AGE_AT_DX", op: "<", value: 50 }] },
        "Average-onset CRC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"] }, { kind: "clinical", attribute: "AGE_AT_DX", op: ">=", value: 50 }] }
      },
      views: [{ kind: "adjusted", cohorts: ["Early-onset CRC", "Average-onset CRC"], covariates: ["MSI_TYPE", "TMB_SCORE"] }]
    }
  },
  {
    title: "Clinical actionability: OncoKB levels across 50,000 tumours, and primary against metastasis",
    demonstrates: "An `actionability` view: each sequenced patient's highest OncoKB therapeutic level (1, 2, 3A, 3B, 4) and any resistance level over their mutations and copy-number calls, read from the version-pinned store, as stacked bars per cancer type (the largest eight, the rest pooled into a named Other); and for patients with both a primary and a metastatic sample sequenced, the cross-table of their highest level on each side. The store's levels are not cancer-type specific, so the bars are an upper bound — the caveat says so.",
    tags: ["oncokb", "precision-oncology", "pan-cancer"],
    note: "MSK-IMPACT 50K by cancer type. Because a level is the store's best for the alteration in any cancer type, KRAS-mutant pancreatic cancers count at level 1 (87%) and as R1: an upper bound, not a treatment rate. Of the 2,278 patients with a primary and a metastasis sequenced, 25.5% have a different highest level in the two.",
    doc: {
      study: "msk_impact_50k_2026",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "actionability", cohorts: ["all patients"], groupBy: "CANCER_TYPE", top: 8 }]
    }
  },
  {
    title: "Driver-negative lung cancer: what is mutated when no canonical driver is",
    demonstrates: "A `drivernegative` view: one cohort split into patients with an OncoKB driver in a canonical driver list (here the default NSCLC set: EGFR, KRAS, ALK, ROS1, BRAF, MET, RET, ERBB2, NTRK1–3), patients with none who were profiled for every listed gene, and those not fully profiled (neither side); then every other gene's mutation frequency in patients compared between driver-negative and driver-positive, Fisher per gene and Benjamini–Hochberg across genes.",
    tags: ["drivers", "volcano", "nsclc"],
    note: "Non-small cell lung cancer in MSK-CHORD. 2,898 of 7,809 patients (37.1%) carry none of the eleven drivers. Their tumours carry NF1 (12.4% against 5.0%), NFE2L2, KEAP1, RASA1, MAP2K1 and NRAS mutations more often — other routes into the same MAPK and oxidative-stress pathways — while RBM10 goes with the drivers.",
    doc: {
      study: "msk_chord_2024",
      cohorts: { "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] } },
      views: [{ kind: "drivernegative", cohorts: ["NSCLC"] }]
    }
  },
  {
    title: "Metastatic organotropism: which mutations go with spread to which organ (MSK-MET)",
    demonstrates: "An `organotropism` view: per-organ metastasis flags (MSK-MET's DMETS_DX_<site>, Yes / No) crossed with the twelve most often mutated genes (OncoKB drivers), each cell a Cochran–Mantel–Haenszel test stratified by cancer type with the Mantel–Haenszel odds ratio, Benjamini–Hochberg over the grid — panel-aware, so a patient not profiled for a gene is in neither group.",
    tags: ["metastasis", "heatmap", "pan-cancer"],
    note: "25,775 patients in MSK-MET (Nguyen et al., Cell 2022). Within cancer types, TP53 goes with metastasis to nearly every organ (liver odds ratio 1.45), EGFR with the brain (1.63), bone and peripheral nerves, APC with liver and lung, and PTEN and ARID1A with less peritoneal and liver spread — the paper's organotropism map from counts alone.",
    doc: {
      study: "msk_met_2021",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "organotropism", cohorts: ["all patients"] }]
    }
  },
  {
    title: "Brain metastasis in lung cancer by EGFR, from dated tumour sites",
    demonstrates: "An `organotropism` view on timeline sites (MSK-CHORD's Diagnosis events, TUMOR_SITE from radiology reports): a gene × site heatmap for six lung-cancer genes, and the cumulative incidence of a first CNS/brain site after the timeline's day 0 for EGFR-mutant against EGFR-wild-type patients, death as a competing risk (Aalen–Johansen, Gray's test).",
    tags: ["metastasis", "competing-risks", "nsclc"],
    note: "Non-small cell lung cancer in MSK-CHORD. EGFR-mutant tumours carry brain sites more often (OR 1.7) and gain them faster after sequencing: 32% by five years against 23%, Gray's p < 0.001; STK11, KEAP1 and SMARCA4 go with adrenal spread.",
    doc: {
      study: "msk_chord_2024",
      cohorts: { "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] } },
      views: [{ kind: "organotropism", cohorts: ["NSCLC"], source: "timeline", genes: ["EGFR", "KRAS", "TP53", "STK11", "KEAP1", "SMARCA4"], incidence: { site: "CNS/Brain", gene: "EGFR" } }]
    }
  },
  {
    title: "Endometrial cancer molecular subtypes by genetic ancestry (POLE, MMRd, p53abn, NSMP)",
    demonstrates: "A `molsubtype` view: the endometrial molecular classification (TCGA 2013 / ProMisE / WHO 2020) applied to each patient in its hierarchy — a POLE exonuclease-domain hotspot, else MSI-high (MSI_TYPE), else an OncoKB-driver TP53 mutation, else no specific molecular profile — with patients missing an input counted as not classifiable; subtype shares by ANCESTRY_LABEL (chi-squared) and overall survival by subtype (log-rank).",
    tags: ["endometrial", "classifier", "ancestry"],
    note: "2,373 endometrial cancers in MSK-IMPACT 50K; 196 have no MSI call. p53-abnormal tumours are 71% of classified patients of African ancestry against 34% of non-Ashkenazi European (as in Weigelt et al. on Black and White patients, PMID 37651310), and survival separates as published: POLE-ultramutated best, p53-abnormal worst (median 29.6 months).",
    doc: {
      study: "msk_impact_50k_2026",
      cohorts: { "Endometrial": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Endometrial Cancer"] }] } },
      views: [{ kind: "molsubtype", cohorts: ["Endometrial"], by: "ANCESTRY_LABEL" }]
    }
  },
  {
    title: "The endometrial classifier against TCGA's own molecular subtypes",
    demonstrates: "A `molsubtype` view on TCGA's uterine cohort, where the MSI call is the MSIsensor score (MSI_SENSOR_SCORE, ≥ 10 MSI-high, < 3 stable) and the subtypes are crossed with TCGA's published integrated subtypes (the SUBTYPE attribute) — a check of the panel-based classifier against the original.",
    tags: ["endometrial", "classifier", "tcga"],
    note: "Of TCGA's 49 POLE tumours 48 are called POLE-ultramutated, 122 of 126 MSI tumours MMR-deficient, 139 of 161 copy-number-high p53-abnormal, and 135 of 145 copy-number-low NSMP.",
    doc: {
      study: "ucec_tcga_pan_can_atlas_2018",
      cohorts: { "UCEC": { all: [] } },
      views: [{ kind: "molsubtype", cohorts: ["UCEC"], by: "SUBTYPE" }]
    }
  },
  {
    title: "Germline carriers in metastatic prostate cancer, and their tumours' second hits",
    demonstrates: "A `germline` view: per gene with at least two germline carriers (mutations the study marks GERMLINE), the carriers among patients sequenced for the gene, and the share whose tumour carries a somatic second hit in the same gene (another mutation or a deep deletion) against the somatic rate in non-carriers, Fisher per gene with Benjamini–Hochberg; overall survival of BRCA2 carriers against non-carriers.",
    tags: ["inherited", "second-hit", "prostate"],
    note: "SU2C/PCF metastatic castration-resistant prostate cancer (Abida et al. 2019), one of the few public studies that deposit germline calls. 17 of 429 patients (4.0%) carry a germline BRCA2 variant, 3 of them with a second somatic BRCA2 mutation against 7.3% of non-carriers; 2 of 6 BRCA1 carriers against 0.5% (q 0.005). Loss of heterozygosity is not assessed, so these are floors. Only 128 patients have OS recorded.",
    doc: {
      study: "prad_su2c_2019",
      cohorts: { "mCRPC": { all: [] } },
      views: [{ kind: "germline", cohorts: ["mCRPC"], minCarriers: 2, survival: { gene: "BRCA2" } }]
    }
  },
  {
    title: "splitBy: one cohort, auto-split into an arm per receptor subtype",
    demonstrates: "`splitBy` turns one named cohort into an arm per distinct value of a categorical attribute, live from the data, instead of hand-writing one cohort per value. The arms are scoped to this one view — they never touch the document's own cohort list — but still carry full provenance (each arm's own compiled count/SQL) in the result.",
    tags: ["splitBy", "cohort-structure"],
    note: "\"all patients\" split by RECEPTOR_STATUS_PRIMARY gives the same 4 clinically standard subtypes a hand-written 4-cohort document would (HR+/HER2-, Triple Negative, HR+/HER2+, HR-/HER2+), plus a few small ones this study also records (HR+/HER2_Unknown, Unk/ND, HR+/HER2_Equivocal) — all within the default 8-arm cap, so nothing here needs pooling into \"Other\". TP53 reads 26.8%/90.4%/49.2%/77% across the four main subtypes, matching the published literature on triple-negative breast cancer's markedly higher TP53 mutation rate.",
    doc: {
      study: "breast_msk_2018",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "compare", genes: ["TP53", "PIK3CA"], splitBy: { cohort: "all patients", attribute: "RECEPTOR_STATUS_PRIMARY" } }]
    }
  },
  {
    title: "splitBy: gene mutation status, without hand-writing the mutant/wildtype pair",
    demonstrates: "splitBy's second shape — `{cohort, gene}` — makes the same one-view, never-touches-the-document's-cohort-list arms as the attribute shape, but for a gene's mutation status: exactly two arms, no live query needed to know their names in advance (unlike an attribute's values, which must be discovered from the data).",
    tags: ["splitBy", "log-rank"],
    note: "\"all patients\" split by APC mutation status gives the same two arms a hand-written {\"kind\":\"oql\",\"q\":\"APC: MUT\"} cohort pair would (325 mutant, 146 wildtype) — APC-mutant patients have better overall survival (median 25.6mo vs 17.9mo, log-rank p=9.1e-5), matching this study's own headline finding (see the crc_apc_impact_2020 Cox example above) from a single view, no separate cohorts to define.",
    doc: {
      study: "crc_apc_impact_2020",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "survival", splitBy: { cohort: "all patients", gene: "APC" } }]
    }
  },
  {
    title: "splitBy: a list of OQL queries, arms that overlap and a disclosed \"Other\"",
    demonstrates: "splitBy's third shape — `{cohort, oql}` — reaches anything OQL can express, not just one gene's plain mutation status: each query becomes its own arm, named from the query text. Arms are not forced into a partition — a patient matching more than one query counts toward each — so the result discloses `overlapCount`; anyone matching none of the queries falls into an \"Other\" arm alongside the named ones.",
    tags: ["splitBy", "OQL"],
    note: "\"all patients\" split by [\"TP53: MUT\", \"KRAS: MUT\"] gives 13,105 TP53-mutant, 7,115 KRAS-mutant, and 9,019 in neither (\"Other\") — summing to more than the 24,950-patient base cohort because 4,289 patients carry both mutations, which the result discloses as `splitBy.overlapCount` rather than leaving the arm counts to look inconsistent on their own (13,105 + 7,115 − 4,289 + 9,019 = 24,950, exactly the base count).",
    doc: {
      study: "msk_chord_2024",
      cohorts: { "all patients": { all: [] } },
      views: [{ kind: "compare", genes: ["TP53", "KRAS"], splitBy: { cohort: "all patients", oql: ["TP53: MUT", "KRAS: MUT"] } }]
    }
  },
  {
    title: "Survival split three ways: the k-group log-rank",
    demonstrates: "3+ cohorts in a survival view now get a real test — the k-group log-rank generalization (a (k-1)-df chi-squared from the full covariance matrix, the same statistic R's survdiff() reports) — instead of only a picture with no way to say whether the split is real.",
    tags: ["log-rank", "k-group"],
    note: "MSI status in three groups (stable / instable / indeterminate) instead of the usual two-arm split. The test asks whether the three curves differ AT ALL, not which pair does — a different question from running the 2-arm test three times pairwise, which would need its own multiple-testing correction.",
    doc: {
      study: "crc_apc_impact_2020",
      cohorts: {
        "stable": { all: [{ kind: "clinical", attribute: "MSI_TYPE", values: ["Stable"] }] },
        "instable": { all: [{ kind: "clinical", attribute: "MSI_TYPE", values: ["Instable"] }] },
        "indeterminate": { all: [{ kind: "clinical", attribute: "MSI_TYPE", values: ["Indeterminate", "Do not report"] }] }
      },
      views: [{ kind: "survival", cohorts: ["stable", "instable", "indeterminate"] }]
    }
  },
  {
    title: "A missing alteration type is disclosed, never a false negative",
    demonstrates: "sarcoma_msk_2022 has no copy-number data at all (0 of 7,494 samples). MDM2 amplification is well-differentiated liposarcoma's defining alteration, so a naive tool would report 0% altered here and look confidently wrong. This one instead says so.",
    tags: ["panel-aware", "data-quality"],
    note: "TP53 (a real mutation hotspot here) and MDM2 (never assayed for copy-number in this study) side by side. Both show 0%-or-real altered figures, but only the view's note — and each cell's per-type breakdown (mutation/CNA/structural-variant counts, visible on hover in the app) — reveals that MDM2's 0% means \"never checked\" while TP53's is a real, profiled result.",
    doc: {
      study: "sarcoma_msk_2022",
      cohorts: {
        "Well-diff liposarcoma": { all: [{ kind: "clinical", attribute: "CANCER_TYPE_DETAILED", values: ["Well-Differentiated Liposarcoma"] }] }
      },
      views: [{ kind: "compare", cohorts: ["Well-diff liposarcoma"], genes: ["MDM2", "TP53"] }]
    }
  },
  {
    title: "Four receptor subtypes, one real test: Welch's ANOVA",
    demonstrates: "A numeric attribute compared across 3+ cohorts now gets a real test (Welch's ANOVA, plus Kruskal-Wallis alongside it since this stays within one study) instead of being skipped outright — the same k-group treatment this DSL's categorical and survival tests already got.",
    tags: ["anova", "kruskal-wallis", "k-group"],
    note: "Breast cancer's four receptor subtypes, compared on genomic instability (FRACTION_GENOME_ALTERED) and mutation burden (TMB_NONSYNONYMOUS). Triple-negative's markedly higher genomic instability is exactly the known biology, and both the parametric (ANOVA) and rank-based (Kruskal-Wallis) tests agree emphatically; TMB does not differ significantly by subtype here, and again both tests agree.",
    doc: {
      study: "breast_msk_2018",
      cohorts: {
        "HR+/HER2-": { all: [{ kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["HR+/HER2-"] }] },
        "TNBC": { all: [{ kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["Triple Negative"] }] },
        "HR+/HER2+": { all: [{ kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["HR+/HER2+"] }] },
        "HR-/HER2+": { all: [{ kind: "clinical", attribute: "RECEPTOR_STATUS_PRIMARY", values: ["HR-/HER2+"] }] }
      },
      views: [{ kind: "clinical", cohorts: ["HR+/HER2-", "TNBC", "HR+/HER2+", "HR-/HER2+"], attributes: ["TMB_NONSYNONYMOUS", "FRACTION_GENOME_ALTERED"] }]
    }
  },
  {
    title: "A non-standard survival endpoint, named directly",
    demonstrates: "ucec_msk_2018 declares no <X>_MONTHS/<X>_STATUS pair at all — its outcome lives in PFS_MONTHS_FIRST_LINE_TX/PROGRESSION_STATUS instead, so the usual endpoint prefix shorthand finds nothing. monthsAttribute/statusAttribute name the real columns directly.",
    tags: ["endpoint", "data-quality"],
    note: "MSI-H vs MSS endometrial cancer, progression-free survival from first-line treatment — the study's actual recorded outcome, reachable only because the exact column names are given rather than assumed from an OS/PFS/DFS-style prefix.",
    doc: {
      study: "ucec_msk_2018",
      cohorts: {
        "MSI-H": { all: [{ kind: "clinical", attribute: "MSI_STATUS", values: ["MSI-H"] }] },
        "MSS": { all: [{ kind: "clinical", attribute: "MSI_STATUS", values: ["MSS"] }] }
      },
      views: [{ kind: "survival", cohorts: ["MSI-H", "MSS"], endpoint: "PFS_1L", monthsAttribute: "PFS_MONTHS_FIRST_LINE_TX", statusAttribute: "PROGRESSION_STATUS" }]
    }
  },
  {
    title: "Top 20% TMB, within one cancer type: a percentile cutoff",
    demonstrates: "Reproducing Samstein et al.'s TMB-and-immunotherapy finding needed \"the top 20% of TMB, specifically among NSCLC patients\" — a cancer-type-specific percentile, not a hardcoded number. percentileOf scopes the live-resolved threshold to another cohort in this document instead of the whole (pan-cancer) study.",
    tags: ["percentile", "cutoff"],
    note: "tmb_mskcc_2018 is pan-cancer, so a plain percentile would mix histologies with very different baseline TMB. \"NSCLC high-TMB\"/\"NSCLC low-TMB\" both restrict to NSCLC first, then split on whether TMB is at or above the 80th percentile COMPUTED WITHIN THAT NSCLC POPULATION (percentileOf:\"NSCLC\") — the readback shows the resolved number and what it was a percentile of, not just a bare threshold.",
    doc: {
      study: "tmb_mskcc_2018",
      cohorts: {
        "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] }] },
        "NSCLC high-TMB": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
          { kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: ">=", percentile: 0.8, percentileOf: "NSCLC" }
        ] },
        "NSCLC low-TMB": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"] },
          { kind: "clinical", attribute: "TMB_NONSYNONYMOUS", op: "<", percentile: 0.8, percentileOf: "NSCLC" }
        ] }
      },
      views: [{ kind: "survival", cohorts: ["NSCLC high-TMB", "NSCLC low-TMB"] }]
    }
  },
  {
    title: "Custom data: a curated biopsy site on every sample",
    demonstrates: "An uploaded, sample-level annotation (`custom:luad-biopsy-site/BIOPSY_SITE`) used like the study's own attributes: as a cohort filter, an oncoprint track that orders the columns, a plot axis, and a `splitBy` that compares gene frequencies across sites. The rows are demo data bundled with the app, so this example runs without logging in; a real upload is stored on the server.",
    tags: ["splitBy"],
    note: "luad_mskimpact_2021 is 93 EGFR-mutant lung adenocarcinomas with 186 primary and metastatic samples. The demo upload gives every sample a BIOPSY_SITE, grouped from the study's own SAMPLE_TYPE and free-text METASTATIC_SITE the way a reviewer would (scripts/gen-custom-demo.ts), standing in for a clinician-curated annotation. \"CNS met\" filters on it: 8 patients. Ordered by site, the oncoprint puts each patient's primary and metastases in their own groups. Fraction of the genome altered has a median of 0.47 in the 11 CNS samples and 0.36 in liver, against 0.21 in the 76 primaries. Split by site, TP53 is altered in 7 of 8 CNS-met patients (87.5%) against 65.6% of the patients with a primary sample. The split arms overlap, because a patient whose primary and metastasis were both sequenced belongs to both arms. With 8 to 61 patients per arm, these are illustrations, not findings.",
    customData: [LUAD_BIOPSY_SITE_DEMO],
    doc: {
      study: "luad_mskimpact_2021",
      cohorts: {
        "all patients": { all: [] },
        "CNS met": { all: [{ kind: "clinical", attribute: "custom:luad-biopsy-site/BIOPSY_SITE", values: ["CNS met"] }] }
      },
      views: [
        { kind: "oncoprint", unit: "sample", cohorts: ["all patients"], genes: ["EGFR", "KRAS", "TP53", "STK11", "KEAP1", "SMARCA4"],
          clinical: ["custom:luad-biopsy-site/BIOPSY_SITE", "SAMPLE_TYPE"], sort: ["custom:luad-biopsy-site/BIOPSY_SITE"] },
        { kind: "plot", unit: "sample", cohorts: ["all patients"],
          x: { source: "clinical", attribute: "custom:luad-biopsy-site/BIOPSY_SITE" },
          y: { source: "clinical", attribute: "FRACTION_GENOME_ALTERED" } },
        { kind: "compare", genes: ["EGFR", "KRAS", "TP53", "STK11", "KEAP1", "SMARCA4"],
          splitBy: { cohort: "all patients", attribute: "custom:luad-biopsy-site/BIOPSY_SITE" } }
      ]
    }
  },
  {
    title: "Custom data: single-cell features of ovarian tumours (MSK SPECTRUM)",
    demonstrates: "Features summarised from a study's single-cell RNA-seq, uploaded as six custom datasets (five patient-level, one sample-level) and read beside its genomics: oncoprint tracks, box plots against the mutational signature, a scatter between two cell compartments, and a sample-level plot by tumour site. The rows are demo data bundled with the app, so this example runs without logging in.",
    tags: ["single-cell"],
    note: "msk_spectrum_tme_2022 is 42 untreated high-grade serous ovarian cancers; 41 had scRNA-seq at several anatomical sites. scripts/gen-spectrum-sc-demo.py reads the public CELLxGENE cell annotations (cell states, per-cell pathway scores, per-cell 6p allele fraction) and summarises them per patient (solid sites pooled; ADX_ adnexal, NADX_ non-adnexal) and per cBioPortal sample (the scRNA-seq site of the same patient, 61 of 82 samples). Dysfunctional T/NK cells (TNK_DYSFUNC) have a median of 10.8% of T/NK cells in the 16 HRD-Dup tumours against 6.0% in the 14 FBI tumours, and naive/central-memory cells the reverse (7.5% against 11.1%), as in the paper's Fig. 4b. In adnexal cancer cells, JAK-STAT pathway activity has a median of 0.03 in HRD-Dup against -0.57 in FBI (Fig. 3e), and cancer-cell and T/NK-cell JAK-STAT correlate across patients (Spearman 0.74, Fig. 4e). Clonal 6p loss of heterozygosity (over 80% of cancer cells) is called in 4 patients, 3 of them HRD-Dup — the paper reports 4 of 41. By site, T cells are a median 43% of immune cells in the 22 adnexal samples against 54% in the 18 omental ones. These are summaries of public cell metadata, not the paper's statistical models.",
    customData: SPECTRUM_SC_DEMO,
    doc: {
      study: "msk_spectrum_tme_2022",
      cohorts: { "all patients": { all: [] } },
      views: [
        { kind: "oncoprint", cohorts: ["all patients"], genes: ["TP53", "BRCA1", "BRCA2", "CCNE1", "MYC", "CDK12"],
          clinical: ["CONSENSUS_SIGNATURE", "custom:spectrum-sc-cancer/CA_6P_STATUS", "custom:spectrum-sc-tnk/TNK_DYSFUNC", "custom:spectrum-sc-tnk/TNK_NAIVE_CM"],
          sort: ["CONSENSUS_SIGNATURE"] },
        { kind: "plot", unit: "patient", cohorts: ["all patients"],
          x: { source: "clinical", attribute: "CONSENSUS_SIGNATURE" },
          y: { source: "clinical", attribute: "custom:spectrum-sc-tnk/TNK_DYSFUNC" } },
        { kind: "plot", unit: "patient", cohorts: ["all patients"],
          x: { source: "clinical", attribute: "CONSENSUS_SIGNATURE" },
          y: { source: "clinical", attribute: "custom:spectrum-sc-tnk/TNK_NAIVE_CM" } },
        { kind: "plot", unit: "patient", cohorts: ["all patients"],
          x: { source: "clinical", attribute: "CONSENSUS_SIGNATURE" },
          y: { source: "clinical", attribute: "custom:spectrum-sc-cancer/ADX_CA_JAKSTAT" } },
        { kind: "plot", unit: "patient", cohorts: ["all patients"],
          x: { source: "clinical", attribute: "custom:spectrum-sc-cancer/CA_JAKSTAT" },
          y: { source: "clinical", attribute: "custom:spectrum-sc-tnk/TNK_JAKSTAT" } },
        { kind: "plot", unit: "sample", cohorts: ["all patients"],
          x: { source: "clinical", attribute: "TUMOR_SUPERSITE" },
          y: { source: "clinical", attribute: "custom:spectrum-sc-site/IMM_T" } }
      ]
    }
  }
];

export const EXAMPLES: DslExample[] = [...GUIDE_EXAMPLES, ...Object.values(KIND_DOCS).flatMap((d) => d.examples ?? [])];

/** the Views table's rows, one per kind */
const viewsTable = (): string =>
  Object.entries(KIND_DOCS).map(([kind, d]) => "| `" + kind + "` | " + d.reference + " |").join("\n");

/** the agent grammar's "views" list, then what kinds say after it */
const VIEWS_INDENT = " ".repeat(13);
function viewsGrammar(): string {
  const entries = Object.values(KIND_DOCS).map((d, i, all) => {
    const lines = d.grammar.split("\n").map((l) => VIEWS_INDENT + l);
    let last = lines.length - 1;
    while (lines[last].trimStart().startsWith("//")) last--;
    lines[last] += i === all.length - 1 ? " ] }" : ",";
    return lines.join("\n");
  });
  const notes = Object.values(KIND_DOCS).flatMap((d) => d.grammarNotes ? [d.grammarNotes] : []);
  return '  "views": [ ' + entries.join("\n").slice(VIEWS_INDENT.length) + (notes.length ? "\n\n" + notes.join("\n\n") : "");
}

const exampleBlock = (ex: { title: string; note: string; doc: unknown; customData?: CustomDataset[] }, i: number) =>
  `### Example ${i + 1}: ${ex.title}\n\n${ex.note}\n\n` +
  (ex.customData?.length ? "Runs on custom data: " + ex.customData.map((d) => "`" + d.id + "` (" + d.name + ", " + d.rows.length +
    " " + d.level + "s, columns " + d.columns.map((c) => c.name).join(", ") + ")").join("; ") +
    ", sent with the request as `customData`; without it the document is refused.\n\n" : "") +
  `\`\`\`json\n${JSON.stringify(ex.doc, null, 2)}\n\`\`\`\n`;

// ---- the full reference (docs/dsl.md + MCP describe_dsl) -------------------
export function renderDslMarkdown(): string {
  return `<!-- GENERATED FILE — do not edit. Source: lib/dsl-reference.ts; regenerate with \`npm run docs:gen\`. -->

# cbio-lab DSL (v${DSL_VERSION})

One declarative JSON object — the **Analysis document** — describes everything cbio-lab does:
which patients form each cohort, and which views compare them. The server compiles it to
ClickHouse SQL (\`lib/cohort2.ts\`, \`lib/oql.ts\`, \`lib/compiler.ts\`, \`lib/analysis.ts\`);
clients never send SQL. Every result carries provenance: the definition readback and the exact
SQL each cohort compiled to.

## Analysis document

\`\`\`
{ "dsl":     "${DOC_VERSION}",                         // the document's version; see "Versions" below
  "study":   "<default study id>",            // validated against cancer_study
  "cohorts": { "<name>": cohortDef, ... },    // max 16 — the store every view's "cohorts" names from
  "views":   [ view, ... ],                   // max 6; each lists its own "cohorts": ["<name>", ...]
  "uploads"?: [ { "as": "<name>", "dataset": "<id>", "version": n } ] }  // server-stored custom data, pinned
\`\`\`

\`uploads\` pins server-stored custom data: every \`custom:<as>/<COLUMN>\` attribute in the document reads that
dataset at that version, which never changes, so whoever may read it gets the same rows. The web app adds the pin
the first time an analysis uses a server dataset. A \`custom:\` name with no pin is a local upload, sent by the
browser that holds it.

Sent to \`POST /api/analysis\`, edited by the researcher's assistant through the page's WebMCP tools, and encoded in shareable
\`/analysis?doc=<base64url>\` links: the base64url of the document's UTF-8 JSON opens as it is, and the app writes it
deflated (\`1.<base64url>\`, \`lib/url-json.ts\`) to keep links short.

## Cohort definitions

\`\`\`
cohortDef := { "all": [clause × 0-8],         // ANDed (intersection of samples); [] means every sample in the study
               "extends"?: "<cohort name>",   // splice that cohort's own "all" in AHEAD of this one's, resolved before anything is compiled
               "study"?:   "<id>",            // evaluate in another study
               "studies"?: ["<id>", ...],     // union across studies (federated, no count limit)
               "lineGap"?: 90,                // derived-treatment-line gap, days
               "notes"?:   "<prose>",         // the analyst's own note on this cohort; never compiled
               "from"?:    { "saved": "<id>", "name": "<name>", "hash": "<sha256>", "savedAt"?: "<when>" },  // set by the page: the saved cohort this was copied from, and the hash of what was copied; never compiled
               "splits"?:  { "<name>": splitDef },  // divisions of this cohort into arms that add up to it
               "lock"?:    { "set": "<id set>", "n": N, "nPatients": N, "at": "<ISO time>", "dataVersion"?: "…", "oncokbPin"?: "…",
                             "children"?: { "<split> / <arm>": { "set", "part": "arm:<split> / <arm>", "n", "nPatients" } } } }
                                              // frozen to the samples it selected at "at" — see "Locked cohorts" below
splitDef  := { "arms": [ { "name": "<label>", "where": clause, "splits"?: {…} } × 1-8 ],  // tested in order; first match wins; an arm may be split again
               "other"?: "<label>",            // the remainder's name, default "Other"
               "otherSplits"?: {…},            // splits of the remainder
               "notes"?: "<prose>" }
clause    := leaf | { "any": [leaf × 1-8] }   // OR (UNION DISTINCT)
                  | { "not": leaf | { "any": [leaf × 1-8] } }  // the study's samples EXCEPT leaf, or EXCEPT the OR of several (De Morgan's, in one clause instead of one "not" per leaf)
\`\`\`

**A cohort is a set of samples, as on cBioPortal.** Every clause selects samples. A sample-level
clause — a sample attribute, an OQL alteration (called in the sample that carries it), a sample
list, \`profiled\`, \`genomicData\`, \`proteinPosition\`, \`caseList\` — selects the samples that
match it; a patient-level clause — a patient attribute, a timeline \`event\`, \`derived\`, a patient
list, the held-out \`split\` — selects every sample of the patients that match. \`all\`, \`any\` and
\`not\` are intersection, union and complement over the study's samples. A cohort's patients are
the owners of its samples: views drawn per patient (survival, timelines, Cox) use them, and views
drawn per sample — and every gene frequency — use only the cohort's own samples, so a patient's
other samples never count. "Non-small cell lung cancer" is the NSCLC samples, not every sample of
patients who have one.

**Cross-study semantics.** A cohort with \`studies\` is compiled per study (compilers are
single-study by design); members are study-qualified patient ids. Patient overlap across studies
is deliberately **not** deduplicated, and clinical vocabularies are **not** harmonized — views
say so in their captions.

**\`extends\`.** A cohort naming another cohort in \`extends\` inherits that cohort's \`all\`
clauses, spliced in ahead of its own — so a family of nested cohorts (e.g. "APC-mutated", then
"APC-mutated AND liver mets") can share one definition instead of two copies of the same clause
drifting apart when one gets edited. Only \`all\` is inherited — \`study\`/\`studies\`/\`lineGap\`/
\`notes\` are always the child's own. Resolved (and a cycle, direct or through a chain, rejected by
name) before compilation, so every downstream reader — compiled SQL, the plain-language readback,
provenance — sees the fully flattened \`all\` list, exactly as if it had been written out by hand.

**Splits.** A cohort's \`"splits": {"<name>": splitDef}\` divide it into child cohorts that
are **disjoint and together exactly the parent** — the grouping a comparison needs, rather than a
set of filters that may overlap or quietly lose patients. Arms are tested in order and the first
match wins, so a patient matching two arms is in the earlier one, and reordering arms changes who
goes where. Before testing an arm, the engine requires every condition needed to decide the earlier
arms to be knowable: an \`oql\` arm needs the patient profiled for that gene and alteration type
(the panel-aware rule — a patient whose panel omits the gene is not wild-type for it; a bare-gene
query needs mutation, copy-number and structural-variant profiling), a \`clinical\` arm needs a
recorded value. Patients failing that go to a child named \`"Not profiled: <GENE> <type>"\` or
\`"No <ATTRIBUTE> recorded"\`; patients matching no arm go to \`"Other"\` (or the \`other\` name).

Each child is an ordinary cohort named \`"<cohort> / <split> / <arm>"\` (an arm split again: \`"NSCLC /
KRAS allele / G12C / sex / Female"\`), usable anywhere a cohort name is, with its own readback and
SQL; a split itself is addressed as \`"<cohort> / <split>"\`. **Each view chooses what it draws**:
in a view's \`cohorts\`, a cohort's name is that whole cohort, split or not; a split's name is its arms
and remainder (not its not-evaluable children, which the split discloses); an arm's name is that arm,
whole, even if it is split further. So one view can show NSCLC while another shows "NSCLC / KRAS
allele". A view draws **either whole cohorts or the groups of one split, never a mix and never two
splits** — two splits of one cohort count every patient twice, groups of two splits are two
comparisons in one, and a whole cohort beside a split's groups can share their patients — and a view
naming such a list is refused, naming what clashes. A view with no \`cohorts\` shows the authored
cohorts, whole. A cohort may have several splits; each view picks at most one. The result's
\`splits\` gives every child's count and checks the sum against the parent's (\`conserved\`).
Conditions the engine cannot check evaluability for (expression, assay values, timeline events,
derived metrics) are listed in \`unchecked\`: their patients with no data count as not matching.
Up to 16 authored cohorts and 48 cohorts in all, children included. Expanded before \`extends\`, so
each child \`extends\` its parent and runs in the parent's studies. (Not to be confused with the
\`{"kind":"split"}\` leaf below, which selects the engine's fixed discovery or validation half.)

**Versions.** A document carries \`"dsl": "${DOC_VERSION}"\`. One written for an older version is
upgraded when it is read — the result's \`upgraded\` says from which version and what changed
(2.2 → 2.3 moved top-level \`partitions\` onto the cohorts they split as \`splits\`, and renamed
their children from \`"<partition> / <arm>"\` to \`"<cohort> / <partition> / <arm>"\`, views
included; 2.3 → 2.4 ended "a split replaces what it splits" — a view that drew a split cohort's arms
under 2.3 is given those arms by name, so it draws the same thing; 2.4 → 2.5 ended "a view with no
\`cohorts\` draws every cohort" — such a view is given every authored cohort by name; 2.5 → 2.6 renamed
the oncoprint's study track "Study of origin"; 2.6 → 2.7 let a list clause name a stored id set, and
2.7 → 2.8 let a cohort be locked; neither changes anything an older document says) — and saving it writes the new
version. One with no \`dsl\` is read the same way, so
leaving it out is harmless. One written for a NEWER version than the server reads is refused,
rather than silently ignoring what it does not understand.

### Leaf kinds

| kind | shape | meaning |
|---|---|---|
| \`oql\` | \`{"kind":"oql","q":"STK11: DRIVER"}\` | genomic status in cBioPortal OQL (see below) |
| \`clinical\` | \`{"kind":"clinical","attribute":A, ...predicate}\` | clinical attribute, matched at the level the study records it: a sample attribute selects the samples whose value matches, a patient attribute every sample of the patients whose value matches — so one clause over two studies, one recording the attribute per sample and the other per patient, matches each its own way, as cBioPortal does; predicate is \`values:[≤50]\` (OR), \`range:{gt,gte,lt,lte}\` (numeric via toFloat64OrNull), or \`op\`(\`= != > >= < <=\`)+\`value\`. A \`per\` key is refused. \`op\`+\`percentile\` (0-1) resolves \`value\` LIVE from a percentile of the attribute's distribution instead of a literal number — e.g. \`{"op":">=","percentile":0.8}\` = "at or above the 80th percentile" ("top 20%"). \`percentileOf\`:"\<cohort name\>" scopes the reference population to another cohort in this document (e.g. "top 20% TMB **within NSCLC**", not the whole study); both the leaf's own cohort and, if given, \`percentileOf\`'s cohort must resolve to a single study, and \`percentileOf\` may not itself use \`percentile\` (no chaining). Resolved once, live, before compilation — the readback shows the resolved number and what it was a percentile of. **Custom data:** an attribute the reader uploaded is named \`custom:<dataset>/<COLUMN>\` (e.g. \`custom:brain-mets/MET_SITE\`) and works here and in every view exactly like the study's own — oncoprint \`clinical\` tracks, \`splitBy.attribute\`, \`clinical\` views, plot axes. Uploads are stored on the server, readable once logged in, and pinned by version in the document's \`uploads\`; a document naming a dataset the request cannot read is refused, never answered as if no patient had a value. Patient-level studies only |
| \`derived\` | \`{"kind":"derived","metric":"followupMonths"|"historyMonths"|"alteredGenes"|"lines"|"treatmentSpan","range":{gte?,gt?,lte?,lt?},"eventType"?,"lineGap"?:90,"lineClasses"?}\` | filters on a value computed from the **shape** of the data rather than a study's vocabulary. Event-type names and attribute keys are study-specific \u2014 this database spells one concept \`Treatment\` in 87 studies and \`TREATMENT\` in 10, and the key MSK-CHORD calls \`SUBTYPE\` exists in only 27 of 131 timeline studies \u2014 so these read dates and gene symbols instead and mean the same thing everywhere. \`followupMonths\`: how far the timeline runs past its own day 0. \`historyMonths\`: how much predates it. \`alteredGenes\`: distinct genes altered (panel size bounds it, so not comparable across studies with different panels). \`lines\` and \`treatmentSpan\` are the deliberate exception \u2014 they need \`eventType\` (which timeline event stands for "a therapy" here; Explore proposes one from the study's own catalog), because there is no vocabulary-free way to ask "how many lines of treatment". \`lines\`: the number of treatment lines, by the one line definition the \`sequence\` view and "Treatment line (derived)" share (systemic-therapy records of that event type, a \`lineGap\`-day gap; \`lineClasses\` \`"all"\` or a class list widens it). \`treatmentSpan\`: months from the first to the last record of that event type |
| \`event\` | \`{"kind":"event","a":sel,"b"?:sel,"rel":rel,"priorGuard"?:bool,"lineGap"?:90}\` | timeline sub-DSL (below) |
| \`sampleList\` | \`{"kind":"sampleList","ids":["<study>:<id>", ...]}\` or \`{"kind":"sampleList","set":"<id set>"}\` | explicit, cross-study list of sample ids: inline in \`ids\` (up to about 200 KB of ids per study, roughly 10,000 — refused by name past that), or a **stored id set** named by \`set\`, of any size up to 250,000 (see below) |
| \`patientList\` | \`{"kind":"patientList","ids":["<study>:<id>", ...]}\` or \`{"kind":"patientList","set":"<id set>"}\` | explicit, cross-study list of patient ids, same two forms and limits |
| \`profiled\` | \`{"kind":"profiled","type":"MUTATION"\\|"CNA"\\|"SV", "gene"?:"KRAS" \\| "genes"?:["KRAS","NRAS"]}\` | patient has a sample on a gene panel for that data type — with \`gene\`, a panel covering that gene (or whole-exome); with \`genes\` (≤32), covering every one of them, the same as one \`gene\` clause per gene in a single clause. Combine with \`not\` to separate wild-type from not-profiled: \`not\` alone keeps patients never tested for the gene |
| \`caseList\` | \`{"kind":"caseList","id":"sequenced"}\` | portal sample list; bare ids get the study prefix |
| \`genomicData\` | \`{"kind":"genomicData","gene":G,"profileType":P,"range"\\|"values"}\` | continuous per-gene values (cna, mrna z-scores, …); unknown profiles error listing what the study has |
| \`genericAssay\` | \`{"kind":"genericAssay","profileType":P,"entity":E,"range"\\|"values"\\|"measured":true}\` | generic assay values (mutational signatures, …); \`measured\`: any value at all, which a split on an entity uses to give unmeasured patients their own child |
| \`proteinPosition\` | \`{"kind":"proteinPosition","gene":G,"range":{gt,gte,lt,lte}}\` | patient carries a mutation in \`gene\` whose protein position (the stored proteinPosStart, same column the lollipop draws from) falls in \`range\` — for an N-/C-terminal split when a study doesn't deposit one as a clinical attribute. Position-only: AND with an \`oql\` leaf (e.g. \`{"kind":"oql","q":"APC: TRUNC"}\`) to also restrict by mutation type — the two can then be met by different mutations; an OQL position range (\`APC: TRUNC_(1400-)\`) requires both of one mutation |
| \`split\` | \`{"kind":"split","part":"discovery"\|"validation"}\` | one fixed half of the study's patients, decided inside the database by a salted hash of the patient id — the same half for every caller, reproducible, and never passed through the client as an id list. It exists for **held-out replication**: test on \`discovery\`, confirm the same document on \`validation\`. A hypothesis campaign (\`/campaign\`, MCP \`campaign_*\`) adds it itself and refuses documents that already carry one, so a generator cannot choose its own half |
| \`upload\` | \`{"kind":"upload","dataset":"custom:<name>"}\` | the patients with a row in an upload: a value in any of its columns, patient- or sample-level (a blank cell is not a value). \`dataset\` names the upload as its attributes do, and the document's \`uploads\` pins it like any of them; a document naming an upload the request cannot read is refused |
| \`alteration\` | *(deprecated)* | translated to OQL internally; do not write new ones |

**\`sampleList\`/\`patientList\` ids.** Each id is \`"<study>:<bare-id>"\` — a colon, not the
database's internal underscore, because a bare id may itself contain one (this is also the
legacy portal's own study-qualified id convention). A single list can span every study named in
the cohort's \`studies\`: it compiles once per study (the same fan-out \`studies\` already does for
every other clause) and an id meant for a different study is simply inert in that pass, not an
error — so the list itself never needs to be split up by study. These two leaves are the one
kind of clause that can **never** leave for a remote or aggregate-only participant: an id-carrying
cohort is refused before any request is made, the same guarantee \`docs/DATA-BOUNDARY.md\`
describes for every other identifier-bearing path.

**Locked cohorts.** A cohort can be frozen to the patients its definition selects at one moment,
so an analysis stops drifting as samples are added to the data: \`lock\` names the stored id set
holding those samples (\`n\` of them, from \`nPatients\` patients), when it was taken, the data
version and OncoKB release then, and, under \`children\`, each split arm by name. The lock is ONE
sample-level set: beside the samples it keeps, as named parts, each arm's samples (\`part\`:
\`"arm:<split> / <arm>"\`). The engine
evaluates the set, not the definition; the definition stays as the record of how the cohort was
made, and is still run beside the set, so the result's \`cohorts[name].lock\` says how far the
data has moved, in samples: what the definition selects \`now\`, which samples it would add
(\`entered\` — a new sample it selects is one of these) or drop (\`left\`), and how many frozen
samples the data still holds (\`present\` of \`n\`). A split arm added after the lock is evaluated
inside the frozen cohort, so arms still add up to it. The document's \`locked\` says every cohort
was locked at once, one moment for all. Locks are taken by \`POST /api/lock\` (\`{doc, cohorts?}\`,
every cohort when none are named) or the page — a cohort's menu, or "Lock all cohorts" — and need a
sign-in, since the sets are the reader's. Unlocking is removing \`lock\`. Values recorded about
the frozen patients (a re-called mutation, an edited clinical field) are read as they are now.

**Stored id sets.** A long list is saved once on the server — \`POST /api/id-sets\` with
\`{name, level:"sample"|"patient", studies, ids}\`, or "+ Add cohort" → "From a list of ids" — and
named by its id: \`{"kind":"sampleList","set":"<id>"}\`. The ids are matched to the studies' own
samples or patients when the set is saved (the answer says how many matched nothing); a set's
members never change, so a document naming one always means the same cases, and a different list
is a new set. The set travels to ClickHouse as an external table beside each statement that reads
it, never as SQL text, so its size does not touch the 256 KB statement limit an inline list
meets, and the document, its \`?doc=\` link and every request carry only the id. \`label\` and \`n\`
beside \`set\` are its name and size as the page wrote them, shown on the cohort's pill and never
compiled. A set is its saver's and shared as saved cohorts are; reading one needs a signed-in request
through the web app, so a document naming a set is refused, saying why, over MCP or without a
sign-in — those carry their ids inline. Like an inline list, it never reaches a remote or
aggregate-only participant. The web app stores every list it makes as a set when its reader is
signed in (a cohort picked on an oncoprint, donors from Cell Explorer, a pasted list), and every
inline list still in a cohort or an analysis when it is saved, so what is saved names sets.

### OQL subset

\`q\` is 1–30 entries separated by \`;\`, each \`GENE\` (any alteration) or \`GENE: spec spec ...\`.
A patient matches if **any** entry matches (portal "altered in query" semantics).

- Mutations: \`MUT\`, \`MUT=<protein change>\` (e.g. \`MUT=G12C\`), classes \`MISSENSE NONSENSE FRAMESHIFT NONSTART NONSTOP INFRAME SPLICE PROMOTER TRUNC\`; bare \`G12C\` is protein-change shorthand. Classes are cBioPortal's, case for case: each stored mutation type maps to one class exactly as the portal's OQL maps it (e.g. \`Splice_Region\` is SPLICE, \`Translation_Start_Site\` NONSTART; a protein change of \`Promoter\` is PROMOTER whatever its type; an unlisted type such as \`5'Flank\` or \`Silent\` is in no class). **\`TRUNC\` is the portal's: every mutation that is not missense or in-frame** — nonsense, frameshift, nonstop, splice, start-loss, promoter and unclassified types alike — not just nonsense and frameshift.
- Copy number: \`AMP\`, \`HOMDEL\`, \`CNA\` (either, high-level ±2 only).
- Structural variants: \`FUSION\`.
- Drivers: \`DRIVER\` alone (any driver alteration) or as modifier (\`MUT_DRIVER\`, \`DRIVER_G12D\`, \`TRUNC_DRIVER\`). Requires the version-pinned OncoKB annotation store; the pin is reported in every result.
- Protein position range, on a mutation (cBioPortal's \`(a-b)\` modifier): \`TRUNC_(1400-)\`, \`MUT_(-500)\`, \`MUT_(12-13)\`, \`MUT=(712-979)_DRIVER\`, or a range alone (\`(1400-)\`, any mutation there). By default a mutation matches when its protein range (start-end) **overlaps** the range; with \`*\` (\`(1-100*)\`) it must lie entirely inside it. A mutation with no usable position (missing, -1, or start after end) never matches, as in the portal. The range and the class are tested on the **same** mutation, so \`APC: TRUNC_(1400-)\` is a truncation at or after codon 1400 — unlike ANDing an \`APC: TRUNC\` leaf with a \`proteinPosition\` leaf, which can be satisfied by two different mutations. On anything but a mutation (\`AMP_(1-100)\`) it is refused.
- Expression: \`EXP>z EXP<z PROT>z\` — only in studies with mRNA/protein profiles (errors otherwise, listing available profiles).
- **Rejected loudly** (never silently approximated): \`GAIN HETLOSS GERMLINE SOMATIC\`.
- **Uncalled mutations are not alterations**, as on the portal: a variant called in one of a patient's
  samples and looked up in the others, where reads support it below the caller's thresholds
  (\`mutation_status\` UNCALLED), matches no OQL, oncoprint cell or plot axis.

### Event sub-DSL (timeline)

The v1 language, embedded as an \`event\` leaf (the flat v1 shape \`{a,b,rel,...}\` is also accepted
anywhere a cohortDef is expected, for back-compat).

\`\`\`
selector := { "eventType": "Treatment" | "Diagnosis" | "Lab_Test" | ...        // per-study catalog
                        | "Treatment line (derived)",                          // synthetic type
              "attrs"?: [{ "key": K, "value": V } × ≤3],                       // event attributes
              "occurrence"?: "ANY" | "FIRST" | "LAST",                         // pin per patient
              "numeric"?: { "key": K, "op": ">"|">="|"<"|"<="|"=", "value": N },
              "minDurationDays"?: N }
rel      := { "type": "NONE" }                                                 // A exists
           | { "type": "BEFORE", "minDays"?: 0, "maxDays": N }                 // A then B within window
           | { "type": "DURING" }                                              // B inside A's start..stop
           | { "type": "NOT_FOLLOWED_BY", "withinDays": N, "observed"?: true } // absence of B after A
\`\`\`

- **Exists-pair semantics**: a patient qualifies if at least one (A,B) occurrence pair satisfies
  the relation; results are distinct patients.
- **Absence queries**: always set \`"observed": true\` on NOT_FOLLOWED_BY, restricting to patients
  whose follow-up actually covers the window — otherwise "no event" conflates with lost-to-follow-up.
- **\`priorGuard: true\`** restricts to treatment-naive patients (required for honest "first-line"
  claims; ~20% of MSK-CHORD patients had prior treatment elsewhere). Naive means a "No prior
  medications" record under \`PRIOR_MED_TO_MSK\`, which only MSK's own studies record; patients
  with no record are left out, and a study that records the flag for no one is refused.
- **"Treatment line (derived)"** is synthesized at query time and supports attrs \`LINE_NO\`,
  \`COMPOSITION\`, \`GAP\`. Lines have ONE definition, shared by this type, the \`lines\` derived
  metric and the \`sequence\` view: systemic-therapy \`Treatment\` records — the class is the event's
  SUBTYPE, or TREATMENT_TYPE where it has none, and must be a systemic class (chemotherapy,
  immunotherapy, targeted, hormone, biologic, investigational, "medical therapy" and their
  spellings; radiation, surgery, bone and ancillary treatment are not lines) — and a record starting
  more than \`lineGap\` days (default 90) after every earlier one has stopped begins a new line. A
  line's COMPOSITION is its sorted combination (\`Biologic + Chemo\`); the attr matches it ignoring
  case, order and spacing around \`+\`.
- **Names and values match ignoring case and surrounding whitespace** — event types, attribute
  keys and attribute values alike (\`Chemo\` = \`CHEMO\`), because studies spell the same thing
  differently. Nothing beyond case and whitespace is merged.
- **A clinical value spelled as missing is no value**: empty, \`NA\`, \`N/A\` and \`NaN\`, in any case,
  as cBioPortal's study view reads them. Such a value gets no facet bar and no group, matches
  neither \`= X\` nor \`!= X\`, and \`{not: …}\` keeps its sample, so \`{not: {kind:"clinical",
  attribute, op:"!=", value:""}}\` is the portal's NA filter. Other words (\`Unknown\`, \`None\`) are values.
- **A number recorded as a bound** (a de-identified age \`>90\`, a lab limit \`<0.5\`) is selected, as on
  cBioPortal, by a comparison open on its side: \`>90\` counts as just above 90 (and \`>=90\` as 90) for
  \`range:{gt|gte}\` or \`op:">"|">="\` with no upper end, \`<18\` likewise for an upper bound alone; a closed
  range or an equality reads plain numbers only.

## Views

\`compare\`, \`survival\`, \`cox\`, \`logistic\`, \`clinical\` and \`course\` (**genuinely multi-cohort
views — every named or synthetic cohort they're given is drawn**), and \`oncoprint\` (one column-
group per cohort; JSON only, no UI control for it yet) may carry \`splitBy\` instead of, or
alongside, their own \`cohorts\`: auto-split one named cohort into several arms, live from the
data, rather than hand-writing one cohort per arm. **Not offered** on \`hotspots\`,
\`cooccurrence\`, \`coexpression\` or \`plot\` (each draws exactly one cohort, always the first named
— documented behavior for the first three, an architectural property of the fourth, whose
grouping comes from its own x-axis/colorBy attribute, not from multiple cohorts) or on
\`sequence\` (draws at most 2, silently) — a facet split's whole value is drawing many arms at
once, which none of those five would actually show. The synthetic arms are **not** added to the
document's own cohort list (they don't count against the 16-cohort cap or appear in the Cohorts
tab — only in this one view's own result, with full provenance: each arm's own compiled SQL and
count), and this view alone draws them instead of whatever \`cohorts\` would otherwise resolve to.

Exactly one of three mutually exclusive shapes:

- \`splitBy: {cohort, attribute, maxArms?, minCount?}\` — one arm per distinct value of a
  categorical clinical attribute. Top \`maxArms - 1\` values by patient count (default and max 8)
  get their own arm; everything else — both values beyond that cutoff and any value with fewer
  than \`minCount\` patients (default 10) — pools into one disclosed \`"Other"\` arm rather than
  being dropped or given a needlessly small, statistically unstable arm of its own. A numeric
  attribute is refused (split needs a categorical; threshold a continuous one with a cohort's
  own \`percentile\` instead), as is an attribute with fewer than 2 values clearing \`minCount\`, or
  a study that itself declines to answer (e.g. over its own 200-distinct-value cap). Arms are
  named \`"<cohort> — <attribute>: <value>"\`.
- \`splitBy: {cohort, gene}\` — exactly two arms, mutated vs. not, via OQL (\`<gene>: MUT\`) —
  no live query needed to know the two group names in advance, unlike \`attribute\`. Sugar for the
  single-query case of \`oql\` below, with its complement (not mutated) auto-generated. \`maxArms\`/
  \`minCount\` don't apply and are refused if given alongside \`gene\`, rather than silently
  ignored. Arms are named \`"<cohort> — <gene>: Mutated"\` / \`"<cohort> — <gene>: Not mutated"\`.
- \`splitBy: {cohort, oql: [q, ...]}\` — one arm per portal-OQL query (1-8, the same subset a
  cohort's own \`{"kind":"oql"}\` leaf compiles), named from the query text itself — reaching
  anything OQL can express (a driver-only call, copy number, a multi-gene co-alteration like
  \`"TP53: MUT; KRAS: MUT"\`), not just plain mutation status as \`gene\` does. Arms are **not**
  forced into a partition: a patient matching more than one query counts toward each, and the
  total overlap is disclosed (\`overlapCount\` in the result), not hidden; anyone matching none of
  them falls into a disclosed \`"<cohort> — Other"\` arm (omitted entirely if it would be empty).
  \`maxArms\`/\`minCount\` don't apply here either — you named the arms yourself, so there's no
  data-discovered long tail to cap or pool — and are refused if given alongside \`oql\`.

Arms are only a strict partition for \`gene\` (mutated/not always sums to the whole). For
\`attribute\` and \`oql\`, the result's \`splitBy.overlapCount\` discloses how many patients counted
toward more than one named arm — attribute mode can still overlap on a sample-level attribute
when one patient's samples disagree, and oql mode whenever two queries both match the same
patient — so the arm counts summing to more than the base cohort is expected, not a bug.

| kind | fields | semantics |
|---|---|---|
${viewsTable()}

\`views[].note\` is the analyst's own one-line annotation, carried through to the result and
drawn above the figure. It is plain text on purpose — never markdown — so a document cannot
smuggle formatting or links into a page that reports numbers.

\`views[].cohorts\` lists the cohorts a view draws, in order — every view names its own; one with
no list (or an empty one) is refused as empty, never read as "all of them". The document's
\`cohorts\` is the store those names come from: a cohort is defined once there and listed by every
view that draws it. Oncoprints federate across studies: columns are
study-qualified, a synthetic **Study** track shows each column's origin, and duplicates appear twice.

### Table views: columns, search, filters, sort

Every view that lists rows — \`table\`, \`mutations\` — takes the same four fields, and its result
answers them the same way. They are the view's spec, so a shared document reproduces the
filtered, sorted table; the page is the reader's and is not.

- \`columns: [ids]\` — the columns shown, in order (default: the view's own set). The download
  holds every column whatever is shown.
- \`search: "text"\` — keeps rows containing the text, case-insensitively, in any shown column
  (numbers as written).
- \`filters: {"<column>": filter}\` — a row is kept when it passes every filter. A text column takes
  \`{"op": "contains"|"notContains"|"equals"|"notEquals"|"startsWith"|"endsWith"|"regex", "value": "…"}\`
  (case-insensitive but for \`regex\`, RE2 syntax) or \`{"values": ["…", …]}\` (≤500 exact values; \`""\`
  is blank); a numeric column takes \`{"min"?: n, "max"?: n}\` (inclusive; a blank value fails it).
- \`sort: {"column": id, "desc"?: true}\` — numbers as numbers, missing values last either way.

All four run in the database across every cohort and study together, so the order is global and
any page is one query however deep. The result carries \`total\` (rows kept) and \`all\` (rows in
the table), per cohort and study in \`lists\`, and the caveat says what the query kept. A bad
column id or a filter that does not suit its column is refused with the ids accepted.
\`POST /api/view-page {doc, view, offset, limit}\` returns another page; \`{doc, view, values:
"<column>"}\` returns the values that column takes among the rows the rest of the query keeps
(distinct values with counts, or a numeric column's range) — what its filter offers.
\`POST /api/table {doc, view}\` streams every row kept, every column, as CSV.

### Plot axes

An axis is a clinical attribute, one of the study's own molecular profiles, or a query across genes,
and the pair decides the shape — the portal's own rule:

| \`source\` | shape of the axis | fields |
| --- | --- | --- |
| \`clinical\` | number or category, **as the study declared it** | \`attribute\` |
| \`profile\` | **as the study describes the profile** (below) | \`profile\` (its id without the study prefix), \`gene\` (or \`entity\` for a generic assay), \`by\` for a mutation profile, \`log\` for numbers |
| \`alteration\` | category | \`oql\` (below), or \`genes\` (2-20, any mutated) |

**A profile axis** reads one gene in one of the study's profiles, and what it is follows from the
study's own description of that profile (\`genetic_profile\`: its alteration type and datatype), never
from its name: a **mutation** profile (MAF) groups cases by mutation type, or with \`by: "mutated"\`
mutated or not; a **structural-variant** profile by whether the case has one; a **discrete
copy-number** profile by its own calls (Deep deletion, Shallow deletion, Diploid, Gain,
Amplification, drawn in that order); and a **continuous** one (mRNA, z-scores, log2 copy number,
protein) is a number. A case with no mutation, SV or high-level call in the gene is the wild-type
answer only when it is profiled for that gene; otherwise it is **Not profiled**. A profile a study
does not have is refused with the list it does have, and one that two pooled studies describe
differently is refused, never read as one thing. A **generic-assay** profile (mutational signatures,
arm-level copy number, methylation probes, phosphosites, treatment response, …) reads one \`entity\`
of the profile instead of a gene — \`{"source":"profile","profile":"armlevel_cna","entity":"8q_status"}\`
— as a number, or as a category where the study declares the profile CATEGORICAL or BINARY; values
that are not numbers (NA, a limit like ">8") and categorical "NA" are left out, and an entity the
profile lacks is refused with the closest it has. A patient-level assay's value is shared by the
patient's samples. The engine runs a profile axis as the lower-level forms it resolves to, which a
document may also give directly: \`{"source":"molecular","profileType","gene","discrete"?}\`,
\`{"source":"assay","profileType","entity","categorical"?,"patientLevel"?}\` and
\`{"source":"alteration","gene","by":"mutationType"|"mutated"|"cna"|"sv"}\`.

number × number draws a **density scatter**, number × category a **box**, category × category a
**contingency table**. Every statistic is computed where the rows are and is therefore exact over
every case, not over what fits in a browser: n, Pearson and Spearman with their two-sided t-test
p-values, and the least-squares line. Quartiles use Tukey's 1.5×IQR fences.

**\`genes\` (a gene set, not one gene).** An alteration axis normally names one gene; \`genes\`
names 2-20 and asks "is ANY of these altered" as a single category — a pathway rollup (e.g. a DDR
gene set) for a Cox covariate, a compare-style axis, or any other consumer of a plot axis, without
inventing a second mechanism. Only \`by:"mutated"\` (the default when \`genes\` is used) is
supported for a set — combining several genes' mutation TYPES or copy-number states into one
category has no single honest reading, so that combination is refused rather than guessed at.

Two things are refused rather than approximated. A profile axis **must name one gene** — a
whole profile is 630 million values in this warehouse, and reading them to draw one picture is
never what was meant. And a categorical axis with more than 150 distinct values is refused,
because a truncated contingency table is a wrong one.

**A cohort spanning more than one study federates.** Each site answers a smaller, self-contained
question rather than its own complete plot: its own extent, its own bin counts against one shared
grid (a scatter's bins would otherwise mean a different range at every site — the reason this was
refused outright before), its own six sums (n, Σx, Σy, Σxy, Σx², Σy²) for Pearson and the
regression line, and its own contingency cells or per-group quartiles. All of that pools exactly
except one thing: **Spearman rank correlation is not reported for a federated plot**, because a
rank needs the pooled *global* ordering, which no per-site aggregate can reconstruct — reported
as absent, not approximated. A federated box plot's quartiles are a size-weighted approximation
across sites. When it draws
no points, its violin is binned the way a scatter's grid is: every site cuts the same bins over one
shared range (the pooled whiskers, reaching at most one whisker span past them, which is the axis
the figure draws), so the counts add exactly; a value past that range is off the figure and left
out of the density.

**Points: every case when it is a drawing, the outliers when it is not.** cBioPortal draws every
case as a point. So does this, up to ${POINTS_CAP_TEXT} cases, on a scatter as on a box, and only when the
study is one this participant may see cases in — the points carry case ids, so they come from the
same entitlement that lets a patient-level participant list cohort members, and an aggregate-only
participant has no method that could return them. The jitter across a box is fixed per case, so
the figure does not move between the server SVG, the browser and the Python package.

Past ${POINTS_CAP_TEXT} the crowd is drawn as density — a quarter of a million dots is a solid block, and a
hover on it would land on an arbitrary case — and, by default, the **outliers** are a point layer
over it (see **Points**; on a box they are marked at any size, among the points too): on a box, the
values beyond each group's Tukey whiskers, drawn over a **violin** (from per-group bins) that stops
at the whiskers; on a scatter, the cases in **sparse cells** of the grid — every cell holding at
most 3 cases (fewer, if that is what keeps the points under ${POINTS_CAP_TEXT}) is drawn as its cases instead of
as a shade. Both subsets are chosen in the database, against the same grid and whiskers the figure
draws. A scatter's subset past ${POINTS_CAP_TEXT} is not drawn, never its first ${POINTS_CAP_TEXT}; a box's draws
${POINTS_CAP_TEXT} of them, **each group's most extreme** — furthest beyond its whiskers, measured in that group's whisker
spans — with the budget shared between the groups, so a group whose outliers are milder than another's still
draws its own (a group with fewer than an even share keeps them all; each group draws at most its most extreme
${POINT_RULE_N_MAX_TEXT} or its share of the overall most extreme, whichever is more). The caption says how many lie beyond in all. With
\`allPoints: false\` and \`points: []\`, or from a participant that may not disclose a case, the
figure is density alone.
The caption always says which it drew, how many points, and why there are none when there are
none. Each violin is scaled to its own densest bin, because one group holding 178,489 of the
values would otherwise flatten every other group to nothing; how many cases a group has is
printed under its name. A box's axis spans the points it draws but reaches at most one whisker
span past the whiskers, so one extreme value cannot flatten every box; a point beyond that is a
triangle at the frame's edge, counted in the caption.

**Colour.** \`colorBy\` fills each value with the colour of a category and \`ringBy\` rings it, the
portal's "Color samples by" with its two checkboxes — so a case that is amplified *and* mutated
stays legible. Both take the same categorical axes as the plot itself. A mutation class or a
copy-number state takes **the colour the oncoprint gives it**, so a missense dot here is the same
green as a missense cell there; anything else cycles the shared categorical palette. A ring means
"this case also has that", so a category meaning absence is drawn neutral and gets no ring.

Above the points cap the fill splits the **density** instead: the bin key gains the class, and each
bin's width is shared out between the classes in it. That stays an aggregate, so a participant that
may not disclose a case can still colour its plot. The key is capped at 12 classes.

**OQL on an axis.** An alteration axis can be an OQL query instead of genes:
\`{"source":"alteration","oql":"KRAS: G12C, STK11: MUT"}\`, its statements separated by a comma, a
semicolon or a new line (as in a cohort's \`oql\` leaf). Each case is **Altered** when it matches any
statement — the portal's own reading of a multi-gene query — and **Unaltered** when it matches none
and is profiled for every statement's gene in the alteration types that statement asks about; a
case whose gene panel omits one of them is **Not profiled**, never counted as wild type (the
panel-aware rule of \`docs/PERFORMANCE.md\`). Every case of the cohort is one of the three, so none is
missing. With \`"by": "statement"\` each statement is its own group, named as written: a case matching
two is the pair ("KRAS: G12C + STK11: MUT"), three or more "3 or more lines", none Unaltered or Not
profiled by the same rule (at most ${OQL_STATEMENT_CAP} statements). It is the same OQL a cohort's \`oql\` leaf takes
(mutation classes and protein changes, AMP/HOMDEL, FUSION, DRIVER against the pinned OncoKB version,
EXP/PROT thresholds), and it matches per patient or per sample following the plot's \`unit\`.
Because it is a categorical axis, it also works as \`colorBy\`/\`ringBy\` and as a Cox or logistic
covariate, where "Unaltered" is the reference level.
OQL is for alteration axes only: a profile axis stays one gene in one profile.

**Points.** Every case is a point when there are at most ${POINTS_CAP_TEXT} of them and every study may show
cases (\`allPoints: false\` draws the density alone at any size). Over that the plotted cohort is a
density, and \`points\` lists the subsets worth seeing one by one, each drawn in its own colour with
the plotted cohort light blue beneath them (at most four layers, in order):
\`{"rule": "outliers"}\` — on a box, the values beyond each group's Tukey whiskers at any size, marked
among every value when every case is a point and drawn over the violin (which then stops at the
whiskers) when the cases are density; on a single study's scatter past ${POINTS_CAP_TEXT} cases, the cases in sparse
cells (every grid cell holding at most 3 cases, left unshaded under its points) — a smaller scatter has
no crowded density for a case to stand out of, since nearly every cell holds one or none, and its caption
points to \`trend\` instead; with \`"n": 20\`, on a box each group's \`n\` most extreme, on a scatter at
most \`n\` cases; \`{"rule": "extremes", "axis":
"y", "n": 50}\` — the \`n\` highest and lowest values of a numeric axis (per group on a box);
\`{"rule": "trend", "n": 50}\` — on a scatter, the \`n\` cases furthest from the fitted line; and
\`{"cohort": "KRAS G12C"}\` — the plotted cohort's cases that are also in that cohort (how many of its
patients fall outside the plotted cohort is stated, and they are not drawn). The default is
\`[{"rule": "outliers"}]\`; \`[]\` draws none. A case in two layers is drawn by the first, and the
caption counts what each layer left to an earlier one. Every layer shares one ${POINTS_CAP_TEXT}-point budget,
and a layer is never cut to its first cases: a cohort layer past the budget, or from a study that
may not show cases, is drawn as an aggregate on the plot's own scale (cells on the scatter's grid,
or a narrow box per group), and a rule layer is not drawn — the caption says which and why. A box's
outliers are the exception: past the budget they are cut by extremity, never by order, as above.
Extremes and trend are exact over several studies (each returns its own top \`n\`). Layers change no
statistic: the coefficients and quartiles stay those of the whole plotted cohort. A contingency
table has no points to mark. On a box plot a value beyond the axis is pinned to the frame's edge as
a triangle and counted; with the cases coloured by a category, a layer is a ring round the case.

A case with no value on an axis is simply absent, so a pair is an inner join: only cases measured
on both axes are counted, and the figure reports how many that was.

**Oncoprint columns**: \`unit: "sample"\` draws one column per SAMPLE instead of one per patient.
A cohort still selects patients, so every sample of a selected patient is drawn — including
samples on which the cohort's own criterion was never measured — and patient-level clinical
values repeat across that patient's samples. The contract says so in \`conventions.column\`.

**Oncoprint display options** (\`display: {…}\`): every viewing decision lives in the document
rather than in browser state, so a shared link, the server SVG, the CLI and the Python package
all reproduce the same picture. Unknown keys are rejected loudly.

| key | default | what it does |
| --- | --- | --- |
| \`showUnaltered\` | \`true\` | draw columns with no alteration in any gene track |
| \`whitespace\` | \`true\` | gaps between columns once they are wide enough |
| \`gaps\` | \`"none"\` | \`"gaps"\` / \`"pct"\` / \`"pct-left"\`: split each cohort into runs of the primary categorical sort key; the \`pct\` modes label each run with its altered % on its right or left |
| \`colorByType\` | \`true\` | colour each mutation class separately; off draws them as one |
| \`whiteBackground\` | \`false\` | white instead of grey for unaltered cells, for print |
| \`clinicalLegends\` | \`"all"\` | \`"none"\` drops the category keys under the figure |
| \`colors\` | — | \`{track: {value: "#rrggbb"}}\`, the portal's Edit Colors |
| \`style\` | — | override any visual decision (palette, glyph bands, legend); validated against the style schema |
| **\`hideVUS\`** | \`false\` | **changes the numbers**: drops alterations the annotation source does not call drivers, so the altered fraction is over drivers alone. The contract reports how many went |
| **\`annotate\`** | \`"oncokb"\` | **changes the numbers**: \`"none"\` calls nothing a driver, so every driver percentage becomes 0 |

The last two are viewing options only in the sense that they live beside the others; they change
what is counted, not how it is drawn, and the figure says so where it reports them.

**Oncoprint overlays** (\`overlays: [{kind, profileType, threshold?}]\`, ≤2): thresholded molecular
evidence drawn INTO the gene cells rather than as tracks of their own — \`"mrna"\` as an outline,
\`"protein"\` as thin bars, the portal's ±2 z-score rule (\`threshold\` defaults to 2). Evidence
about a gene is not an alteration of it, so overlays never enter the altered fraction.

**Oncoprint derived-cohort rows** (\`derivedCohorts: [name]\`, ≤3): draw any cohort in the document
as a binary row, so a phenotype defined by the cohort DSL can be read against the genomics.
Single-study and patient-mode only, because cohort rows are patient-level.

**Oncoprint merged rows**: a \`genes\` entry may be a group — \`{"label"?: "TP53 pathway", "genes":
["TP53", "MDM2", "MDM4"]}\` — drawn as ONE row, cBioPortal's \`[TP53 MDM2 MDM4]\`. The row is altered
where any member is altered and profiled where any member was profiled, so its percentage is over
the **union** of the members' panels. Without a label the row is named by its members
(\`TP53 / MDM2 / MDM4\`). Groups do not nest, a gene may appear both in a group and on its own, and
the caps are 12 rows and 32 distinct genes (coverage is one bit per gene in a 32-bit mask). Merged
rows are an oncoprint idea: every other view flattens a group to its members. Per-track OQL inside a
group (\`[TP53: MUT MDM2: AMP]\`) is **refused**, not approximated — a track here draws every
alteration type its genes have.

**Oncoprint clinical tracks**: any attribute name; patient-level rows win, sample-level attributes
fall back to one sample value per patient. Numeric attributes (≥90% parseable, >10 distinct) render
as a continuous heat track scaled to the cohort's min→max with a gradient key; unknown attributes
render a labeled "(no data)" track.

**Oncoprint heatmap tracks** (portal-style): \`heatmap: [{"profileType": P, "genes"?: [...], "reference"?: "cohort"|"federation"}]\` adds
one continuous row per gene from a molecular profile (mRNA/protein z-scores, methylation, log2 CNA,
…; \`genes\` defaults to the gene tracks). Values are patient-level (mean across a patient's
samples, since columns are patients). Z-score profiles render on a **fixed diverging ±3
blue→white→red ramp** so colors are comparable across oncoprints; other sign-spanning data gets a
symmetric diverging ramp; positive-only data a sequential ramp. Track labels are
\`GENE <short-profile>\` (e.g. \`ERBB2 mRNA-z\`) and are valid \`sort\` keys. A numeric
**generic-assay** profile draws its \`entities\` instead of genes — \`{"profileType":
"mutational_signatures_contribution_SBS", "entities": ["mutational_signature_contribution_SBS4"]}\`, at
most 12 — labelled by the entity without the words it repeats from the profile and the assay's
kind (\`SBS4 sig\`, \`cg00032419 meth\`), and sortable and clusterable like any other; a
categorical assay (arm-level copy number) is refused, as is a federation reference. Unknown profiles
error loudly, listing what the study has. The synthetic profile \`"VAF"\` renders variant allele
fraction computed from mutation allele counts (max across a patient's mutations in the gene,
fixed 0–1 ramp) — available wherever the study loaded tumor alt/ref counts.

\`reference: "federation"\` re-scores those values against a distribution pooled from **every**
participating study — including instances that disclose no patients and so contribute no columns.
Each returns three totals per gene (n, \u03a3x, \u03a3x\u00b2), which is all a mean and standard deviation need,
so the reference population can be far larger than the drawn one without any value moving.

**Oncoprint sorting**: \`sort\` is an ordered list of track keys — \`"genomic"\` (the default
staircase: alteration type + driver rank across the gene tracks), \`"id"\` (the column id),
\`"cluster:<profileType>"\` (a Ward dendrogram over that profile's values, computed in the engine
because the browser never receives them; capped at 4,000 columns), a clinical or derived-event
track label, or \`"-label"\` for descending (e.g. \`["CANCER_TYPE", "-CURRENT_AGE_DEID"]\`). Applied
within each cohort group; missing values always sort last; the genomic staircase and patient id are
always the final tiebreakers. A sort key that names a track not in the oncoprint errors loudly,
listing the sortable tracks. The effective sort is echoed in \`conventions.sort\`.

## OncoprintSpec (standalone)

The builder page (\`/oncoprint\`), \`POST /api/oncoprint\`, and the MCP \`render_oncoprint\` tool
take a standalone spec (the analysis oncoprint view compiles to the same engine):

\`\`\`
{ "study"?: "<id>",
  "genes": [≤12],
  "clinical": [≤8],
  "heatmap"?: [{ "profileType": P, "genes"?: [...] | "entities"?: [...] } × ≤4], // continuous molecular / generic-assay tracks
  "sort"?: ["CANCER_TYPE", "-CURRENT_AGE_DEID", "genomic"],                   // column sort (≤4 keys)
  "derivedEvents": [{ "label": L, "expression": <event cohortDef> } × ≤3],   // phenotype tracks
  "cohort"?: { "dsl": <cohortDef> },                                          // single column group
  "layout"?: { "groupBy": { "kind": "cohorts", "groups": [{name,dsl} × ≤4] } },
  "conventions"?: { "lineGap": 90 } }
\`\`\`

Cell values are bitmasks (MISSENSE 1, TRUNCATING 2, INFRAME 4, SPLICE 8, OTHER_MUT 16, SV 32,
AMP 64, HOMDEL 128, DRIVER 256); −1 is NOT_PROFILED. Frequencies use profiled denominators.
Shareable links, all taking the same base64url spec: \`/oncoprint-lab?spec=\` (the interactive figure), \`/provenance?spec=\` (picture, DSL and SQL), \`/oncoprint-lab/cli?spec=\` (the node and Python command lines, run against it) and \`/oncoprint-lab/python?spec=\` (a Pyodide notebook).

## Endpoints

| endpoint | takes |
|---|---|
| \`POST /api/analysis\` | Analysis document → cohorts (counts, readback, SQL provenance) + views |
| \`POST /api/explore\` | \`{study, draft?}\` → faceted catalog (clinical/events/genes/case lists), counts conditioned on the draft |
| \`POST /api/oncoprint\` | OncoprintSpec → render contract |
| \`POST /api/cohort\` | v1 event DSL → count + histogram + provenance |
| \`GET /api/catalog?study=\` | event-type / attribute vocabulary for the event sub-DSL |
| \`GET /api/studies\` | all loadable studies |

## Templates: \`params\`, and \`notes\`

A document may declare **parameters** and refer to them anywhere:

\`\`\`json
{ "params": { "study": "msk_chord_2024", "genes": ["TP53", "KRAS"] },
  "study": "$study",
  "cohorts": { "cohort": { "all": [] } },
  "views": [ { "kind": "oncoprint", "genes": "$genes" },
             { "kind": "compare",   "genes": "$genes" } ] }
\`\`\`

A saved workup can then be re-pointed at a different gene panel or a different
study in ONE edit rather than five, which is the difference between an analysis
you ran once and one you keep.

The rule is deliberately tiny: **a value that is exactly \`"$name"\` is replaced by
that parameter, whatever its type** — so \`"$genes"\` becomes a real array. There is
no interpolation inside a longer string (\`"$gene mutations"\` stays literal), no
expressions, no defaults, and no chaining. Every resolved document is an ordinary
analysis document, checked by the same validators and compiling to the same SQL as
if the values had been typed in.

- Only **values** are substituted, never object keys: a cohort named \`"$name"\` stays literally that.
- Substitution happens only when \`params\` is present, so no existing document changes meaning.
- An unknown \`$name\` is a **loud error** naming the path and listing what IS declared.
- Parameters declared but never referenced are reported in the result (\`unusedParams\`) — the run
  still succeeds, so nothing else would tell you a rename missed a reference.
- The parameters that produced a result are echoed back in it, the same way the OncoKB pin is.

\`notes\` is the analyst's prose about the whole document; each view may carry its own
\`note\`, and each cohort may carry its own \`notes\`. All three are stored with the
document and travel in a \`?doc=\` link, so they are rendered as **plain text, never
markdown** — a shared link is untrusted input. None of them are compiled: a cohort's
\`notes\` never reaches SQL or the compiled readback.

## Examples

Every example below is executed against the live compiler by \`npm run docs:check\`
(part of the e2e suite) — if one breaks, the build fails.

${EXAMPLES.map(exampleBlock).join("\n")}
`;
}

// ---- compact grammar for agents: the browser assistant's dsl_reference tool --
// Keep this the terse twin of the markdown above; both live in this file so
// they are reviewed together. Behavioral guidance stays with the tools that serve it.
export const AGENT_GRAMMAR = `Document shape:
{ "study": "<default study id>",
  "params"?: { "<name>": <any JSON> },   // optional; a value that is EXACTLY "$name" is replaced by it
  "notes"?: "<the analyst's own prose about this workspace>",
  "title"?: "<name, when saved as a workspace>",
  "uploads"?: [{ "as": "<name>", "dataset": "<id>", "version": n }],  // set by the page: pins server custom data; never write or edit it
  "cohorts": { "<name>": <cohortDef>, ... (max 16) },  // the store: each cohort defined once, drawn by the views that list it
  // EVERY view lists the cohorts it draws: "cohorts": ["<name>", ...]. A view without that list is empty and refused —
  // it does NOT default to all cohorts. A cohort no view lists is kept in the store but drawn nowhere.
  "dsl"?: "${DOC_VERSION}",  // the document's version; older documents are upgraded on read, newer ones refused
  // A cohort may carry "splits": { "<name>": { "arms": [{ "name": "<label>", "where": <clause>, "splits"?: {…} }, ...(max 8)],
  // "other"?: "<label>" } } — children that are disjoint and add up to it: arms are tested in order, first match wins
  // (put the most specific first: G12C before KRAS: MUT). Patients not profiled for an OQL arm's gene, or with no
  // value for a clinical arm's attribute, get their own "Not profiled: …" / "No … recorded" child; the rest go to
  // "Other". Each child is the cohort "<cohort> / <split> / <arm>"; an arm may carry its own "splits" to nest. In a
  // view's "cohorts", a cohort's name is the WHOLE cohort (split or not), "<cohort> / <split>" is that split's arms and
  // Other, and an arm's name is that arm — so to compare the arms, list the split's name. A view lists EITHER whole
  // cohorts OR the groups of ONE split (the split's name, or some of its arms) — never a mix, never two splits; such a
  // view is refused. A cohort may have several splits ("splits" holds them all); each view picks one. Prefer a split to
  // hand-written mutually exclusive cohorts, and to splitBy when the arms must not overlap. (Not the {"kind":"split"}
  // held-out-half leaf.) Always write "dsl": "${DOC_VERSION}" in a document you author.
  // compare/survival/cox/logistic/clinical/course/oncoprint (only) may carry "splitBy" instead of (or with)
  // "cohorts" — auto-splits one named cohort into several arms, scoped to THIS view only, never added to the
  // document's own cohort list. Exactly one of three shapes:
  //   {"cohort":"<name>","attribute":"<categorical clinical attr>","maxArms"?:8,"minCount"?:10} — one arm per
  //     distinct value, live from the data; top (maxArms-1) by count each get an arm, the rest (plus anything
  //     under minCount patients) pool into one disclosed "Other" arm. Refused for a numeric attribute, or
  //     fewer than 2 values clearing minCount.
  //   {"cohort":"<name>","gene":"<symbol>"} — exactly 2 arms (mutated / not, via OQL), no live query needed;
  //     maxArms/minCount are refused here, not silently ignored.
  //   {"cohort":"<name>","oql":["<query>", ...(max 8)]} — one arm per portal-OQL query, named from the query
  //     text — reaches driver calls, CNA, multi-gene co-alteration, not just plain mutation. Arms aren't a
  //     partition (a patient matching 2+ queries counts toward each; the result's splitBy.overlapCount says by
  //     how much); anyone matching none of them gets a disclosed "Other" arm. maxArms/minCount refused here too.
${viewsGrammar()}

cohortDef: { "all": [clause, ...(max 8)], "extends"?: "<cohort name>", "study"?: "<id>", "studies"?: ["<id>", ...] } — clauses ANDed; an empty all[] is every patient in the study;
"extends" splices that cohort's own "all" in ahead of this one's (only "all" is inherited; a cycle is rejected by name) — e.g. define "apcMutated" once, then "apcMutatedLiverMets": {"extends":"apcMutated","all":[...]} instead of repeating the APC clause.
a cohort may target another study or union across several (members are study-qualified; overlap
across studies is NOT deduplicated — say so when comparing). Oncoprint views federate too: cross-study
columns are qualified per study (duplicates appear twice) and a \u201cStudy of origin\u201d track shows each column's origin.
clause = leaf | {"any":[leaf,...]} | {"not":leaf} | {"not":{"any":[leaf,...]}} (De Morgan's — "none of these" in one clause).
Leaf kinds:
- {"kind":"oql","q":"STK11: DRIVER"} — genomic status in cBioPortal OQL (preferred; full notes below).
- {"kind":"split","part":"discovery"} (or "validation") — a fixed, engine-owned half of the study's patients, for held-out replication.
- {"kind":"derived","metric":"followupMonths","range":{"gte":24}} (also historyMonths, alteredGenes \u2014 computed from data shape, not study vocabulary; also "lines"/"treatmentSpan", which need an explicit "eventType" since they read the study's own therapy-event vocabulary on purpose)
- {"kind":"clinical","attribute":"GENDER","op":"=","value":"Male"} (ops = != > >= < <=; numeric values compare numerically).
  Useful attributes: OS_STATUS (0:LIVING/1:DECEASED), OS_MONTHS, GENDER, RACE, CURRENT_AGE_DEID,
  SMOKING_PREDICTIONS_3_CLASSES (Former/Current Smoker, Never, Unknown), CANCER_TYPE-site flags (LUNG, LIVER, BONE... values Yes/No).
  "op":"!=","value":"" is the idiom for "this attribute is recorded at all" (e.g. isolate patients
  a free-text response column was actually filled in for, rather than filtering on its content).
- {"kind":"event", "a":{selector}, "b":{selector}?, "rel":{...}, "priorGuard":bool} — timeline DSL:
  selectors: eventType (Treatment, Diagnosis, Lab_Test, Surgery, Pathology, "Treatment line (derived)"),
  attrs [{key,value}] (Treatment SUBTYPE: Immuno/Chemo/Targeted/Hormone/Biologic/Radiation Therapy;
  Diagnosis PROGRESSION=Y; Lab_Test TEST: PSA/CEA/CA 15-3/CA 19-9 with numeric{key:"RESULT",op,value});
  occurrence ANY|FIRST|LAST. rel: {"type":"NONE"} | {"type":"BEFORE","minDays":0,"maxDays":N} |
  {"type":"DURING"} | {"type":"NOT_FOLLOWED_BY","withinDays":N,"observed":true}.
  For absence queries ALWAYS set observed:true (else "no event" conflates with lost-to-follow-up).
  priorGuard:true restricts to treatment-naive patients — REQUIRED for honest "first-line" claims
  (~20% of patients had prior treatment elsewhere, ~20% undetermined and left out). Needs the
  study's PRIOR_MED_TO_MSK flag (MSK studies); refused on a study without it.
- {"kind":"sampleList"|"patientList","ids":["<study>:<id>",...]} — explicit, cross-study list; ids
  are "<study>:<bare-id>" (colon, matching the legacy portal's convention — not the database's
  internal underscore, since a bare id may contain one). A list the page saved on the server is
  {"kind":"sampleList"|"patientList","set":"<id>","label":"…","n":N}: keep such a clause as it is
  (copy it whole when reusing the cohort) — its ids are not in the document.
- A cohort with "lock" is frozen to the samples it selected when locked: the engine evaluates the
  lock, not "all". Leave "lock" as it is; editing "all" does not change what is in a locked cohort
  (the result's cohorts[name].lock reports what "all" selects now). Remove "lock" to unlock it.
- {"kind":"clinical",...} also supports "values":[...] (OR across values), "range":{"gte":60,"lt":80}
  (numeric). It matches at the level the study records the attribute (sample attribute: the
  matching samples; patient attribute: every sample of the matching patients); never add "per".
  "op"+"percentile" (0-1, e.g. {"op":">=","percentile":0.8}) resolves "value" live from a
  percentile of the attribute's own distribution ("top 20%"); "percentileOf":"<cohort name>"
  scopes that to another cohort in this document instead of the whole study (e.g. top 20% TMB
  WITHIN NSCLC) — both cohorts must be single-study, and percentileOf may not itself use percentile.
- Attributes named "custom:<dataset>/<COLUMN>" are the user's own uploads (Explore → Custom data),
  usable anywhere a clinical attribute is. Use only ones explore_get_facets lists; they are stored on
  the server, so whoever opens a shared link must be logged in to run it.
- {"kind":"profiled","type":"MUTATION"|"CNA"|"SV","gene"?:"KRAS"|"genes"?:[...]} — patient was
  profiled for that data type, on a panel covering the gene(s) if given. A wild-type cohort is
  {"not": oql "GENE:"} AND profiled with that gene: "not" alone keeps patients never tested for it.
- {"kind":"caseList","id":"sequenced"|"cna"|full stable id} — portal case lists.
- {"kind":"genomicData","gene":"CDKN2A","profileType":"cna","range":{"lte":-2}} — continuous
  per-gene values; profile must exist in the study or it errors listing what does.
- {"kind":"proteinPosition","gene":"APC","range":{"lt":1400}} — mutated in gene with protein
  position (proteinPosStart) in range, for an N-/C-terminal split; AND with an oql leaf
  ({"kind":"oql","q":"APC: TRUNC"}) to also require a mutation type — or, to require both of the
  SAME mutation, use an OQL range instead: {"kind":"oql","q":"APC: TRUNC_(1400-)"}.
- OQL EXP>z / PROT>z work only if the study has mRNA/protein profiles (msk_chord does not).
- OQL details for {"kind":"oql"}: per gene MUT,
  MUT=<pchange>, MISSENSE/NONSENSE/FRAMESHIFT/NONSTART/NONSTOP/INFRAME/SPLICE/PROMOTER/TRUNC (the portal's
  classes; TRUNC = anything not missense or in-frame, splice included), AMP, HOMDEL, FUSION, DRIVER and _DRIVER
  modifiers, and a protein position range on a mutation (TRUNC_(1400-), MUT_(12-13), (1-100*) = fully inside;
  class and range checked on the same mutation); entries separated by ';' are OR'd (portal "altered in query" semantics).
  GAIN/HETLOSS/GERMLINE/SOMATIC are always rejected; EXP/PROT are rejected in studies
  without mRNA/protein profiles — do not use any of these there.`;
