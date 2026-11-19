# Parity audit — Patient View › other tabs (spec `41-patient-tabs.md`)

- **Date:** 2026-11-11; re-measured 2026-11-18 against master `bc53b944` (dev server `http://127.0.0.1:3109`): P1 Genomic Evolution, Pathways, Clinical Data and P5 Mutational Signatures reloaded, the tab bar on P1–P4; no verdict changed
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day: page DOM + REST API)
- **Code paths (cBioLab):** `app/portal/patient-layout.ts` (tabs, gating), `app/portal/PortalTabs.tsx`; Genomic Evolution `lib/views/evolution/{run,sql,figure,types}.ts`, `app/lab/evolution-body.tsx`; Pathways `lib/views/pathwaymap/*`, `app/lab/kinds/pathwaymap.tsx`, `lib/views/pathways`; Clinical Data `lib/views/table/*`; Mutational Signatures `lib/views/signatures/{run,data,figure,reference}.ts`, `app/lab/signatures-body.tsx`

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| P1 multi-sample, VAF, timeline | `/patient/genomicEvolution?studyId=lgg_ucsf_2014&caseId=P04` (and `/patient/pathways?…`) | `/portal/patient?studyId=lgg_ucsf_2014&caseId=P04&tab=Genomic+Evolution` (and `tab=Pathways`, `Clinical+Data`) |
| P2 sample mode | `/patient?studyId=lgg_ucsf_2014&sampleId=P04_Rec1` | `/portal/patient?studyId=lgg_ucsf_2014&sampleId=P04_Rec1` |
| P3 single sample, TCGA | `/patient?studyId=coadread_tcga_pan_can_atlas_2018&caseId=TCGA-A6-2671` | same params under `/portal/patient` |
| P5 signatures | `/patient/mutationalSignatures?studyId=pancan_pcawg_2020&caseId=DO496` (REST: `generic_assay_data/pancan_pcawg_2020_mutational_signatures_{contribution,counts}_{SBS,DBS}/fetch`) | `/portal/patient?studyId=pancan_pcawg_2020&caseId=DO496&tab=Mutational+Signatures` |

