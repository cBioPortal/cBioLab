# Legacy parity spec — Results View › Mutations (owner: mutation table, lollipop / mutation mapper, annotation columns)

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.
`[B-new]` = seen on cbioportal.org but **absent from cd8c6df** (production is newer); spec it from the browser.
Most hover tooltips did not render headless, so tooltip text is mostly `[C]`.

**Shared-component contract.** Patient View and Comparison reuse: the mutation table (§5–§7, `MUT-TB/COL/AN/VA`),
the lollipop + tracks + 3D (§2–§4, `MUT-LP/TK/3D`) and the filter model (§8, `MUT-FM`). They should write
"uses <component> (see 05-mutations.md <ID-range>)" and list only differences. Columns that exist only outside the
Results View (Cohort, mRNA Expr.) are specced here too (§6.3).

Reference queries:
- `/results/mutations?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS NRAS BRAF TP53 APC` (add `&mutations_gene=TP53`)
- Multi-sample patients: `cancer_study_list=lgg_ucsf_2014&case_set_id=lgg_ucsf_2014_all&gene_list=IDH1 TP53 ATRX`
- Multi-study: `cancer_study_list=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&case_set_id=all&gene_list=PIK3CA TP53`
- Fusions as mutations: `cancer_study_list=prad_tcga_pan_can_atlas_2018&case_set_id=prad_tcga_pan_can_atlas_2018_all&gene_list=TMPRSS2 ERG ETV1&profileFilter=mutations,structural_variants`

Key files (paths relative to cbioportal-frontend; `RMM/` = `packages/react-mutation-mapper/src/`, `MT` = `src/shared/components/mutationTable/MutationTable.tsx`,
`RVMT` = `src/pages/resultsView/mutation/ResultsViewMutationTable.tsx`, `RVMM` = `src/pages/resultsView/mutation/ResultsViewMutationMapper.tsx`,
`LMT` = `src/shared/components/lazyMobXTable/LazyMobXTable.tsx`, `OKB/` = `packages/oncokb-frontend-commons/src/`):
`src/pages/resultsView/mutation/*`, `src/shared/components/mutationMapper/*`, `src/shared/components/mutationTable/column/*`,
`RMM/component/{lollipopMutationPlot,lollipopPlot,track,mutationMapper,filter,column,civic,clinvar,gnomad,hotspot,revue}/*`,
`src/shared/components/{structureViewer,proteinChainPanel,categoricalFilterMenu,filterIconModal}/*`, `src/shared/lib/MutationUtils.tsx`.

---

## 0. Tab wiring and banners

- **MUT-0-1** Tab label "Mutations", path `/results/mutations`; always shown. Root `div[data-test="mutationsTabDiv"]`; big spinner while `mutationsByGene` pending (`Mutations.tsx:101-125`, `ResultsViewPage.tsx:389-405`).
- **MUT-0-2** Uses the Results header and global settings menu (see 01-oncoprint.md RV-1…RV-3).
- **MUT-0-3** One mapper store per gene, cached by `${hugo}_DRIVER|_NO_DRIVER`. Changing driver annotation settings creates a new store → **all in-tab filters, selections and y-max reset** `[C]` (`ResultsViewPageStore.ts:3921-3946`).
- **MUT-0-4 Mutation set per gene** (`ResultsViewPageStore.ts:3629-3760`) `[C]`:
  1. OQL mutation filter, only if the query has mutation OQL and "Filter by OQL" is on `[default on]`.
  2. `compileMutations(excludeVus, excludeGermline)`; defaults `excludeVus = !includeVUS` (RV-2 "Show only drivers"), `excludeGermline = !includeGermline` (RV-2 "Show only somatic").
  3. If RV-2 "Show only profiled" is on, drop unprofiled samples.
  4. Structural variants of the gene are added as pseudo-mutations: `mutationType 'fusion'`, `proteinChange` = "A-B Fusion" (`[B]` "TMPRSS2-ERG Fusion"), `mutationStatus = svStatus`, `center 'N/A'`.
- **MUT-0-5 Banners above the mapper** `[C]` (`Mutations.tsx:184-238`):
  - OQL status (only if the query has OQL): "Your OQL specification does not affect the results below because you have not specified any filters for mutations in this gene." / "The results below are filtered by the OQL specification from your query." / "The results below are not filtered by the OQL specification from your query." + button "Do not filter by OQL" / "Filter by OQL" *(local)*.
  - AlterationFilterWarning (mutations mode): "`N` mutations of unknown significance are hidden below." / "…are shown below." + [Show]/[Hide]; same for "`N` germline mutations…". "is"/"are" singular when N = 1. Toggle is *(local)*, overrides RV-2 for this tab only.
  - CaseFilterWarning (unprofiled samples included/excluded), as RV-3.

## 1. Gene tabs

- **MUT-GT-1** Pill tabs `#mutationsPageTabs`, one per gene in `uniqueGenesInOQLQuery(gene_list)` — query order, uppercased, de-duplicated (`ResultsViewPageStore.ts:773-779`).
- **MUT-GT-2** Every queried gene gets a pill, label = symbol only (no count). A gene with 0 mutations is greyed (`color:#bbb`) but clickable `[C]` (`Mutations.tsx:137-156`).
- **MUT-GT-3** Active gene: `URL: mutations_gene` if it is a queried gene, else the first gene `[default]`. Clicking a pill updates the URL (not a session prop; shared with the SV tab).
- **MUT-GT-4** Pills are `unmountOnHide`; each gene keeps its own cached store (filters survive switching genes, see MUT-0-3).

## 2. Mapper layout and header column

**MUT-LY-1 Layout** (`MutationMapper.tsx:539-574`): bordered box; left = control bar, lollipop plot, tracks, PDB chain panel; right meta column = transcript dropdown, gene summary, mutation-rate summary, type/driver badge filter, [View 3D Structure]. Below: `<hr>`, then the table. The 3D viewer floats above (draggable).

**MUT-HD-1 Transcript dropdown** (`RMM/component/mutationMapper/TranscriptDropdown.tsx`)
- Shown only if server `show_transcript_dropdown` (`[default false]` in code; **on** at cbioportal.org `[B]`).
- react-select, not clearable, `aria-label="Transcript Dropdown"`. Closed value = RefSeq id (or versioned Ensembl id).
- Option label: "`<RefSeq> / <ENST.v> (<CCDS>) (<len> amino acids)` (default)". `[B]` KRAS: "NM_004985 / ENST00000311936.3 (CCDS8702) (188 amino acids) (default)", "NM_033360 / ENST00000256078.4 (CCDS8703) (189 amino acids)", "ENST00000557334.1 (75 amino acids)", "ENST00000556131.1 (43 amino acids)".
- Lists all transcripts with a protein length. Order: canonical, then has-RefSeq, then length desc, then id asc.
- Default transcript: `URL: mutations_transcript_id` if valid → canonical via Genome Nexus with isoform override `mskcc` (server `isoformOverrideSource`) → if canonical has no annotated mutations but another does, the first annotated one `[C]`.
- `URL: mutations_transcript_id` is a **single value for all genes** (legacy quirk: switching gene keeps a foreign id, which then falls back to canonical).
- **MUT-HD-2 Non-canonical transcript selected** `[C]`: mutations re-annotated via Genome Nexus for that transcript; protein length, Pfam, PTM, exons, topology and PDB follow it; OncoKB and Hotspot tracks removed; **Annotation column removed** (RVMT:214-215); table default sort column then missing → original order.

