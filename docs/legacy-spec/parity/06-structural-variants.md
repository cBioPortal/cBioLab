# Parity audit — Results › Structural Variants (spec `06-structural-variants.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day)
- **Code paths (cBioLab):** `app/portal/results-layout.ts` (`svTab`, `svCheckCohort`, tab hiding), `lib/views/sv/*` (runner, `README.md`, profiled SQL), `lib/sv-table.ts` (rows, columns, OncoKB join, default order), `app/lab/kinds/sv.tsx`, `app/_table/DataTable.tsx`, `lib/table-query.ts`

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 reference | `/results/structuralVariants?cancer_study_list=prad_tcga_pan_can_atlas_2018&case_set_id=prad_tcga_pan_can_atlas_2018_all&gene_list=TMPRSS2 ERG ETV1&profileFilter=mutations,structural_variants&mutations_gene=<TMPRSS2\|ERG\|ETV1>` | `/portal/results?study=prad_tcga_pan_can_atlas_2018&genes=TMPRSS2%20ERG%20ETV1&tab=Structural%20Variants` (+ chips) |
| Q1 Mutations tab (fusion cross-check) | same, `/results/mutations…&mutations_gene=TMPRSS2` | same, `&tab=Mutations` |

Legacy: header text and "Download TSV" per gene. cBioLab: the same `sv` view per gene via `/api/analysis` and `/api/table` (CSV), plus the page in the browser. Rows joined on Sample ID + Gene 1 + Gene 2 + Site1/Site2 Position. Scripts and screenshots: (local scratch, not committed) (`legsv.js`, `labsv.js`, `lab.js`; `out/legsv-TMPRSS2.png`, `out/lab-SV.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 25 |
| 🟡 partial | 11 |
| 🔶 different | 8 |
| ❌ missing | 7 |
| 🐞 ok | 2 |
| 🐞 copied | 0 |
| N/A | 1 |
| ? | 0 |
| **Total IDs** | **54** |

**Overall: 51.9 %** (✅ 25 + 🐞ok 2 + N/A 1 = 28 of 54). Counting 🟡 as half: 62.0 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §1 Tab and layout (SV) | 8 | 4 | 3 | 1 | 0 | 0 | 0 | Tab hidden/shown as legacy, both-partner rows identical; no "Beta!", no info alert |
| §2 Table (TB) | 6 | 1 | 3 | 2 | 0 | 0 | 0 | Shared table: numbered pager, header filters, CSV; no duplicate suffix; default sort differs |
| §2 Columns (COL) | 23 | 16 | 3 | 0 | 3 | 1 | 0 | Every stored column with identical values; no Exon/Intron, no Center; Annotation blank |
| §3 Annotation (AN) | 5 | 0 | 1 | 4 | 0 | 0 | 0 | Gene-level "Fusion" entry of the stronger partner; store holds none, so blank |
| §4 Modes (MD) | 7 | 3 | 1 | 0 | 1 | 1 | 1 | Hiding, empty genes, site2 rows match; no duplicate suffix |
| §6 Statistics (STM) | 5 | 1 | 0 | 1 | 3 | 0 | 0 | Row counts identical; duplicates and exon rank not shown; fusions absent from Mutations |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Annotation column blank** on all 236 TMPRSS2 rows (store has no SV entries; gene-level "Fusion" of the stronger partner, not the pair); plain header, no icon | SV-COL-13, AN-1…AN-5 | (tracked) "The Annotation column: our OncoKB store has no structural-variant entries" |
| 2 | **Fusions absent from the Mutations tab** (TMPRSS2 4 rows vs 240) | SV-STM-5 | not tracked |
| 3 | **Default sort** "drivers, then gene 1, gene 2" (first row AFF3-TMPRSS2) vs Annotation ↓ (TMPRSS2-BRAF first) | SV-TB-4, STM-3 | not tracked |
| 4 | **No duplicate suffix** ("includes 2 duplicate structural variants in patients with multiple samples"; the 2 are in cBioLab's rows) | SV-TB-1, MD-7, STM-1 | not tracked |
| 5 | **No experimental-feature alert, no "Beta!" label** | SV-1, SV-5 | not tracked |
| 6 | **No Site1/Site2 Exon/Intron columns** (Genome Nexus transcripts) | SV-COL-6, COL-10, STM-2 | not tracked (noted in `lib/views/sv/README.md`) |
| 7 | **Gene chip not shared with the Mutations tab** (`mutations_gene`); kept per tab in the document | SV-4 | not tracked |
| 8 | **Table chrome differs**: Columns button with count/find/default, filter on every header (legacy: plain checklist, none), numbered pager, CSV of kept rows, no Copy | SV-TB-2, TB-3, TB-6 | partly (table copy/download listed for Comparison) |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| TMPRSS2 rows | SV-STM-4, SV-7 | 236 | 236 | ✅ |
| ERG rows | SV-STM-4 | 220 | 220 | ✅ |
| ETV1 rows | SV-STM-4 | 11 | 11 | ✅ |
| TMPRSS2 row set | SV-7 | 236 (sample, genes, positions) | 236/236 matched, none extra | ✅ |
| Connection Type, Event Info, Variant Class, Site1 Chromosome, Effect on Frame, MS, NCBI Build, Tumor Split Read Count | SV-COL-* | 236 rows | 236/236 identical | ✅ |
| Cancer Type Detailed in the download | SV-TB-6, COL-3 | blank on 236/236 (legacy bug) | "Prostate Adenocarcinoma" | 🐞 ok |
| Duplicates (TMPRSS2) | SV-STM-1 | "includes 2 duplicate…" | 2 by the same rule in its CSV; not shown | ❌ |
| Duplicates (ERG, ETV1) | SV-STM-1 | none shown | none shown | ✅ |
| Annotated rows (TMPRSS2) | SV-AN-2 | OncoKB ring on every row; TMPRSS2-BRAF sorted first | 0/236 annotated | 🔶 (tracked) |
| TMPRSS2 in the Mutations tab | SV-STM-5 | 240 rows (236 fusions + 4); Fusion 207 driver / 29 VUS | 4 rows; Fusion 0 / 0 | 🔶 |
| Profiling (cBioLab only) | — | not shown | TMPRSS2 204 samples with a call, 494 of 494 profiled | n/a (legacy shows no frequency) |

Data version: rows and every stored field match exactly, so the warehouse and cbioportal.org hold the same SV data.

---

## 4. Scorecard

### §1 Tab and layout

| ID | verdict | how | note |
|---|---|---|---|
| SV-1 | 🟡 | B | "Structural Variants" between Mutations and Co-expression ✅; no orange "Beta!" |
| SV-2 | 🟡 | BC | Shown only when a queried patient carries a call (`svCheckCohort`, `results-layout.ts:148`) ✅, and the page says why when hidden; query genes only (no OQL fusion partners, `NO_GENE`/`ANY_GENE`); reads every SV profile, not the selected ones |
| SV-3 | ✅ | B | Loading cover and refusal states (no `fusionsTabDiv`) |
| SV-4 | 🟡 | B | Chips TMPRSS2 · ERG · ETV1, every gene ✅; active gene in the document, not shared with Mutations |
| SV-5 | 🔶 | B | No blue alert; a caveat paragraph under the table instead |
| SV-6 | ✅ | B | Table only, no lollipop/badges |
| SV-7 | ✅ | B | Site1 or site2: TMPRSS2 236 / ERG 220 identical; ERG-TMPRSS2 rows in both tabs |
| SV-8 | ✅ | C | Raw rows, no OQL/driver/somatic filter |

### §2 Table

| ID | verdict | how | note |
|---|---|---|---|
| SV-TB-1 | 🟡 | B | "236 TMPRSS2 structural variants"; no page part, no duplicate suffix |
| SV-TB-2 | 🔶 | B | Search, "columns (8/36)" with find + all/default, "download CSV"; filter icon on every header (legacy: none, plain checklist); no Copy |
| SV-TB-3 | 🟡 | B | 25 rows ✅; numbered pager + per-page select, "Showing 1–25 of 236 TMPRSS2 structural variants" |
| SV-TB-4 | 🔶 | B | "drivers first, then gene 1, gene 2" (`sv-table.ts:126`): AFF3-TMPRSS2 first; legacy TMPRSS2-BRAF first |
| SV-TB-5 | ✅ | C | Search over shown columns (Annotation text included; no Exon/Intron to exclude) |
| SV-TB-6 | 🟡 | BC | CSV of all 36 columns incl. hidden ✅; rows = those kept by search/filters (legacy all); Annotation exported (blank); Cancer Type Detailed filled (COL-3) |

### §2 Columns

| ID | verdict | how | note |
|---|---|---|---|
| SV-COL-1 | 🟡 | C | Hidden ✅; raw study id, not a name link / tooltip |
| SV-COL-2 | ✅ | B | Link to the sample's page, new tab |
| SV-COL-3 | 🐞 ok | B | Shown ✅; download filled (legacy blank) |
| SV-COL-4 | ✅ | B | Gene 1 = site 1, not reordered |
| SV-COL-5 | ✅ | B | Site1 Entrez / Transcript / Chromosome / Position, values identical |
| SV-COL-6 | ❌ | C | No Site1 Exon/Intron |
| SV-COL-7 | ✅ | C | Site1 Description |
| SV-COL-8 | ✅ | B | Gene 2 |
| SV-COL-9 | ✅ | B | Site2 fields |
| SV-COL-10 | ❌ | C | No Site2 Exon/Intron |
| SV-COL-11 | ✅ | C | Site2 Description |
| SV-COL-12 | ✅ | B | Effect on Frame, identical 236/236 |
| SV-COL-13 | ❌ | B | "Annotation (OncoKB)" blank 236/236 (tracked) |
| SV-COL-14 | 🟡 | B | MS raw "SOMATIC" (identical); no S / G badge |
| SV-COL-15 | ✅ | B | NCBI Build … Tumor Split Read Count, identical |
| SV-COL-16 | ✅ | C | SV Description |
| SV-COL-17 | 🟡 | C | Breakpoint Type ✅; no Center (not stored) |
| SV-COL-18 | ✅ | B | Connection Type "NA" identical |
| SV-COL-19 | ✅ | B | Event Info "AFF3-TMPRSS2 fusion" identical |
| SV-COL-20 | ✅ | B | Variant Class identical |
| SV-COL-21 | ✅ | C | Length, Comments |
| SV-COL-22 | ✅ | B | Default 8: Sample ID, Cancer Type Detailed, Gene 1, Gene 2, Annotation, Connection Type, Event Info, Variant Class, same order |
| SV-COL-23 | ✅ | C | No column tooltips beyond the table's generic sort/filter tips |

### §3 Annotation column

| ID | verdict | how | note |
|---|---|---|---|
| SV-AN-1 | 🔶 | B | Plain header "Annotation (OncoKB)", no icon row or Compact/Expanded toggle |
| SV-AN-2 | 🟡 | BC | OncoKB only ✅; blank everywhere (store has no SV rows, tracked) |
| SV-AN-3 | 🔶 | C | Store entry `alteration_type = 'SV' AND alteration = 'Fusion'` per gene (`sv-table.ts:102`): no pair, no variantClass type, no tumour type (tracked) |
| SV-AN-4 | 🔶 | C | Stronger of the two partners' calls, gene 1 on a tie (`sv-table.ts:84`), not site1-preferred annotated gene |
| SV-AN-5 | 🔶 | B | Nothing drawn when there is no call |

### §4 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| SV-MD-1 | ✅ | C | Tab hidden; the page names why ("no structural-variant data" / "no structural variant in the queried genes") |
| SV-MD-2 | ✅ | C | Every gene has a chip; empty table for a gene without calls |
| SV-MD-3 | ✅ | B | AFF3-TMPRSS2 (TMPRSS2 as site 2) in the TMPRSS2 tab |
| SV-MD-4 | 🟡 | C | Listed once ✅; no OncoKB variantClass/functionalFusion logic |
| SV-MD-5 | 🐞 ok | C | Only studies with SV data contribute ✅; annotation read per row from one store, not from the first profile only |
| SV-MD-6 | N/A | C | No global Show only drivers / somatic settings exist |
| SV-MD-7 | ❌ | B | No duplicate suffix |

### §6 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| SV-STM-1 | ❌ | BC | Not computed or shown; its CSV holds the same 2 duplicates (patient + both breakpoints) |
| SV-STM-2 | ❌ | C | No exon rank |
| SV-STM-3 | 🔶 | C | Driver bit, then gene 1, gene 2 (`sv-table.ts:126`) |
| SV-STM-4 | ✅ | B | 236 / 220 / 11 identical |
| SV-STM-5 | ❌ | B | Fusions not in the Mutations tab (4 vs 240 rows); see 05-mutations MUT-MD-11 |

---

## 5. cBioLab bugs (broken on its own terms)

- None found on this tab. The table, counts and caveat match its own `README.md`.
