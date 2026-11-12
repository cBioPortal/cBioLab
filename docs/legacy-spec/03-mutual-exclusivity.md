# Legacy parity spec — Results View › Mutual Exclusivity

Source of truth: cbioportal.org (checked 2026-11-10) and `cBioPortal/cbioportal-frontend@cd8c6df`.
Each line is one checkable requirement with an ID. Defaults are written as `[default]`. `URL:` gives the
query param that persists the state; *(local)* means component state only, lost on reload.
**Tag key:** `[B]` = seen in the browser, `[C]` = code-derived only. Untagged lines were confirmed both ways.
Column-header tooltips did not render headless, so they are `[C]`.

Reference queries:
- `/results/mutualExclusivity?cancer_study_list=msk_impact_2017&case_set_id=msk_impact_2017_all&profileFilter=mutations,structural_variants,cna&gene_list=TP53 KRAS PIK3CA EGFR` (6 pairs)
- OQL plus a merged track: same study, `gene_list=KRAS: MUT\nTP53: MUT HOMDEL\n[BRAF NRAS]` (3 pairs)
- Single gene (error state): `gene_list=KRAS`

Key files (relative to cbioportal-frontend `src/`): `pages/resultsView/mutualExclusivity/MutualExclusivityTab.tsx`,
`…/MutualExclusivityTable.tsx`, `…/MutualExclusivityUtil.tsx`, `shared/lib/calculation/FisherExactTestCalculator.ts`,
`shared/lib/calculation/BenjaminiHochbergFDRCalculator.ts`, `pages/resultsView/ResultsViewPageStoreUtils.ts` (`getSampleAlteredMap`, lines 473-627).

---

## 0. Shared chrome and tab visibility
- **MEX-0.1** Uses the Results header, global settings and banners from `01-oncoprint.md` RV-1…RV-3:
  - OqlStatusBanner (`tabReflectsOql=true`). Seen: "The results below are filtered by the OQL specification from your query."
  - AlterationFilterWarning.
  - CaseFilterWarning.
- **MEX-0.2** Tab "Mutual Exclusivity", route `/results/mutualExclusivity`. Legacy alias `mutual_exclusivity`.
- **MEX-0.3** The tab is hidden while `isSampleAlteredMap` is loading, and when it has fewer than 2 tracks (raw count, before the unprofiled-track removal of MEX-STM-2) (`ResultsViewPage.tsx:234-244`).
  - Exception: it is always shown when routed to directly. Seen: the tab is present for `gene_list=KRAS` opened at `/mutualExclusivity`.
  - It is also hidden by `disabled_tabs`.
- **MEX-0.4** Loading → spinner. Error → nothing.

## 1. Error / empty states (`MutualExclusivityTab.tsx:101-109`)
- **MEX-ER-1** Fewer than 2 tracks → alert-info "Mutual exclusivity analysis can only be performed when data from at least two genes is provided." Seen for a single gene.
- **MEX-ER-2** At least 2 tracks but fewer than 2 profiled tracks (MEX-STM-2) → alert-info "Mutual exclusivity analysis can only be performed when at least two of the queried genes have been profiled in the queried samples." `[C]`
- **MEX-ER-3** In error states, the excluded-track warning (MEX-UI-2), AlterationFilterWarning and CaseFilterWarning still render; the OQL banner does not `[C]`.

## 2. Page content (in order)
- **MEX-UI-1** Banners (MEX-0.1).
- **MEX-UI-2** Excluded-track warning (alert-warning), shown when ≥1 track was dropped by MEX-STM-2 `[C]`:
  - 1 track: "`X` is not profiled in any queried samples and therefore is excluded from this analysis."
  - More: "`X, Y` and `Z` are not profiled in any queried samples and therefore are excluded from this analysis."
- **MEX-UI-3** Summary: "The analysis tested **`P`** pair(s) between the **`T`** tracks in the OncoPrint."
  - P = number of pairs, unfiltered; T = number of tracks after MEX-STM-2.
  - "pair" when P ≤ 1, else "pairs".
  - Seen: "tested 6 pairs between the 4 tracks".