**MUT-HD-2a Gene summary** (compact) — two lines `RefSeq | ENST.v` and `CCDS | UniProt-entry-name` (`[B]` "NM_004985 | ENST00000311936.3", "CCDS8702 | RASK_HUMAN"):
- RefSeq → `https://www.ncbi.nlm.nih.gov/nuccore/<id>`; CCDS → NCBI `CcdsBrowse.cgi?REQUEST=CCDS&DATA=<id>`; UniProt → `https://www.uniprot.org/uniprot/<acc>`; Ensembl → server `ensembl_transcript_url` (`[default]` grch37 Ensembl `Transcript/Summary?t=<id>`; grch38 URL for GRCh38 studies). Missing → "-".

**MUT-HD-3 Mutation rate summary** (`MutationRateSummary.tsx`, `MutationStatusSelector.tsx`) — shown when the gene has >0 mutations and >0 samples.
- "Somatic Mutation Frequency ⓘ **x.x%**"; ⓘ tooltip "Percentage of samples with a somatic mutation in <GENE>" `[C]`. Method: MUT-STM-1.
- "Germline Mutation Frequency ⓘ **x.x%**" only when the germline rate > 0; tooltip "…germline mutation in <GENE>".
- No germline → static label. Germline present → both become toggle badges "Somatic" / "Germline" (black on white) that filter by mutation status (MUT-FM-2) `[C]`.

## 3. Lollipop plot

**MUT-LP-1 Control bar** (left → right): Track selector "Add annotation tracks" (MUT-TK-1) | "Y-Axis Max:" slider + editable number | filter-reset panel (MUT-FM-5) | right: [Legend 👁] [☁ download].
- **MUT-LP-2 Y-Axis Max** *(local)*: slider min 1, max = default y-max; number box accepts values above the slider max; values < 1 clamp to 1. `[B]` KRAS default 142.
- **MUT-LP-3** No %/# axis toggle and no log scale in the Results View (`showPlotPercentToggle` not passed) `[C]`.
- **MUT-LP-4 Download** ☁ → SVG / PNG / PDF, file `<GENE>_lollipop.<ext>`; includes visible tracks with titles. Hidden when `skin_hide_download_controls` = hide-all `[C]`.
- **MUT-LP-5 Legend** button toggles *(local, default hidden)* panel "Color Codes" with the exact text:
  - "Mutation diagram circles are colored with respect to the corresponding mutation types. In case of different mutation types at a single position, color of the circle is determined with respect to the most frequent mutation type."
  - "Mutation types and corresponding color codes are as follows:" then, when drivers are annotated, a (putative driver) and (unknown significance) entry per type: Missense Mutations; Truncating Mutations: Nonsense, Nonstop, Frameshift deletion, Frameshift insertion, Splice site; Inframe Mutations: Inframe deletion, Inframe insertion; Splice Mutations; Fusion Mutations (single entry); Other Mutations: All other types of mutations. Without driver annotation: one entry per type.
  - Legacy bug: legend says Splice site is Truncating, but splice is colored as Splice (orange).

**MUT-LP-6 Axes and geometry**
- X: 0 … protein length of the active transcript (fallback 10); right label "`<len>aa`"; ticks from [50,100,200,250,500,1000,…], every other tick labelled (`[B]` TP53: 0,100,200,300, "393aa"; IDH1 "414aa").
- Y label "**# patients**"; ticks from [1,2,5,10,20,50,100,200,500]; top tick = y-max, prefixed "≥ " (`>= `) when any lollipop exceeds it; stems capped at y-max.
- Plot height 200; backbone and sequence bar `#BABDB6`; head radius 2.8 (5 when hovered/selected).
- Positions < 0, NaN or > length+1 are not drawn `[C]`.
- **MUT-LP-7 Lollipop height** = MUT-STM-2. Default y-max = max(5, tallest lollipop).

**MUT-LP-8 Lollipop colour**

| Class | Driver | VUS |
|---|---|---|
| Missense | `#008000` | `#53D400` |
| Inframe | `#993404` | `#a68028` |
| Truncating | `#000000` | `#708090` |
| Splice | `#e5802b` | `#f0b87b` |
| Fusion | `#8B00C9` | `#ce92e8` |
| Other | `#cf58bc` | `#f96ae3` |

- VUS colours only when drivers are annotated; otherwise all use the driver column.
- Several mutations at a position `[C]`: (1) any putative driver beats VUS; (2) then most frequent class (raw record count); (3) tie → priority missense > inframe > in_frame_ins > truncating/frameshift > frame_shift_ins > nonsense > nonstop > nonstart > splice > fusion > other (`RMM/util/MutationTypeUtils.ts`).
- Putative driver = `putativeDriver` OR (class Other AND OncoKB oncogenic) (`MutationUtils.tsx:537`).

**MUT-LP-9 Label**: exactly one text label above the plot `[B]` ("G12D/V/C and 3 more", "R175H/C", "R132H/C/G").
- Labels the tallest position if ≤2 positions tie; otherwise forced pick: tallest → inside a mutated Pfam domain → nearest the middle `[C]`.
- Text: up to 3 protein changes by count desc then alpha, common prefix shown once, joined "/", + " and N more". Arial 10px.

**MUT-LP-10 Lollipop tooltip** (hover): "**N mutated of M profiled patients**" / "AA Change: R175H/C" `[B]`. N = MUT-STM-2, M = MUT-STM-3.

**MUT-LP-11 Interaction**
- Hover → highlights matching table rows (row class `highlighted`); no page jump `[C]`.
- Click → selects that position; the table shows only the selected rows; reset panel shows "Showing 35 mutations (35 samples/patients) [Remove filter]" `[B]`.
- Shift+click → add/remove further positions; panel adds "(Shift click to select multiple residues)" `[B]`.
- Click again → deselect; click on empty plot area → clear selection.
- **No drag-select of an x range** (dragging does nothing `[B]`).
- Selection narrows only the table; lollipops, tracks, badges and rates are unchanged (MUT-FM-3).

**MUT-LP-12 Pfam domains**: rectangles height 24, labelled in white with the domain name (truncated with ".."). Colours by domain start order, cycling: `#2dcf00 #ff5353 #5b5bff #ebd61d #ba21e0 #ff9c42 #ff7dff #b9264f #baba21 #c48484 #1f88a7 #cafeb8 #4a9586 #ceb86c #0e180f` (`[B]` TP53: green, red, blue).
- Tooltip: "`<name>: <description> (<start> - <end>)`" + links "PFAM" (`http://pfam.xfam.org/family/<acc>`) and "Mutation Aligner" (when available) `[B]` "P53_TAD: P53 transactivation motif (6 - 29) / PFAM / Mutation Aligner". Hover only.
- Sequence-bar hover: UniProt id link `[C]`.

