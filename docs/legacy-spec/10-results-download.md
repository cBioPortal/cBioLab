# Legacy parity spec — Results View › Download

Source of truth: cbioportal.org (checked 2026-11-10; files downloaded and inspected) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Conventions as in `01-oncoprint.md`: `[default]`, `URL:`, *(local)*; `[B]` browser-only, `[C]` code-only, untagged = both.

Reference query:
- `/results/download?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic,rna_seq_v2_mrna_median_Zscores&gene_list=KRAS NRAS BRAF TP53 APC` (594 samples; 525 altered / 69 unaltered).

Key files: `src/pages/resultsView/download/DownloadTab.tsx`, `DownloadUtils.ts`, `GeneAlterationTable.tsx`, `CaseAlterationTable.tsx`; `shared/components/copyDownloadControls/*`; `ResultsViewPageStore.ts` (`nonOqlFilteredAlterations` 1907, `nonOqlFilteredCaseAggregatedData` 2086, `nonSelectedDownloadableMolecularProfiles` 4408-4493, `virtualStudyParams` 2935).

---

## 0. Visibility and chrome

- **RDL-0.1** Tab "Download". Absent when `skin_hide_download_controls=HIDE_ALL` (`ResultsViewPage.tsx:597-613`).
- **RDL-0.2** Banners: OQL status (`tabReflectsOql=true`), AlterationFilterWarning, CaseFilterWarning (`DownloadTab.tsx:675-718`).
- **RDL-0.3** Whole tab shows a spinner until all its data promises resolve; any error → ErrorMessage (`:637-671`).
- **RDL-0.4** Sections, in order:
  1. "Downloadable Data Files" (striped table)
  2. `<hr>` "Gene Alteration Frequency" table
  3. `<hr>` "Type of Genetic Alterations Across All Samples" table

## 1. Downloadable Data Files — rows (in order; `DownloadTab.tsx:733-806`)

`SHOW_ALL` = row shown only when `skin_hide_download_controls=SHOW_ALL`.

| # | Row label | Shown when | Links → filename |
|---|---|---|---|
| RDL-1.1 | Copy-number Alterations (OQL is not in effect) | any CNA value in selected CNA profile; SHOW_ALL | Tab Delimited Format → `cna.txt`; Transposed Matrix → `cna_transposed.txt` |
| RDL-1.2 | Mutations (OQL is not in effect) | any mutation; SHOW_ALL | `mutations.txt`; `mutations_transposed.txt` |
| RDL-1.3 | Structural Variants (OQL is not in effect) | any SV `eventInfo`; SHOW_ALL | `structural_variants.txt`; `structural_variants_transposed.txt` |
| RDL-1.4 | ⟨name of the first selected mRNA profile⟩ | mRNA profile selected in the query and has data; SHOW_ALL | `<profile name>.txt` (both links — legacy bug: transposed has the same filename) |
| RDL-1.5 | ⟨name of the first selected protein profile⟩ | protein profile selected and has data; SHOW_ALL | same as RDL-1.4 |
| RDL-1.6 | Altered samples | always | Copy \| Download → `altered_samples.txt` \| Query \| Virtual Study |
| RDL-1.7 | Unaltered samples | always | Copy \| Download → `unaltered_samples.txt` \| Query \| Virtual Study |
| RDL-1.8 | Sample matrix: List of all samples where 1=altered and 0=unaltered | always | Copy \| Download → `sample_matrix.txt` |
| RDL-1.9 | one row per non-selected profile name (+ ⓘ description tooltip, single study only) | ≥1 such profile; SHOW_ALL | Tab Delimited Format / Transposed Matrix → `<profile name>.txt` |
| RDL-1.10 | one row per generic-assay profile group (+ ⓘ description) | single study; GA profiles exist; SHOW_ALL | if tracks for that group were added in OncoPrint: Tab Delimited / Transposed → `<profile name>.txt`; else "Tracks added in the [OncoPrint tab] can be downloaded here." (link switches tab) |

- **RDL-1.11** Seen non-selected rows (coadread): Log2 copy-number values; mRNA Expression, RSEM (Batch normalized…); mRNA z-scores relative to all samples / normal samples; Protein levels (CPTAC); Protein level z-scores (CPTAC); Protein expression (RPPA); Protein expression z-scores (RPPA). GA rows: Putative arm-level copy-number from GISTIC; Genetic Ancestry; Methylation (HM27 and HM450 merge); Methylation (HM450).
- **RDL-1.12** Non-selected profiles (`ResultsViewPageStore.ts:4408-4493`; `ResultsViewPageStoreUtils.ts:844-858`):
  - All study profiles minus the query's selected profiles, minus MUTATION_EXTENDED, MUTATION_UNCALLED, FUSION, STRUCTURAL_VARIANT and GENERIC_ASSAY types.
  - Grouped by profile **name**, so multi-study same-name profiles share one row.
  - Sorted by type: MUTATION 1, CNA 2, GENESET_SCORE 3, MRNA 4, METHYLATION 5, METHYLATION_BINARY 6, PROTEIN 7, other last.
