# Legacy parity spec — Results View › Plots (owner of shared box / violin / scatter / waterfall / bar / table plotting)

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.
Point tooltips rendered once headless (scatter); the rest of §9 is `[C]` unless marked. Generic-assay limit values (">8") are code-derived unless marked.

Reference queries:
- Single study: `/results/plots?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS TP53 APC`
- Generic assay / waterfall: `/results/plots?cancer_study_list=ccle_broad_2019&case_set_id=ccle_broad_2019_all&profileFilter=mutations,gistic&gene_list=BRAF NRAS` (Treatment Response profiles `CCLE_drug_treatment_AUC/IC50/zscore`). No public entity with ">x"/"<x" values was found (first 24 IC50 entities checked), so limit-value behaviour (PLT-AX-5, PLT-LV) is `[C]`.
- Multi-sample patients: `cancer_study_list=lgg_ucsf_2014&gene_list=IDH1 TP53 ATRX`
- Multi-study: `cancer_study_list=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&case_set_id=all`
- State is in the URL, e.g. `&plots_horz_selection={"dataType":"MRNA_EXPRESSION","selectedGeneOption":3845,"selectedDataSourceOption":"rna_seq_v2_mrna","logScale":"true"}&plots_vert_selection={...}&plots_coloring_selection={...}`

Key files (all `src/shared/components/plots/` unless noted): `PlotsTab.tsx` (controls, plot-type rule, coloring),
`PlotsTabUtils.tsx` (axis data, appearance, legends, tooltips, downloads, log functions), `PlotsTabStore.ts` (data caches),
`ScatterPlot.tsx`, `BoxScatterPlot.tsx` + `src/shared/lib/boxPlotUtils.ts`, `WaterfallPlot.tsx`, `MultipleCategoryBarPlot(.tsx|Utils.ts)`,
`TablePlot.tsx` + `TablePlotUtils.ts`, `PlotUtils.ts` (jitter, sizes, p-value, colors), `QuickPlots.ts`, `LastPlotsTabSelectionForDatatype.ts`,
`SelectedDataAlert.tsx`, `PlotsTabUrlParameters.tsx`, `PlotsTabTypes.ts`. Mounted from `src/pages/resultsView/ResultsViewPage.tsx:256`
(the same `PlotsTab` is reused by Study View and Patient View wrappers). There is no `src/pages/resultsView/plots/` directory at this commit.

**For other spec files:** the scatter, box(-scatter), waterfall, multiple-category bar, and table components are specified here
(PLT-SC, PLT-BX, PLT-WF, PLT-BR, PLT-TB, PLT-STM). Legacy has **no violin plot** in this tab; "violin" is not an option anywhere in
`PlotsTab`. Reference the IDs; list only page-specific prop differences (§12).

---

## 0. Tab chrome

Uses the Results header and global settings menu (see 01-oncoprint.md RV-1…RV-4). Plots-specific:

- **PLT-CH-1** OQL banner: shown only if the query has OQL; Plots uses `tabReflectsOql=false` → "…does not affect…" (unaffected) wording `[C]`.
- **PLT-CH-2** AlterationFilterWarning rendered with `isUnaffected=true`: the driver/VUS/germline filters of RV-2 do **not** filter Plots data (see PLT-STM-2) `[C]`.
- **PLT-CH-3** CaseFilterWarning (Show-only-profiled): same as RV-3; filtered-out samples are excluded from every axis `[C]`.
- **PLT-CH-4** (Not shown on cbioportal.org for coadread + brca PanCan `[B]`.) Multi-study and server rule `enable_cross_study_expression` disallows → info alert "Expression data cannot be compared across the selected studies." and mRNA / protein / miRNA / RNA profiles are dropped from the study's profile list `[C]`.
- **PLT-CH-5** Banners PLT-CH-1/2/3 are hidden when there are no queried genes (Study/Patient View reuse) `[C]`.

---

## 1. Layout

- **PLT-LY-1** Top row "**Examples:**" + quick-plot pills (§7). The pill whose axes match the current selection is `active`.
- **PLT-LY-2** Left column, top→bottom: **Horizontal Axis** block · `↑ Swap Axes ↓` link button · **Vertical Axis** block · Utilities (§5). Spinner until data types, sources and coverage are loaded.
- **PLT-LY-3** Right column (chart), top→bottom:
  1. Info alert "Showing N samples with data in both profiles (axes)" + ⓘ (PLT-MS-5).
  2. Bordered chart box: "Color samples by:" toolbar (§6; hidden for discrete-vs-discrete), download controls top-right (§10), selection bar (PLT-HL-5), plot in a horizontally scrolling pane with a synced top scrollbar.
  3. Footnotes under the box (PLT-MS-7).
- **PLT-LY-4** Plot sizes `[C]`: scatter 650×650 chart (`PLOT_SIDELENGTH`); box chartBase 550; waterfall: sample axis = 480 + round(1.6 × N) px, value axis = 500 px; bar chartBase 650; table min 650×650, min cell 35×35.

---

## 2. Axis menus (identical for horizontal and vertical unless noted)

Each block: title "Horizontal Axis" / "Vertical Axis", then the controls below in this order.

### PLT-AX-1 Data Type select (not searchable, not clearable)
Options = data types that have ≥1 profile *with data for the queried genes*, in this order:

| Order | Label | value | Notes |
|---|---|---|---|
| 0 | Ordered samples | `none` | Only listed when the **other** axis is mRNA or a LIMIT-VALUE generic assay (PLT-PT-1). ⓘ "Sample order determined by values on the '<other profile name>' axis" |
| 1 | Clinical Attribute | `clinical_attribute` | if any NUMBER/STRING attribute |
| 2 | Custom Data | `custom_attribute` | logged-in custom data only `[C]` |
| 3 | Mutation | `MUTATION_EXTENDED` | |
| 4 | Structural Variant | `STRUCTURAL_VARIANT` | |
| 5 | Copy Number | `COPY_NUMBER_ALTERATION` | |
| 6 | mRNA | `MRNA_EXPRESSION` | |
| 7 | Gene Sets | `GENESET_SCORE` | only if the query has gene sets `[C]` |
| 8 | Protein Level | `PROTEIN_LEVEL` | |
| 9 | DNA Methylation | `METHYLATION` | native (non-generic-assay) methylation only |
| 10+ | one per generic-assay type, e.g. "Treatment Response", "Arm-level CNA", "Genetic Ancestry", "Methylation" | `<genericAssayType>` | in profile order, one per type; label from GA config or Title-Cased type |

Seen (coadread): `Ordered samples, Clinical Attribute, Mutation, Structural Variant, Copy Number, mRNA, Protein Level, Arm-level CNA, Genetic Ancestry, Methylation` (the last three are generic-assay types). `[B]`

- **PLT-AX-1a Defaults** (`PlotsTab.tsx:1062-1144`):
  - Vertical: mRNA if present, else the first option (normally Clinical Attribute).
  - Horizontal: Copy Number if present, else Structural Variant, else the first option.
  - A URL `dataType` that no longer exists is replaced by the default.
  - Seen `[B]`: coadread → horz `Copy Number / gistic / KRAS`, vert `mRNA / rna_seq_v2_mrna / Same gene (KRAS)` (box plot). lgg_ucsf_2014 (mutations only) → both axes `Clinical Attribute / MUTATION_COUNT` (first attribute by priority), i.e. a scatter of an attribute against itself.
