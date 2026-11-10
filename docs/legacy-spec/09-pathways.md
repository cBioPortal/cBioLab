# Legacy parity spec — Results View › Pathways (PathwayMapper / NDEx)

Source of truth: cbioportal.org (checked 2026-11-10), `cBioPortal/cbioportal-frontend@cd8c6df`, bundled `pathway-mapper@2.3.0` (`node_modules/pathway-mapper/src`).
Conventions as in `01-oncoprint.md`: `[default]`, `URL:`, *(local)*; `[B]` browser-only, `[C]` code-only, untagged = both.

Reference query:
- `/results/pathways?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS NRAS BRAF TP53 APC`

Key files: `src/pages/resultsView/pathwayMapper/PathWayMapperContainer.tsx`, `ResultsViewPathwayMapper.tsx`, `src/shared/lib/pathwayMapper/PathwayMapperTable.tsx`, `OncoprintUtils.ts:857-1073` (`getAlterationData`), `ResultsViewPageStore.ts:1688-1745` (NDEx).
pathway-mapper: `ui/react-pathway-mapper.tsx`, `ui/Ranking.tsx`, `ui/Toolbar.tsx`, `managers/GenomicDataOverlayManager.ts`, `data/pathways.json`.

---

## 0. Visibility and sub-tabs

- **PWY-0.1** Tab "Pathways". Hidden in IE, when both `show_pathway_mapper` and `show_ndex` are off, or until studies load (`ResultsViewPage.tsx:540-582`). A spinner is shown until genes, samples, patients, coverage, sequenced keys and OQL data load.
- **PWY-0.2** "Choose Pathway Source:" + pill tabs (`PathWayMapperContainer.tsx`):

| Pill | Shown when | Tooltip |
|---|---|---|
| PathwayMapper | `show_pathway_mapper` | "PathwayMapper shows pathways from over fifty cancer related pathways and provides a collaborative web-based editor for creating new ones." |
| NDEx Cancer Pathways | `show_ndex` and the NDEx iQuery POST returned an `https://` `webURL` | "NDEx shows 1,352 pathways:" + live list "N from ⟨db⟩" from `GET https://iquery-cbio-dev.ucsd.edu/integratedsearch/v1/source`; "Loading networks"; error "Error: Failed to load tooltip content." |

- **PWY-0.3** Sub-tab persists in the URL path: `URL: /results/pathways/<sanitized>`, sanitized = lower-case, spaces → `-` (`ResultsViewURLWrapper.ts:280-283, 392-400`).
  - Legacy bug: the active tab is read back as the sanitized id (`pathwaymapper`, `ndex-cancer-pathways`), which never equals the tab ids `PathwayMapper` / `NDEx Cancer Pathways`, so a reload does not restore the sub-tab `[C]`.
- **PWY-0.4** NDEx pane = iframe (height 800) of the returned `webURL`. The request is `POST https://iquery-cbio.ucsd.edu/integratedsearch/v1/` with `{geneList, sourceList:['enrichment'], alterationData}` (alterationData = PWY-STM-1 for the query genes), timeout 30 s, errors swallowed (`ResultsViewPageStore.ts:1690-1745`) `[C]`.
- **PWY-0.5** OQL banner with `tabReflectsOql=true` (`ResultsViewPathwayMapper.tsx:210-216`).

## 1. PathwayMapper layout (cBioPortal mode)

- **PWY-1.1** Row 1: toolbar icons (left), message banner, selected pathway name (right, e.g. "RTK-RAS").
- **PWY-1.2** Row 2: Cytoscape canvas (9/12 width, 800 px, blue `#4389c0` border) + "Powered by PathwayMapper"; ranking panel (3/12).
- **PWY-1.3** Toolbar, in order (`ui/Toolbar.tsx:58-117`), tooltips:
  - "Save as PNG"
  - "Save as SVG"
  - "Perform layout"
  - "Add selected genes to query"
  - "Add all valid genes to query"
  - "Edit pathway" — opens `http://pathwaymapper.org/?pathwayName=<pw>&q=<JSON alterationData>&g=<genes joined by +>`
  - "Help" — the cBio help modal
