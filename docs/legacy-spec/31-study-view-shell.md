# Legacy parity spec — Study View › page shell and non-Summary tabs

Source of truth: cbioportal.org (checked 2026-11-10, logged out) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Each line is one checkable requirement with an ID. Defaults are `[default]`. `URL:` = query/hash param that persists the
state; *(local)* = component state, lost on reload.
**Tag key:** `[B]` = seen in the browser only, `[C]` = code-derived only. Untagged = confirmed both ways.
Logged-in features (saving groups/charts/VS, layout) are `[C]`. Production ran a newer build than cd8c6df for resource
tabs (§10.5) — those lines are `[B]`.
**Out of scope here:** individual chart types, chart headers, chart-level filters and per-chart "Compare" icons →
`30-study-summary.md`. Global driver-annotation menu → `01-oncoprint.md` RV-2. Plots tab internals → `04-plots.md`.

Reference URLs:
- `/study/summary?id=coadread_tcga_pan_can_atlas_2018` (594 patients / 594 samples; CN Segments; 2 resource tabs)
- `/study/summary?id=lgg_ucsf_2014` (23 patients / 61 samples; no CN Segments, no resources)
- `/study/summary?id=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018` (Combined Study, 1,678 / 1,678)
- `/study/summary?id=coadread_tcga_pan_can_atlas_2018&filterAttributeId=SEX&filterValues=Female` (280 samples)
- `/study/summary?id=coadread_tcga_pan_can_atlas_2018&filterAttributeId=AGE&filterValues=50-60` (106 samples)
- `/study/summary?id=…#filterJson={"clinicalDataFilters":[{"attributeId":"SEX","values":[{"value":"Nonexistent"}]}]}` (0 samples)

Key files (paths relative to `src/pages/studyView/` unless prefixed):
`StudyViewPage.tsx`, `StudyViewPageStore.ts` (13k lines; "Store" below), `StudyViewURLWrapper.ts`, `StudyViewQueryExtractor.ts`,
`StudyViewPageTabs.ts`, `UserSelections.tsx`, `studyPageHeader/{StudyPageHeader,ActionButtons}.tsx`,
`studyPageHeader/{studySummary/StudySummary,rightPanel/RightPanel}.tsx`, `virtualStudy/{VirtualStudy,VirtualStudyModal}.tsx`,
`addChartButton/{AddChartButton,SaveChartSettingsButton}.tsx`, `addChartButton/addChartByType/AddChartByType.tsx`,
`addChartButton/customCaseSelection/*`, `addChartButton/geneLevelSelection/GeneLevelSelection.tsx`,
`menu/{StudyViewPageSettingsMenu,AutosubmitToggle}.tsx`, `tabs/{ClinicalDataTab,CNSegments,SummaryTab,EmbeddingsTab}.tsx`,
`resources/{ResourcesTab,FilesAndLinks}.tsx`, `StudyViewPlotsTabWrapper.tsx`,
`src/pages/groupComparison/comparisonGroupManager/*`, `src/shared/components/PillTag/PillTag.tsx`.

---

## 1. Routing and URL parameters

**STV-URL-1 Path.** `/study/<tab>`; `<tab>` ∈ `summary` `[default]`, `clinicalData`, `heatmaps`, `cnSegments`,
`filesAndLinks`, `plots`, `embeddings`, `openResource_<resourceId>` (`StudyViewPageTabs.ts`, `StudyViewURLWrapper.ts:61-70`).
Old `/study?id=…` is rewritten to `/study/summary?id=…` on mount (`StudyViewPage.tsx:290`).

**STV-URL-2 Query/hash params** (`StudyViewPage.tsx:218-262`, `StudyViewQueryExtractor.ts`):

| Param | Where | Effect |
|---|---|---|
| `id` / `studyId` / `cancer_study_id` | query | Comma list of physical or virtual study IDs. Precedence `studyId` ?? `cancer_study_id` ?? `id`. Trimmed, split on `,`. |
| `filters` | query | Legacy alias of `filterJson`. |
| `filterJson` | hash (`#filterJson=`) or query `filters`, or `window.postData.filterJson` (POST, wins over both) | URI-decoded JSON `StudyViewFilter`, applied once on load. If the string contains `patientIdentifiers` it is a `{patientIdentifiers:[{studyId,patientId}]}` filter, converted to `sampleIdentifiers` = all samples of those patients in `<study>_all` lists. Invalid JSON → console error, ignored. `ensureBackwardCompatibilityOfFilters` upgrades old shapes. |
| `filterAttributeId` + `filterValues` | query | Only if no `filterJson`. Attribute matched case-insensitively across queried studies. NUMBER: values `a-b,c-d` → bins `{start:a,end:b}`; STRING: split on `,` (`\,` escapes a comma), trimmed. Unknown attribute → red banner "The clinical attribute FOO is not available for this study" and no filter. |
| `sharedGroups` | hash | Comma list of group IDs; loads them and **opens the Groups menu** (STV-GR). |
| `sharedCustomData` | hash | Comma list of custom-data IDs; opens Charts menu on the Custom Data tab. |
| `tab` | — | Declared but tab comes from the path. |
| `resourceUrl` | query | Which datum a resource tab shows (§10.5). |
| `plots_horz_selection`, `plots_vert_selection`, `plots_coloring_selection` | query | Plots tab (see 04-plots). |
| `embeddings_coloring_selection` | query | Similarity Maps tab. |
| `geneset_list` (session prop), `generic_assay_groups` | query | Plots-tab helpers. |

- **STV-URL-3** Active filters are **not** written to the URL as the user filters; they persist only via the bookmark link (STV-BM). [C]
- **STV-URL-4** Client-side navigation to a different `id` re-runs the URL extraction (`componentDidUpdate`, `StudyViewPage.tsx:265-289`).
- **STV-URL-5** Patient-view link from "View selected cases" (STV-AB-2) and query submission use `localStorage['legacyStudySubmission']` + `window.open` (`StudyViewUtils.tsx:2838`). Too large → clears localStorage and retries, then `alert('Sorry, the query is too large to submit')`. [C]

---

## 2. Header (`StudyPageHeader.tsx`, `StudySummary.tsx`)

**STV-HD-1 Status banners** (top of header, one `alert-<status>` per message):
- "Unknown/Unauthorized study: X" / "…studies: X, Y" (danger) when some, but not all, IDs are invalid (`Store:6652`).
- "The clinical attribute X is not available for this study" (danger).

