# Legacy parity spec — Results View › Co-expression

Source of truth: cbioportal.org (checked 2026-11-10), `cBioPortal/cbioportal-frontend@cd8c6df`, backend `cBioPortal/cbioportal` (column-store / ClickHouse implementation, which cbioportal.org serves).
Conventions as in `01-oncoprint.md`: `[default]`, `URL:`, *(local)*; `[B]` browser-only, `[C]` code-only, untagged = both.

Reference queries:
- `/results/coexpression?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS TP53`
- Same with Y profile = "Protein expression (RPPA)" (cross-profile path).

Key files (frontend `src/pages/resultsView/coExpression/`): `CoExpressionTab.tsx`, `CoExpressionViz.tsx`, `CoExpressionTableGenes.tsx`, `CoExpressionTableGenesets.tsx`, `CoExpressionTabUtils.ts`, `CoExpressionVizUtils.ts`, `CoExpressionPlot.tsx`, `CoExpressionPlotUtils.ts`; `shared/lib/calculation/BenjaminiHochbergFDRCalculator.ts`.
Backend: `application/rest/vcolumnstore/ColumnStoreCoExpressionController.java`, `domain/coexpression/usecase/FetchCoExpressionsUseCase.java`, `resources/mappers/clickhouse/coexpression/ClickhouseCoExpressionMapper.xml`. Legacy MySQL path (`/api/legacy/…`, gated by `coexpression_enabled`): `legacy/service/impl/CoExpressionServiceImpl.java`, `legacy/service/util/CoExpressionAsyncMethods.java`.

---

## 0. Tab visibility and chrome

- **COE-0.1** Tab label "Co-expression". Hidden when >1 study is queried (virtual studies count as their physical studies), or when no queried gene has data in any mRNA/protein profile (the `isThereDataForCoExpressionTab` HEAD-count check) (`ResultsViewPage.tsx:440-457`, `ResultsViewPageStore.ts:1632-1680`). Shown anyway if routed to directly.
- **COE-0.2** Banners `[C]`: OQL status with `tabReflectsOql=false` ("…does not affect…"); AlterationFilterWarning with `isUnaffected`; CaseFilterWarning (`CoExpressionTab.tsx:656-695`).
- **COE-0.3** No eligible profiles → `alert-info` "There are no available profiles in the queried studies." (`CoExpressionTab.tsx:643-647`) `[C]`.
- **COE-0.4** Loading text under the spinner while correlations compute: ≤500 samples in X profile → "Computing correlations across all genes. This may take a few seconds."; else "This study has a large number of samples. Computing correlations may take up to 2 minutes." (`CoExpressionViz.tsx:587-599`) `[C]`.

## 1. Entity pills and profile selectors

- **COE-1.1** Pill tabs, one per queried gene, then one per queried gene set (`geneticEntities`, `ResultsViewPageStore.ts:4802-4840`). Default = first. *(local)*
- **COE-1.2** Sentence: "Find **genes** [or **genes/genesets** if any GSVA score profile exists] in ⟨Y select⟩ that are correlated with ⟨entity⟩ in ⟨X select⟩" (`CoExpressionTab.tsx:439-500`).
  - Y = "query profile" (`.coexpression-select-query-profile`): the profile searched for correlated entities. Sent as `molecularProfileIdB`.
  - X = "subject profile" (`.coexpression-select-subject-profile`): the profile of the selected entity. Sent as `molecularProfileIdA`. Disabled when the selected entity is a gene set.
- **COE-1.3** Option label: `<profile name> (N sample[s])`, N = samples profiled in that profile after Show-only-profiled filtering (`molecularProfileIdToProfiledFilteredSamples`) (`CoExpressionTabUtils.ts:73-94`). Seen: "mRNA Expression, RSEM (Batch normalized from Illumina HiSeq_RNASeqV2) (592 samples)", "Protein levels (mass spectrometry by CPTAC) (84 samples)", "Protein expression (RPPA) (464 samples)".
- **COE-1.4** Eligible profiles (`CoExpressionTabUtils.ts:32-71`, `ResultsViewPageStore.ts:1616-1630`):

| List | Includes | Excludes | Order |
|---|---|---|---|
| X (gene entity) | `MRNA_EXPRESSION` or `PROTEIN_LEVEL` | id contains `zscores` unless it contains `merged_median_zscores` | id contains `rna_seq` first, else API order |
| X (gene-set entity) | `GENESET_SCORE` | id contains `gsva_pvalues` | API order |
| Y | union of both lists above | — | `rna_seq` first |

- **COE-1.5** Defaults: X = first X option, Y = first Y option *(local)*. Selections persist across pill switches (the same X/Y ids are reused).
- **COE-1.6** Every (entity × X × Y) combination is pre-mounted hidden; only the selected one fetches (`CoExpressionTab.tsx:529-593`). Cache key = `entityId,XprofileId,YprofileId` (`:415-416`).

