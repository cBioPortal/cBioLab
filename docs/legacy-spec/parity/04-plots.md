# Parity audit — Results › Plots (spec `04-plots.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day)
- **Code paths (cBioLab):** `app/portal/results-layout.ts:191-217` (Plots tab: default axes, `points` layers), `app/portal/PortalTabs.tsx:188` (mounts `PlotControls`), `app/lab/plot-controls.tsx` (axis sidebar, swap, unit, Points/Density, Highlight layers, colour/ring, "Showing N" line), `app/lab/view-chrome.tsx:110-240` (`AxisPicker`: Data / Gene / Plot mutations by / Entity), `app/lab/plot-hover.tsx` + `lib/views/plot/point-tip.ts` (tooltips), `lib/views/plot/figure.ts` (scatter / box / table SVG), `lib/views/plot/run.ts` (runner, box order, pooling), `lib/plot.ts` (axis SQL, stats SQL, box SQL, `tukey`, `corrPValue`), `lib/plot-profile.ts` (profile → axis), `lib/chart/format.ts` (`fmtNum`, `pDigits`)

**Queries used** (legacy ⇄ cBioLab). All on `coadread_tcga_pan_can_atlas_2018`, genes `KRAS TP53 APC`, unless noted.

| # | Axes (horizontal × vertical) | Legacy | cBioLab |
|---|---|---|---|
| Q1 default, expression vs CNA (box) | CNA `gistic` KRAS × mRNA `rna_seq_v2_mrna` KRAS | `/results/plots?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS TP53 APC` | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%20TP53%20APC` › Plots |
| Q1-log | Q1, vertical log on | Q1 + Vertical Log Scale | Q1 axis `y.log: true` |
| Q2 expression vs CNA (scatter) | CNA `log2CNA` KRAS × mRNA KRAS (log off / on) | Q1, horizontal source → log2CNA | `?changes=` `Plots › Plot` `{x:{profile:"log2CNA",gene:"KRAS"}, y:{…}}` |
| Q3 clinical vs clinical (scatter) | MUTATION_COUNT × FRACTION_GENOME_ALTERED ("Mut# vs FGA") | Q1, both axes Clinical Attribute | `?changes=` with two `clinical` axes |
| Q4 clinical vs clinical (scatter) | AGE × FRACTION_GENOME_ALTERED | same | same |
| Q5 clinical vs clinical (box) | CANCER_TYPE_DETAILED × FRACTION_GENOME_ALTERED ("FGA vs Dx") | same | same |
| Q6 discrete vs discrete | CNA `gistic` KRAS × Mutation type KRAS | same | `y:{profile:"mutations",gene:"KRAS",by:"mutationType"}` |
| Q7 mutation type vs mRNA (box, log) | Mutation type KRAS × mRNA KRAS log | same | same |
| Q8 multi-study | Q1 axes over `coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018` | (spec PLT-MS-5 tooltip figures) | `/api/analysis`, `studies:[…]` |

Legacy values read from `window.resultsViewPlotsTab` (`scatterPlotData`, `boxPlotData`, axis promises) plus the rendered SVG text; legacy box statistics recomputed from its plotted values with `boxPlotUtils.ts`'s rule (PLT-STM-8; verified: recomputed medians equal legacy's own `median` field). cBioLab values from the `/api/analysis` result the page posts (`plot.stats`, `plot.groups`, `plot.cells`, `plot.xyPoints`) and the rendered SVG. Scripts, JSON and screenshots: (local scratch, not committed) (`leg.js`, `leg2.js`, `lab.js`, `labapi.js`, `labui.js`, `compare.js`; `out/leg-*.png`, `out/ui-*.png`, `out/lab.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 13 |
| 🟡 partial | 42 |
| 🔶 different | 33 |
| ❌ missing | 75 |
| 🐞 ok | 2 |
| 🐞 copied | 0 |
| N/A | 5 |
| ? | 0 |
| **Total IDs** | **170** |

