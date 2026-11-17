# Parity audit — Results › Structural Variants (spec `06-structural-variants.md`)

- **Date:** 2026-11-11; re-scored 2026-11-16
- **cBioLab:** master @ `7ef627ba`, `next dev` on `http://127.0.0.1:3000` (first audit: `session/spec` @ `f3197d75`)
- **Legacy:** cbioportal.org (2026-11-11; the re-score re-read cBioLab only, the legacy rows being unchanged data)
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
| ✅ match | 28 |
| 🟡 partial | 12 |
| 🔶 different | 7 |
| ❌ missing | 5 |
| 🐞 ok | 2 |
| 🐞 copied | 0 |
| N/A | 0 |
| ? | 0 |
| **Total IDs** | **54** |

**Overall: 55.6 %** (✅ 28 + 🐞ok 2 = 30 of 54). Counting 🟡 as half: 66.7 %. (2026-11-11: 51.9 % / 62.0 %.)

Re-score of 2026-11-16: 4 verdicts changed. The OncoKB lookup is now the portal's per pair and tumour type (#219), fusions are on the Mutations tab (#230), and the driver settings that now exist (#168) leave this tab alone, as the portal's do. The Annotation column is still blank on Q1: prad's pairs are not in this warehouse's OncoKB SV store. ✅ rows spot-checked, none regressed: SV-6, SV-7, COL-2, COL-4, COL-22, STM-4.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §1 Tab and layout (SV) | 8 | 4 | 3 | 1 | 0 | 0 | 0 | Unchanged: no "Beta!", no info alert |
| §2 Table (TB) | 6 | 1 | 3 | 2 | 0 | 0 | 0 | Unchanged: numbered pager, header filters, CSV; default sort differs |
| §2 Columns (COL) | 23 | 16 | 4 | 0 | 2 | 1 | 0 | Annotation reads the pair now, blank here; no Exon/Intron, no Center |
| §3 Annotation (AN) | 5 | 1 | 1 | 3 | 0 | 0 | 0 | The portal's query; no header icons, card or empty-call icon |
| §4 Modes (MD) | 7 | 4 | 1 | 0 | 1 | 1 | 0 | Settings leave the tab alone, as legacy; no duplicate suffix |
| §6 Statistics (STM) | 5 | 2 | 0 | 1 | 2 | 0 | 0 | Fusions on the Mutations tab; duplicates and exon rank not shown |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Annotation column blank** on all 236 TMPRSS2 rows: the pair lookup is the portal's (#219) but prad's pairs are not in the store; plain header, no icon, no card | SV-COL-13, AN-1, AN-2, AN-4, AN-5 | SV tab: the Annotation column |
| 2 | **Default sort** "drivers, then gene 1, gene 2" (AFF3-TMPRSS2 first) vs Annotation ↓ (TMPRSS2-BRAF first) | SV-TB-4, STM-3 | SV tab (added in this re-score) |
| 3 | **No duplicate suffix** ("includes 2 duplicate structural variants…") | SV-TB-1, MD-7, STM-1 | SV tab (added in this re-score) |
| 4 | **No experimental-feature alert, no "Beta!"** | SV-1, SV-5 | SV tab (added in this re-score) |
| 5 | **No Site1/Site2 Exon/Intron columns** | SV-COL-6, COL-10, STM-2 | SV tab: Exon and Intron columns |

---

## 3. Number check (2026-11-16, cBioLab)