- **MEX-UI-4** Checkboxes, inline, all *(local)*:

| Checkbox | Default | Effect (MEX-STM-8) |
|---|---|---|
| Mutual exclusivity | ☑ | include pairs with log2 OR ≤ 0 |
| Co-occurrence | ☑ | include pairs with log2 OR > 0 |
| Significant only | ☐ | additionally require q < 0.05 |

- **MEX-UI-5** Both tendency boxes off → empty table, even if Significant only is on `[C]`.
- **MEX-UI-6** No URL params, no persisted state. There is no chart; the tab is the table only.
- **MEX-UI-7** Dead code, not shown: `getCountsText` ("The query contains N track pairs with mutually exclusive alterations (M significant)…") and `calculateAdjustedPValue` (Bonferroni) are unused `[C]`.

## 3. Table (LazyMobXTable)

**MEX-TB-1 Toolbar**
- Search box (`table-search-input`).
- "Columns" dropdown with [Select all] / [Deselect all]; all 10 columns on by default.
- Copy button and Download button.
- Copy and download are hidden when `skin_hide_download_controls = HIDE_ALL`.

**MEX-TB-2 Columns** (order fixed):

| Column | Cell | Bold when | Header tooltip `[C]` | Sort key | Searchable |
|---|---|---|---|---|---|
| A | track A label | always | "A" | label string | ✔ |
| B | track B label | always | "B" | label string | ✔ |
| Neither | count | — | "Number of samples with alterations in neither A nor B" | number | |
| A Not B | count | — | "…in A but not in B" | number | |
| B Not A | count | — | "…in B but not in A" | number | |
| Both | count | — | "…in both A and B" | number | |
| Log2 Odds Ratio | MEX-STM-6 | — | "Quantifies how strongly the presence or absence of alterations in A are associated with the presence or absence of alterations in B in the selected samples. OR = (Neither * Both) / (A Not B * B Not A)" | raw float (±Infinity) | |
| p-Value | MEX-STM-6 | — | "Derived from two-sided Fisher Exact Test" | raw p | |
| q-Value | MEX-STM-6 | q < 0.05 | "Derived from Benjamini-Hochberg FDR correction procedure" | raw q | |
| Tendency | "Mutual exclusivity" / "Co-occurrence" | q < 0.05 | 3-row table: "Log2 ratio > 0 : Tendency towards co-occurrence / Log2 ratio <= 0 : Tendency towards mutual exclusivity / q-Value < 0.05 : Significant association" | string | ✔ |

**MEX-TB-3 Default sort:** q-Value ascending (`initialSortColumn: 'q-Value'`).
- Ties keep the p-value order of MEX-STM-7 (stable sort); then pair-generation order.
- Clicking a header toggles asc/desc.

**MEX-TB-4 Search:** case-insensitive substring over A, B and Tendency only.
- Seen: "co-occ" → 5 rows; "kras" → 3 rows.

**MEX-TB-5 Pagination:** fixed 50 rows per page (the only option). Footer "Showing 1-N of M".

**MEX-TB-6 Download** `table.tsv`:
- Tab-separated, **CRLF** line endings.
- Header = the column names.
- Values use the *display formatting*: `-1.700`, `<0.001`, `>3`. So exact p/q are lost — legacy quirk.
- Seen first row: `KRAS  EGFR  8336  1754  803  52  -1.700  <0.001  <0.001  Mutual exclusivity`.
- Copy copies the same text `[C]`.

**MEX-TB-7 Observed reference output** (TP53 KRAS PIK3CA EGFR, msk_impact_2017; 10,945 samples, all profiled):