**Overall: 11.8 %** (✅ 13 + 🐞ok 2 + N/A 5 = 20 of 170). Counting 🟡 as half: 24.1 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Chrome (CH) | 5 | 0 | 2 | 0 | 1 | 0 | 2 | Page-wide OQL note only; cross-study rule applied by dropping expression; no CaseFilterWarning |
| §1 Layout (LY) | 4 | 0 | 2 | 1 | 1 | 0 | 0 | Sidebar + "Showing N" line + figure; no quick-plot pills; card-width figure |
| §2 Axis menus (AX) | 14 | 0 | 6 | 1 | 6 | 1 | 0 | One Data select (profiles by name); 2 of 6 mutation groupings; no Same gene, filter/sort categories, limit-value, sort-order |
| §3 Axis data (DT) | 19 | 4 | 6 | 1 | 7 | 1 | 0 | CNA, continuous, clinical and panel-aware Not profiled match exactly; no Driver/VUS, VAF, CCF, clonality, SV type, gene sets |
| §4 Plot types (PT) | 6 | 2 | 0 | 2 | 2 | 0 | 0 | Scatter and vertical box match; no waterfall; no horizontal boxes; discrete pair is a table only |
| §5 Utilities (UT) | 9 | 0 | 0 | 2 | 7 | 0 | 0 | No search, connect, plot type, sort-by, horizontal bars; regression line always on |
| §6 Coloring (CL) | 10 | 0 | 4 | 3 | 3 | 0 | 0 | Box only: fill + ring by any categorical axis; default none; no numeric colouring, no driver split |
| §7 Quick plots (QP) | 12 | 0 | 0 | 0 | 12 | 0 | 0 | No "Examples" pills |
| §8 Scatter (SC) | 6 | 0 | 2 | 3 | 1 | 0 | 0 | Points per sample ✅; stats line Pearson-first at 2 significant digits; dashed fit always; no drag-select |
| §8 Box (BX) | 8 | 1 | 1 | 5 | 1 | 0 | 0 | Different quartile index and even-n median; n=1 draws a box; counts on tick labels; adds a box tooltip |
| §8 Waterfall (WF) | 7 | 0 | 0 | 0 | 7 | 0 | 0 | Refused: "an ordered-cases axis (a waterfall) is not implemented yet" |
| §8 Bar (BR) | 8 | 0 | 0 | 0 | 8 | 0 | 0 | No bar / stacked / 100% charts |
| §8 Table (TB) | 4 | 1 | 1 | 2 | 0 | 0 | 0 | Counts identical (15/15 cells); log shading, marginal-total order |
| §9 Tooltips (TT) | 4 | 0 | 1 | 1 | 2 | 0 | 0 | Id, both values, layers, link; no mutation/CNA/SV sections |
| §10 Download (DL) | 2 | 0 | 0 | 0 | 2 | 0 | 0 | No SVG/PNG/PDF/Data on the Plots card |
| §11 Highlight (HL) | 5 | 0 | 0 | 3 | 1 | 0 | 1 | Highlight = point layers (cohort / outliers / extremes / trend) + show/hide chips; no search, no selection bar |
| §11 Messages (MS) | 7 | 0 | 4 | 0 | 1 | 0 | 2 | "Showing N of M samples with data on both axes" (numbers match); refusals in own words |
| §11 Limit values (LV) | 4 | 0 | 0 | 1 | 3 | 0 | 0 | ">8"-style values dropped as non-numeric |
| §13 Modes (MD) | 14 | 1 | 8 | 2 | 3 | 0 | 0 | Sample default + patient mode; multi-study counts match; no waterfall / limit-value / driver modes |
| §15 Statistics (STM) | 22 | 4 | 5 | 6 | 7 | 0 | 0 | Pearson, n, p(Pearson), table counts, panel-aware categories exact; Spearman ties, box quartiles, log base, regression differ |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Box-plot quartiles differ from legacy on the default Plots view**: ClickHouse `quantilesExact` (sorted[floor(p·n)]) vs legacy nearest-rank sorted[round(p·n)−1], and the upper middle as median for even n. Q1 Amplification median 2722.74 vs legacy 2668.88; Diploid q1/med/q3 981.83/1220.17/1496.62 vs 978.62/1217.02/1487.07; whiskers move with them | STM-8, BX-4 | not tracked |
| 2 | **No default "Color samples by" gene**: legacy colours every point by the first gene's mutation type (fill) + CNA (stroke) with a legend; cBioLab draws plain points, colour/ring only on box plots and only when chosen; no colouring on scatters at all | CL-1…CL-4, CL-8, SC-6 | driver/VUS colouring only: (tracked) Driver-annotation settings |
| 3 | **Discrete × discrete is a table only**: no Bar / Stacked (legacy default) / 100% stacked, Sort By, Horizontal Bars | PT-6, UT-4…6, BR-1…8, STM-12 | not tracked |
| 4 | **Spearman uses ordinal ranks for ties** (ClickHouse `rankCorr`), not average ranks: AGE×FGA ρ −0.05476 vs −0.05509 (shown "−0.055" vs "−0.06"); Mut#×FGA −0.34867 vs −0.34872; p moves with it | STM-5, STM-6 | not tracked |
| 5 | **Correlation display**: "Pearson r = −0.038 (p = 0.36) · Spearman ρ = −0.055 (p = 0.19)" (2 significant digits, p to 2 sig., Pearson first, above the plot) vs legacy "Spearman: -0.06 (p = 0.185)" / "Pearson: -0.04 (p = 0.359)" (`toFixed(2)`, `toConditionalPrecision(p,3,0.01)`, right gutter) | SC-2, STM-4, STM-6, STM-22 | not tracked |
| 6 | **No quick-plot "Examples" pills** (Mut# vs Dx, FGA vs Dx, mRNA vs CNA, …) | QP-1…12, LY-1 | not tracked |
| 7 | **Mutation axis groupings**: only "mutation type" and "mutated vs not"; no Driver vs VUS, VAF, CCF, Clonality; SV has no Variant Type; labels "Not mutated" (legacy "No mutation"), "Structural variant" (legacy "With Structural Variants") | AX-2, DT-3…10, MD-4, MD-12 | Driver vs VUS: (tracked) Driver-annotation settings |
| 8 | **No waterfall / Ordered samples** (Treatment Response, mRNA) and no limit values ">8" (dropped as non-numeric) | PT-1/2, WF-*, AX-3, AX-5, LV-*, MD-8/9, STM-19/20 | not tracked |
| 9 | **No downloads** on the Plots card (SVG / PNG / PDF / Data `plot.txt`) | DL-1, DL-2 | hide-switch only: (tracked) Data-governance switches |
| 10 | **No Search Case(s) / Search Mutation(s), no scatter drag-select + "Selected: N samples" → Study View**, no clickable legend highlight | UT-1, UT-2, UT-8, SC-5, HL-1…5 | not tracked |
| 11 | **Log scale is log10(v+1) with negatives dropped**, not log2(max(v,0)+1); not auto-on for `rna_seq` mRNA; axis "(log scale)" not "(log2(value + 1))". Pearson is base-invariant (0.37742 both) but box values / ticks differ | AX-4, STM-11, MD-11 | not tracked |
| 12 | **Regression line always drawn** (dashed), no "Show Regression Line" toggle, no "y = mx + b" / R² label | UT-7, SC-3, STM-7 | not tracked |
| 13 | **Category order**: non-CNA boxes ordered by count (Q5: Colon, Rectal, Mucinous; legacy alphabetical Colon, Mucinous, Rectal; Q7: Not mutated first, legacy Missense…No mutation, Not profiled); table rows/columns by marginal total. No Filter categories / Sort by Median | BX-1, TB-3, DT-3, AX-9, AX-10, STM-9 | not tracked |
| 14 | **Clinical attributes shown by raw id** (`MUTATION_COUNT`, `CANCER_TYPE_DETAILED`) in the select, axis title and tooltip, not display names; no ⓘ descriptions | AX-2, DT-19 | not tracked |
| 15 | **Multi-study box quartiles are a size-weighted approximation** across studies (counts exact: 1662 / 1674 / 1658 = legacy); legacy computes on pooled values | MD-2, STM-8 | not tracked |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 data availability (h / v / both) | STM-3, MS-5 | 592 / 592 → "Showing 590 samples" | 592 / 592 → "Showing 590 of 594 samples" | ✅ |
| Q1 box n per CNA level | STM-1, BX-1 | 1 / 67 / 388 / 128 / 6 | 1 / 67 / 388 / 128 / 6 | ✅ |
| Q1 Shallow Del. q1 · med · q3 · whiskers | STM-8 | 774.00 · 1017.73 · 1169.69 · 180.48–1763.21 | 774.00 · 1017.73 · 1170.69 · 178.98–1765.72 | 🔶 q3 index (floor vs round−1) |
| Q1 Diploid (n=388) | STM-8 | 978.62 · 1217.02 · 1487.07 · 215.95–2249.74 | 981.83 · 1220.17 · 1496.62 · 209.64–2268.81 | 🔶 quartile index + even-n median |
| Q1 Gain (n=128) | STM-8 | 1166.20 · 1442.89 · 1854.65 · 244.40–2887.33 | 1169.46 · 1444.28 · 1868.43 · 244.40–2916.87 | 🔶 |
| Q1 Amplification (n=6) | STM-8 | 2398.32 · 2668.88 · 2842.69 · 1762.30–3509.25 | 2398.32 · 2722.74 · 2842.69 · 1762.30–3509.25 | 🔶 median (upper middle) |
| Q1 Deep Del. (n=1) | BX-3 | no box (point only) | degenerate box at 468.29 | 🔶 |
| Q1-log Diploid (legacy rule on log10 for comparability) | STM-8, STM-11 | log2: 9.936 · 10.250 · 10.539 (log10 equiv. 2.9911 · 3.0857 · 3.1726) | log10: 2.9925 · 3.0868 · 3.1754 | 🔶 base + quartile rule |
| Q2 n | STM-1 | 590 | 590 (same 590 sample ids) | ✅ |
| Q2 Pearson (raw) | STM-4/6 | 0.50806, p 4.86e-40 → "Pearson: 0.51 (p = 4.86e-40)" | 0.50806, p 4.863e-40 → "Pearson r = 0.51 (p = 4.9e-40)" | 🟡 value ✅, format |
| Q2 Spearman | STM-5/6 | 0.33036, p 1.72e-16 → "0.33" | 0.33046, p 1.686e-16 → "0.33 (p = 1.7e-16)" | 🔶 ties ranked ordinally |
| Q2 Pearson, mRNA on log | STM-4/11 | 0.37742 (log2(x+1)), p 2.06e-21 | 0.37742 (log10(x+1)), p 2.063e-21 | ✅ (base-invariant) |
| Q3 n (h / v / both) | STM-3 | 534 / 583 → 523 | 534 / 583 → 523 (same ids, same values) | ✅ |
| Q3 Pearson | STM-4/6 | −0.33166, p 6.80e-15 → "−0.33 (p = 6.80e-15)" | −0.33166, p 6.801e-15 → "−0.33 (p = 6.8e-15)" | 🟡 value ✅, format |
| Q3 Spearman | STM-5/6 | −0.34872, p 2.12e-16 → "−0.35 (p = 2.12e-16)" | −0.34867, p 2.142e-16 → "−0.35 (p = 2.1e-16)" | 🔶 ties (p 2.12 vs 2.14e-16) |
| Q4 n | STM-3 | 592 / 583 → 581 | 592 / 583 → 581 (same ids, same values) | ✅ |
| Q4 Pearson | STM-4/6 | −0.03816, p 0.359 → "−0.04 (p = 0.359)" | −0.03816, p 0.3585 → "−0.038 (p = 0.36)" | 🟡 value ✅, format |
| Q4 Spearman | STM-5/6 | −0.05509, p 0.185 → "−0.06 (p = 0.185)" | −0.05476, p 0.1875 → "−0.055 (p = 0.19)" | 🔶 ties; shown value differs |
| Spearman on cBioLab's own points, ordinal ties | STM-5 | — | −0.05477 / −0.34889 (≈ engine's −0.05476 / −0.34867) vs average-rank −0.05509 / −0.34872 | diagnosis: `rankCorr` does not average ties |
| Q5 n per category | STM-1 | Colon 370 · Mucinous 58 · Rectal 155 (583) | 370 · 58 · 155 (583) | ✅ |
| Q5 Colon (n=370) | STM-8 | 0.1065 · 0.2268 · 0.3407 · 0–0.6920 | 0.1065 · 0.2269 · 0.3407 · 0–0.6920 | 🔶 median (even n) |
| Q5 Mucinous (n=58) | STM-8 | 0.0053 · 0.1140 · 0.2128 · 0–0.5240 | 0.0053 · 0.1146 · 0.2128 · 0–0.5240 | 🔶 median |
| Q5 Rectal (n=155) | STM-8 | 0.1909 · 0.2973 · 0.4110 · 0–0.7411 | 0.1909 · 0.2973 · 0.4128 · 0–0.7457 | 🔶 q3 index |
| Q6 table, 15 non-zero cells | STM-13 | Diploid×No mutation 223, Diploid×Missense 126, Gain×Missense 64, Gain×No mut 49, ShDel×No mut 40, Diploid×NP 39, ShDel×Missense 22, Gain×NP 15, ShDel×NP 5, Amp×Missense 3, Amp×No mut 2, Diploid×Inframe 1, DeepDel×No mut 1, Amp×NP 1, Diploid×Truncating 1 | identical (labels "Not mutated", "Shallow deletion") | ✅ |
| Q7 mutation-type n | DT-3, DT-18 | Missense 216 · Inframe 1 · Truncating 1 · No mutation 314 · Not profiled 60 | Missense 216 · Inframe 1 · Truncating 1 · Not mutated 314 · Not profiled 60 | ✅ counts (label differs) |
| Q7 Missense median (log10 basis, n=216) | STM-8 | 3.1178 | 3.1193 | 🔶 even-n median |
| Q8 multi-study h / v / both | STM-3, MD-2 | 1662 / 1674 / 1658 | 1662 / 1674 / 1658 | ✅ |
| Q8 per-level n | MD-2 | — (not read) | 3 / 181 / 1070 / 383 / 21; quartiles size-weighted across studies | ? legacy quartiles not read; cBioLab says its quartiles are approximate |

