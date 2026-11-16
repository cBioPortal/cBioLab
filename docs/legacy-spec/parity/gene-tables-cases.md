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

## The Freq tooltip's gene panels (GP)

| # | Case | Rule | Source |
|---|---|---|---|
| GP1 | The tooltip | Three lines: "# of samples with a mutation in this gene that are also profiled for mutations: N" (N the altered samples on a covering panel), "# of samples profiled for mutations in this gene: M", then the panel line. "mutation"/"mutations" become "structural variant"/"structural variants" or "copy number alteration"/"copy number alterations". Numbers with thousands separators | TableUtils.tsx:110-131 |
| GP2 | The panel line | "Gene panels: P1, P2", or "Gene panels: none" when there are none | StudyViewGenePanelModal.tsx:20-44 |
| GP3 | Which panels | Each gene panel held by a selected sample for the table's alteration type that lists the gene, whole-exome (`WES`) among them | AM:127-149 (`getMatchingGenePanelIds`) |
| GP4 | ⚠ Their order | A to Z. The portal's are a set, in no fixed order | AbstractAlterationCountByGeneUseCase.java:58-72 |
| GP5 | Several connections | The panels of every connection, each once | `mergeExplore` |
| GP6 | ⚠ A panel's genes | The portal opens a panel's gene list on a click of its name. Not built here | StudyViewGenePanelModal.tsx |

## Selecting rows (GU)

| # | Case | Rule | Source |
|---|---|---|---|
| GU1 | Union | The checked genes filter as one clause: the samples altered in any of them (one OQL query of a line per gene) | STS-GT-9; MST |
| GU2 | Intersection | The checked genes filter as a clause per gene: the samples altered in every one | STS-GT-9 |
| GU3 | The choice | Offered with two or more rows checked. Union by default for the gene tables. The choice is kept by the browser and shared by the three gene tables | STS-GT-9 (localStorage by table type) |
| GU4 | Applied rows | A gene the selection already filters on in this table (a line of one of the draft's OQL clauses) is pinned to the top, checked and disabled, in the filter's order | STS-GT-9 |
| GU5 | Appended | A new filter is added to the selection's other filters (AND), never replacing them | STS-GT-9 |

## The gene-click query queue (GQ)

| # | Case | Rule | Source |
|---|---|---|---|
| GQ1 | Queue | A gene's search icon (or Enter / Space on it) adds the gene to the genes queued for a query; again removes it | GeneCell.tsx; STS-GT-6 |
| GQ2 | Message | "<G> queued for query (see top right of page for submit)" or "<G> removed from query queue" | STS-GT-6 |
| GQ3 | ⚠ The query | The page's Query genes… dialog opens with the queued genes, one per line (the dialog's form), in the order they were queued. The portal joins them with spaces in its query box | StudyViewPageStore.ts:3174-3189 |
| GQ4 | Queued state | The icon is drawn selected while its gene is queued; the queue is the page's, so a gene queued from one table shows queued in another | STS-GT-6 |

## The alteration-filter indicator (GI)

| # | Case | Rule | Source |
|---|---|---|---|
| GI1 | Indicator | With Alterations: OncoKB drivers only (the page's alteration filter), the `#` header's filter icon is drawn dark and its tooltip is the portal's filtered text: "Total number of mutations" (mutated), "Total number of fusions" (SV) or "Number of samples with one or more copy number alterations" (CNA), then "This table is filtered based on selections in the Alteration Filter menu." | ChartContainer.tsx:733-739, 879-885, 1056-1063 |
| GI2 | Off | With every alteration counted, the icon is drawn grey and the tooltip is the plain one (GH1–GH3) | TableHeaderCellFilterIcon.tsx:29; MST:341-342 |
| GU6 | ⚠ Past the filter limit | A selection holds at most 8 filters, and Intersection adds one per gene (OQL can't AND genes in one query). When the checked genes would take the selection past 8, Intersection is offered but disabled, saying how many filters it would make. Union, one filter, is unaffected. The portal has no limit | `lib/cohort2.ts` (all: 0–8 clauses) |
