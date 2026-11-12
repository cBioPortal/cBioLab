# Parity audit — Results › Cancer Types Summary (spec `02-cancer-types-summary.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day)
- **Code paths (cBioLab):** `app/portal/results-layout.ts:213` (tab → `cancertypes` view on "Queried", genes only), `app/portal/PortalTabs.tsx:171-187`, `app/lab/kinds/cancertypes.tsx` (controls, gene pills), `lib/views/cancertypes/{run,sql,figure,kind,method,types,doc}.ts`, `lib/figures/common.ts:30-34` (colours), `lib/chart/format.ts:21` (`fmtPct`)

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy (`/results/cancerTypesSummary?…`) | cBioLab |
|---|---|---|
| Q1 multi cancer type | `cancer_study_list=msk_impact_2017&case_set_id=msk_impact_2017_all&profileFilter=mutations,structural_variants,cna&gene_list=TP53 KRAS PIK3CA` (patients; samples; KRAS tab) | `/portal/results?study=msk_impact_2017&genes=TP53%20KRAS%20PIK3CA&tab=Cancer+Types+Summary`; numbers via the same `/api/analysis` doc with `minSamples:1` (all groups), `unit:"sample"` |
| Q2 multi-study | `cancer_study_list=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&case_set_id=all&profileFilter=mutations,structural_variants,gistic&gene_list=TP53 KRAS` | `studies=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&genes=TP53%20KRAS` (+ `groupBy:"study"`) |
| Q3 one cancer type | `cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS` | `study=coadread_tcga_pan_can_atlas_2018&genes=KRAS` (+ `groupBy:"CANCER_TYPE_DETAILED"`) |
| Q4 OQL | Q1 base, `gene_list=KRAS: MUT=G12D⏎TP53: HOMDEL` | portal passes plain `KRAS TP53`; `genes:["KRAS: MUT=G12D", …]` refused by the engine |

Legacy per-group numbers read from the chart component's React props (`countsByGroup`: `profiledTotal`, `alteredCount`, `alterationTypeCounts`, `profiledCounts`) with the total-threshold box set to 0, cross-checked against hovered bar tooltips (identical). cBioLab numbers from the `cancertypes` result. Scripts, JSON and screenshots: (local scratch, not committed) (`legcts.js`, `labcts.py`, `ctscompare.py`; `out/leg-cts-*.json|png`, `out/lab-cts-*.json`, `out/cts1.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 11 |
| 🟡 partial | 15 |
| 🔶 different | 14 |
| ❌ missing | 15 |
| 🐞 ok | 1 |
| 🐞 copied | 0 |
| N/A | 3 |
| ? | 0 |
| **Total IDs** | **59** |

