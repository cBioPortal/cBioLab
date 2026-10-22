# Performance vs. cbioportal.org

Measured 2026-09-02 from a single VPS, against the live public portal and a live
ClickHouse Cloud instance. Every number here was observed, not estimated. It is
a point-in-time snapshot: the public portal changes, and so does this project.

**The short version, which is not the flattering one:** we are *not* faster than
cbioportal.org. On a cached single chart the portal answers in 27 ms and nothing
we do comes close. What we do differently is move ~36× less data to reach the
same screen, because we aggregate in the database instead of shipping rows to
the browser. That buys scale and costs interactivity.

## How to reproduce

Time the portal's endpoints directly (`POST` bodies are the study-view filter
shape — note the filter is the body itself, not wrapped in `studyViewFilter`,
for `/mutated-genes/fetch`):

```bash
curl -s -X POST https://www.cbioportal.org/api/mutated-genes/fetch \
  -H 'Content-Type: application/json' -d '{"studyIds":["msk_chord_2024"]}' \
  -o /dev/null -w '%{time_total}s %{size_download} bytes\n'
```

Ours, with the app running on 3102:

```bash
curl -s -X POST http://127.0.0.1:3102/api/explore \
  -H 'Content-Type: application/json' -d '{"studies":["msk_chord_2024"]}' \
  -o /dev/null -w '%{time_total}s %{size_download} bytes\n'
```

Whole-page numbers came from Playwright with a `requestfinished` listener
summing response bodies until the charts appear.

## Baselines: is the comparison network-fair?

Both systems pay network cost, which matters before attributing anything to
architecture.

| hop | round trip |
|---|---|
| this host → cbioportal.org | 80–110 ms |
| this host → our ClickHouse Cloud | 10–45 ms warm (205 ms first) |

Our floor is lower but not by seconds. Network explains ~70–100 ms of their
latency, not the shape of anything below. Note that our app server is local
while theirs is remote — a real advantage to us on round-trip count, and a
reason to read per-call comparisons charitably toward the portal.

## Single operations: the portal wins, decisively

| operation | portal cold | portal warm | payload |
|---|---|---|---|
| mutated genes, whole study | 470 ms | **27 ms** | 152 KB |
| CNA genes, whole study | 681 ms | **39 ms** | 329 KB |
| mutated genes, filtered by cancer type | 764 ms | 494 ms | 145 KB |
| numeric bin counts, one attribute | 17 ms | 16 ms | 1 KB |

| operation | ours cold | ours warm | payload |
|---|---|---|---|
| all facets, one study | 1,246 ms | 601 ms | 151 KB |
| all facets, two studies (~250 k patients) | 2,141 ms | 1,933 ms | 165 KB |
| all facets, filtered | 602 ms | 670 ms | 148 KB |

Two things to take from this. First, **their cache is very good** — a 17× drop
from cold to warm on mutated genes. Second, **we have no application cache at
all**; our "warm" figure is ClickHouse's own page cache and nothing else. Any
comparison that ignores this is dishonest: a warm portal beats us on every
single chart.

The rows are not equivalent, though, which is the next section.

## Whole page: a wash on time, 36× apart on data

The like-for-like comparison is one screen against one screen: their study view
against our Explore tab.

| | cbioportal.org study view | cbio-lab Explore |
|---|---|---|
| time to charts | 3,797 ms | 3,511 ms |
| API calls | 22 | **3** |
| bytes to the browser | **18,003 KB** | **500 KB** |
| scope | MSK-CHORD, 25,040 samples | MSK-CHORD **+ GENIE public**, ~250 k patients |

Their four heaviest calls:

```
1763ms      0 KB  /api/copy-number-segments/fetch?projection=META
1175ms  12669 KB  /api/clinical-data/fetch?clinicalDataType=SAMPLE
 794ms      3 KB  /api/clinical-attributes/counts/fetch
 405ms   4940 KB  /api/filtered-samples/fetch
```

That 12.7 MB is the whole story. The portal ships raw per-sample clinical data
to the browser and builds the charts client-side; we compute counts in
ClickHouse and ship the counts. Same wall-clock, one thirty-sixth of the bytes,
for roughly ten times the patients.

## What that trade actually buys, and what it costs

**Buys:** latency that barely grows with cohort size, because rows are never
transferred. Our two-study Explore covers ~250 k patients in 1.9 s; the
transferred payload is 165 KB whether the cohort is 500 patients or 250,000.

**Costs: post-load interactivity, and this is a real loss.** Once the portal has
those 12.7 MB in the browser, re-filtering is instant and local. Every filter
click of ours is a ~600 ms server round trip. A user rapidly ticking facets will
find the portal more responsive after the first second, despite its slower
start. We are better at the first screen and worse at the tenth interaction.

## Why we look fast, stated plainly

Some of our advantage is architecture and some is work we simply do not do. Both
are real; only the first is a contribution.

**Architecture:**

- Columnar storage with pre-joined derived tables (`sample_derived`,
  `genomic_event_derived`, `clinical_data_derived`), so faceting is a scan and a
  `GROUP BY`, not a join graph.
- Aggregation pushed into the database. The one API response is counts.
- One round trip instead of 22.
- **`/api/column-store/*` returns 404 on the public portal**, so cbioportal.org
  is not on its ClickHouse path for these endpoints. Much of the remaining gap
  is columnar-vs-classic storage, not anything clever here.

**Work we do not do:**

- We cap everywhere: 500 genes per table, 20 values per facet, 14 histograms,
  250 attributes. The portal computes complete results.
