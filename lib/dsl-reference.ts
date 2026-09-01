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

export interface DslExample { title: string; note: string; doc: AnalysisDoc }

// ---- runnable examples (rendered into the doc AND executed by docs:check) --
export const EXAMPLES: DslExample[] = [
  {
    title: "Genomic status via OQL, compared",
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
    title: "any / not / genomicData",
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
    title: "Clinical attributes compared between cohorts",
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
    title: "Study-stratified survival across two studies",
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
cohortDef := { "all": [clause × 1-8],         // ANDed (INTERSECT DISTINCT)
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
| \`clinical\` | \`{"kind":"clinical","attribute":A, ...predicate, "per"?:"sample"}\` | clinical attribute; predicate is \`values:[≤50]\` (OR), \`range:{gt,gte,lt,lte}\` (numeric via toFloat64OrNull), or \`op\`(\`= != > >= < <=\`)+\`value\`; \`per:"sample"\` = patient matches if ANY sample matches |
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
| \`survival\` | \`cohorts?:[names]\` | Kaplan–Meier on OS_MONTHS/OS_STATUS, plus a two-sided **log-rank** test when exactly 2 cohorts. Across studies the test is **stratified by study** (each study compared only against itself, so differing case mix cannot masquerade as a cohort effect); the pooled p is reported alongside. Left truncation caveat applies; cross-study baselines are not harmonized |
| \`oncoprint\` | \`genes:[≤12], clinical?:[≤8], heatmap?:[≤4], sort?:[≤4], cohorts?:[names]\` | render-contract oncoprint: columns are patients grouped by cohort (first matching cohort wins); NOT_PROFILED is a first-class cell state |

\`views[].cohorts\` defaults to all cohorts. Oncoprints federate across studies: columns are
study-qualified, a synthetic **Study** track shows each column's origin, and duplicates appear twice.

**Oncoprint clinical tracks**: any attribute name; patient-level rows win, sample-level attributes
fall back to one sample value per patient. Numeric attributes (≥90% parseable, >10 distinct) render
as a continuous heat track scaled to the cohort's min→max with a gradient key; unknown attributes
render a labeled "(no data)" track.

**Oncoprint heatmap tracks** (portal-style): \`heatmap: [{"profileType": P, "genes"?: [...]}]\` adds
one continuous row per gene from a molecular profile (mRNA/protein z-scores, methylation, log2 CNA,
…; \`genes\` defaults to the gene tracks). Values are patient-level (mean across a patient's
samples, since columns are patients). Z-score profiles render on a **fixed diverging ±3
blue→white→red ramp** so colors are comparable across oncoprints; other sign-spanning data gets a
symmetric diverging ramp; positive-only data a sequential ramp. Track labels are
\`GENE <short-profile>\` (e.g. \`ERBB2 mRNA-z\`) and are valid \`sort\` keys. Unknown profiles
error loudly, listing what the study has. The synthetic profile \`"VAF"\` renders variant allele
fraction computed from mutation allele counts (max across a patient's mutations in the gene,
fixed 0–1 ramp) — available wherever the study loaded tumor alt/ref counts.

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
             {"kind":"survival","cohorts":[names?]},
             {"kind":"cooccurrence","genes":[...(2-12)],"cohorts":[names?]},
             {"kind":"clinical","attributes":[...(1-20)],"cohorts":[names?]},
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

cohortDef: { "all": [clause, ...(max 8)], "study"?: "<id>", "studies"?: ["<id>", ...] } — clauses ANDed;
a cohort may target another study or union across several (members are study-qualified; overlap
across studies is NOT deduplicated — say so when comparing). Oncoprint views federate too: cross-study
columns are qualified per study (duplicates appear twice) and a Study track shows each column's origin.
clause = leaf | {"any":[leaf,...]} | {"not":leaf}.
Leaf kinds:
- {"kind":"oql","q":"STK11: DRIVER"} — genomic status in cBioPortal OQL (preferred; full notes below).
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
