# Parity audit — Patient View › other tabs (spec `41-patient-tabs.md`)

- **Date:** 2026-11-11
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
| ✅ match | 18 |
| 🟡 partial | 15 |
| 🔶 different | 15 |
| ❌ missing | 30 |
| 🐞 ok | 0 |
| 🐞 copied | 0 |
| N/A | 3 |
| ? | 0 |
| **Total IDs** | **81** |

**Overall: 25.9 %** (✅ 18 + 🐞ok 0 + N/A 3 = 21 of 81). Counting 🟡 as half: 35.2 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 TAB inventory | 5 | 0 | 2 | 2 | 0 | 0 | 1 | Different order and gating; placeholder tabs; `?tab=` not path |
| §1 GE core | 4 | 2 | 1 | 0 | 1 | 0 | 0 | Same mutation set and selection model; no unprofiled alert |
| §1 GE line chart | 7 | 1 | 4 | 0 | 2 | 0 | 0 | Sequential/log/data-range present; no Group by, no timeline toggle |
| §1 GE heatmap | 4 | 0 | 0 | 3 | 1 | 0 | 0 | Mutation × sample fixed, oncoprint ramp, no cluster/transpose/zoom/download |
| §1 GE table | 1 | 0 | 0 | 1 | 0 | 0 | 0 | Own columns (VAF by sample, Max VAF); no "only selected" |
| §2 Pathways | 4 | 0 | 2 | 2 | 0 | 0 | 0 | Same scores; numeric score not Yes/No; tie order → other default pathway |
| §3 Clinical Data | 4 | 0 | 0 | 3 | 1 | 0 | 0 | Wide row-per-case tables; no timeline tables |
| §4 Mutational Signatures | 7 | 5 | 2 | 0 | 0 | 0 | 0 | Close port; numbers identical; table paged |
| §5 Resources, pathology, tissue, trials, custom | 10 | 0 | 0 | 0 | 10 | 0 | 0 | None built (tracked) |
| §6 mRNA / Plots (beta) | 11 | 0 | 0 | 0 | 10 | 0 | 1 | None built (mRNA tracked) |
| §7 Modes | 12 | 5 | 1 | 3 | 3 | 0 | 0 | Sample mode right; GE offered on 1-sample patients |
| §9 Statistics | 12 | 5 | 3 | 1 | 2 | 0 | 1 | VAF and signature numbers identical; no clustering, no mRNA stats |

---

## 2. Top gaps (ranked by how often a portal user hits them)

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
| P1 Clinical Data samples | CD-3 | 4 sample columns, order Pri, Rec1, Rec2, Rec3 | 4 sample rows, same order | 🔶 layout only |
| P5 SBS contributions | STM-4 | SBS5 0.3618, SBS13 0.3437, SBS2 0.2746, SBS1 0.0199 (REST, 4 dp) → 36 / 34 / 27 / 2 % | 0.36181, 0.34369, 0.27459, 0.01991 → 36 / 34 / 27 / 2 %; zeros "<1%" | ✅ |
| P5 signature rows | MS-7 | 65 | 65 | ✅ |
| P5 SBS count | MS-4, STM-6 | 347 ("Sample: SP1003 \| Single Base Substitution (SBS) count: 347") | 347, same line | ✅ |
| P5 SBS channels | STM-6 | 96 channel counts | 96, all equal | ✅ counts; % unrounded (🟡) |
| P5 DBS | STM-4 | DBS2 1.0, count 1 | DBS offered as a version | ✅ (not drawn) |
| P5 significance | STM-5 | no pvalue profile → nothing bold | "no p-values recorded", nothing bold | ✅ |
| P2 tabs in sample mode | MD-1 | Summary, Pathways, Clinical Data | Summary, Pathways, Clinical Data, Files & Links, Clinical Trials (no GE) | ✅ GE hidden |
| P3 GE on 1 sample | MD-2 | tab hidden | tab shown: "TCGA-A6-2671 has 1 sample; following mutations across samples needs at least two" | 🔶 |

---

## 4. Scorecard

### §0 Tab inventory and gating