| A | B | Neither | A¬B | B¬A | Both | log2 OR | p | q | Tendency |
|---|---|---|---|---|---|---|---|---|---|
| KRAS | EGFR | 8336 | 1754 | 803 | 52 | -1.700 | <0.001 | **<0.001** | **Mutual exclusivity** |
| TP53 | EGFR | 5939 | 4151 | 362 | 493 | 0.962 | <0.001 | **<0.001** | **Co-occurrence** |
| TP53 | KRAS | 5425 | 3714 | 876 | 930 | 0.633 | <0.001 | **<0.001** | **Co-occurrence** |
| TP53 | PIK3CA | 5517 | 4014 | 784 | 630 | 0.143 | 0.084 | 0.126 | Co-occurrence |
| PIK3CA | EGFR | 8795 | 1295 | 736 | 119 | 0.135 | 0.367 | 0.440 | Co-occurrence |
| KRAS | PIK3CA | 7963 | 1568 | 1176 | 238 | 0.040 | 0.730 | 0.730 | Co-occurrence |

- Significant only → the first 3 rows. Plus Co-occurrence off → the KRAS/EGFR row only.
- OQL run rows: `KRAS: MUT` vs `TP53: MUT HOMDEL` 0.638 Co-occurrence; `KRAS: MUT` vs `BRAF / NRAS` -1.183 Mutual exclusivity; `TP53: MUT HOMDEL` vs `BRAF / NRAS` -0.151, p = q = 0.153.

## 4. Modes & conditions

| ID | Condition | Expected behaviour |
|---|---|---|
| MEX-MD-1 | 1 track | Tab hidden unless routed to; MEX-ER-1 |
| MEX-MD-2 | A track with no profiled sample | Track dropped, warning MEX-UI-2; if <2 remain → MEX-ER-2 |
| MEX-MD-3 | OQL lines | One track per OQL line; label = OQL line text (MEX-STM-3); OQL banner |
| MEX-MD-4 | Merged track `[A B]` / `["LBL" A B]` | One track; label "A / B" or LBL; altered if any member altered |
| MEX-MD-5 | Patient vs sample view (`show_samples`) | **No effect** — always sample-level |
| MEX-MD-6 | Show only profiled (RV-2) | Uses `filteredSamples`; CaseFilterWarning |
| MEX-MD-7 | Driver/VUS/germline filters | Altered status uses the filtered alterations; AlterationFilterWarning |
| MEX-MD-8 | Multi-study, mixed panels | Per-sample unprofiled exclusion uses only that study's selected profiles (MEX-STM-1) |
| MEX-MD-9 | Duplicate track label (e.g. same gene twice with default OQL) | Map key collides; the later track overwrites the earlier — legacy bug `[C]` |
| MEX-MD-10 | Pair with no jointly profiled samples | Counts all 0, p = 1, log2 OR = +∞ → ">3", "Co-occurrence" — legacy quirk `[C]` |

## 5. Persistence summary
- **URL:** none specific to this tab (route only). Global RV-2 params apply.
- **Not persisted:** the three checkboxes, search text, column visibility, sort, page.

## 6. Statistics & methods `[C]` (spot-checked against MEX-TB-7 by hand)

**MEX-STM-1 Cases and per-track status** (`ResultsViewPageStoreUtils.ts:473-597`)
- Unit = **sample** (`store.filteredSamples`), never patient.
- Each sample gets one status per track: UNPROFILED, ALTERED or UNALTERED.
- **Single-gene track:**
  - UNPROFILED if the sample is *not* profiled for the gene in **at least one** selected profile that its study has (selected ∩ study profiles; all selected profiles if the study is unknown). The sample must be profiled in *every* applicable selected profile to count.
  - Profiled is tested with `isSampleProfiled` (gene panel or whole-genome coverage).
- **Merged track:** UNPROFILED if there is some applicable selected profile in which the sample is profiled for *none* of the member genes.
- ALTERED if the sample has ≥1 alteration in `oqlFilteredCaseAggregatedDataByUnflattenedOQLLine` for the track (OQL-matched, after driver/VUS/germline filters). Otherwise UNALTERED.
- Contrast: Cancer Types Summary counts a case as profiled if it is profiled in *any* profile (`02-cancer-types-summary.md` CTS-STM-4).

