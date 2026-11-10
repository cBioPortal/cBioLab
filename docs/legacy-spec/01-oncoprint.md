# Legacy parity spec — Results View › OncoPrint

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.
Tooltips did not render in headless Chromium, so §8 is `[C]`.

Reference queries (single study, rich data):
- `/results/oncoprint?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS NRAS BRAF TP53 APC`
- Add `&clinicallist=NO_CONTEXT_MUTATION_SIGNATURE,CANCER_TYPE_DETAILED,AGE,SEX,FRACTION_GENOME_ALTERED,MUTATION_COUNT&heatmap_track_groups=coadread_tcga_pan_can_atlas_2018_rna_seq_v2_mrna_median_Zscores,KRAS,TP53`

Key files: `src/shared/components/oncoprint/*` (ResultsViewOncoprint, controls/OncoprintControls, OncoprintUtils,
geneticrules, SortUtils, TooltipUtils, tabularDownload), `src/pages/resultsView/oncoprint/TracksMenu.tsx`,
`packages/oncoprintjs/src/js/*`, `src/shared/alterationFiltering/SettingsMenu.tsx`.

---

## 0. Shared Results-View chrome (affects OncoPrint; the other tabs reuse it)

**RV-1 Header**
- Study name link.
- "All samples (N samples/patients)" with a case-set link.
- Gene summary with a ✎ edit icon.
- "Queried genes are altered in X (Y%) of queried patients/samples".
- Share-link button.
- Buttons: [Modify Query] and [⚙ sliders] (global settings).

**RV-2 Global settings menu (sliders)**

*Annotate Data → Driver annotations:*

| Option | Default | Shown when |
|---|---|---|
| ☑ OncoKB | `oncoprint_oncokb_default` | `show_oncokb`; disabled with an error icon if OncoKB fails |
| ☑ Hotspots | `oncoprint_hotspots_default` | `show_hotspot` |
| ☐ Custom binary driver | `…binary_default` | server label set and study has the data `[C]` |
| ☐ One per custom tier | `…tiers_default` | server label set and tiers exist `[C]` |

- "Drivers annotated" = any of these is checked.

*Filter Data:*
- ☐ Show only drivers — disabled unless drivers are annotated; removes VUS mutations, CNAs and SVs.
- ☐ Show only somatic — URL `exclude_germline_mutations=true`.
- ☐ Show only profiled — URL `hide_unprofiled_samples`, with radios:
  - "Profiled in **all** queried genes/profiles" = `any`
  - "Profiled in **any**" = `totally`
- Driver checkboxes and Show-only-drivers are store state, not URL. Defaults come from server config.

**RV-3 Banners above the oncoprint** `[C]`
- OQL status, shown only if the query has OQL:
  - "…does not affect…" (unaffected)
  - "…filtered by the OQL specification…" (success)
  - "…not filtered…" (info)
- AlterationFilterWarning: counts hidden VUS and germline, with a Show/Hide toggle.
- CaseFilterWarning: "N samples/patients not profiled for all|any queried genes… included|excluded from analysis".
- RestoreClinicalTracks: "Your previously saved clinical tracks have been applied." [Keep Saved Tracks] [Revert to Previous Tracks] ×.

**RV-4 Loading** `[C]`
- Spinner + progress list:
  1. "Querying N genes in M samples" (adds "- this can take several seconds" after 2 s)
  2. "Loading genetic and clinical data"
  3. "Annotating with OncoKB™ and Cancer Hotspots" (or a variant)
  4. "Rendering"
- No WebGL → message instead of the oncoprint, and no controls.

---

## 1. Toolbar — order: Tracks | Sort | Mutations | View | Download | Zoom | Minimap

### ONC-TR — Tracks dropdown
Tabbed panel; a tab is hidden when empty; each tab label shows a count badge.
Seen: Clinical 64 · Heatmap 6 · Arm-level CNA 1 · Genetic Ancestry 1 · Methylation 2.

**ONC-TR-1 Clinical tab**

*Header row:*
- [Select all (N)] [Deselect all] buttons.
- Search box.
- [📌 Save tracks].
- Table columns: Name checkbox, Freq (% samples with data).

*Row order:*
1. Study of origin
2. Mutation spectrum
3. Profiled-in attributes
4. Rest sorted by freq desc, then priority, then name

*Applying changes:*
- Ticking rows stages them. An [Update tracks] button appears when staged ≠ applied; clicking applies and closes `[C]`.
- Select all / Deselect all apply immediately `[C]`.

**ONC-TR-2 Heatmap tab** (hidden if multi-study)
- Profile `<select>` lists:
  - mRNA / protein z-score profiles
  - methylation
  - "Variant Allele Frequency in Selected Mutations Profile" (only if alt/ref counts exist)
  - GSVA