Data version: every n, every point set and every value compared is identical (Q2–Q4: same sample ids, values equal), so the warehouse holds the same data as cbioportal.org for this study. All differences above are method, not data.

---

## 4. Scorecard

### §0 Tab chrome

| ID | verdict | how | note |
|---|---|---|---|
| PLT-CH-1 | 🟡 | B | No per-tab OQL banner; the Results header says once "The query's OQL decides who is Altered; the oncoprint and the gene tabs draw every alteration" (`results/page.tsx:133`). Plots axes ignore OQL ✅ |
| PLT-CH-2 | N/A | C | No global driver/VUS/germline filter exists to warn about; plot axes read every called mutation (`plot.ts` `mutation_status != 'UNCALLED'`), as legacy Plots does |
| PLT-CH-3 | ❌ | C | No Show-only-profiled, no CaseFilterWarning |
| PLT-CH-4 | 🟡 | C | Same rule (`expressionAcross`, `results-layout.ts:190`); when it disallows, the Plots tab falls back to a clinical axis and the header lists "expression in Plots (expression data cannot be compared across the selected studies)" rather than an info alert inside the tab |
| PLT-CH-5 | N/A | C | No banners in the plot card at all |

### §1 Layout

| ID | verdict | how | note |
|---|---|---|---|
| PLT-LY-1 | ❌ | B | No "Examples:" pills |
| PLT-LY-2 | 🟡 | B | Horizontal block · "↑ Swap axes ↓" · Vertical block ✅; below them "Each point is a", "Draw each sample as", "Highlight" instead of Utilities; blocks are Data / Gene / (Plot mutations by) / Log scale |
| PLT-LY-3 | 🟡 | B | "Showing 590 of 594 samples with data on both axes" ✅ (no ⓘ; per-axis breakdown in the caption); colour toolbar only on box plots, plus "SHOW" chips; no download, no selection bar; caption under the figure in place of footnotes |
| PLT-LY-4 | 🔶 | BC | Figure drawn at card width, height `clamp(240, 0.36·W, 420)` (`figure.ts:41`); no 650×650 scatter, no waterfall/bar sizes |

