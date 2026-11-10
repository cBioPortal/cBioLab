# Legacy parity spec — Patient View › non-Summary tabs

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.
The page shell, header, sample manager (sample order, colours, labels) and the Summary tab belong to
`40-patient-summary.md` and are only referenced here.
Headless note: on cbioportal.org only the **first** navigation per browser context loads; later ones hang behind Cloudflare.
Each check therefore used a fresh browser. VAF-chart and heatmap tooltips did not render, so they are `[C]`.

Reference URLs (prefix `/patient/<tabId>?`):
- `studyId=lgg_ucsf_2014&caseId=P04` — 4 samples with VAF data: Genomic Evolution, timeline.
- `studyId=lgg_ucsf_2014&sampleId=P04_Pri` — sample mode, no Genomic Evolution.
- `studyId=msk_impact_2017&caseId=P-0000377` — Pathways.
- `studyId=pancan_pcawg_2020&caseId=DO496` — Mutational Signatures with counts, plus Chromoscope resource tab.
- `studyId=brca_tcga&caseId=TCGA-A2-A04P` — Pathology Report and Tissue Image.
- `studyId=brca_tcga_pan_can_atlas_2018&caseId=TCGA-A2-A04P` — also the "Slide Microscopy" resource tab.

Key files (under `src/pages/patientView/` unless noted):
- `PatientViewPageTabs.tsx` (tab list), `PatientViewPage.tsx` (gating getters), `PatientViewUrlWrapper.ts`, `clinicalInformation/PatientViewPageStore.ts` (`PVS`)
- `mutation/PatientViewMutationsTab.tsx`, `mutation/PatientViewMutationsDataStore.ts`, `mutation/oncoprint/MutationOncoprint{,Utils}.ts(x)`
- `timeline/VAFChart{Wrapper,WrapperStore,Controls,Utils,Header}.ts(x)`
- `mutationalSignatures/*`, `clinicalInformation/ClinicalInformation{Patient,Samples,MutationalSignature}Table.tsx`, `shared/lib/GenericAssayUtils/MutationalSignaturesUtils.tsx` (`MSU`)
- `pathwayMapper/PatientViewPathwayMapper.tsx`, `shared/lib/pathwayMapper/PathwayMapperTable.tsx`, `pathway-mapper@2.3.0` (`PM`)
- `resources/ResourcesTab.tsx`, `shared/components/resources/{ResourceTab,ResourceTable}.tsx`, `pathologyReport/PathologyReport.tsx`, `trialMatch/*`
- `mrna/*`, `PatientViewPlotsTabWrapper.tsx`, `clinicalInformation/PatientViewPlotsStore.ts` (`PS`)

---

## 0. Tab inventory and gating

**PTB-TAB-1 Routing.** The tab id is the last path segment: `/patient/<tabId>?studyId=…&caseId=…|sampleId=…` (`PatientViewUrlWrapper.ts:68-74`).
- Clicking a tab rewrites the path and keeps the query.
- A missing or unknown id falls back to Summary.

**PTB-TAB-2 Tabs in render order**, from `tabs()` in `PatientViewPageTabs.tsx:96-827`. Observed orders:
- P04: Summary · Genomic Evolution · Pathways · Clinical Data
- DO496: Summary · Pathways · Clinical Data · Mutational Signatures · Chromoscope
- TCGA: Summary · Pathways · Clinical Data · Pathology Report · Tissue Image (· Slide Microscopy)

| # | Label | id | Shown when | Code |
|---|---|---|---|---|
| 1 | Summary | `summary` | always (see 40-patient-summary) | :102 |
| 2 | Genomic Evolution | `genomicEvolution` | sampleManager ready AND **>1 sample in view** AND some mutation (called or uncalled) has VAF>0 (`tumorAltCount/(alt+ref)`, both integers) | :455-493, PVS:3125 |
| 3 | Pathways | `pathways` | always (spinner until genetic track data loads) | :521-538 |
| 4 | Clinical Data | `clinicalData` | always | :540-584 |
| 5 | Files & Links | `filesAndLinks` | any resource definition (study, patient or sample) has ≥1 datum; or the URL is already on `filesAndLinks` | :586-604, `PatientViewPage.tsx:280-295` |
| 6 | Pathology Report | `pathologyReport` | studyId contains "tcga" (case-insensitive) AND ≥1 PDF found on GitHub (PTB-PR) | :606-626, `PatientViewPage.tsx:297-303` |
| 7 | Tissue Image | `tissueImage` | patientId matches `/TCGA/` AND the Digital Slide Archive meta call returns `total_count>0`; hidden while pending or on error | :628-644, `PatientViewPage.tsx:305-313`, PVS:265-274 |
| 8 | Tissue Image (MSK) | `MSKTissueImage` | some sample has clinical attr `MSK_SLIDE_ID` AND a GET on the whole-slide-viewer URL (built from the ids + userName + server token) succeeds `[C]` | :646-662, `PatientViewPage.tsx:247-254, 329-345` |
| 9 | Matched Trials | `trialMatchTab` | `localStorage.trialmatch === 'true'` AND MatchMiner returns ≥1 trial match `[C]` | :664-680, `PatientViewPage.tsx:315-322` |
| 10 | Mutational Signatures | `mutationalSignatures` | the study has a `MUTATIONAL_SIGNATURE` generic-assay profile AND ≥1 datum for the patient's samples; hidden while profiles or version are pending or the per-version map is empty | :682-736, PVS:1593-1601 |
| 11 | mRNA **Beta!** | `mrna` | (`app_name==='mskcc-portal'` OR `?featureFlags=patientMRNATab`) AND (an mRNA expression profile exists OR the tab is deep-linked) `[C]` | :495-519, 740-757 |
| 12 | Plots **Beta!** | `plots` | same gate as mRNA, always adjacent to it `[C]` | :758-787 |
| 13 | `<resource displayName>` | `openResource_<resourceId>` | resource tab is open (PTB-RS-5) AND has ≥1 datum; sorted by `priority` | :790-792, `PatientViewPage.tsx:468-504` |
| 14 | `<custom tab title>` | config id | server `custom_tabs` with `location:'PATIENT_PAGE'`; an optional async `hideTab` promise shows a loading tab while pending and drops the tab unless it resolves `true` `[C]` | :794, `shared/lib/customTabs/customTabHelpers.tsx` |

