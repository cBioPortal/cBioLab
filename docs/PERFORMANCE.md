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

| | cbioportal.org study view | cohort-lab Explore |
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
- **Post-load interactivity** is our weakest dimension and the one users feel
  most.
- **`compare` at 916 ms** is the slowest view and the obvious optimisation
  target.
- **The 20 k id ceiling** should be lifted before anyone tries a real
  sample-list workflow.

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
