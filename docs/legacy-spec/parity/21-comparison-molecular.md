# Parity audit — Group Comparison › molecular tabs (spec `21-comparison-molecular.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright + its REST API from a cbioportal.org page, same day)
- **Code paths (cBioLab):** `app/portal/comparison/page.tsx`, `app/portal/comparison-layout.ts`, `app/portal/study-known.ts` (profile picks), `app/portal/results-layout.ts` (Results › Comparison/Survival); views `lib/views/enrichment/{run,figure,types}.ts` + `app/lab/kinds/enrichment.tsx`; `lib/views/diffexpr/{run,sql,types}.ts` + `app/lab/kinds/diffexpr.tsx`; `lib/views/assays/*` + `app/lab/kinds/assays.tsx`; `lib/views/mutcompare/*` + `app/lab/kinds/mutcompare.tsx`; SQL `lib/federation-views.ts:265-325`; tests `lib/stats.ts` (`fisherExact`, `chiSquareTest`, `welchT`, `oneWayAnova`, `benjaminiHochberg`); formats `lib/chart/format.ts` (`pDigits`, `portalP`, `fmtPct`); `lib/legacy-comparison.ts`

**Groups.** `brca_tcga_pan_can_atlas_2018`, cohorts `SUBTYPE = BRCA_<x>`. The sessions were built by cBioLab's `/api/legacy-comparison` (the "Open in cBioPortal" route), so legacy and cBioLab compare the same sample ids: G2 = Basal 171 · LumA 499; G5 = Basal 171 · Her2 78 · LumA 499 · LumB 197 · Normal 36. Groups are disjoint, so the overlap strategy does not change any number.

| # | Legacy | cBioLab |
|---|---|---|
| G2 | `/comparison/<tab>?comparisonId=6af47b7e795bfa2419d8e7a0` | `/portal/comparison?doc=eyJzdHVkeSI6ImJyY2FfdGNnYV9wYW5fY2FuX2F0bGFzXzIwMTgiLCJ2aWV3cyI6W10sImNvaG9ydHMiOnsiQmFzYWwiOnsiYWxsIjpbeyJraW5kIjoiY2xpbmljYWwiLCJhdHRyaWJ1dGUiOiJTVUJUWVBFIiwidmFsdWVzIjpbIkJSQ0FfQmFzYWwiXX1dfSwiTHVtQSI6eyJhbGwiOlt7ImtpbmQiOiJjbGluaWNhbCIsImF0dHJpYnV0ZSI6IlNVQlRZUEUiLCJ2YWx1ZXMiOlsiQlJDQV9MdW1BIl19XX19fQ&tab=<Tab>` |
| G5 | `/comparison/<tab>?comparisonId=6af47b7eb1971a03c3aa3e4f` | same doc with Basal, Her2, LumA, LumB, Normal |