## 2. Correlation table

- **COE-2.1** Layout: table 40% left, plot 60% right (`CoExpressionViz.tsx:537-557`).
- **COE-2.2** Columns (genes; `CoExpressionTableGenes.tsx:35-81`):

| Column | Render | Sort key | Download |
|---|---|---|---|
| Correlated Gene | bold symbol | symbol | symbol |
| Cytoband | text; `-`/empty when unknown | string | string |
| Spearman's Correlation | green `rgb(41,87,41)` if >0, else red `rgb(180,4,4)`; right-aligned | [\|ρ\|, ρ>0?1:0]; null → [0,0] | `toString()` or `N/A` |
| p-Value (tooltip "Derived from 2-sided t-test.") | black | [p, 1]; null → [0,0] | raw or `N/A` |
| q-Value (tooltip "Derived from Benjamini-Hochberg FDR correction procedure.") | bold if < 0.05 | [q ?? ∞, p ?? ∞] | raw or `N/A` |

- **COE-2.3** Gene-set Y profile variant (`CoExpressionTableGenesets.tsx`) `[C]`: first column "Correlated Gene Set" (names >28 chars → first 25 + "..."), width 60%; no Cytoband; no p/q tooltips; filter placeholder "Enter gene set.."; copy/download shown regardless of `skin_hide_download_controls`.
- **COE-2.4** Null correlation → cell "N/A" with tooltip "Correlation could not be computed: this gene has too few distinct expression values across the selected samples." (all three numeric columns) (`CoExpressionTableGenes.tsx:91-107`). Seen: 3,045 of 20,337 rows for KRAS/coadread mRNA.
- **COE-2.5** Number format: `toConditionalPrecision(v, 3, 0.01)` — if 1e-6 ≤ v < 0.01 → `toExponential(3)` (e.g. "4.257e-6"), else `toPrecision(3)` (e.g. "0.662", "5.09e-76"). Legacy quirk: 4 significant digits in [1e-6, 0.01), 3 elsewhere; negative values never use the exponential branch.
- **COE-2.6** Default sort: q-Value ascending (`:205-207`). First click on another column sorts ascending (Spearman asc puts N/A rows first).
  - Legacy bug: p-Value null sort key [0,0] puts N/A rows *first* when ascending.
- **COE-2.7** Table-mode select (`.coexpression-select-table-mode`, width 180) `[default Show Any Correlation]` *(local)* (`CoExpressionViz.tsx:93-113`):
  - "Show Any Correlation" — all rows incl. N/A.
  - "Show Only Positively Correlated" — ρ ≥ 0 (non-null).
  - "Show Only Negatively Correlated" — ρ ≤ 0 (non-null). Seen "Showing 1-25 of 7868".
  - ρ = 0 appears in both filtered modes.
- **COE-2.8** Search box, placeholder "Enter gene or cytoband..", with info icon: "Coexpression data can be filtered by gene, or by cytoband. To exclude all genes from a cytoband, prefix with a dash -. For example, to exclude all genes on 1p, search '-1p'." (`CoExpressionTabUtils.ts:20-23`). Matching (`ResultsViewTableUtils.ts:4-45`): row passes if gene name contains the upper-cased string OR the cytoband filter passes. Cytoband filter: whitespace-split terms; positive terms OR'ed, each a *prefix* match on cytoband; `-term` terms AND'ed, each rejects a prefix match.
- **COE-2.9** Pagination fixed 25/page ("Showing 1-25 of N", "Show more"). No column-visibility menu. Copy hidden; Download shown unless `skin_hide_download_controls=HIDE_ALL` (genes table).
- **COE-2.10** Row click selects the row (highlighted) and sets the plot's Y entity. When nothing is selected, the first row of the current sorted/filtered view is auto-selected (`CoExpressionViz.tsx:115-123`); the selection persists through re-sorts.
- **COE-2.11** Rows whose entity id has no gene/gene-set name are dropped client-side (`CoExpressionTab.tsx:397-403`). Cytoband from reference genome gene; gene only in `entrezGeneIdToGeneAll` → empty cytoband (seen for RPPA phospho entries e.g. `MAP2K1_PS217_S221`).
- **COE-2.12** Empty result → centered "There is no expression data for **⟨entity⟩** with the selected samples in **⟨X profile name⟩**." (`CoExpressionViz.tsx:558-574`) `[C]`.
- **COE-2.13** Dead code (do not port): "Load data for all genes." button and message "There are no genes with a Pearson or Spearman correlation with X of > 0.3 or < -0.3." (`CoExpressionViz.tsx:391-412`) never render, because `allDataRequested` defaults to `true` (`:137`). `correlationInformation` text (`CoExpressionTabUtils.ts:15-18`, "Pearson correlations are computed first…") is unused and wrong for the current backend.