- **PLT-AX-1b** Changing data type: resets the source to the type's first option, clears "Filter categories", sets `viewLimitValues=true`, restores this axis's last gene/gene-set/source/entity chosen for that type in this session (*(local)* history), and re-runs coloring-gene auto-choice (PLT-CL-3).
- **PLT-AX-1c** If one axis was "Same gene" and the other axis switches to a non-gene type, the "Same gene" axis is set to the actual gene `[C]`.

### PLT-AX-2 Source select (searchable, not clearable) — hidden for `Ordered samples`
| Data type | Label | Options |
|---|---|---|
| Clinical Attribute | "Clinical Attribute" | NUMBER/STRING attributes, unique by id across studies, sorted by priority desc then display name; ⓘ attribute description |
| Custom Data | "Custom Attribute" | same rule |
| Mutation | "**Plot Mutations by**" | Mutation Type `[default]` · Mutated vs Wild-type · Driver vs VUS · "Variant Allele Freqency" (sic) · Cancer Cell Fraction (only if the axis gene has ASCN `ccfExpectedCopies`) · Clonality (only if ASCN `clonal`). An unavailable selection resets to Mutation Type once mutations load. URL `mutationCountBy` |
| Structural Variant | "**Plot Structural variants by**" | Variant vs No Variant `[default]` · Variant Type (hidden when every SV has no `variantClass` or `NA`). URL `structuralVariantCountBy` |
| Molecular / GA / gene set | "`<Type label>` Profile", e.g. "mRNA Profile", "Copy Number Profile", "Treatment Response Profile" | one option per profile-id **suffix** (id minus `<studyId>_`), so the same profile across studies is one option; label = first profile's name; sorted by name, except Copy Number: DISCRETE first; ⓘ profile description |

- Generic-assay profiles with `showProfileInAnalysisTab=false` are not offered as sources `[C]`.
- Seen coadread mRNA order: RSEM (`rna_seq_v2_mrna`) · z-scores rel. all samples · rel. diploid · rel. normal. Copy Number: `gistic` then `log2CNA`. `[B]`
- URL: `selectedDataSourceOption=<suffix>`.

### PLT-AX-3 Sort Order button (waterfall only)
- Shown on the **Ordered samples** axis block when the plot is a waterfall. Label "Sort Order", `fa-signal` icon rotated per direction.
- Toggles ASC ↔ DESC. Initial value = the profile's `sortOrder` (seen `ASC` for CCLE AUC). *(local)*.

### PLT-AX-4 Log Scale checkbox
- **Shown** iff (`logScalePossible`, `PlotsTabUtils.tsx:2769`):
  - axis data is numeric with no negative values, **or**
  - generic-assay LIMIT-VALUE with no negative values, **or**
  - the source id matches `/rna_seq/i` and not `/zscore/i`.
- **Disabled** (and shown unchecked) when the data has negatives, unless it is an mRNA `rna_seq` non-z-score profile.
- Default off. Auto-set **on** when an mRNA source whose id contains `rna_seq` is chosen via the source select or a quick-plot pill (not on initial page load). `[B]`: default load had log off; selecting `rna_seq_v2_mrna` turned it on.
- Effective only while still possible (stored flag AND possible). URL `logScale="true"|"false"`.
- Axis label gets the suffix " (log2(value + 1))" for non-GA data, " (log10)" for generic assay. Methods: PLT-STM-11.

### PLT-AX-5 Limit-value checkbox (generic assay LIMIT-VALUE only)
- Shown on an axis whose GA data contains threshold values. Label "Value `>8.00` Labels **" (joined with " or " for several, e.g. "Value >8.00 or <0.01 Labels"); no "**" on waterfall.
- `[default]` checked. *(local)*; reset to checked by any gene/source/entity/data-type change.
- Effect: PLT-LV-*.

### PLT-AX-6 Gene select (not searchable) — for Mutation, SV, Copy Number, mRNA, Protein, DNA Methylation
- Options = queried genes in query order. Label suffix " (Not profiled)" if no sample is profiled for the gene (no whole-profile coverage and no panel containing it).
- Vertical only: first option "Same gene (<horizontal gene>)" when the horizontal axis has a gene selector. `[default]` on vertical. Seen: "Same gene (KRAS)".
- Horizontal default = first queried gene.
- URL `selectedGeneOption=<entrez>` (−20000 = Same gene). Also stored in localStorage `plotsHorzGeneSelection` / `plotsVertGeneSelection` and used when the URL has none `[C]`.

### PLT-AX-7 Gene Set select — Gene Sets only `[C]`
- Options = queried gene sets (`genesetId`, label = name). Vertical adds "Same gene set (<name>)". Default = first. URL `selectedGenesetOption`.

### PLT-AX-8 Entity select — generic assay types
- Label = plural type name, e.g. "Treatment Responses". Searchable (regex, case-insensitive, on label and value; invalid regex matches nothing).
- Menu header "Showing N of M" style counts; at most **100** non-selected options listed (`DEFAULT_GENERIC_ASSAY_OPTIONS_SHOWING`).
- Grouping: if the query URL preselected entities for that type (oncoprint GA tracks), groups "Selected entities" and "Other entities".
- Ordering of other options (gene-related GA types only): entities matching the **other axis's gene** first, then entities matching any queried gene, then the rest. Match = regex `^(GENE|GENE\W+.*)$` on label or stable id.
- Default = first gene-related option for the other axis's gene, else the first option.
- Vertical adds "Same <type> (<entity>)" when both axes have the same GA type.
- ⓘ next to it: entity stable id (linked to the entity URL if any) + description.
- Option label = name/description/stableId composite; axis label uses entity name (or compact "name (id)" when the type config says so).
- URL `selectedGenericAssayOption=<stableId>`.

### PLT-AX-9 Filter categories (multi-select, clearable, searchable) — box plots only
- Shown on the **category** axis when the plot is a box plot and the axis has categories.
- Options = all distinct string values on that axis, sorted alphabetically.
- Empty = all categories. Selecting keeps only those boxes. *(local)*; cleared on data type/source change; swapped by Swap Axes.

### PLT-AX-10 ☐ Sort Categories by Median — box plots with >1 category, on the string axis
- Sorts boxes by ascending median of the raw values (PLT-STM-9). *(local)*.

### PLT-AX-11 ↑ Swap Axes ↓
- Swaps data type, source, log scale, mutation-count-by, selected categories, gene (unless vertical = Same gene), gene set (unless Same), GA entity (unless Same).
- Legacy bug: `structuralVariantCountBy` is **not** swapped (`PlotsTab.tsx:3018-3024`) `[C]`.

---

## 3. Axis data per data type (`makeAxisDataPromise`, `PlotsTabUtils.tsx:936-1699`)

Samples = the Results View filtered samples (PLT-STM-1). One record per sample unless noted; a record can carry several values (one point per value).