- Order: selected first; mRNA → protein → methylation → VAF; GSVA last.
- Gene textarea, prefilled with the query genes, with a validity badge ("All gene symbols are valid.").
- [Add Genes to Heatmap]:
  - Disabled if any gene is invalid.
  - Replaces that profile's genes.
  - URL `heatmap_track_groups=prof,G1,G2;prof2,…`.
- Optional [Whole Study Heatmap (NG-CHM) ↗] with a confirm modal (server `show_mdacc_heatmap`) `[C]`.

**ONC-TR-3 Generic-assay tabs** (one per GA type; single-study only)
- Profile select.
- Searchable entity multi-select ("Search for <type>..."). Gene-related entities are listed first.
- [Select all] / [Clear all], shown when ≤50 options.
- Chart type radios:
  - Separate rows (heatmap) `[default]`
  - Separate rows (bar chart)
  - Stacked bar (composition)
  - Stacked bar (absolute)
- [Add Track] → URL `generic_assay_groups`, plus `generic_assay_bar_profiles`, `generic_assay_stacked_profiles` or `generic_assay_stacked_absolute_profiles`.
- An empty submit removes that profile's tracks.

**ONC-TR-4 Other tabs** `[C]`
- Groups: comparison groups as "In group: X", Yes/No.
- Custom Charts: study-view custom data.
- Same Update-tracks / Save behavior as Clinical.

### ONC-SO — Sort dropdown (radio group)
- **ONC-SO-1** ◉ Sort by data `[default]` (URL `oncoprint_sortby` absent). Sub-checkboxes:
  - ☑ Mutation Type — URL `oncoprint_sort_by_mutation_type`. Disabled unless sorting by data AND Color-by-Type is on.
  - ☑ Driver — URL `oncoprint_sort_by_drivers`. Disabled unless drivers are annotated.
  - ☐ Ignore VUS — URL `oncoprint_sort_by_drivers_ignore_vus`. Disabled unless Driver is on and VUS are not hidden. Tooltip "Order columns as if alterations of unknown significance were absent…".
- **ONC-SO-2** ○ Sort by case id (alphabetical) → `case_id`.
- **ONC-SO-3** ○ Sort by case list order → `case_list`. Disabled unless the query used explicit sample IDs.
- **ONC-SO-4** ○ Sorted by heatmap clustering order:
  - Always disabled (indicator only).
  - Checked when `oncoprint_sortby=cluster`.
  - Shown only when heatmap profiles exist.
- **ONC-SO-5** Choosing SO-1, SO-2 or SO-3 clears `oncoprint_cluster_profile`.

### ONC-MU — Mutations dropdown
- **ONC-MU-1** Color by ☑ Type *(local)* — off draws all mutations green (§3).
- **ONC-MU-2** Color by ☑ Somatic vs Germline *(local)* — off removes the germline stripe and its legend.
- **ONC-MU-3** "Annotate and Filter: Please see the [⚙] menu." — the button opens RV-2.

### ONC-VI — View dropdown
- **ONC-VI-1** ○ Events per sample / ◉ Events per patient `[default patient]`:
  - URL `show_samples=true|false`.
  - Default comes from server `oncoprint_defaultview`.
- **ONC-VI-2** ☑ Show unaltered columns *(local)* — off hides columns with no genetic alteration.
- **ONC-VI-3** ☑ Show whitespace between columns *(local)* — auto-off when cell width < 2 px.
- **ONC-VI-4** ☑ Show legends for clinical tracks *(local)*.
- **ONC-VI-5** ☐ Only show clinical track legends for altered patients/samples. *(local)*:
  - Indented under VI-4; disabled when VI-4 is off.
  - Wording follows the column mode.
- **ONC-VI-6** Show OQL filters *(local)*:
  - Default ☑ iff the query has OQL.
  - Shows a gray OQL sublabel after gene labels (never for merged tracks).
- **ONC-VI-7** ☐ Use white background (Caution: profiled and unprofiled samples look identical and germline mutations might be hidden):
  - URL `enable_white_background_for_glyphs`.
  - White base cell and white heatmap null color.

### ONC-DL — Download dropdown
- Order: PDF | PNG | SVG | "Sample order"/"Patient order" | Tabular | Open in Oncoprinter | Open in JupyterNoteBook **Beta!**
- **ONC-DL-1** Hide rules `[C]`:
  - Whole menu hidden if `skin_hide_download_controls=HIDE_ALL`.
  - The last three are shown only when it is `show`.
- **ONC-DL-2** Images (labels + headers + track info + cells + legend):
  - `oncoprint.pdf`
  - `oncoprint.svg`
  - `oncoprint.png` — 2×, white background; alert "Oncoprint too large - PNG truncated to WxH" when too large.
