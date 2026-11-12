# Legacy parity spec — Results View › Cancer Types Summary

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.
Bar and scatter tooltips rendered headless (verified). The Data download could not be triggered headless, so its format is `[C]`.

Reference queries:
- Multi cancer type: `/results/cancerTypesSummary?cancer_study_list=msk_impact_2017&case_set_id=msk_impact_2017_all&profileFilter=mutations,structural_variants,cna&gene_list=TP53 KRAS PIK3CA` (58 cancer types, 359 detailed)
- Multi-study: `…?cancer_study_list=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&case_set_id=all&profileFilter=mutations,structural_variants,gistic&gene_list=TP53 KRAS`
- Single cancer type, single gene: `…?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS`

Key files (relative to cbioportal-frontend `src/`): `pages/resultsView/cancerSummary/CancerSummaryContainer.tsx`,
`…/CancerSummaryContent.tsx`, `…/CancerSummaryChart.tsx`, `shared/lib/alterationCountHelpers.ts`,
`pages/resultsView/ResultsViewPageStore.ts` (`extendSamplesWithCancerType`), `shared/lib/isSampleProfiled.ts`.

---

## 0. Shared chrome
- **CTS-0.1** Uses the Results header, global settings menu and banners (see `01-oncoprint.md` RV-1…RV-3). Page-specific behaviour only below.
- **CTS-0.2** Tab "Cancer Types Summary", route `/results/cancerTypesSummary`. Legacy alias `cancer_types_summary`. Always shown unless `disabled_tabs` lists it, and always shown when routed to (`ResultsViewPage.tsx:204-217, 631-642`) `[C]`.
- **CTS-0.3** Banners in `.tabMessageContainer` (`CancerSummaryContainer.tsx:251-293`):
  - OqlStatusBanner with `tabReflectsOql=true` ("…filtered by the OQL specification…").
  - AlterationFilterWarning.
  - CaseFilterWarning.
  - None show for the reference query `[B]`.
- **CTS-0.4** Loading: a large centred spinner until samples, alterations, studies, coverage and profiles have all loaded. On error the tab renders nothing (`:222-242`) `[C]`.

## 1. Gene tabs (pill tabs)
- **CTS-GT-1** Pill tabs (`.pillTabs`): "All Queried Genes" first, then one tab per queried gene in query order. Seen: `All Queried Genes | TP53 | KRAS | PIK3CA`.
- **CTS-GT-2** "All Queried Genes" appears only when there is more than one gene. A single-gene query shows only the gene tab (seen: `KRAS`).
- **CTS-GT-3** `[default]` the first tab is active. *(local)*; no URL param.
- **CTS-GT-4** A gene tab label is grey (`#bbb`) when the gene has 0 alterations in every group (`:135-139`) `[C]`.
- **CTS-GT-5** Tabs unmount on hide, so per-tab controls (§2 marked "per tab") reset when you switch tabs.
- **CTS-GT-6** Gene tabs come from `store.genes`, one per distinct gene. OQL merged tracks and repeated OQL lines for the same gene get no separate tabs. All OQL-filtered alterations for the gene are pooled `[C]`.

## 2. Controls panel (left column)
Panel layout: block "Category" (vertical label) | block "Occurrence" | checkbox below.

**CTS-CT — Category block**

| ID | Control | Options / range | Default | Scope |
|---|---|---|---|---|
| CTS-CT-1 | Category Type (radio) | Cancer Study (`studyId`) · Cancer Type (`cancerType`) · Cancer Type Detailed (`cancerTypeDetailed`) | see CTS-CT-2 | shared across gene tabs *(local)* |
| CTS-CT-3 | Filter Categories › "Min. # Total Patients\|Samples" slider + text box | 0 … `totalCasesMax` (CTS-STM-6) | 10 if `totalCasesMax` > 10, else 0 | per tab *(local)* |
| CTS-CT-4 | "Min. % Altered Patients\|Samples" (freq mode) / "Min. # Altered …" (count mode) slider + text box | 0 … `altCasesMax`; slider end label `ceil(max)` + "%" | 0 | per tab *(local)* |
| CTS-CT-5 | Sort X-Axis By (select) | Y-Axis Values (`y-axis`) · Alphabetically (`x-axis`) | Y-Axis Values | per tab *(local)* |