**Overall: 25.4 %** (✅ 11 + 🐞ok 1 + N/A 3 = 15 of 59). Counting 🟡 as half: 38.1 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Shared chrome | 4 | 1 | 2 | 1 | 0 | 0 | 0 | Tab and link ✅; no OQL banner or filter warnings |
| §1 Gene tabs (GT) | 6 | 3 | 1 | 0 | 1 | 0 | 1 | Same pill tabs; no grey label for unaltered genes |
| §2 Category (CT) | 10 | 0 | 1 | 4 | 4 | 0 | 1 | Same 3 categories (+ any attribute); default always Cancer Type; small groups pooled, not filtered; no altered threshold, no sort select |
| §2 Occurrence (OC) | 5 | 3 | 0 | 0 | 1 | 0 | 1 | Count By (Patients default) and Y-axis ✅; no "Show Genomic Alteration Types" |
| §3 Chart (CH) | 9 | 0 | 4 | 4 | 1 | 0 | 0 | Stacked bars with same colours but reversed stack; "+" rows only where groups differ; SVG titles, not popovers; study ids as labels |
| §4 Sorting (SO) | 4 | 1 | 0 | 2 | 1 | 0 | 0 | Frequency order identical; count mode still sorted by frequency; no Alphabetical |
| §5 Downloads (DL) | 3 | 0 | 0 | 0 | 3 | 0 | 0 | No download at all |
| §6 Modes (MD) | 12 | 2 | 3 | 2 | 4 | 1 | 0 | Patients/samples ✅; OQL not applied; no filters/Show-only-profiled; default category per mode differs |
| §8 Statistics (STM) | 6 | 1 | 4 | 1 | 0 | 0 | 0 | Every denominator identical; altered counts identical in all 65 groups compared; amp + homdel across genes → Multiple (legacy picks one) in 3 groups |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **OQL ignored**: the tab draws every alteration of the genes. Q4 legacy `KRAS: MUT=G12D` + `TP53: HOMDEL` → NSCLC 64 / 1567, Pancreatic 150 / 487; cBioLab KRAS alone 454 / 1567, 369 / 487. No OQL banner | MD-5, GT-6, 0.3 | (tracked) "the oncoprint and gene tabs still draw every alteration" |
| 2 | **Default category always Cancer Type**: coadread (one cancer type) shows one bar "Colorectal Cancer" instead of 3 Cancer Type Detailed bars; multi-study shows cancer types instead of studies | CT-2, MD-2, MD-3 | not tracked |
| 3 | **Small groups pooled, not filtered**: "18 smaller groups" bar (24 / 76) instead of the alert "40 of 58 categories (Cancer Type) are shown based on filtering."; no Min. # Total slider/text box, only a "min group" select (1/10/50/100/200/500) | CT-3, CH-1, STM-6 | not tracked |
| 4 | **No Min. % / # Altered filter, no Sort X-Axis (Alphabetically)** | CT-4, CT-5, SO-3 | not tracked |
| 5 | **No downloads** (SVG / PNG / PDF / Data TSV) | DL-1..3, MD-12 | not tracked (hide switch tracked under Data-governance) |
| 6 | **Bar tooltip**: SVG `<title>` "Colorectal Cancer: 92.8% (911 / 982 patients)" per bar and per segment; legacy popover "Gene altered in 92.77% of 982 patients" + type table at 2 dp; no study link / "Query this study" | CH-7, STM-5, MD-2 | not tracked |
| 7 | **Stack order reversed** (Mutation at the bottom, Multiple on top; legacy Multiple bottom, Mutation top); legend order differs; Multiple `#6e7a83` vs `#666` | CH-3, CH-4 | not tracked |
| 8 | **Count mode sorted by frequency**, not by count | SO-2 | not tracked |
| 9 | **Profiled strip**: "+" rows drawn only for a data type some group lacks, else one sentence "Every group was profiled for …"; no "−" glyph, no hover counts | CH-5, CH-6, MD-8 | not tracked |
| 10 | **By-study labels are study ids** (`brca_tcga_pan_can_atlas_2018`), not study names | CH-8, MD-2 | not tracked |
| 11 | **No "Show Genomic Alteration Types" toggle** | OC-3 | not tracked |
| 12 | **Driver/VUS/germline settings, Show only profiled** not applied (view has its own "count: any alteration / drivers") ; no warnings | MD-6, MD-7, 0.3 | (tracked) Driver-annotation settings |
| 13 | **Gene with no alterations**: no grey tab label, no "There are no alterations in this gene." | GT-4, MD-10 | not tracked |

---

## 3. Number check

