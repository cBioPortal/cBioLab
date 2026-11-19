# Parity audit — Results › OncoPrint (spec `01-oncoprint.md`)

- **Date:** 2026-11-10; re-scored 2026-11-16; re-measured 2026-11-18
- **cBioLab:** master @ `cc9004b7`, `next dev` on `http://127.0.0.1:3109` (2026-11-16: master @ `7ef627ba`; first audit: `session/spec` @ `73a4af6f`)
- **Legacy:** cbioportal.org (Playwright, 2026-11-18 for the statistics; 2026-11-16; first audit 2026-11-10)
- **Code paths (cBioLab):** `app/_oncoprint/OncoprintFigure.tsx` (figure, toolbar, track menu, tooltips), `app/_oncoprint/OncoprintCard.tsx` (data controls, Tracks menu), `app/_oncoprint/canvas.ts`, `lib/oncoprint.ts` (engine), `lib/oncoprint-assemble.ts` (cells, sort, %), `lib/oncoprint-style.ts`, `lib/oncoprint-cluster.ts`, `lib/annotation.ts`, `app/portal/results/page.tsx`, `app/portal/results-layout.ts`

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 reference | `/results/oncoprint?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS NRAS BRAF TP53 APC` | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%20NRAS%20BRAF%20TP53%20APC` |
| Q2 multi-sample | `/results/oncoprint?cancer_study_list=msk_impact_2017&case_set_id=msk_impact_2017_all&gene_list=TP53 KRAS TERT` | `/portal/results?study=msk_impact_2017&genes=TP53%20KRAS%20TERT` |
| Q3 partial panel | same, `gene_list=ZFHX3 RAC1 AXIN2` (+ `&show_samples=true`) | `/portal/results?study=msk_impact_2017&genes=ZFHX3%20RAC1%20AXIN2` (+ `unit:"sample"` via `/api/oncoprint`) |
| Q4 multi-study | `cancer_study_list=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&case_set_id=all&gene_list=KRAS TP53` | `/portal/results?studies=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&genes=KRAS%20TP53` |
| Q5 OQL | Q1 base, `gene_list=KRAS: AMP MUT=G12D⏎TP53` | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%3A%20AMP%20MUT%3DG12D%3B%20TP53` |