### §2 Axis menus

| ID | verdict | how | note |
|---|---|---|---|
| PLT-AX-1 | 🟡 | BC | One "Data" select merges data type and source: "Clinical attribute", then each profile by name grouped by type, then "OQL query" (`view-chrome.tsx:165-173`); no "Ordered samples", no "Gene Sets"; no 2-level type → source |
| PLT-AX-1a | 🟡 | BC | coadread default identical (CNA gistic KRAS × mRNA RSEM KRAS, log off). No mRNA: horizontal = mutation type of gene 1, vertical = FGA / MUTATION_COUNT (`results-layout.ts:191,216`), not legacy's first-attribute-against-itself |
| PLT-AX-1b | 🟡 | C | Changing Data resets gene/entity; no per-type session history; no viewLimitValues |
| PLT-AX-1c | ❌ | C | No "Same gene" option |
| PLT-AX-2 | 🟡 | BC | Profiles by name ✅; attributes by raw id (`MUTATION_COUNT`), not display name/priority; "Plot mutations by": mutation type / mutated vs not only; no SV "by" select; no ⓘ description |
| PLT-AX-3 | ❌ | C | No waterfall |
| PLT-AX-4 | 🔶 | BC | Shown on any numeric axis; never disabled (negatives dropped, NULL, `plot.ts:274`); log10(v+1); not auto-on for `rna_seq`; title "(log scale)"; kept in the document |
| PLT-AX-5 | ❌ | C | No limit-value checkbox (limit values are dropped; LV) |
| PLT-AX-6 | 🟡 | BC | Free gene field (any gene, `QueryField`), not the queried genes; no "(Not profiled)" suffix; no localStorage fallback; default gene 1 ✅; several genes on a mutation axis become an OQL axis |
| PLT-AX-7 | ❌ | C | No gene sets (tracked: GSVA gene sets) |
| PLT-AX-8 | 🟡 | C | `EntityField` search per generic-assay profile; no "Same <type>", no gene-related ordering, no 100-option header |
| PLT-AX-9 | ❌ | C | No Filter categories |
| PLT-AX-10 | ❌ | C | No Sort Categories by Median |
| PLT-AX-11 | 🐞 ok | BC | Swap exchanges the whole axis definitions (log, by and SV mode included), so the `structuralVariantCountBy` bug is not reproduced; disabled when a box already has its categories across |

