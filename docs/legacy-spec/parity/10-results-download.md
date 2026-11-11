# Parity audit — Results › Download (spec `10-results-download.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day)
- **Code paths (cBioLab):** `lib/views/datafiles/{run,sql,tables,types}.ts`, `lib/views/datafiles/README.md`, `app/lab/kinds/datafiles.tsx` (file rows, frequency table), `app/_table/DataTable.tsx` (case table), `lib/table-query.ts`, `app/portal/results-layout.ts` (tab, `pinsOf`)

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 | `/results/download?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS NRAS BRAF TP53 APC` | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%20NRAS%20BRAF%20TP53%20APC` › Download; `POST /api/analysis` `{kind:"datafiles", oql:["KRAS","NRAS","BRAF","TP53","APC"]}` |
| Q5 OQL | same, `gene_list=KRAS: AMP MUT=G12D⏎TP53` | `{kind:"datafiles", oql:["KRAS: AMP MUT=G12D","TP53"]}` |

The spec's reference query adds `rna_seq_v2_mrna_median_Zscores` (525 altered); Q1 leaves it out so both apps read the same profiles. Files were not downloaded this time; file contents are judged from code and the spec's captures. Scripts and output: (local scratch, not committed) (`legother.js dl`, `out/leg-dl1.txt`, `out/leg-dl5.txt`, `out/lab-dl.png`, `out/lab-dl1.json`, `out/lab-dl5.json`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 5 |
| 🟡 partial | 23 |
| 🔶 different | 6 |
| ❌ missing | 4 |
| 🐞 ok | 1 |
| 🐞 copied | 0 |
| N/A | 2 |
| ? | 0 |
| **Total IDs** | **41** |

**Overall: 19.5 %** (✅ 5 + 🐞ok 1 + N/A 2 = 8 of 41). Counting 🟡 as half: 47.6 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Chrome (0.x) | 4 | 2 | 2 | 0 | 0 | 0 | 0 | Same three sections; no hide switch |
| §1 Data files (1.x) | 13 | 1 | 10 | 1 | 1 | 0 | 0 | Every profile offered as CSV; no transposed; no generic-assay rows; lists open as a lab cohort |
| §2 Gene frequency (2.x) | 6 | 0 | 2 | 4 | 0 | 0 | 0 | Counts identical; 1-decimal %, no bar, no sort/paging |
| §3 Case table (3.x) | 6 | 0 | 4 | 0 | 1 | 1 | 0 | Cells match minus "(Driver)" tags; no Study ID column, no per-alteration columns |
| §4 Modes (MD) | 6 | 1 | 1 | 1 | 1 | 0 | 2 | OQL handled as legacy |
| §6 Statistics (STM) | 6 | 1 | 4 | 0 | 1 | 0 | 0 | Altered 485 / 344 and every line's count identical; Unaltered excludes not-profiled (invariant 7) |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **CSV only, no tab-delimited / transposed files**; columns `cohort, study, Sample ID, Patient ID, genes…` | 1.1–1.5, 1.9, STM-4 | (tracked) "Tab-delimited and transposed downloads" |
| 2 | **Percent shown at 1 decimal** ("37.4%") vs legacy integer ≥ 3 % ("37%"); no FrequencyBar; download value a number, not the `percentAltered` string | 2.4, 2.5, STM-2 | not tracked |
| 3 | **Case table cells lack "(Driver)" and the Germline badge** ("G12D" vs "G12D(Driver)") | 3.4 | not tracked |
| 4 | **Unaltered list = 55, legacy 109**: 54 samples not profiled in every data type are left out (NP), per invariant 7 | 1.7, STM-1, STM-3 | N/A (deliberate, README) |
| 5 | **No Query / Virtual Study actions** on the altered/unaltered rows; "Open as cohort" (lab) instead | 1.6, 1.7, 1.13 | not tracked |
| 6 | **No generic-assay rows** ("Tracks added in the OncoPrint tab…") | 1.10, STM-6, MD-4 | not tracked (README: deliberate) |
| 7 | **Gene frequency table**: no sort, paging, filter or column menu; extra "Profiled" column and visible OQL line | 2.1, 2.6 | not tracked |
| 8 | **Case table**: no Study ID column/links; Altered as "altered/unaltered/not profiled" not 1/0; 25 per page (legacy 20) | 3.1, 3.5 | not tracked |
| 9 | No hidden per-alteration columns (`KRAS: MUT`, `KRAS: AMP`) | 3.3 | not tracked |
| 10 | No `skin_hide_download_controls` switch | 0.1, MD-5 | (tracked) Data-governance switches |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 altered samples | STM-1 | 485 (header "485 (82%)") | 485 (81.6%) | ✅ count |
| Q1 unaltered samples | STM-1 | 109 (594 − 485) | 55 (+ 54 "neither") | N/A invariant 7 |
| Q1 APC | STM-2 | 396 · 67% | 396 / 594 · 66.7% | 🟡 count ✅ |
| Q1 TP53 | STM-2 | 315 · 53% | 315 / 594 · 53.0% | 🟡 |
| Q1 KRAS | STM-2 | 222 · 37% | 222 / 594 · 37.4% | 🟡 |
| Q1 BRAF | STM-2 | 64 · 11% | 64 / 594 · 10.8% | 🟡 |
| Q1 NRAS | STM-2 | 38 · 6% | 38 / 594 · 6.4% | 🟡 |
| Q5 header / altered | STM-1, MD-1 | 344 (58%) | 344 (57.9%) | ✅ count |
| Q5 `KRAS: AMP MUT=G12D` | STM-2, MD-1 | 63 · 11% | 63 / 594 · 10.6% | 🟡 count ✅ |
| Q5 TP53 | STM-2 | 315 · 53% | 315 · 53.0% | 🟡 |
| Q1 case table, first rows | 3.4 | TCGA-3L-AA1B-01: — / G12D(Driver) / L597V(Driver) / — / R1450*(Driver), R876*(Driver) | — / G12D / L597V / — / R1450*, R876* | 🟡 same calls, no driver tag |
| Q5 case table TCGA-5M-AATE-01 TP53 (Q1) | 3.4 | S127T(Driver), HOMDEL(Driver) | S127T, HOMDEL | 🟡 |
| Q1 file rows | STM-4 | all 594 samples | 594 rows per file | ✅ |

Data version: every count identical.

---

## 4. Scorecard

### §0 Visibility and chrome

| ID | verdict | how | note |
|---|---|---|---|
| RDL-0.1 | 🟡 | B | Tab "Download" always present; no hide switch (tracked) |
| RDL-0.2 | 🟡 | B | Page-level OQL note; no AlterationFilter / CaseFilter banners (no such settings) |
| RDL-0.3 | ✅ | C | Waits with its own cover (`drawsOwnWaiting`); errors as refusals |
| RDL-0.4 | ✅ | B | "Downloadable data files", "Gene alteration frequency", "Type of genetic alterations across all samples", in order |

### §1 Downloadable data files

| ID | verdict | how | note |
|---|---|---|---|
| RDL-1.1 | 🟡 | B | CNA as "Putative copy-number alterations from GISTIC" (the profile's name, not "Copy-number Alterations (OQL is not in effect)"); CSV only (tracked) |
| RDL-1.2 | 🟡 | B | "Mutations (OQL is not in effect)" ✅; CSV only |
| RDL-1.3 | 🟡 | BC | "Structural Variants (OQL is not in effect)" ✅; shown when the study holds an SV profile, not when any SV exists; CSV only |
| RDL-1.4 | 🟡 | B | Every mRNA profile offered by name; no "selected in the query" row (the query's mRNA choice does not change the list) |
| RDL-1.5 | 🟡 | B | Same for protein |
| RDL-1.6 | 🟡 | B | "Altered samples" 485 rows: CSV, Copy, Open as cohort; no Download as `altered_samples.txt`, Query, Virtual Study |
| RDL-1.7 | 🟡 | B | "Unaltered samples" 55 rows (see STM-1); same actions |
| RDL-1.8 | 🟡 | B | "Sample matrix: … 1 = altered, 0 = unaltered, NP = not profiled": CSV only, no Copy |
| RDL-1.9 | 🟡 | B | Each profile its own row with a description line (no ⓘ tooltip); CSV only |
| RDL-1.10 | ❌ | B | No generic-assay rows |
| RDL-1.11 | 🟡 | B | Rows: GISTIC, Log2, mRNA, z (normal), z (all), z (diploid), CPTAC, CPTAC z, RPPA, RPPA z — same profiles; z-score order reversed vs legacy (diploid, all, normal) |
| RDL-1.12 | ✅ | C | Mutation/SV types not in the profile list; ordered MUTATION, CNA, GENESET, MRNA, METHYLATION, …, PROTEIN (`run.ts:113`); one row per profile id (= name for one study) |
| RDL-1.13 | 🔶 | C | Copy → clipboard "`study:sample`" one per line ✅ with "N sample ids copied"; Query/Virtual Study replaced by "Open as cohort" (lab document with a `sampleList` clause) |

### §2 Gene Alteration Frequency

| ID | verdict | how | note |
|---|---|---|---|
| RDL-2.1 | 🔶 | B | Gene \| OQL line (visible) \| Altered \| Profiled \| Altered %; extra Profiled column |
| RDL-2.2 | 🟡 | C | One row per line ✅; merged `[ ]` refused on the Results page (one gene per line, `run.ts:125`) |
| RDL-2.3 | 🟡 | C | Unprofiled → "—" in %, altered shows 0, no "Not Profiled" |
| RDL-2.4 | 🔶 | B | `toFixed(1)` "37.4%" vs `getPercentage` "37%" / "<1%"; no 200 px bar |
| RDL-2.5 | 🔶 | C | CSV `percent_altered` = 37.4 (number), not "37%" / "2.5%" / "N/P"; extra `profiled` column |
| RDL-2.6 | 🔶 | B | Query order, no sort/paging/filter/column menu; `gene_alteration_frequency.csv` |

### §3 Type of Genetic Alterations Across All Samples

| ID | verdict | how | note |
|---|---|---|---|
| RDL-3.1 | 🟡 | B | Sample ID, Patient ID, Altered; no Study ID column (study in the CSV), no links, "altered/unaltered/not profiled" text instead of 1/0, no tooltip |
| RDL-3.2 | 🟡 | B | One column per line; header = gene for a bare gene ✅, the OQL text for others ("KRAS: AMP MUT=G12D", legacy same without ";") ✅; merged tracks impossible (refused) |
| RDL-3.3 | ❌ | C | No hidden per-alteration columns |
| RDL-3.4 | 🟡 | B | Calls joined ", " ✅ incl. CNA ("S127T, HOMDEL") ✅; "no alteration"/"not profiled" ✅; no "(Driver)", no Germline badge |
| RDL-3.5 | 🟡 | B | Altered first ✅; 25/page (legacy 20); search, columns menu, CSV download (`/api/table`) always on |
| RDL-3.6 | 🐞 ok | C | Regex filters validated (`table-query.ts:120`): bad input is refused, not thrown |

### §4 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| RDL-MD-1 | ✅ | BC | Q5: frequencies, lists and case table follow OQL (63 / 344); files list every call ("OQL is not in effect") |
| RDL-MD-2 | N/A | C | No driver/VUS/germline settings exist (tracked: Driver-annotation settings) |
| RDL-MD-3 | N/A | C | No Show-only-profiled setting (RV-2) |
| RDL-MD-4 | 🟡 | C | Multi-study: profile rows per profile id with "only X hold it"; no GA rows anyway; studies not deduplicated (invariant 3) |
| RDL-MD-5 | ❌ | C | No hide switch (tracked) |
| RDL-MD-6 | 🔶 | C | Merged tracks refused on the Results page (tracked: OQL coverage / per-track OQL in merged groups) |

§5 Persistence (no IDs): case-table search, filters, sort and columns are in the document (invariant 9); legacy keeps them local.

### §6 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| RDL-STM-1 | 🟡 | BC | Altered identical (485, 344), sample level ✅; Unaltered requires profiling for every line's gene and data type (55 vs 109; invariant 7, README); files are CSV with header and cohort/study/patient columns, Copy gives `study:sample` lines |
| RDL-STM-2 | 🟡 | BC | Numerator, denominator (profiled for the gene in any type the line reads; 594 here) identical; rounding 1 decimal vs `percentAltered` |
| RDL-STM-3 | 🟡 | C | One column per **line** (not per gene); unprofiled `NP` (legacy `0`); `Altered` 1/0/NP |
| RDL-STM-4 | ✅ | C | All cohort samples; mutations space-joined with " [germline]" and `WT`; SV `NA`; profiles raw value / `NA`; `NP` from panels for mutation, SV, discrete CNA (`tables.ts:100-150`); format CSV/no transposed counted under 1.x |
| RDL-STM-5 | 🟡 | C | Same matrix for every non-selected profile; discrete CNA gets `NP` (legacy never); transposed bug moot (no transposed) |
| RDL-STM-6 | ❌ | C | No generic-assay files |

---

## 5. cBioLab bugs

- None found.
