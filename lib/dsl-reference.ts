// ============================================================================
// THE SINGLE SOURCE OF TRUTH for DSL documentation.
//
// Everything that *describes* the DSL renders from this module:
//   - docs/dsl.md            (generated: npm run docs:gen — never edit by hand)
//   - the chat system prompt (app/api/chat/route.js imports CHAT_GRAMMAR)
//   - the MCP describe_dsl tool (mcp/tools.js serves renderDslMarkdown())
//
// The EXAMPLES below are executed against the live compiler by
// `npm run docs:check` (also run by e2e.cjs), and docs/dsl.md is diffed against
// a regeneration — so a stale doc or a broken example fails the suite.
//
// When you change the DSL (lib/cohort2.ts, lib/oql.ts, lib/compiler.ts,
// lib/analysis.ts views, lib/oncoprint.js), update this file in the same
// commit and run `npm run docs:gen`.
// ============================================================================

import type { AnalysisDoc } from "./types.ts";

export const DSL_VERSION = "2.2";

export interface DslExample {
  title: string; note: string; doc: AnalysisDoc;
  /** one line on WHY this example exists — rendered by the app's Examples tab */
  demonstrates?: string;
  /** view kinds / themes exercised, for grouping in the app */
  tags?: string[];
}

// ---- runnable examples (rendered into the doc AND executed by docs:check) --
export const EXAMPLES: DslExample[] = [
  {
    title: "Lung adenocarcinoma: a four-view workup",
    demonstrates: "One document, four views: the same two cohorts asked genomically, clinically, temporally and structurally. This is what the analysis document is FOR \u2014 not one chart, but a whole workup that travels as a single object.",
    tags: ["multi-view", "compare", "clinical", "survival", "cooccurrence"],
    note: "EGFR-mutant versus KRAS-mutant lung adenocarcinoma \u2014 the two dominant, mutually exclusive driver classes. Co-alteration frequencies, how the groups differ clinically, how they differ in survival (with a log-rank test), and which driver pairs co-occur within the EGFR arm. Every view is computed from aggregates each site could return without disclosing a patient.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "EGFR-mutant NSCLC": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"], per: "sample" },
          { kind: "oql", q: "EGFR: MUT" }
        ] },
        "KRAS-mutant NSCLC": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"], per: "sample" },
          { kind: "oql", q: "KRAS: MUT" }
        ] }
      },
      views: [
        { kind: "compare", genes: ["TP53", "STK11", "KEAP1", "RBM10", "ERBB2", "MET"] },
        { kind: "clinical", attributes: ["SMOKING_PREDICTIONS_3_CLASSES", "CURRENT_AGE_DEID", "TMB_NONSYNONYMOUS", "FRACTION_GENOME_ALTERED"] },
        { kind: "survival" },
        { kind: "cooccurrence", genes: ["EGFR", "TP53", "STK11", "KEAP1", "RBM10"] }
      ]
    }
  },
  {
    title: "One cohort, five ways: the colorectal hotspot workup",
    demonstrates: "A single cohort put through five different views at once \u2014 including the lollipop \u2014 to show that the views compose rather than compete. Nothing here is re-queried per chart; each view asks its own aggregate of the same compiled cohort.",
    tags: ["multi-view", "lollipop", "hotspots", "cooccurrence", "clinical", "oncoprint"],
    note: "Colorectal cancer in MSK-CHORD. Lollipops for the canonical drivers (KRAS codon 12/13, BRAF V600E, PIK3CA E545K/H1047R), which pairs co-occur or exclude each other, how the mutated and wild-type groups differ clinically, and an oncoprint of the same patients. minCount is set so no site returns a change carried by fewer than three patients.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "CRC, KRAS-mutant": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"], per: "sample" },
          { kind: "oql", q: "KRAS: MUT" }
        ] },
        "CRC, KRAS wild-type": { all: [
          { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"], per: "sample" },
          { not: { kind: "oql", q: "KRAS:" } },
          { kind: "profiled", type: "MUTATION" }
        ] }
      },
      views: [
        { kind: "hotspots", genes: ["KRAS", "BRAF", "PIK3CA", "TP53"], minCount: 3 },
        { kind: "cooccurrence", genes: ["KRAS", "BRAF", "NRAS", "PIK3CA", "TP53", "APC", "SMAD4"] },
        { kind: "compare", genes: ["BRAF", "NRAS", "PIK3CA", "APC", "SMAD4"] },
        { kind: "clinical", attributes: ["CURRENT_AGE_DEID", "MSI_SCORE", "TMB_NONSYNONYMOUS"] },
        { kind: "survival" }
      ]
    }
  },
  {
    title: "Federated end to end: two studies, four views",
    demonstrates: "The full federated story in one document \u2014 cohorts spanning two studies, with every view falling back on aggregates that each site can compute in its own database: pooled gene counts, additive moments, per-site survival triples and per-site 2\u00d72 tables.",
    tags: ["multi-view", "federation", "survival", "log-rank", "cooccurrence", "clinical"],
    note: "TP53-mutant versus wild-type across MSK-CHORD and MSK-MET. The log-rank is stratified by study, the co-occurrence test is Cochran\u2013Mantel\u2013Haenszel across the two sites, and the clinical comparison pools counts and moments \u2014 all from per-site aggregates. Run with either study aggregate-only and the numbers do not change.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { studies: ["msk_chord_2024", "msk_met_2021"],
          all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION" }] }
      },
      views: [
        { kind: "compare", genes: ["KRAS", "PIK3CA", "APC", "EGFR", "CDKN2A"] },
        { kind: "survival" },
        { kind: "clinical", attributes: ["CURRENT_AGE_DEID", "TMB_NONSYNONYMOUS", "FRACTION_GENOME_ALTERED"] },
        { kind: "cooccurrence", genes: ["TP53", "KRAS", "PIK3CA", "APC"] }
      ]
    }
  },
  {
    title: "Genomic status via OQL, compared",
    demonstrates: "The base case the others build on: two cohorts defined genomically, compared gene by gene with panel-aware denominators, then followed to death.",
    tags: ["compare", "survival", "OQL"],
    note: "STK11 putative drivers vs wild-type (wild-type = NOT any STK11 alteration, so it includes not-profiled unless you add a profiled clause). Two views: co-alteration frequencies and overall survival.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "STK11 driver": { all: [{ kind: "oql", q: "STK11: DRIVER" }] },
        "STK11 wt": { all: [{ not: { kind: "oql", q: "STK11:" } }, { kind: "profiled", type: "MUTATION" }] }
      },
      views: [{ kind: "compare", genes: ["KEAP1", "KRAS", "TP53"] }, { kind: "survival" }]
    }
  },
  {
    title: "Clinical + timeline event composition",
    demonstrates: "A cohort no attribute filter could express \u2014 it depends on the ORDER of events in a patient's timeline.",
    tags: ["compare", "timeline"],
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
      views: [{ kind: "compare", genes: ["STK11", "KEAP1", "TP53"] }]
    }
  },
  {
    title: "Derived filters: enough follow-up to answer the question",
    demonstrates: "Filters computed from the SHAPE of the data instead of a study's own words. Event-type names and attribute keys differ study to study, so anything keyed on them works nowhere in particular; dates and gene symbols are the same everywhere.",
    tags: ["derived", "timeline", "temporal", "survival", "clinical"],
    note: "Any question about an outcome is only honest among patients observed long enough to have one. This contrasts patients with at least two years of follow-up past the study's own day 0 against those with under six months — a distinction no clinical attribute in this study records, and one that needs no knowledge of how this study names its events.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "followed 2y+": { all: [{ kind: "derived", metric: "followupMonths", range: { gte: 24 } }] },
        "followed < 6mo": { all: [{ kind: "derived", metric: "followupMonths", range: { lt: 6 } }] }
      },
      views: [
        { kind: "clinical", attributes: ["CANCER_TYPE", "CURRENT_AGE_DEID", "TMB_NONSYNONYMOUS"] },
        { kind: "compare", genes: ["TP53", "KRAS", "PIK3CA"] }
      ]
    }
  },
  {
    title: "Progression on immunotherapy: during, versus absent",
    demonstrates: "Two temporal relations that look similar and mean opposite things. DURING asks whether progression was recorded inside a treatment interval; NOT_FOLLOWED_BY asks whether it was absent for a year afterwards \u2014 and only counts patients whose follow-up actually covers that year.",
    tags: ["timeline", "temporal", "compare", "clinical", "survival"],
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
        { kind: "compare", genes: ["STK11", "KEAP1", "TP53", "EGFR", "SMARCA4"] },
        { kind: "clinical", attributes: ["TMB_NONSYNONYMOUS", "CURRENT_AGE_DEID", "SMOKING_PREDICTIONS_3_CLASSES"] },
        { kind: "survival" }
      ]
    }
  },
  {
    title: "Derived treatment lines: who reaches a third line?",
    demonstrates: "Treatment lines are not a column in the data \u2014 they are synthesised at query time by interval-merging systemic therapy with a gap rule. The line number is then an ordinary attribute you can filter on, and NOT around a line selector expresses \"never got that far\".",
    tags: ["timeline", "temporal", "treatment-lines", "survival", "clinical"],
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
        { kind: "survival" },
        { kind: "clinical", attributes: ["CURRENT_AGE_DEID", "CANCER_TYPE", "TMB_NONSYNONYMOUS"] },
        { kind: "compare", genes: ["TP53", "KRAS", "PIK3CA", "APC"] }
      ]
    }
  },
  {
    title: "True first line: fast progression versus durable control",
    demonstrates: "The prior-treatment guard. \"First line\" ordinarily means first line OBSERVED HERE \u2014 about a fifth of these patients were treated elsewhere first. priorGuard restricts to those flagged treatment-naive, which is the difference between a real first-line claim and an artefact of where the patient was referred from.",
    tags: ["timeline", "temporal", "prior-guard", "survival", "compare"],
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
        { kind: "survival" },
        { kind: "compare", genes: ["TP53", "KRAS", "SMAD4", "CDKN2A", "MYC"] },
        { kind: "clinical", attributes: ["CANCER_TYPE", "FRACTION_GENOME_ALTERED", "CURRENT_AGE_DEID"] }
      ]
    }
  },
  {
    title: "Lab thresholds over time: PSA above 100",
    demonstrates: "A numeric predicate on a repeated measurement. The cohort is defined by a lab value ever crossing a threshold, and its complement is built by wrapping the same selector in NOT alongside \"was measured at all\" \u2014 so the comparison is against patients genuinely tested, not against patients with no PSA record.",
    tags: ["timeline", "temporal", "lab-values", "compare", "survival"],
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
        { kind: "compare", genes: ["AR", "TP53", "PTEN", "SPOP", "RB1"] },
        { kind: "survival" },
        { kind: "clinical", attributes: ["CURRENT_AGE_DEID", "FRACTION_GENOME_ALTERED", "CANCER_TYPE"] }
      ]
    }
  },
  {
    title: "any / not / genomicData",
    demonstrates: "Boolean structure: OR inside a clause, NOT around a leaf, and a copy-number threshold expressed as a continuous range.",
    tags: ["compare", "boolean"],
    note: "Colorectal or pancreatic patients (OR inside one clause), excluding CDKN2A deep deletions expressed as a continuous copy-number threshold.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "CRC/PAAD without CDKN2A loss": { all: [
          { any: [
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"], per: "sample" },
            { kind: "clinical", attribute: "CANCER_TYPE", values: ["Pancreatic Cancer"], per: "sample" }
          ] },
          { not: { kind: "genomicData", gene: "CDKN2A", profileType: "cna", range: { lte: -2 } } }
        ] }
      },
      views: [{ kind: "compare", genes: ["KRAS", "TP53", "APC", "SMAD4"] }]
    }
  },
  {
    title: "Cross-study federation with an oncoprint",
    demonstrates: "One cohort spanning two studies. Overlap is NOT deduplicated and vocabularies are NOT harmonized \u2014 the view says so rather than hiding it.",
    tags: ["oncoprint", "federation"],
    note: "One cohort unioned across two studies (members are study-qualified; overlap is NOT deduplicated), rendered as a federated oncoprint with a categorical and a numeric clinical track, columns sorted by cancer type then descending age. The Study track is added automatically.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53-mut, CHORD+MET": { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] }
      },
      views: [{ kind: "oncoprint", genes: ["TP53", "KRAS", "EGFR"], clinical: ["CANCER_TYPE", "CURRENT_AGE_DEID"], sort: ["CANCER_TYPE", "-CURRENT_AGE_DEID"] }]
    }
  }
