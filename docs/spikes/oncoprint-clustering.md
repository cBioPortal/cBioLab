# Spike: OncoPrint clustering at scale

2026-11-11. Measurement only; no repo code was changed. The scripts and raw timings were kept outside the repo.

**Question:** can legacy's method run at real cohort sizes (10k and 25k columns), in a request or in the browser? Legacy's method is average linkage on 1 − Spearman, over rows and columns, using the `tayden-clusterfck` library.

## Results

**Legacy's own code (clusterfck)**

| Columns | Time | Peak memory |
|---|---|---|
| 4k | 20–34 s | |
| 8k | 105–225 s | ~1 GB |
| 10k (extrapolated) | ~3–7 min | ~1.45 GB |
| 25k (extrapolated) | ~28–83 min | ~8.4 GB, more than a browser tab holds |
| msk_chord_2024 CNA, real data (7,689 columns after legacy skips the all-null/0 ones) | 84.5 s | 1.2 GB |

**Legacy on cbioportal.org**

| Study | Columns | Result |
|---|---|---|
| msk_impact_2017, msk_chord_2024 | | No heatmap profile, so these studies can't be clustered at all. |
| pancan_pcawg_2020 | 2,922 | Clusters in ~1.6 s. |
| msk_impact_50k_2026 signatures | 54k | Column clustering never returns. With the heap capped at 1 GB the page crashed at 145 s; uncapped it would need ~23 GB. |

**Other methods**

| Method | Exact? | 10k | 20k | 25k | Memory |
|---|---|---|---|---|---|
| cBioLab's current Ward, cap removed | | 6.5–19.5 s | | 30–110 s | <190 MB |
| Legacy's method, fast implementation (Float32, nearest-neighbour chain) | exact | 8–15 s, 0.3 GB | 68 s, 0.9 GB | ~100 s, 1.3 GB (extrapolated) | |
| **Distinct-pattern clustering** | **exact** | | | **0.1–0.33 s** on real msk_chord_2024 | |
| Sampling: cluster 2,000 columns, place the rest | approximate, quality not measured | | | 2–6.5 s | <160 MB |
| ClickHouse computes the distances | | 33.6 s, distances alone | | | |

**How much distinct-pattern clustering saves depends on the data**

| Data | Columns | Distinct patterns |
|---|---|---|
| MSK CNA | 25k (69–87% all-null/0) | 29–602 |
| 5-gene expression | 25k | 114 rank patterns |
| 20-gene continuous expression | 25k | no reduction |

## Verdict

- **Inside a request**, we can match legacy's method exactly up to about **8–10k distinct patterns**.
- **As a background job**, about 20k.
- **At 25k distinct**, never.
- **Legacy itself fails above about 8–10k.** Its large MSK studies avoid the problem by having no heatmap profile.
- **The current 4,000 cap counts raw columns, so it is conservative.** Counting distinct patterns would let real MSK data through exactly.

## Recommendation

1. Switch to legacy's method: average linkage on 1 − Spearman, rows and columns, with all-null/0 columns placed last. Cluster the distinct rank patterns, weighted by how often each occurs.
2. Cap on distinct patterns, about 8,000 (~5–10 s), not on raw columns.
3. Past the cap, cluster a sample of 2,000 patterns and place the rest next to their nearest sampled pattern. Mark the result approximate, in the figure and in its method record.
4. Don't compute distances in ClickHouse, and don't precompute per study: the result depends on the cohort, genes and profile. Use the existing result cache.
5. Say what was done in the UI:
   - exact: "Clustered: average linkage, 1 − Spearman; 17,351 columns with no data placed last; 7,689 columns = 602 patterns";
   - approximate: "Approximate: 2,000 of N patterns clustered; others placed next to their nearest";
   - over the hard cap: refuse and name the limit.

## Caveats

- **Synthetic expression:** above 6,272 columns, expression data was resampled from the study with 1% jitter. Everything else is real ClickHouse data.
- **Ties:** legacy's distances are heavily tied, so its tree isn't unique. The fast implementation matches clusterfck to 1.5e-7 on tie-free data, but differs on real data where ties are broken differently.
- **Runs skipped to stay under 1.5 GB:** legacy at 10k dense, the fast exact method at 25k, and ClickHouse at 25k.
- **The live 54k run** had only V8's 1 GB heap cap as a guard, so the browser process may briefly have gone over 1.5 GB.