## 4. Annotation tracks and 3D

**MUT-TK-1 Track selector** — checked multi-select, placeholder "Add annotation tracks", buttons "Add all (n)" / "Clear"; spinner per option while loading. **All tracks off** `[default]`; state *(local)*, kept across gene tabs, not in URL. Options in order `[B]`:

| Option | Shown when |
|---|---|
| Cancer Hotspots | `show_hotspot` and canonical transcript |
| OncoKB™ | `show_oncokb` and canonical transcript |
| Post Translational Modifications (dbPTM) | `ptmSources` unset or includes dbPTM |
| Post Translational Modifications (Uniprot) | `ptmSources` includes Uniprot `[C]` |
| Exon | always |
| Uniprot Topology | always |
| 3D Structure | always; disabled until PDB alignments are loaded and non-empty |

**MUT-TK-2 Track rows** (height 15, below the plot, title at left) `[C]` unless noted:

| Track | Glyph / colour | Data | Tooltip |
|---|---|---|---|
| Cancer Hotspots | circle `#FF9900` per hotspot residue | filtered mutations matched to Genome Nexus hotspots (linear + 3D) | "**N** sample(s) with **Recurrent Hotspot** [(new in V3)] [and **3D Clustered Hotspot**] on residue(s) **X**" + method text + cancerhotspots.org / 3dhotspots.org links |
| OncoKB™ | circle `#007FFF` per oncogenic position | OncoKB indicators of filtered mutations that are oncogenic | "**N** sample(s)", oncogenicity counts, highest sensitive/resistance level, cancer types |
| PTM (dbPTM) `[B]` | ▸ expandable, expanded by default into sub-rows `[B]` Phosphorylation, Acetylation, Ubiquitination, Methylation, Glutathionylation, O-linked Glycosylation, S-nitrosylation, Sumoylation | circles: Phosph `#2DCF00`, Acetyl `#5B5BFF`, Ubiq `#B9264F`, Methyl `#EBD61D`, several types `#444444`, other `#BA21E0` | info ⓘ "Displays all Post Translational Modifications (PTMs) available for the Ensembl transcript <id.v>." + colour legend + "Data Source: dbPTM"; item → PTM table |
| Exon `[B]` | rectangles alternating `#007FFF`/`#35BAF6`, white exon number (UTRs removed, mapped to aa) | active transcript exons | "Exon n", "Start: Nucleotide n of amino acid a", "End: …", "Length: x amino acids [and y nucleotides]", genomic location with IGV link `https://igv.org/app/?locus=chr…&genome=<build>` |
| Topology `[B]` | ▸ expandable rectangles per UniProt topology type (TRANSMEM `#8d99ae`, INTRAMEM `#0096c7`, Cytoplasmic `#e76f51`, Extracellular `#e9c46a`…) | UniProt features, category TOPOLOGY | "Title", "Start", "End", "Length", "Description"; ⓘ "Information of the subcellular location of the mature protein." + "Data Source: UniProt". Legacy bug: two colour strings are invalid (`'vca6702'`, `'v560bad'`) |

- **MUT-TK-3** Clicking a track circle = select that position AND that track's own filter (e.g. only hotspot mutations at that residue); shift adds. Hovering a rectangle highlights its codon range; rectangle click does nothing `[C]`.
- **MUT-TK-4** Hotspot/OncoKB tracks count from the filtered mutations (badges/search applied).

**MUT-3D-1 PDB chain panel** (track "3D Structure"; `ProteinChainPanel.tsx`) `[C]`:
- G2S alignments for the active Ensembl transcript, merged per chain, sorted by identity desc, alignment length, identity %, pdbId, chain; `5xzc` ignored. First chain auto-selected.
- "PDB Chains" ⓘ; collapsed shows the selected chain; hover expands the list (max 200 px, scroll). Bar spans the aligned UniProt range, opacity = identity %. Click selects. [Show/Hide PDB Chain Table] (PDB Id, Chain, Uniprot Positions, Organism, Summary).
- **MUT-3D-2 [View 3D Structure]** (`data-test="view3DStructure"`) toggles the 3D panel and the PDB track; disabled when no chains.
- **MUT-3D-3 3D viewer** (floating, draggable; header "3D Structure" with expand / minimize / close):
  - `[B-new]` "Structure source: ◉ AlphaFold (predicted) ○ PDB (experimental)"; AlphaFold default shows "AlphaFold AF-<UniProt>-F1: …", Color option **pLDDT**, checkbox "Display PAE heatmap". Not in cd8c6df.
  - PDB mode `[C]`: "PDB **<id>**" link `http://www.rcsb.org/pdb/explore/explore.do?structureId=<id>`, "Chain X: <molecule>".
  - Warnings `[C]`: "None of the mutations can be mapped onto this structure" / "Selected mutation cannot be mapped onto this structure" / "`n` of the selections cannot be mapped onto this structure".
  - Toolbar: [PyMol] (tooltip "Download PyMol script", file `<pdbId>_<chain>.pml`, only if downloads shown) · "how to pan/zoom/rotate?".
  - Protein Style: Scheme cartoon `[default]` / space-filling / trace; Color uniform `[default]` / secondary structure / N-C rainbow (+ atom type for space-filling `[C]`, + pLDDT for AlphaFold `[B-new]`); "Display bound molecules" ☑ `[C]`. Invalid combo resets to uniform.
  - Mutation Style: Side Chain all / selected `[default]` / none; Color uniform (`#8A2BE2`) / mutation type `[default]` / `[B]` mutation density / none.
  - Fixed colours `[C]`: highlight `#FFDD00`, base `#DDDDDD`, chain `#888888`, helix `#FFA500`, sheet `#0000FF`.
  - Mapped residues = filtered mutations inside the chain's UniProt range; selected/hovered lollipop positions shown yellow.

## 5. Driver / type badge filter (meta column)

- **MUT-BF-1 Drivers annotated** (`DriverAnnotationProteinImpactTypeBadgeSelector.tsx`): header badges **Driver** (`#000000`) and **VUS** (`#696969`) with totals, a ⚙ sliders button (`aria-label="Driver annotation settings"`, tooltip "Change driver filtering in [⚙]") that opens RV-2; grid rows Missense, Truncating, Inframe, Splice, Fusion, Other × (driver count, VUS count) `[B]` (KRAS: Driver 221 / VUS 2; Missense 220/1, Truncating 0/1, Inframe 1/0, Splice 0/0, Fusion 0/0).
  - Row label colours = driver class colours; badge colours = MUT-LP-8.
  - "Other" row hidden when both its counts are 0 `[B]`.
