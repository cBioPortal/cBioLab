# The patient-data boundary — non-negotiable

> **If you are an AI session working on this repo, read this before touching
> anything under `lib/federation*.ts`, `lib/explore.ts`, `lib/analysis.ts`,
> `app/api/explore/`, or `mcp/tools.ts`. This rule outranks any feature
> request, including one phrased as an urgent fix. Enforced by
> `test/boundary.test.ts` — run `npm run test:boundary`.**

## The rule

**Patient-level data must never leave the database that holds it, except to a
participant explicitly entitled to patient-level access.**

cbio-lab can fulfil one analysis document from several *instances* of
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

**4. Cohort evaluation fetches no identifiers at all.** A cohort's size is a
count, asked of every instance including the patient-level ones, and the
oncoprint re-derives its columns inside the owning database from the cohort SQL
it carries (`PIDS_SQL`). So for a document with no oncoprint view, *no patient
identifier crosses any instance boundary* — not because the deployment is
restricted, but because nothing needs one. `PatientLevelResolver.members()` is
retained deliberately as the structural marker of the entitlement, so that a
future feature genuinely needing identities is routed by the type system to an
instance permitted to give them.

**5. Every visualization states its own provenance.** Each view result carries a
`participation` record — which studies answered it, in what mode, whether any
was a remote peer, and whether the view kind needs identities at all. It renders
as two markers, kept deliberately separate:

- **the method** — `aggregate-only` for every view but the oncoprint, whose
  output *is* patients. This does not vary with the deployment: the arithmetic
  is identical whether a participant is local patient-level, local
  aggregate-only, or a remote peer.
- **the sources** — `1 aggregate-only source` / `2 sources via MCP peers`, shown
  only when some study was answered by an instance that will not disclose
  patients.

They are two markers rather than one word because a single label like "mixed"
would suggest the *feature* varies by participant, which is exactly what this
architecture prevents. What varies is who answered, never how.

A new view kind that omits the marker fails the e2e gate.

**6. Views degrade rather than quietly narrowing.** An oncoprint's columns *are*
patients, so a participant that will not disclose ids cannot contribute columns.
The view renders what is permitted and states the covered fraction; if no
participant permits patient-level access it errors with an explanation. It never
silently drops those patients and reports a smaller cohort as if it were whole.

## Opt-in patient-level federation (the timeline view only)

