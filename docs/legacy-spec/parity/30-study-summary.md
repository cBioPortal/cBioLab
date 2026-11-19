# Parity audit — Study View › Summary charts (spec `30-study-summary.md`)

- **Date:** 2026-11-11; re-scored 2026-11-16; re-measured 2026-11-18
- **cBioLab:** master @ `bc53b944`, `next dev` on `http://127.0.0.1:3109` (2026-11-16: `3ff57c37`; first audit: `session/spec` @ `f3197d75`)
- **Legacy:** cbioportal.org (Playwright + its REST API, 2026-11-11; the statistics again through its REST API on 2026-11-18)
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
| ✅ match | 41 |
| 🟡 partial | 47 |
| 🔶 different | 13 |
| ❌ missing | 29 |
| 🐞 ok | 3 |
| 🐞 copied | 0 |
| N/A | 2 |
| ? | 0 |
| **Total IDs** | **135** |

**Overall: 34.1 %** (✅ 41 + 🐞ok 3 + N/A 2 = 46 of 135). Counting 🟡 as half: 51.5 %. (2026-11-16: 39.3 % / 54.1 %; 2026-11-11: 17.8 % / 31.9 %.)

Re-measurement of 2026-11-18 (master `bc53b944`): every ID judged again from the spec text against the code and the page, not from the PRs' Tracker lines. 18 verdicts changed: 5 up (GT-4, TBL-7, DL-3, MD-13, MD-16), 13 down (LY-8, HD-1, BAR-4, BAR-7, GT-10, GT-11, OT-7, KM-2, KM-5, GS-1, FL-3, MD-12, STM-1; marked ↓ in the note). The numbers all still match: on Q1, Q2 and Q4 every categorical chart, every numeric chart's bins (with the MSI custom bins the page sends), every mutated / CNA / SV gene (18,275 / 23,770 / 810 on Q1; 16,678 / 17,395 / 361 on Q2; 18,669 mutated on Q4), the 16 data types, 14 case lists and 3 event types are identical to cbioportal.org's API; KM 590 / 120 / 81.37 and the density's Pearson −0.3317 / Spearman −0.3487 as the portal. The drops are behaviour the earlier rows passed over: no search beyond the gene symbol, no alteration filter beyond drivers, no manual submit, Log Scale keeping the filter, the timeline-events table shown by default without Freq.

