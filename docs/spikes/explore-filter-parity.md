# Spike: what Explore filter parity costs (exclude the chart's own filter, fixed bins)

2026-11-11. Measurement only; no repo code was changed. The scripts and raw timings were kept outside the repo.

## Setup

- **What runs:** `bench.ts` imports the repo's `buildExplore` / `buildExploreFederated`, `compileCohortDef`, `clinicalTable`, `chQuery` and `dataBins`, and calls them the way `app/api/explore/route.ts` `exploreFor` does: no attributes list, no Next result cache, in node directly.
- **Measured:** server-side CPU and `read_bytes` come from `system.query_log`, via `log_comment` tags polled across both replicas.
- **Database:** ClickHouse Cloud 26.6, with 2 replicas shared with other sessions, so the timings are noisy.
- **Runs:** each figure is the median of 5 warm runs (min–max), plus the cold first run.
- **Scopes:**

  | Scope | Studies | Patients | Categorical facets | Histograms |
  |---|---|---|---|---|
  | `chord` | `msk_chord_2024` | | 41 | 9 |
  | `chord_genie` | `msk_chord_2024` + `genie_public` | ~270k | 49 | 14 |

- **Filters:** each count adds to the one before.
  1. `CANCER_TYPE = NSCLC`
  2. + `MUTATION_COUNT (2,10]`
  4. + `FGA (0.1,0.4]` + `TP53: MUT`

**Variants**

| Variant | What it does |
|---|---|
| **A** | Today's request. It already counts drafted *categorical* charts without their own clause (`draftedClinical`), so the parity gap is numeric only. |
| **Bt** | A plus, per filtered numeric chart, its values without its own clause, run in parallel. |
| **Bf** | Naive parity: A plus one whole Explore request per filtered chart without its own clause, run in parallel. |
| **C** | Single scan. A per-sample bitmask with bit k set when the sample passes every filter but k, OR'd per patient. One `GROUP BY type, attr, value` returns `uniqExactIf(id, bitTest(pm, k))`. The same pass returns `n_all`, the unfiltered distribution, for the fixed bins. |
| **C2** | C with the mask held only for samples that fail at most one filter (`LEFT ANY JOIN`). |
| **C3** | C2 with the mask uploaded as an external table when it is 50k rows or fewer. |
| **Cg** | The gene table's altered count, using the same mask. |
| **D** | Fixed bins, uncached. |

**Correctness:** C, C2 and C3 gave **0 mismatches** against today's numbers, over 3,320–24,770 values per check.

## Results

Times are wall ms per click. CPU and MB are server-side.

| Scope | Filters | Variant | Cold | Warm median (min–max) | Queries | CPU ms | MB read |
|---|---|---|---|---|---|---|---|
| chord | 0 | A | 565 | 436 (410–505) | 23 | 1,790 | 346 |
| chord | 0 | C2 | 140 | 146 | 1 | 616 | 74 |
| chord | 0 | D | 112 | 106 | 1 | 172 | 22 |
| chord | 1 | A | 495 | 673 (576–830) | 25 | 1,682 | 398 |
| chord | 1 | Bt | 508 | 647 | 25 | 1,681 | 398 |
| chord | 1 | Bf | 777 | 790 | 48 | 3,495 | 744 |
| chord | 1 | C / C2 / C3 | 297 / 368 / 256 | 336 / 302 / 344 | 1/1/2 | 994 / 934 / 893 | 106 / 90 / 83 |
| chord | 2 | A | 861 | 750 (661–1,869) | 26 | 1,743 | 433 |
| chord | 2 | Bt | 1,048 | 733 | 27 | 1,807 | 449 |
| chord | 2 | Bf | 1,220 | 1,752 | 76 | 5,100 | 1,225 |
| chord | 2 | C / C2 / C3 | 514 / 446 / 508 | 451 / 357 / 548 | 1/1/2 | 1,185 / 1,042 / 988 | 133 / 104 / 91 |
| chord | 4 | A | 1,310 | 1,528 (1,147–7,661) | 27 | 2,220 | 530 |
| chord | 4 | Bt | 1,396 | 1,832 | 29 | 2,703 | 610 |
| chord | 4 | Bf | 3,004 | 2,269 | 132 | 9,696 | 2,391 |
| chord | 4 | C / C2 / C3 | 981 / 531 / 433 | 667 / 487 / 582 | 1/1/2 | 1,536 / 1,136 / 1,005 | 177 / 126 / 101 |
| chord | 4 | Cg | 141 | 184 | 1 | 214 | 36 |
| chord_genie | 0 | A | 2,416 | 2,727 | 46 | 11,773 | 1,829 |
| chord_genie | 0 | C2 | 1,131 | 3,084 (960–4,236) | 2 | 5,086 | 533 |
| chord_genie | 0 | D | 1,178 | 1,168 | 2 | 1,473 | 203 |
| chord_genie | 1 | A | 6,433 | 1,953 | 50 | 8,696 | 2,255 |
| chord_genie | 1 | Bt | 10,712 | 1,748 | 50 | 8,594 | 2,255 |
| chord_genie | 1 | Bf | 9,142 | 3,309 | 96 | 20,210 | 4,084 |
| chord_genie | 1 | C / C2 / C3 | 3,968 / 3,031 / 3,656 | 2,251 / 1,940 / 2,328 | 2/2/4 | 8,309 / 7,167 / 7,150 | 839 / 692 / 622 |
| chord_genie | 2 | A | 2,397 | 1,967 | 52 | 8,905 | 2,523 |
| chord_genie | 2 | Bt | 1,849 | 1,834 | 54 | 9,637 | 2,670 |
| chord_genie | 2 | Bf | 4,863 | 5,155 | 153 | 37,790 | 8,383 |
| chord_genie | 2 | C / C2 / C3 | 2,417 / 2,297 / 2,632 | 2,321 / 2,052 / 2,443 | 2/2/4 | 9,677 / 8,170 / 8,853 | 1,060 / 802 / 911 |
| chord_genie | 4 | A | 2,818 | 3,044 | 54 | 11,917 | 3,286 |
| chord_genie | 4 | Bt | 2,929 | 3,333 | 58 | 15,499 | 3,991 |
| chord_genie | 4 | Bf | 7,785 | 6,331 | 264 | 51,289 | 14,307 |
| chord_genie | 4 | C / C2 / C3 | 3,551 / 3,966 / 2,611 | 3,294 / 2,045 / 1,802 | 2/2/4 | 11,473 / 8,549 / 7,384 | 1,421 / 982 / 766 |
| chord_genie | 4 | Cg | 605 | 593 | 2 | 1,947 | 374 |