- **MUT-BF-2 No driver annotation**: one count badge per type (Missense, Truncating, Inframe, Splice, Fusion, Other), Other hidden when 0 `[C]`.
- **MUT-BF-3 Clicks** — all badges selected `[default]`:
  - Click a badge → toggles it (e.g. Driver off → only VUS: "Showing 3 mutations (3 samples/patients)" `[B]` on TP53).
  - Click a type label → toggles the type (both sub-badges); Driver/VUS header → toggles the whole class.
  - Hover shows **ONLY** (`data-test="<value>_only"`) → select just that badge/type/class (`[B]` Truncating ONLY → "Showing 75 mutations (74 samples/patients)").
  - Selecting everything removes the filter.
- **MUT-BF-4 Counts** = MUT-STM-4. Filter applies to lollipops, tracks, 3D and table.

## 6. Mutation table — columns

**MUT-COL-0 Rules**
- One row per mutation record (row = `[mutation]`).
- Order by `order` value (in brackets below). Visible `[default]` as marked. Server `skin_results_view_mutation_table_columns_show_on_init` (non-empty) **replaces** all default visibility with its list `[C]`.
- Sort header click: first click uses the column's default direction (desc where marked "↓") else asc. Nulls always last in both directions; arrays compare element-wise; ties keep order (`LMT:136-188`).
- "Search" = matched by the table search box (MUT-TB-3). "TSV" = download value. Columns without a header tooltip are marked —.
- Header filter: `cat` = categorical menu, `num` = range slider (MUT-TB-6).

### 6.1 Results View columns (Mutations tab of the Columns menu, then Clinical tab)

| ID | Header [order] | Default | Shown when | Cell | Sort | Search | TSV | Filter | Header tooltip / cell tooltip / link |
|---|---|---|---|---|---|---|---|---|---|
| MUT-COL-1 | Study of Origin [0] | hidden (see note) | always | study name link | name | name | name | cat | hdr "Study of Origin"; cell "`<name>: <description>`"; link `/study?id=<studyId>` |
| MUT-COL-2 | Gene | hidden | always | symbol | symbol | symbol | symbol | cat | — |
| MUT-COL-3 | Sample ID [10] | ☑ | always | sampleId link, new tab | id | id | id | cat | cell = id; link `/patient?sampleId=&studyId=` |
| MUT-COL-4 | Cancer Type (clinical `CANCER_TYPE`) [14] | hidden | attribute exists | text | str | str | text | cat | attr description |
| MUT-COL-5 | Cancer Type Detailed [15] | ☑ if >1 distinct value among rows | tumour-type map present | text | str | str | text | cat | hdr "Cancer Type Detailed"; NA "Cancer type not available for this sample." |
| MUT-COL-6 | Protein Change [20] | ☑ | always | bold italic, max 40 chars; red "Germline" tag when germline; reVUE icon if VUE | MUT-STM-9 | proteinChange (+ "germline") | proteinChange | cat | cell = full text |
| MUT-COL-7 | Annotation [30] ↓ | ☑ | canonical transcript | icons §7 | MUT-STM-10 | only literal `HOTSPOT` | MUT-AN-6 | `[B-new]` special (MUT-TB-7) | header icons with cards (MUT-AN-1) |
| MUT-COL-8 | `<customDriverName>` [33] ↓ | ☑ if any row has custom driver data | server custom-driver config | annotation text, bold if `Putative_Driver` | "`<rank>_<annotation>`", rank Putative_Driver 3 / Putative_Passenger 2 / Unknown 1 / NA 0 | text | text | — | hdr = config description |
| MUT-COL-9 | `<customDriverTiersName>` [34] | hidden | same | tier text, bold if driver | text | text | text | — | hdr = config description |
| MUT-COL-10 | Functional Impact [38] | hidden | `show_genomenexus` | MUT-VA-5 | **not sortable** | — | MUT-VA-5 | — | per-source legends |
| MUT-COL-11 | Mutation Type [40] | ☑ | always | label + colour (MUT-COL-T1) | label | label | **raw** (e.g. `Missense_Mutation`) `[B]` | cat (values = labels) `[B]` | cell = raw when it differs |
| MUT-COL-12 | Variant Type [45] | hidden | always | UPPERCASE, coloured | str | str | upper | cat | SNP "Single Nucleotide Polymorphism", DNP "Di-…", TNP "Tri-…", ONP "Oligo-Nucleotide Polymorphism", INS "Insertion", DEL "Deletion" |
| MUT-COL-13 | ASCN Method [46] | hidden | any row has ASCN method | text | str | — | per-mutation list | cat | "Allele Specific Copy Number Method" |
| MUT-COL-14 | Clonal [47] | ☑ (no `visible` flag) | any row has CCF | circle (MUT-STM-12) | **ccfExpectedCopiesUpper** (legacy quirk) | — | CLONAL/SUBCLONAL/INDETERMINATE/NA | num | — |
| MUT-COL-15 | CCF [48] | hidden | same | `toFixed(2)` | number | — | `toFixed(2)` | num | "Cancer Cell Fraction" |
| MUT-COL-16 | Mutant Integer Copy # [49] | hidden | expectedAltCopies exists | icon | "eac/tcn" string | — | "eac/tcn" | num | "Best Guess for Mutant Integer Cop #" (legacy typo) |
| MUT-COL-17 | Total Integer Copy # [50] | hidden | ASCN integer + total + minor CN exist | icon (MUT-STM-12) | string | — | **none (not exported)** | — | — |
| MUT-COL-18 | Copy # [51] | ☑ when the discrete CNA profile is in the query | always | MUT-STM-11 | −2…2, null last | label (case-insens.) | label | cat (`[B]` Diploid, Gain, ShallowDel, Amp, (Blanks)) | Deep deletion / Shallow deletion / Diploid / normal / Low-level gain / High-level amplification |
| MUT-COL-19 | MS [70] | hidden | always | **S** on `#ccffff` (somatic), **G** on `#ffffcc` (germline), else raw grey xx-small | raw | raw | raw | — | hdr "Mutation Status"; cell = raw |
| MUT-COL-20 | VS [80] | hidden | always | **V** (`#ccffcc`) valid/validated · **W** wildtype · **U** (`#e0e0e0`) unknown/not_tested/none/na · raw | raw | raw | raw | — | hdr "Validation Status" |
| MUT-COL-21 | Center [100] | hidden | always | text | str | str | text | cat | — |
| MUT-COL-22 | Chromosome [110] | hidden | always | chr, right | MUT-STM-9 | str | chr | cat | — |
| MUT-COL-23 | Start Pos [120] / End Pos [130] | hidden | always | int, right | number | str | raw | num | — |
| MUT-COL-24 | Ref [140] / Var [150] | hidden | always | allele | str | — | raw | cat | — |
| MUT-COL-25 | HGVSg [151] | hidden | always | "`<hgvsg>` ↗" link (`[B]` "7:g.140453136A>T") | str | — | hgvsg | cat | "`<hgvsg>` / Click to see this variant on Genome Nexus"; `<genomenexus_website_url>/variant/<hgvsg>` |
| MUT-COL-26 | HGVSc [152] | hidden | always | `ENST…:c.…` (`[B]` "ENST00000288602.6:c.1799T>A"), right | int after `c.` | — | hgvsc | cat | — |
| MUT-COL-27 | Allele Freq (T) [160] | ☑ if any row has a non-zero VAF | always | MUT-STM-5 | ratio | — | formatted | num | hdr "Variant allele frequency in the tumor sample"; cell "**alt** variant reads out of **alt+ref** total" |
| MUT-COL-28 | Allele Freq (N) [170] | hidden | always | MUT-STM-5 (normal) | ratio | — | formatted | num | hdr "Variant allele frequency in the normal sample" |
| MUT-COL-29 | Variant Reads [180] / Ref Reads [190] / Variant Reads (Normal) [200] / Ref Reads (Normal) [210] | hidden | always | MUT-STM-6 | raw | — | MUT-STM-6 | num | — |
| MUT-COL-30 | # Mut in Sample [220] | ☑ | mutation-count cache | integer, right | int | — | value, '' when 0 | num | hdr "Total number of nonsynonymous mutations in the sample"; MUT-STM-7 |
| MUT-COL-31 | Exon [230] | hidden | always | exon number only | int before "/" | — | "n/total" (`[B]` "15/18") | num | header "Exon (`<N>` in total)" `[B]` ("Exon (18 in total)"); "None" if no exons |
| MUT-COL-32 | gnomAD [260] ↓ | hidden | always | MUT-VA-3 (`[B]` "0.0000040") | combined AF | — | AF string | num | MUT-VA-3 |
| MUT-COL-33 | ClinVar [270] ↓ | hidden | always | MUT-VA-1 | significance str | — | MUT-VA-1 | cat | MUT-VA-1 |
| MUT-COL-34 | dbSNP [280] ↓ | hidden | always | rsID link (`[B]` "rs113488022") | str | rsID substring | rsID | cat | MUT-VA-2 |
| MUT-COL-35 | SIGNAL [290] | hidden | `show_signal` | MUT-VA-4 | freq | — | 2 sig. digits | cat | MUT-VA-4 |
| MUT-COL-36 | Clinical attribute columns [300] (one per study attribute except CANCER_TYPE_DETAILED, MUTATION_COUNT; name = display name) | hidden | always | text, max 30 chars; patient attrs by patient | number if NUMBER else str; '' → null | STRING attrs only | value | NUMBER → num, STRING → cat | hdr = attribute description; NA "Clinical attribute not available for this sample." |
| MUT-COL-37 | Namespace columns [400] ("`<Namespace> <Column>`") | `skin_mutation_table_namespace_column_show_by_default` | namespace data present | value | numeric / str | legacy bug: never matches | value | num / cat | — |

