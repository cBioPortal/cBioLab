# Legacy parity spec — Group Comparison core (page shell, Overlap, Survival/KM, Clinical) + Results View › Comparison/Survival

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`; backend `cbioportal` (legacy controllers) for clinical-tab statistics.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.
Hover popovers on group buttons rendered headless; KM point tooltips and Venn/UpSet hover tooltips did not, so those are `[C]`.

**This file owns the Kaplan-Meier survival chart and its statistics (CMP-KM-*, CMP-STM-1…8).** Other files say "uses KM chart (see 20-comparison-core.md CMP-KM)".
Enrichment tabs (Genomic Alterations, Mutations, mRNA, Protein, Methylation, Generic-assay) → `21-comparison-molecular.md`.
Box plot / category bar plot internals → `04-plots.md`. Group colours palette → `30-study-summary.md`.

Reference URLs:
- RV tab: `/results/comparison/survival?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS`
  (groups seen: Altered group (222), Unaltered group (372), KRAS (222); OS p = 0.632; HR Unaltered vs Altered 1.094 (0.760–1.575)) `[B]`
- GC page: `/comparison/overlap?comparisonId=6af36ddbb1971a03c3aa3bc7` — test session on coadread: Male, Female, "Male subset" (30 male samples), "Mixed" (20 M + 20 F) → both subsets fully overlapping `[B]`. Add `&overlapStrategy=Include` for the include mode.

Key files (frontend `src/`):
`pages/groupComparison/{GroupComparisonPage,GroupComparisonStore,GroupComparisonURLWrapper,GroupComparisonUtils,Overlap,OverlapVenn,OverlapUpset,UpSet,CreateGroupFromOverlap,OverlapExclusionIndicator,OverlapUtils,Survival,ClinicalData,ClinicalDataEnrichmentsTable,ClinicalDataUtils,CategoryPlot,CategoryTable,SummaryStatisticsTable}.tsx`,
`pages/groupComparison/groupSelector/*`, `pages/groupComparison/rectangleVennDiagram/*`,
`pages/resultsView/survival/{SurvivalChart,SurvivalUtil,SurvivalHelper,SurvivalPrefixTable,logRankTest}.ts(x)`, `pages/resultsView/SurvivalStoreHelper.ts`,
`pages/resultsView/comparison/{ComparisonTab,ResultsViewComparisonStore,ResultsViewComparisonUtils}.ts(x)`,
`shared/lib/comparison/ComparisonStore.ts`, `shared/lib/StoreUtils.ts:1520-1600`, `shared/lib/calculation/BenjaminiHochbergFDRCalculator.ts`.
Backend: `legacy/web/ClinicalDataEnrichmentController.java`, `legacy/web/util/ClinicalDataEnrichmentUtil.java`, `legacy/service/impl/ClinicalDataServiceImpl.java:177-290`, Datumbox 0.8.2 `KruskalWallis`, `Chisquare`.

---

## 0. Page shell — `/comparison/<tab>?comparisonId=…` (GroupComparisonPage.tsx)

**CMP-PG-1 Routing**
- URL: `comparisonId` (alias `sessionId`) = comparison-session id; loaded from session service `api/session/comparison_session/<id>`.
- Tab = path segment `/comparison/<tab>`; ids: `overlap` `[default]`, `survival`, `clinical`, `alterations`, `mutations`, `mrna`, `protein`, `dna_methylation`, `generic_assay_<type>`, `pathways` (feature flag `group_comparison_pathways`). Plus server `custom_tabs` for `COMPARISON_PAGE`.
- Changing `comparisonId` rebuilds the store. Adding/deleting a group writes a **new** session and replaces `comparisonId`.
- Full-page spinner while a new session is being saved (`newSessionPending`).

**CMP-PG-2 Header (left)**
- 1 study → `<h3>` study name, links to study view.
- >1 study → `<h4>` "Multiple studies", links to `/study?id=a,b,…` (new tab).
- If session has `clinicalAttributeName` → appended "Groups from ***<name>***" (bold italic). Seen: "Colorectal Adenocarcinoma (TCGA, PanCancer Atlas) Groups from Sex" `[B]`.

**CMP-PG-3 Header (right) — overlap strategy select** (react-select, not searchable/clearable, 355 px)
- Shown only when the selected groups have any sample or patient overlap (`totalSampleOverlap || totalPatientOverlap`, accumulated over all exclusion iterations, CMP-STM-9).
- Options: "Include overlapping samples and patients" | "Exclude overlapping samples and patients" `[default Exclude]`.
- URL: `overlapStrategy=Include|Exclude` (GC page); `comparison_overlapStrategy` (RV tab).
- Changing it remounts Survival and Clinical tabs (keyed by strategy).

**CMP-PG-4 Tab visibility** (`ComparisonStore.ts:2091-2121`, GroupComparisonPage.tsx:139-366)

| Tab | Hidden when | Greyed (`greyedOut`) when |
|---|---|---|
| Overlap | never | — |
| Survival | no `<P>_STATUS`+`<P>_MONTHS` patient data for active samples (CMP-SV-1), **or** >10 active groups. Exception: stays visible with 0 active groups if it was shown before (`tabHasBeenShown`) | — |
| Clinical | never | <2 active groups |
| Others | see 21-comparison-molecular.md | |
- Seen tab list (coadread SEX session): Overlap | Survival | Clinical | Genomic Alterations | Mutations **Beta!** | mRNA | Protein | Arm-level CNA | Genetic Ancestry | Methylation; DNA Methylation hidden `[B]`.
- Help widget in tab-content area; app tour (`Tour`) after tabs load.

---

## 1. Group selector (groupSelector/*)

**CMP-GS-1 Layout:** "**Groups:** (drag to reorder)" then one button per original group, then optional collapse button, then "Select all | Deselect all" links.

**CMP-GS-2 Group button**
- Background = group colour; text black if luminance (0.299R+0.587G+0.114B) > 186 else white (`OverlapUtils.getTextColor`).
- Label: `(<ordinal>) <name>` (name ellipsised at 200 px) + count `(N)` if #samples = #patients else `(S/P)`. Seen "(A) Female (280)" `[B]`.
- Counts are of existing samples in the group and their distinct patients (overlap NOT removed).
- Unselected: transparent background, 1 px #c3c3c3 border.
- Excluded-from-analysis (Exclude mode and group fully overlapped, CMP-STM-9): background #dddddd, white text, line-through.
- ⚠ error icon if the group references samples not in the DB; tooltip "The following samples cannot be found in our database. They might have been removed or changed since this group was created:" + list `study:sample`.
- Delete "×" (fa-times-circle, dashed left border) shown when: GC page — session has >2 groups; RV tab — group is user-created (from overlap). Click → new session without the group.
- Click on the name/count area toggles selection; ignored while dragging.

**CMP-GS-3 Hover popover** (delay `TOOLTIP_MOUSE_ENTER_DELAY_MS`, placement top)
- "(D) Mixed (40)" — counts as "(N)" or "(S samples/P patients)" (singular when 1) + " - <description>" if any.
- If excluded: "This group is a subset of the other selected groups, so it's excluded from analysis, and not considered in overlap calculations." `[B]`
- Link "Open in study view" (pie icon) → study view filtered to the group's samples.

**CMP-GS-4 Selection**
- GC page: URL `unselectedGroups=["name",…]` (JSON); all selected `[default]`. Select all → `[]`; Deselect all → all names.
- RV tab: URL `comparison_selectedGroups=[…]` (JSON, a **whitelist**); default `["Altered group","Unaltered group"]`.
- Selection is by group **name**.

**CMP-GS-5 Reorder:** drag (react-sortable-hoc, axis xy, 6 px activation distance); collapse button and select links are not draggable.
- URL: `groupOrder` (GC) / `comparison_groupOrder` (RV) = JSON array of names. Unlisted groups go last.
- Order drives ordinals, legend order, survival curve order, clinical category order.

**CMP-GS-6 Default order** (GC page only; `GroupComparisonUtils.ts:97-126`)
1. URL `groupOrder` if present; else session `groupNameOrder`; else:
2. Sort by name-priority: `/\bprimary\b/i`=0, `/\bpre(?:treatment)?\b/i`=1, others=2, `/\bpost(?:treatment)?\b/i`=3, `/\bmetastas(is|tic)\b/i`=4; then case-insensitive name; group named "NA" (any case) last. Seen: Female, Male, Male subset, Mixed although session order was Male, Female… `[B]`
- RV: query-derived order (Altered, Unaltered, Unprofiled, per-track…) then user-created; no name sort `[C]`.

**CMP-GS-7 Ordinals** (GC only): A…Z, AA, AB… (bijective base 26), assigned after ordering; `nameWithOrdinal = "(A) name"`. RV groups have no ordinal.

**CMP-GS-8 Colours**
- GC: session colour if set; else Study-View palette `COLORS` minus colours already used by other groups, via `pickClinicalDataColors` (reserved value colours first; see 30-study-summary).
- RV: Altered `#dc3912`, Unaltered `#3366cc`, Unprofiled `DEFAULT_NA_COLOR`, others from a unique colour getter excluding those two.
- No rename and no colour editing on the comparison page (those live in Study View's group manager).

**CMP-GS-9 Collapse** (RV only, threshold 40): when >40 groups show the first 39 + "N more groups ▼" / "Show less ▲" *(local)* `[C]`.

---

## 2. Overlap tab (Overlap.tsx)

**CMP-OV-1** Uses **selected** groups (`_selectedGroups`), overlap **not** removed, regardless of strategy.
- <2 selected → "We need at least 2 groups to show overlap. Please select more groups from the Groups section above."
- Otherwise: exclusion banner (CMP-OX, overlap-tab wording) + plot.

**CMP-OV-2 Plot type:** ≤3 selected → Venn (sample + patient side by side); >3 selected, or Venn layout failure (final layout error ≥ 1) → UpSet, with alert "We couldn't find a good Venn diagram layout, so showing UpSet diagram instead." on failure.

**CMP-OV-3 Venn** (OverlapVenn.tsx, rectangleVennDiagram/*)
- SVG 2×400 + 10 px gap + 20 + 180 px legend; height 500. Titles "Samples overlap" / "Patients overlap" (bold Verdana).
- Area-proportional rectangle Venn; regions = exclusive combinations (2 sets: A, B, AB; 3 sets: 7 regions).
- Region fill = Lab-interpolated blend of member colours (pairwise 50 %, iterated); outline per set in its colour, 2 px.
- Label = region count (bold) for non-empty regions; selected → "N ✔" on yellow rounded rect.
- Hover (non-empty) → fill brightened (`hsl.brighter(1)`); tooltip "**N samples/patients**<br>in only (A) X and (B) Y." `[C]`
- Click non-empty region toggles it; click background clears the selection *(local)*.
- Legend right: one square per group, label "(A) name" (max 100 px).
- Patient Venn: case key = `uniquePatientKey` of samples in the group.

**CMP-OV-4 UpSet** (UpSet.tsx, OverlapUpset.tsx)
- One UpSet each for samples and patients; side by side if total combinations ≤ 100, else stacked; container max width = window − 80 px, horizontal scroll.
- Columns = non-empty exclusive combinations, sorted by size desc. Bars black; y-axis "Overlap count". No per-bar labels `[B]`.
- Dot matrix: group rows ordered by `nameWithOrdinal` **descending** (seen (D)…(A) top-to-bottom) `[B]`; member dots black, others grey; connecting line.
- Hover bar/dot → "N samples in only (A) X and (B) Y." `[C]`. Click toggles; selected bar/dots/line yellow.

**CMP-OV-5 Create group from selection** (CreateGroupFromOverlap.tsx) — one per diagram
- Button "Create Group From Selected Diagram Areas" (btn-primary), disabled until ≥1 region selected.
- Under it: one line per selected region "Samples only in (A) X and (B) Y." / "Patients only in …".
- Click → popover: [☑ Save group to user account ⓘ] (logged-in only, default on) + text input "Enter a group name.." + [Submit].
- Submit disabled if name empty or duplicate (trimmed) of session group names (+ user's saved groups for these studies when saving to user); message "Another group already has this name."
- Sample selection: union over regions of (∩ included groups − ∪ other plotted groups), at sample level.
- Patient selection: same at patient level, then converted to **all samples of those patients** (`convertPatientsStudiesAttrToSamples`).
- New group: colour unset (auto), `origin` = session origin; appended to session → new session id (GC) / `comparison_createdGroupsSessionId` (RV).

**CMP-OV-6 Download** (top-right, when plot exists): SVG | PNG | PDF | Data; filename `overlap`. UpSet SVG = sample + patient SVGs combined.
- Data TSV: header `Sample ID, Patient ID, Study ID, <group name…>` (all original groups), one row per session sample, cells "Yes"/"No".
- Hidden unless server `skin_hide_download_controls = show` `[C]`.

**CMP-OX Overlap/exclusion banner** (OverlapExclusionIndicator.tsx) — shown only when total sample or patient overlap > 0
- Style: Exclude → `alert-info` + ⓘ; Include → `alert-warning` + ⚠ (survival tab: always info).
- Line 1 (if fully-overlapped groups exist): "(C) X and (D) Y are completely overlapping with other selected groups and are excluded|included in other tabs|the analysis below." `[B]`
- Line 2/3: "Samples|Patients (N) that overlap in the selected groups|between (A) … are included in|excluded from sample|patient-level analysis in other tabs.|below." N = overlap among the **remaining** groups (0 → line omitted).
- Survival tab: patient line only; in Include mode with patient overlap: "Overlapping patients (N) are plotted as distinct groups below."

---

## 3. Survival tab (Survival.tsx) — page-specific logic

**CMP-SV-1 Survival types** (`StoreUtils.getSurvivalClinicalAttributesPrefix`)
- Prefix P qualifies when active studies have attribute ids `P_STATUS` and `P_MONTHS` (regex `_STATUS$`/`_MONTHS$` case-insensitive; prefix cut at literal `_STATUS`).
- Order: priority desc; OS=400, DFS=300, PFS=250, DSS=250 fixed; other prefixes use the `_STATUS` attribute's `priority`.
- Tab exists if a META count of PATIENT clinical data for these attributes over active samples' patients is > 0.
- Data fetched: PATIENT clinical data for all `P_STATUS`/`P_MONTHS` over patients of `activeSamplesNotOverlapRemoved`.

**CMP-SV-2 Guards:** counted on selected, non-excluded groups.
- 0 → "We need at least 1 group to show survival. Please select more groups from the Groups section above."
- >10 → "We can't show survival for more than 10 groups. Please deselect groups in the Groups section."

**CMP-SV-3 Top messages (alert-info):**
- "Interpret all results with caution, as they can be confounded by many different variables that are not controlled for in these analyses. Consider consulting a statistician."
- "The log-rank test is used to test the null hypothesis that there is no difference between the groups in the probability of an event at any time point. Hazard ratios are derived from the log-rank test."
- Study id containing `genie_bpc` and left truncation unavailable → "Kaplan-Meier estimates do not account for the lead time bias introduced by the inclusion criteria for the GENIE BPC Project."
- CMP-OX (patient only, survival mode).

**CMP-SV-4 Analysis groups (curves)** (Survival.tsx:74-180)
- **Exclude** `[default]`: one curve per active group (overlap removed, non-empty), in group order; name "(A) X", group colour. Patients = the group's overlap-filtered patient list (`StudyViewUtils.getPatientIdentifiers`).
- **Include:** one curve per non-empty patient partition of selected non-excluded groups ("Venn regions"), named "Only (A) X" / "Only (A) X, (D) Y"; colour = blend (CMP-OV-3); order = #groups asc, then sum of group indices asc. Seen 5 curves: Only (A) Female, Only (B) Male, Only (A) Female, (D) Mixed, Only (B) Male, (C) Male subset, Only (B) Male, (D) Mixed `[B]`.
- A patient goes to exactly one curve.

**CMP-SV-5 Survival-type table** (SurvivalPrefixTable.tsx) — shown only when >1 prefix; left column, 475 px
- Header: "Min. # Patients per Group:" slider + editable number. Default = server `survival_min_group_threshold` (default 3).
  - Range: min..max over rows of each row's smallest group size; step 1.
  - Row hidden if any group has fewer patients than the threshold.
- Columns: Survival Type (not togglable) | Number of Patients | `# in <group>` (hidden by default) | `Median months survival in <group> (95% CI)` (hidden by default) | p-Value (tooltip "Derived from Log Rank test.") | q-Value (tooltip "Derived from Benjamini-Hochberg FDR correction procedure.").
- p/q columns exist only if server `survival_show_p_q_values_in_survival_type_table` (default true). Null p → "N/A".
- Initial sort p-Value asc; 15 rows/page; filter box; download (no copy); column-visibility menu. Row click selects plot; selected row highlighted.
- Seen RV: Progression Free 590 0.0191 0.0764 | Disease Free 223 0.125 0.250 | Disease-specific 569 0.531 0.632 | Overall 590 0.632 0.632 `[B]`.
- Survival Type text = title (CMP-KM-2).

**CMP-SV-6 Default plot**
- Code intends the first row of the sorted/filtered table (or first prefix if no table) (Survival.tsx:588-612). Observed: **Overall** shown first although PFS/DFS had smaller p — first render uses priority order `[B]`.
- If table rows exist but all are filtered by the threshold → alert-warning "The current **Min. # Patients per Group** is **N**. Adjust the filter to see comparisons for groups with fewer patients."
- Prefix with no patients → alert-info "<title> not available".

**CMP-SV-7 Plot header**
- `<h4>` title; `<p>` attribute description if exactly one study description, else blank.
- Several studies with descriptions → alert-warning "The survival data on patients from different cohorts may have been defined by [different criteria.]"; prefixed "Different descriptions of survival data were used for different studies." if descriptions differ. Hover link → table Study | Description.
- Then KM chart (CMP-KM) with props: totalCasesHeader "Number of Cases, Total", statusCasesHeader "Number of Events", medianMonthsHeader "Median Months <title> (95% CI)", curve name in tooltip, p from CMP-STM-3.

**CMP-SV-8 Left truncation** (OS only)
- Available only when single study `heme_onc_nsclc_genie_bpc` AND feature flag `LEFT_TRUNCATION_ADJUSTMENT`.
- Entry time = patient attribute `TT_CPT_REPORT_MOS`.
- Checkbox "Adjust for left truncation" `[default on]` *(local store state)*; when on: "(N patients excluded)" = patients without adjustment − with; ⓘ tooltip cites Brown et al. (2022) `[C]`.

---

## 4. Kaplan-Meier chart — shared component (SurvivalChart.tsx) — OWNER

Used by: Group Comparison Survival tab, RV Comparison/Survival, Study View KM chart (compact/summary mode — 30-study-summary lists its differences).

**CMP-KM-1 Controls row** (when `showSlider`, default true; comparison: true)
- ☐ Calculate hazard ratios `[default off]` *(local)*; disabled when only one curve has data.
- Control-group select (300 px, placeholder "Select control group"); disabled until HR on.
  - Options = raw curve values (group uid, or "uidA,uidB" in Include mode) with >10 patients, in data insertion order. Seen "Female,Mixed / Female / Male,Male subset / Male / Male,Mixed" `[B]`.
  - None qualifies → single option "Group sizes too small". Default = first option.
  - ⓘ "Option to set the control group."
- ☐ Add landmarks `[default off]` → enables text input "Add landmark values"; ⓘ "Enter numeric landmark(s) (comma or whitespace separated)". Unticking hides the lines and clears the input.
- "X-Axis Max:" slider 0…ceil(max months), step 1 + editable number + "Month(s) Survival".
  - Default = max, or min(server `survival_initial_x_axis_limit`, max) if set (default 0 = unset). Seen 149 `[B]`.
- Download (top-right): SVG | PNG | PDF | Data; filename = title with the **first** space replaced by "_".

**CMP-KM-2 Titles & axes**
- Title = `<P>_STATUS` displayName of the first study with "status"/"survival" removed (case-insensitive, not trimmed). Seen "Overall", "Progression Free", "Disease-specific".
- Y label: displayName contains "OS " or "Overall" → "Probability of Overall Survival"; "PFS" → "Probability of Progression-Free Survival"; "DFS" → "Probability of Disease-Free Survival"; else title.
- Y axis 0–100 %, 11 ticks, "%" suffix.
- X label = most common `<P>_MONTHS` displayName across studies (ties → alphabetically first). Seen "Overall Survival (Months)".
- X ticks: 18 when the legend is shown. Domain [0, slider]. Chart 1200×500; left padding grows when group names > 20 chars.

**CMP-KM-3 Curves**
- One step line (stepAfter) per curve with data; starts at (0, 100 %); a vertex at every patient (events and censored).
- Stroke = curve colour, 1 px.
- Censor mark "+" (size 3) at points where the estimate did not change. Legacy bug: the first point always gets a "+" even if it is an event.
- Invisible hover circles (size 10) on every point; hover → circle fill 0.3 + tooltip.
- Curves with >1000 patients: down-sampled hit points (hypotenuse threshold over plot px) `[C]`.

**CMP-KM-4 Point tooltip** `[C]`
- "Patient ID: <link to patient view>"
- "Curve: <curve name>"
- "% event free: xx.xx%"
- "Time of event: x.xx months" / "Time of last observation: x.xx months (censored)"
- "Number of patients at risk: n" (CMP-STM-1 at-risk of that row)
- Stays open while hovered.

**CMP-KM-5 Legend & p-value**
- Legend at right (x = width − 300): square per curve with data, label = curve name. No click interaction in comparison.
- "Logrank Test P-Value: <p>" at (910, 30). Shown when p non-null (≥2 curves).
  - If `survival_show_p_q_values_in_survival_type_table` is false and any curve has <10 patients → "N/A (<10 cases in a group)".

**CMP-KM-6 Number-at-risk table (inside SVG, under the x axis)**
- Row header "**Number at risk (n)**" then curve names.
- Columns at d3 `ticks(18)` of [0, slider]. Value = #patients in the curve with months ≥ t (no left-truncation adjustment).
- Labels that would overlap are thinned (keep every other). Seen at 0: 221 / 369 `[B]`.

**CMP-KM-7 Landmarks**
- Vertical dashed black lines at each entered value (y 0→103).
- Extra "**Landmark**" row block: per curve `(#months ≥ L) / (#patients) × 100`, 1 decimal + "%". Shown only if some landmark ≤ slider.
- Seen L=24: 48.0 % / 43.6 %; L=60: 10.0 % / 6.5 % `[B]`. Note: not a KM estimate (censored patients drop out).
- Landmarks do not change p-value or HR. Landmark log-rank/HR helpers exist but are never rendered (dead code).

**CMP-KM-8 Hazard-ratio mode** (CMP-STM-5)
- Legend replaced: first entry "<name>\nControl", others "<name>\nHR: x.xxx ( 95% CI: l.lll - u.lll )" or "<name>\nNA"; second line "Hazard ratio group" (12 px).
- Below chart: `<h4>` "Hazard ratio" + matrix table. Header row "*hazard ratio ( ±95% confidence interval)*" + curve names; cell (row i, col k) = "HR (lo-hi)", 3 decimals = HR of curve k vs curve i.
  - Seen RV: Altered row: 1.000 (0.672-1.488), 1.094 (0.760-1.575); Unaltered row: 0.914 (0.635-1.317), 1.000 (0.720-1.388) `[B]`.
- If not computable → "**Hazard ratio calculation failed**: Not enough groups / group size too small".

**CMP-KM-9 Summary table** ("Survival plot summary", always shown)
- Columns: (curve) | Number of Cases, Total | Number of Events | Median Months <title> (95% CI). One row per curve incl. empty ones (0, 0, "N/A").
- Seen RV OS: Altered 221 | 46 | NA; Unaltered 369 | 74 | 65.85 (51.48 - NA) `[B]`.

**CMP-KM-10 Data download (TSV)**
- Line 1 = title. Then per curve: blank line, curve name, TSV `Case ID, Study ID, Number at Risk, Status, Survival Rate, Time (months)`.
- Number at Risk = n − index (ignores left truncation). Status "deceased"/"censored" for every survival type (legacy wording). Survival Rate = estimate 0–1.

**CMP-KM-11** No data in any curve → alert-info "No data to plot."

---

## 5. Clinical tab (ClinicalData.tsx)

**CMP-CL-1 Guards:** active groups <2:
- if ≥2 selected-not-excluded → "Due to excluded overlapping cases, there are less than 2 selected nonempty groups - we need at least 2."
- else → "We need at least 2 groups to show clinical data enrichments. Please select more groups from the Groups section above."
- Otherwise: caution alert (CMP-SV-3 first text) + CMP-OX banner + table (600 px) | plot.

**CMP-CL-2 Attribute table** (ClinicalDataEnrichmentsTable.tsx)
- Rows = backend enrichments (CMP-STM-6/7), minus survival attributes (`<P>_STATUS`, `<P>_MONTHS`) and `AGE_LAST_FU_YEARS`, `BIRTH_YEAR`.
- Columns:
  - Clinical Attribute (160 px; bold if q < 0.05)
  - Attribute Type ("Patient"/"Sample")
  - Statistical Test ("Chi-squared Test" / "Wilcoxon Test" / "Kruskal Wallis Test")
  - p-Value (bold if q < 0.05; tooltip "p-value of null Hypothesis, derived from Chi-Squared test or Kruskal-Wallis test")
  - q-Value (bold if q < 0.05; tooltip "Derived from Benjamini-Hochberg FDR correction procedure.")
- Statistical Test, p and q are hidden by default when server `survival_show_p_q_values_in_survival_type_table` = false.
- Initial sort q asc; 20/page ("Show more"); text filter (name, type, test); column toggle; download TSV (shown only when downloads = show); no copy.
- Number format: `toConditionalPrecisionWithMinimum(v,3,0.01,−10)` (CMP-STM-10). Seen "Sex | Patient | Chi-squared Test | < 10^-10 | < 10^-10"; "Patient Weight | Patient | Wilcoxon Test | 3.86e-8 | 1.022e-6" `[B]`.
- Row click → highlight + plot. Default highlighted = first row once sorted. Changing row resets Swap Axes and Log Scale.

**CMP-CL-3 Plot controls** *(all local)*

| Control | Default | Shown when |
|---|---|---|
| Visualisation type select: Plot \| Table | Plot | numeric attribute |
| Plot Type select: Bar chart \| Stacked bar chart \| 100% stacked bar chart \| Heatmap \| Table | 100% stacked bar chart | categorical attribute |
| ☐ Swap Axes | off | not Table |
| ☐ Horizontal Bars | off | categorical, not Heatmap/Table |
| ☐ Log Scale | off | numeric; log2(max(x, 0.01)), axis label + " (log2)" |
| ☑ Show NA | on | attribute datatype string |
| ☐ Show p and q | off | not Table, not Heatmap; draws "p …" / "q …" label on the plot |

- Download (SVG/PNG/PDF; heatmap → oncoprint SVG) above the plot, not in Table mode; filename `clinical-plot-svg`.

**CMP-CL-4 Plot data**
- Fetch the highlighted attribute for active-group samples (sample attr) or patients (patient attr). Patient values are copied to **every sample** of the patient, so the plot counts samples.
- Case-insensitive value merge: first-seen spelling wins.
- Group axis = sample → group `nameWithOrdinal` list (a sample in several groups in Include mode counts in each). Category order = group order.
- Show NA (string only): session samples (minus overlapping samples/patients in Exclude mode) without a value → "NA". Off → values equal (case-insensitive) to any `comparison_categorical_na_values` entry (default "NA", `|`-separated) are dropped.
- Colours: group colours by "(A) name" + reserved clinical value colours.
- Axis labels: "Group" and attribute displayName. Counts axis "<attr># samples (%)" (seen "Sex# samples (%)") `[B]`.
- Numeric → box+scatter (uses box plot, see 04-plots.md); box width 30 if >7 groups else 60; tooltip = summary table Maximum / 75% (q3) / Median / 25% (q1) / Minimum, 2 decimals.
- Numeric Table → "Data description": Count, Minimum, Maximum, Mean, Standard Deviation (population, ÷n), Median, "Mean Absolute Deviation" (actually median absolute deviation — legacy label bug), 25% (q1), 75% (q3); 2 decimals.
- Categorical Table: rows = categories, columns = groups, cells = counts.
- 100 % stacked: % = count ÷ group total × 100, 2 decimals.

---

## 6. Results View › Comparison/Survival tab — differences only (ComparisonTab.tsx, ResultsViewComparisonStore.ts)

**CMP-RV-1 Tab label:** "Comparison/Survival" if survival data exists, else "Comparison"; tab hidden while that check is pending. Legacy route `/results/survival` → redirects to `/results/comparison/survival`.

**CMP-RV-2 Sub-tabs** (secondary nav, path `/results/comparison/<subtab>`; legacy `comparison_subtab` param):
- Overlap | Survival | Clinical | Genomic Alterations | mRNA | Protein | DNA Methylation | generic-assay tabs.
- No Mutations or Pathways sub-tab. Same visibility rules as CMP-PG-4.
- Legacy subtab values `mutations`/`cna` → `alterations` + preset event types.

**CMP-RV-3 Groups** (ResultsViewComparisonUtils.ts, ResultsViewPageStore.ts:1035-1115)
- "Altered group": filtered samples with ≥1 OQL-matched alteration. Description "Samples|Patients with at least one alteration in [the OQL specification for ]your queried genes in the selected profiles."
- "Unaltered group": profiled, unaltered.
- "Unprofiled group": totally unprofiled samples; only if present and `hide_unprofiled_samples` ≠ `totally`.
- One group per OQL line / oncoprint track: name = merged-track label, or genes joined " / " (default OQL), or the OQL line without ";". Duplicates by name dropped. Seen "KRAS (222)".
- User-created groups from `comparison_createdGroupsSessionId` session (overlap tab), appended last.
- Default selected: Altered + Unaltered only `[B]`. No ordinals; names shown bare.
- Groups are always sample sets; patient-level flag only changes the `count`.
- With KRAS selected too it is fully overlapping → "KRAS is completely overlapping with other selected groups and is excluded in other tabs." `[B]`

**CMP-RV-4 Layout:** banners above selector:
- OQL status banner (`tabReflectsOql`)
- AlterationFilterWarning
- CaseFilterWarning (see 01-oncoprint RV-3)
- Then group selector (collapse threshold 40) left, overlap-strategy select right.

**CMP-RV-5 URL params:**
- `comparison_selectedGroups`, `comparison_groupOrder`, `comparison_overlapStrategy`
- `comparison_createdGroupsSessionId` (session prop)
- `comparison_selectedEnrichmentEventTypes`

**CMP-RV-6 Left truncation** (CMP-SV-8) gated by feature flag in both RV and GC stores.

---

## 7. Modes and conditions

| ID | Condition | Expected behavior |
|---|---|---|
| CMP-MD-1 | Exclude (default) | Overlapping samples and patients are removed from each group; fully-overlapped groups are excluded (struck-through button) and leave all non-Overlap tabs; survival = one curve per group |
| CMP-MD-2 | Include | Groups used as-is; survival curves become exclusive patient partitions ("Only …"); clinical counts a sample in each of its groups; banner warns |
| CMP-MD-3 | No overlap among selected | Strategy select hidden; no CMP-OX banner |
| CMP-MD-4 | 1 group selected | Overlap msg; Clinical greyed + msg; Survival: single curve, no p, HR checkbox disabled |
| CMP-MD-5 | >3 selected | UpSet instead of Venn |
| CMP-MD-6 | >10 active groups | Survival tab hidden; deep link shows the too-many message |
| CMP-MD-7 | Single survival prefix | No survival-type table; that plot shown directly |
| CMP-MD-8 | Multi-study | Header "Multiple studies"; survival title from first study's displayName; multi-description warning |
| CMP-MD-9 | Group references missing samples | ⚠ icon on its button; missing samples ignored everywhere |
| CMP-MD-10 | Curve ≤10 patients | Excluded from control-group options and HR (CMP-STM-5); p-value still computed (no minimum) |
| CMP-MD-11 | Logged in | "Save group to user account" checkbox; duplicate check includes user's groups `[C]` |
| CMP-MD-12 | GENIE BPC NSCLC + flag | Left-truncation checkbox on OS |
| CMP-MD-13 | Server `survival_show_p_q_values_in_survival_type_table=false` | Survival table hides p/q; KM p shows "N/A (<10 cases in a group)" when any curve <10; clinical table hides test/p/q by default |

---

## 8. Persistence summary

**URL (GC page):**
- `comparisonId`/`sessionId`, path tab
- `unselectedGroups`, `groupOrder`, `overlapStrategy`
- `patientEnrichments`, `selectedEnrichmentEventTypes` (session prop), `selectedGene`, `axisMode` (molecular tabs; 21-comparison-molecular)

**URL (RV):** `comparison_*` params (CMP-RV-5) + path subtab.

**Session service:** groups (name, description, studies{id, samples}, origin, color), `origin`, `clinicalAttributeName`, optional `groupNameOrder`. Logged-in "save to user" also stores the group.

**Not persisted (local):**
- Venn/UpSet selections, new-group name
- Survival: selected prefix, min-patients threshold, column visibility, HR toggle, control group, landmarks, slider, left-truncation toggle
- Clinical: highlighted row, plot type, visualisation type, swap/horizontal/log/NA/p&q toggles
- Collapse state

---

## 9. Statistics & methods

Cases: "active groups" = selected, non-empty, overlap-removed in Exclude mode (`ComparisonStore.ts:364-390`).

**CMP-STM-1 Kaplan-Meier estimator** (`SurvivalUtil.ts:104-245`)
- Patient-level. One record per patient in a curve, kept only if (SurvivalStoreHelper.ts:6-64):
  - both `P_STATUS` and `P_MONTHS` exist;
  - neither is a null value (`[not applicable]`, `[not available]`, `[pending]`, `[discrepancy]`, `[completed]`, `[null]`, `""`, `na`; trimmed, case-insensitive);
  - months is numeric and ≥ 0;
  - entry months ≤ months.
- Status: event iff value is `"1:<label>"` (prefix before ":" equals "1"). Any value without ":" counts as censored (legacy behavior).
- Sort: months asc, events before censored at the same time.
- At risk at row i (sorted, 0-based): n − i. With left truncation (any entry ≠ 0): #{entry < tᵢ} − i.
- Estimate: each event row multiplies S by (atRiskᵢ − 1)/atRiskᵢ. Censored rows carry S forward. Tied events give the standard ∏(1 − d/n).
- Greenwood SE, computed once per distinct event time (at its last tied event): Σ d/(n(n−d)) with n = at risk before the tie; SE = S·√Σ.
- 95 % CI is log-transformed, matching R `survfit conf.type="log"` (SurvivalHelper.ts:8-26): exp(ln S ± 1.959964·SE/S); upper capped at 1; S = 0 → NaN.

**CMP-STM-2 Median & CI** (`SurvivalUtil.getMedian:303-354`)
- Median = months of the first row with S ≤ 0.5. Lower CI = first row whose CI-low ≤ 0.5; upper = first row whose CI-high ≤ 0.5. All `toFixed(2)`.
- Output strings: "NA" (S never ≤ 0.5), "m", "m (lo - NA)", "m (NA - hi)", "m (lo - hi)". No midpoint rule for a flat 0.5 segment.
- KM summary table uses the CMP-STM-1 sort. Survival-type table medians sort by months only (no event-first tie order), so medians can differ slightly at ties — legacy quirk (Survival.tsx:429-440).

**CMP-STM-3 Log-rank test** (`logRankTest.ts:94-313`; port of UCSC Xena km.js; validated against R `survdiff` in `logRankTest.spec.ts`)
- Pooled table: at each distinct time with ≥1 event, d = total events and N = total at risk. Per group: Oᵢ = #events; Eᵢ = Σ nᵢ(t)·d/N.
- Groups with Eᵢ = 0 are dropped; df = k′ − 1.
- Hypergeometric covariance: Vᵢᵢ = Σ d·nᵢ(N−nᵢ)(N−d)/(N²(N−1)); Vᵢⱼ = −Σ d·nᵢnⱼ(N−d)/(N²(N−1)). N = 1 terms are skipped.
- χ² = (O−E)ᵀ V⁻¹ (O−E) on the first k′−1 groups. p = 1 − χ²cdf(χ², df) (jStat). With 2 groups this is the standard log-rank test, no continuity correction.
- Not computed (null → no p text, "N/A" in table) when <2 analysis groups or df = 0. No minimum group size for the p-value.
- Input = curves of CMP-SV-4. Empty curves are passed and dropped by E = 0.

**CMP-STM-4 Survival-type q-values** (Survival.tsx:255-280): BH (CMP-STM-8) over non-null p-values across all prefixes.

**CMP-STM-5 Hazard ratio** (`logRankTest.calculatePairWiseHazardRatio:315-397`; validated against R `(O2/E2)/(O1/E1)` from `survdiff`)
- Uses Oᵢ, Eᵢ from CMP-STM-3. HR(i vs j) = [Oᵢ/(Eᵢ+0.0001)] / [Oⱼ/(Eⱼ+0.0001)].
- 95 % CI = exp(ln HR ± 1.959963984540054·√(1/Eᵢ + 1/Eⱼ)). The diagonal gives HR 1 with a non-degenerate CI (seen 1.000 (0.672-1.488)).
- Not a Cox model.
- Eligible curves: all with data if every one has >10 patients (`MIN_GROUP_SIZE_FOR_LOGRANK = 10`, strict >); else only curves with >10, control first.
- Display index mapping (SurvivalChart.tsx:1008-1076, 1660-1720) — **legacy bug**:
  - Label lookup uses `props.analysisGroups[i]`, while the HR rows are in "eligible curve" order.
  - The control column index comes from the control-select option order (data insertion order).
  - Groups dropped for E = 0 shift indices further.
  - Effect: when curves are dropped/reordered (small groups, empty curves, Include mode), HRs and CIs can sit under the wrong names.
  - In Include mode the control matching compares `legendText` (JSON) with value ("a,b"), so it never matches. Legend "Control" lands on the first curve while the select shows another (seen select "Female,Mixed", legend "Only (A) Female Control") `[B]`.

**CMP-STM-6 Clinical tab — categorical** (backend `ClinicalDataEnrichmentUtil.java:92-171`, `ClinicalDataServiceImpl.java:177-290`)
- Request: one group per active group = its sample identifiers (missing samples dropped; empty groups dropped server-side).
- Attributes: all STRING attributes of involved studies, deduped by (attrId, patientAttribute).
- Counts per group: sample attribute → per sample; patient attribute → per distinct patient of the group's samples.
  - Values "NA", "NAN", "N/A" (case-insensitive) and missing are removed.
  - Values matching `comparison.categorical_na_values` (default "NA") are removed.
  - Value matching is exact (case-sensitive), unlike the plot.
- Test needs ≥2 categories over all groups. Groups whose counts are all 0 are dropped. Then ≥2 groups and a valid table.
- Pearson χ² test of independence on groups × categories (Datumbox `Chisquare`, df = (r−1)(c−1), no Yates correction). Score = χ² (not shown).

**CMP-STM-7 Clinical tab — numeric** (`ClinicalDataEnrichmentUtil.java:15-90`)
- NUMBER attributes. Values: sample attributes per sample; patient attributes per distinct patient; attributes that are patient-level in some studies and sample-level in others are expanded to one value per sample. Non-numeric strings are dropped (`NumberUtils.isCreatable`).
- Needs ≥2 groups with values and ≥2 distinct values overall; NaN p dropped.
- Test = Kruskal-Wallis H with tie correction (H / (1 − Σ(t³−t)/(n³−n))), χ² with k−1 df (Datumbox `KruskalWallis`).
- Method label "Wilcoxon Test" when exactly 2 non-empty groups were sent (by group count, not per attribute), else "Kruskal Wallis Test". With 2 groups this equals a two-sided Wilcoxon rank-sum, normal approximation, tie-corrected, no continuity correction.
- Score = χ²⁻¹cdf(p, k−1) (not shown).
- Plot vs test mismatch — legacy quirk: the plot counts samples (patient values copied to every sample, CMP-CL-4); the test counts patients.

**CMP-STM-8 q-values (BH)** (`BenjaminiHochbergFDRCalculator.ts`; clinical: `ComparisonStore.ts:2750-2779`)
- p sorted ascending (n values). Going from largest to smallest: q₍ₙ₎ = p₍ₙ₎; q₍ᵢ₎ = min(q₍ᵢ₊₁₎, p₍ᵢ₎·n/i). Not capped at 1 (inputs ≤ 1).
- Clinical: n = **all** enrichments returned, including survival `_STATUS`/`_MONTHS` attributes that the table hides. So q-values use a larger n than the visible rows — legacy quirk. Seen "Showing 1-20 of 45".
- Bold / "significant" threshold q < 0.05.

**CMP-STM-9 Overlap computation & exclusion** (`GroupComparisonUtils.getOverlapComputations:852-938`)
- Overlapping samples = (study, sample) in ≥2 selected groups. Overlapping patients = (study, patient) in ≥2 selected groups, where group patients = patients of its existing samples.
- Iterate:
  1. Remove overlapping samples and patients from every group.
  2. If some groups become empty, mark the **last** empty one excluded and recompute overlap without it.
  3. Repeat until no group empties.
- `totalSampleOverlap` / `totalPatientOverlap` = union over iterations (drives CMP-PG-3, CMP-OX). The banner count N = overlap among the final remaining groups.
- Exclude mode: active groups = these filtered groups (non-empty). Sample lists and patient lists are filtered **independently**:
  - Survival uses the group's filtered patient list, so overlapping patients are dropped from all curves.
  - Clinical-tab backend tests receive only sample ids. A patient whose *different* samples sit in different groups keeps those samples, so patient attributes still count that patient in both groups — legacy quirk `[C]`.
- Include mode: groups unchanged. Excluded groups still feed the banner, but no button strike-through.

**CMP-STM-10 Number formats**
- `toConditionalPrecision(v,3,0.01)`: 1e-6 ≤ v < 0.01 → `toExponential(3)`; else `toPrecision(3)`.
- `…WithMinimum(…, −10)`: v = 0 or log10 v < −10 → "< 10^-10".
- KM p-value text uses `toConditionalPrecision(p,3,0.01)`.
- HR 3 decimals; median/CI 2 decimals; tooltip % 2 decimals; landmark % 1 decimal.

**CMP-STM-11 Counts**
- Group button: #existing samples; #distinct patients via sample→patient map.
- Survival "Number of Patients" = #patients with valid survival data that belong to any curve.
- "# in group" = per-curve count.
- Number at risk = #(months ≥ t). Landmark % = #(months ≥ L)/n.
