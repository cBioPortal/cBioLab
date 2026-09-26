<!-- GENERATED FILE — do not edit. Source: lib/dsl-reference.ts; regenerate with `npm run docs:gen`. -->

# cbio-lab DSL (v2.2)

One declarative JSON object — the **Analysis document** — describes everything cbio-lab does:
which patients form each cohort, and which views compare them. The server compiles it to
ClickHouse SQL (`lib/cohort2.ts`, `lib/oql.ts`, `lib/compiler.ts`, `lib/analysis.ts`);
clients never send SQL. Every result carries provenance: the definition readback and the exact
SQL each cohort compiled to.

## Analysis document

```
{ "study":   "<default study id>",            // validated against cancer_study
  "cohorts": { "<name>": cohortDef, ... },    // max 16
  "views":   [ view, ... ] }                  // max 6
```

Sent to `POST /api/analysis`, edited by the in-app chat, and encoded in shareable
`/analysis?doc=<base64url>` links.

## Cohort definitions

```
cohortDef := { "all": [clause × 0-8],         // ANDed; [] means every patient in the study
               "extends"?: "<cohort name>",   // splice that cohort's own "all" in AHEAD of this one's, resolved before anything is compiled
               "study"?:   "<id>",            // evaluate in another study
               "studies"?: ["<id>", ...],     // union across studies (federated, no count limit)
               "lineGap"?: 90,                // derived-treatment-line gap, days
               "notes"?:   "<prose>" }        // the analyst's own note on this cohort; never compiled
clause    := leaf | { "any": [leaf × 1-8] }   // OR (UNION DISTINCT)
                  | { "not": leaf | { "any": [leaf × 1-8] } }  // study base EXCEPT leaf, or EXCEPT the OR of several (De Morgan's, in one clause instead of one "not" per leaf)
```

**Cross-study semantics.** A cohort with `studies` is compiled per study (compilers are
single-study by design); members are study-qualified patient ids. Patient overlap across studies
is deliberately **not** deduplicated, and clinical vocabularies are **not** harmonized — views
say so in their captions.

**`extends`.** A cohort naming another cohort in `extends` inherits that cohort's `all`
clauses, spliced in ahead of its own — so a family of nested cohorts (e.g. "APC-mutated", then
"APC-mutated AND liver mets") can share one definition instead of two copies of the same clause
drifting apart when one gets edited. Only `all` is inherited — `study`/`studies`/`lineGap`/
`notes` are always the child's own. Resolved (and a cycle, direct or through a chain, rejected by
name) before compilation, so every downstream reader — compiled SQL, the plain-language readback,
provenance — sees the fully flattened `all` list, exactly as if it had been written out by hand.

### Leaf kinds

| kind | shape | meaning |
|---|---|---|
| `oql` | `{"kind":"oql","q":"STK11: DRIVER"}` | genomic status in cBioPortal OQL (see below) |
| `clinical` | `{"kind":"clinical","attribute":A, ...predicate, "per"?:"sample"}` | clinical attribute; predicate is `values:[≤50]` (OR), `range:{gt,gte,lt,lte}` (numeric via toFloat64OrNull), or `op`(`= != > >= < <=`)+`value`; `per:"sample"` = patient matches if ANY sample matches. `op`+`percentile` (0-1) resolves `value` LIVE from a percentile of the attribute's distribution instead of a literal number — e.g. `{"op":">=","percentile":0.8}` = "at or above the 80th percentile" ("top 20%"). `percentileOf`:"<cohort name>" scopes the reference population to another cohort in this document (e.g. "top 20% TMB **within NSCLC**", not the whole study); both the leaf's own cohort and, if given, `percentileOf`'s cohort must resolve to a single study, and `percentileOf` may not itself use `percentile` (no chaining). Resolved once, live, before compilation — the readback shows the resolved number and what it was a percentile of |
| `derived` | `{"kind":"derived","metric":"followupMonths"|"historyMonths"|"alteredGenes"|"lines"|"treatmentSpan","range":{gte?,gt?,lte?,lt?},"eventType"?,"lineGap"?:90}` | filters on a value computed from the **shape** of the data rather than a study's vocabulary. Event-type names and attribute keys are study-specific — this database spells one concept `Treatment` in 87 studies and `TREATMENT` in 10, and the key MSK-CHORD calls `SUBTYPE` exists in only 27 of 131 timeline studies — so these read dates and gene symbols instead and mean the same thing everywhere. `followupMonths`: how far the timeline runs past its own day 0. `historyMonths`: how much predates it. `alteredGenes`: distinct genes altered (panel size bounds it, so not comparable across studies with different panels). `lines` and `treatmentSpan` are the deliberate exception — they need `eventType` (which timeline event stands for "a therapy" here; Explore proposes one from the study's own catalog), because there is no vocabulary-free way to ask "how many lines of treatment". `lines`: distinct treatment lines, grouped by a `lineGap`-day gap. `treatmentSpan`: months from the first to the last record of that event type |
| `event` | `{"kind":"event","a":sel,"b"?:sel,"rel":rel,"priorGuard"?:bool,"lineGap"?:90}` | timeline sub-DSL (below) |
| `sampleList` | `{"kind":"sampleList","ids":["<study>:<id>", ...]}` | explicit, cross-study list of sample ids — up to ~22,000 total (measured ClickHouse query-size ceiling; not enforced as a hard cap yet) |
| `patientList` | `{"kind":"patientList","ids":["<study>:<id>", ...]}` | explicit, cross-study list of patient ids, same shape and ceiling |
| `profiled` | `{"kind":"profiled","type":"MUTATION"\|"CNA"\|"SV"}` | patient has a sample on a gene panel for that data type — combine with `not` to separate wild-type from not-profiled |
| `caseList` | `{"kind":"caseList","id":"sequenced"}` | portal sample list; bare ids get the study prefix |
| `genomicData` | `{"kind":"genomicData","gene":G,"profileType":P,"range"\|"values"}` | continuous per-gene values (cna, mrna z-scores, …); unknown profiles error listing what the study has |
| `genericAssay` | `{"kind":"genericAssay","profileType":P,"entity":E,"range"\|"values"}` | generic assay values (mutational signatures, …) |
| `proteinPosition` | `{"kind":"proteinPosition","gene":G,"range":{gt,gte,lt,lte}}` | patient carries a mutation in `gene` whose protein position (the stored proteinPosStart, same column the lollipop draws from) falls in `range` — for an N-/C-terminal split when a study doesn't deposit one as a clinical attribute. Position-only: AND with an `oql` leaf (e.g. `{"kind":"oql","q":"APC: TRUNC"}`) to also restrict by mutation type |
| `alteration` | *(deprecated)* | translated to OQL internally; do not write new ones |