**MEX-STM-2 Track inclusion** (`MutualExclusivityUtil.tsx:264-280`): a track is kept iff it has ≥1 sample that is not UNPROFILED.

**MEX-STM-3 Track labels** (`ResultsViewPageStoreUtils.ts:599-627`)
- Line's parsed alterations equal the default OQL → gene symbol.
- Otherwise → `oql_line` minus its last character (the trailing `;`). Seen `KRAS: MUT`.
- Merged track → its label if given, else member genes joined by `" / "`.

**MEX-STM-4 Pairs and 2×2 counts** (`MutualExclusivityUtil.tsx:20-58, 169-209`)
- Pairs: all unordered combinations (C(T,2)) of the kept tracks, in track (query) order. A = the earlier track.
- Per pair, skip every sample that is UNPROFILED in A **or** B.
- Over the remaining samples:
  - Neither = A unaltered ∧ B unaltered
  - A Not B = A altered ∧ B unaltered
  - B Not A = A unaltered ∧ B altered
  - Both = otherwise
- So each pair's denominator is its own set of jointly profiled samples.

**MEX-STM-5 Log2 odds ratio** (`:74-84`)
- `log2((Neither × Both) / (ANotB × BNotA))`. **No pseudocount, no Haldane correction.**
- Edge cases:
  - Both products 0 → `+Infinity`.
  - Only the denominator 0 → `+Infinity` (x/0).
  - Only the numerator 0 → `-Infinity`.
  - No NaN is possible.
- **Tendency** (`:16-18`): log2 OR > 0 → "Co-occurrence"; ≤ 0 (including exactly 0 and −∞) → "Mutual exclusivity".
- **Significance:** q < 0.05 (strict). Tendency labels have no other thresholds.

**MEX-STM-6 p-value: TWO-sided Fisher exact test** (not one-sided) (`FisherExactTestCalculator.ts:3-68`)
- Table `[[Neither, BNotA],[ANotB, Both]]` with fixed margins.
- Hypergeometric P(table) is computed via log-factorials.
- p = P(observed) + Σ P(t) over every other table t with the same margins and P(t) ≤ P(observed).
  - The tables are enumerated by stepping (a+1,b−1,c−1,d+1) min(b,c) times and (a−1,b+1,c+1,d−1) min(a,d) times.
  - The comparison uses **no relative tolerance** (R uses 1e-7). Near-ties can therefore differ from R's `fisher.test`.
- The p-value is not capped at 1.

**MEX-STM-7 q-value: Benjamini–Hochberg** (`BenjaminiHochbergFDRCalculator.ts:1-20`, applied in `MutualExclusivityUtil.tsx:211-217`)
- Sort all C(T,2) pairs ascending by p (stable).
- Walking from the largest p down: `q_i = min(q_{i+1}, p_i × m / rank_i)` with m = number of pairs. The largest q equals its p.
- Computed over **all** pairs, independent of the checkboxes and search.
- No cap at 1.
- Quirk: the running minimum is skipped while it is exactly 0 (`if (cachedElement)`). This has no practical effect.
- Check: p = (…, 0.084, 0.367, 0.730), m = 6 → q(0.367) = 0.367·6/5 = 0.440; q(0.084) = 0.084·6/4 = 0.126.

**MEX-STM-8 Checkbox filter** (`:222-241`)
- keep = (MutEx ∧ OR ≤ 0) ∨ (CoOcc ∧ OR > 0); then, if Significant only, keep ∧ q < 0.05.
- The filter changes only which rows are shown. q is not recomputed.

**MEX-STM-9 Display formatting** (`:243-262`)
- p and q: `< 0.001` → "<0.001", else `toFixed(3)`.
- log2 OR: < −3 → "<-3", > 3 → ">3" (including ±∞), else `toFixed(3)`.
- Sorting uses the raw values.
