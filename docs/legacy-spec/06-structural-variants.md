# Legacy parity spec — Results View › Structural Variants

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.

Reference query:
- `/results/structuralVariants?cancer_study_list=prad_tcga_pan_can_atlas_2018&case_set_id=prad_tcga_pan_can_atlas_2018_all&gene_list=TMPRSS2 ERG ETV1&profileFilter=mutations,structural_variants`

Key files: `src/pages/resultsView/structuralVariant/*` (StructuralVariants, ResultsViewStructuralVariantMapper(+Store, +DataStore),
ResultsViewStructuralVariantTable), `src/shared/components/structuralVariantTable/StructuralVariantTable.tsx` (`SVT`),
`src/pages/patientView/structuralVariant/column/AnnotationColumnFormatter.tsx` (`ACF`), `packages/oncokb-frontend-commons/src/util/OncoKbUtils.ts` (`OKU`),
`src/pages/resultsView/ResultsViewPageStore.ts` (`RVPS`).

Shared pieces: uses the Results header (01-oncoprint.md RV-1…RV-3); table base, search, pagination, copy/download behave as the mutation table
(see 05-mutations.md MUT-TB-1…MUT-TB-4, MUT-TB-8) except where listed here; OncoKB icon/card as 05-mutations.md MUT-AN-3.
Fusions also appear in the **Mutations** tab as "A-B Fusion" pseudo-mutations (05-mutations.md MUT-0-4, MUT-MD-11).

---

## 1. Tab and layout

- **SV-1** Tab label "Structural Variants **Beta!**" (orange "Beta!"), path `/results/structuralVariants`, between Mutations and Co-expression `[B]`.
- **SV-2** Tab hidden unless the SV fetch returns ≥1 SV (`ResultsViewPage.tsx:409-415`) `[C]`. Fetch (`RVPS:3399-3459`) `[C]`:
  - Uses only **selected** SV profiles; samples only from studies that have one.
  - Genes: all query genes (`entrezGeneIds`) plus OQL fusion queries (`structuralVariantQueries`, incl. `NO_GENE` / `ANY_GENE`).
  - Not affected by driver/VUS or germline settings.
- **SV-3** Root `div[data-test="fusionsTabDiv"]`; spinner while stores load; `ErrorMessage` on failure `[C]`.
- **SV-4 Gene pills** `#fusionsPageTabs`: one per query gene (incl. OQL fusion partners), label = symbol only, **every gene gets a pill even with 0 SVs** (empty table) `[C]`; `[B]` TMPRSS2 · ERG · ETV1.
  - Active gene: `URL: mutations_gene` (shared with the Mutations tab), else first gene `[default]`.
- **SV-5 Info alert** (blue) above the table, exact text `[B]`: "This is an experimental feature. The structural variant gene and event info annotations might not always be correct. If you are interested in improving SV annotation and visualization together, please reach out on cbioportal@googlegroups.com"
- **SV-6** **No lollipop, mapper, badges, rate summary or filters** — alert + table only `[B]`.
- **SV-7 Rows of a gene tab** (`RVPS:3512-3536`): SVs where the gene is site1 **or** site2. An SV between two queried genes appears in both tabs `[B]` (ERG-TMPRSS2 rows in the TMPRSS2 tab).
- **SV-8** Rows are the raw SVs: **not** filtered by OQL alteration terms, Show only drivers or Show only somatic `[C]`.

## 2. Table

- **SV-TB-1 Header line** "`N` Structural Variants (page x of y)"; singular "Structural Variant"; with duplicates "236 Structural Variants: includes 2 duplicate structural variants in patients with multiple samples (page 1 of 10)" `[B]` (SV-STM-1).
- **SV-TB-2 Toolbar**: [📋 Copy] [☁ Download TSV] [Columns ▾] [search] `[B]`.
  - Columns menu = plain checklist with [Select all] [Deselect all] — **no count in the button, no Mutations/Clinical tabs, no search, no Reset** (unlike MUT-TB-5) `[B]`.
  - **No header filter icons** (unlike MUT-TB-6) `[B]`.
