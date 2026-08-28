<!-- GENERATED FILE — do not edit. Source: lib/dsl-reference.js; regenerate with `npm run docs:gen`. -->

# Cohort Lab DSL (v2.2)

One declarative JSON object — the **Analysis document** — describes everything Cohort Lab does:
which patients form each cohort, and which views compare them. The server compiles it to
ClickHouse SQL (`lib/cohort2.js`, `lib/oql.js`, `lib/compiler.js`, `lib/analysis.js`);
clients never send SQL. Every result carries provenance: the definition readback and the exact
SQL each cohort compiled to.

## Analysis document

```
{ "study":   "<default study id>",            // validated against cancer_study
  "cohorts": { "<name>": cohortDef, ... },    // max 6
  "views":   [ view, ... ] }                  // max 6
```

Sent to `POST /api/analysis`, edited by the in-app chat, and encoded in shareable
`/analysis?doc=<base64url>` links.

## Cohort definitions

```
cohortDef := { "all": [clause × 1-8],         // ANDed (INTERSECT DISTINCT)
               "study"?:   "<id>",            // evaluate in another study
               "studies"?: ["<id>", ...],     // union across studies (federated, no count limit)
               "lineGap"?: 90 }               // derived-treatment-line gap, days
clause    := leaf | { "any": [leaf × 1-8] }   // OR (UNION DISTINCT)
                  | { "not": leaf }           // study base EXCEPT leaf
```

**Cross-study semantics.** A cohort with `studies` is compiled per study (compilers are
single-study by design); members are study-qualified patient ids. Patient overlap across studies
is deliberately **not** deduplicated, and clinical vocabularies are **not** harmonized — views
say so in their captions.

### Leaf kinds

| kind | shape | meaning |
|---|---|---|
| `oql` | `{"kind":"oql","q":"STK11: DRIVER"}` | genomic status in cBioPortal OQL (see below) |
| `clinical` | `{"kind":"clinical","attribute":A, ...predicate, "per"?:"sample"}` | clinical attribute; predicate is `values:[≤50]` (OR), `range:{gt,gte,lt,lte}` (numeric via toFloat64OrNull), or `op`(`= != > >= < <=`)+`value`; `per:"sample"` = patient matches if ANY sample matches |
| `event` | `{"kind":"event","a":sel,"b"?:sel,"rel":rel,"priorGuard"?:bool,"lineGap"?:90}` | timeline sub-DSL (below) |
| `patients` | `{"kind":"patients","ids":[≤50000]}` | explicit list, intersected with the study |
| `profiled` | `{"kind":"profiled","type":"MUTATION"\|"CNA"\|"SV"}` | patient has a sample on a gene panel for that data type — combine with `not` to separate wild-type from not-profiled |
| `caseList` | `{"kind":"caseList","id":"sequenced"}` | portal sample list; bare ids get the study prefix |
| `genomicData` | `{"kind":"genomicData","gene":G,"profileType":P,"range"\|"values"}` | continuous per-gene values (cna, mrna z-scores, …); unknown profiles error listing what the study has |
| `genericAssay` | `{"kind":"genericAssay","profileType":P,"entity":E,"range"\|"values"}` | generic assay values (mutational signatures, …) |
| `alteration` | *(deprecated)* | translated to OQL internally; do not write new ones |

### OQL subset

`q` is 1–10 entries separated by `;`, each `GENE` (any alteration) or `GENE: spec spec ...`.
A patient matches if **any** entry matches (portal "altered in query" semantics).

- Mutations: `MUT`, `MUT=<protein change>` (e.g. `MUT=G12C`), classes `MISSENSE NONSENSE TRUNC INFRAME SPLICE`; bare `G12C` is protein-change shorthand.
- Copy number: `AMP`, `HOMDEL`, `CNA` (either, high-level ±2 only).
- Structural variants: `FUSION`.
- Drivers: `DRIVER` alone (any driver alteration) or as modifier (`MUT_DRIVER`, `DRIVER_G12D`, `TRUNC_DRIVER`). Requires the version-pinned OncoKB annotation store; the pin is reported in every result.
- Expression: `EXP>z EXP<z PROT>z` — only in studies with mRNA/protein profiles (errors otherwise, listing available profiles).
- **Rejected loudly** (never silently approximated): `GAIN HETLOSS GERMLINE SOMATIC PROMOTER`.

### Event sub-DSL (timeline)

The v1 language, embedded as an `event` leaf (the flat v1 shape `{a,b,rel,...}` is also accepted
anywhere a cohortDef is expected, for back-compat).

```
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
```

- **Exists-pair semantics**: a patient qualifies if at least one (A,B) occurrence pair satisfies
  the relation; results are distinct patients.