- **PWY-1.4** "Add selected genes to query" `[C]`:
  - Selection contains non-gene nodes → message "Selection contains nodes that are not genes: ⟨…⟩. "
  - Any selected gene not in the valid set → "Following gene symbols are invalid or already in gene list: ⟨…⟩."
  - Otherwise the selected genes are appended to `gene_list` as a new line, and the app navigates to `results/oncoprint` (`ResultsViewPageHelpers.tsx:228-244`).
  - The valid set = non-query pathway genes that the gene API recognises, accumulated over every pathway viewed.
- **PWY-1.5** "Add all valid genes to query": appends every gene of the current pathway that is in the valid set; no-op if none `[C]`.
- **PWY-1.6** Message banner: shows "Loading alteration data..." while frequencies for non-query genes load; otherwise the last toolbar message, with a dismiss ×. Selecting a pathway clears it `[C]`.
- **PWY-1.7** Query genes are emphasized (thick black border, bold label) after every pathway change.

## 2. Ranking panel

- **PWY-2.1** Table (`PathwayMapperTable.tsx`):

| Column | Render | Sort | Filter |
|---|---|---|---|
| Pathway name | radio + bold name; names ≥20 chars truncated to 20 + "...", full name in tooltip | name | substring, case-insensitive |
| Score | **toFixed(2)** | score | substring of the raw number |
| Genes matched | space-joined query genes in the pathway, truncated with a tooltip | **count** of matched genes | substring |

- **PWY-2.2** Default sort Score desc, 10 rows/page, copy/download unless `skin_hide_download_controls=HIDE_ALL`. The page jumps to the one holding the selected pathway.
- **PWY-2.3** ☑ "Show TCGA PanCancer Atlas pathways only" `[default on]` (`ui/Ranking.tsx`).
  - On → only the 10 TCGA PanCan pathways: Cell Cycle, HIPPO, MYC, NOTCH, NRF2, PI3K, RTK-RAS, TGF-Beta, TP53, WNT ("Showing 1-10 of 10").
  - Off → all 55 pathways in `pathways.json` (TCGA PanCan + per-study, e.g. "COADREAD-2012-RTK-RAS-PI(3)K-pathway").
  - Turning it on while a non-PanCan pathway is selected switches to the top-ranked shown pathway.
- **PWY-2.4** "Ranking options": dropdown [Match count `[default]` | Match percentage] + ☐ "Consider alteration frequency". Info-icon texts are the `COUNT_PERC_EXPLANATION` and `ALTERATION_EXPLANATION` strings in `ui/Ranking.tsx`.
- **PWY-2.5** Initial pathway = top of the Match-count ranking (all 55 pathways), then the PanCan filter applies. Seen: RTK-RAS (3.00, KRAS NRAS BRAF), then WNT 1.00 (APC), TP53 1.00, Cell Cycle 1.00 (TP53), others 0.00.
- **PWY-2.6** Clicking a radio loads that pathway. Its genes without frequency data go to `changePathwayHandler`, which triggers PWY-STM-2.
- **PWY-2.7** Ranking state is *(local)*; not in the URL.

## 3. Gene node overlay

- **PWY-3.1** Each GENE node shows one box: the patient-level alteration % (PWY-STM-1), coloured per PWY-STM-3.
- **PWY-3.2** Box text: `"<0.5%"` if 0 < p < 0.5; else `p.toFixed(1) + "%"` (e.g. "37.4%", "0.0%"); not profiled → "N/P" on grey `rgb(210,210,210)` (`GenomicDataOverlayManager.ts:191-195`).
- **PWY-3.3** Seen (coadread, mutations+SV+GISTIC): KRAS 37.4%, BRAF 10.8%, NRAS 6.4%, EGFR 3.0%, HRAS 1.2%.
- **PWY-3.4** Non-query pathway genes get frequencies from a second, hidden ResultsViewPageStore built from the same URL query with `gene_list` = those genes. So: same study, case set and profiles; default OQL; the new store's own driver and germline settings (not the user's current RV-2 menu state) `[C]`.

---

## 4. Modes and conditions