,
  {
    title: "Molecular heatmap tracks, sorted by expression",
    demonstrates: "Continuous molecular values as tracks, with the track label doubling as the sort key.",
    tags: ["oncoprint", "heatmap"],
    note: "ERBB2-amplified TCGA breast tumors with an mRNA z-score heatmap under the gene tracks, columns sorted by descending ERBB2 expression. Z-scores render on a fixed diverging \u00b13 ramp; the track label (gene + short profile name) is the sort key.",
    doc: {
      study: "brca_tcga_pan_can_atlas_2018",
      cohorts: {
        "ERBB2 amp": { all: [{ kind: "oql", q: "ERBB2: AMP" }] }
      },
      views: [{ kind: "oncoprint", genes: ["ERBB2", "EGFR", "PIK3CA"],
        heatmap: [{ profileType: "rna_seq_v2_mrna_median_Zscores" }],
        sort: ["-ERBB2 mRNA-z"] }]
    }
  },
  {
    title: "A federated z-score reference on an oncoprint",
    demonstrates: "The sharpest form of the argument: a site that discloses no patients \u2014 and so draws no columns \u2014 still defines the scale those columns are read against, from three totals per gene.",
    tags: ["oncoprint", "federation", "z-reference"],
    note: "A heatmap track with reference:\"federation\" is scored against a distribution pooled from EVERY participating study, including instances that disclose no patients and therefore contribute no columns — each returns three totals per gene (n, sum, sum of squares), which is enough to define the reference. Run with luad_tcga_pan_can_atlas_2018 aggregate-only, its patients are absent from the columns while its 510 patients still shape what the drawn columns mean.",
    doc: {
      study: "brca_tcga_pan_can_atlas_2018",
      cohorts: {
        "ERBB2 amp": { studies: ["brca_tcga_pan_can_atlas_2018", "luad_tcga_pan_can_atlas_2018"],
          all: [{ kind: "oql", q: "ERBB2: AMP" }] }
      },
      views: [{ kind: "oncoprint", genes: ["ERBB2", "EGFR"],
        heatmap: [{ profileType: "rna_seq_v2_mrna_median_Zscores", reference: "federation" }] }]
    }
  },
  {
    title: "The clinical course: who is still on treatment, and when",
    demonstrates: "Timeline data finally DRAWN rather than only filtered on. The two things that make a temporal chart honest are both enforced by the engine: every patient is lined up on a real clinical landmark rather than a study-specific day 0, and the denominator is who was still under observation \u2014 not the whole cohort.",
    tags: ["course", "temporal", "timeline", "anchor", "at-risk"],
    note: "MSK-CHORD, aligned on each patient's FIRST treatment, split by TP53 status. Treatment carries real start/stop dates so it is drawn as a state patients are IN; surgery has no duration, so it is the share with a surgery in that bin \u2014 a distinction read from the data's shape, not from the event's name. Note surgery peaking BEFORE time zero: resection typically precedes first systemic therapy. The at-risk row under the axis is the denominator, and it falls steeply \u2014 a curve read without it would be badly misleading.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] },
        // "wild-type" means PROFILED for mutation and not altered \u2014 without the
        // profiled guard, patients never tested land in the wild-type arm.
        "TP53 wt": { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION" }] }
      },
      views: [{
        kind: "course", eventTypes: ["treatment", "surgery"],
        anchor: { eventType: "Treatment", occurrence: "FIRST" },
        binMonths: 3, fromMonths: -12, toMonths: 60
      }]
    }
  },
  {
    title: "What comes after what: lines of therapy as a Sankey",
    demonstrates: "The question the clinical-course view CANNOT answer. That chart asks 'on treatment, yes or no', so a seamless switch between drugs is invisible in it. This one follows the actual sequence \u2014 and makes the attrition explicit rather than letting it leak out of the diagram.",
    tags: ["sequence", "sankey", "temporal", "lines-of-therapy", "attrition"],
    note: "MSK-CHORD therapy lines, 90-day gap. Read the grey blocks first: of 21,444 patients with a first line, 13,620 never start a second. Chemo dominates first line; hormone therapy holds its share far better across lines, which is what maintenance endocrine therapy looks like. The four excluded SUBTYPE values are a judgement made HERE, in the document, not hidden in the engine \u2014 'Prior Medications to MSK' is a provenance marker rather than a therapy, and radiation and bone treatment co-occur with almost everything, so leaving them in explodes the combination space. Nothing in the data structure distinguishes them from real treatments, which is exactly why the choice is visible.",
    doc: {
      study: "msk_chord_2024",
      cohorts: { "MSK-CHORD": { all: [] } },
      views: [{
        kind: "sequence", labelKey: "SUBTYPE",
        exclude: ["Prior Medications to MSK", "Radiation Therapy", "Bone Treatment", "Other"],
        lineGap: 90, maxSteps: 3, topN: 8
      }]
    }
  },
  {
    title: "Lollipop plot: recurrent protein changes, with a suppression floor",
    demonstrates: "Lollipop data, and the one place small cells genuinely bite: minCount is applied by each site BEFORE anything is returned, because a coordinator filtering what it already received is theatre.",
    tags: ["hotspots", "lollipop", "suppression"],
    note: "Hotspots in colorectal cancer. Percentages are of the patients carrying any mutation in that gene, so BRAF V600E accounts for roughly 70% of BRAF-mutant cases. minCount is applied by each site before anything is returned — with it set to 3, a change carried by one or two patients never leaves the database holding it, which is where small-cell suppression belongs.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "CRC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Colorectal Cancer"], per: "sample" }] }
      },
      views: [{ kind: "hotspots", genes: ["KRAS", "BRAF", "PIK3CA", "TP53"], minCount: 3 }]
    }
  },
  {
    title: "Co-expression from sums alone",
    demonstrates: "A correlation depends on the data only through six running totals, so it federates exactly \u2014 the pooled answer equals the centralized one rather than approximating it.",
    tags: ["coexpression", "federation"],
    note: "Pearson correlation between gene pairs in TCGA breast cancer. A correlation depends on the data only through six running totals, so each site can contribute without transmitting a single expression value — and because the totals add, the federated answer is exact rather than approximate. ERBB2/GRB7 (adjacent on the 17q12 amplicon) comes out near 0.87.",
    doc: {
      study: "brca_tcga_pan_can_atlas_2018",
      cohorts: { "BRCA": { all: [{ kind: "profiled", type: "MUTATION" }] } },
      views: [{ kind: "coexpression", profileType: "rna_seq_v2_mrna_median_Zscores",
        genes: ["ERBB2", "GRB7", "ESR1", "PGR", "MKI67"] }]
    }
  },
  {
    title: "Clinical attributes compared between cohorts",
    demonstrates: "Welch's t from (n, sum, sum of squares): three additive totals per site, so pooled mean and variance are exact and no individual value is transmitted.",
    tags: ["clinical", "federation"],
    note: "How TP53-mutant and wild-type tumors differ clinically. Categorical attributes are compared with a chi-squared over the full value vocabulary; numeric ones with Welch's t computed from three additive totals per site (n, sum, sum of squares) rather than from any transmitted value. An attribute the study does not declare is reported as skipped, not silently dropped.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION" }] }
      },
      views: [{ kind: "clinical", attributes: ["CANCER_TYPE", "SMOKING_PREDICTIONS_3_CLASSES", "CURRENT_AGE_DEID", "TMB_NONSYNONYMOUS", "FRACTION_GENOME_ALTERED"] }]
    }
  },
  {
    title: "Co-occurrence and mutual exclusivity in NSCLC",
    demonstrates: "Four counts per gene pair per site. Denominators are the patients each site's OWN panels profiled for both genes \u2014 something pooled exports get wrong.",
    tags: ["cooccurrence", "federation"],
    note: "Pairwise associations among lung cancer driver genes. Each site returns four counts per pair — both altered, one, the other, neither — among the patients its own panels profiled for BOTH genes, and nothing else; the coordinator does the inference. Reproduces the textbook pattern: STK11/KEAP1 co-occur, EGFR/KRAS and EGFR/ALK are mutually exclusive.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "NSCLC": { all: [{ kind: "clinical", attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"], per: "sample" }] }
      },
      views: [{ kind: "cooccurrence", genes: ["EGFR", "KRAS", "TP53", "STK11", "KEAP1", "ALK"] }]
    }
  },
  {
    title: "Survival from first chemotherapy, left-truncated",
    demonstrates: "Re-anchoring the survival clock to a timeline event, and the correction that makes it honest. The study measures OS from its own day 0 (first sequencing); anchoring at first chemotherapy moves the clock earlier, so patients are unobservable until day 0 and enter the risk set then — without that, every patient would appear to survive from chemotherapy to sequencing, which is precisely what got them into the study.",
    tags: ["survival", "timeline", "temporal", "left-truncation", "anchor"],
    note: "TP53-mutant vs wild-type, overall survival measured from each patient's first chemotherapy rather than from sequencing. Patients whose first chemotherapy falls after day 0, or who never had chemotherapy, are excluded rather than given negative follow-up. The result reports how long after the anchor patients became observable, so an anchor that is matching earlier events than intended shows up as a long tail.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION" }] }
      },
      views: [{ kind: "survival",
        anchor: { eventType: "Treatment", key: "SUBTYPE", value: "Chemo", occurrence: "FIRST" } }]
    }
  },
  {
    title: "Study-stratified survival across two studies",
    demonstrates: "The log-rank statistic is a sum over strata, so sites can BE the strata \u2014 which is better methodology than pooling, not merely more private.",
    tags: ["survival", "log-rank", "federation"],
    note: "TP53-mutant vs wild-type, each cohort spanning two studies. Every site answers with (months, event, n) counts only — no survival time for any individual crosses an instance boundary — and because the log-rank statistic is a sum over strata, those counts are enough to compute the test STRATIFIED by study: each study is compared only against itself. The unstratified pooled p is reported alongside, since the two can disagree when case mix differs between sites.",
    doc: {
      study: "msk_chord_2024",
      cohorts: {
        "TP53 mut": { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] },
        "TP53 wt": { studies: ["msk_chord_2024", "msk_met_2021"],
          all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION" }] }
      },
      views: [{ kind: "survival" }]
    }
  }
];