## 3. Scatter plot

Uses ScatterPlot (see `04-plots.md`, scatter section). Page-specific differences:

- **COE-3.1** Title "⟨X entity⟩ vs. ⟨Y entity⟩"; 530×530 (`CoExpressionViz.tsx:494-510`).
- **COE-3.2** Axis labels `"<profile name>: <entity> (<cytoband>) (log2) "`; X includes cytoband, Y never does (legacy quirk, `CoExpressionPlot.tsx:239-248`).
- **COE-3.3** Points = samples with numeric values on both axes, from the study's sample list (`molecularProfileIdToDataQueryFilter`), i.e. not restricted to the table's sample set (COE-STM-2) and not affected by Show-only-profiled (`CoExpressionVizUtils.ts:48-167`).
- **COE-3.4** Toolbar (checkboxes, shared across all entity/profile combos, *(local)*; `CoExpressionTab.tsx:119-123`):

| Control | Default | Shown when |
|---|---|---|
| ☑ Show Mutations | on | study has a MUTATION_EXTENDED profile |
| ☐ Log Scale | off | X or Y profile id matches `/rna_seq/i` and not `/zscore/i` (`PlotsTabUtils.tsx:2765`) |
| ☐ Show Regression Line | off | always |

- **COE-3.5** Log scale applies log2(max(v, 0.01)) to **both** axes even when only one profile qualifies (legacy quirk, `CoExpressionPlot.tsx:250-262`). Seen: Pearson changes 0.49 → 0.74, Spearman unchanged.
- **COE-3.6** Point colours (Show Mutations on; `CoExpressionPlot.tsx:60-140`):

| State | Fill | Stroke | Legend |
|---|---|---|---|
| not profiled for mutations in X and Y | `#ffffff` | `#d3d3d3` | "Not profiled for mutations" |
| both mutated | `#FF0000` | `#B40404` | "Both mutated" |
| X only | `#DBA901` | `#886A08` | "⟨X⟩ mutated" |
| Y only | `#F5A9F2` | `#F7819F` | "⟨Y⟩ mutated" |
| neither | `#58acfa` | `#0174df` | "Neither mutated" |

  - Show Mutations off → all `#58acfa`/`#0174df`, no legend. Stroke width 1.2.
  - Draw order (z): not profiled < neither < one < both.
  - "Mutated" = any mutation with a protein change (germline included, no driver filter). "Profiled" = sample profiled in the study's mutation profile for that gene. Gene sets are never "profiled".
- **COE-3.7** Tooltip: "Sample ID: ⟨link⟩", "⟨X⟩: x.xx", "⟨Y⟩: y.yy" (toFixed(2)), "⟨X⟩ Mutation: …", "⟨Y⟩ Mutation: …" (comma list, " [germline]" suffix) `[C]`.
- **COE-3.8** Correlation legend (from ScatterPlot): "Spearman: 0.66 (p = 5.11e-76)", "Pearson: 0.49 (p = 2.18e-36)" — computed client-side over plotted points, so it can differ from the table value (COE-STM-6).
- **COE-3.9** Download buttons SVG | PNG | PDF | Data, filename `coexpression.*`; shown only when `skin_hide_download_controls=SHOW_ALL`. Data TSV (`CoExpressionPlotUtils.ts:43-76`):
  - Header: `Sample ID`, `⟨X⟩ (⟨X profile⟩)`, `⟨Y⟩ (⟨Y profile⟩)`, plus `⟨X⟩ Mutations`, `⟨Y⟩ Mutations` when Show Mutations is on.
  - Mutation cells: the protein-change list, or `WT` if profiled and unmutated, or `NS` if not profiled.
- **COE-3.10** Empty plot data → "No data to plot."; fetch error → "Error fetching data. Please refresh the page and try again." `[C]`.

---

## 4. Modes and conditions

| ID | Condition | Expected behavior |
|---|---|---|
| COE-MD-1 | X = Y profile | Request uses the study's `sampleListId` (or custom `sampleIds`) — all queried samples |
| COE-MD-2 | X ≠ Y profile | Request uses `sampleIds` = intersection of samples profiled in X and in Y after Show-only-profiled filtering (seen: 462 ids for mRNA×RPPA). Empty intersection → no request, empty state |
| COE-MD-3 | Y profile is GENESET_SCORE | Gene-set table variant (COE-2.3); names via `fetchGenesetsUsingPOST` |
| COE-MD-4 | Selected entity is a gene set | X list = GSVA score profiles only; X select disabled. Legacy bug: the column-store endpoint returns `[]` when `entrezGeneId` is null, so the tab always shows the empty state (COE-2.12) `[C]` |
| COE-MD-5 | Multi-study | Tab hidden (COE-0.1) |
| COE-MD-6 | Show only profiled (RV-2) on | Changes option counts and the cross-profile sample set only; same-profile requests still use the full sample list (legacy inconsistency) |
| COE-MD-7 | OQL / driver / germline settings | No effect on correlations; banners say so |
| COE-MD-8 | No mutation profile | Show Mutations hidden; all points blue |
| COE-MD-9 | Neither profile RNA-seq (non-z-score) | Log Scale hidden |