- **CTS-CT-2 Default Category Type** (`CancerSummaryContainer.tsx:69-88`):
  - More than one study → Cancer Study. Seen in multi-study.
  - One study whose filtered samples all share one `cancerType` → Cancer Type Detailed. Seen for coadread.
  - Otherwise → Cancer Type. Seen for msk_impact_2017.
- **There is no group-by-clinical-attribute option.** There are only these three categories.
- **CTS-CT-6** Wording follows Count By. Seen: "Min. # Total Patients", "Min. % Altered Patients", "Min. # Altered Samples".
- **CTS-CT-7 Text boxes:**
  - Typing strips every character except `0-9` and `.`.
  - The box applies only on Enter (`:537-575`) `[C]`.
  - The altered box displays value + "%" in freq mode (seen "0%").
  - Altered box on Enter: NaN → reset to 0. No clamp.
  - Total box on Enter: NaN → reset to the default minimum. Over the max → clamped to the max (seen: 999999 → 1668).
- **CTS-CT-8 Slider apply timing (legacy quirk):**
  - The Min-altered filter applies live while dragging (it uses the temp value).
  - The Min-total filter applies on release (`:274-284, 355-368, 577-583`) `[C]`.
- **CTS-CT-9** A text box gets the `highlightInput` class when its applied value is > 0. Total defaults to 10, so it is highlighted by default `[C]`.
- **CTS-CT-10 Resets:**
  - Changing Category Type or Count By resets both thresholds to their defaults.
  - Changing Y-Axis Value resets only Min-altered to 0 (`:508-512, 618, 755`).
  - Sort and Y-axis choices survive a Category change. Seen: abs-count / Alphabetically kept.

**CTS-OC — Occurrence block**

| ID | Control | Options | Default | Scope |
|---|---|---|---|---|
| CTS-OC-1 | Count By (radio) | Samples (`sampleCounts`) · Patients (`patientCounts`) | **Patients** | shared across gene tabs *(local)* |
| CTS-OC-2 | Y-Axis Value (select) | Alteration Frequency (`alt-freq`) · Absolute Counts (`abs-count`) | Alteration Frequency | per tab *(local)* |

- **CTS-OC-3** ☑ "Show Genomic Alteration Types" `[default on]`, per tab *(local)*. When off:
  - The stack merges into one bar per group, height = sum of all type segments = total altered.
  - The bar is colour `#666` (the first colour of the scale).
  - The legend is hidden.
  - Downloads are unchanged (CTS-DL-3).
- **CTS-OC-4** There are no per-alteration-type toggles. The only type control is CTS-OC-3.
- **CTS-OC-5** Seen after switching gene tabs: Category and Count By kept; Y-axis, Sort and checkbox back to defaults.

## 3. Chart
There is no table view. The tab shows the chart only. Per-group numbers appear only in tooltips and the Data download.

- **CTS-CH-1** Filter alert above the chart. Shown when fewer groups are plotted than exist AND (total threshold > 0 OR altered threshold > 0):
  - Text: "`X` of `Y` categories (`<Category label>`) are shown based on filtering."
  - Seen: "40 of 58 categories (Cancer Type)…" at the default threshold of 10.
- **CTS-CH-2 Stacked bar chart** (Victory):
  - Bars 20 px wide with 8 px gaps; plot height 400.
  - Y-axis label "Alteration Frequency" (ticks "N%") or "Absolute Counts".
  - The x tick labels on the bar chart are hidden; group labels are drawn under the scatter strip at a 50° angle.
  - More than 37 groups → the chart is 100% wide with horizontal scroll and a synced dummy scrollbar on top (`HORIZONTAL_SCROLLING_THRESHOLD`) `[C]`.
