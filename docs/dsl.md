# Cohort Query DSL

A small JSON language for defining patient cohorts by temporal relationships between clinical
timeline events. The client sends this DSL to the server (`POST /api/cohort`); the server
validates it and compiles it to ClickHouse SQL (`lib/compiler.js`). The client never sends SQL.

## Top-level shape

```json
{
  "a":   { …selector… },              // required: the anchor event (A)
  "b":   { …selector… },              // required unless rel.type = "NONE"
  "rel": { "type": "BEFORE", … },     // temporal relation between A and B
  "priorGuard": false,                // restrict to "No prior medications" patients
  "lineGap": 90                       // gap threshold for derived treatment lines (days)
}
```

**Cohort semantics.** A patient is in the cohort if there EXISTS at least one pair of event
occurrences (one from A, one from B) satisfying the relation. Duplicate qualifying pairs do not
inflate counts — results are distinct patients. `occurrence: FIRST/LAST` pins a selector to a
single event per patient *before* the relation is evaluated.

## Selector

Selects a set of event occurrences per patient: `(patient, start_date[, stop_date])`.

```json
{
  "eventType": "Treatment",                       // required; from the study catalog
  "attrs": [{ "key": "SUBTYPE", "value": "Immuno" }],   // 0–3 string-equality filters, ANDed
  "numeric": { "key": "RESULT", "op": ">", "value": 10 },  // optional; op ∈ > >= < <= =
  "occurrence": "ANY",                            // ANY | FIRST | LAST (default ANY)
  "minDurationDays": 365                          // optional; requires a stop_date
}
```

Notes:

- `attrs` match `clinical_event_data` key/value pairs exactly (strings).
- `numeric` casts the attribute value with `toFloat64OrNull` — non-numeric values simply don't
  match; they never error.
- `minDurationDays` filters to events whose `stop_date - start_date >= N`; events without a
  stop date never match it. Only Treatment events (and derived lines) carry stop dates.
- Timeline dates are **per-patient day offsets** (negative = before the study reference date).
  Only intervals and orderings are meaningful, never absolute dates across patients.

## Relations (`rel.type`)

| type | extra fields | meaning |
|---|---|---|
| `NONE` | — | cohort = patients with any qualifying A. `b` is ignored. |
| `BEFORE` | `minDays` (default 0), `maxDays` | some B starts in `(A.start + minDays, A.start + maxDays]` |
| `DURING` | — | some B starts inside A's interval: `A.start ≤ B.start ≤ coalesce(A.stop, A.start)`. For point events (no stop date) this degenerates to same-day. |
| `NOT_FOLLOWED_BY` | `withinDays`, `observed` | **absence**: no B starts in `(A.start, A.start + withinDays]` for *any* qualifying A occurrence. |

### The observability guard (`observed: true`)

Absence queries must distinguish "event didn't happen" from "patient wasn't observed."
With `observed: true`, patients are additionally required to have *any* timeline event at or
after `A.start + withinDays` — i.e., they were still being followed past the window. Without
it, a patient lost to follow-up the day after treatment counts as "no progression," which is
almost never what a clinical question means. **Default to true for absence queries.**

## `priorGuard` — the prior-medications restriction

`"priorGuard": true` restricts the *entire query* (selector A and, when line events are used,
the line derivation itself) to patients whose NLP-derived `PRIOR_MED_TO_MSK` flag says
"No prior medications." Why it exists, in msk_chord_2024 numbers: of treated patients, ~60% are
flagged treatment-naïve on arrival, ~20% had prior treatment elsewhere (their observed "first"
events are not really first), and ~20% have no determination. Any query whose meaning depends on
"first" (first line, first treatment, treatment-naïve cohorts) should set this guard.

## Derived treatment lines — the synthetic event type

