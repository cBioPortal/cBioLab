# Legacy parity spec — Results View › CN Segments (IGV)

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df` (bundles `igv@2.11.2`).
Conventions as in `01-oncoprint.md`: `[default]`, `URL:`, *(local)*; `[B]` browser-only, `[C]` code-only, untagged = both.

Reference query:
- `/results/cnSegments?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS TP53`

Key files: `src/pages/resultsView/cnSegments/CNSegments.tsx`, `src/shared/lib/IGVUtils.ts`, `src/shared/components/igv/IntegrativeGenomicsViewer.tsx`, `src/shared/components/cnSegments/CNSegmentsDownloader.tsx`, `ResultsViewPageStore.ts:1354-1395`, `node_modules/igv/dist/igv.esm.js` (`SegTrack`, ~l.43020-43460).

---

## 0. Visibility and chrome

- **CNS-0.1** Tab label "CN Segments" (legacy id `IGV` maps here). Hidden until studies, genes and reference genes load, and hidden if no queried sample has `copyNumberSegmentPresent` (`ResultsViewPage.tsx:497-509`; `ResultsViewPageStoreUtils.ts:463-471`). Multi-study allowed.
- **CNS-0.2** Banner: CaseFilterWarning only (no OQL or alteration-filter banner) (`CNSegments.tsx:186-196`) `[C]`.
- **CNS-0.3** Loading: spinner + sequential progress list "Loading copy number segments data..." then "Rendering"; IGV stays at opacity 0 until IGV's first render completes (`CNSegments.tsx:152-177, 217-223`) `[C]`.

## 1. Controls

- **CNS-1.1** Pill nav: "Whole Genome", then one pill per queried gene (query order). Default active = **first gene** (`CNSegments.tsx:54-64, 197-209`). *(local)*
- **CNS-1.2** Download button (top right, `fa-cloud-download`, tooltip "Download a copy number segment file for the selected samples"; spinner while fetching) (`CNSegmentsDownloader.tsx`). Shown only when `skin_hide_download_controls=SHOW_ALL`.
  - Always downloads **whole-genome** segments for all filtered samples, whatever pill is active, and even above the sample threshold (CNS-MD-3).
  - Filename `<prefix>segments.seg`; prefix = `<studyId>_` (one study) or `combined_study_` (several) (`FilenameUtils.ts:11-23`).
- **CNS-1.3** IGV navbar (seen): "IGV", genome id (`hg19`/`hg38`), chromosome `<select>`, locus search box + 🔍, window width ("47 kb"), buttons Cursor Guide | Center Line | Track Labels (on) | Sample Names | Save SVG, zoom −/slider/+.
  - Gene pill active → locus box shows the gene locus (KRAS: `chr12:25,357,179-25,404,870`); chromosome select and search box **disabled**.
  - Whole Genome → locus `all`; search enabled.
- **CNS-1.4** Tracks: ideogram, ruler, reference sequence/gene track (IGV default), and one seg track named **"CNA"**, `displayMode: 'FILL'` (`IGVUtils.ts:63-70`).
- **CNS-1.5** Track gear menu (IGV): rename, height, … and "DisplayMode:" Squish / Expand / Fill `[C]`. Right-click on the seg track → "Sort by value" (toggles DESC → ASC) (`igv.esm.js` `SegTrack.contextMenuItemList`) `[C]`.
- **CNS-1.6** Segment popup on click (`IGVUtils.ts:217-235`) `[C]`:
  - Sample: `<sampleId>`
  - Mean CN log2 value: `<segmentMean>` (raw)
  - Location: `chr<N>:<start>-<end>` with locale thousands separators.
- **CNS-1.7** "Too many samples (>20000) for the whole genome view. Try to select a different sample list." replaces the Whole Genome view when filtered samples > 20000 (`CNSegments.tsx:40-42, 93-107, 210-216`) `[C]`.

## 2. Data

- **CNS-2.1** Samples = `filteredSamples` (queried samples minus unprofiled ones when Show-only-profiled is on). No OQL, driver or alteration filter.
- **CNS-2.2** Requests: `POST /api/copy-number-segments/fetch?projection=DETAILED[&chromosome=<chr>]`, body = sample identifiers (`StoreUtils.ts:423-440`).
  - Gene pill: chromosome = the reference gene's chromosome (seen `chromosome=12` for KRAS); one cached request per distinct chromosome.
  - Whole Genome: no chromosome filter.
- **CNS-2.3** Feature mapping (`IGVUtils.ts:153-168`): `chr = normalizeChromosome(chromosome)`, `start`, `end`, `value = segmentMean`, `sample = sampleKey = sampleId`.
  - Legacy bug: rows are keyed by `sampleId` only, so multi-study queries with the same sample id collapse into one row.
- **CNS-2.4** Genome: the **first** study's `referenceGenome` (default hg19) for every study (`ResultsViewPageStore.ts:4764-4767`).

## 3. Rendering

- **CNS-3.1** Track height = max(25, min(0.7 × window height, distinctSamples × 10)) px (`IGVUtils.ts:186-199`; `CNSegments.tsx:47-52`). Max is fixed at mount.
- **CNS-3.2** Colour scale (igv.js defaults; cBioPortal sets no colour config) `[C]`:

| log2 value v | Colour |
|---|---|
| v < −0.1 | gradient from blue `rgb(0,0,255)` at ≤ −1.5 to white at −0.1 |
| −0.1 ≤ v ≤ 0.1 | white |
| v > 0.1 | gradient from white at 0.1 to red `rgb(255,0,0)` at ≥ 1.5 |

- **CNS-3.3** Log detection `[C]`: `isLog` is never set, so igv.js sets it true only if any loaded value is < 0. Otherwise it treats values as linear copy number and colours log2(v/2). Legacy bug: an all-non-negative seg set is miscoloured.
- **CNS-3.4** Row height in FILL mode = track height ÷ number of samples. If a row is < 0.25 px, the bar height is scaled by min(1, 0.1 + 2·|v|) `[C]`.
- **CNS-3.5** Sample order: IGV first-seen order of returned segments (no explicit sort); "Sort by value" ranks samples by the overlap-weighted mean of segment values in a ±2.5-pixel window around the click `[C]`.

---

## 4. Modes and conditions

| ID | Condition | Expected behavior |
|---|---|---|
| CNS-MD-1 | Gene pill | Chromosome-scoped fetch; locus = gene; search and chromosome select disabled |
| CNS-MD-2 | Whole Genome | Full fetch; locus `all`; search enabled |
| CNS-MD-3 | Filtered samples > 20000 and Whole Genome | No fetch; message (CNS-1.7); gene pills still work |
| CNS-MD-4 | No sample has segment data | Tab hidden |
| CNS-MD-5 | Show only profiled on | Fewer samples (filteredSamples); banner |
| CNS-MD-6 | Multi-study | One track; first study's genome; sample-id collisions merge (CNS-2.3) |
| CNS-MD-7 | Gene missing from the reference genome map | Legacy bug: the `chromosome` lookup throws (`CNSegments.tsx:74-83`), `activePromise` resolves to undefined, and the spinner never clears `[C]` |
| CNS-MD-8 | `skin_hide_download_controls` ≠ `SHOW_ALL` | Download button hidden |

## 5. Persistence

- URL: none beyond the tab path.
- *(local)*: active pill, IGV locus/zoom, display mode, sort, toggled IGV buttons.

---

## 6. Statistics & methods

**CNS-STM-1 Segment file** (`IGVUtils.ts:130-151`)
- Tab-separated, header `ID  chrom  loc.start  loc.end  num.mark  seg.mean`.
- One row per segment, API order. Values unformatted: `sampleId`, `chromosome` as stored (not normalized), `start`, `end`, `numberOfProbes`, `segmentMean`.
- No trailing newline. Only the filtered samples.

**CNS-STM-2 Displayed values**
- The only number displayed is the raw `segmentMean` (popup) and the colour mapping in CNS-3.2. No aggregation across samples.
