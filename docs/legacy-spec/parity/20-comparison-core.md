# Parity audit — Group Comparison core: shell, Overlap, Survival/KM, Clinical; Results › Comparison/Survival (spec `20-comparison-core.md`)

- **Date:** 2026-11-11; re-measured 2026-11-18 against master `bc53b944` (dev server `http://127.0.0.1:3109`; G1 and G2 rebuilt as `?doc=` documents) and cbioportal.org (the G1 and G2 sessions' Survival and Clinical tabs, the portal API's clinical data): 16 verdicts changed, 2 of them down (CMP-SV-6, CMP-STM-6)
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day)
- **Code paths (cBioLab):** `app/portal/comparison/page.tsx` (page, groups, overlap choice), `app/portal/comparison-layout.ts` (tabs), `app/portal/results-layout.ts` (RV groups, Comparison/Survival sub-tabs), `app/portal/portal-chrome.tsx` (group chips), `app/portal/PortalTabs.tsx` (tab rendering: figure only for survival/clinical), `lib/partition-arms.ts` (`exclusiveCohorts`, limits), `lib/views/overlap/{run,sql,figure}.ts`, `lib/views/survival/{run,figure}.ts`, `lib/survival-sql.ts`, `lib/stats.ts` (`kaplanMeier`, `logRank`, `logRankK`, `survivalAxis`), `lib/views/clinical/{run,figure}.ts`, `lib/legacy-comparison.ts` + `app/api/legacy-comparison/route.ts` (session hand-off)

**Group sets** (identical sample lists in both apps: cBioLab's `/api/legacy-comparison` built each session, saved to cbioportal.org's session service from the browser)

| # | Groups (coadread_tcga_pan_can_atlas_2018) | Legacy | cBioLab |
|---|---|---|---|
| G1 two groups | Female (SEX=Female, 280), Male (SEX=Male, 312) | `/comparison/overlap?comparisonId=6af47b8eb1971a03c3aa3e50` | `/portal/comparison?doc=<{study, cohorts:{Female, Male}}>` (base64url) |
| G2 overlapping | Male 312, Female 280, KRAS (OQL `KRAS`, 222) | `/comparison/overlap?comparisonId=6af47e8db1971a03c3aa3e5a` (default Exclude; `&overlapStrategy=Include`) | same doc with Male, Female, KRAS; `&overlap=exclude` for Exclude |
| G2′ Include partitions | Only Male / Only Female / Male∩KRAS / Female∩KRAS as cohorts | (legacy hides them: "Only (C) KRAS" has 1 patient < Min. 3) | `/api/analysis` |
| R1 Results | KRAS: Altered / Unaltered | `/results/comparison/survival?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=…_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS` (numbers from the spec, same day) | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS` › Comparison/Survival |

cBioLab numbers for PFS/DFS/DSS and the chosen clinical attributes read from `/api/analysis` (the portal tab draws OS and 8 attributes only). Scripts, logs, screenshots: (local scratch, not committed) (`leg.js`, `lab.js`, `labapi.js`, `labparts.js`; `out/leg-*.log|png`, `out/lab-*.log|png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 11 |
| 🟡 partial | 30 |
| 🔶 different | 8 |
| ❌ missing | 20 |
| 🐞 ok | 0 |
| 🐞 copied | 0 |
| N/A | 4 |
| ? | 0 |
| **Total IDs** | **73** |