**`sampleList`/`patientList` ids.** Each id is `"<study>:<bare-id>"` — a colon, not the
database's internal underscore, because a bare id may itself contain one (this is also the
legacy portal's own study-qualified id convention). A single list can span every study named in
the cohort's `studies`: it compiles once per study (the same fan-out `studies` already does for
every other clause) and an id meant for a different study is simply inert in that pass, not an
error — so the list itself never needs to be split up by study. These two leaves are the one
kind of clause that can **never** leave for a remote or aggregate-only participant: an id-carrying
cohort is refused before any request is made, the same guarantee `docs/DATA-BOUNDARY.md`
describes for every other identifier-bearing path.

### OQL subset

`q` is 1–30 entries separated by `;`, each `GENE` (any alteration) or `GENE: spec spec ...`.
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
| `compare` | `genes:[≤20], cohorts?:[names]` | per-gene driver% / altered% per cohort with **panel-aware denominators** (profiled patients only); two-sided Fisher p for exactly 2 cohorts, a Pearson chi-squared (2×N table, altered vs not) for 3+; either way, q-values are Benjamini–Hochberg across the genes tested, separately for any-alteration and driver-only. `altered%` combines mutation/CNA/structural-variant, matching the oncoprint's "any alteration" convention; each cell also carries the same three counts split by type, and if a WHOLE type was never assayed anywhere in the participating studies (e.g. no copy-number data at all) the view says so rather than let a false 0% for that type alone read as a real negative |
| `clinical` | `attributes:[≤1-20], cohorts?:[names]` | compares clinical attribute distributions across cohorts. Categorical: Pearson chi-squared over the **full** value vocabulary, any number of cohorts. Numeric: Welch's unequal-variance t-test for exactly 2 cohorts, **Welch's ANOVA for 3+** — both from (n, Σx, Σx²) per cohort, additive across sites, so pooled mean/variance are exact and no individual value is transmitted, at any study count. BH q across attributes (moment-based test only). Each site types its own attributes from `clinical_attribute_meta`; disagreements are refused, not merged. **Single-study views only:** numeric attributes also report median/IQR, and a rank-based test alongside the moment-based one — a Mann-Whitney U for exactly 2 cohorts, **Kruskal-Wallis for 3+** — a check worth having when the mean is misleading (skew, outliers); computed from the complete value distribution, which is exact only when the whole comparison stays within one study, so it is not offered otherwise, and not part of the q-value correction above |
| `cooccurrence` | `genes:[2-12], cohorts?:[names]` | pairwise co-occurrence / mutual exclusivity **within one cohort** (the first named). Each pair's 2×2 is counted among patients profiled for **both** genes, per study against that study's own panels; log₂ odds ratio, two-sided Fisher, Benjamini–Hochberg q across pairs. Across studies the test is **stratified by study** (Cochran–Mantel–Haenszel). Pairs no panel covers are reported as not assessable, never as a null result |
| `hotspots` | `genes:[≤12], cohorts?:[names], minCount?` | the lollipop, as cBioPortal's results-page mutation tab draws it: one stem per codon (the stored protein start position) whose height is the distinct patient + protein change pairs there, coloured by the codon's dominant mutation type (putative drivers first), on the canonical transcript with its Pfam domains (Genome Nexus); mutations with no protein position are counted and disclosed, not drawn. `minCount` is a suppression floor each site applies **before returning anything** — a change carried by one patient is the most disclosive aggregate here |
| `coexpression` | `genes:[2-12], profileType, cohorts?:[names]` | Pearson correlation between gene pairs on a continuous molecular profile, **within one cohort** (the first named). Each site reports only six sums (n, Σx, Σy, Σxy, Σx², Σy²), which are additive — so the federated correlation is exact, not approximate. Across studies a Fisher-z meta-analysis of per-study correlations is reported alongside the pooled one |
| `survival` | `endpoint?:"OS"|"PFS"|…, monthsAttribute?/statusAttribute?, anchor?:{eventType,key?,value?,occurrence?}, cohorts?:[names]` | Kaplan–Meier on OS_MONTHS/OS_STATUS, plus a two-sided **log-rank** test when exactly 2 cohorts, or the **k-group generalization** (a (k-1)-df chi-squared from the full covariance matrix, not a scalar variance — the same statistic R's `survdiff()` reports) when 3+, testing whether the groups differ AT ALL rather than which pair does. Across studies either test is **stratified by study** (each study compared only against itself, so differing case mix cannot masquerade as a cohort effect); the pooled p is reported alongside. `anchor` resets the clock to a timeline event (first chemotherapy, initial diagnosis) instead of the study's day 0, and **applies left truncation automatically**: a patient joins the risk set when the study could first observe them, never at the anchor — otherwise everyone appears to survive from the anchor to their own entry, which is exactly what put them in the study. The reported entry distribution warns when an anchor is matching earlier events than intended. Cross-study baselines are not harmonized. **The test is refused, not computed, when any arm has fewer than 10 patients** — the KM curves still draw (they are descriptive), but a chi-squared from a handful of patients reads as a real result whatever its p-value says, so it is named as refused rather than reported. `monthsAttribute`/`statusAttribute` override the `<endpoint>_MONTHS`/`<endpoint>_STATUS` naming convention with exact column names, for a study whose outcome columns don't follow it (some do not — e.g. `PFS_MONTHS_FIRST_LINE_TX`/`PROGRESSION_STATUS`); both must be given together, and `endpoint` becomes purely a display label rather than something column names are derived from |
| `cox` | `endpoint?:"OS"|"PFS"|..., monthsAttribute?/statusAttribute?, covariates:[axis, ...(max 8)], stratifyByStudy?, stratifyByCohort?, cutoffMonths?, cohorts?:[names]` | multivariate Cox proportional-hazards regression: several covariates fit simultaneously, reported as hazard ratios with Wald confidence intervals, drawn as a forest plot. Each `covariate` is a plot axis (clinical, molecular, or a gene's — or a gene SET's — alteration status; see Plot axes below). Unlike every other view, this is fit from real per-patient rows within each LOCAL study, not pooled aggregate counts, so a remote or aggregate-only participant cannot contribute to it and is named as excluded rather than silently dropped. `stratifyByStudy` fits a separate baseline hazard per study instead of pooling them (one model, per-study risk sets). `stratifyByCohort` goes further: with 2+ named cohorts, it fits each cohort as its own INDEPENDENT model — own coefficients, own reference-level choice — instead of one pooled fit, drawn as one forest-plot panel per cohort sharing a single hazard-ratio scale so the effects are directly comparable; the right tool when a covariate's EFFECT, not just the cohorts' case mix, might genuinely differ between them (pooling would average that difference away). A cohort that can't be fit (too few patients, no variation) is named and skipped rather than blocking the rest; a no-op with only one cohort. A categorical covariate is dummy-coded against a reference level: a mutated-vs-not alteration axis (`by:"mutated"`, the default) always defaults to `"Not mutated"` regardless of which side is more frequent — a gene altered in a minority of patients and one altered in a majority would otherwise silently end up measured in opposite directions, purely from how common each gene's alteration happens to be; every other categorical (a mutation-type/CNA axis, a clinical attribute) defaults to its most-frequently-observed level. Either way, a covariate axis may add `"reference":"<level>"` to declare the level explicitly instead — a `reference` naming a level the data doesn't have is ignored (falls back to the same default as if none were declared) rather than silently matching nothing. `monthsAttribute`/`statusAttribute` are the same naming-convention override as `survival`, for a study whose outcome columns don't follow `<endpoint>_MONTHS`/`<endpoint>_STATUS` |
| `logistic` | `outcome:axis, outcomeEvent?:"<level>", covariates:[axis, ...(max 8)], cohorts?:[names]` | multivariate logistic regression: a BINARY outcome (not time-to-event — no endpoint/months convention here) regressed on several covariates at once, reported as odds ratios with Wald confidence intervals, drawn as a forest plot the same shape as `cox`'s. `outcome` is a plot axis, exactly like a covariate (clinical, molecular, or alteration status). A categorical outcome (a clinical attribute, or an alteration axis) needs `outcomeEvent` naming which observed value counts as the event (1) — every other observed value collapses into "not event" (0), and which values got collapsed is disclosed in the caveat; omitting it, or naming a value never observed, is refused with the actual observed values listed rather than guessed at. A numeric outcome must already be coded exactly 0/1 (refused otherwise) and must NOT be given `outcomeEvent`. Covariates use the exact same dummy-coding and reference-level rules as `cox` (see above): a mutated-vs-not axis defaults to `"Not mutated"`, others default to the most frequent level, `reference` overrides either. Same patient-level-only boundary as `cox` |
| `course` | `eventTypes:[≤6], anchor?:{eventType,key?,value?,occurrence?}, binMonths?:3, fromMonths?:-12, toMonths?:60, cohorts?:[names]` | the **clinical course**: per time bin, the share of the cohort in each event state. Two things it refuses to fake. (1) The denominator is the patients still under observation in that bin — first recorded event to last contact (the later of their last event and their OS follow-up) — never the whole cohort, which would make a curve fall merely because follow-up ran out. (2) `anchor` is optional for one study but **required across studies**: day 0 is birth in some studies and first sequencing in others, and nothing in the schema records which, so raw day 0 compares incomparable clocks. Event types that carry real durations are drawn as a state the patient is IN; the rest as an event that HAPPENED — read from the data, not from the name. Bins are half-open [t, t+w). Event-name spellings differing only in case are folded (`Treatment`/`TREATMENT`) and the fold is named in the caveat; nothing else is merged |
| `sequence` | `labelKey?:"SUBTYPE", eventType?:"treatment", exclude?:[values], lineGap?:90, maxSteps?:3, topN?:8, cohorts?:[names]` | **what follows what**: therapy transitions as lines, drawn as a Sankey. Records are first grouped into LINES — therapies less than `lineGap` days apart are one line, labelled by their whole combination (sorted, so `A + B` and `B + A` are one regimen). That grouping is the point: a patient has a median of 6 treatment records and 4 distinct agents, and combination therapy is several records describing ONE decision. Paths that end flow into TWO explicit terminals, never one: **no further line** (the study watched for at least one `lineGap` and saw no further therapy) and **record ends here** (it did not, so nothing can be concluded). Measured on MSK-CHORD, 68% of patients have under three months of observation after their last therapy and the median is 15 days — so collapsing the two would turn record-keeping into an apparent clinical decision. Flows out of a node sum to it, so nobody vanishes. Up to two cohorts are drawn as panels sharing one scale and one colour per regimen. `exclude` drops label values that are not therapies; it is a parameter and not an engine rule because such markers are **not structurally distinguishable** (MSK’s `Prior Medications to MSK` carries no duration, but neither do `Radiation Therapy` or `Investigational`), so the choice belongs in the document where a reader can see it. One cohort only |
| `plot` | `x:axis, y:axis, unit?:"patient"\|"sample", bins?:[240,160], points?:true, colorBy?:axis, ringBy?:axis, cohorts?:[names]` | two axes over the same cases, aggregated **inside the database**: a scatter comes back as counts per grid cell, a box as quartiles per group, two categoricals as a contingency table. The payload is a few kilobytes whatever the cohort's size |
| `oncoprint` | `genes:[≤12 rows], clinical?:[≤8], heatmap?:[≤4], sort?:[≤4], unit?:"patient"\|"sample", display?:{…}, overlays?:[≤2], derivedCohorts?:[≤3], cohorts?:[names]` | render-contract oncoprint: columns are patients grouped by cohort (first matching cohort wins); NOT_PROFILED is a first-class cell state |

`views[].note` is the analyst's own one-line annotation, carried through to the result and
drawn above the figure. It is plain text on purpose — never markdown — so a document cannot
smuggle formatting or links into a page that reports numbers.

`views[].cohorts` defaults to all cohorts. Oncoprints federate across studies: columns are
study-qualified, a synthetic **Study** track shows each column's origin, and duplicates appear twice.

### Plot axes

An axis is one of four things, and the pair decides the shape — the portal's own rule:

| `source` | shape of the axis | fields |
| --- | --- | --- |
| `clinical` | number or category, **as the study declared it** | `attribute` |
| `molecular` | number | `profileType`, `gene` |
| `alteration` | category | `gene` **or** `genes` (2-20), `by`: `"mutationType"` (default) \| `"mutated"` \| `"cna"` |

number × number draws a **density scatter**, number × category a **box**, category × category a
**contingency table**. Every statistic is computed where the rows are and is therefore exact over
every case, not over what fits in a browser: n, Pearson and Spearman with their two-sided t-test
p-values, and the least-squares line. Quartiles use Tukey's 1.5×IQR fences.

**`genes` (a gene set, not one gene).** An alteration axis normally names one gene; `genes`
names 2-20 and asks "is ANY of these altered" as a single category — a pathway rollup (e.g. a DDR
gene set) for a Cox covariate, a compare-style axis, or any other consumer of a plot axis, without
inventing a second mechanism. Only `by:"mutated"` (the default when `genes` is used) is
supported for a set — combining several genes' mutation TYPES or copy-number states into one
category has no single honest reading, so that combination is refused rather than guessed at.

Two things are refused rather than approximated. A molecular axis **must name one gene** — a
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
as absent, not approximated. A federated box plot draws only points behind it, never the density
overlay a single-study box can fall back to (that needs the same shared-scale binning a scatter
uses, not yet built for a box); its quartiles are a size-weighted approximation across sites, the
same one Explore's federated numeric histograms already disclose.

**What sits behind the boxes.** cBioPortal draws every value as a jittered point over its box.
So does this, up to 5,000 values, and only when the study is one this participant may see cases
in — the points carry case ids, so they come from the same entitlement that lets a
patient-level participant list cohort members, and an aggregate-only participant has no method
that could return them. The jitter is fixed per case, so the figure does not move between the
server SVG, the browser and the Python package.

Above the cap, or with `points: false`, or from a participant that may not disclose a case, the
same values are drawn as a **violin** from per-group bins: a quarter of a million jittered dots
is a solid block, while the density is 19KB and is what the reader was looking for. Each violin
is scaled to its own densest bin, because one group holding 178,489 of the values would
otherwise flatten every other group to nothing; how many cases a group has is printed under its
name. The caption always says which of the two it drew.

**Colour.** `colorBy` fills each value with the colour of a category and `ringBy` rings it, the
portal's "Color samples by" with its two checkboxes — so a case that is amplified *and* mutated
stays legible. Both take the same categorical axes as the plot itself. A mutation class or a
copy-number state takes **the colour the oncoprint gives it**, so a missense dot here is the same
green as a missense cell there; anything else cycles the shared categorical palette. A ring means
"this case also has that", so a category meaning absence is drawn neutral and gets no ring.

Above the points cap the fill splits the **density** instead: the bin key gains the class, and each
bin's width is shared out between the classes in it. That stays an aggregate, so a participant that
may not disclose a case can still colour its plot. The key is capped at 12 classes.

A case with no value on an axis is simply absent, so a pair is an inner join: only cases measured
on both axes are counted, and the figure reports how many that was.

**Oncoprint columns**: `unit: "sample"` draws one column per SAMPLE instead of one per patient.
A cohort still selects patients, so every sample of a selected patient is drawn — including
samples on which the cohort's own criterion was never measured — and patient-level clinical
values repeat across that patient's samples. The contract says so in `conventions.column`.

**Oncoprint display options** (`display: {…}`): every viewing decision lives in the document
rather than in browser state, so a shared link, the server SVG, the CLI and the Python package
all reproduce the same picture. Unknown keys are rejected loudly.

| key | default | what it does |
| --- | --- | --- |
| `showUnaltered` | `true` | draw columns with no alteration in any gene track |
| `whitespace` | `true` | gaps between columns once they are wide enough |
| `gaps` | `"none"` | `"gaps"` / `"pct"` / `"pct-left"`: split each cohort into runs of the primary categorical sort key; the `pct` modes label each run with its altered % on its right or left |
| `colorByType` | `true` | colour each mutation class separately; off draws them as one |
| `whiteBackground` | `false` | white instead of grey for unaltered cells, for print |
| `clinicalLegends` | `"all"` | `"none"` drops the category keys under the figure |
| `colors` | — | `{track: {value: "#rrggbb"}}`, the portal's Edit Colors |
| `style` | — | override any visual decision (palette, glyph bands, legend); validated against the style schema |
| **`hideVUS`** | `false` | **changes the numbers**: drops alterations the annotation source does not call drivers, so the altered fraction is over drivers alone. The contract reports how many went |
| **`annotate`** | `"oncokb"` | **changes the numbers**: `"none"` calls nothing a driver, so every driver percentage becomes 0 |

The last two are viewing options only in the sense that they live beside the others; they change
what is counted, not how it is drawn, and the figure says so where it reports them.

**Oncoprint overlays** (`overlays: [{kind, profileType, threshold?}]`, ≤2): thresholded molecular
evidence drawn INTO the gene cells rather than as tracks of their own — `"mrna"` as an outline,
`"protein"` as thin bars, the portal's ±2 z-score rule (`threshold` defaults to 2). Evidence
about a gene is not an alteration of it, so overlays never enter the altered fraction.

**Oncoprint derived-cohort rows** (`derivedCohorts: [name]`, ≤3): draw any cohort in the document
as a binary row, so a phenotype defined by the cohort DSL can be read against the genomics.
Single-study and patient-mode only, because cohort rows are patient-level.

**Oncoprint merged rows**: a `genes` entry may be a group — `{"label"?: "TP53 pathway", "genes":
["TP53", "MDM2", "MDM4"]}` — drawn as ONE row, cBioPortal's `[TP53 MDM2 MDM4]`. The row is altered
where any member is altered and profiled where any member was profiled, so its percentage is over
the **union** of the members' panels. Without a label the row is named by its members
(`TP53 / MDM2 / MDM4`). Groups do not nest, a gene may appear both in a group and on its own, and
the caps are 12 rows and 32 distinct genes (coverage is one bit per gene in a 32-bit mask). Merged
rows are an oncoprint idea: every other view flattens a group to its members. Per-track OQL inside a
group (`[TP53: MUT MDM2: AMP]`) is **refused**, not approximated — a track here draws every
alteration type its genes have.

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
staircase: alteration type + driver rank across the gene tracks), `"id"` (the column id),
`"cluster:<profileType>"` (a Ward dendrogram over that profile's values, computed in the engine
because the browser never receives them; capped at 4,000 columns), a clinical or derived-event
track label, or `"-label"` for descending (e.g. `["CANCER_TYPE", "-CURRENT_AGE_DEID"]`). Applied
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
Shareable links, all taking the same base64url spec: `/oncoprint-lab?spec=` (the interactive figure), `/provenance?spec=` (picture, DSL and SQL), `/oncoprint-lab/cli?spec=` (the node and Python command lines, run against it) and `/oncoprint-lab/python?spec=` (a Pyodide notebook).