| ID | verdict | how | note |
|---|---|---|---|
| PTB-TAB-1 | 🟡 | B | `?tab=<Title>` keeps the query; unknown → Summary ✅; not a path segment |
| PTB-TAB-2 | 🔶 | B | P1: Summary · Pathways · Clinical Data · Genomic Evolution · Files & Links · Clinical Trials; GE gated on "not sample mode and has mutations" (`patient-layout.ts:57`), not ≥2 samples + VAF; Signatures on a contribution profile (`patient-layout.ts:25`) ✅; no Pathology / Tissue / Matched Trials / mRNA / Plots / resource / custom tabs |
| PTB-TAB-3 | 🔶 | B | Adds a "Clinical Trials — not built yet" tab (OncoKB trial matching) that legacy does not have |
| PTB-TAB-4 | N/A | — | Observation about the public build; requirement is TAB-2 #5 |
| PTB-TAB-5 | 🟡 | C | Line tabs + "Open in cBioPortal"; no pagination, no help widget, no closable resource tabs |

### §1 Genomic Evolution

| ID | verdict | how | note |
|---|---|---|---|
| PTB-GE-1 | 🟡 | B | Line chart \| Heatmap, table below ✅; choice in the document (invariant 9); no unprofiled alert |
| PTB-GE-2 | ✅ | BC | Every mutation of the table's query with a VAF; uncalled included as its own state; key gene + protein change + event (`figure.ts:7`) |
| PTB-GE-3 | ❌ | C | No alert; NP shown only as dashed line / NA cell |
| PTB-GE-4 | ✅ | C | Hover highlights line, row, table row; click toggles kept picks (local) |
| PTB-GE-LC-1 | ❌ | B | No Show/Hide Timeline |
| PTB-GE-LC-2 | 🟡 | B | sequential (disabled + reason when days missing), log scale, y axis to data range ✅ (in document); no Group by, no "Show only selected mutations" |
| PTB-GE-LC-3 | 🟡 | B | Polylines + sample markers ✅; y title "Variant allele frequency"; extra legend (called / uncalled / not found / not profiled) |
| PTB-GE-LC-4 | 🟡 | B | Sequential even spacing / collection day ✅; x axis in days (0…1,400) not 0, 4m, 8m, 1y |
| PTB-GE-LC-5 | ❌ | B | No grouping |
| PTB-GE-LC-6 | 🟡 | C | "VAF 0.38 (46 of 121 reads)", "called, no allele counts", "uncalled, VAF …", "not found", "not profiled" (`figure.ts:15-26`) — same states, other words |
| PTB-GE-LC-7 | ✅ | C | No download on the tab, as legacy without the timeline |
| PTB-GE-HM-1 | ❌ | C | No Cluster, Transpose, labels toggle, zoom, download |
| PTB-GE-HM-2 | 🔶 | C | Always a row per mutation, column per sample (legacy default is the transpose); no-VAF mutations dropped ✅ |
| PTB-GE-HM-3 | 🔶 | C | Oncoprint sequential ramp, not yellow→teal; grey = profiled not found ✅, NA glyph ✅, called-no-counts glyph, uncalled dot |
| PTB-GE-HM-4 | 🔶 | C | Table order; no clustering |
| PTB-GE-TB-1 | 🔶 | B | Columns Samples · Gene · Protein Change · Mutation Type · VAF by sample · Max VAF (6/13); 25 rows; no "Show only selected" (filter the table instead) |

### §2 Pathways

| ID | verdict | how | note |
|---|---|---|---|
| PTB-PW-1 | 🟡 | B | Own PathwayMapper-data renderer (no lazy chunk) + canonical-pathways bars below; no unprofiled alert |
| PTB-PW-2 | 🟡 | BC | Genes altered in the patient (mutation, AMP/HOMDEL, **and SV**); nodes coloured by altered % (TP53 100 %), not per-sample mini tracks |
| PTB-PW-3 | 🔶 | B | "rank by match count", "weight by altered %", "PanCanAtlas pathways only" shown; legacy shows only the TCGA checkbox; no "Perform layout" |
| PTB-PW-4 | 🔶 | B | Columns pathway · score · genes matched; legacy Pathway name · Pathway altered (bold Yes/No) · Genes matched; P1 first row Cell Cycle vs TP53; no copy/download (tracked) |

### §3 Clinical Data

| ID | verdict | how | note |
|---|---|---|---|
| PTB-CD-1 | 🔶 | B | Two cards "Patient", "Samples"; no Timeline Data section |
| PTB-CD-2 | 🔶 | B | One row, attributes as columns (P04 · 4 · 1:DECEASED · 22 …); per-column filter + CSV ✅; no Attribute \| Value, no priority order, no 1-decimal format, no panel links |
| PTB-CD-3 | 🔶 | B | One row per sample, patient attributes repeated; legacy one column per sample |
| PTB-CD-4 | ❌ | B | No per-event-type timeline tables |