| ID | Condition | Expected behavior |
|---|---|---|
| PWY-MD-1 | `show_pathway_mapper` off | PathwayMapper pill hidden |
| PWY-MD-2 | NDEx returns nothing or non-https | NDEx pill hidden |
| PWY-MD-3 | OQL query | Query-gene % reflect OQL (merged `[ ]` tracks: legacy bug, `gene` undefined, so no box) `[C]` |
| PWY-MD-4 | Unprofiled query gene | "N/P" grey box; contributes −101 to alteration-weighted scores (bug, PWY-STM-4) |
| PWY-MD-5 | Multi-study | Supported; % pooled across studies |
| PWY-MD-6 | Patient vs sample setting | Ignored; always patient level |

## 5. Persistence

- URL: sub-tab path segment only (PWY-0.3; restore broken).
- *(local)*: selected pathway, ranking dropdown, alteration checkbox, PanCan checkbox, table sort/page/filter, accumulated valid genes, node positions.

---

## 6. Statistics & methods

**PWY-STM-1 Per-gene alteration %** (`OncoprintUtils.ts:878-926, 1026-1073`; `react-pathway-mapper.tsx:307-318`)
- Always **patient level** (`sampleMode = false`).
- altered = patients with ≥1 OQL-filtered alteration in the gene's track, after the driver/VUS and germline filters (oncoprint track data).
- sequenced = patients profiled for the gene (`filteredSequencedPatientKeysByGene`; filtered cases per Show-only-profiled).
- p = altered / sequenced × 100. Note: numerator is all altered patients, not altered∩sequenced. sequenced = 0 → NaN → stored as −101 (N/P).
- Stored rounded `toFixed(2)` (`getGeneStudyMap`, `addPortalGenomicData`), displayed `toFixed(1)`.

**PWY-STM-2 Non-query gene frequencies** (`ResultsViewPathwayMapper.tsx:59-65, 139-174, 246-281`)
- Pathway genes lacking data → `fetchGenes` validates symbols → a hidden store computes PWY-STM-1 for them.
- Results are accumulated across pathway switches and pushed via `addGenomicData`. Invalid symbols get no box.

**PWY-STM-3 Colour** (`GenomicDataOverlayManager.ts:105-180`; scheme `react-pathway-mapper.tsx:232-236`)
- Default scheme `{-100: #0000ff, 0: #ffffff, 100: #ff0000}`; the user can edit it in the colour-scheme modal.
- For 0 ≤ p < 100 (interval [0,100]): ratio = 0.8 × ln(1+p) / ln(101); colour = white + ratio × (red − white), i.e. `rgb(255, round(255(1−ratio)), round(255(1−ratio)))`. Max at p→100 is ratio 0.8 = `rgb(255,51,51)`.
- p = 100 falls outside every half-open interval → pure red `#ff0000` (discontinuity, legacy quirk).
- Negative strings (−101 N/P) or p > 100 → grey `rgb(210,210,210)`.

**PWY-STM-4 Pathway ranking score** (`react-pathway-mapper.tsx:402-453`)
- Only query genes count. matched = query genes that are GENE-type nodes in the pathway. G = number of GENE-type nodes in the pathway.
- a_g = mean over profiles of the stored % for gene g (one profile, `cBioPortal_data`, so a_g = PWY-STM-1 value; N/P = −101); missing → 0. S = Σ_{g∈matched} a_g.

| Dropdown | Alteration checkbox | Score |
|---|---|---|
| Match count | off | \|matched\| |
| Match percentage | off | \|matched\| / G × 100 |
| Match count | on | S (percentage points; seen RTK-RAS 54.54 = 37.4+6.4+10.8; WNT 66.67 = APC) |
| Match percentage | on | \|matched\| × S / G |

- Legacy bugs:
  - The "percentage with alteration" formula multiplies by \|matched\|, contradicting the help text ("(0.2+0.3)/4").
  - The help text describes frequencies as fractions (0.5), but they are percentages (50).
  - An N/P query gene contributes −101 to S.
- Order: max-heap extraction by score; tie order unspecified (heap order), then the table re-sorts by Score desc (stable).
