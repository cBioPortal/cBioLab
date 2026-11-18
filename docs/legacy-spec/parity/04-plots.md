# Parity audit — Results › Plots (spec `04-plots.md`)

- **Date:** 2026-11-11; re-measured 2026-11-18
- **cBioLab:** master @ `bc53b944`, `next dev` on `http://127.0.0.1:3109` (first audit: `session/spec` @ `f3197d75`)
- **Legacy:** cbioportal.org (Playwright, 2026-11-11; the 2026-11-18 numbers compared with the values read then, the data being the same version)
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
| ✅ match | 33 |
| 🟡 partial | 44 |
| 🔶 different | 17 |
| ❌ missing | 69 |
| 🐞 ok | 2 |
| 🐞 copied | 0 |
| N/A | 5 |
| ? | 0 |
| **Total IDs** | **170** |

**Overall: 23.5 %** (✅ 33 + 🐞ok 2 + N/A 5 = 40 of 170). Counting 🟡 as half: 36.5 %. (2026-11-11: 13.5 % / 25.9 %.)

Re-measurement of 2026-11-18 (master `bc53b944`): every ID judged again from the spec text against the code, the page and the `/api/analysis` results, not from the PRs' Tracker lines; the PRs since the first audit (#226, #232, #234, #238, #240, #241, #254, #280, #283, #285, #289, #298, #300, #305, #315, #318) had updated only three rows. 32 verdicts went up, none down. The statistics now agree with legacy wherever they were compared: every box's quartiles, median and whiskers (Q1, Q5), Spearman with average ranks (Q2 0.33036, Q3 −0.34872, Q4 −0.05509), both p-values, the regression's rounded slope / intercept / R², the table's 15 cells, Q8's counts. Sort by Median orders by the raw values' median only where the points are drawn; otherwise by each box's own median, said to be approximate. What is still missing is the portal's surface: quick-plot pills, waterfall, bar charts, downloads, search and selection, the first gene's colouring by default, limit values, VAF / CCF / clonality.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Chrome (CH) | 5 | 0 | 2 | 0 | 1 | 0 | 2 | Page-wide OQL note only; cross-study rule applied by dropping expression; no CaseFilterWarning |
| §1 Layout (LY) | 4 | 0 | 2 | 1 | 1 | 0 | 0 | Sidebar + "Showing N" line + figure; no quick-plot pills; card-width figure |
| §2 Axis menus (AX) | 14 | 2 | 7 | 0 | 4 | 1 | 0 | Log scale and Sort by Median ✅; Filter categories without search; 3 of 6 mutation groupings; clinical select by raw id |
| §3 Axis data (DT) | 19 | 9 | 2 | 1 | 6 | 1 | 0 | Mutation, Driver vs VUS, SV, CNA, continuous, clinical axes and titles as legacy; no VAF, CCF, clonality, SV type, gene sets |
| §4 Plot types (PT) | 6 | 3 | 0 | 1 | 2 | 0 | 0 | Scatter, vertical and horizontal boxes ✅; no waterfall; discrete pair a table only |
| §5 Utilities (UT) | 9 | 1 | 0 | 1 | 7 | 0 | 0 | Show Regression Line ✅; no search, connect, plot type, sort-by, horizontal bars |
| §6 Coloring (CL) | 10 | 0 | 4 | 3 | 3 | 0 | 0 | Fill + ring by a categorical axis on boxes and scatters; the portal's gene colouring only through the document; default none |
| §7 Quick plots (QP) | 12 | 0 | 0 | 0 | 12 | 0 | 0 | No "Examples" pills |
| §8 Scatter (SC) | 6 | 0 | 5 | 0 | 1 | 0 | 0 | Correlation and regression text as legacy, placed above / under the plot; no drag-select |
| §8 Box (BX) | 8 | 4 | 0 | 3 | 1 | 0 | 0 | Order, one-case groups, quartiles ✅; own styling, counts on labels, a box tooltip |
| §8 Waterfall (WF) | 7 | 0 | 0 | 0 | 7 | 0 | 0 | Refused |
| §8 Bar (BR) | 8 | 0 | 0 | 0 | 8 | 0 | 0 | No bar / stacked / 100% charts |
| §8 Table (TB) | 4 | 2 | 1 | 1 | 0 | 0 | 0 | Counts and order ✅; log shading, 0 cells empty |
| §9 Tooltips (TT) | 4 | 0 | 1 | 1 | 2 | 0 | 0 | Id, both values, layers, link; no mutation/CNA/SV sections |
| §10 Download (DL) | 2 | 0 | 0 | 0 | 2 | 0 | 0 | No SVG/PNG/PDF/Data on the Plots card |
| §11 Highlight (HL) | 5 | 0 | 0 | 3 | 1 | 0 | 1 | Highlight = point layers + show/hide chips; no search, no selection bar |
| §11 Messages (MS) | 7 | 0 | 4 | 0 | 1 | 0 | 2 | "Showing N of M samples with data on both axes" (numbers match); refusals in own words |
| §11 Limit values (LV) | 4 | 0 | 0 | 1 | 3 | 0 | 0 | ">8"-style values dropped as non-numeric |
| §13 Modes (MD) | 14 | 2 | 9 | 1 | 2 | 0 | 0 | Sample default + patient mode; multi-study pooled; no waterfall / limit-value modes |
| §15 Statistics (STM) | 22 | 10 | 7 | 0 | 5 | 0 | 0 | Pearson, Spearman, p, regression, box statistics, log, table counts as legacy; sort by median approximate without points |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **No default "Color samples by" gene**: legacy colours every point by the first gene's mutation type (fill) and CNA / SV (stroke) with a legend; cBioLab draws plain points unless a colour is picked, and the portal's gene colouring (`topMutationType` / `copyNumberSv`, #305) is reachable only through the document, not from the page's pickers | CL-1…4, CL-8, STM-14…16, MD-4 | (tracked) "The first queried gene by default …" |
| 2 | **Discrete × discrete is a table only**: no Bar / Stacked (legacy default) / 100% stacked, Sort By, Horizontal Bars | PT-6, UT-4…6, BR-1…8, STM-12 | (tracked) |
| 3 | **No quick-plot "Examples" pills** | QP-1…12, LY-1 | (tracked) |
| 4 | **No downloads** on the Plots card (SVG / PNG / PDF / Data `plot.txt`) | DL-1, DL-2 | (tracked) |
| 5 | **No Search Case(s) / Search Mutation(s), scatter drag-select, "Selected: N samples" → Study View, legend highlight** | UT-1, UT-2, UT-8, SC-5, HL-1…5 | (tracked) |
| 6 | **No waterfall / Ordered samples, no limit values ">8"** | PT-1/2, WF-*, AX-3, AX-5, LV-*, MD-8/9, STM-19/20 | (tracked) |
| 7 | **Mutation axis**: no VAF, CCF, Clonality; no SV Variant Type; nonstart → Other and 5'Flank → Promoter on the mutation-type axis (legacy Truncating, Other) | AX-2, DT-3, DT-6…8, DT-10, MD-12, STM-21 | (tracked) |
| 8 | **Clinical select by raw id** (`MUTATION_COUNT`), not display name and priority, no ⓘ | AX-2 | (tracked) |
| 9 | **Correlation and regression placement**: one line above the plot / a line under it, not the right gutter; regression dashed in the series colour, not red | SC-2, SC-3 | (tracked) |
| 10 | **Box styling**: counts in the tick labels, a box tooltip, blue box, own jitter | BX-2, BX-5, BX-6, STM-10 | not tracked: added |
| 11 | **Filter categories not searchable** | AX-9 | not tracked: added |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 data availability (h / v / both) | STM-3, MS-5 | 592 / 592 → "Showing 590 samples" | 592 / 592 → "Showing 590 of 594 samples" | ✅ |
| Q1 box n per CNA level | STM-1, BX-1 | 1 / 67 / 388 / 128 / 6 | 1 / 67 / 388 / 128 / 6 | ✅ |
| Q1 Shallow Del. q1 · med · q3 · whiskers | STM-8 | 774.00 · 1017.73 · 1169.69 · 180.48–1763.21 | 774.00 · 1017.73 · 1169.69 · 180.48–1763.21 | ✅ |
| Q1 Diploid (n=388) | STM-8 | 978.62 · 1217.02 · 1487.07 · 215.95–2249.74 | 978.62 · 1217.02 · 1487.07 · 215.95–2249.74 | ✅ |
| Q1 Gain (n=128) | STM-8 | 1166.20 · 1442.89 · 1854.65 · 244.40–2887.33 | 1166.20 · 1442.89 · 1854.65 · 244.40–2887.33 | ✅ |
| Q1 Amplification (n=6) | STM-8 | 2398.32 · 2668.88 · 2842.69 · 1762.30–3509.25 | 2398.32 · 2668.88 · 2842.69 · 1762.30–3509.25 | ✅ |
| Q1 Deep Del. (n=1) | BX-3 | no box (point only) | no box (point only) | ✅ |
| Q1-log Diploid | STM-8, STM-11 | log2: 9.936 · 10.250 · 10.539 | log2(v+1), the portal's rule (#254) | ✅ (not re-read) |
| Q2 n | STM-1 | 590 | 590 (same 590 sample ids) | ✅ |
| Q2 Pearson (raw) | STM-4/6 | 0.50806, p 4.86e-40 → "Pearson: 0.51 (p = 4.86e-40)" | 0.50806, p 4.856e-40 → same text | ✅ |
| Q2 Spearman | STM-5/6 | 0.33036, p 1.72e-16 → "0.33" | 0.33036, p 1.724e-16 | ✅ |
| Q2 Pearson, mRNA on log | STM-4/11 | 0.37742 (log2(x+1)), p 2.06e-21 | 0.37742 (log10(x+1)), p 2.063e-21 | ✅ (base-invariant) |
| Q3 n (h / v / both) | STM-3 | 534 / 583 → 523 | 534 / 583 → 523 (same ids, same values) | ✅ |
| Q3 Pearson | STM-4/6 | −0.33166, p 6.80e-15 → "−0.33 (p = 6.80e-15)" | −0.33166, p 6.799e-15 → same text | ✅ |
| Q3 Spearman | STM-5/6 | −0.34872, p 2.12e-16 → "−0.35 (p = 2.12e-16)" | −0.34872, p 2.119e-16 → same text | ✅ |
| Q4 n | STM-3 | 592 / 583 → 581 | 592 / 583 → 581 (same ids, same values) | ✅ |
| Q4 Pearson | STM-4/6 | −0.03816, p 0.359 → "−0.04 (p = 0.359)" | −0.03816, p 0.3585 → same text | ✅ |
| Q4 Spearman | STM-5/6 | −0.05509, p 0.185 → "−0.06 (p = 0.185)" | −0.05509, p 0.1848 → same text | ✅ |
| Q3 regression (toggle on) | STM-7 | slope 0, intercept 0.24, R² 0 (portal rule from the same points) | "y = 0x + 0.24   R² = 0" | ✅ |
| Q5 n per category | STM-1 | Colon 370 · Mucinous 58 · Rectal 155 (583) | 370 · 58 · 155 (583) | ✅ |
| Q5 Colon (n=370) | STM-8 | 0.1065 · 0.2268 · 0.3407 · 0–0.6920 | 0.1065 · 0.2268 · 0.3407 · 0–0.6920 | ✅ |
| Q5 Mucinous (n=58) | STM-8 | 0.0053 · 0.1140 · 0.2128 · 0–0.5240 | 0.0053 · 0.1140 · 0.2128 · 0–0.5240 | ✅ |
| Q5 Rectal (n=155) | STM-8 | 0.1909 · 0.2973 · 0.4110 · 0–0.7411 | 0.1909 · 0.2973 · 0.4110 · 0–0.7411 | ✅ |
| Q5 box order | BX-1 | Colon, Mucinous, Rectal (alphabetical) | Colon, Mucinous, Rectal | ✅ |
| Q6 table, 15 non-zero cells | STM-13, TB-3 | Diploid×No mutation 223, Diploid×Missense 126, Gain×Missense 64, … Diploid×Truncating 1 | identical; columns Deep Deletion … Amplification, rows Missense … Not profiled | ✅ |
| Q7 mutation-type n | DT-3, DT-18 | Missense 216 · Inframe 1 · Truncating 1 · No mutation 314 · Not profiled 60 | same counts, labels and order | ✅ |
| Q7 Missense median (log2 basis, n=216) | STM-8 | median of the two middle values | 10.3571 | ✅ (rule; not re-read) |
| Q8 multi-study h / v / both | STM-3, MD-2 | 1662 / 1674 / 1658 | 1662 / 1674 / 1658 | ✅ |
| Q8 per-level n | MD-2 | — (not read) | 3 / 181 / 1070 / 383 / 21; quartiles over the pooled values (#280) | ? legacy quartiles not read |

Data version: every n, every point set and every value compared is identical (Q2–Q4: same sample ids, values equal), so the warehouse holds the same data as cbioportal.org for this study. On 2026-11-18 cBioLab's n, counts and Pearson values are unchanged from the first audit, and the method differences it found (quartile rule, tie ranks, correlation and regression text) are gone.

---

## 4. Scorecard

### §0 Tab chrome

| ID | verdict | how | note |
|---|---|---|---|
| PLT-CH-1 | 🟡 | B | No per-tab OQL banner; the page's one note under the header names the tabs the OQL decides (oncoprint, Cancer Types Summary, Mutual Exclusivity, Pathways) and says the other gene tabs draw every alteration. Plots axes ignore OQL ✅ |
| PLT-CH-2 | N/A | C | No global driver/VUS/germline filter exists to warn about; plot axes read every called mutation (`plot.ts` `mutation_status != 'UNCALLED'`), as legacy Plots does |
| PLT-CH-3 | ❌ | C | No Show-only-profiled, no CaseFilterWarning |
| PLT-CH-4 | 🟡 | C | Same rule (`expressionAcross`, `results-layout.ts:190`); when it disallows, the Plots tab falls back to a clinical axis and the header lists "expression in Plots (expression data cannot be compared across the selected studies)" rather than an info alert inside the tab |
| PLT-CH-5 | N/A | C | No banners in the plot card at all |

### §1 Layout

| ID | verdict | how | note |
|---|---|---|---|
| PLT-LY-1 | ❌ | B | No "Examples:" pills |
| PLT-LY-2 | 🟡 | B | Horizontal block · "↑ Swap axes ↓" · Vertical block ✅; below them "Each point is a", "Draw each sample as", "Highlight" instead of Utilities; blocks are Data / Gene / (Plot mutations by) / Log scale |
| PLT-LY-3 | 🟡 | B | "Showing 590 of 594 samples with data on both axes" ✅ (no ⓘ; per-axis breakdown in the caption); colour / ring toolbar on boxes and point scatters, plus "SHOW" chips; no download, no selection bar; caption under the figure in place of footnotes |
| PLT-LY-4 | 🔶 | BC | Figure drawn at card width, height `clamp(240, 0.36·W, 420)` (`figure.ts:41`); no 650×650 scatter, no waterfall/bar sizes |

### §2 Axis menus

| ID | verdict | how | note |
|---|---|---|---|
| PLT-AX-1 | 🟡 | BC | One "Data" select merges data type and source: "Clinical attribute", then each profile by name grouped by type, then "OQL query" (`view-chrome.tsx:165-173`); no "Ordered samples", no "Gene Sets"; no 2-level type → source |
| PLT-AX-1a | 🟡 | BC | coadread default identical (CNA gistic KRAS × mRNA RSEM KRAS, log off). No mRNA: horizontal = mutation type of gene 1, vertical = FGA / MUTATION_COUNT (`results-layout.ts:191,216`), not legacy's first-attribute-against-itself |
| PLT-AX-1b | 🟡 | C | Changing the categorical axis's data type or source clears Filter categories, a new gene or entity keeps them, as legacy (`axis-edit.ts:29-32`, #318) ✅; the gene carries over to the new data rather than a per-type session history; no viewLimitValues; no colouring auto-choice (CL-3) |
| PLT-AX-1c | ❌ | C | No "Same gene" option |
| PLT-AX-2 | 🟡 | BC | Profiles by name ✅; the clinical select lists raw ids (`MUTATION_COUNT`, `view-chrome.tsx:205`), not display names by priority, though the axis title uses the display name; "Plot mutations by": mutation type / mutated vs not / driver vs VUS (no VAF, CCF, Clonality); no SV "by" select; no ⓘ description |
| PLT-AX-3 | ❌ | C | No waterfall |
| PLT-AX-4 | ✅ | BC | Offered on a numeric axis; with values below 0 shown unchecked and disabled (reason in its tooltip, the choice kept in the document) except an `rna_seq` non-z-score profile; on when an `rna_seq` mRNA profile is chosen; title " (log2(value + 1))" / " (log10)" (#254) |
| PLT-AX-5 | ❌ | C | No limit-value checkbox (limit values are dropped; LV) |
| PLT-AX-6 | 🟡 | BC | Free gene field (any gene, `QueryField`), not the queried genes; no "(Not profiled)" suffix; no localStorage fallback; default gene 1 ✅; several genes on a mutation axis become an OQL axis |
| PLT-AX-7 | ❌ | C | No gene sets (tracked: GSVA gene sets) |
| PLT-AX-8 | 🟡 | C | `EntityField` search per generic-assay profile; no "Same <type>", no gene-related ordering, no 100-option header |
| PLT-AX-9 | 🟡 | BC | "Filter categories" on a box plot: a checkbox list of every category, empty = all, cleared when the category axis's data changes, swapped with the axes (`plot-controls.tsx:249-275`) ✅; not searchable; kept in the document (invariant 9) |
| PLT-AX-10 | ✅ | BC | ☐ "Sort Categories by Median" on a box plot with > 1 category, ascending (`plot-controls.tsx:276-282`); the median it uses: STM-9 |
| PLT-AX-11 | 🐞 ok | BC | Swap exchanges the whole axis definitions (log, by and SV mode included), so the `structuralVariantCountBy` bug is not reproduced; Filter categories and Sort by Median stay with the categorical axis (`axis-edit.ts:35-37`, #318) |

### §3 Axis data

| ID | verdict | how | note |
|---|---|---|---|
| PLT-DT-1 | ✅ | BC | Sample attribute; numeric = finite parse (`finiteSql`); Q3/Q4 values identical to legacy |
| PLT-DT-2 | ✅ | BC | Patient value repeated on each sample (`plot.ts:300-304`); AGE (patient attr) 592 samples = legacy |
| PLT-DT-3 | 🟡 | BC | Q7 Missense 216 · Inframe 1 · Truncating 1 · No mutation 314 · Not profiled 60, in the portal's class order, labels as legacy ✅; but the axis classes by cBioLab's own rule (`MUT_CLASS`, `plot.ts:552-557`): Translation_Start_Site (nonstart) → Other (legacy Truncating), 5'Flank → Promoter (legacy Other) |
| PLT-DT-4 | ✅ | B | "Mutated" 218 / "No mutation" 314 / "Not profiled" 60 in that order; title "KRAS: Mutated vs Wild Type" |
| PLT-DT-5 | ✅ | B | "Plot mutations by: driver vs VUS": Driver 216 / VUS 2 / No mutation 314 / Not profiled 60, title "KRAS: Driver vs VUS Mutations"; drivers by the view's driver settings (counts not compared with legacy) |
| PLT-DT-6 | ❌ | C | No VAF axis |
| PLT-DT-7 | ❌ | C | No CCF |
| PLT-DT-8 | ❌ | C | No Clonality |
| PLT-DT-9 | ✅ | B | "No Structural Variants" 532 / "Not profiled for structural variants" 60, title "KRAS: Variant vs No Variant", as legacy |
| PLT-DT-10 | ❌ | C | No SV Variant Type |
| PLT-DT-11 | ✅ | BC | Five levels "Deep Deletion" … "Amplification" in level order, values identical (Q1, Q6) |
| PLT-DT-12 | ✅ | BC | Continuous CNA / mRNA: same 590 samples, same values (Q2) |
| PLT-DT-13 | ❌ | C | No gene sets (tracked) |
| PLT-DT-14 | 🔶 | C | ">8" values have no row in the numeric form (`generic-assay.ts:20-31`); counted as "no value" in the caption |
| PLT-DT-15 | 🟡 | C | GA categorical axis ✅; groups by count, no reserved order |
| PLT-DT-16 | ❌ | C | No Ordered samples |
| PLT-DT-17 | 🐞 ok | C | Every called mutation (no driver/somatic filter); germline VUS not dropped |
| PLT-DT-18 | ✅ | BC | Panel-aware `profiledCasesSql`; Not profiled 60 = legacy (Q6, Q7) |
| PLT-DT-19 | ✅ | B | Clinical display name ("Mutation Count", "Diagnosis Age"); "KRAS: Mutations", "KRAS: Mutated vs Wild Type", "KRAS: Driver vs VUS Mutations", "KRAS: Variant vs No Variant", "KRAS: Putative copy-number alterations from GISTIC"; " (log2(value + 1))" on a log axis |

### §4 Plot-type rules

| ID | verdict | how | note |
|---|---|---|---|
| PLT-PT-1 | ❌ | C | Waterfall refused (`federation.ts:1684`) |
| PLT-PT-2 | ❌ | C | Same |
| PLT-PT-3 | ✅ | B | number × number → scatter |
| PLT-PT-4 | ✅ | B | string × number → vertical boxes |
| PLT-PT-5 | ✅ | BC | number × string → horizontal boxes, categories down the side (`figure.ts:254-256`); FGA × Cancer Type Detailed gives the same three boxes as Q5 |
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
| PLT-UT-7 | ✅ | BC | ☐ "Show Regression Line" on a scatter, default off (`plot-controls.tsx:241-248`; the fit is dropped unless asked, `run.ts:772`) |
| PLT-UT-8 | ❌ | C | No search |
| PLT-UT-9 | 🔶 | B | No jitter control ✅, but "Draw each sample as Points / Density" adds a per-group density (violin) |

### §6 Color samples by

| ID | verdict | how | note |
|---|---|---|---|
| PLT-CL-1 | 🟡 | BC | On boxes and point scatters: "colour samples by FILL" + "RING", each none, a clinical attribute or a categorical profile (mutation, SV, discrete CNA, GA category); no "Genes" group colouring as the portal does (that exists only in the document, CL-8), no Cancer Study entry, no numeric attributes |
| PLT-CL-2 | 🔶 | B | Default none (legacy: first queried gene) |
| PLT-CL-3 | ❌ | C | No auto-choice |
| PLT-CL-4 | 🔶 | B | Two pickers (fill, ring) replace the Mutation Type / Structural Variant / Copy Number checkboxes |
| PLT-CL-5 | ❌ | C | No numeric colouring / Log Scale |
| PLT-CL-6 | 🟡 | B | None → no colouring ✅; clinical and genomic can combine (fill + ring) |
| PLT-CL-7 | ❌ | B | No footnotes |
| PLT-CL-8 | 🟡 | BC | The portal's gene colouring exists in the engine (#305): fill by top mutation class (Missense #008000, Not mutated #c4e5f5, "Not profiled for mutations" white), ring by copy number with SV over it (Q1: 313 / 215 / 60 / 1 / 1 and 388 / 128 / 67 / 6 / 1), but only through the document (`colorBy … by:"topMutationType"`): the page's pickers do not offer it and the default is none; no driver/VUS shades in it |
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
| PLT-SC-2 | 🟡 | BC | "Spearman: −0.35 (p = 2.12e-16)   ·   Pearson: −0.33 (p = 6.80e-15)" in the portal's order and formats (`figure.ts:157-159`), on one line above the plot, not in the right gutter |
| PLT-SC-3 | 🟡 | BC | With the toggle: the fit and "y = 0x + 0.24   R² = 0" under the plot with a swatch (Q3, as legacy); dashed 1.5 px in the series colour, not solid red 2 px |
| PLT-SC-4 | 🟡 | C | One radius 2.8 for every point; hovered point redrawn on top; no 4/6/8 sizes |
| PLT-SC-5 | ❌ | B | No drag-select on the scatter |
| PLT-SC-6 | 🟡 | B | Colour and ring legends when a colour is chosen, plus the point-layer legend; position and order not the portal's; no gene-symbol title |

### §8 Box

| ID | verdict | how | note |
|---|---|---|---|
| PLT-BX-1 | ✅ | BC | One box per category in the portal's order (CNA levels; Q5 Colon, Mucinous, Rectal alphabetical; Q7 Missense … No mutation, Not profiled), filtered by AX-9, re-sorted by AX-10 |
| PLT-BX-2 | 🔶 | B | Blue `LAYER_BASE` box (fill 0.1), 2-px median, muted whisker without caps; half-width ≤24 px; jitter ±0.9 × half |
| PLT-BX-3 | ✅ | B | A group of one case draws no box, only its point (Q1 Deep Deletion; Q7 Inframe, Truncating), said in the caption |
| PLT-BX-4 | ✅ | BC | Log applied before the box; quartiles by the portal's rule (STM-8) |
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
| PLT-TB-3 | ✅ | BC | Rows and columns in category order, the first row at the top (Q6: Deep Deletion … Amplification across, Missense … Not profiled down) (`run.ts:147`) |
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
| PLT-MD-2 | 🟡 | C | Counts identical (Q8: 1662 / 1674 / 1658); sources merged by profile suffix ✅; box quartiles over the pooled values (#280); no mRNA vs Study pill, no study in the tooltip, no study counts |
| PLT-MD-3 | 🟡 | C | No Connect samples; patient unit instead; "# Samples per Patient" if the study has it as an attribute |
| PLT-MD-4 | 🟡 | BC | Driver vs VUS axis ✅ and "mutation types as Driver / VUS" when the view holds driver settings; the portal's split mutation legend only through the document's gene colouring (CL-8) |
| PLT-MD-5 | 🟡 | C | No filter applies ✅; no Show only profiled |
| PLT-MD-6 | 🟡 | BC | "Not profiled" category per sample/gene ✅ (60, Q7); no "(Not profiled)" gene suffix |
| PLT-MD-7 | 🟡 | C | Profile absent → not in the Data list ✅; no colouring checkboxes to drop |
| PLT-MD-8 | ❌ | C | No limit-value mode |
| PLT-MD-9 | ❌ | C | No waterfall |
| PLT-MD-10 | 🟡 | B | Table only; no colour toolbar ✅, no search ✅; no Plot Type / Sort By / Horizontal Bars |
| PLT-MD-11 | ✅ | C | Negatives: log scale off, axis drawn linear and the caption says so; `rna_seq` (not z-score) keeps it, negatives drawn at 0 and counted (#254) |
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
| PLT-STM-4 | ✅ | BC | Pearson identical to 5 dp in all four scatters, log space included (Q2 0.50806, Q2-log 0.37742, Q3 −0.33166, Q4 −0.03816), shown `toFixed(2)`; no limit values to exclude (LV) |
| PLT-STM-5 | ✅ | BC | Average ranks for ties now: Q2 0.33036, Q3 −0.34872, Q4 −0.05509, identical to legacy (first audit: −0.05476 etc.) |
| PLT-STM-6 | ✅ | BC | Same t-test on r rounded to 5 dp (#285): p Q2 1.72e-16, Q3 2.12e-16, Q4 0.185 (Spearman), 4.86e-40 / 6.80e-15 / 0.359 (Pearson) = legacy; shown `toConditionalPrecision(p, 3, 0.01)` (`portalP`) |
| PLT-STM-7 | ✅ | BC | OLS in plotted space, slope and intercept rounded to 2 dp from the rounded slope, R² from them (Q3: slope 0, intercept 0.24, R² 0); a negative intercept prints "− 1.2", not the portal's "+ -1.2" |
| PLT-STM-8 | ✅ | BC | Nearest-rank quartiles, mean-of-middles median, fence whiskers as legacy: Q1 Shallow 774.00 · 1017.73 · 1169.69 · 180.48–1763.21, Diploid 978.62 · 1217.02 · 1487.07 · 215.95–2249.74, Gain, Amplification 2668.88; Q5 0.2268 / 0.1140 / Rectal q3 0.4110 — all = legacy |
| PLT-STM-9 | 🟡 | C | Median of the raw values (a log axis's converted back) from the drawn points; without points, each box's own median, the order then said to be approximate (`lib/views/plot/run.ts:300-318`) (#318) |
| PLT-STM-10 | 🟡 | C | Deterministic per sample (FNV-1a hash → sin, `plot-draw.ts:14`) ✅; different hash, ±0.9 × half-width |
| PLT-STM-11 | ✅ | BC | log2(max(v,0)+1), generic assay log10(v) with 0 → 0, before Pearson/box/regression; Q1-log Diploid quartiles = portal (#254) |
| PLT-STM-12 | ❌ | C | No bar counts |
| PLT-STM-13 | ✅ | BC | Q6: all 15 cells identical |
| PLT-STM-14 | 🟡 | C | The document's `topMutationType` colour picks the class by the portal's priority (fusion > promoter > splice > trunc > inframe > missense > other); the page's mutation colour uses the axis value, "Multiple" for two classes |
| PLT-STM-15 | 🟡 | C | Discrete CNA value per sample ✅ (one call); no waterfall maxBy |
| PLT-STM-16 | 🟡 | C | The document's `copyNumberSv` ring: SV over CNA, as legacy; the page's pickers keep CNA and SV as separate choices |
| PLT-STM-17 | ✅ | BC | Panel-aware profiled per sample and gene (`profiledCasesSql`); Not profiled counts = legacy |
| PLT-STM-18 | ❌ | C | No numeric colour scale |
| PLT-STM-19 | ❌ | C | No limit values |
| PLT-STM-20 | ❌ | C | No waterfall |
| PLT-STM-21 | ❌ | C | No VAF / CCF / clonality axes |
| PLT-STM-22 | 🟡 | BC | Tooltip 2 decimals ✅, correlations `toFixed(2)` ✅, regression 2 dp ✅; no downloads, no bar percentages |

---

## 5. cBioLab bugs (wrong on its own terms)

- ~~**Spearman is not Spearman on tied data**~~ — fixed (#183): average ranks; Q2–Q4 equal legacy.
- ~~**Caption calls the whiskers "Tukey"**~~ — fixed: the caption now says "whiskers end at 1.5 × IQR past the box, or at the extreme value when none lies beyond (the portal's rule)".
- ~~**Box for n = 1**~~ — fixed (#226): no box, only the point.
- ~~**Swap on a box plot whose categories are on the vertical axis**~~ — fixed (#226): horizontal boxes.
- **The gene colouring's two keys carry the same title**: `colorBy … topMutationType` with `ringBy … copyNumberSv` returns `colorLabel` and `ringLabel` both "KRAS: Mutated vs Wild Type", though the ring is copy number and SV (Q1, `/api/analysis`).

## 6. Not verified

- Legacy multi-study (Q8) per-category quartiles (counts only, from the spec's tooltip figures). cBioLab's are now over the pooled values (Amplification n 21, median 2722.74).
- Driver vs VUS counts (DT-5) against legacy.
- Generic-assay entity search limits and limit-value data (no public ">x" entity; legacy LV is `[C]` in the spec too).
- Box hover tooltip in the browser: the pointer lands on a point over the box; `boxTip` is code-verified.
