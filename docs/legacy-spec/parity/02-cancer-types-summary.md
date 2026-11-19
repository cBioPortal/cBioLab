# Parity audit — Results › Cancer Types Summary (spec `02-cancer-types-summary.md`)

- **Date:** 2026-11-11; re-measured 2026-11-18
- **cBioLab:** master @ `bc53b944`, `next dev` on `http://127.0.0.1:3109` (first audit: `session/spec` @ `f3197d75`)
- **Legacy:** cbioportal.org (Playwright, 2026-11-11; Q1 patients again from the page's chart props on 2026-11-18)
- **Code paths (cBioLab):** `app/portal/results-layout.ts:341` (tab → `cancertypes` view on "Queried" with the query's OQL), `app/lab/kinds/cancertypes.tsx` (controls, gene pills, popover, downloads), `lib/views/cancertypes/{run,sql,figure,tip,tsv,kind,method,types,doc}.ts`, `lib/figures/common.ts:30-37` (colours)

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy (`/results/cancerTypesSummary?…`) | cBioLab |
|---|---|---|
| Q1 multi cancer type | `cancer_study_list=msk_impact_2017&case_set_id=msk_impact_2017_all&profileFilter=mutations,structural_variants,cna&gene_list=TP53 KRAS PIK3CA` (patients; samples; KRAS tab) | `/portal/results?study=msk_impact_2017&genes=TP53%20KRAS%20PIK3CA&tab=Cancer+Types+Summary`; numbers via the same `/api/analysis` doc with `minSamples:1` (all groups), `unit:"sample"` |
| Q2 multi-study | `cancer_study_list=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&case_set_id=all&profileFilter=mutations,structural_variants,gistic&gene_list=TP53 KRAS` | `studies=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&genes=TP53%20KRAS` (+ `groupBy:"study"`) |
| Q3 one cancer type | `cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS` | `study=coadread_tcga_pan_can_atlas_2018&genes=KRAS` (+ `groupBy:"CANCER_TYPE_DETAILED"`) |
| Q4 OQL | Q1 base, `gene_list=KRAS: MUT=G12D⏎TP53: HOMDEL` | `oql:["KRAS: MUT=G12D","TP53: HOMDEL"]` (what the portal page sends) |

Legacy per-group numbers read from the chart component's React props (`countsByGroup`: `profiledTotal`, `alteredCount`, `alterationTypeCounts`, `profiledCounts`) with the total-threshold box set to 0, cross-checked against hovered bar tooltips (identical). cBioLab numbers from the `cancertypes` result. Scripts, JSON and screenshots: (local scratch, not committed) (`legcts.js`, `labcts.py`, `ctscompare.py`; `out/leg-cts-*.json|png`, `out/lab-cts-*.json`, `out/cts1.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 33 |
| 🟡 partial | 17 |
| 🔶 different | 2 |
| ❌ missing | 3 |
| 🐞 ok | 1 |
| 🐞 copied | 0 |
| N/A | 3 |
| ? | 0 |
| **Total IDs** | **59** |

**Overall: 62.7 %** (✅ 33 + 🐞ok 1 + N/A 3 = 37 of 59). Counting 🟡 as half: 77.1 %. (2026-11-11: 42.4 % / 52.5 %.)

Re-measurement of 2026-11-18 (master `bc53b944`): every ID judged again from the spec text against the code and the page, not from the PRs' Tracker lines. The rows the PRs had already updated (#244, #287, #291, #295, #328, #332, #335, #338, #339) were checked again and the summary above, which they had left at the first audit's counts, recounted. Against the first audit 24 verdicts went up and 2 went down (CH-7, MD-2, ↓ in the note: "Query this study" is part of the spec and is left out). Q1 patients were taken again from cbioportal.org: 55 of 58 groups identical on all seven counts, Σ altered 5900 in both; the other 3 differ by one patient each, an amplification in one gene and a deep deletion in another, now counted as Amplification (legacy: Deep Deletion; at the first audit: Multiple).

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Shared chrome | 4 | 1 | 2 | 1 | 0 | 0 | 0 | Tab and link ✅; no OQL banner or filter warnings |
| §1 Gene tabs (GT) | 6 | 5 | 0 | 0 | 0 | 0 | 1 | Same pill tabs, grey for an unaltered gene |
| §2 Category (CT) | 10 | 4 | 4 | 0 | 1 | 0 | 1 | Portal default category, filters, sort, wording and resets ✅; thresholds are text boxes without sliders, total not clamped, no highlight |
| §2 Occurrence (OC) | 5 | 4 | 0 | 0 | 0 | 0 | 1 | Count By, Y-axis, Show Genomic Alteration Types ✅ |
| §3 Chart (CH) | 9 | 5 | 4 | 0 | 0 | 0 | 0 | Filter alert, legend, strip, labels ✅; smaller plot, no gain/hetloss, no "Query this study", empty-state wording |
| §4 Sorting (SO) | 4 | 3 | 0 | 1 | 0 | 0 | 0 | Frequency, count and alphabetical ✅; ties by profiled count |
| §5 Downloads (DL) | 3 | 3 | 0 | 0 | 0 | 0 | 0 | SVG / PNG / PDF / Data as legacy |
| §6 Modes (MD) | 12 | 5 | 4 | 0 | 2 | 1 | 0 | Defaults per mode ✅; no OQL banner, own driver toggle, no Show only profiled, no hide-download switch |
| §8 Statistics (STM) | 6 | 3 | 3 | 0 | 0 | 0 | 0 | Every denominator identical; AMP + HOMDEL across genes → Amplification (legacy Deep Deletion) in 3 groups |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Driver / VUS / germline settings and Show only profiled** not applied to the tab (own "count: drivers" toggle; DRIVER in the OQL follows the page); no AlterationFilterWarning / CaseFilterWarning | MD-6, MD-7, 0.3 | (tracked) "The other Results tabs following the settings", "Show only profiled" |
| 2 | **No OQL banner** on this tab ("…filtered by the OQL specification…"); the OQL itself is applied | 0.3, MD-5 | (tracked) "Ours alone: the portal's green OqlStatusBanner … is the page's one note" |
| 3 | **AMP in one gene + HOMDEL in another → Amplification**; legacy counts whichever CNA comes first (Deep Deletion in the 3 Q1 groups) | STM-2, STM-3 | new: added |
| 4 | **Thresholds are text boxes only**: no sliders, the total box not clamped to the max (999999 hides every group), no highlighted box | CT-3, CT-4, CT-7, CT-9, STM-6 | (tracked) "Ours alone: the thresholds are text boxes without the sliders" |
| 5 | **No "Query this study"** in the by-study popover | CH-7, MD-2 | (tracked, omitted by the user's decision) |
| 6 | **Plot 240 px with ≤ 32 px bars, labels at 45°**, no top scrollbar for > 37 groups | CH-2, MD-11 | not tracked |
| 7 | **No Gain / Shallow Deletion buckets** (OQL GAIN / HETLOSS refused) | CH-3, STM-2 | (tracked) with low-level CNA |
| 8 | No hide-download switch | MD-12 | (tracked) Data-governance switches |

---

## 3. Number check

Groups compared on every count: profiled (denominator), altered, Mutation / Amplification / Deep Deletion / SV / Multiple.

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 patients, All genes: groups | STM-1 | 58 Cancer Type groups | 58 | ✅ |
| Q1 patients: groups identical on all 7 counts | STM-3/4 | — | 55 / 58 | 🟡 (3 differ, see below) |
| Q1 Colorectal Cancer (patients) | STM-3/5 | 911 / 982 = 92.77 %; Mut 888, SV 3, Amp 1, Del 1, Multi 18 | 911 / 982 (92.77 %); same split | ✅ |
| Q1 Non-Small Cell Lung Cancer | STM-3 | 1178 / 1567 (75.18 %); Mut 1116, Amp 7, Del 5, SV 2, Multi 48 | identical | ✅ |
| Q1 Breast Cancer | STM-3 | 809 / 1246 (64.93 %); Mut 774, Amp 5, Del 1, Multi 29 | identical | ✅ |
| Q1 Germ Cell Tumor | STM-2/3 | 106 / 276; Amp 45, Del 2, Multi 10 | 106 / 276; Amp 46, Del 1, Multi 10 | 🔶 1 patient: AMP + HOMDEL in different genes → legacy "Deep Deletion" (first CNA), cBioLab "Amplification" |
| Q1 Bone Cancer | STM-2/3 | 33 / 129; Amp 0, Del 7 | 33 / 129; Amp 1, Del 6 | 🔶 same cause |
| Q1 GI Neuroendocrine Tumor | STM-2/3 | 13 / 45; Amp 0, Del 1 | 13 / 45; Amp 1, Del 0 | 🔶 same cause |
| Q1 Σ altered over groups (patients) | STM-3 | 5900 | 5900 | ✅ |
| Q1 samples: groups identical | STM-2 | — | 55 / 58 (same 3 groups, same cause) | 🟡 |
| Q1 samples NSCLC / Breast / Colorectal | STM-2 | 1237/1668, 865/1337, 932/1007 | identical, splits identical | ✅ |
| Q1 samples Σ altered | STM-2 | 6163 | 6163 | ✅ |
| Q1 KRAS tab (patients) | STM-3/4 | 58 groups; NSCLC 454/1567, CRC 438/982, Breast 25/1246; Σ 1772 | 58 / 58 groups identical; Σ 1772 | ✅ |
| Q1 groups kept at default threshold 10 | STM-6 | 40 of 58 shown | 40 of 58 shown, same alert | ✅ |
| Q1 first bars (frequency order) | SO-1 | Colorectal, Small Cell Lung, Small Bowel… | Colorectal 92.77, Small Cell Lung 89.02, Small Bowel 85.71, Ovarian, Appendiceal | ✅ |
| Q1 slider max (Total / Altered) | STM-6 | 1567 / 93 % | — (no slider) | ❌ |
| Q1 by count / alphabetically | SO-2/3 | NSCLC first; Adrenocortical Carcinoma, Ampullary, Anal | NSCLC 1178, CRC 911, Breast 809; Adrenocortical Carcinoma, Ampullary, Anal | ✅ |
| Q2 by study: brca | STM-1/3 | 365 / 1084 (33.67 %); Mut 338, Amp 6, Del 9, Multi 12 | identical | ✅ |
| Q2 by study: coadread + header | STM-3 | 2 / 2 groups identical; Σ 775 | 2 / 2; 775 of 1678 | ✅ |
| Q2 default category | CT-2 | Cancer Study | Cancer Study, labels "Colorectal Adenocarcinoma (TCGA, PanCancer Atlas)", … | ✅ |
| Q3 coadread Cancer Type Detailed | STM-1/3/4 | Colon 139/378, Mucinous 27/61, Rectal 56/155 (Amp 3, Del 1, Multi 1) | identical (with `groupBy:"CANCER_TYPE_DETAILED"`) | ✅ |
| Q3 profiled per data type (scatter) | CH-5 | Colon mutation 338, CNA 376, SV 338 (+ not-profiled 40/2/40) | `profiledFor` 338 / 376 / 338, three "+" rows | ✅ |
| Q3 default category | CT-2 | Cancer Type Detailed (3 bars) | Cancer Type Detailed (3 bars) | ✅ |
| Q4 OQL NSCLC / CRC / Pancreatic | MD-5 | 64/1567, 125/982, 150/487; Σ 530 | 64/1567, 125/982, 150/487 | ✅ |
| Popover | STM-5, CH-7 | "Gene altered in 92.77% of 982 patients", Mutation 90.43% (888) … Multiple 1.83% (18) | identical (hovered) | ✅ |
| Data TSV Colorectal | DL-3 | `mutated` 90.42769857433809 / 888 (spec) | `mutated` 90.4276985743381 / 888 | ✅ (last float digit) |

Data version: every denominator and every altered count matches in all 65 group comparisons (Q1 patients re-read from cbioportal.org on 2026-11-18, still identical); the only differences are the type bucket for patients/samples with an amplification in one gene and a deep deletion in another. Warehouse and cbioportal.org hold the same data for these studies.

---

## 4. Scorecard

### §0 Shared chrome

| ID | verdict | how | note |
|---|---|---|---|
| CTS-0.1 | 🟡 | B | Results header as in `01-oncoprint.md` RV-1..3 (same gaps) |
| CTS-0.2 | ✅ | BC | Tab "Cancer Types Summary", `?tab=Cancer+Types+Summary`, always laid out (`results-layout.ts:213`); Open in cBioPortal → `cancerTypesSummary` (`legacy-link.ts:34`) |
| CTS-0.3 | 🔶 | B | No OqlStatusBanner (the page's note says Cancer Types Summary follows the OQL), no AlterationFilterWarning / CaseFilterWarning |
| CTS-0.4 | 🟡 | B | Generic card wait state; on error the engine's refusal text, not nothing |

### §1 Gene tabs

| ID | verdict | how | note |
|---|---|---|---|
| CTS-GT-1 | ✅ | B | "All Queried Genes · TP53 · KRAS · PIK3CA" pills |
| CTS-GT-2 | ✅ | C | Shown only when > 1 gene (`cancertypes.tsx:37`) |
| CTS-GT-3 | ✅ | C | First active; component state, no URL |
| CTS-GT-4 | ✅ | C | A gene tab's label is grey (#bbb) when the gene is altered in no unit of any cohort, before the filters (coadread TP53 + DAZ1: DAZ1 grey) |
| CTS-GT-5 | N/A | C | Invariant 9: the view's settings live in the document and are shared by every gene pill, so nothing resets on switch |
| CTS-GT-6 | ✅ | C | One tab per distinct gene; two lines of one gene counted together under it |

### §2 Controls — Category

| ID | verdict | how | note |
|---|---|---|---|
| CTS-CT-1 | 🟡 | B | "category" select: Cancer Study / Cancer Type / Cancer Type Detailed + every categorical sample attribute; kept in the document |
| CTS-CT-2 | ✅ | BC | Unset, the portal default (`run.ts:295-303`): Q2 → Cancer Study (2 bars, study names), Q3 coadread → Cancer Type Detailed (Colon 139/378, Mucinous 27/61, Rectal 56/155), Q1 → Cancer Type; the select names it "portal default (Cancer Type)" |
| CTS-CT-3 | ✅ | BC | "Min. # Total Patients\|Samples" box and slider 0 … the largest profiled total drawn (`thresholds.ts`); unset = 10, or 0 when no group has more than 10 (`run.ts:325`); groups below are hidden (Q1: 40 of 58); scope shared across gene tabs (document, invariant 9), each tab working out its own default (#429) |
| CTS-CT-4 | ✅ | BC | "Min. % Altered Patients" / "Min. # Altered …" box and slider 0 … the largest share / count drawn, end label `ceil(max)` + "%" (Q1 93%), default 0, inclusive (#429) |
| CTS-CT-5 | ✅ | BC | "sort x-axis by: Y-Axis Values / Alphabetically" (`cancertypes.tsx:194-198`); Q1 alphabetical: Adrenocortical Carcinoma, Ampullary Cancer, Anal Cancer, as legacy |
| CTS-CT-6 | ✅ | B | "Min. # Total Patients", "Min. % Altered Patients"; "Min. # Altered …" in count mode; "Samples" with count by samples (`cancertypes.tsx:146, 183`) |
| CTS-CT-7 | ✅ | C | Digits and "." only, applied on Enter, the altered box shows "0%", NaN → 0 / default; Min. # Total over the largest drawn is set to it (Q1 by patients 999999 → 1567, by samples 1668) (#429) |
| CTS-CT-8 | 🟡 | C | Both sliders apply when let go; the portal's Min. Altered applies while dragging (#429) |
| CTS-CT-9 | ✅ | B | Box highlighted when its applied value is above 0, Min. # Total at its default of 10 (#429) |
| CTS-CT-10 | ✅ | C | Category or count-by resets both thresholds, y-axis only Min. altered (`cancertypes.tsx:154, 165, 190`); sort and y-axis kept across a category change |

### §2 Controls — Occurrence

| ID | verdict | how | note |
|---|---|---|---|
| CTS-OC-1 | ✅ | BC | "count by: patients / samples", patients default (`run.ts:27`), shared across pills |
| CTS-OC-2 | ✅ | B | "y-axis: Alteration Frequency / Absolute Counts" |
| CTS-OC-3 | ✅ | BC | "Show Genomic Alteration Types" (default on); unticked, each bar drawn whole in #666 at its altered total, no legend; the Data download unchanged (view `alterationTypes:false`) |
| CTS-OC-4 | ✅ | B | No per-type toggles (an extra "count: any alteration / drivers" exists) |
| CTS-OC-5 | N/A | C | Invariant 9 (see GT-5) |

### §3 Chart

| ID | verdict | how | note |
|---|---|---|---|
| CTS-CH-1 | ✅ | B | "40 of 58 categories (Cancer Type) are shown based on filtering." above the chart at the default threshold (Q1), as legacy (`figure.ts:67-69`) |
| CTS-CH-2 | 🟡 | BC | Vertical stacked bars ≤ 32 px, plot 240 px (legacy 20 px / 400); y titles identical; labels at 45° under the bars (legacy 50°); more groups than fit → figure grows and scrolls, no synced top scrollbar |
| CTS-CH-3 | 🟡 | BC | Stack bottom → top Multiple, Protein low/high, mRNA low/high, Deep Deletion, Amplification, SV, Mutation, Multiple `#666` (`figure.ts:18-21`, `common.ts:35`) ✅; no Gain / Shallow Deletion buckets: OQL GAIN / HETLOSS is refused ("only high-level CNA is stored") |
| CTS-CH-4 | ✅ | B | Types present only; Mutation · Structural Variant · Amplification · Deep Deletion · Multiple Alterations (Q1), as legacy |
| CTS-CH-5 | ✅ | BC | The profiled-data strip as the portal's: a row per data type the query reads (Structural variant / Mutation / CNA, and mRNA / Protein for an EXP / PROT line), "+" or "−" per group; on a gene tab for that gene's panels (msk_impact_2017 NEGR1: Colorectal 782 of 982 patients) |
| CTS-CH-6 | ✅ | BC | Each mark's tip "N patients profiled" or "Not profiled" |
| CTS-CH-7 | 🟡 | BC | ↓ Popover per bar as CancerSummaryChart's: "Summary for Colorectal Cancer / Gene altered in 92.77% of 982 patients / Mutation 90.43% (888 patients) / … / Multiple Alterations 1.83% (18 patients)", identical to legacy (Q1, hovered); by study the linked name. No "Query this study" button (left out by the user's decision, but part of the spec) |
| CTS-CH-8 | ✅ | BC | Raw values; by study `shortStudyName(name)` (`run.ts:233-236`): Q2 "Colorectal Adenocarcinoma (TCGA, PanCancer Atlas)" |
| CTS-CH-9 | 🟡 | C | Every group filtered away → "No category passes the filters." with the controls kept (legacy "No data to plot."); a gene with no alterations → "There are no alterations in this gene." (`figure.ts:128-131`) ✅; no profiled unit → the engine's refusal |

### §4 Sorting

| ID | verdict | how | note |
|---|---|---|---|
| CTS-SO-1 | ✅ | BC | Descending altered ÷ profiled (`run.ts:47`); Q1 first five bars identical |
| CTS-SO-2 | ✅ | BC | Absolute Counts sorts by altered count (`run.ts:318, 328`): Q1 NSCLC 1178, Colorectal 911, Breast 809 first, as legacy |
| CTS-SO-3 | ✅ | BC | Alphabetically by group key, a study by its id (`run.ts:320`); Q1 Adrenocortical Carcinoma, Ampullary Cancer, Anal Cancer |
| CTS-SO-4 | 🔶 | C | Ties broken by profiled count descending (`run.ts:328`), not first appearance |

### §5 Downloads

| ID | verdict | how | note |
|---|---|---|---|
| CTS-DL-1 | ✅ | B | Cloud-download icon top right of each chart, menu SVG · PNG · PDF · Data (opens on click, not hover) (`cancertypes.tsx:72-103`) |
| CTS-DL-2 | ✅ | BC | `cancer_types_summary.svg|png|pdf|tsv` (Q1 download: `cancer_types_summary.tsv`); the image is the chart as drawn, strip, labels and legend; a second cohort adds its name |
| CTS-DL-3 | ✅ | BC | Q1 Data file: header "Cancer Type · Alteration Frequency · Alteration Type · Alteration Count", rows per shown group in the drawn order, kinds `multiple` first, unrounded y (`90.4276985743381`), raw keys, counts 888 / 3 / 1 / 1 / 18 (`tsv.ts`); follows the filters, ignores the types toggle |

### §6 Modes & conditions

| ID | verdict | how | note |
|---|---|---|---|
| CTS-MD-1 | ✅ | BC | Samples ↔ patients changes every numerator and denominator (Q1 both modes identical to legacy); captions follow the unit (see bug 1 for exceptions); no thresholds to reset |
| CTS-MD-2 | 🟡 | BC | ↓ Default Cancer Study with study names; popover header links the study; counts per study identical (Q2 coadread 410/594, brca 365/1084). No "Query this study" (left out by the user's decision, but part of the spec) |
| CTS-MD-3 | ✅ | BC | Q3 coadread: Cancer Type Detailed, 3 bars, counts identical to legacy |
| CTS-MD-4 | ✅ | B | Single gene: no "All Queried Genes" |
| CTS-MD-5 | 🟡 | BC | The query's OQL applied (the view's `oql`), EXP/PROT as mRNA / protein high and low segments; the OQL banner is the page's note (tracked) |
| CTS-MD-6 | 🟡 | BC | Own "count: drivers" (OncoKB only) toggle, not the page's settings; no VUS/germline/hotspot; no warning (tracked: Driver-annotation settings) |
| CTS-MD-7 | ❌ | C | No Show only profiled |
| CTS-MD-8 | ✅ | BC | Denominator excludes cases whose panels lack the genes ✅ (all denominators identical); the strip shows "−" for a group with no case profiled for a type |
| CTS-MD-9 | 🐞 ok | C | All groups filtered away: "No category passes the filters.", the controls stay |
| CTS-MD-10 | ✅ | C | Grey tab label; "There are no alterations in this gene." in place of the bars; "No category passes the filters." first when every group is filtered away |
| CTS-MD-11 | 🟡 | B | > 37 groups: figure widens and scrolls; no top scrollbar |
| CTS-MD-12 | ❌ | C | No hide-download switch (no downloads either) (tracked: Data-governance switches) |

§7 Persistence (no IDs): legacy persists nothing; cBioLab keeps category, count-by, measure, min group and y-axis in the document (`?changes=`) per invariant 9; the active gene pill stays in the browser.

### §8 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| CTS-STM-1 | ✅ | BC | Grouping by sample CANCER_TYPE / CANCER_TYPE_DETAILED / study; missing CANCER_TYPE → the study's type of cancer, else "Unknown"; missing detailed → cancer type (`sql.ts:238-258`), as legacy; a patient spanning groups counts in each. Q1 58/58 group keys and denominators identical |
| CTS-STM-2 | ✅ | BC | Q1 samples: 58 groups, Σ altered 6163, NSCLC 1237/1668, Breast 865/1337, CRC 932/1007 identical; types de-duplicated by alteration type, the kind the first the portal meets: samples by id, genes in query order (`sql.ts` `met`, `cna1`); no gain/hetloss buckets (#428) |
| CTS-STM-3 | ✅ | BC | Q1 patients 58/58 groups identical on all 7 counts, Σ altered 5900 (GI Neuroendocrine, Germ Cell, Bone now Deep Deletion, as legacy); KRAS tab, Q2 and Q3 identical (#428) |
| CTS-STM-4 | ✅ | BC | Profiled = panel lists the gene for mutation, CNA or SV (`sql.ts:47-52`); All = union over genes; every denominator identical |
| CTS-STM-5 | ✅ | BC | Heights = count ÷ profiled × 100 or count ✅; popover % as lodash `_.round(x, 2)` (`portalRound2`: 92.77, 1.005 → 1.01) |
| CTS-STM-6 | 🟡 | BC | Plotted iff profiled > 0, ≥ Min. # Total (default 10 / 0) and ≥ Min. altered, inclusive (`run.ts:322-331`): Q1 40 of 58, as legacy; no slider maxima |

---

## 5. cBioLab bugs (wrong on its own terms)

1. ~~**"samples" where the unit is patients** in the results text and card subtitle~~ — fixed (#183): `kind.ts:366`, `cancertypes.tsx:216` follow the unit.
2. ~~**Absolute Counts is not "highest first"**~~ — fixed (#183, #291): count mode sorts by altered count (`run.ts:318`).
3. ~~**`types.ts` and the DSL summary** describe "% of samples"~~ — fixed (#183). One left: the gallery example's text still says "the share of samples altered" and "fewer profiled patients" in one sentence for a view counting patients (`doc.ts:393`).