const exampleBlock = (ex: { title: string; note: string; doc: unknown }, i: number) =>
  `### Example ${i + 1}: ${ex.title}\n\n${ex.note}\n\n\`\`\`json\n${JSON.stringify(ex.doc, null, 2)}\n\`\`\`\n`;

// ---- the full reference (docs/dsl.md + MCP describe_dsl) -------------------
export function renderDslMarkdown(): string {
  return `<!-- GENERATED FILE — do not edit. Source: lib/dsl-reference.ts; regenerate with \`npm run docs:gen\`. -->

# Cohort Lab DSL (v${DSL_VERSION})

One declarative JSON object — the **Analysis document** — describes everything Cohort Lab does:
which patients form each cohort, and which views compare them. The server compiles it to
ClickHouse SQL (\`lib/cohort2.ts\`, \`lib/oql.ts\`, \`lib/compiler.ts\`, \`lib/analysis.ts\`);
clients never send SQL. Every result carries provenance: the definition readback and the exact
SQL each cohort compiled to.

## Analysis document

\`\`\`
{ "study":   "<default study id>",            // validated against cancer_study
  "cohorts": { "<name>": cohortDef, ... },    // max 6
  "views":   [ view, ... ] }                  // max 6
\`\`\`

Sent to \`POST /api/analysis\`, edited by the in-app chat, and encoded in shareable
\`/analysis?doc=<base64url>\` links.

## Cohort definitions

\`\`\`
cohortDef := { "all": [clause × 0-8],         // ANDed; [] means every patient in the study
               "study"?:   "<id>",            // evaluate in another study
               "studies"?: ["<id>", ...],     // union across studies (federated, no count limit)
               "lineGap"?: 90 }               // derived-treatment-line gap, days
clause    := leaf | { "any": [leaf × 1-8] }   // OR (UNION DISTINCT)
                  | { "not": leaf }           // study base EXCEPT leaf
\`\`\`

**Cross-study semantics.** A cohort with \`studies\` is compiled per study (compilers are
single-study by design); members are study-qualified patient ids. Patient overlap across studies
is deliberately **not** deduplicated, and clinical vocabularies are **not** harmonized — views
say so in their captions.

### Leaf kinds

| kind | shape | meaning |
|---|---|---|
| \`oql\` | \`{"kind":"oql","q":"STK11: DRIVER"}\` | genomic status in cBioPortal OQL (see below) |
| \`hotspots\` | \`genes:[\u226412], cohorts?:[names], minCount?\` | recurrent protein changes per gene (the lollipop's data): patients carrying each change, as a share of those with ANY mutation in that gene. The codon is parsed from the change string, since the schema stores no position. \`minCount\` is a suppression floor each site applies **before returning anything** \u2014 a variant carried by one patient is the most disclosive aggregate here |
| \`coexpression\` | \`genes:[2-12], profileType, cohorts?:[names]\` | Pearson correlation between gene pairs on a continuous molecular profile, **within one cohort** (the first named). Each site reports only six sums (n, \u03a3x, \u03a3y, \u03a3xy, \u03a3x\u00b2, \u03a3y\u00b2), which are additive \u2014 so the federated correlation is exact, not approximate. Across studies a Fisher-z meta-analysis of per-study correlations is reported alongside the pooled one |
| \`clinical\` | \`{"kind":"clinical","attribute":A, ...predicate, "per"?:"sample"}\` | clinical attribute; predicate is \`values:[≤50]\` (OR), \`range:{gt,gte,lt,lte}\` (numeric via toFloat64OrNull), or \`op\`(\`= != > >= < <=\`)+\`value\`; \`per:"sample"\` = patient matches if ANY sample matches |
| \`derived\` | \`{"kind":"derived","metric":"followupMonths"|"historyMonths"|"alteredGenes","range":{gte?,gt?,lte?,lt?}}\` | filters on a value computed from the **shape** of the data rather than a study's vocabulary. Event-type names and attribute keys are study-specific \u2014 this database spells one concept \`Treatment\` in 87 studies and \`TREATMENT\` in 10, and the key MSK-CHORD calls \`SUBTYPE\` exists in only 27 of 131 timeline studies \u2014 so these read dates and gene symbols instead and mean the same thing everywhere. \`followupMonths\`: how far the timeline runs past its own day 0. \`historyMonths\`: how much predates it. \`alteredGenes\`: distinct genes altered (panel size bounds it, so not comparable across studies with different panels) |
| \`event\` | \`{"kind":"event","a":sel,"b"?:sel,"rel":rel,"priorGuard"?:bool,"lineGap"?:90}\` | timeline sub-DSL (below) |
| \`patients\` | \`{"kind":"patients","ids":[≤50000]}\` | explicit list, intersected with the study |
| \`profiled\` | \`{"kind":"profiled","type":"MUTATION"\\|"CNA"\\|"SV"}\` | patient has a sample on a gene panel for that data type — combine with \`not\` to separate wild-type from not-profiled |
| \`caseList\` | \`{"kind":"caseList","id":"sequenced"}\` | portal sample list; bare ids get the study prefix |
| \`genomicData\` | \`{"kind":"genomicData","gene":G,"profileType":P,"range"\\|"values"}\` | continuous per-gene values (cna, mrna z-scores, …); unknown profiles error listing what the study has |
| \`genericAssay\` | \`{"kind":"genericAssay","profileType":P,"entity":E,"range"\\|"values"}\` | generic assay values (mutational signatures, …) |
| \`alteration\` | *(deprecated)* | translated to OQL internally; do not write new ones |

### OQL subset

\`q\` is 1–10 entries separated by \`;\`, each \`GENE\` (any alteration) or \`GENE: spec spec ...\`.
A patient matches if **any** entry matches (portal "altered in query" semantics).

- Mutations: \`MUT\`, \`MUT=<protein change>\` (e.g. \`MUT=G12C\`), classes \`MISSENSE NONSENSE TRUNC INFRAME SPLICE\`; bare \`G12C\` is protein-change shorthand.
- Copy number: \`AMP\`, \`HOMDEL\`, \`CNA\` (either, high-level ±2 only).
- Structural variants: \`FUSION\`.
- Drivers: \`DRIVER\` alone (any driver alteration) or as modifier (\`MUT_DRIVER\`, \`DRIVER_G12D\`, \`TRUNC_DRIVER\`). Requires the version-pinned OncoKB annotation store; the pin is reported in every result.
- Expression: \`EXP>z EXP<z PROT>z\` — only in studies with mRNA/protein profiles (errors otherwise, listing available profiles).
- **Rejected loudly** (never silently approximated): \`GAIN HETLOSS GERMLINE SOMATIC PROMOTER\`.

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
  claims; ~20% of MSK-CHORD patients had prior treatment elsewhere).
- **"Treatment line (derived)"** is synthesized at query time from treatment gaps (\`lineGap\`,
  default 90 days) and supports attrs \`LINE_NO\`, \`COMPOSITION\`, \`GAP\`.

## Views

| kind | fields | semantics |
|---|---|---|
| \`compare\` | \`genes:[≤20], cohorts?:[names]\` | per-gene driver% / altered% per cohort with **panel-aware denominators** (profiled patients only); two-sided Fisher p when exactly 2 cohorts |
| \`clinical\` | \`attributes:[\u22641-20], cohorts?:[names]\` | compares clinical attribute distributions across cohorts. Categorical: Pearson chi-squared over the **full** value vocabulary. Numeric: Welch's t from (n, \u03a3x, \u03a3x\u00b2) \u2014 additive across sites, so pooled mean/variance are exact and no individual value is transmitted. BH q across attributes. Each site types its own attributes from \`clinical_attribute_meta\`; disagreements are refused, not merged |
| \`cooccurrence\` | \`genes:[2-12], cohorts?:[names]\` | pairwise co-occurrence / mutual exclusivity **within one cohort** (the first named). Each pair's 2×2 is counted among patients profiled for **both** genes, per study against that study's own panels; log₂ odds ratio, two-sided Fisher, Benjamini–Hochberg q across pairs. Across studies the test is **stratified by study** (Cochran–Mantel–Haenszel). Pairs no panel covers are reported as not assessable, never as a null result |
| \`survival\` | \`endpoint?:"OS"|"PFS"|…, anchor?:{eventType,key?,value?,occurrence?}, cohorts?:[names]\` | Kaplan–Meier on OS_MONTHS/OS_STATUS, plus a two-sided **log-rank** test when exactly 2 cohorts. Across studies the test is **stratified by study** (each study compared only against itself, so differing case mix cannot masquerade as a cohort effect); the pooled p is reported alongside. \`anchor\` resets the clock to a timeline event (first chemotherapy, initial diagnosis) instead of the study's day 0, and **applies left truncation automatically**: a patient joins the risk set when the study could first observe them, never at the anchor \u2014 otherwise everyone appears to survive from the anchor to their own entry, which is exactly what put them in the study. The reported entry distribution warns when an anchor is matching earlier events than intended. Cross-study baselines are not harmonized |
| \`course\` | \`eventTypes:[\u22646], anchor?:{eventType,key?,value?,occurrence?}, binMonths?:3, fromMonths?:-12, toMonths?:60, cohorts?:[names]\` | the **clinical course**: per time bin, the share of the cohort in each event state. Two things it refuses to fake. (1) The denominator is the patients still under observation in that bin \u2014 first recorded event to last contact (the later of their last event and their OS follow-up) \u2014 never the whole cohort, which would make a curve fall merely because follow-up ran out. (2) \`anchor\` is optional for one study but **required across studies**: day 0 is birth in some studies and first sequencing in others, and nothing in the schema records which, so raw day 0 compares incomparable clocks. Event types that carry real durations are drawn as a state the patient is IN; the rest as an event that HAPPENED \u2014 read from the data, not from the name. Bins are half-open [t, t+w). Event-name spellings differing only in case are folded (\`Treatment\`/\`TREATMENT\`) and the fold is named in the caveat; nothing else is merged |
| \`sequence\` | \`labelKey?:"SUBTYPE", eventType?:"treatment", exclude?:[values], lineGap?:90, maxSteps?:3, topN?:8, cohorts?:[names]\` | **what follows what**: therapy transitions as lines, drawn as a Sankey. Records are first grouped into LINES \u2014 therapies less than \`lineGap\` days apart are one line, labelled by their whole combination (sorted, so \`A + B\` and \`B + A\` are one regimen). That grouping is the point: a patient has a median of 6 treatment records and 4 distinct agents, and combination therapy is several records describing ONE decision. Patients who begin no further line flow into an explicit terminal node, so flows out of a node sum to it and attrition \u2014 usually the largest flow \u2014 cannot vanish. \`exclude\` drops label values that are not therapies; it is a parameter and not an engine rule because such markers are **not structurally distinguishable** (MSK\u2019s \`Prior Medications to MSK\` carries no duration, but neither do \`Radiation Therapy\` or \`Investigational\`), so the choice belongs in the document where a reader can see it. One cohort only |
| \`oncoprint\` | \`genes:[≤12], clinical?:[≤8], heatmap?:[≤4], sort?:[≤4], cohorts?:[names]\` | render-contract oncoprint: columns are patients grouped by cohort (first matching cohort wins); NOT_PROFILED is a first-class cell state |

\`views[].cohorts\` defaults to all cohorts. Oncoprints federate across studies: columns are
study-qualified, a synthetic **Study** track shows each column's origin, and duplicates appear twice.

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
\`GENE <short-profile>\` (e.g. \`ERBB2 mRNA-z\`) and are valid \`sort\` keys. Unknown profiles
error loudly, listing what the study has. The synthetic profile \`"VAF"\` renders variant allele
fraction computed from mutation allele counts (max across a patient's mutations in the gene,
fixed 0–1 ramp) — available wherever the study loaded tumor alt/ref counts.

\`reference: "federation"\` re-scores those values against a distribution pooled from **every**
participating study — including instances that disclose no patients and so contribute no columns.
Each returns three totals per gene (n, \u03a3x, \u03a3x\u00b2), which is all a mean and standard deviation need,
so the reference population can be far larger than the drawn one without any value moving.

**Oncoprint sorting**: \`sort\` is an ordered list of track keys — \`"genomic"\` (the default
staircase: alteration type + driver rank across the gene tracks), a clinical or derived-event track
label, or \`"-label"\` for descending (e.g. \`["CANCER_TYPE", "-CURRENT_AGE_DEID"]\`). Applied
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
  "heatmap"?: [{ "profileType": P, "genes"?: [...] } × ≤4],                   // continuous molecular tracks
  "sort"?: ["CANCER_TYPE", "-CURRENT_AGE_DEID", "genomic"],                   // column sort (≤4 keys)
  "derivedEvents": [{ "label": L, "expression": <event cohortDef> } × ≤3],   // phenotype tracks
  "cohort"?: { "dsl": <cohortDef> },                                          // single column group
  "layout"?: { "groupBy": { "kind": "cohorts", "groups": [{name,dsl} × ≤4] } },
  "conventions"?: { "lineGap": 90 } }
\`\`\`

Cell values are bitmasks (MISSENSE 1, TRUNCATING 2, INFRAME 4, SPLICE 8, OTHER_MUT 16, SV 32,
AMP 64, HOMDEL 128, DRIVER 256); −1 is NOT_PROFILED. Frequencies use profiled denominators.
Shareable links: \`/oncoprint?spec=<base64url>\`.

## Endpoints

| endpoint | takes |
|---|---|
| \`POST /api/analysis\` | Analysis document → cohorts (counts, readback, SQL provenance) + views |
| \`POST /api/explore\` | \`{study, draft?}\` → faceted catalog (clinical/events/genes/case lists), counts conditioned on the draft |
| \`POST /api/oncoprint\` | OncoprintSpec → render contract |
| \`POST /api/cohort\` | v1 event DSL → count + histogram + provenance |
| \`GET /api/catalog?study=\` | event-type / attribute vocabulary for the event sub-DSL |
| \`GET /api/studies\` | all loadable studies |

## Examples

Every example below is executed against the live compiler by \`npm run docs:check\`
(part of the e2e suite) — if one breaks, the build fails.

${EXAMPLES.map(exampleBlock).join("\n")}
`;
}