| ID | Data type / source | Value per sample | Kind | Category order |
|---|---|---|---|---|
| PLT-DT-1 | Clinical (sample attr) | raw value; NUMBER → `parseFloat` (non-numbers → NaN → dropped) | number / string per attribute datatype | none (alphabetical) |
| PLT-DT-2 | Clinical (patient attr) | patient value copied to each of the patient's filtered samples | same | same |
| PLT-DT-3 | Mutation › Mutation Type | no mutation: "No mutation" if profiled for the gene, else "Not profiled"; one class → that class; ≥2 classes → "Multiple" | string | Missense, Inframe, Truncating, Splice, Promoter, Other, Multiple, No mutation, Not profiled |
| PLT-DT-4 | Mutation › Mutated vs Wild-type | "Mutated" / "No mutation" / "Not profiled" | string | Mutated, No mutation, Not profiled |
| PLT-DT-5 | Mutation › Driver vs VUS | "Driver" if any mutation is a putative driver, else "VUS"; "No mutation" / "Not profiled" | string | Driver, VUS, No mutation, Not profiled |
| PLT-DT-6 | Mutation › VAF | one value per mutation with integer alt/ref counts (PLT-STM-21); samples without such mutations are **excluded** | number | — |
| PLT-DT-7 | Mutation › Cancer Cell Fraction | one value per mutation with ASCN `ccfExpectedCopies`; others excluded | number | — |
| PLT-DT-8 | Mutation › Clonality | unique non-NA ASCN `clonal` values: one → it, several → "INDETERMINATE"; all NA → excluded; no mutation → "No mutation"/"Not profiled" | string | CLONAL, SUBCLONAL, INDETERMINATE, No mutation, Not profiled |
| PLT-DT-9 | Structural Variant › Variant vs No Variant | "With Structural Variants" / "No Structural Variants" / "Not profiled for structural variants" | string | none (alphabetical) |
| PLT-DT-10 | Structural Variant › Variant Type | unique `variantClass`; ≥2 → "Multiple structural variants" | string | none |
| PLT-DT-11 | Copy Number, DISCRETE profile(s) | −2 "Deep Deletion", −1 "Shallow Deletion", 0 "Diploid", 1 "Gain", 2 "Amplification" (other values kept raw) | string | Deep Deletion, Shallow Deletion, Diploid, Gain, Amplification |
| PLT-DT-12 | Copy Number continuous, mRNA, Protein, DNA Methylation | profile value; samples absent from the profile response have no record | number | — |
| PLT-DT-13 | Gene Sets | `Number(value)` from the gene-set profile | number | — |
| PLT-DT-14 | Generic assay LIMIT-VALUE | `parseFloat` of the number after stripping a leading `>`/`<` (kept as `thresholdType`) | number | — |
| PLT-DT-15 | Generic assay CATEGORICAL / BINARY | raw string | string | reserved per-type order if configured, else alphabetical |
| PLT-DT-16 | Ordered samples | empty data, kind `none` | none | — |

- **PLT-DT-17** Mutations considered = all mutations of the axis gene in the study's mutation profile for the filtered samples, annotated with driver status (OncoKB/hotspot/custom per RV-2 checkboxes), **not** filtered by Show-only-drivers / Show-only-somatic. Legacy bug: germline mutations that are also VUS are dropped (`PlotsTabStore.ts:1166-1171` concatenates `data + vus + germline` but not `vusAndGermline`) `[C]`.
- **PLT-DT-18** "Profiled" for mutation/SV categories = the sample is profiled for the gene in ≥1 of the selected profiles (gene panel contains the gene, or whole-genome/exome coverage).
- **PLT-DT-19** Axis labels (`getAxisLabel`):
  - Clinical: display name. Gene set: "`<genesetId>: <profile name>`". GA: "`<entity name>: <profile name>`" (seen "A-443654: Treatment response: AUC").
  - Molecular: "`<GENE>: <profile name>`"; Mutation: Mutation Type → "`GENE: <profile name>`" (seen "KRAS: Mutations"); Driver vs VUS → "`GENE: Driver vs VUS Mutations`"; VAF → "`GENE: Variant Allele Frequency`"; CCF → "`GENE: Cancer Cell Fraction`"; Clonality → "`GENE: Clonality`"; Mutated vs WT → "`GENE: Mutated vs Wild Type`". SV: "`GENE: Variant Type`" / "`GENE: Variant vs No Variant`".
  - Plus " (log2(value + 1))" or " (log10)" when log is on.
  - Long labels wrap (60-char chunks on scatter).

---

## 4. Plot-type rules (`PlotsTab.tsx:4923-4957`)

| ID | Horizontal | Vertical | Plot |
|---|---|---|---|
| PLT-PT-1 | Ordered samples | number | **Waterfall**, vertical bars |
| PLT-PT-2 | number | Ordered samples | **Waterfall**, horizontal bars |
| PLT-PT-3 | number | number | **Scatter** |
| PLT-PT-4 | string | number | **Box**, vertical boxes (categories on x) |
| PLT-PT-5 | number | string | **Box**, horizontal boxes (categories on y) |
| PLT-PT-6 | string | string | **Discrete vs discrete**: Bar / Stacked bar `[default]` / 100% stacked bar / Table (PLT-UT-4) |

- "Ordered samples" is only offered when the other axis is mRNA or GA LIMIT-VALUE, so waterfalls exist only for those (in practice; any number axis would qualify).
- Number = PLT-DT kinds marked number; string = marked string. Discrete CNA, mutation categories, SV, clinical STRING, GA categorical/binary are strings.
- Seen `[B]`: CNA×mRNA → box; mRNA×mRNA → scatter; CNA×Mutation → stacked bar; FGA×Mutation Count → scatter; None×Treatment response → waterfall.

---

## 5. Utilities (left column, below the vertical axis)

Hidden entirely when none of its items apply.

| ID | Control | Shown when | Default | Persist |
|---|---|---|---|---|
| PLT-UT-1 | "Search Case(s)" text box, placeholder "Case ID.." | any non-discrete plot | empty | *(local)* |
| PLT-UT-2 | "Search Mutation(s)" text box, placeholder "Protein Change.." + red "Mutation not found for selected gene" (waterfall only, when no plotted point matches any word) | non-discrete plot AND coloring-by-gene is possible (mutation profile exists and a gene is chosen in "Color samples by") | empty | *(local)* |
| PLT-UT-3 | ☐ Connect samples from the same patient | box plot AND ≥1 patient has ≥2 samples among plotted points | off | *(local)* |
| PLT-UT-4 | "Plot Type" select: Bar chart · Stacked bar chart `[default]` · 100% stacked bar chart · Table | discrete vs discrete | Stacked | *(local)* |
| PLT-UT-5 | "Sort By" select: Alphabetically `[default]` · Number of samples · one option per minor category (bar colors), in data order, unsorted (seen `[B]` "Rectal Adenocarcinoma, Colon Adenocarcinoma, Mucinous…") | discrete vs discrete, not Table | Alphabetically | *(local)* |
| PLT-UT-6 | ☐ Horizontal Bars | same as UT-5 | off | *(local)*; toggling resets Sort By to Alphabetically |
| PLT-UT-7 | ☐ Show Regression Line | scatter | off | *(local)* |

- **PLT-UT-8** Search inputs apply 600 ms after the last keystroke. Words split on whitespace.
  - Case match: any word is a **case-sensitive substring** of the sample id (seen `[B]`: "TCGA-A6" highlighted 51 points).
  - Mutation match: any word, as a **case-insensitive regex**, matches the protein change of any of the point's mutations (coloring gene). Legacy bug: an invalid regex (e.g. "(") throws `[C]`.
  - Matched points are highlighted (PLT-HL-1).
- **PLT-UT-9** No jitter control exists; box-plot points are always jittered (PLT-STM-10). No violin option.

---

## 6. "Color samples by" toolbar (all plots except discrete vs discrete)