- **MUT-COL-1 note — legacy bug:** code sets Study of Origin visible for >1 study only in `componentWillUpdate` (RVMT:124-129), so in practice it stays hidden in multi-study queries `[B]` (coadread+brca: not shown). Intended: visible when >1 study.
- **MUT-COL-T1 Mutation Type labels/colours** (`MutationTypeColumnFormatter.tsx:22-83`): Missense, IF, Truncating, Nonsense, Nonstop, Nonstart, FS, FS del, FS ins, IF ins, IF del, Splice, Fusion, Silent, else raw. Colours: missense `#008000`, truncating family `#000000`, inframe `#8b4513`, splice `#e5802b`, fusion `#8b00c9`, other/silent `#cf58bc`.
- **MUT-COL-T2 Variant Type colours**: SNP/DNP/TNP/ONP `#008000`, INS `#8b4513`, DEL `#8b00c9`, other `#000`.
- **MUT-COL-38 Default visible set** `[B]` (coadread, KRAS): Sample ID, Cancer Type Detailed, Protein Change, Annotation, Mutation Type, Copy #, Allele Freq (T), # Mut in Sample → "Columns (8 / 92)".

### 6.2 Cell states (all lazy columns) `[C]`
- Loading spinner; error "Error retrieving data." / "Error fetching Genome Nexus annotation"; NA indicator with column-specific text (e.g. "CNA data is not available for this gene.", "Mutation count not available for this sample.").

### 6.3 Columns not in the Results View (owned here for Patient View / others) `[C]`
| ID | Header | Method |
|---|---|---|
| MUT-COL-40 | Cohort (hdr "Mutation frequency in cohort") | Frequency bar: counts `[samples with a mutation in gene, samples with this keyword]` of total; tooltip "`n` samples (**p**) in this study have mutated `<GENE>`, out of which `k` (**q**) have `<keyword>` mutations." + MutSig badge if qValue > 0. Sort = gene count. Method MUT-STM-8 |
| MUT-COL-41 | mRNA Expr. | 30 px bar, circle at percentile: blue <25, red >75, else grey; text `round(percentile)%`; tooltip "mRNA level of the gene in this tumor / mRNA z-score: z / Percentile: p"; TSV percentile or "N/A"; not sortable |
| MUT-COL-42 | Samples, Gene panel | Patient View only; specced in 40-patient-summary.md |

## 7. Annotation & variant-annotation columns (shared)

**MUT-AN-1 Annotation header** (`annotation/AnnotationHeader.tsx:416-531`): "Annotation" + icon row with hover cards `[B]` (OncoKB ◎, CIViC, hotspot 🔥, ▾):
- OncoKB icon (if `show_oncokb`): intro "**OncoKB™** is a precision oncology knowledge base that contains information about the effects and treatment implications of variants in cancer (Chakravarty et al. 2017)", radio "OncoKB Icon Style: Compact / Expanded" (`[default]` from `oncokb_merge_icons_by_default`=true → Compact; stored in localStorage `mergeOncoKbIcons`), tabs "Oncogenicity (Somatic)", "Pathogenicity (Germline)", "Therapeutic Levels", "Diagnostic Levels", "Prognostic Levels" `[C]`.
- reVUE icon (if `show_revue` and any row has a VUE) `[C]`; CIViC (if `show_civic`); Cancer Hotspots (if `show_hotspot`) — each with intro + legend `[C]`.

**MUT-AN-2 Cell icons, in order**: OncoKB → reVUE (placeholder if none) → CIViC → Hotspot (`RMM/column/Annotation.tsx:329-394`). Spinner while loading; ⚠ "Error fetching OncoKB data" / "Error fetching Civic data".