### §3 Axis data

| ID | verdict | how | note |
|---|---|---|---|
| PLT-DT-1 | ✅ | BC | Sample attribute; numeric = finite parse (`finiteSql`); Q3/Q4 values identical to legacy |
| PLT-DT-2 | ✅ | BC | Patient value repeated on each sample (`plot.ts:300-304`); AGE (patient attr) 592 samples = legacy |
| PLT-DT-3 | 🟡 | BC | Counts identical (Q7); "Not mutated" for "No mutation"; order by count, not class order; nonstart / nonstop: nonstop → Truncating ✅, Translation_Start_Site → Other (legacy Truncating) (`plot.ts:452`) |
| PLT-DT-4 | 🟡 | C | "Mutated" / "Not mutated" / "Not profiled" |
| PLT-DT-5 | ❌ | C | No Driver vs VUS (tracked: Driver-annotation settings) |
| PLT-DT-6 | ❌ | C | No VAF axis |
| PLT-DT-7 | ❌ | C | No CCF |
| PLT-DT-8 | ❌ | C | No Clonality |
| PLT-DT-9 | 🟡 | C | "Structural variant" / "No structural variant" / "Not profiled" (`plot.ts:414`) |
| PLT-DT-10 | ❌ | C | No SV Variant Type |
| PLT-DT-11 | 🟡 | BC | Five levels, values identical (Q1, Q6); labels "Deep deletion", "Shallow deletion" (lower-case second word) |
| PLT-DT-12 | ✅ | BC | Continuous CNA / mRNA: same 590 samples, same values (Q2) |
| PLT-DT-13 | ❌ | C | No gene sets (tracked) |
| PLT-DT-14 | 🔶 | C | ">8" values have no row in the numeric form (`generic-assay.ts:20-31`); counted as "no value" in the caption |
| PLT-DT-15 | 🟡 | C | GA categorical axis ✅; groups by count, no reserved order |
| PLT-DT-16 | ❌ | C | No Ordered samples |
| PLT-DT-17 | 🐞 ok | C | Every called mutation (no driver/somatic filter); germline VUS not dropped |
| PLT-DT-18 | ✅ | BC | Panel-aware `profiledCasesSql`; Not profiled 60 = legacy (Q6, Q7) |
| PLT-DT-19 | 🟡 | B | "KRAS: Putative copy-number alterations from GISTIC" ✅ form; clinical raw id; mutation "KRAS mutation type" (legacy "KRAS: Mutations"); log "(log scale)" |

### §4 Plot-type rules

| ID | verdict | how | note |
|---|---|---|---|
| PLT-PT-1 | ❌ | C | Waterfall refused (`federation.ts:1684`) |
| PLT-PT-2 | ❌ | C | Same |
| PLT-PT-3 | ✅ | B | number × number → scatter |
| PLT-PT-4 | ✅ | B | string × number → vertical boxes |
| PLT-PT-5 | 🔶 | BC | number × string still drawn with categories across; sidebar says "Swap to make them agree" (`plot-controls.tsx:205`); no horizontal boxes |
| PLT-PT-6 | 🔶 | B | Contingency table only (legacy default Stacked bar) |

### §5 Utilities

| ID | verdict | how | note |
|---|---|---|---|
| PLT-UT-1 | ❌ | B | No Search Case(s) |
| PLT-UT-2 | ❌ | B | No Search Mutation(s) |
| PLT-UT-3 | ❌ | C | No Connect samples; "Each point is a patient" combines samples instead |
| PLT-UT-4 | ❌ | B | No Plot Type select |
| PLT-UT-5 | ❌ | B | No Sort By |
| PLT-UT-6 | ❌ | B | No Horizontal Bars |
| PLT-UT-7 | 🔶 | B | No toggle: the dashed least-squares line is always drawn on a scatter |
| PLT-UT-8 | ❌ | C | No search |
| PLT-UT-9 | 🔶 | B | No jitter control ✅, but "Draw each sample as Points / Density" adds a per-group density (violin) |

### §6 Color samples by

