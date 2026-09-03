<!-- GENERATED FILE — do not edit. Source: lib/dsl-reference.ts; regenerate with `npm run docs:gen`. -->

# Cohort Lab DSL (v2.2)

One declarative JSON object — the **Analysis document** — describes everything Cohort Lab does:
which patients form each cohort, and which views compare them. The server compiles it to
ClickHouse SQL (`lib/cohort2.ts`, `lib/oql.ts`, `lib/compiler.ts`, `lib/analysis.ts`);
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
cohortDef := { "all": [clause × 0-8],         // ANDed; [] means every patient in the study
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
| `hotspots` | `genes:[≤12], cohorts?:[names], minCount?` | recurrent protein changes per gene (the lollipop's data): patients carrying each change, as a share of those with ANY mutation in that gene. The codon is parsed from the change string, since the schema stores no position. `minCount` is a suppression floor each site applies **before returning anything** — a variant carried by one patient is the most disclosive aggregate here |
| `coexpression` | `genes:[2-12], profileType, cohorts?:[names]` | Pearson correlation between gene pairs on a continuous molecular profile, **within one cohort** (the first named). Each site reports only six sums (n, Σx, Σy, Σxy, Σx², Σy²), which are additive — so the federated correlation is exact, not approximate. Across studies a Fisher-z meta-analysis of per-study correlations is reported alongside the pooled one |
| `clinical` | `{"kind":"clinical","attribute":A, ...predicate, "per"?:"sample"}` | clinical attribute; predicate is `values:[≤50]` (OR), `range:{gt,gte,lt,lte}` (numeric via toFloat64OrNull), or `op`(`= != > >= < <=`)+`value`; `per:"sample"` = patient matches if ANY sample matches |
| `derived` | `{"kind":"derived","metric":"followupMonths"|"historyMonths"|"alteredGenes","range":{gte?,gt?,lte?,lt?}}` | filters on a value computed from the **shape** of the data rather than a study's vocabulary. Event-type names and attribute keys are study-specific — this database spells one concept `Treatment` in 87 studies and `TREATMENT` in 10, and the key MSK-CHORD calls `SUBTYPE` exists in only 27 of 131 timeline studies — so these read dates and gene symbols instead and mean the same thing everywhere. `followupMonths`: how far the timeline runs past its own day 0. `historyMonths`: how much predates it. `alteredGenes`: distinct genes altered (panel size bounds it, so not comparable across studies with different panels) |
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
| `clinical` | `attributes:[≤1-20], cohorts?:[names]` | compares clinical attribute distributions across cohorts. Categorical: Pearson chi-squared over the **full** value vocabulary. Numeric: Welch's t from (n, Σx, Σx²) — additive across sites, so pooled mean/variance are exact and no individual value is transmitted. BH q across attributes. Each site types its own attributes from `clinical_attribute_meta`; disagreements are refused, not merged |
| `cooccurrence` | `genes:[2-12], cohorts?:[names]` | pairwise co-occurrence / mutual exclusivity **within one cohort** (the first named). Each pair's 2×2 is counted among patients profiled for **both** genes, per study against that study's own panels; log₂ odds ratio, two-sided Fisher, Benjamini–Hochberg q across pairs. Across studies the test is **stratified by study** (Cochran–Mantel–Haenszel). Pairs no panel covers are reported as not assessable, never as a null result |
| `survival` | `endpoint?:"OS"|"PFS"|…, anchor?:{eventType,key?,value?,occurrence?}, cohorts?:[names]` | Kaplan–Meier on OS_MONTHS/OS_STATUS, plus a two-sided **log-rank** test when exactly 2 cohorts. Across studies the test is **stratified by study** (each study compared only against itself, so differing case mix cannot masquerade as a cohort effect); the pooled p is reported alongside. `anchor` resets the clock to a timeline event (first chemotherapy, initial diagnosis) instead of the study's day 0, and **applies left truncation automatically**: a patient joins the risk set when the study could first observe them, never at the anchor — otherwise everyone appears to survive from the anchor to their own entry, which is exactly what put them in the study. The reported entry distribution warns when an anchor is matching earlier events than intended. Cross-study baselines are not harmonized |
| `course` | `eventTypes:[≤6], anchor?:{eventType,key?,value?,occurrence?}, binMonths?:3, fromMonths?:-12, toMonths?:60, cohorts?:[names]` | the **clinical course**: per time bin, the share of the cohort in each event state. Two things it refuses to fake. (1) The denominator is the patients still under observation in that bin — first recorded event to last contact (the later of their last event and their OS follow-up) — never the whole cohort, which would make a curve fall merely because follow-up ran out. (2) `anchor` is optional for one study but **required across studies**: day 0 is birth in some studies and first sequencing in others, and nothing in the schema records which, so raw day 0 compares incomparable clocks. Event types that carry real durations are drawn as a state the patient is IN; the rest as an event that HAPPENED — read from the data, not from the name. Bins are half-open [t, t+w). Event-name spellings differing only in case are folded (`Treatment`/`TREATMENT`) and the fold is named in the caveat; nothing else is merged |
| `sequence` | `labelKey?:"SUBTYPE", eventType?:"treatment", exclude?:[values], lineGap?:90, maxSteps?:3, topN?:8, cohorts?:[names]` | **what follows what**: therapy transitions as lines, drawn as a Sankey. Records are first grouped into LINES — therapies less than `lineGap` days apart are one line, labelled by their whole combination (sorted, so `A + B` and `B + A` are one regimen). That grouping is the point: a patient has a median of 6 treatment records and 4 distinct agents, and combination therapy is several records describing ONE decision. Patients who begin no further line flow into an explicit terminal node, so flows out of a node sum to it and attrition — usually the largest flow — cannot vanish. `exclude` drops label values that are not therapies; it is a parameter and not an engine rule because such markers are **not structurally distinguishable** (MSK’s `Prior Medications to MSK` carries no duration, but neither do `Radiation Therapy` or `Investigational`), so the choice belongs in the document where a reader can see it. One cohort only |
| `oncoprint` | `genes:[≤12], clinical?:[≤8], heatmap?:[≤4], sort?:[≤4], cohorts?:[names]` | render-contract oncoprint: columns are patients grouped by cohort (first matching cohort wins); NOT_PROFILED is a first-class cell state |

`views[].cohorts` defaults to all cohorts. Oncoprints federate across studies: columns are
study-qualified, a synthetic **Study** track shows each column's origin, and duplicates appear twice.

**Oncoprint clinical tracks**: any attribute name; patient-level rows win, sample-level attributes
fall back to one sample value per patient. Numeric attributes (≥90% parseable, >10 distinct) render
as a continuous heat track scaled to the cohort's min→max with a gradient key; unknown attributes
render a labeled "(no data)" track.

**Oncoprint heatmap tracks** (portal-style): `heatmap: [{"profileType": P, "genes"?: [...], "reference"?: "cohort"|"federation"}]` adds
one continuous row per gene from a molecular profile (mRNA/protein z-scores, methylation, log2 CNA,
…; `genes` defaults to the gene tracks). Values are patient-level (mean across a patient's
samples, since columns are patients). Z-score profiles render on a **fixed diverging ±3
blue→white→red ramp** so colors are comparable across oncoprints; other sign-spanning data gets a
symmetric diverging ramp; positive-only data a sequential ramp. Track labels are
`GENE <short-profile>` (e.g. `ERBB2 mRNA-z`) and are valid `sort` keys. Unknown profiles
error loudly, listing what the study has. The synthetic profile `"VAF"` renders variant allele
fraction computed from mutation allele counts (max across a patient's mutations in the gene,
fixed 0–1 ramp) — available wherever the study loaded tumor alt/ref counts.

`reference: "federation"` re-scores those values against a distribution pooled from **every**
participating study — including instances that disclose no patients and so contribute no columns.
Each returns three totals per gene (n, Σx, Σx²), which is all a mean and standard deviation need,
so the reference population can be far larger than the drawn one without any value moving.

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

### Example 1: Lung adenocarcinoma: a four-view workup

EGFR-mutant versus KRAS-mutant lung adenocarcinoma — the two dominant, mutually exclusive driver classes. Co-alteration frequencies, how the groups differ clinically, how they differ in survival (with a log-rank test), and which driver pairs co-occur within the EGFR arm. Every view is computed from aggregates each site could return without disclosing a patient.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "EGFR-mutant NSCLC": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "CANCER_TYPE",
          "values": [
            "Non-Small Cell Lung Cancer"
          ],
          "per": "sample"
        },
        {
          "kind": "oql",
          "q": "EGFR: MUT"
        }
      ]
    },
    "KRAS-mutant NSCLC": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "CANCER_TYPE",
          "values": [
            "Non-Small Cell Lung Cancer"
          ],
          "per": "sample"
        },
        {
          "kind": "oql",
          "q": "KRAS: MUT"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "compare",
      "genes": [
        "TP53",
        "STK11",
        "KEAP1",
        "RBM10",
        "ERBB2",
        "MET"
      ]
    },
    {
      "kind": "clinical",
      "attributes": [
        "SMOKING_PREDICTIONS_3_CLASSES",
        "CURRENT_AGE_DEID",
        "TMB_NONSYNONYMOUS",
        "FRACTION_GENOME_ALTERED"
      ]
    },
    {
      "kind": "survival"
    },
    {
      "kind": "cooccurrence",
      "genes": [
        "EGFR",
        "TP53",
        "STK11",
        "KEAP1",
        "RBM10"
      ]
    }
  ]
}
```

### Example 2: One cohort, five ways: the colorectal hotspot workup

Colorectal cancer in MSK-CHORD. Lollipops for the canonical drivers (KRAS codon 12/13, BRAF V600E, PIK3CA E545K/H1047R), which pairs co-occur or exclude each other, how the mutated and wild-type groups differ clinically, and an oncoprint of the same patients. minCount is set so no site returns a change carried by fewer than three patients.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "CRC, KRAS-mutant": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "CANCER_TYPE",
          "values": [
            "Colorectal Cancer"
          ],
          "per": "sample"
        },
        {
          "kind": "oql",
          "q": "KRAS: MUT"
        }
      ]
    },
    "CRC, KRAS wild-type": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "CANCER_TYPE",
          "values": [
            "Colorectal Cancer"
          ],
          "per": "sample"
        },
        {
          "not": {
            "kind": "oql",
            "q": "KRAS:"
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
      "kind": "hotspots",
      "genes": [
        "KRAS",
        "BRAF",
        "PIK3CA",
        "TP53"
      ],
      "minCount": 3
    },
    {
      "kind": "cooccurrence",
      "genes": [
        "KRAS",
        "BRAF",
        "NRAS",
        "PIK3CA",
        "TP53",
        "APC",
        "SMAD4"
      ]
    },
    {
      "kind": "compare",
      "genes": [
        "BRAF",
        "NRAS",
        "PIK3CA",
        "APC",
        "SMAD4"
      ]
    },
    {
      "kind": "clinical",
      "attributes": [
        "CURRENT_AGE_DEID",
        "MSI_SCORE",
        "TMB_NONSYNONYMOUS"
      ]
    },
    {
      "kind": "survival"
    }
  ]
}
```