- **SV-TB-3** 25 rows `[default]`, [Show more] pagination, "Showing 1-25 of 236 Structural Variants: includes 2 duplicate…" `[B]`.
- **SV-TB-4** Default sort Annotation ↓ (`SVT:190-198`) `[B]` (OncoKB-annotated TMPRSS2-BRAF row first).
- **SV-TB-5** Search: case-insensitive substring over visible columns except Annotation and the Exon/Intron columns (no search value) `[C]`.
- **SV-TB-6** Download: all columns with a download value incl. hidden, all rows; Annotation and Exon/Intron columns are **not exported**; Cancer Type Detailed exports blank (legacy bug: reads a field the SV model lacks, `SVT:419`) `[C]`.

**SV-COL Columns** (display order = this table; plain columns render the raw field, sort by it, search by substring, download it):

| ID | Header | Field | Default | Notes |
|---|---|---|---|---|
| SV-COL-1 | Study | studyId | hidden | study-name link `/study?id=`, max 16 chars, tooltip "`<name>: <description>`"; renders empty if profile id ≠ `<studyId>_structural_variants` (legacy quirk) |
| SV-COL-2 | Sample ID | sampleId | ☑ | link to patient view (new tab) only if `<studyId>_structural_variants` profile exists, else text |
| SV-COL-3 | Cancer Type Detailed | sample CANCER_TYPE_DETAILED | ☑ | download blank (SV-TB-6) |
| SV-COL-4 | Gene 1 | site1HugoSymbol | ☑ | |
| SV-COL-5 | Site1 Entrez Gene Id / Site1 Ensembl Transcript Id / Site1 Chromosome / Site1 Position | site1* | hidden | |
| SV-COL-6 | Site1 Exon/Intron | computed | hidden | "Exon N" / "Intron N" / blank (SV-STM-2); no sort, no search, no download |
| SV-COL-7 | Site1 Description | site1Description | hidden | |
| SV-COL-8 | Gene 2 | site2HugoSymbol | ☑ | |
| SV-COL-9 | Site2 Entrez Gene Id / Site2 Ensembl Transcript Id / Site2 Chromosome / Site2 Position | site2* | hidden | |
| SV-COL-10 | Site2 Exon/Intron | computed | hidden | as SV-COL-6 |
| SV-COL-11 | Site2 Description | site2Description | hidden | |
| SV-COL-12 | Effect on Frame | site2EffectOnFrame | hidden | |
| SV-COL-13 | Annotation | — | ☑ | SV-AN-*; sort SV-STM-3 |
| SV-COL-14 | MS | svStatus | hidden | /somatic/i → **S**, /germline/i → **G** (tooltip = raw, placement right); else raw text |
| SV-COL-15 | NCBI Build, DNA Support, RNA Support, Normal Read Count, Tumor Read Count, Normal Variant Count, Tumor Variant Count, Normal Paired End Read Count, Tumor Paired End Read Count, Normal Split Read Count, Tumor Split Read Count | same-named fields | hidden | raw |
| SV-COL-16 | SV Description | `annotation` field | hidden | |
| SV-COL-17 | Breakpoint Type / Center | breakpointType / center | hidden | |
| SV-COL-18 | Connection Type | connectionType | ☑ | `[B]` "NA" |
| SV-COL-19 | Event Info | eventInfo | ☑ | `[B]` "TMPRSS2-ERG fusion" |
| SV-COL-20 | Variant Class | variantClass | ☑ | `[B]` "NA" |
| SV-COL-21 | Length / Comments | length / comments | hidden | |

- **SV-COL-22** Default visible set `[B]`: Sample ID, Cancer Type Detailed, Gene 1, Gene 2, Annotation, Connection Type, Event Info, Variant Class (Connection Type, Event Info, Variant Class render **after** Annotation in this order on screen `[B]`).
- **SV-COL-23** No column has a header tooltip except Annotation (header icons) `[C]`.

## 3. Annotation column

