# Parity audit — Patient View › shell + Summary (spec `40-patient-summary.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day: page DOM + REST API)
- **Code paths (cBioLab):** `app/portal/patient/page.tsx` (page), `app/portal/patient-header.tsx` + `app/portal/patient-attrs.ts` (header, clinical spans), `app/portal/cohort-nav.tsx` + `cohort-navigation.ts` (pager), `app/portal/patient-layout.ts` (tabs → views), `app/portal/PortalTabs.tsx`; timeline `lib/timeline-tracks.ts`, `lib/timeline-svg.ts`, `app/lab/timeline-body.tsx`; genomic overview `app/lab/genomic-overview.tsx`, `lib/views/segments/{igv,run,sql}.ts`; tables `lib/views/alterations/run.ts`, `lib/patient-alterations.ts`, `app/lab/alterations-body.tsx`

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| P1 multi-sample (4), WES, timeline, no CNA/SV | `/patient?studyId=lgg_ucsf_2014&caseId=P04` | `/portal/patient?studyId=lgg_ucsf_2014&caseId=P04` |
| P2 sample mode | `/patient?studyId=lgg_ucsf_2014&sampleId=P04_Rec1#navCaseIds=…P01,…P04,…P05` | `/portal/patient?studyId=lgg_ucsf_2014&sampleId=P04_Rec1`; nav via `&cohort=<def of P01,P04,P05>` |
| P3 TCGA, CNA, segments, mRNA | `/patient?studyId=coadread_tcga_pan_can_atlas_2018&caseId=TCGA-A6-2671` | `/portal/patient?studyId=coadread_tcga_pan_can_atlas_2018&caseId=TCGA-A6-2671` |
| P4 gene panel + TMB-H | `/patient?studyId=msk_impact_2017&caseId=P-0000004` | `/portal/patient?studyId=msk_impact_2017&caseId=P-0000004` |