### Example 3: Federated end to end: two studies, four views

TP53-mutant versus wild-type across MSK-CHORD and MSK-MET. The log-rank is stratified by study, the co-occurrence test is Cochran–Mantel–Haenszel across the two sites, and the clinical comparison pools counts and moments — all from per-site aggregates. Run with either study aggregate-only and the numbers do not change.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "TP53 mut": {
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
    },
    "TP53 wt": {
      "studies": [
        "msk_chord_2024",
        "msk_met_2021"
      ],
      "all": [
        {
          "not": {
            "kind": "oql",
            "q": "TP53:"
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
        "KRAS",
        "PIK3CA",
        "APC",
        "EGFR",
        "CDKN2A"
      ]
    },
    {
      "kind": "survival"
    },
    {
      "kind": "clinical",
      "attributes": [
        "CURRENT_AGE_DEID",
        "TMB_NONSYNONYMOUS",
        "FRACTION_GENOME_ALTERED"
      ]
    },
    {
      "kind": "cooccurrence",
      "genes": [
        "TP53",
        "KRAS",
        "PIK3CA",
        "APC"
      ]
    }
  ]
}
```

### Example 4: Genomic status via OQL, compared

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

### Example 5: Clinical + timeline event composition

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

### Example 6: Derived filters: enough follow-up to answer the question

Any question about an outcome is only honest among patients observed long enough to have one. This contrasts patients with at least two years of follow-up past the study's own day 0 against those with under six months — a distinction no clinical attribute in this study records, and one that needs no knowledge of how this study names its events.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "followed 2y+": {
      "all": [
        {
          "kind": "derived",
          "metric": "followupMonths",
          "range": {
            "gte": 24
          }
        }
      ]
    },
    "followed < 6mo": {
      "all": [
        {
          "kind": "derived",
          "metric": "followupMonths",
          "range": {
            "lt": 6
          }
        }
      ]
    }
  },
  "views": [
    {
      "kind": "clinical",
      "attributes": [
        "CANCER_TYPE",
        "CURRENT_AGE_DEID",
        "TMB_NONSYNONYMOUS"
      ]
    },
    {
      "kind": "compare",
      "genes": [
        "TP53",
        "KRAS",
        "PIK3CA"
      ]
    }
  ]
}
```