- We skip whole features the study view loads: copy-number segments (1,763 ms in
  their trace), treatment sample counts, resource definitions, gene-panel matrix.
- OncoKB annotation is precomputed into a version-pinned store rather than
  resolved live.
- Our oncoprint is a server-rendered SVG (measured 542 ms query + 10 ms draw);
  theirs is an interactive canvas whose re-sorting is free after load, where
  ours is a re-run.
- None of our numbers include browser rendering. For a very large oncoprint the
  browser is likely the dominant cost and nothing here would show it.

## Per-view latency inside one analysis

Instrumented in the app itself (each view reports its own wall-clock; queries
within a view run concurrently, so a view is not the sum of its queries):

```
compare          916ms
survival         219ms
clinical         128ms
cooccurrence     190ms
hotspots         117ms
TOTAL           1720ms   (cohort evaluation 150ms)
```

`compare` dominates because it runs per cohort per gene with panel-aware
denominators. Everything else is well under 250 ms.

## Arbitrary sample lists: linear, competitive — then a hard wall

A cohort can be defined by an explicit id list (`{"kind":"patients","ids":[…]}`)
rather than a filter. This is the shape a "send me these 5,000 samples" workflow
produces.

| N ids | ours | portal (`sampleIdentifiers`) |
|---|---|---|
| 100 | 426 ms | 773 ms |
| 1,000 | 245 ms | 480 ms |
| 10,000 | 1,047 ms (117 KB request) | 778 ms (586 KB request) |
| 20,000 | 1,866 ms (~254 KB of SQL) | — |
| 22,000 | **fails** | — |

Growth is roughly linear and competitive with the portal, so an explicit list is
**not** disproportionately expensive. But we inline ids as SQL text, and at
~22,000 ids the statement exceeds ClickHouse's 256 KB `max_query_size`:

```
Code: 62. DB::Exception: Max query size exceeded
(can be increased with the `max_query_size` setting): Syntax error
```

The full MSK-CHORD cohort (24,950 patients) therefore **cannot be expressed as a
list at all**, while the portal handles a full-study list without complaint. It
fails loudly rather than truncating silently — invariant 1 holding — but it
surfaces a raw ClickHouse error rather than an application-level explanation.

Fixes, in increasing order of goodness:

1. Raise `max_query_size` on the connection. One line, moves the wall.
2. Chunk the list and union the parts. Removes the wall, adds round trips.
3. Stop inlining: stream ids into a temporary table and join. Removes the wall
   properly and makes request size independent of cohort size.

**Since measured again, and fixed with stored id sets.** Sample ids are longer than patient
ids, so the wall comes sooner for them: on `msk_chord_2024` (a compare and a clinical view),
12,000 sample ids ran and 13,000 failed with the same `max_query_size` error. Each view also
re-inlined the whole list, and the readback carried it back to the browser in every compiled
query: at 10,000 ids every id appeared four times in an 839 KB response. And the page keeps the
document in the URL (`?doc=`), which Node refuses past 16 KB of headers (431) — a reload or a
shared link broke at roughly 350 sample ids, long before ClickHouse did.

The fix is option 3 above, with the ids kept on the server: a list is saved once as a stored
id set (`lib/id-set-store.ts`) and a cohort names it, `{"kind":"sampleList","set":"<id>"}`. The
request reads the set from Postgres once (cached in memory; a set never changes) and each
statement that reads it carries it as a ClickHouse external table. Same documents, measured
with `runAnalysis` against the live warehouse:

| set | document | response | time | result |
|---|---|---|---|---|
| 10,000 msk_chord_2024 samples | 416 B | 23 KB | 2.2 s | ok |
| all 25,040 msk_chord_2024 samples | 416 B | 23 KB | 4.9 s | ok (inline: fails) |
| 60,000 samples, msk_chord_2024 + genie_public | 504 B | 45 KB | 7.3 s | ok |