## Endpoints

| endpoint | takes |
|---|---|
| `POST /api/analysis` | Analysis document → cohorts (counts, readback, SQL provenance) + views |
| `POST /api/explore` | `{study, draft?}` → faceted catalog (clinical/events/genes/case lists), counts conditioned on the draft |
| `POST /api/oncoprint` | OncoprintSpec → render contract |
| `POST /api/cohort` | v1 event DSL → count + histogram + provenance |
| `GET /api/catalog?study=` | event-type / attribute vocabulary for the event sub-DSL |
| `GET /api/studies` | all loadable studies |

## Templates: `params`, and `notes`

A document may declare **parameters** and refer to them anywhere:

```json
{ "params": { "study": "msk_chord_2024", "genes": ["TP53", "KRAS"] },
  "study": "$study",
  "cohorts": { "cohort": { "all": [] } },
  "views": [ { "kind": "oncoprint", "genes": "$genes" },
             { "kind": "compare",   "genes": "$genes" } ] }
```

A saved workup can then be re-pointed at a different gene panel or a different
study in ONE edit rather than five, which is the difference between an analysis
you ran once and one you keep.

The rule is deliberately tiny: **a value that is exactly `"$name"` is replaced by
that parameter, whatever its type** — so `"$genes"` becomes a real array. There is
no interpolation inside a longer string (`"$gene mutations"` stays literal), no
expressions, no defaults, and no chaining. Every resolved document is an ordinary
analysis document, checked by the same validators and compiling to the same SQL as
if the values had been typed in.

