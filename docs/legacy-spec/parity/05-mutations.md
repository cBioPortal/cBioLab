# Parity audit — Results › Mutations (spec `05-mutations.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day)
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
| ✅ match | 14 |
| 🟡 partial | 34 |
| 🔶 different | 22 |
| ❌ missing | 58 |
| 🐞 ok | 3 |
| 🐞 copied | 1 |
| N/A | 7 |
| ? | 0 |
| **Total IDs** | **139** |

**Overall: 17.3 %** (✅ 14 + 🐞ok 3 + N/A 7 = 24 of 139). Counting 🟡 as half: 29.5 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | 🐞cp | N/A | One line |
|---|---|---|---|---|---|---|---|---|---|
| §0 Wiring, banners (0) | 5 | 1 | 1 | 2 | 1 | 0 | 0 | 0 | Tab present; no OQL/VUS/germline banners; SVs not added as fusion mutations |
| §1 Gene tabs (GT) | 4 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | Chips in query order; not greyed; gene in the document; switching resets the table |
| §2 Layout, header (LY, HD) | 5 | 0 | 4 | 0 | 1 | 0 | 0 | 0 | Same meta column; transcript fixed to canonical; no germline rate |
| §3 Lollipop (LP) | 12 | 4 | 4 | 2 | 1 | 0 | 1 | 0 | Stems, heights, colours, labels identical; no Y-max slider; axis and tooltip worded differently |
| §4 Tracks, 3D (TK, 3D) | 7 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | None (tracked) |
| §5 Badge filter (BF) | 4 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | Grid and clicks match; hotspots not drivers; no ⚙ |
| §6 Table columns (COL) | 44 | 4 | 8 | 3 | 25 | 1 | 0 | 3 | 18 columns of ~92; values identical where present; Mutation Type raw; no Copy # / ASCN / clinical / GN columns |
| §7 Annotation (AN, VA) | 12 | 0 | 0 | 3 | 8 | 0 | 0 | 1 | OncoKB text badge only; level not tumour-type-specific; no hotspot/CIViC/variant columns |
| §8 Table controls, filters (TB, FM) | 14 | 0 | 7 | 5 | 2 | 0 | 0 | 0 | Search/filters/columns/download exist in own shapes; search does not reach the lollipop; numbered pager; CSV |
| §9 Modes (MD) | 15 | 1 | 1 | 3 | 7 | 1 | 0 | 2 | No fusions, OQL, drivers-only, germline, profiled; empty gene shows no empty state |
| §11 Statistics (STM) | 17 | 2 | 5 | 2 | 6 | 1 | 0 | 1 | Frequency, stems, badges, VAF, # Mut identical on Q1; fusions and hotspot drivers differ; dup/reset counts absent |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Fusions missing from the Mutations tab**: SVs are not added as "A-B Fusion" mutations. Q2 TMPRSS2: 4 rows vs 240, frequency 0.8 % vs 41.5 %, Fusion badges 0/0 vs 207/29; ERG shows nothing (legacy 220 fusions) | MUT-0-4, MD-11, STM-1, STM-4 | not tracked |
| 2 | **Table defaults**: 6 default columns (no Copy #, no Allele Freq (T)); Mutation Type raw `Missense_Mutation`, uncoloured; default sort "drivers, then codon" (KRAS first row A11_G12dup) vs Annotation ↓ (G12C first) | COL-38, COL-11, COL-T1, TB-9, STM-10 | not tracked |
| 3 | **Annotation column** is one text badge "Oncogenic · Level 1": no icons/cards/header; level is the highest across tumour types (KRAS 206/223 rows differ: G12D "Level 1" vs legacy `level_3b`); no hotspot/CIViC/reVUE | COL-7, AN-1…AN-6 | partly (hotspots, CIViC under Mutation annotation breadth) |
| 4 | **Cancer Hotspots not counted as drivers**: TP53 Driver/VUS 325/7 vs 329/3 (R175C ×3, T125M) | BF-1, STM-4 | (tracked) "Cancer Hotspots as putative drivers" |
| 5 | **Table search and column filters do not reach the lollipop or badges** (search "G12D": table 59 rows, lollipop still 14 stems / 223); the link is grid + codon selection only | TB-3, FM-1, FM-3, STM-4 | not tracked |
| 6 | **OQL not applied** to lollipop/table; no OQL banner or toggle | MUT-0-4, 0-5, MD-12 | (tracked) "gene tabs still draw every alteration" |
| 7 | **No Y-Axis Max slider**; y axis titled "# KRAS Mutations" (legacy "# patients"), ticks niced to 150 (legacy top tick 142, "≥" when capped) | LP-2, LP-6, STM-17 | not tracked (Comparison's sliders are) |
| 8 | **Lollipop tooltip** is the native SVG title "codon 12: 142 mutations / G12D 58…", not "142 mutated of 594 profiled patients / AA Change: G12D/V/C/A/S/R"; no hover → table highlight | LP-10, LP-11 | not tracked |
| 9 | **Missing columns**: Gene, Cancer Type, Copy #, ASCN (5), VS, Center, Allele Freq (N), normal reads, Exon, clinical attributes, namespace | COL-2…COL-37 | partly (HGVS, gnomAD, ClinVar, dbSNP, SIGNAL, Functional Impact, custom driver tracked; Copy #, ASCN, clinical not) |
| 10 | **Annotation tracks and 3D structure** absent | TK-1…TK-4, 3D-1…3D-3, MD-10 | (tracked) annotation breadth; Comparison "lollipop's tracks" |
| 11 | **Table chrome**: numbered pager + per-page select (no Show more); Columns menu single list (no Clinical tab, no Freq); CSV of rows kept by filters (legacy TSV of all rows); no Copy; no annotation filter | TB-2, TB-4, TB-5, TB-7, TB-8 | partly (table copy/download listed for Comparison) |
| 12 | **No global settings / banners**: no Show only drivers / somatic / profiled, no germline rate or badges | 0-5, HD-3, FM-2, MD-3, MD-4, MD-13 | (tracked) Driver-annotation settings, germline; Show only profiled not tracked |
| 13 | **Multi-sample counts**: no "includes N duplicate mutations" suffix, no "n samples / m patients" in banners | TB-1, MD-5, STM-14, STM-16, FM-5 | not tracked |
| 14 | **Zero-mutation gene**: chip not greyed; lollipop card shows only its method caption (no "no mutations", no 0 % or 0 badges) | GT-2, MD-1 | not tracked (bug, see §5) |
| 15 | **Transcript fixed to canonical** (disabled one-entry select) | HD-1, HD-2, MD-7 | (tracked) transcript drop-down |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 KRAS Somatic Mutation Frequency | STM-1 | 36.7 % | 218 / 594 samples → 36.7 % | ✅ |
| Q1 TP53 Somatic Mutation Frequency | STM-1 | 52.9 % | 314 / 594 → 52.9 % | ✅ |
| Q2 TMPRSS2 Somatic Mutation Frequency | STM-1 | 41.5 % (fusions included) | 4 / 494 → 0.8 % | 🔶 SVs not in the tab |
| Q1 KRAS stems | STM-2, LP-7, LP-8 | 14 stems, Σ 223, tallest 142 at codon 12 | 14 stems, Σ 223, 142 at 12; 14/14 positions with equal height and colour | ✅ |
| Q1 TP53 stems | STM-2, LP-7, LP-8 | 111 stems, Σ 332, tallest 35 at R175 | 111/111 positions with equal height and colour | ✅ |
| Q2 TMPRSS2 stems | STM-2 | 4 (E215K, N341del, K377Qfs*6, …) | 4 | ✅ |
| Q1 labels | LP-9 | "G12D/V/C and 3 more", "R175H/C" | same | ✅ |
| Q1 default y-max | STM-17 | 142 / 35 (top tick) | domain 142 / 35; KRAS axis ticks 0-50-100-150 | 🟡 |
| Q1 tooltip denominator | STM-3 | "of 594 profiled patients" (= queried, legacy bug) | no denominator in the tip | 🐞 ok |
| Q1 KRAS badges | STM-4 | Driver 221 / VUS 2; Missense 220/1, Trunc 0/1, Inframe 1/0, Splice 0/0, Fusion 0/0 | identical | ✅ |
| Q1 TP53 badges | STM-4 | 329 / 3; Missense 233/2, Trunc 75/0, Inframe 4/1, Splice 17/0 | 325 / 7; Missense 229/6, Trunc 75/0, Inframe 4/1, Splice 17/0 | 🔶 4 hotspot rows (R175C ×3 Likely Neutral, T125M Inconclusive) are legacy drivers |
| Q2 TMPRSS2 badges | STM-4 | 207 / 33; Fusion 207/29, Missense 0/1, Trunc 0/2, Inframe 0/1 | 0 / 4; Fusion 0/0, rest equal | 🔶 |
| KRAS VUS-only table (Driver badge off) | BF-3 | 2 VUS rows | "2 of 223" | ✅ |
| Table rows KRAS / TP53 | TB-1 | 223 / 332 | 223 / 332; every row matched (sample + change + start) | ✅ |
| Table rows TMPRSS2 (Q2) | MD-11 | 240 | 4 | 🔶 |
| Mutation Type, Variant Type, Cancer Type Detailed, Chr, End, Ref, Var, MS | COL-* | 555 rows | 555/555 identical | ✅ |
| Allele Freq (T) | STM-5 | 555 rows | 555/555 equal within display rounding | ✅ values (display 🟡) |
| # Mut in Sample | STM-7 | 555 rows | 555/555 identical | ✅ |
| Variant / Ref Reads | STM-6 | blank for 0 | 1 row (TCGA-DY-A1DG-01 R282W Ref Reads) "0" | 🟡 |
| OncoKB oncogenicity | AN-3 | 555 rows | 555/555 identical | ✅ |
| OncoKB level | AN-3 | KRAS tumour-type-specific (G12D `level_3b`, …) | 206/223 KRAS rows differ ("Level 1"); TP53 0 differ | 🔶 |
| Codon 12 selected → table | LP-11 | (not read) | 142 rows | ? legacy not read |

Data version: mutation rows, VAFs, mutation counts and OncoKB oncogenicity are identical on Q1, so the warehouse and cbioportal.org hold the same data; the differences are rules (hotspot drivers, fusions, tumour-type levels). OncoKB: cBioLab v7.5 pinned; legacy live.

---

## 4. Scorecard

### §0 Tab wiring and banners

| ID | verdict | how | note |
|---|---|---|---|
| MUT-0-1 | ✅ | B | "Mutations" tab, always shown; `?tab=Mutations`; spinner/skeleton while loading |
| MUT-0-2 | 🟡 | B | Results header as audited in 01-oncoprint RV-1…RV-3 |
| MUT-0-3 | 🔶 | C | No driver settings to reset on; in-tab state (`hide`, `codons`, table query) lives in the document (invariant 9) |
| MUT-0-4 | 🔶 | BC | No OQL filter (tracked), no VUS/germline/profiled exclusion, **no SV pseudo-mutations** (Q2 TMPRSS2 4 vs 240) |
| MUT-0-5 | ❌ | B | No OQL / VUS-hidden / germline / CaseFilter banners; the caption says VUS and germline are included |

### §1 Gene tabs

| ID | verdict | how | note |
|---|---|---|---|
| MUT-GT-1 | ✅ | B | One chip per query gene, query order (KRAS NRAS BRAF TP53 APC) |
| MUT-GT-2 | 🟡 | B | Symbol only ✅; a gene with 0 mutations is not greyed (Q2 ERG) |
| MUT-GT-3 | 🟡 | B | First gene default ✅; active gene in the document (`?changes=`), not `mutations_gene`; not shared with the SV tab |
| MUT-GT-4 | 🔶 | C | Switching gene clears the table's sort/search/filters and the codon selection (`results-layout.ts:224`); legacy keeps a store per gene |

### §2 Layout and header column

| ID | verdict | how | note |
|---|---|---|---|
| MUT-LY-1 | 🟡 | B | Plot left, meta column right (transcript, ids, frequency, grid), table below in its own card; no track selector, Y-max or [View 3D Structure]; legend of classes drawn under the plot |
| MUT-HD-1 | 🟡 | B | Disabled one-entry select "NM_004985" (canonical only) (tracked) |
| MUT-HD-2 | ❌ | C | No other transcript (tracked) |
| MUT-HD-2a | 🟡 | BC | "NM_004985 \| ENST00000311936.3", "CCDS8702 \| RASK_HUMAN" with the same links ✅; Ensembl link always grch37 (`TranscriptSummary.tsx:25`) |
| MUT-HD-3 | 🟡 | B | "Somatic Mutation Frequency 36.7%" ✅; ⓘ replaced by tip "218 of 594 samples carry a somatic mutation in KRAS"; no germline rate or Somatic/Germline badges (tracked) |

### §3 Lollipop plot

| ID | verdict | how | note |
|---|---|---|---|
| MUT-LP-1 | 🟡 | B | [Legend 👁] [☁] ✅; no track selector (tracked), no Y-Axis Max, no reset panel in the bar (banners above the plot) |
| MUT-LP-2 | ❌ | B | No Y-Axis Max slider/box |
| MUT-LP-3 | ✅ | C | No %/# toggle, no log scale |
| MUT-LP-4 | 🟡 | BC | SVG / PNG of the plot as drawn; no PDF; file `KRAS_mutation_diagram.<ext>` (legacy `KRAS_lollipop`); no hide switch (tracked: data-governance) |
| MUT-LP-5 | 🐞 copied | BC | Text verbatim ✅, fusion single entry ✅; repeats "Splice site" under Truncating while splice stems are orange (`ColorLegend.tsx:8`); always split driver/VUS |
| MUT-LP-6 | 🔶 | B | "188aa" ✅, backbone `#BABDB6`, heads 2.8 / 5 ✅; x ticks every 20 (legacy 0, 100, 188aa); y title "# KRAS Mutations" (legacy "# patients"); y ticks niced past the max (0-50-100-150), no "≥" |
| MUT-LP-7 | ✅ | B | Heights identical on 125/125 stems (KRAS, TP53) |
| MUT-LP-8 | ✅ | BC | Palette identical; stem colours identical on 125/125 stems; driver → count → priority rule (`lollipop.ts lollipopColor`) |
| MUT-LP-9 | ✅ | BC | "G12D/V/C and 3 more", "R175H/C"; tie rule copied (`labelledPosition`) |
| MUT-LP-10 | 🔶 | B | Native SVG title "codon 12: 142 mutations / G12D 58 / G12V 49 …"; no "N mutated of M profiled patients", no "AA Change:" line |
| MUT-LP-11 | 🟡 | B | Click selects (table 142 of 223), shift-click adds, click elsewhere clears, no drag ✅, table only narrows ✅; no hover → row highlight; banner "Selected: KRAS codon 12 (142 mutations drawn there) [clear selection]" |
| MUT-LP-12 | 🟡 | BC | Same colour cycle (Ras green) ✅; name cut with "…"; tip "name (accession): start–end", no description, no PFAM / Mutation Aligner links; no sequence-bar UniProt link |

### §4 Annotation tracks and 3D

| ID | verdict | how | note |
|---|---|---|---|
| MUT-TK-1 | ❌ | B | No track selector (tracked) |
| MUT-TK-2 | ❌ | C | No hotspot/OncoKB/PTM/exon/topology tracks (tracked) |
| MUT-TK-3 | ❌ | C | (tracked) |
| MUT-TK-4 | ❌ | C | (tracked) |
| MUT-3D-1 | ❌ | C | No PDB chain panel (tracked) |
| MUT-3D-2 | ❌ | B | No [View 3D Structure] (tracked) |
| MUT-3D-3 | ❌ | C | No 3D viewer (tracked) |

### §5 Driver / type badge filter

| ID | verdict | how | note |
|---|---|---|---|
| MUT-BF-1 | 🟡 | B | Driver `#000` / VUS `#696969` totals, class rows, colours, "Other" hidden at 0 ✅; KRAS counts identical, TP53 differs by 4 hotspot rows (tracked); no ⚙ button (tracked) |
| MUT-BF-2 | 🔶 | C | No pin → every mutation a driver, grid still shows Driver/VUS columns (`federation.ts:530`) |
| MUT-BF-3 | ✅ | B | Badge, row and column toggles; "only" (always visible, not on hover); everything selected removes the filter; Driver off → 2 of 223 |
| MUT-BF-4 | 🟡 | B | Filter reaches lollipop and table (Alteration column) ✅; no tracks/3D; counts see STM-4 |

### §6 Mutation table — columns

| ID | verdict | how | note |
|---|---|---|---|
| MUT-COL-0 | 🟡 | BC | One row per call ✅, nulls last ✅; first click asc for text, desc for numbers (no per-column default); no server visibility config |
| MUT-COL-1 | 🐞 ok | C | Multi-study adds cohort + study columns (`DataTable.tsx:448`), so the study is shown (raw id, not a name link) |
| MUT-COL-2 | ❌ | C | No Gene column |
| MUT-COL-3 | ✅ | B | Sample link → `/portal/patient?study=&sample=`, new tab |
| MUT-COL-4 | ❌ | C | No Cancer Type |
| MUT-COL-5 | 🟡 | B | Shown by default always (legacy only when >1 distinct value); no NA text |
| MUT-COL-6 | 🟡 | B | Plain text; no bold italic, 40-char cut, Germline tag, reVUE icon; sort by codon (STM-9) |
| MUT-COL-7 | 🔶 | B | One text badge (AN-2/3), sort by driver bit only (STM-10) |
| MUT-COL-8 | ❌ | C | (tracked: custom driver annotations) |
| MUT-COL-9 | ❌ | C | (tracked) |
| MUT-COL-10 | ❌ | C | (tracked: functional impact) |
| MUT-COL-11 | 🔶 | B | Raw `Missense_Mutation`, uncoloured, filter on raw values; values identical 555/555; extra "Alteration" column ("Missense · Driver") |
| MUT-COL-12 | 🟡 | C | Raw, hidden ✅; uncoloured, no tooltip |
| MUT-COL-13 | ❌ | C | No ASCN columns |
| MUT-COL-14 | ❌ | C | |
| MUT-COL-15 | ❌ | C | |
| MUT-COL-16 | ❌ | C | |
| MUT-COL-17 | ❌ | C | |
| MUT-COL-18 | ❌ | B | No Copy # (legacy default-visible) |
| MUT-COL-19 | 🟡 | B | "MS" raw (`.` on Q1); no S / G badges |
| MUT-COL-20 | ❌ | C | No VS |
| MUT-COL-21 | ❌ | C | No Center |
| MUT-COL-22 | 🟡 | C | Chromosome sorts as text ("10" < "2"); no X = 23 |
| MUT-COL-23 | ✅ | C | Start / End numeric |
| MUT-COL-24 | ✅ | C | Ref / Var |
| MUT-COL-25 | ❌ | C | (tracked: HGVSg/c) |
| MUT-COL-26 | ❌ | C | (tracked) |
| MUT-COL-27 | 🟡 | BC | Values identical; hidden by default; always 2 decimals |
| MUT-COL-28 | ❌ | C | No Allele Freq (N) |
| MUT-COL-29 | 🟡 | C | Variant / Ref Reads only, no normal counts; 0 shown as "0" |
| MUT-COL-30 | ✅ | BC | Default visible, identical 555/555 |
| MUT-COL-31 | ❌ | C | No Exon |
| MUT-COL-32 | ❌ | C | (tracked: gnomAD) |
| MUT-COL-33 | ❌ | C | (tracked: ClinVar) |
| MUT-COL-34 | ❌ | C | (tracked: dbSNP) |
| MUT-COL-35 | ❌ | C | (tracked: SIGNAL) |
| MUT-COL-36 | ❌ | C | No clinical attribute columns |
| MUT-COL-37 | ❌ | C | No namespace columns |
| MUT-COL-38 | 🔶 | B | "columns (6/18)": Sample ID, Cancer Type Detailed, Protein Change, Annotation, Mutation Type, # Mut in Sample — no Copy #, no Allele Freq (T) (`mutation-table.ts:38`); legacy 8 / 92 |
| MUT-COL-T1 | ❌ | B | No label mapping or colours |
| MUT-COL-T2 | ❌ | C | No Variant Type colours |
| MUT-COL-40 | N/A | C | Patient View column, not on the Results tab (audit in 40/41) |
| MUT-COL-41 | N/A | C | Same |
| MUT-COL-42 | N/A | C | Same |

### §7 Annotation and variant-annotation columns

| ID | verdict | how | note |
|---|---|---|---|
| MUT-AN-1 | ❌ | B | Header "Annotation (OncoKB)", no icon row, cards or Compact/Expanded toggle |
| MUT-AN-2 | 🔶 | B | One text badge (orange when oncogenic), no icons |
| MUT-AN-3 | 🔶 | BC | Oncogenicity and level for the sample's tumour type (`annotation.oncokb_tumor_type`, #PRNUM): identical to the portal's query for every mutation of acc_tcga_pan_can_atlas_2018 (7,568) and paad_iatlas_prince_2022 (7,255), all four highest levels; resistance, Dx, Px stored but not shown; no card |
| MUT-AN-4 | ❌ | C | (tracked: hotspots) |
| MUT-AN-5 | ❌ | C | (tracked: CIViC); no reVUE |
| MUT-AN-6 | 🔶 | B | CSV "Oncogenic · Level 1" vs "OncoKB: Oncogenic, level_1, resistance NA;CIViC: …;CancerHotspot: yes;3DHotspot: no" |
| MUT-VA-1 | ❌ | C | (tracked) |
| MUT-VA-2 | ❌ | C | (tracked) |
| MUT-VA-3 | ❌ | C | (tracked) |
| MUT-VA-4 | ❌ | C | (tracked) |
| MUT-VA-5 | ❌ | C | (tracked) |
| MUT-VA-6 | N/A | C | No Genome Nexus variant columns to depend on it |

### §8 Table controls and filter model

| ID | verdict | how | note |
|---|---|---|---|
| MUT-TB-1 | 🟡 | B | "223 KRAS mutations" / "142 of 223 KRAS mutations"; no page part, no duplicate suffix |
| MUT-TB-2 | 🟡 | B | Search, "columns (6/18)", "download CSV (223)"; no Copy |
| MUT-TB-3 | 🔶 | B | Shown columns only ✅, case-insensitive ✅; applies on Enter/blur; **does not filter lollipop or badges** ("G12D": table 59, lollipop 14 stems) |
| MUT-TB-4 | 🔶 | B | Numbered pages + "per page 25/50/100/250", "Showing 1–25 of 223 KRAS mutations"; no Show more |
| MUT-TB-5 | 🟡 | B | One list "Columns (6 of 18)" with find, all / default; no Mutations/Clinical tabs, no Freq, no Reset |
| MUT-TB-6 | 🟡 | BC | Filter on every column: 7 conditions (no "does not begin/end with"), value list with counts, all / none; numeric from/to boxes (no slider, no Hide empty); no Compare |
| MUT-TB-7 | ❌ | B | No annotation filter ([B-new]) |
| MUT-TB-8 | 🔶 | BC | CSV (not TSV), `cohort-lab_<study>_KRAS_mutations.csv`, all 18 columns ✅; rows = those kept by search/filters (legacy all rows) |
| MUT-TB-9 | 🔶 | B | "drivers first, then by codon" (`mutation-table.ts:132`): KRAS first row A11_G12dup; legacy Annotation ↓: G12C |
| MUT-FM-1 | 🟡 | B | Table ANDs search + filters ✅; lollipop follows only the grid and codon selection |
| MUT-FM-2 | ❌ | C | No mutation-status filter (tracked: germline) |
| MUT-FM-3 | 🟡 | B | Selection narrows the table only ✅; grid counts never change (legacy follow search and other filters) |
| MUT-FM-4 | 🔶 | C | State is document fields `hide`, `codons`, `filters.alteration` / `filters.proteinPos` |
| MUT-FM-5 | 🟡 | B | "Showing 2 of 223 mutations [remove filter]" and "Selected: … [clear selection]"; no samples/patients link to Study View |

### §9 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| MUT-MD-1 | 🔶 | B | Q2 ERG: table "0 ERG mutations" ✅; lollipop card shows only its caption — no empty plot, 0 %, or 0 badges; chip not greyed |
| MUT-MD-2 | 🔶 | C | As BF-2 |
| MUT-MD-3 | ❌ | C | No Show only drivers / banner (tracked: driver-annotation settings) |
| MUT-MD-4 | ❌ | C | (tracked: germline) |
| MUT-MD-5 | 🟡 | C | Patient + change de-dup ✅ (`federation.ts:546`); no duplicate suffix, no "n samples / m patients" |
| MUT-MD-6 | ✅ | C | Denominators and counts summed over studies (`buildLollipopGene`); study columns shown; Cancer Type Detailed shown |
| MUT-MD-7 | ❌ | C | (tracked: transcript) |
| MUT-MD-8 | 🔶 | C | Falls back to the highest codon seen, caption "Genome Nexus could not be reached…"; no "No Transcript found" |
| MUT-MD-9 | 🐞 ok | C | Draws without domains |
| MUT-MD-10 | ❌ | C | No 3D at all (tracked) |
| MUT-MD-11 | ❌ | B | No fusion mutations (Q2 TMPRSS2 4 vs 240 rows; Fusion badges 0 vs 207/29) |
| MUT-MD-12 | ❌ | C | (tracked: OQL in gene tabs) |
| MUT-MD-13 | ❌ | C | No Show only profiled |
| MUT-MD-14 | N/A | C | No such deployment switch and no GN-based columns |
| MUT-MD-15 | N/A | C | Pinned licensed OncoKB store with levels (invariant 2) |

§10 Persistence (no IDs): the gene, grid selection, codon selection, search, filters, sort and visible columns are in the document (`?changes=`), which legacy does not persist (invariant 9). Page and page size stay in the browser.

### §11 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| MUT-STM-1 | 🟡 | BC | KRAS 36.7 %, TP53 52.9 % identical; Q2 TMPRSS2 0.8 % vs 41.5 % (fusions); germline test is `status != 'GERMLINE'` (case-sensitive, `federation.ts:566`); "<0.1%" / "100%" vs "< 0.1" / "100.0%" |
| MUT-STM-2 | ✅ | B | Distinct patient + change per codon; 125/125 stems identical |
| MUT-STM-3 | 🐞 ok | BC | No mislabelled "profiled" denominator; but no denominator at all |
| MUT-STM-4 | 🔶 | B | KRAS ✅; TP53 4 hotspot rows VUS (tracked); TMPRSS2 Fusion 0/0 vs 207/29; tally ignores search/filters |
| MUT-STM-5 | 🟡 | BC | Values identical; display `toFixed(2)` always (`mutations.tsx:18`), no 4 decimals below 0.01 |
| MUT-STM-6 | 🟡 | BC | Raw ✅; 0 shown as "0" (legacy blank) |
| MUT-STM-7 | ✅ | BC | `MUTATION_COUNT`, identical 555/555 |
| MUT-STM-8 | N/A | C | Cohort column not on the Results tab |
| MUT-STM-9 | 🟡 | C | Protein change by stored codon, ties by sample (no letter fraction); chromosome text sort; no HGVSc |
| MUT-STM-10 | 🔶 | C | Annotation sort = driver bit (`order: "drv"`), not the OncoKB/CIViC/hotspot array |
| MUT-STM-11 | ❌ | C | No Copy # |
| MUT-STM-12 | ❌ | C | No ASCN |
| MUT-STM-13 | ❌ | C | (tracked: gnomAD/SIGNAL) |
| MUT-STM-14 | ❌ | B | Duplicate count not computed or shown |
| MUT-STM-15 | ❌ | B | No Freq in the Columns menu |
| MUT-STM-16 | ❌ | B | Banners count mutations only, no samples/patients |
| MUT-STM-17 | 🟡 | B | Domain max(5, tallest) ✅ (`lollipop-svg.ts:55`); axis niced to the next round tick |

---

## 5. cBioLab bugs (broken on its own terms)

- **Empty gene has no empty state.** A gene with 0 mutations (Q2 ERG) is dropped from the result (`hotspots/run.ts:28`), and `HotspotsBody.tsx:87` falls back to `v.note || "no mutations…"`; `note` is always set, so the card shows only the method caption. Breaks UI.md's "loading, empty and failed are three states".
- **Germline test is case-sensitive**: `uniqExactIf(sid, status != 'GERMLINE')` (`federation.ts:566`) counts a study's "Germline" calls as somatic.
- **Ensembl link always GRCh37** (`TranscriptSummary.tsx:25`), so a GRCh38 study links to the wrong assembly.
- **Legend contradicts the plot**: "Splice site" is listed under Truncating, but splice stems are drawn orange as Splice (copied legacy bug, LP-5).