- **RDL-1.13** Copy → clipboard, then a transient "Copied!" message. Query → opens the Modify Query form prefilled with a custom case list (`CUSTOM_CASE_LIST_ID`) of those `studyId:sampleId`, sample mode (`DownloadTab.tsx:1404-1413`). Virtual Study → save-virtual-study overlay `[C]`:
  - name = the current virtual study's name, if exactly one is queried;
  - description = "`N` altered samples from:\n\n" (or "unaltered") + one study name per line;
  - samples = the listed samples.

## 2. Gene Alteration Frequency table (`GeneAlterationTable.tsx`)

- **RDL-2.1** Columns: Gene Symbol | OQL Line (hidden by default) | Num Samples Altered | Percent Samples Altered.
- **RDL-2.2** One row per **flattened** OQL line (merged `[ ]` groups expand to per-gene lines; a gene on two lines gives two rows).
- **RDL-2.3** "Num Samples Altered" shows `altered`, or "Not Profiled" if sequenced = 0 (download `N/P`).
- **RDL-2.4** "Percent Samples Altered" is a FrequencyBar (200 px bar + text). Text = `getPercentage(altered/sequenced)`: 0 → "0%"; <1% → "<1%"; else `Math.round`. Seen: APC 408 69%, TP53 351 59%, KRAS 246 41%, BRAF 112 19%, NRAS 66 11%. Not profiled → "Not Profiled".
- **RDL-2.5** Download value of the percent column = `percentAltered` string (RDL-STM-2 rounding, not the displayed one).
- **RDL-2.6** Default sort Percent desc (sort key altered/sequenced); 10/page; filter on gene (and OQL line); column menu "Columns"; copy/download unless HIDE_ALL; filename `gene_alteration_frequency.tsv`.

## 3. Type of Genetic Alterations Across All Samples (`CaseAlterationTable.tsx`)

- **RDL-3.1** Fixed columns:
  - Study ID (study link)
  - Sample ID (sample-page link, new tab)
  - Patient ID (patient-page link)
  - Altered, `1`/`0`, tooltip "1 = Sample harbors alteration in one of the input genes"
- **RDL-3.2** One visible column per **unflattened** OQL line (track). Header (`ResultsViewPageStoreUtils.ts:599-627`):
  - Single gene: gene symbol if its alterations equal the default OQL; else `oql_line` minus the trailing `;` (e.g. `KRAS: MUT`).
  - Merged track: its label, or genes joined " / ".
- **RDL-3.3** Hidden extra columns, one per (gene × parsed OQL alteration): header `<gene>: <source OQL of that alteration>` (e.g. `KRAS: MUT`, `KRAS: AMP`). Content = that gene's data for that alteration **type**, regardless of the qualifier.
- **RDL-3.4** Cell content (`CaseAlterationTable.tsx` `generateOqlValue` / `getPseudoOqlSummaryByAlterationTypes`). For each alteration type in the track's OQL (`MUT`, `CNA`, `EXP`, `PROT`, `FUSION`):
  - not profiled for every type → "not profiled";
  - else the altered parts joined ", ";
  - else "no alteration".

  Parts by type:

| Type | Text (screen) | Text (download) |
|---|---|---|
| MUT | `<proteinChange>` + "Germline" badge + "(Driver)" | `<pc>[ [germline]][ (driver)]` |
| CNA | `AMP`/`GAIN`/`HETLOSS`/`HOMDEL` + "(Driver)" | `<type>[ (driver)]` |
| EXP / PROT | `HIGH` / `LOW` | same |
| FUSION | SV `eventInfo` | same |

  Seen: "G12D(Driver)", "R1450*(Driver), R876*(Driver)", "S127T(Driver), HOMDEL(Driver)", "V173Efs*7(Driver), LOW".
- **RDL-3.5** Default sort Altered desc; 20/page; filter box; column menu; horizontal scroll. Copy/download only when SHOW_ALL; filename `alterations_across_samples.tsv`.
- **RDL-3.6** Legacy bug: per-column filters use `new RegExp(filterString, 'i')`, so input like `(` or `*` throws.

---

## 4. Modes and conditions

