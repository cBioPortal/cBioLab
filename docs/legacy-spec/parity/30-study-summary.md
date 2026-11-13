# Parity audit — Study View › Summary charts (spec `30-study-summary.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org v7.2.3 (Playwright + its REST API called from the portal's origin, same day)
- **Study View equivalent in cBioLab: Explore** — `/lab?tab=explore&study=<id[,id…]>`. The homepage's "Explore selected studies" and each study row's "explore" icon open it (`app/_home/query-flow.tsx:20`). There is no `/portal/study` route. Explore is one page of facet cards: no Summary/Clinical Data/CN Segments/Plots tabs.
- **Code paths (cBioLab):** `app/lab/explore-sections.tsx` (picker, filter bar, Add chart dialog, clinical/gene/assay facets, gene tables, data types, case lists, events), `app/lab/explore-charts.tsx` (survival, mutation count vs FGA density), `app/lab/use-explore-state.ts` (draft, default charts, clause merging, URL), `app/lab/use-explore.ts`, `app/lab/page.tsx:506-581` (layout), `lib/explore.ts` (all counts), `lib/data-binner.ts` (DataBinner port), `app/api/explore/route.ts`, `/api/analysis` (survival, plot views)

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 unfiltered | `/study/summary?id=coadread_tcga_pan_can_atlas_2018` + API `studyViewFilter {studyIds}` | `/lab?tab=explore&study=coadread_tcga_pan_can_atlas_2018`; `POST /api/explore {study}` |
| Q2 one filter (Sex = Female) | `…&filterAttributeId=SEX&filterValues=Female`; API `clinicalDataFilters [{SEX, Female}]` | Add chart › Sex, click "Female"; `POST /api/explore {draft:{all:[{kind:"clinical",attribute:"SEX",values:["Female"]}]}}` |
| Q3 numeric filter | API AGE (50, 60] | draft `AGE range {gt:50,lte:60}` |
| Q4 multi-study | `id=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018` | `study=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018` |