Legacy values read from `window.frontendOnc.model` (track info, id order) and `resultsViewOncoprint.geneticTracks` (altered/profiled); cBioLab values from the `/api/oncoprint` contract the page posts. Scripts and screenshots: (local scratch, not committed) (`out/leg.png`, `out/lab.png`, `out/legz.png`, `out/labz.png`, `out/i-*.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 53 |
| 🟡 partial | 37 |
| 🔶 different | 1 |
| ❌ missing | 10 |
| 🐞 ok | 1 |
| 🐞 copied | 0 |
| N/A | 2 |
| ? | 0 |
| **Total IDs** | **104** |

**Overall: 53.8 %** (✅ 53 + 🐞ok 1 + N/A 2 = 56 of 104). Counting 🟡 as half: 71.6 %. (2026-11-16: 51.9 % / 70.2 %; 2026-11-10: 23.1 % / 43.3 %.)

Re-measurement of 2026-11-18 (master `cc9004b7`), each ID against the spec text in cBioLab's UI or code, the statistics against cbioportal.org: 4 verdicts changed. Up: ONC-SO-4, ONC-TM-5 (#278), ONC-TT-8 (#267). Down: ONC-VI-6. The Q1–Q5 numbers all match again; ONC-STM-4 stays 🟡 for a new reason (the spectrum's Freq).

Re-score of 2026-11-16: 36 verdicts changed, all for the better; no regression in the ✅ rows spot-checked (SO-2, VI-1…3, VI-7, DL-3, GL-1, GL-3, TM-1, TM-4, MI-2, MD-5).

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Results chrome (RV) | 4 | 0 | 4 | 0 | 0 | 0 | 0 | Samples line added; driver menu on the toolbar, not a page ⚙; no Show only profiled, no CaseFilterWarning |
| §1 Tracks (TR) | 4 | 0 | 4 | 0 | 0 | 0 | 0 | Clinical tab now the portal's (names, Freq %, Select all, Update); Heatmap tab still raw profile ids, GA heatmap only |
| §1 Sort (SO) | 5 | 4 | 0 | 0 | 1 | 0 | 0 | Type / Driver / Ignore VUS toggles; clustering a disabled indicator; no case-list order |
| §1 Mutations (MU) | 3 | 2 | 1 | 0 | 0 | 0 | 0 | Germline stripe and Show only somatic added; colour-by-type and germline sit in Display |
| §1 View (VI) | 7 | 4 | 2 | 0 | 1 | 0 | 0 | No clinical-legend toggles in the UI; Show OQL filters only offered with OQL |
| §1 Download (DL) | 6 | 1 | 2 | 1 | 2 | 0 | 0 | PNG/SVG/PDF, portal-shaped TSV and order file; no Oncoprinter, no hide switch |
| §1 Zoom/Minimap (ZM, MM) | 4 | 1 | 3 | 0 | 0 | 0 | 0 | Fit now the altered span; no % box; minimap is a strip |
| §2 Layout (LY) | 6 | 2 | 4 | 0 | 0 | 0 | 0 | Gutter % as the portal's; Profiled rows named by type; merged `[A B]` refused |
| §3 Glyphs (GL) | 6 | 4 | 2 | 0 | 0 | 0 | 0 | Hotspots and custom drivers added; Nonstart → Other; no "No alterations" legend entry |
| §4 Other tracks (TT) | 12 | 9 | 0 | 0 | 3 | 0 | 0 | Spectrum, clinical colours/aggregation, heatmap ramps and GA thresholds; no GA bar/stacked/categorical, no GSVA |
| §5 Track menu (TM) | 5 | 3 | 2 | 0 | 0 | 0 | 0 | Remove/cluster bugs fixed; Cluster / Don't cluster in a heatmap row's menu |
| §6 Sorting (ST) | 5 | 5 | 0 | 0 | 0 | 0 | 0 | Staircase, Ignore VUS and natural sort as the portal's |
| §7 Mouse (MI) | 6 | 2 | 3 | 0 | 1 | 0 | 0 | Unchanged: no label drag, no cell highlight |
| §8 Tooltips (TP) | 5 | 1 | 3 | 0 | 1 | 0 | 0 | Exact values now; no OncoKB/hotspot icons, no "View these N" |
| §9 Modes (MD) | 13 | 5 | 6 | 0 | 0 | 0 | 2 | Germline, drivers-only disabling fixed; SVs all VUS on the oncoprint; Show only profiled missing |
| §11 Statistics (STM) | 13 | 10 | 1 | 0 | 1 | 1 | 0 | Labels, aggregation, clustering, zoom as the portal's; no GSVA |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **SV driver calls differ**: Q1's TRIM24-BRAF is "unknown significance" here, "putative driver" on the portal (no pair call in the pinned OncoKB v7.5 store); the oncoprint also reads only the gene-level "Fusion" row, not the pair calls the SV and Mutations tabs use since #219 | MD-7 | OncoPrint default view: SV drivers (added in this re-score) |
| 2 | **No "Show only profiled"** with its warnings | MD-3, RV-2, RV-3 | Driver-annotation settings: "Show only profiled" |
| 3 | **Driver menu is on the oncoprint toolbar**, not a page-level ⚙ beside Modify query | RV-1, RV-2, MU-3 | Driver-annotation settings: "The menu as a page-level sliders button" |
| 4 | **Tracks › Heatmap lists raw profile ids**; no GA bar/stacked/categorical tracks, no Select/Clear all | TR-2, TR-3, TT-9, TT-10, TP-5 | OncoPrint default view: Heatmap and generic-assay tracks (added in this re-score) |
| 5 | **Merged `[A B]` groups refused** on the Results page | LY-5, MD-9 | OQL coverage |
| 6 | **Tooltips thinner**: no OncoKB/hotspot icons, no panel popup, no "View these N", no OQL / description in the label tip | TP-1, TP-2, TP-4, MI-1, MI-5 | OncoPrint default view: tooltips (added in this re-score) |
| 7 | **Layout details**: no clinical/genetic gap, labels truncated, no ⋮, Profiled rows named by type, no "No alterations" legend entry, no clinical-legend toggles | LY-1…3, GL-6, VI-4, VI-5 | OncoPrint default view: layout and legend (added in this re-score) |
| 8 | **Zoom/minimap**: no % box, marquee instead of the portal's drag-zoom, minimap a strip | ZM-1, ZM-3, MM, MI-4 | OncoPrint default view: zoom and minimap (added in this re-score) |
| 9 | **Download**: no Open in Oncoprinter, no hide-download switch, Jupyter export instead of the mutations CSV | DL-1, DL-2, DL-5, DL-6 | Oncoprint export (Oncoprinter after release); Data-governance switches; DL-2, DL-6 added in this re-score |

---

## 3. Number check (2026-11-16)

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 KRAS / NRAS / BRAF / TP53 / APC (patients) | STM-1 | 37% / 6% / 11% / 53% / 67% | "37% / 37%", "5% / 6%", "9% / 11%", "52% / 53%", "65% / 67%" (driver / any) | ✅ (#192) |
| Q1 header | STM-2 | 485 (82%) | 485 (82%) of 594 | ✅ |
| Q2 header patients / samples | STM-2 | 6208 (60%) / 6494 (59%) | 6,208 (60%) / 6,494 (59%) of 10,945 | ✅ (#192) |
| Q4 header | STM-2, MD-2 | 775 (46%) | 775 (46%) | ✅ |
| Q5 header (OQL) | STM-2 | 344 (58%) | 344 (58%) | ✅ |
| Q5 KRAS track (`AMP MUT=G12D`) | STM-1, MD-9 | 63 / 594 (11%) | "11% / 11%" | ✅ (#225) |
| Q1 initial zoom | STM-13 | fits the altered span | fits the altered span | ✅ (#194) |
| Q1 Tracks › Clinical count | TR-1, STM-4 | 64 | Clinical (64) | ✅ (#196) |
| Q1 SV legend | MD-7 | "Structural Variant (putative driver)" | "Structural Variant (unknown significance)" | 🟡 |

**Re-measured 2026-11-18** (cBioLab master `cc9004b7`; legacy values from `resultsViewOncoprint.geneticTracks`):

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 KRAS / NRAS / BRAF / TP53 / APC labels; header | STM-1, STM-2 | 37 / 6 / 11 / 53 / 67 %; 485 (82%) | same; 485 (82%) | ✅ |
| Q2 TP53 / KRAS / TERT altered of 10,336 | STM-1 | 4,437 / 1,768 / 1,600 (43 / 17 / 15 %) | 4,437 / 1,768 / 1,600 (43 / 17 / 15 %) | ✅ |
| Q3 ZFHX3 / RAC1 / AXIN2 | STM-1, LY-4 | 391 of 7,773 "5%*", 128 "1%", 224 "2%" (2 more ZFHX3 mutations drawn in unprofiled columns, not counted) | 391 / 7,773 "5%*", 128 "1%", 224 "2%" | ✅ |
| Q3 header patients / samples | STM-2 | 682 (7%) / 690 (6%) | 682 (7%) / 690 (6%) | ✅ |
| Q4 KRAS / TP53; header | STM-1, STM-2 | 245 / 669 (15 / 40 %); 775 (46%) | 245 / 669; 775 (46%) | ✅ |
| Q5 KRAS `AMP MUT=G12D` / TP53; header | STM-1, STM-2 | 63 / 315; 344 (58%) | 63 / 315; 344 (58%) | ✅ |
| Q1 Tracks › Clinical Freq, every row but the spectrum | STM-4 | e.g. Overall Survival Status 99.5 %, Mutation Count 89.9 %, Disease Free Status 37.5 % | the same for every row | ✅ |
| Q1 Tracks › Clinical, Mutation spectrum | STM-4 | 99.7 % | 89.9 % | 🟡 |
| Q1 SV legend | MD-7 | "Structural Variant (putative driver)" | "Structural Variant (unknown significance)" | 🟡 |

Counts in Q1–Q5 match as on 2026-11-10; the earlier figures (Q2 per sample, Q3 partial panels, Q1 column order) were not re-run, their IDs being ✅ on the PRs' own audits (#192, #193).

---

## 4. Scorecard

### §0 Results-View chrome

| ID | verdict | how | note |
|---|---|---|---|
| RV-1 | 🟡 | B | Samples line now shown when samples ≠ patients (Q2 "6,494 (59%) of 10,945 queried samples altered") (#192); study name still a title, not a link; no case-set link; no ⚙ button |
| RV-2 | 🟡 | BC | A "mutations" menu on the oncoprint toolbar now holds OncoKB, Hotspots, the study's custom calls and tiers, Show only drivers, Show only somatic (`DriverSettingsMenu.tsx`) (#168, #211); still no Show only profiled, and the menu is not the page-level ⚙ beside Modify query (tracked) |
| RV-3 | 🟡 | BC | Unchanged: OQL banner is the page's note under the header; VUS / germline hidden counts as legend marks (`OncoprintFigure.tsx:1132-1133`); no CaseFilterWarning, no RestoreClinicalTracks |
| RV-4 | 🟡 | BC | Unchanged: spinner + skeleton; no 4-step progress list; canvas 2D, so no WebGL message |

### §1 Toolbar — Tracks

| ID | verdict | how | note |
|---|---|---|---|
| ONC-TR-1 | 🟡 | B | Display names, Freq %, Select all (64) / Deselect all, applied by Update tracks, no cap; 64 attributes as legacy (#196); automatic rows (Profiled for, Mutation spectrum) listed first (#258); a patient-level attribute's Freq over samples (#264): every other Q1 row's Freq as the portal's (2026-11-18); a numeric attribute by its display name alone ("Diagnosis Age", `track-edits.ts:222` tracksMenuText) (#377). Left: the spectrum's Freq (STM-4); no Save tracks (MD-12) |
| ONC-TR-2 | 🟡 | BC | Unchanged: Heatmap tab lists raw profile ids (`rna_seq_v2_mrna_median_Zscores`, `gistic`) + VAF + generic assays; not hidden for multi-study; free-text genes per profile; no NG-CHM (tracked: gated features) |
| ONC-TR-3 | 🟡 | BC | Unchanged: generic assay as heatmap rows with entity search; no Select/Clear all, no bar/stacked chart types |
| ONC-TR-4 | 🟡 | B | Unchanged: "Cohort rows" (≤3) ≈ Groups; "Custom" tab = uploads ≈ Custom Charts |

### §1 Toolbar — Sort

| ID | verdict | how | note |
|---|---|---|---|
| ONC-SO-1 | ✅ | BC | Staircase menu: mutation type, driver, ignore VUS, each enabled only where the portal's is (#195) |
| ONC-SO-2 | ✅ | B | "patient id" / "sample id" option |
| ONC-SO-3 | ✅ | C | Sort › "case list order", enabled with a User-defined Case List: typed order, kept by the stored set; a patient at its first listed sample; disabled otherwise, as the portal's (`lib/oncoprint-case-list.ts`, sort key `caseList`) (#468) |
| ONC-SO-4 | ✅ | BC | Was 🔶: the sort select shows "sorted by heatmap clustering order" as a disabled entry, only with a heatmap row, selected while clustered (`OncoprintFigure.tsx:858-861`) (#278); Q1 + mRNA-z, Cluster on TP53 mRNA-z: select reads it |
| ONC-SO-5 | ✅ | C | Choosing another primary key replaces the cluster key |

### §1 Toolbar — Mutations

| ID | verdict | how | note |
|---|---|---|---|
| ONC-MU-1 | ✅ | BC | "colour by mutation type" in display menu; kept in the document (invariant 9) |
| ONC-MU-2 | ✅ | BC | Display › "mark germline mutations" (the stripe) and Mutations › "Show only somatic" (#168) |
| ONC-MU-3 | 🟡 | B | A "mutations" menu now exists for driver annotation and filters (#168); colour by type and germline sit in Display, not in it |

### §1 Toolbar — View

| ID | verdict | how | note |
|---|---|---|---|
| ONC-VI-1 | ✅ | B | "columns: patients/samples", default patient; in `?changes=` |
| ONC-VI-2 | ✅ | B | "show unaltered patients" |
| ONC-VI-3 | ✅ | BC | "whitespace between cells"; pad drawn only once a column is ≥6 px (legacy auto-off <2 px) |
| ONC-VI-4 | ✅ | C | Display › "show legends for clinical tracks", on by default; off drops the clinical keys, never the gene legend or a heatmap's (`display.clinicalLegends`, `OncoprintFigure.tsx` Legend, `oncoprint-svg.ts`) (#444) |
| ONC-VI-5 | ✅ | C | Display › "only show clinical track legends for altered patients / samples", disabled while VI-4 is off; each key over the columns some gene row alters (`alteredColumns`, the portal's altered_uids) (#444) |
| ONC-VI-6 | ✅ | BC | A row's OQL line in grey after its gene; Display › show OQL filters always offered, on by default only with OQL (`oncoprint.ts:523`); a single-gene row without OQL shows the default line, buildDefaultOQLProfile over the study's profiles in id order (`oql-match.ts:144`, `oncoprint.ts:453`, `oncoprint-assemble.ts:752`): coadread ": AMP HOMDEL MUT FUSION"; none on merged rows (#380) |
| ONC-VI-7 | ✅ | BC | "white background (for print)" + legend caution |

### §1 Toolbar — Download

| ID | verdict | how | note |
|---|---|---|---|
| ONC-DL-1 | ❌ | C | No hide-download switch (tracked: Data-governance switches) |
| ONC-DL-2 | 🟡 | BC | PNG/SVG/PDF via "Export image…" dialog (page width, DPI); the PDF the server SVG on one page its size, font embedded; names `oncoprint-<study>-<w>in.png` (portal `oncoprint.png`) |
| ONC-DL-3 | ✅ | BC | "Patient order in the Oncoprint is:" + the ids as drawn; file `OncoPrintPatients.txt` / `OncoPrintSamples.txt` |
| ONC-DL-4 | 🟡 | BC | The portal's rows: CLINICAL by display name, each gene's CNA/MUTATIONS/MRNA/PROTEIN/STRUCTURAL_VARIANT, `HEATMAP <type> <datatype>`; the columns as drawn (`oncoprint-tabular.ts`). Readable text where the portal writes raw codes (`splice_rec`, `amp_rec`, `sv_rec`); a merged row by its label |
| ONC-DL-5 | ❌ | B | No Open in Oncoprinter, deferred to after the initial release; offers CLI emulator / Python notebook links instead |
| ONC-DL-6 | 🔶 | B | "export to Jupyter (.ipynb)" embeds the contract + package, not a mutations CSV |

### §1 Toolbar — Zoom, Minimap

| ID | verdict | how | note |
|---|---|---|---|
| ONC-ZM-1 | 🟡 | BC | Unchanged: − / +, log-scale slider, "fit"; no editable % box |
| ONC-ZM-2 | ✅ | BC | Fits the altered columns (Q1 KRAS run fills the plot, unaltered scrolled off) and leaves the figure at its start (#194) |
| ONC-ZM-3 | 🟡 | BC | Unchanged: marquee → selection bar (Zoom to selection, New cohort, Save as feature, Copy ids) |
| ONC-MM | 🟡 | BC | Unchanged: Display › "minimap" strip under the figure (`OncoprintFigure.tsx:817`); no floating panel |

### §2 Layout

| ID | verdict | how | note |
|---|---|---|---|
| ONC-LY-1 | ✅ | B | clinical → genes → heatmap, a 10 px gap after each track group (clinical, genetic, each heatmap profile), as the portal's track_group_padding (`lib/oncoprint-rows.ts`) (#485) |
| ONC-LY-2 | 🟡 | B | label \| info \| cells; labels cut as the portal's, past 18 characters to 15 and "..." (#480); no ⋮ (click label opens menu) |
| ONC-LY-3 | 🟡 | BC | Unchanged: "Profiled for <type>" rows named by alteration type (legacy: "Profiled in" + profile name, e.g. "Putative copy-number alterations from GISTIC"); Study of origin, # Samples per Patient ✅ |
| ONC-LY-4 | ✅ | B | Integer %, "<1%", the portal's double rounding under 3% (Q1 "37% / 37%", Q5 KRAS "11% / 11%") (#192). Ours alone: the driver % before the portal's one number |
| ONC-LY-5 | 🟡 | BC | Merged rows drawn "[A / B]"; the Results page still refuses `[BRAF NRAS] KRAS` ("bad gene entry '[BRAF'") (tracked: OQL coverage) |
| ONC-LY-6 | ✅ | B | No column labels, grows in height, own horizontal scrollbar |

### §3 Glyphs

| ID | verdict | how | note |
|---|---|---|---|
| ONC-GL-1 | ✅ | C | `styleForDisplay` colour-by-type off → one green pair "Mutation"; annotate none → one colour per glyph |
| ONC-GL-2 | ✅ | C | A mutation's class as getOncoprintMutationType: "Promoter" change → promoter; listed missense / in-frame / splice keep theirs, unlisted → other; every other listed type (nonsense, frameshift, Translation_Start_Site, nonstop, Fusion) → Truncating (`oncoprint-assemble.ts` `mutClassBit`, oql-match `mutationClass`); msk_impact_2017 B2M no Other (#436) |
| ONC-GL-3 | ✅ | C | One glyph per layer, legacy priority, driver before VUS; no per-count tiebreak, no germline stripe |
| ONC-GL-4 | ✅ | C | MUT, AMP/HOMDEL (±2 only), FUSION drawn; a line's EXP / PROT as mRNA / protein high and low in the cells |
| ONC-GL-5 | ✅ | BC | OncoKB, Cancer Hotspots (on by default) and the study's custom calls (#168, #211) |
| ONC-GL-6 | ✅ | B | Lists only present glyphs; then "No alterations" whenever a gene row is drawn and "Not profiled" only when one is not, last in that order (`geneLegend`, `glyphPresence`); coadread KRAS TP53 no Not profiled, msk_impact_2017 with NEGR1 both (#451) |

Glyph table (colours, bands, z-order) matches legacy exactly for every row present; GAIN/HETLOSS and Germline rows are absent (see OQL coverage / germline gaps).

### §4 Other track types

| ID | verdict | how | note |
|---|---|---|---|
| ONC-TT-1 | ✅ | C | Every value its own colour from the portal's list, reserved colours, "Mixed" (#197); legend alphabetical. Ours alone: at most 8 legend values, then "+N more" |
| ONC-TT-2 | ✅ | C | Bars for a declared NUMBER, categories for any other datatype, whatever the values (`oncoprint-assemble.ts:172`); patient value by datatype (#198, #262) |
| ONC-TT-3 | ✅ | BC | Mutation spectrum row, stacked by substitution in the portal's order and fills (`oncoprint-style.ts:102`) (#199); in Tracks › Clinical at 89.9 % (#258) |
| ONC-TT-4 | ✅ | B | Profiled rows Yes = `#1b9e77`, No = NA glyph |
| ONC-TT-5 | ✅ | C | Expression blue→black→red, z −3…3 (#200) |
| ONC-TT-6 | ✅ | C | Methylation fixed [0, 1], white at 0.35 (`oncoprint-style.ts:117`) (#200) |
| ONC-TT-7 | ✅ | C | VAF yellow→teal `rgb(241,242,181)`→`rgb(19,80,88)` (#200); a profiled column with no VAF drawn #e0e0e0, legend "Not mutated/no VAF data" (`oncoprint-style.ts` heatNull) (#263) |
| ONC-TT-8 | ✅ | C | Was 🟡: range, pivot threshold and sort order as the portal's (#200); threshold values (">90", "<1") read and drawn as categories (`lib/oncoprint.ts:417` parseThresholdValue, `oncoprint-style.ts:652` thresholdColor) (#267), the intended behaviour rather than the legacy NaN drop |
| ONC-TT-9 | ❌ | C | Unchanged: no GA bar / stacked (the only stacked row is the mutation spectrum) |
| ONC-TT-10 | ❌ | C | Unchanged: categorical GA refused |
| ONC-TT-11 | ❌ | C | Unchanged: no GSVA (tracked) |
| ONC-TT-12 | ✅ | C | Clinical: NUMBER mean, MUTATION_COUNT max, else shared value or "Mixed"; heatmap furthest from 0; VAF max (#198, #200) |

### §5 Per-track menu

| ID | verdict | how | note |
|---|---|---|---|
| ONC-TM-1 | ✅ | B | Current sort bold + ✓; one menu at a time. Item lists differ: genetic rows lack "Sort by genes"; # Samples per Patient lacks "Show one column per…"; no group-header menu |
| ONC-TM-2 | 🟡 | BC | "Remove track" no longer offered on the last gene, a `cluster:` key survives track edits (#187); remove gene still edits the view's genes, not `gene_list` |
| ONC-TM-3 | 🟡 | B | Unchanged: Show gaps / w/% right / w/% left only when the track is already the primary sort key |
| ONC-TM-4 | ✅ | BC | Edit colours inline (colour inputs), Reset; stored in the document, not localStorage (invariant 9); the spectrum row too (#265) |
| ONC-TM-5 | ✅ | BC | Was 🟡: average linkage on 1 − Spearman, rows and columns (#201); Cluster / Don't cluster in each heatmap row's menu, one profile at a time (`OncoprintFigure.tsx:950-951`) (#278). Q1 + mRNA-z: Cluster reorders columns and the five rows. No group-header row (LY-1) |

### §6 Sorting

| ID | verdict | how | note |
|---|---|---|---|
| ONC-ST-1 | ✅ | BC | User keys → staircase → id; not profiled last only after every row, as the portal (#193) |
| ONC-ST-2 | ✅ | BC | Per key CNA then mutation, drivers before VUS; over the portal's own cells Q1 594/594, Q3 10,336/10,336 positions (#193) |
| ONC-ST-3 | ✅ | BC | Staircase › ignore VUS, enabled with Driver (#195) |
| ONC-ST-4 | ✅ | C | Text tracks by javascript-natural-sort (`oncoprint-style.ts:394`) (#206) |
| ONC-ST-5 | ✅ | C | Re-sorts in the browser on every key change |

### §7 Mouse interactions

| ID | verdict | how | note |
|---|---|---|---|
| ONC-MI-1 | 🟡 | B | Unchanged: tooltip after ~220 ms; no cell outline / column highlight |
| ONC-MI-2 | ✅ | B | Click on cells does nothing (drag selects; see ZM-3) |
| ONC-MI-3 | ❌ | C | Unchanged: no label drag; Move up/down only |
| ONC-MI-4 | 🟡 | B | Unchanged: see ZM-3 |
| ONC-MI-5 | 🟡 | B | Unchanged: "222 of 594 profiled patients altered (37.4%)", "219 putative driver (36.9%)"; no OQL line / attribute description / profile description |
| ONC-MI-6 | ✅ | B | Same tip gives altered/profiled and "not profiled in N of M columns" |

### §8 Cell tooltips

| ID | verdict | how | note |
|---|---|---|---|
| ONC-TP-1 | 🟡 | B | Unchanged: id + group + "open this patient ↗"; zoomed out "N patients under this pixel", no "View these N" link |
| ONC-TP-2 | 🟡 | BC | Unchanged: "TP53 R248W · Missense Mutation · putative driver", "panel WES"; no OncoKB / hotspot icons, no panel popup |
| ONC-TP-3 | ✅ | C | Exact value from the contract (`OncoprintFigure.tsx:644-646`); "≈x" only for an older contract (#198) |
| ONC-TP-4 | 🟡 | C | Exact value now (#200); no profile-type prefix |
| ONC-TP-5 | ❌ | C | Unchanged: no GA stacked tracks |

### §9 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| ONC-MD-1 | ✅ | BC | Aggregation the portal's (TT-12); # Samples per Patient on sample columns too, each its patient's queried samples (`oncoprint.ts:208` columnFactsSql, `oncoprint-assemble.ts:429`), with the row's "Show one column per patient." / "sample." (#377). msk_impact_2017 by sample: 1 × 9,774, 2 × 1,038, 3 × 120, 4 × 8, 5 × 5 samples, as the portal's API |
| ONC-MD-2 | 🟡 | B | Q4: Study of origin, Profiled for rows, 775 (46%) ✅; Heatmap / GA tabs not hidden |
| ONC-MD-3 | 🟡 | B | NA glyph, "*", Profiled rows ✅; no Show only profiled (tracked) |
| ONC-MD-4 | ✅ | C | "Show only drivers" disabled with no source on (`DriverSettingsMenu.tsx:88`) (#168) |
| ONC-MD-5 | ✅ | BC | drivers only drops VUS, re-runs, legend mark counts them |
| ONC-MD-6 | ✅ | BC | Germline stripe and Show only somatic (#168) |
| ONC-MD-7 | 🟡 | B | Inset glyph + split ✅; the oncoprint now reads OncoKB's pair calls (`lib/sv-oncokb.ts:95` svDriverKeysSql) (#271), but the pinned v7.5 store has none, so Q1's TRIM24-BRAF is still "Structural Variant (unknown significance)" (2026-11-18), legacy "(putative driver)" |
| ONC-MD-8 | ✅ | C | "Remove track" not offered on a single gene (#187) |
| ONC-MD-9 | 🟡 | B | Each row draws its gene's line (Q5 KRAS "11% / 11%", header 344 (58%), as legacy) (#225, #229); `[ ]` still refused (tracked) |
| ONC-MD-10 | ✅ | C | No special empty state; 0 % / N/P |
| ONC-MD-11 | 🟡 | B | Initial zoom fits the altered columns (#194); simple progress text; PNG export has no truncation alert |
| ONC-MD-12 | N/A | C | Tracks live in the document/link (invariant 9), so there is no per-user save to disable |
| ONC-MD-13 | N/A | C | Same; "Saved work" saves the whole document |

§10 Persistence (no IDs): everything legacy keeps in the URL is in the document (`?changes=`); so are colour-by, view checkboxes and edited colours, which legacy does not persist (invariant 9). Zoom, minimap and selection stay in the browser, as in legacy.

### §11 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| ONC-STM-1 | ✅ | BC | Counts as before; labels as the portal's (KRAS 222/594 "37%", Q2 header 6,208 (60%)) (#192). Ours alone: the driver % beside it |
| ONC-STM-2 | ✅ | B | 485 (82%), 6,208 (60%) + 6,494 (59%) samples, 775 (46%), 344 (58%), as legacy (#192) |
| ONC-STM-3 | 🐞 ok | C | Per-segment altered ÷ profiled; no profiled → "N/P", not "NaN%" (`canvas.ts:88-92`). Note: counts any cell code > 0, so mRNA/protein overlay bits would count as altered |
| ONC-STM-4 | ✅ | B | Q1, 2026-11-18: every attribute's Freq as the portal's, patient-level ones over samples (#264). Mutation spectrum: ours 89.9 %, the portal's 99.7 %; recorded as Ours alone by the user's decision (2026-11-19): the portal's `sample_derived.sequenced` matches bare sample ids across studies' `_sequenced` lists, ours counts the samples the study's mutation profile holds |
| ONC-STM-5 | ✅ | C | Patient NUMBER mean, MUTATION_COUNT max, ranges as the portal's (#198) |
| ONC-STM-6 | ✅ | C | Spectrum shares per substitution (#199) |
| ONC-STM-7 | ✅ | C | z clamp ±3, methylation [0, 1], VAF max, patient max |x|, GA pivot (#200) |
| ONC-STM-8 | ✅ | BC | Zoomed out: a number's mean "(average of n values)", a category's count of each value, Profiled rows "No (k samples)", heatmap mean (#262). Ours alone: a patient with disagreeing samples counts once as "Mixed" |
| ONC-STM-9 | ✅ | C | Average linkage, 1 − Spearman, rows + columns (`oncoprint-cluster.ts:2-3`) (#201) |
| ONC-STM-10 | ❌ | C | Unchanged: no GSVA (tracked) |
| ONC-STM-11 | ✅ | C | OncoKB Oncogenic / Likely / Resistance, Cancer Hotspots, custom calls (#168, #211) |
| ONC-STM-12 | ✅ | BC | The query's z / RPPA z and mRNA / protein profile set the OQL's EXP / PROT, inclusive (lib/query-options.ts defaultOql); coadread MYC with rna_seq_v2_mrna_median_Zscores: 123 of 594 patients altered at z 2.0, 270 at z 1.0, as ClickHouse counts them directly. The lab view's own `overlays` (default 2) have no portal counterpart |
| ONC-STM-13 | ✅ | BC | Fit = the altered span (#194) |