- **ONC-DL-3** Order file `OncoPrintSamples.txt` / `OncoPrintPatients.txt`:
  - First line "Sample order in the Oncoprint is:", then one ID per line.
  - Current visible order.
- **ONC-DL-4** Tabular `SAMPLE_DATA_oncoprint.tsv` / `PATIENT_DATA_oncoprint.tsv`:
  - Header: `track_name  track_type  <ids in visible order>`.
  - Rows, in group order:
    1. CLINICAL (counts tracks: one row per category, "Label (C>A)")
    2. CNA
    3. MUTATIONS
    4. MRNA
    5. PROTEIN
    6. STRUCTURAL_VARIANT
    7. `HEATMAP <ALTTYPE> <DATATYPE>`
  - Values like "Amplification" or "Missense Mutation (putative driver)".
  - Legacy quirk: splice, other and SV rows emit raw codes such as `splice_rec` and `sv_rec`.
- **ONC-DL-5** Open in Oncoprinter — opens `/oncoprinter` prefilled with genetic, clinical and heatmap data. GSVA not supported (shows an alert).
- **ONC-DL-6** Jupyter — modal; exports a mutations CSV and opens a notebook `[C]`.

### ONC-ZM — Zoom (horizontal only)
- **ONC-ZM-1** Controls: 🔍− (×0.7) | slider 0–1 (applies on release) | editable % box (≤3 digits) | 🔍+ (÷0.7).
- **ONC-ZM-2** Initial zoom fits the *altered* columns (seen: 30% for 594 patients). Refits on data change until the user zooms. Max zoom is 100%.
- **ONC-ZM-3** Drag-select zoom:
  - Horizontal mouse drag over cells draws a gray overlay.
  - Release zooms to fit the enclosed columns.
  - A move under 10 px is a click.

### ONC-MM — Minimap toggle (⛶ button; `active` state; default hidden)
- 150×150 floating panel, draggable, with a ⊗ close button that syncs the toolbar toggle.
- Viewport rectangle: drag to pan; drag edges to zoom.
- Horizontal and vertical zoom sliders.
- Zoom-to-fit button.

---

## 2. Layout and track groups

**ONC-LY-1 Vertical order**
1. Clinical group (includes Profiled-in tracks)
2. Genetic group
3. Heatmap and GA groups, in the order added
4. GSVA group last
- A gap separates groups.
- The legend sits below, ordered: Genetic Alteration first, then clinical, then heatmaps.

**ONC-LY-2 Track rows**
- Left to right: label (bold, truncated to 18 chars + "...") | ⋮ track menu (shown on hover) | track info (genetic % altered) | cells.
- Hover on a cell highlights the track label (yellow) and outlines the column.

**ONC-LY-3 Default tracks when no saved or URL config**
- Precedence: URL `clinicallist` → user's saved session config → server `oncoprint_clinical_tracks_config_json` → defaults.
- Defaults:
  - "Profiled in <profile>" for each queried profile — seen: Mutations, Putative CNA from GISTIC, Structural variants.
  - "Study of origin" if multi-study.
  - "# Samples per Patient" if #samples > #patients.

**ONC-LY-4 Track info, genetic tracks** — % altered; see ST-M1 for the method.
- Display: "<1%" for values above 0 and under 1, otherwise an integer %.
- "N/P" when nothing is profiled.
- "*" suffix when only some cases are profiled.

**ONC-LY-5 Labels**
- Gene symbol.
- Merged OQL `[A B]` → "A / B", or the user label for `["LBL" A B]`.
- One track per OQL line, so the same gene can appear twice.

**ONC-LY-6** No column labels and no vertical scroll (the oncoprint grows in height). Horizontal scrollbar under the cells.

---

## 3. Genetic track glyphs

All glyphs stack in one cell, in this z-order:

| Event | Shape | Color (driver / VUS) | Legend label |
|---|---|---|---|
| none | full cell | `#BEBEBE` (white with VI-7) | No alterations (legend last) |
| not profiled | white + gray mid-line | — | Not profiled |
| AMP | full | `#ff0000` | Amplification |
| GAIN | full | `#ffb6c1` | Gain |
| HOMDEL | full | `#0000ff` | Deep Deletion |
| HETLOSS | full | `#8fd8d8` | Shallow Deletion |
| mRNA high / low | outline, 2px | `#ff9999` / `#6699cc` | mRNA High / Low |
| Protein high / low | top / bottom 20% | `#ff3df8` / `#00E1FF` | Protein High / Low |
| Structural variant | inset 20–80% height | `#8B00C9` / `#ce92e8` | Structural Variant (putative driver / unknown significance) |
| Missense | middle third | `#008000` / `#53D400` | Missense Mutation (…) |
| Inframe | middle third | `#993404` / `#a68028` | Inframe Mutation (…) |
| Truncating | middle third | `#000000` / `#708090` | Truncating Mutation (…) |
| Splice | middle third | `#e5802b` / `#f0b87b` | Splice Mutation (…) |
| Promoter | middle third | `#00B7CE` / `#8cedf9` | Promoter Mutation (…) |
| Other | middle third | `#cf58bc` / `#f96ae3` | Other Mutation (…) |
| Germline | white stripe, y 46–54% | `#FFFFFF` | Germline Mutation |