Groups compared on every count: profiled (denominator), altered, Mutation / Amplification / Deep Deletion / SV / Multiple.

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 patients, All genes: groups | STM-1 | 58 Cancer Type groups | 58 | ✅ |
| Q1 patients: groups identical on all 7 counts | STM-3/4 | — | 55 / 58 | 🟡 (3 differ, see below) |
| Q1 Colorectal Cancer (patients) | STM-3/5 | 911 / 982 = 92.77 %; Mut 888, SV 3, Amp 1, Del 1, Multi 18 | 911 / 982 (92.8 %); same split | ✅ (display 1 dp) |
| Q1 Non-Small Cell Lung Cancer | STM-3 | 1178 / 1567 (75.18 %); Mut 1116, Amp 7, Del 5, SV 2, Multi 48 | identical | ✅ |
| Q1 Breast Cancer | STM-3 | 809 / 1246 (64.93 %); Mut 774, Amp 5, Del 1, Multi 29 | identical | ✅ |
| Q1 Germ Cell Tumor | STM-2/3 | 106 / 276; Del 2, Multi 10 | 106 / 276; Del 1, Multi 11 | 🔶 1 patient: AMP + HOMDEL in different genes → legacy "Deep Deletion" (first CNA), cBioLab "Multiple" |
| Q1 Bone Cancer | STM-2/3 | 33 / 129; Del 7, Multi 2 | 33 / 129; Del 6, Multi 3 | 🔶 same cause |
| Q1 GI Neuroendocrine Tumor | STM-2/3 | 13 / 45; Del 1, Multi 0 | 13 / 45; Del 0, Multi 1 | 🔶 same cause |
| Q1 Σ altered over groups (patients) | STM-3 | 5900 | 5900 | ✅ |
| Q1 samples: groups identical | STM-2 | — | 55 / 58 (same 3 groups, same cause) | 🟡 |
| Q1 samples NSCLC / Breast / Colorectal | STM-2 | 1237/1668, 865/1337, 932/1007 | identical, splits identical | ✅ |
| Q1 samples Σ altered | STM-2 | 6163 | 6163 | ✅ |
| Q1 KRAS tab (patients) | STM-3/4 | 58 groups; NSCLC 454/1567, CRC 438/982, Breast 25/1246; Σ 1772 | 58 / 58 groups identical; Σ 1772 | ✅ |
| Q1 groups kept at default threshold 10 | STM-6 | 40 of 58 shown | 40 drawn + 1 pooled bar "18 smaller groups" (24 / 76) | 🔶 |
| Q1 first bars (frequency order) | SO-1 | Colorectal, Small Cell Lung, Small Bowel… | Colorectal 92.77, Small Cell Lung 89.02, Small Bowel 85.71, Ovarian, Appendiceal | ✅ |
| Q1 slider max (Total / Altered) | STM-6 | 1567 / 100 % | — (no slider) | ❌ |
| Q2 by study: brca | STM-1/3 | 365 / 1084 (33.67 %); Mut 338, Amp 6, Del 9, Multi 12 | identical | ✅ |
| Q2 by study: coadread + header | STM-3 | 2 / 2 groups identical; Σ 775 | 2 / 2; 775 of 1678 | ✅ |
| Q2 default category | CT-2 | Cancer Study | Cancer Type | 🔶 |
| Q3 coadread Cancer Type Detailed | STM-1/3/4 | Colon 139/378, Mucinous 27/61, Rectal 56/155 (Amp 3, Del 1, Multi 1) | identical (with `groupBy:"CANCER_TYPE_DETAILED"`) | ✅ |
| Q3 profiled per data type (scatter) | CH-5 | Colon mutation 338, CNA 376, SV 338 (+ not-profiled 40/2/40) | `profiledFor` 338 / 376 / 338 | ✅ counts; 🔶 drawing |
| Q3 default category | CT-2 | Cancer Type Detailed (3 bars) | Cancer Type (1 bar) | 🔶 |
| Q4 OQL NSCLC / CRC / Pancreatic | MD-5 | 64/1567, 125/982, 150/487; Σ 530 | not expressible (OQL dropped; KRAS alone 454, 438, 369) | ❌ |
| Tooltip % | STM-5 | `_.round(x, 2)` "92.77%" | `fmtPct` 1 dp "92.8%" | 🟡 |

Data version: every denominator and every altered count matches in all 65 group comparisons; the only differences are the type bucket for patients/samples with an amplification in one gene and a deep deletion in another. Warehouse and cbioportal.org hold the same data for these studies.

---

## 4. Scorecard

### §0 Shared chrome

| ID | verdict | how | note |
|---|---|---|---|
| CTS-0.1 | 🟡 | B | Results header as in `01-oncoprint.md` RV-1..3 (same gaps) |
| CTS-0.2 | ✅ | BC | Tab "Cancer Types Summary", `?tab=Cancer+Types+Summary`, always laid out (`results-layout.ts:213`); Open in cBioPortal → `cancerTypesSummary` (`legacy-link.ts:34`) |
| CTS-0.3 | 🔶 | B | No OqlStatusBanner (OQL not applied; header note "the gene tabs draw every alteration"), no AlterationFilterWarning / CaseFilterWarning |
| CTS-0.4 | 🟡 | B | Generic card wait state; on error the engine's refusal text, not nothing |

### §1 Gene tabs

| ID | verdict | how | note |
|---|---|---|---|
| CTS-GT-1 | ✅ | B | "All Queried Genes · TP53 · KRAS · PIK3CA" pills |
| CTS-GT-2 | ✅ | C | Shown only when > 1 gene (`cancertypes.tsx:37`) |
| CTS-GT-3 | ✅ | C | First active; component state, no URL |
| CTS-GT-4 | ❌ | C | No grey label for a gene with 0 alterations |
| CTS-GT-5 | N/A | C | Invariant 9: the view's settings live in the document and are shared by every gene pill, so nothing resets on switch |
| CTS-GT-6 | 🟡 | C | One tab per distinct gene (`geneSymbols`) ✅; OQL not applied, so nothing is "pooled" |

### §2 Controls — Category