Legacy GE/heatmap/signature UI details from the spec run (`…/scratchpad/PTB/`, same day −1) where not re-rendered; numbers re-read today via REST. cBioLab numbers from `/api/analysis` (`evolution`, `signatures` views) and the rendered page. Scripts and output: (local scratch, not committed) (`legtab.js`, `legapi.js`, `lab.js`, `out/legtab_pw.json`, `out/legapi_{lgg,sig}.json`, `out/lab_{lgg_evo,pcawg_sig}.json`, `out/labui_{lgg,pcawg}.json`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 30 |
| 🟡 partial | 18 |
| 🔶 different | 4 |
| ❌ missing | 26 |
| 🐞 ok | 0 |
| 🐞 copied | 0 |
| N/A | 3 |
| ? | 0 |
| **Total IDs** | **81** |

**Overall: 40.7 %** (✅ 30 + 🐞ok 0 + N/A 3 = 33 of 81). Counting 🟡 as half: 51.9 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 TAB inventory | 5 | 1 | 3 | 0 | 0 | 0 | 1 | Portal order and GE gating; Files & Links placeholder always; `?tab=` not path |
| §1 GE core | 4 | 2 | 1 | 0 | 1 | 0 | 0 | Same mutation set and selection model; no unprofiled alert |
| §1 GE line chart | 7 | 4 | 2 | 0 | 1 | 0 | 0 | Sequential/log/data-range, Group by, the timeline's axis; no timeline toggle, no "only selected" |
| §1 GE heatmap | 4 | 2 | 2 | 0 | 0 | 0 | 0 | Sample rows, the portal's VAF ramp, cluster/transpose/labels; no zoom/download |
| §1 GE table | 1 | 0 | 0 | 1 | 0 | 0 | 0 | Own columns (VAF by sample, Max VAF); no "only selected" |
| §2 Pathways | 4 | 0 | 2 | 2 | 0 | 0 | 0 | Same scores; numeric score not Yes/No; tie order → other default pathway |
| §3 Clinical Data | 4 | 1 | 3 | 0 | 0 | 0 | 0 | Attribute \| Value, Attribute × sample, Timeline Data tables; no 1-decimal, sorts, copy |
| §4 Mutational Signatures | 7 | 6 | 1 | 0 | 0 | 0 | 0 | Close port; numbers identical; table paged |
| §5 Resources, pathology, tissue, trials, custom | 10 | 0 | 0 | 0 | 10 | 0 | 0 | None built (tracked) |
| §6 mRNA / Plots (beta) | 11 | 0 | 0 | 0 | 10 | 0 | 1 | None built (mRNA tracked) |
| §7 Modes | 12 | 8 | 1 | 0 | 3 | 0 | 0 | Sample mode and GE gating right; no resources, download switch |
| §9 Statistics | 12 | 6 | 3 | 1 | 1 | 0 | 1 | VAF and signature numbers identical; no clustering, no mRNA stats |

---

## 2. Top gaps (ranked by how often a portal user hits them)

Re-measured 2026-11-18: 2 is down to Files & Links on every patient; 1 to the 1-decimal patient values, sorts and copy/download; 3 to zoom and download; 4 to the timeline toggle, "Show only selected" and axis titles; 9 closed (one page, download, whole %). 5, 6, 7, 8, 10–13 unchanged.

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Clinical Data tab is two wide tables** (one row per patient / sample, every attribute a column, raw values) instead of Attribute \| Value and Attribute × sample; **no Timeline Data tables** | CD-1..4, STM-11 | not tracked |
| 2 | **Tab order and gating**: GE after Clinical Data; GE shown (then refuses) for single-sample patients; "Clinical Trials" placeholder that legacy does not have; "Files & Links" placeholder always | TAB-2, TAB-3, MD-2, MD-3, MD-12 | Files & Links, Clinical Trials (tracked as gaps) |
| 3 | **GE heatmap**: rows = mutations fixed (legacy default rows = samples), oncoprint blue ramp (legacy `rgb(241,242,181)`→`rgb(19,80,88)`), table order; no Cluster, Transpose, labels toggle, zoom, SVG/PNG/Data download | HM-1..4, STM-3 | not tracked |
| 4 | **GE line chart controls**: no Group by, no Show/Hide Timeline, no "Show only selected mutations" checkbox (the table's filter decides what is drawn); y label "Variant allele frequency", x "Days from diagnosis" | LC-1..5 | not tracked |
| 5 | **GE table**: Samples · Gene · Protein Change · Mutation Type · VAF by sample · Max VAF; no Annotation, Allele Freq bars, Cohort; 25 rows | TB-1 | not tracked |
| 6 | **Pathways table and controls**: "score" number instead of bold Yes/No "Pathway altered"; tie order puts Cell Cycle first (legacy TP53) so the drawn pathway differs; patient view shows "rank by" and "weight by altered %" that legacy hides; nodes coloured by altered % not per-sample mini tracks | PW-2..4, STM-10 | partly: "Ranking table search and CSV" |
| 7 | **No unprofiled-sample alert** on GE and Pathways (GE draws not-profiled cells dashed / NA glyph) | GE-3, PW-1, MD-5 | not tracked |
| 8 | **Files & Links, resource tabs, Pathology Report, Tissue Image** | RS-1..6, PR, TI, MD-9, MD-10 | (tracked) "Files & Links and resource tabs" |
| 9 | **Signature table paged** (25 of 65) and no download; spectrum % unrounded | MS-7, STM-6 | download tracked |
| 10 | **mRNA (Beta) tab** | MR-1..9 | (tracked) "Patient → mRNA" |
| 11 | **Plots (Beta) tab** with reference-cohort select | PL-1, PL-2 | not tracked |
| 12 | **Download switch** (`skin_hide_download_controls`) | MD-11 | (tracked) Data-governance switches |
| 13 | **Custom tabs / Matched Trials** | CT, TM | custom tabs tracked (Gated portal features); Matched Trials not |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| P1 mutations drawn (VAF > 0 somewhere) | GE-2, STM-1 | 58 of 80 (22 without counts) | 58 drawn, 22 "no allele counts" | ✅ |
| P1 VAF points (called, alt/ref) | STM-1 | 88 sample × mutation cells | 88 identical alt and ref; 144 "not found" = profiled VAF 0 | ✅ |
| P1 sample x (time mode) | LC-4 | P04_Pri 0, Rec1 461, Rec2 1075, Rec3 1343 days (SPECIMEN) | days 0 / 461 / 1075 / 1343 | ✅ |
| P1 pathway scores (TCGA-only) | STM-10 | TP53 Yes (TP53), Cell Cycle Yes (TP53), 8 × No | Cell Cycle 1, TP53 1 (TP53), 8 × 0 | 🟡 scores ✅; tie order and default pathway differ |
| P1 Clinical Data samples | CD-3 | 4 sample columns, order Pri, Rec1, Rec2, Rec3 | 4 sample columns, same order (2026-11-18) | 🟡 |
| P5 SBS contributions | STM-4 | SBS5 0.3618, SBS13 0.3437, SBS2 0.2746, SBS1 0.0199 (REST, 4 dp) → 36 / 34 / 27 / 2 % | 0.36181, 0.34369, 0.27459, 0.01991 → 36 / 34 / 27 / 2 %; zeros "<1%" | ✅ |
| P5 signature rows | MS-7 | 65 | 65 | ✅ |
| P5 SBS count | MS-4, STM-6 | 347 ("Sample: SP1003 \| Single Base Substitution (SBS) count: 347") | 347, same line | ✅ |
| P5 SBS channels | STM-6 | 96 channel counts | 96, all equal | ✅ counts; % unrounded (🟡) |
| P5 DBS | STM-4 | DBS2 1.0, count 1 | DBS offered as a version | ✅ (not drawn) |
| P5 significance | STM-5 | no pvalue profile → nothing bold | "no p-values recorded", nothing bold | ✅ |
| P2 tabs in sample mode | MD-1 | Summary, Pathways, Clinical Data | Summary, Pathways, Clinical Data, Files & Links (no GE; 2026-11-18) | ✅ GE hidden |
| P3 GE on 1 sample | MD-2 | tab hidden | tab hidden (2026-11-18; on the 11th shown, then refused) | ✅ |

---

## 4. Scorecard

### §0 Tab inventory and gating

| ID | verdict | how | note |
|---|---|---|---|
| PTB-TAB-1 | 🟡 | B | `?tab=<Title>` keeps the query; unknown → Summary ✅; not a path segment |
| PTB-TAB-2 | 🟡 | B | Summary · Genomic Evolution · Pathways · Clinical Data · Mutational Signatures, the legacy order ✅; GE on >1 sample and a called mutation with VAF > 0 in a called or uncalled record (legacy mergeMutationsIncludingUncalled; `lib/views/evolution/sql.ts:52-60`) ✅, drawable lists identical on glioma_msk_2018 36 / lgg_ucsf_2014 23 / msk_impact_2017 545; no Files & Links (no study holds resource data; `app/portal/patient-layout.ts:67`) ✅; Pathways hidden with no genomic data; no Pathology / Tissue / Matched Trials / mRNA / Plots / resource / custom tabs |
| PTB-TAB-3 | ✅ | B | No Clinical Trials tab |
| PTB-TAB-4 | N/A | — | Observation about the public build; requirement is TAB-2 #5 |
| PTB-TAB-5 | 🟡 | C | Line tabs + "Open in cBioPortal"; no pagination, no help widget, no closable resource tabs |

### §1 Genomic Evolution

| ID | verdict | how | note |
|---|---|---|---|
| PTB-GE-1 | 🟡 | B | Line chart \| Heatmap, table below ✅; choice in the document (invariant 9); unprofiled alert ✅ (PTB-GE-3) |
| PTB-GE-2 | ✅ | BC | Every mutation of the table's query with a VAF; uncalled included as its own state; key gene + protein change + event (`figure.ts:7`) |
| PTB-GE-3 | ✅ | BC | "Sample(s) ⟨markers⟩ not profiled for mutations" above the chart, the samples outside the mutation profile in the patient's order, none when all are in it (`notProfiledForMutations`, `lib/views/evolution/figure.ts`); NP also drawn as dashed line / NA cell (all_phase2_target_2018_pub TARGET-10-PAPLDL: -04, as the portal's gene-panel data; lgg_ucsf_2014 P04: none) |
| PTB-GE-4 | ✅ | C | Hover highlights line, row, table row; click toggles kept picks (local) |
| PTB-GE-LC-1 | ✅ | B | Show Timeline / Hide Timeline, offered only with clinical events ✅; shown, the patient's timeline above the line chart, the chart's time axis spanning the timeline's plot so each sample sits under its day ✅ (lgg_ucsf_2014 P04: both axes' "1y" at 403 px); in the document (`showTimeline`), as the portal's URL setting; default hidden ✅ |
| PTB-GE-LC-2 | ✅ | B | sequential (disabled + reason when days missing), log scale, y axis to data range, Group by (None + the samples' clinical attributes) ✅ (in document); "only selected" draws only the clicked mutations, none with nothing clicked, the data range following them (`onlySelected`, `lib/views/evolution/figure.ts`; local, as the portal's) ✅ (lgg_ucsf_2014 P04: 58 lines, 0, 2 picked → 2) |
| PTB-GE-LC-3 | 🟡 | B | Polylines + sample markers ✅; y title "Variant allele frequency"; extra legend (called / uncalled / not found / not profiled) |
| PTB-GE-LC-4 | ✅ | BC | Sequential even spacing / collection day ✅; the x axis is the patient timeline's, as legacy: year ticks "0, 1y, 2y" with month ticks "4m, 8m", spanning all the patient's events (lgg_ucsf_2014 P04: specimens at 0/461/1075/1343, last event day 1854, axis to 5y, as the API gives), empty years cut, "every year" (expandGaps, in the document) for legacy's click on the cut; axis below the plot (legacy above) |
| PTB-GE-LC-5 | ✅ | BC | Group by a sample attribute, as legacy (splitMutationsBySampleGroup): a line per mutation and group through that group's samples only, groups in the order of their first sample, the portal's unique colours (#3366cc, #dc3912, …) when there are 2+ groups, samples without a value a last uncoloured group, a marker row per group labelled in its colour (lgg_ucsf_2014 P04 by Sample Type: Primary 1, Recurrence 2–4) |
| PTB-GE-LC-6 | ✅ | BC | The portal's tooltip: Gene, Protein Change, Sample ID, then "VAF: 0.69 (54 reads of 78 total)" (lgg_ucsf_2014 P04_Pri TP53 R248Q, 54/24 reads in the API), "Mutated, but we don't have VAF data.", "Mutation uncalled (…)", "Mutation not detected", "<sample> is not sequenced for <gene> mutations." (mutationTooltip) |
| PTB-GE-LC-7 | ✅ | C | No download on the tab, as legacy without the timeline |
| PTB-GE-HM-1 | ✅ | B | Cluster ✅, Transpose ✅, mutation-labels toggle ✅ (gear menu, in the document); SVG / PNG / Data download ✅ (#419; lgg P04 88/88 cells = portal); zoom − / slider / + ✅ (20 px cells at 1, ×0.7 a step, the fit to 1; local, as the portal's; lgg P04 at 800 px 12 → 17.1 → 20 px) |
| PTB-GE-HM-2 | ✅ | C | Default a row per sample, a column per mutation, as legacy; Transpose gives a row per mutation; no-VAF mutations dropped ✅ |
| PTB-GE-HM-3 | 🟡 | C | The legacy VAF ramp yellow→teal `rgb(241,242,181)`→`rgb(19,80,88)` ✅ (STYLE.ramps.vaf); grey = profiled not found ✅, NA glyph ✅; ours adds a called-no-counts glyph and an uncalled dot |
| PTB-GE-HM-4 | ✅ | C | Clustered by default with the oncoprint heatmap clustering (both axes); Cluster off: samples in collection order, mutations by name in either orientation (legacy MutationOncoprint mutationWithIdOrder) |
| PTB-GE-TB-1 | 🔶 | B | Columns Samples · Gene · Protein Change · Mutation Type · VAF by sample · Max VAF (6/13); 10 rows ✅; "Show only selected mutations" above the table ✅: only the picked mutations in the table's order, every row with none picked, picks not highlighted while filtering, kept in the browser as the picks are (`lib/views/evolution/table.ts`; lgg_ucsf_2014 P04: 2 picks across pages → "2 of 80 Mutations"); no Annotation, Allele Freq bars or Cohort column |

### §2 Pathways

| ID | verdict | how | note |
|---|---|---|---|
| PTB-PW-1 | 🟡 | B | Own PathwayMapper-data renderer (no lazy chunk) + canonical-pathways bars below; unprofiled alert ✅: "Sample(s) ⟨markers⟩ not profiled for mutations / copy number alterations" above the diagram, a line per profile the study holds (`lib/views/pathwaymap/profiled.ts`; all_phase2_target_2018_pub TARGET-10-PAPLDL: -04 mutations, -03 copy number, as the portal's gene-panel data); not in sample mode |
| PTB-PW-2 | 🟡 | BC | Genes altered in the patient (mutation, AMP/HOMDEL, **and SV**); nodes coloured by altered % (TP53 100 %), not per-sample mini tracks |
| PTB-PW-3 | 🟡 | B | Patient page: only "PanCanAtlas pathways only", ranking by match count, as the portal's patient mode ✅ (lgg_ucsf_2014 P04); the analysis page keeps rank by / weight by altered %; no "Perform layout" |
| PTB-PW-4 | 🟡 | B | Patient page: Pathway name · Pathway altered (bold Yes / No = score > 0) · Genes matched ✅, altered first (lgg_ucsf_2014 P04: Cell Cycle, TP53 Yes; eight No) (`pathwayAltered`, `lib/views/pathwaymap/rank.ts`); names not truncated to 20 characters; no page of 10, copy or download (tracked) |

### §3 Clinical Data

| ID | verdict | how | note |
|---|---|---|---|
| PTB-CD-1 | ✅ | B | "Patient" and "Samples" tables as the portal's, and the Timeline Data tables under them (#316) ✅ |
| PTB-CD-2 | 🟡 | B | Attribute \| Value, priority then name, every attribute with a value, a filter box ✅ (lgg P04: Overall Survival Status 1:DECEASED, Diagnosis Age 22, Number of Samples 4, OS 61, Sex Male — the portal API's five); non-integer numbers to one decimal (`lib/views/table/transpose.ts`, TCGA-A6-2671 OS_MONTHS 43.8 = portal) ✅; no panel links, no copy/download |
| PTB-CD-3 | 🟡 | B | Attribute × sample, a sample's own attributes, n/a where missing, raw values ✅ (P04: P04_Pri … P04_Rec3); samples in the page's sample order, the header's markers ✅ (prad_mskcc_2017 P-0001684: T02 Primary, then T01 Metastasis); no column sorts (the portal sorts Attribute) |
| PTB-CD-4 | 🟡 | B | Timeline Data: a table per event type, START_DATE · STOP_DATE · EVENT_TYPE · each attribute key in first-seen order, PATIENT_ID and STYLE_* left out, days as recorded, each sortable (as text) and filterable ✅ (lgg P04: Specimen 4, Surgery 4, Status 4, Treatment 3 rows — the portal API's counts); laid out as its own card under the two tables |

### §4 Mutational Signatures

| ID | verdict | how | note |
|---|---|---|---|
| PTB-MS-1 | ✅ | BC | Contribution / pvalue / counts by profile id, version = last token, NAME/DESCRIPTION/URL meta (`signatures/data.ts`) |
| PTB-MS-2 | ✅ | B | "Mutational Signature Type:" select, %/#, "Y-axis Max:" slider; settings in the document; sample select not exercised (1 sample) |
| PTB-MS-3 | ✅ | C | "<ids> is/are not profiled for mutational signatures." (`signatures-body.tsx:121`) |
| PTB-MS-4 | ✅ | B | "Sample: SP1003 \| Single Base Substitution (SBS) count: 347" + ⓘ |
| PTB-MS-5 | ✅ | B | Category strip, contexts, "Single Base Substitution (%)" ✅; Download ▸ SVG / PNG / PDF of the spectrum as drawn (with the chosen reference profile), named mutationalBarChart, as legacy (pancan_pcawg_2020 DO1000 saved in all three) |
| PTB-MS-6 | ✅ | C | Row click → COSMIC v3.3 reference below (`reference.ts`) |
| PTB-MS-7 | 🟡 | B | Name + ⓘ, sample column, bold p<0.05, first sample desc ✅; every row on one page, as legacy (#343); extra "Signature contributions" bar chart; Copy / Download as the portal's table.tsv ✅ (every row in the table's sort, the search not narrowing it, "<1%"/whole percents, CRLF; pancan_pcawg_2020 DO1000: 65 rows, SBS40 65%, SBS5 22%, SBS1 13% as the API's 0.654/0.2208/0.1252) |

### §5 Files & Links, resources, pathology, tissue, trials, custom tabs

| ID | verdict | how | note |
|---|---|---|---|
| PTB-RS-1 | ❌ | C | No resource data (tracked) |
| PTB-RS-2 | ❌ | B | "Files & Links — not built yet" (tracked) |
| PTB-RS-3 | ❌ | C | (tracked) |
| PTB-RS-4 | ❌ | C | (tracked) |
| PTB-RS-5 | ❌ | C | (tracked) |
| PTB-RS-6 | ❌ | C | (tracked) |
| PTB-PR | ❌ | C | (tracked: pathology reports) |
| PTB-TI | ❌ | C | (tracked: slides, imaging) |
| PTB-TM | ❌ | C | No MatchMiner tab; cBioLab plans an OncoKB "Clinical Trials" tab instead (tracked as Patient → Clinical Trials) |
| PTB-CT | ❌ | C | (tracked: custom tabs from config) |

### §6 mRNA (Beta) and Plots (Beta)

| ID | verdict | how | note |
|---|---|---|---|
| PTB-MR-1 | ❌ | C | (tracked: Patient → mRNA) |
| PTB-MR-2 | ❌ | C | (tracked) |
| PTB-MR-3 | ❌ | C | (tracked) |
| PTB-MR-4 | ❌ | C | (tracked) |
| PTB-MR-5 | ❌ | C | (tracked) |
| PTB-MR-6 | ❌ | C | (tracked) |
| PTB-MR-7 | ❌ | C | (tracked) |
| PTB-MR-8 | N/A | — | Dead UI, not to be ported |
| PTB-MR-9 | ❌ | C | (tracked) |
| PTB-PL-1 | ❌ | C | No patient Plots tab |
| PTB-PL-2 | ❌ | C | No reference-cohort select |

### §7 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| PTB-MD-1 | ✅ | BC | P2: no GE; signatures read the cohort's sample (`samples: "cohort"`, `patient-layout.ts:59`) |
| PTB-MD-2 | ✅ | B | No GE tab (TCGA-A6-2671); Samples table one row ✅ |
| PTB-MD-3 | ✅ | B | No GE tab: prad_mskcc_2017 P-0000964 (2 samples, 10 mutations, none with allele counts on the portal's API) |
| PTB-MD-4 | ✅ | C | `noDay` forces sequential; checkbox disabled with the reason (not hidden) |
| PTB-MD-5 | ✅ | BC | NA cells ✅, dashed line across NP ✅; the alert on Genomic Evolution (#477) and Pathways ✅ (patient mode) |
| PTB-MD-6 | ✅ | C | Spectrum, count line, %/# and reference need counts (`signatures-body.tsx:71,119`) |
| PTB-MD-7 | ✅ | B | No pvalue profile → nothing bold, "no p-values recorded" |
| PTB-MD-8 | ✅ | C | Reference only for SBS/DBS/ID (`reference.ts:31`) |
| PTB-MD-9 | ❌ | C | (tracked) |
| PTB-MD-10 | ❌ | C | (tracked) |
| PTB-MD-11 | ❌ | C | (tracked: Data-governance switches) |
| PTB-MD-12 | ✅ | B | No trials tab |

§8 Persistence (no IDs): GE chart, sequential, log, data range, signature version/scale/ymax/signature, table queries all in the document (`?changes=`, invariant 9); legacy keeps most local or in `genomicEvolutionSettings`. Hover and picks stay in the browser in both.

### §9 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| PTB-STM-1 | ✅ | BC | 88/88 points; lines trimmed to first/last sample with reads (README); profiled-not-found = 0; NP never 0; interpolation bug not reproduced |
| PTB-STM-2 | 🟡 | C | Data range and log (floor 0.001) ✅; tick-label rule not compared |
| PTB-STM-3 | 🟡 | C | Heatmap clustered with lib/oncoprint-cluster.ts (the oncoprint's heatmap clustering); clustered order not compared cell-by-cell with the portal |
| PTB-STM-4 | ✅ | BC | Stored fraction; "<1%" below 1 %, else whole % (`data.ts:93-96`); 36/34/27/2 % |
| PTB-STM-5 | ✅ | C | p < 0.05 bold; p = 0 also bolds (legacy bug not copied) |
| PTB-STM-6 | ✅ | BC | Counts and total 347 ✅; % = round(100·count/total), 0 when the total is 0 (`spectrumPct`), as legacy; the multi-sample tooltip bug not copied |
| PTB-STM-7 | ✅ | C | Ported (`data.ts:212-226`) |
| PTB-STM-8 | ✅ | C | COSMIC v3.3, key = first word of NAME |
| PTB-STM-9 | N/A | — | Unused store quirks |
| PTB-STM-10 | 🟡 | B | Match count, TCGA-only ✅, same scores; shown as number; ties broken differently |
| PTB-STM-11 | ✅ | B | Patient table non-integer numerics to one decimal, "< 0.1" when it rounds to 0 (`lib/views/table/transpose.ts`, portalClinicalValue); samples table raw. TCGA-A6-2671: OS_MONTHS/DSS_MONTHS 43.75842457 → 43.8, PFS_MONTHS 17.58884834 → 17.6, WEIGHT 67.2, as the portal; FGA 0.4881 raw in the samples table |
| PTB-STM-12 | ❌ | C | No mRNA tab (tracked) |

---

## 5. cBioLab bugs

- ~~**Genomic Evolution tab offered where it can only refuse** — single-sample patients (P3 TCGA-A6-2671, msk P-0000004) get the tab and a refusal; `patient-layout.ts:57` does not check ≥2 samples or allele counts, though the patient page knows the sample count.~~ Fixed (2026-11-18: no GE tab on TCGA-A6-2671 or msk P-0000004).
- No other behaviour broken on its own terms was found in these tabs.
