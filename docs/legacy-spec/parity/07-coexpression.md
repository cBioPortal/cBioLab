# Parity audit — Results › Co-expression (spec `07-coexpression.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright + its REST API from the page, same day)
- **Code paths (cBioLab):** `lib/views/correlates/{run,sql,method,figure,types}.ts`, `app/lab/kinds/correlates.tsx` (table, toolbar, side plot), `app/lab/portal-bodies.tsx` (`PortalTable`), `app/portal/results-layout.ts:209` (tab), `app/portal/study-known.ts:100` (`expressionProfile`), `lib/stats.ts`

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 KRAS mRNA×mRNA | `/results/coexpression?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS TP53`; API `co-expressions/fetch?molecularProfileIdA=…_rna_seq_v2_mrna&molecularProfileIdB=…_rna_seq_v2_mrna&threshold=0`, `{sampleListId:…_all, entrezGeneId:3845}` | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%20TP53` › Co-expression; `POST /api/analysis` `{kind:"correlates", gene:"KRAS", profileType:"rna_seq_v2_mrna", show:250}` |
| Q2 TP53 mRNA×mRNA | same, `entrezGeneId:7157` | same view, `gene:"TP53"` (no TP53 pill on the tab; API) |
| Q3 KRAS mRNA×RPPA | `molecularProfileIdB=…_rppa`, `sampleIds` = mRNA ∩ RPPA sample lists (462) | `otherProfile:"rppa"` |

Legacy q-values recomputed with the spec's BH rule (COE-STM-5) from the API's p; checked against the UI (FGD4 shown 8.81e-72, recomputed 8.808e-72). Scripts and output: (local scratch, not committed) (`legcoe.js`, `cmp.js` → `out/cmp.out`, `legties.js`, `labui.js`, `out/coe.png`, `out/leg-coe.png`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 10 |
| 🟡 partial | 14 |
| 🔶 different | 11 |
| ❌ missing | 6 |
| 🐞 ok | 1 |
| 🐞 copied | 0 |
| N/A | 6 |
| ? | 1 |
| **Total IDs** | **49** |

**Overall: 34.7 %** (✅ 10 + 🐞ok 1 + N/A 6 = 17 of 49). Counting 🟡 as half: 49.0 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | N/A | ? | One line |
|---|---|---|---|---|---|---|---|---|---|
| §0 Visibility (0.x) | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | Hidden for multi-study ✅; needs an mRNA profile; generic waiting/refusal texts |
| §1 Pills, profiles (1.x) | 6 | 0 | 1 | 3 | 1 | 0 | 1 | 0 | No entity pills; raw profile ids, no names or sample counts |
| §2 Table (2.x) | 13 | 2 | 5 | 4 | 0 | 1 | 1 | 0 | Only top 100 +/− rows, no N/A rows; 2-sig-digit p/q; search has no cytoband exclusion |
| §3 Plot (3.x) | 10 | 1 | 2 | 2 | 4 | 0 | 0 | 1 | Generic scatter, statistics match; no mutation colours, log scale, toggles or downloads |
| §4 Modes (MD) | 9 | 4 | 1 | 0 | 1 | 0 | 3 | 0 | Same- and cross-profile sample sets identical (592, 462) |
| §6 Statistics (STM) | 7 | 3 | 1 | 2 | 0 | 0 | 1 | 0 | ρ and p identical for untied genes; ties and the null rule differ, so BH m and q differ |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Table lists only the 100 most positive + 100 most negative genes** ("Showing 1–25 of 200"); legacy lists every gene (20,337 rows, 7,868 negative) and N/A rows | 2.4, 2.7, STM-1 | not tracked |
| 2 | **q-values differ by ×1.15**: BH over 19,892 tested genes vs legacy 17,292 non-null (legacy nulls 3,045 tie-heavy genes; cBioLab tests them). FGD4 q 1.013e-71 vs 8.808e-72; q<0.05: 11,809 vs 11,701 | STM-3, STM-5 | not tracked |
| 3 | **ρ differs for tie-heavy genes**: legacy ClickHouse `rankCorr` vs cBioLab average ranks; TP53×NRG3 −0.1760 vs −0.2026 (average-rank Spearman from legacy's own raw data: −0.2026) | STM-3 | not tracked |
| 4 | **No entity pills**: tab draws the first gene; other genes via a free-text "gene" field | 1.1 | not tracked |
| 5 | **Profile selects show raw ids** (`rna_seq_v2_mrna`), no names, no "(N samples)"; z-score profiles not excluded | 1.2–1.4 | not tracked |
| 6 | **Plot lacks Show Mutations colouring, Log Scale and Regression toggles** (fit line always drawn); no plot downloads | 3.4–3.6, 3.9, MD-8, MD-9 | not tracked |
| 7 | **Number format**: p/q 2 significant digits ("5.1e-76", "1e-71") vs legacy 3 ("5.09e-76", "8.81e-72"); ρ `toFixed(3)` | 2.5 | not tracked |
| 8 | **Search**: substring of "gene cytoband"; no `-1p` exclusion (returns 0 rows), no prefix rule, no info tip | 2.8 | not tracked |
| 9 | No table download | 2.9 | not tracked |
| 10 | Tab needs an MRNA_EXPRESSION profile (legacy also shows it for protein-only studies) | 0.1 | not tracked |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| Q1 rows returned / with ρ | STM-1, STM-3 | 20,337 / 17,292 (3,045 null) | 19,892 tested, 445 untested; 200 listed | 🔶 |
| Q1 top 20 (by q) ρ | STM-3 | FGD4 0.6623, IPO8 0.6430, SCYL2 0.6266, PPP1R12A 0.6255, CAND1 0.6084 … APAF1 0.5628 | identical, all 20 (n = 592) | ✅ |
| Q1 top 20 p | STM-4 | FGD4 5.094e-76, IPO8 2.313e-70, SCYL2 6.763e-66 … APAF1 9.068e-51 | identical, all 20 | ✅ |
| Q1 top 20 q | STM-5 | FGD4 8.808e-72, IPO8 2.000e-66, SCYL2 3.898e-62 … APAF1 7.840e-48 | FGD4 1.013e-71, IPO8 2.301e-66, SCYL2 4.485e-62 … APAF1 9.019e-48 (all ×1.150 = 19,892/17,292) | 🔶 |
| Q1 all 500 listed genes | STM-3/4 | — | max \|Δρ\| 5.0e-5 (4-dp rounding), median \|Δlog10 p\| 0; top-20 +/− sets identical | ✅ |
| Q1 most negative | STM-3 | CCS −0.5168, STK25 −0.5120, XAB2 −0.5106 | same | ✅ |
| Q1 q < 0.05 | STM-5 | 11,701 | 11,809 | 🔶 |
| Q2 TP53 top 20 ρ / p | STM-3/4 | TNK1 0.4753 1.057e-34, ELAC2 0.4619 1.267e-32, RNF167 0.4560 9.827e-32 … PFAS 0.4050 8.997e-25 | identical | ✅ |
| Q2 top 20 q | STM-5 | TNK1 1.829e-30 … PFAS 7.779e-22 | 2.104e-30 … 8.949e-22 (×1.150) | 🔶 |
| Q2 tie-heavy genes (n = 365) | STM-3 | NRG3 −0.1760, SFTA1P −0.2255, CDH19 −0.1869; AKR1D1, LGI1 null | −0.2026, −0.2478, −0.2029; AKR1D1 −0.2014, LGI1 −0.1891 | 🔶 legacy `rankCorr` tie handling; average-rank recomputation from legacy raw values gives cBioLab's −0.2026 / −0.2478 / −0.2014 |
| Q2 q < 0.05 | STM-5 | 4,816 | 4,726 | 🔶 |
| Q3 cross-profile n | MD-2, STM-2 | 462 (mRNA ∩ RPPA) | n = 462 | ✅ |
| Q3 rows | STM-1 | 209 | 209 tested | ✅ |
| Q3 top 20 ρ / p / q | STM-3/4/5 | MAP2K1_PS217_S221 0.2121 4.257e-6 8.896e-4; CLDN7 0.1955 2.316e-5 2.421e-3; CHEK2 −0.1913 3.500e-5 2.439e-3 … DIRAS3 −0.1277 5.965e-3 0.06234 | identical (q differs ≤1e-3 relative) | ✅ |
| Q3 q < 0.05 | STM-5 | 18 | 18 | ✅ |
| Plot KRAS×FGD4 | STM-6 | Spearman 0.66 (p = 5.11e-76), Pearson 0.49 (p = 2.18e-36) | Spearman 0.66 (p = 5.1e-76), Pearson 0.49 (p = 2.2e-36) | ✅ |

Data version: identical values per sample (TP53/NRG3 n = 365 both sides), so the warehouse and cbioportal.org hold the same mRNA/RPPA data. Every ρ difference is the tie rule; every q difference is BH's m.

---

## 4. Scorecard

### §0 Tab visibility and chrome

| ID | verdict | how | note |
|---|---|---|---|
| COE-0.1 | 🟡 | BC | Hidden for multi-study ✅ with a note "Co-expression (one study at a time)"; requires an MRNA_EXPRESSION profile (`results-layout.ts:186`), so a protein-only study has no tab; no per-gene data-count check |
| COE-0.2 | 🟡 | B | Page-level note about OQL instead of the tab banner; no AlterationFilter / CaseFilter warnings (no such settings) |
| COE-0.3 | 🟡 | C | No profile → tab dropped with a reason; a refused view names the available profiles (invariant 1) |
| COE-0.4 | 🟡 | B | "updating…" cover + ms badge (9.3 s Q1); no size-dependent message |

### §1 Entity pills and profile selectors

| ID | verdict | how | note |
|---|---|---|---|
| COE-1.1 | 🔶 | B | No pills; tab draws `genes[0]`, a free-text "gene" field changes it (`correlates.tsx:78`) |
| COE-1.2 | 🔶 | B | Toolbar "gene ⟨KRAS⟩ on ⟨X⟩ against ⟨Y⟩ list ⟨100⟩ each way" instead of the sentence; X/Y map ✅ |
| COE-1.3 | ❌ | B | Options are raw profile ids; no names, no "(N samples)" |
| COE-1.4 | 🔶 | C | Any non-`cna` profile of the study (z-scores not excluded, no rna_seq-first order); Y also offers numeric generic assays (extra) |
| COE-1.5 | 🟡 | BC | Default X = first CONTINUOUS mRNA (`rna_seq_v2_mrna`) ✅, Y = X ✅; kept in the document (invariant 9), not reset per pill |
| COE-1.6 | N/A | C | Implementation detail (pre-mounted combos); results cached server-side by document (invariant 11) |

### §2 Correlation table

| ID | verdict | how | note |
|---|---|---|---|
| COE-2.1 | ✅ | B | Table left, plot right |
| COE-2.2 | 🟡 | B | Same five columns ✅; ρ colours `SERIES[2]/[4]` not `rgb(41,87,41)`/`rgb(180,4,4)`; no p/q header tooltips; q always bold; Spearman sorts by value, not [\|ρ\|, sign] |
| COE-2.3 | N/A | C | No gene-set (GSVA) data in the warehouse (tracked: GSVA gene sets) |
| COE-2.4 | 🔶 | BC | No N/A rows: untested genes (445, <10 pairs or no spread) only counted in the caption; legacy's 3,045 tie-heavy nulls get a ρ here |
| COE-2.5 | 🔶 | B | ρ `toFixed(3)`; p/q `pDigits` 2 sig. digits ("5.1e-76", "1e-71") vs `toConditionalPrecision` ("5.09e-76", "8.81e-72") |
| COE-2.6 | 🟡 | B | Default q asc ✅; first click on a numeric header sorts descending (legacy ascending); p-null sort bug moot (no N/A rows) |
| COE-2.7 | 🔶 | B | Select present; labels "Show Positive/Negative Correlations"; filters the 100 listed per direction ("of 100"), not all (legacy "of 7868"); ρ > 0 / < 0 strict |
| COE-2.8 | 🔶 | B | Placeholder "search"; substring on "gene cytoband": `12p` → 10 rows, `-1p` → 0 rows (legacy excludes 1p); no info tip |
| COE-2.9 | 🟡 | B | 25/page ✅ "Showing 1–25 of 200"; no Download, no copy |
| COE-2.10 | 🟡 | BC | Row click selects + plots ✅; auto-pick = lowest q (then \|ρ\|) over the whole list, not the current view's first row (`correlates.tsx:25`) |
| COE-2.11 | ✅ | BC | Genes by symbol; RPPA phospho entities kept (MAP2K1_PS217_S221 matched, 209/209) |
| COE-2.12 | 🟡 | C | Empty → refusal "no sample in … has a value for KRAS on …", not the centred message |
| COE-2.13 | 🐞 ok | C | Dead "Load data for all genes" / 0.3-threshold text not ported |

### §3 Scatter plot

| ID | verdict | how | note |
|---|---|---|---|
| COE-3.1 | 🔶 | B | No "X vs. Y" plot title; a meta line "KRAS vs FGD4 · Spearman … · Pearson …"; card-width, not 530×530 |
| COE-3.2 | 🔶 | B | "KRAS: mRNA Expression, RSEM (…)" / "FGD4: …"; no cytoband, no "(log2)" |
| COE-3.3 | 🟡 | BC | A `plot` view with `unit: "patient"` ("592 of 594 patients have a value on both axes"); legacy samples (same here: 1 sample/patient) |
| COE-3.4 | ❌ | B | No Show Mutations / Log Scale / Show Regression Line; least-squares line always drawn |
| COE-3.5 | ❌ | B | No log scale |
| COE-3.6 | ❌ | B | All points one colour; no mutation states or legend |
| COE-3.7 | ? | — | Plot hover tooltip not checked (generic plot view tooltip) |
| COE-3.8 | ✅ | B | "Pearson r = 0.49 (p = 2.2e-36) · Spearman ρ = 0.66 (p = 5.1e-76)" = legacy values |
| COE-3.9 | ❌ | B | No SVG/PNG/PDF/Data buttons on the plot |
| COE-3.10 | 🟡 | C | Plot error shown as a note; spinner "drawing KRAS vs FGD4…"; other wording |

### §4 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| COE-MD-1 | ✅ | BC | Same profile: every cohort sample with both values (n = 592) |
| COE-MD-2 | ✅ | C | Cross profile: pairs per sample with both values = intersection (n = 462, = legacy) |
| COE-MD-3 | N/A | C | No GENESET_SCORE profiles (tracked: GSVA) |
| COE-MD-4 | N/A | C | Same (gene-set entity); legacy path is broken anyway |
| COE-MD-5 | ✅ | B | Multi-study: tab hidden with a note |
| COE-MD-6 | N/A | C | No Show-only-profiled setting (RV-2) |
| COE-MD-7 | ✅ | C | Correlations ignore OQL/driver settings |
| COE-MD-8 | ❌ | B | No mutation colouring in any case |
| COE-MD-9 | 🟡 | B | No Log Scale at all (so never shown); hiding rule moot |

§5 Persistence (no IDs): gene, profiles and list size are in the document (`?changes=`); table mode, search, sort, page, selected row are browser state. Legacy keeps all of it local.

### §6 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| COE-STM-1 | 🟡 | BC | Own SQL (`correlatesMomentsSql`), every Y gene computed (≈ threshold 0) ✅; result carries only top `show` (100, max 250) per direction |
| COE-STM-2 | ✅ | BC | Same profile: all queried samples; cross: per-sample pairs (462); never altered-only; patient-level assays paired per sample |
| COE-STM-3 | 🔶 | BC | Spearman = Pearson on average ranks (scipy). Untied genes identical to 4 dp; tie-heavy genes differ (NRG3 −0.2026 vs −0.1760; recomputed from legacy raw data −0.2026). Legacy null rule (`uniq ≤ n/2`, n < 3) not applied; cBioLab skips n < 10 or no spread. Query gene excluded ✅ |
| COE-STM-4 | ✅ | BC | t = ρ√((n−2)/(1−ρ²)), df n−2 ✅; p identical for all compared genes |
| COE-STM-5 | 🔶 | BC | BH step-up ✅ but over all tested (19,892) vs legacy's non-null (17,292) → q ×1.15 on Q1/Q2; identical on Q3 (m = 209 both); independent of filter/search ✅ |
| COE-STM-6 | ✅ | B | Plot ρ/r and p match legacy's (0.66 / 5.1e-76; 0.49 / 2.2e-36) |
| COE-STM-7 | N/A | C | Legacy MySQL path, not served by cbioportal.org |

---

## 5. cBioLab bugs

- None that break cBioLab's own rules. Note: "Show Positive/Negative Correlations" and the search act on the 200 listed genes while the note says "of 19,892" — a reader can take a filtered count of 100 for the whole profile.