| ID | Condition | Expected behavior |
|---|---|---|
| RDL-MD-1 | OQL query | Sections 2–3, altered/unaltered and the matrix follow OQL; data files (1.1–1.5, 1.9) do not ("OQL is not in effect") |
| RDL-MD-2 | Show only drivers / hide VUS / exclude germline | Applies to **all** sections, including the "OQL is not in effect" files (they use the filtered, annotated data) |
| RDL-MD-3 | Show only profiled on | Sections 2–3 and the altered/unaltered/matrix lists use filtered samples; data files still list **all** queried samples (hidden ones get NA/NP) |
| RDL-MD-4 | Multi-study | GA rows hidden; non-selected rows merged by name, no ⓘ; filenames unchanged |
| RDL-MD-5 | `skin_hide_download_controls=SHOW_ALL` vs other | Other → only rows 1.6–1.8 remain; case table loses copy/download |
| RDL-MD-6 | Merged gene track | One track column; gene-frequency rows per member gene |

## 5. Persistence

- URL: none beyond the tab path. All table sort/filter/page/column choices *(local)*.

---

## 6. Statistics & methods

**RDL-STM-1 Altered / unaltered case lists** (`DownloadUtils.ts` `generateCaseAlterationData` l.772-906, `initializeCaseAlterationData` l.908-934; `DownloadTab.tsx:141-170, 398-416, 1150-1236`)
- Universe = `filteredSamples` (sample level, never patient level).
- For each OQL line (flattened and unflattened), oncoprint genetic-track data is built per sample. A sample is **altered** if any track datum for it has ≥1 alteration that matched the OQL after driver/VUS/germline filtering.
- Unaltered = universe − altered.
- File format: one `studyId:sampleId` per line, `\n`-joined, no trailing newline, in caseAlterationData order (samples order).

**RDL-STM-2 Gene frequency** (`DownloadUtils.ts:192-216`; `OncoprintUtils.ts:857-926, 960-1000`)
- Sample level, per flattened OQL line.
- altered = filtered samples with ≥1 OQL-matched alteration for that line.
- sequenced = `filteredSequencedSampleKeysByGene[gene]` (profiled per gene panel in ≥1 selected profile).
- percent = alteredAndSequenced / sequenced via `percentAltered`: <3% → 1 decimal (".0" dropped), else integer, with a "%" suffix (e.g. "69%", "2.5%"); sequenced 0 → "N/P". This string is the download value.
- The table returns no rows if `sequencedSampleKeysByGene` is empty.

**RDL-STM-3 Sample matrix** (`DownloadTab.tsx:418-449`)
- Header: `studyID:sampleId`, `Altered`, then one column per **gene** (keys of `oqlDataByGene`, first-seen order).
- Gene cell = `1` if the sample has ≥1 OQL-matched alteration in that gene, else `0` (unprofiled → `0`). `Altered` = RDL-STM-1.

**RDL-STM-4 CNA / mutation / SV / mRNA / protein files** (`DownloadUtils.ts` `generateDownloadData` l.703-770)
- Rows = **all** queried samples (`store.samples` order); columns `STUDY_ID`, `SAMPLE_ID`, then query genes in query order.
- Source = `nonOqlFilteredCaseAggregatedData`: selected-profile data after driver/VUS/germline filters, ignoring OQL.

| File | Cell value | Empty | Not profiled* |
|---|---|---|---|
| cna | `String(value)` of discrete CNA (seen −2…2, including 0) | `NA` | `NP` |
| mutations | `proteinChange` + ` [germline]` if germline; several space-joined; no driver tag | `WT` | `NP` |
| structural_variants | `eventInfo`, space-joined | `NA` | `NP` |
| mRNA / protein | `String(value)` (raw, e.g. `0.2115`) | `NA` | `NP` |

- *Not profiled = no selected profile of that type in the sample's study, or the gene is not in the sample's panel.
- Mutation data also include legacy `FUSION`-type records.
- Transposed = `_.unzip` of the same matrix: rows `STUDY_ID`, `SAMPLE_ID`, then one per gene.
- Tab-separated, `\n`-joined, no trailing newline.

**RDL-STM-5 Non-selected profile files** (`DownloadUtils.ts:383-473`)
- On click: `POST molecular-data/fetch` (DETAILED) for query genes × (every queried sample in a study that has the profile × every profile in the name group).
- Same matrix as RDL-STM-4: `String(value)`, several space-joined; missing → `NA`; never `NP` (no profiling check).
- GENESET_SCORE profiles in this list fetch by gene and so come back all `NA` `[C]`.
- Legacy bug: Transposed passes the 2-D array, not text, to `fileDownload`. The file is one comma-joined line with no tabs or newlines (confirmed in the browser).

**RDL-STM-6 Generic-assay files** (`DownloadUtils.ts:475-569`; `DownloadTab.tsx:210-258`)
- Columns: `STUDY_ID`, `SAMPLE_ID`, then each entity selected in OncoPrint for that profile group. Header = entity meta `NAME` (fallback stableId), or the compact "name (id)" label when the GA type config sets `formatDownloadHeaderUsingCompactLabel`.
- Rows = all queried samples. Cells = values space-joined, else `NA`. Transposed works correctly.