### Example 7: Progression on immunotherapy: during, versus absent

Patients who progressed while on immunotherapy (1,423) versus those with no progression recorded in the year after starting it (534). The second cohort sets observed:true, so "no progression" means the follow-up was there and nothing was recorded — not that the patient was lost to follow-up. Without that guard the cohort would be far larger and largely meaningless.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "progressed on immunotherapy": {
      "all": [
        {
          "kind": "event",
          "a": {
            "eventType": "Treatment",
            "attrs": [
              {
                "key": "SUBTYPE",
                "value": "Immuno"
              }
            ]
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
            "type": "DURING"
          }
        }
      ]
    },
    "no progression within a year": {
      "all": [
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
            "type": "NOT_FOLLOWED_BY",
            "withinDays": 365,
            "observed": true
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
        "TP53",
        "EGFR",
        "SMARCA4"
      ]
    },
    {
      "kind": "clinical",
      "attributes": [
        "TMB_NONSYNONYMOUS",
        "CURRENT_AGE_DEID",
        "SMOKING_PREDICTIONS_3_CLASSES"
      ]
    },
    {
      "kind": "survival"
    }
  ]
}
```

### Example 8: Derived treatment lines: who reaches a third line?

Patients who reached a third line of therapy (3,088) versus those who had a first line and never a second (13,620), with lines derived on a 90-day gap. Changing lineGap changes both cohorts — the line boundary is a modelling choice, made explicit rather than baked into the data. READ THE SURVIVAL CURVE WITH CARE: reaching a third line requires surviving long enough to receive one, so this comparison carries immortal time bias and the modest separation it shows (medians 48.1 vs 43.1 months) is not evidence that more lines help. The engine cannot detect this — it is a property of how the cohorts were defined, not of the data, which is exactly why the definition travels with the result.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "reached 3rd line": {
      "all": [
        {
          "kind": "event",
          "a": {
            "eventType": "Treatment line (derived)",
            "attrs": [
              {
                "key": "LINE_NO",
                "value": "3"
              }
            ]
          },
          "rel": {
            "type": "NONE"
          },
          "lineGap": 90
        }
      ]
    },
    "first line only": {
      "all": [
        {
          "kind": "event",
          "a": {
            "eventType": "Treatment line (derived)",
            "attrs": [
              {
                "key": "LINE_NO",
                "value": "1"
              }
            ]
          },
          "rel": {
            "type": "NONE"
          },
          "lineGap": 90
        },
        {
          "not": {
            "kind": "event",
            "a": {
              "eventType": "Treatment line (derived)",
              "attrs": [
                {
                  "key": "LINE_NO",
                  "value": "2"
                }
              ]
            },
            "rel": {
              "type": "NONE"
            },
            "lineGap": 90
          }
        }
      ]
    }
  },
  "views": [
    {
      "kind": "survival"
    },
    {
      "kind": "clinical",
      "attributes": [
        "CURRENT_AGE_DEID",
        "CANCER_TYPE",
        "TMB_NONSYNONYMOUS"
      ]
    },
    {
      "kind": "compare",
      "genes": [
        "TP53",
        "KRAS",
        "PIK3CA",
        "APC"
      ]
    }
  ]
}
```