- **ONC-GL-1 Rule sets** (Type × drivers annotated):

  | Color by Type | Drivers annotated | Mutations drawn as | Legend |
  |---|---|---|---|
  | off | off | all green | "Mutation" |
  | off | on | green / light green | "Mutation (putative driver/unknown significance)" |
  | on | off | per-class driver colors | "Missense Mutation" etc. |
  | on | on | full table | full labels |

  CNA has no driver/VUS visual split.
- **ONC-GL-2 Mutation class map**
  - frameshift, nonsense, nonstart, nonstop, fusion → Truncating
  - in-frame indels → Inframe
  - splice → Splice
  - proteinChange "promoter" → Promoter
  - unknown → Other
- **ONC-GL-3 Multiple events in one cell:** one glyph per layer.
  - Mutation priority: trunc > splice > inframe > promoter > missense > other, drivers before VUS, ties by count.
  - CNA: amp/homdel before gain/hetloss.
  - Germline stripe if any shown mutation is germline.
- **ONC-GL-4 Default OQL** per profile:
  - `MUT`
  - `AMP HOMDEL` (gain and shallow deletion are **not** shown by default)
  - `EXP≥±z`
  - `PROT≥±z`
  - `FUSION`
- **ONC-GL-5 Driver** = OncoKB oncogenic OR hotspot OR custom binary OR selected custom tier (each source only if enabled). Definitions in ST-M11.
- **ONC-GL-6 Legend** lists only the categories present in the data.

---

## 4. Other track types

| ID | Track | Rendering | Legend |
|---|---|---|---|
| ONC-TT-1 | Clinical string | categorical colors (see below); multi-valued case → "Mixed" | swatches + "No data" |
| ONC-TT-2 | Clinical number | green bars (negative values red); MUTATION_COUNT log scale, 0 when missing; FGA range [0,1] | min▲max ramp + "No data" |
| ONC-TT-3 | Mutation spectrum (counts) | stacked bar C>A `#3D6EB1`, C>G `#8EBFDC`, C>T `#DFF1F8`, T>A `#FCE08E`, T>C `#F78F5E`, T>G `#D62B23` | 6 swatches + No data |
| ONC-TT-4 | Profiled in X | Yes = teal, No = NA | Yes / No |
| ONC-TT-5 | Heatmap mRNA/protein | blue → black → red, −3…3 | "Expression Heatmap" |
| ONC-TT-6 | Heatmap methylation | blue → white → red, 0…1 | "Methylation Heatmap" |
| ONC-TT-7 | Heatmap VAF | `[241,242,181]`→`[19,80,88]`, 0…1; null "Not mutated/no VAF data" | "VAF Heatmap" |
| ONC-TT-8 | GA heatmap (LIMIT-VALUE) | diverging around the profile pivot (blue/red), reversed if sortOrder DESC; threshold values (">8") are meant to be categories but are dropped as NaN (legacy bug, ST-M7) | profile name |
| ONC-TT-9 | GA bar / stacked composition / stacked absolute | bars; one stacked track per profile, entity colors from a 20-color palette; composition = share of total, absolute = sum scaled to the global max | profile name |
| ONC-TT-10 | GA categorical | categorical, "Mixed" | profile name |
| ONC-TT-11 | GSVA | PiYG gradient −1…1 | "Gene Set Heatmap" |

**ONC-TT-1 reserved colors** `[C]`

| Values | Color |
|---|---|
| yes, true, positive, alive, living, disease/tumor free | `#1b9e77` |
| no, false, negative, deceased, recurred, progressed | `#d95f02` |
| female | `#E0699E` |
| male | `#2986E2` |
| unknown, na | `#D3D3D3` |

Other values get stable palette colors.

**ONC-TT-12 Patient-mode aggregation** `[C]`
- Clinical number: mean (MUTATION_COUNT: max).
- Spectrum: sum.
- Heatmap: value with the largest |x| (GA: min or max per sortOrder).
- String: "Mixed" if values differ.

---

## 5. Per-track ⋮ menu (observed item lists)

