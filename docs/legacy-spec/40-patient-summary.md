# Legacy parity spec — Patient View › page shell + Summary tab

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`; backend `cbioportal` for server-side counts.
Each line is one checkable requirement with an ID. Defaults are `[default]`. `URL:` = query param that persists the state; *(local)* = component state, lost on reload.
**Tag key:** `[B]` = seen in the browser only, `[C]` = code-derived only. Untagged = confirmed both ways.
Hover tooltips rendered headless for most items; logged-in / MSK-only features are `[C]`.

Reference URLs:
- Multi-sample, timeline, no CNA/SV: `/patient?studyId=lgg_ucsf_2014&caseId=P04` (4 samples: P04_Pri, P04_Rec1-3)
- Sample mode + cohort nav: `/patient?studyId=lgg_ucsf_2014&sampleId=P04_Rec1#navCaseIds=lgg_ucsf_2014:P01,lgg_ucsf_2014:P04,lgg_ucsf_2014:P05`
- TCGA (CNA, segments, mRNA, timeline with treatments, pathology/tissue tabs): `/patient?studyId=coadread_tcga_pan_can_atlas_2018&caseId=TCGA-A6-2671`
- Gene-panel sample + TMB-H badge: `/patient?studyId=msk_impact_2017&caseId=P-0000004`

Key files (under `src/pages/patientView/` unless noted): `PatientViewPage.tsx`, `PatientViewPageTabs.tsx`, `PatientViewUrlWrapper.ts`,
`PatientViewPageHeader.tsx`, `patientHeader/*`, `sampleHeader/SampleSummaryList.tsx`, `SampleManager.tsx`,
`clinicalInformation/PatientViewPageStore.ts`, `clinicalInformation/lib/clinicalAttributes{Util.js,StyleConsts.ts}`,
`genomicOverview/*`, `vafPlot/*`, `timeline/*`, `packages/cbioportal-clinical-timeline/src/*`,
`mutation/{PatientViewMutationTable,MutationTableWrapper,GeneFilterMenu}.tsx`, `mutation/column/*`,
`copyNumberAlterations/*`, `structuralVariant/StructuralVariantTableWrapper.tsx`, `src/shared/lib/IGVUtils.ts`,
`src/shared/components/SampleNotProfiledAlert.tsx`, `src/shared/cache/{VariantCountCache,MrnaExprRankCache}.ts`.

Shared components: mutation table base columns, annotation column (OncoKB/CIViC/Hotspots/Revue), Copy # column, functional impact,
ASCN column internals → **uses MutationTable (see `05-mutations.md`)**; this file lists patient-view differences only.

---

## 1. Page shell