- **PLT-CL-1** Select (searchable): groups
  1. "None"
  2. "Genes": queried genes
  3. "Clinical Attributes": "Cancer Study" (special) + all clinical and custom attributes (incl. Profiled-in and comparison-group attributes), except Mutation spectrum.
  - URL `plots_coloring_selection.selectedOption = "<entrezId>_<JSON{clinicalAttributeId,patientAttribute,studyId}>"`. Changing it clears legend highlights.
- **PLT-CL-2 Default**: the first queried gene (seen "KRAS"; "BRAF"). Seen `[B]` group sizes coadread: None · Genes(3) · Clinical Attributes(64, first "Cancer Study").
- **PLT-CL-3 Auto-choice** on any axis change (`autoChooseColoringMenuGene`):
  - exactly one axis is a gene-based molecular axis (not clinical, gene set, GA, none) → color by that axis's gene;
  - both are, and the current coloring gene is on neither → the horizontal gene;
  - if a gene is now selected and Mutation Type and Copy Number are both off → turn both on.
- **PLT-CL-4** Checkboxes after the select, only when coloring by a gene (labels exact):

  | Box | Shown when | Default | URL |
  |---|---|---|---|
  | Mutation Type * | a mutation profile exists | ☑ | `colorByMutationType` |
  | Structural Variant¹ | an SV profile exists | ☑ | `colorBySv` |
  | Copy Number | a discrete CNA profile exists | ☑ | `colorByCopyNumber` |
  | None (radio) | waterfall only | — | — |

  - On waterfalls they are **radio buttons** (mutually exclusive): precedence Mutation > Copy Number > SV when several are true in the URL; seen default = Mutation Type only. `[B]`
- **PLT-CL-5** "Log Scale" checkbox: only when coloring by a NUMBER clinical attribute whose values are all ≥ 0. URL `plots_coloring_selection.logScale`. Default off.
- **PLT-CL-6** Coloring is ignored (none of the boxes shown) when the "Color by" choice is None. Coloring by clinical precludes genomic coloring.
- **PLT-CL-7** Footnotes (below chart): "* Driver annotation settings are located in the settings menu [sliders] at the top of the page." when mutation coloring is possible; "¹ Structural variants are shown instead of copy number alterations when a sample has both." when SV coloring is possible.

### PLT-CL-8 Point appearance (scatter and box points) `PlotsTabUtils.tsx:1877-2397`
Default (no coloring): fill `#00AAF8`, stroke `#0089C6`, circle.

*Mutation fill* (stroke `#000`, opacity 0.5):

| dispMutationType | Drivers annotated | Drivers not annotated |
|---|---|---|
| missense(.driver) | VUS `MUT_COLOR_MISSENSE_PASSENGER` "Missense (VUS)" / driver `MUT_COLOR_MISSENSE` "Missense (Driver)" | `MUT_COLOR_MISSENSE` "Missense" |
| inframe | "Inframe (VUS/Driver)" | "Inframe" |
| trunc | "Truncating (VUS/Driver)" | "Truncating" |
| splice | "Splice (VUS/Driver)" | — legacy bug: the non-driver map has no `splice` entry, so the point falls back to default blue and the legend builder dereferences `undefined.legendLabel` (likely throws) when a splice mutation is present and no driver source is enabled `[C]` |
| promoter | "Promoter (VUS/Driver)" | "Promoter" |
| other | "Other (VUS/Driver)" | "Other" |
| fusion | `STRUCTURAL_VARIANT_COLOR` "Fusion" | "Fusion" |
| not mutated | fill `#c4e5f5`, stroke opacity 0.3, "Not mutated" | same |
| not profiled | fill white, stroke `LIGHT_GREY`, "Not profiled for mutations" (2 lines) | same |

Colors are the oncoprint mutation colors (01-oncoprint.md §3). "promoter" and "other" never get ".driver" in the key, so their "(Driver)" variants are unreachable `[C]`.

*CNA / SV stroke* (fill becomes transparent when only CNA/SV coloring is on; stroke width 1.8):

| Value | Stroke | Legend |
|---|---|---|
| 2 | `CNA_COLOR_AMP` (red) | Amplification |
| 1 | `#ff8c9f` | Gain |
| 0 | `DEFAULT_GREY` | Diploid |
| −1 | `#2aced4` | Shallow Deletion |
| −2 | `CNA_COLOR_HOMDEL` (blue) | Deep Deletion |
| SV present | `STRUCTURAL_VARIANT_COLOR` (purple) | "Structural Variant ¹" — wins over CNA |
| not profiled | `BLACK` | "Not profiled" / "for CNA", "for Structural Variants" or "for CNA and Structural Variants" |
| profiled, no CNA record | Diploid grey (no legend entry unless 0-values exist) | — |

- Mutation fill and CNA/SV stroke combine on the same point.
- Limit-value points (PLT-LV-2) become diamonds.
- **PLT-CL-9** Draw order (z): highlighted on top; then by clinical has-data; else mutation priority `fusion > promoter.driver > splice.driver > trunc.driver > inframe.driver > missense.driver > other.driver > promoter > splice > trunc > inframe > missense > other > not mutated > not profiled`, then SV present > SV none > not profiled, then CNA `−2 > 2 > −1 > 1 > 0 > not profiled` (higher priority drawn on top) `[C]`.
- **PLT-CL-10 Clinical coloring**: STRING → reserved colors (01-oncoprint.md ONC-TT-1 list, plus mutation class names) else unique D3-31 palette colors in data order; stroke `#000` 0.5. NUMBER → `d3.interpolateReds((x−min)/(max−min))`, or with log scale `ln(max(0.01,x))` normalized the same way. No data → fill `LIGHT_GREY` "No data". (PLT-STM-18)

---

## 7. Quick-plot pills ("Examples:") (`QuickPlots.ts`)

Clicking a pill sets the listed data types/sources, then auto-sets log scale for rna_seq mRNA, then "Same gene" vertically when marked.

| ID | Pill | Shown when | Sets (vertical × horizontal) |
|---|---|---|---|
| PLT-QP-1 | Mut# vs Dx | Clinical has MUTATION_COUNT & CANCER_TYPE_DETAILED and 1 < #cancer types < 16 | MUTATION_COUNT × CANCER_TYPE_DETAILED |
| PLT-QP-2 | Mut# vs Dx | MUTATION_COUNT & CANCER_TYPE and #cancer types > 15 | MUTATION_COUNT × CANCER_TYPE (legacy bug: never shown active because `selected` checks CANCER_TYPE_DETAILED) |
| PLT-QP-3 | FGA vs Dx | as QP-1 with FRACTION_GENOME_ALTERED | FGA × CANCER_TYPE_DETAILED |
| PLT-QP-4 | FGA vs Dx | as QP-2 with FGA | FGA × CANCER_TYPE (same legacy bug) |
| PLT-QP-5 | Mut# vs FGA | both attributes exist | MUTATION_COUNT × FGA |
| PLT-QP-6 | mRNA vs Dx | mRNA + CANCER_TYPE_DETAILED, #cancer types > 1 | mRNA (first source) × CANCER_TYPE_DETAILED |
| PLT-QP-7 | mRNA vs mut type | mRNA + Mutation, ≥1 mutation | mRNA (Same gene) × Mutation |
| PLT-QP-8 | mRNA vs CNA | mRNA + Copy Number | mRNA (Same gene) × Copy Number |
| PLT-QP-9 | mRNA vs methyl | mRNA + data type value `METHYLATION` (native or GA) | mRNA (Same gene) × METHYLATION |
| PLT-QP-10 | Protein vs mRNA | Protein + mRNA | Protein (source `brca_tcga_protein_quantification` if present) (Same gene) × mRNA |
| PLT-QP-11 | Tx Waterfall | GA type TREATMENT_RESPONSE | Treatment response (first source) × Ordered samples |
| PLT-QP-12 | mRNA vs Study | mRNA + "Study of origin" attribute (multi-study) | mRNA × Study of origin |