- **Absence queries**: always set `"observed": true` on NOT_FOLLOWED_BY, restricting to patients
  whose follow-up actually covers the window — otherwise "no event" conflates with lost-to-follow-up.
- **`priorGuard: true`** restricts to treatment-naive patients (required for honest "first-line"
  claims; ~20% of MSK-CHORD patients had prior treatment elsewhere).
- **"Treatment line (derived)"** is synthesized at query time from treatment gaps (`lineGap`,
  default 90 days) and supports attrs `LINE_NO`, `COMPOSITION`, `GAP`.

## Views

| kind | fields | semantics |
|---|---|---|
| `compare` | `genes:[≤20], cohorts?:[names]` | per-gene driver% / altered% per cohort with **panel-aware denominators** (profiled patients only); two-sided Fisher p when exactly 2 cohorts |
| `survival` | `cohorts?:[names]` | Kaplan–Meier on OS_MONTHS/OS_STATUS; left truncation caveat applies; cross-study baselines are not harmonized |
| `oncoprint` | `genes:[≤12], clinical?:[≤8], heatmap?:[≤4], sort?:[≤4], cohorts?:[names]` | render-contract oncoprint: columns are patients grouped by cohort (first matching cohort wins); NOT_PROFILED is a first-class cell state |

`views[].cohorts` defaults to all cohorts. Oncoprints federate across studies: columns are
study-qualified, a synthetic **Study** track shows each column's origin, and duplicates appear twice.

**Oncoprint clinical tracks**: any attribute name; patient-level rows win, sample-level attributes
fall back to one sample value per patient. Numeric attributes (≥90% parseable, >10 distinct) render
as a continuous heat track scaled to the cohort's min→max with a gradient key; unknown attributes
render a labeled "(no data)" track.

**Oncoprint heatmap tracks** (portal-style): `heatmap: [{"profileType": P, "genes"?: [...]}]` adds
one continuous row per gene from a molecular profile (mRNA/protein z-scores, methylation, log2 CNA,
…; `genes` defaults to the gene tracks). Values are patient-level (mean across a patient's
samples, since columns are patients). Z-score profiles render on a **fixed diverging ±3
blue→white→red ramp** so colors are comparable across oncoprints; other sign-spanning data gets a
symmetric diverging ramp; positive-only data a sequential ramp. Track labels are
`GENE <short-profile>` (e.g. `ERBB2 mRNA-z`) and are valid `sort` keys. Unknown profiles
error loudly, listing what the study has. The synthetic profile `"VAF"` renders variant allele
fraction computed from mutation allele counts (max across a patient's mutations in the gene,
fixed 0–1 ramp) — available wherever the study loaded tumor alt/ref counts.

**Oncoprint sorting**: `sort` is an ordered list of track keys — `"genomic"` (the default
staircase: alteration type + driver rank across the gene tracks), a clinical or derived-event track
label, or `"-label"` for descending (e.g. `["CANCER_TYPE", "-CURRENT_AGE_DEID"]`). Applied
within each cohort group; missing values always sort last; the genomic staircase and patient id are
always the final tiebreakers. A sort key that names a track not in the oncoprint errors loudly,
listing the sortable tracks. The effective sort is echoed in `conventions.sort`.

## OncoprintSpec (standalone)

The builder page (`/oncoprint`), `POST /api/oncoprint`, and the MCP `render_oncoprint` tool
take a standalone spec (the analysis oncoprint view compiles to the same engine):

```
{ "study"?: "<id>",
  "genes": [≤12],
  "clinical": [≤8],
  "heatmap"?: [{ "profileType": P, "genes"?: [...] } × ≤4],                   // continuous molecular tracks
  "sort"?: ["CANCER_TYPE", "-CURRENT_AGE_DEID", "genomic"],                   // column sort (≤4 keys)
  "derivedEvents": [{ "label": L, "expression": <event cohortDef> } × ≤3],   // phenotype tracks
  "cohort"?: { "dsl": <cohortDef> },                                          // single column group
  "layout"?: { "groupBy": { "kind": "cohorts", "groups": [{name,dsl} × ≤4] } },
  "conventions"?: { "lineGap": 90 } }
```

Cell values are bitmasks (MISSENSE 1, TRUNCATING 2, INFRAME 4, SPLICE 8, OTHER_MUT 16, SV 32,
AMP 64, HOMDEL 128, DRIVER 256); −1 is NOT_PROFILED. Frequencies use profiled denominators.
Shareable links: `/oncoprint?spec=<base64url>`.

## Endpoints

| endpoint | takes |
|---|---|
| `POST /api/analysis` | Analysis document → cohorts (counts, readback, SQL provenance) + views |
| `POST /api/explore` | `{study, draft?}` → faceted catalog (clinical/events/genes/case lists), counts conditioned on the draft |
| `POST /api/oncoprint` | OncoprintSpec → render contract |
| `POST /api/cohort` | v1 event DSL → count + histogram + provenance |
| `GET /api/catalog?study=` | event-type / attribute vocabulary for the event sub-DSL |
| `GET /api/studies` | all loadable studies |