// ---- compact grammar for the chat system prompt ----------------------------
// Keep this the terse twin of the markdown above; both live in this file so
// they are reviewed together. Behavioral guidance stays in the chat route.
export const CHAT_GRAMMAR = `Document shape:
{ "study": "<default study id>",
  "cohorts": { "<name>": <cohortDef>, ... (max 6) },
  "views": [ {"kind":"compare","genes":[...(max 20)],"cohorts":[names?]},
             {"kind":"survival","endpoint":"OS|PFS|DFS|…","anchor":{"eventType":"Treatment","key":"SUBTYPE","value":"Chemo","occurrence":"FIRST"},"cohorts":[names?]},
             {"kind":"cooccurrence","genes":[...(2-12)],"cohorts":[names?]},
             {"kind":"clinical","attributes":[...(1-20)],"cohorts":[names?]},
             {"kind":"coexpression","genes":[...(2-12)],"profileType":"<mrna profile>","cohorts":[names?]},
             {"kind":"hotspots","genes":[...(max 12)],"cohorts":[names?],"minCount":1},
             {"kind":"course","eventTypes":[...(max 6)],"anchor":{"eventType":"Treatment","occurrence":"FIRST"},
              "binMonths":3,"fromMonths":-12,"toMonths":60,"cohorts":[names?]},
             {"kind":"sequence","labelKey":"SUBTYPE","eventType":"treatment","exclude":[values?],
              "lineGap":90,"maxSteps":3,"topN":8,"cohorts":[names?]},
             {"kind":"oncoprint","genes":[...(max 12)],"clinical":["<attribute>", ...(max 8)]?,
              "heatmap":[{"profileType":"<profile>","genes":[...]?}, ...(max 4)]?,
              "sort":["<track>"|"-<track>"|"genomic", ...(max 4)]?,"cohorts":[names?]} ] }

Oncoprint clinical tracks: any clinical attribute name works (patient- or sample-level; sample-level
falls back to one sample's value per patient). Numeric attributes (age, TMB, ...) render as a
continuous heat track with a min→max key; unknown attributes render a labeled "(no data)" track.
Oncoprint heatmap: continuous molecular-profile rows per gene (genes default to the gene tracks);
profile must exist in the study (get_catalog lists them; e.g. rna_seq_v2_mrna_median_Zscores in TCGA studies);
z-scores render on a fixed diverging ±3 ramp; the synthetic profile "VAF" renders mutation variant
allele fraction (needs loaded allele counts); track label = "GENE <short>" (e.g. "ERBB2 mRNA-z",
"TP53 VAF") and is a valid sort key.
Oncoprint sort: ordered track keys — "genomic" (default staircase), a clinical track label (must also
be in clinical), or "-label" descending; missing values sort last; staircase + patient id are the
final tiebreakers. Example: "sort":["CANCER_TYPE","-CURRENT_AGE_DEID"].

cohortDef: { "all": [clause, ...(max 8)], "study"?: "<id>", "studies"?: ["<id>", ...] } — clauses ANDed; an empty all[] is every patient in the study;
a cohort may target another study or union across several (members are study-qualified; overlap
across studies is NOT deduplicated — say so when comparing). Oncoprint views federate too: cross-study
columns are qualified per study (duplicates appear twice) and a Study track shows each column's origin.
clause = leaf | {"any":[leaf,...]} | {"not":leaf}.
Leaf kinds:
- {"kind":"oql","q":"STK11: DRIVER"} — genomic status in cBioPortal OQL (preferred; full notes below).
- {"kind":"derived","metric":"followupMonths","range":{"gte":24}} (also historyMonths, alteredGenes \u2014 computed from data shape, not study vocabulary)
- {"kind":"clinical","attribute":"GENDER","op":"=","value":"Male"} (ops = != > >= < <=; numeric values compare numerically).
  Useful attributes: OS_STATUS (0:LIVING/1:DECEASED), OS_MONTHS, GENDER, RACE, CURRENT_AGE_DEID,
  SMOKING_PREDICTIONS_3_CLASSES (Former/Current Smoker, Never, Unknown), CANCER_TYPE-site flags (LUNG, LIVER, BONE... values Yes/No).
- {"kind":"event", "a":{selector}, "b":{selector}?, "rel":{...}, "priorGuard":bool} — timeline DSL:
  selectors: eventType (Treatment, Diagnosis, Lab_Test, Surgery, Pathology, "Treatment line (derived)"),
  attrs [{key,value}] (Treatment SUBTYPE: Immuno/Chemo/Targeted/Hormone/Biologic/Radiation Therapy;
  Diagnosis PROGRESSION=Y; Lab_Test TEST: PSA/CEA/CA 15-3/CA 19-9 with numeric{key:"RESULT",op,value});
  occurrence ANY|FIRST|LAST. rel: {"type":"NONE"} | {"type":"BEFORE","minDays":0,"maxDays":N} |
  {"type":"DURING"} | {"type":"NOT_FOLLOWED_BY","withinDays":N,"observed":true}.
  For absence queries ALWAYS set observed:true (else "no event" conflates with lost-to-follow-up).
  priorGuard:true restricts to treatment-naive patients — REQUIRED for honest "first-line" claims
  (~20% of patients had prior treatment elsewhere, ~20% undetermined).
- {"kind":"patients","ids":[...]} — explicit list.
- {"kind":"clinical",...} also supports "values":[...] (OR across values), "range":{"gte":60,"lt":80}
  (numeric), and "per":"sample" (patient matches if ANY sample matches — say so when used).
- {"kind":"profiled","type":"MUTATION"|"CNA"|"SV"} — patient was profiled for that data type
  (use with {"not":...} to distinguish wild-type from not-profiled).
- {"kind":"caseList","id":"sequenced"|"cna"|full stable id} — portal case lists.
- {"kind":"genomicData","gene":"CDKN2A","profileType":"cna","range":{"lte":-2}} — continuous
  per-gene values; profile must exist in the study or it errors listing what does.
- OQL EXP>z / PROT>z work only if the study has mRNA/protein profiles (msk_chord does not).
- OQL details for {"kind":"oql"}: per gene MUT,
  MUT=<pchange>, MISSENSE/NONSENSE/TRUNC/INFRAME/SPLICE, AMP, HOMDEL, FUSION, DRIVER and _DRIVER
  modifiers; entries separated by ';' are OR'd (portal "altered in query" semantics).
  GAIN/HETLOSS/GERMLINE/SOMATIC/PROMOTER are always rejected; EXP/PROT are rejected in studies
  without mRNA/protein profiles — do not use any of these there.`;