### PAT-URL — Routing and URL state
- **PAT-URL-1** Route `/patient[/<tab>]`; tab id is the last path segment, `[default]` `summary` (`PatientViewUrlWrapper.ts:73`).
- **PAT-URL-2** URL `studyId` (required) + exactly one of:
  - `caseId=<patientId>` → **patient mode** (all samples of the patient).
  - `sampleId=<sampleId>` → **sample mode** (only that sample's data; patient derived from it) (`PatientViewPageStore.ts:1225`).
- **PAT-URL-3** Other params: `resourceUrl` (open resource link), `genomicEvolutionSettings.*` (Genomic Evolution tab, not here), plots params, `geneset_list` (session), `generic_assay_groups`.
- **PAT-URL-4** Hash `#navCaseIds=<study:patient>,<study:patient>,…` → cohort navigation list (§1.3). Over 60 000 chars it is moved out of the hash into a window variable on load (`shared/lib/handleLongUrls.ts`). Also accepts `window.clientPostedData.navCaseIds` (POST from study view/results).
- **PAT-URL-5** Changing `studyId`, `caseId` or `sampleId` remounts the whole page (fresh store; `PatientViewPage.tsx:124`).
- **PAT-URL-6** Legacy bug `[C]`: `parseCohortIds` prefixes un-namespaced ids with `this.studyId` inside a module function (`this` undefined) → throws; only `study:patient` ids work.

### PAT-SH — Header block (`PatientViewPage.tsx:796-821`)
- **PAT-SH-1** Browser title `Patient: <patientId>` (patient mode) / `Sample: <sampleId>` (sample mode); meta description `<id> from <study name>`.
- **PAT-SH-2** Layout: user-circle icon; table rows **"Patient:"** and **"Samples:"**; right-aligned study bar with study-name link (→ study view) and cohort nav.
- **PAT-SH-3** Loading: big centered spinner until patient clinical data, sample manager and study metadata resolve.
- **PAT-SH-4** Invalid URL → `ValidationAlert` with `urlValidationError` instead of the page `[C]`.

**PAT-SH-5 Patient row** (`patientHeader/PatientHeader.tsx`)
- Patient id as a link; click → URL `caseId=<id>`, `sampleId` removed (returns from sample mode to patient mode).
- Followed by clinical spans (§1.2) built from patient attributes **plus** `CANCER_TYPE` / `CANCER_TYPE_DETAILED` when identical in all samples (those are then removed from the sample rows) (`SampleManager.tsx:290-305`).
- Seen: `P04, Male, 22 years old, Glioma, DECEASED (61 months)`.
- Hover → tooltip: `<h5>patientId</h5>` + Attribute/Value table of all patient clinical data (raw values, e.g. `1:DECEASED`).
- Darwin logo link: `getDarwinUrl` exists but is never rendered (dead code) `[C]`.

**PAT-SH-6 Samples row** (`sampleHeader/SampleSummaryList.tsx`), one entry per sample visible in header, in sample order (§STM-12):
- Sample icon (§1.1) — hover tooltip: `<icon> sampleId` + Attribute/Value table of sample clinical data; gene-panel attribute values are links that open the gene panel modal (PAT-GP-4); `N/A`/`WXS` are not links `[C]`.
- PDX/organoid icon (mouse / organoid SVG) when normalized type is `Xenograft` / `Organoid` `[C]`.
- Sample id link: label `DISPLAY_SAMPLE_NAME (sampleId)` if that attribute exists, else `sampleId`. href = sample-mode URL in new tab; plain click → in-place URL `sampleId=<id>`, `caseId` removed; shift/alt/meta-click → browser default (new tab).
- Sample clinical spans (§1.2), e.g. `, Recurrence (Anaplastic Astrocytoma)`, `, Primary (Breast)`.
- OncoKB biomarker badges: `, MSI-H <OncoKB icon>` / `, TMB-H <OncoKB icon>` (§STM-9). Seen `TMB-H` on msk_impact_2017 P-0000004.
- Mutational-signature mini stacked bar (100 px, 10 px high) when the study has signature data (§STM-8) `[C]`.
- **Sample mode** with >1 sample in patient: only the selected sample is listed (keeping its patient-level number, e.g. `2`) + button **[Show all N samples]** → patient mode.

### PAT-SH-7 Sample icon (`SampleLabelHTML`)
- 12×12 SVG circle, white number label = 1-based position in sample order (stable across patient/sample mode).
- Colour by normalized case type (`SampleManager.tsx:210-285`):

| DERIVED_NORMALIZED_CASE_TYPE | Colour |
|---|---|
| Primary | black |
| Recurrence, Progressed | orange |
| Metastasis | red |
| cfDNA | blue |
| Xenograft | pink |
| Organoid | paleVioletRed |
| Plasma | gold |
| ctDNA | lightblue |
| Urine | yellow |
| Exosome | purple |
| total RNA | grey |
| total DNA, Tissue, none | black |

- Server config `skin_patient_view_custom_sample_type_colors_json` (`{"type":"color"}`) overrides: substring match (case-insensitive) on the source value wins over the built-in rules `[C]`.
- Not-profiled variant: grey (#cccccc) horizontal pill, tooltip "This gene was not profiled for this sample (absent from gene panel). It is unknown whether it is mutated." (`SampleLabelNotProfiled.tsx`).
- Uncalled-mutation variant: same circle at fill-opacity 0.1 (supporting reads) or 0 (no reads).

### PAT-CS — Clinical spans (`clinicalAttributesUtil.js`, `clinicalAttributesStyleConsts.ts`)
- **PAT-CS-1 Clean**: drop values (case-insensitive) in `not applicable, not available, pending, discrepancy, completed, '', null, unknown, na, n/a, [unkown], [not submitted], [not evaluated], [not applicable], [not available], [undefined]`. `AGE`, `OS_MONTHS`, `DFS_MONTHS` floored if numeric. `OS_STATUS`/`DFS_STATUS` lose a `0:`/`1:` prefix.
- **PAT-CS-2 Derive** `DERIVED_NORMALIZED_CASE_TYPE` from first present of `SAMPLE_CLASS, SAMPLE_TYPE, TUMOR_TISSUE_SITE, TUMOR_TYPE, SAMPLE_TYPE_DETAILED`, substring match in this priority: custom types → `metasta`→Metastasis, `recurr`→Recurrence, `progr`→Progressed, `xeno`/`pdx`→Xenograft, `organoid`, `cfdna`, `prim`→Primary, `ctdna`, `plasma`, `urine`, `exosome`, `total rna`, `total dna`, `tissue`.
- **PAT-CS-3** `DERIVED_SAMPLE_LOCATION`: Metastasis → `METASTATIC_SITE`‖`TUMOR_SITE`; Primary → `PRIMARY_SITE`‖`TUMOR_SITE`; else `TUMOR_SITE`.
- **PAT-CS-4** Only whitelisted keys render, sorted by `order` (missing order = last):

| Key | Order | Style | Format |
|---|---|---|---|
| PATIENT_DISPLAY_NAME, SAMPLE_DISPLAY_NAME | 0 | secondary | `(v)` |
| GENDER, SEX | 1 | primary | v |
| DERIVED_NORMALIZED_CASE_TYPE | 1 | primary; Primary black, Recurrence/Progressed orange, Metastasis red | v |
| AGE | 2 | primary | `v years old` |
| DERIVED_SAMPLE_LOCATION | 2 | secondary | `(v)` |
| CANCER_TYPE | 3 | primary | v |
| CANCER_TYPE_DETAILED | 4 | secondary | `(v)` |
| KNOWN_MOLECULAR_CLASSIFIER | 5 | primary | v |
| BREAST_CANCER_RECEPTOR_STATUS, DRIVER_MUTATIONS, ETS_RAF_SPINK1_STATUS, GLEASON_SCORE, HISTOLOGY, MOUSE_STRAIN, TUMOR_GRADE, TUMOR_STAGE_2009 | 6 | primary | v |
| ERG_FUSION_ACGH | 6 | primary | `ERG-fusion aCGH: v` |
| SERUM_PSA | 6 | primary | `Serum PSA: v` |
| TMPRSS2_ERG_FUSION_STATUS | 6 | primary | `TMPRSS2-ERG Fusion: v` |
| OS_STATUS | 7 | primary; DECEASED/DEAD #f00, LIVING/ALIVE green | v |
| OS_MONTHS | 8 | secondary | `(v months)` |
| DFS_STATUS | 9 | primary; DiseaseFree/Yes green, other #f00 | v |
| DFS_MONTHS | 10 | secondary | `(v months)` |
| GLEASON | none (last) | primary | `Gleason: v` |

- **PAT-CS-5** Punctuation: `, ` before the first span; after each span `, ` if the next span is primary, a space if secondary, nothing after the last. Values coloured; punctuation #333.

### PAT-NAV — Cohort navigation (`PatientViewPage.tsx:634-744`), shown only when a nav list exists
- **PAT-NAV-1** Pagination controls: `|<` `<` [editable current index] `of` **`N patients`** `>` `>|`. First/prev disabled at index 0; next/last disabled at the end. Seen `2 of 3 patients`.
- **PAT-NAV-2** Typing a page number in [1, N] jumps to that patient.
- **PAT-NAV-3** "N patients" link (tooltip "Open all patients in study view") opens study view in a new window with `filterJson={patientIdentifiers:[…]}` passed via `window.studyPageFilter` `[C]`.
- **PAT-NAV-4** ⊖ icon (tooltip "Exclude the current patient") removes the current patient from the list and navigates to the next (or previous if it was last); rewrites the `navCaseIds` hash only if URL ≤ 4500 chars `[C]`.
- **PAT-NAV-5** Navigation always uses patient mode (`caseId`), dropping `sampleId`.

### PAT-TAB — Tab bar (`PatientViewPageTabs.tsx`), in this order

| Tab (id) | Shown when |
|---|---|
| Summary (`summary`) | always |
| Genomic Evolution (`genomicEvolution`) | >1 sample in current mode AND some mutation has VAF > 0 (not in this file) |
| Pathways (`pathways`) | always |
| Clinical Data (`clinicalData`) | always |
| Files & Links (`filesAndLinks`) | any study/patient/sample resource data, or it is the active tab |
| Pathology Report (`pathologyReport`) | TCGA studies only (study id contains `tcga`) and ≥1 PDF found in the datahub mirror |
| Tissue Image (`tissueImage`) | tissue-image iframe check succeeds |
| Tissue Image (`MSKTissueImage`) | MSK: sample attr `MSK_SLIDE_ID` exists and viewer URL responds `[C]` |
| Matched Trials (`trialMatchTab`) | `localStorage.trialmatch === 'true'` and matches exist `[C]` |
| Mutational Signatures (`mutationalSignatures`) | study has signature data |
| mRNA **Beta!** / Plots **Beta!** | `app_name=mskcc-portal` or feature flag `patientMRNATab`, and an mRNA profile exists (or deep-linked) `[C]` |
| open resource tabs (`openResource_<id>`) | resource opened (or `openByDefault`); closable ×, closing returns to Files & Links |
| custom tabs | server `custom_tabs` with location `PATIENT_PAGE` `[C]` |

- Seen TCGA: Summary, Pathways, Clinical Data, Pathology Report, Tissue Image, Slide Microscopy (custom). lgg P04: Summary, Genomic Evolution, Pathways, Clinical Data.

---

## 2. Summary tab — layout (top → bottom; `PatientViewPageTabs.tsx:102-452`)
1. **Timeline** (§3) — only if the patient has ≥1 clinical event; followed by `<hr>`.
2. **Genomic Overview** (§4) — only if (gene-filtered called mutations > 0 OR CNA segments > 0); instruction pill "Click alteration for detail. Double-click to zoom."
3. **Mutations table** (§5) — instruction pill "Click on an mutation to zoom in on the gene in the IGV browser above" (sic).
4. **Structural Variants table** (§7).
5. **Copy Number Alterations table** (§6) — instruction "Click on a CNA row to zoom in on the gene in the IGV browser above".
- **PAT-SUM-1** No "actionability"/OncoKB summary cards exist in legacy; OncoKB appears only as header biomarker badges (PAT-SH-6) and the Annotation columns.
- **PAT-SUM-2** All data on this tab is for the samples of the current mode (`sampleIds`): patient mode = all samples, sample mode = one sample. Exception: the Timeline always shows all of the patient's events.

---

## 3. Timeline (`timeline/TimelineWrapper.tsx`, `timeline/timeline_helpers.tsx`, `packages/cbioportal-clinical-timeline`)

### PAT-TL-TR — Tracks
- **PAT-TL-TR-1** One root track per `eventType` (upper-cased). Root order: `SPECIMEN, SAMPLE ACQUISITION, SEQUENCING, SURGERY, MED ONC, MED ONC ASSESSMENT, STATUS, DIAGNOSTICS, DIAGNOSTIC, IMAGING, IMAGING ASSESSMENT, TREATMENT, DIAGNOSIS, LAB_TEST, MEASUREMENTS`, then any other types in first-seen order (`timeline_helpers.tsx:300`).
- **PAT-TL-TR-2** Nested sub-tracks by attribute hierarchy (`timeline_helpers.tsx:317`):

| Root | Nested by |
|---|---|
| TREATMENT | TREATMENT_TYPE → SUBTYPE → AGENT |
| LAB_TEST | TEST |
| DIAGNOSIS | SUBTYPE |
| PATHOLOGY | SUBTYPE |
| BIOBANK | SPECIMEN_TYPE → SITE → SUBTYPE |

- Events lacking the attribute go to an `Other` child. A chain where the only child is `Other` collapses into the parent. Seen TCGA: TREATMENT › Other › Conatumumab, Leucovorin; Chemotherapy › Fluorouracil, …
- Sibling sub-tracks sorted by the start of their first item; indent 17 px per level.
- **PAT-TL-TR-3** Track label = `label || type` with **underscores removed** (e.g. `LAB_TEST` → `LABTEST`) — legacy quirk; long labels ellipsized with tooltip.
- **PAT-TL-TR-4** Collapse: parents show ▾ caret; click → ▸ and children hidden, their events drawn on the parent row *(local)*. Seen: collapsing TREATMENT hides 5 sub-rows.
- **PAT-TL-TR-5** Hovering a row highlights the label and the row (#F2F2F2).
- **PAT-TL-TR-6** Special studies `[C]`: URL containing `genie_bpc` → GENIE config (different order, Med Onc/Imaging status colours + legend); MSK hosts → toxicity grade colours (1 green, 2 yellow, 3 orange, 4 red); `htan_test_2021`+`HTA9_1` → hard-coded imaging camera. Not required for parity.

### PAT-TL-EV — Event rendering
- **PAT-TL-EV-1** Point event (start = end; end defaults to start when missing or 0): circle r=4, colour = attribute `STYLE_COLOR` or `rgb(31,119,180)`. `STYLE_SHAPE` ∈ circle/square/triangle/diamond/star/camera changes the shape.
- **PAT-TL-EV-2** Range event: rounded bar, height 5, width ≥ 8 px.
- **PAT-TL-EV-3** Same-day events in one row stack: superscript count + stacked colours; the tooltip pages through them.
- **PAT-TL-EV-4** SPECIMEN / SAMPLE ACQUISITION / SEQUENCING rows: event with attr `SAMPLE_ID` → sample marker (circle r=7, sample colour, white number). Several on the same day → pill with the colours of the distinct samples and a range label (`1-3, 5`). Unknown sample id → colour #333333, label `-`.
- **PAT-TL-EV-5** STATUS row: an event with `STATUS=DECEASED` → black diamond.
- **PAT-TL-EV-6** Line charts (row height 50 instead of 20): LAB_TEST sub-tracks where every event has a numeric `RESULT`; PSA uses `VALUE`‖`RESULT`; MEASUREMENTS sub-tracks with numeric `RESULT`. A leading `<` / `>` is stripped before parsing. Grid lines + 3-tick axis in the label column `[C]`.

### PAT-TL-TT — Tooltips (`TimelineTrack.tsx`, `TimelineStore.tsx`)
- **PAT-TL-TT-1** Hover shows a tooltip; leaving hides it after 100 ms unless pinned; click toggles the pin; clicking a tooltip closes the others; Esc closes all; leaving the page body closes all.
- **PAT-TL-TT-2** Default content: table of all attributes (key with `_`→space; value rendered as Markdown links `p`/`a`; a link ending in `:blank` opens a new tab, other links open an iframe overlay with [Open in New Window] [Close]), then `DATE` (point) or `START DATE` + `END DATE` (range), formatted per §STM-11.
- **PAT-TL-TT-3** Sample rows: custom table — `SAMPLE ID`, then the event attributes merged with **all sample clinical attributes**, keys upper-cased with `_`→space, sorted by key, then `START DATE`. Seen: `SAMPLE ID` appears twice (header row + attribute) — legacy quirk.
- **PAT-TL-TT-4** Multiple events: header shows the event's point plus `[<] i of n events [>]`; ←/↓ previous, →/↑/space next (wraps). Line-chart rows add "Plotted y value is the max of simultaneous events." `[C]`

### PAT-TL-ZM — Axis, zoom, download
- **PAT-TL-ZM-1** X axis in days since diagnosis, one major tick per 365 days labelled `0`, `1y`, `-1y`…; minor ticks every 30.42 days, labelled `Nm`/`Ny Nm` when ≥150 px per year (every 4th month) or all months at >700 px per year.
- **PAT-TL-ZM-2** Empty stretches of ≥4 consecutive years without events are trimmed to a squiggle; clicking a squiggle expands all trims and shows **[reset axis]** *(local)*.
- **PAT-TL-ZM-3** "🔍+ drag to zoom": drag > 10 px horizontally → zoom to that range and scroll to it; shows **[🔍− reset zoom]** *(local)*. A vertical cursor line follows the mouse. Legacy bug `[C]`: zoom bounds starting exactly at day 0 are ignored (`if (start && end)`, `TimelineStore.tsx:354`).
- **PAT-TL-ZM-4** Download button (cloud icon) → PDF, PNG, SVG (`timeline.*`, labels and tracks, no highlight rects) and **Data (ZIP)** = `timeline.zip` with one TSV per event type `data_timeline_<eventtype lower>.txt`, columns `PATIENT_ID, START_DATE, STOP_DATE, EVENT_TYPE, <all attribute keys>` `[C]` (button seen `[B]`).
- **PAT-TL-ZM-5** Width = window width; header column width fixed at first render.

---

## 4. Genomic Overview (`genomicOverview/GenomicOverview.tsx`, `shared/lib/IGVUtils.ts`)
- **PAT-GO-1** igv.js viewer, genome hg38 if the study reference genome is GRCh38, else hg19.
- **PAT-GO-2** Tracks, in order:
  - **MUT** (if mutations): one row per sample with ≥1 called, gene-filtered mutation; feature at [start−1, end]; colour = protein-impact colour of the mutation, all treated as drivers (`defaultMutationTrackProps`; colours in `05-mutations.md`).
  - **CNA** (if segments): `seg` track, one row per sample with segments, value = `segmentMean`, igv default seg colour scale `[C]`.
  - Row height 18 px; track height = clamp(#samples × 18, 25, 600). Rows sorted by sample order.
- **PAT-GO-3** Three side columns aligned to rows:
  - left: sample icon (with clinical tooltip);
  - right: per-sample summary — MUT: mutation count (tooltip "Number of mutation events."), CNA: altered % or `N/A` (tooltip "Percentage of copy number altered chromosome regions (mean copy number log value >0.2 or <-0.2) out of measured regions." / "Copy number segment data not available") — §STM-5/6;
  - far right: gene-panel icon, shown only if some sample is not whole-exome/genome — label `P1…Pn` (blue, 20 % alpha bg) or `W` (#007fff), tooltip `Gene panel: <id>` or "Gene panel information not found. Sample is presumed to be whole exome/genome sequenced." (§STM-13). Seen `P1` on msk_impact_2017.
- **PAT-GO-4** Compact view `[default]`: no navbar search, ideogram, sequence/RefSeq track, track labels; compact ruler. Custom button **[Reset View]**.
- **PAT-GO-5** Feature popups `[C]`: mutation → Sample, Gene, Protein Change, Location `chrN:start-end` (thousands separators); segment → Sample, Mean CN log2 value, Location.
- **PAT-GO-6** Any locus change other than whole genome (`all`) switches to the advanced view (navbar, search, ideogram, sequence, SVG/track-label/cursor/center-line buttons) `[C]`.
- **PAT-GO-7** Clicking a mutation row or CNA row sets the locus to that gene (seen: APC row → chr5 ~112 Mb). Selecting a mutation deselects a selected CNA and vice versa.
- **PAT-GO-8** [Reset View] → compact view, locus `all`, and deselects the selected table row.
- **PAT-GO-9** Not implemented in legacy: genome-wide "circos" view; per-sample VAF tracks inside IGV. VAF is shown as the Allele-Freq header plot (§5.3).

---

## 5. Mutations table — patient-view differences (base: `05-mutations.md`)

### PAT-MT-1 Data and rows
- Rows = called mutations (mutation profile) + uncalled mutations (`*_uncalled` profile, only rows also present as called), for `sampleIds` (§STM-14 merge key).
- `Study is not profiled for mutations.` alert if the study has no MUTATION_EXTENDED profile.
- PAT-NP not-profiled alert above the table (§8); the table is hidden when no current sample is profiled.
- Header `N Mutations (page x of y)`; paging `[default]` 10 rows; options 10, 25, 50, 100; "Show more".
- Default sort: column `skin_patient_view_tables_default_sort_column` `[default 'Annotation']`, descending.
- Row click → select + IGV zoom (PAT-GO-7); hover tracked for other views `[C]`.

### PAT-MT-2 Columns (patient-specific behaviour), in display order

| Column | Default visible | Shown/excluded when | Notes |
|---|---|---|---|
| Samples | ✓ | excluded if <2 samples in mode AND no uncalled mutations | one icon per patient sample (all samples, also in sample mode); see PAT-MT-4 |
| Gene | ✓ | — | header gear menu = gene filter (PAT-MT-6) |
| Gene panel | ✗ | — | panel id(s) per sample, links open panel modal |
| Protein Change | ✓ | — | — |
| Annotation | ✓ | — | OncoKB uses patient-level tumor type per sample; header toggle merge/split OncoKB icons, persisted in localStorage (PAT-PER) |
| Custom Driver / Custom Driver Tiers | ✗ | per server labels | — |
| Functional Impact | ✗ | excluded unless `show_genomenexus` | — |
| Chromosome, Start Pos, End Pos, Ref, Var, HGVSg, HGVSc, MS, VS | ✗ | — | — |
| Mutation Type | ✓ | — | — |
| Variant Type | ✗ | — | — |
| ASCN Method | ✗ | excluded unless some mutation has ASCN method | — |
| Clonal | ✗ | excluded unless CCF/expected-copies data | per-sample icons |
| CCF | auto | excluded unless CCF data; visible by default when data exists | per-sample values |
| Mutant Integer Copy # | auto | excluded unless data; visible by default when data exists | per-sample |
| Total Integer Copy # | ✗ | excluded unless ASCN integer, total and minor copy number all exist | per-sample |
| Center | ✗ | — | — |
| **Allele Freq** | auto | visible iff some row has a non-zero VAF | PAT-MT-3 |
| Variant Reads, Ref Reads, Variant Reads (Normal), Ref Reads (Normal) | ✗ | — | per-sample values |
| **Copy #** | auto | excluded if no discrete CNA profile OR >1 sample in mode | gene's discrete CNA in that sample, e.g. ShallowDel/Gain/Diploid; tooltip "Shallow deletion" (renderer in `05-mutations.md`) |
| **mRNA Expr.** | ✓ | excluded if no `*rna_seq*_zscores` profile OR >1 sample in mode | PAT-MT-5 |
| **Cohort** | ✓ | — | §STM-2 |
| Exon, gnomAD, ClinVar, dbSNP | ✗ | — | — |
| SIGNAL | ✗ | excluded unless `show_signal` | — |
| namespace columns | ✗ | from MAF namespaces | — |

- Seen lgg (4 samples, no CNA): Samples, Gene, Protein Change, Annotation, Mutation Type, Allele Freq, Cohort. TCGA (1 sample): Gene, Protein Change, Annotation, Mutation Type, Allele Freq, Copy #, mRNA Expr., Cohort.
- Server `skin_patient_view_mutation_table_columns_show_on_init` (comma list) forces initial visibility; `skin_mutation_table_namespace_column_show_by_default` for namespaces `[C]`.
- Columns dropdown lists every non-excluded column with checkboxes + [Select all] [Deselect all]; visibility *(local)*.

### PAT-MT-3 Allele Freq column (`mutation/column/AlleleFreqColumnFormatter.tsx`)
- One sample visible in header: plain text VAF (§STM-1 format).
- >1 sample: SVG of 6-px-wide bars, 3-px gaps, one slot per patient sample in sample order; bar height = VAF × 12 px, colour = sample colour; missing sample = empty slot.
- Tooltip, one line per sample: `<icon> <VAF> (<alt> variant reads out of <alt+ref> total)`, uncalled prefixed `(uncalled) `. Seen `0.38 (46 variant reads out of 121 total)`.
- Sort: vector of per-sample VAFs in sample order. Download: VAF per mutation (array if several).
- Header: "Allele Freq" + bar-chart thumbnail when VAF data exists; hover shows "Variant allele frequency in the tumor sample" + expanded VAF plot (§STM-7) with checkboxes ☑ histogram, ☑ density estimation *(local)*.
- Legacy bugs: a VAF of exactly 0 renders as empty text in single-sample mode and sorts as null (`|| undefined`, `|| null`); counts 0/0 give text `NaN`.

### PAT-MT-4 Samples column (`mutation/column/TumorColumnFormatter.tsx`)
- For each patient sample: mutated → sample icon (opacity 1 called, 0.1 uncalled with reads); profiled but not mutated → invisible placeholder (keeps alignment); gene not on the sample's panel → grey not-profiled pill.
- Tooltip extra text: "Mutation has supporting reads, but wasn't called." and/or "This gene was not profiled for this sample (absent from gene panel)".
- Sort: (# called samples, then 0/1 presence per sample in order). Download: sample ids.

### PAT-MT-5 mRNA Expr. column (`MrnaExprColumnFormatter.tsx`)
- 30-px line with a 3-px dot at the percentile position + `round(percentile)%`. Dot colour: <25 blue, >75 red, else gray.
- Tooltip "mRNA level of the gene in this tumor / mRNA z-score: z / Percentile: p" (seen `-0.8638`, `25`); NA → "mRNA data is not available for this gene." (§STM-4).

### PAT-MT-6 Gene filter ("Show only") menu (`mutation/GeneFilterMenu.tsx`)
- Gear icon in the Gene header, shown only if >1 sample in mode AND some row's gene is not profiled in some sample.
- Text "Different gene panels were used for the samples. Filter mutations for:"; radios ◉ **Genes profiled in any sample** `[default]` (server `skin_patientview_filter_genes_profiled_all_samples=true` → all) / ○ **Genes profiled in all samples** *(local)*.
- "All samples" keeps only rows whose gene is profiled in every sample in mode; it also filters the Genomic Overview MUT track and the VAF plot. Not seen (no mixed-panel patient tested) `[C]`.
- No other "show only" filters (drivers/somatic) exist on the patient page.

---

## 6. Copy Number Alterations table (`copyNumberAlterations/CopyNumberTableWrapper.tsx`)
- **PAT-CNA-1** Data: discrete CNA (default event types HOMDEL and AMP only, i.e. −2/2) for `sampleIds`; rows merged by gene + alteration.
- **PAT-CNA-2** No discrete profile → alert "Study is not profiled for copy number alterations." Seen on lgg.
- **PAT-CNA-3** Header `N Copy Number Alterations (page x of y)`; 10 rows; default sort by the Annotation column (server default), descending.
- **PAT-CNA-4** Columns:

| Column | Default | Condition / content |
|---|---|---|
| Samples | ✓ | only if ≥2 samples in mode; same renderer as PAT-MT-4 using the CNA panel |
| Gene | ✓ | gear gene-filter menu (as PAT-MT-6) |
| Gene panel | ✗ | — |
| CNA | ✓ | `AMP` (#FF0000) / `DeepDel` (#0000FF); filter on text; sort by value |
| Annotation | ✓ | OncoKB + CIViC; no hotspots, no Revue |
| Custom Driver | auto | visible if **some** row has `driverFilter`/`driverFilterAnnotation` |
| Custom Driver Tiers | auto | visible only if **every** row has `driverFilter`/`driverFilterAnnotation` — legacy bug (checks the binary fields, not tiers) |
| Cytoband | ✓ | from reference genome genes |
| mRNA Expr. | ✓ | only if exactly 1 sample in mode and an mRNA z-score profile exists; same renderer as PAT-MT-5 |
| Cohort | ✓ | §STM-3; GISTIC badge if the gene has a GISTIC peak for that direction (q-value, # genes in peak) |
| namespace columns | ✗ | — |

- Seen TCGA: Gene, Gene panel(✗), CNA, Annotation, Custom Driver(✗), Custom Driver Tiers(✗), Cytoband, mRNA Expr., Cohort.
- Server `skin_patient_view_copy_number_table_columns_show_on_init` replaces visibility for all columns `[C]`.
- Copy/download buttons only when `skin_hide_download_controls` = show all.
- **PAT-CNA-5** Gene filter "all samples" for CNA uses the **mutation** gene-panel map (`PatientViewPageStore.ts:3110`, `3164`) — legacy bug.

---

## 7. Structural Variants table (`structuralVariant/StructuralVariantTableWrapper.tsx`)
- **PAT-SV-1** Data: SVs in the first STRUCTURAL_VARIANT profile (FUSION or SV datatype) for `sampleIds`; rows merged by sorted (gene1, gene2, pos1, pos2, chr1, chr2, variantClass) so A–B and B–A merge.
- **PAT-SV-2** No profile → "Study is not profiled for structural variants."; empty → header `0 Structural Variants`, body "There are no results."
- **PAT-SV-3** Columns: Samples (≥2 samples), Gene 1 ✓ (gear gene-filter menu), Gene 2 ✓, Gene panel ✗, Status ✓ (`s`/`g` badge from `svStatus`; sort is a constant — not sortable), Annotation ✓ (OncoKB fusion), Custom Driver / Tiers (same some/every bug as CNA), Variant Class ✓, Site1/Site2 Chromosome ✗, Site1/Site2 Position ✗, Event Info ✓, Connection Type ✓, Breakpoint Type ✗, Additional Annotation ✗, namespace ✗. No Cohort column.
- **PAT-SV-4** Legacy bug: the SV gene-filter menu updates its option but the table data is never filtered by it.
- **PAT-SV-5** Server `skin_patient_view_structural_variant_table_columns_show_on_init` overrides visibility `[C]`.

---

## 8. Gene panels and profiling indicators
- **PAT-NP-1** Per table, alert "Sample(s) <icons> not profiled for <mutations | copy number alterations | structural variants>" listing current samples with no gene-panel-data row for that profile; table hidden if none profiled `[C]`.
- **PAT-GP-1** Profiled for gene ⇔ sample panel is WES/WGS/unknown (whole genome) OR the panel contains the gene.
- **PAT-GP-2** Indicators: not-profiled pill in Samples columns; Gene panel column; Genomic Overview panel icons; sample tooltip gene-panel attribute.
- **PAT-GP-3** Gene panel modal: title "Gene Panel", panel id, gene filter box (regex, case-insensitive), genes in 3 columns, copy/download of the gene list `[C]`.
- **PAT-GP-4** All gene-panel links (Gene panel columns, clinical tooltip values) open the modal; tooltips are disabled while it is open.

---

## Modes & conditions

| Condition | Effect |
|---|---|
| `caseId=` (patient mode) | all samples; header lists all samples; Samples columns when ≥2 |
| `sampleId=` (sample mode) | data for one sample; header shows that sample (numbered as in the patient) + [Show all N samples]; Copy #/mRNA columns allowed; Genomic Evolution hidden; Timeline still all events |
| 1 sample in mode | no Samples column (unless uncalled mutations); Allele Freq as text; Copy # and mRNA Expr. columns allowed |
| ≥2 samples | Samples columns; VAF bars; Copy #/mRNA Expr. excluded; gene-filter gear if panels differ |
| No clinical events | no Timeline |
| No mutations and no segments | no Genomic Overview |
| No CNA segments | CNA track absent (lgg) |
| Panel-sequenced samples | GO gene-panel icon column; not-profiled pills |
| No discrete CNA / SV / mutation profile | corresponding "Study is not profiled for …" alert |
| TMB ≥ 10 / MSI Instable | OncoKB TMB-H / MSI-H badge in sample row |
| cohort list present | prev/next nav + exclude button |
| TCGA study | Pathology Report tab probe |

## Persistence

| State | Where |
|---|---|
| mode, patient, sample, study | URL `caseId` / `sampleId` / `studyId` |
| active tab | URL path `/patient/<tab>` |
| cohort list | URL hash `navCaseIds` (or POSTed data / window cache) |
| open resource link | URL `resourceUrl`; open resource tabs *(local)* |
| OncoKB merged/split icons | localStorage (`getOncoKbIconStyleFromLocalStorage`) |
| table column visibility, page, sort, search | *(local)* |
| gene filter any/all (mut, CNA, SV) | *(local)*, default from server config |
| selected row / IGV locus / compact vs advanced | *(local)* |
| timeline collapse, zoom, expanded trims, pinned tooltips | *(local)* |
| VAF plot histogram / density checkboxes | *(local)* |

---

## Statistics & methods

**PAT-STM-1 VAF** (`AlleleFreqColumnFormatter.tsx:267`, `GenomicOverviewUtils.ts:111`)
- Per mutation per sample: tumorAltCount / (tumorAltCount + tumorRefCount). Negative counts (missing) → no value.
- Format: `< 0.01` → 4 decimals, else 2 decimals (`getFormattedFrequencyValue`).
- `existsSomeMutationWithVAFData` (gates Genomic Evolution): some mutation with integer counts and VAF > 0.

**PAT-STM-2 Mutation Cohort column** (`shared/components/mutationTable/column/CohortColumnFormatter.tsx`; backend `VariantCountServiceImpl.java`, `VariantCountMapper.xml`, `migration.sql:361`)
- Numerator A = `gene_count`: distinct samples in the study's mutation profile with **any** mutation in the gene (all types, germline and VUS included; not panel-aware).
- Numerator B (when the row has a `keyword`, e.g. `IDH1 R132 missense`, `APC truncating`): distinct samples with that keyword.
- Denominator: sample count of list `<studyId>_sequenced`; if missing, number of samples with mutation data in the profile. Same for every gene (not "profiled for this gene").
- Bar 30 px: grey background, light-green = A/denominator, green = B/denominator; text = A%.
- Percent format (`getPercentage`): 0 → `0%`; < 1 % → `<1%`; else `Math.round`.
- Tooltip: "A samples (A%) in this study have mutated GENE, out of which B (B%) have KEYWORD mutations." (B% is also over the study denominator). Seen "387 samples (72%) … 376 (70%) have APC truncating mutations."
- MutSig badge if the gene has a MutSig q-value > 0 `[C]`.
- Sort by A, default direction desc. Download `[C]`: none defined (column not downloadable).

**PAT-STM-3 CNA Cohort column** (`copyNumberAlterations/column/CohortColumnFormatter.tsx`; backend `DiscreteCopyNumberServiceImpl.fetchCopyNumberCounts`, `MolecularDataServiceImpl.java:151`)
- Numerator: number of samples in the discrete profile with **exactly the same alteration** (2 or −2) in the gene.
- Denominator: number of samples in the discrete CNA molecular profile (`genetic_profile_samples`) — a different denominator than the mutation Cohort column.
- Bar red (AMP) / blue (deletion); percent via `getPercentage`. Tooltip "N sample(s) (P%) in this study has/have amplified|deleted GENE". Seen "27 samples (5%) in this study have amplified ANK1".
- Download: the percent string; sort: numerator, default desc.

**PAT-STM-4 mRNA percentile** (backend `MrnaPercentileServiceImpl.java`)
- Profile: first study profile matching `/^.+rna_seq.*_zscores$/i`; none → column absent.
- z-score = this sample's value. Rank among all numeric values of the gene in the profile (all samples), `NaturalRanking(NaN REMOVED, ties MAXIMUM)`; percentile = rank / n × 100, rounded to 2 decimals HALF_UP. Display `Math.round(percentile)%`.

**PAT-STM-5 Genomic Overview CNA %** (`CnaTrackSampleSummary.tsx:15`)
- Per sample over its segments: measured = Σ(end − start); altered = Σ(end − start) of segments with length ≥ 50 000 bp AND |segmentMean| ≥ 0.2.
- Value = 100 × altered / measured, `toFixed(1)%`; measured = 0 → `N/A`. Seen TCGA-A6-2671 `48.8%`.
- The tooltip says "> 0.2 or < -0.2"; code is inclusive (≥).

**PAT-STM-6 Genomic Overview mutation count**: number of MUT features for the sample = called (non-uncalled) mutations after the gene filter, one per mutation record. Seen lgg P04: 12, 28, 18, 55.

**PAT-STM-7 VAF plot** (`vafPlot/legacyVAFCode.js`, `GenomicOverviewUtils.ts:111-150`)
- Input per sample: VAFs of called mutations with counts ≥ 0, **padded with NaN** up to the number of merged mutation rows.
- x domain [−0.1, 1]; KDE = Gaussian kernel at 100 `ticks` of x; bandwidth = max(1.06 × σ × n^(−1/5), 0.01) (Silverman). σ = population SD.
- Histogram: `d3.layout.histogram` 30 bins, relative frequency, drawn on its own y scale; left axis = mutation count [0, max bin count].
- Legacy bugs: n in the bandwidth and the histogram frequency denominators include the NaN padding (non-NaN values are used for mean/σ). `doesFrequencyExist` checks only the first value of the first sample, so the VAF thumbnail can be hidden even when other samples have VAF.

**PAT-STM-8 Mutational-signature header bar** (`SignificantMutationalSignatures.tsx`, `MutationalSignaturesUtils.tsx:136`)
- Significant = signatures for the sample with confidence (p) < 0.05, sorted by contribution desc, for the selected signature version.
- Bar segments: per signature category colour, width = floor(Σ contribution × 100) %.
- Tooltip: ≤5 significant → "Significant signatures" (all); >5 → first 10, header "Top 10 signatures" even if fewer than 10 exist (legacy quirk); table name + exposure bar.

**PAT-STM-9 TMB-H / MSI-H badges** (`PatientViewPageStore.ts:3569-3660`, `shared/lib/StoreUtils.ts:1803-1940`, `shared/constants.ts:29-41`)
- TMB-H: a sample qualifies if `CVR_TMB_SCORE` (preferred) or `TMB_NONSYNONYMOUS` ≥ 10 (inclusive) → OncoKB query with tumor type.
- MSI-H: a sample qualifies if `MSI_TYPE` = `Instable` exactly. The badge also needs an `MSI_SCORE` attribute to exist; its value is not checked against `MSI_H_THRESHOLD` = 10 (legacy quirk; `getNumericalClinicalDataValue` never returns undefined for strings).
- Only shown when `show_oncokb` is on and OncoKB returns an annotation.

**PAT-STM-10 Clinical value formatting**
- Spans: AGE / OS_MONTHS / DFS_MONTHS floored (PAT-CS-1).
- Tooltip tables: non-integer numbers rounded to 1 decimal (seen Fraction Genome Altered 0.4881 → `0.5`); timeline sample tooltip shows raw values (`0.4881`).

**PAT-STM-11 Timeline time math** (`packages/cbioportal-clinical-timeline/src/lib/helpers.ts`)
- `formatDate(d)`: years = ⌊|d|/365⌋, months = ⌊(|d| − 365y)/30⌋, days = remainder; parts `N year(s)`, `N month(s)`, `N day(s)` (days shown if > 0 or d = 0), joined with `, `, leading `-` if negative. Seen `28 days`, `0 days`.
- Ticks: 365-day intervals from ⌊min/365⌋×365 to ⌈max/365⌉×365; 20-day buffer before the first and after the last event; ≥4 empty ticks in a row → trim region.
- Line chart: y = max of the values of simultaneous events; scale [min, max] (max = min + 1 if equal); padding = min(h/7, 15).

**PAT-STM-12 Sample order and numbering** (`SampleManager.tsx:21-110`)
- Sort keys, ascending: (1) `startNumberOfDaysSinceDiagnosis` of the SPECIMEN / SAMPLE ACQUISITION event whose `SAMPLE_ID` / `SpecimenReferenceNumber` / `SPECIMEN_REFERENCE_NUMBER` matches (missing → last); (2) normalized type index primary=0, metastasis=1, cfdna=2, other=3; (3) natural sort of sample id.
- Label = index + 1. Computed over **all** patient samples, so numbering is the same in sample mode.

**PAT-STM-13 Gene-panel icon labels** (`GenomicOverviewUtils.ts:39-109`)
- Collect unique panel ids from mutation + CNA panel maps, drop undefined, sort ascending. WES/WGS → `W`; the others numbered `P1…Pn` in that sorted order.
- The column is hidden if every sample is WES/WGS/unknown.

**PAT-STM-14 Row merging**
- Mutations: key = gene + proteinChange + chr + start + end + ref + var; one row per key across samples; uncalled mutations join only existing keys.
- CNA: key = entrezGeneId + alteration.
- SV: sorted field tuple (PAT-SV-1).

**PAT-STM-15 "Profiled in all samples" filter**: keep a row iff, for every sample in `sampleIds`, the gene is profiled (PAT-GP-1) in that sample's panel for the profile (mutation map for mutations; also the mutation map for CNA — PAT-CNA-5).