| Statistic | ID | Legacy (2026-11-11) | cBioLab | Verdict |
|---|---|---|---|---|
| TMPRSS2 / ERG / ETV1 rows | SV-STM-4, SV-7 | 236 / 220 / 11 | 236 / 220 / 11 | ✅ |
| Annotated rows (TMPRSS2) | SV-AN-2, COL-13 | OncoKB ring on every row | 0/236 | 🟡 (store) |
| TMPRSS2 in the Mutations tab | SV-STM-5 | 240 rows; Fusion 207 / 29 | 240 rows; Fusion 0 / 236 | ✅ rows (#230); split in 05-mutations STM-4 |
| First row | SV-TB-4 | TMPRSS2-BRAF | AFF3-TMPRSS2 | 🔶 |

---

---

## 4. Scorecard

### §1 Tab and layout

| ID | verdict | how | note |
|---|---|---|---|
| SV-1 | 🟡 | B | Unchanged: placed between Mutations and Co-expression; no orange "Beta!" |
| SV-2 | 🟡 | BC | Unchanged: shown when a queried patient carries a call (`results-layout.ts:330`); query genes only, every SV profile |
| SV-3 | ✅ | B | Loading cover and refusal states (no `fusionsTabDiv`) |
| SV-4 | 🟡 | B | Unchanged: chips TMPRSS2 · ERG · ETV1; active gene in the document, not shared with Mutations |
| SV-5 | 🔶 | B | Unchanged: no blue alert, a caveat paragraph under the table |
| SV-6 | ✅ | B | Table only, no lollipop/badges |
| SV-7 | ✅ | B | Site1 or site2: TMPRSS2 236 / ERG 220 identical; ERG-TMPRSS2 rows in both tabs |
| SV-8 | ✅ | C | Raw rows, no OQL/driver/somatic filter |

### §2 Table

| ID | verdict | how | note |
|---|---|---|---|
| SV-TB-1 | 🟡 | B | Unchanged: "236 TMPRSS2 structural variants"; no duplicate suffix |
| SV-TB-2 | 🔶 | B | Unchanged: search, "columns (8/36)", "download CSV (236)", filter icon on every header; no Copy |
| SV-TB-3 | 🟡 | B | Unchanged: numbered pager + per page, "Showing 1–25 of 236" |
| SV-TB-4 | 🔶 | B | Unchanged: "drivers first, then gene 1, gene 2" (`sv-table.ts:127`): AFF3-TMPRSS2 first; legacy TMPRSS2-BRAF first |
| SV-TB-5 | ✅ | C | Search over shown columns (Annotation text included; no Exon/Intron to exclude) |
| SV-TB-6 | 🟡 | BC | Unchanged: CSV of every column; rows kept by search/filters (legacy all) |

### §2 Columns

| ID | verdict | how | note |
|---|---|---|---|
| SV-COL-1 | 🟡 | C | Unchanged: raw study id |
| SV-COL-2 | ✅ | B | Link to the sample's page, new tab |
| SV-COL-3 | 🐞 ok | B | Shown ✅; download filled (legacy blank) |
| SV-COL-4 | ✅ | B | Gene 1 = site 1, not reordered |
| SV-COL-5 | ✅ | B | Site1 Entrez / Transcript / Chromosome / Position, values identical |
| SV-COL-6 | ❌ | C | Unchanged: no Site1 Exon/Intron |
| SV-COL-7 | ✅ | C | Site1 Description |
| SV-COL-8 | ✅ | B | Gene 2 |
| SV-COL-9 | ✅ | B | Site2 fields |
| SV-COL-10 | ❌ | C | Unchanged: no Site2 Exon/Intron |
| SV-COL-11 | ✅ | C | Site2 Description |
| SV-COL-12 | ✅ | B | Effect on Frame, identical 236/236 |
| SV-COL-13 | 🟡 | B | The column now reads OncoKB's pair call in the sample's tumour type (`lib/sv-oncokb.ts`) (#219); still blank on 236/236 TMPRSS2 rows here: prad's pairs are not in this warehouse's store, and the gene-level fallback holds no Fusion call for these partners |
| SV-COL-14 | 🟡 | B | Unchanged: MS raw "SOMATIC"; no S / G badge |
| SV-COL-15 | ✅ | B | NCBI Build … Tumor Split Read Count, identical |
| SV-COL-16 | ✅ | C | SV Description |
| SV-COL-17 | 🟡 | C | Unchanged: no Center (not stored) |
| SV-COL-18 | ✅ | B | Connection Type "NA" identical |
| SV-COL-19 | ✅ | B | Event Info "AFF3-TMPRSS2 fusion" identical |
| SV-COL-20 | ✅ | B | Variant Class identical |
| SV-COL-21 | ✅ | C | Length, Comments |
| SV-COL-22 | ✅ | B | Default 8: Sample ID, Cancer Type Detailed, Gene 1, Gene 2, Annotation, Connection Type, Event Info, Variant Class, same order |
| SV-COL-23 | ✅ | C | No column tooltips beyond the table's generic sort/filter tips |

### §3 Annotation column

| ID | verdict | how | note |
|---|---|---|---|
| SV-AN-1 | 🔶 | B | Unchanged: plain header "Annotation (OncoKB)", no icon row or Compact/Expanded toggle |
| SV-AN-2 | 🟡 | BC | OncoKB only; blank on Q1 (store, see COL-13) |
| SV-AN-3 | ✅ | C | Per pair of Entrez ids, OncoKB's SV type (`svTypeSql`, FUSION for two genes) and the sample's tumour type, '' for the driver call, as the portal asks (`lib/sv-oncokb.ts`) (#219); the gene-level fallback only where a study's pairs are not synced |
| SV-AN-4 | 🔶 | C | Unchanged: with no pair call, the stronger of the partners' gene-level calls, not the portal's site1-preferred annotated gene; no card |
| SV-AN-5 | 🔶 | B | Unchanged: nothing drawn when there is no call |

### §4 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| SV-MD-1 | ✅ | C | Tab hidden; the page names why ("no structural-variant data" / "no structural variant in the queried genes") |
| SV-MD-2 | ✅ | C | Every gene has a chip; empty table for a gene without calls |
| SV-MD-3 | ✅ | B | AFF3-TMPRSS2 (TMPRSS2 as site 2) in the TMPRSS2 tab |
| SV-MD-4 | 🟡 | C | Listed once ✅; OncoKB SV type derived as the portal's (#219); no functionalFusion logic |
| SV-MD-5 | 🐞 ok | C | Only studies with SV data contribute ✅; annotation read per row from one store, not from the first profile only |
| SV-MD-6 | ✅ | C | Show only drivers / somatic now exist (#168) and, as on the portal, do not touch this tab (the `sv` view takes no driver settings) |
| SV-MD-7 | ❌ | B | Unchanged: no duplicate suffix |

### §6 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| SV-STM-1 | ❌ | BC | Unchanged: duplicates not computed or shown |
| SV-STM-2 | ❌ | C | Unchanged: no exon rank |
| SV-STM-3 | 🔶 | C | Unchanged: driver bit, then gene 1, gene 2 |
| SV-STM-4 | ✅ | B | 236 / 220 / 11 identical |
| SV-STM-5 | ✅ | B | Fusions on the Mutations tab: TMPRSS2 240 rows, ERG 220 (#230) |

---

## 5. cBioLab bugs (broken on its own terms)

- None found on this tab. The table, counts and caveat match its own `README.md`.