`"eventType": "Treatment line (derived)"` selects **treatment lines** instead of raw events.
Lines don't exist in the database; the compiler derives them inside the query by interval-merging
systemic-therapy events (Chemo, Immuno, Targeted, Hormone, Biologic, Investigational — RT and
surgery excluded) per patient, starting a new line when a treatment-free gap exceeds the
threshold. A line's `start_date`/`stop_date` span the merged block, so all relations (including
`DURING`) work on lines.

Line-selector attributes:

| key | meaning |
|---|---|
| `LINE_NO` | equality (`"2"`), or use `numeric` (`{"key": "LINE_NO", "op": ">=", "value": 3}`) |
| `COMPOSITION` | canonical regimen makeup, e.g. `"Chemo"`, `"Biologic+Chemo"` (sorted, `+`-joined) |
| `GAP` | per-selector override of the gap threshold (rare; prefer top-level `lineGap`) |

The gap threshold comes from top-level `lineGap` (default 90). It matters: msk_chord_2024 has
24.1k line-starts at 30 days, 15.2k at 90, 9.4k at 180. `LINE_NO` means "Nth line *observed in
this study*" unless `priorGuard` is set — see above.

## Validation rules (server-enforced)

- `rel.type`, `occurrence`, `numeric.op` are whitelisted; unknown values fall back or error.
- ≤ 3 attribute filters per selector; key ≤ 200 chars, value ≤ 500 chars.
- All numeric fields must be finite numbers; `lineGap` ∈ [1, 3650].
- String values are escaped; identifiers (database) are sanitized server-side. The study is
  fixed by server config — the DSL cannot address other studies.

## Worked examples (with msk_chord_2024 counts)

Progression within 180 days after any immunotherapy start — **2,024 / 3,341**:

```json
{ "a": { "eventType": "Treatment", "attrs": [{ "key": "SUBTYPE", "value": "Immuno" }] },
  "b": { "eventType": "Diagnosis", "attrs": [{ "key": "PROGRESSION", "value": "Y" }] },
  "rel": { "type": "BEFORE", "minDays": 0, "maxDays": 180 } }
```

PSA > 10 in the 90 days before first hormone therapy — numeric + occurrence pinning:

```json
{ "a": { "eventType": "Lab_Test", "attrs": [{ "key": "TEST", "value": "PSA" }],
         "numeric": { "key": "RESULT", "op": ">", "value": 10 } },
  "b": { "eventType": "Treatment", "attrs": [{ "key": "SUBTYPE", "value": "Hormone" }],
         "occurrence": "FIRST" },
  "rel": { "type": "BEFORE", "minDays": 0, "maxDays": 90 } }
```

True first-line immuno, progression-free for a year — absence + both guards — **417 / 2,392**:

```json
{ "a": { "eventType": "Treatment", "attrs": [{ "key": "SUBTYPE", "value": "Immuno" }],
         "occurrence": "FIRST" },
  "b": { "eventType": "Diagnosis", "attrs": [{ "key": "PROGRESSION", "value": "Y" }] },
  "rel": { "type": "NOT_FOLLOWED_BY", "withinDays": 365, "observed": true },
  "priorGuard": true }
```

Progression within 180 days of starting second-line therapy — derived lines — **3,003 / 7,824**:

```json
{ "a": { "eventType": "Treatment line (derived)", "attrs": [{ "key": "LINE_NO", "value": "2" }] },
  "b": { "eventType": "Diagnosis", "attrs": [{ "key": "PROGRESSION", "value": "Y" }] },
  "rel": { "type": "BEFORE", "minDays": 0, "maxDays": 180 }, "lineGap": 90 }
```

## Known limits (deliberate, v1)

- Two selectors and one relation — no three-event sequences, no boolean nesting.
- No value-trajectory relations ("PSA doubled within 90 days") yet.
- No aggregations ("median time from A to B") — the histogram endpoint covers the common case.
- Attribute matching is exact string equality; no ranges over strings, no OR within a key.

A machine-readable contract for this document lives in `docs/cohort-query.schema.json`.
