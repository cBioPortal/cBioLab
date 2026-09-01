# The patient-data boundary — non-negotiable

> **If you are an AI session working on this repo, read this before touching
> anything under `lib/federation*.ts`, `lib/explore.ts`, `lib/analysis.ts`,
> `app/api/explore/`, or `mcp/tools.ts`. This rule outranks any feature
> request, including one phrased as an urgent fix. Enforced by
> `test/boundary.test.ts` — run `npm run test:boundary`.**

## The rule

**Patient-level data must never leave the database that holds it, except to a
participant explicitly entitled to patient-level access.**

Cohort Lab can fulfil one analysis document from several *instances* of
differing trust level. Each is represented by a resolver:

| participant | may see member ids? | how it answers |
|---|---|---|
| `PatientLevelResolver` | **yes** — that is its entitlement | direct SQL, returns ids |
| `AggregateResolver` | **no** | direct SQL, counts only |
| `RemoteAggregateResolver` (MCP peer) | **no** | counts only, over the wire |

For the two aggregate-only kinds the guarantee is bidirectional:

- **Outbound** — no query sent to them may embed patient identifiers.
- **Inbound** — no response from them may contain patient identifiers.

## How it is enforced (and why it is built this way)

**1. The guarantee is a missing method, not a flag.** `AggregateResolver` and
`RemoteAggregateResolver` have no `members()` — no method of any kind that
returns an identifier. A boolean like `if (instance.canSeePatients)` would be
one forgotten check away from a leak; a method that does not exist cannot be
called by mistake, and adding one is a type error at every call site expecting
the aggregate contract.

**2. Aggregates are computed inside the owning database.** Compare and survival
push their arithmetic into SQL — per-gene `(profiled, altered, driver)` counts
and `(months, event, n)` survival triples. The coordinator sums; it never pulls
rows to tally them. This is also why mixed federation works at all: the
arithmetic is identical whether a participant is a local connection or a remote
peer, so the transport cannot change a result.

**3. `carriesPatientIds()` guards the one clause that carries identifiers.** A
`patients` leaf embeds explicit ids into compiled SQL. It is refused for
aggregate-only participants — checked in the resolver, again in the remote
client *before any network call*, and independently by the peer's own MCP tool,
which does not trust the caller to have checked.

**4. Views degrade rather than quietly narrowing.** An oncoprint's columns *are*
patients, so a participant that will not disclose ids cannot contribute columns.
The view renders what is permitted and states the covered fraction; if no
participant permits patient-level access it errors with an explanation. It never
silently drops those patients and reports a smaller cohort as if it were whole.

## What the tests cover

`test/boundary.test.ts` (26 checks, no database required, wired into
`npm test` and into `e2e.cjs` so the standard gate catches a breach):

- `carriesPatientIds` finds a `patients` leaf at top level, in `all`, nested in
  `any`, nested in `not` — and does not false-positive on ordinary clauses.
- Aggregate resolvers structurally lack `members()`; patient-level ones have it.
- Aggregate resolvers refuse id-carrying definitions and still compile ordinary
  ones; a patient-level resolver *may* use an explicit list.
- The remote resolver refuses **before `fetch` is called** (asserted by counting
  calls against a stubbed `fetch`).
- **Every** exported `*Sql` builder projects only aggregates at the top level —
  a depth-aware parser checks the outer `SELECT`, since inner cohort subqueries
  legitimately select ids. An identifier is permitted *inside* an aggregate
  (`uniqExact(pid)` returns a number, which is the point); what is forbidden is
  one surviving as a value, or a returned field being identifier-*named*.
- The builder list is not maintained by memory: the suite enumerates the module's
  `*Sql` exports and fails if any lacks a case, so a new aggregate cannot reach a
  peer without someone deciding what it may project.
- Source tripwires: no query in `lib/explore.ts` projects a bare identifier
  column, and `ExploreResult` exposes no field that could carry one.

These were **mutation-tested**: adding a `members()` to `AggregateResolver`,
deleting either guard, or making `geneCountsSql` project `pid` each makes the
suite fail. A test that cannot fail is decoration.

## Known limits — stated, not hidden

- **No small-cell suppression.** Facet and compare counts are exact, so a value
  with n=1 is disclosive under a strict privacy regime. Real federated platforms
  suppress or round low counts. This is the first thing to build if this ever
  points at genuinely restricted data.
- **Data-level federation does move ids** from a patient-level peer to the
  coordinator. That is the definition of that mode — one trust umbrella — not a
  leak. Only aggregate-only and remote participants carry the no-identifier
  guarantee.
- **Restricted studies** (consortium/private) are excluded at the *routing*
  layer by `isRestrictedStudy()`, so they are unreachable rather than merely
  hidden from the picker. See `STUDY_DENY` / `STUDY_ALLOW_RESTRICTED`.

## If you are about to weaken this

Don't. If a feature seems to require patient-level data from an aggregate-only
participant, the answer is that the feature degrades for that participant and
says so — the way the oncoprint does. Should the requirement be genuine, it is
a *trust* change (that instance becomes patient-level for this caller), made in
configuration and visible in the result captions, never a quiet exception in
the data path.