- Seen coadread `[B]`: Mut# vs Dx · FGA vs Dx · Mut# vs FGA · mRNA vs Dx · mRNA vs mut type · mRNA vs CNA · mRNA vs methyl · Protein vs mRNA. CCLE adds Tx Waterfall.
- Legacy bug: "#cancer types" is `Object.keys(<MobxPromise object>)`, i.e. the promise's property count, not the number of detailed cancer types (`PlotsTab.tsx:592`). Seen `[B]`: it is 10 for lgg_ucsf_2014 (5 real types) and for the 2-study query (2 real types). So QP-1, QP-3, QP-6 pass the count test and QP-2, QP-4 never show.

---

## 8. Plot renderers

### PLT-SC Scatter (`ScatterPlot.tsx`)
- **PLT-SC-1** One point per (sample × horizontal value × vertical value); points with NaN on either axis dropped. Axes: 8 ticks, numeral formatting (e.g. "2k"); log axes show ticks in log space.
- **PLT-SC-2** Right gutter text: "Spearman: r.rr" then "(p = …)", "Pearson: r.rr" then "(p = …)" (PLT-STM-4…6). Seen `[B]`: "Spearman: -0.08 (p = 0.0496)", "Pearson: -0.06 (p = 0.160)".
- **PLT-SC-3** Regression line (UT-7): red `#c43a31`, width 2, spans the plotted x-domain; gutter shows a red swatch + "y = <m>x + <b>" and "R² = <r2>" (PLT-STM-7). Seen `[B]`: "y = -0.1x + 11.91", "R² = 0".
- **PLT-SC-4** Point size 4; hovered 6; highlighted 8.
- **PLT-SC-5** Drag-select (rectangle) selects points → PLT-HL-5. Only the scatter supports selection.
- **PLT-SC-6** Legend: right if ≤7 entries, else bottom (labels flattened to one line). Title = coloring gene symbol or clinical attribute name (wrapped at 100 px). Order: mutation entries (PLT-CL-8 legend order `fusion, promoter.driver, promoter, splice.driver, splice, trunc.driver, trunc, inframe.driver, inframe, missense.driver, missense, other.driver, other`), "Not mutated", "Not profiled for mutations", CNA values descending (Amplification…Deep Deletion), "Structural Variant ¹", CNA/SV not-profiled, limit-value entry; only categories present in the plotted points. Seen `[B]` coadread KRAS: Truncating (VUS), Inframe (Driver), Missense (Driver), Missense (VUS), Not mutated, Not profiled for mutations, Amplification, Gain, Diploid, Shallow Deletion, Deep Deletion.

### PLT-BX Box + points (`BoxScatterPlot.tsx`, `boxPlotUtils.ts`)
- **PLT-BX-1** One box per category, in category order (PLT-DT table) or alphabetical; filtered by PLT-AX-9; re-sorted by PLT-AX-10.
- **PLT-BX-2** Box: q1–q3 fill `#eeeeee`, median line `#999999` width 1, whiskers `#999999`. Box width = clamp(W/(n + (n−1)/2), 18, 80) with W = 600 for vertical, 400 for horizontal boxes. Points jittered across the category axis (±0.2 × box width).
- **PLT-BX-3** Categories with a single point (or none after limit-value exclusion) draw **no box**, only the point (quartile undefined → box dropped). `[B]` (Inframe, Truncating n=1).
- **PLT-BX-4** Box statistics: PLT-STM-8. Values are log-transformed **before** computing the box when log is on.
- **PLT-BX-5** No box-hover statistics tooltip in Plots (the component supports one, but PlotsTab passes no `boxPlotTooltip`); only point tooltips `[C]`.
- **PLT-BX-6** Category tick labels = category names (no counts). Legend right unless chart width > 550 px or > 7 entries → bottom.
- **PLT-BX-7** Connect samples (UT-3): lines join points of the same patient; clicking a line hides it until the checkbox is toggled `[C]`. Seen `[B]`: checkbox present for lgg_ucsf_2014 Mutation × Mutation Count.
- **PLT-BX-8** No p-value or test is displayed in the Plots tab box plot (the `pValue/qValue` props are used only by other pages).

### PLT-WF Waterfall (`WaterfallPlot.tsx`)
- **PLT-WF-1** One bar per sample value, ordered by value (PLT-STM-20). Bars start at the profile `pivotThreshold` (0 if absent) and extend to the value.
- **PLT-WF-2** Bar color = mutation fill, CNA/SV stroke color, clinical color, or default blue, per the single radio selection (PLT-CL-4).
- **PLT-WF-3** Limit values: a diamond above (value ≥ pivot) or below the bar end, offset 2% of the value range (PLT-LV-3).
- **PLT-WF-4** Search matches: red "+" marker offset 2% beyond the pivot side; legend entry "Sample match" (only while something matches).
- **PLT-WF-5** Legend symbols are squares. Legend bottom when chart width > 550 px or > 7 entries.
- **PLT-WF-6** No correlation, regression or box statistics.
- **PLT-WF-7** Seen `[B]`: CCLE IC50 vs Ordered samples, 425 bars → chart 1160 × 500 (480 + round(425 × 1.6)); default sort ASC; coloring radios Mutation Type * / Structural Variant¹ / Copy Number / None with Mutation Type selected.

### PLT-BR Multiple-category bar (`MultipleCategoryBarPlot.tsx`)
- **PLT-BR-1** Major categories = horizontal-axis values (vertical-axis values if Horizontal Bars); minor categories (colors / stack segments) = the other axis.
- **PLT-BR-2** Count-axis title has two lines: the other axis's label, then "# samples" ("# samples (%)" for 100%). Seen `[B]` "KRAS: Mutations" / "# samples"; "Cancer Type Detailed" / "# samples (%)".
- **PLT-BR-3** Modes: Bar = grouped side-by-side bars (bar width 20; halved when >10 minor categories); Stacked; 100% stacked (y = percentage).
- **PLT-BR-4** Colors: reserved clinical colors matched case-insensitively (incl. Missense/Inframe/Truncating/Splice/Promoter/Fusion, Driver, VUS), else D3-31 palette in order.
- **PLT-BR-5** Legend: one square per minor category, sorted by category order; right unless chart width > 550 px or > 15 entries.
- **PLT-BR-6** Tooltip: "<major>" / **"<minor>: N sample(s) (P%)"**.
- **PLT-BR-7** Major-category order: category order/alphabetical; or by Sort By (PLT-STM-12). Minor order reversed for vertical stacked and for horizontal grouped bars.
- **PLT-BR-8** More than 150 categories on either axis (bar modes only) → message instead of plot (PLT-MS-4).

