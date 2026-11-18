# Parity audit — Results › Mutations (spec `05-mutations.md`)

- **Date:** 2026-11-11; re-scored 2026-11-16
- **cBioLab:** master @ `7ef627ba`, `next dev` on `http://127.0.0.1:3000` (first audit: `session/spec` @ `f3197d75`)
- **Legacy:** cbioportal.org (Playwright, 2026-11-16; first audit 2026-11-11)
- **Code paths (cBioLab):** `app/portal/results-layout.ts` (Mutations tab: `hotspots` + `mutations` views, gene chooser, `linkMutations`), `lib/views/hotspots/*`, `lib/lollipop.ts` (types, colours, label, Genome Nexus), `lib/lollipop-svg.ts` (figure), `lib/federation.ts:519-570` (lollipop SQL), `app/_lollipop/*` (HotspotsBody, AlterationGrid, TranscriptSummary, ColorLegend, LollipopTools, use-stem-clicks), `lib/views/mutations/*`, `lib/mutation-table.ts`, `app/lab/kinds/mutations.tsx`, `app/_table/DataTable.tsx`, `lib/table-query.ts`

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 reference (KRAS, TP53 tabs) | `/results/mutations?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS NRAS BRAF TP53 APC&mutations_gene=KRAS` (and `=TP53`) | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%20NRAS%20BRAF%20TP53%20APC&tab=Mutations` (+ TP53 chip) |
| Q2 fusions | `/results/mutations?cancer_study_list=prad_tcga_pan_can_atlas_2018&case_set_id=prad_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=TMPRSS2 ERG ETV1&mutations_gene=TMPRSS2` | `/portal/results?study=prad_tcga_pan_can_atlas_2018&genes=TMPRSS2%20ERG%20ETV1&tab=Mutations` (+ ERG chip) |

Legacy: lollipop stems read from `.lollipop-svgnode` circle geometry (heights fitted to hovered tooltips, x to codons), every stem's tooltip hovered on KRAS (14), the top 15 on TP53; badge grid and frequency from page text; table from its "Download TSV". cBioLab: the same documents via `/api/analysis` (`hotspots`, `mutations`) and `/api/table` (CSV), plus the page in the browser. Rows joined on Sample ID + Protein Change + Start Pos. Scripts, logs and screenshots: (local scratch, not committed) (`leg.js`, `lab.js`, `labapi.js`, `cmp_lp.py`, `cmp_tb.py`; `out/leg-coad-KRAS.png`, `out/lab-KRAS.png`, `out/lab-prad-ERG.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 38 |
| 🟡 partial | 41 |
| 🔶 different | 13 |
| ❌ missing | 30 |
| 🐞 ok | 4 |
| 🐞 copied | 0 |
| N/A | 7 |
| ? | 6 |
| **Total IDs** | **139** |

**Overall: 35.3 %** (✅ 38 + 🐞ok 4 + N/A 7 = 49 of 139). Counting 🟡 as half: 50.0 %. (2026-11-11: 18.0 % / 30.2 %.)