**MUT-AN-3 OncoKB**
- Compact `[default]` `[B]`: one 18×18 ring icon. Ring: oncogenic/likely/resistance/pathogenic `#0968C3`; neutral/VUS/benign `#696969`; inconclusive `#AAAAAA`; unknown `#CCCCCC`. Level badges: TxS top-right circle, TxR bottom-right circle, Dx top-left square, Px bottom-left triangle; colours 1 `#33A02C`, 2 `#1F78B4`, 3A `#984EA3`, 3B `#BE98CE`, 4 `#424242`, R1 `#EE3424`, R2 `#F79A92`, R3 `#FCD6D3` `[C]`.
- Expanded: separate icons for oncogenicity, TxS, TxR, Dx, Px `[C]`.
- Icon shown whenever the gene is in OncoKB (fusions always) `[C]`.
- Card `[C]`: title "GENE p.X" (germline: "c.… · (p.X)" + "Germline"); tumour type subtitle (single cancer type only); tabs "Biological Effect", "Therapeutic Implications", "Diagnostic Implications", "Prognostic Implications"; disclaimer "The information above is intended for research purposes only and should not be used as a substitute for professional diagnosis and treatment."; footer link `https://www.oncokb.org/gene/<GENE>/<alteration>` + Feedback. Gene absent: "There is currently no information about this gene in OncoKB."
- Public instance (no license): level icons hidden; card "Therapeutic, diagnostic and prognostic implications are not available in this instance of cBioPortal." `[C]`.
- **Query** `[C]`: somatic = protein change + mutation type, tumour type = sample's CANCER_TYPE_DETAILED (fallback study cancer type); germline = HGVSc "GENE:c.…" (GRCh38 if `ncbiBuild` ~ 38) — no fallback when HGVSc missing (row unannotated).
- Download text: "`OncoKB: <oncogenic|Unknown>, <level_x|level NA>, <resistance level|resistance NA>`" `[B]` ("OncoKB: Oncogenic, level_1, resistance NA").

**MUT-AN-4 Cancer Hotspots** `[C]`: flame icon if recurrent (single/indel; splice for splice mutations), 3D icon if only 3D. Tooltip "**Recurrent Hotspot** [(new in V3)] and **3D Clustered Hotspot**" + "This mutated amino acid was identified as a recurrent hotspot (statistically significant) … Chang et al. 2016, Chang et al. 2018, and Bandlamudi et al. 2026 …" + "Explore all mutations at https://cancerhotspots.org/ and https://3dhotspots.org/." Source: Genome Nexus hotspot endpoint.

**MUT-AN-5 CIViC / reVUE** `[C]`: CIViC logo → card "CIViC Variants" (gene link + description, variants "name Entries: types", or "Information about the oncogenic activity of this alteration is not yet available in CIViC.", research disclaimer). reVUE → "Predicted Effect by VEP: **x**" / "Revised Protein Effect by reVUE (refs): **y**".
- No My Cancer Genome badge exists (not in code, not seen).

**MUT-AN-6 Annotation download** `;`-joined: OncoKB part; `reVUE: …` (if shown); `CIViC: {diagnosticCount: 3, predictiveCount: 177, …}` or `NA`; `CancerHotspot: yes|no`; `3DHotspot: yes|no` `[B]`.

**MUT-VA-1 ClinVar** — cell = clinical significance (≤30 chars) `[B]` "Conflicting_classifications_of..."; tooltip: significance, conflicting detail, "(ClinVar ID: <link https://www.ncbi.nlm.nih.gov/clinvar/variation/<id>/>)"; empty "Variant has no ClinVar data."; TSV "sig(conflicting)" `[B]`. Header "ClinVar aggregates information about genomic variation and its relationship to human health."
**MUT-VA-2 dbSNP** — rsID link `https://www.ncbi.nlm.nih.gov/snp/<rs>`, tooltip "Click to see variant on dbSNP website."; empty "Variant has no dbSNP data."; header "The Single Nucleotide Polymorphism Database (dbSNP) is a free public archive for genetic variation within and across different species. NOTE: Currently only SNPs, single base deletions and insertions are supported."
**MUT-VA-3 gnomAD** — cell = overall AF (MUT-STM-13); tooltip table "Population | Allele Count | Allele Number | Number of Homozygotes | Allele Frequency", rows African, Latino, Other, European (Non-Finnish), European (Finnish), Ashkenazi Jewish, East Asian, South Asian sorted by AF desc, then bold Total; footer "Source: genomenexus.org, which serves myvariant.info's gnomAD data. Latest gnomAD data may differ." + link `https://gnomad.broadinstitute.org/variant/<chr>-<pos>-<ref>-<alt>`; empty "Variant has no data in gnomAD." Header "gnomAD population allele frequencies. Overall population allele frequency is shown. Hover over a frequency to see the frequency for each specific population."
**MUT-VA-4 SIGNAL** — cell = germline frequency (fraction, 2 sig. digits); tooltip table "Cancer Type | Mutation Status | # Patients | # Carriers | % Prevalence | % Biallelic | Median Age at Dx | Median TMB | MSI Score | Median HRD LST | Median HRD ntelomeric AI | Median HRD Fraction LOH %", sorted by % Prevalence desc. Header "Prevalence of germline mutations in cancer patients from SIGNAL".
**MUT-VA-5 Functional Impact** — sub-icons Mutation Assessor (if `show_genomenexus_annotation_sources` ∋ mutation_assessor), SIFT, PolyPhen-2, AlphaMissense; ● colours red `#f00` (MA high / deleterious / probably_damaging / pathogenic), orange `#ffaa22` (MA medium), yellow `#ffd700` (MA low / deleterious_low_confidence / possibly_damaging / ambiguous), grey `#c1c1c1` (neutral / tolerated / benign). Tooltip "Source | Impact | Score (2 dp)". TSV `[B]` "MutationAssessor: impact: high, score: 7.11…;SIFT: impact: deleterious, score: 0;Polyphen-2: impact: probably_damaging, score: 0.963;AlphaMissense: pathogenicity: pathogenic, score: 0.9927". SIFT/PolyPhen/AlphaMissense from the active transcript.
- **MUT-VA-6** All of ClinVar, SIGNAL, HGVSc, reVUE and germline OncoKB need Genome Nexus variant annotations; in code these are fetched only when `show_transcript_dropdown` is on `[C]` (on at cbioportal.org; populated `[B]`). gnomAD/dbSNP use a separate my_variant_info fetch.

## 8. Table controls and filter model