| ID | verdict | how | note |
|---|---|---|---|
| CTS-CT-1 | 🟡 | B | "category" select: Cancer Study / Cancer Type / Cancer Type Detailed + every categorical sample attribute; kept in the document |
| CTS-CT-2 | 🔶 | BC | Always `CANCER_TYPE` (layout sends no `groupBy`); Q2 legacy Cancer Study, Q3 legacy Cancer Type Detailed |
| CTS-CT-3 | 🔶 | B | "min group" select 1/10/50/100/200/500, default 10 ✅ on profiled count ✅; groups below are pooled into one named bar, not hidden; no slider or text box |
| CTS-CT-4 | ❌ | B | No Min. % / # Altered |
| CTS-CT-5 | ❌ | B | No Sort X-Axis By |
| CTS-CT-6 | 🔶 | B | Wording "min group" (tip: "fewer profiled patients (or samples)"), not "Min. # Total Patients\|Samples" |
| CTS-CT-7 | ❌ | B | No text boxes |
| CTS-CT-8 | N/A | C | No sliders to time |
| CTS-CT-9 | ❌ | B | No highlighted input |
| CTS-CT-10 | 🔶 | C | No resets: category, count-by, min group and y-axis are independent document fields |

### §2 Controls — Occurrence

| ID | verdict | how | note |
|---|---|---|---|
| CTS-OC-1 | ✅ | BC | "count by: patients / samples", patients default (`run.ts:27`), shared across pills |
| CTS-OC-2 | ✅ | B | "y-axis: Alteration Frequency / Absolute Counts" |
| CTS-OC-3 | ❌ | B | No "Show Genomic Alteration Types" |
| CTS-OC-4 | ✅ | B | No per-type toggles (an extra "count: any alteration / drivers" exists) |
| CTS-OC-5 | N/A | C | Invariant 9 (see GT-5) |

### §3 Chart

| ID | verdict | how | note |
|---|---|---|---|
| CTS-CH-1 | 🔶 | B | No filter alert; the pooled bar "18 smaller groups" is drawn last and named in the caption |
| CTS-CH-2 | 🟡 | BC | Vertical stacked bars ≤ 32 px, plot 240 px (legacy 20 px / 400); y titles identical; labels at 45° under the bars (legacy 50°); more groups than fit → figure grows and scrolls, no synced top scrollbar |
| CTS-CH-3 | 🔶 | C | Stack bottom → top: Mutation, Amplification, Deep Deletion, SV, Multiple (`figure.ts:11, 76`) — legacy reverse; no Gain / Shallow Deletion / mRNA / Protein buckets (not loaded / not counted); colours identical except Multiple `#6e7a83` (legacy `#666`) |
| CTS-CH-4 | 🟡 | B | Only types present ✅; order Mutation · Amplification · Deep Deletion · Structural Variant · Multiple (legacy Mutation · SV · Amp · Deep Del · Multiple) |
| CTS-CH-5 | 🔶 | BC | Rows "Mutation data / CNA data / Structural variant data" with "+" only for a type some group lacks; when every group has it, one line "Every group was profiled for mutation, CNA and structural variant data." (`figure.ts:39-42, 101-105`); no "−"; no mRNA/protein rows; per-type profiled counts identical to legacy (Q3) |
| CTS-CH-6 | ❌ | B | No scatter tooltip |
| CTS-CH-7 | 🟡 | BC | SVG `<title>` per segment "Colorectal Cancer — Mutation: 888 of 982 profiled patients" and per bar "Colorectal Cancer: 92.8% (911 / 982 patients)"; no popover table, no study link, no "Query this study" |
| CTS-CH-8 | 🔶 | B | Raw values ✅ for attributes; by study the label is the study id (`sql.ts:35`), not the study name |
| CTS-CH-9 | 🟡 | C | No profiled unit → refusal "no patient in this cohort was profiled for …" (`run.ts:98`); "No data to plot" cannot occur (nothing filtered); no "There are no alterations in this gene." |

### §4 Sorting

| ID | verdict | how | note |
|---|---|---|---|
| CTS-SO-1 | ✅ | BC | Descending altered ÷ profiled (`run.ts:47`); Q1 first five bars identical |
| CTS-SO-2 | 🔶 | C | Absolute Counts still sorted by frequency |
| CTS-SO-3 | ❌ | B | No Alphabetical |
| CTS-SO-4 | 🔶 | C | Ties broken by profiled count descending, not first appearance; pooled bar always last |

### §5 Downloads