- **SV-AN-1** Header "Annotation" with the same icon row as the mutation table (OncoKB, CIViC, hotspot icons + ▾ in the header `[B]`) and the Compact/Expanded OncoKB style toggle (localStorage `mergeOncoKbIcons`).
- **SV-AN-2** Cells show **OncoKB only** — CIViC, Hotspots and reVUE are hard-disabled (`SVT:483-486`) `[B]` (only the OncoKB ring in cells). Shown when `show_oncokb`.
- **SV-AN-3 OncoKB query** (`StoreUtils.ts:848-881`, `OKU:246-320`) `[C]`:
  - Kept only if site1 or site2 gene is OncoKB-annotated.
  - geneA = first present of site1/site2 Entrez id, geneB = the other (or geneA); `functionalFusion = both genes present`.
  - Type: both Hugo symbols present → `FUSION`; else `variantClass` if one of DELETION, TRANSLOCATION, DUPLICATION, INSERTION, INVERSION, FUSION; else `UNKNOWN`.
  - Tumour type = sample's CANCER_TYPE_DETAILED (fallback study cancer type).
  - Never germline (`isGermline` false).
  - Legacy bug: the query uses only the **first** SV profile found (`RVPS:5911-5924`), so in multi-study queries other studies' SVs can lack OncoKB annotation.
- **SV-AN-4** Displayed gene for the card: the OncoKB-annotated site gene (site1 preferred), else the cancer-gene site, else site1 `[C]`.
- **SV-AN-5** Oncogenicity icon always drawn (even with no indicator); OncoKB failure → error status ⚠ `[C]`.

## 4. Modes & conditions

| ID | Condition | Expected behaviour |
|---|---|---|
| SV-MD-1 | No SV profile selected, or 0 SVs for all query genes | Tab hidden |
| SV-MD-2 | SVs for some genes only | Other genes' pills show an empty table |
| SV-MD-3 | Queried gene is site2 | Row included in that gene's tab (SV-7) |
| SV-MD-4 | Intragenic / one-sided SV | Listed once per gene; OncoKB type from variantClass, `functionalFusion=false` |
| SV-MD-5 | Multi-study | Only studies with an SV profile contribute; links depend on the `<study>_structural_variants` id; OncoKB uses the first profile only (SV-AN-3) |
| SV-MD-6 | Show only drivers / Show only somatic on | **No effect** on this tab (SV-8); Mutations tab and OncoPrint do apply them |
| SV-MD-7 | Multi-sample patients | duplicate suffix in counts (SV-STM-1) |

## 5. Persistence

- **URL:** `mutations_gene` (active gene pill; shared with Mutations).
- **localStorage:** `mergeOncoKbIcons`.
- **Not persisted:** sort, search, page size, column visibility.

---

## 6. Statistics & methods `[C]`

**SV-STM-1 Duplicate count** (`ResultsViewStructuralVariantMapperDataStore.ts:34-50`)
- Group the gene tab's SVs by `patientId + site1Chromosome + site1Position + site2Chromosome + site2Position`; duplicates = Σ(group size − 1); on all tab rows (not search-filtered). Suffix shown only when > 0.

**SV-STM-2 Exon/Intron rank** (`SVT:427-441, 578-623`)
- Exons of the site's transcript (Genome Nexus; `site<n>EnsemblTranscriptId`, or the gene's canonical `mskcc` transcript when the id is "NA").
- Position inside an exon → "Exon <rank>"; between two exons → "Intron floor((rank_left + rank_right)/2)"; outside all exons → blank.

**SV-STM-3 Annotation sort** (`ACF:189-209`): `[oncoKbSortValue(indicator), civic 0, isOncoKbCancerGene ? 1 : 0]`, element-wise, desc; OncoKB part as 05-mutations.md MUT-STM-10 item 1.

**SV-STM-4 Counts**: header/pagination count = number of SV rows in the gene tab (after search). No frequencies or percentages are shown on this tab.

**SV-STM-5 Fusions in the Mutations tab** (for cross-checking): each SV becomes one mutation record with `mutationType 'fusion'`; it counts in Fusion badges and lollipops there, and **is** subject to VUS/germline/OQL filtering in that tab (05-mutations.md MUT-0-4). `[B]` TMPRSS2: 236 SV rows vs 240 Mutations-tab rows (fusions + point mutations).