- Only **values** are substituted, never object keys: a cohort named `"$name"` stays literally that.
- Substitution happens only when `params` is present, so no existing document changes meaning.
- An unknown `$name` is a **loud error** naming the path and listing what IS declared.
- Parameters declared but never referenced are reported in the result (`unusedParams`) — the run
  still succeeds, so nothing else would tell you a rename missed a reference.
- The parameters that produced a result are echoed back in it, the same way the OncoKB pin is.

`notes` is the analyst's prose about the whole document; each view may carry its own
`note`, and each cohort may carry its own `notes`. All three are stored with the
document and travel in a `?doc=` link, so they are rendered as **plain text, never
markdown** — a shared link is untrusted input. None of them are compiled: a cohort's
`notes` never reaches SQL or the compiled readback.

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

### Example 5: Multivariate Cox: gene status alongside a clinical covariate

Overall survival regressed on TP53 mutation status and reported gender, over the whole study. The forest plot reports one hazard ratio per covariate level, each measured against its own reference: a mutated-vs-not covariate always defaults to "Not mutated", any other categorical defaults to its most common level.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "all patients": {
      "all": []
    }
  },
  "views": [
    {
      "kind": "cox",
      "covariates": [
        {
          "source": "alteration",
          "gene": "TP53",
          "by": "mutated"
        },
        {
          "source": "clinical",
          "attribute": "GENDER"
        }
      ]
    }
  ]
}
```

### Example 6: Clinical + timeline event composition

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

### Example 7: Derived filters: enough follow-up to answer the question

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

### Example 8: Progression on immunotherapy: during, versus absent

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

### Example 9: Derived treatment lines: who reaches a third line?

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

### Example 10: True first line: fast progression versus durable control

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

### Example 11: Lab thresholds over time: PSA above 100

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

### Example 12: any / not / genomicData

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

### Example 13: Cross-study federation with an oncoprint

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

### Example 14: Molecular heatmap tracks, sorted by expression

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

### Example 15: A plot of 13,000 samples, drawn as density

Tumour mutational burden against fraction of the genome altered, over every sample of a TP53-mutant cohort. The figure is a density field: the samples are counted into a 240x160 grid, and only the occupied cells travel. Pearson, Spearman and the fitted line are computed over EVERY sample inside ClickHouse, so they describe the whole cohort rather than the points that happened to be painted last. The second view groups the same measure by TP53 mutation class, as quartiles with Tukey whiskers.

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
    }
  },
  "views": [
    {
      "kind": "plot",
      "unit": "sample",
      "x": {
        "source": "clinical",
        "attribute": "MUTATION_COUNT"
      },
      "y": {
        "source": "clinical",
        "attribute": "FRACTION_GENOME_ALTERED"
      }
    },
    {
      "kind": "plot",
      "unit": "sample",
      "x": {
        "source": "alteration",
        "gene": "TP53",
        "by": "mutationType"
      },
      "y": {
        "source": "clinical",
        "attribute": "FRACTION_GENOME_ALTERED"
      }
    }
  ]
}
```