**STV-HD-2 Title (h3).**
- One displayed study → its name; else **"Combined Study"**.
- A single virtual study (no physical) → the VS name and description (`displayedStudies`, `Store:6566`).
- Mixed reference genomes → warning icon after the name (`mixedReferenceGenomeWarning`). [C]
- Download icon ⤓ after the title, tooltip "Download all clinical and genomic data of this study", links
  `getStudyDownloadUrl(studies[0])`. Shown iff (study ID is in the server's download list — single study only — OR
  `feature_study_export`) AND `skin_hide_download_controls = SHOW_ALL` (`StudySummary.tsx` `showDownload`).

**STV-HD-3 Description.**
- Single study: first line of `description` (HTML, split on `\n+`) + " PubMed" link (`/pubmed/<pmid>`, new tab) when pmid exists.
- Multi: "This combined study contains samples from N studies".
- ⊕/⊖ toggle *(local, default collapsed)* shown iff: description has >1 line, or >1 study, or single VS.
- Expanded: single → remaining lines (`white-space: pre`); multi → list of study names linking to each `/study?id=`.
- Single VS → "This virtual study was derived from:" + one collapsible panel per origin study (name, ⊕ description, ↗ link); origin VS fetched from session service. [C]
- No citation block and no sample/patient counts in the header; counts live in STV-AB-1.

**STV-HD-4 Right panel: gene query box** (`RightPanel.tsx`):
- `OQLTextArea` in study-view mode, placeholder "Click gene symbols below or enter here". Clicking gene symbols in charts appends to it (see 30).
- [🔍 Query] button. Disabled when: box empty, OQL syntax error, unrecognised genes (suggestions pending), or `oqlSubmitError`.
- `oqlSubmitError` messages, in order:
  - Single physical study only: "Mutation data query specified in OQL, but no mutation profile is available for the selected study." (same for CNA "…in the selected study.", mRNA, "Protein level…").
  - >1 displayed study and OQL has EXP: "Expression filtering in the gene list (the EXP command) is not supported when doing cross cancer queries." (PROT analog).
  - `genes × selectedSamples > query_product_limit` (default 1,000,000): "Please limit your queries to ⌊limit / selectedSamples⌋ genes or fewer."
- Submit behavior → STV-STM-6.

---

## 3. Filter bar (`UserSelections.tsx`)

Shown only when ≥1 filter component exists. Layout: groups of `Name : pill(s)` with logic words, then [Clear All Filters], optional [Submit ►], then 🔗 bookmark icon.

**STV-FB-1 Pill anatomy** (`PillTag.tsx`): coloured box (`STUDY_VIEW_CONFIG.colors.theme.clinicalFilterContent` blue unless noted), text colour black/white by contrast, ⓧ delete icon (`data-test=pill-tag-delete`), optional info icon. Pending pill (manual mode) = dashed/"pending" style; pending delete = struck style. [C styles]

**STV-FB-2 Grouping words** (`GroupLogic.tsx`): items joined with the operation word; `( … )` when `group=true`.

**STV-FB-3 Pill types and order** (order is the push order in `allComponents`, `UserSelections.tsx:132-673`):

| # | Filter | Label | Pill content | Join | Delete |
|---|---|---|---|---|---|
| 1 | Custom selection | "Custom Selection" | "N sample(s)" | — | removes CUSTOM_SELECT set |
| 2 | Group filter (from Groups › Filter) | `A and B` / `A and N other groups` | `caseCounts(samples, patients)` e.g. "12 samples/10 patients" | — | removes group filter |
| 3 | Clinical categorical | chart display name | each value | `or` | removes that value |
| 3 | Clinical numeric | chart display name | interval (STV-FB-4), **editable** | — | removes filter |
| 4 | Custom-data chart | chart name | values / interval | `or` | — |
| 5 | Genomic (gene-specific) | chart name | CNA values mapped via `getCNAByAlteration`, or interval | `or` | — |
| 5b | Genomic filter with no chart (mRNA violin drag) | `GENE (profileType)` | interval | — | clears violin selection |
| 6 | Variant annotations (namespace) | chart name | values, `_`→space | inner `or`, outer `and` | per value |
| 7 | Mutation-type chart | chart name | values `_`→space | `:`/`and` | per value |
| 8 | Pre-defined custom charts (e.g. Cancer Studies) | chart name | values | `or` | per value |
| 9 | Gene tables (Mutated/CNA/SV genes) | — | gene symbol, info icon with OQL; colour: mutated = MUT_COLOR_MISSENSE green, SV = STRUCTURAL_VARIANT_COLOR purple, CNA single alteration = AMP red / HOMDEL blue, else DEFAULT_NA_COLOR grey | inner `or`, outer `and` | per gene (removes that OQL) |
| 10 | SV (fusion) table | — | `GENE1::GENE2` | `or` / `and` | per pair |
| 11 | Genomic profile sample counts ("Data Types") | — | profile name | `or` / `and` | per profile |
| 12 | Case lists | — | case-list name | `or` / `and` | per list |
| 13 | Generic-assay frequency-table selections | chart name | row display names | `or` / `and` | per row |
| 14 | Generic-assay numeric | chart name (or fallback name) | interval, editable | — | clears |
| 15 | Clinical event type counts | chart name | event types | `or` / `and` | per type |
| 16–21 | Treatments: sample, patient, "Group Treatement per Sample" (legacy typo), "Group Treatment per Patient", "Target Treatment per Sample", "Target Treatment per Patient" | — | `treatment[ time]` (time = Pre/Post for sample-level) | `or` in `( )`, groups `and` | per pill |

- **STV-FB-3a** Survival attribute filters resolve to the KM chart's meta for the label. [C]
- **STV-FB-3b** Scatter (X vs Y) rectangle and pie/bar chart selections that produce sample-ID sets feed STV-STM-1 but have **no pill** other than the chart's own (see 30). [C]

**STV-FB-4 Numeric interval text** (`intervalFiltersDisplayValue`, `StudyViewUtils.tsx:1741-1890`):
- Contiguous bins merge to one interval: start = first bin start, end = last bin end.
- Both open: "All Numbers"; only end: "≤ end"; only start: "≥ start" if first bin is a point bin else "> start";
  start = end: "v"; first bin is a point bin: "a ≤ x ≤ b"; else "a < x ≤ b". Non-numeric bins (e.g. NA) appended ", NA".