| ID | verdict | how | note |
|---|---|---|---|
| PLT-CL-1 | 🟡 | BC | Box plots only: "colour samples by FILL" + "RING", each any categorical axis (clinical, mutation, SV, discrete CNA, GA category) or none; no Cancer Study entry; no numeric attributes; scatter has none |
| PLT-CL-2 | 🔶 | B | Default none (legacy: first queried gene) |
| PLT-CL-3 | ❌ | C | No auto-choice |
| PLT-CL-4 | 🔶 | B | Two pickers (fill, ring) replace the Mutation Type / Structural Variant / Copy Number checkboxes |
| PLT-CL-5 | ❌ | C | No numeric colouring / Log Scale |
| PLT-CL-6 | 🟡 | B | None → no colouring ✅; clinical and genomic can combine (fill + ring) |
| PLT-CL-7 | ❌ | B | No footnotes |
| PLT-CL-8 | 🟡 | C | Mutation / CNA colours from `oncoprint-style` (`categoryColor`, `plot.ts:126`); no driver/VUS split (tracked); "Multiple" grey; no white "Not profiled" with grey stroke; diamonds n/a |
| PLT-CL-9 | 🔶 | C | Draw order = layer order (plotted cohort, then layers, first layer wins), not mutation/CNA priority |
| PLT-CL-10 | 🟡 | C | String colours: reserved oncoprint colours else categorical palette, top 12 + "other"; no numeric Reds |

### §7 Quick-plot pills

| ID | verdict | how | note |
|---|---|---|---|
| PLT-QP-1 | ❌ | B | No pills at all |
| PLT-QP-2 | ❌ | B | — |
| PLT-QP-3 | ❌ | B | — |
| PLT-QP-4 | ❌ | B | — |
| PLT-QP-5 | ❌ | B | — |
| PLT-QP-6 | ❌ | B | — |
| PLT-QP-7 | ❌ | B | — |
| PLT-QP-8 | ❌ | B | (the default view equals "mRNA vs CNA") |
| PLT-QP-9 | ❌ | B | — |
| PLT-QP-10 | ❌ | B | — |
| PLT-QP-11 | ❌ | B | — |
| PLT-QP-12 | ❌ | B | — |

### §8 Scatter

| ID | verdict | how | note |
|---|---|---|---|
| PLT-SC-1 | 🟡 | BC | One point per sample, NaN dropped ✅; ticks from `lib/chart`, "2,000" not "2k"; above 10,000 cases a binned density |
| PLT-SC-2 | 🔶 | B | Line above the plot: "Pearson r = −0.33 (p = 6.8e-15) · Spearman ρ = −0.35 (p = 2.1e-16)": Pearson first, `fmtNum(r, 2)` = 2 significant digits ("−0.038"), p via `pDigits` |
| PLT-SC-3 | 🔶 | B | Dashed line, ink/series colour, always on; no swatch, equation or R² |
| PLT-SC-4 | 🟡 | C | One radius 2.8 for every point; hovered point redrawn on top; no 4/6/8 sizes |
| PLT-SC-5 | ❌ | B | No drag-select on the scatter |
| PLT-SC-6 | 🔶 | B | Legend = "point layers" only; no colour legend (no scatter colouring) |

### §8 Box

| ID | verdict | how | note |
|---|---|---|---|
| PLT-BX-1 | 🟡 | B | One box per category ✅; CNA in level order ✅ (`run.ts:66`); others by count desc (`plotBoxSql … ORDER BY n DESC`) |
| PLT-BX-2 | 🔶 | B | Blue `LAYER_BASE` box (fill 0.1), 2-px median, muted whisker without caps; half-width ≤24 px; jitter ±0.9 × half |
| PLT-BX-3 | 🔶 | B | n = 1 draws a flat box + whisker (Q1 Deep deletion) |
| PLT-BX-4 | 🔶 | BC | Log applied before the box ✅; quartile rule differs (STM-8) |
| PLT-BX-5 | 🔶 | C | Adds a box tooltip: median, quartiles, whiskers, n (`point-tip.ts:49`); legacy has none |
| PLT-BX-6 | 🔶 | B | Tick labels carry counts "Diploid (388)"; labels horizontal/wrapped (legacy rotated 50°) |
| PLT-BX-7 | ❌ | C | No connect lines |
| PLT-BX-8 | ✅ | B | No p-value or test on the box plot |

### §8 Waterfall

| ID | verdict | how | note |
|---|---|---|---|
| PLT-WF-1 | ❌ | C | `federation.ts:1684` refuses an ordered-cases axis |
| PLT-WF-2 | ❌ | C | — |
| PLT-WF-3 | ❌ | C | — |
| PLT-WF-4 | ❌ | C | — |
| PLT-WF-5 | ❌ | C | — |
| PLT-WF-6 | ❌ | C | — |
| PLT-WF-7 | ❌ | C | — |

### §8 Multiple-category bar

| ID | verdict | how | note |
|---|---|---|---|
| PLT-BR-1 | ❌ | B | No bar chart |
| PLT-BR-2 | ❌ | B | — |
| PLT-BR-3 | ❌ | B | — |
| PLT-BR-4 | ❌ | B | — |
| PLT-BR-5 | ❌ | B | — |
| PLT-BR-6 | ❌ | B | — |
| PLT-BR-7 | ❌ | B | — |
| PLT-BR-8 | ❌ | C | (the 150-category cap exists for the table/box: `CATEGORY_CAP`) |

### §8 Table