- **CTS-CH-3 Stack order** (bottom → top), with colours:

| Key | Label | Colour |
|---|---|---|
| multiple | Multiple Alterations | `#666` |
| protExpressionLow | Protein Low | `#E0FFFF` |
| protExpressionHigh | Protein High | `#FF989A` |
| mrnaExpressionLow | mRNA Low | `#529AC8` |
| mrnaExpressionHigh | mRNA High | `#FF989A` (same as Protein High — legacy) |
| hetloss | Shallow Deletion | `#8fd8d8` |
| homdel | Deep Deletion | `#0000ff` |
| gain | Gain | `rgb(255,182,193)` |
| amp | Amplification | `#ff0000` |
| structuralVariant | Structural Variant | `#8B00C9` |
| mutated | Mutation | `#008000` |

- **CTS-CH-4 Legend** (horizontal, below the chart):
  - Only types with count > 0 in at least one plotted group.
  - Listed in reverse stack order. Seen: Mutation · Structural Variant · Amplification · Deep Deletion · Multiple Alterations.
- **CTS-CH-5 Profiled-data scatter strip** under the bars, one row per alteration data type of the selected profiles:

| Row label (bottom → top) | Profile type |
|---|---|
| Protein data | PROTEIN_LEVEL |
| mRNA data | MRNA_EXPRESSION |
| CNA data | COPY_NUMBER_ALTERATION |
| Mutation data | MUTATION_EXTENDED |
| Structural variant data | STRUCTURAL_VARIANT |

  - A point appears for each (group, type) where profiled + not-profiled > 0.
  - Glyph: "plus" if profiledCount > 0, else "minus".
  - Seen: "Structural variant data / Mutation data / CNA data" rows.
- **CTS-CH-6 Scatter tooltip:**
  - "`N` patient(s)|sample(s)  profiled" (two spaces in the source); seen "592 patients profiled".
  - "Not profiled" when the profiled count is 0.
- **CTS-CH-7 Bar tooltip** (hovering any segment; popover; stays 100 ms after leaving so it can be hovered):
  - Header: "Summary for `<group>`". When grouped by study AND more than 1 group is plotted, the header is instead a link `<study name> ↗` → `/study?id=<studyId>` (new tab).
  - "Gene altered in `P`% of `N` patients|samples". The same wording is used on the All-genes tab.
  - Table "Alteration | Frequency": one row per type with count > 0, in reverse stack order. Row text "`p`% (`n` patient(s))".
  - Seen: "Summary for Colorectal Cancer / Gene altered in 92.77% of 982 patients / Mutation 90.43% (888 patients) / Structural Variant 0.31% (3 patients) / Amplification 0.1% (1 patient) / Deep Deletion 0.1% (1 patient) / Multiple Alterations 1.83% (18 patients)".
  - Study-link mode only: button "Query this study" (+ " for `<GENE>`" on a gene tab). It opens `/results` in a new window with the current query, but with `cancer_study_list=<studyId>` and `gene_list=<gene>` (or the full list on the All tab), passed via `window.clientPostedData` (`CancerSummaryContainer.tsx:203-220`) `[C]`.
- **CTS-CH-8 Group labels:**
  - Raw group values (cancer type strings).
  - By study: `shortenStudyName(study.name)`; seen full names such as "Colorectal Adenocarcinoma (TCGA, PanCancer Atlas)".
- **CTS-CH-9 Empty states** (`CancerSummaryContent.tsx:803-906`), in order:
  1. No group passes the filters or has profiled cases → "No data to plot." (alert-info). This **replaces the controls too**; the only recovery is switching tabs. Legacy bug `[C]`.
  2. Sum of `alterationTotal` = 0 → "There are no alterations in this gene." (alert-info, no controls) `[C]`.