- **MUT-TB-1 Header line** "`N` Mutations (page x of y)" (page part only if >1 page); singular "Mutation" for 1; with multi-sample duplicates: "61 Mutations: includes 38 duplicate mutations in patients with multiple samples (page 1 of 3)" `[B]` (MUT-STM-14).
- **MUT-TB-2 Toolbar (right)**: [📋 Copy] [☁ Download TSV] [Columns (v / t) ▾] [search 🔍]. Copy/Download only if `skin_hide_download_controls === 'show'`.
- **MUT-TB-3 Search box** (no placeholder, `aria-label` "Mutations Table Search Input"): 400 ms debounce, case-insensitive substring, row matches if **any visible** column's search value matches (columns marked "—" in §6.1 are not searchable); resets to page 1; also filters lollipops, tracks and badges (MUT-FM-1).
- **MUT-TB-4 Pagination** (bottom): "Showing 1-25 of 223 Mutations" `[B]` (+ duplicate suffix); ‹ prev, [Show more] (25 → 50 → 100 → +100 each), › next, "Reset" link when page size > 25 `[C]`; controls hidden when ≤ 25 rows; no page-size select. 25 rows `[default]`.
- **MUT-TB-5 Columns menu** (`AddColumns.tsx`): button "Columns (v / t)" `[B]` "Columns (8 / 92)"; two tabs with counts: **Mutations** (`[B]` "6 / 31", table order) and **Clinical** (`[B]` "2 / 61": clinical attrs + Study of Origin, Cancer Type Detailed, # Mut in Sample; columns Name | Freq; sorted by Freq desc then name; Freq = MUT-STM-15; 0% rows disabled). Each tab: [Select all (n)] [Deselect all] (shown when applicable), search "Search...". [Reset columns] appears when visibility ≠ default `[B]`. Toggling a column off clears its header filter. Visibility *(local)*, per Mutations component (survives gene switch).
- **MUT-TB-6 Header filters** (Results View only; `RVMM:727-760`): a 🔽 filter icon appears on header hover; blue when active.
  - Categorical (`cat`): condition select Contains `[default]` / Does Not Contain / Equals / Does Not Equal / Begins With / Does Not Begin With / Ends With / Does Not End With / Regular Expression (case-insensitive, 400 ms debounce) + value checklist (sorted, "(Blanks)" for empty) + Select all (n) / Deselect all + [Remove filter]. Row passes if value matches the condition AND is checked.
  - `[B-new]` checklist shows "All N values" and a per-value "Mutations" count column, and a [Compare] button that opens Group Comparison in a new tab (`/loading/comparison?phase=creating_session&clinicalAttributeName=<column>&origin=<study>`), one group per value.
  - Numerical (`num`): double-handle slider + two number boxes, range = column min…max over all rows; "Hide empty values" checkbox when nulls exist; nulls pass unless hidden; bounds inclusive.
  - Filter returns to inactive when set back to default.
- **MUT-TB-7** `[B-new]` Annotation header filter: "Match ◉ any source ○ all sources", "Check values to show only the mutations that have them.", groups with per-value counts: OncoKB oncogenicity (Oncogenic / Likely Oncog. / Resistance, Likely Neutral, Inconclusive, VUS, Unknown); OncoKB highest level (for the sample's cancer type) (Level 1, 2, 3A, 3B, 4, R1, R2); Cancer Hotspots (Recurrent (or recurrent + 3D) hotspot, 3D clustered hotspot, Not a known hotspot); CIViC (In CIViC, with oncogenic activity info; In CIViC, no oncogenic activity info; Not in CIViC); [Compare] [Remove filter]. These values also appear as hideable entries in the Columns menu list.
- **MUT-TB-8 Download TSV** — file `table.tsv` `[B]`; header = **every column that has a download value, visible or hidden** (incl. Gene, Study of Origin, all clinical attributes) `[B]`; rows = **all rows in current sort, ignoring search and all filters** `[C]`; tab-separated, CRLF; multi-value cells expand to several lines; lazy data fetched first ("Downloading Table Data..." modal). Copy = same text, "Copy Ready!" modal or "Copied!" tooltip `[C]`.
- **MUT-TB-9 Default sort**: Annotation ↓ (server `skin_results_view_tables_default_sort_column`, `[default]` "Annotation") `[B]` (KRAS G12C rows first).

**Filter model** (`MutationMapperDataStore.ts:139-168`, `RMM/util/FilterUtils.ts`) `[C]`:
- **MUT-FM-1** Data filters (badges, mutation status, header filters, track defaults) and the search string are ANDed → "filtered data". Lollipops, tracks, 3D residues and table use it.
- **MUT-FM-2** Mutation-status filter: case-insensitive equality with `mutationStatus`; mutations with no status fail when active.
- **MUT-FM-3** Selection (lollipop/track click) → table shows only selected rows; hover highlight never removes rows. Badge counts ignore the badge filter itself; rates ignore all in-tab filters.
- **MUT-FM-4** Driver/type filter id `_cBioPortalAnnotatedProteinImpactTypeFilter_` (or `_cBioPortalProteinImpactTypeFilter_`), status `_cBioPortalMutationStatusFilter_`, header filters `_cBioPortal<Column>ColumnFilter_`.
- **MUT-FM-5 Reset panel** (`data-test="filter-reset-panel"`) shown when table rows ≠ all rows: "Showing `N` mutations (`<link>`)" where link = "**n** samples / **m** patients" or "**n** samples/patients" when equal (tooltip "Explore samples in study view", opens Study View with those samples) + [Remove filter] (clears search, data filters, selection, highlight) `[B]`.

## 9. Modes & conditions

| ID | Condition | Expected behaviour |
|---|---|---|
| MUT-MD-1 | Gene has 0 mutations | Greyed pill; empty plot; rate summary hidden; badges 0; table "0 Mutations" |
| MUT-MD-2 | Drivers not annotated (all RV-2 sources off) | Single-colour classes; simple type badges (MUT-BF-2); legend without driver/VUS split |
| MUT-MD-3 | Show only drivers (VUS hidden) | VUS removed before the tab; banner with Show/Hide |
| MUT-MD-4 | Germline present | Germline rate + Somatic/Germline badges; red "Germline" tag in Protein Change; germline OncoKB via HGVSc; banner when hidden |
| MUT-MD-5 | Multi-sample patients | Lollipop counts unique patient+change; duplicate suffix on counts (MUT-TB-1); reset panel shows "n samples / m patients" |
| MUT-MD-6 | Multi-study | Denominators span all studies; Study of Origin intended visible (legacy bug: hidden); Cancer Type Detailed visible |
| MUT-MD-7 | Non-canonical transcript | MUT-HD-2 |
| MUT-MD-8 | No canonical transcript | "No Transcript found for <GENE>" + red ⚠ `[C]` |
| MUT-MD-9 | No Pfam domains | legacy bug: plot may spin forever `[C]` |
| MUT-MD-10 | No PDB alignment | [View 3D Structure] and "3D Structure" option disabled |
| MUT-MD-11 | SV profile queried | Fusions appear as "A-B Fusion" mutations, Fusion badge counts, purple lollipops `[B]` |
| MUT-MD-12 | OQL with mutation terms | OQL banner + toggle; table/plot show only OQL-matched mutations when on |
| MUT-MD-13 | Show only profiled | unprofiled samples' mutations removed; denominators shrink (MUT-STM-1, -3) |
| MUT-MD-14 | `show_transcript_dropdown` off | No dropdown; Genome Nexus–based columns empty (MUT-VA-6) `[C]` |
| MUT-MD-15 | OncoKB public instance | Level icons and implications hidden (MUT-AN-3) |

## 10. Persistence

- **URL:** `mutations_gene`, `mutations_transcript_id` (both non-session; transcript id shared across genes).
- **localStorage:** `mergeOncoKbIcons` (OncoKB icon style).
- **Not persisted:** track visibility, column visibility, header filters, badge filters, search, sort, page size, selection, y-max, legend, 3D options, OQL/VUS/germline banner toggles.

---

## 11. Statistics & methods

**MUT-STM-1 Somatic / Germline Mutation Frequency** (`MutationUtils.tsx:238-311`, `MutationRateSummary.tsx:42-67`)
- Numerator: unique samples (study+sample) with ≥1 mutation in the gene whose `mutationStatus` does **not** match /germline/i (germline: does match). Uses the tab's mutation set (MUT-0-4: after OQL, VUS, germline exclusion, transcript), **before** any in-tab filter.
- Denominator: all queried samples (`filteredSamples`; minus unprofiled only if Show only profiled) — **not** profiled-only. Germline: germline-consented samples (`<study>_germline` lists from server `studiesWithGermlineConsentedSamples`) if any, else all samples.
- Sample level, ×100, 1 decimal; non-zero below 0.05 → "< 0.1"; plus "%".
- `[B]` check: KRAS 218 samples / 594 = 36.7%; TP53 52.9%; lgg IDH1 100.0%.

**MUT-STM-2 Lollipop height / "N mutated"** (`MutationMapperStore.ts:221-228`, `MutationUtils.tsx:156-196`)
- Per protein start position: number of distinct `hugo + patientId + proteinChange` among **filtered** mutations (badges, status, header filters, search applied; selection not).
- Patient-level de-dup of the same change; a patient with two different changes at one position counts twice (legacy quirk vs the "# patients" label).

**MUT-STM-3 Tooltip "of M profiled patients"** (`LollipopTooltipCountInfo.tsx:29-38`)
- M = number of queried patients (`filteredPatients`), **not** profiled-only despite the wording (legacy bug). `[B]` "35 mutated of 594 profiled patients".

**MUT-STM-4 Badge counts** (`MutationMapper.tsx:320-369`)
- Raw mutation records (one per table row) per class × driver/VUS, over all tab mutations after every data filter **except** the protein-impact badge filter, and after the search string. Driver/VUS header = sum of its column. `[B]` KRAS 221 + 2 = 223 = table total.
- Class mapping: missense; truncating = nonsense, nonstop, nonstart, frameshift; inframe = in-frame ins/del; splice; fusion; other = everything else (silent, 5'UTR…).

**MUT-STM-5 Allele Freq (T)/(N)** (`TumorAlleleFreqColumnFormatter.tsx`, `NormalAlleleFreqColumnFormatter.tsx`)
- `alt / (alt + ref)` with tumor (normal) alt/ref counts of the row's mutation; null if either count < 0.
- Display: value < 0.01 → 4 decimals, else 2 (`[B]` 0.31, 0.0098). 0 or NaN (0/0) → NA, '' in TSV.

**MUT-STM-6 Read columns**: raw `tumorAltCount`, `tumorRefCount`, `normalAltCount`, `normalRefCount`; values ≤ 0 or missing shown blank; multi-sample form "sampleId: value" (newline on screen, `;` in TSV).

**MUT-STM-7 # Mut in Sample** (`MutationCountCache.ts:17-33`)
- Sample clinical attribute `MUTATION_COUNT` (computed at import: nonsynonymous mutations in the sample's mutation profile — all genes, no driver filter). Integer; sort `parseInt`; TSV '' when 0.

**MUT-STM-8 Cohort column** (not in RV; backend `VariantCountServiceImpl.java:25-53`, `VariantCountMapper.xml`)
- Gene count = `GENE_COUNT`, keyword count = `KEYWORD_COUNT` from table `mutation_count_by_keyword` (precomputed at import, distinct samples per profile).
- Denominator = sample count of list `<study>_sequenced`, else number of samples in the mutation profile.
- Percent format `getPercentage`: 0 → "0%", < 1 → "<1%", else `round(%)`.

**MUT-STM-9 Sort keys**
- Protein change (`ProteinChangeUtils.ts:409-476`): match `/[A-Za-z][0-9]+./` → position + fractional part from char codes of the non-digit letters (so V600E < V600K < V601…); else first number; else null.
- Chromosome: first integer; X = 23, Y = 24; otherwise −1.
- HGVSc: `parseInt` after "c.".

**MUT-STM-10 Annotation sort** (`Annotation.tsx:319-327`, `OKB/util/OncoKbUtils.ts:369-421, 825-877`) — array compared element-wise, missing = −∞:
1. OncoKB `[bio, TxS, TxR, Dx, Px]`: bio oncogenic/pathogenic 5 else 0; TxS 1=6, 2=5, 3A=3, 3B=2, 4=1; TxR R1=3, R2=2, R3=1; Dx/Px 1=3, 2=2, 3=1.
2. CIViC entry 1 / 0. 3. Hotspot: recurrent +1, 3D +0.5. 4. reVUE 0. 5. OncoKB cancer gene 1 / 0.
- Default direction desc.

**MUT-STM-11 Copy #** (`DiscreteCNAColumnFormatter.tsx`): value of the queried discrete CNA profile for (sample, gene): 2 **Amp** (red 12 px), 1 **Gain** (red, smaller), 0 Diploid (black xx-small), −1 **ShallowDel** (blue), −2 **DeepDel** (blue 12 px); missing → "(Blanks)" in filter.

**MUT-STM-12 ASCN** (`ascnCopyNumber/*`, `clonal/*`, `expectedAltCopies/*`, `src/shared/lib/ASCNUtils.ts`) `[C]`
- Clonal: CLONAL black circle, SUBCLONAL striped, INDETERMINATE light grey, NA invisible; tooltip "Clonal <value>" / "CCF <ccf|INDETERMINATE|NA>".
- Mutant Integer Copy #: "`eac` out of `tcn` copies of this gene are mutated." or "Indeterminate sample".
- Total Integer Copy #: number = totalCopyNumber; fill by ascnIntegerCopyNumber 2 `#ff0000`, 1 `#e15b5b`, 0 `#ffffff`, −1 `#2a5eea`, −2 `#0000ff`, INDETERMINATE `#bcbcbc`; "WGD" above when sample `ASCN_WGD` = WGD; tooltip "**<call>** (<wgd> with total copy number of tcn and a minor copy number of mcn)", call from lookup `[wgd, tcn−mcn, mcn]`.

**MUT-STM-13 gnomAD AF** (`RMM/util/GnomadUtils.ts:34-61, 154-220`)
- Exome and genome both present: per population AC, AN, homozygotes summed; AF = ΣAC / ΣAN. Only one: its `af`, else AC/AN, else 0.
- Display `toLocaleString(undefined, {min/maxSignificantDigits: 2})` — plain decimal, browser locale (`[B]` "0.0000040").
- SIGNAL: `Number(v.toLocaleString('en-US',{maximumSignificantDigits:2}))`; tooltip % = ×100, 1 decimal; TMB 1 decimal.

**MUT-STM-14 Duplicate count** (`MutationMapper.tsx:236-248`): group the gene's mutations by `gene + patientId + proteinChange`; duplicates = Σ(group size − 1); computed on all tab data (not filtered). Shown only when > 0.

**MUT-STM-15 Columns-menu Freq** (`ResultsViewPageStore.ts:1338-1351`): 100 × samples with a value ÷ queried samples, 1 decimal (`[B]` "100.0%", "99.7%").

**MUT-STM-16 Reset-panel counts**: unique sampleIds and patientIds among the currently shown table rows.

**MUT-STM-17 Default y-max**: `max(5, tallest lollipop)`; positions beyond protein length + 1 ignored.