| ID | verdict | how | note |
|---|---|---|---|
| PLT-TB-1 | 🟡 | B | Columns = horizontal, rows = vertical ✅; counts identical (Q6); 0 cells empty, not "0" |
| PLT-TB-2 | 🔶 | BC | Series-blue with log-scaled opacity (`figure.ts:385`), white text when opacity > 0.55; legacy linear white → `rgb(0,102,204)` |
| PLT-TB-3 | 🔶 | B | Rows and columns by marginal total desc (Q6: Diploid, Gain, Shallow, Amp, Deep), not category order |
| PLT-TB-4 | ✅ | B | No totals, no %, no test |

### §9 Tooltips

| ID | verdict | how | note |
|---|---|---|---|
| PLT-TT-1 | 🟡 | B | "TCGA-AG-4015-01 / KRAS: Putative … : Deep deletion / KRAS: mRNA …: 468.29 / in Altered / open this sample ↗" — id + link ✅, both values 2 decimals ✅; log axes show the raw value (legacy the log value); no mutation / CNA / SV / clinical-colour sections; no study line |
| PLT-TT-2 | ❌ | C | No waterfall |
| PLT-TT-3 | 🔶 | C | No bar; the table has per-cell `<title>` "x × y: n" (legacy none) |
| PLT-TT-4 | ❌ | C | No alteration sections |

### §10 Download

| ID | verdict | how | note |
|---|---|---|---|
| PLT-DL-1 | ❌ | B | No SVG / PNG / PDF / Data on the card; hide switch (tracked: Data-governance switches) |
| PLT-DL-2 | ❌ | B | No `plot.txt` |

### §11 Highlighting, selection

| ID | verdict | how | note |
|---|---|---|---|
| PLT-HL-1 | 🔶 | B | "Highlight" point layers (a cohort — Altered by default —, outliers, top/bottom N, furthest from the fit), drawn in colour over the plot; no search / legend highlight |
| PLT-HL-2 | 🔶 | B | "SHOW" chips hide/show the plotted cohort and each layer (Esc resets); browser-only |
| PLT-HL-3 | 🔶 | C | Layer membership predicates, not legend-category predicates |
| PLT-HL-4 | N/A | C | Results View only |
| PLT-HL-5 | ❌ | B | No selection bar / "Explore samples in study view" |

### §11 Messages

| ID | verdict | how | note |
|---|---|---|---|
| PLT-MS-1 | N/A | C | Every axis always has a Data choice |
| PLT-MS-2 | 🟡 | C | Gene field placeholder "choose a gene"; an empty gene is refused by the engine in its own words |
| PLT-MS-3 | 🟡 | C | "name the entity it reads (a signature, an arm, a probe), not a gene" (`plot-profile.ts:31`) |
| PLT-MS-4 | 🟡 | C | Same 150 cap (`CATEGORY_CAP`); own wording |
| PLT-MS-5 | 🟡 | B | "Showing 590 of 594 samples with data on both axes" + caption "(2 have no …; 2 have no …)"; numbers = legacy (STM-3); no study counts; VAF wording n/a |
| PLT-MS-6 | N/A | C | Empty: "nothing to draw" / engine note; error shown in the card (own wording) |
| PLT-MS-7 | ❌ | B | No footnotes |

### §11 Limit values

| ID | verdict | how | note |
|---|---|---|---|
| PLT-LV-1 | 🔶 | C | ">8" / "<0.01" are not parsed: the value is dropped, the case counted as having none |
| PLT-LV-2 | ❌ | C | No diamonds / legend entry / exclusion switch |
| PLT-LV-3 | ❌ | C | No waterfall |
| PLT-LV-4 | ❌ | C | No "unchecked" mode |

### §13 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| PLT-MD-1 | ✅ | BC | Sample-level default; patient attribute copied to each sample; adds "Each point is a patient" (mean / common value / Multiple) |
| PLT-MD-2 | 🟡 | C | Counts identical (Q8: 1662 / 1674 / 1658); sources merged by profile suffix ✅; box quartiles size-weighted across studies (`run.ts:18`); no mRNA vs Study pill, no study in tooltip |
| PLT-MD-3 | 🟡 | C | No Connect samples; patient unit instead; "# Samples per Patient" if the study has it as an attribute |
| PLT-MD-4 | ❌ | C | No driver split (tracked) |
| PLT-MD-5 | 🟡 | C | No filter applies ✅; no Show only profiled |
| PLT-MD-6 | 🟡 | BC | "Not profiled" category per sample/gene ✅ (60, Q7); no "(Not profiled)" gene suffix |
| PLT-MD-7 | 🟡 | C | Profile absent → not in the Data list ✅; no colouring checkboxes to drop |
| PLT-MD-8 | ❌ | C | No limit-value mode |
| PLT-MD-9 | ❌ | C | No waterfall |
| PLT-MD-10 | 🟡 | B | Table only; no colour toolbar ✅, no search ✅; no Plot Type / Sort By / Horizontal Bars |
| PLT-MD-11 | 🔶 | C | Negatives: log still offered, negative values dropped (NULL), all profiles alike |
| PLT-MD-12 | 🔶 | C | One value per sample: molecular `argMax(value, 1)` (any one), assay `avg`; no VAF multi-value axes |
| PLT-MD-13 | 🟡 | C | Explore / lab plot card (`app/lab/kinds/plot.tsx`) defaults to two numeric attributes, else mutation type × a categorical; gene from a free field |
| PLT-MD-14 | 🟡 | C | Custom data uploads appear as clinical attributes (`custom-data.ts`), no login needed |