### Example 16: Merged gene rows: a pathway as one track

Pancreatic adenocarcinoma. The first row pools TP53, MDM2 and MDM4: it is altered where any of them is, and its denominator is the union of the three genes' panels — not their intersection, and not the whole cohort. TP53 is drawn again on its own underneath, so the difference the other two make is readable rather than asserted. A row's members are listed in its tooltip and in the contract's `members` field.

```json
{
  "study": "msk_chord_2024",
  "cohorts": {
    "Pancreatic": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "CANCER_TYPE",
          "values": [
            "Pancreatic Cancer"
          ],
          "per": "sample"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "oncoprint",
      "genes": [
        {
          "label": "TP53 pathway",
          "genes": [
            "TP53",
            "MDM2",
            "MDM4"
          ]
        },
        "TP53",
        {
          "label": "RAS",
          "genes": [
            "KRAS",
            "NRAS",
            "HRAS"
          ]
        },
        "SMAD4",
        "CDKN2A"
      ],
      "clinical": [
        "CURRENT_AGE_DEID"
      ]
    }
  ]
}
```

### Example 17: A federated z-score reference on an oncoprint

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

### Example 18: The clinical course: who is still on treatment, and when

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

### Example 19: A reusable workup: one template, retargeted in a single edit

The gene list appears once, in `params`, and every view refers to it as `$genes`; the study likewise. Change either and all three figures follow. The rule is only that a value which is exactly "$name" is replaced by that parameter — no interpolation, no expressions — so the resolved document is an ordinary one and compiles to exactly the SQL you would get by typing the values in. A `$name` with no declaration is a loud error naming the path, and a parameter declared but never referenced is reported back, which is what catches a rename that missed a reference. `notes` and each view’s `note` travel with the document.

