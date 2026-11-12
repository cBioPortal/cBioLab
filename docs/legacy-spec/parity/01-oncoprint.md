# Parity audit — Results › OncoPrint (spec `01-oncoprint.md`)

- **Date:** 2026-11-10
- **cBioLab:** `session/spec` @ `73a4af6f`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day)
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
| ✅ match | 19 |
| 🟡 partial | 41 |
| 🔶 different | 24 |
| ❌ missing | 17 |
| 🐞 ok | 1 |
| 🐞 copied | 0 |
| N/A | 2 |
| ? | 0 |
| **Total IDs** | **104** |

**Overall: 21.2 %** (✅ 19 + 🐞ok 1 + N/A 2 = 22 of 104). Counting 🟡 as half: 40.9 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Results chrome (RV) | 4 | 0 | 4 | 0 | 0 | 0 | 0 | Header and settings exist in reduced form; no ⚙ menu, no sample line, no hotspot/somatic/profiled filters |
| §1 Tracks (TR) | 4 | 0 | 3 | 1 | 0 | 0 | 0 | Different Tracks menu: raw attribute ids, counts not %, immediate apply, cap 8; GA heatmap only |
| §1 Sort (SO) | 5 | 2 | 1 | 1 | 1 | 0 | 0 | Data/id sort present; no Type/Driver/Ignore-VUS toggles, no case-list order; cluster is a choice not an indicator |
| §1 Mutations (MU) | 3 | 1 | 0 | 1 | 1 | 0 | 0 | Colour-by-type yes; no germline |
| §1 View (VI) | 7 | 4 | 1 | 0 | 2 | 0 | 0 | Columns, unaltered, whitespace, white background match; no clinical-legend toggles UI, no OQL sublabels |
| §1 Download (DL) | 6 | 0 | 2 | 2 | 2 | 0 | 0 | PNG/SVG/TSV/order/ipynb exist in own shapes; no PDF, no Oncoprinter, no hide switch |
| §1 Zoom/Minimap (ZM, MM) | 4 | 0 | 3 | 1 | 0 | 0 | 0 | Zoom fits all columns (legacy fits altered); no % box; minimap is a strip |
| §2 Layout (LY) | 6 | 1 | 4 | 1 | 0 | 0 | 0 | Order right; gutter shows "driver% / any%" at 1 decimal; Profiled rows named by type |
| §3 Glyphs (GL) | 6 | 3 | 3 | 0 | 0 | 0 | 0 | Colours/bands identical; OncoKB-only drivers; legend lacks "No alterations" |
| §4 Other tracks (TT) | 12 | 1 | 1 | 6 | 4 | 0 | 0 | No mutation spectrum, GA bar/stacked/categorical or GSVA; heatmap ramps and patient aggregation differ |
| §5 Track menu (TM) | 5 | 2 | 2 | 1 | 0 | 0 | 0 | Move/remove/sort/gaps/colours present; cluster from Sort menu, Ward |
| §6 Sorting (ST) | 5 | 1 | 1 | 2 | 1 | 0 | 0 | Staircase ranks differ (VUS truncating above driver in-frame; NP not last); no Ignore VUS |
| §7 Mouse (MI) | 6 | 2 | 3 | 0 | 1 | 0 | 0 | Hover/label tips present; no label drag |
| §8 Tooltips (TP) | 5 | 0 | 2 | 2 | 1 | 0 | 0 | Cell tip has alteration + panel + link; numbers approximated "≈x" |
| §9 Modes (MD) | 13 | 2 | 7 | 0 | 2 | 0 | 2 | OQL not applied in oncoprint; germline missing; logged-in save N/A |
| §11 Statistics (STM) | 13 | 0 | 4 | 6 | 2 | 1 | 0 | All counts/denominators match exactly; display rounding, aggregation, clustering, zoom differ |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Oncoprint ignores the query's OQL** — draws every alteration of the genes; Q5 KRAS shows 37.4 % (222/594) vs legacy 11 % (63/594). Merged `[A B]` tracks refused on the Results page ("bad gene entry '[BRAF'") | MD-9, LY-5, VI-6, GL-4 | (tracked) "the oncoprint and gene tabs still draw every alteration"; "per-track OQL inside merged oncoprint groups" |
| 2 | **Gutter % format**: "36.9% / 37.4%" (driver / any, 1 decimal) vs legacy "37%" (integer ≥3 %, "<1%"); header "485 (81.6%)" vs "485 (82%)" | LY-4, STM-1, STM-2 | not tracked |
| 3 | **Initial zoom fits all columns**, not the altered span (legacy 30 % on Q1, 3 % on Q3); unaltered columns crowd the view | ZM-2, STM-13, MD-11 | not tracked |
| 4 | **Staircase sort differs**: one rank per cell (top class + driver bit) instead of legacy's per-key CNA → mutation; VUS truncating ranks above driver in-frame/missense; not-profiled ties with unaltered instead of last. Q1 order identical at 191/594 positions | ST-1, ST-2 | not tracked |
| 5 | **No ⚙ global settings menu**: no Hotspots driver source, no custom drivers, no "Show only somatic", no "Show only profiled" + CaseFilterWarning | RV-2, RV-3, GL-5, STM-11, MD-3 | (tracked) Driver-annotation settings; hotspots (Comparison›Mutations item); custom drivers |
| 6 | **Header lacks the samples line** when #samples ≠ #patients (Q2 legacy "6494 (59%) of queried samples"; Q3 "690 (6%)") | RV-1, STM-2 | not tracked |
| 7 | **Sort menu sub-options missing**: Mutation Type, Driver, Ignore VUS toggles; "case list order" | SO-1, SO-3, ST-3 | not tracked |
| 8 | **Tracks › Clinical tab differs**: raw attribute ids (`SAMPLE_TYPE`), patient counts not Freq %, no Select/Deselect all, ticks apply at once (re-run), max 8 tracks, 59 vs legacy 64 | TR-1, STM-4 | not tracked |
| 9 | **SV drivers**: OncoKB store has no SV entries, so every SV is "unknown significance" (legacy Q1 legend: "Structural Variant (putative driver)") | MD-7, GL-5 | (tracked) SV tab "Annotation column: our OncoKB store has no structural-variant entries" |
| 10 | **No mutation spectrum track** | TT-3, STM-6 | not tracked |
| 11 | **Heatmap rendering/aggregation differs**: expression ramp blue→white→red (legacy blue→black→red), methylation not fixed [0,1], VAF ramp blue (legacy yellow→teal), patient value = mean (legacy max \|x\|) | TT-5..7, TT-12, STM-7 | not tracked |
| 12 | **Clustering method differs**: Ward / Euclidean on per-gene z-scores, NaN → mean, columns only, ≤4,000 columns; legacy average linkage, 1 − Spearman, rows and columns | SO-4, TM-5, STM-9 | not tracked |
| 13 | **No germline**: no stripe, no Somatic-vs-Germline toggle, no "Show only somatic" | MU-2, MD-6, RV-2 | (tracked) Driver-annotation settings: germline/somatic filtering and colouring |
| 14 | **Clinical tracks**: top 8 values + "Other", Okabe-Ito palette, no "Mixed"; patient value = patient row else one sample's (legacy mean / MUTATION_COUNT max / "Mixed"); tooltips "≈x" from a 256-step code | TT-1, TT-2, TT-12, TP-3, STM-5 | not tracked |
| 15 | **Download**: no PDF, no Open in Oncoprinter, no hide-download switch; TSV is one row per gene (legacy CNA/MUTATIONS/… rows) | DL-1, DL-2, DL-4, DL-5 | (tracked) "Oncoprint export — PDF and tabular"; Data-governance switches |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 KRAS altered / profiled (patients) | STM-1 | 222 / 594 → "37%" | 222 / 594 → "36.9% / 37.4%" | 🟡 counts ✅, format differs |
| Q1 NRAS | STM-1 | 38 / 594 → "6%" | 38 / 594 → "5.1% / 6.4%" | 🟡 |
| Q1 BRAF | STM-1 | 64 / 594 → "11%" | 64 / 594 → "9.4% / 10.8%" | 🟡 |
| Q1 TP53 | STM-1 | 315 / 594 → "53%" | 315 / 594 → "52.2% / 53%" | 🟡 |
| Q1 APC | STM-1 | 396 / 594 → "67%" | 396 / 594 → "64.8% / 66.7%" | 🟡 |
| Q1 header | STM-2 | 485 (82%) of queried patients/samples | 485 (81.6%) of 594 queried patients | 🟡 count ✅, rounding differs |
| Q2 TP53 / KRAS / TERT (patients) | STM-1 | 4437 / 1768 / 1600 of 10336 → 43% / 17% / 15% | 4437 / 1768 / 1600 of 10336 → 42.9 / 17.1 / 15.5 % | ✅ counts |
| Q2 same, samples (cBioLab only via API) | STM-1, MD-1 | not read | 4644 / 1806 / 1659 of 10945 | ? legacy not read |
| Q2 header patients | STM-2 | 6208 (60%) | 6208 (60.1%) | 🟡 count ✅ |
| Q2 header samples | STM-2 | 6494 (59%) | not shown | ❌ |
| Q3 ZFHX3 patients (partial panel) | STM-1 | "5%*", NP 2563 → profiled 7773 | 391 / 7773 → "1.6% / 5%*" | ✅ denominator; legacy numerator not exposed (cells with data 393 incl. off-panel; cBioLab drops 2 off-panel calls) |
| Q3 ZFHX3 samples | STM-1 | "5%*", NP 2809 → profiled 8136 | 396 / 8136 (4.9 %) | ✅ denominator |
| Q3 RAC1 / AXIN2 patients | STM-1 | 128 / 224 of 10336 → label "1%" / "2%" (info "1.2%" / "2.2%") | 128 / 224 of 10336 → "1% / 1.2%", "0.4% / 2.2%" | 🟡 counts ✅; legacy label rounds, cBioLab keeps decimal |
| Q3 RAC1 / AXIN2 samples | STM-1 | 128 / 227 of 10945 | 128 / 227 of 10945 | ✅ |
| Q3 header patients / samples | STM-2 | 682 (7%) / 690 (6%) | 682 (6.6%) / not shown | 🟡 / ❌ |
| Q3 off-panel calls | STM-1 | counted in header, not in % | 680 altered columns in figure vs 682 in header; legend "2 off-panel calls not drawn" | ✅ (same rule as legacy %) |
| Q4 KRAS / TP53 (2 studies) | STM-1, MD-2 | 245 / 669 of 1678 | 245 / 669 of 1678 | ✅ |
| Q4 header | STM-2 | 775 (46%) | 775 (46.2%) | 🟡 rounding |
| Q5 header (OQL) | STM-2 | 344 (58%) | 344 (57.9%) | 🟡 count ✅ |
| Q5 KRAS track (`AMP MUT=G12D`) | STM-1, MD-9 | 63 / 594 (11%) | 222 / 594 (37.4%) — OQL not applied | 🔶 |
| Q1 column order | ST-1/2 | — | same set; 191 / 594 positions equal; 120 vs 122 signature runs | 🔶 tie ranks differ (see ST-2) |
| Q1 initial zoom | STM-13 | 30 % (fits altered span) | fit-all, 2.3 px/column (slider at 0) | 🔶 |
| Q3 initial zoom | STM-13 | 3 % | fit-all | 🔶 |
| Tracks menu Clinical count Q1 | TR-1, STM-4 | Clinical 64 | Clinical (59) | 🔶 (count and "Freq" basis differ) |
| Driver % (no legacy figure) | STM-11 | — | KRAS 219 / 594 driver | n/a (legacy shows no driver %) |

Data version: counts match exactly in every query, so the warehouse and cbioportal.org hold the same mutation / CNA / panel data for these studies. OncoKB: cBioLab v7.5 pinned; legacy live.

---

## 4. Scorecard

### §0 Results-View chrome

| ID | verdict | how | note |
|---|---|---|---|
| RV-1 | 🟡 | B | Study name is a title, not a link; "594 samples · 594 patients" with no case-set link; genes as pills + ✎; "Copy link" sits in the site header; Modify query ✅; no ⚙ button; patient line only |
| RV-2 | 🟡 | BC | Only "annotate OncoKB/none" + "drivers only" on the oncoprint toolbar (`OncoprintCard.tsx:291-298`); no Hotspots, custom binary/tier, Show only somatic, Show only profiled (tracked) |
| RV-3 | 🟡 | BC | OQL note replaced by "The query's OQL decides who is Altered; the oncoprint … draw every alteration"; VUS-hidden count as legend mark (`OncoprintFigure.tsx:1061`); no CaseFilterWarning, no RestoreClinicalTracks |
| RV-4 | 🟡 | BC | Spinner "querying and building the oncoprint…" + skeleton; no 4-step progress list; canvas 2D, so no WebGL message |

### §1 Toolbar — Tracks

| ID | verdict | how | note |
|---|---|---|---|
| ONC-TR-1 | 🔶 | B | Raw attribute ids, patient counts (not % samples), most first; no Select all/Deselect all, no Save tracks; tick applies at once (re-run, no Update button); cap 8; 59 attrs vs 64 |
| ONC-TR-2 | 🟡 | BC | Profile list = raw profile ids + VAF + generic assays, not hidden for multi-study; free-text genes per profile (blank = figure genes), no validity badge, cap 4 profiles × 12 genes; no NG-CHM (tracked: gated features) |
| ONC-TR-3 | 🟡 | BC | Generic assay as heatmap rows with entity search (`OncoprintCard.tsx:159-214`); no Select/Clear all, no bar/stacked chart types |
| ONC-TR-4 | 🟡 | B | "Cohort rows" (document cohorts as Yes/No rows, ≤3) ≈ Groups; "Custom" tab = uploads ≈ Custom Charts |

### §1 Toolbar — Sort

| ID | verdict | how | note |
|---|---|---|---|
| ONC-SO-1 | 🟡 | BC | "engine order (genomic)" default; no Mutation Type / Driver / Ignore VUS sub-checkboxes |
| ONC-SO-2 | ✅ | B | "patient id" / "sample id" option |
| ONC-SO-3 | ❌ | C | No case-list order |
| ONC-SO-4 | 🔶 | C | "cluster by <profile>" is a selectable option that triggers clustering (`OncoprintFigure.tsx:772`), not a disabled indicator |
| ONC-SO-5 | ✅ | C | Choosing another primary key replaces the cluster key |

### §1 Toolbar — Mutations

| ID | verdict | how | note |
|---|---|---|---|
| ONC-MU-1 | ✅ | BC | "colour by mutation type" in display menu; kept in the document (invariant 9) |
| ONC-MU-2 | ❌ | C | No germline (tracked) |
| ONC-MU-3 | 🔶 | B | No Mutations menu; annotate/drivers controls sit inline on the toolbar |

### §1 Toolbar — View

| ID | verdict | how | note |
|---|---|---|---|
| ONC-VI-1 | ✅ | B | "columns: patients/samples", default patient; in `?changes=` |
| ONC-VI-2 | ✅ | B | "show unaltered patients" |
| ONC-VI-3 | ✅ | BC | "whitespace between cells"; pad drawn only once a column is ≥6 px (legacy auto-off <2 px) |
| ONC-VI-4 | 🟡 | C | Engine has `display.clinicalLegends: all\|none` (`oncoprint-assemble.ts:83`); no UI toggle |
| ONC-VI-5 | ❌ | C | No "only altered" legend option |
| ONC-VI-6 | ❌ | C | No OQL sublabel (OQL not drawn at all; see MD-9) |
| ONC-VI-7 | ✅ | BC | "white background (for print)" + legend caution |

### §1 Toolbar — Download

| ID | verdict | how | note |
|---|---|---|---|
| ONC-DL-1 | ❌ | C | No hide-download switch (tracked: Data-governance switches) |
| ONC-DL-2 | 🟡 | BC | PNG/SVG via "Export image…" dialog (page width, DPI); no PDF (tracked); names `oncoprint-<study>-<w>in.png` |
| ONC-DL-3 | 🟡 | BC | "patient order in the oncoprint is:" + ids; file `oncoprint-<study>-patient-order.txt` |
| ONC-DL-4 | 🔶 | C | TSV one row per track; gene row merges mutation/CNA/SV labels; type `GENE`/`CLINICAL`/`HEATMAP <profile>` (`oncoprint-tabular.ts`); no splice/sv raw-code quirk (tracked: Oncoprint export) |
| ONC-DL-5 | ❌ | B | No Open in Oncoprinter; offers CLI emulator / Python notebook links instead |
| ONC-DL-6 | 🔶 | B | "export to Jupyter (.ipynb)" embeds the contract + package, not a mutations CSV |

### §1 Toolbar — Zoom, Minimap

| ID | verdict | how | note |
|---|---|---|---|
| ONC-ZM-1 | 🟡 | BC | − / + (×1.4), log-scale slider (live), "fit"; no editable % box |
| ONC-ZM-2 | 🔶 | BC | Fits ALL columns (`fitZoom`), refits on data change; max 24 px/column |
| ONC-ZM-3 | 🟡 | BC | Drag draws marquee with live count → selection bar with "Zoom to selection", New cohort, Save as feature, Copy ids; <4 px = click |
| ONC-MM | 🟡 | BC | "minimap" checkbox (this browser only) draws a full-width strip under the figure, click/drag pans; no floating 150×150 panel, edge-zoom, sliders or close button |

### §2 Layout

| ID | verdict | how | note |
|---|---|---|---|
| ONC-LY-1 | 🟡 | B | Clinical → genes → heatmap, legend genes first ✅; no gap between clinical and genetic groups |
| ONC-LY-2 | 🟡 | B | label \| info \| cells; no ⋮ (click label opens menu); label truncated at 17 chars + "…" |
| ONC-LY-3 | 🟡 | BC | Auto rows: Profiled for <type> (named by alteration type, sorted alphabetically: CNA, mutations, SV — legacy profile names in profile order), Study of origin (multi), # Samples per Patient ✅; no clinicallist/session/server-config precedence |
| ONC-LY-4 | 🔶 | B | "36.9% / 37.4%" driver/any at 1 decimal; no "<1%", no integer rounding; N/P ✅, "*" ✅ |
| ONC-LY-5 | 🟡 | BC | Merged rows drawn "[A / B]"; Results page refuses `[A B]` OQL; genes deduplicated so one gene cannot appear twice (tracked: OQL coverage) |
| ONC-LY-6 | ✅ | B | No column labels, grows in height, own horizontal scrollbar |

### §3 Glyphs

| ID | verdict | how | note |
|---|---|---|---|
| ONC-GL-1 | ✅ | C | `styleForDisplay` colour-by-type off → one green pair "Mutation"; annotate none → one colour per glyph |
| ONC-GL-2 | 🟡 | C | Nonstart (Translation_Start_Site) → Other (legacy Truncating); fusion is an SV, not a truncating mutation (`oncoprint-assemble.ts:19-29`) |
| ONC-GL-3 | ✅ | C | One glyph per layer, legacy priority, driver before VUS; no per-count tiebreak, no germline stripe |
| ONC-GL-4 | ✅ | C | MUT, AMP/HOMDEL (±2 only), FUSION drawn; EXP/PROT only as opt-in overlays |
| ONC-GL-5 | 🟡 | C | OncoKB only; no hotspot or custom sources (tracked) |
| ONC-GL-6 | 🟡 | B | Lists only present glyphs ✅; "Not profiled" always listed even with none; no "No alterations" entry |

Glyph table (colours, bands, z-order) matches legacy exactly for every row present; GAIN/HETLOSS and Germline rows are absent (see OQL coverage / germline gaps).

### §4 Other track types

| ID | verdict | how | note |
|---|---|---|---|
| ONC-TT-1 | 🔶 | C | Top 8 values + "Other"; Okabe-Ito palette; reserved colours ✅; no "Mixed"; legend shows 8 + "+N more" |
| ONC-TT-2 | 🟡 | C | Green bars, red negative, MUTATION_COUNT log, FGA [0,1] ✅; numeric = ≥90 % parse and >10 distinct values, not attribute datatype |
| ONC-TT-3 | ❌ | C | No mutation spectrum track |
| ONC-TT-4 | ✅ | B | Profiled rows Yes = `#1b9e77`, No = NA glyph |
| ONC-TT-5 | 🔶 | C | z-score fixed −3…3 ✅ but blue→white→red; non-z profiles scaled to data range |
| ONC-TT-6 | 🔶 | C | Methylation (generic assay) scaled to data, not fixed 0…1 / 0.35 midpoint |
| ONC-TT-7 | 🔶 | C | VAF 0…1 ✅, sequential blue ramp; profiled-not-mutated drawn as no data |
| ONC-TT-8 | 🔶 | C | GA heatmap: diverging around 0 only if data spans 0; no pivot threshold or sortOrder reversal |
| ONC-TT-9 | ❌ | C | No GA bar / stacked |
| ONC-TT-10 | ❌ | C | Categorical GA refused ("a heatmap track draws numbers") |
| ONC-TT-11 | ❌ | C | No GSVA (tracked: no GSVA data) |
| ONC-TT-12 | 🔶 | C | Clinical: patient row, else one sample's value (no mean/max/"Mixed"); heatmap mean across samples (legacy max \|x\|); VAF max ✅ |

### §5 Per-track menu

| ID | verdict | how | note |
|---|---|---|---|
| ONC-TM-1 | ✅ | B | Current sort bold + ✓; one menu at a time. Item lists differ: genetic rows lack "Sort by genes"; # Samples per Patient lacks "Show one column per…"; no group-header menu |
| ONC-TM-2 | 🟡 | BC | Sort a-Z / Z-a / Don't sort ✅ (kept in document); remove gene edits the view's genes, not `gene_list`; "Remove track" shown on the last gene but is a no-op (`OncoprintCard.tsx:81`); `pruneSort` drops a `cluster:` key on any track edit |
| ONC-TM-3 | 🟡 | B | Show gaps / w/% right / w/% left; offered only when the track is already the primary sort key (no forced a-Z) |
| ONC-TM-4 | ✅ | C | Edit colours inline (colour inputs), Reset; stored in the document, not localStorage (invariant 9) |
| ONC-TM-5 | 🔶 | C | Cluster from the Sort menu; Ward on columns only, group rows not reordered; refused >4,000 columns |

### §6 Sorting

| ID | verdict | how | note |
|---|---|---|---|
| ONC-ST-1 | 🔶 | BC | User keys → staircase → id ✅; not-profiled ranks with unaltered (rank 0), not last (`oncoprint-assemble.ts:415`; visible on Q3 ZFHX3) |
| ONC-ST-2 | 🔶 | BC | One rank per cell: AMP > HOMDEL > SV > trunc > splice > inframe > promoter > missense > other, driver bit as the minor key — so AMP+missense ties AMP alone, and a VUS truncating ranks above a driver in-frame/missense; legacy SV > CNA > mutation as separate keys with all drivers before VUS. Q1: 191/594 positions equal |
| ONC-ST-3 | ❌ | C | No Ignore VUS |
| ONC-ST-4 | 🟡 | C | Clinical string sorts by category index (frequency order), not natural sort; numeric ✅; NA last ✅ |
| ONC-ST-5 | ✅ | C | Re-sorts in the browser on every key change |

### §7 Mouse interactions

| ID | verdict | how | note |
|---|---|---|---|
| ONC-MI-1 | 🟡 | B | Tooltip after ~220 ms; no cell outline / column highlight / label highlight seen |
| ONC-MI-2 | ✅ | B | Click on cells does nothing (drag selects; see ZM-3) |
| ONC-MI-3 | ❌ | C | No label drag; Move up/down only |
| ONC-MI-4 | 🟡 | B | See ZM-3 |
| ONC-MI-5 | 🟡 | B | Label tip: name, merged members, "222 of 594 profiled patients altered (37.4%)", "219 putative driver (36.9%)"; no OQL line / attribute description / profile description |
| ONC-MI-6 | ✅ | B | Same tip gives altered/profiled and "not profiled in N of M columns" |

### §8 Cell tooltips

| ID | verdict | how | note |
|---|---|---|---|
| ONC-TP-1 | 🟡 | B | Id + group + "open this patient ↗"; zoomed out: "N patients under this pixel", no "View these N" link |
| ONC-TP-2 | 🟡 | BC | Per alteration "GENE p.X · class · putative driver/unknown significance"; panel name + "not covering …"; no OncoKB / hotspot icons, no panel popup, no "Profiled in all…" wording |
| ONC-TP-3 | 🔶 | C | "Label: value"; numeric "≈x" decoded from a 0-255 code; no "(n samples)", no "average of n" |
| ONC-TP-4 | 🔶 | C | Heatmap "≈x" approximation, no profile-type prefix |
| ONC-TP-5 | ❌ | C | No stacked tracks |

### §9 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| ONC-MD-1 | 🟡 | BC | Columns, denominators, links, order-file name follow the unit ✅; aggregation differs (TT-12); # Samples per Patient dropped in sample mode (legacy keeps it) |
| ONC-MD-2 | 🟡 | B | Study of origin ✅, Profiled for <type> ✅, numbers ✅ (Q4); Heatmap/GA tabs not hidden |
| ONC-MD-3 | 🟡 | B | NA glyph, "*", Profiled rows ✅; no Show only profiled |
| ONC-MD-4 | 🟡 | C | annotate none: one colour ✅; "drivers only" not disabled |
| ONC-MD-5 | ✅ | BC | drivers only drops VUS, re-runs, legend mark counts them |
| ONC-MD-6 | ❌ | C | No germline (tracked) |
| ONC-MD-7 | 🟡 | B | Inset glyph + split ✅; every SV VUS (no OncoKB SV entries; tracked) |
| ONC-MD-8 | 🟡 | C | "Remove track" still offered on a single gene (no-op) |
| ONC-MD-9 | ❌ | B | Oncoprint does not apply OQL (Q5); `[ ]` refused; no VI-6 (tracked) |
| ONC-MD-10 | ✅ | C | No special empty state; 0 % / N/P |
| ONC-MD-11 | 🟡 | B | 10,336 columns draw fine; simple progress text; fit-all zoom; PNG export has no truncation alert (size chosen in dialog) |
| ONC-MD-12 | N/A | C | Tracks live in the document/link (invariant 9), so there is no per-user save to disable |
| ONC-MD-13 | N/A | C | Same; "Saved work" saves the whole document |

§10 Persistence (no IDs): everything legacy keeps in the URL is in the document (`?changes=`); so are colour-by, view checkboxes and edited colours, which legacy does not persist (invariant 9). Zoom, minimap and selection stay in the browser, as in legacy.

### §11 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| ONC-STM-1 | 🟡 | BC | Numerator/denominator identical in Q1–Q4, patient and sample (`oncoprint-assemble.ts:502-508`); off-panel calls excluded as legacy; display 1 decimal always + driver %, legacy label integer / "<1%" |
| ONC-STM-2 | 🟡 | B | Patient count identical (485, 6208, 682, 775, 344); 1 decimal vs integer; no sample line |
| ONC-STM-3 | 🐞 ok | C | Per-segment altered ÷ profiled; no profiled → "N/P", not "NaN%" (`canvas.ts:88-92`). Note: counts any cell code > 0, so mRNA/protein overlay bits would count as altered |
| ONC-STM-4 | 🔶 | B | Shows patients with a value (count), not 100 × samples ÷ all samples, no 1-decimal % |
| ONC-STM-5 | 🔶 | C | FGA [0,1], # Samples [0,max], log MUTATION_COUNT, zero-height minimum ✅; no patient mean / MUTATION_COUNT max; min = max → span 1 (legacy [x/2, 1.5x]); missing → NA (avoids legacy NaN); legend 1 decimal (legacy 2) |
| ONC-STM-6 | ❌ | C | No mutation spectrum |
| ONC-STM-7 | 🔶 | C | Raw values ✅; z clamp ±3 ✅; methylation not [0,1]; VAF max ✅; patient mean (legacy max \|x\|); GA no pivot |
| ONC-STM-8 | 🔶 | B | Zoomed out: gene "x altered of y profiled"; others "zoom in for per-patient values"; no means |
| ONC-STM-9 | 🔶 | C | Ward, Euclidean on z-scored genes, NaN → mean, columns only (`oncoprint-cluster.ts`); legacy average linkage, 1 − Spearman, rows + columns |
| ONC-STM-10 | ❌ | C | No GSVA (tracked) |
| ONC-STM-11 | 🟡 | C | OncoKB driver = Oncogenic / Likely Oncogenic / Resistance ✅ (`importer/setup.ts:51`); no hotspots, no custom; CNA via OncoKB ✅ (tracked) |
| ONC-STM-12 | 🟡 | C | Overlay threshold default 2, inclusive ✅ (`oncoprint-assemble.ts:240`); not tied to the query's EXP/PROT or profile choice |
| ONC-STM-13 | 🔶 | BC | Fit = all columns, not the altered span; Q1 legacy 30 % vs cBioLab fit-all (2.3 px/column); slider position is log-scaled, not a % |