§14 Persistence (no IDs): both axes, log, unit, layers, colour and ring live in the document (`?changes=` `Plots › Plot`); "SHOW" chips and hover stay in the browser (invariant 9). Legacy's localStorage gene fallback and per-type session history have no equivalent.

### §15 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| PLT-STM-1 | ✅ | BC | Inner join on sample; same n and same sample ids in Q1–Q8 |
| PLT-STM-2 | 🟡 | C | Every called mutation of the gene, not driver-filtered ✅; CNA colouring by any categorical (discrete profile includes 0/±1 ✅); no hotspot/custom annotation |
| PLT-STM-3 | ✅ | B | Axis counts and intersection identical (590/592/592; 523/534/583; 581/592/583; 583/594/583; 1658/1662/1674) |
| PLT-STM-4 | 🟡 | BC | ClickHouse `corr` = sample Pearson; values identical to 5 dp in all four scatters, log space included; shown `fmtNum(r,2)` ("−0.038" vs "−0.04"); no limit-value exclusion |
| PLT-STM-5 | 🔶 | BC | `rankCorr` ranks ties ordinally: −0.05476 vs −0.05509 (Q4, shown "−0.055" vs "−0.06"), −0.34867 vs −0.34872 (Q3), 0.33046 vs 0.33036 (Q2). Average-rank Spearman on cBioLab's own points reproduces legacy exactly |
| PLT-STM-6 | 🟡 | BC | Same t-test, n−2 df, two-sided (`plot.ts:806`); p(Pearson) equal; p(Spearman) moves with STM-5; full-precision r (legacy rounds r to 5 dp first); shown `pDigits` (2 sig., ≥0.1 → 2 dp) not `toConditionalPrecision(p,3,0.01)` — though `portalP` exists in `lib/chart/format.ts` |
| PLT-STM-7 | 🔶 | C | `simpleLinearRegression` full precision, over every case; no rounding, no R², no label, always drawn |
| PLT-STM-8 | 🔶 | BC | `quantilesExact(0.25,0.5,0.75)` = sorted[floor(p·n)]: q1/q3 differ from legacy sorted[round(p·n)−1] whenever p·n has fraction ≥ .5 or is integral; median = upper middle for even n (Q1 Amp 2722.74 vs 2668.88). Whiskers `min(hi, q3+1.5·IQR)` = legacy's fence rule ✅ (comment and caption call it "Tukey") |
| PLT-STM-9 | ❌ | C | No sort by median |
| PLT-STM-10 | 🟡 | C | Deterministic per sample (FNV-1a hash → sin, `plot-draw.ts:14`) ✅; different hash, ±0.9 × half-width |
| PLT-STM-11 | 🔶 | BC | log10(v+1), negatives → NULL (legacy log2(max(v,0)+1)); before Pearson/box ✅, Spearman unaffected ✅; GA axes same log10(v+1) (legacy log10(v+offset)) |
| PLT-STM-12 | ❌ | C | No bar counts |
| PLT-STM-13 | ✅ | BC | Q6: all 15 cells identical |
| PLT-STM-14 | 🔶 | C | Colouring by mutation type uses the axis value: a sample with two classes is "Multiple", not the top-priority class |
| PLT-STM-15 | 🟡 | C | Discrete CNA value per sample ✅ (one call); no waterfall maxBy |
| PLT-STM-16 | ❌ | C | SV does not override CNA (separate fill / ring choices) |
| PLT-STM-17 | ✅ | BC | Panel-aware profiled per sample and gene (`profiledCasesSql`); Not profiled counts = legacy |
| PLT-STM-18 | ❌ | C | No numeric colour scale |
| PLT-STM-19 | ❌ | C | No limit values |
| PLT-STM-20 | ❌ | C | No waterfall |
| PLT-STM-21 | ❌ | C | No VAF / CCF / clonality axes |
| PLT-STM-22 | 🔶 | BC | Tooltip 2 decimals ✅ (`point-tip.ts:20`); correlations 2 significant digits; p `pDigits`; no downloads |

---

## 5. cBioLab bugs (wrong on its own terms)

- **Spearman is not Spearman on tied data**: `rankCorr` (`lib/plot.ts:516`) assigns ordinal ranks to ties, so ρ depends on row order and is off by up to 6×10⁻⁴ here (Q4 shows "−0.055" for −0.05509). Every clinical count axis (MUTATION_COUNT, AGE) has ties. The method record should also say so (invariant 12).
- **Caption and code comment call the whiskers "Tukey"** (`plot.ts:796` "reach the furthest value inside 1.5 x IQR"; caption "quartiles with Tukey whiskers") but `tukey()` returns the fence value itself (Q1 Shallow deletion: lower whisker drawn to 178.98 = q1 − 1.5·IQR; the lowest value inside the fence is 327.49, the next one down 176.18): the whisker ends where no data point is. This is legacy's own fence rule (PLT-STM-8, so the numbers agree with legacy), but it is not what the caption says.
- **Box for n = 1** is drawn as a flat box with a "whisker" (Q1 Deep deletion), though a single value has no quartiles.
- **Swap on a box plot whose categories are on the vertical axis**: the figure ignores the axis assignment and says so in the sidebar ("Swap to make them agree") rather than drawing what the document says.

## 6. Not verified

- Legacy multi-study (Q8) per-category quartiles (counts only, from the spec's tooltip figures).
- Generic-assay entity search limits and limit-value data (no public ">x" entity; legacy LV is `[C]` in the spec too).
- Box hover tooltip in the browser: the pointer lands on a point over the box; `boxTip` is code-verified.