## 4. Sorting
- **CTS-SO-1** Y-Axis Values + Frequency: descending by `alteredCount / profiledTotal`.
- **CTS-SO-2** Y-Axis Values + Absolute Counts: descending by `alteredCount`. Seen: NSCLC first.
- **CTS-SO-3** Alphabetically: ascending by the **group key**, i.e. by `studyId` rather than the displayed study name (legacy quirk). Seen: "Adrenocortical Carcinoma, Ampullary Cancer, Anal Cancer…".
- **CTS-SO-4** Ties: lodash `orderBy` is stable, so ties keep group first-appearance order (sample order) `[C]`.

## 5. Downloads (`CancerSummaryChart.tsx:729-769, 908-920`)
- **CTS-DL-1** A cloud-download icon button sits top-right of the chart box. Hovering it opens the menu **SVG | PNG | PDF | Data**. Hidden when `skin_hide_download_controls = HIDE_ALL`.
- **CTS-DL-2** Filename base `cancer_types_summary` (`.svg/.png/.pdf/.tsv`). Images contain the bars, scatter strip, labels and legend `[C]`.
- **CTS-DL-3 Data TSV** `[C]`:
  - Header: `<Category label>  <Alteration Frequency|Absolute Counts>  Alteration Type  Alteration Count`.
  - One row per (plotted group in current sort order) × (alteration type in stack order, `multiple` first), skipping y = 0.
  - Values: group = display label; y = **unrounded** float (e.g. `90.42769857433809`) or the count; type = **raw key** (`mutated`, `amp`, `multiple`…); count = integer.
  - Follows the threshold filters; ignores CTS-OC-3.

## 6. Modes & conditions

| ID | Condition | Expected behaviour |
|---|---|---|
| CTS-MD-1 | Samples vs Patients | Changes every numerator and denominator (CTS-STM-2/3), control wording, tooltips, threshold max; resets thresholds |
| CTS-MD-2 | Multi-study / virtual study | Default Category = Cancer Study; tooltip header becomes the study link plus "Query this study" when >1 study is plotted |
| CTS-MD-3 | One study, one cancer type | Default Category = Cancer Type Detailed |
| CTS-MD-4 | Single gene | No "All Queried Genes" tab |
| CTS-MD-5 | OQL query | OQL banner; only OQL-matched alterations counted; mRNA/protein high/low segments appear with EXP/PROT OQL |
| CTS-MD-6 | Driver/VUS/germline filters (RV-2) | Counts use the filtered alterations; AlterationFilterWarning shown |
| CTS-MD-7 | Show only profiled (RV-2) | Unprofiled samples removed from every group (`filteredSamples`); CaseFilterWarning |
| CTS-MD-8 | Gene not on some panels | Those cases are excluded from the denominator only (CTS-STM-4); scatter shows "minus" for groups with no profiled cases |
| CTS-MD-9 | All groups filtered out | "No data to plot.", controls gone (legacy bug) |
| CTS-MD-10 | Gene has no alterations | Grey tab label; "There are no alterations in this gene." |
| CTS-MD-11 | > 37 groups | Horizontal scroll with a top scrollbar |
| CTS-MD-12 | `skin_hide_download_controls=HIDE_ALL` | No download button |

## 7. Persistence summary
- **URL:** none specific to this tab. The tab itself is the route `/results/cancerTypesSummary`. Global params (`exclude_germline_mutations`, `hide_unprofiled_samples`, …) apply; see `01-oncoprint.md` §10.
- **Not persisted:** active gene tab, Category Type, Count By, thresholds, sort, Y-axis, Show Genomic Alteration Types. Category/Count are shared across gene tabs; the rest reset on tab switch.

## 8. Statistics & methods `[C]`

**CTS-STM-1 Cases and grouping**
- Cases: `filteredSamplesExtendedWithClinicalData` = query samples, minus unprofiled samples when Show-only-profiled is on.
- Grouping key, by Category Type:
  - Cancer Type → `sample.cancerType`
  - Cancer Type Detailed → `sample.cancerTypeDetailed`
  - Cancer Study → `sample.studyId`
- Fallbacks (`ResultsViewPageStore.ts:365-419`):
  - `cancerType` = clinical `CANCER_TYPE`, else the study's `cancerType.name`, else `"Unknown"`.
  - `cancerTypeDetailed` = `CANCER_TYPE_DETAILED`, else `cancerType`.