Re-score of 2026-11-16: the rows PRs #203, #222, #257, #260, #261 and #266 had already updated were checked again, and 17 more verdicts changed, all for the better (#188, #190, #261). The default charts, NA slices and rows, % of every case, bins fixed for the study, two bars of a chart ORed and a second click unselecting all now match. Still open: the pie allowlist, slice labels and grey-out, list search and Select all, the missing chart kinds (violin, treatment, GA frequency, mutation-type, variant annotations) and the downloads beyond Summary Data.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §1 Layout (LY) | 11 | 1 | 4 | 3 | 3 | 0 | 0 | Fixed CSS grid of cards, no drag or resize (decided); default clinical charts the portal's (#188); non-clinical cards not ordered by priority |
| §2 Header (HD) | 7 | 0 | 4 | 1 | 2 | 0 | 0 | Title + "…" menu: Compare / Analyze, Custom Bins, Show NA, Download; titles wrap, not ellipsized; no reset, delete, info overlay or type switch |
| §3 Pie (PIE) | 9 | 2 | 3 | 3 | 1 | 0 | 0 | NA slice and a second click unselecting fixed; pie only for allowlisted ids, no slice labels, no grey-out, Okabe-Ito palette |
| §4 Clinical table (TBL) | 7 | 0 | 5 | 0 | 2 | 0 | 0 | % of every case with an NA row; no header, search or Select all |
| §5 Bar (BAR) | 9 | 3 | 6 | 0 | 0 | 0 | 0 | Bins fixed for the study, the portal's bar menu; bars OR and grey out; click, not drag; Log Scale keeps the filter |
| §6 Gene tables (GT) | 11 | 4 | 6 | 0 | 1 | 0 | 0 | Every gene, sort, panels, q-values, Union / Intersection, query queue; search on the symbol only; drivers the only alteration filter; no OncoKB filter |
| §7 Other tables (OT) | 7 | 0 | 3 | 0 | 4 | 0 | 0 | Data types, case lists and events counted as the portal; no Freq on two, events shown by default; no treatment, GA-frequency, mutation-type or VA tables |
| §8 Density scatter (SC) | 8 | 5 | 2 | 0 | 0 | 1 | 0 | Drawn as the portal draws it (#222); no other X vs Y |
| §9 Violin (VI) | 8 | 0 | 0 | 0 | 8 | 0 | 0 | No violin/box tables |
| §10 Survival (KM) | 6 | 1 | 1 | 2 | 1 | 1 | 0 | One OS/PFS/… chart with a picker (kept on purpose); n / events / median match; no left truncation |
| §11 Added charts (GS) | 7 | 0 | 4 | 1 | 2 | 0 | 0 | Gene mutation chart's counts match, drawn as a list; CNA lacks GAIN/HETLOSS; GA one entity at a time |
| §12 Special (SP) | 4 | 2 | 2 | 0 | 0 | 0 | 0 | Studies breakdown ≈ Cancer Studies, also shown for one study; constant charts hidden |
| §13 Downloads (DL) | 3 | 0 | 1 | 0 | 1 | 1 | 0 | Summary / Full Data, SVG, PDF, gene-table Data; not a gene-state or GA chart's Full Data |
| §14 Filters (FL) | 3 | 1 | 0 | 0 | 1 | 0 | 1 | AND across charts, OR within; legacy URL inputs read; no manual submit |
| §15 Modes (MD) | 16 | 9 | 3 | 2 | 1 | 0 | 1 | Single and multi study; own filter excluded for every chart kind; no manual submit |
| §17 Statistics (STM) | 19 | 13 | 3 | 1 | 2 | 0 | 0 | Every count identical to the portal API on Q1, Q2, Q4; at most 200 values per chart |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Different default charts.** DB priority 1 is taken as-is (legacy replaces it from its config table), then ranked by coverage: Q1 shows Cancer Type, Sample Type, Somatic Status, # Samples per Patient (one value each), Form completion date, "Last Alive Less Initial…" (all 0), Tissue Source Site…; Sex, Race, Ethnicity, Subtype, T/M stage, Aneuploidy, Days to Birth, DFS/DSS/PFS KM are hidden. Legacy 29 charts vs cBioLab 20 clinical + 9 fixed cards; 8 of legacy's 17 clinical charts overlap | LY-7, LY-8, MD-1 | fixed (#188); the single-study Studies card is still shown (MD-1) |
| 2 | **Categorical % leaves NA out.** NA is never a slice/row, and Freq = count ÷ Σ non-NA values: Sex Male 52.7 % (legacy 52.5 %); Race White 78.7 % of 362 (legacy 48.0 % of 594, NA 232) | PIE-9, TBL-1, STM-1, STM-3, MD-9 | fixed (#190) |
| 3 | **Numeric bins are dynamic, and a numeric chart is not freed of its own filter.** Edges recomputed on the filtered cohort (Q2: MSI MANTIS 0.02-wide bars vs legacy's stable 0.01; MSIsensor ">2.8" vs ">2.2"; TBL ">170" vs ">160"); Q3 AGE (50,60] collapses the AGE chart to ten one-value bars 51…60 (legacy keeps all bins, own filter excluded) | BAR-1, STM-2, STM-8, MD-6 | fixed (#188, #190); generic-assay bars still cut by `numericBinEdges` (BAR-1) |
| 4 | **Clicking a second bar of one histogram ANDs the ranges → 0 patients** (AGE (50,60] + (70,75] = 0); categorical values OR correctly | BAR-5 (cBioLab bug) | fixed (#188) |
| 5 | **No bar-chart menu**: no Custom Bins / Quartiles / Median / Generate, no Log Scale toggle, no Show NA; no default MSI custom bins (legacy MANTIS 468/22/67, MSIsensor 496/10/78) | BAR-1, BAR-6…8, HD-5 | fixed (#203) |
| 6 | **Gene tables**: 500-row cap ("500 of 18,275 genes"), no column sort, title lacks "(N profiled samples)", no OncoKB cancer-gene icon/filter, no MutSig/GISTIC q-value, no gene-panel tooltip, no query-queue on gene click, Union only, SV default sort by # altered not # SV | GT-2, GT-3, GT-5…GT-9 | mostly fixed (#261, #266); OncoKB cancer-gene icon and filter, q-values, a panel's gene list tracked |
| 7 | **No chart downloads** (Summary/Full data, SVG, PDF, gene-table TSV) | DL-*, HD-5 | Summary Data done (#257); the rest tracked in PORTAL-PARITY |
| 8 | **Missing chart kinds**: treatment tables, GA frequency table (arm-level CNA shown by default in legacy), mutation-type counts, variant annotations, X-vs-Y density/violin, gene-specific violin, continuous gene bar | OT-3…6, VI-*, GS-4, SC-1 | tracked (Chart kinds) |
| 9 | **Pie behaviour**: pie only for 9 allowlisted ids (else a list, even for 2 values); legend beside pie instead of slice labels; unselected slices not greyed; clicking a selected value does not remove it (turns "=" into "∈ {…}"); Okabe-Ito colours | LY-9, PIE-3, PIE-6…8 | second click fixed (#188); the rest tracked (Pie) |
| 10 | **Survival**: one chart with an endpoint picker instead of one KM tile per endpoint; numbers match | KM-1 | kept on purpose (decided 2026-11-13) |
| 11 | **Density**: x = log10(MC+1), y = FGA (legacy x = FGA, y = MC, linear); 48×32 grid (legacy 44×38); no Pearson/Spearman text, no Swap Axes / Log menu, tooltip "n samples" only | SC-2…5, STM-15 | fixed (#222) |
| 12 | **Chart chrome**: no drag, resize, ✕ delete (hide via Add chart), ↶ reset (remove pill instead), ⓘ overlay (title tooltip only) | LY-1…6, HD-2…4 | decided against (2026-11-13): fixed layout |
| 13 | **Gene CNA chart**: the discrete profile's five levels and Not profiled, as the portal (KRAS 6 / 128 / 390 / 67 / 1 / NA 2); drawn as a list without the CNA colours | GS-3 | fixed (#378) |
| 14 | **Empty selection**: facets still drawn (filtered attribute only), "0 patients match"; no "filtered out all the samples" message | LY-11, MD-14 | fixed (#260) |
| 15 | **Case lists** limited to 10 (`LIMIT 10 BY s`): coad, read, protein_quantification, methylation_hm450 missing; counted in patients, not samples | OT-2 | fixed (#260) |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 / Q2 / Q3 / Q4 selected | STM-1 | 594 · 280 · 106 · 1,678 | same ("(overlap not deduplicated)" on Q4) | ✅ |
| Q1 categorical charts, NA included (40 attributes) | STM-1, STM-3 | e.g. Sex 312 / 280 / NA 2; Race White 285 (48.0 % of 594), NA 232; OS Status 471 / 120 / NA 3 | identical for all 40; OTHER_PATIENT_ID lists 200 of its 592 values | ✅ (one capped) |
| Q2 categorical charts (Sex = Female) | STM-1, STM-2 | as Q1's API with the filter; the page drops Sex's own filter | identical; Sex shows 312 / 280 / NA 2, own filter excluded | ✅ |
| Q4 categorical charts (coadread + brca) | STM-1 | — | identical for all 40 | ✅ |
| Q1 / Q2 numeric bins, 13 charts (AGE, MC, FGA, Aneuploidy, Days to Birth, OS/DSS/DFS months, Buffa, Weight, …) | STM-5, STM-6, STM-8 | STATIC bins, NA | identical bins and NA on every chart | ✅ |
| Q1 / Q2 MSI MANTIS, MSIsensor (page's custom bins [0.4,0.6], [4,10]) | BAR-1, STM-4 | 468 / 22 / 67 NA 37 · 496 / 10 / 78 NA 10; Q2 215 / 13 / 38 NA 14 | identical | ✅ |
| Q1 the five numeric charts past the 14th (PFS_MONTHS, RAGNUM / WINTER hypoxia, TMB_NONSYNONYMOUS, TBL_SCORE) (2026-11-19) | BAR-1, STM-8 | STATIC bins, NA (14 / 17 / 18 / 17 / 17 bars; NA 4 / 229 / 60 / 2 / 229) | identical bins and NA on every chart | ✅ |
| Q3 AGE chart under its own filter | STM-2 | all 12 bins | all 12 bins (8, 11 … 23) | ✅ |
| Mutated / CNA / SV genes, every row (# altered, # events, profiled) | STM-13 | Q1 18,275 / 23,770 / 810; Q2 16,678 / 17,395 / 361; Q4 18,669 mutated | identical, 0 rows differ | ✅ |
| Data types (16), case lists (14), event types (3), Q1 and Q2 | STM-14 | e.g. mutations 534 / 255; all 594; STATUS 592 / 280 | identical | ✅ |
| KRAS mutation chart Q1 | GS-1 | 218 / 316 / 60 | 218 / 316 / 60 | ✅ |
| KRAS CNA chart Q1 (2026-11-19) | GS-3 | AMP 6, HOMDEL 1, GAIN 128, HETLOSS 67, Diploid 390, NA 2 | Amplified 6, Gained 128, Diploid 390, Heterozygously deleted 67, Homozygously deleted 1, Not profiled 2 | ✅ |
| OS KM Q1 | STM-18 | n 590, 120 events, median 81.37 mo | "median 81.37 (62.79 - NA) mo · n = 590 · 120 events" | ✅ |
| Density Q1 | STM-15 | n 523, Pearson −0.3317, Spearman −0.3487 | "523 of 594 samples have both", Pearson −0.3317, Spearman −0.3487 | ✅ |
| Treatment per patient (2026-11-11) | OT-6 | 214 patients, per-drug rows | none (only "has Treatment" 214) | ❌ |
| msk_impact_2017 gene tables, Freq text (2026-11-19) | GT-5 | `getFrequencyStr` of the API's on-panel ÷ profiled | 413 / 413 mutated, 786 / 786 CNA identical | ✅ |
| Cancer Studies, msk_impact_2017 + acc_tcga_pan_can_atlas_2018 (2026-11-19) | STM-19 | 10,945 / 92; SEX Female 5,497 / 60 | identical | ✅ |
| GRADE, blca_tcga + ampca_bcm_2016 (2026-11-19) | MD-5 | one chart per sample; High Grade filter 389 samples / 388 patients | identical | ✅ |
| Generic-assay bars, 6 entities (brca ancestry ×2, phosphoprotein, methylation; luad_cas_2020 SBS1, SBS4) (2026-11-19) | BAR-1, GS-5 | STATIC bins, NA | identical bars, counts and NA | ✅ |

Legacy figures for Q1, Q2 and Q4 were taken again on 2026-11-18 from `/api/clinical-data-counts/fetch`, `/api/clinical-data-bin-counts/fetch?dataBinMethod=STATIC`, `/api/mutated-genes/fetch`, `/api/cna-genes/fetch`, `/api/structuralvariant-genes/fetch`, `/api/molecular-profile-sample-counts/fetch`, `/api/sample-lists-counts/fetch`, `/api/clinical-event-type-counts/fetch` and `/api/filtered-samples/fetch`, and compared row by row with `POST /api/explore` on master; the KM and density from the rendered page. Rows marked (2026-11-11) were not re-run.

Data version: every count matches exactly, so the warehouse holds the same coadread/brca data as cbioportal.org. Differences are display rules (NA, denominators), bin method (DYNAMIC vs STATIC, default custom bins) and the default chart choice.

---

## 4. Scorecard

### §1 Grid and layout

| ID | verdict | how | note |
|---|---|---|---|
| STS-LY-1 | 🔶 | B | CSS grid `.facetgrid`, cards ~301 px wide, 5 columns at 1600 px; heights follow content; not react-grid-layout |
| STS-LY-2 | 🔶 | B | Fixed shapes: clinical cards one cell; gene tables, survival, density, data types wider; no w×h model |
| STS-LY-3 | 🟡 | BC | Clinical charts by priority, then name (`lib/study-view-config.ts:31`, `lib/explore.ts:322`); the other cards in a fixed CSS order (`app/globals.css:248-253`): gene tables first, survival and density last (legacy ranks them 400 / 200, above the gene tables); no findSpot |
| STS-LY-4 | ❌ | B | No drag |
| STS-LY-5 | ❌ | B | No resize |
| STS-LY-6 | ❌ | C | No highlight of a newly added chart |
| STS-LY-7 | ✅ | BC | The portal's defaults (#188): coadread charts 17 of 59, Sex, Race, Ethnicity and Subtype among them; constant charts (Cancer Type, Samples per Patient) hidden |
| STS-LY-8 | 🟡 | C | ↓ Clinical priorities and the DB-priority-1 override from the portal's table (`lib/study-view-config.ts:11-28`); priority < 0 still offered in Add chart (legacy drops it); the non-clinical priorities (survival 400, density 200, SV 85 before CNA 80) not used, CSS order instead |
| STS-LY-9 | 🔶 | BC | Pie only for `PIE_ATTRIBUTES` (SEX, GENDER, *_STATUS, SAMPLE_TYPE, SOMATIC_STATUS; `explore-sections.tsx:57`), every other STRING a list; NUMBER → histogram ✅ |
| STS-LY-10 | 🟡 | B | Skeleton grid while building, "updating…" over survival/density, busy class on the grid; no progress list, no per-chart error text beyond the API error |
| STS-LY-11 | 🟡 | BC | 0 samples: the portal's message, no charts, the filter bar kept ([empty-caselists-cases](empty-caselists-cases.md) EM1–EM5). No invalid-sample alert, no saved-layout banner |

### §2 Chart header

| ID | verdict | how | note |
|---|---|---|---|
| STS-HD-1 | 🟡 | B | ↓ displayName + "· sample-level · N samples"; gene tables "Mutated Genes (534 profiled samples)" (#261) ✅; but left-aligned and wrapped over two lines ("American Joint Committee on Cancer Metastasis Stage Code"), not centred and ellipsized (`.facettitle`, `app/globals.css:669`) |
| STS-HD-2 | 🔶 | B | "…" menu button always visible, not hover-only |
| STS-HD-3 | ❌ | B | No ⓘ, ↶ reset, ✕ delete buttons; only the "…" menu (remove a filter via its pill, hide a chart via Add chart) |
| STS-HD-4 | 🟡 | B | Title `data-tip` = "ID — description"; no survival unit lines |
| STS-HD-5 | 🟡 | B | Numeric charts: Log Scale (when offered), Compare / Analyze groups, Custom Bins…, Show NA, Download, in the portal's order (`explore-sections.tsx:842-861`); pie: Compare, Analyze, Download; no Swap Axes or Show Table/Pie |
| STS-HD-6 | ❌ | C | No pie ↔ table switch (shape fixed by allowlist) |
| STS-HD-7 | 🟡 | BC | Compare → new tab `/portal/comparison` with one group per value, top 20 by count ✅ (`explore-sections.tsx:621-638`); bar: Quartiles / Median / Current bins ✅ (single study only for quartiles); checked rows restrict the groups (legacy ignores the selection); extra "Analyze groups" target |

### §3 Pie chart

| ID | verdict | how | note |
|---|---|---|---|
| STS-PIE-1 | 🟡 | BC | Count order, NA last ✅ (`explore-sections.tsx:790-792`); ordinal attributes in their own order (`naturalOrder`), where the portal keeps count order |
| STS-PIE-2 | 🔶 | B | 72-unit SVG pie with an always-visible legend (swatch, value, count) beside it |
| STS-PIE-3 | ❌ | B | No slice labels |
| STS-PIE-4 | 🟡 | B | Slice tip "Male — 806 (74.1%)", % of every patient (`data-tip`, not `<title>`) |
| STS-PIE-5 | 🟡 | B | No hover table; legend gives value + count; no %, no Select all/Compare in tooltip |
| STS-PIE-6 | ✅ | B | Click a slice or legend row adds the value (OR within the chart); a second click takes it out (`aria-pressed`) (#188) |
| STS-PIE-7 | 🔶 | B | Selected slice gets class `on`; unselected slices keep their colour (no #D3D3D3 grey); counts stay (own filter excluded ✅) |
| STS-PIE-8 | 🔶 | BC | `CAT_COLORS` Okabe-Ito by position (Male #0072B2, Female #E69F00); no reserved-value colours, no pinning |
| STS-PIE-9 | ✅ | B | NA its own slice in #D3D3D3 and legend row, selectable (Sex NA 2) (#190) |

### §4 Clinical table

| ID | verdict | how | note |
|---|---|---|---|
| STS-TBL-1 | 🟡 | B | Value list: checkbox, value, bar, count, % of every patient, NA row (Race White 48.0 %, NA 232; #190); no header row, no swatch |
| STS-TBL-2 | 🟡 | BC | Count order (ordinal attributes in natural order); selected rows marked, not pinned |
| STS-TBL-3 | ❌ | B | No search box under a list |
| STS-TBL-4 | 🟡 | B | Checkboxes stage; [Apply filter] writes one OR clause (`ValueList`) |
| STS-TBL-5 | ❌ | B | No Select all / Deselect all ("Clear" of staged picks only) |
| STS-TBL-6 | 🟡 | B | Compare via "…" menu: checked rows → groups, none checked → top 20 values; one checked → disabled "Check another row" |
| STS-TBL-7 | 🟡 | C | ↑ Rows 24 px (`VALROW_H`, `app/lab/pick-list.tsx:94`), legacy 25; no header row; the list scrolls after 9 rows |

### §5 Bar chart

| ID | verdict | how | note |
|---|---|---|---|
| STS-BAR-1 | ✅ | BC | Clinical and generic-assay bins from `lib/data-binner.ts` (DataBinner port, STATIC); the MSI scores' initial custom bins ✅; generic-assay entities identical to the portal API (brca AFR, EUR, AAAS_pS462, cg00000029; luad_cas_2020 SBS1, SBS4) |
| STS-BAR-2 | 🟡 | B | Numeric bins then category bins ✅; HTML bars, NA as a right-hand "NA n" note; no y axis |
| STS-BAR-3 | 🟡 | B | Tick = bin start ("≤35 40 50 …", thinned to fit); no trailing end tick, no 10^n superscripts |
| STS-BAR-4 | 🟡 | B | ↓ Tip "35–40 · 11 patients — click to filter": the unit follows the attribute's level (legacy bug not copied ✅), but the range is "35–40", not "(35, 40]", and there is no "Number of samples: / Range:" layout (`explore-sections.tsx:767-768, 950`) |
| STS-BAR-5 | 🟡 | BC | Click a bar adds its range; a second bar of the chart ORs and a click takes it out (#188); unselected bars greyed (`hbar off`, `explore-sections.tsx:951`); no drag |
| STS-BAR-6 | ✅ | B | Show NA [off]: off the "NA n" note, on an NA bar last (clicking it filters to NA); the y-max takes it in only when drawn; kept per chart by the browser |
| STS-BAR-7 | 🟡 | C | ↓ Offered as the portal offers it (`looksLogarithmic`, `lib/study-view-bins.ts:24-34`); unchecking gives linear bars (Days to Birth ≤-32000 … >-12000). But toggling keeps the chart's filter, where the spec clears it |
| STS-BAR-8 | ✅ | C | Custom Bins dialog: Quartiles / Median split / Generate bins (size, min value) / Custom bins [default], the box starting from the bars' edges (0 kept, unlike legacy); a non-number refused by name. Disabled, saying why, on a chart of ≤10 values (legacy shows it and ignores it) |
| STS-BAR-9 | ✅ | BC | "Compare groups ▸ Quartiles / Median / Current bins" (`explore-sections.tsx:640-652`) |

### §6 Gene tables

| ID | verdict | how | note |
|---|---|---|---|
| STS-GT-1 | 🟡 | B | Mutated, CNA, SV tables per alteration type, every gene (coadread 18,275 / 23,770 / 810) ([gene-tables-cases](gene-tables-cases.md)); no SV-pair table |
| STS-GT-2 | ✅ | B | "Mutated Genes (534 profiled samples)", "CNA Genes (592 …)", "Structural Variant Genes (534 …)" on coadread, as the portal ([gene-tables-cases](gene-tables-cases.md)) |
| STS-GT-3 | ✅ | B | Columns ✅; a header click sorts by any column, a second reverses; default Freq desc (SV # SV desc), ties by events then gene ([gene-tables-cases](gene-tables-cases.md)) |
| STS-GT-4 | ✅ | B | ↑ The portal's header tooltips, and the filtered "#" variant ("…filtered based on selections in the Alteration Filter menu") under the drivers filter (`lib/study-view-gene-tables.ts:174-181`, `explore-sections.tsx:1240`) |
| STS-GT-5 | 🟡 | B | # Mut/# SV = events ✅, # = altered ✅, Freq written as the portal's `getFrequencyStr` of the unrounded frequency ("<0.1%", "100.0%", "NA"; `geneFreqText`, `lib/study-view-gene-tables.ts`) ✅ — msk_impact_2017 413 / 413 mutated and 786 / 786 CNA rows as the portal, Freq tooltip with "Gene panels: …" and the panel gene-list dialog (`app/lab/explore-panel-genes.tsx:73-86`) ✅; CNA tag dark red/blue on a tint, not bold #ff0000/#0000ff (`app/globals.css:505-507`) |
| STS-GT-6 | 🟡 | B | A gene's search icon queues it for Query genes…, with the portal's messages ([gene-tables-cases](gene-tables-cases.md)) GQ1–GQ4; the MutSig "M" / GISTIC "G" q-value icon and tooltip, single study (QV1–QV7; stad_tcga: 192 MutSig and 2,517 GISTIC rows, identical to the portal API). No OncoKB cancer-gene tooltip |
| STS-GT-7 | ❌ | C | No OncoKB cancer-gene filter |
| STS-GT-8 | ✅ | B | The `#` header's filter icon, dark under "Alterations: OncoKB drivers only" (the page's alteration filter), with the portal's filtered tooltip ([gene-tables-cases](gene-tables-cases.md)) GI1–GI2 |
| STS-GT-9 | 🟡 | B | Check rows → [Apply filter], Union (one OQL clause) or Intersection (a clause per gene, refused past the selection's 8 filters), the choice kept by the browser; applied rows pinned, checked and disabled ([gene-tables-cases](gene-tables-cases.md)) GU1–GU6; compare via "…" |
| STS-GT-10 | ✅ | C | ↓ The search matches any column as shown (gene, # Mut / # SV, #, Freq; CNA: cytoband, AMP / HOMDEL; `geneRowMatches`); legacy Freq-search bug not reproduced |
| STS-GT-11 | 🟡 | BC | ↓ Counts follow the page's one alteration filter, "Alterations: all / OncoKB drivers only" (`app/lab/page.tsx:596-600`); no germline / somatic / unknown, VUS or tier choices, CNA fixed to AMP / HOMDEL |

### §7 Other table charts

| ID | verdict | how | note |
|---|---|---|---|
| STS-OT-1 | ✅ | B | "Data types" card: profile id + name + count + Freq (÷ selected samples, the portal's format), sorted by Freq; counts identical; pick → `profiled` clause for MUT/CNA/SV only, Intersection by default (Union to choose, kept by the browser): coadread mutations + gistic 532, as the portal |
| STS-OT-2 | 🟡 | BC | Every case list, by kind across studies, counted in samples, Freq of the selected samples; coadread's 14 lists match cbioportal.org's counts ([empty-caselists-cases](empty-caselists-cases.md) CL1–CL10). Always shown (the portal only when filtered on one) |
| STS-OT-3 | ❌ | C | No mutation-type counts table |
| STS-OT-4 | ❌ | C | No variant-annotations table |
| STS-OT-5 | ❌ | B | No GA frequency table; Add chart › Generic assays charts one entity at a time (see GS-5/6) |
| STS-OT-6 | ❌ | B | No treatment tables |
| STS-OT-7 | 🟡 | B | ↓ "Timeline events" card, patients per event type (592 / 588 / 214, = the portal API) with Freq ÷ selected patients (99.7 % / 99.0 % / 36.0 %) ✅; shown by default where legacy offers it in Add Chart only (`explore-sections.tsx`) |

### §8 Density scatter

| ID | verdict | how | note |
|---|---|---|---|
| STS-SC-1 | 🟡 | BC | Fixed "Mutation count vs fraction genome altered" card when both attributes exist; no other X vs Y |
| STS-SC-2 | ✅ | B | 44×38 bins cut as the portal cuts them (FGA 0–1, MC from 0), a plasma dot per bin, the "# samples" legend; the middle label is the count at the middle of the bar (⚠ C6, [density-cases](density-cases.md)) |
| STS-SC-3 | ✅ | BC | Pearson and Spearman with p, as the portal writes them; shown whenever n > 2 (⚠ S9) |
| STS-SC-4 | ✅ | B | "Number of Samples", the x range to 2 places, the y range as formatRange |
| STS-SC-5 | ✅ | B | Swap Axes, Log Scale X / Y on the MC axis (kept by the browser); Download ▸ SVG, PDF with the legend and coefficients inside the file ([download-cases](download-cases.md) FG8); Data, the samples with both values (PC7) |
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
| STS-KM-2 | 🟡 | B | ↓ Patients of the selection, one curve, no p-value ✅; curve colour `SERIES[0]` #0072B2 (`lib/chart/style.ts:35`), legacy #2986E2 |
| STS-KM-3 | 🔶 | B | Full KM with axes, number-at-risk table and "median 81.4 mo · n = 590 · 120 events" line |
| STS-KM-4 | 🐞 ok | C | No selection on the curve (legacy's is dead code) |
| STS-KM-5 | ❌ | C | ↓ The Explore card sends only `{kind, endpoint}` (`explore-charts.tsx:79`): no "Left truncation" checkbox and no `TT_CPT_REPORT_MOS` entry anywhere |
| STS-KM-6 | ✅ | B | Download ▸ SVG, PDF of the curve with its number-at-risk table and legend ([download-cases](download-cases.md) FG9); Data, every selected patient's status and months (PC8) |

### §11 Added charts

| ID | verdict | how | note |
|---|---|---|---|
| STS-GS-1 | 🟡 | B | ↓ "KRAS: somatic mutations" Mutated / Not mutated / Not profiled = 218 / 316 / 60 (= legacy) ✅; drawn as a list without the portal's colours (#1b9e77 / #d95f02 / #D3D3D3), labels lower-case "Not mutated" (`lib/explore.ts:876-878`) |
| STS-GS-2 | ❌ | C | No mutation-type option |
| STS-GS-3 | 🟡 | B | ↓ "KRAS: copy-number alterations" Amplified / Gained / Diploid / Heterozygously deleted / Homozygously deleted / Not profiled = 6 / 128 / 390 / 67 / 1 / 2 (= legacy `/api/genomic-data-counts/fetch`) ✅, a click a `genomicData` clause on the discrete profile's values (`lib/explore.ts`, `lib/gene-state-clauses.ts`); drawn as a list without the portal's CNA colours |
| STS-GS-4 | ❌ | C | No continuous-profile gene bar |
| STS-GS-5 | 🟡 | C | Generic assays › one entity → histogram (`buildAssayFacets`), bars by the DataBinner over every study's values (as the portal's, 6 entities compared), ≤6 charts |
| STS-GS-6 | 🟡 | C | Categorical GA entity → value list (top 30) |
| STS-GS-7 | 🟡 | B | "Custom data" uploads become clinical-like facets (tag "custom") |

### §12 Special charts

| ID | verdict | how | note |
|---|---|---|---|
| STS-SP-1 | 🟡 | B | "Cancer Studies" card (study ids, %, samples) for more than one study only, "Explore only these" on pick; msk_impact_2017 + acc 10,945 / 92 as the portal ✅; a list, not a pie (no table past 20) |
| STS-SP-2 | ✅ | B | Cancer Type / Detailed are lists; a one-value Cancer Type is hidden (#188) |
| STS-SP-3 | 🟡 | B | "Number of Samples Per Patient" a list (not a pie); hidden when every patient has one sample (coadread) |
| STS-SP-4 | ✅ | C | No mutation-spectrum chart, as legacy |

### §13 Downloads

| ID | verdict | how | note |
|---|---|---|---|
| STS-DL-1 | 🟡 | B | Categorical charts (clinical pie or list, generic-assay categorical, gene state): Download ▸ Summary Data, as the portal writes it ([download-cases](download-cases.md) SD1–SD16). SVG and PDF of every chart but the gene tables, Data Types and Case Lists (FG1–FG10). Full Data of a clinical pie or list chart and a clinical bar chart's Data, read through the patient-level table route (PC1–PC14). Not yet: a gene-state or generic-assay chart's Full Data / Data |
| STS-DL-2 | ❌ | C | No download-hide switch (tracked: Data-governance switches) |
| STS-DL-3 | 🐞 ok | C | ↑ The gene-table TSV now exists (`lib/study-view-gene-tables.ts:103-115`): CNA writes profiled, then altered, under "Profiled Samples, #" (not swapped); Freq is the screen's on-panel Freq; no SV-pair table. None of the three legacy bugs copied |

### §14 Selection → filter summary

| ID | verdict | how | note |
|---|---|---|---|
| STS-FL-1 | ✅ | BC | Clauses AND across charts |
| STS-FL-2 | N/A | BC | Legacy inputs read: `filterJson`, `filterAttributeId` + `filterValues`, the "not available for this study" message (`lib/study-view-url.ts:100-121`, `explore-sections.tsx:285`). cBioLab also writes the filters to the URL (`filters=`, `app/lab/use-explore-state.ts:521-536`; #189), where legacy leaves it unchanged: N/A per invariant 9, a link carries what the reader sees |
| STS-FL-3 | ❌ | C | ↓ No manual-submit mode, so no "Add Filters" buttons or its alert |

### §15 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| STS-MD-1 | ✅ | B | Single study: one-value Cancer Type hidden (#188), the q-value icons shown (`lib/explore.ts:692`), no Cancer Studies card ✅ |
| STS-MD-2 | 🟡 | B | Multi: Studies breakdown, merged facets with "*" on partial attributes, panel-aware Freq ✅ (TP53 41.3 %); header "(overlap not deduplicated)" (invariant 3) |
| STS-MD-3 | ✅ | C | Freq = on-panel altered ÷ samples profiled for that gene + WES (`explore.ts:597-602`, invariant 7) |
| STS-MD-4 | ✅ | B | Patient attributes count patients ("Diagnosis Age · 592 patients", bar tip "patients") |
| STS-MD-5 | ✅ | BC | An attribute patient-level in one selected study and sample-level in another is read per sample in every study (`conflictingLevels`, `withSampleLevel` in `lib/custom-data.ts`) and charted once: blca_tcga + ampca_bcm_2016 GRADE as the portal (389 / 90 / 59 / 21 / 5 / 2, NA 7) |
| STS-MD-6 | ✅ | BC | Categorical and numeric charts both exclude their own filter (#188) |
| STS-MD-7 | ✅ | C | ≤10 distinct values → one bar per value (`DISTINCT_VALUE_THRESHOLD`) |
| STS-MD-8 | ✅ | B | Log bins chosen automatically (Days to Birth); the Log Scale item switches them off |
| STS-MD-9 | ✅ | B | Bar "NA n", pie NA slice, list NA row (#190) |
| STS-MD-10 | 🔶 | C | Shape from allowlist, not >20 categories |
| STS-MD-11 | N/A | C | cBioLab never shows cancer-gene icons, so there is nothing for this mode to hide (the gap is GT-6) |
| STS-MD-12 | ❌ | C | ↓ No manual-submit mode |
| STS-MD-13 | 🟡 | C | ↑ Custom bins, Log Scale and Show NA kept per study set, in the browser (`app/lab/use-explore-state.ts:149-172`), not per user; chart picks, layout and cancer-gene flags not saved; no restore banner |
| STS-MD-14 | ✅ | B | Empty: the message, no charts (see LY-11) |
| STS-MD-15 | ✅ | C | No host-specific priorities, as cbioportal.org |
| STS-MD-16 | ✅ | B | ↑ `.facetgrid` `auto-fill minmax(300px, 1fr)` (`app/globals.css:231`): fewer columns in a narrow window, charts reflow |

### §16 Persistence (no IDs)

Filters not in the URL (as legacy); study list and drivers toggle are (`?study=`, `?drivers=1`). Chart picks are browser state only; no per-user layout. Saving the draft is "Save as a Cohort" (library) or Analyze/Compare (document link).

### §17 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| STS-STM-1 | 🟡 | BC | ↓ Count by folded value at the attribute's level, NA row; all 40 categorical charts identical to the portal API on Q1, Q2, Q4. But the kept spelling is the most frequent (legacy the greatest), and a chart lists at most 200 values (`FACET_VALUE_LIMIT`, `lib/explore.ts:36`; OTHER_PATIENT_ID "showing 200 of 592 values") |
| STS-STM-2 | ✅ | BC | Disjunctive counts for categorical, derived, gene and assay facets; numeric charts counted over the other filters too (#188) |
| STS-STM-3 | ✅ | B | % of every case (Race White 48.0 % of 594) (#190) |
| STS-STM-4 | ✅ | C | The whole dispatch: discrete first, then CUSTOM (adjustCustomBins), GENERATE, MEDIAN, QUARTILE (median fallback), log unless disabled, scientific, linear. 29 recorded cases match the portal's bars (`test/fixtures/data-binner-methods.json`) |
| STS-STM-5 | ✅ | BC | Linear bins identical on every Q1 attribute (incl. AGE ≤35) |
| STS-STM-6 | ✅ | BC | Days to Birth log bins identical |
| STS-STM-7 | ✅ | C | Scientific-small binner ported (`lib/data-binner.ts`) |
| STS-STM-8 | ✅ | BC | Bins fixed for the study, not recomputed on the filtered cohort (#190) |
| STS-STM-9 | ✅ | C | Range clause `gt/lte` = (start, end]; bars of one chart OR (#188) |
| STS-STM-10 | ✅ | C | An empty Custom box is the default bars (sent as `bins: null`, which also overrides the MSI initial bins) |
| STS-STM-11 | ✅ | B | NA n = cohort − counted values (`explore.ts:965`): AGE 2, MC 60, FGA 11 match |
| STS-STM-12 | 🟡 | C | Quartiles/Median cut by the server over the selection's values (`compareQuantiles`); Current bins one group per bar ✅; quartiles single study only |
| STS-STM-13 | ✅ | BC | # = altered incl. off-panel, Freq = on-panel ÷ profiled, UNCALLED excluded; identical numbers. A sample on two panels counted once (`surplus`, `explore.ts:574-588`) where legacy counts per panel — no difference on these studies |
| STS-STM-14 | ✅ | B | Data types, events (patients), case lists (samples): counts identical to the portal API on Q1 and Q2, each with its Freq over the selected samples (events: patients) |
| STS-STM-15 | ✅ | BC | The portal's bins, cell rule, ln(1 + v) Log Scale and coefficients: coadread Pearson −0.3317, Spearman −0.3487, as on cbioportal.org |
| STS-STM-16 | ❌ | C | No violin |
| STS-STM-17 | ❌ | C | No gene violin |
| STS-STM-18 | ✅ | B | KM over the selection's patients: 590 / 120 / 81.4 and 280 / 56 / not reached, as legacy |
| STS-STM-19 | ✅ | B | Samples per study over the selection (`studyBreakdown`, `lib/explore.ts`): msk_impact_2017 + acc 10,945 / 92, Female 5,497 / 60, identical to the portal API |

---

## 5. cBioLab bugs (on its own terms)

Fixed since the first audit (#188): two bars of one histogram ANDing to nothing; a second click on a selected pie value re-adding it; a numeric chart collapsing under its own filter; constant attributes among the default charts.

Found on 2026-11-18 (master `bc53b944`):