### §4 Mutational Signatures

| ID | verdict | how | note |
|---|---|---|---|
| PTB-MS-1 | ✅ | BC | Contribution / pvalue / counts by profile id, version = last token, NAME/DESCRIPTION/URL meta (`signatures/data.ts`) |
| PTB-MS-2 | ✅ | B | "Mutational Signature Type:" select, %/#, "Y-axis Max:" slider; settings in the document; sample select not exercised (1 sample) |
| PTB-MS-3 | ✅ | C | "<ids> is/are not profiled for mutational signatures." (`signatures-body.tsx:121`) |
| PTB-MS-4 | ✅ | B | "Sample: SP1003 \| Single Base Substitution (SBS) count: 347" + ⓘ |
| PTB-MS-5 | 🟡 | B | Category strip, contexts, "Single Base Substitution (%)" ✅; no SVG/PNG/PDF button |
| PTB-MS-6 | ✅ | C | Row click → COSMIC v3.3 reference below (`reference.ts`) |
| PTB-MS-7 | 🟡 | B | Name + ⓘ, sample column, bold p<0.05, first sample desc ✅; paged 25 of 65 (legacy all); extra "Signature contributions" bar chart; no download (tracked) |

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
| PTB-MD-2 | 🔶 | B | GE tab shown and refuses (P3, P4); Samples table one row ✅ |
| PTB-MD-3 | 🔶 | C | GE tab shown; the view refuses a patient with no allele counts |
| PTB-MD-4 | ✅ | C | `noDay` forces sequential; checkbox disabled with the reason (not hidden) |
| PTB-MD-5 | 🟡 | C | NA cells ✅, dashed line across NP ✅; no alert |
| PTB-MD-6 | ✅ | C | Spectrum, count line, %/# and reference need counts (`signatures-body.tsx:71,119`) |
| PTB-MD-7 | ✅ | B | No pvalue profile → nothing bold, "no p-values recorded" |
| PTB-MD-8 | ✅ | C | Reference only for SBS/DBS/ID (`reference.ts:31`) |
| PTB-MD-9 | ❌ | C | (tracked) |
| PTB-MD-10 | ❌ | C | (tracked) |
| PTB-MD-11 | ❌ | C | (tracked: Data-governance switches) |
| PTB-MD-12 | 🔶 | B | "Clinical Trials" placeholder on every patient |

§8 Persistence (no IDs): GE chart, sequential, log, data range, signature version/scale/ymax/signature, table queries all in the document (`?changes=`, invariant 9); legacy keeps most local or in `genomicEvolutionSettings`. Hover and picks stay in the browser in both.

### §9 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| PTB-STM-1 | ✅ | BC | 88/88 points; lines trimmed to first/last sample with reads (README); profiled-not-found = 0; NP never 0; interpolation bug not reproduced |
| PTB-STM-2 | 🟡 | C | Data range and log (floor 0.001) ✅; tick-label rule not compared |
| PTB-STM-3 | ❌ | C | No heatmap clustering |
| PTB-STM-4 | ✅ | BC | Stored fraction; "<1%" below 1 %, else whole % (`data.ts:93-96`); 36/34/27/2 % |
| PTB-STM-5 | ✅ | C | p < 0.05 bold; p = 0 also bolds (legacy bug not copied) |
| PTB-STM-6 | 🟡 | BC | Counts and total 347 ✅; % = 100·count/total unrounded (`figure.ts:89`), legacy rounds to integers |
| PTB-STM-7 | ✅ | C | Ported (`data.ts:212-226`) |
| PTB-STM-8 | ✅ | C | COSMIC v3.3, key = first word of NAME |
| PTB-STM-9 | N/A | — | Unused store quirks |
| PTB-STM-10 | 🟡 | B | Match count, TCGA-only ✅, same scores; shown as number; ties broken differently |
| PTB-STM-11 | 🔶 | B | Raw values in both tables; no toFixed(1) on the patient table |
| PTB-STM-12 | ❌ | C | No mRNA tab (tracked) |

---

## 5. cBioLab bugs

- **Genomic Evolution tab offered where it can only refuse** — single-sample patients (P3 TCGA-A6-2671, msk P-0000004) get the tab and a refusal; `patient-layout.ts:57` does not check ≥2 samples or allele counts, though the patient page knows the sample count.
- No other behaviour broken on its own terms was found in these tabs.