Re-score of 2026-11-16: 30 verdicts changed, from #230 (fusions), #245 (the portal's columns and Mutation Type labels), #250 (empty gene, germline, GRCh38, legend) and #251 (OQL). Six IDs are now `?`: their Genome Nexus columns exist but Q1's study is not in the offline store, so the cells are blank and their format could not be compared. ✅ rows spot-checked, none regressed: GT-1, LP-7…9, COL-3, COL-30, MD-12, STM-7.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | 🐞cp | N/A | ? | One line |
|---|---|---|---|---|---|---|---|---|---|---|
| §0 Wiring, banners (0) | 5 | 1 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | OQL and fusions added; drivers-only / somatic / profiled still not applied; no VUS or germline banners |
| §1 Gene tabs (GT) | 4 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | Unchanged |
| §2 Layout, header (LY, HD) | 5 | 1 | 3 | 0 | 1 | 0 | 0 | 0 | 0 | GRCh38 Ensembl link fixed; transcript fixed to canonical; no germline rate |
| §3 Lollipop (LP) | 12 | 6 | 4 | 1 | 0 | 1 | 0 | 0 | 0 | Legend no longer copies the portal's Splice error; no Y-max slider; axis and tooltip worded differently |
| §4 Tracks, 3D (TK, 3D) | 7 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 0 | None (tracked) |
| §5 Badge filter (BF) | 4 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | Grid as the portal's; driver split depends on the loaded stores |
| §6 Table columns (COL) | 44 | 14 | 15 | 1 | 10 | 1 | 0 | 3 | 0 | 35 columns now, labels coloured; default set lacks Copy # and Allele Freq (T); no ASCN / clinical / namespace columns |
| §7 Annotation (AN, VA) | 12 | 0 | 0 | 3 | 3 | 0 | 0 | 1 | 5 | OncoKB text badge, gene-level level; variant columns exist but blank on Q1 |
| §8 Table controls, filters (TB, FM) | 14 | 2 | 6 | 4 | 2 | 0 | 0 | 0 | 0 | Unchanged: search does not reach the lollipop; drivers-first sort |
| §9 Modes (MD) | 15 | 5 | 1 | 1 | 5 | 1 | 0 | 2 | 0 | Fusions and the empty gene fixed; drivers-only, germline, profiled missing |
| §11 Statistics (STM) | 17 | 6 | 5 | 1 | 2 | 1 | 0 | 1 | 1 | Frequency with fusions and Copy # as legacy; driver split, duplicates, Freq absent |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Table defaults**: 6 default columns (no Copy #, no Allele Freq (T)); default sort "drivers, then codon" (KRAS first row A11_G12dup) vs Annotation ↓ (G12C first) | COL-38, COL-18, COL-27, TB-9, STM-10 | Mutations tab: table defaults |
| 2 | **Annotation column** is one text badge "Oncogenic · Level 1": no icons/cards/header; level is the gene's highest (KRAS G12D "Level 1" vs legacy level_3b); no hotspot icon, CIViC, reVUE | COL-7, AN-1…AN-6 | Mutations tab: Annotation column; annotation breadth |
| 3 | **Driver split depends on the loaded stores**: TP53 4 hotspot rows VUS (coadread not in the Genome Nexus store); prad fusions all VUS (no OncoKB pair calls in the pinned v7.5 store) | BF-1, STM-4 | Mutations tab (added in this re-score) |
| 4 | **Genome Nexus columns blank on Q1**: Functional Impact, HGVSc, Exon, gnomAD, ClinVar, dbSNP, SIGNAL exist (#245) but coadread is not in the offline store | COL-10, COL-26, COL-31…35, VA-1…5, STM-13 | Mutations tab (added in this re-score) |
| 5 | **Table search and column filters do not reach the lollipop or badges** (search "G12D": table 59, lollipop 223) | TB-3, FM-1, FM-3, STM-4 | Mutations tab: table search and filters |
| 6 | **No Y-Axis Max slider**; y axis "# KRAS Mutations" (legacy "# patients"), ticks niced to 150 | LP-2, LP-6, STM-17 | Mutations tab: Y-Axis Max |
| 7 | **Lollipop tooltip** is the native SVG title, no "N mutated of M profiled patients"; no hover → table highlight | LP-10, LP-11 | Mutations tab: stem tooltip |
| 8 | **Show only drivers / somatic / profiled** not applied to this tab; no VUS or germline banners | 0-4, 0-5, MD-3, MD-4, MD-13, FM-2 | Driver-annotation settings; Show only profiled |
| 9 | **Missing columns**: ASCN (5), clinical attributes, namespace, custom driver; Variant Type uncoloured | COL-8, COL-9, COL-12…17, COL-36, COL-37, COL-T2 | Custom driver annotations; Mutations tab (added in this re-score) |
| 10 | **Annotation tracks and 3D structure** absent | TK-1…TK-4, 3D-1…3D-3, MD-10 | annotation breadth |
| 11 | **Table chrome**: numbered pager, one-list Columns menu without Freq, CSV of rows kept, no Copy, no annotation filter | TB-1, TB-2, TB-4…TB-8, STM-15 | Mutations tab (added in this re-score) |
| 12 | **Multi-sample counts**: the duplicate suffix is in (#302); no "n samples / m patients" | TB-1, MD-5, STM-14, STM-16, FM-5 | Mutations tab (added in this re-score) |
| 13 | **Transcript fixed to canonical** | HD-1, HD-2, MD-7 | transcript drop-down |

---

## 3. Number check (2026-11-16)

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 KRAS / TP53 Somatic Mutation Frequency | STM-1 | 36.7 % / 52.9 % | 36.7 % / 52.9 % | ✅ |
| Q2 TMPRSS2 / ERG Somatic Mutation Frequency | STM-1 | 41.5 % / 2.8 % | 41.5 % / 2.8 % | ✅ (#230) |
| Q1 KRAS badges | STM-4 | Driver 221 / VUS 2 | 221 / 2 | ✅ |
| Q1 TP53 badges | STM-4 | 329 / 3 | 325 / 7 | 🔶 4 hotspot rows (store) |
| Q2 TMPRSS2 Fusion badge | STM-4 | 207 / 29 | 0 / 236 | 🔶 total ✅, no pair calls in the v7.5 store |
| Table rows KRAS / TP53 / TMPRSS2 / ERG | TB-1, MD-11 | 223 / 332 / 240 / 220 | 223 / 332 / 240 / 220 | ✅ |
| KRAS table defaults | COL-38 | Sample ID, Cancer Type Detailed, Protein Change, Annotation, Mutation Type, Copy #, Allele Freq (T), # Mut in Sample | the same without Copy # and Allele Freq (T) | 🔶 |
| KRAS G12C Copy # (A6-A567, AA-3696, AA-A02W) | STM-11 | ShallowDel, Gain, Diploid | ShallowDel, Gain, Diploid | ✅ (#245) |
| Search "G12D" | TB-3 | lollipop follows | table 59 of 223, badges 59, stems G12D and A11_G12dup ("G12dup" contains "g12d") | ✅ |

Q1 stems, labels, VAF, # Mut and oncogenicity were matched row by row on 2026-11-11 and not re-run; the stem labels ("G12D/V/C and 3 more", "R175H/C") and counts above agree.

---

---

## 4. Scorecard

### §0 Tab wiring and banners

| ID | verdict | how | note |
|---|---|---|---|
| MUT-0-1 | ✅ | B | "Mutations" tab, always shown; `?tab=Mutations`; spinner/skeleton while loading |
| MUT-0-2 | 🟡 | B | Unchanged: the Results header as audited in 01-oncoprint RV-1…RV-3 |
| MUT-0-3 | 🔶 | C | The tab's Driver/VUS split and its DRIVER lines follow the page's driver settings (#251, and the sources now reach the badges and table), but it has no settings menu of its own; in-tab state lives in the document (invariant 9) |
| MUT-0-4 | 🟡 | BC | The query's OQL filters the tab (#251) and SVs are "A-B Fusion" rows (Q2 TMPRSS2 240 rows, as legacy) (#230); Show only drivers / somatic / profiled still not applied to this tab (tracked) |
| MUT-0-5 | 🟡 | B | The OQL status line with "Do not filter by OQL" (#251); no VUS-hidden, germline or CaseFilter banners |

### §1 Gene tabs

| ID | verdict | how | note |
|---|---|---|---|
| MUT-GT-1 | ✅ | B | One chip per query gene, query order (KRAS NRAS BRAF TP53 APC) |
| MUT-GT-2 | 🟡 | BC | Unchanged: symbol only ✅; nothing greys a gene with no mutations (`results-layout.ts`) |
| MUT-GT-3 | 🟡 | B | Unchanged: first gene default ✅; active gene in the document, not `mutations_gene`; not shared with the SV tab |
| MUT-GT-4 | 🔶 | C | Unchanged: switching gene clears sort, search, filters and codons (`results-layout.ts:328`) |

### §2 Layout and header column

| ID | verdict | how | note |
|---|---|---|---|
| MUT-LY-1 | 🟡 | B | Unchanged: plot left, meta column right, table below; no track selector, Y-max or [View 3D Structure] |
| MUT-HD-1 | 🟡 | B | Unchanged: disabled one-entry select (`TranscriptSummary.tsx:20`) (tracked) |
| MUT-HD-2 | ❌ | C | Unchanged: no other transcript (tracked) |
| MUT-HD-2a | ✅ | BC | Same ids and links; Ensembl on GRCh38 when every study is (`TranscriptSummary.tsx:26`) (#250) |
| MUT-HD-3 | 🟡 | B | "Somatic Mutation Frequency 36.7%" ✅ with a tip; "Germline Mutation Frequency" when a sample has a germline mutation, over every queried sample (legacy's default: no germline-consented list configured); no Somatic/Germline badges yet |

### §3 Lollipop plot

| ID | verdict | how | note |
|---|---|---|---|
| MUT-LP-1 | 🟡 | B | Y-Axis Max, [Legend 👁] [☁]; no track selector |
| MUT-LP-2 | ✅ | B | "Y-Axis Max:" slider 1…default and a number box above it; below 1 read as 1; kept in the view (`yMax`), as in-tab state is (invariant 9), not local |
| MUT-LP-3 | ✅ | C | No %/# toggle, no log scale |
| MUT-LP-4 | 🟡 | BC | Unchanged: SVG / PNG of the plot; no PDF; `KRAS_mutation_diagram.<ext>` |
| MUT-LP-5 | 🐞 ok | BC | Legend lists Splice as its own entry, as the stems draw it, not under Truncating as the portal's legend does (#250) |
| MUT-LP-6 | ✅ | B | Y "# patients", 0 to the maximum exactly, only the ends labelled (">= N" when capped), steps from [1,2,5,…] unlabelled; X "0" … "<len>aa", steps from [50,100,200,250,…], every other labelled (TP53 0, 100, 200, 300, 393aa) (`lib/lollipop.ts` lollipopXTicks/lollipopYTicks) |
| MUT-LP-7 | ✅ | B | Heights identical on 125/125 stems (KRAS, TP53) |
| MUT-LP-8 | ✅ | BC | Palette identical; stem colours identical on 125/125 stems; driver → count → priority rule (`lollipop.ts lollipopColor`) |
| MUT-LP-9 | ✅ | BC | "G12D/V/C and 3 more", "R175H/C"; tie rule copied (`labelledPosition`) |
| MUT-LP-10 | 🔶 | B | Unchanged: native SVG title "codon 11: 1 mutation / A11_G12dup 1" |
| MUT-LP-11 | 🟡 | B | Unchanged: click / shift-click select codons, table narrows; no hover → row highlight |
| MUT-LP-12 | 🟡 | BC | Unchanged: domain tip "Ras (PF00071): 5–164"; no description, PFAM / Mutation Aligner links |

### §4 Annotation tracks and 3D

| ID | verdict | how | note |
|---|---|---|---|
| MUT-TK-1 | ❌ | B | Unchanged (tracked) |
| MUT-TK-2 | ❌ | C | Unchanged (tracked) |
| MUT-TK-3 | ❌ | C | Unchanged (tracked) |
| MUT-TK-4 | ❌ | C | Unchanged (tracked) |
| MUT-3D-1 | ❌ | C | Unchanged (tracked) |
| MUT-3D-2 | ❌ | B | Unchanged (tracked) |
| MUT-3D-3 | ❌ | C | Unchanged (tracked) |

### §5 Driver / type badge filter

| ID | verdict | how | note |
|---|---|---|---|
| MUT-BF-1 | 🟡 | B | Grid as the portal's; KRAS 221/2 identical; TP53 still 325/7 vs 329/3 (the 4 hotspot rows: coadread not yet in the Genome Nexus store); no ⚙ (tracked) |
| MUT-BF-2 | ✅ | C | With no driver source on (or offered), one badge per type, no Driver/VUS header (`AlterationGrid.tsx` TypeBadges) (#282) |
| MUT-BF-3 | ✅ | B | Badge, row and column toggles; "only" (always visible, not on hover); everything selected removes the filter; Driver off → 2 of 223 |
| MUT-BF-4 | 🟡 | B | Unchanged: filter reaches lollipop and table; no tracks / 3D |

### §6 Mutation table — columns

| ID | verdict | how | note |
|---|---|---|---|
| MUT-COL-0 | 🟡 | BC | Unchanged: one row per call, nulls last; no per-column default direction |
| MUT-COL-1 | 🐞 ok | C | Multi-study adds cohort + study columns (`DataTable.tsx:448`), so the study is shown (raw id, not a name link) |
| MUT-COL-2 | ✅ | C | Gene, hidden by default; a fusion row's is its site 1 gene (`mutation-table.ts:23`) (#245) |
| MUT-COL-3 | ✅ | B | Sample link → `/portal/patient?study=&sample=`, new tab |
| MUT-COL-4 | ✅ | C | Cancer Type, hidden by default (#245) |
| MUT-COL-5 | 🟡 | B | Unchanged: shown always (legacy only when >1 distinct value) |
| MUT-COL-6 | 🟡 | B | Unchanged: plain text; no bold italic, Germline tag, reVUE icon |
| MUT-COL-7 | 🔶 | B | Unchanged: one text badge "Oncogenic · Level 1" |
| MUT-COL-8 | ❌ | C | Unchanged: no custom driver column (tracked) |
| MUT-COL-9 | ❌ | C | Unchanged (tracked) |
| MUT-COL-10 | 🟡 | BC | Functional Impact column, hidden, unsorted, as legacy (#245); blank on Q1 (coadread not yet in the Genome Nexus store) |
| MUT-COL-11 | ✅ | B | The portal's labels in its colours (Missense, IF ins, FS del, Splice, Fusion), stored text as tooltip (#245) |
| MUT-COL-12 | 🟡 | C | Upper-cased, header tooltip (#245); still uncoloured |
| MUT-COL-13 | ❌ | C | Unchanged: no ASCN columns |
| MUT-COL-14 | ❌ | C | Unchanged |
| MUT-COL-15 | ❌ | C | Unchanged |
| MUT-COL-16 | ❌ | C | Unchanged |
| MUT-COL-17 | ❌ | C | Unchanged |
| MUT-COL-18 | 🟡 | B | Copy # column, values as legacy (Q1 G12C: ShallowDel, Gain, Diploid) (#245); shown by default, as legacy when the query holds the discrete CNA profile (ours shows it whatever the query holds) |
| MUT-COL-19 | 🟡 | B | Unchanged: "MS" raw; no S / G badges |
| MUT-COL-20 | ✅ | C | VS, hidden (#245) |
| MUT-COL-21 | ✅ | C | Center, hidden (#245) |
| MUT-COL-22 | 🟡 | C | Unchanged: Chromosome sorts as text (`mutation-table.ts:54`, no order) |
| MUT-COL-23 | ✅ | C | Start / End numeric |
| MUT-COL-24 | ✅ | C | Ref / Var |
| MUT-COL-25 | ✅ | C | HGVSg from the mutation's coordinates ("12:g.25398283_25398284insCCAGCT") (#245) |
| MUT-COL-26 | 🟡 | C | HGVSc column (#245); blank on Q1 (not in the Genome Nexus store) |
| MUT-COL-27 | 🟡 | BC | Values identical, written as the portal (4 decimals below 0.01, else 2; none for 0); shown by default, as legacy |
| MUT-COL-28 | ✅ | C | Allele Freq (N), hidden (#245) |
| MUT-COL-29 | ✅ | C | Normal read counts added (#245); a count of 0 or less blank, as the portal |
| MUT-COL-30 | ✅ | BC | Default visible, identical 555/555 |
| MUT-COL-31 | 🟡 | C | Exon column (#245); blank on Q1 (not in the Genome Nexus store) |
| MUT-COL-32 | 🟡 | C | gnomAD column (#245); blank on Q1 |
| MUT-COL-33 | 🟡 | C | ClinVar column (#245); blank on Q1 |
| MUT-COL-34 | 🟡 | C | dbSNP column (#245); blank on Q1 |
| MUT-COL-35 | 🟡 | C | SIGNAL column (#245); blank on Q1 |
| MUT-COL-36 | ❌ | C | Unchanged: no clinical attribute columns beyond Cancer Type |
| MUT-COL-37 | ❌ | C | Unchanged: no namespace columns |
| MUT-COL-38 | ✅ | B | The portal's 8 by default: Sample ID, Cancer Type Detailed, Protein Change, Annotation, Mutation Type, Copy #, Allele Freq (T), # Mut in Sample |
| MUT-COL-T1 | ✅ | B | Label mapping and colours (`lib/mutation-type.ts`) (#245) |
| MUT-COL-T2 | ❌ | C | Unchanged: no Variant Type colours |
| MUT-COL-40 | N/A | C | Patient View column, not on the Results tab (audit in 40/41) |
| MUT-COL-41 | N/A | C | Same |
| MUT-COL-42 | N/A | C | Same |

### §7 Annotation and variant-annotation columns

| ID | verdict | how | note |
|---|---|---|---|
| MUT-AN-1 | ❌ | B | Unchanged: header "Annotation (OncoKB)", no icon row or cards |
| MUT-AN-2 | 🔶 | B | Unchanged: one text badge |
| MUT-AN-3 | 🔶 | BC | Oncogenicity identical; the caption says the level is "its highest sensitivity level for the gene": Q1 KRAS G12D "Level 1", legacy level_3b for colorectal (tumour-type calls #202 on synced studies only) |
| MUT-AN-4 | ❌ | C | Hotspots count as drivers (#211) but there is no hotspot icon (tracked) |
| MUT-AN-5 | ❌ | C | Unchanged (tracked: CIViC); no reVUE |
| MUT-AN-6 | 🔶 | B | Unchanged: CSV "Oncogenic · Level 1" |
| MUT-VA-1 | ? | C | ClinVar column exists (#245); Q1 not in the Genome Nexus store, so its cell could not be compared |
| MUT-VA-2 | ? | C | As VA-1 |
| MUT-VA-3 | ? | C | gnomAD column exists (#245); not comparable on Q1 |
| MUT-VA-4 | ? | C | SIGNAL column exists (#245); not comparable on Q1 |
| MUT-VA-5 | ? | C | Functional Impact column exists (#245); not comparable on Q1 |
| MUT-VA-6 | N/A | C | No Genome Nexus variant columns to depend on it |

### §8 Table controls and filter model

| ID | verdict | how | note |
|---|---|---|---|
| MUT-TB-1 | 🟡 | B | "223 KRAS mutations", "59 of 223 KRAS mutations", with the ": includes N duplicate mutations in patients with multiple samples" suffix when N > 0; no "(page x of y)" |
| MUT-TB-2 | 🟡 | B | Unchanged: search, columns, download CSV; no Copy |
| MUT-TB-3 | ✅ | B | Search "G12D" → table 59 of 223, the lollipop and badges 59 too (the hotspots view's `table`, `linkMutations`) |
| MUT-TB-4 | 🔶 | B | Unchanged: numbered pages + per page |
| MUT-TB-5 | 🟡 | B | Unchanged: one list "Columns (6 of 35)"; no Clinical tab, no Freq |
| MUT-TB-6 | 🟡 | BC | Unchanged |
| MUT-TB-7 | ❌ | B | Unchanged: no annotation filter |
| MUT-TB-8 | 🔶 | BC | Unchanged: CSV `cohort-lab_<study>_KRAS_mutations.csv`, every column, rows kept by filters |
| MUT-TB-9 | 🔶 | B | Unchanged: "drivers first, then by codon": first row A11_G12dup; legacy G12C |
| MUT-FM-1 | 🟡 | B | Search and header filters now reach the lollipop and badges; no mutation-status filter (FM-2) or tracks |
| MUT-FM-2 | ❌ | C | Unchanged: no mutation-status filter |
| MUT-FM-3 | ✅ | B | A stem selection narrows only the table; badge counts ignore the badge filter; Somatic Mutation Frequency ignores every in-tab filter |
| MUT-FM-4 | 🔶 | C | Unchanged |
| MUT-FM-5 | 🟡 | B | The filtered table's count says "(n samples / m patients)", as the portal's reset panel; in the table's title, not a panel on the lollipop; no Study View link (#307) |

### §9 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| MUT-MD-1 | ✅ | B | A gene with no mutations keeps its plot, drawn empty with "No <GENE> mutations in this cohort", zero badges, no frequency (#250) |
| MUT-MD-2 | ✅ | C | As BF-2; the legend has one line per type; stems take the type's main colour |
| MUT-MD-3 | ❌ | C | Unchanged: Show only drivers not applied to the tab (tracked) |
| MUT-MD-4 | ❌ | C | Unchanged: germline not filtered on the tab (tracked) |
| MUT-MD-5 | 🟡 | C | Unchanged |
| MUT-MD-6 | ✅ | C | Denominators and counts summed over studies (`buildLollipopGene`); study columns shown; Cancer Type Detailed shown |
| MUT-MD-7 | ❌ | C | Unchanged (tracked: transcript) |
| MUT-MD-8 | 🔶 | C | Unchanged |
| MUT-MD-9 | 🐞 ok | C | Draws without domains |
| MUT-MD-10 | ❌ | C | Unchanged (tracked) |
| MUT-MD-11 | ✅ | B | Fusions as "A-B Fusion" rows: Q2 TMPRSS2 240 rows, 41.5 %, Fusion badge 236; ERG 220, 2.8 % (#230). Driver split in STM-4 |
| MUT-MD-12 | ✅ | C | The query's mutation OQL filters the lollipop and table; "Do not filter by OQL" turns it off |
| MUT-MD-13 | ❌ | C | Unchanged (tracked) |
| MUT-MD-14 | N/A | C | No such deployment switch and no GN-based columns |
| MUT-MD-15 | N/A | C | Pinned licensed OncoKB store with levels (invariant 2) |

§10 Persistence (no IDs): the gene, grid selection, codon selection, search, filters, sort and visible columns are in the document (`?changes=`), which legacy does not persist (invariant 9). Page and page size stay in the browser.

### §11 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| MUT-STM-1 | 🟡 | BC | KRAS 36.7 %, TP53 52.9 %, TMPRSS2 41.5 % (#230), ERG 2.8 % as legacy; germline test /germline/i (#250); format still `fmtShare` |
| MUT-STM-2 | ✅ | B | Distinct patient + change per codon; 125/125 stems identical |
| MUT-STM-3 | 🐞 ok | BC | No mislabelled "profiled" denominator; but no denominator at all |
| MUT-STM-4 | 🟡 | B | Totals as legacy; driver split differs where the stores are not loaded: TP53 325/7 vs 329/3 (hotspots), TMPRSS2 Fusion 0/236 vs 207/29 (no OncoKB pair calls in the pinned v7.5 store; #230 matched at v7.7); tally follows the table's search and filters |
| MUT-STM-5 | 🟡 | BC | 4 decimals below 0.01, else 2 (`portalVaf`, and the same in search and CSV); a negative count gives none; 0 shown blank where the portal writes "NA" on screen |
| MUT-STM-6 | 🟡 | BC | Raw counts; 0 or less blank; no multi-sample "sampleId: value" form |
| MUT-STM-7 | ✅ | BC | `MUTATION_COUNT`, identical 555/555 |
| MUT-STM-8 | N/A | C | Cohort column not on the Results tab |
| MUT-STM-9 | 🟡 | C | Unchanged |
| MUT-STM-10 | 🔶 | C | Unchanged: annotation sort `order: "drv"` (`mutation-table.ts:101`) |
| MUT-STM-11 | ✅ | C | Copy # is the sample's discrete call for the gene; Q1 KRAS G12C rows ShallowDel / Gain / Diploid as legacy (#245) |
| MUT-STM-12 | ❌ | C | Unchanged: no ASCN |
| MUT-STM-13 | ? | C | gnomAD and SIGNAL columns exist (#245); blank on Q1, not comparable |
| MUT-STM-14 | ✅ | B | Grouped by patient + protein change (one gene per table), Σ(group − 1) over every row, not the search (`mutationRowSource` duplicateKey); keyed within a study, where legacy keys on the patient id alone (two studies sharing a patient id count no duplicate here) |
| MUT-STM-15 | ❌ | B | Unchanged: no Freq in the Columns menu |
| MUT-STM-16 | ✅ | B | Distinct samples and patients of the rows the table keeps, per study, summed (`mutationRowSource` units) (#307) |
| MUT-STM-17 | ✅ | B | Default max(5, tallest), exact (TP53 coadread: 0 / 17); a set Y-Axis Max is the exact top, ">= N" on it when a stem is capped |

---

## 5. cBioLab bugs (broken on its own terms)

All four found on 2026-11-11 are fixed (#250):
- ~~**Empty gene has no empty state.**~~ Fixed: the plot is drawn empty with "No <GENE> mutations in this cohort".
- ~~**Germline test is case-sensitive.**~~ Fixed: `/germline/i`, as the portal's.
- ~~**Ensembl link always GRCh37.**~~ Fixed: GRCh38 when every study is.
- ~~**Legend contradicts the plot.**~~ Fixed rather than copied: Splice is its own legend entry (LP-5 now 🐞 ok).

No new bug in the re-score.