**PTB-TAB-3 Tabs that do not exist** in this version (do not invent them):
- Clinical Trials / CT.gov: only #9 exists, and it is MSK MatchMiner, not OncoKB/CT.gov search.
- Methylation, Treatment, generic-assay, IGV/CN-segments, MTB tabs: none.
- Generic-assay data shows up only via #10 and the shared Plots tab. CN segments live in the Summary genomic overview.

**PTB-TAB-4 Public-site differences** `[B]`:
- The URL gains `pathologySlideSettings={}`, which is absent from cd8c6df, so the public build is newer.
- On `brca_tcga_pan_can_atlas_2018` TCGA-A2-A04P the only resource is patient-level and open by default (Slide Microscopy). The site showed **no Files & Links tab**, and a deep link to `/filesAndLinks` landed on Summary.
- Per cd8c6df code, Files & Links should be shown there. Treat the code (PTB-TAB-2 #5) as the requirement and note the divergence.

**PTB-TAB-5 Tab bar**: MSKTabs with pagination when the bar is too wide (`getPaginationWidth=window width`), plus a HelpWidget in the content area (:80-93). Resource tabs show a close "×" (PTB-RS-6).

---

## 1. Genomic Evolution (`genomicEvolution`)

**PTB-GE-1 Layout.** From top:
1. Sub-tabs **Line Chart** | **Heatmap** (`secondaryNavigation`, both stay mounted).
2. Unprofiled-sample alert to the right of the sub-tabs.
3. Mutation table below both.
- Sub-tab choice is in localStorage `patient_view_mutations_tab__vaf_plot_choice` (`lineChart` `[default]` | `heatmap`) (`PatientViewMutationsTab.tsx:54-56, 128-140`).

**PTB-GE-2 Mutation set.** `mergedMutationDataIncludingUncalledFilteredByGene` minus fusions (`isFusion` on the first row) (:146-153).
- Includes uncalled mutations.
- Respects the Summary-tab gene filter.
- One row/line per (gene, protein change) merged across samples.

**PTB-GE-3 Unprofiled alert** (`shared/components/SampleNotProfiledAlert.tsx:15-60`): "Sample(s) ⟨sample icons⟩ not profiled for mutations", from gene-panel data for the mutation profile. Hidden when every sample is profiled (P04: none).

**PTB-GE-4 Selection model** (`PatientViewMutationsDataStore.ts`):
- The key is gene + proteinChange.
- Clicking a VAF point, a line, a heatmap cell or a table row toggles that mutation's selection.
- Hovering highlights it in all three views.
- Selection is *(local)*. Hover colour is `#318ec4`, highlight stroke 6 px.
- Clicking an empty heatmap area clears the selection `[C]`.

### PTB-GE-LC — Line Chart

**PTB-GE-LC-1 Timeline toggle.** Button [Show Timeline]/[Hide Timeline], only when the patient has clinical events.
- `URL: genomicEvolutionSettings.showTimeline` (`'true'`; default hidden) (:58-77, 396-460).
- When shown, the timeline (40-patient-summary) is drawn above the chart and the header widens to 150 px.

**PTB-GE-LC-2 Controls row** (`VAFChartControls.tsx`). All are *(local)*: the store state is not written to the URL, although the URL keys `logScaleChart`, `yAxisDataRangeInChart` and `showOnlySelectedMutationsInChart` exist (dead; legacy).

| Control | Default | Notes |
|---|---|---|
| Group by: select | empty, shown as "Select…" (null; "None" is not preselected — legacy quirk) | Options: "None" + every sample clinical attribute present on ≥1 sample (P04: Cancer Type, Cancer Type Detailed, Neoplasm Histologic Grade, IDH1 Mutation, MGMT Status, Mutation Count, …, Sample Type, Somatic Status, 1p/19q Status, TMB (nonsynonymous)); searchable, not clearable |
| ☐ Show samples in sequential mode | server `vaf_sequential_mode_default` (false) | **Hidden** when only sequential mode is possible (then forced on). That happens when there are no events, fewer events than samples, or not every sample has a SPECIMEN / "Sample Acquisition" collection day (`SampleManager.tsx:416-427`) |
| ☐ Show only selected mutations | off | Plots only selected mutations (an empty selection plots nothing) |
| ☐ Log scale | server `vaf_log_scale_default` (false) | |
| ☐ Set y-axis to data range | off | |

**PTB-GE-LC-3 Plot.**
- One polyline per mutation (per mutation × group when grouped).
- Points are white-filled circles, r=3, stroke 2 px in the line colour. Segments use stroke-opacity 0.5.
- Colour is black, or a per-group unique colour when grouping is on with >1 group.
- Y-axis label is "Allele Frequency" with 6 ticks (0.0 … 1.0 by default).
- Sample markers (numbered, coloured circles) sit below the plot. Samples at the same x collapse into a multi-marker.
- Data height is 200 px plus a 20 px footer.

**PTB-GE-LC-4 X position.**
- Sequential mode: `x = order(sample)·(width−40)/(nSamples−1) + 20`, with order from sampleManager (40-patient-summary).
- Otherwise: the timeline pixel position of the sample's SPECIMEN event (`VAFChartWrapper.tsx:262-292`).
- In non-sequential mode the x-axis shows time ticks: 0, 4m, 8m, 1y, 1y 4m, … `[B]`.

**PTB-GE-LC-5 Grouping.**
- A mutation's samples are split by the sample's value of the chosen attribute. Samples lacking it go to `'undefined-group'`.
- Each group gets its own line, and its own sample-marker track labelled with the value (coloured, ellipsis).

**PTB-GE-LC-6 Tooltip** `[C]` (`PatientViewMutationsTabUtils.tsx`): "Gene: G", "Protein Change: P", then on a point "Sample ID: S" and one of:

| Status | Text |
|---|---|
| mutated with VAF | `VAF: 0.xx (a reads of t total)` |
| mutated, no VAF | `Mutated, but we don't have VAF data.` |
| uncalled with reads | `Mutation uncalled (VAF: 0.xx (a reads of t total))` |
| profiled, not mutated | `Mutation not detected` (+ VAF when reads are known) |
| not profiled | `S is not sequenced for G mutations.` |

**PTB-GE-LC-7 Download** `[C]`: the chart is rendered inside the clinical-timeline component, which supplies its download control (see 40-patient-summary timeline). The tab itself adds none.

### PTB-GE-HM — Heatmap (`MutationOncoprint.tsx`)

**PTB-GE-HM-1 Header controls.**

| Control | Default | Persistence |
|---|---|---|
| ☑ Cluster | server `oncoprint_clustered_default` (true) | `URL: genomicEvolutionSettings.clusterHeatmap` |
| ☐ Transpose | off: rows = samples, columns = mutations | `URL: genomicEvolutionSettings.transposeHeatmap` |
| ☑ Show mutation labels | on | `URL: genomicEvolutionSettings.showMutationLabelsInHeatmap` |
| Zoom: [−] slider [+] | 100 | *(local)*; − multiplies by 0.7, + divides by 0.7 (:298-306) |
| Download: SVG · PNG · Data | — | file `vafHeatmap`; Data TSV `Sample_ID, Gene, Protein_Change, Variant_Allele_Frequency`, only cells with a VAF (`MutationOncoprintUtils.ts:168-187`) |

- URL check `[B]`: toggling Transpose writes `genomicEvolutionSettings={"transposeHeatmap":"true"}`, and turning Cluster off adds `"clusterHeatmap":"false"`.

**PTB-GE-HM-2 Tracks.**
- *Sample mode (default):* one track per sample in sampleManager order. The label is the 1-based sample number in a sample-colour circle. Column labels are "GENE pChange", only when Show mutation labels is on.
- *Transposed:* one track per mutation, labelled "GENE pChange". Tracks are sorted alphabetically by that label (`:289`). Columns are samples, labelled with numbered coloured circles. Track labels are hidden when labels are off.
- Cells are 20 px wide with 1 px padding (`INIT_PARAMS`).
- Mutations with **no VAF in any sample** are dropped entirely (`MutationOncoprintUtils.ts:156-158`).
- An empty result renders nothing.

**PTB-GE-HM-3 Cell values and legend** (`shared/components/oncoprint/OncoprintUtils.ts:243-253`):
- Value = VAF on [0,1], a linear 2-stop gradient from `rgb(241,242,181)` to `rgb(19,80,88)`.
- Legend reads "VAF Heatmap" 0–1 and "Not mutated/no VAF data" `[B]`.
- null = profiled but not mutated, uncalled with 0 alt reads, or mutated without VAF.
- NA = not profiled for the gene: white cell with a grey horizontal dash, legend "Not sequenced".
- Uncalled with alt>0 gets a value and status "uncalled with reads".
- Tooltip as in PTB-GE-LC-6 `[C]`.

**PTB-GE-HM-4 Ordering.**
- Cluster on: oncoprint heatmap clustering of the track group (see `01-oncoprint.md` ST-M9).
- Cluster off: tracks in sampleManager order (or alphabetical in transposed mode). In transposed mode columns are in sample order; otherwise columns use the oncoprint default sort `[C]`.

### PTB-GE-TB — Mutation table

**PTB-GE-TB-1** Uses the patient mutation table (see `05-mutations.md`). Differences:
- Wrapped in `data-test=GenomicEvolutionMutationTable`.
- **☐ Show only selected mutations** sits at the left of the toolbar: `URL: genomicEvolutionSettings.showOnlySelectedMutationsInTable`. With an empty selection all rows are shown.
- When the filter is on, selected rows are not highlighted.
- Default visible columns `[B]`: Samples · Gene · Protein Change · Annotation · Mutation Type · Allele Freq · Cohort.
- Pages of 10 ("Showing 1-10 of 80 Mutations", [Show more]).
- Column visibility is shared with the Summary mutation table.

---

## 2. Pathways (`pathways`)

**PTB-PW-1** Embeds PathwayMapper (lazy chunk `pathway-mapper`) in patient mode, `patientView=true` (`PatientViewPathwayMapper.tsx`).
- Above it, the unprofiled alert (PTB-GE-3) covers both the mutation and discrete-CNA profiles.
- Spinner until the module and `geneticTrackData` load.

**PTB-PW-2 Input genes.**
- Every gene with a (called or uncalled) mutation after the gene filter, plus every gene with a discrete CNA.
- Each contributes `altered=1, sequenced=1` (100%) and an alteration-type label: the mutation type of the first row, or the CNA type.
- Gene nodes are overlaid with a mini per-sample genetic track (sample order and colours from sampleManager) instead of a % colour.

**PTB-PW-3 Controls in patient mode.**
- Toolbar: Save PNG, Save SVG, Perform layout, help. "Add selected genes to query" is **hidden**.
- Ranking panel: only ☑ **Show TCGA PanCancer Atlas pathways only** `[default on]` `[B]`. The "Ranking options" dropdown and "Consider alteration frequency" are hidden (`PM Ranking.tsx:157-200`).
- Radio-select a row to load that pathway.

**PTB-PW-4 Pathway table** (`PathwayMapperTable.tsx`):
- Columns: Pathway name (radio, truncated to 20 chars + tooltip) · **Pathway altered** (bold Yes/No = score>0, replacing "Score") · Genes matched (truncated list + tooltip; sorted by count).
- Page size fixed at 10, with copy/download buttons.
- Observed `[B]`: altered pathways listed first (NOTCH, WNT, TP53, RTK-RAS, Cell Cycle = Yes; HIPPO, TGF-Beta, NRF2, PI3K, MYC = No).
- The default pathway is the top-ranked one.

---

## 3. Clinical Data (`clinicalData`)

**PTB-CD-1 Layout** `[B]`: h3 "Patient" + table; h3 "Samples" + table; h2 "Timeline Data"; then an h3 per event type (capitalised, e.g. Specimen, Surgery, Status, Treatment), each with a table.

**PTB-CD-2 Patient table** (`ClinicalInformationPatientTable.tsx`):
- Columns Attribute | Value, one row per patient attribute.
- Order: `priority` desc, then displayName (localeCompare) (`shared/lib/SortUtils.ts:3-16`).
- No pagination (all rows). Filter box on. Copy/download shown only when `skin_hide_download_controls===SHOW_ALL`.
- Value rendering:
  - URL → link (new tab).
  - "Gene Panel" → comma list of panel links that open the gene-panel modal (N/A and WXS are not links).
  - Non-integer numeric → `formatPercentValue` (1 decimal; `< 0.1` for tiny non-zero).
  - Otherwise raw.

**PTB-CD-3 Samples table** (`ClinicalInformationSamplesTable.tsx`):
- Columns: Attribute, then one column per sample id in sampleManager order (P04: P04_Pri, P04_Rec1, P04_Rec2, P04_Rec3).
- One row per attribute present on any sample, ordered as PTB-CD-2. A missing value shows `n/a`.
- Values are raw strings (no decimal formatting). URLs → links.
- Only the Attribute column is sortable. No pagination. Copy/download as PTB-CD-2.

**PTB-CD-4 Timeline tables** (`timeline/ClinicalEventsTables.tsx`, `timelineDataUtils.ts`):
- One table per `eventType`.
- Columns: `START_DATE, STOP_DATE, EVENT_TYPE` + the union of attribute keys in first-seen order.
- `PATIENT_ID` and any `STYLE_*` columns are dropped.
- Dates are raw days since diagnosis; missing values are blank.
- All columns are sortable (string sort) and filterable. No pagination.

---

## 4. Mutational Signatures (`mutationalSignatures`)

**PTB-MS-1 Data model** (PVS:1303-1601, `MSU`):
- Profiles: every study profile with `genericAssayType=MUTATIONAL_SIGNATURE`.
- The role comes from a substring of the profile id: `contribution` | `pvalue` (confidence) | `counts`.
- **Version = last `_` token of the profile id** (e.g. `SBS`, `DBS`, `ID`, `v2`, `v3`).
- Confidence is joined to contribution by `uniqueSampleKey` + the last `_` token of the stable id.
- Signature name, description and URL come from the generic-assay meta `NAME`/`DESCRIPTION`/`URL`.

**PTB-MS-2 Controls row.**

| Control | Default | Shown when |
|---|---|---|
| "Mutational Signature Type:" select, options "Mutational Signature <VERSION>" (uppercased) | initial version: `v3` if both v2 and v3 exist; else `SBS` if present; else the first version found (`MSU:184-205`) | always; options = versions that have contribution data |
| "Sample:" select (sample ids with data) | first sample that has **counts** data | >1 sample with signature data |
| [%] [#] y-axis switch | `%` | counts data exist |
| "Y-axis Max:" slider 1–100 step 1 | 100 | counts data exist; reset to 100 on version or scale change |

- All are *(local)*. Version and sample live in the store, not the URL `[C]`.
- Changing version resets the reference plot and selects that version's first signature (`MutationalSignaturesContainer.tsx:290-301`).
- DO496 `[B]`: type "Mutational Signature SBS"; no sample select (1 sample); `%` active.

**PTB-MS-3 Not-profiled alert:** "<ids joined ','> are not profiled for mutational signatures" (or "<id> is …"), for patient samples lacking any count or contribution datum (:413-428).

**PTB-MS-4 Summary line** (counts only): "**Sample:** S | **<Version label> count:** N ⓘ".
- Version labels:
  - SBS → "Single Base Substitution (SBS)"
  - DBS → "Double Base Substitution (DBS)"
  - ID → "Small insertions and deletions (ID)"
  - else the raw version
- Tooltip: "Mutation count may include silent, noncoding and other types of mutations that may not be shown elsewhere in cBioPortal."
- DO496 `[B]`: "Sample: SP1003 | Single Base Substitution (SBS) count: 347".

**PTB-MS-5 Spectrum bar chart** (counts only; `MutationalSignatureBarChart.tsx`):
- One bar per channel of the selected sample, height 230, inside a bordered chart.
- Category strip on top with colour bands:

  | Category | Colour |
  |---|---|
  | C>A | `#5DADE2` |
  | C>G | `#154360` |
  | C>T | red |
  | T>A | `#99A3A4` |
  | T>C | `#2ECC71` |
  | T>G | `#F5B7B1` |
  | DBS AC> | skyblue |
  | DBS AT> | blue |
  | DBS CC> | lightgreen |
  | DBS CG> | darkgreen |
  | unmatched | `#EE4B2B` |

  (`MutationalSignatureBarChartUtils.ts:58-120`)
- Bars are sorted by group. X tick = trinucleotide context (SBS) or COSMIC-style labels (DBS/ID).
- Y label: "Single Base Substitution (%|#)", "Double Base Substitutions (…)", or "Indels (…)". Note the version-dependent label uses `SBS`/`DBS`, else "Indels".
- `#` mode: the top tick is labelled `>=N` `[B]`.
- Download SVG/PNG/PDF button (file `mutationalBarChart`, shown when SHOW_ALL).

**PTB-MS-6 COSMIC reference plot.**
- Hidden until a table row is clicked. Then a mirrored (downward) bar chart appears under the spectrum: "COSMIC Reference / <signature> (%)", ticks 0%…100% `[B]`.
- Data: bundled `cosmic_reference.json` **v3.3 / GRCh37 / <version> / <first word of signature name>**, frequency×100.
- SVG height becomes 550 (300 without the reference).
- Hovering a row updates the info-tooltip target only.

**PTB-MS-7 Signature table** (`ClinicalInformationMutationalSignatureTable.tsx`), with instruction "Click on a mutational signature to update reference plot".
- Columns: "Mutational Signature" (name link + ⓘ tooltip), then one column per sample id with data.
- Tooltip content: "Signature: X", "Description: …" or "No description annnotated in data", "External link to signature (opens new tab)" or "No url annnotated in data". The "annnotated" typo is legacy.
- Cell = contribution % (PTB-STM-4), **bold when confidence p<0.05** (PTB-STM-5).
- Initial sort: the first sample column, desc. No pagination, no column toggle. Filter and copy/download standard.
- Clicking a row highlights it (selected row) and sets the reference.
- DO496 `[B]`: SBS5 36%, SBS13 34%, SBS2 27%, SBS1 2%, SBS25 <1% …

---

## 5. Files & Links and resource tabs

**PTB-RS-1 Resource sources.** `/studies/{id}/resource-definitions`, then data per definition `resourceType`:
- `STUDY`: study resource data.
- `PATIENT`: this patient.
- `SAMPLE`: each sample in view.

(PVS:1793-1909)

**PTB-RS-2 Files & Links tab** (title "Files & Links"; `ResourcesTab.tsx`). Sections in order, each only when non-empty:
1. "Patient Resources for <patientId>"
2. "Sample Resources" — sample table, sample rows with ≥1 resource
3. "Study Resources for <study name>"
4. Fallback "Resources for <patientId>" when nothing has data.

**PTB-RS-3 Resource table** (`ResourceTable.tsx`). Columns:
- [Sample ID] — sample table only.
- Resource — header is the single displayName when all rows share one, else "Resource". The cell is a link with a person icon, "Open in Patient View" → PTB-RS-5.
- Resource URL — "Open in new window", new tab.
- Description — only if any row has one.
- Empty table: "There are no resources for this sample."
- The Resource column sorts by `priority` as a **string** (legacy bug: "10" < "2").

**PTB-RS-4 Default-open tabs.** Definitions with `openByDefault=true` open their own tab on load (PVS:1797-1805).
- Seen `[B]`: Chromoscope (pancan_pcawg_2020), Slide Microscopy (TCGA PanCan IDC_SLIM).
- Most public definitions are openByDefault.

**PTB-RS-5 Open resource.** Marks the tab open, navigates to `openResource_<id>`, and sets `URL: resourceUrl=<url>` (`PatientViewPage.tsx:506-517`).
- A deep link to `openResource_<id>` re-opens that tab on load (:198-205).

**PTB-RS-6 Resource tab** (`shared/components/resources/ResourceTab.tsx`):
- Header "<displayName>" + "<sampleId|patientId> | <description> | i of N".
- Iframe height = window − 275.
- Chevron ‹ › carousel when N>1. It moves `resourceUrl` and is inactive at the ends.
- `.pdf` is wrapped in the Google Docs viewer.
- Instance URL transformers may rewrite the URL.
- http URL on an https portal → "We can't show this URL in the portal. Please use the link below:" + link.
- If the resource config has `iframeErrorMessage`: a no-cors HEAD probe runs (spinner meanwhile). On failure, a warning banner with [Refresh Page].
- Closing the tab (×) hides it. If it was active, the view navigates to Files & Links (:519-534).
- Open state is *(local)*.

**PTB-PR — Pathology Report** (`pathologyReport/PathologyReport.tsx`, PVS:1911-1956):
- Probes `raw.githubusercontent.com/inodb/datahub/a0d36d7…/tcga/pathology_reports/symlink_by_patient/<patientId>.<i>` for i=0,1,2,… until one 404s.
- Each hit yields PDF `github.com/…/pathology_reports/<name>`.
- A `<select>` of PDF names is shown only when >1 PDF.
- Iframe = Google Docs viewer of the selected PDF, height window − 220.

**PTB-TI — Tissue Image:**
- Iframe `digital_slide_archive_iframe_url + "#!/CDSA/byPatientID/<patientId>"`, height window − 220 (`shared/api/urls.ts:310-320`).
- The MSK variant (#8) iframes the whole-slide-viewer URL and stays mounted when hidden `[C]`.

**PTB-TM — Matched Trials** `[C]` (`trialMatch/TrialMatchTable.tsx`):
- Data: `POST api/matchminer/api/post_trial_match {mrn: patientId}` → nct/protocol ids → `POST …/trials`; grouped by trial.
- Intro: "Curated genomic and clinical criteria from open clinical trials at Memorial Sloan Kettering. Please contact us or submit feedback form…"
- Table columns: Title · Matching Criteria · Status (+ [Feedback] per trial). No copy/download.
- Footer: "Powered by OncoKB".
- Negative criteria text:
  - "Negative for <G p1, p2>"
  - "Negative for alterations in <genes | N genes>"
  - Wildtype: "Tumor doesn't have <genes> defined by the trial"
- Feedback modals: "OncoKB Matched Trials General Feedback" / "OncoKB Matched Trial Feedback".

**PTB-CT — Custom tabs** `[C]`: configured title. Content is rendered by server-config JS on mount (`showCustomTab`); `unmountOnHide` comes from config.

---

## 6. mRNA (Beta!) and Plots (Beta!) — feature-flagged, all `[C]`

The public site does not enable these tabs, so this section is from code only.

**PTB-MR-1 Profile:** the first `MRNA_EXPRESSION` profile, preferring `showProfileInAnalysisTab` and non-z-score, then any non-z-score, then `[0]`. z-score = datatype letters contain "ZSCORE" (PS:972-1000).

**PTB-MR-2 Title:** "<profile.name> - <cohortName>". `cohortName` is the study name, or the filter values joined with " or ", even across AND-ed attributes (legacy bug) (`MrnaTabContent.tsx:1905-1936`).

**PTB-MR-3 States:**
- Spinner while loading.
- "No mRNA expression data is available for this patient's sample(s)." when no non-NaN value.

**PTB-MR-4 Reference cohort radios** ("Reference cohort • N sample(s)"):
- Options: All samples `[default]` / Same cancer type (<types " or ">) / Same cancer type detailed.
- A type radio is hidden when the patient lacks that value.
- Types come from **all patient samples even in sample mode**.
- Selecting a radio replaces all cohort filters.

**PTB-MR-5 Expression table:**
- Columns: [+ / ✓] · Gene (bold, OncoKB tooltip) · Labels (chips) · one "Sample <label>" column per sample with data.
- Values `toFixed(2)`, "—" when missing. "Search genes" does a substring filter.
- At most 50 rows. Footer "Showing X genes of Y with mRNA data." (+ " Filter/sort to explore.").
- Footnote for samples with no data.
- Rows = genes with data, OncoKB curated genes only (`oncoGenesOnly` default true, **no UI toggle**).
- Default sort: first sample column desc by **signed** value. The intent was |value| (legacy bug). Missing values go last.
- ✓ on a gene that was added via a group adds it again instead of removing it (legacy bug).

**PTB-MR-6 Gene groups:**
- Static chips: MSK-T (10 genes), FDA (26), MSK (60), TRIAL (179) ADC-target lists.
- Dynamic chips: MUT, SV (both partners), CNA.
- "+ Add gene sets to plot" popover toggles `group:<id>` tokens. It is hidden when no labels are present.

**PTB-MR-7 Chart:**
- Default empty, with placeholder 'Use the "Add to plot" button…' (the button is actually titled "Add to chart"; legacy text mismatch).
- At most the first **50** genes are drawn, with a warning above that.
- Checkboxes: ☑ Log scale (disabled "Linear only — data contains non-positive values" unless renderable) · ☐ Swap axes · ☐ Violin.
- Cohort points: grey, opacity 0.25, deterministic jitter ±0.18.
- Highlighted samples drawn as numbered bubbles: the focused sample in sample mode, all samples in patient mode.
- Bubble tooltip: "<G> expression: v", "z = ±|z| (Pth percentile in cohort)", plus that sample's alterations in G.
- SVG download `mrna_expression_<slug>` (SHOW_ALL only).

**PTB-MR-8 Dead UI** (mounted but unreachable — do not port as required):
- Co-expression dialog
- Outlier-gene dialog
- Reference Cohort Builder modal

**PTB-MR-9 Persistence:**
- localStorage `patientView.mrnaTab.settings` = `{logScale, violin, swapAxes, oncoGenesOnly, referenceCohortMode}`.
- Gene selection, sort, search and custom filters are *(local)*.

**PTB-PL-1** Uses the shared Plots tab (see `04-plots.md`). Differences:
- `hasNoQueriedGenes`: gene pickers are async search, no default gene.
- No OQL or alteration-filter banners.
- Highlighted = **all patient samples even in sample mode**, labelled `index+1`.

**PTB-PL-2 "Reference Cohort:" select:**

| Option | Notes |
|---|---|
| Samples In Cohort Nav: N | default when `navCaseIds` exist |
| Study: <name> | default otherwise |
| Cancer Type: … | patient types not de-duplicated, so cohort samples are duplicated (legacy bug); shown even with an empty type (legacy bug) |
| Cancer Type Detailed: … | same as Cancer Type |

- `URL: plots_horz_selection, plots_vert_selection, plots_coloring_selection`.
- Cohort choice is *(local)*.

---

## 7. Modes and conditions (each must be checked)

| ID | Condition | Expected behavior |
|---|---|---|
| PTB-MD-1 | Sample mode (`sampleId=`) | Only that sample is in view. Genomic Evolution is hidden for a single sample `[B]`. Signatures and resources are restricted to that sample. mRNA and Plots cancer types still use all patient samples |
| PTB-MD-2 | Single-sample patient | No Genomic Evolution. Signature sample select hidden. Samples table has one column |
| PTB-MD-3 | Multi-sample, no alt/ref counts | No Genomic Evolution |
| PTB-MD-4 | Sample lacking a collection-day event | Sequential mode forced and its checkbox hidden |
| PTB-MD-5 | Unprofiled samples | Alert in Genomic Evolution and Pathways. Heatmap NA cells. VAF points dropped (PTB-STM-1) |
| PTB-MD-6 | Signature contribution only (no counts) | No %/# switch, slider, summary line or spectrum/reference plot; table only. Sample select defaults to *undefined* (shown empty) (legacy bug, PVS:1697-1708) |
| PTB-MD-7 | No pvalue profile (all public studies) | Confidence = 0, so nothing is bold (PTB-STM-5) |
| PTB-MD-8 | v2/v3 versions | Version select lists them; no COSMIC reference (reference JSON keyed by SBS/DBS/ID) |
| PTB-MD-9 | TCGA study / patient | Pathology Report (if PDFs) and Tissue Image (if DSA has slides) |
| PTB-MD-10 | Study with resources | Default-open resource tabs. Files & Links (code) |
| PTB-MD-11 | `skin_hide_download_controls` ≠ SHOW_ALL | VAF/heatmap/signature downloads and table copy/download hidden. PathwayMapper table hides them only on HIDE_ALL |
| PTB-MD-12 | Logged out / no MatchMiner | No Matched Trials tab |

---

## 8. Persistence summary

**URL**
- Path segment = active tab id (`openResource_<id>` for resource tabs).
- `resourceUrl`
- `genomicEvolutionSettings` JSON: `showTimeline`, `clusterHeatmap`, `transposeHeatmap`, `showMutationLabelsInHeatmap`, `showOnlySelectedMutationsInTable`.
  - `logScaleChart`, `yAxisDataRangeInChart` and `showOnlySelectedMutationsInChart` are declared but never written or read by the chart (legacy dead keys).
- `plots_horz_selection`, `plots_vert_selection`, `plots_coloring_selection`, `geneset_list`, `generic_assay_groups`

**localStorage**
- `patient_view_mutations_tab__vaf_plot_choice`
- `patientView.mrnaTab.settings`
- `trialmatch` (gate)
- OncoKB icon style (shared)

**Not persisted**
- VAF group-by / sequential / log / data range / only-selected
- Heatmap zoom
- Mutation selection
- Signature version, sample, scale, slider and selected reference
- Pathway selection and TCGA-only checkbox
- Open/closed resource tabs (beyond defaults)
- Pathology PDF choice
- Plots cohort

---

## 9. Statistics & methods `[C]`

**PTB-STM-1 VAF line data** (`timeline/VAFChartUtils.ts:46-229`):
- Per mutation (and per group), points per sample:
  - called with integer alt+ref → `y = alt/(alt+ref)`
  - uncalled with alt>0 → y = VAF
  - uncalled with alt≤0 → no point
  - mutated without counts → y undefined
  - other samples: profiled for the gene → y=0 ("not detected"); else y undefined (not profiled)
- Points are sorted by sample order. Leading and trailing points are **trimmed until the first and last real-VAF point**. A y=0 "not detected" end point is therefore also dropped (legacy behaviour: a mutation lost in later samples does not drop to 0).
- Interior undefined points are removed, so the line joins neighbours directly. They are "interpolated" with `(i−l)/(r−l)·(y_l+y_r)`, which is wrong except at the midpoint (legacy bug), but the result is never drawn.
- Mutations with no remaining points are skipped.

**PTB-STM-2 VAF y-axis** (`VAFChartWrapper.tsx:105-160`, `VAFChartUtils.ts:231-372`):
- Range [0,1], or with data range on, `[floor10(min, −(lz(min)+1)), ceil10(max, −(lz(max)+1))]`. Here lz = leading decimal zeros, 0 when the value is ≥0.1 or 0.
- 6 equally spaced ticks. Labels use the minimal decimals (≤3) that keep them distinct, else exponential. Duplicate labels collapse the ticks.
- Log scale: `log10(max(0.001, y))` mapped linearly between the log-clamped min and max ticks. Tick labels stay linear values.
- 10 px padding top and bottom on a 200 px data height.
- `[B]` log + data range on P04 gives ticks 0.1, 0.3, 0.5, 0.6, 0.8, 1.0.

**PTB-STM-3 Heatmap clustering:** same algorithm as `01-oncoprint.md` ST-M9 (average linkage, 1 − Spearman, cases and tracks) over the VAF `profile_data`. null = profiled not mutated or no VAF; NA = unprofiled.

**PTB-STM-4 Signature contribution %** (`shared/lib/FormatUtils.tsx:132-145`):
- The value is the stored contribution fraction (no renormalisation in the frontend).
- Display: NaN → `NA`; `100·v < 1` → `<1%`; else `toFixed(100·v, 0)` + `%`.
- Sort uses the raw value.
- A sample missing a signature row gets `value 0, confidence 1` (`MutationalSignatureBarChartUtils.ts:589-598`).

**PTB-STM-5 Signature significance** (`MSU:22`, `ClinicalInformationMutationalSignatureTable.tsx:135`):
- Bold iff `confidence` (from the `pvalue` profile) is **truthy and < 0.05**.
- p = 0 exactly is not bolded (legacy bug).
- Without a pvalue profile confidence is 0, so nothing is bold.
- The same threshold drives "significant signatures" in the Summary header (`getSignificantMutationalSignatures`: same sample, p<0.05, sorted by contribution desc; see 40-patient-summary).

**PTB-STM-6 Spectrum values** (`MutationalSignatureBarChartUtils.ts:391-410`):
- `#` = raw count per channel for the selected sample.
- `%` = `round(count / Σ counts of that sample & version · 100)`, 0 when the sum is 0. Rounded integers, so they may not sum to 100.
- The container also stamps `percentage` using the sum over **all samples** of the version (`MutationalSignaturesContainer.tsx:271-291`). This feeds tooltips in `#` mode, so a multi-sample tooltip % is wrong (legacy bug).
- Summary count N = Σ counts of the selected sample for the version.

**PTB-STM-7 Spectrum y-domain** (`MutationalSignatureBarChart.tsx:95-153`):
- Slider s ∈ [1,100]. Effective s' = 80 if 80<s<100, 1 if s≤1, else `ceil(s/20)·20`.
- `%` mode domain: `[0, s']`.
- `#` mode domain: `[0, ceil(max·s'/100/10)·10]` (`[0,10]` if max=0). The top tick is shown as `>=N`.
- Reference domain: `%` → `[−ceil(s/10)·10, 0]`; `#` → `[−100, 0]` (does not follow the slider).

**PTB-STM-8 COSMIC reference:** bar = `−frequency·100` (%) for the channel from COSMIC v3.3 GRCh37. Signature key = text before the first space of the meta NAME.

**PTB-STM-9 Store quirks:**
- `numberOfMutationsForSample` = total mutation rows for the patient, not per sample (PVS:1432; unused in the UI).
- The version-pair validator expects contribution + pvalue pairs (`MSU:150-182`), but nothing enforces it.

**PTB-STM-10 Pathway score in patient mode** (`PM react-pathway-mapper.tsx:332-357, 402-457`):
- Ranking mode is fixed to **match count**: score = number of input genes (PTB-PW-2) that are GENE nodes in the pathway.
- Every input gene counts as 100% altered.
- Display: "Yes" iff score>0, sorted by score desc.
- The TCGA-only checkbox restricts the candidate pathways.

**PTB-STM-11 Clinical numbers:** patient-table non-integer numerics use `toFixed(1)` (`< 0.1` if it rounds to 0). Sample-table and timeline values are raw strings.

**PTB-STM-12 mRNA tab** (`MrnaTabContent.tsx`):
- **Cohort:** sample-level; all study samples, or `/filtered-samples` for the reference cohort. The patient's own samples are included. "N samples" counts cohort samples, not profiled ones.
- **Box:** R type-7 quantiles on raw values. Tukey whiskers = most extreme values within 1.5·IQR. In log mode values are clamped to `logFloor`.
- **Log:**
  - Allowed iff all values ≥0 and ≥2 values >0 (across plotted genes).
  - No pseudocount: values are clamped to the minimum positive value (`logFloor`, default 1), then `log10`.
  - Padding: `max(0.05·decades, 0.02)` in log mode, 5% of the span in linear mode.
- **Transform for z and percentile:** `t = log10(max(v, floor))` when log is on, else v. So z and percentile change with the toggle (legacy quirk).
- **Robust z:**
  - `0.6745·(t−median)/MAD` (type-7 median; MAD = median |t−median|).
  - MAD=0 → denominator 1e−9 (legacy bug).
  - Not shown with fewer than 5 finite cohort values.
- **Percentile:** fraction of cohort values ≤ t (inclusive, own value included), shown as `round(100p)` + "th". This gives "1th"/"22th" (legacy bug).
- **Violin:** Gaussian KDE, Silverman bandwidth `0.9·min(sd, IQR/1.34)·n^−1/5`, 48-point grid over `[min−3h, max+3h]`. Needs ≥5 values. Subsamples above 1500 values.
- **Number formats:**
  - value: ≥100 → 0 decimals, ≥10 → 1, else 2
  - z: 2 decimals
  - axis: ≥1000 → `k`; log ticks 1-2-5 per decade when ≤2 decades, else powers of 10