- Start/end are inline editable (numeric only, empty not allowed). Typing a start > end swaps them; start = end is rejected.
  Edits create custom bins and an interval filter.
- Seen: `filterValues=50-60` → "Diagnosis Age : 50 < x ≤ 60"; `SEX=Female` → "Sex : Female".

**STV-FB-5 Clear All Filters** (`Store.clearAllFilters:3319`): clears every filter type, custom selection, group filter,
scatter custom bins, treatment and clinical-event filters, both pill stores. In manual mode also submits immediately.

**STV-FB-6 Submit ►** (`data-test=submit-study-filters`, marching-ants style): shown iff tab = Summary AND manual mode AND ≥1 pending pill. Applies all queued adds/deletes.

**STV-FB-7 Bookmark 🔗** (tooltip "Get bookmark link for this filter") → STV-BM.

---

## 4. Selection summary and action buttons (toolbar right of the tabs)

Toolbar order (seen): `Selected: N patients | N samples` · [👤][🔖][⤓] · [Custom Selection ▾] · [Charts ▾ / Columns ▾] · [Groups ▾] · [⚙]. "Alteration Filter ▾" sits between Custom Selection and Charts when enabled.

**STV-AB-1 Selected info** (`StudyResultsSummary`, `StudyViewPage.tsx:95-118`):
- "**Selected:** " prefix only when `chartsAreFiltered`. Then "**N** patients | **M** samples", `toLocaleString` (e.g. "1,678").
- While `selectedSamples` pending → small spinner instead of the text; buttons still shown.
- Seen: coadread "594 patients | 594 samples"; lgg "23 patients | 61 samples"; empty "Selected: 0 patients | 0 samples".

**STV-AB-2 [👤] View selected cases** (tooltip "View selected cases"): disabled if 0 patients. Opens patient view of the first selected patient in a new window with `navCaseIds` = all selected patients (prev/next navigation). URL > 4,500 chars → opens bare URL and passes `navCaseIds` via `window.clientPostedData` (`ActionButtons.tsx:76-108`).

**STV-AB-3 [🔖] Virtual study** (tooltip "Share Virtual Study", logged in "Save/Share Virtual Study"): disabled while VS list, selected samples, profile names or case-list names pending → opens STV-VS.

**STV-AB-4 [⤓] Download clinical data** (tooltip "Download clinical data for the selected cases"; after failure "An error occurred while downloading the data. Please try again."):
- Shown iff `skin_hide_download_controls = SHOW_ALL`. Disabled until all chart data promises complete. Spinner icon while downloading.
- File `<prefix>clinical_data.tsv`; prefix `<studyId>_` (one study) or `combined_study_` (>1). Format → STV-STM-5.

**STV-AB-5 [⚙] Settings gear** (`data-test=study-view-settings-menu`), popover "Submitting filters ⓘ" (tooltip "Disabling autosubmit is a beta feature still under evaluation"):
- ◉ Autosubmit `[default]` / ○ Manually submit. Stored in `localStorage['study_view_filter_autosubmit']` (`'true'` = manual).
- Switching to Autosubmit with pending pills submits them.
- Manual mode: chart selections queue as pending pills until [Submit ►]; deleting a submitted pill queues a delete; deleting a queued pill drops it immediately (`PillTag.handleDelete`).

**STV-AB-6 [Alteration Filter ▾]** (`data-test=AlterationFilterButton`): only if server `skin_show_settings_menu` (hidden on cbioportal.org `[B]`). Opens the shared SettingsMenu (driver annotations, tiers, germline/somatic etc., see 01 RV-2) with an info header about which tables it affects (CNA table included iff CNA profile data). Results feed `filters.alterationFilter` (STV-STM-1). [C]

---

## 5. Custom Selection (`CustomCaseSelection.tsx`, `disableGrouping=true`)

Button "Custom Selection ▾" (`data-test=custom-selection-button`), shown on Summary, Clinical Data, CN Segments, Files & Links, Plots, Similarity Maps tabs. Popover 350 px.

- **STV-CS-1** Radios: ◉ By sample ID `[default]` / ○ By patient ID.
- **STV-CS-2** Links "↓ currently selected" / "↓ currently unselected": fill the box with selected (or all-minus-selected) sample IDs, or their patient IDs (deduped); prefixed `study:` when >1 queried study. Patient mode: a partially selected patient appears in both lists. [C]
- **STV-CS-3** Textarea (`data-test=CustomCaseSetInput`), rows 5. Placeholder lists examples "with newline / with comma / with space" using `sample_id1` (or `study_id:sample_id1` multi-study).
- **STV-CS-4** Input normalizer: split on commas/spaces, trim, drop empties, one ID per line. Re-validated 500 ms after typing.
- **STV-CS-5** Warning "⚠ Submitting will clear current filters."
- **STV-CS-6** Submit button "Filter to listed samples" / "Filter to listed patients" (`data-test=CustomCaseSetSubmitButton`); disabled when there are errors or 0 valid IDs.
- **STV-CS-7** Validation messages (`validateLines`, `CustomCaseSelectionUtils.tsx:108`):
  - Error "Incorrect study id: X" when a `study:` prefix is not queried.
  - Warning "The following case(s) is/are invalid and will be ignored. …".
  - Multi-study, unprefixed ID found in >1 study: warning "The sample ID's below belong to multiple studies. All of them in the different studies will be selected…".
  - Exact duplicate lines silently de-duplicated.