| Track | Items |
|---|---|
| Clinical string (e.g. Cancer Type Detailed, Sex) | Move up · Move down · Remove track · Sort a-Z · Sort Z-a · Don't sort track · Show Gaps · Show Gaps (w/%) · Edit Colors |
| Clinical number | Move up · Move down · Remove track · Sort a-Z · Sort Z-a · Don't sort track |
| Mutation spectrum | … · Don't sort track · Edit Colors (no gaps) |
| # Samples per Patient | + "Show one column per patient/sample." (switches VI-1) `[C]` |
| Genetic | Move up · Move down · Remove track (only if >1 genetic track) · Sort by genes; merged tracks add Expand / Remove expansion |
| Heatmap / GA row | Move up · Move down · Remove track · Sort a-Z · Sort Z-a · Don't sort track; GA adds "Chart type ▸" (4 options; Absolute omitted when values are fractions) |
| GA stacked | Move · Remove · Sort a-Z/Z-a/none · "Sort by ▸" Dominant category (default) / Total (absolute only) / each category → URL `generic_assay_stacked_sortby` · Chart type ▸ `[C]` |
| GSVA | Move · Sort · "Show  genes" / "More  genes" (adds 5 correlated genes; info = correlation) · Remove expansion `[C]` |
| **Group header** (heatmap profile, underlined title) | Cluster · Don't cluster · ─ · Delete; VAF + OQL adds "Apply OQL filter" / "Show all mutations"; GA adds chart-type options `[C]` |

- **ONC-TM-1** The current sort or gap option is shown in bold. Opening one menu closes the others.
- **ONC-TM-2 Effects**
  - Sort a-Z / Z-a / none sets the track's sort direction and forces data sort. Saved to the clinical config `sortOrder`.
  - Remove updates URL or session:
    - genetic → edits `gene_list` and re-queries
    - heatmap → `heatmap_track_groups`
    - GA → `generic_assay_groups`
  - Removing the clustered profile reverts to data sort.
- **ONC-TM-3 Gaps** (string clinical only)
  - Inserts a gap where the value changes.
  - "Show Gaps": gap = 1 cell. "(w/%)": 50 px gap plus a % altered label per segment on each genetic row.
  - Forces a-Z if the track was unsorted.
- **ONC-TM-4 Edit Colors** opens the modal "Color Configuration: <label>":
  - Value | Color table; swatch → circle color picker.
  - [Reset Colors] shown only when something was changed.
  - Saved in localStorage `clinicalTracksColorConfig`, keyed by track label across studies.
- **ONC-TM-5 Cluster**
  - Hierarchical clustering of the columns on that heatmap group; also reorders the group's rows.
  - URL `oncoprint_sortby=cluster&oncoprint_cluster_profile=<id>`.
  - Drag is disabled in a clustered group. Unclustering restores the row order.

---

## 6. Sorting (data mode)

- **ONC-ST-1 Key order**
  1. Clinical tracks with a direction
  2. Heatmap tracks with a direction
  3. Genetic tracks, top to bottom
  4. Not-profiled last
  5. Case id
- **ONC-ST-2 Per genetic track:** SV > CNA > mutation > germline > mRNA > protein.

  | Key | Order |
  |---|---|
  | CNA | amp > homdel > gain > hetloss > none (drivers split each level first) |
  | Mutation, Type + Driver | trunc_d > splice_d > inframe_d > promoter_d > missense_d > other_d > the same for VUS > none |
  | Mutation, Type only | by class |
  | Mutation, Driver only | driver > VUS > none |
  | Mutation, neither | mutated > not |
  | Germline | before somatic |
  | mRNA, protein | high > low > none |

- **ONC-ST-3 Ignore VUS** treats VUS as absent when ordering but still draws them.
- **ONC-ST-4 Comparators**
  - Clinical string: natural sort.
  - Number: numeric.
  - Counts: dominant category, then proportion.
  - NA always last.
- **ONC-ST-5** Re-sorts automatically when data or settings change.

---

## 7. Mouse interactions

- **ONC-MI-1 Hover cell** → black outline on the cell, column highlight, label highlight, and tooltip (§8) after 250 ms.
- **ONC-MI-2 Click cell** → no action; there is no persistent column selection in the Results View.
- **ONC-MI-3 Drag a track label vertically** → reorders within its group.
  - The dragged label is drawn red.
  - Not persisted.
  - Label tooltip says "hold to drag" (or "dragging disabled for clustered tracks").
- **ONC-MI-4** Drag over cells → zoom (ZM-3).
- **ONC-MI-5** Hover a label → full name (link for GSVA/GA entities) plus a description: the OQL line for genetic tracks, the attribute description for clinical tracks, "<gene> data from <profile>" for heatmap tracks.
- **ONC-MI-6** Hover track info → "X% altered (altered / profiled = a / b)", or "* = not all samples are profiled".

