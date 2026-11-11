# Parity audit — Results › Mutual Exclusivity (spec `03-mutual-exclusivity.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day)
- **Code paths (cBioLab):** `app/portal/results-layout.ts:204,214` (tab → `cooccurrence` view on "Queried"), `app/portal/PortalTabs.tsx:171-181` (portal draws the kind's figure; no table), `lib/views/cooccurrence/{run,figure,kind,method,doc,types}.ts`, `lib/federation.ts:395-447` (`pairCountsSql`), `lib/stats.ts:12-26` (`fisherExact`), `:617-628` (`benjaminiHochberg`), `:642` (`cochranMantelHaenszel`), `:670-676` (`log2OddsRatio`), `app/lab/kinds/cooccurrence.tsx` (table card, `/lab` only)

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy (`/results/mutualExclusivity?…`) | cBioLab (`/portal/results?…&tab=Mutual+Exclusivity`) |
|---|---|---|
| Q1 reference | `cancer_study_list=msk_impact_2017&case_set_id=msk_impact_2017_all&profileFilter=mutations,structural_variants,cna&gene_list=TP53 KRAS PIK3CA EGFR` | `study=msk_impact_2017&genes=TP53%20KRAS%20PIK3CA%20EGFR` |
| Q2 OQL + merged | same, `gene_list=KRAS: MUT⏎TP53: MUT HOMDEL⏎[BRAF NRAS]` | `genes=KRAS%3A%20MUT%3B%20TP53%3A%20MUT%20HOMDEL%3B%20%5BBRAF%20NRAS%5D` (refused) and Q2b without brackets `…%3B%20BRAF%3B%20NRAS` |
| Q3 partial panel | same, `gene_list=ZFHX3 RAC1 AXIN2 TP53` | `study=msk_impact_2017&genes=ZFHX3%20RAC1%20AXIN2%20TP53` |
| Q4 multi-study | `cancer_study_list=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&case_set_id=all&profileFilter=mutations,structural_variants,gistic&gene_list=TP53 KRAS PIK3CA APC` | `studies=coadread_tcga_pan_can_atlas_2018,brca_tcga_pan_can_atlas_2018&genes=TP53%20KRAS%20PIK3CA%20APC` |
| Q5 TCGA | `cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS NRAS BRAF TP53 APC` | `study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%20NRAS%20BRAF%20TP53%20APC` |
| Q6 one gene | `…msk_impact_2017…&gene_list=KRAS` | `study=msk_impact_2017&genes=KRAS&tab=Mutual+Exclusivity` |

Legacy shows p/q only as "<0.001" / `toFixed(3)`, so exact legacy p/q were recomputed from legacy's own 2×2 counts with a line-for-line port of `getTwoTailedPValue` and `calculateQValues` (`cbioportal-frontend/src/shared/lib/calculation/`); every recomputed value rounds to the displayed one. cBioLab values from the `/api/analysis?oncoprint=spec` response the page receives. Scripts, JSON and screenshots: (local scratch, not committed) (`legmex.js`, `labmex.sh`, `compare.js`; `out/leg-mex.json`, `out/mex-compare.json`, `out/leg-mex-*.png`, `out/lab-mex-*.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 5 |
| 🟡 partial | 11 |
| 🔶 different | 11 |
| ❌ missing | 11 |
| 🐞 ok | 1 |
| 🐞 copied | 0 |
| N/A | 1 |
| ? | 0 |
| **Total IDs** | **40** |

**Overall: 17.5 %** (✅ 5 + 🐞ok 1 + N/A 1 = 7 of 40). Counting 🟡 as half: 31.3 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | One line |
|---|---|---|---|---|---|---|---|---|
| §0 Chrome & visibility | 4 | 1 | 3 | 0 | 0 | 0 | 0 | Tab and link ✅; hidden for <2 genes even when routed to; no OQL/filter banners |
| §1 Error states | 3 | 0 | 0 | 2 | 1 | 0 | 0 | Error states unreachable (tab hidden) or replaced by "not assessable" pairs |
| §2 Page content | 7 | 1 | 2 | 2 | 2 | 0 | 0 | A log₂ OR bar chart replaces the table; no checkboxes, no summary sentence |
| §3 Table | 7 | 1 | 1 | 1 | 4 | 0 | 0 | No table on the portal (only on `/lab`); Q1 reference numbers identical |
| §4 Modes | 10 | 1 | 2 | 1 | 4 | 1 | 1 | OQL and merged tracks not supported; profiled = mutation panel only; multi-study stratified |
| §6 Statistics (STM) | 9 | 1 | 3 | 5 | 0 | 0 | 0 | Counts, log₂ OR, Fisher p, BH q identical on single-study queries with identical denominators; multi-study uses CMH; Haldane on zero cells |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **No table on the portal tab** — only a horizontal log₂ OR bar chart (row text "−1.7 · q = 2.2e-20"); Neither / A Not B / B Not A / Both, p and Tendency only in the SVG hover title. The table card exists only on `/lab` (`app/lab/kinds/cooccurrence.tsx`) | UI-6, TB-1, TB-2, STM-9 | not tracked |
| 2 | **OQL ignored**: `KRAS: MUT` / `TP53: MUT HOMDEL` counted as whole genes (Q2b KRAS/TP53 5425/876/3714/930 vs legacy 5530/797/3772/846, log₂ OR 0.633 vs 0.638); labels are gene symbols | MD-3, STM-1, STM-3, 0.1 | (tracked) "the oncoprint and gene tabs still draw every alteration" |
| 3 | **Merged tracks `[BRAF NRAS]` refused** by the Results page ("bad gene entry '[BRAF'") | MD-4 | (tracked) OQL coverage: per-track OQL inside merged groups |
| 4 | **Multi-study test is CMH stratified by study**, not pooled Fisher: Q4 TP53/KRAS legacy p 2.1e-7, q 3.2e-7 (Co-occurrence, significant) vs cBioLab CMH p = q = 0.880 (not significant); PIK3CA/APC tendency flips (legacy −0.232 ME, cBioLab MH log₂ OR +0.543 Co-occurrence). Deliberate (`doc.ts:7`) | MD-8, STM-5..7 | not tracked |
| 5 | **No Mutual exclusivity / Co-occurrence / Significant only checkboxes** | UI-4, UI-5, STM-8 | not tracked |
| 6 | **Profiled = mutation panel only** (`federation.ts:427`), not "every selected profile": Q5 coadread 534–537 samples per pair vs legacy 532; Q4 +13–16 per pair; small p/q shifts (Q5 KRAS/TP53 p 0.655 vs 0.721) | STM-1, MD-8, TB-7 | not tracked |
| 7 | **No search, column picker, copy, `table.tsv` download** | TB-1, TB-4, TB-6 | not tracked (hide-download switch tracked under Data-governance) |
| 8 | **One gene**: tab hidden even when routed to (`?tab=Mutual+Exclusivity` lands on Oncoprint), no ER-1 message | 0.3, ER-1, MD-1 | not tracked |
| 9 | **Gene cap 12** (`COOCCUR_GENE_LIMIT`, `shared.ts:14`): a 13-gene query errors on this tab; legacy has no cap | — (0.3) | not tracked |
| 10 | **Driver / VUS / germline filters and Show-only-profiled** not applied; no AlterationFilterWarning / CaseFilterWarning | MD-6, MD-7, 0.1 | (tracked) Driver-annotation settings |
| 11 | **Zero-cell pairs**: Haldane +0.5 gives a finite log₂ OR (legacy ±∞ → "<-3"/">3"); tendency null when log₂ OR is 0 or ±∞ (legacy "Mutual exclusivity" for ≤ 0) | STM-5 | not tracked |
| 12 | **Display formatting**: log₂ OR via `fmtNum` ("−1.7", "0.04"), q in scientific notation; no "<0.001", no "<-3" / ">3" | STM-9 | not tracked |

---

## 3. Number check

Legacy p/q: recomputed from legacy counts with legacy's code (displayed value in brackets). cBioLab: raw API values. "=" means identical to ≥3 significant figures.

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 KRAS/EGFR counts N/AnB/BnA/Both | STM-4 | 8336 / 1754 / 803 / 52 | 8336 / 1754 / 803 / 52 | ✅ |
| Q1 KRAS/EGFR log₂ OR, p, q | STM-5..7 | −1.700, 3.75e-21, 2.25e-20 (<0.001) | −1.700, 3.75e-21, 2.25e-20 | ✅ |
| Q1 TP53/EGFR | STM-4..7 | 5939/4151/362/493; 0.962; p 1.50e-20; q 4.51e-20 | = | ✅ |
| Q1 TP53/KRAS | STM-4..7 | 5425/3714/876/930; 0.633; p 2.16e-17; q 4.33e-17 | = | ✅ |
| Q1 TP53/PIK3CA | STM-4..7 | 5517/4014/784/630; 0.143; p 0.0837; q 0.126 | = | ✅ |
| Q1 PIK3CA/EGFR | STM-4..7 | 8795/1295/736/119; 0.135; p 0.367; q 0.440 | = | ✅ |
| Q1 KRAS/PIK3CA | STM-4..7 | 7963/1568/1176/238; 0.040; p 0.730; q 0.730 | = | ✅ |
| Q1 Tendency (6 rows) | STM-5 | ME ×1, Co ×5 | same | ✅ |
| Q3 ZFHX3/AXIN2 (partial panel) | STM-1..7 | 7609/353/131/43; 2.823; p 1.51e-19; q 9.05e-19 | = | ✅ |
| Q3 ZFHX3/RAC1 | STM-1..7 | 7660/380/80/16; 2.011; p 1.35e-5; q 4.05e-5 | = | ✅ |
| Q3 ZFHX3/TP53 | STM-1..7 | 4522/191/3218/205; 0.593; p 7.08e-5; q 1.42e-4 | = | ✅ |
| Q3 RAC1/AXIN2 | STM-1..7 | 10597/121/220/7; 1.479; p 0.0170; q 0.0255 | = | ✅ |
| Q3 AXIN2/TP53 | STM-1..7 | 6187/114/4531/113; 0.437; p 0.0251; q 0.0301 | = | ✅ |
| Q3 RAC1/TP53 | STM-1..7 | 6237/64/4580/64; 0.446; p 0.0879; q 0.0879 | = | ✅ |
| Q5 TP53/APC | STM-1,4..7 | 90/49/129/264 (532); 1.910; p 7.68e-11; q 7.68e-10 | 90/49/130/265 (534); 1.905; p 8.16e-11; q 8.16e-10 | 🔶 denominator |
| Q5 BRAF/APC | STM-1,4..7 | 102/37/366/27; −2.298; p 9.39e-9; q 4.69e-8 | 102/37/368/27; −2.306; p 8.55e-9; q 4.28e-8 | 🔶 |
| Q5 KRAS/BRAF | STM-1,4..7 | 255/213/57/7; −2.766; p 2.49e-8; q 6.28e-8 | 256/214/57/7; −2.767; p 2.47e-8; q 6.40e-8 | 🔶 |
| Q5 KRAS/APC | STM-1,4..7 | 109/30/203/190; 1.766; p 2.51e-8; q 6.28e-8 | 109/30/204/191; 1.766; p 2.56e-8; q 6.40e-8 | 🔶 |
| Q5 KRAS/NRAS | STM-1,4..7 | 282/215/30/5; −2.194; p 5.85e-4; q 0.00146 | 283/216/30/5; −2.195; p 5.84e-4; q 0.00146 | 🔶 (display same) |
| Q5 BRAF/TP53 | STM-1,4..7 | 182/37/286/27; −1.107; p 0.0044 (0.004); q 0.0073 (0.007) | 183/37/287/27; −1.104; p 0.0046 (0.005); q 0.0077 (0.008) | 🔶 |
| Q5 NRAS/APC | STM-1,4..7 | 135/4/362/31; 1.531; p 0.046; q 0.065 | 135/4/364/31; 1.523; p 0.046; q 0.065 | 🔶 |
| Q5 KRAS/TP53 | STM-1,4..7 | 126/93/186/127; −0.112; p 0.721; q 0.901 | 126/94/187/127; −0.136; p 0.655; q 0.819 | 🔶 |
| Q5 NRAS/TP53, NRAS/BRAF | STM-1,4..7 | 0.075 / −0.090; p = q = 1.000 | 0.077 / −0.083; p = q = 1.000 | 🔶 |
| Q4 KRAS/APC (2 studies) | MD-8, STM-5..7 | 1122/52/219/191; 4.234 (">3"); p 3.74e-81; q 2.24e-80 | 1135/52/221/192; pooled 4.245, **MH 1.758**; Fisher 6.39e-82, **CMH p 4.07e-8**; q 1.22e-7 | 🔶 |
| Q4 TP53/APC | same | 781/393/139/271; 1.954; p 1.91e-30; q 5.74e-30 | 791/396/141/272; MH 1.667; CMH 6.09e-10; q 3.66e-9 | 🔶 |
| Q4 TP53/PIK3CA | same | 574/498/346/166; −0.855; p 1.21e-7; q 2.41e-7 | 583/502/349/166; MH −0.786; CMH 2.23e-6; q 4.47e-6 | 🔶 |
| Q4 TP53/KRAS | same | 816/525/104/139; 1.055; p 2.13e-7; q 3.20e-7 (sig.) | 827/529/105/139; MH 0.055; CMH 0.880; q 0.880 (not sig.) | 🔶 |
| Q4 KRAS/PIK3CA | same | 922/150/419/93; 0.448; p 0.037; q 0.044 | 935/150/421/94; MH 1.156; CMH 8.93e-6; q 1.34e-5 | 🔶 |
| Q4 PIK3CA/APC | same | 784/390/288/122; −0.232; p 0.220; q 0.220; **Mutual exclusivity** | 796/391/289/124; MH +0.543; CMH 0.084; q 0.101; **co-occurrence** | 🔶 tendency flips |
| Q2 KRAS: MUT / TP53: MUT HOMDEL | MD-3 | 5530/797/3772/846; 0.638; p 1.90e-16; q 5.70e-16 | (Q2b, OQL dropped) KRAS/TP53 5425/876/3714/930; 0.633; p 2.16e-17 | 🔶 |
| Q2 KRAS: MUT / BRAF / NRAS | MD-4 | 8495/1577/807/66; −1.183; p 6.47e-12 | refused (merged); Q2b gives KRAS/BRAF −1.104 and KRAS/NRAS −1.595 as separate rows | ❌ |
| Q2 TP53: MUT HOMDEL / BRAF / NRAS | MD-4 | 5802/4270/525/348; −0.151; p = q = 0.153 | refused | ❌ |
| Summary "tested 6 pairs between the 4 tracks" | UI-3 | 6 / 4 | "BH across the 6 assessable pairs" (note) | 🟡 |

Diagnosis:
- **Q1, Q3**: identical — msk_impact_2017's mutation and CNA panels coincide, so "profiled for the mutation panel" (cBioLab) equals "profiled in every selected profile" (legacy). Same data version.
- **Q5**: coadread has samples sequenced but without a GISTIC CNA call (or vice versa); legacy marks them UNPROFILED (must be profiled in *every* selected profile, MEX-STM-1), cBioLab keeps them (mutation panel only). 2–5 extra samples per pair; p/q move in the 3rd digit, KRAS/TP53 more (0.721 → 0.655).
- **Q4**: same denominator effect (+13–16 samples) plus the deliberate CMH stratification, which changes p by up to 22 orders of magnitude and one tendency.

---

## 4. Scorecard

### §0 Shared chrome and tab visibility

| ID | verdict | how | note |
|---|---|---|---|
| MEX-0.1 | 🟡 | B | Results header as in `01-oncoprint.md` RV-1; no OqlStatusBanner (OQL not applied; header line "the oncoprint and the gene tabs draw every alteration", `results/page.tsx:131-135`); no AlterationFilterWarning / CaseFilterWarning |
| MEX-0.2 | ✅ | BC | Tab "Mutual Exclusivity"; `?tab=Mutual+Exclusivity`; "Open in cBioPortal" maps to `mutualExclusivity` (`legacy-link.ts:35`) |
| MEX-0.3 | 🟡 | BC | Hidden when < 2 distinct genes (`results-layout.ts:204,214`), listed as "Mutual Exclusivity (one gene)"; routed directly (Q6) the tab is absent and the page shows Oncoprint (legacy shows the tab + ER-1); > 12 genes the view errors (`COOCCUR_GENE_LIMIT`) |
| MEX-0.4 | 🟡 | B | Generic card wait state; an error shows the engine's message instead of nothing |

### §1 Error / empty states

| ID | verdict | how | note |
|---|---|---|---|
| MEX-ER-1 | 🔶 | BC | Unreachable on the page (tab hidden); engine says "co-occurrence needs at least 2 distinct genes" (`run.ts:19`) |
| MEX-ER-2 | 🔶 | C | No track-level message; pairs nobody is profiled for are dropped and named in the note (`run.ts:55-56, 82-86`); with no assessable pair the figure is null (`kind.ts:7`) |
| MEX-ER-3 | ❌ | C | No excluded-track, AlterationFilter or CaseFilter warnings exist |

### §2 Page content

| ID | verdict | how | note |
|---|---|---|---|
| MEX-UI-1 | 🔶 | B | No OQL banner (see 0.1) |
| MEX-UI-2 | 🟡 | C | "N of M pairs are NOT assessable here — no panel … covers both genes (A/B, …). They are omitted" in the note; per pair, not per track; not an alert |
| MEX-UI-3 | 🟡 | B | No "tested P pairs between T tracks" sentence; note ends "q-values are Benjamini–Hochberg across the 6 assessable pairs" |
| MEX-UI-4 | ❌ | B | No Mutual exclusivity / Co-occurrence / Significant only checkboxes |
| MEX-UI-5 | ❌ | C | Follows UI-4 |
| MEX-UI-6 | 🔶 | B | No URL state ✅, but the tab IS a chart: horizontal bars of log₂ OR, coloured by q < 0.05 and direction (`figure.ts:8-27`); no table |
| MEX-UI-7 | ✅ | C | No counts sentence, no Bonferroni |

### §3 Table

| ID | verdict | how | note |
|---|---|---|---|
| MEX-TB-1 | ❌ | BC | Portal renders the figure only (`PortalTabs.tsx:171-181`: `cooccurrence` has a `Card`, not a `body`); the `/lab` card has a plain table with no search, columns menu, copy or download |
| MEX-TB-2 | 🔶 | BC | Per row: label "A / B" + "log₂OR · q"; counts and p in the SVG `<title>` ("both 52, KRAS only 1754, EGFR only 803, neither 8336 · p …"); `/lab` card columns pair / both / A only / B only / neither / log₂ OR / p / q / tendency (order differs, Both first) |
| MEX-TB-3 | 🟡 | BC | Rows ordered by p ascending (`run.ts:60`), equivalent to q order; no click-to-sort |
| MEX-TB-4 | ❌ | B | No search |
| MEX-TB-5 | ❌ | B | No pagination (all ≤ 66 rows drawn) |
| MEX-TB-6 | ❌ | B | No copy or `table.tsv` download; no figure SVG/PNG download either |
| MEX-TB-7 | ✅ | BC | Q1 reference reproduced exactly: every count, log₂ OR, p, q, tendency, row order (§3) |

### §4 Modes & conditions

| ID | verdict | how | note |
|---|---|---|---|
| MEX-MD-1 | 🟡 | B | 1 gene → tab hidden ✅, but also when routed to; no ER-1 |
| MEX-MD-2 | 🟡 | C | Unprofiled handled per pair (dropped + named), not per track; no ER-2 |
| MEX-MD-3 | ❌ | B | OQL lines reduced to gene symbols (`geneSymbols`, `results-layout.ts:214` passes `genes`); Q2b KRAS/TP53 = plain-gene counts; labels are symbols (tracked) |
| MEX-MD-4 | ❌ | B | `[BRAF NRAS]` refused by the Results page: "bad gene entry '[BRAF'" (tracked: OQL coverage) |
| MEX-MD-5 | ✅ | BC | Always sample-level (`pairCountsSql` counts `bareSampleId`, `federation.ts:410`); Q1 profiled 10,945 = samples. Caption says "patients" (see bugs) |
| MEX-MD-6 | ❌ | C | No Show only profiled (unprofiled samples are excluded per pair anyway) |
| MEX-MD-7 | ❌ | C | No driver/VUS/germline filter on this view; every called alteration counts (tracked: Driver-annotation settings) |
| MEX-MD-8 | 🔶 | BC | Per-study panels ✅ (each study answers its own 2×2), but profiled = MUTATION_EXTENDED panel only (`federation.ts:427`), and the test is CMH stratified by study with the MH odds ratio driving direction (`run.ts:41-49`); Q4 numbers in §3 |
| MEX-MD-9 | 🐞 ok | C | Genes de-duplicated (`geneSymbols`, `run.ts:16`); no key collision |
| MEX-MD-10 | N/A | C | Invariant 1 (loud rejection, never silent approximation): a pair with no jointly profiled sample is omitted and named "not assessable" instead of p = 1, ">3", "Co-occurrence" (`run.ts:52-56`) |

§5 Persistence (no IDs): legacy persists nothing; cBioLab has nothing to persist (no checkboxes / search / sort). The view's genes live in the document.

### §6 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| MEX-STM-1 | 🔶 | BC | Unit = sample ✅. UNPROFILED = no MUTATION_EXTENDED panel row covering the gene (`federation.ts:423-429`), not "not profiled in every applicable selected profile"; ALTERED = `ALTERED_COND` (mutation, CNA ±2, SV; off-panel calls excluded), OQL and driver filters not applied. Q1/Q3 identical; Q5 +2–5, Q4 +13–16 samples |
| MEX-STM-2 | 🟡 | C | No track-level inclusion; pairs with 0 jointly profiled samples dropped (`run.ts:55-56`) |
| MEX-STM-3 | 🔶 | B | Labels are gene symbols, "A / B" in the figure; no OQL-line labels, no merged labels |
| MEX-STM-4 | ✅ | BC | C(T,2) in query order, A = earlier gene (`run.ts:20-21`); per-pair jointly profiled denominator (`federation.ts:438-444`); counts identical in Q1, Q3 |
| MEX-STM-5 | 🔶 | C | Same formula, identical to 3 dp when no cell is 0 (all Q1/Q3/Q5 pairs); but +0.5 to every cell when any is 0 (`stats.ts:670-676`) → finite, legacy ±∞; rounded to 3 dp at source; tendency `null` when log₂ OR is 0 or ±∞ (`run.ts:48`), legacy "Mutual exclusivity" for ≤ 0; multi-study direction from MH OR |
| MEX-STM-6 | 🟡 | BC | Two-sided Fisher, p identical to ≥ 3 s.f. on all 12 Q1/Q3 pairs; ties use a 1e-9 log tolerance (`stats.ts:23`, legacy none) and p is capped at 1; multi-study primary p = CMH (pooled Fisher kept as `p`) |
| MEX-STM-7 | 🟡 | BC | BH step-up identical (Q1/Q3 q equal); over assessable pairs only, capped at 1 (`stats.ts:625`); multi-study on CMH p |
| MEX-STM-8 | 🔶 | B | No checkbox filter; the figure colours rows by q < 0.05 ∧ direction (`figure.ts:15`) |
| MEX-STM-9 | 🔶 | B | "−1.7 · q = 2.2e-20" (`fmtNum`, `fmtQ`); no "<0.001", no "<-3" / ">3" (±∞ drawn to the axis edge, `figure.ts:26`) |

---

## 5. cBioLab bugs (wrong on its own terms)

1. **"patients" for samples**: the note ("Denominators are the patients profiled for BOTH genes", `run.ts:74`), the DSL reference (`doc.ts:7`), the method step ("Of the patients with a sample on a mutation panel…", `method.ts:20`) and the `/lab` card subtitle (`cooccurrence.tsx:13`) say patients; `pairCountsSql` counts samples (its own comment says so, `federation.ts:396`). Q1: profiled 10,945 = the study's samples, not its 10,336 patients.
2. **Multi-study log₂ OR disagrees between outputs**: the figure and `/lab` card draw log₂(MH OR) (`figure.ts:12`, `cooccurrence.tsx:30`), while the results text prints the pooled `log2Odds` (`kind.ts:14`) and the method record describes only the pooled formula (`method.ts:31`). Q4 TP53/KRAS: figure 0.055, text 1.049.
3. **Tendency `null` (no label) for a log₂ OR of exactly 0, or ±∞** (`run.ts:48`): single-study log₂ OR is always finite (Haldane), so a pair with no association gets no tendency at all; multi-study an MH OR of 0 or ∞ (`Math.log2`) does too.