- **STV-CS-8** On submit: `clearAllFilters()`, then sample-ID filter `CUSTOM_SELECT` = the listed samples (patient mode → all samples of each patient). Pill "Custom Selection : N samples" (STV-FB-3 #1).
- **STV-CS-9** ID parsing: `study:case` split on the first `:` only; IDs that themselves contain `:` cannot be entered. [C]

---

## 6. Charts / Columns menu (`AddChartButton.tsx`)

Button text "Charts ▾" on Summary, "Columns ▾" on Clinical Data; absent on other tabs. Popover `bottomRight`, min width 400 px. Won't open while profile options are loading. Opens automatically on the Custom Data tab when `sharedCustomData` is in the URL.

**STV-AC-1 Top row:** [📌 Save settings] (session service on) — see STV-LP-2.

**STV-AC-2 Tabs** (each hidden when empty; seen coadread: Clinical · Genomic · Gene Specific · Custom Data · X vs Y **Beta!** · Arm-level CNA · Genetic Ancestry · Methylation; multi-study adds Phosphosite Quantification):

| Tab | Shown when | Content |
|---|---|---|
| Clinical `[default]` | always | AddChartByType list of clinical attributes (incl. Cancer Studies, Case Lists, survival-derived options on Clinical Data only) |
| Genomic | ≥1 option; on Clinical Data only bar/pie-type options | Mutated Genes, CNA Genes, Structural Variant Genes, Data Types, Fraction Genome Altered, Mutation Count, Mutation Count vs FGA … |
| Gene Specific | not on Clinical Data; ≥1 profile of type mRNA/protein/methylation/CNA/mutation | GeneLevelSelection (STV-AC-5) + list of already-added gene charts |
| Custom Data | not on Clinical Data | STV-AC-6 |
| Variant Annotations | not on Clinical Data; ≥1 namespace attribute | list |
| X vs Y **Beta!** | always (also on Clinical Data) | STV-AC-7 |
| one tab per generic-assay type (label from type) | not on Clinical Data; GA profiles exist | STV-AC-8 |
| [↶ Reset charts] (button, not a tab) | logged in AND Summary AND current ≠ default layout | opens STV-LP-4 |

**STV-AC-3 AddChartByType list** (`AddChartByType.tsx`):
- Header: [Select all (N)] (N = rows after search; hidden when all selected) [Deselect all] (hidden when none) · search box (substring, case-insensitive, autofocus).
- Columns: checkbox + name (ellipsis tooltip) | **Freq** (header tooltip "% samples with data") | optional share/delete column.
- Sort: freq desc, then name asc; while freq loading: name asc + "Calculating data availability..." spinner.
- Row disabled (greyed, not checkable) when freq = 0, or attribute not valid for the tab (e.g. survival attributes on Summary).
- Height: 15 rows max (25 px each).
- Toggle: checked → chart added (Summary) / column added + chart added (Clinical Data); unchecked → chart removed **and its filter reset**.
- Info banner (green, 10 s): Summary "X added as a Pie Chart" / "X Pie Chart is removed"; Clinical Data "X added to table and as Pie Chart in Summary tab" / "X column is removed"; bulk "N charts added", "N columns added to table and N charts added in Summary tab".
- Freq numbers → STV-STM-3.

**STV-AC-4 Seen frequencies** (coadread): Clinical 100.0% … 99.7%; Genomic: Data Types 100.0%, CNA Genes 99.7%, FGA 98.1%, Mutated Genes 89.9%, Mutation Count 89.9%, SV Genes 89.9%.

**STV-AC-5 Gene Specific** (`GeneLevelSelection.tsx`):
- Profile select: "<profile name> (N samples)"; N = filtered samples profiled (STV-STM-4). Seen "mRNA expression z-scores relative to normal samples (log RNA Seq V2 RSEM) (592 samples)".
- Sub-select for mutation profiles: Mutated vs Mutation Type.
- Gene-set select `[default "User-defined List"]`, plus server gene sets "<id> (N genes)" and "ADC targets (N genes)".
- Gene box "Enter gene symbols"; OQL → "OQL not allowed", button disabled.
- Radio "Add N Pie Charts" / "Add N Bar Charts" / "Add N Mutation Type Charts"; numeric profile with >1 gene: "Add 1 Violin Plot" `[default]` or "Add N Bar Charts".
- [Add Chart(s)]. Banner "X has been added." / "X is already added." / "Violin chart added (N genes)" / "N charts added".

**STV-AC-6 Custom Data:**
- Logged out: "Please [Login] to add custom data charts to your profile."; the creation form is shown only when logged in (or under webdriver/e2e cookie, as on our headless run `[B]`).
- Form = CustomCaseSelection with grouping: By sample/patient ID, ◉ Categorical / ○ Numerical data, ↓ currently selected/unselected, textarea (`id value` per line; multi-study requires `study:`), "Title (optional)" (default name from `getDefaultCustomChartName`; duplicate → error "Custom data exists."), [Add Chart]. Unvalued lines get a default value (STV-STM-7).
- Saving → spinner banner "Saving X", then "X has been added.".
- Existing custom charts listed (header "Custom data"), each with 🗑 (mark for deletion → "Restore") and share icon; [Share selected] button; shared rows highlighted with "Highlighted rows are shared custom data.".
- Marked charts are deleted when the menu closes ("Deleted charts will be permanently removed when this menu is closed. Any active filters based on deleted charts will also be removed.").
- Share opens "Share custom data" modal with `…#sharedCustomData=<ids>`.
- Legacy bug: the note "Custom charts are saved to your profile" is unreachable (`AddChartButton.tsx:842`, duplicate condition).

**STV-AC-7 X vs Y:** two selects "Select first clinical attribute" / "Select second clinical attribute" (all clinical attributes except survival ones other than OS_STATUS). Button text/state:
- missing either → "Add Chart" (disabled); same attribute → "Please choose two different attributes." (disabled); already exists → "A chart with these attributes already exists" (disabled);
- both STRING → "Can't add a chart with two categorical attributes (yet)." (disabled); NUMBER+STRING → "Add violin/box plot table"; NUMBER+NUMBER → "Add density plot".
- Banner "Y vs X added.", selects reset.

**STV-AC-8 Generic-assay tabs:** profile select "<name> (N samples|patients)" (patient-level profiles say patients), entity search "Search for <Type>...", [Add charts]. For BINARY/CATEGORICAL profiles also a "Frequency Table: <profile>" row. Added charts listed below without controls. LIMITVALUE → continuous charts; BINARY/CATEGORICAL → categorical charts.

---

## 7. Groups (`ComparisonGroupManager.tsx`, `GroupCheckbox.tsx`)

Button "Groups ▾" (`data-test=groups-button`) shown iff session service enabled; on every tab. Popover 350 px; auto-open when `sharedGroups` in URL.

- **STV-GR-1 Header:** [Select all (N)] [Deselect all] (act on search-filtered groups) · search "Search.." (case-insensitive regex on name). Groups sorted by lower-case name.
- **STV-GR-2 Empty:** "Group comparison allows you to create custom groups and compare their clinical and genomic features. Use the button below to create groups based on selections."; search miss: "No results for your current search."; error: "There was an error loading saved groups. Please try again.".
- **STV-GR-3 Group row:** checkbox (default unchecked on load), name (truncated at 30) + "(N samples/M patients)" or "(N samples/patients)" when equal; ⚠ "You have selected identical colors for compared groups." when two selected groups share a colour; colour swatch (tooltip "Optional: Select color for group…"; 20 palette colours + Yes/No/Female/dark grey; re-clicking the same colour clears it); 🗑 "Delete Group"; share icon; ⚠ error icon listing samples no longer in the study. Shared groups highlighted.
- **STV-GR-4 Delete:** marks row (struck, [Restore]); actual delete (session service) happens when the menu closes.
- **STV-GR-5 Buttons** (only if ≥1 group):
  - [Compare] primary — enabled for 2…20 selected groups (`MAX_GROUPS_IN_SESSION=20`); tooltips "Select between 2 and 20 groups to enable comparison." / "Open a comparison session with selected groups" / "Create at least two groups to open a comparison session". Opens new tab → comparison loading page → `/comparison?comparisonId=<id>` (session `{groups, origin: studyIds}`).
  - [Filter] — enabled if ≥1 selected; `clearAllFilters()` then sample-ID filter = **union** of selected groups' samples (STV-FB-3 #2).
  - [Share] — enabled if ≥1 selected; modal "Share Group" / "Share N Groups": "Please send the following link to users with whom you want to share the selected group(s)." URL `…#sharedGroups=<ids>`.
- **STV-GR-6 Create:** [Create new group from selected samples (N)] (`data-test=create-new-group-btn`) → name input "Enter a name for your new group" prefilled with `getDefaultGroupName` (STV-STM-8) + [Create]; disabled if name empty or duplicate (tooltip "Another group already has this name."); Enter submits. Saves `{name, description:'', studies:[{id, samples}], origin: studyIds}`. Reserved names get a fixed colour. Logged out: group kept only for this page session.
- **STV-GR-7 Notes:** "Highlighted rows are shared groups."; logged out with social auth: "The groups above will not be saved without [Login]"; logged in with shared groups: "They have been saved to your profile.".
- **STV-GR-8 Which groups are listed** [C]: user's saved groups for the queried study IDs (logged in, or `noauthsessionservice`) + URL-shared groups whose studies are all queried + groups created this session. Samples not in the cohort are dropped and reported (STV-GR-3).
- **STV-GR-9 Rename:** not available in the study-view manager (rename only in Group Comparison).
- **STV-GR-10 Other "Compare" entry points:** per-chart compare icons (see 30-study-summary) call `Store.openComparisonPage` (`Store:2310`); categories become groups.

---

## 8. Virtual study modal (`VirtualStudyModal.tsx`, `VirtualStudy.tsx`)

Title "Create a Virtual Study". Spinner while inputs load.

- **STV-VS-1 Title:** input; placeholder "Selected samples (YYYY-MM-DD)" ("sample" when 1); prefilled with the VS name when the page is a single unfiltered VS.
- **STV-VS-2 Description:** textarea, auto-generated (STV-STM-9) until the user edits it; placeholder "Virtual study description (Optional)".
- **STV-VS-3 Type:** ◉ Static `[default]` / ○ Dynamic with ⓘ explanatory tooltip (static = fixed sample IDs; dynamic = re-evaluates the filter as data change). Switching type swaps the default description (dynamic omits counts) unless edited.
- **STV-VS-4 Buttons:** [Save] (only when a real user is logged in, not "anonymousUser") and [Create]. Both disabled only if name and placeholder are empty (never in practice). Spinner on the clicked one.
- **STV-VS-5 Payload:** `{name: title || placeholder, description, studyViewFilter: current filters minus sampleIdentifiersSet, origin: studies with selected samples, studies: [{id, samples}] of selected samples, dynamic}`; Save also adds to user's list. [C]
- **STV-VS-6 Success:** "Success! Copy the following link to view virtual study." + read-only `…/study?id=<vsId>` input, 📋 copy (→ 👍) and ↗ open in new tab. Failure: "Failed to save|share virtual study, please try again later.".
- Seen default description: "594 samples from 1 study:\n- Colorectal Adenocarcinoma (TCGA, PanCancer Atlas) (594 samples)\n\nCreated on 2026-11-10 by anonymousUser".

---

## 9. Bookmark / share filter link (`StudyViewPage.tsx:479-675`)

- **STV-BM-1** URL = `origin + pathname + search + '#filterJson=' + JSON.stringify(store.filters)` — includes `studyIds` or `sampleIdentifiers` and the full `alterationFilter` (seen).
- **STV-BM-2** Modal "Bookmark this filter": full URL input + "Shortened URL" (bit.ly when `bitly_access_token` set, seen `https://bit.ly/…`).
- **STV-BM-3** If the URL > 300,000 chars: opens the VS modal instead, with warning "The url is too long to share. Please consider making a virtual study containing the selected samples.".

---

## 10. Tabs

**STV-TAB-1 Order and visibility** (`StudyViewPage.tsx:747-870`):

| Tab | Label | Hidden when |
|---|---|---|
| Summary | Summary | never (charts: 30-study-summary) |
| Clinical Data | Clinical Data | `skin_hide_clinical_data_tab_study_view` OR 0 selected samples |
| Heatmaps | Heatmaps | MDACC heatmap meta empty (`show_mdacc_heatmap` off, or >1 physical study) — iframe `bioinformatics.mdanderson.org/TCGA/NGCHMPortal/?<meta>` |
| CN Segments | CN Segments | `hasCNSegmentData` pending or false (META count of segments over **all** queried samples = 0) |
| Files & Links | single resource definition → its name, else "Files & Links" | no resource definitions |
| Plots | Plots | never |
| Similarity Maps **Beta!** | — | feature flag `EMBEDDINGS` off or no studies |
| open resource tabs | resource display name, ✕ close | not open |
| server custom tabs | config `custom_tabs` (location STUDY_PAGE) | per config |

- Seen: coadread → Summary · Clinical Data · CN Segments · Plots · Computed Tomography · Slide Microscopy `[B]`; lgg → Summary · Clinical Data · Plots; 0 samples → Summary · CN Segments · Files & Links · Plots `[B]`.
- Tab switch updates the path (`/study/<tab>?…`); hidden-tab content stays mounted. A `HelpWidget` sits in the tab bar. Pagination of tab headers stops at the toolbar.

### 10.1 Clinical Data (`ClinicalDataTab.tsx`)
- **STV-CD-1** Loading spinner until attribute product, max-samples, selected samples and ≥1 visible chart are ready.
- **STV-CD-2** Too many: if `#clinicalAttributes × #selectedSamples > clinical_attribute_product_limit` (default 6,500,000): "Too many samples selected. The maximum table length is **⌊limit/#attrs⌋** rows, but your current selection would be **N** rows. Select fewer samples on the [Summary tab]." (link switches tab).
- **STV-CD-3** Columns: Patient ID (→ patient view, new tab), Sample ID (→ sample view), "Cancer Study" (studyId) iff the Cancer Studies chart is visible, then one column per **visible Summary chart that is a clinical attribute**, ordered by priority then name (`chartMetaComparator`). Header tooltip = name, description, attribute ID. Column set = Summary charts; [Columns ▾] edits both.
- **STV-CD-4** Cells: empty → grey "—" (title "No data available"); URL values → link; else text.
- **STV-CD-5** Header "**N results**" (server total). 20 rows/page `[default]`, pagination + "Show more"; max height `calc(100vh - 220px)`; no column-visibility menu; no count header.
- **STV-CD-6** Search box and column sort are **server-side** (re-fetch with `searchTerm`, `sortAttributeId`, direction; Patient ID → `patientId`, Sample ID → `sampleId`). Max 500 rows fetched; when total > 500 and user is on the last page/"show all": "You've reached the maximum viewable records. Please use filter or sort to refine result set."
- **STV-CD-7** Download (cloud icon) iff `SHOW_ALL`; copy hidden; file `<prefix>clinical_data.tsv`. **Legacy bug:** the download fetcher is capped at 500 rows (`ClinicalDataTab.tsx:445`), so large selections download truncated. Use STV-AB-4 for the full file.
- **STV-CD-8** Seen: "594 results", default columns: Patient ID, Sample ID, Cancer Type Detailed, Mutation Count, Fraction Genome Altered, Diagnosis Age, MSI MANTIS Score, MSIsensor Score, Overall Survival Status, Sex, Ethnicity Category, Race Category, Subtype, Tumor Type, … (mirrors Summary charts).
- **STV-CD-9** Columns menu tabs on this tab: Clinical · Genomic (bar/pie only) · X vs Y.

### 10.2 CN Segments (`CNSegments.tsx`)
- **STV-CN-1** Info line: "Segmented copy-number data for the selected N samples." ("sample" when 1); "No segmented copy-number data for the selected N samples." when none; >20,000 selected: "Too many samples (>20000) for copy number segmentation view, make a selection on Summary tab first." and no fetch.
- **STV-CN-2** Download link next to it → `<prefix>segments.seg` (iff `SHOW_ALL`, and data exist).
- **STV-CN-3** IGV with one segment track of selected samples; genome = first queried study's reference genome (seen "hg19"); track height from features, max 70 % of window; locus remembered while tab re-renders *(local)*. Progress: "Loading copy number segments data..." → "Rendering".

### 10.3 Plots
- **STV-PL-1** Shared PlotsTab (04-plots) with `hasNoQueriedGenes=true` (any gene typed in), cohort = selected samples, coverage over all patients. URL params `plots_*`. Examples panel shown before selection `[B]`.

### 10.4 Similarity Maps (`EmbeddingsTab.tsx`) [C]
- Feature-flagged; select embedding (UMAP-like 2-D maps per supported study), colour by cancer type / gene / clinical attribute ("None" option), non-cohort points labelled "Sample not in this cohort" / "Case not in this cohort". Lasso selection creates a custom-data chart "<Embedding> Sample Selection" / "Patient Selection". URL `embeddings_coloring_selection`. Not visible on cbioportal.org.

### 10.5 Files & Links and resource tabs
- **STV-RS-1** [C, cd8c6df] Files & Links table (`FilesAndLinks.tsx`) over selected samples: Patient ID (→ patient Files & Links), Sample ID, "Type Of Resource" (→ patient `openResource_<id>`), "Resource URL" ("Open in new window"), "Description" (iff any definition has one), "Resources per Patient" (or "<Type>s per Patient" when one type). Default sort Resources per Patient desc. Header "N resources" (or custom name). Resource-config flags: `hidePerPatientColumn`, `hideUrlColumn`, `openInNewTab`, `columnNameMapping`, `customizedDisplayName`.
- **STV-RS-2** [C] Study-level resources section exists but is rendered `display:none`.
- **STV-RS-3** [C] Resource tab `openResource_<id>`: iframe of the selected datum (`resourceUrl`), prev/next, accessibility check (HEAD, no-cors). Definitions with `openByDefault` open on load; ✕ closes and returns to Files & Links.
- **STV-RS-4** [B, production build] One tab per resource type, path `resourceTable_<RESOURCE_ID>` (e.g. `resourceTable_IDC_OHIF_CT`), table header "1-24 of 24 Computed Tomographies · 21 patients", search "Search patient ID, sample ID, reso…", [Add columns ▾], download, columns Patient ID ▲ | Link "↗ Open in new window", pagination with page size 25. Files & Links tab appeared only in the 0-sample state.
- **Legacy bug** [C]: FilesAndLinks matches resources to the selection by bare `sampleId`/`patientId` (`FilesAndLinks.tsx:104`) and groups by bare `patientId` (`:120`), so multi-study ID collisions mix rows and per-patient counts.

---

## 11. Layout persistence (logged in) [C]

- **STV-LP-1** Possible iff logged in AND session service enabled (`Store:899`). Settings are keyed by the exact `studyIds` list (page `STUDY_VIEW`).
- **STV-LP-2** [📌 Save settings] (`data-test=save-chart-settings-to-session`): enabled iff logged in and current ≠ last saved. States: "📌 Save settings" (logged out / dirty) or "☑ Settings saved". Tooltips: "Log in to save chart settings." / "Save the currently visible charts as default for future visits to this study." / "All changes saved." Seen disabled when logged out `[B]`.
- **STV-LP-3** Saved: visible charts, grid layout (x,y,w,h), chart types, gene-specific / generic-assay / X-vs-Y / violin chart definitions (incl. log scale), custom bins, cancer-gene filter toggles of gene tables, and group colours (group colours auto-save on change).
- **STV-LP-4** On load with saved settings that differ from defaults: banner "Your previously saved layout preferences have been applied." [Keep Saved Layout] [Revert to Previous Layout] ×.
- **STV-LP-5** Reset charts modal: "Reset charts" / "Please confirm that you would like to replace the current charts with the default list." [Confirm] [Cancel]. Confirm keeps charts that currently have a filter, restores defaults, and saves.
- **STV-LP-6** Logging in from the study page loads saved settings and saves session-created custom data/shared groups to the profile.

---

## 12. Loading, error and empty states

- **STV-LD-1** Page: big centred spinner while queried sample IDs / invalid IDs / study resolution are pending (`StudyViewPage.tsx:464`).
- **STV-LD-2** All IDs unknown: code shows ErrorScreen "Unknown/Unauthorized Study|Studies" / "The following studies are unknown or you lack privileges to view them: …". **Legacy bug** `[B]`: production instead shows a generic API error page ("studyIds size must be between 1 and 2147483647" ×4, "Return to homepage", "Copy Error Log to Clipboard").
- **STV-LD-3** Some IDs unknown: banner STV-HD-1; page works on the valid ones.
- **STV-LD-4** Summary progress list: "Loading meta information" → "Loading clinical data" → "Loading sample data" (each "+ - this can take several seconds" after 2 s if still pending) → "Rendering".
- **STV-LD-5** Invalid sample IDs (VS sample no longer exists): dismissible red alert "The following sample(s) might have been deleted/updated with the recent data updates" + scrolling list `study:sample`.
- **STV-LD-6** 0 selected samples: box "The filters you have selected have filtered out all the samples in this study; because of this, no data visualizations are shown." / "You can remove filters in the header of this page to widen your search criteria and add samples back to your results."; charts hidden; Clinical Data tab hidden; download returns empty. **Legacy bug** `[B]`: the progress list stays on screen with "Rendering" spinning forever below the message.
- **STV-LD-7** A guided Tour component is mounted after load (input: any sample selected, logged in). [C]

---

## 13. Modes & conditions

| ID | Condition | Expected behavior |
|---|---|---|
| STV-MD-1 | Single physical study | Title/description/PubMed; study download icon if listed; Query uses that study's default profiles; case set `<study>_all` |
| STV-MD-2 | Multiple studies | "Combined Study"; "contains samples from N studies" + list; no download icon; Query profileFilter = all mutation/CNA/SV suffixes; case set `all`; EXP/PROT OQL blocked; custom selection needs/accepts `study:` prefix; heatmaps tab hidden; Genomic freqs inflated (legacy bug STV-STM-3) |
| STV-MD-3 | Single virtual study, no physical | VS name/description as header; "derived from" origin list; cohort = VS sample list; VS modal prefilled with its name/description when unfiltered |
| STV-MD-4 | VS + physical studies | Physical studies contribute all samples (fetched per study); VS contribute their lists; unions per study |
| STV-MD-5 | Filtered vs unfiltered | "Selected:" prefix; Query sends `case_set_id=-1` + explicit `case_ids`; groups default name from filters |
| STV-MD-6 | 0 samples | STV-LD-6 |
| STV-MD-7 | Manual-submit mode | Pending pills, [Submit ►] on Summary; `chartsAreFiltered` follows pending filters while counts follow submitted ones (quirk) |
| STV-MD-8 | Logged out | No Save on VS; custom data not creatable; groups session-only; Save settings disabled; no Reset charts |
| STV-MD-9 | Logged in | Saved groups, custom data, layout (STV-LP) |
| STV-MD-10 | Session service disabled | No Groups button, no Save settings, no layout persistence |
| STV-MD-11 | `skin_hide_download_controls` ≠ SHOW_ALL | Hide header download icon, ⤓ action button, Clinical Data download, CN segments download |
| STV-MD-12 | Multi-sample patients (lgg) | Patient count < sample count everywhere (e.g. 23 | 61) |
| STV-MD-13 | Clinical Data tab | Columns menu (Clinical/Genomic/X vs Y only); Custom Selection kept |
| STV-MD-14 | CN Segments / Files & Links / Plots / Similarity Maps tab | Custom Selection kept; Charts menu absent |

---

## 14. Persistence summary

**URL:** path tab; `id`/`studyId`/`cancer_study_id`; `#filterJson` (also query `filters`, POST); `filterAttributeId`+`filterValues`; `#sharedGroups`; `#sharedCustomData`; `resourceUrl`; `plots_*`; `embeddings_coloring_selection`; `geneset_list`; `generic_assay_groups`.

**localStorage:** `study_view_filter_autosubmit` (manual mode); `legacyStudySubmission` (query hand-off).

**Session service (logged in):** study-page settings per study-ID set (charts, layout, group colours); comparison groups; custom data; virtual studies (Save).

**Not persisted:** active filters (unless bookmarked), selected groups, menu tab choices, Clinical Data search/sort/page, CN Segments locus, description expand state.

---

## 15. Statistics & methods

**STV-STM-1 Cohort and selected samples** (`Store.samples:9558`, `selectedSamples:9676`, `filtersProxy:4892`)
- Cohort `samples`: `fetchFilteredSamples({studyIds})` for physical-only queries, or `{sampleIdentifiers}` when any VS is queried (VS sample lists ∪ all samples of physical studies; `queriedSampleIdentifiers:6493`).
- Unfiltered (`isFiltered(userSelections)` false, `StudyViewUtils.tsx:1210`): selected = cohort.
- Filtered: `fetchFilteredSamples(filters)` on the server. Filter types are ANDed; values within one filter are ORed (pills, §3). Sample-ID filter sets (custom selection, group filter, chart ID selections) are **intersected** with each other (`intersect` on `sampleId+studyId`); if none, the cohort IDs are sent.
- `alterationFilter` (driver/VUS/tier/germline/somatic flags) is sent with every filter and affects gene-table filters server-side.
- Patient-attribute filters select every sample of a matching patient (server-side semantics; see 30).

**STV-STM-2 Selected counts** (`StudyResultsSummary`)
- Samples = `selectedSamples.length`.
- Patients = number of distinct `uniquePatientKey` (study+patient) among selected samples (`selectedPatients:9809`). A patient counts if any of its samples is selected.

**STV-STM-3 Add-chart "Freq" column** (`AddChartButton.tsx:197`, `calculateClinicalDataCountFrequency`, `dataWithCount:11034`)
- Freq = `count × 100 / #selectedSamples` (sample-level denominator for every option, incl. patient attributes).
- Display (`getFrequencyStr`, `StudyViewUtils.tsx:1982`): 0 → "0%"; [99.9,100) → "99.9%"; ≥0.1 → one decimal (`toFixed(1)`); (0,0.1) → "<0.1%"; negative/NaN → "NA". Not capped at 100.
- `count` per option:

| Option | count |
|---|---|
| Clinical attribute | rows in `clinical_sample` + `clinical_patient` joined to the selected samples, grouped by attribute ID (backend `ClinicalAttributeMapper.xml:116` `getClinicalAttributeCountsBySampleIds`); a patient attribute counts once per selected sample of that patient; sample and patient attributes with the same ID are summed |
| Namespace (variant annotation) | server namespace count for selected samples |
| Survival (KM) chart | number of survival data points |
| Cancer Studies | Σ counts of the cancer-study pie |
| Mutated Genes / CNA Genes | Σ over **each** mutation (CNA) profile of `molecularProfileSampleCountSet[suffix]` |
| SV Genes / SV table | Σ over SV profiles of the suffix count; if 0, falls back to the Mutated Genes count |
| Mutation Count vs FGA | selected samples having that scatter datum |
| Data Types (genomic profile sample counts) | = #selected (100 %) |
| Custom charts | = #selected (100 %) |
| Gene-specific / generic-assay charts | suffix count of their profile |
| Sample treatments, and (copy-paste) Sample Treatment Groups and Sample Treatment Target | `sampleTreatments.totalSamples` |
| Patient treatments / groups / target | each one's `totalPatients` (patients over a sample denominator) |
| Clinical event type counts | `calculateSampleCountForClinicalEventTypeCountTable` |
| anything else | 0 → row disabled |

- `molecularProfileSampleCountSet[suffix]` = server `molecular-profile-sample-counts` with the current filters, rows merged by profile suffix **across studies** (backend `ClickhouseGenomicDataMapper.xml:7`, `GetMolecularProfileSampleCountsUseCase`).
- **Legacy bug:** summing that already-merged suffix count once per study's profile multiplies it by the number of studies. Seen coadread+brca: Mutated Genes **190.7 %**, CNA Genes **198.1 %**, SV Genes 190.7 % (true values ≈ 95 %). Single study correct: Mutated Genes 89.9 % = 534/594.
- Legacy quirk: Sample Treatment Groups/Target reuse the sample-treatments total (`Store:11146-11160`).

**STV-STM-4 Profile "(N samples)" in Gene Specific / generic-assay selects**
- N = number of **selected** samples profiled in that profile suffix (summed across studies), from STV-STM-3's suffix count (`molecularProfileOptions:10821`, `genericAssayProfileOptionsByType:7101`). Patient-level GA profiles label "patients" but the number is the same sample-profile count.

**STV-STM-5 Clinical data download (⤓)** (`getDownloadDataPromise:11339`)
- Rows = selected samples (in `selectedSamples` order). Columns = Study ID, Patient ID, Sample ID, then **every** clinical attribute of the queried studies (deduped by attribute ID, `displayName` as header), not just visible ones.
- Data via `getAllClinicalDataByStudyViewFilter(filters)` in pages of 25,000 sample groups; a missing value → "NA". TSV, `\n` line ends, no quoting.

**STV-STM-6 Query submission** (`onSubmitQuery:11426`)
- `cancer_study_list` = queried IDs minus unknown; `tab_index=tab_visualize`.
- `profileFilter`: single physical study → suffixes of the default profiles for alteration types present in the OQL (mutation, SV, CNA, mRNA, protein); multi/VS → all mutation + CNA + SV suffixes (deduped). If empty for a single study → first selectable profile suffix.
- Filtered → `case_set_id=-1`, `case_ids` = `study:sample` joined by `+`. Unfiltered → `<study>_all` (single physical) or `all`.
- Genes present → `gene_list` = OQL lines joined by `\n`, `Action=Submit`, target `/results`; else `/` (query page). Opens in a new tab.

**STV-STM-7 Custom data / custom selection mapping** (`getData`, `CustomCaseSelectionUtils.tsx:297`)
- Sample mode: one row per listed sample. Patient mode: one row per sample of each listed patient.
- Value = the line's value. An unvalued line gets "Unselected" if any other line has a value, else `custom_value`.
- Unprefixed IDs (multi-study) match in every queried study containing them.

**STV-STM-8 Default new-group name** (`getDefaultGroupName`, `GroupComparisonUtils.tsx:589`)
- Concatenate, in this order, joined by ", ": gene-filter OQL strings; STRING clinical filters sorted by attribute ID, values joined by "+"; pre-defined custom chart values (sorted by chart ID) joined by "+"; genomic-profile filter IDs; case-list IDs. Numeric filters and other filter types contribute nothing (empty name possible).

**STV-STM-9 Virtual-study default description** (`getVirtualStudyDescription`, `StudyViewUtils.tsx:1018`)
- Line 1: "N sample(s) from K study:|studies:" (dynamic: "Samples from …"); N = distinct selected sample keys.
- Per study: "- <name> (n samples)". **Legacy bug:** per-study plural uses the total N, not n.
- "Filters:" block: gene filters "- <table>:" + "  - <OQL, …>"; "- Genomic Profile Sample Counts:" / "- Case List Sample Counts:" with names; clinical, genomic, mutation, generic-assay filters as "- <name>: <interval/values string>" (STV-FB-4 string form); each sample-ID set "- <name or key>: N samples". Custom-data, treatment, SV, namespace and clinical-event filters are omitted.
- Last line "Created on YYYY-MM-DD[ by <user>]" (UTC date). With an existing VS description: keep it, strip from "Created on" on, append a new created line.

**STV-STM-10 Group counts** (`caseCounts`, `finalizeStudiesAttr`)
- Samples = group samples that still exist in the cohort; patients = distinct patients of those samples. Text "N samples/M patients", or "N samples/patients" when equal (singular "sample/patient" when 1).
- Group filter pill: union over selected groups of samples and of patients.

**STV-STM-11 Query gene limit**
- Max genes = ⌊`query_product_limit` / #selected samples⌋ (default limit 1,000,000).

**STV-STM-12 Clinical Data tab limits**
- Max rows = ⌊`clinical_attribute_product_limit` / #clinical attributes⌋ (default 6,500,000); page fetch limit 500; "N results" = server `totalItems` (samples matching search).

**STV-STM-13 CN Segments availability**
- Tab shown iff segment `META` total-count > 0 over all cohort samples (not just selected); fetch threshold 20,000 selected samples.