---

## 8. Cell tooltips `[C]`

- **ONC-TP-1 First line:** sample-id link (or patient-id link in patient mode) to the patient view.
  - Several cases under the cursor (zoomed out) → "View these N samples/patients" link.
- **ONC-TP-2 Genetic**, in order:
  1. "Structural Variant: A-B, <class>, Event Info: …" + OncoKB icon
  2. "Mutation: GENE p.X" + hotspot / OncoKB / custom-driver / tier icons, red "Germline", "(n)" for multiple cases
  3. "Copy Number Alteration: GENE AMPLIFIED|HOMODELETED|GAIN|HETLOSS" + icons
  4. "MRNA: GENE HIGH|LOW"
  5. "PROT: GENE HIGH|LOW"
  6. "Gene Panels: <panel link>" (click → popup with the gene list), "(gene not on panel)"
  7. Profiling status: "Profiled in all selected molecular profiles." / "Not profiled in selected molecular profiles." / "Profiled in: …" + red "Not profiled in: …"
  - Fusion-partner note when the gene is off-panel but detected in an SV.
- **ONC-TP-3 Clinical**
  - String: "Label: **v**" (+ "(n samples)"), or one line per value with counts.
  - Number: "**x.xx** (average of n values)".
  - Spectrum: each category in its color with a count.
  - Profiled-in: Yes / No.
- **ONC-TP-4 Heatmap:** "MRNA: / PROT: / METHYLATION: / VAF: / <GA type>: **x.xx**" (average of n), or "N/A".
- **ONC-TP-5 Stacked bar:** each category with its value (means; 4 decimals).

---

## 9. Modes and conditions (each must be checked)

| ID | Condition | Expected behavior |
|---|---|---|
| ONC-MD-1 | Patient vs sample mode | Changes columns, % denominators, clinical/heatmap aggregation, tooltip links, order-file name, and VI-5 wording |
| ONC-MD-2 | Multi-study / virtual study | "Study of origin" track by default; Heatmap and GA tabs hidden; profiled-in attributes per alteration type; "Not profiled in" lists alteration types the study lacks |
| ONC-MD-3 | Unprofiled samples | NA glyph, "*" on %, Profiled-in tracks auto-added; Show only profiled removes them (with banner) |
| ONC-MD-4 | Drivers not annotated (all sources off) | No driver/VUS split; Sort›Driver, Ignore VUS and Show only drivers disabled |
| ONC-MD-5 | VUS hidden | VUS removed; Ignore VUS disabled; banner |
| ONC-MD-6 | Germline present | Stripe + legend (if MU-2 on); sorted first; "Germline" in tooltip; Show only somatic removes |
| ONC-MD-7 | SVs present | Purple inset glyph, driver/VUS split, SV tooltip line |
| ONC-MD-8 | Single gene | Genetic track has no Remove |
| ONC-MD-9 | OQL query | One track per line; merged `[ ]` tracks expandable; VI-6 on by default; OQL banner; VAF group OQL toggle |
| ONC-MD-10 | Zero altered / empty | No special empty state; all-gray rows; "0%" or "N/P" |
| ONC-MD-11 | Large cohort | Progress text; zoom-to-fit altered columns; PNG truncation alert |
| ONC-MD-12 | Logged out | Save tracks disabled with "Log in to save clinical tracks." |
| ONC-MD-13 | Logged in | Save tracks enabled when changed; saved per study set; restore banner (RV-3) |

---

## 10. Persistence summary

**URL**
- `show_samples`
- `oncoprint_sortby` (`''` | `case_id` | `case_list` | `cluster`)
- `oncoprint_cluster_profile`
- `oncoprint_sort_by_mutation_type`
- `oncoprint_sort_by_drivers`
- `oncoprint_sort_by_drivers_ignore_vus`
- `enable_white_background_for_glyphs`
- `heatmap_track_groups`
- `generic_assay_groups`
- `generic_assay_{bar,stacked,stacked_absolute}_profiles`
- `generic_assay_stacked_sortby`
- `exclude_germline_mutations`
- `hide_unprofiled_samples`
- `clinicallist` (legacy; read once into the session; `null` = none)
- `#userSettingsJson={clinicallist,geneticlist}` hash (from share links)

**Session (user settings, per study set):** clinical tracks `{stableId, sortOrder, gapOn}` and the genetic list.

**localStorage:** clinical value colors.

**Not persisted:**
- Color-by toggles
- View checkboxes VI-2 to VI-6
- Zoom and minimap
- Track drag order
- Expansions
- Heatmap tab selection
- Driver-source checkboxes

---