```json
{
  "params": {
    "study": "msk_chord_2024",
    "genes": [
      "TP53",
      "KRAS",
      "STK11",
      "KEAP1",
      "EGFR"
    ]
  },
  "study": "$study",
  "title": "NSCLC driver workup",
  "notes": "Standard first pass at a driver panel: how often each gene is altered, whether the alterations travel together, and who carries them. Retarget by editing $genes.",
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
      "kind": "compare",
      "genes": "$genes",
      "note": "Frequencies first — the headline numbers."
    },
    {
      "kind": "cooccurrence",
      "genes": "$genes",
      "note": "Do these drivers co-occur, or exclude one another?"
    },
    {
      "kind": "oncoprint",
      "genes": "$genes"
    }
  ]
}
```

### Example 20: What comes after what: lines of therapy, and what ending a path means

MSK-CHORD therapy lines by TP53 status, 90-day gap, two panels on one scale. Read the grey blocks first, and read them as TWO things: the darker terminal is patients the study watched for at least a line gap who began no further therapy; the lighter one is patients whose records simply stop, about whom nothing can be concluded. Over half of all paths end censored — collapsing them together (as a plain Sankey does) would turn record-keeping into an apparent clinical decision. The real signal is in first line: TP53 wild-type receives far more hormone therapy than TP53-mutant, which is what hormone-receptor-positive disease looks like. The four excluded SUBTYPE values are a judgement made HERE, in the document, not hidden in the engine — 'Prior Medications to MSK' is a provenance marker rather than a therapy, and radiation and bone treatment co-occur with almost everything, so leaving them in explodes the combination space. Nothing in the data structure distinguishes them from real treatments, which is exactly why the choice is visible.

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