- Patient mode groups samples first by group, then by `uniquePatientKey`. A patient whose samples span two groups is counted in each group.

**CTS-STM-2 Sample mode** (`alterationCountHelpers.ts:114-298`). Per group:
- `profiledTotal` = samples profiled for at least one selected profile of any alteration type (CTS-STM-4).
- Altered sample = has ≥1 OQL-filtered alteration (`oqlFilteredAlterationsByGeneBySampleKey`, after driver/VUS/germline filters).
  - Per-gene tab: that gene's alterations.
  - All tab: all genes' alterations concatenated.
- `alteredCount` = number of altered samples. This counts altered samples whether or not they are profiled.
- Type bucket: take the sample's alterations, de-duplicated **by `alterationType`** (MUTATION_EXTENDED, COPY_NUMBER_ALTERATION, MRNA_EXPRESSION, PROTEIN_LEVEL, STRUCTURAL_VARIANT).
  - More than 1 distinct type → `multiple`.
  - Exactly 1 → that bucket:
    - CNA → `amp` / `gain` / `hetloss` / `homdel`, from `alterationSubType`.
    - mRNA/protein → High or Low, from subtype `high` / `low`.
    - Mutation → `mutated`.
    - SV → `structuralVariant`.
  - So the type buckets plus `multiple` are mutually exclusive, and they sum to `alteredCount`.
- `alterationTotal` = sum over samples of the distinct-type count. Used only for CTS-GT-4 and CTS-CH-9.
- Quirk (All tab): de-duplication is by type, not subtype. TP53 mutation + KRAS mutation → "Mutation" (not Multiple). AMP in gene A + HOMDEL in gene B → counted under whichever CNA comes first.

**CTS-STM-3 Patient mode** (`:300-512`)
- Same rules, applied to the union of a patient's samples' alterations.
- `profiledTotal` = patients with ≥1 profiled sample.
- `alteredCount` = patients with ≥1 altered sample.
- Legacy bug: `notProfiledCounts` increments once per unprofiled *sample* × type, so a patient can be counted both profiled and not-profiled for the same type. Affects only the scatter glyph data.

**CTS-STM-4 Profiled** (`isSampleProfiled.ts:18-49`)
- A sample is profiled for profile P if P appears in its coverage for the gene (gene panel contains the gene) or in its `allGenes` coverage (WES/WGS).
  - Per-gene tab: tested for that gene.
  - All tab: no gene is passed, so the union of every query gene's coverage (profiled for *any* query gene).
- "Profiled for type T" = profiled in any selected profile of type T.
- `profiledCounts[T]` / `notProfiledCounts[T]` feed the scatter strip.
- Note: this is "any type", whereas Mutual Exclusivity requires "all selected profiles" (`03-mutual-exclusivity.md` MEX-STM-1).

**CTS-STM-5 Displayed numbers**
- Bar height (freq mode) = `typeCount / profiledTotal × 100`; the stack top = `alteredCount / profiledTotal × 100`.
- Bar height (count mode) = `typeCount`.
- Tooltip %: `_.round(x × 100, 2)` with trailing zeros dropped (seen 90.43, 0.1).

**CTS-STM-6 Group filters** (applied before plotting)
- A group is plotted iff all three hold:
  - Σ`profiledCounts` > 0.
  - Altered threshold met (inclusive ≥): freq mode `alteredCount/profiledTotal×100 ≥ minAlt`; count mode `alteredCount ≥ minAlt`.
  - `profiledTotal ≥ minTotal`.
- Slider max values (legacy quirk):
  - `totalCasesMax` = the max `profiledTotal`, and `altCasesMax` = the max % or count, both **over the currently plotted groups only**.
  - So each slider's max shrinks as filters are applied. Seen: the max shows 1668 for the msk Cancer Type groups, but 10945 for the single-study group.
- `totalCasesMin` default is 10 when `totalCasesMax` > 10, else 0.
