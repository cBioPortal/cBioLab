# Legacy parity spec — Study View › Summary tab charts

Source of truth: cbioportal.org (checked 2026-11-10), `cBioPortal/cbioportal-frontend@cd8c6df`, and backend `/home/ubuntu/cbioportal@03c0280`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the query param that persists the state; *(local)* means component or store state only, lost on reload.
**Tag key:** `[B]` = seen in the browser only; `[C]` = from code only. Untagged lines were confirmed both ways.
This file **owns every Study View chart type**. Other files reference it.

Reference queries:
- Single study: `/study/summary?id=coadread_tcga_pan_can_atlas_2018` (594 patients / 594 samples; 29 charts by default).
- Multi-study: `/study/summary?id=acc_tcga_pan_can_atlas_2018,msk_impact_2017` (adds Cancer Studies, Cancer Type and # Samples per Patient; gene panels are mixed).

Path prefixes (used in citations):
- `FE/` = `cbioportal-frontend/src/pages/studyView/`
- `BE/` = `cbioportal/src/main/java/org/cbioportal/`
- `CH/` = `cbioportal/src/main/resources/mappers/clickhouse/`

Key files:
- `FE/tabs/SummaryTab.tsx` (per-type props), `FE/charts/ChartContainer.tsx`, `FE/chartHeader/ChartHeader.tsx`
- `FE/charts/{pieChart,barChart,scatterPlot,violinPlotTable,mrnaViolinPlot,survival}/*`
- `FE/table/*` (MultiSelectionTable, FixedHeaderTable, ClinicalTable, treatments/*, GenericAssayFrequencyTable, ClinicalEventTypeCountTable)
- `FE/StudyViewConfig.ts`, `FE/StudyViewUtils.tsx`, `FE/StudyViewPageStore.ts`, `FE/TableUtils.tsx`
- Backend: `BE/legacy/web/util/DataBinner.java` + `LinearDataBinner`, `LogScaleDataBinner`, `ScientificSmallDataBinner`, `DiscreteDataBinner`, `DataBinHelper`
- The live endpoints are the ClickHouse controller `BE/application/rest/vcolumnstore/ColumnarStoreStudyViewController.java`. The MySQL versions now sit under `/api/legacy/…`. Both use the same `DataBinner`.

Out of scope here:
- Page header, filter pills, Add-Chart menu, custom selection, groups and virtual study → study-view header file.
- KM statistics → `20-comparison-core.md`.
- The comparison page itself.

---

## 1. Grid and layout

**STS-LY-1 Grid** (`StudyViewConfig.ts:179-312`)
- react-grid-layout, cell 195 × 170 px, margin 5 px.
- Columns = `floor((windowWidth − 40) / 200)` (`StudyViewPageStore.ts:2858-2865`). The config value `cols: 6` is ignored.
- Container width = cols·195 + (cols+1)·5.
- Chart pixel width = 195w + 5(w−1) − 2·border. Height = 170h + 5(h−1) − 20 (header). Tables subtract another 30 px for the controls row (`StudyViewUtils.tsx:2400-2429`).

**STS-LY-2 Default dimensions (w×h)**

| Type | Size |
|---|---|
| Pie, survival | 1×1 |
| Bar, variant annotations | 2×1 |
| Scatter, violin, every other table | 2×2, minW 2 |
| Clinical table (pie converted to table) | 2×1 if ≤4 rows, else 2×2 (`StudyViewPageStore.ts:9152-9167`) |
| OS survival when left truncation is available | 2×2 |

- Seen: Cancer Type Detailed (3 rows) renders 395×170; with 6+ rows it renders 395×345. `[B]`

**STS-LY-3 Placement**
- First load: charts are sorted by priority desc, then displayName asc (`chartMetaComparator`).
- Each chart goes into the first free spot, scanning rows top-down and then left-right (`findSpot`; `calculateLayout`, `StudyViewUtils.tsx:2106-2290`).
- Later recomputes keep the current order (by y, then x). Newly added charts go last.
- The chart the user just changed (type or size) keeps its x,y (`calculateNewLayoutForFocusedChart`).

**STS-LY-4 Drag**
- The handle is the chart title bar (`.draggable`, `SummaryTab.tsx:1180`). The rest of the chart does not start a drag.
- `useCSSTransforms=false`.

**STS-LY-5 Resize**
- Bottom-right handle on every chart. `isResizable: true`, limited by minW/minH.
- `onResizeStop` writes the new w and h into `chartsDimension` (`SummaryTab.tsx:993-1008`).
- The violin and scatter charts re-render to fit. Violin quartile columns appear only when w > 2 (STS-VI-6).

**STS-LY-6 Newly added chart**
- Highlighted with a 2 px border for `chartHighlight` = 10 000 ms (`ChartContainer.tsx:1679-1687`). `[C]`

**STS-LY-7 Default visible charts** (`StudyViewPageStore.ts:9205-9252`)
- Clinical attributes with priority > 0, sorted, top `studyview_clinical_attribute_chart_count` [default 20].
- Attributes named in the initial filters are always added.
- A clinical chart is shown only if `isFiltered || uniqueValues ≥ 2 || totalSamples == 1` (`shouldShowChart`, `StudyViewUtils.tsx:1480-1486`).
  - Seen: CANCER_TYPE is hidden in single-study coadread (1 value) and shown in the multi-study query. `[B]`

**STS-LY-8 Priority table** (`StudyViewConfig.ts:131-170`)
- A DB priority of exactly 1 (`defaultPriority`) is replaced by the config value. Any other DB priority wins (`StudyViewUtils.tsx:2383-2397`).
- Priority 0 → hidden but still offered in Add Chart. Priority < 0 → dropped entirely.

| Key | Priority | Key | Priority |
|---|---|---|---|
| CANCER_TYPE | 3000 | PATIENT/SAMPLE_TREATMENT*, CLINICAL_EVENT_TYPE_COUNTS, VARIANT_ANNOTATIONS | 75 |
| CANCER_TYPE_DETAILED | 2000 | CANCER_STUDIES | 70 |
| MRNA_VIOLIN_PLOT | 1900 | SEQUENCED | 60 |
| GENOMIC_PROFILES_SAMPLE_COUNT, CASE_LISTS_SAMPLE_COUNT | 1000 | HAS_CNA_DATA | 50 |
| OS / DFS / DSS / PFS survival | 400 / 300 / 250 / 250 | SAMPLE_COUNT | 40 |
| X-VS-Y-FRACTION_GENOME_ALTERED-MUTATION_COUNT | 200 | MUTATION_COUNT | 30 |
| MUTATED_GENES_TABLE | 90 | FRACTION_GENOME_ALTERED | 20 |
| STRUCTURAL_VARIANT_GENES / _VARIANTS | 85 | GENDER, SEX, AGE | 9 |
| CNA_GENES_TABLE | 80 | RACE, ETHNICITY, SAMPLE_TYPE, HISTOLOGY, TUMOR_TYPE, SUBTYPE, TUMOR_SITE | 8 |

- On `*.mskcc.org` hosts the following are overridden: MUTATED 940, CNA 930, SV 920, FGA-vs-MC 890, SAMPLE_COUNT 820, GENOMIC_PROFILES −1.
- The server `study_view` config is merged over the whole table (`StudyViewConfig.ts:330-344`). `[C]`

**STS-LY-9 Chart kind by attribute**
- STRING → pie. NUMBER → bar.
- CANCER_TYPE and CANCER_TYPE_DETAILED (`tableAttrs`) always render as a table.
- A pie with more than `pieToTable` = 20 categories renders as a table instead (`showAsPieChart`, `StudyViewPageStore.ts:11597-11621`).

**STS-LY-10 Loading**
- Page progress items: "Loading meta information" → "Loading clinical data" → "Loading sample data" → "Rendering". After 2 s each pending item gets " - this can take several seconds" (`SummaryTab.tsx:1010-1060`). `[C]`
- Per chart:
  - A spinner while the chart's promise is pending. The old content stays (hidden) unless `renderWhenDataChange` is set.
  - On error: "⚠ Error when loading data." (`ChartContainer.tsx:1754-1782`). `[C]`

**STS-LY-11 Empty and invalid states** `[C]`
- No selected samples → "The filters you have selected have filtered out all the samples in this study; because of this, no data visualizations are shown." plus "You can remove filters in the header…" (`SummaryTab.tsx:1197-1216`).
- Invalid sample ids → a red dismissible alert: "The following sample(s) might have been deleted/updated with the recent data updates", followed by a list of `study:sample`.
- Restored layout → "Your previously saved layout preferences have been applied." with buttons [Keep Saved Layout] [Revert to Previous Layout].

---

## 2. Chart header (all types)

**STS-HD-1 Title**
- `chartMeta.displayName`, bold and centred. Long titles are ellipsized (for example "American Joint Committee on Can…"). `[B]`
- Gene tables add " (N profiled samples)" (STS-GT-2). Scatter and violin titles: STS-SC-1, STS-VI-1.

**STS-HD-2 Hover**
- The control buttons render only while the mouse is in the chart or the menu is open.
- Leaving the chart hides them after 100 ms. Leaving the menu closes it after 125 ms (`ChartContainer.tsx:291-306`, `ChartHeader.tsx:106-121`).
- Menus and submenus open to the left when the pointer x > windowWidth − 400.

**STS-HD-3 Buttons, left to right**

| Button | Shown when | Action / tooltip |
|---|---|---|
| ⓘ info | survival description exists, or the chart has a clinicalAttribute or description | Hover overlay (STS-HD-4) |
| ↶ reset | the chart has ≥1 active filter (violin: any gene selection) | "Reset filters in chart". Clears that chart's filters. Manual-submit mode shows the Alert "In manual submit mode, you can only clear filters using the filter tokens at the top of the page." |
| ✕ delete | always | "Delete chart". Hides the chart, which can be re-added from Add Chart |
| ☰ menu | ≥1 menu item | Hover-open dropdown, 190 px wide (STS-HD-5) |

- Seen: gene tables, Data Types and the scatter have no ⓘ. Clinical, survival, treatment and GA charts have one. Data Types has no ☰ (it has no items). `[B]`

**STS-HD-4 Info overlay** (`getClinicalAttributeOverlay`, `StudyViewUtils.tsx:556-590`)
- **displayName** in bold + " ID: <clinicalAttributeId>".
- The description, shown only if it differs from the displayName (case-insensitive, trimmed).
- Survival charts add "x axis unit: months", and "All events were floored to the nearest month" in compact mode.
- Seen: "Diagnosis Age ID: AGE / Age at which a condition or disease was first diagnosed." and "KM Plot: Overall (months) ID: OS_SURVIVAL / Overall patient survival status. / x axis unit: months". `[B]`

**STS-HD-5 Menu item order** (`ChartHeader.tsx:284-678`; an item appears only when its condition holds)
1. ☐ Log Scale
2. ↑ Swap Axes ↓
3. ☐ Log Scale X
4. ☐ Log Scale Y
5. ☐ Show Violin Plot
6. ☐ Show Box Plot
7. Show Table (pie only)
8. Show Pie (clinical table only)
9. Compare Groups (STS-HD-7)
10. ☐ Left truncation
11. Custom Bins (bar only)
12. ☐ Show NA (bar only, when an NA bin exists)
13. Download ▸ (STS-DL)

Observed item lists `[B]`:

| Chart | Items |
|---|---|
| Pie | Show Table · Compare Groups · Download |
| Clinical table | Show Pie · Compare Groups · Download |
| Bar (linear) | Compare Groups · Custom Bins · Show NA · Download |
| Bar (log-capable, e.g. DAYS_TO_BIRTH) | Log Scale · Compare Groups · Custom Bins · Show NA · Download |
| Scatter FGA vs MC | Swap Axes · Log Scale Y · Download |
| Survival | Download |
| Gene, treatment and GA-frequency tables | Compare Groups · Download |

**STS-HD-6 Change chart type**
- Only pie ↔ table. Nothing else is switchable.
- Switching resizes the chart: table 2×1 or 2×2 by row count (STS-LY-2), pie 1×1. The chart keeps its position.
- Saved in `chartsType` (user settings, STS-PS).

**STS-HD-7 Compare Groups** — opens the comparison page in a new tab (`StudyViewPageStore.ts:2310-2480`)
- Enabled only when the chart's promise is complete, the chart has >1 data row, and the type is in `COMPARISON_CHART_TYPES`. That list is pie, table, bar, mutated/CNA/SV-gene/SV tables, variant annotations, GA frequency table, and all treatment tables (`ChartContainer.tsx:103-119, 451-460`).
- Pie and table: one group per category with ≥1 selected case, ignoring the chart's selection. Groups are sorted by count desc, at most `MAX_GROUPS_IN_SESSION` = 20 (no limit for Cancer Studies), and keep the chart colours. `[C]`
- Bar: submenu **Quartiles / Median / Current bins** (STS-STM-12).
- Gene, treatment and GA tables: the menu item is greyed until ≥2 rows are checked. The same action is available as the table's [Compare] button (STS-GT-9).

---

## 3. Pie chart (`PIE_CHART`, `charts/pieChart/PieChart.tsx`)

- **STS-PIE-1 Data:** categories from `/clinical-data-counts/fetch`, sorted by count desc with NA always last (`clinicalDataCountComparator`).
- **STS-PIE-2 Size:** radius = min(w,h)/2 − 20. The pie is drawn at translate(0, −12). The legend is drawn below the visible area and appears only in SVG/PDF exports (`toSvgDomNodeWithLegend`).
- **STS-PIE-3 Slice labels:** the count, formatted with numeral `0.[0]a`, k/m upper-cased (e.g. "1.2K").
  - Always shown when the slice is more than 25% of the total.
  - Smaller slices show the label only if it fits: `|tan(π·ratio/2)|·(r/5)·2 ≥ textWidth`.
  - Label colour contrasts with the slice (`getTextColor`).
- **STS-PIE-4 Slice `<title>`:** "value:count".
- **STS-PIE-5 Hover tooltip:** a full Clinical table (STS-TBL) of 300×150. Its first column header is the chart title. It has [Select all] / [Deselect all] and [Compare].
  - Hovering a row highlights it.
  - Seen: "Sex / # / Freq / Male 312 52.5% / Female 280 47.1% / NA 2 0.3% / Select all / Compare". `[B]`
- **STS-PIE-6 Click** a slice or its label → toggles that value in the chart's filter.
  - Filter values are matched case-insensitively to the data's spelling (`PieChart.tsx:61-74`).
  - Clicking adds the value; clicking an already-selected value removes it. Several values are OR'ed.
- **STS-PIE-7 Selected styling** (only while the chart has a filter):
  - Selected slices keep their colour and get a 3 px `#cccccc` stroke.
  - Unselected slices are filled `#D3D3D3` at 0.5 opacity.
  - Unselected categories still show their counts (the chart's own filter is excluded, STS-STM-2). Seen with Sex: Male, where Female 209 is drawn grey. `[B]`
- **STS-PIE-8 Colours** (`pickClinicalDataColors`, `addColorToCategories`):
  1. Reserved values (01-oncoprint ONC-TT-1 plus the survival status keys `0:LIVING`, `1:DECEASED`, …). Matching ignores case and whitespace.
  2. NA → `#D3D3D3`.
  3. Every other value cycles through the 13-colour palette `#2986E2 #DC3912 #f88508 #109618 #990099 #0099c6 #dd4477 #66aa00 #b82e2e #316395 #994499 #5574a1 #3b3ea5`, skipping colours already taken by reserved values. Palette order follows count rank.
  4. Once assigned, a colour is pinned per (chart, value) for the session (`chartItemToColor`), so colours stay put when filters change. A newly appearing value gets the first unused palette colour.
- **STS-PIE-9 NA** is a normal slice, coloured `#D3D3D3` and placed last. It can be selected (filter value "NA").

---

## 4. Clinical table (`TABLE`, `table/ClinicalTable.tsx` on `FixedHeaderTable`)

- **STS-TBL-1 Columns**

  | Column | Header | Width | Content | Header tooltip | Default sort |
  |---|---|---|---|---|---|
  | 1 | Chart title (invisible "." when there is no label) | remainder | 12 px colour swatch + value (ellipsis tooltip) | the info overlay | asc by value |
  | 2 | `#` | 80 | checkbox + `count.toLocaleString()` | "Number of patients" or "Number of samples" (by the attribute's level) | desc |
  | 3 | `Freq` | 60 | `freq` string | "Percentage of patients" or "Percentage of samples" | desc by percentage |

- **STS-TBL-2 Initial sort:** Freq desc. Rows whose value is selected are pinned to the top. `[C]`
- **STS-TBL-3 Search box** below the table: placeholder "Search...", 400 ms debounce.
  - Matches the value by upper-case substring, the count as a string, or the freq string.
- **STS-TBL-4 Checkbox** toggles the value, like a pie click.
- **STS-TBL-5 [Select all] / [Deselect all]**
  - Shown only while hovering the chart (in the pie tooltip: always).
  - "Select all" adds every **currently filtered (searched)** row to the existing selection, keeping earlier ones. It is hidden when all rows are selected.
  - "Deselect all" removes the visible rows. It is hidden when nothing is selected.
- **STS-TBL-6 [Compare] button** (shown when comparison is possible):
  - Disabled when exactly one row is selected.
  - With no selection it compares all categories (STS-HD-7). Selecting several rows does **not** restrict the groups (legacy quirk).
- **STS-TBL-7 Row height** 25 px, header 25 px. `[C]`

---

## 5. Bar chart (`BAR_CHART`, numeric clinical, gene-specific numeric, GA numeric, custom numeric)

**STS-BAR-1 Data**
- Clinical: `/clinical-data-bin-counts/fetch?dataBinMethod=STATIC` with `{attributeId, disableLogScale, showNA, customBins?, binMethod, binsGeneratorConfig?}`.
  - Initial custom bins: `MSI_SCORE` [4,10], `MSI_SENSOR_SCORE` [4,10], `MSI_SCORE_MANTIS` [0.4,0.6] (`StudyViewConfig.ts:126-130`).
- Genomic: `/genomic-data-bin-counts/fetch`. GA: `/generic-assay-data-bin-counts/fetch`. Both are STATIC.
- The binning algorithm is in STS-STM-3 … STM-8.

**STS-BAR-2 Layout** (`BarChart.tsx`, `generateNumericalData`)
- One bar per bin. Numeric bins come first, then category bins (non-numeric values), then NA.
- Interval bars sit between ticks (x = i + 0.5). Single-value bins and outlier bars sit on a tick.
- barRatio 0.8. On a log scale whose first edge is not 0 and not a power of 10, the bars shift one slot right and barRatio is scaled by n/(n+1).
- Padding: left 40, right 20, top 10. Bottom padding is computed from the tilted labels.
- Tick labels: rotated 50°, font 0.85× the theme size.
- Y axis: integer ticks only.

**STS-BAR-3 Tick labels** (`formatNumericalTickValues`, `StudyViewUtils.tsx:1582-1692`)
- Values are each interval's start, then the last end. A leading "≤x" and trailing ">x" come from the outlier bins.
- Linear numbers use `toFixedDigit`: integers as-is, otherwise 2 decimals (plus the leading zeros when |v| < 1), trailing zeros stripped.
- Scientific notation (`1e-4`) when the middle bin's end v satisfies 0 < |v| ≤ 0.001.
- Log scale:
  - Integer exponents show as "10^n" with a superscript (negative values as "−10^n").
  - Half-exponent ticks are blank.
  - −10, −1, 0, 1 and 10 are shown literally.
- Seen `[B]`:
  - MUTATION_COUNT: "≤20, 20, 40 … 240, >240".
  - FGA: "≤0.05, 0.05 … 0.7, >0.7".
  - AGE: "≤35, 35 … 90".
  - MSI MANTIS: "≤0.4, 0.4, 0.6, >0.6".
  - MSIsensor: "≤4, 4, 10, >10".
  - DAYS_TO_BIRTH (log): "−10⁵, −10⁴".

**STS-BAR-4 Hover tooltip** (popover, 150 px wide, flips left past the middle bar)
- Text: "Number of samples: **n**" / "Range: **r**".
- r = `formatRange`:
  - "(20, 25]" for an interval
  - "≤18", ">90" for outliers
  - "5" for a single value
  - "NA" or the category string
  - "≤20-25" when a special value has both ends
  - Numbers use `toLocaleString`.
- Seen: "Number of samples: 74 / Range: (60, 80]". `[B]`
- Legacy bug: the label says "samples" even for patient-level attributes (e.g. AGE counts patients) (`BarChartToolTip.tsx:78`).

**STS-BAR-5 Selection**
- Drag horizontally (`VictorySelectionContainer`, x only). Every bar touched by the brush is selected, and the selection replaces the chart's filter. `[C]`
- There is no click-to-select on a single bar. A drag over one bar selects it.
- Each selected bin becomes a `DataFilterValue`: `{start, end}`, or `{end}` for ≤x, `{start}` for >x, `{value}` for NA or a category (`getDataIntervalFilterValues`, `StudyViewUtils.tsx:1335-1349`).
- The backend ORs a chart's values: `start < x ≤ end`, or `|x − v| < e⁻¹¹` when start == end (STS-STM-9).
- Selected bars stay `#2986E2`; unselected bars turn `#D3D3D3`. With no filter all bars are `#2986E2`. A bar counts as selected if a filter range encloses it (`isDataBinSelected`).
- Selecting on the MUTATION_COUNT or FGA bars clears the extra edges added by a scatter selection (STS-SC-6).

**STS-BAR-6 NA handling**
- ☐ Show NA [default off] (`getDefaultClinicalDataBinFilter`). The menu item appears only if an NA bin exists.
- Off: the NA bar and its tick are removed and a top-right label "NA: n" is drawn (hidden if n = 0). The y-max ignores NA.
- On: an "NA" bar and tick are appended last. `[B]`
- Saved per chart (`showNA`, STS-PS).

**STS-BAR-7 Log Scale toggle**
- Shown if log is currently disabled for the chart, or the bins look logarithmic (`isLogScaleByDataBins`: every interval edge v has |v| ≥ 1 or v = 0, and `log10|v|` rounded is a multiple of 0.5) (`StudyViewPageStore.ts:4638-4672`).
- Checked = `!disableLogScale` [default checked, i.e. the backend may choose log].
- Toggling flips `disableLogScale`, **clears the chart's filter** (custom-data charts do not clear it), and refetches.
- Seen: DAYS_TO_BIRTH starts checked; unchecking gives linear bins "≤-32000 … >-12000". `[B]`
- Legacy bug: for custom-data charts `isLogScaleChecked` returns `disableLogScale` un-negated (`StudyViewPageStore.ts:4688-4691`). `[C]`

**STS-BAR-8 Custom Bins modal** (`CustomBinsModal.tsx`)
- Title "Custom Bins". Radios:
  - ○ Quartiles
  - ○ Median split
  - ○ Generate bins
  - ◉ Custom bins [default selected]
- There is **no "Default" option.** An empty Custom box restores default binning (STS-STM-10).
- Custom bins:
  - Prompt "Please specify bin boundaries of the x axis".
  - Textarea prefilled with the current non-zero unique edges, joined with ", ". Seen for AGE: "35, 40, 45, …, 90".
  - Legacy bug: a 0 edge is dropped from the prefill (`getNonZeroUniqueBins`).
- Generate bins:
  - Two text inputs: "Bin size" [0] and "Min value" (anchor) [0]. `[B]`
  - NaN input clears the field. Legacy bug: Update with bin size 0 makes the backend throw (`BigDecimal.remainder(0)`).
- [Update]:
  - Validation `customBinsAreValid`: split on ","; invalid if any piece is NaN. It runs for every method. An invalid entry disables the update.
  - CUSTOM sends the sorted numbers. The other methods send `[]` plus `binMethod` (and `binsGeneratorConfig` for Generate).
- Seen `[B]`:
  - Quartiles on AGE → "≤58, 58, 68, 76, >76".
  - Median → "≤68, >68".
- The modal methods are ignored when the data has ≤10 distinct values (STS-STM-4; legacy quirk).

**STS-BAR-9 Compare Groups submenu:** "Quartiles", "Median", "Current bins" (STS-STM-12).

---

## 6. Gene tables (Mutated Genes, CNA Genes, Structural Variant Genes, Structural Variants)
Shared component `MultiSelectionTable` (`table/MultiSelectionTable.tsx`). The SV pair table is `StructuralVariantMultiSelectionTable`.

**STS-GT-1 When shown**
- One table per alteration type present (mutation, SV, CNA). The chart key is the joined profile ids, e.g. `acc_…_mutations:msk_impact_2017_mutations`. Hidden if its priority is 0.
- The SV **pair** table needs server `skin_study_view_show_sv_table` [default false]. `[C]`

**STS-GT-2 Titles:** "Mutated Genes (N profiled samples)", "Structural Variant Genes (N …)", "CNA Genes (N …)".
- N = samples profiled in the chart's profiles (`molecularProfileSampleCountSet`).
- Seen: coadread Mutated 534, SV 534, CNA 592. `[B]`

**STS-GT-3 Columns**

| Table | Columns (width ratio) | Default sort |
|---|---|---|
| Mutated | Gene .35 · `# Mut` .25 · `#` .25 · `Freq` .15 | Freq desc |
| SV genes | Gene · `# SV` · `#` · `Freq` | **# SV desc** |
| CNA | Gene .24 · Cytoband .24 · CNA .18 · `#` .17 · `Freq` .17 | Freq desc |
| SV pairs | select icon .07 · Gene 1 .3 · Gene 2 .3 · `# SV` .08 · `#` .2 · `Freq` .3 | Freq desc |

**STS-GT-4 Header tooltips**
- `# Mut` "Total number of mutations"
- `# SV` "Total number of structural variants"
- `#` "Number of samples with one or more mutations" (or "…structural variants", "…copy number alterations")
- `Freq` "Percentage of samples with one or more …"
- CNA "Copy number alteration, only amplifications and deep deletions are shown"
- Cytoband "Cytoband"
- When the global Alteration Filter is active, the `#` tooltip becomes "Total number of mutations" (mutated) or "Total number of fusions" (SV), or "Number of samples with one or more copy number alterations" (CNA), followed by "This table is filtered based on selections in the *Alteration Filter* menu." `[C]`
- Seen: the mutated-table tooltips match the first set. `[B]`

**STS-GT-5 Cells**
- `# Mut` / `# SV` = `totalCount` (events).
- `#` = checkbox + `numberOfAlteredCases`.
- `Freq` = STS-STM-13.
- CNA cell: bold, coloured text — `AMP` `#ff0000`, `HOMDEL` `#0000ff` (GAIN `#ffb6c1`, HETLOSS `#8fd8d8`, DIPLOID `#FAF9F6`, other `#cccccc`).
- Numbers use `toLocaleString`. Seen: "4,974". `[B]`
- Freq-cell tooltip (right) `[C]`: "# of samples with a mutation in this gene that are also profiled for mutations: N" / "# of samples profiled for mutations in this gene: M" / "Gene panels: P1, P2" (each a link) or "Gene panels: none".
  - Clicking a panel link opens a modal: the panel id as title, one gene symbol per line, and [Close].
  - There is **no "*" or panel icon** in the cell.

**STS-GT-6 Gene cell** (`GeneCell.tsx`)
- Symbol plus a hover `fa-search` icon. Click (or Enter/Space) toggles the gene in the page's query box. `[B]` (icon and aria "Select gene APC")
- Toasts: "<G> queued for query (see top right of page for submit)" / "<G> removed from query queue". The icon turns "selected" while queued. `[C]`
- Cancer genes only: a tooltip on the left. `[C]`
  - Text: "<G> is included in the OncoKB™ Cancer Gene List [as a oncogene and tumor suppressor gene]."
  - Then **"Click gene symbol to queue for query"** or "…remove from query queue". Non-cancer genes get no hint.
- q-value icon when `qValue` is defined (single study only): MutSig for mutations, GISTIC otherwise. Tooltip "…Q-value: x.xxxe-x". `[C]`
- Legacy oddity: SV rows can show a GISTIC icon carrying a MutSig q-value. `[C]`

**STS-GT-7 OncoKB cancer-gene filter**
- A `fa-filter` icon in the Gene header. Shown only if `show_oncokb` is set and the cancer-gene list loaded.
- Tooltip: "Filtered by OncoKB™ Cancer Gene List. Click to show all genes." or "Showing all genes. Click to filter by OncoKB™ Cancer Gene List." `[C]`
- Client-side filter on `isCancerGene`. The SV pair table keeps a row if either gene is a cancer gene.
- Default: **off** for a fresh anonymous visit (observable starts false). It becomes **on** after "reset charts", or when saved settings lack the value (`StudyViewPageStore.ts:2971-2992, 8278-8280, 8659-8681`). `[C]`
- Per table; saved in user settings. Legacy bug: the SV-pair flag is loaded but never saved.

**STS-GT-8 Alteration-filter indicator:** a passive `fa-filter` in the `#` header. Shown when `skin_show_settings_menu` is set, black when the global Alteration Filter is active. No click action. `[C]`

**STS-GT-9 Row selection** (FixedHeaderTable controls, below the rows)
- Checking rows stages them *(local)*. Already-applied rows are pinned to the top, checked, disabled and highlighted (alternating grey per filter group). `[B]`
- Controls `[B]`:
  - Search box.
  - **[Select Samples]** (text "Add Filters " in manual-submit mode), shown when ≥1 row is checked. With ≥2 rows it gains a ∪/∩ glyph and a caret dropdown.
  - **[Compare]**, shown when ≥2 rows are checked.
- Dropdown items: **Intersection**, **Union**. Tooltip "<op> of samples in the newly selected rows".
  - Default: Union for gene tables, Intersection for Data Types and Case Lists.
  - The choice is saved in localStorage keyed by table type and shared by all tables of that type. `[C]`
- Submit:
  - Union → one OR-group `[[k1,k2]]`. Intersection → `[[k1],[k2]]`.
  - Groups are **appended** to the chart's existing filter. Groups AND with each other; keys within a group OR.
  - Seen: checking APC + TP53 → pill "( APC or TP53 )", and selected samples went 312 → 228. `[B]`
- Keys:
  - Mutated / SV gene: the hugo symbol. CNA: "GENE:AMP" / "GENE:HOMDEL". SV pair: "G1::G2" (`-` = no gene, `*` = any).
  - Filter: `geneFilters {molecularProfileIds, geneQueries[[{hugoGeneSymbol, alterations, + current driver/VUS/germline/somatic/tier flags}]]}`.
  - SV pair: `structuralVariantFilters`.
- [Compare] → comparison with one group per checked gene (`hugoGeneSymbols`). The SV pair table's Compare passes no params (legacy bug).
- Legacy bugs:
  - The SV pair table is wired to the gene-filter getters, so its applied filters are never pinned and reset clears the wrong set (`SummaryTab.tsx:577-581`).
  - The SV-pair filter may be ignored by the ClickHouse backend (no mapper reads `structuralVariantFilters`). `[C]`

**STS-GT-10 Search:** substring over all columns.
- Legacy bug: the Freq search compares the fraction, not the displayed percentage (×100 missing) (`MultiSelectionTable.tsx:447-452`).

**STS-GT-11 Alteration Filter (global, owned by the study-view header):** changes the counts in these tables (`studyViewFilter.alterationFilter`).
- Defaults: CNA {AMP, HOMDEL}; mutations any; germline, somatic and unknown statuses all included; drivers, VUS and tiers all included.
- The CNA table never applies germline/somatic status.

---

## 7. Other table charts

**STS-OT-1 Data Types** (`GENOMIC_PROFILES_TABLE`, key `GENOMIC_PROFILES_SAMPLE_COUNT`)
- Columns:
  - Molecular Profile, with a **blank** header
  - `#` — tooltip "Number of samples"
  - `Freq` = count ÷ selected samples
- No ⓘ, no ☰, no download, no Compare. Default sort Freq desc.
- Selection key = profile type. Default operator **Intersection**.
- Seen: "Putative arm-level copy-number from GISTIC 594 100.0% … Mutations 534 89.9%". `[B]`

**STS-OT-2 Case Lists** (`CASE_LIST_TABLE`): same as Data Types, first column "Name". Shown by default only if the initial filters contain case lists. `[C]`

**STS-OT-3 Mutation Type Counts** (`MUTATION_TYPE_COUNTS_TABLE`, gene-specific, from Add Chart) `[C]`
- Columns: Mutation Type · # Mut · # · Freq.
- Freq denominator = **selected samples**, not profiled samples.
- No cancer-gene icon and no Compare.
- Selection → `mutationDataFilters {hugoGeneSymbol, profileType, categorization:'MUTATION_TYPE', values}`, appended.

**STS-OT-4 Variant Annotations** (`VARIANT_ANNOTATIONS_TABLE`, namespace attributes, 2×1) `[C]`
- Columns: Annotation · `# VA` ("Total number of variant annotations") · # · Freq.
- Denominator = selected samples.
- Selection → `namespaceDataFilters`.

**STS-OT-5 Generic-assay frequency table** (`GENERIC_ASSAY_FREQUENCY_TABLE`, one per binary or categorical GA profile)
- Title "Frequency Table: <profile name>". Seen by default in coadread for arm-level CNA. `[B]`
- Columns: Entity .4 · Category .25 (hidden for BINARY) · # .2 · Freq .15.
- One row per (entity, value) with count > 0.
  - Values "" and "na" are dropped.
  - BINARY profiles also drop `0, absent, false, n, negative, no`.
- Freq = count ÷ (selected patients if the profile is patient-level, else selected samples) × 100. **Unprofiled cases are included** in the denominator. `[C]`
- Header tooltips say "samples" even for patient-level profiles (legacy bug). `[C]`
- ARMLEVEL_CNA and LOH_HLA:
  - Category filter icon tooltip: "Showing altered categories only. Click to include unchanged or unknown rows." / "Showing all categories. Click to hide unchanged or unknown rows."
  - Unchanged/unknown are hidden by default.
  - Sort by curated category priority (loss/deletion/gain/amp first), then Freq desc. `[C]`
- Selection keys `stableId::value::profileType` → `genericAssaySelectionFilters [{profileType, patientLevel, values[[{stableId,value}]]}]`.
  - Legacy risk: the local backend has no `genericAssaySelectionFilters` or `profileType` count field. `[C]`

**STS-OT-6 Treatment tables** (`table/treatments/*`; all have patientAttribute = true, priority 75, 2×2)

| Key | Title | Columns |
|---|---|---|
| PATIENT_TREATMENTS | "Treatment per Patient" | Treatment · `#` ("Number of patients treated") |
| SAMPLE_TREATMENTS | "Treatment per Sample (pre/post)" | Treatment .6 · Pre / Post .3 · `#` .2 ("Number of samples acquired before treatment or after/on treatment") |
| PATIENT/SAMPLE_TREATMENT_GROUPS | "Treatment Category per Patient" / "…per Sample (pre/post)" | as above |
| PATIENT/SAMPLE_TREATMENT_TARGET | "Treatment Target per Patient" / "…per Sample (pre/post)" | as above |

- There is **no Freq column**. Default sort `#` desc.
- The sample table keeps a treatment's Pre and Post rows adjacent: it sorts by that treatment's max count. Seen: "Fluorouracil Pre 155 / Fluorouracil Post 1 / Leucovorin Pre 136 …". `[B]`
- ⓘ shows the description, e.g. "List of treatments and the corresponding number of patients treated". `[C]`
- Visibility:
  - Base pair: when the study has treatment data. Seen in coadread. `[B]`
  - Groups and Target: also need server `enable_treatment_groups` and data at the AgentClass / AgentTarget tier. `[C]`
- Selection keys: `treatment` (patient) or `treatment::time` (sample). Union/Intersection as in STS-GT-9, default Union.
  - Filter `{patientTreatmentFilters | sampleTreatmentFilters}: {filters:[[{treatment, time?}]]}`, appended.
- Compare → one group per checked treatment. Patient tables use all of that patient's samples. `[C]`
- Download: base tables only ("Data").
- Legacy bugs `[C]`:
  - The Groups (sample) table reads `.treatments` from a raw array, so it renders empty.
  - The Target (sample) legacy path ignores the tier.
  - `removeTreatmentsFilter` always starts from the sample filters.
  - `totalSamples` / `totalPatients` are de-duplicated by id only, not by study+id.

**STS-OT-7 Timeline Events Availability** (`CLINICAL_EVENT_TYPE_COUNTS_TABLE`) `[C]`
- Description "Distinct Counts of Patients with Clinical Event Types". Offered only when the study has clinical events. Not visible by default (Add Chart only).
- Columns:
  - Event Type
  - `#` — "Distinct Number of Patients with Event Type"
  - `Freq` — "Freq of Event Types with Selected Patients" = count ÷ selected patients × 100
- Selection → `clinicalEventFilters [{values:[{value, start:0, end:0}]}]`, appended. The localStorage key for the operator is `CLINICAL_EVENT_TYPE_COUNT`.
- Legacy bug: the Freq column search forgets the ×100.

---

## 8. Density scatter (`SCATTER`, "density plot")

- **STS-SC-1 Charts**
  - Default: "Mutation Count vs Fraction Genome Altered" (x = FGA, y = MUTATION_COUNT, 2×2, priority 200). Added when both attributes exist with priority ≠ 0.
  - Others come from Add Chart › X vs Y (priority 0).
  - Title = "<Y> vs <X>". Key `X-VS-Y-<sorted ids>`, so there is one chart per pair.
- **STS-SC-2 Rendering**
  - One dot per non-empty density bin, size 3, offset to the bin's lower-left corner.
  - Colour = `interpolatePlasma(0.75·(ln c − ln min)/(ln max − ln min))`.
  - Legend at top right: title "# samples", a vertical gradient with labels max (top), a middle value, and min (bottom). Seen "34 / 10 / 1". `[B]`
  - Axes: 8 ticks, domain padding 15. FGA domain [0,1]; MUTATION_COUNT min 0. Axis labels get " (log)" when log is on.
  - Empty state: "No data to plot." `[C]`
- **STS-SC-3 Correlation text** (right side, only when n > 2): "Pearson:" / r.toFixed(4) / "p=" p.toFixed(2), then "Spearman:" in the same layout.
  - Seen "Pearson: -0.3317 p=0.00 / Spearman: -0.3487 p=0.00". `[B]`
  - Method: STS-STM-15.
- **STS-SC-4 Tooltip** (hover a dot; hidden while the mouse is down):
  - "Number of Samples: **n**" / "<X>[ (log)]: **xRange**" / "<Y>[ (log)]: **yRange**".
  - xRange = "min.toFixed(2)-max.toFixed(2)", or a single value.
  - yRange = `formatRange`, so "(a, b]" or a single value.
  - Seen "Number of Samples: 1 / Fraction Genome Altered: 0.00 / Mutation Count: 3,070". `[B]`
- **STS-SC-5 Menu**
  - ↑ Swap Axes ↓ (always): swaps x/y and their log flags, then renames the chart.
  - ☐ Log Scale X / ☐ Log Scale Y: shown only for a MUTATION_COUNT axis [default off].
  - Download: Data / SVG / PDF.
- **STS-SC-6 Rectangle drag-select** `[C]`
  - start = min of the selected bins' coordinate; end = max + bin size.
  - If an end equals the domain max (or x ≈ 1), 1 is added to it.
  - All bounds are rounded `toFixed(2)`. In log mode each bound becomes `exp(v) − 1` after rounding (imprecise).
  - Sets **two** clinical filters, one per attribute `{start, end}`, and adds the bounds as extra custom edges on those attributes' bar charts (`_customBinsFromScatterPlotSelectionSet`).
  - Reset ↶ removes both.
- **STS-SC-7** The chart's own filters are **not** excluded, so the plot shrinks to the selected region (unlike pie and bar). `[C]`
- **STS-SC-8** Legacy bugs and dead code `[C]`:
  - The grey "unselected" styling is commented out.
  - `yBinsMin = 52` and `sampleToAnalysisGroup` are passed but unused.
  - The frontend's bin size is computed from the observed data extent, not the request range.

---

## 9. Violin / box charts

**STS-VI-1 Clinical violin table** (`VIOLIN_PLOT_TABLE`, Add Chart › X vs Y with categorical × numeric) `[C]`
- Title "<numeric>[ (log)] vs <categorical>". 2×2, minW 2.
- Settings [default]: violin on, box on, log off.
- **STS-VI-2 Columns**

  | Column | Content | Notes |
  |---|---|---|
  | category | value; resizable | sortable, searchable |
  | numeric | mirrored grey violin + box | sorted by median; width 160 + (w−3)·195 when w > 3 |
  | `#` | checkbox + numSamples; width 60 | default sort desc |
  | Median / Quartile 1 / Quartile 3 | 2 decimals | only when w > 2 |

  - When w ≤ 2 a link reads "Expand to see quartiles →".
- **STS-VI-3** Footer filter "Hide # <" [default 10] hides rows with fewer samples. Empty state "No data."
- **STS-VI-4 Rendering**
  - Curve scale = min(1, 12 / max density): small curves are never scaled up.
  - Rows with ≤7 points get no curve and show all points (r = 3). Otherwise only the 3·IQR outliers are drawn as points.
  - Box: `#dddddd`, 10 px tall.
- **STS-VI-5 Tooltips**
  - Box: "Median:", "Quartile 1:", "Quartile 3:".
  - Point: "Study ID:" link, "Sample ID:" link, then "<numeric>:" value.
- **STS-VI-6 Selection**
  - A category checkbox toggles a categorical filter on the category attribute.
  - Dragging more than 5 px across the numeric column picks a range → `updateClinicalDataCustomIntervalFilter`. This **rewrites the numeric attribute's bar-chart custom bins** to include the range edges (legacy side effect).
  - The active range is shown by white masks outside it.
  - Reset clears both attribute filters.
- **STS-VI-7 Menu**
  - ☐ Log Scale (MUTATION_COUNT only).
  - ☐ Show Violin Plot, ☐ Show Box Plot.
- Legacy bug: the Median and Quartile columns show log-space values while the tooltips convert back.

**STS-VI-8 Gene-specific violin** (`GENE_SPECIFIC_VIOLIN_PLOT`) `[C]`
- Created by Add Chart when ≥2 genes are picked on one continuous profile.
- Title "<profile name> (n genes)". At most 10 genes.
- Data comes from at most **1000 selected samples** (silently truncated).
- Drag on one gene row selects a range on that gene only.
  - A drag under 3 px clears it.
  - Ending within 0.5% of an edge leaves that end open.
- Filter → `genomicDataFilters {hugoGeneSymbol, profileType, values:[{start,end}]}`.
- ↶ appears when any gene has a selection and clears all of them.
- ☐ Log Scale = log2(x+1), allowed only when no value is negative.
- Empty states: "No data available for this study." / "No mRNA expression data available for this study."
- `MRNA_VIOLIN_PLOT` has a type and a priority (1900), but nothing ever registers it (dead).

---

## 10. Survival mini chart (`SURVIVAL`)
Uses the KM chart and statistics from 20-comparison-core.md. Study-view differences only.

- **STS-KM-1 Charts**
  - One per prefix P that has both `P_STATUS` and `P_MONTHS`. Key `P_SURVIVAL`, 1×1.
  - Title "KM Plot: " + STATUS displayName with "status"/"survival" removed + " (months)". Seen "KM Plot: Overall (months)", "…Disease Free…", "…Disease-specific…", "…Progression Free…". `[B]`
- **STS-KM-2 Population**
  - Patients of the currently selected samples, one curve, colour `#2986E2`.
  - **No p-value** is ever shown (only one analysis group).
- **STS-KM-3 Rendering** `[C]`
  - The legend lives in the tooltip. Headers: "Number of Cases, Total", "Number of Events", "Median Months Survival".
  - y-label tooltip "% event free". 2 y ticks, 4 x ticks.
  - No slider, no table, no in-chart download buttons.
  - Compact mode when a group has more than 15 000 patients.
- **STS-KM-4 Selection:** none. The `onUserSelection` prop is passed but never called (dead code). Reset is a no-op.
- **STS-KM-5 Left truncation** `[C]`
  - Only for `heme_onc_nsclc_genie_bpc` with the feature flag on, and only for OS.
  - Entry time comes from `TT_CPT_REPORT_MOS`. ☑ "Left truncation" [default on]. The chart becomes 2×2.
- **STS-KM-6 Download:** Data / SVG / PDF.

---

## 11. Gene-specific, generic-assay and custom-data charts (created from Add Chart)

| ID | Source | Chart | Categories / bins | Filter |
|---|---|---|---|---|
| STS-GS-1 | Gene + mutation profile | pie (or table) | "Mutated" `#1b9e77`, "Not Mutated" `#d95f02`, "Not Profiled" `#D3D3D3`; other values `#A9A9A9`; labels via `transformMutatedType` | `mutationDataFilters` (MUTATED) `[C]` |
| STS-GS-2 | Gene + mutation profile, "mutation type" option | Mutation Type Counts table (STS-OT-3) | — | `mutationDataFilters` `[C]` |
| STS-GS-3 | Gene + discrete CNA profile | pie | AMP / GAIN / DIPLOID / HETLOSS / HOMDEL with the CNA colours (STS-GT-5); "NA" displays as "Not Profiled" | `genomicDataFilters {value}` `[C]` |
| STS-GS-4 | Gene + continuous profile | bar (STS-BAR, genomic bins) | — | `genomicDataFilters {start,end}` `[C]` |
| STS-GS-5 | GA entity, continuous | bar, 2×1 | GA bins, STATIC | `genericAssayDataFilters` `[C]` |
| STS-GS-6 | GA entity, binary/categorical | pie | value counts | `genericAssayDataFilters {value}` `[C]` |
| STS-GS-7 | Custom data (user-defined) | pie / table / bar | counts computed client-side over selected cases | custom sample-identifier filter `[C]` |

- These reuse the pie, table and bar behaviour in §3–5. The only differences are in the table above.

---

## 12. Special charts

- **STS-SP-1 Cancer Studies** (multi-study only, i.e. >1 physical study)
  - Pie, priority 70. Description "The cancer study id for each sample in the cohort".
  - Counts **samples** per studyId and labels slices with **study ids**, not names. Becomes a table when there are more than 20 studies.
  - Seen: "Cancer Studies / msk_impact_2017 10,945 99.2% / acc_tcga_pan_can_atlas_2018 92 0.8%". Menu: Show Table · Compare Groups · Download. `[B]`
  - Selection becomes a sample-identifier filter, intersected with the other sample-list filters. The Compare group count is not limited.
- **STS-SP-2 Cancer Type / Cancer Type Detailed:** always tables (STS-LY-9). Cancer Type is seen only in multi-study (2×2). `[B]`
- **STS-SP-3 # Samples per Patient** (`SAMPLE_COUNT`, "Number of Samples Per Patient"): an ordinary clinical pie, priority 40. Seen in multi-study. `[B]`
- **STS-SP-4** There is no mutation-spectrum chart in the Study View (grep finds none). `[C]`

---

## 13. Downloads (☰ › Download ▸)

| Chart | Options | Content |
|---|---|---|
| Pie, clinical table | Summary Data · Full Data · SVG · PDF | Summary: `Category\tNumber of <samples\|patients>\tPercentage of <…>`, one row per category (freq string). Full: `Study ID\tPatient ID[\tSample ID]\t<displayName>` per selected case, missing → "NA". Table SVG/PDF renders a hidden pie with its legend |
| Bar | Data · SVG · PDF | Data = Full format |
| Scatter | Data · SVG · PDF | per-sample x/y values for selected samples |
| Survival | Data · SVG · PDF | per patient |
| Gene tables | Data | Mutated: `Gene, MutSig(Q-value), # Mut, #, Profiled Samples, Freq`. SV: `Gene, # Structural Variant, #, Profiled Samples, Freq`. CNA: `Gene, Gistic(Q-value), Cytoband, CNA, Profiled Samples, #, Freq`. Plus `Is Cancer Gene (source: OncoKB)` when OncoKB is on |
| Treatments (base), GA frequency, mutation type, variant annotations | Data | table rows |
| Data Types, Case Lists, treatment Groups / Target | none | — |

- **STS-DL-1** File name = displayName with spaces → "_".
- **STS-DL-2** Server `skin_hide_download_controls`: HIDE_ALL hides the menu item; anything other than SHOW_ALL hides the data download. `[C]`
- **STS-DL-3** Legacy bugs `[C]`:
  - The CNA TSV writes altered, then profiled, under the headers "Profiled Samples, #" (swapped).
  - The SV-pair TSV has an empty Gene column and "Is Cancer Gene" is always "No".
  - The download Freq uses `numberOfAlteredCases` (not the on-panel count), so it can differ from the screen.

---

## 14. Selection → filter summary

| Chart | User action | Filter written | Within chart | Own counts |
|---|---|---|---|---|
| Pie / clinical table | click / checkbox | `clinicalDataFilters {attributeId, values:[{value}]}` | OR | own filter excluded (other slices stay visible, greyed) |
| Bar | x-drag | `clinicalDataFilters {values:[{start?,end?,value?}]}` | OR | own filter excluded; STATIC edges |
| Gene tables | check + Select Samples | `geneFilters` / `structuralVariantFilters` (appended groups) | Union = OR, Intersection = AND | own filter **included** |
| Data Types / Case Lists | check + Select | `genomicProfiles` / `caseLists` `string[][]` | as above | included |
| Treatments | check + Select | `patient/sampleTreatmentFilters` | as above | included |
| Scatter | rectangle drag | 2 × `clinicalDataFilters {start,end}` | AND | included |
| Violin table | checkbox / range drag | categorical + custom-bin interval | — | numeric filter excluded from curves |
| Survival | none | — | — | — |

- **STS-FL-1** Filters on different charts AND together (intersection).
- **STS-FL-2** Filters are **not** written to the URL. Seen: the URL is unchanged after selections. `[B]`
  - URL input only: `filterJson`, or `filterAttributeId` + `filterValues` (numeric "a-b,c-d" → `{start,end}`; else comma-separated values). An unknown attribute shows "The clinical attribute X is not available for this study" (`StudyViewQueryExtractor.ts:140-185`). `[C]`
- **STS-FL-3** In manual-submit mode a chart cannot remove a filter (Alert: "In manual submit mode, you can only remove filters using the filter tokens at the top of the page."). Buttons read "Add Filters ". `[C]`

---

## 15. Modes and conditions (each must be checked)

| ID | Condition | Expected behaviour |
|---|---|---|
| STS-MD-1 | Single study | No Cancer Studies chart. Cancer Type is hidden if it has 1 value. q-value icons are available |
| STS-MD-2 | Multi-study / virtual study | Cancer Studies pie; Cancer Type table; gene-table keys join profile ids with ":"; no MutSig/GISTIC q-values; frequencies are panel-aware (MUC16 14/91 = 15.4% ranks above KRAS 14.9% in the reference query) `[B]` |
| STS-MD-3 | Mixed gene panels | Freq denominator per gene = samples whose panel has the gene + WES samples (STS-STM-13); "Gene panels:" listed in the Freq tooltip |
| STS-MD-4 | Patient-level attribute | Counts patients; table tooltips say "patients"; the bar tooltip still says "samples" (bug); Compare and Full download expand to the patients' samples |
| STS-MD-5 | Attribute both patient- and sample-level across studies ("conflicting") | Counted per sample (patient value repeated for each of its samples) `[C]` |
| STS-MD-6 | Chart has its own filter | Pie/bar/table: counts exclude the chart's own filter, so unselected categories stay visible in grey. Gene tables and scatter: include it |
| STS-MD-7 | ≤10 distinct numeric values | Discrete bars, one per value; custom/quartile/median/generate are ignored `[C]` |
| STS-MD-8 | Wide numeric range (box range > 1000) | Log bins by default; Log Scale item checked; unchecking gives linear bins `[B]` |
| STS-MD-9 | NA present | Bar: "NA: n" label, Show NA item. Pie: grey NA slice last |
| STS-MD-10 | More than 20 categories | Pie renders as a table |
| STS-MD-11 | OncoKB disabled (`show_oncokb` off or fetch failed) | No cancer-gene icon or tooltips |
| STS-MD-12 | Manual submit (autosubmit off) | Buttons read "Add Filters "; chart UI cannot remove filters (Alert) |
| STS-MD-13 | Logged in | Layout, chart types, bins, NA and log toggles, and cancer-gene flags saved per study set; restore banner (STS-LY-11) |
| STS-MD-14 | All samples filtered out | No charts; message as in STS-LY-11 |
| STS-MD-15 | `*.mskcc.org` host | Priority overrides (STS-LY-8) |
| STS-MD-16 | Narrow window | Fewer grid columns; charts reflow |

---

## 16. Persistence summary

**URL:** only the tab (`/study/summary`), `id`, and the input-only filter params (STS-FL-2). Filters and layout are **not** in the URL.

**Session-service user settings** (logged in, per study set; `ChartUserSetting`):
- `id`, `chartType`, `layout {x,y,w,h}`
- `customBins`, `disableLogScale`, `showNA`
- `filterByCancerGenes`
- X-vs-Y attribute ids, `violinLogScale`
- gene/profile/GA ids for added charts
- Not saved: `binMethod` and `binsGeneratorConfig` (Quartile / Median / Generate are lost on reload).

**localStorage:** the Union/Intersection operator per table type.

**Not persisted *(local)*:** checked-but-unsubmitted rows, table sort and search, hover state, pinned colour assignments, violin show-box/show-violin toggles.

---

## 17. Statistics & methods `[C]`

**STS-STM-1 Clinical counts** (`/clinical-data-counts/fetch`; ClickHouse `CH/clinical_data/ClickhouseClinicalDataMapper.xml:271-364`)
- `count(*)` by (attribute, raw value) over the filtered cases. Sample attributes count samples; patient attributes count patients. Conflicting-level attributes count one per sample.
- Values are merged case-insensitively. The spelling kept is the lexicographically greatest (e.g. "true" beats "TRUE") (`StudyViewColumnarServiceUtil.java:132-177`).
- NA row = filtered cases − Σ counts, emitted only if > 0. Cases in studies that lack the attribute count as NA. NA strings ("NA", "NAN", "N/A", "") are folded into NA.
- An attribute missing from the result gets a single NA row equal to all filtered cases.

**STS-STM-2 Own-filter exclusion** (`NewClinicalDataBinUtil.java:23-34`; legacy `StudyViewController.java:174-176`)
- When a counts or bins request names exactly **one** attribute, that attribute's own clinical filter is removed from `studyViewFilter`.
- The frontend requests per chart once that chart is filtered, which gives the "selected chart keeps all categories" behaviour.

**STS-STM-3 Pie / table percentage**
- `freq = getFrequencyStr(100·count / Σ counts of the chart, NA included)`.
- Σ = all filtered cases (excluding the chart's own filter).
- Format:
  - 0 → "0%"
  - 99.9 ≤ v < 100 → "99.9%"
  - v ≥ 0.1 → 1 decimal
  - otherwise "<0.1%"
  - negative or NaN → "NA"
- The pie legend (SVG only) shows "value: count (freq)".

**STS-STM-4 Bin method dispatch** (`DataBinner.java:357-430`; first match wins)
1. **Discrete:** 1–10 distinct numeric values (after removing special outliers) → one bin per value, `[v,v]`. This overrides every user method.
2. **CUSTOM** with edges:
   - Edges outside special-value bounds are dropped and the bound inserted (`adjustCustomBins`).
   - Bins `(eᵢ, eᵢ₊₁]` plus "≤e₀" / ">eₙ" outliers.
   - With one edge: only ≤x and >x.
3. **GENERATE {binSize, anchor}:**
   - First edge = min + ((anchor − min) mod binSize), made non-negative.
   - Then add binSize while the edge < max. The max is never an edge, so the top values land in ">last".
4. **MEDIAN:** "≤m" / ">m". m = the mean of the two middle values for even n.
5. **QUARTILE:** edges {Q1, Q2, Q3}, de-duplicated. Q1 = median of the lower half, Q3 = median of the upper half (the middle element is excluded for odd n). If all three are equal it falls back to MEDIAN.
6. **Log:** box range > 1000 and `!disableLogScale` (STM-6).
7. **Scientific small:** the element at index ceil(n/2) lies in (−0.001, 0.001) and ≠ 0 (STM-7).
8. **Linear** (STM-5).

**STS-STM-5 Linear bins** (`LinearDataBinner.java`, `DataBinHelper.java`)
- Box range (`calcBoxRange`):
  - q1 = sorted[⌊0.25n⌋], q3 = sorted[⌊0.75n⌋]. If q1 == q3 == max, drop the max values and recompute.
  - Bounds q1 − 1.5·IQR and q3 + 1.5·IQR, clamped to [min, max].
  - Rounding: 3 decimals (HALF_UP) if 0.001 ≤ q3 < 1; none if q3 < 0.001; otherwise floor/ceil to 1 decimal.
  - Integer-only data truncates the box range to longs.
- Outlier limits: lower = max(boxLower, data "<"/"<=" bound), upper = min(boxUpper, data ">"/">=" bound).
- Interval:
  - The first of {0.001, 0.002, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000} with (max − min)/interval < 20.
  - Integer data uses only {1, 2, 5, 10, 20, 25, 50, 100, …, 10000}. If none qualifies, 10000.
- Start = min + interval − (min mod interval). Subtract one interval if there is no lower outlier, or if start − interval > lower outlier.
- End = max, or max − interval when max + interval ≥ upper outlier. Edges step while ≤ end.
- **AGE rule:** applies to ids matching `^AGE$`, `^AGE_.*`, `.*_AGE_.*`. If min < 18 and (boxUpper − boxLower)/2 > 18 and the first bin end > 18, the first bin starts at 18 ("≤18").
- No other per-attribute special-casing (none for MUTATION_COUNT or FGA).

**STS-STM-6 Log bins** (`LogScaleDataBinner.java`)
- Start exponent = 0 if boxLower = 0, else ⌊log10|lo|⌋ (negative lo → −⌈…⌉).
- Step 0.5. Edge = sign(e)·⌊10^|e|⌋, giving 1, 3, 10, 31, 100, 316, 1000, 3162, …
- Continue past boxUpper to the next integer power of 10. Edges are clipped by the special bounds.
- Legacy quirk: negative ranges go …, −3, −1, 0, 3, 10 (+1 is skipped).

**STS-STM-7 Scientific-small bins** (`ScientificSmallDataBinner.java`)
- Per-value exponent = precision − scale − 1 (zeros dropped). Take the box range of the exponents.
- Range > 1: edges 10^i with step round(range/4), from lo − step to hi.
- Range = 1: 10^lo/3, then 10^i and 3·10^i.
- Range = 0: step 2·10^lo, from 10^lo to 10^(hi+1).

**STS-STM-8 Bin assembly and counting**
- Order: lower outlier "≤" (if count ≠ 0), intervals, upper outlier ">" (if count ≠ 0), leading and trailing zero-count bins trimmed.
- If every interval holds exactly one distinct integer, all of them convert to `[v,v]` (all or nothing).
- Then non-numeric categories (grouped case-insensitively, first-seen spelling, first-appearance order), then NA last.
- Ranges: intervals `(start, end]`; discrete `[v,v]`; "≤x" = (−∞, x]; ">x" = (x, ∞).
- Data strings like "<18" or ">=90" join the outlier bins. They are relabelled "≤" / ">" whatever their original operator.
- STATIC: edges are computed on the **unfiltered** cohort, then counts on the filtered cohort. Zero-count bins from the unfiltered layout are kept, so edges stay stable as filters change.
- Legacy bugs:
  - ">=x" data relabelled ">" is then missed by the `x > start` filter and by the STATIC re-count.
  - `1` vs `1.0` become two discrete bins and each value is counted in both (BigDecimal equals vs compareTo).

**STS-STM-9 Numeric filter matching** (ClickHouse `CH/studyview/ClickhouseStudyViewFilterMapper.xml:297-467`)
- Values OR'd within an attribute; different attributes INTERSECTed.
- `{start,end}` → start < x ≤ end. `{v,v}` → |x − v| < e⁻¹¹. `{end}` → x ≤ end. `{start}` → x > start.
- Data strings cast before comparison: "<=x" / ">=x" → x; "<x" → x − e⁻¹⁰; ">x" → x + e⁻¹⁰; other non-numerics → NULL.
- `{value}` → `ILIKE value` (case-insensitive; `%` and `_` are unescaped wildcards — legacy bug).
- "NA" matches an NA-ish value, a missing row, or a study without the attribute.
- Patient-level matches expand to all of the patient's samples.

**STS-STM-10 Custom-bins edge cases**
- An empty Custom box passes validation (`Number("") = 0`), sends `[]`, and the store deletes `customBins`. The backend then uses default binning (the only route back to "default").
- For genomic and GA charts `[]` is sent as-is.

**STS-STM-11 Bar NA count:** from the counts in STM-1 (ClickHouse) or legacy (NA strings + cases with no row). Shown as "NA: n" when Show NA is off.

**STS-STM-12 Bar "Compare Groups"** (`StudyViewPageStore.ts:1490-1610`, `GroupComparisonUtils.splitData`)
- Data: the attribute's values for the selected cases. Non-numeric values are dropped.
- **Quartiles / Median:**
  - Sort ascending and split into 4 (or 2) **equal-count slices**: slice i = data[⌊i·n/k⌋ … ⌊(i+1)·n/k⌋). Empty slices are dropped.
  - Ties can straddle groups. Group name = "first-last" value (integer or 2 decimals).
  - Session label "Quartiles of X" / "Median of X". These differ from the backend QUARTILE bins.
- **Current bins:** one group per displayed bin with ≥1 case, assigned with the same (a,b] / [v,v] / ≤ / > rules. Name `getBinName` ("20-25", "<=20", ">90", "NA"). Label "Bins of X".
- Patient attributes map patients to all their selected samples.

**STS-STM-13 Gene-table counts and frequency** (`CH/alteration/ClickhouseAlterationMapper.xml`; `AbstractAlterationCountByGeneUseCase.java:40-75`)
- `totalCount` (`# Mut` / `# SV`) = number of events that pass the alteration filter. Mutations exclude `UNCALLED`.
- `numberOfAlteredCases` (`#`) = distinct samples with ≥1 event, **including off-panel calls**.
- `numberOfAlteredCasesOnPanel` = distinct samples whose call is on-panel.
- **Freq = on-panel altered ÷ numberOfProfiledCases × 100** (falls back to `#` when the on-panel field is absent). Format as in STM-3.
- `numberOfProfiledCases`, per gene:
  - (filtered samples whose gene panel, in the **first profile of that alteration type per study**, contains the gene)
  - + (filtered samples with panel "WES" for that alteration type, **not** restricted to the first profile; added to every gene).
  - Samples in no profile are never counted.
- Rows with the same hugo symbol (different entrez ids) are summed. CNA does **not** sum the on-panel count (legacy bug).
- CNA rows are per (gene, alteration ∈ {AMP, HOMDEL} by default).
- Sample-level only; there is no patient option.
- Sorting by Freq: rows with 0 profiled or 0 altered sort as 0.

**STS-STM-14 Other denominators**
- Data Types, Case Lists, Mutation Type Counts, Variant Annotations: ÷ selected samples.
- Timeline events: ÷ selected patients.
- GA frequency table: ÷ selected samples or patients, unprofiled included.
- Treatments: counts only, no frequency.

**STS-STM-15 Density scatter** (`BE/…/ClinicalDataDensityPlotServiceImpl.java:88-173`; `StudyViewPageStore.ts:9903-10000`)
- Bin counts: x 44, y 38. These come from the hard-coded pixel sizes `ceil(263.282/6)` and `ceil(223.372/6)`.
- Axis start/end: FGA 0/1; MUTATION_COUNT start 0; otherwise the data min/max.
- Interval = (end − start)/count. Index = ⌊(v − start)/interval⌋; v = end goes into the last bin.
- Each bin reports count and the real minX/maxX/minY/maxY. Zero bins are dropped.
- A sample needs both values numeric. Patient attributes are copied to each of the patient's samples.
- Log is applied only to MUTATION_COUNT, as **ln(1+x)** (natural log, not log10). The axis bounds are transformed too.
- Pearson and Spearman: commons-math, over all included samples (log-transformed if on). 0 when ≤1 point.
- p-value (frontend `PlotUtils.ts:462-482`): t = |r|·√((n−2)/(1−r²)), two-sided Student t with **df = n − 2** (`jStat.ttest(t, n−1, 2)` subtracts 1 internally). The same formula is used for Spearman. 0 when |r| = 1; null when n ≤ 2. n = Σ bin counts.
- Legacy bug: a value outside an explicit axis range (e.g. FGA < 0) gives an out-of-range bin index, which throws.

**STS-STM-16 Clinical violin** (`BE/…/ViolinPlotServiceImpl.java`)
- Row `#` = samples in the fully filtered set.
- Curves and boxes use the samples filtered with only the **numeric** attribute's own filter removed.
- Box: commons-math `Percentile` (default estimator), p25 / p50 / p75.
- Whiskers: if any point lies beyond 1.5·IQR on either side, **both** whiskers sit at the fences Q1 − 1.5·IQR and Q3 + 1.5·IQR; otherwise min and max (legacy quirk). Clamped to the axis.
- Outlier points: beyond 3·IQR.
- KDE: 100 curve points over [global min, global max]. Gaussian σ = 4·step, where step = (end − start)/99.
  - Sum of normalized Gaussians over the non-outlier points, **not divided by n**. Display scale min(1, 12/max).
- Rows with ≤7 points: points only.
- Log (MUTATION_COUNT only) = ln(1+x).
- Category vs numeric is decided per value by whether the second datum parses as a number. Legacy bug: numeric-looking categories misfire.

**STS-STM-17 Gene-specific violin** (`MrnaViolinPlotChart.tsx`)
- KDE with 80 points over the 1st–99th percentile range.
- Bandwidth = max(1.06·σ·n^−0.2, 5% of range).
- Quartiles by nearest rank; whiskers clamped to 1.5·IQR.
- Rows with ≤2 distinct values, or IQR = 0, are drawn as a jittered strip instead.
- At most 1000 samples are used.

**STS-STM-18 Survival mini chart:** KM per 20-comparison-core.md, over the patients of the selected samples. Status '1' (parsed prefix) = event. No log-rank (single group).

**STS-STM-19 Cancer Studies counts:** samples per studyId over the selected samples, with the chart's own filter excluded. Freq as in STM-3.