Saving the 60,000-id set (matching every id to the studies' samples, then storing it) took
0.9 s. An inline list is still accepted up to `INLINE_ID_SQL_LIMIT` (200 KB of ids per study,
about 10,000 sample ids) and refused by name past it, pointing at a stored set, instead of
failing with ClickHouse's syntax error.

One further constraint: a `patients` leaf is refused for aggregate-only
participants (see [DATA-BOUNDARY.md](DATA-BOUNDARY.md)), so a list-defined
cohort is **inherently non-federatable** — it cannot cross an instance boundary
at any size.

## A bug this exercise found

`/api/explore` was firing **twice** on load — two concurrent, identical faceting
passes over ClickHouse, one of whose results was discarded. `exFetchSeq`
superseded stale *results*, so the page looked correct while doing double the
database work; only a request trace revealed it. Now deduplicated on
`(studies, draft, geneSearch)`.

That is the general lesson of this document: none of it was visible from the UI.
The page looked fine at every point, including while doing twice the necessary
work and while being twenty times slower than the thing it is meant to improve
on.

## Where to look next

- **We have no cache.** The portal's biggest advantage is one we have not tried
  to compete with. A result cache keyed on the compiled SQL would be
  straightforward and would close most of the single-chart gap.
- **Post-load interactivity** was our weakest dimension and the one users feel
  most. Two causes were found and fixed — see *Interactive filtering* below.
- **`compare` at 916 ms** is the slowest view and the obvious optimisation
  target.
- **The 20 k id ceiling** should be lifted before anyone tries a real
  sample-list workflow.

---

# Interactive filtering

Measured 2026-09-16 against a cBioPortal **v7.0.0** instance pointed at *this project's own
ClickHouse database*, with the same credentials, on this box — so data, hardware and engine are
held constant and only the architecture differs. Production `cbioportal.org` reports
`v7.1.1` / `dbVersion 3.0.0`, i.e. the same ClickHouse architecture one minor version ahead.

**This supersedes the claim earlier in this document that `/api/column-store/*` 404s mean
cbioportal.org "is not on its ClickHouse path".** v7 dropped the `column-store` path prefix; the
404 means the prefix is gone, not the architecture. The portal computes its study-view counts in
ClickHouse, as we do. The "36x less data" figure above was measured against the v6 architecture
that shipped per-sample clinical data to the browser; against v7 the payload ratio is 3–9.5x.

## What the portal's cache does and does not buy

`persistence.cache_type` / `persistence.cache_type_clickhouse` (`no-cache` by default; Redis and
Ehcache are the options). With Redis on, the same unfiltered request goes **6.14s → 0.026s**, a
236x speedup — that is where a "27 ms warm" figure comes from, and any single-chart comparison
against a warm portal is measuring the cache, not the design.

It does not, however, help exploration. Running the filter ladder with a **new** combination at
each step — which is what faceting is — cache-on and cache-off are indistinguishable:

| depth | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| portal, no cache | 4,865 | 3,651 | 4,038 | 3,760 | 4,483 |
| portal, Redis | 4,292 | 3,226 | 3,647 | 4,105 | 5,043 |
| cbio-lab | 1,346 | 590 | 939 | 864 | 1,039 |

v7.0.1+ makes this explicit: all 21 `StudyViewService` methods carry
`condition = "... && isUnfilteredQuery(#studyViewFilter)"`. It is a landing-page cache by design.
On repeat-identical requests, where the cache works perfectly, the portal returns in 561–722ms
against our **uncached** 724–840ms.

Numbers agree: unfiltered, our top-10 mutated genes match the portal's exactly, to the sample
(`TP53 13124/25040` both sides). Filtered they differ by <0.2 percentage points because the
denominators differ — **the portal filters samples, we filter patients and include all their
samples** (5,957 vs 6,007 for `ONCOTREE_CODE=LUAD`). Both are defensible; they are not the same
question, and a reader comparing side by side will notice.

## Two fixes, and what each was worth

**1. Abandoned requests were run to completion.** `exFetchSeq` discarded superseded *results*,
but the request kept running — all ~30 ClickHouse queries of an answer nobody would read, holding
database capacity the live request then queued behind. Four facet clicks 250ms apart:

| | final answer | that request | inflation vs isolated |
|---|---|---|---|
| before | t+3,826ms | 3,072ms | **2.0x** |
| after | t+1,814ms | 1,049ms | **1.0x** |

The client now aborts the previous request on every click; the route runs inside
`withChContext({ signal: req.signal })`, so a query that reaches the front of the queue after its
reader left is never started, and `cancel_http_readonly_queries_on_client_close=1` makes
ClickHouse stop the ones already running. Isolated latency was never the problem — repeated
measurement puts run-to-run spread at 1.1–1.6x — so this is entirely a contention fix.

**2. The cohort was re-evaluated inside every facet query.** The compiled definition was spliced
into each of ~30 queries per screen; measured on one facet query, carrying it cost **48ms → 94ms
(2.0x)**. It is now resolved once per study per request and carried as a ClickHouse **external
table** (`_cohort_<study>`), which also sidesteps the 256KB `max_query_size` wall an inlined id
list hits at ~22,000 patients — the ceiling recorded earlier in this document, measured again
here: 15,872 ids still fit in one statement, MSK-CHORD's 24,950 do not, and the external table
carries all of them at no extra wall clock. Total database work for a two-study depth-4 request:
**6,357ms → 3,568ms (-44%)**.

End to end, 9 interleaved runs per cell, production builds of both versions:

| | depth 0 | depth 2 | depth 4 |
|---|---|---|---|
| `msk_chord_2024` | +2% | **-8%** | **-21%** |
| `msk_chord_2024` + `genie_public` | +2% | **-16%** | **-22%** |

Depth 0 has no draft, so the change cannot affect it; the +2% on both rows is the harness's own
noise floor and is what makes the filtered numbers trustworthy. The win grows with filter depth,
because that is what makes the predicate expensive.

Above `EXPLORE_COHORT_EXTERNAL_LIMIT` (50,000 patients) the resolved cohort is not shipped and
the predicate goes back inline — the bound is about payload, not correctness, and the fallback is
what this code always did. There is no context to hold the cohort in MCP tools, scripts and
tests, which take the same inline path.

Verified by comparing ~11,600 values — every facet count, bin, gene-table row, event, case list
and gene-status slice — across 7 request shapes against the pre-change build: all identical.
(Responses are *not* byte-identical run to run, before or after: `ORDER BY n DESC` ties resolve
arbitrarily. Two runs of the same build differ the same way.)

## The bug this introduced, and the rule that comes out of it

Wiring the reader's abort signal through to ClickHouse created a new error that existing code
had never had to consider, and one `catch` was waiting for it.

`studyRouting()` asks each instance which studies it holds, tolerates a failure — "an
unreachable instance simply contributes no studies" — and memoizes the result for the life of
the process. That was correct while the only possible error meant the instance really was
unreachable. An abort means something completely different: **the reader left**. It says nothing
about the data.

So one cancelled request — a facet ticked twice quickly, a browser navigating away — landing
while the routing map was still being built would be swallowed, an **empty map cached**, and
from then on *every request from every user* answered `unknown study <x>` with a 400. The page
rendered no facets. Only a restart cleared it. In production that is an outage triggered by an
ordinary click.

It surfaced as a flaky e2e suite: 4 failures in 5 cold runs on the branch, 0 in 2 on master,
and **never** on a warm server — because a process that had already cached a good map could not
reproduce it. Three plausible explanations (memory pressure, a mid-suite kill, the external
cohort table) each survived a round of evidence before being disproved; what found it was
logging the error the route was swallowing into its 400.

The rule, which is now guarded by `test/abort-cache.test.ts` (mutation-verified against both
halves):

> **A cancelled query is not an answer.** Any `catch` that folds an error into a remembered
> value must first ask whether the error was a cancellation — `isAbortError()` in `lib/ch.ts`.
> And memoize only a COMPLETE result: a partial one outlives the outage that produced it, so a
> transient failure looks permanent.

`validStudies()` lost its second cache for the same reason — a cache on top of a cache can
outlive the bad value underneath it.

Asking "where else does a `catch` feed a cached value?" found three more sites that the same
signal can now reach, fixed before they bit anyone:

| site | what it cached on any error | severity |
|---|---|---|
| `oncokbPin()` | a **null pin**, for a 5-minute TTL | every `OQL ... DRIVER` clause refused for 5 minutes |
| `syncedStudies()` | an **empty list**, with **no TTL** | the process believes no study is synced, for its whole life — driver annotation silently thins |
| `buildAnnotationIndex()` | not cached, but degrades to the **mock** annotator | a cancelled request would be answered with non-OncoKB calls |

## What did not work

Raising `CLICKHOUSE_MAX_INFLIGHT` from 8 to 24 changed the rapid-click inflation from 2.0x to
1.8x and isolated latency not at all. Fired 1/4/8/16/24 identical real queries at ClickHouse
Cloud directly, throughput saturates at ~4–5x regardless of N. **The database is the ceiling, so
the fix is doing less work, not scheduling it harder** — which is why both fixes above remove
work rather than parallelise it.

## Clinical course (`course` view)

Measured on `msk_chord_2024`, 24,950 patients, two cohorts, two event types, 3-month bins over
−12…60 months: **~700–900ms** server wall-clock, of which under 25ms is drawing the SVG. That is
two queries per cohort (a structural `timelineSpan` probe and the binned `eventCourse`), run
concurrently.

The first prototype cross-joined every patient against every bin and took **881ms for one
cohort**. Computing each span's bin range arithmetically instead — `floor((day - anchor) / w)`,
clamped to the window — brought the same query to **277ms**, because the bin range is derived per
row rather than materialized as a product. The clamp matters for more than speed: `msk_met_2021`
anchors ~6,266 days from day 0, which without clamping is a 2,000-bin range per patient.

## Treatment sequences (`sequence` view)

~600ms for one cohort of 24,950 patients (~1.5s for two cohorts plus the label-key probe): one query that groups treatment records into lines with two window
functions, then reads each line's successor with `leadInFrame`. Cost is flat in the number of
lines followed, since `maxSteps` only filters the final aggregation.

The row cap is 2,000 (was 500, which truncated real data): combination regimens have a long tail
— 51 distinct regimens fold into "other" even at `topN: 8`, covering 24% of first-line patients.
That is genuine regimen diversity, not a tuning artefact, and raising `topN` to 10 only moves it
to 20%.

## Derived facet OR groups

Ticking several buckets of one derived metric ORs them into `{any:[...]}`. The generic `any` path
unions its leaves, and every derived leaf recomputes its metric from scratch — a `GROUP BY` over
the study's whole `clinical_event` — so each extra bucket added a full scan. Federated over two
studies, Explore went **4.7s for one bucket to 13.3s for four**, which is slow enough that each
answer was superseded by the next click and the draft count never caught up.

Buckets of one metric now share a single scan with the ranges OR'd in the `WHERE`. Same counts,
**4.6s for four buckets and flat** in the number of buckets (3.7 / 3.2 / 4.6 for 1 / 2 / 4).

---

# Explore at scale, and what any change to it must not break

Measured 2026-09-10/11 against the live database. Read the first section before
optimising anything here: it is a correctness constraint, not a performance note.

## 1. The rule that outranks performance: panel-aware denominators

Samples are sequenced with different gene panels, **within a single study as well
as across studies**. `nsclc_ctdx_msk_2022` uses 8 different panels for copy
number; `msk_ch_2020` is 73% whole-exome and 27% panel; `brca_msk_erbb2_2026`
has 7 panels and no whole-exome at all.

A sample whose panel does not include a gene cannot report on that gene. It is
**not profiled** — not wild-type. So a gene's frequency is:

    altered for that gene  ÷  samples actually profiled for that gene

where `profiled(gene) = Σ(samples on panels containing the gene) + whole-exome samples`.

The tempting shortcut — dividing by the study total, or by the number of samples
in the current selection — **does not raise an error**. It returns a plausible
percentage that is simply wrong, always in the same direction: everything looks
rarer than it is. Injecting exactly that mistake produced:

| study | gene | correct | with the shortcut |
|---|---|---|---|
| `msk_ch_2020` | DNMT3A | 2559/7216 = 35.5% | 2559/24146 = 10.6% |
| `nsclc_ctdx_msk_2022` | CDKN2A (deep del) | 159/1476 = 10.8% | 159/2621 = 6.1% |
| `histiocytosis_cobi_msk_2019` | BRAF | 8/47 = 17.0% | 8/52 = 15.4% |

The last row is why this is guarded by tests rather than by care: a five-sample
difference, a number nobody would question.

**Because profiling is a property of (sample, gene), both the numerator and the
denominator are additive over samples.** That is what makes any pooling safe —
summing `altered` and summing `profiled` across studies and then dividing gives
exactly the per-study answer. `mergeExplore` already relies on this. What is
never safe is averaging per-study percentages, which would weigh a 30-sample
study the same as a 30,000-sample one.

This also makes the denominator **cheap to compute in bulk**: profiling status is
already reduced into `sample_to_gene_panel_derived` (1.45M rows) and
`gene_panel_to_gene_derived` (70,694 rows), so the correct denominator for every
(study, gene) pair across all 560 studies is one join over ~1.5M rows — measured
at 0.46s. Correctness here does not cost performance, and nothing needs to be
traded against it.

Guarded by `test/denominator.test.ts` (source tripwire, no database) and
`npm run check:denominators` (live differential with pinned values, in the e2e
gate). Both were mutation-verified against the shortcut above. Note that the
additivity half of the check stayed GREEN under that mutation — only the pinned
absolute values caught it, because two compensating errors agree with each other.

**Off-panel calls belong to neither side of the frequency.** A sample can carry a call in a gene
its panel does not cover (`genomic_event_derived.off_panel`) — 0.37% of mutation calls on
panel-sequenced samples, 1.3% of CNA calls and 37% of SV calls (a fusion is recorded under both
partners, and the partner is often not on the panel). That sample is not in `profiled`, so the
numerator must not count it either: cBioPortal's study view shows it in "#"
(`numberOfAlteredCases`) and leaves it out of Freq (`numberOfAlteredCasesOnPanel / numberOfProfiledCases`),
and its results view counts a sample altered only where it was also sequenced. Ours does both
(`GeneTableRow.alteredOnPanel`; the OncoPrint leaves the cell not profiled and counts the calls
in `stats.offPanel`). Counting them read SV EWSR1 at 72/407 = 17.7% where the portal shows 0/407.
`check:portal` compares all three numbers for every row of a selection mixing panel and
whole-exome studies.

## 2. How Explore scaled per study

**Superseded by §3d:** every Explore query now runs once per connection. This section records
the per-study design it replaced, and the measurements that motivated the change.

`buildExploreFederated` called `buildExplore` once **per study**, and each call
makes 41 ClickHouse round trips (measured; an earlier draft of this section said
~17). At 560 studies that is ~23,000 queries for one page load. Cost is
therefore linear in study *count*, not in patients. §3b records what pooling the
13 gene-table round trips removed from that.

| studies | patients | all attributes | 20-attribute list |
|---|---|---|---|
| 1 | 48,179 | 2.4s · 25 facets | 1.6s · 10 facets |
| 8 | 193,788 | 3.9s · 179 | 2.6s · 19 |
| 32 | 259,569 | 9.9s · 697 | 7.5s · 19 |
| 64 | 293,454 | 17.6s · 1,634 | 14.6s · 20 |
| 128 | 575,915 | — | 29.4s · 20 |
| 256 | 613,643 | — | 54.3s · 20 |
| **560** | **633,924** | — | **137.3s · 21** |

Single studies, warm — cost tracks patients *and* attribute count, neither alone:
`msk_ch_2023` (42,714 patients, 6 attributes) 3.6s; `msk_chord_2024` (24,950
patients, 50 attributes) 5.7s; `genie_public` (242,866 patients, 25 attributes)
15.2s.

Three conclusions:

- **Capping attributes is a UI fix, not a performance fix.** Restricting to 20
  common attributes cuts the facet count 80x (1,634 → 20) and the latency only
  17%. 1,634 facets is unreadable, so the cap is worth having — but it does not
  address the ceiling.
- **In the browser, though, the cap is the fix.** Measured 2026-10-21 over 32 studies with the
  server's answer already cached (0.7s): drawing every attribute meant 486 facet cards, 7,521
  value rows (5,935 of them inside lists' hidden scroll areas) and ~52,000 DOM nodes, built in
  one 4.4s main-thread task; a facet click froze the page 2.9s before its request was even sent.
  Explore now draws cBioPortal's default — the first 20 attributes with priority above 0,
  plus any the draft filters on; the rest are one checkbox away in "+ Add chart" — and the same
  selection is 20 cards and ~6,200 nodes, 1.0s to draw and 0.7s on a click (React dev build,
  both sides). The server still computes every attribute, which keeps the checklist complete.
- **`next dev` is about 4× slower than a production build for Explore.** The same 32-study
  request with one filter, sent with an unseen filter value so neither server's result cache
  answered it: 29.8s and 30.4s through the dev server, 7.3s and 8.0s through a production build
  of the same tree (and ~7s calling `buildExploreFederated` directly). Profiling the dev server
  put ~60% of its CPU in React's development-only async debugging, which records a stack trace
  for every promise created inside a `'use cache'` function; the rest is unoptimised dev code.
  Measure server time on a production build. (Measured before §3d; the ratio is what carries.)
- **Production caps out well below the box.** `app/api/explore/route.ts` sets
  `maxDuration = 60`, so Vercel fails somewhere around 256 studies regardless.
- **The default landing state is slow.** `DEFAULT_EXPLORE_STUDIES` is
  `["msk_chord_2024", "genie_public"]` — two studies, one of them 242k patients.

### Correction to earlier figures in this repo's history

An earlier run of this ladder reported 18.3s for one study and 97.6s for 64, and
an outright failure at 560. Those numbers were taken while a second full-scale
Explore ran against the same server, and are roughly 5x too slow. The table above
was measured on an idle server and supersedes them.

## 3. Why per-study, and what a pooled version must keep

Five reasons the code fans out per study, of which one is load-bearing:

1. **Cross-instance federation** — real. A study may live in another database or
   another institution's instance, and one SQL statement cannot span them. But
   the routing here is **546 studies on one connection and 14 on another**: the
   generality is paid 560 times to serve a 2-way split.
2. **The cohort compiler is single-study** — real, but only when a draft filter
   exists. The measurements above used no draft and still cost 137s.
3. **Panel-aware denominators** — per-study *grouping*, which SQL does natively;
   not a reason for separate round trips. See §1: the panel join is what makes
   the number right, not the study filter.
4. **Vocabularies are not harmonised** — a labelling decision. One query can
   return `(study, attribute, value, n)` and the "do not merge these" rule stays
   where it is.
5. **The OncoKB pin** — global. Not per-study at all.

So the shape of a faster version is **partition by connection, not by study**:
one set of queries per connection covering all its studies with
`GROUP BY cancer_study_identifier`, merged as today. Federation survives — a peer
study still goes over MCP, a study on another instance still gets its own pass.

### What pooling actually costs, measured

Measured directly against the database, not through the endpoint:

| pooled query, ALL studies at once | time | rows |
|---|---|---|
| clinical facets (20 common attributes) | 0.41s | — |
| panel-aware denominator, every (study, gene) | **0.46s** | 86,178 |
| altered counts, mutations, top 500 per study | 1.40s | 222,682 |
| **complete gene table — altered AND profiled, every study** | **1.77s** | 222,682 |
| the same for all three alteration types | 4.40s | 388,899 |

For comparison, one study's gene-table numerator alone currently takes 0.25s,
and there are three of them per study among the 41 round trips.

The pooled gene table was checked against the pinned values and reproduces them
exactly — `msk_ch_2020` DNMT3A `2559/7216`, `histiocytosis_cobi_msk_2019` BRAF
`8/47`.

**Correction to an earlier draft of this section.** It recommended pooling the
clinical facets first and leaving the gene tables alone, on the grounds that the
gene tables are where the denominator rule lives and therefore the risky part.
That was wrong, and backwards:

- The denominator is **not** recomputed from the 50M-row event table. Profiling
  status is already reduced into `sample_to_gene_panel_derived` (1.45M rows) and
  `gene_panel_to_gene_derived` (70,694 rows). Joining those across every study
  touches ~1.5M rows and costs 0.46s.
- It is **correct by construction when pooled**, because profiling is a property
  of `(sample, panel, gene)`. The `GROUP BY study` is presentation; the join is
  what makes the number right. The same join that is right for one study is right
  for 560 in one pass.
- So the gene tables are simultaneously the **most expensive** part of the
  per-study fan-out and the **cheapest and safest** to pool.

The revised order is therefore the opposite: **pool the gene tables first**, since
that is where the time is, and the pinned differential already covers the only
thing that could go wrong.

Two limits on these numbers, stated so they are not over-read:

- They are raw SQL. The endpoint also merges results, and a **drafted** Explore
  still needs per-study compiled predicates from `compileCohortDef` — the pooled
  figures above are for the unfiltered case.
- `LIMIT n BY study` keeps the per-study cap, but the pooled result set is ~560x
  larger (222,682 gene rows against 500). That is a payload question to design,
  not inherit.

## 3b. What pooling actually delivered, measured

Shipped: `geneTables()` in `lib/explore.ts` takes a **list** of studies, and
`buildExploreFederated` calls it once per connection instead of once per study.
One study is the list of length one, so there is a single implementation of the
panel-aware denominator rather than a pooled copy that could drift from it.

**Round-trip counts, measured by instrumenting `post()` in `lib/ch.ts`** — and
correcting the "~17" repeated earlier in this document, which was wrong:

| | round trips |
|---|---|
| one study, full | **41** |
| one study, `skipGenes` | 28 |
| → the gene tables | **13** |
| 8 studies federated, pooled | 333 |

333 accounts exactly: `8 × 28` per-study, `+ 13` pooled once, `+ 96` for pass-2
histograms (6 numeric facets × 8 studies × 2 queries). Nothing unexplained.

**End to end, through `buildExploreFederated`, 20 common attributes, no draft.**
Both columns are the same study list on the same idle server with equally warm
caches — the first pooled run showed 1 study at 1432ms purely because it ran
cold, which is why the A/B was repeated rather than reported:

| studies | patients | master | pooled | |
|---|---|---|---|---|
| 1 | 48,179 | 829ms | 815ms | unchanged, as designed |
| 8 | 193,788 | 2.2s | 1.4s | 1.6× |
| 32 | 259,133 | 9.2s | 4.2s | 2.2× |
| 64 | 292,094 | 18.4s | 7.8s | 2.4× |
| 128 | 327,607 | 37.5s | 14.6s | 2.6× |
| 256 | 361,706 | 65.9s | 28.6s | 2.3× |
| **546** | **379,989** | **126.4s** | **60.0s** | **2.1×** |

Half the round trips removed buys rather more than half the time, because the
gene queries were the expensive ones, not merely the numerous ones.

**This does not clear the Vercel ceiling.** `app/api/explore/route.ts` sets
`maxDuration = 60`, and 546 studies now lands at 60.0s. The remaining 28
per-study round trips are the ceiling; pooling those is the next step, and the
same argument applies to them — they are all `GROUP BY` away from being one
query per connection.

### Two denominator errors this work surfaced

Both were live on `master`, neither was introduced by pooling.

**1. CNA frequencies were reported at half their true value, in 101 studies.**
`sample_to_gene_panel_derived` holds one row per (sample, panel,
**genetic_profile**). Every TCGA study publishes both a discrete and a linear CNA
profile, so each sample appears twice, and a denominator built with `count()`
doubled. `brca_tcga` reported MYC amplification at `229/2160 = 10.6%`; the truth
is `229/1080 = 21.2%`, which is what cBioPortal reports.

Measured scope, across the whole database:

| alteration type | studies | with duplicate rows | extra rows |
|---|---|---|---|
| MUTATION_EXTENDED | 540 | **0** | 0 |
| STRUCTURAL_VARIANT | 221 | **0** | 0 |
| COPY_NUMBER_ALTERATION | 353 | **101** | 37,994 of 282,726 |

Fixed by counting `uniqExact(sample_unique_id)` rather than rows. One residual
remains and is deliberate: a sample on two **different** panels is still counted
once per panel, because deduplicating that needs the sample-level join the
per-panel CTE exists to avoid (13s on a 290k-sample study). It is 328 samples
across the entire database, against 37,666 cured.

**2. The per-study merge dropped profiled samples, biasing frequencies high.**
A study's gene table has a row only for genes it saw altered, and the merge sums
`profiled` across the rows that exist. So a study that profiled a gene and never
saw it mutated contributed nothing to the denominator. Pooling counts it.
Measured over 5 studies: 500 of 500 CNA rows and 486 of 500 mutation rows
recover samples the per-study sum drops. `together 713/10154 vs summed
713/10109` — identical numerator, larger and correct denominator.

This is why `npm run check:denominators` asserts the numerator is exactly
additive but the denominator only that pooled is **never smaller**, and pins the
absolute value against an independently shaped query. The numerator check
compares one gene at a time: both tables are cut at `GENE_TABLE_LIMIT`, so
comparing the truncated lists would measure the cut rather than the arithmetic.
All of it is mutation-verified — restoring `count()` turns the independent-count
check and the `brca_tcga` pins red, with `229/1080 -> 229/2160` in the output.

## 3c. Pooling the analysis views: measured, and not done

§3's rule — partition by connection, not by study — was measured on **Explore**, where
per-study round trips had piled up (28 per study) and 546 studies met Vercel's 60 s ceiling.
The analysis views added later (`cancertypes`, `overlap`, `enrichment`, `assays`, `correlates`,
`genome`, `pathways`, `paired`, `clonality`, `incidence`, `labs`, `diffexpr`) also run one query per
(cohort, study) — but they send them **all at once**. Pooling them was built and measured before
deciding (October 2026), and is **not** shipped: on this ClickHouse Cloud deployment it is slower.

Two pooled forms against what the views do now, on one builder (`enrichAlteredSql`, mutation
counts per gene) for a TP53-mutant / wild-type pair of cohorts across TCGA PanCancer studies.
Two runs each; all three return identical sums.

| | 8 studies (16 pieces) | 32 studies (64 pieces) |
|---|---|---|
| per (cohort, study) query, sent in parallel — **what the views do** | 0.6–0.7 s | 2.3–3.6 s |
| one scan, members joined in, `GROUP BY cohort, study` (§3's form) | 1.2–1.6 s | 3.7–5.8 s |
| each piece's own query side by side in one `UNION ALL` statement | 1.7–2.1 s | 6.3–11.3 s |

The `UNION ALL` form was built through every view (correct: the docs gate's pinned counts and
every method script reproduced unchanged) and measured whole: a six-view document over those
8 studies took **25.6 s per-study and 54.9 s pooled**; `enrichment` alone went from 49 queries in
1.7 s to 4 queries in 28 s. Fewer round trips did not buy time — parallel requests spread across
the cluster, one statement does not. The code is parked on the local branch
`session/more-features-pooled`.

So for the analysis views the rule is the opposite of §3's: **fan out per (cohort, study), in
parallel**. What would change that, and should be measured before acting on it:

- Very large cohorts. At several hundred studies the parallel requests may meet ClickHouse's
  concurrent-query limit; the answer then is batching the parallel requests, or the single-scan
  form for that case only — measured at ~546 studies first, not assumed.
- A different database deployment (one replica, or a server where round trips dominate).

The paged row views (`table`, `mutations`) are the exception, for a reason of correctness rather
than speed: a page of one global order can only be cut from all the rows sorted together, so they
combine every (cohort, study) part in one statement per connection.

## 3d. Explore pooled by connection: measured, and shipped (October 2026)

§3c's finding — parallel per-study queries beat one pooled statement — was measured on the
analysis views, whose queries are large. Explore's are small: averaging 26-35 ms, dominated by
the round trip, and `MAX_INFLIGHT = 8` (`lib/ch.ts`) runs them eight at a time, so its wall time
was summed query time ÷ 8, and every query removed was time saved. Of 1,165 queries for 32
studies, 896 were histograms (14 numeric facets × 32 studies × bins and outliers), 13 the
already-pooled gene tables, the rest ~8 facet queries per study; a draft added a per-study
fallback for the gene tables (416 queries).

Every Explore query now runs once per connection over all its studies, the study in its
`GROUP BY` and `LIMIT … BY study` where it had a per-study limit, and each study's rows are
handed back to it (`prefetchFacets`), so classification, disjunctive values and `mergeExplore`
are unchanged. Histograms bin every study at once against the shared edges, outlier bars in the
same scan (`pooledHistograms`). Under a draft each study's cohort is resolved once up front and
the pooled queries read them as one set of study-qualified ids (`pooledPatientSet`). One study is
the list of length one: single-study output is identical to the per-study code's.

Engine time, best of two alternating runs, the production build matching the engine for this
path (7.2s engine against 7.3-8.0s for 32 studies with a filter before the change):

| studies | no draft: per study → pooled | with a draft |
|---|---|---|
| 2 | 334ms → 154ms (57 → 27 queries) | 503ms → 190ms |
| 8 | 875ms → 296ms | 1.5s → 0.32s |
| 32 | 3.1s → 0.46s (1,165 → 34) | 6.4s → 0.88s (1,594 → 98) |
| 64 | 6.5s → 1.0s | 13.3s → 1.7s |
| 128 | 13.3s → 1.9s (4,621 → 34) | 23.5s → 3.4s (6,374 → 290) |
| 551 | 48.7s → 4.7s (19,849 → 33) | — |

Two wrong answers it removed, both live for multi-study Explore before it:

- **Histograms were summed across studies by bar position**, while a study carries the "<=" /
  ">" bars only when it has values there: bars shifted into their neighbours and outlier bars
  vanished. 14 of 14 numeric facets were wrong over 32 studies, with and without a draft; pooled,
  14/14 equal an independently shaped per-(study, bin) count.
- **Under a draft the gene tables fell back to per-study tables merged by gene**, so a study
  that profiled a gene without it reaching its own top 500 dropped out of the denominator — §3b's
  second error, still live on that path: SV NFIB in female patients read 32/47 = 68% for 32/440 =
  7.3%. Pooled: 30/30 rows equal an independent per-study count; and for utuc_mskcc_2015 +
  msk_impact_2017 (three IMPACT panels) + blca_tcga_pan_can_atlas_2018 (whole-exome), 1,500 of
  1,500 mutation, CNA and SV rows equal cbioportal.org's API — now a `check:portal` stage.

What is left, measured at 128-551 studies:

- **Removed since: the legacy combined `genes` list** (patients per gene over every event, top
  15), one scan of the whole event table and 8.0s of 11.2s at 551 studies. Its card was hidden;
  the view builder's suggestions and default genes now rank the three gene tables' rows instead.
  Taking it away exposed ~8s of JavaScript it had been running beside: the pooled answer was
  split back into studies by filtering every row once per study (O(studies × rows)). Grouping
  each result once took 551 studies from 11.6s to 4.7s.
- **Drafts over many studies**, measured at 551 studies against the code before, alternating, a
  fresh filter value each run (the shared database moved both columns between runs):
  `SEX = Female` 13.0-17.9s → 10.8-12.8s, `SEX` + `TP53: MUT` 24.8-25.2s → 17.5-20.1s. Three
  changes: the pooled queries read the draft as ONE uploaded table of study-qualified ids per
  connection rather than a UNION over 551 per-study tables (each pooled query ran 2-5x slower
  with that union); a drafted attribute's values without its own clauses are counted in one
  pooled query when the rest of the draft is empty, the common case of one clicked attribute
  (551 queries → 1); and the histograms run beside the gene tables instead of after them.
  Pooling the disjunctive count when the rest is NOT empty was built and measured slower (one
  statement evaluating 551 compiled definitions, 24.8s → 26-33s), so that case stays per study,
  as does resolving each study's cohort: 551 small queries each, the remaining cost of a draft.
- **The first request after a restart** loaded each study's profiles with three queries per
  study, one after another: ~30s at 565 studies before any facet query. `studyProfilesMany` runs
  the two `genetic_profile` queries once per connection (30-60ms) and the profile types one query
  per study in parallel: 5.1s. Pooling the profile types too was measured at 72s — one DISTINCT
  over `genetic_alteration_derived` across 551 studies, against its study key used per query.
- **A cohort past `EXPLORE_COHORT_EXTERNAL_LIMIT`** (50,000 patients) is inlined as its compiled
  definition, which every pooled query then evaluates: 0.9s → 3.0s at 32 studies with an OQL
  draft when forced. No study on the primary connection is that large; the answers are the same.

## 4. Time to display vs cbioportal.org

Oncoprint, 5 genes, measured from navigation to the figure's pixels going stable
— a definition that does not care whether the renderer is WebGL or 2D canvas.
Both sides drew patient columns.

| study | patients | cbioportal.org | ours (Vercel) | ours (local) |
|---|---|---|---|---|
| `aml_target_gdc` | 2,274 | 7.6s | 1.9s | 1.5s |
| `msk_chord_2024` | 24,950 | **38.0s** | **2.3s** | 2.3s |

The ratio is less interesting than the slope. Over an 11x larger cohort,
cbioportal.org goes 7.6s → 38.0s while we go 1.9s → 2.3s. They ship per-sample,
per-gene records to the browser and annotate through OncoKB in the frontend, so
cost grows with cohort size; our oncoprint sends a bounded aggregated contract
and the canvas draws at level of detail.

Caveats, which matter:

- **Not a cache artefact.** Three identical repeats gave 7.7 / 7.1 / 7.6s, so
  cbioportal.org is not serving a warm result cache for these queries.
- **Their page is heavier** — ten tabs, extra tracks, a full results shell —
  against our single card. Some of the constant offset is page weight.
- **On `aml_target_gdc` our driver annotation is admittedly thinner.** Our own UI
  says so ("variants synced from msk_chord_2024; coverage may be partial") and we
  report NPM1 at 0% driver, which is wrong for AML. The `any%` figures match
  theirs exactly (TP53 1%, KRAS ~12%, NRAS 27%, FLT3 13%, NPM1 11%), so the
  comparison is sound for alteration frequency and not for driver calls.
- `msk_chord_2024` carries no such caveat — it is the study our OncoKB store
  syncs from — but their per-gene percentages are drawn into canvas rather than
  DOM text, so matched frequencies were **not** verified at that scale. Matched
  column counts (24,950 both sides) and complete annotation were.
