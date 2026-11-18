# Parity audit: cBioLab against the legacy spec

Each scorecard here checks cBioLab against one file of the [legacy spec](../README.md), ID by ID.

**When:** 2026-11-11.
**cBioLab version:** `session/spec` (master `0a02e89e` plus the spec docs), as served by `next dev`.
**Legacy version:** cbioportal.org, checked the same day.

**Method**
- Each ID was checked in the browser where the behaviour is visible, otherwise in the code. The scorecards cite file:line for code checks.
- Statistics (`*-STM-*`) were checked by number: the same query or groups were run in both apps and the values compared.

**Verdicts**

| Verdict | Meaning |
|---|---|
| `✅` | match |
| `🟡` | partial |
| `🔶` | different |
| `❌` | missing |
| `🐞 ok` | a legacy bug, correctly not reproduced |
| `🐞 copied` | a legacy bug that cBioLab reproduces |
| `N/A` | a cBioLab invariant overrides the legacy behaviour, or the ID doesn't apply |
| `?` | couldn't be determined |

**How the scores are calculated**
- **Strict** = (✅ + 🐞 ok + N/A) / all IDs.
- **Half** counts each 🟡 as half a match.

Untracked gaps and the cBioLab bugs found are carried into [`../../PORTAL-PARITY.md`](../../PORTAL-PARITY.md). That file is the work list; these scorecards are the evidence behind it.

## Scores

| Scorecard | IDs | ✅ | 🟡 | 🔶 | ❌ | 🐞 ok | N/A | ? | Strict | Half |
|---|---|---|---|---|---|---|---|---|---|---|
| [01 OncoPrint](01-oncoprint.md) | 104 | 51 | 38 | 2 | 10 | 1 | 2 | 0 | 52% | 70% |
| [02 Cancer Types Summary](02-cancer-types-summary.md) | 59 | 21 | 12 | 12 | 10 | 1 | 3 | 0 | 42% | 53% |
| [03 Mutual Exclusivity](03-mutual-exclusivity.md) | 40 | 6 | 11 | 11 | 10 | 1 | 1 | 0 | 20% | 34% |
| [04 Plots](04-plots.md) | 170 | 16 | 42 | 30 | 75 | 2 | 5 | 0 | 14% | 26% |
| [05 Mutations](05-mutations.md) | 139 | 38 | 41 | 13 | 30 | 4 | 7 | 6 | 35% | 50% |
| [06 Structural Variants](06-structural-variants.md) | 54 | 30 | 12 | 7 | 3 | 2 | 0 | 0 | 59% | 70% |
| [07 Co-expression](07-coexpression.md) | 49 | 10 | 14 | 11 | 6 | 1 | 6 | 1 | 35% | 49% |
| [08 CN Segments](08-cn-segments.md) | 29 | 6 | 8 | 4 | 5 | 4 | 1 | 1 | 38% | 52% |
| [09 Pathways](09-pathways.md) | 33 | 5 | 12 | 3 | 6 | 2 | 4 | 0 | 33% | 52% |
| [10 Results › Download](10-results-download.md) | 41 | 11 | 21 | 2 | 4 | 1 | 2 | 0 | 34% | 60% |
| [20 Comparison core](20-comparison-core.md) | 73 | 6 | 24 | 17 | 22 | 0 | 4 | 0 | 14% | 30% |
| [21 Comparison molecular](21-comparison-molecular.md) | 88 | 18 | 35 | 22 | 7 | 2 | 3 | 1 | 26% | 46% |
| [30 Study View summary](30-study-summary.md) | 135 | 48 | 40 | 14 | 28 | 3 | 2 | 0 | 39% | 54% |
| [31 Study View shell](31-study-view-shell.md) | 118 | 24 | 34 | 9 | 43 | 5 | 3 | 0 | 27% | 42% |
| [40 Patient summary](40-patient-summary.md) | 92 | 51 | 25 | 2 | 9 | 4 | 1 | 0 | 61% | 74% |
| [41 Patient tabs](41-patient-tabs.md) | 81 | 30 | 18 | 4 | 26 | 0 | 3 | 0 | 41% | 52% |
| **Results** | 718 | 194 | 211 | 95 | 159 | 19 | 31 | 8 | 34% | 49% |
| **Comparison** | 161 | 24 | 59 | 39 | 29 | 2 | 7 | 1 | 20% | 39% |
| **Study View** | 253 | 72 | 74 | 23 | 71 | 8 | 5 | 0 | 34% | 48% |
| **Patient** | 173 | 81 | 43 | 6 | 35 | 4 | 4 | 0 | 51% | 64% |
| **All** | **1,305** | 371 | 387 | 163 | 294 | 33 | 47 | 9 | **35%** | **49%** |

One legacy bug is reproduced in cBioLab, and is not counted as a match:
- ~~05 Mutations' legend lists "Splice site" under Truncating (MUT-LP-5).~~ Fixed rather than copied (#250); re-scored 2026-11-16.
- 09 Pathways uses legacy's "match % weighted" formula on purpose (PWY-STM-4).

## What the audit found overall

**The data agrees.** Wherever the two apps were given the same cases, cBioLab's counts matched cbioportal.org's:
- altered and profiled counts and their denominators, per patient and per sample;
- mutation, copy-number and SV rows;
- lollipop stems;
- enrichment counts with their Fisher and chi-squared p-values;
- expression and protein means, SDs and p-values;
- survival patients, events, medians and log-rank p;
- Pearson correlations;
- Study View chart counts;
- patient VAF reads and signature spectra.

**The differences sit in five places:**
1. **Method, where cBioLab differs from legacy**
   - Box-plot quartiles and median.
   - Spearman ties: cBioLab ranks ties consecutively in Plots, but averages them in Co-expression, which there is the correct result.
   - The Clinical tab uses Welch's t; legacy uses a rank test.
   - Clustering uses Ward on Euclidean distance; legacy uses average linkage on 1 − Spearman.
   - Mutual Exclusivity stratifies across studies.
   - The per-assay "profiled" rule differs.
   - A default minimum of 5 altered samples changes which genes are tested, and so the q-values.
2. **Driver and query rules**
   - OQL is not applied in the oncoprint, Cancer Types Summary, Mutual Exclusivity or Pathways.
   - Hotspots are not counted as drivers.
   - Fusions are missing from the Mutations tab.
   - OncoKB levels ignore the tumour type.
3. **Display**
   - Percentages show one decimal, where legacy shows whole numbers.
   - Default charts, sorts and table columns differ.
   - Initial zoom fits all columns rather than the altered span.
4. **Caps**
   - Comparison tables stop at 300 rows (1,500 for expression).
   - Co-expression lists 200 genes.
   - CN Segments draws 300 samples.
   - Gene tables stop at 500 rows.
   - The Clinical tab tests 8 attributes.
5. **Missing surfaces**
   - The ⚙ driver settings menu.
   - Downloads on most tabs.
   - Plot types: stacked bar and waterfall.
   - Hazard ratios and the choice of survival endpoint.
   - The Study View's Clinical Data tab, Groups menu, virtual study and bookmark link.

## Not verified anywhere

- Most legacy hover tooltips, which don't render headless. Those IDs rest on the spec's code-derived lines.
- Logged-in features.
- Some multi-study and multi-sample paths, which were checked in code only. Each scorecard's header and notes name them.