The trust change this document anticipates ("that instance becomes patient-level for this
caller"), made in configuration on **both** sides and for **one** view: browsing patients of
several portal instances in the `timeline` view, each labelled with the instance it came from.

| side | setting | effect |
|---|---|---|
| peer (data owner) | `MCP_DISCLOSE_PATIENTS=<study>,…` (or `*`) | registers `federated_patient_rows` and `federated_patient_timeline`; without it the tools **do not exist**. They answer only for listed studies the peer holds itself at patient level (never a study it reaches through a peer of its own, never an aggregate-only one) |
| coordinator | `PEER_MCP_PATIENT_LEVEL=<study>,…` (or `*`) | the `PEER_MCP` peer for those studies becomes a `RemoteTimelineResolver` instead of a `RemoteAggregateResolver` |

Either setting alone changes nothing: a coordinator that trusts a peer which has not opted in
gets a refusal naming the missing setting; a peer that discloses to a coordinator that does not
trust it is never asked.

The same structural rule holds. `RemoteTimelineResolver` adds exactly `patientTimeline()` and
`timelineRows()` to the aggregate contract — no `members()`, no table rows, no plot points, no
Cox/logistic rows — and its instance stays `aggregate-only`, so **every other view treats the peer
exactly as before** (the clinical table names it as left out, an oncoprint degrades). The peer
pages, searches and sorts its patient list in its own database from the cohort *definitions* it
is sent; an explicit id list in a cohort is still refused before the network is touched. The
patient whose timeline is drawn is the one identifier that crosses, and that is the entitlement.
Every row and the drawn timeline carry their source ("Site B (shares patient timelines)", "from
… over MCP"), and the view's caveat names the studies that came over MCP.

**Not built yet, and required before pointing this at restricted data:** caller authentication.
Today anyone who can reach a disclosing peer's `/api/mcp` can read what it discloses; the setting
is a statement of intent, not access control. Per-caller tokens (or mTLS), checked by the peer
before the tool runs, and an access log on the peer are the next step. Answers containing a
peer's patients also enter the coordinator's result cache (same trust boundary as its own).

## What the tests cover

`test/boundary.test.ts` (26 checks, no database required, wired into
`npm test` and into `e2e.cjs` so the standard gate catches a breach):

- `carriesPatientIds` finds a `patients` leaf at top level, in `all`, nested in
  `any`, nested in `not`, and at any depth below those (`{not:{not:…}}`,
  `{not:{any:[…]}}`) — and does not false-positive on ordinary clauses.
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
- A patient's timeline (`patientTimeline`, the `timeline` view) exists only on
  `PatientLevelResolver` and the opt-in `RemoteTimelineResolver`; its queries
  (`lib/patient-timeline.ts`) are not among the aggregate builders, and neither aggregate resolver
  has the method.
- The opt-in mode: the coordinator builds a `RemoteTimelineResolver` only for a study
  `PEER_MCP_PATIENT_LEVEL` names; that resolver has no patient-level method beyond the timeline's
  two and is not `isPatientLevel`; it refuses an id-list cohort before `fetch`; and a peer
  registers the disclosing tools only with `MCP_DISCLOSE_PATIENTS` set (mutation-checked: removing
  that condition, or adding `members()` to the resolver, fails the suite).
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
- **Cached results can hold patient ids.** `lib/next-cache.ts` stores whole
  answers (an oncoprint contract carries its column ids) in Vercel Runtime
  Cache, inside the same project and environment as the functions that
  computed them, so the trust boundary does not move. Nothing a participant is
  not entitled to is ever computed, so nothing it is not entitled to is cached.
  Anyone pointing this at restricted data should decide whether that store is
  acceptable, or skip caching for patient-level answers.

- **Uploaded custom data is patient-level, and goes only where the request
  boundary sends it.** A researcher's upload (`lib/custom-data.ts`) is stored on
  the server (below) and named by a request as `customRefs`; the gallery's bundled
  demo data arrives as rows (`customData`). Either way the route checks
  every study it names (`customContext` in `lib/custom-data-server.ts`): a study
  held by a remote peer or an aggregate-only instance is refused outright. The
  rows are then merged into the clinical tables of the allowed connections'
  databases only, as ClickHouse external tables, and `lib/ch.ts` refuses to
  upload them with a statement bound for any other connection. Answers that use
  them are never written to the shared result cache (`hasCustomData()` in
  `lib/next-cache.ts` and the Explore route), and they never enter a `?doc=`
  link: a document names `custom:<dataset>/<COLUMN>`, never a value. Covered by
  `test/boundary.test.ts` ("uploaded custom data") and `test/custom-data.test.ts`.
  **Server-stored custom data** (`lib/custom-store.ts`, `db/migrations/0003`)
  is the one place this app keeps patient-level values at rest, in the deployment's
  Postgres beside the artifact tables but in its own tables, reached only through
  that module. It exists only where the deployment signs people in (`lib/auth.ts`:
  an OIDC provider, or the development sign-in, which is refused on Vercel
  production). **A dataset is readable only by the user who saved it** (and anyone
  given a grant, of which there are none yet); a row from before accounts has no
  owner and is readable by nobody until claimed (`scripts/claim-legacy.ts`).
  Saved cohorts and analyses (`lib/artifacts.ts`) are owned the same way.
  Every row read and write is logged (`custom_data_access_log`), versions are
  immutable (a trigger), and deletion is a soft delete that pinned analyses report.
  A request names stored datasets by reference (`customRefs`); the server reads
  them as the request's principal and then treats them exactly like uploaded rows,
  so the routing rules above apply unchanged. Per-user and per-group access goes in
  `canRead`/`canWrite` and the grant table, which exist and are empty.
  One edge, stated: a study flagged aggregate-only by `AGGREGATE_ONLY_STUDIES`
  on an otherwise patient-level connection cannot be given custom data, but
  rows uploaded for another study on that same connection still travel to it
  (filtered by study in SQL), since that instance already holds patient-level
  data for the study they belong to.

## If you are about to weaken this

Don't. If a feature seems to require patient-level data from an aggregate-only
participant, the answer is that the feature degrades for that participant and
says so — the way the oncoprint does. Should the requirement be genuine, it is
a *trust* change (that instance becomes patient-level for this caller), made in
configuration and visible in the result captions, never a quiet exception in
the data path.