## 11. Statistics & methods `[C]`

Every number the tab displays, with how it is computed.
"Filtered cases" = all queried cases, minus unprofiled ones when Show only profiled (RV-2) is on.
Paths are relative to cbioportal-frontend; oncoprintjs = `packages/oncoprintjs/src/js/`.

**ST-M1 Per-track % altered** (`OncoprintUtils.ts:857-960`, `ResultsViewPageStore.ts:2311`)
- Numerator: cases that are both altered and profiled. Altered = at least one OQL-matched event after the driver/VUS and germline filters.
- Denominator: filtered cases profiled for the gene in at least one selected profile.
  - Profiled = the gene-panel entry says profiled, and either the panel contains the gene or there is no panel (whole-exome / whole-profile).
  - Patient mode: a patient is profiled if any of its samples is, and altered if any of its samples is.
  - Merged OQL track: the union of its genes' profiled sets.
- Rounding: under 3% → 1 decimal (dropped if it is .0); otherwise integer. The track label then shows "<1%" or `Math.round`. The 1-decimal value appears only in the tooltip and SVG export.
- "N/P" when the denominator is 0.
- "*" when 0 < profiled < filtered cases. The tooltip then reads "* = not all samples are profiled".

**ST-M2 Header "Queried genes are altered in X (Y%) of queried patients/samples"** (`QuerySummaryUtils.tsx:30-70`)
- Numerator: filtered cases with an OQL-matched alteration in any queried gene. A patient counts if any of its samples does.
- Denominator: **all filtered cases**, not profiled-only (unlike ST-M1).
- Shows separate patient and sample lines when #samples ≠ #patients. Independent of the OncoPrint sample/patient toggle.
- Format: exactly 0 → "0%"; under 1 → "<1%"; otherwise rounded.

**ST-M3 Gap % labels** (Show Gaps (w/%); `OncoprintUtils.ts:1200-1288`)
- Per segment × genetic track: altered ÷ (profiled ∩ segment), with ST-M1's definitions.
- Segments come from the first gap-enabled clinical track only.
- Label: integer or "<1%". Tooltip: "X% (altered / profiled = a / b)".
- Legacy bug: shows "NaN%" when the segment has no profiled cases.

**ST-M4 Tracks-menu "Freq"** (`TracksMenu.tsx:242-256`)
- Formula: 100 × (samples with a value) ÷ **all queried samples**, not filtered. Server attributes use backend per-attribute counts summed across studies.
- Special attributes:
  - Study of origin, # Samples per Patient, Profiled-in: always 100%.
  - Mutation spectrum: % of samples sequenced.
  - Groups: % of samples in the group.
- Format: 1 decimal; "99.9%" for values from 99.9 up to (not including) 100; "<0.1%" below 0.1; "0%" disables the row.

**ST-M5 Clinical numeric tracks** (`DataUtils.ts:661-700`, `oncoprintruleset.ts:810-905`)

*Patient-mode aggregation*
- Mean of the parseable values (NaN dropped).
- MUTATION_COUNT: max over the patient's samples.
- Patient-level attributes are copied to each sample in sample mode.

*Bar scale*
- FRACTION_GENOME_ALTERED: fixed [0, 1].
- # Samples per Patient: [0, max]. Uses unfiltered samples.
- Others: [data min, data max]. If min = max, the range becomes [x/2, 1.5x].
- Non-negative data: height = (v − min)/(max − min). The smallest value gets a zero-height bar — legacy quirk.
- Data spanning 0: height = v/max(|min|, max), with negative values drawn downward.

*MUTATION_COUNT*
- Log scale: height = (ln(v+s) − ln(min+s)) / (ln(max+s) − ln(min+s)), where s = |min| + 1.
- Missing → 0, drawn as a bar rather than NA. Legacy bug: its tooltip shows "NaN".

*Legend:* min and max to 2 decimals.

**ST-M6 Mutation spectrum** (backend `MutationSpectrumServiceImpl`; `DataUtils.ts:711-744`)
- Per sample: counts of single-base substitutions across **all mutations in the study's mutation profile** (all genes; no type or driver filter).
- Collapsed to the pyrimidine strand: C>A includes G>T, C>G includes G>C, C>T includes G>A, T>A includes A>T, T>C includes A>G, T>G includes A>C.
- Patient mode: the counts are summed. All zero → NA.
- Each bar is normalized to its own total (composition). The tooltip shows raw counts for the first case under the cursor.

**ST-M7 Heatmap and generic-assay values** (`OncoprintUtils.ts:316-540, 713-797, 1912-2280`; `DataUtils.ts:385-500`)

*mRNA / protein / methylation / GSVA*
- Raw profile value.
- Color clamps: expression [−3, 3]; methylation [0, 1], midpoint 0.35; GSVA [−1, 1].