**Where A's time goes**

- **chord, 4 filters (1,183 ms):**

  | Stage | ms |
  |---|---|
  | Resolve the cohort | 110 |
  | 6 facet queries (parallel) | ~110 |
  | Categorical values | 41 |
  | 3 disjunctive counts, one after another | 189 + 192 + 176 |
  | Histograms | 39 |
  | 15 gene-table queries | ~100 |

  Two of the three disjunctive counts are for numeric attributes, and their rows are discarded (`buildExploreOne` keeps `catAttrs` only). The single-study path runs them one after another with `for … await`; the federated path pools them.
- **chord_genie, 4 filters (3,044 ms):** the categorical and disjunctive counts run from 732 to 2,717 ms (8 statements, 6.1 s CPU). Everything else is done by ~920 ms.

## Legacy (cbioportal.org), msk_chord_2024

`legacy.ts` replays, in parallel, the calls one click fires:
- `clinical-data-counts` with every filter;
- STATIC bin counts;
- one call per filtered chart without its own filter;
- mutated, CNA and SV genes;
- `filtered-samples`.

genie_public isn't on cbioportal.org, so there are no legacy numbers for that scope.

| Filters | Cold ms | Warm median (min–max) | Calls | KB |
|---|---|---|---|---|
| 0 | 696 | 188 (landing cache) | 6 | 5,990 |
| 1 | 889 | 3,172 (1,271–6,181) | 7 | 2,231 |
| 2 | 2,896 | 3,901 (2,502–9,005) | 8 | 1,391 |
| 4 | 10,703 | 6,651 (5,082–8,067) | 9 | 483 |

The own-filter-excluded calls are cheap (counts ~1.0–1.3 s, bins ~80 ms). Legacy's time goes to the counts with every filter and to the gene tables. **On the same clicks, cBioLab today is 2–5× faster than legacy.** The replay is a lower bound for legacy's real page, and its server is shared and noisy.

## Verdict

- **Parity is cheap.** Categorical charts already exclude their own filter, and Bt costs about 0 wall time and 0–30% more CPU.
- **Naive parity (Bf) is unacceptable** at 4 filters:

  | | Wall | CPU | Bytes |
  |---|---|---|---|
  | chord | 1.5 → 2.3 s | 2–4.4× | 2–4.5× |
  | chord_genie | 3.0 → 6.3 s | 2–4.4× | 2–4.5× |

- **The single scan (C2/C3) is exact and CPU-neutral.** It needs one statement per connection: 0.3–0.6 s on chord, 1.8–2.0 s on chord_genie. It doesn't need the cohort resolved first. Estimated clicks:

  | Scope | Filters | Today | With the scan |
  |---|---|---|---|
  | chord | 4 | 1.2–1.5 s | ~0.55 s |
  | chord | 2 | 0.75 s | ~0.4 s |
  | chord_genie | 4 | 3.0 s | ~2.0 s |

  These are estimates from the stage timings, not end-to-end runs. With no filters the scan is slower, so keep today's path there.
- **Fixed bins, uncached:** 0.1 s on chord, 1.2 s on chord_genie. The scan's `n_all` already provides the data, and a per-study cache removes the cost entirely.
- **Gene tables fit the mask pattern** (65–590 ms), but legacy keeps their own filter, so no change is needed.

## Recommended design

1. **Numeric parity now, at about zero cost.** For each drafted numeric attribute, run `numericValueCounts` without its own clause, with no `LIMIT … BY`, in parallel. Also:
   - drop the numeric disjunctive query whose rows are discarded;
   - make `buildExploreOne`'s sequential `for … await` a `Promise.all`, which saves ~0.4 s at chord with 4 filters.
2. **Fixed bins** from the unfiltered distribution, cached per (study set, attribute, `cacheVersion`) through `throughCache`. Each click's values are binned in TypeScript, with 0 queries once warm.
3. **Then the single scan.** One statement per connection replaces the categorical values, the disjunctive counts and the histograms. Upload the mask when it is 50k rows or fewer (C3), otherwise inline it (C2). Start it at t=0 from cached metadata. Update the method record (`lib/method.ts`, `check:methods`).
4. **Gene tables unchanged:** they keep their own filter, as in legacy.
5. **Caching:** keep the per-draft result cache and add a per-study cache for bin edges and metadata. Don't cache the mask.