### PLT-TB Table (`TablePlot.tsx`)
- **PLT-TB-1** Contingency table: columns = horizontal categories, rows = vertical categories; each cell shows the count of (sample × value-pair) entries (PLT-STM-13), including 0 cells.
- **PLT-TB-2** Cell fill linear white `rgb(255,255,255)` → `rgb(0,102,204)` over [min, max] count; text white if count > (min+max)/2 else black.
- **PLT-TB-3** Category order: data category order (categories absent from it are dropped — legacy bug for unexpected values) or natural sort; vertical order reversed so the first is at the top.
- **PLT-TB-4** No row/column totals, no percentages, no statistical test.

---

## 9. Tooltips `[C]`

- **PLT-TT-1 Scatter / box point** (seen `[B]`: "TCGA-A6-5665-01 / Horizontal: 10.27 / Vertical: 11.75 / KRAS: Diploid" on log2 axes): sample id (link to patient view sample page, new tab); study name link if >1 study; "Horizontal: **x**"; "Vertical: **y**" (numbers via `toFixedWithoutTrailingZeros(·, 2)`, prefixed with `>`/`<` for limit values; on log axes the **log-transformed** value is shown; box category shown as text); then mutation section "GENE: p.X, p.Y" with hotspot and OncoKB icons (or "Not profiled for mutations."); CNA section "GENE: Amplification" + OncoKB icon (0 values listed as "Diploid", ±1 as Gain/Shallow Deletion) (or "Not profiled for copy number alterations."); SV section "Structural Variant: **class**, **class**" (or "Not profiled for structural variants."); clinical coloring "<Attr>: **value**" (numbers `toFixed(2)`; missing "No data").
- **PLT-TT-2 Waterfall bar**: sample id (+ study), "Value: **[>|<]v**" with `toFixed(4)` of the **plotted** (possibly log-transformed) value, then the same sections.
- **PLT-TT-3 Bar**: PLT-BR-6. **Table**: none.
- **PLT-TT-4** The mutation/CNA/SV sections reflect only the "Color samples by" gene (data fetched for that gene only).

---

## 10. Download

- **PLT-DL-1** Download controls top-right of the chart (shown once an SVG exists; `type="button"` dropdown): SVG · PNG · PDF, file `plot.svg/png/pdf`, plus "Data ☁" (disabled until genes load). Rendered only when server `skin_hide_download_controls` = show; any other value hides the whole control `[C]`.
- **PLT-DL-2** "Data" → `plot.txt`, tab-separated, numbers formatted `0[.][000000]` (≤6 decimals) `[C]`:

| Plot | Header |
|---|---|
| Scatter | `Sample Id`, `<horz label>`, `<vert label>` [, `Mutations`][, `Copy Number Alterations`][, `<clinical attr>`] |
| Box | `Sample Id`, `<category axis label>`, `<value axis label>` [, …same optional] |
| Waterfall | `Sample Id`, `<axis label>`, `pivot threshold`, `sort order` [, …] — rows in displayed order |
| Discrete | `Sample Id`, `<horz label>`, `<vert label>` — one row per value pair; missing `n/a` |

- Optional columns are added when the Mutation Type / Copy Number boxes are **checked** (even if coloring is None) and when coloring by clinical. Mutations cell: "GENE: p.A, p.B" (genes `; `-joined), "Not Profiled" or "-". CNA cell: "GENE: Amplification", "Not Profiled" or "-". Clinical: value or "-".
- Legacy gaps: no SV column; VAF/limit-value prefixes are not exported; log-scaled values are exported raw.

---

## 11. Highlighting, selection, messages, limit values

- **PLT-HL-1** A point is highlighted if it matches Search Case, Search Mutation, is drag-selected, or matches any clicked legend item. Highlighted points draw on top and larger.
- **PLT-HL-2** Legend items with a highlight function are clickable (pointer cursor); clicked items turn **bold**; several can be active (OR). The numeric clinical gradient, its "No data" item and the waterfall "Sample match" item are not clickable. Cleared when the coloring choice or coloring checkboxes change. *(local)*
- **PLT-HL-3** Highlight predicates: mutation entry = same dispMutationType; "Not mutated" = profiled & none; "Not profiled…" = not profiled; CNA entry = same dispCna value; SV = has SV; clinical category = equal value; "No data" = missing; limit-value entry = limited point.
- **PLT-HL-4** Study View / Patient View highlight `highlightedSamples` separately (not in Results View).
- **PLT-HL-5** Scatter selection bar above the plot: "Selected: **N samples**" (link, tooltip "Explore samples in study view" → opens Study View filtered to those sample ids) + [Clear Selection]. N counts **points**, not unique samples (legacy quirk with multi-value axes) `[C]`.

**Messages**
- **PLT-MS-1** No data type on an axis → grey box "← Please select datatype(s)." `[C]`
- **PLT-MS-2** Gene axis with no gene → "← Please select gene(s)." `[C]`
- **PLT-MS-3** GA type selected but no entities → red ⚠ "To visualize selected generic assay data, you must ensure you have already imported related data and select an entity." `[C]`
- **PLT-MS-4** >150 categories (bar modes) → "There are too many unique categories in the data selected for the horizontal or vertical axis. The current threshold is set at150 categories…" (sic, missing space) `[C]`
- **PLT-MS-5** Data-availability alert: "Showing N samples with data in both profiles (axes)" (+ ". Samples without mutations or Variant Allele Frequency[ or Cancer Cell Fraction] data are excluded from the plot" for VAF/CCF axes). ⓘ tooltip: "Data availability per profile/axis:", "**Horizontal Axis:** n samples from k study/studies", "**Vertical Axis:** …", "**Intersection of the two axes:** N samples from k studies". Seen `[B]` 590 (default), 592 (mRNA×mRNA), 425 (CCLE AUC); 2-study tooltip: "Horizontal Axis: 1662 samples from 2 studies / Vertical Axis: 1674 samples from 2 studies / Intersection of the two axes: 1658 samples from 2 studies".
- **PLT-MS-6** Empty after loading → "No data to plot." Error → "Error loading plot data."
- **PLT-MS-7** Footnotes: PLT-CL-7; plus with limit values on a scatter "** Labeling of threshold values (e.g. >8.00) excludes threshold values from correlation coefficient calculation." / on a box plot "…excludes threshold values from box plot calculation."

**Limit values (generic assay LIMIT-VALUE, e.g. ">8")**
- **PLT-LV-1** Parsed from values matching `^([><]? *)(-?\d+(\.\d+)?)$`; the symbol is `thresholdType`, the number is plotted at its threshold. Types listed as `">8.00"` (`toFixed(2)`), unique.
- **PLT-LV-2** With PLT-AX-5 checked: limited points drawn as **diamonds**; legend entry "value >8.00" (diamond, grey `#999`; waterfall: hollow, black stroke); excluded from correlation (scatter) and from box statistics (box). Regression line: see legacy bug PLT-STM-7.
- **PLT-LV-3** Waterfall: diamond label at the bar end; unchecking hides labels.
- **PLT-LV-4** Unchecked: limited points look and count like ordinary points.

---

## 12. Shared-component notes for other pages `[C]`

- `ScatterPlot` props used elsewhere: `correlation={pearson,spearman}` overrides the computed values (Co-expression); without `onDataSelection` no drag-select.
- `BoxScatterPlot` props not used by Plots: `boxPlotTooltip(stats,labels)` (box hover stats), `boxCalculationFilter`, `startDataAxisAtZero`, `compressXAxis` (labels truncated to 50 px-chars), `pValue`/`qValue` display, `highlightedSamples`, `customSamplePointComponent`. Users: Expression, Enrichments box plots, Group Comparison clinical numerical, Co-expression (scatter).
- `MultipleCategoryBarPlot` (Group Comparison clinical categorical) supports a custom `tooltip`.
- `toDataDescriptive` (count, min, max, mean, population SD (÷n), median, MAD) is for the Comparison summary table, not shown in Plots.

