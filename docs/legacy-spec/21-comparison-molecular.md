# Legacy parity spec — Group Comparison › molecular tabs (enrichments)

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`; backend `cBioPortal/cbioportal@03c0280`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.
Hover tooltips mostly did not render headless; tooltip text is `[C]` unless marked.

**Owner of:** the shared enrichment tables, volcano plot, frequency scatter, gene/entity bar plot and clicked-row box plot
(used by Group Comparison and Results View › Comparison). Box/whisker geometry itself → `04-plots.md`;
group selection, overlap strategy, OverlapExclusionIndicator, Survival, Clinical → `20-comparison-core.md`;
lollipop / mutation table base → `05-mutations.md`.

Reference queries (comparison sessions created by POSTing `/api/session/comparison_session` with
`brca_tcga_pan_can_atlas_2018` patient-level `SUBTYPE` groups; IDs are durable on the public session service):
- 2 groups (LumA 499, Basal 171 samples): `/comparison/alterations?comparisonId=6af36e2f795bfa2419d8e51d`
- 5 groups (Basal, Her2, LumA, LumB, Normal): `/comparison/alterations?comparisonId=6af36e2fb1971a03c3aa3bca`
- Swap the path tab for `mutations`, `mrna`, `protein`, `dna_methylation`, `generic_assay_<type>` (e.g. `generic_assay_methylation`, `generic_assay_armlevel_cna`).
- Results View: `/results/comparison?cancer_study_list=brca_tcga_pan_can_atlas_2018&case_set_id=brca_tcga_pan_can_atlas_2018_all&profileFilter=mutations,gistic&gene_list=TP53 PIK3CA&comparison_subtab=alterations`
- Panel edge case (API): `msk_impact_2017` groups of IMPACT341 vs IMPACT410 samples.

Key files (frontend): `src/shared/lib/comparison/ComparisonStore.ts` (profiles, requests, tab visibility),
`ComparisonStoreUtils.ts` (event types), `AlterationEnrichmentTypeSelector.tsx`,
`src/pages/resultsView/enrichments/*` (EnrichmentsUtil, *Container, *Table, MiniScatterChart, MiniFrequencyScatterChart,
GeneBarPlot, GenericAssayBarPlot, ExpressionEnrichmentsBoxPlot, EnrichmentsDataSetDropdown, AddCheckedGenes),
`src/pages/groupComparison/{AlterationEnrichments,MRNAEnrichments,ProteinEnrichments,MethylationEnrichments,GenericAssayEnrichmentCollections,GroupComparisonMutationsTab,GroupComparisonMutationMapper*,GroupComparisonUtils}.tsx`,
`src/pages/resultsView/ResultsViewPageStoreUtils.ts:629-800` (q-values), `src/shared/lib/calculation/BenjaminiHochbergFDRCalculator.ts`,
`src/pages/resultsView/comparison/ComparisonTab.tsx`.
Key files (backend): `domain/alteration/usecase/GetAlterationEnrichmentsUseCase.java`, `domain/alteration/util/AlterationEnrichmentScoreUtil.java`,
`resources/mappers/clickhouse/alteration/ClickhouseAlteration{,Filter}Mapper.xml`, `legacy/service/util/ExpressionEnrichmentUtil.java`,
`legacy/service/impl/ExpressionEnrichmentServiceImpl.java`, `legacy/service/util/FisherExactTestCalculator.java`, `legacy/web/ExpressionEnrichmentController.java`.

---

## 0. Tabs, visibility and gating

**CMM-TAB-1 Tab order** (Group Comparison): Overlap · Survival · Clinical · **Genomic Alterations** · **Mutations Beta!** · [Pathways] · **mRNA** · **Protein** · **DNA Methylation** · one tab per generic-assay type (sorted by display text) · custom tabs.
- Seen on brca 2-group: … Genomic Alterations · Mutations Beta! · mRNA · Protein · Arm-level CNA · Genetic Ancestry · Methylation · Phosphosite Quantification (DNA Methylation tab hidden — brca methylation is a GA profile) `[B]`.
- URL path: `/comparison/<tabId>`; ids `alterations`, `mutations`, `pathways`, `mrna`, `protein`, `dna_methylation`, `generic_assay_<genericAssayType lower-case>`.

**CMM-TAB-2 Profile selection per tab** (`EnrichmentsUtil.tsx:668-790`, `ComparisonStore.ts:537-1110`)

| Tab | Profiles eligible | Default per study |
|---|---|---|
| Genomic Alterations | mutations: `MUTATION_EXTENDED`; CNA: `COPY_NUMBER_ALTERATION` + datatype `DISCRETE`; SV: `STRUCTURAL_VARIANT` or `FUSION` (datatype FUSION/SV) | first of each kind; no profile dropdown |
| Mutations | `MUTATION_EXTENDED` | all mutation profiles (fetch), first for enrichment |
| mRNA | `MRNA_EXPRESSION`, excluding ids containing `zscores` unless `merged_median_zscores`; RNA-seq profiles sorted first | first |
| Protein | `PROTEIN_LEVEL`, same z-score exclusion | first (seen: "Protein levels (mass spectrometry by CPTAC)") |
| DNA Methylation | `METHYLATION` | first |
| Generic assay `<type>` | `GENERIC_ASSAY` with datatype `LIMIT-VALUE`, or `BINARY`/`CATEGORICAL` with `patientLevel=false` | first in the "all" list |

**CMM-TAB-3 Tab shown / hidden** (`ComparisonStore.ts:2123-2350`; page uses `anchorClassName='hidden'`)

| Tab | Hidden when | In-tab message instead of content |
|---|---|---|
| Genomic Alterations | no mutation and no CNA profile in active studies, or < 2 active groups | — |
| Mutations | no mutation profile (never hidden for group count) | < 2 groups: "We need 2 groups to show mutations. Please select more groups from the Groups section above." · > 2: "We can't show mutations for more than 2 groups. Please deselect groups in the Groups section." · no gene: "There are no mutations available." |
| mRNA / Protein / DNA Methylation | no eligible profile, < 2 active groups, **or > 1 active study** | — |
| Generic assay | all three GA kinds unavailable (no profile / < 2 groups / > 1 study) | — |

- **CMM-TAB-4** A tab that was shown once stays shown when the user deselects all groups (`tabHasBeenShown`, `ComparisonStore.ts:150-205`) `[C]`.
- **CMM-TAB-5** Shared tab wrapper messages (`GroupComparisonUtils.tsx:540-560`) `[C]`:
  - fewer than 2 selected: "Please select more groups - we need at least 2 selected groups to show enrichments."
  - ≥2 selected but <2 non-empty after overlap exclusion: "Due to excluded overlapping cases, there are less than 2 selected nonempty groups - we need exactly 2 nonempty selected groups to show enrichments."
  - multi-study on mRNA/protein/methylation/GA: "The selected comparison groups span more than one study, so we can't show <type> enrichments. Please change your selection in the Groups section so that all samples only come from one study."
  - Above the content: OverlapExclusionIndicator (see 20-comparison-core), patient wording when patient-level enrichments are on.
- **CMM-TAB-6** Empty result → `alert-info` "No data/result available".
- **CMM-TAB-7** Pathways tab only with feature flag `group_comparison_pathways`; renders PathwayMapper over the Genomic Alterations rows, "Select genes" popup `[C]`.
- **CMM-TAB-8** Groups used by every tab = active groups after the overlap strategy (default Exclude); group label = `nameWithOrdinal`, e.g. "(A) BRCA_Basal". Group 1 / group 2 = the first two in group order (seen: alphabetical, (A) Basal before (B) LumA). Group colors come from the group.

---

## 1. Genomic Alterations tab

### CMM-AT — Alteration type selector
Shown inline at left when server `skin_show_settings_menu` is false (public portal); otherwise these move into the ⚙ AlterationFilterMenuSection (see 01-oncoprint RV-2) `[B: inline]`.

**CMM-AT-1 Checkbox tree** (heading "Alteration Types"; each parent ☑ when any child ☑; clicking a parent toggles all its children):

| Level | Item | Member mutation_type values (lower-case) |
|---|---|---|
| 0 | **Mutations** (if mutation profile) | all below |
| 1 | Missense | missense, missense_mutation, missense_variant |
| 1 | Inframe | indel, nonframeshift, inframe + the two below |
| 2 | Inframe Insertion | inframe_ins, inframe_insertion, in_frame_ins, in_frame_insertion, nonframeshift_insertion |
| 2 | Inframe Deletion | inframe_del, inframe_deletion, in_frame_del, in_frame_deletion, nonframeshift_deletion |
| 1 | Truncating | truncating, feature_truncation + Nonsense, Frameshift, Nonstart, Nonstop, Splice groups |
| 2 | Nonsense | nonsense_mutation, nonsense, stopgain_snv, stop_gained |
| 2 | Frameshift | frameshift, frameshift_variant + two below |
| 3 | Frameshift Insertion | frame_shift_ins, frameshift_insertion |
| 3 | Frameshift Deletion | frame_shift_del, frameshift_deletion |
| 2 | Nonstart | translation_start_site, initiator_codon_variant, start_codon_snp, start_codon_del, de_novo_start_outofframe |
| 2 | Nonstop | nonstop_mutation, stop_lost |
| 2 | Splice | splice_site, splice, splicing, splice_site_snp, splice_site_del, splice_site_indel, splice_region_variant, splice_region |
| 1 | Other | silent, synonymous_variant, targeted_region, other |
| 0 | **Structural Variants / Fusions** (if SV profile) | variant_type structural_variant |
| 0 | **Copy Number Alterations** (if discrete CNA profile) | — |
| 1 | Amplification | AMP (2) |
| 1 | Deletion | HOMDEL (−2) |

- **CMM-AT-2** Default: everything ☑ for the kinds that have a profile `[default]`.
- **CMM-AT-3** [Select] button applies; disabled until the staged selection differs from the applied one.
- **CMM-AT-4** URL `selectedEnrichmentEventTypes` = JSON array of checked leaf values in mutationGroup order, then CNA, then `structural_variant` (seen after unchecking CNA: 48 mutation values + `structural_variant`, rows 22 871 → 15 404) `[B]`; absent = default. Session prop (moves into the session when the URL gets long). RV: `comparison_selectedEnrichmentEventTypes` `[C]`.
- **CMM-AT-5** Sending rules (`ComparisonStore.ts:1279-1345`; backend `AlterationFilter.java:85-126`) `[C]`:
  - Mutation map sent for every mutationGroup key (true/false). All true → backend applies **no** mutation-type filter (types not in the list, e.g. `5'Flank`, `Intron`, `Fusion`, are then counted).
  - Some unchecked and **Other** checked → SQL `NOT IN (unchecked)` (unknown types counted); Other unchecked → `IN (checked)`.
  - No mutation types checked → mutation profile not included in the request at all.
  - No CNA types → CNA profile omitted; SV unchecked → `structuralVariants:false` excludes `variant_type='structural_variant'`.
  - Nothing at all selected → no request; empty table.
- **CMM-AT-6** Driver/germline filters come from the **comparison store's own** annotation settings (server defaults; RV comparison does not inherit the RV ⚙ state): includeDriver ☑, includeVUS = ¬`oncoprint_hide_vus_default`, includeUnknownOncogenicity ☑, tiers, germline/somatic/unknown status all ☑ `[C]`. Driver status here is the DB `driver_filter` column (custom driver annotation), not OncoKB.

### CMM-AL — Layout (top: charts panel; bottom: table)
- **CMM-AL-1 Charts, 2 groups:** volcano (CMM-VO) · frequency scatter (CMM-FS) · gene bar plot (CMM-BP).
- **CMM-AL-2 Charts, >2 groups:** bar plot only `[B]`.
- **CMM-AL-3 Header** "Genomic Alterations"; RV only: [Add checked genes to query (…)] (CMM-RV-3).
- **CMM-AL-4 Controls row** (left → right):
  1. Level select `[default]` "Sample-level enrichments" / "Patient-level enrichments" → URL `patientEnrichments=true|false` (RV: `patient_enrichments`).
  2. "Enriched in ..." multi-select of groups, all ☑ `[default]` *(local)* — semantics CMM-FL-2.
  3. ☐ Significant only *(local)* — CMM-FL-1.
- **CMM-AL-5 Table** columns, 2 groups `[B]`:
  `Gene | Cytoband | (A) g1 | (B) g2 | Co-occurrence Pattern | Log2 Ratio | p-Value | q-Value | Enriched in`
  >2 groups: `Gene | Cytoband | one count column per group | p-Value | q-Value | Most enriched in` `[B]`.
  - Paging: 20 rows, "Showing 1-20 of N", [Show more]; columns menu; copy/download when `skin_hide_download_controls=show`.
  - Initial sort: q-Value ascending; ties keep pre-sort (p asc, then gene symbol asc) — seen alphabetical runs when p underflows to 0 `[B]`.
  - Seen counts: 22 871 rows (2-group brca default) `[B]`.

| Column | Cell | Sort | Filter / tooltip |
|---|---|---|---|
| Gene | **bold symbol**; RV: checkbox before it (query genes ☑+disabled "This is one of the query genes") | symbol | substring, case-insensitive |
| Cytoband | from reference genome gene | string | cytoband filter |
| per group | "altered (xx.xx%)" e.g. "154 (90.06%)" | altered count | hover `[B]`: "171 samples in (A) BRCA_Basal are profiled for TP53, 154 (90.06%) of which are altered in TP53"; header tooltip "<group>: Number (percentage) of samples|patients in <group> that are profiled for, and altered in, listed gene." `[C]` |
| Co-occurrence Pattern | MiniOncoprint 150 px (CMM-AL-6); "-" when p undefined | — | header tooltip `[B]`: "Upper row : Samples colored according to group. / Lower row : Samples with an alteration in the listed gene are highlighted." |
| Log2 Ratio | `formatLogOddsRatio` (">10", "<-10", else 2 dp); "-" if falsy (0, NaN, undefined) | numeric | "Log2 based ratio of (pct in g1/ pct in g2)" |
| p-Value | `< 10^-10` when p=0 or log10 p < −10; else CMM-STM-9; "-" if undefined; **bold when q<0.05** | numeric | "Derived from two-sided Fisher Exact test" (2 groups) / "Derived from Chi-squared test" (>2) |
| q-Value | same format, bold when q<0.05 | numeric | "Derived from Benjamini-Hochberg procedure" |
| Enriched in / Most enriched in | group name (truncated 20 chars); when q<0.05: bold + background = group color, text color contrast; "-" if no p | name | substring filter; 2-group tooltip table: "Log ratio > 0 : Enriched in g1 / Log ratio <= 0 : Enriched in g2 / q-Value < 0.05 : Significant association"; >2: "The group with the highest alteration frequency" |

- **CMM-AL-6 Co-occurrence MiniOncoprint** (`AlterationEnrichmentsContainer.tsx:188-330`) `[C]`: widths as % of (g1 queried + g2 queried cases):
  - g1 width = g1 queried / total; g2 = rest. Segments: g1 unprofiled = (queried−profiled)/total, g1 unaltered, g1 altered, g2 altered, g2 unprofiled (all ÷ total). Queried = distinct samples (or patients) in the group.
  - Tooltip: "<G> alterations in: g1: a of p of profiled samples (x.x%)" per group (1 dp).
- **CMM-AL-7** Row click → highlights row in the table data store (no box plot for alterations).

### CMM-VO — Volcano (MiniScatterChart; shared by all 2-group tabs)
- 350×350, title-less; X "Log2 Ratio", Y "-log10 p-Value"; corner labels "← <g2>" (left) and "<g1> →" (right), "Significance →" vertical; labels truncated with "…" when long `[B]`.
- **CMM-VO-1 Points** = all rows with p and q defined, minus RV query genes. x = log ratio (alterations & GA-binary: clamped ±10 via `roundLogRatio`, else 2 dp; expression/GA numeric: raw), y = −log10 p, capped at 10 (p=0 → 10).
- **CMM-VO-2 X domain:** alterations [−15, 15] with ticks −10, 0, 10 `[B]`; expression/GA: [−d, d], d = ceil(max |x|), auto ticks (seen ±8 mRNA, ±2 protein, ±1 methylation) `[B]`.
- **CMM-VO-3 Color:** in drag-selection `#FE9929`; q<0.05 `#58ACFA`; else `#D3D3D3`; fillOpacity 0.4.
- **CMM-VO-4 Hover tooltip** "Gene: X" (GA: entity name) / "Log2 Ratio: …" / "p-Value: …" / "q-Value: …" (CMM-STM-9 format) `[C]`.
- **CMM-VO-5 Drag rectangle** → filters the table to selected genes *(local)*; click on empty space clears; clicking a point (expression/GA) = row click (sets the box plot).
- **CMM-VO-6** Download (SVG/PNG) `enrichments-volcano` `[C]`.

### CMM-FS — Frequency scatter (alterations & GA binary, 2 groups)
- X "Altered Frequency in <g1> (%)", Y "Altered Frequency in <g2> (%)" (GA binary: Y prefix "Frequency"); both axes [0, max(x,y) over all points]; dashed `#cccccc` diagonal y=x `[B]`.
- Points: x = g1 altered %, y = g2 altered %; significant (q<0.05) drawn on top in `#58ACFA`, others `#D3D3D3`, selection `#FE9929`.
- Tooltip: Gene, Log Ratio, "Alteration Frequency in g1: N%" (integer), g2, p, q `[C]`. Drag-select like VO-5.

### CMM-BP — Gene bar plot (GeneBarPlot; GA binary: GenericAssayBarPlot)
- **CMM-BP-1** Title at top-left = current option label; [Select genes] popup; download `GroupComparisonGeneFrequencyPlot`.
- **CMM-BP-2** Options (`EnrichmentsUtil.tsx:1468-1560`):

| Option | Ordering |
|---|---|
| User-defined genes | textarea (OQL disallowed: "OQL is not allowed") |
| Genes with highest frequency in any group `[default]` | desc by max group altered % |
| Genes with highest average frequency | desc by mean of group altered % |
| Genes with most significant p-value | **legacy bug:** comparator returns 0 when both p defined → original (p-sorted) order kept, undefined p first |
| Sync with table (up to 100 genes) | current visible table rows, first 100 |

- "Number of Genes (max. 100)" input, default 10 `[default]`; [Submit]. GA binary: same with "Entities …", [Select entities].
- **CMM-BP-3 Bars:** grouped by gene, one bar per group in group color; height = group altered % (not normalized); gene label gets "*" when q<0.05 `[B]`. Y label `[C]`:
  - mutations only → "Mutation frequency"; CNA only → "Copy-number alteration frequency" (rule fires when *nothing* is selected — legacy bug); else "Alteration event frequency" (seen) `[B]`.
  - Legacy bug: "Fusion event frequency" requires SV **and CNA** selected and no mutations.
  - GA binary: "<profile name> altered ratio (%)".
- **CMM-BP-4 Tooltip:** "<G> <yLabel>" + table Group | Percentage Altered "xx.xx% (a/p)" (hovered group bold) + p, q; shows "-" when p or q is 0 (falsy check — legacy bug) `[C]`.

### CMM-FL — Table filters (shared by all enrichment tables except GA categorical)
- **CMM-FL-1 Significant only:** keep rows with q < 0.05 (seen 22 871 → 5 747 rows) `[B]`. Rows whose q is undefined/0 bypass the check (pass) `[C]`.
- **CMM-FL-2 "Enriched in ..." / "High expression in ..." / "High methylation in ..." / "High in ..."** (`getFilteredData`, `EnrichmentsUtil.tsx:546-600`): keep a row if, for at least one selected group G, value(G) ≥ value(every other group in the row) — i.e. G is (tied) max, compared against *all* groups. value = `meanExpression || alteredPercentage`.
  - Legacy bug: a mean of exactly 0 is falsy → value undefined → comparisons fail, so any row where some group's mean is exactly 0 is hidden even with all groups selected (expression & GA numeric) `[C]`.
  - Deselecting all groups empties the table.
- **CMM-FL-3** Volcano/scatter selection (VO-5) is ANDed with FL-1/2.

---

## 2. Mutations tab (comparison lollipop)
Uses the mutation mapper / mutation table (see 05-mutations.md). Comparison differences only:
- **CMM-MU-1 Header row:** gene selector (searchable, "Search genes"; default options = genes with mutations sorted by frequency) · "Highest Frequency:" pill tabs for the top 10 genes `[B]` (seen TP53, PIK3CA, TTN, CDH1, GATA3, MAP3K1, MUC16, KMT2C, USH2A, SPTA1).
  - Gene order = Genomic-Alterations-style enrichment run on mutations only (all mutation types, current sample/patient level) sorted by max group altered % (`ComparisonStore.ts:1367-1432`) `[C]`.
  - Default gene = top one; URL `selectedGene=<symbol>`.
- **CMM-MU-2 Title** "<GENE> mutations: (A) g1 vs (B) g2" `[B]`.
- **CMM-MU-3 Mirrored lollipop:** g1 on top, g2 below; y-axis labels "**(A) <name ≤~21 units…>**\n% mutated of N profiled pts" or "# patients"; Top/Bottom Y-Axis Max inputs; Y-Axis toggle `%` `[default]` / `#` → URL `axisMode=PERCENT|COUNT` `[B]`.
  - Count = unique (gene, patient, protein change) mutations at that position; % = count / profiled patients ×100 (`GroupComparisonMutationMapperWrapper.tsx:69-80`) `[C]`.
  - Profiled patients per group = distinct patients with ≥1 sample in the group profiled for the gene in any mutation profile (gene-panel aware) — seen 171 Basal / 499 LumA `[B]`.
  - Lollipop tooltip: "x% (m mutated of N profiled patients)" / "m mutated of N profiled patients" `[C]`.
- **CMM-MU-4 Footer label** "Fisher Exact Two-Sided Test p-value for all|filtered|selected mutations - g1 vs g2: <p>" (selected if any selection, filtered if table filtered) `[B: all]`.
  - a = unique patients in g1 with a mutation in current table data, b = same for g2; p = two-sided Fisher on [a, N1−a, b, N2−b]; format `< 10^-10` / CMM-STM-9.
  - ⓘ tooltip: overlap table + "k patients have more than one mutation in GENE" `[C]`.
- **CMM-MU-5 Table** columns `[B]`: Protein Change | Annotation | (custom driver, tier, mutation status when present) | Mutation Type | (A) g1 | (B) g2 | Co-occurrence Pattern | Log2 Ratio | p-Value | q-Value | Enriched in. Rows = one per protein change ("132 Mutations (page 1 of 6)").
  - Group cells "a (x.xx%)": a = distinct patients in group with that protein change; % = a / profiled patients ×100.
  - Log2 Ratio = log2(%A / %B) (">10" when B=0 — seen) ; Enriched in = A if log ratio > 0 else B; colored/bold when q<0.05.
  - p = two-sided Fisher per protein change [a, NA−a, b, NB−b]; q = BH over all protein-change rows; p/q bold when q<0.05; p format "2.587e-4", q "0.0269" `[B]`.
  - Controls: "Enriched in ..." (by `nameWithOrdinal`) and ☐ Significant only (q<0.05) filter table + lollipop via protein-change filter; reset on transcript change.
- **CMM-MU-6** Patient-level always (ignores the sample/patient enrichment select). OverlapExclusionIndicator in sample mode.
- **CMM-MU-7** No mutations → "Selected gene has no mutations for profiled samples." / "…due to no profiled samples." `[C]`.
- **CMM-MU-8** Not in Results View › Comparison.

---

## 3. mRNA / Protein / DNA Methylation tabs (ExpressionEnrichmentContainer)

- **CMM-EX-1 "Data Set:"** profile select (width 400) + ⓘ description tooltip; always shown (`alwaysShow`). Changing it refetches *(local, not URL)* `[B]`.
- **CMM-EX-2 Charts:** volcano (2 groups only; CMM-VO) + box plot panel (CMM-BX). No frequency scatter, no bar plot `[B]`.
- **CMM-EX-3 Header** = selected profile name (h3) + `<hr>`; RV: [Add checked genes to query].
- **CMM-EX-4 Controls:** group select placeholder "High expression in ..." (mRNA/protein) / "High methylation in ..." (methylation) · ☐ Significant only. No sample/patient select `[B]`.
- **CMM-EX-5 Columns** `[B]`: `Gene | Cytoband | μ in <g> (each group) | σ in <g> (each group) | [Log2 Ratio — 2 groups] | p-Value | q-Value | Higher expression in` (methylation: "Higher methylation in").
  - μ, σ: 2 dp; "NA" if group absent for that gene.
  - Log2 Ratio: `formatLogOddsRatio(μ1−μ2)`; tooltip "Log2 of ratio of (unlogged) mean in g1 to (unlogged) mean in g2" — **legacy mislabel**: value is a difference of means of log2(x+1) (RNA-seq) or raw values (CMM-STM-4).
  - p: `toConditionalPrecision(p,3,0.01)` — p=0 shows "0.00" (seen in 5-group ANOVA) `[B]`; tooltip "Derived from Student's t-test" (2 groups) / "Derived from one-way ANOVA" (≥3) — test is actually Welch (CMM-STM-4).
  - q: same format, **bold when q<0.05**; p never bold.
  - Higher … in: as CMM-AL-5 Enriched in (color when q<0.05; "-" when p undefined); >2 groups = highest mean; tooltips "The group with the highest expression|methylation frequency".
  - μ header tooltip "Mean log2 expression of the listed gene in samples in <g>" (methylation: "Mean methylation…"); σ "Standard deviation of log2 expression…" `[C]`.
  - Row count seen: mRNA 20 026, protein 9 719 (2 groups) `[B]`.
- **CMM-EX-6** Row click (or volcano point click) → box plot for that gene; row highlighted.
- **CMM-EX-7** 2-group mRNA occasionally failed with "Error encountered…" (request terminated) on first load; reload worked `[B]` — not a requirement.

### CMM-BX — Clicked-row box plot (ExpressionEnrichmentsBoxPlot; plotting → 04-plots.md)
- Before a click: "Click on gene in the table to render this plot." (GA: "an entity") `[B]`.
- **CMM-BX-1 Data:** fetches the selected profile's values for that gene/entity for **all samples in the comparison** (`sampleKeyToSample`), then groups them by group membership (a sample in two groups appears in both) `[C]`.
  - RNA-seq profile (`molecularProfileId` contains `rna_seq`): value → log2(v+1) (no clamp of negatives — differs from backend; values < −1 → NaN) and Y label suffix " (log2)" `[B: suffix]`.
  - GA: values with `<`/`>` skipped; others parseFloat.
- **CMM-BX-2 Render:** boxes per group (x order = group order), box width 60 (30 if >7 groups), fill `#00AAF8`, circles, Y starts at 0 when data ≥0, log-space ticks; X label "Group" (RV with queried genes: "Query: <genes>"); Y "<GENE>, <profile name>[ (log2)]" or "<entity label>, <profile name>" `[B]`.
- **CMM-BX-3 Legend:** "p-Value: <p>" and "q-Value: <q>" (toConditionalPrecision 3/0.01) `[B]`.
- **CMM-BX-4 Point tooltip:** sample link (patient view) + "<enrichment type>[ (log2)]: v.vvv" (GA: "<entity>: v.vvv"); RV adds "Alteration(s): GENE: MUT; …" when OQL data supplied `[C]`.
- **CMM-BX-5 Download:** SVG / PNG / Data; file `expression_enrichment`, `methylation_enrichment`, `<GA type>_enrichment` `[C]`.

---

## 4. Generic assay tabs (`GenericAssayEnrichmentCollections`)
One tab per `genericAssayType`; label = config `displayTitleText` (Treatment Response, Mutational Signature, Arm-level CNA, HLA LOH) else title-cased type ("Genetic Ancestry", "Phosphosite Quantification") `[B]`.

- **CMM-GA-1 Data Set dropdown** lists binary, then categorical, then LIMIT-VALUE profiles of that type; selected profile's datatype decides the container `[C]`.
  - Legacy bug: binary/categorical data come from `selectedGenericAssay{Binary,Categorical}EnrichmentProfileMap…`, which the dropdown never updates → with ≥2 binary (or ≥2 categorical) profiles, switching keeps showing the first profile's data under the new name `[C]`.
  - A page error "Cannot read properties of undefined (reading '<studyId>')" is thrown on load of comparison pages (seen on brca) `[B]` — not a requirement.
- **CMM-GA-2 Entity column** title = config `entityTitle` (Methylation: "Gene / Probe") else display text; cell **bold** compact label "NAME (stableId)" (e.g. "TBX19 (cg17095936)"); name fallback = stableId; filter/sort by name `[B]`.

### CMM-GN — Numeric (LIMIT-VALUE) container
- Same layout as CMM-EX (volcano + box plot, no header h3), placeholder "High in ..." `[B]`.
- Columns: `<Entity> | μ in g… | σ in g… | [Log Ratio] | p-Value | q-Value | Higher in` `[B]`. Log Ratio = μ1−μ2 (tooltip "Log2 of ratio of mean in g1 to mean in g2" — mislabel); volcano axis still says "Log2 Ratio" `[B]`.
- Seen: Methylation GA 22 601 rows, top TBX19 μ 0.93 vs 0.40, p 3.37e-233 `[B]`.

### CMM-GB — Binary container `[C]` (no binary GA profile found on the public brca study)
- Charts (2 groups): volcano (x clamped ±10), frequency scatter (Y "Frequency in …"), entity bar plot.
- Columns: `<Entity> | count column per group "n (xx.xx%)" | [Co-occurrence Pattern | Log Ratio] | p-Value | q-Value | Enriched in / Most enriched in`. Cell tooltip "<total> samples in g are profiled for E, n (x%) of which are altered in E".
- Placeholder "High in ..."; Significant only. Always sample wording (patient-level prop not passed).

### CMM-GC — Categorical container (seen on Arm-level CNA)
- Left (900 px): table `<Entity> | Attribute Type ("Sample") | Statistical Test ("Chi-squared Test") | p-Value | q-Value`; 39 rows; p/q "0.00" when 0 `[B]`. No volcano, no enriched-in or significance filter.
  - Legacy bug: p-Value header tooltip says "Derived from Student's t-test"/"one-way ANOVA" though the test is chi-squared `[C]`.
- Right: plot of the highlighted row (first row by default; row click switches) `[B]`:
  - Plot Type select: Bar chart · Stacked bar chart · **100% stacked bar chart** `[default]` · Heatmap.
  - ☐ Swap Axes · ☐ Horizontal Bars (not for heatmap) · ☑ Show NA `[default]` · ☐ Show p and q (not for heatmap). Download (SVG/PNG).
  - X = group, stacks = category (seen Gain / Loss / NA / Unchanged), Y "# samples (%)". Category values normalized case-insensitively to the first spelling seen.
  - Show NA ☑: samples of the comparison without a value are added as "NA"; ☐: NA-like values (server `comparison_categorical_na_values`) removed.
  - Uses CategoryPlot (Clinical tab component, 20-comparison-core).

---

## 5. Results View › Comparison tab differences (`ComparisonTab.tsx`, `ResultsViewComparisonStore.ts`)
- **CMM-RV-1** Sub-tabs: Overlap · Survival · Clinical · Genomic Alterations · mRNA · Protein · DNA Methylation · GA tabs. **No Mutations tab, no Pathways.** URL `comparison_subtab=<id>`.
- **CMM-RV-2** Groups: "Altered group" `#dc3912`, "Unaltered group" `#3366cc`, "Unprofiled group" (NA color; only if totally-unprofiled samples exist and not hidden), plus one group per OncoPrint track (seen: Altered 622, Unaltered 462, TP53 354, PIK3CA 368; first two selected) `[B]`; user groups via `comparison_selectedGroups`, `comparison_groupOrder`, `comparison_overlapStrategy`, `comparison_createdGroupsSessionId` (details → 20-comparison-core) `[C]`.
- **CMM-RV-3** Gene checkboxes + [Add checked genes to query (A, B)] ("(none checked)" and disabled when none; tooltip "Check genes in table below") on Genomic Alterations, mRNA, Protein, Methylation; adds genes to `gene_list` and re-queries `[C]`.
- **CMM-RV-4** Query genes are removed from Genomic Alterations results **before** q-values are computed (and from the volcano/scatter) whenever any queried profile's study is in the request (`ResultsViewPageStoreUtils.ts:672-697`) — TP53/PIK3CA absent from the table `[B]`. mRNA/protein/methylation/GA do **not** drop query genes `[C]`.
- **CMM-RV-5** Level select persists in `patient_enrichments`; alteration types in `comparison_selectedEnrichmentEventTypes`.
- **CMM-RV-6** Settings menu: the alteration-type selector is rendered inline unless `skin_show_settings_menu` and ≥2 active groups.

---

## 6. Modes & conditions

| ID | Condition | Expected behavior |
|---|---|---|
| CMM-MD-1 | Exactly 2 groups | Volcano (+ frequency scatter for alterations/GA binary), Log2 Ratio column, Co-occurrence column, "Enriched in"; Mutations tab works |
| CMM-MD-2 | ≥3 groups | No volcano/scatter/log ratio/co-occurrence; "Most enriched in" = highest %/mean; alteration p by chi-square; expression p by one-way ANOVA; Mutations tab message |
| CMM-MD-3 | <2 active groups | Molecular tabs hidden (Mutations shows message); tab-wrapper messages CMM-TAB-5 |
| CMM-MD-4 | Multi-study groups | mRNA/Protein/Methylation/GA hidden; Genomic Alterations and Mutations still work (one profile per study) |
| CMM-MD-5 | Patient-level enrichments | Alteration counts/denominators in patients (CMM-STM-2); wording "patients"; expression/GA unaffected (always sample) |
| CMM-MD-6 | Overlap Exclude `[default]` / Include | Exclude: overlapping cases removed from all groups before every request; Include: a case counts in each of its groups |
| CMM-MD-7 | Targeted panels of different gene content | Profiled denominators per gene differ by group; gene absent from all panels of one group → p=0 bug (CMM-STM-1) |
| CMM-MD-8 | Group with no data for a gene (expression) | Group omitted from that gene's statistics ("NA" μ/σ); gene dropped if <2 groups remain |
| CMM-MD-9 | Results View | No Mutations tab; query genes dropped from alterations; Add-to-query buttons |
| CMM-MD-10 | `skin_show_settings_menu` true | Alteration types inside ⚙ menu instead of inline |
| CMM-MD-11 | Several eligible profiles | "Data Set:" dropdown on mRNA/Protein/Methylation/GA; alterations always use the first profile per study |

---

## 7. Persistence

**URL (Group Comparison):** path tab · `comparisonId` · `patientEnrichments` · `selectedEnrichmentEventTypes` (session prop) · `selectedGene` · `axisMode` · plus core params `groupOrder`, `unselectedGroups`, `overlapStrategy`.
**URL (Results View):** `comparison_subtab` · `patient_enrichments` · `comparison_selectedEnrichmentEventTypes` · `comparison_selectedGroups` · `comparison_groupOrder` · `comparison_overlapStrategy` · `comparison_createdGroupsSessionId`.
**localStorage:** OncoKB icon merge style (mutation mapper).
**Not persisted:** Data Set selection, Significant only, enriched-in selection, volcano/scatter selection, bar-plot gene option, clicked row/box plot, checked genes, categorical plot options, mutation table filters.

---

## 8. Statistics & methods

Paths: frontend relative to cbioportal-frontend; backend relative to `cbioportal/src/main/java/org/cbioportal/`.
"Groups" = active groups after overlap strategy. Requests: `POST /api/alteration-enrichments/fetch?enrichmentType=SAMPLE|PATIENT`
(column-store `GetAlterationEnrichmentsUseCase`), `/api/expression-enrichments/fetch` (mRNA/protein/methylation),
`/api/generic-assay-enrichments/fetch` (numeric), `/api/generic-assay-binary-enrichments/fetch`, `/api/generic-assay-categorical-enrichments/fetch` (expression/GA always `SAMPLE`).

**CMM-STM-1 Alteration p-value** (`domain/alteration/util/AlterationEnrichmentScoreUtil.java`)
- Only computed if ≥2 groups have profiled > 0 and no group has altered > profiled. **Otherwise p = 0** (BigDecimal 0, not null) → shows "< 10^-10", q≈0, significant. Legacy bug, confirmed via API: IMPACT341 vs IMPACT410 groups → every gene on only one panel (e.g. STAT3 7/300 vs 0/0) returns `pValue: 0` `[B]`. (The old `legacy/service/util/AlterationEnrichmentUtil` left p null.)
- 2 groups: **two-sided Fisher exact** on 2×2 [[g2 unaltered, g2 altered],[g1 unaltered, g1 altered]]; two-sided = sum of probabilities of all tables with the same margins and P ≤ P(observed) (`legacy/service/util/FisherExactTestCalculator.java:42-90`); no tolerance factor.
- ≥3 groups: **Pearson chi-square test of independence** on k×2 [altered, profiled−altered] (Apache `ChiSquareTest.chiSquareTest(long[][])`, df = k−1, no Yates). NaN → p = 1 (e.g. all altered, or any group with profiled = 0 → zero row → p = 1).
- Genes with altered = 0 in every group are dropped (backend and again frontend).

**CMM-STM-2 Alteration counts** (`GetAlterationEnrichmentsUseCase.java`, `ClickhouseAlterationMapper.xml:220-268`)
- Request per group: one identifier per sample (caseId = sampleId, or patientId in PATIENT mode) × each selected profile of its study (mutation, CNA, SV) — samples of studies lacking a profile are skipped for that profile.
- **Altered** = COUNT DISTINCT sample (or patient) with ≥1 event in `genomic_event_derived` for the gene, in the selected profiles, passing: mutation_status ≠ UNCALLED; mutation-type filter (CMM-AT-5); CNA ∈ {AMP, HOMDEL} selection (only ±2 are stored); SV toggle; driver (`driver_filter` putative_driver / putative_passenger / unknown), tier and germline/somatic/unknown filters when not all-selected. **Off-panel events are counted** (not `numberOfAlteredCasesOnPanel`).
- **Profiled** = number of cases whose set of gene panels (union over all selected profiles' `sample_to_gene_panel_derived` rows) contains the gene; WES (`gene_panel_id` empty → 'WES') covers every gene in the gene table. A case with any panel containing the gene counts as profiled for every alteration type (documented design limitation). Cases with no panel row for any selected profile are never profiled.
- PATIENT mode: entity = `patient_unique_id`; panels and events are joined over **all samples of the patient**, including samples not in the group (quirk) `[C]`.
- Groups missing for a gene get {altered 0, profiled 0}.

**CMM-STM-3 Alteration display values** (`EnrichmentsUtil.tsx:310-370`)
- altered % = altered / profiled × 100 (0 if either is 0); cell "a (pct.toFixed(2)%)"; co-occurrence tooltip 1 dp.
- Log2 Ratio (2 groups) = log2(%g1 / %g2), **no pseudocount**: %g2 = 0 → +∞ (">10", volcano x 10); %g1 = 0 → −∞ ("<-10"); both 0 → NaN ("-"). Exactly 0 also renders "-".
- Enriched in (2 groups) = g1 if logRatio > 0 else g2 (NaN → g2); uses `nameOfEnrichmentDirection` if set. ≥3 groups: group with max altered % (first in sorted order on ties).

**CMM-STM-4 Expression statistics** (`legacy/service/util/ExpressionEnrichmentUtil.java`)
- Values: the profile's value for each requested sample present in the profile's ordered sample list; non-numeric (`NumberUtils.isNumber` false, e.g. NA, ">8") dropped.
- Transform: profile stableId contains `rna_seq` → log2(max(v,0)+1); otherwise raw (microarray, merged z-scores, RPPA/MS protein, methylation beta, GA).
- Per group: requires ≥2 values (else the group is omitted for that gene); mean = arithmetic mean; σ = sample SD (n−1, `DescriptiveStatistics`); group omitted if mean/SD NaN.
- Gene kept only if ≥2 groups remain. 2 groups: `TestUtils.tTest(a,b)` = **two-sided Welch t-test** (unequal variances); ≥3: **one-way ANOVA** F-test p. NaN p → gene dropped (e.g. both groups constant).
- Expression requests are always SAMPLE-level; patient-level GA profiles: one sample per patient per group (first encountered) before the test.
- Log2 Ratio (2 groups) = μ1 − μ2 of the transformed values (difference of mean log2(x+1) for RNA-seq; plain mean difference otherwise). No pseudocount beyond the +1. Higher-in = g1 if > 0 else g2; ≥3 groups: highest μ.
- Multiple entrez IDs mapping to one symbol: only enrichments with a gene record are kept.

**CMM-STM-5 Generic assay binary** (`ExpressionEnrichmentUtil.java:150-225`) `[C]`
- Values: non-empty strings; "true"/"yes" → 1, "false"/"no" → 0, others parsed as numbers (a non-numeric string like "NA" would throw — latent bug).
- Per group: totalCount = number of values; count = values equal to 1; needs ≥2 values. p = Welch t-test (2 groups) / ANOVA (≥3) on the 0/1 values (not Fisher).
- altered % = count / totalCount × 100; Log Ratio = log2(%g1/%g2) (no pseudocount); enriched as STM-3.
- Backend computes BH q, then the frontend recomputes q (STM-7) and overwrites it.

**CMM-STM-6 Generic assay categorical** (`ExpressionEnrichmentUtil.java:95-148`)
- Per group: counts of each raw value string (case-sensitive, NA strings included as a category) over requested samples present in the profile; group needs ≥2 values.
- p = Pearson chi-square on groups × categories (all categories from all groups; missing = 0). Only one category → p = 1; NaN → 1.
- q = BH computed **in the backend** (`ExpressionEnrichmentServiceImpl.calcQValues`, BigDecimal, scale of p, HALF_UP); frontend does not recompute.

**CMM-STM-7 q-values (frontend)** (`ResultsViewPageStoreUtils.ts:629-650`, `BenjaminiHochbergFDRCalculator.ts`)
- Benjamini–Hochberg over all rows that have a p-value (after RV query-gene removal), n = that count: sort p ascending; q_i = min_{j≥i}(p_j · n / j); largest p keeps q = p. Not capped (p ≤ 1 anyway).
- Applied to alterations, mutations-enrichment, expression, GA numeric, GA binary. Mutations tab: BH over protein-change rows (STM-8).
- Rows then sorted by (p asc, gene symbol / stableId asc); table initial sort q asc.
- Quirk: `if (cachedElement)` treats a running minimum of 0 as unset (only matters when the max p is 0).

**CMM-STM-8 Mutations tab statistics** (`GroupComparisonUtils.tsx:1124-1215`, `FisherExactTwoSidedTestLabel.tsx`)
- N_g = distinct patients of group g with ≥1 sample profiled for the gene in any mutation profile (coverage/gene panel).
- Per protein change: a_g = distinct patients in g with that protein change (merged by gene + protein change, selected transcript); % = a_g / N_g × 100; log2 ratio = log2(%A/%B) (no pseudocount); p = two-sided Fisher [a_A, N_A−a_A, a_B, N_B−a_B] (frontend `FisherExactTestCalculator.ts`); q = BH over all rows; significant q < 0.05.
- Footer p: same test on distinct mutated patients across all / filtered / selected rows.
- Lollipop height: count = unique (patient, protein change) mutations at a position; % mode divides by N_g.

**CMM-STM-9 Number formats** (`NumberUtils.ts:1-11`, `FormatUtils.tsx:75-125`)
- `toConditionalPrecision(x,3,0.01)`: 1e-6 ≤ x < 0.01 → `toExponential(3)` ("2.587e-4"); otherwise `toPrecision(3)` ("0.0269", "3.80e-14", "0.00" for 0) `[B]`.
- Alteration & mutation tables / Fisher label: `toConditionalPrecisionWithMinimum(x,3,0.01,−10)`: x = 0 or log10 x < −10 → "< 10^-10" `[B]`.
- `formatLogOddsRatio`: < −10 → "<-10", > 10 → ">10", else 2 dp.
- Volcano y = −log10 p capped at 10; x for alterations rounded to 2 dp and clamped ±10.

**CMM-STM-10 Significance** — everywhere "significant" = q < 0.05 (strict): bold p/q (alterations, mutations), bold q (expression/GA), colored enriched-in cell, blue volcano/scatter point, "*" on bar-plot gene label, Significant-only filter. No p-value or effect-size threshold.

**CMM-STM-11 Box plot values** — raw profile values (log2(v+1) for `rna_seq` profiles, negatives not clamped) for every comparison sample in each group; box statistics per 04-plots.md. Legend p/q are the table's values.