### Example 21: Lollipop plot: mutations by protein position, with a suppression floor

Hotspots in colorectal cancer, drawn the way cBioPortal's mutation tab draws them: one stem per codon, its height the distinct patient + protein change pairs there, with the protein's Pfam domains on the backbone — so KRAS spikes at codons 12-13 and BRAF at V600. minCount is applied by each site before anything is returned — with it set to 3, a change carried by one or two patients never leaves the database holding it, which is where small-cell suppression belongs.

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

### Example 22: Co-expression from sums alone

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

### Example 23: Clinical attributes compared between cohorts

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

### Example 24: Co-occurrence and mutual exclusivity in NSCLC

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

### Example 25: Survival from first chemotherapy, left-truncated

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

### Example 26: Study-stratified survival across two studies

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

### Example 27: extends: a nested cohort without repeating its parent's filter

APC-mutant colorectal cancer, then the same population restricted to liver metastasis — without re-stating the APC clause. `compare` shows both share the same APC-mutant base, so a difference between them is attributable to the liver-mets split, not to two independently-typed cohort definitions quietly drifting apart.

```json
{
  "study": "crc_apc_impact_2020",
  "cohorts": {
    "APC-mutant": {
      "all": [
        {
          "kind": "oql",
          "q": "APC: MUT"
        }
      ]
    },
    "APC-mutant, liver mets": {
      "extends": "APC-mutant",
      "all": [
        {
          "kind": "clinical",
          "attribute": "METASTASIS_LIVER",
          "values": [
            "Yes"
          ]
        }
      ]
    }
  },
  "views": [
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

### Example 28: Median/IQR and a rank-sum test, single-study only

APC-mutant colorectal cancer, split by liver metastasis. Alongside mean/SD, numeric attributes report an exact median/IQR and a Mann-Whitney U — available here only because both cohorts stay within one study (crc_apc_impact_2020): median and rank are not additive across sites the way (n, Σx, Σx²) is, so this is refused rather than approximated the moment a cohort spans more than one study.

```json
{
  "study": "crc_apc_impact_2020",
  "cohorts": {
    "liver mets": {
      "all": [
        {
          "kind": "oql",
          "q": "APC: MUT"
        },
        {
          "kind": "clinical",
          "attribute": "METASTASIS_LIVER",
          "values": [
            "Yes"
          ]
        }
      ]
    },
    "no liver mets": {
      "all": [
        {
          "kind": "oql",
          "q": "APC: MUT"
        },
        {
          "kind": "clinical",
          "attribute": "METASTASIS_LIVER",
          "values": [
            "No"
          ]
        }
      ]
    }
  },
  "views": [
    {
      "kind": "clinical",
      "attributes": [
        "MSI_SCORE",
        "AGE_AT_MET"
      ]
    }
  ]
}
```

### Example 29: Cox with a gene-SET covariate: any of three genes, one term

Every patient in the study, one term: mutated in any of TP53/KRAS/PIK3CA versus none of them. Compiles to a single hugo_gene_symbol IN (...) — the same shape as a single-gene covariate, just with a broader gene list, so it costs nothing extra downstream (dummy-coding, the forest plot, the reference-level override all just work).

```json
{
  "study": "crc_apc_impact_2020",
  "cohorts": {
    "all patients": {
      "all": []
    }
  },
  "views": [
    {
      "kind": "cox",
      "endpoint": "OS",
      "covariates": [
        {
          "source": "alteration",
          "genes": [
            "TP53",
            "KRAS",
            "PIK3CA"
          ]
        }
      ]
    }
  ]
}
```

### Example 30: Cox stratified by cohort: does a gene's hazard ratio hold up in both arms?

APC mutation status regressed on overall survival, separately in the MSI-high and MSS arms of the same study. Pooled, APC reads HR=0.61 (95% CI 0.48-0.78) — a real effect, but stratifying shows it is almost entirely a microsatellite-stable-population effect (MSS: HR=0.54, p<0.0001) that does not reach significance in the small MSI-high arm (HR=0.87, 95% CI 0.31-2.44, n=27) — a pooled fit alone would not have shown that the effect is concentrated in one subgroup.

```json
{
  "study": "crc_apc_impact_2020",
  "cohorts": {
    "MSI-high": {
      "all": [
        {
          "kind": "clinical",
          "per": "sample",
          "attribute": "MSI_TYPE",
          "op": "=",
          "value": "Instable"
        }
      ]
    },
    "MSS": {
      "all": [
        {
          "kind": "clinical",
          "per": "sample",
          "attribute": "MSI_TYPE",
          "op": "=",
          "value": "Stable"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "cox",
      "covariates": [
        {
          "source": "alteration",
          "gene": "APC",
          "by": "mutated"
        }
      ],
      "stratifyByCohort": true
    }
  ]
}
```

### Example 31: Logistic regression: does APC status predict MSI-high status?

MSI_TYPE = Instable (vs every other observed value: Stable, Indeterminate, Do not report) regressed on APC mutation status. APC-mutant patients have substantially lower odds of MSI-high status (OR=0.28, 95% CI 0.13-0.63, p=0.0018) — consistent with APC-driven CRC typically arising through the chromosomal-instability pathway rather than the mismatch-repair-deficient pathway MSI-high status marks.

```json
{
  "study": "crc_apc_impact_2020",
  "cohorts": {
    "all patients": {
      "all": []
    }
  },
  "views": [
    {
      "kind": "logistic",
      "outcome": {
        "source": "clinical",
        "attribute": "MSI_TYPE"
      },
      "outcomeEvent": "Instable",
      "covariates": [
        {
          "source": "alteration",
          "gene": "APC",
          "by": "mutated"
        }
      ]
    }
  ]
}
```

### Example 32: Survival split three ways: the k-group log-rank

MSI status in three groups (stable / instable / indeterminate) instead of the usual two-arm split. The test asks whether the three curves differ AT ALL, not which pair does — a different question from running the 2-arm test three times pairwise, which would need its own multiple-testing correction.

```json
{
  "study": "crc_apc_impact_2020",
  "cohorts": {
    "stable": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "MSI_TYPE",
          "values": [
            "Stable"
          ],
          "per": "sample"
        }
      ]
    },
    "instable": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "MSI_TYPE",
          "values": [
            "Instable"
          ],
          "per": "sample"
        }
      ]
    },
    "indeterminate": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "MSI_TYPE",
          "values": [
            "Indeterminate",
            "Do not report"
          ],
          "per": "sample"
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

