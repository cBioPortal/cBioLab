# Parity audit — Results › Pathways (spec `09-pathways.md`)

- **Date:** 2026-11-11
- **cBioLab:** `session/spec` @ `f3197d75`, dev server `http://127.0.0.1:3156`
- **Legacy:** cbioportal.org (Playwright, same day; node %s from the spec's capture of 2026-11-10)
- **Code paths (cBioLab):** `lib/views/pathwaymap/{run,rank,library,figure,types}.ts`, `lib/views/pathwaymap/README.md`, `app/lab/kinds/pathwaymap.tsx` (toolbar, ranking table), `lib/oncoprint-style.ts:94,166` (`frequencyColor`), `lib/chart/format.ts:21` (`fmtPct`), `app/portal/results-layout.ts` (tab)

**Queries used** (legacy ⇄ cBioLab)

| # | Legacy | cBioLab |
|---|---|---|
| Q1 | `/results/pathways?cancer_study_list=coadread_tcga_pan_can_atlas_2018&case_set_id=coadread_tcga_pan_can_atlas_2018_all&profileFilter=mutations,structural_variants,gistic&gene_list=KRAS NRAS BRAF TP53 APC` | `/portal/results?study=coadread_tcga_pan_can_atlas_2018&genes=KRAS%20NRAS%20BRAF%20TP53%20APC` › Pathways; `POST /api/analysis` `{kind:"pathwaymap", genes:[…]}` |
| Q5 OQL | `gene_list=KRAS: AMP MUT=G12D⏎TP53` (KRAS 63/594 in Download, see `10-results-download`) | code: the tab passes plain `genes` (`results-layout.ts`, `pathwaymap/run.ts:73-80`) |

Scripts and output: (local scratch, not committed) (`legother.js pwy` → `out/leg-pwy.png`, `labui.js` → `out/lab-pwy.png`, `out/lab-pwy.json`).

---

## 1. Summary

| Verdict | Count |
|---|---|
| ✅ match | 5 |
| 🟡 partial | 10 |
| 🔶 different | 5 |
| ❌ missing | 6 |
| 🐞 ok | 2 |
| 🐞 copied | 1 |
| N/A | 4 |
| ? | 0 |
| **Total IDs** | **33** |

**Overall: 33.3 %** (✅ 5 + 🐞ok 2 + N/A 4 = 11 of 33). Counting 🟡 as half: 48.5 %.

| Section | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞ok | 🐞copied | N/A | One line |
|---|---|---|---|---|---|---|---|---|---|
| §0 Visibility, sub-tabs (0.x) | 5 | 0 | 1 | 1 | 2 | 0 | 0 | 1 | No source pills, no NDEx; OQL not applied |
| §1 Layout (1.x) | 7 | 1 | 2 | 0 | 3 | 0 | 0 | 1 | Own SVG diagram; no PathwayMapper toolbar (export, layout, add genes, edit, help) |
| §2 Ranking (2.x) | 7 | 2 | 3 | 1 | 0 | 0 | 0 | 1 | Scores and default pathway match; tie order differs; no table sort/paging/download |
| §3 Overlay (3.x) | 4 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | Q1 %s identical; sample level, every alteration |
| §4 Modes (MD) | 6 | 0 | 1 | 2 | 1 | 1 | 0 | 1 | OQL ignored; always sample level |
| §6 Statistics (STM) | 4 | 1 | 0 | 1 | 0 | 1 | 1 | 0 | Weighted scores identical (54.54, 66.67); percent formula's legacy bug copied on purpose |

---

## 2. Top gaps (ranked by how often a portal user hits them)

| # | Gap | IDs | Tracked in PORTAL-PARITY.md |
|---|---|---|---|
| 1 | **Query OQL not applied to node %** (KRAS under `AMP MUT=G12D` reads 37.4 %, legacy 10.6 %); `[ ]` merged groups refused | 0.5, MD-3, STM-1 | (tracked) "the oncoprint and gene tabs still draw every alteration" |
| 2 | **Sample-level %, not patient-level** — equal here (1 sample/patient), differs on multi-sample studies | 3.1, MD-6, STM-1 | not tracked (README states it) |
| 3 | **No PathwayMapper toolbar**: Save PNG/SVG, Perform layout, Add selected / all valid genes to query, Edit pathway, Help | 1.3–1.5 | (tracked) "add genes to query"; rest not tracked |
| 4 | **No NDEx / pathway-source pills** | 0.2, 0.4, MD-2 | (tracked) "NDEx" |
| 5 | **Ranking table**: no column sort, filter, paging, copy/download; score "3" not "3.00"; names not truncated | 2.1, 2.2 | (tracked) "Ranking table search and CSV" |
| 6 | **Tie order**: WNT, Cell Cycle, TP53 (by summed %, then name) vs legacy WNT, TP53, Cell Cycle (heap order) | 2.5 | not tracked (README states it) |
| 7 | Node text: 0 → "0%" (legacy "0.0%"), small → "<0.1%" (legacy "<0.5%" for p < 0.5) | 3.2 | not tracked |
| 8 | No ranking-option info texts | 2.4 | not tracked |

---

## 3. Number check

| Statistic | ID | Legacy | cBioLab | Verdict |
|---|---|---|---|---|
| KRAS node % | STM-1 | 37.4% | 37.4% (222/594, stored 37.37) | ✅ |
| BRAF | STM-1 | 10.8% | 10.8% (64/594) | ✅ |
| NRAS | STM-1 | 6.4% | 6.4% (38/594) | ✅ |
| EGFR (non-query) | STM-2 | 3.0% | 3.0% (18/594) | ✅ |
| HRAS (non-query) | STM-2 | 1.2% | 1.2% (7/594) | ✅ |
| TP53 / APC (stored) | STM-1 | — (not drawn in RTK-RAS) | 53.03 / 66.67 | n/a |
| KRAS under Q5 OQL | MD-3 | 10.6 % (63/594) | 37.4 % (OQL not applied) | 🔶 |
| Ranking, match count | STM-4 | RTK-RAS 3.00 (KRAS NRAS BRAF); WNT 1.00 (APC); TP53 1.00; Cell Cycle 1.00 (TP53); 6 × 0.00 | RTK-RAS 3; WNT 1; Cell Cycle 1; TP53 1; 6 × 0 | ✅ scores; 🔶 tie order |
| Weighted (count + frequency) RTK-RAS | STM-4 | 54.54 | 37.37 + 6.40 + 10.77 = 54.54 (`frequencySum`) | ✅ |
| Weighted WNT | STM-4 | 66.67 | 66.67 | ✅ |
| Rows with PanCan filter | 2.3 | 10 of 10 | 10 | ✅ |
| Initial pathway | 2.5 | RTK-RAS | RTK-RAS | ✅ |

Data version: counts identical to the oncoprint's and Download's (same warehouse data).

---

## 4. Scorecard

### §0 Visibility and sub-tabs

| ID | verdict | how | note |
|---|---|---|---|
| PWY-0.1 | 🟡 | B | Tab always laid out; no config switches (`show_pathway_mapper`/`show_ndex`); waits with the generic cover |
| PWY-0.2 | ❌ | B | No "Choose Pathway Source" pills (tracked: NDEx) |
| PWY-0.3 | N/A | C | No sub-tabs; the drawn pathway and ranking live in the document (invariant 9), so they survive reload (legacy restore bug moot) |
| PWY-0.4 | ❌ | C | No NDEx iframe (tracked) |
| PWY-0.5 | 🔶 | B | Page note says gene tabs draw every alteration; legacy tab reflects OQL (tracked) |

### §1 PathwayMapper layout

| ID | verdict | how | note |
|---|---|---|---|
| PWY-1.1 | 🟡 | B | Title "RTK-RAS — altered % per gene" + colour/edge legend; no toolbar, no message banner |
| PWY-1.2 | 🟡 | B | Static SVG from PathwayMapper's own node positions (`figure.ts`), ranking on the right ✅; no Cytoscape (no pan/zoom/drag), no blue border; credit in the caption |
| PWY-1.3 | ❌ | B | None of the seven toolbar actions |
| PWY-1.4 | ❌ | C | No "Add selected genes to query" (tracked) |
| PWY-1.5 | ❌ | C | No "Add all valid genes to query" (tracked) |
| PWY-1.6 | N/A | C | No lazy loading: every library gene's counts arrive with the result, so there is no "Loading alteration data…" state |
| PWY-1.7 | ✅ | B | Query genes have a thick border (KRAS, NRAS, BRAF) |

### §2 Ranking panel

| ID | verdict | how | note |
|---|---|---|---|
| PWY-2.1 | 🟡 | B | Columns pathway / score / genes matched ✅; score via `fmtNum` ("3", not "3.00"); no 20-char truncation; no header sort or filters |
| PWY-2.2 | 🔶 | B | Fixed order by score; no paging (scroll), no copy/download (tracked: search and CSV) |
| PWY-2.3 | ✅ | BC | "PanCanAtlas pathways only" on by default; 10 vs 55; unticking/ticking drops a non-PanCan pathway to the top one (`pathwaymap.tsx:42`) |
| PWY-2.4 | 🟡 | B | "rank by match count / match %" + "weight by altered %" ✅; tooltips instead of the info-icon texts |
| PWY-2.5 | 🟡 | B | RTK-RAS first ✅; equal scores ordered by summed % then name (WNT, Cell Cycle, TP53) vs legacy heap order (WNT, TP53, Cell Cycle) |
| PWY-2.6 | ✅ | BC | Radio draws that pathway with no re-run (all counts in the result) |
| PWY-2.7 | N/A | C | Ranking settings and pathway are in the document (invariant 9), not local |

### §3 Gene node overlay

| ID | verdict | how | note |
|---|---|---|---|
| PWY-3.1 | 🟡 | B | One box per GENE node, coloured ✅; sample-level % of every alteration (not patient-level, not OQL) |
| PWY-3.2 | 🟡 | BC | "37.4%" ✅, N/P grey ✅; 0 → "0%" (legacy "0.0%"), 0 < p < 0.1 → "<0.1%" (legacy "<0.5%" below 0.5) |
| PWY-3.3 | ✅ | B | KRAS 37.4, BRAF 10.8, NRAS 6.4, EGFR 3.0, HRAS 1.2 — identical |
| PWY-3.4 | 🟡 | C | Non-query genes from the same cohort in one pass ✅; every alteration, no driver/germline settings (none exist) |

### §4 Modes and conditions

| ID | verdict | how | note |
|---|---|---|---|
| PWY-MD-1 | N/A | C | No deployment switch for the tab |
| PWY-MD-2 | ❌ | C | No NDEx (tracked) |
| PWY-MD-3 | 🔶 | C | OQL ignored; merged groups refused (tracked) |
| PWY-MD-4 | 🐞 ok | C | N/P gene adds 0 to a weighted score, not −101 (`rank.ts:177`) |
| PWY-MD-5 | 🟡 | C | Multi-study supported, counts summed (never % averaged) ✅; sample level |
| PWY-MD-6 | 🔶 | C | Always sample level (legacy always patient level) |

§5 Persistence (no IDs): pathway, ranking dropdown, frequency and PanCan boxes are in the document; legacy keeps them local.

### §6 Statistics & methods

| ID | verdict | how | note |
|---|---|---|---|
| PWY-STM-1 | 🔶 | BC | altered ÷ samples profiled for that gene (panel-aware, invariant 7) ✅ denominator; sample level and no OQL (legacy patient level, OQL); stored `round2`, shown 1 decimal ✅; Q1 values identical |
| PWY-STM-2 | ✅ | C | All library genes counted at once; non-genes (`NOT_GENES`) get no box, as the portal's invalid symbols |
| PWY-STM-3 | 🐞 ok | C | ratio = 0.8 × ln(1+p)/ln(101) ✅ (`oncoprint-style.ts:94,169`); p = 100 stays at 0.8 (no pure-red jump); p > 100 clamped |
| PWY-STM-4 | 🐞 copied | C | Four scores ✅ (54.54, 66.67 match); "match % weighted" = \|m\| × S / G, the legacy formula the spec flags as a bug (copied deliberately, README); N/P −101 not copied |

---

## 5. cBioLab bugs

- None found.