Legacy numbers come from `POST /api/alteration-enrichments/fetch` (mutation-only, CNA-only, SV-only and default all-types requests), `/api/expression-enrichments/fetch`, `/api/generic-assay-enrichments/fetch` and `/api/generic-assay-categorical-enrichments/fetch`, with q recomputed by BH as the frontend does (STM-7). cBioLab numbers come from the `/api/analysis` result the page posts (captured), and the same views re-posted with `minAltered: 1`. Both tables were also scraped. Scripts and output: (local scratch, not committed) (`legapi.js`, `legapi2.js`, `legui.js`, `lab.js`, `labapi.js`, `cmpalt.py`, `cmpex.py`; `out/cmpalt.txt`, `out/cmp-*.txt`, `out/leg-*.png`, `out/lab-*.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 14 |
| 🟡 partial | 36 |
| 🔶 different | 24 |
| ❌ missing | 8 |
| 🐞 ok | 2 |
| 🐞 copied | 0 |
| N/A | 3 |
| ? | 1 |
| **Total IDs** | **88** |

**Overall: 21.6 %** (✅ 14 + 🐞ok 2 + N/A 3 = 19 of 88). Counting 🟡 as half: 42.0 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | ? | One line |
|---|---|---|---|---|---|---|---|---|---|
| §0 Tabs (TAB) | 8 | 0 | 3 | 4 | 1 | 0 | 0 | 0 | Tab order right; labels differ; Mutations tab hidden for ≠2 groups; no Pathways; overlap default Include |
| §1 Alteration types (AT) | 6 | 0 | 2 | 3 | 1 | 0 | 0 | 0 | No checkbox tree: three separate views (mutation / CNA / SV), no combined table, no [Select] |
| §1 Layout (AL) | 7 | 2 | 2 | 1 | 2 | 0 | 0 | 0 | Three charts + table per view; no Co-occurrence, no sample/patient or Enriched-in select; ≤300 rows |
| §1 Volcano (VO) | 6 | 0 | 4 | 1 | 1 | 0 | 0 | 0 | Present; y not capped at 10; group colours; drag-select only on expression/GA |
| §1 Frequency scatter (FS) | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | Present, top 300 genes only |
| §1 Bar plot (BP) | 4 | 0 | 3 | 1 | 0 | 0 | 0 | 0 | Default ordering only, fixed 10, from top-300 rows |
| §1 Filters (FL) | 3 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | Significant only ✅; group filter on expression/GA only |
| §2 Mutations tab (MU) | 8 | 3 | 5 | 0 | 0 | 0 | 0 | 0 | Table numbers identical; Fisher label format, Y-max, co-occurrence differ |
| §3 Expression (EX) | 7 | 4 | 2 | 0 | 0 | 0 | 1 | 0 | Columns, tips, numbers identical; 1,500-row cap |
| §3 Box plot (BX) | 5 | 1 | 2 | 0 | 1 | 0 | 0 | 1 | Plot view per group; no download |
| §4 Generic assay (GA, GN, GB, GC) | 5 | 1 | 1 | 2 | 0 | 1 | 0 | 0 | Numeric matches; binary/categorical tested differently |
| §5 Results › Comparison (RV) | 6 | 0 | 1 | 3 | 1 | 0 | 1 | 0 | Altered/Unaltered only; mutation + CNA; no expression sub-tabs, no add-to-query |
| §6 Modes (MD) | 11 | 0 | 3 | 5 | 1 | 1 | 1 | 0 | No patient level; a group without data refuses the expression tab |
| §8 Statistics (STM) | 11 | 2 | 5 | 4 | 0 | 0 | 0 | 0 | Counts, Fisher/χ², Welch/ANOVA identical; minAltered 5 changes q; NA handling differs |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **No combined Genomic Alterations table.** The tab holds three views (mutation, CNA, SV), each a type-specific table. Legacy has one row per gene, altered by any selected type, under a checkbox tree with [Select]. G2: TP53 154/171 in legacy (any type) vs 153/171 in cBioLab (mutation); MYC is legacy's #2 row and only in cBioLab's CNA view | AT-1..3, AL-5, STM-2 | not tracked |
| 2 | **Default `minAltered: 5` changes q and significance.** Genes with <5 altered samples are not tested, so BH divides by fewer genes: G2 mutation 3,108 vs 14,780 tested; DYNC2H1 q 0.0503 vs 0.239. SV: PUM1 q 0.0425 (significant) vs 0.533. CNA: 6,512 vs 6,156 significant. G5 mutation: 145 vs 336, because PPP1R16B (q 4.2e-7) and MARK3 are dropped. With `minAltered: 1` every q is identical | STM-7, AL-4 | not tracked |
| 3 | **Row caps:** alterations and GA tables list ≤300 rows, expression ≤1,500 (legacy lists all 22,871 / 20,026). The frequency scatter and bar plot are built from those 300 only | AL-5, FS, BP-2, GN, EX-5 | (tracked) expression 1,500 only |
| 4 | **No patient-level enrichments:** no Sample/Patient select; always samples | AL-4, MD-5 | not tracked |
| 5 | **Overlap default Include** ("Overlapping samples: include") vs legacy Exclude | MD-6, TAB-8 | not tracked |
| 6 | **Alteration number formats:** p/q "1.1e-82" (`pDigits`) vs "< 10^-10"; altered % to 1 dp ("89.5%") vs 2 dp ("90.06%"); group headers "Basal", not "(A) Basal"; volcano y uncapped (to 82) vs capped at 10 | STM-9, STM-3, AL-5, VO-1 | not tracked |
| 7 | **No Co-occurrence Pattern column** (mini oncoprint) on Genomic Alterations or Mutations | AL-6, MU-5 | (tracked) Mutations tab only |
| 8 | **Tabs follow the groups:** Mutations is hidden for ≠2 groups (legacy shows the tab with "We can't show mutations for more than 2 groups…"); expression tabs are hidden for >10 groups; no `tabHasBeenShown` | TAB-3, TAB-4, MD-2 | not tracked |
| 9 | **A group with no data refuses the whole expression tab.** G5 Protein: "no gene had at least 3 samples with a protein_quantification value in every cohort". Legacy drops Normal (no CPTAC data) and tests 4 groups over 9,719 genes | MD-8, STM-4 | not tracked |
| 10 | **Categorical GA:** NA is excluded (legacy counts it as a category), so p differs widely (1q 0.211 vs 5.9e-15; 7q 0.155 vs 0). The table and plot also differ | GC, STM-6 | (tracked) layout; NA not tracked |
| 11 | **Bar plot:** no options, no Select genes, fixed 10, and ranked within the 300 most significant rows | BP-1, BP-2 | not tracked |
| 12 | **Results › Comparison/Survival:** Altered vs Unaltered only (no per-track or Unprofiled groups); mutation + CNA views only (no SV, mRNA, Protein, Methylation); no "Add checked genes to query"; query genes not removed before q | RV-1..4, MD-9 | not tracked |
| 13 | **Driver filter is OncoKB**, not the custom `driver_filter`; no VUS / tier / germline switches | AT-6 | (tracked) Driver-annotation settings, custom drivers |
| 14 | **Alteration volcano is static:** no drag-select or click (expression/GA volcanoes have both); significant points coloured by group, not `#58ACFA` | VO-3, VO-5, FL-3 | not tracked |
| 15 | **Downloads** for the volcano, box plot and table; **Pathways tab** | VO-6, BX-5, TAB-7 | (tracked) both |

---

## 3. Number check

G2 = Basal vs LumA; G5 = five subtypes. "Top 20" = legacy's 20 lowest p, compared gene by gene (`out/cmpalt.txt`, `out/cmp-*.txt`).

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| G2 mutation: altered / profiled, every gene cBioLab lists (300) | STM-2 | e.g. TP53 153/171 vs 53/499; PIK3CA 12/171 vs 237/499; GATA3 0/171 vs 77/499 | identical (300 / 300) | ✅ |
| G2 mutation: p, top 20 | STM-1 | TP53 1.1e-82, PIK3CA 1.14e-24, CDH1 1.64e-14, MYH7B 2.18e-6, ARAP3 1.42e-3 | identical to 3 s.f. | ✅ |
| G2 mutation: q, top 20 (default view) | STM-7 | TP53 1.63e-78, MYH7B 6.45e-3, DYNC2H1 0.239, BRCA1 0.851 | 3.43e-79, 1.36e-3, 0.0503, 0.179 | 🔶 minAltered 5 → BH over 3,108 not 14,780 |
| G2 mutation: q with `minAltered: 1` | STM-7 | as above | identical; 14,780 tested, 7 significant both | ✅ |
| G2 mutation: log2 ratio, top 20 | STM-3 | 3.07, −2.76, −5.22, <-10 (GATA3), >10 (MROH5) | 3.07, −2.76, −5.22, "<-10", ">10" | ✅ |
| G2 mutation: enriched in, top 20 | STM-3 | Basal ×15, LumA ×5 | same | ✅ |
| G2 mutation: altered % display | STM-3 | "153 (89.47%)" (2 dp) | "153 (89.5%)" | 🟡 |
| G2 CNA: counts and p (300 rows) | STM-1/2 | MYC 61/171 vs 36/499, p 1.9e-17 | identical (300 / 300) | ✅ |
| G2 CNA: significant genes | STM-7 | 6,156 of 22,424 | 6,512 of 14,921 (min 5); 6,156 of 22,424 (min 1) | 🔶 default |
| G2 SV: counts and p | STM-1/2 | PUM1 5/171 vs 0/499, p 1.04e-3, q 0.533 | identical; q 0.0425 (min 5; 41 tested) / 0.533 (min 1) | 🔶 default q |
| G2 default table (any type) TP53 | STM-2 | 154/171 (90.06%) vs 55/499; 22,871 rows | no combined table (mutation 153/171) | 🔶 |
| G5 mutation: counts (300 rows) | STM-2 | TP53 153/55/53/71/11 | identical (300 / 300) | ✅ |
| G5 mutation: χ² p | STM-1 | PIK3CA 0, TP53 0 (double underflow); CDH1 1.11e-15; GATA3 2.62e-10 | 2.43e-20, 1.1e-84; 1.13e-15; 2.62e-10 | ✅ (cBioLab more precise; legacy shows "< 10^-10" either way) |
| G5 mutation: significant | STM-7 | 336 of 16,412 | 145 of 5,868 (min 5); 336 of 16,412 (min 1) | 🔶 default |
| G5 CNA / SV: counts | STM-2 | — | identical (300 / 300 each) | ✅ |
| G5 SV significant | STM-7 | 162 of 5,555 | 44 of 207 (min 5); 162 (min 1) | 🔶 default |
| G2 mRNA (`rna_seq_v2_mrna`, log2(x+1)): μ, σ, p, q, top 20 | STM-4 | TTC36 0.82±0.81 vs 5.84±1.74, p 8.05e-220, q 1.61e-215 | identical; max \|Δμ\| 3.6e-15, max rel Δp 3e-11 | ✅ |
| G2 mRNA: genes tested / significant | STM-4/7 | 20,026 / 15,259 | 20,026 / 15,259 | ✅ |
| G5 mRNA (ANOVA): μ, σ | STM-4 | A2ML1 8.46/5.38/1.78/2.41/4.79 | identical | ✅ |
| G5 mRNA: p | STM-4 | 0 for most top genes (F-test underflow) | 4.71e-171 (A2ML1) etc. | ✅ (legacy precision artefact) |
| G5 mRNA: tested / significant | STM-4/7 | 20,039 / 18,184 | 20,039 / 18,184 | ✅ |
| G2 Protein (`protein_quantification`): μ, σ, p, q, n | STM-4 | AGR3 −1.57 vs 0.32, p 3.8e-14, q 3.7e-10; n 24/33 | identical; 9,719 tested, 1,093 significant both | ✅ |
| G5 Protein | MD-8, STM-4 | 9,719 genes over 4 groups (Normal has no data, dropped) | refused for the whole tab | 🔶 |
| G2 Methylation GA (`methylation_hm27_hm450_merge`) | STM-4, GN | cg17095936 0.93 vs 0.40, p 3.37e-233; 22,601 tested, 10,600 significant | same p to 3 s.f.; 22,601 / 10,600; \|Δμ\| ≤ 6.6e-6, p within ≤1.1 % (cg11300809 1.15e-62 vs 1.13e-62) | 🟡 storage precision (data, not method) |
| G2 Arm-level CNA (categorical χ²) | STM-6 | 1q 5.9e-15, 7q 0, 11q 1.3e-4, 16q 1.1e-16; 33 of 39 p = 0 | 1q 0.211, 7q 0.155, 11q 0.0669, 16q 5.8e-8 | 🔶 NA excluded (4,234 values) vs NA a category |
| G2 Mutations tab TP53: rows | STM-8 | 132 protein changes; R342* 6 (3.51%) vs 0, >10, 2.587e-4, 0.0269; R175H 9 vs 4, 2.71, 1.036e-3 | 132; identical on every row read (14) | ✅ |
| G2 Mutations tab: gene Fisher label | MU-4 | "< 10-10" | "1.10e-82 ((A) 153 of 171 profiled patients, 89.5%; (B) 53 of 499 …)" | 🟡 format |
| G2 Mutations tab: badges | MU-5 | Basal Driver 159 / VUS 0; LumA 51 / 2 | 158 / 1; 50 / 3 | 🟡 hotspot drivers (tracked) |
| G2 Highest Frequency genes | MU-1 | TP53 PIK3CA TTN CDH1 GATA3 MAP3K1 MUC16 KMT2C USH2A SPTA1 | identical | ✅ |
| G2 mutation bar plot genes | BP-2 | (mutation-only ranking) …MAP3K1, MUC16 (12.3 %), KMT2C, USH2A, SPTA1 | …MAP3K1, KMT2C, USH2A, SPTA1, SYNE1 (9.4 %): MUC16 absent | 🔶 cBioLab bug |
| Patient-level (G2, mutation) | MD-5 | TP53 153/171 vs 53/499 (1 sample/patient here) | no patient mode | ❌ |

Data version: every altered/profiled count, every expression mean and every p matches, so the warehouse and cbioportal.org hold the same data for this study. The only drift is the methylation GA values (≤6.6e-6), consistent with lower-precision storage.

---

## 4. Scorecard

### §0 Tabs, visibility and gating

| ID | verdict | how | note |
|---|---|---|---|
| CMM-TAB-1 | 🟡 | B | Order matches: Overlap · Survival · Clinical · Genomic Alterations · Mutations · mRNA · Protein · GA tabs. Labels differ: no "Beta!"; "Arm-level copy number" vs "Arm-level CNA"; "Genetic ancestry", "Phosphosite quantification" in sentence case. An extra "Clinical Data" tab. URL `&tab=<title>`, not a path |
| CMM-TAB-2 | 🟡 | BC | mRNA `rna_seq_v2_mrna`, Protein `protein_quantification`, Methylation GA `hm27_hm450_merge` are legacy's picks (`study-known.ts:114-156`). GA: one profile per type, its own order, at most 6 tabs. Alterations read every profile of a kind together (tracked: "One of several … profiles is refused") |
| CMM-TAB-3 | 🔶 | BC | Mutations tab hidden for ≠2 groups (`comparison-layout.ts:30`); legacy shows the tab with a message. Expression tabs need 2–10 groups. The page is single-study, so the multi-study rule does not arise |
| CMM-TAB-4 | 🔶 | C | Tabs are recomputed from the current groups (`groupsOk`, `mutationsOk`); no `tabHasBeenShown` |
| CMM-TAB-5 | 🔶 | C | Own refusal texts: "an enrichment view compares two or more cohorts…", the `left` list "Mutations (compares exactly 2 groups…)". No legacy wording; no OverlapExclusionIndicator (the page has an "Overlapping samples" choice) |
| CMM-TAB-6 | 🟡 | C | Empty → refusal "no gene had at least 5 altered samples (…) across these cohorts" (`enrichment/run.ts:67`), not "No data/result available" |
| CMM-TAB-7 | ❌ | C | No Pathways tab (tracked) |
| CMM-TAB-8 | 🔶 | B | Overlap default Include (legacy Exclude). Group order = document order. Tables use bare names ("Basal"); only the Mutations tab uses "(A) Basal". Colours from the series palette |

### §1 Genomic Alterations — alteration types

| ID | verdict | how | note |
|---|---|---|---|
| CMM-AT-1 | 🔶 | B | No checkbox tree. Each view has an "alteration" select: mutation · amp or deep deletion · amplification · deep deletion · structural variant (`app/lab/kinds/enrichment.tsx:233`). No mutation subtypes |
| CMM-AT-2 | 🔶 | B | Default is three views (mutation, CNA, SV), each with its own table and charts; no combined any-type table |
| CMM-AT-3 | ❌ | B | No [Select]; a change re-runs at once |
| CMM-AT-4 | 🟡 | C | Choice kept in the document (`?changes=`, invariant 9), not `selectedEnrichmentEventTypes` |
| CMM-AT-5 | 🟡 | C | Uncalled excluded ✅, CNA ±2 ✅, SV ✅ (`federation-views.ts:272-277`). **Off-panel calls are excluded** (`NOT g.off_panel`); legacy counts them. No partial mutation-type sets |
| CMM-AT-6 | 🔶 | BC | Page-level "Alterations: all / OncoKB drivers only" uses OncoKB, not the DB `driver_filter`. No VUS / tier / germline (tracked: Driver-annotation settings, Custom driver annotations) |

### §1 Genomic Alterations — layout

| ID | verdict | how | note |
|---|---|---|---|
| CMM-AL-1 | ✅ | B | Volcano · frequency scatter · "Genes with highest frequency in any group", per view |
| CMM-AL-2 | ✅ | B | G5: bar plot only |
| CMM-AL-3 | 🟡 | B | View headers "MUTATIONS — Basal vs LumA", "COPY-NUMBER ALTERATIONS — …", "STRUCTURAL VARIANTS — …"; no single "Genomic Alterations" header |
| CMM-AL-4 | 🟡 | B | Significant only ✅. No Sample/Patient select; no "Enriched in ..." select. Extra controls: "count any/drivers", "test genes altered in ≥ 5" |
| CMM-AL-5 | 🔶 | B | Columns `Gene \| Cytoband \| Basal \| LumA \| Log2 Ratio \| p-Value \| q-Value \| Enriched in`. Differences: no Co-occurrence; cells "153 (89.5%)"; no "(A)"; p/q `pDigits`; p never bold. 25 rows a page of ≤300 ("the 300 most significant of 3,108 genes tested"). Header tip "altered / profiled in Basal" and no per-cell profiled tooltip. Initial sort q ✅; G5 "Most enriched in" ✅ |
| CMM-AL-6 | ❌ | B | No Co-occurrence MiniOncoprint (tracked only for the Mutations tab) |
| CMM-AL-7 | ❌ | C | Row click does nothing (no highlight) |

### §1 Volcano (CMM-VO)

| ID | verdict | how | note |
|---|---|---|---|
| CMM-VO-1 | 🟡 | B | Top 300 (alterations, GA) / 1,500 (expression) drawn as points, the rest as a density grid. Null ratio drawn at the axis edge ✅. **y not capped at 10** (G2 mutation axis to 100, TP53 at 82). Corner labels "← LumA / Basal →" ✅; no "Significance →" |
| CMM-VO-2 | 🟡 | B | Alterations x ±10, ticks −10, −5, 0, 5, 10 (legacy ±15, ticks −10, 0, 10). Expression ±`niceCeil(max\|x\|)` |
| CMM-VO-3 | 🔶 | B | q<0.05 points take the enriched group's colour (blue / orange), others grey; legacy `#58ACFA` / `#D3D3D3`, selection `#FE9929` |
| CMM-VO-4 | 🟡 | C | Alterations: SVG `<title>` "TP53: Basal 89.5% (153 / 171), LumA … · q 3.4e-79", not Gene / Log2 Ratio / p / q lines |
| CMM-VO-5 | 🟡 | BC | Expression / GA: `PickVolcano` drag-select filters the table and a click picks the gene ✅. Alterations: static `DrawAtWidth`, no selection |
| CMM-VO-6 | ❌ | C | No SVG/PNG download button (tracked: comparison Downloads) |

### §1 Frequency scatter, bar plot, filters

| ID | verdict | how | note |
|---|---|---|---|
| CMM-FS | 🟡 | B | X "Altered frequency in Basal (%)", Y "… LumA (%)", dashed diagonal, [0, max] ✅. Only the 300 listed genes ("the 300 most significant genes"); group colours; tooltip is an SVG title; no drag |
| CMM-BP-1 | 🟡 | B | Title "Genes with highest frequency in any group" ✅; no [Select genes], no download |
| CMM-BP-2 | 🔶 | BC | Only the default ordering, fixed 10 genes, no option select / Number input. **Ranked within the 300 most significant rows** (`enrichment/figure.ts:58`): MUC16 (12.3 % Basal) is missing |
| CMM-BP-3 | 🟡 | B | One bar per group, height = %, "*" when q<0.05 ✅ (+ footnote). Y label always "Alteration frequency (%)" |
| CMM-BP-4 | 🟡 | C | Bar `<title>` "TP53 in Basal: 89.5% (153 / 171)"; no p/q, no group table. Legacy falsy-0 bug not applicable |
| CMM-FL-1 | ✅ | BC | "Significant only" = q < 0.05 |
| CMM-FL-2 | 🟡 | BC | Expression / GA "High expression in" / "High methylation in" / "High in": keeps rows whose higher group is selected (`diffexpr.tsx:43`). Legacy mean-0 bug not reproduced. Alterations have no group filter |
| CMM-FL-3 | 🟡 | C | Expression / GA: volcano selection ANDed with the filters ✅; alterations have no selection |

### §2 Mutations tab

| ID | verdict | how | note |
|---|---|---|---|
| CMM-MU-1 | 🟡 | B | "Highest Frequency:" pills identical (TP53 … SPTA1); gene field, not the searchable dropdown (tracked); ranking ignores the driver / event settings (tracked) |
| CMM-MU-2 | ✅ | B | "TP53 mutations: (A) Basal vs (B) LumA" |
| CMM-MU-3 | 🟡 | B | Mirrored lollipop; "(A) Basal / % mutated of 171 profiled pts" ✅; `%` / `#` ✅ (document). No Top/Bottom Y-Axis Max (tracked); stem tooltip differs (tracked) |
| CMM-MU-4 | 🟡 | B | "Fisher Exact Two-Sided Test p-value for all mutations - (A) Basal vs (B) LumA: 1.10e-82 ((A) 153 of 171 …)"; legacy "< 10-10". "all" only (tracked) |
| CMM-MU-5 | 🟡 | B | 132 rows; counts, %, log2, p, q identical on every row read. No Co-occurrence (tracked). Mutation Type is the class ("Truncating") vs legacy type ("Nonsense", "FS ins"). Annotation shows text "Oncogenic"; Enriched in shows "Basal" not "(A) Basal". Badges 158/1 vs 159/0 (hotspots, tracked). Group filter + Significant only ✅ |
| CMM-MU-6 | 🟡 | B | Patient-level ✅ ("profiled patients"); no overlap banner (tracked) |
| CMM-MU-7 | ✅ | C | Same messages (`mutcompare/run.ts:103,132`) |
| CMM-MU-8 | ✅ | C | Results › Comparison/Survival has no Mutations sub-tab (`results-layout.ts:228-235`) |

### §3 mRNA / Protein / DNA Methylation

| ID | verdict | how | note |
|---|---|---|---|
| CMM-EX-1 | 🟡 | B | "DATA SET" select with the profile name; refetches; kept in the document. No ⓘ description (tracked) |
| CMM-EX-2 | ✅ | B | Volcano (2 groups) + box panel; no scatter / bar. GSEA locked off on the portal page |
| CMM-EX-3 | ✅ | B | h3 = profile name ("mRNA Expression, RSEM (Batch normalized from Illumina HiSeq_RNASeqV2)") |
| CMM-EX-4 | ✅ | BC | "High expression in" / "High methylation in", Significant only; no sample/patient select |
| CMM-EX-5 | 🟡 | B | Columns and tips word for word (μ / σ "Mean log2 expression…", Log2 Ratio "(unlogged)" tip kept, "Higher expression in"). p tip "Derived from Welch's two-sided t-test", which corrects legacy's "Student's". `portalP` ✅, q bold ✅. Lists 1,500 of 20,026 (tracked) |
| CMM-EX-6 | ✅ | C | Row or volcano click sets `gene` → plot by cohort (`diffexpr.tsx:44,86`) |
| CMM-EX-7 | N/A | — | Not a requirement |

### §3 Box plot (CMM-BX)

| ID | verdict | how | note |
|---|---|---|---|
| CMM-BX-1 | 🟡 | C | "Click on gene in the table to render this plot." ✅. Data = a `plot` view per cohort, unit sample, `log: true` for log2 profiles (`diffexpr.tsx:44`); negative-value handling follows the plot view, not legacy's unclamped log |
| CMM-BX-2 | 🟡 | C | Drawn by the plot view (geometry → 04-plots) |
| CMM-BX-3 | ✅ | C | "TBX19 · p-Value: 3.37e-233 · q-Value: …" line above the plot (`portalP`) |
| CMM-BX-4 | ? | — | Point tooltip not hovered; it belongs to the plot view |
| CMM-BX-5 | ❌ | C | No SVG/PNG/Data (tracked) |

### §4 Generic assay tabs

| ID | verdict | how | note |
|---|---|---|---|
| CMM-GA-1 | 🐞 ok | BC | "DATA SET" select; each choice re-runs that profile (no stale binary/categorical map) |
| CMM-GA-2 | ✅ | B | "Gene / Probe"; cell bold "TBX19 (cg17095936)" |
| CMM-GN | 🟡 | B | Layout and columns match (μ / σ, "Log Ratio", "Higher in", "High in"), Welch / ANOVA ✅; table capped at 300 of 22,601 (not tracked) |
| CMM-GB | 🔶 | C | BINARY is tested as categorical (χ² on values × cohorts, `assays/run.ts:57-61`); legacy uses Welch t on 0/1, frequency columns, volcano, scatter and bar plot |
| CMM-GC | 🔶 | B | Table `Entity \| Basal n \| LumA n \| p \| q \| Higher in ("Basal · Loss")`, not Attribute Type / Statistical Test; the side panel shows the value mix, with no plot type / swap / horizontal / Show NA / p-q options (tracked). NA excluded (see STM-6) |

### §5 Results View › Comparison

| ID | verdict | how | note |
|---|---|---|---|
| CMM-RV-1 | 🔶 | C | "Comparison/Survival" sub-tabs: Overlap · Survival · Clinical · Genomic Alterations (mutation + CNA views, no SV) · GA tabs. No mRNA / Protein / DNA Methylation; no Mutations ✅ |
| CMM-RV-2 | 🔶 | C | Altered vs Unaltered only (`results-layout.ts:194`); no per-track groups, Unprofiled group, user groups or group order |
| CMM-RV-3 | ❌ | C | No gene checkboxes / [Add checked genes to query] |
| CMM-RV-4 | 🔶 | C | Query genes stay in the enrichment and in BH (`enrichment/run.ts` has no removal) |
| CMM-RV-5 | 🟡 | C | Choices persist in the document (`?changes=`); no patient level |
| CMM-RV-6 | N/A | C | No `skin_show_settings_menu` equivalent; controls always inline |

### §6 Modes & conditions

| ID | verdict | how | note |
|---|---|---|---|
| CMM-MD-1 | 🟡 | B | Volcano + scatter + Log2 Ratio + Enriched in ✅; Mutations ✅; no Co-occurrence |
| CMM-MD-2 | 🟡 | B | No volcano / scatter / ratio ✅, "Most enriched in" ✅, χ² ✅, ANOVA ✅; Mutations tab hidden instead of the message |
| CMM-MD-3 | 🔶 | C | Page needs ≥2 cohorts; fewer active → views refuse in their own words |
| CMM-MD-4 | 🔶 | C | The page compares one study's groups (`doc.study`); the enrichment engine sums across studies, but the Comparison page cannot hold multi-study groups |
| CMM-MD-5 | ❌ | BC | No patient-level enrichments; caveat "counted in SAMPLES" |
| CMM-MD-6 | 🔶 | B | Exclude available ✅; default Include (legacy Exclude) |
| CMM-MD-7 | 🐞 ok | C | A gene unprofiled in any cohort is "not tested" (`enrichment/run.ts:58`), not p = 0. Off-panel calls excluded (AT-5) |
| CMM-MD-8 | 🔶 | B | Needs ≥3 values in **every** cohort (`diffexpr/run.ts:79`; legacy ≥2 per group, dropping the group). G5 Protein: whole tab refused |
| CMM-MD-9 | 🔶 | C | See RV-1..4 |
| CMM-MD-10 | N/A | C | No settings-menu deployment switch |
| CMM-MD-11 | 🟡 | B | Data Set dropdown on mRNA / Protein / GA ✅; alterations read all profiles of a kind (tracked) |

§7 Persistence (no IDs): alteration type, measure, minAltered, data set, picked gene and axis mode live in the document (`?changes=`, invariant 9). Group on/off and overlap are in `?off=` / `?overlap=`. Significant only, the group filter and the volcano selection stay in the browser, as in legacy. Legacy does not persist the Data Set; cBioLab does.

### §8 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| CMM-STM-1 | ✅ | BC | Two-sided Fisher p identical (G2 mutation / CNA / SV). χ² identical where legacy is representable; legacy's underflow to 0 is not copied (G5 PIK3CA 2.43e-20). Panel p = 0 bug not reproduced (MD-7). Fisher uses a 1e-9 relative tolerance (`stats.ts:23`); no visible effect |
| CMM-STM-2 | 🟡 | B | Altered / profiled identical for all 300 listed genes in each of mutation, CNA and SV, G2 and G5. No combined any-type count. Off-panel calls excluded. No PATIENT mode |
| CMM-STM-3 | 🟡 | B | Log2 ratio identical; null → ">10" / "<-10" ✅; enriched-in identical on the top 20. % at 1 dp (legacy 2). A tie of equal non-zero shares goes to the first group (`indexOf(max)`), legacy to the second |
| CMM-STM-4 | 🟡 | B | Welch t and classic ANOVA, log2(x+1) for RNA-seq: μ, σ, p, q, tested counts identical (G2 / G5 mRNA, G2 protein). Differences: min 3 values per cohort vs 2 per group, and every cohort required (MD-8); negative RNA-seq values dropped (`diffexpr/sql.ts:216`) vs clamped to 0 |
| CMM-STM-5 | 🔶 | C | Binary assays: χ² on categories, not Welch on 0/1; no frequency / log ratio |
| CMM-STM-6 | 🔶 | B | χ² ✅, but NA / blank excluded (4,234 values for arm-level) where legacy counts NA strings as a category. 1q 0.211 vs 5.9e-15; 7q 0.155 vs 0; 11q 0.0669 vs 1.3e-4. q by BH in the app vs legacy backend |
| CMM-STM-7 | 🔶 | B | Same BH (q identical at `minAltered: 1`). Default `minAltered: 5` shrinks n: q 2–5× smaller and significance counts differ (Number check). Expression / GA: BH over all tested ✅ |
| CMM-STM-8 | ✅ | B | Per protein change: patients, %, log2, Fisher p, BH q identical (TP53 G2) |
| CMM-STM-9 | 🔶 | B | Alterations: `pDigits` ("1.1e-82", "0.0014"; "<1e-300") vs `toConditionalPrecisionWithMinimum` ("< 10-10", "1.036e-3"). Volcano y not capped at 10. Expression / GA / Mutations tables use `portalP` ✅. Log ratio 2 dp ✅ |
| CMM-STM-10 | 🟡 | B | q < 0.05 drives bold q, coloured enriched-in, "*", Significant only ✅. Alterations p not bold; points take group colours |
| CMM-STM-11 | 🟡 | C | Plot view values per sample per cohort, log for log2 profiles; negatives per the plot view |

---

## 5. cBioLab bugs (broken on its own terms)

- **Bar plot misses frequent genes.** "Genes with highest frequency in any group" ranks only the ≤300 most significant rows (`lib/views/enrichment/figure.ts:58`). In G2 mutation, MUC16 (21/171 = 12.3 % in Basal) is left out and SYNE1 (9.4 %) is drawn. Any frequent gene that does not differ between the groups can drop out the same way.
- **Protein tab refuses five groups** when one group has no data: "no gene had at least 3 samples with a protein_quantification value in every cohort". The tab is offered, then shows only a refusal, though four groups hold 9,719 genes' values (`diffexpr/run.ts:79,97`).
- **SV view tests 41 genes by default** (`minAltered: 5`) and calls PUM1 significant (q 0.0425); with every altered gene tested it is not (q 0.533). The default threshold makes the q-value depend on a display setting (STM-7).

**Not verified:**
- Volcano / box-plot point tooltips (headless hover).
- Patient-level legacy numbers beyond confirming the request (cBioLab has no patient mode).
- Binary GA: no binary profile in this study, so code only.
- Multi-study groups: the page takes one study.
- Results › Comparison sub-tabs: code only.