### Example 33: A missing alteration type is disclosed, never a false negative

TP53 (a real mutation hotspot here) and MDM2 (never assayed for copy-number in this study) side by side. Both show 0%-or-real altered figures, but only the view's note — and each cell's per-type breakdown (mutation/CNA/structural-variant counts, visible on hover in the app) — reveals that MDM2's 0% means "never checked" while TP53's is a real, profiled result.

```json
{
  "study": "sarcoma_msk_2022",
  "cohorts": {
    "Well-diff liposarcoma": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "CANCER_TYPE_DETAILED",
          "values": [
            "Well-Differentiated Liposarcoma"
          ],
          "per": "sample"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "compare",
      "genes": [
        "MDM2",
        "TP53"
      ]
    }
  ]
}
```

### Example 34: Four receptor subtypes, one real test: Welch's ANOVA

Breast cancer's four receptor subtypes, compared on genomic instability (FRACTION_GENOME_ALTERED) and mutation burden (TMB_NONSYNONYMOUS). Triple-negative's markedly higher genomic instability is exactly the known biology, and both the parametric (ANOVA) and rank-based (Kruskal-Wallis) tests agree emphatically; TMB does not differ significantly by subtype here, and again both tests agree.

```json
{
  "study": "breast_msk_2018",
  "cohorts": {
    "HR+/HER2-": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "RECEPTOR_STATUS_PRIMARY",
          "values": [
            "HR+/HER2-"
          ],
          "per": "sample"
        }
      ]
    },
    "TNBC": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "RECEPTOR_STATUS_PRIMARY",
          "values": [
            "Triple Negative"
          ],
          "per": "sample"
        }
      ]
    },
    "HR+/HER2+": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "RECEPTOR_STATUS_PRIMARY",
          "values": [
            "HR+/HER2+"
          ],
          "per": "sample"
        }
      ]
    },
    "HR-/HER2+": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "RECEPTOR_STATUS_PRIMARY",
          "values": [
            "HR-/HER2+"
          ],
          "per": "sample"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "clinical",
      "attributes": [
        "TMB_NONSYNONYMOUS",
        "FRACTION_GENOME_ALTERED"
      ]
    }
  ]
}
```

### Example 35: A non-standard survival endpoint, named directly

MSI-H vs MSS endometrial cancer, progression-free survival from first-line treatment — the study's actual recorded outcome, reachable only because the exact column names are given rather than assumed from an OS/PFS/DFS-style prefix.

```json
{
  "study": "ucec_msk_2018",
  "cohorts": {
    "MSI-H": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "MSI_STATUS",
          "values": [
            "MSI-H"
          ],
          "per": "sample"
        }
      ]
    },
    "MSS": {
      "all": [
        {
          "kind": "clinical",
          "attribute": "MSI_STATUS",
          "values": [
            "MSS"
          ],
          "per": "sample"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "survival",
      "endpoint": "PFS_1L",
      "monthsAttribute": "PFS_MONTHS_FIRST_LINE_TX",
      "statusAttribute": "PROGRESSION_STATUS"
    }
  ]
}
```

### Example 36: Top 20% TMB, within one cancer type: a percentile cutoff

tmb_mskcc_2018 is pan-cancer, so a plain percentile would mix histologies with very different baseline TMB. "NSCLC high-TMB"/"NSCLC low-TMB" both restrict to NSCLC first, then split on whether TMB is at or above the 80th percentile COMPUTED WITHIN THAT NSCLC POPULATION (percentileOf:"NSCLC") — the readback shows the resolved number and what it was a percentile of, not just a bare threshold.

```json
{
  "study": "tmb_mskcc_2018",
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
    },
    "NSCLC high-TMB": {
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
          "kind": "clinical",
          "attribute": "TMB_NONSYNONYMOUS",
          "op": ">=",
          "percentile": 0.8,
          "percentileOf": "NSCLC",
          "per": "sample"
        }
      ]
    },
    "NSCLC low-TMB": {
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
          "kind": "clinical",
          "attribute": "TMB_NONSYNONYMOUS",
          "op": "<",
          "percentile": 0.8,
          "percentileOf": "NSCLC",
          "per": "sample"
        }
      ]
    }
  },
  "views": [
    {
      "kind": "survival",
      "cohorts": [
        "NSCLC high-TMB",
        "NSCLC low-TMB"
      ]
    }
  ]
}
```