Legacy numbers from `/api/clinical-data-counts`, `/api/clinical-data-bin-counts?dataBinMethod=STATIC` (one attribute per request, as the page asks), `/api/mutated-genes`, `/api/cna-genes`, `/api/structuralvariant-genes`, `/api/molecular-profile-sample-counts`, `/api/sample-lists-counts`, `/api/clinical-event-type-counts`, `/api/mutation-data-counts`, `/api/genomic-data-counts`, `/api/clinical-data-density-plot`; legacy KM recomputed (standard KM) from `/api/clinical-data` OS_MONTHS/OS_STATUS of the selected patients. cBioLab numbers from `/api/explore` and `/api/analysis` (the same calls the page makes) plus the rendered page. Scripts and screenshots: (local scratch, not committed) (`leg-api*.js/json`, `lab-api.js`, `lab-all.json`, `lab-ui*.js`, `leg-ui.js`, `out/lab-full.png`, `out/lab-female2.png`, `out/leg-unf.png`, `out/leg-fem.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 19 |
| 🟡 partial | 38 |
| 🔶 different | 35 |
| ❌ missing | 38 |
| 🐞 ok | 3 |
| 🐞 copied | 0 |
| N/A | 2 |
| ? | 0 |
| **Total IDs** | **135** |

**Overall: 17.8 %** (✅ 19 + 🐞ok 3 + N/A 2 = 24 of 135). Counting 🟡 as half: 31.9 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §1 Layout (LY) | 11 | 0 | 2 | 5 | 4 | 0 | 0 | Fixed CSS grid of cards; no drag/resize; default chart set chosen from raw DB priority, so different charts show |
| §2 Header (HD) | 7 | 0 | 3 | 1 | 3 | 0 | 0 | Title + "…" menu with Compare/Analyze only; no reset, delete, info overlay, type switch |
| §3 Pie (PIE) | 9 | 0 | 2 | 6 | 1 | 0 | 0 | Pie only for 9 allowlisted attributes; no NA slice; no grey-out; Okabe-Ito palette |
| §4 Clinical table (TBL) | 7 | 0 | 3 | 2 | 2 | 0 | 0 | Value list with count + %; % excludes NA; staged checkboxes + Apply |
| §5 Bar (BAR) | 9 | 1 | 3 | 2 | 2 | 1 | 0 | DataBinner port gives identical bins unfiltered; dynamic not STATIC; click, not drag; two bars AND to 0 |
| §6 Gene tables (GT) | 11 | 2 | 4 | 2 | 3 | 0 | 0 | Counts and Freq identical; 500-row cap, no sort, no OncoKB/q-value, Union only |
| §7 Other tables (OT) | 7 | 1 | 2 | 0 | 4 | 0 | 0 | Data types / case lists / timeline events counts match; no treatment, GA-frequency, mutation-type, VA tables |
| §8 Density scatter (SC) | 8 | 1 | 2 | 3 | 1 | 1 | 0 | n and Spearman match; axes swapped, log x fixed, no correlation text |
| §9 Violin (VI) | 8 | 0 | 0 | 0 | 8 | 0 | 0 | No violin/box tables |
| §10 Survival (KM) | 6 | 1 | 1 | 2 | 1 | 1 | 0 | One OS/PFS/… chart with a picker; n / events / median match |
| §11 Added charts (GS) | 7 | 1 | 3 | 1 | 2 | 0 | 0 | Gene mutation chart matches; CNA lacks GAIN/HETLOSS; GA one entity at a time |
| §12 Special (SP) | 4 | 1 | 2 | 1 | 0 | 0 | 0 | Studies breakdown ≈ Cancer Studies (patients, not samples) |
| §13 Downloads (DL) | 3 | 0 | 0 | 0 | 3 | 0 | 0 | No chart download |
| §14 Filters (FL) | 3 | 1 | 1 | 0 | 0 | 0 | 1 | AND across charts ✅; filters not in URL as legacy |
| §15 Modes (MD) | 16 | 4 | 4 | 6 | 1 | 0 | 1 | Single/multi study fine; own-filter exclusion only for categorical |
| §17 Statistics (STM) | 19 | 6 | 6 | 4 | 3 | 0 | 0 | Every count matches; Freq denominators exclude NA; bins dynamic; Pearson not shown |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Different default charts.** DB priority 1 is taken as-is (legacy replaces it from its config table), then ranked by coverage: Q1 shows Cancer Type, Sample Type, Somatic Status, # Samples per Patient (one value each), Form completion date, "Last Alive Less Initial…" (all 0), Tissue Source Site…; Sex, Race, Ethnicity, Subtype, T/M stage, Aneuploidy, Days to Birth, DFS/DSS/PFS KM are hidden. Legacy 29 charts vs cBioLab 20 clinical + 9 fixed cards; 8 of legacy's 17 clinical charts overlap | LY-7, LY-8, MD-1 | not tracked (PORTAL-PARITY has no Study View item at all) |
| 2 | **Categorical % leaves NA out.** NA is never a slice/row, and Freq = count ÷ Σ non-NA values: Sex Male 52.7 % (legacy 52.5 %); Race White 78.7 % of 362 (legacy 48.0 % of 594, NA 232) | PIE-9, TBL-1, STM-1, STM-3, MD-9 | not tracked |
| 3 | **Numeric bins are dynamic, and a numeric chart is not freed of its own filter.** Edges recomputed on the filtered cohort (Q2: MSI MANTIS 0.02-wide bars vs legacy's stable 0.01; MSIsensor ">2.8" vs ">2.2"; TBL ">170" vs ">160"); Q3 AGE (50,60] collapses the AGE chart to ten one-value bars 51…60 (legacy keeps all bins, own filter excluded) | BAR-1, STM-2, STM-8, MD-6 | not tracked |
| 4 | **Clicking a second bar of one histogram ANDs the ranges → 0 patients** (AGE (50,60] + (70,75] = 0); categorical values OR correctly | BAR-5 (cBioLab bug) | not tracked |
| 5 | **No bar-chart menu**: no Custom Bins / Quartiles / Median / Generate, no Log Scale toggle, no Show NA; no default MSI custom bins (legacy MANTIS 468/22/67, MSIsensor 496/10/78) | BAR-1, BAR-6…8, HD-5 | fixed (PR #203) |
| 6 | **Gene tables**: 500-row cap ("500 of 18,275 genes"), no column sort, title lacks "(N profiled samples)", no OncoKB cancer-gene icon/filter, no MutSig/GISTIC q-value, no gene-panel tooltip, no query-queue on gene click, Union only, SV default sort by # altered not # SV | GT-2, GT-3, GT-5…GT-9 | not tracked |
| 7 | **No chart downloads** (Summary/Full data, SVG, PDF, gene-table TSV) | DL-*, HD-5 | Data-governance switch tracked; downloads themselves not |
| 8 | **Missing chart kinds**: treatment tables, GA frequency table (arm-level CNA shown by default in legacy), mutation-type counts, variant annotations, X-vs-Y density/violin, gene-specific violin, continuous gene bar | OT-3…6, VI-*, GS-4, SC-1 | not tracked |
| 9 | **Pie behaviour**: pie only for 9 allowlisted ids (else a list, even for 2 values); legend beside pie instead of slice labels; unselected slices not greyed; clicking a selected value does not remove it (turns "=" into "∈ {…}"); Okabe-Ito colours | LY-9, PIE-3, PIE-6…8 | not tracked |
| 10 | **Survival**: one chart with an endpoint picker instead of one KM tile per endpoint; numbers match | KM-1 | not tracked |
| 11 | **Density**: x = log10(MC+1), y = FGA (legacy x = FGA, y = MC, linear); 48×32 grid (legacy 44×38); no Pearson/Spearman text, no Swap Axes / Log menu, tooltip "n samples" only | SC-2…5, STM-15 | not tracked |
| 12 | **Chart chrome**: no drag, resize, ✕ delete (hide via Add chart), ↶ reset (remove pill instead), ⓘ overlay (title tooltip only) | LY-1…6, HD-2…4 | not tracked |
| 13 | **Gene CNA chart**: Amplified / Deleted / Diploid / Not profiled; GAIN and HETLOSS fold into Diploid (KRAS: 585 vs legacy 390 + 128 + 67) | GS-3 | (tracked) OQL coverage: "only high-level ±2 calls are loaded" |
| 14 | **Empty selection**: facets still drawn (filtered attribute only), "0 patients match"; no "filtered out all the samples" message | LY-11, MD-14 | not tracked |
| 15 | **Case lists** limited to 10 (`LIMIT 10 BY s`): coad, read, protein_quantification, methylation_hm450 missing; counted in patients, not samples | OT-2 | not tracked |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 selected patients / samples | STM-1 | 594 / 594 | 594 / 594 | ✅ |
| Q2 selected | STM-1 | 280 / 280 | 280 / 280 ("280 patients match") | ✅ |
| Q3 AGE (50,60] selected | STM-9 | 106 (spec) | 106 | ✅ |
| Q1 Sex | STM-1, STM-3 | Male 312 (52.5 %), Female 280 (47.1 %), NA 2 (0.3 %) | Male 312 (52.7 %), Female 280 (47.3 %), no NA | 🔶 counts ✅, NA row and denominator differ |
| Q2 Sex (own filter excluded) | STM-2 | 312 / 280 / NA 2 | 312 / 280, "not narrowed by its own filter" | ✅ (NA aside) |
| Q1 Overall Survival Status | STM-1 | LIVING 471, DECEASED 120, NA 3 | 471 / 120 | 🟡 NA dropped |
| Q2 OS Status | STM-1 | 224 / 56 | 224 / 56 | ✅ |
| Q1 Cancer Type Detailed | STM-1, STM-3 | 378 / 155 / 61 (63.6 / 26.1 / 10.3 %) | same | ✅ |
| Q1 / Q2 Tumor Type | STM-1 | 378/136/61/13/6 · 174/66/32/5/3 | same | ✅ |
| Q1 Race | STM-3 | White 285 = 48.0 % (Σ 594 incl. NA 232) | White 285 = 78.7 % (Σ 362) | 🔶 denominator |
| Q1 / Q2 AJCC stage, T/M stage, ancestry, tissue site | STM-1 | e.g. STAGE IIA 171, T3 401 / 194, EUR 506 / 239 | same | ✅ (NA rows dropped) |
| Q1 AGE bins | STM-5 | ≤35 8, 35-40 11 … 85-90 23, NA 2 | identical 12 bins, NA 2 | ✅ |
| Q2 AGE bins | STM-8 | ≤35 3 … 85-90 16 | identical | ✅ |
| Q1 / Q2 Mutation Count bins | STM-5 | ≤20 33 … >240 85, NA 60 / ≤20 14 … >240 42, NA 25 | identical | ✅ |
| Q1 / Q2 FGA bins | STM-5 | ≤0.05 87 … >0.7 8, NA 11 / … NA 5 | identical | ✅ |
| Q1 / Q2 OS_MONTHS, Aneuploidy | STM-5 | ≤5 71 … >70 34 / ≤5 41 … >70 22; Aneuploidy ≤2 97 … | identical | ✅ |
| Q1 Days to Birth (log) | STM-6 | −10⁵…−31622: 21, −31622…−10⁴: 569 | same | ✅ |
| Q1 MSI MANTIS | BAR-1, STM-4 | custom [0.4,0.6]: ≤0.4 468, 0.4-0.6 22, >0.6 67, NA 37 | ≤0.4 468, 0.4-0.6 22, >0.6 67 (initial custom bins); an empty Custom box gives legacy's default 19 bars | ✅ |
| Q1 MSIsensor | BAR-1 | custom [4,10]: 496 / 10 / 78 | 496 / 10 / 78 | ✅ |
| Q2 MSI MANTIS | STM-8 | STATIC 0.01 bars: ≤0.26 7, 0.26-0.27 14 … >0.43 49 | re-binned 0.02: ≤0.26 7, 0.26-0.28 24 … >0.46 44 | 🔶 dynamic |
| Q2 MSIsensor | STM-8 | … 2-2.2 2, >2.2 51 | … 2.6-2.8 0, >2.8 49 | 🔶 dynamic |
| Q2 TBL score | STM-8 | … 150-160 1, >160 9 | … 160-170 1, >170 8 | 🔶 dynamic |
| Q3 AGE chart under its own filter | STM-2 | all 12 bins, own filter excluded | ten one-value bars 51…60 (106) | 🔶 |
| Q1 Mutated: APC / TP53 / KRAS | STM-13 | 639 · 387 · 534 → 72.5 % / 332 · 314 → 58.8 % / 223 · 218 → 40.8 % | identical | ✅ |
| Q2 Mutated: APC / KRAS | STM-13 | 295 · 181 · 255 → 71.0 % / 102 · 100 → 39.2 % | identical | ✅ |
| Mutated genes in table | GT-1 | 18,275 (Q2 16,678), all listed | "500 of 18,275" (Q2 "of 16,678") | 🔶 cap |
| Q1 / Q2 CNA: RBFOX1 HOMDEL | STM-13 | 129 / 592 → 21.8 % · 59 / 279 → 21.1 % | identical | ✅ |
| Q1 SV: DPEP1 / TCF25 / TCF7L2 | STM-13 | 7·7·534 1.3 % / 7·7 / 5·4 0.7 %; 810 genes | identical; 810 genes | ✅ |
| Q2 SV genes | STM-13 | 361 | 361 | ✅ |
| Data types (16 profiles) Q1 / Q2 | STM-14 | mutations 534 / 255, gistic 592 / 279, armlevel_cna 594 / 280, rppa 464 / 225 … | identical for all 16 | ✅ |
| Case lists Q1 | STM-14 | 14 lists (all 594, coad 439, read 155, sv 534, … protein_quantification 84, methylation_hm450 379) | top 10 only; shown values identical | 🟡 |
| Timeline event types Q1 / Q2 | STM-14 | STATUS 592, Sample Acquisition 588, Treatment 214 / 280, 279, 100 | identical | ✅ |
| Treatment per patient (total) | OT-6 | 214 patients, per-drug rows | none (only "has Treatment" 214) | ❌ |
| KRAS mutation chart Q1 / Q2 | GS-1 | Mutated 218, Not mutated 316, Not profiled 60 / 100, 155, 25 | identical | ✅ |
| KRAS CNA chart Q1 | GS-3 | AMP 6, HOMDEL 1, GAIN 128, HETLOSS 67, Diploid 390, NA 2 | Amplified 6, Deleted 1, Diploid 585, Not profiled 2 | 🔶 |
| OS KM Q1 | STM-18 | n 590, events 120, median 81.37 mo | n 590, 120 events, median 81.4 mo | ✅ |
| OS KM Q2 | STM-18 | n 280, events 56, median not reached | same | ✅ |
| Density n Q1 / Q2 | STM-15 | 523 / 250 | 523 / 250 ("523 of 594 samples have both") | ✅ |
| Spearman Q1 / Q2 | STM-15 | −0.3487 / −0.3332 | −0.3487 / −0.3331 (computed, not displayed) | 🟡 value ✅, not shown |
| Pearson Q1 | STM-15 | −0.3317 (linear MC) | −0.4080 on log10(MC+1); not displayed | 🔶 |
| Density grid | STM-15 | 44 × 38, 77 non-empty bins | 48 × 32 | 🔶 |
| Q4 selected | STM-1 | 1,678 / 1,678 | 1,678 / 1,678 "(overlap not deduplicated)" | ✅ |
| Q4 Mutated TP53 / KRAS | STM-13 | 661 / 1,600 (41.3 %), 224 | 661 / 1,600 → 41.3 %, 224 | ✅ |

Data version: every count matches exactly, so the warehouse holds the same coadread/brca data as cbioportal.org. Differences are display rules (NA, denominators), bin method (DYNAMIC vs STATIC, default custom bins) and the default chart choice.

---

## 4. Scorecard

### §1 Grid and layout

| ID | verdict | how | note |
|---|---|---|---|
| STS-LY-1 | 🔶 | B | CSS grid `.facetgrid`, cards ~301 px wide, 5 columns at 1600 px; heights follow content; not react-grid-layout |
| STS-LY-2 | 🔶 | B | Fixed shapes: clinical cards one cell; gene tables, survival, density, data types wider; no w×h model |
| STS-LY-3 | 🟡 | BC | Fixed order: survival, density, clinical facets (priority, then coverage, then id; `lib/explore.ts:289-292`), gene facets, assay facets, studies, data types, gene tables, events, case lists (`page.tsx:561-581`); no findSpot |
| STS-LY-4 | ❌ | B | No drag |
| STS-LY-5 | ❌ | B | No resize |
| STS-LY-6 | ❌ | C | No highlight of a newly added chart |
| STS-LY-7 | 🔶 | BC | Top `DEFAULT_CLINICAL_CHARTS` = 20 with priority > 0 (`use-explore-state.ts:366-371`) ✅, drafted attributes always shown ✅; no `shouldShowChart` (single-value Cancer Type, Sample Type, Somatic Status, # Samples per Patient, all-zero DAYS_TO_INITIAL… shown); Sex/Race/Ethnicity/Subtype hidden on Q1 |
| STS-LY-8 | 🔶 | C | DB priority used raw (`explore.ts:283`); no config table, no "1 → config" replacement; priority < 0 not dropped specially |
| STS-LY-9 | 🔶 | BC | Pie only for `PIE_ATTRIBUTES` (SEX, GENDER, *_STATUS, SAMPLE_TYPE, SOMATIC_STATUS; `explore-sections.tsx:57`), every other STRING a list; NUMBER → histogram ✅ |
| STS-LY-10 | 🟡 | B | Skeleton grid while building, "updating…" over survival/density, busy class on the grid; no progress list, no per-chart error text beyond the API error |
| STS-LY-11 | ❌ | BC | 0 samples: facets still drawn, "0 patients match"; no message; no invalid-sample alert; no saved-layout banner |

### §2 Chart header

| ID | verdict | how | note |
|---|---|---|---|
| STS-HD-1 | 🟡 | B | displayName + "· sample-level · N samples" / "· N patients" (+ "not narrowed by its own filter"); gene tables lack "(N profiled samples)" |
| STS-HD-2 | 🔶 | B | "…" menu button always visible, not hover-only |
| STS-HD-3 | ❌ | B | No ⓘ, ↶ reset, ✕ delete buttons; only the "…" menu (remove a filter via its pill, hide a chart via Add chart) |
| STS-HD-4 | 🟡 | B | Title `data-tip` = "ID — description"; no survival unit lines |
| STS-HD-5 | 🟡 | B | Numeric charts: Log Scale (when offered), Compare / Analyze groups, Custom Bins…, Show NA, in the portal's order; no Swap Axes, Show Table/Pie or Download |
| STS-HD-6 | ❌ | C | No pie ↔ table switch (shape fixed by allowlist) |
| STS-HD-7 | 🟡 | BC | Compare → new tab `/portal/comparison` with one group per value, top 20 by count ✅ (`explore-sections.tsx:621-638`); bar: Quartiles / Median / Current bins ✅ (single study only for quartiles); checked rows restrict the groups (legacy ignores the selection); extra "Analyze groups" target |

### §3 Pie chart

| ID | verdict | how | note |
|---|---|---|---|
| STS-PIE-1 | 🔶 | BC | Values ordered by `naturalOrder` (ordinal-aware), not count desc + NA last; no NA |
| STS-PIE-2 | 🔶 | B | 72-unit SVG pie with an always-visible legend (swatch, value, count) beside it |
| STS-PIE-3 | ❌ | B | No slice labels |
| STS-PIE-4 | 🟡 | B | Slice tip "Female — 280 (47.3%)" (`data-tip`, not `<title>`) |
| STS-PIE-5 | 🟡 | B | No hover table; legend gives value + count; no %, no Select all/Compare in tooltip |
| STS-PIE-6 | 🔶 | B | Click slice or legend adds the value (OR within attribute ✅); a second click on a selected value does not remove it — clause becomes `SEX ∈ {Female}` |
| STS-PIE-7 | 🔶 | B | Selected slice gets class `on`; unselected slices keep their colour (no #D3D3D3 grey); counts stay (own filter excluded ✅) |
| STS-PIE-8 | 🔶 | BC | `CAT_COLORS` Okabe-Ito by position (Male #0072B2, Female #E69F00); no reserved-value colours, no pinning |
| STS-PIE-9 | 🔶 | B | No NA slice (Sex NA 2, OS Status NA 3 dropped); NA not selectable from the pie |

### §4 Clinical table

| ID | verdict | how | note |
|---|---|---|---|
| STS-TBL-1 | 🔶 | B | Value list: checkbox, value, bar, count, % ; no header row, no swatch; % excludes NA (Race White 78.7 % vs 48.0 %) |
| STS-TBL-2 | 🟡 | BC | Count order (ordinal attributes in natural order); selected rows marked, not pinned |
| STS-TBL-3 | ❌ | B | No search box under a list |
| STS-TBL-4 | 🟡 | B | Checkboxes stage; [Apply filter] writes one OR clause (`ValueList`) |
| STS-TBL-5 | ❌ | B | No Select all / Deselect all ("Clear" of staged picks only) |
| STS-TBL-6 | 🟡 | B | Compare via "…" menu: checked rows → groups, none checked → top 20 values; one checked → disabled "Check another row" |
| STS-TBL-7 | 🔶 | B | Rows ~20 px; list scrolls after 9 rows with "N values · scroll for more" |

### §5 Bar chart

| ID | verdict | how | note |
|---|---|---|---|
| STS-BAR-1 | 🟡 | BC | Clinical bins from `lib/data-binner.ts` (DataBinner port, STATIC); the MSI scores' initial custom bins ✅; GA bars use `numericBinEdges`, not DataBinner |
| STS-BAR-2 | 🟡 | B | Numeric bins then category bins ✅; HTML bars, NA as a right-hand "NA n" note; no y axis |
| STS-BAR-3 | 🟡 | B | Tick = bin start ("≤35 40 50 …", thinned to fit); no trailing end tick, no 10^n superscripts |
| STS-BAR-4 | 🐞 ok | B | Tip "35–40 · 11 patients — click to filter": unit follows the attribute's level (legacy bug says "samples"); range "35–40" not "(35, 40]" |
| STS-BAR-5 | 🔶 | BC | Click one bar adds a range clause; no drag; bars not greyed. **Bug:** a second bar of the same attribute is ANDed (`use-explore-state.ts:471`), AGE (50,60] + (70,75] → 0 patients |
| STS-BAR-6 | ✅ | B | Show NA [off]: off the "NA n" note, on an NA bar last (clicking it filters to NA); the y-max takes it in only when drawn; kept per chart by the browser |
| STS-BAR-7 | ✅ | C | Log Scale [checked] offered when the bars look logarithmic or it is off (`looksLogarithmic`); unchecking gives linear bars (Days to Birth ≤-32000 … >-12000, = the portal's). It does not clear the chart's filter (ours are ranges, valid on any bars) |
| STS-BAR-8 | ✅ | C | Custom Bins dialog: Quartiles / Median split / Generate bins (size, min value) / Custom bins [default], the box starting from the bars' edges (0 kept, unlike legacy); a non-number refused by name. Disabled, saying why, on a chart of ≤10 values (legacy shows it and ignores it) |
| STS-BAR-9 | ✅ | BC | "Compare groups ▸ Quartiles / Median / Current bins" (`explore-sections.tsx:640-652`) |

### §6 Gene tables

| ID | verdict | how | note |
|---|---|---|---|
| STS-GT-1 | 🟡 | B | Mutated, CNA, SV tables per alteration type ✅; no SV-pair table; 500-row cap |
| STS-GT-2 | ❌ | B | Titles "MUTATED GENES" etc. without "(N profiled samples)" |
| STS-GT-3 | 🔶 | B | Columns ✅ (Gene · # Mut · # · Freq; Gene · Cytoband · CNA · # · Freq; Gene · # SV · # · Freq); no column sort; order = # altered desc, gene asc (SV legacy # SV desc) |
| STS-GT-4 | 🟡 | B | No header tooltips; cell tips explain (`"639 events across 387 samples"`, off-panel note) |
| STS-GT-5 | 🟡 | B | # Mut/# SV = events ✅, # = altered ✅, Freq ✅; CNA AMP/HOMDEL tag ✅; Freq tip "387 altered of 534 samples profiled for APC — …" but no "Gene panels:" list/modal |
| STS-GT-6 | ❌ | B | No gene-symbol query queue, no OncoKB cancer-gene tooltip, no q-value icon |
| STS-GT-7 | ❌ | C | No OncoKB cancer-gene filter |
| STS-GT-8 | 🔶 | B | "Alterations: all / OncoKB drivers only" page-level select instead of the alteration-filter indicator |
| STS-GT-9 | 🟡 | B | Check rows → [Apply filter] = one OQL clause (Union only, no Intersection, no ∪/∩ choice); applied rows not pinned; compare via "…" ("Compare checked groups") |
| STS-GT-10 | ✅ | B | "find gene" filters the loaded rows by symbol (substring); legacy Freq-search bug not reproduced |
| STS-GT-11 | ✅ | B | Own gene filter included; driver toggle changes counts (OncoKB only, see 01 RV-2) |

### §7 Other table charts

| ID | verdict | how | note |
|---|---|---|---|
| STS-OT-1 | 🟡 | B | "Data types" card: profile id + name + count; counts identical; no Freq column; pick → `profiled` clause for MUT/CNA/SV only, OR (legacy Intersection default) |
| STS-OT-2 | 🟡 | BC | "Case lists" always shown; top 10 only; n counts patients (`explore.ts:1093` uniqExact p.stable_id), legacy samples; OR on pick |
| STS-OT-3 | ❌ | C | No mutation-type counts table |
| STS-OT-4 | ❌ | C | No variant-annotations table |
| STS-OT-5 | ❌ | B | No GA frequency table; Add chart › Generic assays charts one entity at a time (see GS-5/6) |
| STS-OT-6 | ❌ | B | No treatment tables |
| STS-OT-7 | ✅ | B | "Timeline events" card, patients per event type (592 / 588 / 214 ✅); shown by default; no Freq column |

### §8 Density scatter

| ID | verdict | how | note |
|---|---|---|---|
| STS-SC-1 | 🟡 | BC | Fixed "Mutation count vs fraction genome altered" card when both attributes exist; no other X vs Y |
| STS-SC-2 | 🔶 | B | 48×32 cells, opacity by log count (no plasma colours, no legend); x log10(MC+1) |
| STS-SC-3 | ❌ | BC | No correlation text (Spearman computed by the view, not rendered) |
| STS-SC-4 | 🔶 | B | Cell tip "N samples" only |
| STS-SC-5 | 🔶 | B | No menu (no swap, no log toggles, no download); axes fixed MC log x, FGA y |
| STS-SC-6 | 🟡 | C | Drag a box → two range clauses (MC rounded to whole counts, FGA by span) (`explore-charts.tsx:89-92`); no custom bins added to the bar charts |
| STS-SC-7 | ✅ | C | Own filters included (the plot is drawn over the draft) |
| STS-SC-8 | 🐞 ok | C | Legacy dead code / out-of-range bin bug not present |

### §9 Violin / box

| ID | verdict | how | note |
|---|---|---|---|
| STS-VI-1 | ❌ | C | No clinical violin table |
| STS-VI-2 | ❌ | C | — |
| STS-VI-3 | ❌ | C | — |
| STS-VI-4 | ❌ | C | — |
| STS-VI-5 | ❌ | C | — |
| STS-VI-6 | ❌ | C | — |
| STS-VI-7 | ❌ | C | — |
| STS-VI-8 | ❌ | C | No gene-specific violin |

### §10 Survival mini chart

| ID | verdict | how | note |
|---|---|---|---|
| STS-KM-1 | 🔶 | B | One card "Overall survival of the selection" with an endpoint select (OS, PFS, …), not one 1×1 tile per prefix — kept on purpose (decided 2026-11-13) |
| STS-KM-2 | ✅ | B | Patients of the selection, one curve, no p-value |
| STS-KM-3 | 🔶 | B | Full KM with axes, number-at-risk table and "median 81.4 mo · n = 590 · 120 events" line |
| STS-KM-4 | 🐞 ok | C | No selection on the curve (legacy's is dead code) |
| STS-KM-5 | 🟡 | C | Left truncation is an analysis-view caveat, not offered on Explore's card |
| STS-KM-6 | ❌ | B | No download |

### §11 Added charts

| ID | verdict | how | note |
|---|---|---|---|
| STS-GS-1 | ✅ | B | Add chart › Gene status: "KRAS: somatic mutations" Mutated / Not mutated / Not profiled = 218 / 316 / 60 (legacy identical); list, not pie |
| STS-GS-2 | ❌ | C | No mutation-type option |
| STS-GS-3 | 🔶 | B | Amplified / Deleted / Diploid / Not profiled; no GAIN/HETLOSS (tracked: OQL coverage, only ±2 loaded) |
| STS-GS-4 | ❌ | C | No continuous-profile gene bar |
| STS-GS-5 | 🟡 | C | Generic assays › one entity → histogram (`buildAssayFacets`), bins from `numericBinEdges`, ≤6 charts |
| STS-GS-6 | 🟡 | C | Categorical GA entity → value list (top 30) |
| STS-GS-7 | 🟡 | B | "Custom data" uploads become clinical-like facets (tag "custom") |

### §12 Special charts

| ID | verdict | how | note |
|---|---|---|---|
| STS-SP-1 | 🟡 | B | "Studies" card (study ids, %, n) on multi-study, "Explore only these" on pick; counts patients, not samples; shown for one study too |
| STS-SP-2 | 🔶 | B | Cancer Type / Detailed are lists ✅, but shown with one value on a single study |
| STS-SP-3 | 🟡 | B | "Number of Samples Per Patient" list (not pie); shown by default |
| STS-SP-4 | ✅ | C | No mutation-spectrum chart, as legacy |

### §13 Downloads

| ID | verdict | how | note |
|---|---|---|---|
| STS-DL-1 | ❌ | B | No chart downloads |
| STS-DL-2 | ❌ | C | No download-hide switch (tracked: Data-governance switches) |
| STS-DL-3 | ❌ | C | n/a — nothing to download (legacy TSV bugs therefore absent) |

### §14 Selection → filter summary

| ID | verdict | how | note |
|---|---|---|---|
| STS-FL-1 | ✅ | BC | Clauses AND across charts |
| STS-FL-2 | N/A | BC | Filters not in the URL (only `study`, `drivers`), as legacy; no `filterJson` / `filterAttributeId` input. N/A per invariant 9: the draft is the document's cohort definition, carried by Save/Analyze/Compare links (`?doc=`), not page state |
| STS-FL-3 | 🟡 | C | No manual-submit mode (filters always apply at once) |

### §15 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| STS-MD-1 | 🔶 | B | Single study: no studies pie needed but "Studies" card shown; one-value Cancer Type shown; no q-values |
| STS-MD-2 | 🟡 | B | Multi: Studies breakdown, merged facets with "*" on partial attributes, panel-aware Freq ✅ (TP53 41.3 %); header "(overlap not deduplicated)" (invariant 3) |
| STS-MD-3 | ✅ | C | Freq = on-panel altered ÷ samples profiled for that gene + WES (`explore.ts:597-602`, invariant 7) |
| STS-MD-4 | ✅ | B | Patient attributes count patients ("Diagnosis Age · 592 patients", bar tip "patients") |
| STS-MD-5 | 🔶 | C | Conflicting-level attributes become two facets keyed `per|attribute`, not one per-sample count |
| STS-MD-6 | 🔶 | BC | Categorical own filter excluded (disjunctive) ✅; numeric, scatter own filter included and re-binned (Q3) |
| STS-MD-7 | ✅ | C | ≤10 distinct values → one bar per value (`DISTINCT_VALUE_THRESHOLD`) |
| STS-MD-8 | ✅ | B | Log bins chosen automatically (Days to Birth); the Log Scale item switches them off |
| STS-MD-9 | 🔶 | B | Bar "NA n" ✅; pie/list has no NA |
| STS-MD-10 | 🔶 | C | Shape from allowlist, not >20 categories |
| STS-MD-11 | N/A | C | cBioLab never shows cancer-gene icons, so there is nothing for this mode to hide (the gap is GT-6) |
| STS-MD-12 | 🟡 | C | No manual submit |
| STS-MD-13 | ❌ | C | Chart picks, layout not saved per user |
| STS-MD-14 | 🔶 | B | Empty: facets drawn, no message (see LY-11) |
| STS-MD-15 | ✅ | C | No host-specific priorities, as cbioportal.org |
| STS-MD-16 | 🟡 | B | Grid reflows by width; cards don't resize |

### §16 Persistence (no IDs)

Filters not in the URL (as legacy); study list and drivers toggle are (`?study=`, `?drivers=1`). Chart picks are browser state only; no per-user layout. Saving the draft is "Save as a Cohort" (library) or Analyze/Compare (document link).

### §17 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| STS-STM-1 | 🟡 | BC | count by folded value (`clinicalValueFoldSql`, most frequent spelling kept; legacy greatest) at the attribute's level ✅, numbers identical; no NA row |
| STS-STM-2 | 🟡 | BC | Disjunctive counts for categorical, derived, gene and assay facets (`explore.ts:247-254`); not numeric histograms |
| STS-STM-3 | 🔶 | B | % = count ÷ Σ non-NA values (`explore-sections.tsx:718`); 1 decimal; Sex 52.7 vs 52.5 |
| STS-STM-4 | ✅ | C | The whole dispatch: discrete first, then CUSTOM (adjustCustomBins), GENERATE, MEDIAN, QUARTILE (median fallback), log unless disabled, scientific, linear. 29 recorded cases match the portal's bars (`test/fixtures/data-binner-methods.json`) |
| STS-STM-5 | ✅ | BC | Linear bins identical on every Q1 attribute (incl. AGE ≤35) |
| STS-STM-6 | ✅ | BC | Days to Birth log bins identical |
| STS-STM-7 | ✅ | C | Scientific-small binner ported (`lib/data-binner.ts`) |
| STS-STM-8 | 🔶 | BC | Edges from the filtered cohort (DYNAMIC), so they move with filters (Q2 MANTIS, MSIsensor, TBL) |
| STS-STM-9 | 🟡 | C | Range clause `gt/lte` = (start, end] ✅; one value `=`; bars of one attribute AND (bug) instead of OR |
| STS-STM-10 | ✅ | C | An empty Custom box is the default bars (sent as `bins: null`, which also overrides the MSI initial bins) |
| STS-STM-11 | ✅ | B | NA n = cohort − counted values (`explore.ts:965`): AGE 2, MC 60, FGA 11 match |
| STS-STM-12 | 🟡 | C | Quartiles/Median cut by the server over the selection's values (`compareQuantiles`); Current bins one group per bar ✅; quartiles single study only |
| STS-STM-13 | ✅ | BC | # = altered incl. off-panel, Freq = on-panel ÷ profiled, UNCALLED excluded; identical numbers. A sample on two panels counted once (`surplus`, `explore.ts:574-588`) where legacy counts per panel — no difference on these studies |
| STS-STM-14 | 🟡 | B | Data types ✅, events ✅ (patients); case lists in patients; no Freq on these |
| STS-STM-15 | 🔶 | BC | n identical; Spearman identical (not shown); Pearson on log10(MC+1) (−0.408 vs −0.332), not shown; 48×32 grid |
| STS-STM-16 | ❌ | C | No violin |
| STS-STM-17 | ❌ | C | No gene violin |
| STS-STM-18 | ✅ | B | KM over the selection's patients: 590 / 120 / 81.4 and 280 / 56 / not reached, as legacy |
| STS-STM-19 | 🔶 | B | Studies card counts patients per study (draftCount), not samples |

---

## 5. cBioLab bugs (on its own terms)

- **Two bars of one histogram AND to nothing.** `addClause` merges only categorical values and OQL; a second range clause on the same attribute is pushed and ANDed (`app/lab/use-explore-state.ts:471`). AGE (50,60] then (70,75] → "0 patients match". Derived buckets already OR (`:451-465`); numeric bars should too.
- **Clicking a selected pie value again** re-adds it (clause `SEX = Female` → `SEX ∈ {Female}`), so the reader cannot unselect from the chart; only the pill's × removes it.
- **Numeric facet under its own filter collapses**: AGE (50,60] redraws AGE as ten one-value bars, so the other ranges cannot be added (the "disappearing options" the categorical facets were fixed for; `draftedClinical` skips NUMBER, `explore.ts:268`).
- **Default charts include constant attributes** (Cancer Type, Sample Type, Somatic Status, Samples per Patient = one value; DAYS_TO_INITIAL_PATHOLOGIC_DIAGNOSIS all 0 draws no bars) while informative ones (Sex, Race, Subtype) are left out.