*VAF*
- Per mutation: tumorAltCount / (tumorAltCount + tumorRefCount). Integer counts are required.
- Per sample: **max** over that gene's mutations in the profile. Not OQL-filtered unless "Apply OQL filter" is on for queried genes.
- Profiled but not mutated (or no counts) → null, "Not mutated/no VAF data". Unprofiled → NA.

*Patient aggregation (all heatmaps)*
- The non-null value with the largest |x|, sign kept.
- Legacy bug: GA profiles ignore sortOrder, so this rule also applies to them.

*GA heatmap legend*
- Range: [min(0, profile min), max(0, profile max)], widened to include `pivotThreshold`. Shared across every track of that profile.
- Legacy bug: threshold strings like ">8.00" become NaN, so they render as no data and no threshold category legend appears.

*GA bar*
- Range [min(0, min), max]. If max ≤ min, it becomes min + 1.

*GA stacked composition*
- Per sample: the entity values. Per patient: the mean over its samples.
- Height = share of the case's total. Total 0 → NA.

*GA stacked absolute*
- Per patient: the sum over its samples.
- Height = case total ÷ the track's max total.
- The "absolute" option is hidden if every per-sample total is ≤ 1.01 (fraction-like data).

**ST-M8 Tooltip numbers** (`TooltipUtils.ts:96-368`)
- Multiple columns under the cursor (zoomed out): the **arithmetic mean** of the already-aggregated column values, shown as "x.xx (average of n values)". Trailing ".00" stripped for clinical values.
- Stacked: per-category mean, shown as integers if all are whole, otherwise to 4 decimals.
- String clinical: per-value sample counts. A patient contributes its per-sample counts.
- Genetic: "(n)" counts per alteration and per profiled status.

**ST-M9 Heatmap clustering** (`oncoprintmodel.ts:2297`, `workers/clustering-worker.ts`)
- Method: agglomerative hierarchical clustering (`tayden-clusterfck`), **average linkage**, distance = **1 − Spearman ρ**. ρ = Pearson correlation of fractional ranks (`jStat.rank`, `jStat.corrcoeff`).
- Both columns (cases) and rows (the group's top-level tracks) are clustered.
- Input: `profile_data` of the group's outer-level tracks; patient mode uses the patient-aggregated values.
- Special distances:
  - Both items all null/0 → distance 0.
  - One item all null/0 → distance 3; those items are appended at the end.
  - ρ = NaN → r = −2, so distance 3.
- No imputation. Legacy quirk: null ranks as 0, tied with real zeros, and undefined ranks highest.
- A one-track group is a plain ascending sort, with null/NaN last.

**ST-M10 Gene-set expansion correlation** (backend `GenesetCorrelationServiceImpl.java:203-245`)
- Method: **Spearman** (Apache `SpearmansCorrelation`) between gene-set scores and the linked raw expression profile, over the query's sample list (unfiltered).
- NaN pairs are dropped. Fewer than 2 pairs → 0.
- The frontend requests threshold 0, so only ρ ≥ 0 is kept. Sorted descending; each "Show/More genes" click adds the next 5.
- Display: `toFixed(2)` as track info. Legacy bug: the track-info formatter turns e.g. 0.85 into "<1" and NaN into "N/P".

**ST-M11 Driver / VUS definition** (`ResultsViewPageStoreUtils.ts:141-289`)
- Driver if any enabled source says so:
  - **OncoKB**: Oncogenic, Likely Oncogenic or Resistance. Predicted Oncogenic does not count. Germline: Pathogenic or Likely Pathogenic.
  - **Hotspot**: Cancer Hotspots *linear* hotspot via Genome Nexus (single residue, in-frame indel, or splice). 3D hotspots are not used.
  - **Custom binary**: `Putative_Driver`.
  - **Custom tier**: any selected tier.
- CNAs are drivers only via OncoKB or custom annotations, never hotspots.

**ST-M12 Default OQL thresholds** (`ResultsViewPageStore.ts:307-363`; `oqlfilter.ts:1005-1045`)
- `Z_SCORE_THRESHOLD` and `RPPA_SCORE_THRESHOLD` both default to 2.
- Default OQL: `EXP>=2 EXP<=-2` and `PROT>=2 PROT<=-2`, added only when that profile type is selected.
- Comparison is inclusive, on the raw value of the selected profile.

**ST-M13 Initial zoom** (`oncoprintmodel.ts:835-919`)
- zoom = (viewport width − gaps × gap size) ÷ (number of columns spanned × column width), clamped to [0, 1].
- The span runs from the leftmost to the rightmost altered column. No altered cases → 1.
- The % box shows round(100 × zoom).