## Examples

Every example below is executed against the live compiler by `npm run docs:check`
(part of the e2e suite) — if one breaks, the build fails.

### Example 1: Genomic status via OQL, compared

STK11 putative drivers vs wild-type (wild-type = NOT any STK11 alteration, so it includes not-profiled unless you add a profiled clause). Two views: co-alteration frequencies and overall survival.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "STK11 driver": {
      "all": [
        {
          "kind": "oql",
          "q": "STK11: DRIVER"
        }
      ]
    },
    "STK11 wt": {
      "all": [
        {
          "not": {
            "kind": "oql",
            "q": "STK11:"
          }
        },
        {
          "kind": "profiled",
          "type": "MUTATION"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "compare",
      "genes": [
        "KEAP1",
        "KRAS",
        "TP53"
      ]
    },
    {
      "kind": "survival"
    }
  ]
}
```

### Example 2: Clinical + timeline event composition

Never-smokers whose timeline shows progression within 180 days after first immunotherapy. The event leaf is the v1 timeline sub-DSL embedded as a clause.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "never-smoker fast progressors": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "SMOKING_PREDICTIONS_3_CLASSES",
          "values": [
            "Never"
          ]
        },
        {
          "kind": "event",
          "a": {
            "eventType": "Treatment",
            "attrs": [
              {
                "key": "SUBTYPE",
                "value": "Immuno"
              }
            ],
            "occurrence": "FIRST"
          },
          "b": {
            "eventType": "Diagnosis",
            "attrs": [
              {
                "key": "PROGRESSION",
                "value": "Y"
              }
            ]
          },
          "rel": {
            "type": "BEFORE",
            "maxDays": 180
          }
        }
      ]
    }
  },
  "views": [
    {
      "kind": "compare",
      "genes": [
        "STK11",
        "KEAP1",
        "TP53"
      ]
    }
  ]
}
```

### Example 3: any / not / genomicData

Colorectal or pancreatic patients (OR inside one clause), excluding CDKN2A deep deletions expressed as a continuous copy-number threshold.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "CRC/PAAD without CDKN2A loss": {
      "all": [
        {
          "any": [
            {
              "kind": "clinical",
              "attribute": "CANCER_TYPE",
              "values": [
                "Colorectal Cancer"
              ],
              "per": "sample"
            },
            {
              "kind": "clinical",
              "attribute": "CANCER_TYPE",
              "values": [
                "Pancreatic Cancer"
              ],
              "per": "sample"
            }
          ]
        },
        {
          "not": {
            "kind": "genomicData",
            "gene": "CDKN2A",
            "profileType": "cna",
            "range": {
              "lte": -2
            }
          }
        }
      ]
    }
  },
  "views": [
    {
      "kind": "compare",
      "genes": [
        "KRAS",
        "TP53",
        "APC",
        "SMAD4"
      ]
    }
  ]
}
```

### Example 4: Cross-study federation with an oncoprint

One cohort unioned across two studies (members are study-qualified; overlap is NOT deduplicated), rendered as a federated oncoprint with a categorical and a numeric clinical track, columns sorted by cancer type then descending age. The Study track is added automatically.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "TP53-mut, CHORD+MET": {
      "studies": [
        "msk_chord_2024",
        "msk_met_2021"
      ],
      "all": [
        {
          "kind": "oql",
          "q": "TP53: MUT"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "oncoprint",
      "genes": [
        "TP53",
        "KRAS",
        "EGFR"
      ],
      "clinical": [
        "CANCER_TYPE",
        "CURRENT_AGE_DEID"
      ],
      "sort": [
        "CANCER_TYPE",
        "-CURRENT_AGE_DEID"
      ]
    }
  ]
}
```

### Example 5: Molecular heatmap tracks, sorted by expression

ERBB2-amplified TCGA breast tumors with an mRNA z-score heatmap under the gene tracks, columns sorted by descending ERBB2 expression. Z-scores render on a fixed diverging ±3 ramp; the track label (gene + short profile name) is the sort key.

```json
{
  "study": "brca_tcga_pan_can_atlas_2018",
  "cohorts": {
    "ERBB2 amp": {
      "all": [
        {
          "kind": "oql",
          "q": "ERBB2: AMP"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "oncoprint",
      "genes": [
        "ERBB2",
        "EGFR",
        "PIK3CA"
      ],
      "heatmap": [
        {
          "profileType": "rna_seq_v2_mrna_median_Zscores"
        }
      ],
      "sort": [
        "-ERBB2 mRNA-z"
      ]
    }
  ]
}
```