---

## 13. Modes and conditions (each must be checked)

| ID | Condition | Expected behavior |
|---|---|---|
| PLT-MD-1 | Sample vs patient | Plots is **always sample-level**; there is no patient toggle. Patient attributes are copied to each sample (PLT-DT-2); a patient with k samples contributes k points |
| PLT-MD-2 | Multi-study | Seen `[B]` extra GA type "Phosphosite Quantification" and pill "mRNA vs Study". Sources merged by profile suffix; "Study of origin" attribute + mRNA vs Study pill; tooltips add study name; data-availability ⓘ counts studies; possible cross-study expression block (PLT-CH-4) |
| PLT-MD-3 | Multi-sample patients | "# Samples per Patient" attribute; Connect samples checkbox in box plots |
| PLT-MD-4 | Drivers annotated / not | Mutation legend "(Driver)/(VUS)" split vs plain class names; Driver vs VUS axis uses `putativeDriver` |
| PLT-MD-5 | Show only drivers / somatic / profiled (RV-2) | Only "profiled" filtering applies (via filtered samples); drivers/somatic filters do not apply (PLT-DT-17) |
| PLT-MD-6 | Gene panels | Gene options "(Not profiled)"; "Not profiled" categories and legend entries per sample/gene |
| PLT-MD-7 | No mutation / CNA / SV profile | The matching coloring checkbox and legend part disappear; Search Mutation hidden without mutation profile |
| PLT-MD-8 | Generic assay LIMIT-VALUE | Ordered samples option on the other axis; log10; limit-value checkbox, diamonds, footnote |
| PLT-MD-9 | Waterfall | Coloring radios incl. None; Sort Order button; no Regression/Connect |
| PLT-MD-10 | Discrete vs discrete | No coloring toolbar, no search, Plot Type / Sort By / Horizontal Bars |
| PLT-MD-11 | Negative values | Log Scale disabled except rna_seq mRNA profiles |
| PLT-MD-12 | Multi-value axes (VAF, CCF, multiple GA/clinical values) | One point per value combination; same sample repeated |
| PLT-MD-13 | No queried genes (Study/Patient View reuse) | Async gene search ("Search for gene"), no default data types unless `highlightedSamples`, coloring defaults to the axis gene or None, banners hidden |
| PLT-MD-14 | Logged in | "Custom Data" data type from the user's custom charts |

---

## 14. Persistence

**URL** (JSON objects, `PlotsTabUrlParameters.tsx`):
- `plots_horz_selection` / `plots_vert_selection`: `{ dataType, selectedDataSourceOption, selectedGeneOption, selectedGenesetOption, selectedGenericAssayOption, mutationCountBy, structuralVariantCountBy, logScale }`
- `plots_coloring_selection`: `{ selectedOption, logScale, colorByMutationType, colorByCopyNumber, colorBySv }` (booleans as "true"/"false"; colorBy* default true when absent)

**localStorage:** `plotsHorzGeneSelection`, `plotsVertGeneSelection` (entrez id; fallback when URL has none).

**Session history (*(local)*):** last gene / gene set / source / GA entity per data type per axis, restored when the type is re-selected.

**Not persisted:** search boxes, Show Regression Line, Connect samples, Plot Type, Sort By, Horizontal Bars, Sort by Median, Filter categories, limit-value checkbox, waterfall sort order, legend highlights, drag selection.

---

## 15. Statistics & methods

Paths relative to `src/shared/components/plots/` unless noted.

**PLT-STM-1 Sample universe**
- Samples = Results View *filtered samples* (all queried samples, minus unprofiled ones when Show-only-profiled is on). Every axis is restricted to them (`PlotsTabStore.ts:1042-1059`, mutation/SV axes iterate `filteredSamples`).
- A point needs data on **both** axes (inner join on `uniqueSampleKey`), except waterfall (one axis). Multi-valued records expand to the Cartesian product of values; any pair with a NaN number is dropped (`PlotsTabUtils.tsx:3083-3112`).
- Sample level only. Patient attributes → each sample of the patient.

**PLT-STM-2 Alteration data used for categories and coloring**
- Mutations: the gene's mutations in the study mutation profile, annotated (driver = OncoKB oncogenic/likely/resistance, hotspot, custom binary or tier, per enabled RV-2 sources; definition as 01-oncoprint.md ST-M11). Not filtered by drivers-only/somatic-only. Germline VUS dropped (legacy bug).
- CNA coloring: discrete CNA profile values for the gene, **all values including 0 and ±1** (not OQL/default-OQL filtered).
- SVs: all SVs involving the gene in the SV profile for queried samples.

