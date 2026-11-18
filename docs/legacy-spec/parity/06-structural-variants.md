# Parity audit — Results › Structural Variants (spec `06-structural-variants.md`)

- **Date:** 2026-11-11; re-scored 2026-11-16; re-measured 2026-11-18
- **cBioLab:** master @ `bc53b944`, `next dev` on `http://127.0.0.1:3109` (2026-11-16: master @ `7ef627ba`; first audit: `session/spec` @ `f3197d75`)
- **Legacy:** cbioportal.org (2026-11-18 for the statistics; 2026-11-11)
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
| ✅ match | 32 |
| 🟡 partial | 13 |
| 🔶 different | 4 |
| ❌ missing | 3 |
| 🐞 ok | 2 |
| 🐞 copied | 0 |
| N/A | 0 |
| ? | 0 |
| **Total IDs** | **54** |

**Overall: 63.0 %** (✅ 32 + 🐞ok 2 = 34 of 54). Counting 🟡 as half: 75.0 %. (2026-11-16: 59.3 % / 70.4 %; 2026-11-11: 51.9 % / 62.0 %.)

Re-measurement of 2026-11-18 (master `bc53b944`), each ID against the spec text in cBioLab's UI or code, the counts against cbioportal.org: 4 verdicts changed, none down. Up to ✅: SV-1 (the orange "Beta!") and SV-TB-4 (default Annotation ↓, #309). 🔶 to 🟡: SV-5 (the alert's exact text, as a plain line rather than a blue alert) and SV-STM-3 (the portal's sort array without its cancer-gene element). Row and duplicate counts match legacy.

Re-score of 2026-11-16: 4 verdicts changed. The OncoKB lookup is now the portal's per pair and tumour type (#219), fusions are on the Mutations tab (#230), and the driver settings that now exist (#168) leave this tab alone, as the portal's do. The Annotation column is still blank on Q1: prad's pairs are not in this warehouse's OncoKB SV store. ✅ rows spot-checked, none regressed: SV-6, SV-7, COL-2, COL-4, COL-22, STM-4.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §1 Tab and layout (SV) | 8 | 5 | 3 | 0 | 0 | 0 | 0 | "Beta!" and the alert's text added; the alert is a plain line |
| §2 Table (TB) | 6 | 2 | 3 | 1 | 0 | 0 | 0 | Default sort Annotation ↓; numbered pager, header filters, CSV of kept rows |
| §2 Columns (COL) | 23 | 16 | 4 | 0 | 2 | 1 | 0 | Annotation reads the pair now, blank here; no Exon/Intron, no Center |
| §3 Annotation (AN) | 5 | 1 | 1 | 3 | 0 | 0 | 0 | The portal's query; no header icons, card or empty-call icon |
| §4 Modes (MD) | 7 | 5 | 1 | 0 | 0 | 1 | 0 | Settings leave the tab alone, as legacy; no duplicate suffix |
| §6 Statistics (STM) | 5 | 3 | 1 | 0 | 1 | 0 | 0 | Fusions on the Mutations tab, duplicates as legacy; sort lacks the cancer-gene element; no exon rank |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Annotation column blank** on all 236 TMPRSS2 rows: the pair lookup is the portal's (#219) but prad's pairs are not in the store; plain header, no icon, no card | SV-COL-13, AN-1, AN-2, AN-4, AN-5 | SV tab: the Annotation column |
| 2 | **First row**: the default sort is Annotation ↓ now (#309), but with no stored pair call every row ties, so AFF3-TMPRSS2 comes first, legacy TMPRSS2-BRAF; the sort's cancer-gene element is missing | SV-TB-4, STM-3, COL-13 | SV tab (added in this re-score) |
| 3 | ~~**No duplicate suffix**~~ ("includes 2 duplicate structural variants…"): in (#302) | SV-TB-1, MD-7, STM-1 | SV tab (added in this re-score) |
| 4 | ~~**No experimental-feature alert, no "Beta!"**~~: in; the alert is a plain line, not the portal's blue box | SV-1, SV-5 | SV tab (added in this re-score) |
| 5 | **No Site1/Site2 Exon/Intron columns** | SV-COL-6, COL-10, STM-2 | SV tab: Exon and Intron columns |

---

## 3. Number check (2026-11-16, cBioLab)

| Statistic | ID | Legacy (2026-11-11) | cBioLab | Verdict |
|---|---|---|---|---|
| TMPRSS2 / ERG / ETV1 rows | SV-STM-4, SV-7 | 236 / 220 / 11 | 236 / 220 / 11 | ✅ |
| Annotated rows (TMPRSS2) | SV-AN-2, COL-13 | OncoKB ring on every row | 0/236 | 🟡 (store) |
| TMPRSS2 in the Mutations tab | SV-STM-5 | 240 rows; Fusion 207 / 29 | 240 rows; Fusion 0 / 236 | ✅ rows (#230); split in 05-mutations STM-4 |
| First row | SV-TB-4 | TMPRSS2-BRAF | AFF3-TMPRSS2 | 🔶 |

**Re-measured 2026-11-18** (cBioLab master `bc53b944`, legacy the same day):

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| TMPRSS2 / ERG / ETV1 rows | SV-STM-4, SV-7 | 236 / 220 / 11 | 236 / 220 / 11 | ✅ |
| TMPRSS2 duplicates | SV-STM-1, SV-TB-1 | "includes 2 duplicate structural variants in patients with multiple samples" | the same, 2 | ✅ |
| TMPRSS2 in the Mutations tab | SV-STM-5 | 240 rows | 240 rows | ✅ |
| First row | SV-TB-4 | TMPRSS2-BRAF (its OncoKB call) | AFF3-TMPRSS2 (no stored call; Annotation ↓ ties) | ✅ sort, store 🟡 (COL-13) |

---

---

## 4. Scorecard

### §1 Tab and layout

| ID | verdict | how | note |
|---|---|---|---|
| SV-1 | ✅ | B | Was 🟡: "Structural Variants Beta!" with "Beta!" orange, between Mutations and Co-expression (2026-11-18) |
| SV-2 | 🟡 | BC | Unchanged: shown when a queried patient carries a call (`results-layout.ts:330`); query genes only, every SV profile |
| SV-3 | ✅ | B | Loading cover and refusal states (no `fusionsTabDiv`) |
| SV-4 | 🟡 | B | Unchanged: chips TMPRSS2 · ERG · ETV1; active gene in the document, not shared with Mutations |
| SV-5 | 🟡 | B | Was 🔶: the alert's exact text above the table, but as a plain grey line, not a blue info alert (2026-11-18) |
| SV-6 | ✅ | B | Table only, no lollipop/badges |
| SV-7 | ✅ | B | Site1 or site2: TMPRSS2 236 / ERG 220 identical; ERG-TMPRSS2 rows in both tabs |
| SV-8 | ✅ | C | Raw rows, no OQL/driver/somatic filter |

### §2 Table

| ID | verdict | how | note |
|---|---|---|---|
| SV-TB-1 | 🟡 | B | "236 TMPRSS2 structural variants: includes 2 duplicate structural variants in patients with multiple samples", as legacy; no "(page x of y)" |
| SV-TB-2 | 🔶 | B | Unchanged: search, "columns (8/36)", "download CSV (236)", filter icon on every header; no Copy |
| SV-TB-3 | 🟡 | B | Unchanged: numbered pager + per page, "Showing 1–25 of 236" |
| SV-TB-4 | ✅ | BC | Was 🔶: default order Annotation ↓, then gene 1, gene 2 (`lib/sv-table.ts:130`) (#309). AFF3-TMPRSS2 is still first, legacy TMPRSS2-BRAF, because no row has a stored call here (COL-13) |
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
| SV-MD-7 | ✅ | B | The duplicate suffix (Q1 TMPRSS2: 2, as legacy) |

### §6 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| SV-STM-1 | ✅ | BC | Grouped by patient + both sites' chromosome and position, Σ(group − 1) over every row (`svRowSource` duplicateKey); TMPRSS2 2; keyed within a study, where legacy keys on the patient id alone |
| SV-STM-2 | ❌ | C | Unchanged: no exon rank |
| SV-STM-3 | 🟡 | C | Was 🔶: [OncoKB sort value, CIViC 0] as the portal's (`lib/sv-oncokb.ts:130-145`) (#309); the third element, whether the gene is an OncoKB cancer gene, is not there (no cancer-gene list stored), so rows with no call tie where the portal's differ |
| SV-STM-4 | ✅ | B | 236 / 220 / 11 identical |
| SV-STM-5 | ✅ | B | Fusions on the Mutations tab: TMPRSS2 240 rows, ERG 220 (#230) |

---

## 5. cBioLab bugs (broken on its own terms)

- None found on this tab. The table, counts and caveat match its own `README.md`.