Legacy numbers from the expanded tables (all rows, "Show more" until gone) and `/api/molecular-profiles/*/mutations/fetch`, `/discrete-copy-number-counts/fetch`, `/sample-lists/*_sequenced`; cBioLab numbers from `/api/analysis` (`alterations`, `evolution` views) and the rendered page. Scripts, JSON and screenshots: (local scratch, not committed) (`leg.js`, `lab.js`, `labnav.js`, `cmp_mut.py`, `out/leg_*.json|png`, `out/labui_*.json`, `out/lab_*_0.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 35 |
| 🟡 partial | 25 |
| 🔶 different | 12 |
| ❌ missing | 15 |
| 🐞 ok | 4 |
| 🐞 copied | 0 |
| N/A | 1 |
| ? | 0 |
| **Total IDs** | **92** |

**Overall: 43.5 %** (✅ 35 + 🐞ok 4 + N/A 1 = 40 of 92). Counting 🟡 as half: 57.1 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| URL | 6 | 2 | 1 | 2 | 0 | 1 | 0 | Portal params accepted; tab in `?tab=`; navCaseIds hash ignored |
| SH header | 7 | 2 | 4 | 0 | 1 | 0 | 0 | Header text identical; no page title, no TMB-H/MSI-H badges, no PDX icon |
| CS clinical spans | 5 | 5 | 0 | 0 | 0 | 0 | 0 | Verbatim port of clean/derive/whitelist/punctuation |
| NAV | 5 | 3 | 0 | 1 | 1 | 0 | 0 | Pager works; "N patients" opens a list, not study view; no exclude |
| TAB | 1 | 0 | 0 | 1 | 0 | 0 | 0 | Different order and gating; placeholder tabs |
| SUM | 2 | 2 | 0 | 0 | 0 | 0 | 0 | No actionability cards; sample mode scopes data, timeline whole patient |
| TL tracks | 6 | 1 | 3 | 0 | 0 | 1 | 1 | Order/nesting right; labels not upper-cased; tie order differs |
| TL events | 6 | 5 | 1 | 0 | 0 | 0 | 0 | Glyphs, stacks, sample markers, diamond, line charts |
| TL tooltips | 4 | 0 | 1 | 3 | 0 | 0 | 0 | Hover-only, ≤4 events stacked; no pin/paging/sample clinical rows |
| TL axis/zoom | 5 | 1 | 2 | 0 | 2 | 0 | 0 | Year ticks and trims; no month ticks, drag-zoom or download |
| GO genomic overview | 9 | 9 | 0 | 0 | 0 | 0 | 0 | Close igv port; side columns' numbers identical |
| MT mutations table | 6 | 0 | 2 | 2 | 2 | 0 | 0 | Same rows; one max VAF not per-sample bars; no mRNA, no gene filter |
| CNA table | 5 | 1 | 2 | 1 | 0 | 1 | 0 | Same 74 rows; empty table instead of "not profiled" alert |
| SV table | 5 | 0 | 2 | 1 | 1 | 1 | 0 | Different default columns; no Status/Annotation |
| NP / GP panels | 5 | 1 | 1 | 0 | 3 | 0 | 0 | GO panel icons only; no alerts, pills, modal |
| STM | 15 | 3 | 6 | 1 | 5 | 0 | 0 | Counts match; display rounding; no mRNA %, VAF plot, badges |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Allele Freq is one number** (highest VAF among samples) — no per-sample bars, no "x variant reads out of y" tooltip, no VAF header plot; always 2 decimals (legacy 4 below 0.01) | MT-3, STM-1, STM-7 | not tracked |
| 2 | **VAF shown wrong by double rounding** on 5 of 64 TCGA-A6-2671 rows (APC S943Qfs*12 0.17 vs 10/57 = 0.18) — see cBioLab bugs | STM-1 | not tracked |
| 3 | **Mutation table columns**: Mutation Type raw MAF (`Frame_Shift_Del` vs `FS del`); Copy # only AMP/HOMDEL (legacy ShallowDel/Gain/Diploid on 61/64 TCGA rows) and kept with >1 sample; no mRNA Expr.; Samples column even with 1 sample; Annotation is OncoKB text only | MT-2, MT-5, STM-4 | partly: "Mutation annotation breadth"; "OQL coverage" (only ±2 CNA loaded) |
| 4 | **Default sort and paging**: gene-grouped, driver genes first, 25 rows; legacy Annotation desc, 10 rows (P1 first rows: legacy IDH1, TP53, MBD4, SPRTN; cBioLab IDH1, MBD4, SPRTN, TP53) | MT-1, CNA-3 | not tracked |
| 5 | **No "Study is not profiled for …" alerts and no not-profiled indicators**: lgg shows empty CNA/SV tables ("no rows"); no grey pills, no Gene panel column, no panel modal | CNA-2, SV-2, NP-1, GP-2..4 | not tracked |
| 6 | **Tab bar**: order Summary · Pathways · Clinical Data · Genomic Evolution (legacy GE second); GE shown for single-sample TCGA/msk patients; "Clinical Trials" and "Files & Links" placeholders always | TAB | Files & Links, Clinical Trials (tracked) |
| 7 | **Timeline**: no drag-zoom, no download (PDF/PNG/SVG/ZIP), no month ticks, tooltips not pinnable/pageable, sample-row tooltip lacks the sample's clinical data | TL-ZM-1/3/4, TL-TT-1..4 | not tracked |
| 8 | **OncoKB TMB-H / MSI-H header badges** missing (msk P-0000004 legacy ", TMB-H") | SH-6, STM-9 | not tracked |
| 9 | **Gene filter "profiled in all samples"** (Gene header gear) missing | MT-6, STM-15 | not tracked |
| 10 | **Cohort column**: "72.5%" (1 decimal) vs "72%" / "<1%"; no keyword bar (green), no tooltip, no MutSig / GISTIC badges | STM-2, STM-3, CNA-4 | not tracked |
| 11 | **Browser title** is "cbio-lab", not "Patient: P04" | SH-1 | not tracked |
| 12 | **Portal cohort links**: `#navCaseIds=` ignored (page opens without the pager); no ⊖ exclude; "N patients" opens a list dialog, not study view | URL-4, NAV-3, NAV-4 | not tracked |
| 13 | **SV table**: default Breakpoint Type shown; no Status (s/g) or Annotation; A–B and B–A not merged | SV-1, SV-3 | Annotation tracked (SV tab item) |
| 14 | **Signature mini-bar in sample row** | SH-6, STM-8 | (tracked) "patient header's significant-signatures badge" |
| 15 | **Table sample numbers ignore collection days** (fine on P04 by chance) | STM-12 | (tracked) Known issues |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| P1 mutation rows (merged) | MT-1, STM-14 | 80 | 80, same (gene, protein change) set | ✅ |
| P1 sample set per row (Samples column) | MT-4 | 80 rows | 80 rows identical sample numbers | ✅ |
| P1 Cohort % per row | STM-2 | 77 rows integer %, 3 blank (AKAP6 C1154delinsWH, MUC4 R3900_T3915del, PRAG1 A351_S352insAA) | 77 equal after rounding; the 3 blank rows 3.3 / 9.8 / 6.6 % | 🟡 counts ✅; legacy blanks look like a legacy bug |
| P1 Cohort denominator | STM-2 | `lgg_ucsf_2014_sequenced` = 61 | samples profiled for the gene (WES: 61) | ✅ (invariant 7; same here) |
| P1 per-sample VAF (alt, ref) | STM-1 | 113 records, 88 with counts | 88 called cells identical alt/ref; 144 "not found" (VAF 0); 22 mutations no counts both | ✅ |
| P1 GO mutation count per sample | STM-6 | 12 / 28 / 18 / 55 | 12 / 28 / 18 / 55 | ✅ |
| P2 sample mode GO / table | STM-6, SUM-2 | 28; header "2 P04_Rec1 … Show all 4 samples" | 28; 28 Mutations; same header | ✅ |
| P3 mutation rows | MT-1 | 64 | 64, same set | ✅ |
| P3 Cohort % | STM-2 | 61 equal, 3 blank (BABAM2 X261_splice, ADAM32 X720_splice, CPD N210_D215del) | equal after rounding; blanks 1.1 / 3.2 / 3.4 % | 🟡 |
| P3 Allele Freq text | STM-1 | 64 values | 59 equal; 5 differ: APC S943Qfs*12 0.18→0.17, PC V944M 0.76→0.77, EZHIP G373A 0.38→0.39, HRNR S2028G 0.11→0.10, SCN1A H553Q 0.43→0.42 | 🔶 bug |
| P3 Copy # | MT-2 | ShallowDel 24, Gain 35, Diploid 2, Amp 2, blank 1 | blank 62, AMP 2 | 🔶 deep calls only |
| P3 CNA rows / cytoband / Cohort % | CNA-1, STM-3 | 74 rows, ANK1 AMP 5 % … | 74 rows; cytoband 74/74; Cohort % 74/74 equal after rounding (ANK1 4.6 %) | ✅ counts, 🟡 format |
| P3 GO | STM-5, STM-6 | 64 · 48.8 % | 64 · 48.8 % | ✅ |
| P4 mutation rows / Cohort % | STM-2 | 16; AKT1 2 %, TP53 41 %, PDCD1 <1 % | 16; 1.6 %, 41.5 %, 0.7 % | ✅ counts, 🟡 format |
| P4 numerators (API) | STM-2 | PDCD1 82, TSHR 123, AKT1 174 of 10,945 → 0.75 / 1.12 / 1.59 % | 0.7 / 1.1 / 1.6 % (1-decimal SQL round) | ✅ |
| P4 CNA Cohort | STM-3 | RAC1 67, BRCA2 28, PMS2 55 of 10,945 → "<1%" ×3 | 0.6 % / 0.3 % / 0.5 % | 🟡 counts ✅, no "<1%" |
| P4 GO | STM-5, STM-13 | 16 · 27.8 % · P1 P1 | 16 · 27.8 % · P1 P1 | ✅ |
| P4 TMB-H badge | STM-9 | ", TMB-H" | absent | ❌ |
| Header text P1 / P3 / P4 | CS-4, CS-5 | "P04, Male, 22 years old, Glioma, DECEASED (61 months)"; samples ", Primary (Astrocytoma)" … | identical | ✅ |
| Sample numbering P1 | STM-12 | P04_Pri 1, Rec1 2, Rec2 3, Rec3 4 | same (header, tables, timeline) | ✅ here |

Data version: every row set, read count and cohort numerator matches, so the warehouse and cbioportal.org hold the same data for these studies. OncoKB pinned in cBioLab; legacy's Annotation icons were not read.

---

## 4. Scorecard

### §1 Page shell — URL

| ID | verdict | how | note |
|---|---|---|---|
| PAT-URL-1 | 🔶 | BC | `/portal/patient?…&tab=<Title>` (title, not path id `/patient/<tab>`); unknown tab → Summary ✅ |
| PAT-URL-2 | ✅ | B | `studyId` + `caseId` / `sampleId` accepted (also `study`/`patient`/`sample`); sample wins (`page.tsx:57`) |
| PAT-URL-3 | 🟡 | C | Page state in `?changes=` (GE settings, collapse etc., invariant 9); no `resourceUrl`, plots params, `geneset_list` |
| PAT-URL-4 | 🔶 | B | `#navCaseIds=` ignored (no pager shown); cohort carried as a definition `?cohort=` / stored `?s=` (`cohort-navigation.ts:21`); no POSTed list |
| PAT-URL-5 | ✅ | C | `PatientView` keyed by study\|patient\|sample (`page.tsx:62`) |
| PAT-URL-6 | 🐞 ok | C | No id-list parsing at all, so no `this.studyId` crash |

### §1 Header

| ID | verdict | how | note |
|---|---|---|---|
| PAT-SH-1 | ❌ | B | Title "cbio-lab" on every patient; no meta description |
| PAT-SH-2 | 🟡 | B | "Patient:" / "Samples:" rows ✅; no user-circle icon; study is id + name text in a summary card, not a link to the study; pager right ✅ |
| PAT-SH-3 | ✅ | B | Skeleton rows while the header loads; tabs load separately |
| PAT-SH-4 | 🟡 | B | Unknown patient → "no patient NOPE in lgg_ucsf_2014", but tabs still render with "cohort's patient list is empty" refusals |
| PAT-SH-5 | ✅ | BC | Id link → patient view; spans + lifted CANCER_TYPE(_DETAILED) (`patient-attrs.ts:390`); hover table of all attributes (display names, raw values) |
| PAT-SH-6 | 🟡 | B | Marker, id link (in place; modifier → new tab), DISPLAY_SAMPLE_NAME, spans, sample mode + "Show all 4 samples" ✅; no TMB-H/MSI-H badges, signature bar (tracked), PDX/organoid icon, gene-panel links in tooltip |
| PAT-SH-7 | 🟡 | C | 14 px circle, number ✅; colour from raw SAMPLE_TYPE regex (`timeline-tracks.ts:36`), not the derived type; total DNA/Tissue → #333 not black; no custom colour config; no not-profiled pill / uncalled opacity |

### §1.2 Clinical spans

| ID | verdict | how | note |
|---|---|---|---|
| PAT-CS-1 | ✅ | C | Same null list, floors, 0:/1: strip (`patient-attrs.ts:285-301`) |
| PAT-CS-2 | ✅ | C | Same attribute order and substring priority; no custom types (server config) |
| PAT-CS-3 | ✅ | C | `patient-attrs.ts:326` |
| PAT-CS-4 | ✅ | BC | Whitelist, order, formats, colours entry for entry (`patient-attrs.ts:335`); header text identical on P1/P3/P4 |
| PAT-CS-5 | ✅ | BC | Same punctuation rule (`patient-attrs.ts:373`) |

### §1.3 Cohort navigation

| ID | verdict | how | note |
|---|---|---|---|
| PAT-NAV-1 | ✅ | B | First / prev / [2] / "3 patients" / next / last; ends disabled |
| PAT-NAV-2 | ✅ | B | Typed 3 + Enter → P05 |
| PAT-NAV-3 | 🔶 | B | "N patients" opens a searchable list dialog in place, not study view |
| PAT-NAV-4 | ❌ | C | No exclude-patient button |
| PAT-NAV-5 | ✅ | C | `patientHref` uses patient mode (`cohort-navigation.ts:42`) |

### §1.4 Tabs

| ID | verdict | how | note |
|---|---|---|---|
| PAT-TAB | 🔶 | B | P1: Summary · Pathways · Clinical Data · Genomic Evolution · Files & Links · Clinical Trials (legacy Summary · Genomic Evolution · Pathways · Clinical Data); GE also on 1-sample P3/P4; Pathways hidden only with no genomic data; Files & Links, Clinical Trials are "not built yet" cards; no Pathology Report, Tissue Image, mRNA, Plots, resource or custom tabs (detail in 41-patient-tabs) |

### §2 Summary layout

| ID | verdict | how | note |
|---|---|---|---|
| PAT-SUM-1 | ✅ | B | No actionability cards; OncoKB only in Annotation columns |
| PAT-SUM-2 | ✅ | B | P2: GO, tables show P04_Rec1 only; timeline still 15 events · 4 samples |

Layout: Timeline → Genomic overview → one "Genomic alterations" card (Mutations, CNA, SV in that order; legacy Mutations, SV, CNA). Timeline card shown even with no events (P4: "has no timeline events recorded"); legacy hides it.

### §3 Timeline — tracks

| ID | verdict | how | note |
|---|---|---|---|
| PAT-TL-TR-1 | 🟡 | B | Root order ✅ (`TRACK_ORDER`); labels keep study case ("Specimen", "STATUS", "Sample Acquisition") vs legacy upper-case |
| PAT-TL-TR-2 | 🟡 | B | Nesting and lone-Other collapse ✅ (TCGA: Treatment › Other › Conatumumab …); tie on start sorted by label (P1: Medical Therapy above Radiation Therapy, both day 488; legacy Radiation first) |
| PAT-TL-TR-3 | 🐞 ok | C | Underscore-stripping quirk not copied |
| PAT-TL-TR-4 | ✅ | B | ▾ click folds children onto parent; kept in the document (invariant 9) + "expand all tracks" |
| PAT-TL-TR-5 | 🟡 | C | Only the label text highlights on hover (`globals.css:1731`); no row band |
| PAT-TL-TR-6 | N/A | — | Spec: not required for parity |

### §3 Timeline — events

| ID | verdict | how | note |
|---|---|---|---|
| PAT-TL-EV-1 | 🟡 | C | Point r=4, STYLE_COLOR, square/triangle/diamond/star ✅ (`timeline-svg.ts:31-43`); no camera |
| PAT-TL-EV-2 | ✅ | C | Bar height 5, rounded |
| PAT-TL-EV-3 | ✅ | C | Same-day stack + count |
| PAT-TL-EV-4 | ✅ | B | Numbered sample markers on Specimen / Sample Acquisition rows |
| PAT-TL-EV-5 | ✅ | C | DECEASED → black diamond (`timeline-svg.ts:32`) |
| PAT-TL-EV-6 | ✅ | C | Numeric lab results as line charts (`timeline-svg.ts:174`) |

### §3 Timeline — tooltips

| ID | verdict | how | note |
|---|---|---|---|
| PAT-TL-TT-1 | 🔶 | C | Hover only; no click-to-pin, no Esc, no 100 ms linger |
| PAT-TL-TT-2 | 🟡 | C | Attributes with `_`→space, DATE / START / END formatted + "(day n)" ✅; no Markdown links / iframe |
| PAT-TL-TT-3 | 🔶 | C | Sample row: event attributes + "· sample n"; no sample clinical attributes |
| PAT-TL-TT-4 | 🔶 | C | Up to 4 events stacked + "and N more"; no `[<] i of n [>]` paging or keys |

### §3 Timeline — axis, zoom, download

| ID | verdict | how | note |
|---|---|---|---|
| PAT-TL-ZM-1 | 🟡 | B | Year ticks "0, 1y … 5y" ✅; no month minor ticks |
| PAT-TL-ZM-2 | 🟡 | B | ≥4 empty years cut to a dashed mark ✅; restored by an "every year" checkbox (in the document), not by clicking it |
| PAT-TL-ZM-3 | ❌ | C | No drag-to-zoom, no cursor line |
| PAT-TL-ZM-4 | ❌ | C | No download (PDF/PNG/SVG/ZIP) |
| PAT-TL-ZM-5 | ✅ | C | Card width (ResizeObserver) |

### §4 Genomic Overview

| ID | verdict | how | note |
|---|---|---|---|
| PAT-GO-1 | ✅ | C | Study build hg19/hg38 (`segments/run.ts:66-74`) |
| PAT-GO-2 | ✅ | BC | MUT then CNA tracks, 18 px rows, clamp height (`genomic-overview.tsx:27-40`) |
| PAT-GO-3 | ✅ | B | Marker / count / CNA % / panel columns; same tooltips verbatim; P4 "P1" |
| PAT-GO-4 | ✅ | C | Compact view, "Reset View" |
| PAT-GO-5 | ✅ | C | Popups Sample/Gene/Protein Change/Location and Sample/Mean CN log2/Location (`igv.ts:50,63`) |
| PAT-GO-6 | ✅ | C | Zoom → advanced |
| PAT-GO-7 | ✅ | C | Mutation/CNA row click → gene locus via locus bus; one selected row across tables |
| PAT-GO-8 | ✅ | C | Reset → compact, whole genome, row deselected |
| PAT-GO-9 | ✅ | C | No circos / per-sample VAF track in either |

### §5 Mutations table

| ID | verdict | how | note |
|---|---|---|---|
| PAT-MT-1 | 🟡 | BC | Same rows (80/64/16); uncalled not listed (lgg has none); header "80 Mutations" ✅; 25 rows/page (legacy 10); default sort gene-grouped, driver genes first (`patient-alterations.ts:149`) vs Annotation desc; no "not profiled for mutations" alert |
| PAT-MT-2 | 🔶 | B | Default: Samples · Gene · Protein Change · Annotation (OncoKB) · Mutation Type · Copy # · Cohort % · Allele Freq; Samples shown with 1 sample; Copy # shown with >1 sample; no mRNA Expr., Gene panel, Functional Impact, ASCN/CCF/clonal, Exon/gnomAD/ClinVar/dbSNP/SIGNAL; Columns menu ✅ (17 columns) |
| PAT-MT-3 | 🔶 | B | One value = highest VAF among samples (`patient-alterations.ts:127`), 2 decimals; no bars, no reads tooltip, no header VAF plot |
| PAT-MT-4 | 🟡 | B | Marker per carrying sample, "--" where not (equal-width slots) ✅; no grey not-profiled pill, no uncalled opacity |
| PAT-MT-5 | ❌ | B | No mRNA Expr. column (P3 legacy 25 %, 29 % …) |
| PAT-MT-6 | ❌ | C | No gene filter menu |

### §6 Copy Number Alterations table

| ID | verdict | how | note |
|---|---|---|---|
| PAT-CNA-1 | ✅ | B | ±2 only, merged by gene + call; 74/74 rows |
| PAT-CNA-2 | 🔶 | B | lgg: "0 Copy Number Alterations … no rows", not "Study is not profiled …" |
| PAT-CNA-3 | 🟡 | B | "74 Copy Number Alterations" ✅; 25 rows; sort driver genes first then gene |
| PAT-CNA-4 | 🟡 | B | Samples (always) · Gene · CNA (AMP/HOMDEL, not DeepDel) · Annotation (OncoKB) · Cytoband ✅ · Cohort %; no mRNA Expr., Custom Driver, GISTIC badge, Gene panel |
| PAT-CNA-5 | 🐞 ok | C | No gene filter, so the mutation-panel-map bug cannot occur |

### §7 Structural Variants table

| ID | verdict | how | note |
|---|---|---|---|
| PAT-SV-1 | 🟡 | C | All SV rows of the patient; merged by (gene1, gene2, class, event, pos1, pos2), unsorted — A–B and B–A stay apart (`patient-alterations.ts:221`) |
| PAT-SV-2 | 🟡 | B | Empty: "0 Structural Variants … no rows" ✅; no "not profiled" alert (lgg) |
| PAT-SV-3 | 🔶 | B | Samples · Gene 1 · Gene 2 · Variant Class · Event Info · Breakpoint Type · Connection Type; no Status badge, no Annotation (tracked), +13 optional columns |
| PAT-SV-4 | 🐞 ok | C | No SV gene filter |
| PAT-SV-5 | ❌ | C | No server column config (tracked: Instance defaults) |

### §8 Gene panels and profiling

| ID | verdict | how | note |
|---|---|---|---|
| PAT-NP-1 | ❌ | B | No "Sample(s) … not profiled for …" alert above any table |
| PAT-GP-1 | ✅ | C | Profiled = panel covers the gene (`profiledCte`, `patient-alterations.ts:77`; evolution `np`) |
| PAT-GP-2 | 🟡 | B | GO panel icons ✅; no not-profiled pill, Gene panel column, tooltip link |
| PAT-GP-3 | ❌ | C | No gene panel modal |
| PAT-GP-4 | ❌ | C | No gene-panel links |

Persistence: tab, mode, ids, collapse, trims, table query/columns/paging in the URL document (invariant 9); legacy keeps most of these local. Selected row / IGV locus local in both.

### Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| PAT-STM-1 | 🔶 | BC | alt/(alt+ref) identical per sample (88/88); table shows max over samples; 2 decimals always (no 4-decimal <0.01); double rounding misprints 5/64 (bug); VAF 0 legacy bugs not copied |
| PAT-STM-2 | 🟡 | BC | Numerator any mutation (not uncalled) ✅; denominator = samples profiled for the gene (invariant 7; equals the sequenced list on WES and IMPACT341 genes); "x.x%" not integer / "<1%"; no keyword numerator B, bar, tooltip, MutSig badge |
| PAT-STM-3 | 🟡 | BC | Same alteration (±2) ÷ samples profiled for the gene by the CNA panel; numbers equal; "0.6%" vs "<1%"; no tooltip, no GISTIC |
| PAT-STM-4 | ❌ | B | No mRNA percentile |
| PAT-STM-5 | ✅ | BC | ≥50 kb and \|mean\| ≥ 0.2, toFixed(1) (`igv.ts:75-84`); 48.8 %, 27.8 % |
| PAT-STM-6 | ✅ | B | 12/28/18/55, 64, 16 |
| PAT-STM-7 | ❌ | C | No VAF histogram / KDE plot |
| PAT-STM-8 | ❌ | C | No header signature bar (tracked) |
| PAT-STM-9 | ❌ | B | No TMB-H / MSI-H badges |
| PAT-STM-10 | 🟡 | C | Span floors ✅; tooltip tables show raw values (no 1-decimal rounding, e.g. TMB 0.933333333333) |
| PAT-STM-11 | 🟡 | C | `formatDays` identical (`timeline-tracks.ts:215`); 365-day ticks, trims ✅; line-chart y rule not checked |
| PAT-STM-12 | 🟡 | BC | Header/timeline: collection day, type rank, natural id ✅ (`timeline-tracks.ts:196`); tables number without days (`alterations/run.ts:101`, tracked known issue) |
| PAT-STM-13 | ✅ | BC | Sorted panel ids → P1…Pn, W for WES (`igv.ts:100-107`) |
| PAT-STM-14 | 🟡 | C | Mutation key adds mutationType/variantType (harmless); CNA ✅; SV tuple not sorted |
| PAT-STM-15 | ❌ | C | No "profiled in all samples" filter |

---

## 5. cBioLab bugs

- **Allele Freq double rounding.** `cellOf` rounds VAF to 3 decimals (`lib/views/alterations/run.ts:32`), then the card prints `x.toFixed(2)` (`app/lab/alterations-body.tsx:102`). A VAF like 10/57 = 0.1754 becomes 0.175 → "0.17". P3 shows 5 of 64 wrong: APC S943Qfs*12 0.17 (0.18), PC V944M 0.77 (0.76), EZHIP G373A 0.39 (0.38), HRNR S2028G 0.10 (0.11), SCN1A H553Q 0.42 (0.43).
- **Unknown patient still lays out every tab.** `?caseId=NOPE` prints "no patient NOPE in lgg_ucsf_2014", then renders the tab bar with views refusing "the cohort's patient list is empty".
- **Genomic Evolution tab offered where it can only refuse** (single-sample P3, P4: "TCGA-A6-2671 has 1 sample; following mutations across samples needs at least two"): `patient-layout.ts:57` gates on "not sample mode and holds mutations", not on ≥2 samples with counts.
- (tracked) Table sample numbering ignores collection days (`alterations/run.ts:101`).