**PLT-STM-3 Data-availability counts** (`PlotsTab.tsx:661-929`, `PlotsTabUtils.tsx:3783-3800`)
- Axis count = number of axis **records** (samples with data for that axis; VAF/CCF: samples with ≥1 usable mutation).
- Main number = |horizontal records ∩ vertical records| by sample key; if one axis is empty (Ordered samples) → the other axis's count.
- Study counts: studies having the attribute/profile; intersection = common studies (or the other axis's studies for Ordered samples).

**PLT-STM-4 Pearson correlation** (`ScatterPlot.tsx:521-536`)
- `jStat.corrcoeff(x, y)` (sample Pearson r) over all plotted scatter points (one per value pair), **in plotted space**: values are log-transformed first when an axis is on log scale.
- Excludes limit-value points (x or y thresholded) when limit-value labelling is on (PLT-LV-2).
- Rounded to 5 decimals internally; shown `toFixed(2)`.
- Verified `[B]`: KRAS vs TP53 RSEM, n=592: Pearson on log2(x+1) values = −0.058 → "−0.06"; raw-value Pearson = −0.071 shown "−0.07" when log off.

**PLT-STM-5 Spearman correlation** (`ScatterPlot.tsx:537-548`)
- `jStat.spearmancoeff(x, y)` = Pearson r of `jStat.rank` ranks; ties get the average rank (1-based). Raw values (rank-invariant to log). Same point set as STM-4. Shown `toFixed(2)`. Verified `[B]` −0.0807 → "−0.08".

**PLT-STM-6 Correlation p-values** (`PlotUtils.ts:462-482`)
- t = |r| · √((n−2)/(1−r²)); two-sided Student-t p with n−2 df (`jStat.ttest(t, n−1, 2)`). Applied to both Pearson and Spearman r (the rounded-to-5-decimals r). n = number of points used.
- |r| = 1 → p = 0. n ≤ 2 → p not shown.
- Display `toConditionalPrecision(p, 3, 0.01)`: p in [1e-6, 0.01) → exponential with 3 decimals (e.g. "1.234e-5"); otherwise 3 significant digits (`toPrecision(3)`, e.g. "0.160", "0.0496"); p < 1e-6 → `toPrecision(3)` too.
- No multiple-testing correction.

**PLT-STM-7 Regression line** (`ScatterPlot.tsx:693-745`, `ScatterPlotUtils.ts:3`, npm `regression@2.0.1` `linear`)
- Ordinary least squares y on x, in plotted (log-transformed) coordinates.
- slope m = round2((nΣxy − ΣxΣy)/(nΣx² − (Σx)²)) (0 if the denominator is 0); intercept b = round2(ȳ − m·x̄) using the **rounded** slope.
- R² = round2(1 − SS_res/SS_tot) with predictions from the rounded coefficients (and rounded to 2 decimals).
- Label "y = {m}x + {b}" (or "y = {m}x" when b = 0); numbers are JS-printed after rounding (e.g. "−0.1", "R² = 0"); negative intercepts print as "+ -1.2" (legacy quirk).
- Drawn only if ≥2 non-limited points. **Legacy bug:** the fit uses **all** points including limit values even when they are excluded from correlation (the filtered list only gates the ≥2 check).

**PLT-STM-8 Box statistics** (`src/shared/lib/boxPlotUtils.ts:64-121`, `BoxScatterPlot.tsx:1284-1336`)
- Input per category: point values (log-transformed if log on), excluding limit values when labelling is on.
- Median: standard (mean of the two middle values for even n).
- q1 = sorted[round(n/4) − 1], q3 = sorted[round(3n/4) − 1] (**nearest-rank, no interpolation**; `jStat.quartiles`, JS `Math.round` half-up). n = 1 → undefined → no box.
- IQR = q3 − q1. Fences: q1 − 1.5·IQR, q3 + 1.5·IQR.
- Upper whisker = **the fence value q3 + 1.5·IQR** if any value ≥ that fence, else the max; lower symmetric with ≤ (legacy quirk: not the most extreme in-fence data point as in Tukey).
- Outliers are not drawn specially (all points are drawn anyway).

**PLT-STM-9 Sort by median**: `jStat.median` of the category's raw (untransformed, limit values included) values, ascending (`PlotsTabUtils.tsx:2833`, `PlotsTab.tsx:5413-5420`).

**PLT-STM-10 Jitter** (`PlotUtils.ts:116-145`, `BoxScatterPlot.tsx:574-616`)
- Deterministic per sample: seed = Java-style 32-bit string hash of `uniqueSampleKey`; r = frac(sin(seed)·10000) mapped to [−1, 1]; offset = 0.2 × boxWidth × r on the category axis only. Scatter and waterfall have no jitter.

**PLT-STM-11 Log transforms** (`PlotsTabUtils.tsx:3725-3770`)
- Non-GA axes: f(x) = log2(max(x, 0) + 1); inverse 2^y − 1.
- GA axes: f(x) = log10(x + offset), 0 when x + offset = 0; offset 0 except waterfall.
- Applied before correlation(Pearson)/regression/box statistics/domain; Spearman unaffected.
- Ticks drawn in transformed space with the original-scale label value.

**PLT-STM-12 Bar counts and percentages** (`MultipleCategoryBarPlotUtils.ts:10-87`)
- For each sample present on both axes, for each (minor value × major value) pair: count += 1.
- Percentage (100% stacked, tooltips) = count / (sum of counts in that **major** category) × 100, rounded to 2 decimals.
- Missing combinations get 0.
- Sort By: "Alphabetically" = category order / alphabetical; "Number of samples" = major categories by total count desc; a minor category name = major categories by that minor's count desc (by percentage in 100% mode), and that minor's bars moved first.
- Legacy bug: Sort-By options are built only on mount, so after changing axes they can list stale minor categories `[C]`.

**PLT-STM-13 Table counts** (`TablePlotUtils.ts:24-49`, `TablePlot.tsx:141-211`): count of (sample × horizontal value × vertical value) triples per cell; samples lacking either axis skipped.

**PLT-STM-14 Mutation coloring: top alteration per sample** (`PlotsTabUtils.tsx:2975-2996`)
- Take the coloring gene's mutations in the sample. Key each as `<class>` + `.driver` if putative driver (not for promoter/other). Class from `getOncoprintMutationType`: proteinChange "promoter" → promoter; missense, inframe, splice, other as simplified; **everything else (frameshift, nonsense, nonstart, nonstop, fusion) → trunc**.
- Pick the key with the best `mutationRenderPriority` (fusion > promoter.driver > splice.driver > trunc.driver > inframe.driver > missense.driver > other.driver > promoter > splice > trunc > inframe > missense > other); ties impossible (distinct keys).
- Waterfall: same, restricted to the coloring gene.

**PLT-STM-15 CNA coloring: displayed value** (`PlotsTabUtils.tsx:2963-2974`, `3186-3198`)
- Scatter/box: the record with the largest |value| (first wins on ties). Waterfall: the record with the largest **signed** value (`maxBy`), so a gain beats a deep deletion (legacy inconsistency).
- Profiled = sample coverage includes the CNA profile for the gene (or whole-profile coverage).

**PLT-STM-16 SV coloring**: any SV for the gene → SV appearance, overriding CNA; tooltip lists `variantClass` values comma-joined.

**PLT-STM-17 Profiled flags for coloring**: per sample, a profile id is "profiled" if the sample's coverage lists it for the coloring gene (or for either axis gene when no coloring gene) or for all genes; mutation/CNA/SV profiled = any of the study profiles of that kind is profiled.

**PLT-STM-18 Clinical color scale** (`src/shared/cache/ClinicalDataCacheUtils.ts:9-67`)
- NUMBER: min/max over all parseable values of the attribute **in the query cohort** (not only plotted points); linear Reds; log variant uses natural log of max(0.01, x), only when min ≥ 0. min = max → NaN → undefined color (edge case).
- STRING: reserved colors, then palette in first-seen order. Legend lists only categories present on plotted points, plus "No data" only if a plotted point lacks a value.
- Numeric legend: vertical Reds gradient bar (30 stops) labelled max (top) and min (bottom), plus the midpoint when max − min > 5, each `toFixedWithoutTrailingZeros(·,2)`; then "No data". Seen `[B]` Diagnosis Age: 90 / 60.5 / 31.

**PLT-STM-19 Limit-value handling**: PLT-LV-1/2. Exclusion from Pearson/Spearman (and their n for p-values) and from box statistics only when the checkbox is on.

**PLT-STM-20 Waterfall ordering and baseline** (`WaterfallPlot.tsx:503-541`)
- Sort ascending by raw value; reverse when (vertical bars and DESC) or (horizontal bars and ASC). Default direction = profile `sortOrder` (mRNA: none → ascending).
- Baseline = `pivotThreshold` (0 if absent).
- Log (GA): offset = |min(values ∪ {pivot})| + 0.0001 if that min < 0, else 0; bars and baseline are log10(value + offset).

**PLT-STM-21 VAF / CCF / clonality**
- VAF per mutation = tumorAltCount / (tumorAltCount + tumorRefCount); both must be integers; NaN dropped. Legacy bug: `_.compact` drops VAF = 0 (`PlotsTabUtils.tsx:1231-1234`).
- If no mutation of the gene has finite alt/ref counts → empty axis.
- CCF = ASCN `ccfExpectedCopies`; clonality = ASCN `clonal` ∈ {CLONAL, SUBCLONAL, INDETERMINATE}, other → NA.

**PLT-STM-22 Number formatting**
- Tooltips: scatter/box `toFixedWithoutTrailingZeros(v, 2)`; waterfall `toFixed(4)`; clinical coloring numbers `toFixed(2)`.
- Downloads: numeral `0[.][000000]`.
- Correlations `toFixed(2)`; regression 2 decimals; limit types `toFixed(2)`; bar percentages 2 decimals.