## 5. Persistence

- URL: none (tab path `/results/coexpression` only).
- *(local)*, lost on reload: selected entity, X/Y profile, table mode, search, sort, page, selected row, the three plot checkboxes.

---

## 6. Statistics & methods

**COE-STM-1 Endpoint** (`CoExpressionTab.tsx:321-329`)
- `POST /api/molecular-profiles/co-expressions/fetch?molecularProfileIdA=<X>&molecularProfileIdB=<Y>&threshold=0`, body `{sampleListId | sampleIds, entrezGeneId | genesetId}`.
- Threshold is always 0: `allData` is always true (`CoExpressionViz.tsx:137`; `CoExpressionTab.tsx:267-270`). Server default would be 0.3. So every gene in Y is returned.
- Server: `ColumnStoreCoExpressionController.java` → `FetchCoExpressionsUseCase.java` → ClickHouse mapper. Genes only; returns `[]` if `entrezGeneId` is null.

**COE-STM-2 Samples** (`CoExpressionTab.tsx:272-305`; `FetchCoExpressionsUseCase.java`)
- Same profile: all sample ids of the query's sample list.
- Cross profile: intersection of X- and Y-profiled samples, after Show-only-profiled filtering.
- Server keeps samples (as `<studyA>_<sampleId>`) where the X entity value is numeric (not `''`/`NA`, parseable as float). Pairs are formed per sample with a numeric Y-gene value. n = number of such pairs, per Y gene.
- Never restricted to altered samples.

**COE-STM-3 Correlation** (`ClickhouseCoExpressionMapper.xml:13-74`)
- Method: **Spearman only**, ClickHouse `rankCorr(refValue, geneValue)` over the n pairs (rank-based, ties averaged per the ClickHouse implementation `[C]`). No Pearson is computed server-side.
- The query entity itself is excluded from the Y list (`hugo_gene_symbol != query`).
- A Y gene is returned with a numeric ρ only if all hold: n ≥ 3; `uniq(values) > n/2` (approximate distinct count; float division); ρ finite; |ρ| ≥ threshold (0); and the gene has >1 distinct value across the whole Y profile.
- Returned with **ρ = null** (→ N/A) if: n < 3, or exactly 1 distinct value, or `uniq(values) ≤ n/2`. This drops many low-expressed genes with mostly tied (e.g. zero) values.
- Silently omitted: n ≥ 3 with >n/2 distinct values but non-finite ρ.

**COE-STM-4 p-value** (`FetchCoExpressionsUseCase.java:121-133`)
- Two-sided t-test on ρ: t = ρ·√((n−2)/(1−ρ²)), df = n−2, p = 2·T_cdf(−|t|) (Apache `TDistribution`).
- n ≤ 2 → 1.0; ρ² ≥ 1 → 0.0. Null ρ → no p-value.

**COE-STM-5 q-value** (`CoExpressionViz.tsx:156-189`; `BenjaminiHochbergFDRCalculator.ts:1-20`)
- Client-side **Benjamini–Hochberg** over the rows with a p-value (N/A rows excluded from m and get q = null).
- Sort by (p asc, gene name asc). With m rows and rank i (1-based): q_i = min_{j≥i}(p_j·m/j), a step-up cumulative minimum from the largest p. No cap at 1 (not needed since p ≤ 1).
- q is computed over the full returned set (all Y genes), independent of the table-mode filter and search.

**COE-STM-6 Plot statistics** (ScatterPlot, see `04-plots.md`)
- Spearman and Pearson over the plotted points (COE-3.3). Pearson uses log2 values when Log Scale is on. p-values come from the same t-approximation on the 5-decimal-rounded ρ.
- So the plot's ρ/p can differ from the table: different sample set, client vs ClickHouse ranking, rounding (seen: table p 5.09e-76, plot p 5.11e-76).

**COE-STM-7 Legacy MySQL backend** (`/api/legacy/…`, only when `coexpression_enabled=true`; not used by cbioportal.org) `[C]`
- Apache `SpearmansCorrelation`. Pairs with a non-numeric value are dropped; n ≤ 2 → omitted; NaN or |ρ| < threshold → omitted (never null).
- p from `getRankCorrelation().getCorrelationPValues()` (same t-test). Supports gene sets.
- Do not port the "null ρ for tie-heavy genes" rule from this path; it exists only in the column-store path.