| ID | verdict | how | note |
|---|---|---|---|
| CTS-DL-1 | ❌ | B | No download button on the portal card |
| CTS-DL-2 | ❌ | B | — |
| CTS-DL-3 | ❌ | B | No Data TSV |

### §6 Modes & conditions

| ID | verdict | how | note |
|---|---|---|---|
| CTS-MD-1 | ✅ | BC | Samples ↔ patients changes every numerator and denominator (Q1 both modes identical to legacy); captions follow the unit (see bug 1 for exceptions); no thresholds to reset |
| CTS-MD-2 | 🔶 | BC | Default Cancer Type (not Study); study ids as labels; no link / Query this study; counts per study identical |
| CTS-MD-3 | 🔶 | B | Default Cancer Type → 1 bar for coadread |
| CTS-MD-4 | ✅ | B | Single gene: no "All Queried Genes" |
| CTS-MD-5 | ❌ | BC | OQL dropped (`results-layout.ts:213` passes `genes`); OQL entries refused by the engine ("a cancertypes view needs genes"); no OQL banner, no EXP/PROT segments (tracked) |
| CTS-MD-6 | 🟡 | BC | Own "count: drivers" (OncoKB only) toggle, not the page's settings; no VUS/germline/hotspot; no warning (tracked: Driver-annotation settings) |
| CTS-MD-7 | ❌ | C | No Show only profiled |
| CTS-MD-8 | 🟡 | BC | Denominator excludes cases whose panels lack the genes ✅ (all denominators identical); profiled strip lacks "−" |
| CTS-MD-9 | 🐞 ok | C | Groups are pooled, never all filtered away; controls never disappear |
| CTS-MD-10 | ❌ | C | No grey label, no message |
| CTS-MD-11 | 🟡 | B | > 37 groups: figure widens and scrolls; no top scrollbar |
| CTS-MD-12 | ❌ | C | No hide-download switch (no downloads either) (tracked: Data-governance switches) |

§7 Persistence (no IDs): legacy persists nothing; cBioLab keeps category, count-by, measure, min group and y-axis in the document (`?changes=`) per invariant 9; the active gene pill stays in the browser.

### §8 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| CTS-STM-1 | 🟡 | BC | Grouping by sample `CANCER_TYPE` / `CANCER_TYPE_DETAILED` / study ✅; values case- and whitespace-folded; missing value → "(no CANCER_TYPE value)" group (legacy: study cancer type, else "Unknown"; detailed falls back to cancer type); a patient spanning groups counts in each ✅ |
| CTS-STM-2 | 🟡 | BC | Sample mode: denominators, altered and splits identical in 55/58 groups; types de-duplicated by **subtype** (amp ≠ homdel), so AMP in one gene + HOMDEL in another → Multiple (legacy: whichever CNA comes first — 3 groups differ by 1); only profiled samples can count as altered (`sql.ts:53-55`), no difference seen; no gain/hetloss/mRNA/protein buckets |
| CTS-STM-3 | 🟡 | BC | Patient mode same rules on the union of samples; 55/58 (All), 58/58 (KRAS), 2/2 (study), 3/3 (detailed) identical; no not-profiled-per-sample double count (legacy bug avoided) |
| CTS-STM-4 | ✅ | BC | Profiled = panel lists the gene for mutation, CNA or SV (`sql.ts:47-52`); All = union over genes; every denominator identical |
| CTS-STM-5 | 🟡 | BC | Heights = count ÷ profiled × 100 or count ✅; tooltip % 1 dp (`fmtPct`), legacy 2 dp |
| CTS-STM-6 | 🔶 | BC | Threshold on profiled count, inclusive ✅ (40 of 58 kept, same as legacy) but the rest pooled; no altered threshold; no slider maxima |

---

## 5. cBioLab bugs (wrong on its own terms)

1. **"samples" where the unit is patients**: the results text says "samples profiled for at least one gene" and "N of M profiled samples altered" whatever the unit (`kind.ts:13-14`), and the card subtitle says "% of profiled samples" (`cancertypes.tsx:95`), while the default (and portal) unit is patients (`run.ts:27`). The figure caption gets it right.
2. **Absolute Counts is not "highest first"**: `arrange` always sorts by altered ÷ profiled (`run.ts:47`), though the figure promises "a vertical bar per group, highest first" (`figure.ts:22`); in count mode, bar heights are not in order.
3. **`types.ts:6-10` and the DSL summary (`doc.ts:9`)** describe "% of samples" for a view that counts patients by default.