**Overall: 20.5 %** (✅ 11 + 🐞ok 0 + N/A 4 = 15 of 73). Counting 🟡 as half: 41.1 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Page shell (PG) | 4 | 0 | 4 | 0 | 0 | 0 | 0 | `?doc=` link, single study only; overlap choice always shown, default Exclude; Survival only with survival data |
| §1 Group selector (GS) | 9 | 0 | 3 | 2 | 3 | 0 | 1 | Chips with swatch + one count; toggle on/off (2–6 on); no ordinals, drag, popover, Select/Deselect all |
| §2 Overlap (OV, OX) | 7 | 0 | 3 | 1 | 3 | 0 | 0 | Area-proportional circles ≤3 groups, patient UpSet >3; counts right; no region selection, create-group, download or banner |
| §3 Survival tab (SV) | 8 | 1 | 5 | 1 | 1 | 0 | 0 | Survival-type table and Include partitions as the portal's; no alerts; a plot even when Min. # hides every row |
| §4 KM chart (KM) | 11 | 1 | 4 | 1 | 5 | 0 | 0 | Curves to the last follow-up, at-risk, median (CI)/n/events; no HR, landmarks, slider, tooltips, censor marks, download |
| §5 Clinical (CL) | 4 | 0 | 2 | 0 | 2 | 0 | 0 | Every attribute in the portal's table; no download, column menu or per-attribute plot |
| §6 RV tab (RV) | 6 | 0 | 3 | 1 | 2 | 0 | 0 | Altered/Unaltered only, Unaltered 312 vs legacy 372; no mRNA/Protein sub-tabs |
| §7 Modes (MD) | 13 | 3 | 3 | 1 | 3 | 0 | 3 | Exclude counts identical; Include partitions; log-rank at any size; no multi-study page |
| §9 Statistics (STM) | 11 | 6 | 3 | 1 | 1 | 0 | 0 | KM n/events/median (CI), log-rank p, survival q, Wilcoxon p identical; 2 × 2 chi² without the portal's Yates correction; no HR |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Clinical tab tests the 8 most-covered attributes only** (coadread: IN_PANCANPATHWAYS_FREEZE, CANCER_TYPE_DETAILED, ONCOTREE_CODE, CANCER_TYPE_ACRONYM, SAMPLE_TYPE, CANCER_TYPE, SAMPLE_COUNT, SOMATIC_STATUS — mostly constant); legacy tests all 45. Sex is not even tested in a Sex comparison. Shown as a −log₁₀ q bar chart: no p column, no type/test columns, raw ids, no sort/filter/download, no click-through plot | CL-2, CL-3, CL-4, STM-8 | not tracked |
| 2 | **No hazard ratios** (checkbox, control group, legend HR, HR matrix) | KM-1, KM-8, STM-5 | not tracked |
| 3 | **Survival tab is OS only**: no survival-type table (PFS/DFS/DSS with p/q, Min. # patients slider), no way to pick another endpoint on the portal tab | SV-1, SV-5, SV-6, STM-4 | not tracked |
| 4 | **Overlap default and Include semantics**: default Include (legacy Exclude); Include survival puts a shared patient in several curves and runs log-rank on non-independent groups (G2: k-group p = 0.910), where legacy partitions patients into "Only …" curves | PG-3, SV-4, MD-2 | not tracked |
| 5 | **KM chart controls missing**: X-Axis Max slider, landmarks, point tooltips, censor "+" marks, download (SVG/PNG/PDF/Data) | KM-1, KM-3, KM-4, KM-7, KM-10 | not tracked |
| 6 | **KM x-axis ends at the last event**, not the last follow-up (`survivalAxis`, `lib/stats.ts:160-165`): G1 OS drawn to ~77 mo, legacy 149; the censored tail and its at-risk counts are cut | KM-3, KM-6 | not tracked |
| 7 | **Results › Unaltered group** requires profiling in every data type: 312 vs legacy 372 (legacy: unaltered among samples not totally unprofiled) → OS Unaltered 309/64, p 0.616 vs legacy 369/74, p 0.632; no Unprofiled or per-gene groups | RV-3 | not tracked |
| 8 | **Numeric clinical test**: Welch t / Welch ANOVA as the reported p and the q basis; legacy Wilcoxon / Kruskal-Wallis (G1 Weight 2.80e-7 vs 3.86e-8; MSI MANTIS 0.0745 vs 0.798). cBioLab's rank p (computed, matches legacy) is not shown on the portal | STM-7 | not tracked |
| 9 | **No median 95 % CI**, median shown to 1 decimal ("62.8 mo" vs "62.79 (56.25 - NA)"); p to 2 digits ("0.68" vs "0.684") | KM-9, STM-2, STM-10 | not tracked |
| 10 | **Log-rank refused when any curve has < 10 patients**; legacy computes it at any size | MD-10, STM-3 | not tracked |
| 11 | **No overlap/exclusion banner** ("Samples (221) that overlap … are excluded …") on any tab | OX, CL-1, SV-3 | (tracked) for the Mutations tab only |
| 12 | **Group selector**: no ordinals "(A)", no drag reorder, no hover popover / Open in study view, no Select all / Deselect all, no S/P counts, no excluded strike-through | GS-1…GS-7 | not tracked |
| 13 | **Overlap tab not interactive**: no region selection, no "Create Group From Selected Diagram Areas", no download; UpSet for patients only; in Exclude mode it draws the overlap-removed groups (legacy draws the originals) | OV-1, OV-4, OV-5, OV-6 | not tracked |
| 14 | **Exclude is refused** for groups that differ in more than one condition, or a group wholly inside another (`lib/partition-arms.ts:139-140`), instead of legacy's iterative exclusion of emptied groups | STM-9, MD-1 | not tracked |
| 15 | **Comparison page is single-study** (doc `study`); no "Multiple studies" header or multi-description warning | PG-2, MD-8 | not tracked |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| G1 group sizes (samples = patients) | STM-11 | Female 280, Male 312 | 280, 312 | ✅ |
| G1 overlap (Venn samples / patients) | STM-9 | 280 / 312, no overlap | 280 / 312, no overlap | ✅ |
| G1 OS n / events | STM-1 | Female 280/56, Male 310/64 | 280/56, 310/64 | ✅ |
| G1 OS median (95 % CI) | STM-2 | Female NA; Male 62.79 (56.25 - NA) | not reached; 62.8 mo (no CI) | 🟡 median ✅, CI missing |
| G1 OS log-rank p | STM-3 | 0.684 | 0.6838 → "p = 0.68" (χ² 0.166) | ✅ value, 🟡 2 digits |
| G1 PFS n/events, median, p | STM-1..3 | 280/62, 310/88; Male 63.12 (41.65 - NA); p 0.119 | 280/62, 310/88; 63.12; p 0.1188 | ✅ (API) |
| G1 DFS n/events, p | STM-1, 3 | 106/10, 117/20; p 0.0221 | 106/10, 117/20; p 0.02210 | ✅ (API) |
| G1 DSS n/events, p | STM-1, 3 | 270/32, 299/41; p 0.464 | 270/32, 299/41; p 0.4636 | ✅ (API) |
| G1 survival-type q (DFS/PFS/DSS/OS) | STM-4 | 0.0884 / 0.238 / 0.618 / 0.684 | — | ❌ |
| G1 Number of Patients per type | SV-5 | DFS 223, PFS 590, DSS 569, OS 590 | sum of curve n: 223, 590, 569, 590 | ✅ values (no table) |
| G1 OS HR Male vs Female | STM-5 | 1.077 (0.753 - 1.541); diag 1.000 (0.695-1.438) | — | ❌ |
| G1 at risk at 0 months | KM-6 | 280 / 310 | 280 / 310 | ✅ |
| G1 Sex (chi²) | STM-6 | < 10^-10 | 9.2e-131 | ✅ |
| G1 Race Category (chi²) | STM-6 | 0.245 | 0.2452 | ✅ |
| G1 Subtype (chi²) | STM-6 | 0.446 | 0.4461 | ✅ |
| G1 AJCC_PATHOLOGIC_TUMOR_STAGE (chi²) | STM-6 | 0.351 | 0.3511 | ✅ |
| G1 Patient Weight | STM-7 | Wilcoxon 3.86e-8 | Welch t 2.80e-7 (Mann-Whitney 3.87e-8, not on portal) | 🔶 test differs |
| G1 MSI MANTIS Score | STM-7 | Wilcoxon 0.798 | Welch t 0.0745 (MW 0.7986) | 🔶 |
| G1 Aneuploidy / Mutation Count / TMB / FGA / Diagnosis Age | STM-7 | 0.268 / 0.414 / 0.516 / 0.713 / 0.846 | Welch 0.275 / 0.390 / 0.522 / 0.741 / 0.917; MW 0.268 / 0.415 / 0.516 / 0.713 / 0.846 | 🔶 shown test differs; rank p identical |
| G1 q-values | STM-8 | BH over 45 (+hidden); Weight q 1.022e-6 | BH over attributes tested (portal: 8; API run: 11, Weight q 1.54e-6 on Welch p) | 🔶 n and basis differ |
| G2 overlapping samples / patients | STM-9 | 221 / 221 | 119 Male∩KRAS + 102 Female∩KRAS = 221 | ✅ |
| G2 Exclude sizes | STM-9, MD-1 | Male 193, Female 178, KRAS 1 (not excluded) | 193, 178, 1 | ✅ |
| G2 Exclude OS | SV-4 | no plot (KRAS 1 < Min. 3) | Male 191/37 (med 62.8), Female 178/37 (67.3), KRAS 0; log-rank refused | 🔶 shows curves legacy filters out |
| G2 Include OS | SV-4, MD-2 | partition curves; hidden ("Only (C) KRAS" 1 < Min. 3) | Male 310, Female 280, KRAS 221 overlapping; 3-group p 0.910 | 🔶 not partitions |
| G2′ partitions OS (cBioLab only) | STM-3 | not shown | Only M 191/37, Only F 178/37, M∩K 119/27, F∩K 102/19; p 0.858 | ? legacy hides it |
| G2 clinical (Exclude), Sex / Weight | STM-6, 7 | < 10^-10 / Wilcoxon 1.085e-5 (labelled Wilcoxon though 3 groups sent) | not run on identical exclusive groups | ? |
| R1 Altered / Unaltered | RV-3 | 222 / 372 | 222 / 372 (2026-11-17; was 312) | ✅ |
| R1 OS n/events | RV-3 | 221/46, 369/74 | 221/46, 369/74 | ✅ |
| R1 OS p | STM-3 | 0.632 | 0.632 | ✅ |
| R1 PFS p (type table) | SV-5 | 0.0191 | 0.0191 (2026-11-17, the page; was 0.0339) | ✅ |
| G1 survival-type table (2026-11-18) | SV-5, STM-4 | DFS 223 0.0221 0.0884; PFS 590 0.119 0.238; DSS 569 0.464 0.618; OS 590 0.684 0.684 | identical | ✅ |
| G1 OS median (95 % CI) (2026-11-18) | STM-2 | Male 62.79 (56.25 - NA), Female NA | Male 62.79 (56.25 - NA), Female not reached | ✅ |
| G1 Clinical, numeric (2026-11-18) | STM-7 | Weight 3.86e-8, MSIsensor 0.0130, Ragnum 0.0465, Buffa 0.145, Aneuploidy 0.268 (Wilcoxon) | identical (Wilcoxon) | ✅ |
| G1 Clinical, 2 × 2 categorical (2026-11-18) | STM-6 | In PanCan Pathway Analysis 0.101, New Neoplasm Event 0.289 | 0.0824, 0.241 (the portal API's counts give 0.101 / 0.289 with Yates' correction, 0.0824 / 0.241 without) | 🔶 |
| G1 Clinical q (2026-11-18) | STM-8 | Weight 1.022e-6, MSIsensor 0.230 (over 53) | 1.003e-6, 0.225 (over 52) | 🟡 |
| G2 Exclude / Include survival (2026-11-18) | SV-6 | every row under Min. # 3: the warning, no plot | the warning, and the Overall plot drawn | 🔶 |

Data version: every n, event count and median agrees exactly on identical groups, so the warehouse and cbioportal.org hold the same clinical data. All survival mismatches trace to group definitions (Unaltered, Include partitions), not arithmetic.

---

## 4. Scorecard

### §0 Page shell

| ID | verdict | how | note |
|---|---|---|---|
| CMP-PG-1 | 🟡 | BC | Groups travel in `?doc=` (or `?s=`), tab `?tab=`; no session service. Tabs Overlap, Survival, Clinical, Genomic Alterations, Mutations (2 groups), mRNA, Protein, DNA methylation / per-probe Methylation, generic assays, + "Clinical Data"; no Pathways (tracked) (`comparison-layout.ts:37-49`) |
| CMP-PG-2 | 🟡 | B | Eyebrow "Group comparison", study name, id, "594 samples · 594 patients"; no study-view link; no "Groups from <attr>"; one study only (`page.tsx:25`) |
| CMP-PG-3 | 🟡 | BC | Re-measured 2026-11-18 (was 🔶): default **Exclude** ✅ (`page.tsx:31`, `?overlap=include` for Include, #223); the select still shown when the groups share nobody (G1 Female/Male: "Overlapping samples: exclude"), where the portal hides it |
| CMP-PG-4 | 🟡 | BC | Re-measured 2026-11-18 (was 🔶): Survival only when the study has a `<X>_MONTHS`/`<X>_STATUS` pair (`survivalDefault`, `comparison-layout.ts:16`) ✅; Clinical hidden when the study has no attributes (portal: never hidden, greyed below 2 groups); <2 groups refused page-wide |

### §1 Group selector

| ID | verdict | how | note |
|---|---|---|---|
| CMP-GS-1 | 🟡 | B | "GROUPS" row of chips; no "(drag to reorder)", no Select all / Deselect all |
| CMP-GS-2 | 🟡 | BC | Series swatch + name + one count (patients, from the tabs); toggles; no ordinal, no (S/P), no delete ×, no missing-sample ⚠, no strike-through (`portal-chrome.tsx:20-30`) |
| CMP-GS-3 | ❌ | B | Only `data-tip` "leave X out of the comparison"; no counts/description popover, no Open in study view |
| CMP-GS-4 | 🟡 | C | `?off=` names taken out (blacklist, as GC); ≥2 and ≤6 on (`COMPARISON_MAX_ACTIVE`, `lib/partition-arms.ts:88`) |
| CMP-GS-5 | ❌ | C | No reorder |
| CMP-GS-6 | 🔶 | B | Document order; no name-priority sort (legacy G2 would be Female, KRAS, Male — saved session order kept here since `groupNameOrder` is sent) |
| CMP-GS-7 | ❌ | B | No ordinals |
| CMP-GS-8 | 🔶 | B | Series palette by position; RV Altered/Unaltered = first two series colours, not #dc3912 / #3366cc |
| CMP-GS-9 | N/A | C | At most 20 groups / 6 active, so the 40-group collapse never applies |

### §2 Overlap

| ID | verdict | how | note |
|---|---|---|---|
| CMP-OV-1 | 🔶 | B | Draws the compared groups, so in Exclude mode the overlap-removed ones (G2: 193/178/1); legacy Overlap always shows the originals |
| CMP-OV-2 | 🟡 | BC | ≤3 Venn, >3 UpSet ✅ (`overlap/figure.ts:225`); no layout-failure fallback (legacy G2 fell back to UpSet; cBioLab drew a Venn with "too small to label: KRAS: 1") |
| CMP-OV-3 | 🟡 | B | Samples + patients diagrams, region counts ✅; circles not rectangles, series fills not blended; hover = SVG `<title>`; no click selection; key lists sizes |
| CMP-OV-4 | 🟡 | C | UpSet counts patients only (`figure.ts:139`), no sample UpSet; pooled columns past width; no click |
| CMP-OV-5 | ❌ | B | No create-group-from-selection |
| CMP-OV-6 | ❌ | B | No download |
| CMP-OX | ❌ | B | No overlap/exclusion banner on any tab (tracked for the Mutations tab only) |

### §3 Survival tab

| ID | verdict | how | note |
|---|---|---|---|
| CMP-SV-1 | ✅ | BC | Re-measured 2026-11-18 (was 🔶): every `<X>_MONTHS`/`<X>_STATUS` pair, ordered OS, DFS, PFS, DSS then the rest (`SURVIVAL_PRIORITY`), each a row of the survival-type table that draws it (#227); G1 rows Disease Free, Progression Free, Disease-specific, Overall as the portal |
| CMP-SV-2 | 🟡 | C | 0 groups impossible; >10 unreachable (6 active max) |
| CMP-SV-3 | 🔶 | B | No caution / log-rank explanation alerts; a caveat paragraph under the figure instead |
| CMP-SV-4 | 🟡 | B | Re-measured 2026-11-18 (was 🔶): Exclude: one curve per group (G2 Male 191/37, Female 178/37) ✅; Include: the portal's partitions "Only Male", "Only Female, KRAS" …, every patient in one curve, the test over them ✅ (#255); no "(A)" ordinals in the names, colours not blended |
| CMP-SV-5 | 🟡 | B | Re-measured 2026-11-18 (was ❌): Survival Type · Number of Patients · p-Value · q-Value, sorted by p, "Min. # Patients per Group" (default 3, rows below it hidden with the portal's warning), a row picks the plot ✅ (#227; G1 DFS 223 0.0221 0.0884 … OS 590 0.684 0.684, as the portal); a number field, not a slider; no hidden `# in`/median columns, column menu, filter or download |
| CMP-SV-6 | 🟡 | B | Re-measured 2026-11-18 (was ✅): Overall drawn first ✅ (G1). When the Min. # threshold hides every row the portal shows only the warning and no plot (G2 Exclude and Include, cbioportal.org 2026-11-18); cBioLab shows the same warning and still draws Overall (G2 Exclude: Male 191, Female 178, KRAS "no patients with data", p = 0.987) |
| CMP-SV-7 | 🟡 | B | Header "SURVIVAL — A vs B"; no attribute description; no multi-study warning (single study) |
| CMP-SV-8 | ❌ | C | No GENIE BPC left-truncation checkbox (delayed entry only with an `anchor`) |

### §4 Kaplan-Meier chart

| ID | verdict | how | note |
|---|---|---|---|
| CMP-KM-1 | ❌ | B | No HR checkbox, control select, landmarks, X-Axis Max slider, download |
| CMP-KM-2 | 🔶 | B | Y "Survival probability", ticks 0/25/50/75/100 %; X "Months", 24-month ticks; legacy "Probability of Overall Survival", 11 y ticks, x label from attribute, 18 ticks |
| CMP-KM-3 | 🟡 | BC | Re-measured 2026-11-18 (was 🔶): Step curves ✅; the axis to the last follow-up, each curve to its own (G1 to 148 mo, as the portal's, #223) ✅; no censor "+" marks, no hover points |
| CMP-KM-4 | ❌ | C | No point tooltip |
| CMP-KM-5 | 🟡 | B | Legend under the plot with median · n · events; "log-rank χ² = 0.166 (1 df) · p = 0.68" (legacy "Logrank Test P-Value: 0.684") |
| CMP-KM-6 | 🟡 | B | Number-at-risk table at 0/24/48/72 ✅ (0: 280/310 = legacy); fewer columns, nothing past last event |
| CMP-KM-7 | ❌ | B | No landmarks |
| CMP-KM-8 | ❌ | C | No hazard ratios |
| CMP-KM-9 | 🟡 | B | n, events, median in the legend; no table, no 95 % CI, 1-decimal median |
| CMP-KM-10 | ❌ | B | No data download |
| CMP-KM-11 | ✅ | C | Empty cohorts → "nothing to plot: … empty" error (`survival/run.ts:96-101`) |

### §5 Clinical tab

| ID | verdict | how | note |
|---|---|---|---|
| CMP-CL-1 | 🟡 | BC | <2 cohorts refused ("at least 2 cohorts"); no caution alert, no overlap banner |
| CMP-CL-2 | 🟡 | B | Re-measured 2026-11-18 (was 🔶): Every attribute by display name in the portal's table: Clinical Attribute · Attribute Type · Statistical Test · p · q, sorted by q, 20 a page, search, "Significant only" (#224); G1 52 attributes, 44 tested; no column menu, download or row click |
| CMP-CL-3 | ❌ | B | No plot controls |
| CMP-CL-4 | ❌ | B | No per-attribute plot or table |

### §6 Results › Comparison/Survival

| ID | verdict | how | note |
|---|---|---|---|
| CMP-RV-1 | 🟡 | B | Always "Comparison/Survival", even without survival data |
| CMP-RV-2 | 🟡 | BC | Sub-tabs Overlap, Survival, Clinical, Genomic Alterations, generic assays (`results-layout.ts:228-235`); no mRNA, Protein, DNA Methylation |
| CMP-RV-3 | 🔶 | BC | Altered 222 ✅; 2026-11-17: Unaltered = not altered AND not totally unprofiled (profiled for some queried gene in some selected alteration profile, `resultsGroups`) → 372 as legacy, OS 369/74, p 0.632 as legacy; msk_impact_2017 ZFHX3 399 / 7,740 samples as the portal's rule over its panel data. Still no Unprofiled, per-gene/track or user groups; fixed selection |
| CMP-RV-4 | 🟡 | B | OQL note on the page; no group selector or overlap select on RV |
| CMP-RV-5 | ❌ | C | No `comparison_*` params; groups fixed |
| CMP-RV-6 | ❌ | C | As SV-8 |

### §7 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| CMP-MD-1 | 🟡 | BC | Exclude removes shared samples, sizes = legacy (G2 193/178/1); not default; a group wholly inside another is refused, not struck through (`partition-arms.ts:139-140`) |
| CMP-MD-2 | 🟡 | B | Re-measured 2026-11-18 (was 🔶): Include: survival as the portal's exclusive partitions ✅ with "Overlapping patients (221) are plotted as distinct groups"; no CMP-OX banner on the other tabs |
| CMP-MD-3 | 🟡 | B | No banner ✅; strategy select still shown |
| CMP-MD-4 | 🔶 | C | A second group cannot be turned off (lock "a comparison needs at least 2 groups") |
| CMP-MD-5 | ✅ | C | >3 groups → UpSet |
| CMP-MD-6 | N/A | C | 6 groups at most compared |
| CMP-MD-7 | ✅ | B | One plot shown directly (OS) |
| CMP-MD-8 | ❌ | C | Comparison page single-study |
| CMP-MD-9 | N/A | C | Groups are cohort definitions evaluated live (document model, CLAUDE.md "What this is"), not stored sample lists |
| CMP-MD-10 | ✅ | BC | Re-measured 2026-11-18 (was 🔶): the portal pages test at any group size (`testAnySize`, #255); a curve with no patients left out of the test, as `logRankTest` drops it (G2 Include: 4-group p 0.858) |
| CMP-MD-11 | N/A | C | Groups live in the document / Saved work (invariant 9) |
| CMP-MD-12 | ❌ | C | As SV-8 |
| CMP-MD-13 | ❌ | C | No deployment switch for p/q display (tracked: "Instance defaults … survival display") |

### §9 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| CMP-STM-1 | ✅ | BC | Same entry rule (both values, null markers, months ≥ 0; `lib/survival-sql.ts`), event code 1 (also bare "1"); n/events identical on 4 endpoints × 2 groups; tied-event product limit |
| CMP-STM-2 | ✅ | BC | Re-measured 2026-11-18 (was 🟡): Median = first S ≤ 0.5 with its 95 % CI, 2 decimals: G1 Male "62.79 (56.25 - NA)", Female not reached, as the portal's summary table |
| CMP-STM-3 | ✅ | BC | Re-measured 2026-11-18 (was 🟡): 2-group and k-group log-rank, hypergeometric variance, at any size; p to 3 digits: G1 OS 0.684, PFS 0.119, DFS 0.0221, DSS 0.464 on both sides |
| CMP-STM-4 | ✅ | BC | Re-measured 2026-11-18 (was ❌): BH over the survival-type rows: G1 DFS 0.0884, PFS 0.238, DSS 0.618, OS 0.684, identical to the portal |
| CMP-STM-5 | ❌ | C | No HR |
| CMP-STM-6 | 🔶 | BC | Re-measured 2026-11-18 (was ✅): Pearson χ² without a continuity correction. The portal applies Yates' correction to 2 × 2 tables (spec says it does not): G1 "In PanCan Pathway Analysis" (No/Yes 55/225 vs 80/232, the portal API's counts) portal 0.101 = Yates, ours 0.0824 = uncorrected; "New Neoplasm Event Post Initial Therapy Indicator" 0.289 vs 0.241. Larger tables identical (Race 0.245, Subtype 0.446, Stage 0.351); the q-values shift with them (MSIsensor Score q 0.230 vs 0.225) |
| CMP-STM-7 | ✅ | BC | Re-measured 2026-11-18 (was 🔶): Kruskal-Wallis, "Wilcoxon Test" for 2 groups (#233): G1 Patient Weight 3.86e-8, MSIsensor 0.0130, Ragnum Hypoxia 0.0465, Aneuploidy 0.268 on both sides |
| CMP-STM-8 | 🟡 | BC | BH same formula; 2026-11-17: n counts the attributes the portal tests but does not list (each survival endpoint's pair, AGE_LAST_FU_YEARS, BIRTH_YEAR): coadread G1 n 52 (was 44), Patient Weight q 1.003e-6 against the portal's 1.022e-6 over 53 — the one left is OTHER_PATIENT_ID, refused past 200 values (QUESTIONS.md: its values are patient identifiers) |
| CMP-STM-9 | 🟡 | BC | Overlap counts and Exclude sizes identical on G2; no iterative exclusion; refused when groups differ in >1 condition or nest |
| CMP-STM-10 | ✅ | B | Re-measured 2026-11-18 (was 🔶): p and q to 3 significant digits ("0.684", "3.86e-8", "< 10^-10"), median to 2 decimals ("62.79"), as the portal; HR and landmark formats belong to the missing features (KM-7, KM-8) |
| CMP-STM-11 | 🟡 | B | Group chip = patients only; per-curve n and at-risk counts ✅ |

---

## 5. cBioLab bugs (on its own terms)

- ~~**Include-mode log-rank on overlapping groups**: with the default "include", a patient in two groups enters two curves and the log-rank/k-group test is run as if the groups were independent (G2: Male, Female, KRAS → p 0.910 with 221 patients counted twice). The caveat says nothing about it.~~ Fixed (#255): Include draws the portal's partitions.
- ~~**Clinical tab picks attributes by coverage**, so near-constant attributes (SAMPLE_TYPE, CANCER_TYPE, SOMATIC_STATUS, SAMPLE_COUNT) fill the 8 slots and the q-correction, and the attribute the groups were built from (SEX) is not tested.~~ Fixed (#224): every attribute.
- ~~**KM axis ends at the last event**: censored follow-up after it (and its at-risk counts) is never drawn, so a curve looks shorter than the data.~~ Fixed (#223).
- ~~**Survival tab on a study without OS** shows only an error naming other endpoints ("pick one of those") while the portal tab has no control to pick one.~~ Fixed (#227): the tab only with survival data, endpoints picked in its table.

**Not verified:** legacy KM point tooltips and Venn hover (do not render headless; taken from the spec's `[C]`); legacy Include-mode partition p (hidden by its Min. # 3 threshold — cBioLab's partition numbers recorded above for later); clinical p on G2 Exclude groups in cBioLab (exclusive cohorts not rerun through the API).