### Example 9: True first line: fast progression versus durable control

Among treatment-naive patients starting first-line chemotherapy: progression recorded within 180 days (3,319) versus none in that window with follow-up to prove it (6,584). BEFORE takes a window; NOT_FOLLOWED_BY takes the same window and asks for its absence. Drop priorGuard and both cohorts grow by roughly the share of patients pre-treated elsewhere.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "progressed within 180d of 1L chemo": {
      "all": [
        {
          "kind": "event",
          "a": {
            "eventType": "Treatment",
            "attrs": [
              {
                "key": "SUBTYPE",
                "value": "Chemo"
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
          },
          "priorGuard": true
        }
      ]
    },
    "no progression within 180d": {
      "all": [
        {
          "kind": "event",
          "a": {
            "eventType": "Treatment",
            "attrs": [
              {
                "key": "SUBTYPE",
                "value": "Chemo"
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
            "type": "NOT_FOLLOWED_BY",
            "withinDays": 180,
            "observed": true
          },
          "priorGuard": true
        }
      ]
    }
  },
  "views": [
    {
      "kind": "survival"
    },
    {
      "kind": "compare",
      "genes": [
        "TP53",
        "KRAS",
        "SMAD4",
        "CDKN2A",
        "MYC"
      ]
    },
    {
      "kind": "clinical",
      "attributes": [
        "CANCER_TYPE",
        "FRACTION_GENOME_ALTERED",
        "CURRENT_AGE_DEID"
      ]
    }
  ]
}
```

### Example 10: Lab thresholds over time: PSA above 100

PSA recorded above 100 ng/ml at any point (879) versus PSA measured but never above 100 (3,250). The second cohort deliberately requires a PSA test to exist: comparing against everyone else would silently contrast the tested with the untested, which is a selection effect rather than a finding.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "PSA above 100": {
      "all": [
        {
          "kind": "event",
          "a": {
            "eventType": "Lab_Test",
            "attrs": [
              {
                "key": "TEST",
                "value": "PSA"
              }
            ],
            "numeric": {
              "key": "RESULT",
              "op": ">",
              "value": 100
            }
          },
          "rel": {
            "type": "NONE"
          }
        }
      ]
    },
    "PSA measured, never above 100": {
      "all": [
        {
          "kind": "event",
          "a": {
            "eventType": "Lab_Test",
            "attrs": [
              {
                "key": "TEST",
                "value": "PSA"
              }
            ]
          },
          "rel": {
            "type": "NONE"
          }
        },
        {
          "not": {
            "kind": "event",
            "a": {
              "eventType": "Lab_Test",
              "attrs": [
                {
                  "key": "TEST",
                  "value": "PSA"
                }
              ],
              "numeric": {
                "key": "RESULT",
                "op": ">",
                "value": 100
              }
            },
            "rel": {
              "type": "NONE"
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
        "AR",
        "TP53",
        "PTEN",
        "SPOP",
        "RB1"
      ]
    },
    {
      "kind": "survival"
    },
    {
      "kind": "clinical",
      "attributes": [
        "CURRENT_AGE_DEID",
        "FRACTION_GENOME_ALTERED",
        "CANCER_TYPE"
      ]
    }
  ]
}
```

### Example 11: any / not / genomicData

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

### Example 12: Cross-study federation with an oncoprint

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

### Example 13: Molecular heatmap tracks, sorted by expression

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

### Example 14: A federated z-score reference on an oncoprint

A heatmap track with reference:"federation" is scored against a distribution pooled from EVERY participating study, including instances that disclose no patients and therefore contribute no columns — each returns three totals per gene (n, sum, sum of squares), which is enough to define the reference. Run with luad_tcga_pan_can_atlas_2018 aggregate-only, its patients are absent from the columns while its 510 patients still shape what the drawn columns mean.

```json
{
  "study": "brca_tcga_pan_can_atlas_2018",
  "cohorts": {
    "ERBB2 amp": {
      "studies": [
        "brca_tcga_pan_can_atlas_2018",
        "luad_tcga_pan_can_atlas_2018"
      ],
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
        "EGFR"
      ],
      "heatmap": [
        {
          "profileType": "rna_seq_v2_mrna_median_Zscores",
          "reference": "federation"
        }
      ]
    }
  ]
}
```

### Example 15: The clinical course: who is still on treatment, and when

MSK-CHORD, aligned on each patient's FIRST treatment, split by TP53 status. Treatment carries real start/stop dates so it is drawn as a state patients are IN; surgery has no duration, so it is the share with a surgery in that bin — a distinction read from the data's shape, not from the event's name. Note surgery peaking BEFORE time zero: resection typically precedes first systemic therapy. The at-risk row under the axis is the denominator, and it falls steeply — a curve read without it would be badly misleading.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "TP53 mut": {
      "all": [
        {
          "kind": "oql",
          "q": "TP53: MUT"
        }
      ]
    },
    "TP53 wt": {
      "all": [
        {
          "not": {
            "kind": "oql",
            "q": "TP53:"
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
      "kind": "course",
      "eventTypes": [
        "treatment",
        "surgery"
      ],
      "anchor": {
        "eventType": "Treatment",
        "occurrence": "FIRST"
      },
      "binMonths": 3,
      "fromMonths": -12,
      "toMonths": 60
    }
  ]
}
```

### Example 16: What comes after what: lines of therapy as a Sankey

MSK-CHORD therapy lines, 90-day gap. Read the grey blocks first: of 21,444 patients with a first line, 13,620 never start a second. Chemo dominates first line; hormone therapy holds its share far better across lines, which is what maintenance endocrine therapy looks like. The four excluded SUBTYPE values are a judgement made HERE, in the document, not hidden in the engine — 'Prior Medications to MSK' is a provenance marker rather than a therapy, and radiation and bone treatment co-occur with almost everything, so leaving them in explodes the combination space. Nothing in the data structure distinguishes them from real treatments, which is exactly why the choice is visible.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "MSK-CHORD": {
      "all": []
    }
  },
  "views": [
    {
      "kind": "sequence",
      "labelKey": "SUBTYPE",
      "exclude": [
        "Prior Medications to MSK",
        "Radiation Therapy",
        "Bone Treatment",
        "Other"
      ],
      "lineGap": 90,
      "maxSteps": 3,
      "topN": 8
    }
  ]
}
```

### Example 17: Lollipop plot: recurrent protein changes, with a suppression floor

Hotspots in colorectal cancer. Percentages are of the patients carrying any mutation in that gene, so BRAF V600E accounts for roughly 70% of BRAF-mutant cases. minCount is applied by each site before anything is returned — with it set to 3, a change carried by one or two patients never leaves the database holding it, which is where small-cell suppression belongs.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "CRC": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "CANCER_TYPE",
          "values": [
            "Colorectal Cancer"
          ],
          "per": "sample"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "hotspots",
      "genes": [
        "KRAS",
        "BRAF",
        "PIK3CA",
        "TP53"
      ],
      "minCount": 3
    }
  ]
}
```

### Example 18: Co-expression from sums alone

Pearson correlation between gene pairs in TCGA breast cancer. A correlation depends on the data only through six running totals, so each site can contribute without transmitting a single expression value — and because the totals add, the federated answer is exact rather than approximate. ERBB2/GRB7 (adjacent on the 17q12 amplicon) comes out near 0.87.

```json
{
  "study": "brca_tcga_pan_can_atlas_2018",
  "cohorts": {
    "BRCA": {
      "all": [
        {
          "kind": "profiled",
          "type": "MUTATION"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "coexpression",
      "profileType": "rna_seq_v2_mrna_median_Zscores",
      "genes": [
        "ERBB2",
        "GRB7",
        "ESR1",
        "PGR",
        "MKI67"
      ]
    }
  ]
}
```

### Example 19: Clinical attributes compared between cohorts

How TP53-mutant and wild-type tumors differ clinically. Categorical attributes are compared with a chi-squared over the full value vocabulary; numeric ones with Welch's t computed from three additive totals per site (n, sum, sum of squares) rather than from any transmitted value. An attribute the study does not declare is reported as skipped, not silently dropped.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "TP53 mut": {
      "all": [
        {
          "kind": "oql",
          "q": "TP53: MUT"
        }
      ]
    },
    "TP53 wt": {
      "all": [
        {
          "not": {
            "kind": "oql",
            "q": "TP53:"
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
      "kind": "clinical",
      "attributes": [
        "CANCER_TYPE",
        "SMOKING_PREDICTIONS_3_CLASSES",
        "CURRENT_AGE_DEID",
        "TMB_NONSYNONYMOUS",
        "FRACTION_GENOME_ALTERED"
      ]
    }
  ]
}
```

### Example 20: Co-occurrence and mutual exclusivity in NSCLC

Pairwise associations among lung cancer driver genes. Each site returns four counts per pair — both altered, one, the other, neither — among the patients its own panels profiled for BOTH genes, and nothing else; the coordinator does the inference. Reproduces the textbook pattern: STK11/KEAP1 co-occur, EGFR/KRAS and EGFR/ALK are mutually exclusive.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "NSCLC": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "CANCER_TYPE",
          "values": [
            "Non-Small Cell Lung Cancer"
          ],
          "per": "sample"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "cooccurrence",
      "genes": [
        "EGFR",
        "KRAS",
        "TP53",
        "STK11",
        "KEAP1",
        "ALK"
      ]
    }
  ]
}
```

### Example 21: Survival from first chemotherapy, left-truncated

TP53-mutant vs wild-type, overall survival measured from each patient's first chemotherapy rather than from sequencing. Patients whose first chemotherapy falls after day 0, or who never had chemotherapy, are excluded rather than given negative follow-up. The result reports how long after the anchor patients became observable, so an anchor that is matching earlier events than intended shows up as a long tail.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "TP53 mut": {
      "all": [
        {
          "kind": "oql",
          "q": "TP53: MUT"
        }
      ]
    },
    "TP53 wt": {
      "all": [
        {
          "not": {
            "kind": "oql",
            "q": "TP53:"
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
      "kind": "survival",
      "anchor": {
        "eventType": "Treatment",
        "key": "SUBTYPE",
        "value": "Chemo",
        "occurrence": "FIRST"
      }
    }
  ]
}
```

### Example 22: Study-stratified survival across two studies

TP53-mutant vs wild-type, each cohort spanning two studies. Every site answers with (months, event, n) counts only — no survival time for any individual crosses an instance boundary — and because the log-rank statistic is a sum over strata, those counts are enough to compute the test STRATIFIED by study: each study is compared only against itself. The unstratified pooled p is reported alongside, since the two can disagree when case mix differs between sites.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "TP53 mut": {
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
    },
    "TP53 wt": {
      "studies": [
        "msk_chord_2024",
        "msk_met_2021"
      ],
      "all": [
        {
          "not": {
            "kind": "oql",
            "q": "TP53:"
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
      "kind": "survival"
    }
  ]
}
```

