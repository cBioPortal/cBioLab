# Study View gene tables: cases

The rules for the Mutated, CNA and Structural Variant gene tables, case by case, from the legacy
frontend (`~/cbioportal-frontend` at `cd8c6df`) and backend (`~/cbioportal`). Each row is a test. ⚠
marks a deliberate difference from the portal, with the reason. The behaviour is spelled out in
`docs/legacy-spec/30-study-summary.md` STS-GT-1…11 and §13.

Sources:

| Abbreviation | File |
|---|---|
| SPS | frontend `src/pages/studyView/StudyViewPageStore.ts` |
| SVU | frontend `src/pages/studyView/StudyViewUtils.tsx` |
| MST | frontend `src/pages/studyView/table/MultiSelectionTable.tsx` |
| AM | backend `src/main/resources/mappers/clickhouse/alteration/ClickhouseAlterationMapper.xml` |

The pure rules are in `lib/study-view-gene-tables.ts`, and the rows come from `geneTables` and
`mergeExplore` in `lib/explore.ts`.

## Rows (GR)

| # | Case | Rule | Source |
|---|---|---|---|
| GR1 | Every gene | A table holds every gene with an event of its type in the selection, with no cap on the rows (one row per gene and call in the CNA table) | AM:32, 59, 82 (no LIMIT) |
| GR2 | Several connections | Rows of the same gene (and call) are summed across connections. Every row survives into the merge, so no connection's counts are lost to a cut | `mergeExplore` |
| GR3 | Search | "find gene" searches every row, not only the most altered | STS-GT-10 |

## Title (GT)

| # | Case | Rule | Source |
|---|---|---|---|
| GT1 | Title | `Mutated Genes (N profiled samples)`, `CNA Genes (N …)`, `Structural Variant Genes (N …)`, where N is written as a plain integer (`534`, `4974`, no separator) | SPS:11701-11738 |
| GT2 | One sample | `(1 profiled sample)` | SPS:11733-11736 (`pluralize`) |
| GT3 | N is 0 or unknown | The bare title, with no parenthesis | SPS:11733 (`count > 0`) |
| GT4 | N for mutations | The selected samples profiled in the `mutations` profile kind | SPS:11707-11716 |
| GT5 | N for structural variants | The `fusion` kind's count if not 0, else `structural_variants`'s, else 0 | SVU:3646-3656 |
| GT6 | N for copy number | The first of `cna`, `gistic`, `cna_rae`, `cna_consensus` that is not 0, else 0 | SVU:3658-3668 |
| GT7 | Several studies | Each kind's count is summed over the studies (a kind is the profile's stable id less the study prefix) | SPS molecularProfileSampleCountSet |

## Sort (GS)

| # | Case | Rule | Source |
|---|---|---|---|
| GS1 | Default | Mutated and CNA by Freq, highest first; SV by `# SV`, highest first | STS-GT-3 |
| GS2 | Ties | Ties keep the rows' own order: the most events first, then the gene A to Z | AM:32, 59, 82 (`ORDER BY totalCount DESC, hugo_gene_symbol ASC`), stable sort |
| GS3 | A header click | A click on a column's header sorts by it, numbers highest first and Gene / Cytoband A to Z; a second click reverses. Freq sorts by its value, not its text. CNA sorts by the call's number, lowest first (HOMDEL, −2, before AMP, 2) | MST:574-575 (`sortBy: data.alteration`), FixedHeaderTable |
| GS4 | ⚠ No frequency | A row whose frequency can't be computed (no profiled sample) sorts below every number, in both directions. The portal sorts it as 0%; here it shows "—" rather than a number, so it goes last | MST:416-424 |

## Header tooltips (GH)

| # | Case | Rule | Source |
|---|---|---|---|
| GH1 | Mutated | `# Mut` "Total number of mutations"; `#` "Number of samples with one or more mutations"; `Freq` "Percentage of samples with one or more mutations" | STS-GT-4 |
| GH2 | SV | `# SV` "Total number of structural variants"; `#` "Number of samples with one or more structural variants"; `Freq` "Percentage of samples with one or more structural variants" | STS-GT-4 |
| GH3 | CNA | `Cytoband` "Cytoband"; `CNA` "Copy number alteration, only amplifications and deep deletions are shown"; `#` "Number of samples with one or more copy number alterations"; `Freq` "Percentage of samples with one or more copy number alterations" | STS-GT-4 |
| GH4 | Gene | No tooltip | STS-GT-4 |

## Data download (GD)

| # | Case | Rule | Source |
|---|---|---|---|
| GD1 | Menu and file | The table's menu ends with Download ▸ Data, saving `Mutated_Genes.txt`, `CNA_Genes.txt` or `Structural_Variant_Genes.txt` (the name without the count) | ST:483-626; CH:102-103 |
| GD2 | Mutated header | `Gene`, `MutSig(Q-value)`, `# Mut`, `#`, `Profiled Samples`, `Freq` | SVU:5085-5128 |
| GD3 | SV header | `Gene`, `# Structural Variant`, `#`, `Profiled Samples`, `Freq` | SVU:5176-5219 |
| GD4 | CNA header | `Gene`, `Gistic(Q-value)`, `Cytoband`, `CNA`, `Profiled Samples`, `#`, `Freq` | SVU:5221-5266 |
| GD5 | Cells | Gene; the q-value empty (not read yet: the warehouse's `mut_sig` and `gistic` tables hold it for some studies, a later change; the portal writes `''` when it has none); events; altered samples; profiled samples; the call `AMP` / `HOMDEL` and the cytoband (empty when none) for CNA | SVU:5085-5266 |
| GD6 | ⚠ CNA columns | Under `Profiled Samples` the profiled count and under `#` the altered count. The portal writes them the other way round under the same headers (altered under "Profiled Samples"), a bug | SVU:5231-5250 |
| GD7 | ⚠ Freq | The frequency the table shows (altered on a covering panel ÷ profiled), as `portalFreq` writes it; `NA` with no profiled sample. The portal's download divides every altered sample by the profiled, so it differs from its own screen when a call is off-panel | SVU:5112-5116 vs MST:389-410 |
| GD8 | Rows and order | Every row, whatever the search box holds and however the table is sorted, in the rows' own order: the most events first, then the gene A to Z | SVU:5085-5266 (API order); AM:32, 59, 82 |
| GD9 | No OncoKB column | No `Is Cancer Gene (source: OncoKB)` column: it appears on the portal only while its cancer-gene filter is on, which is not built here | SVU:5085-5128 |
| GD10 | Layout | As Summary Data: tab-separated, LF, none after the last line, plain integers | download-cases SD10 |
| GD11 | Empty table | Header only | SVU (`[]` → header only) |
