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

**1a. A statement's type says what its rows may hold.** Every statement a resolver runs is one of
three types (`lib/sql-kinds.ts`): an `AggregateSql` (counts, sums and other values over many
patients), a `PatientSql` (rows that name patients or samples, or one patient's own values), or a
`CohortSql` (a cohort's patients as a subquery, never run on its own). All three are strings to the
database and different types to the compiler. `BaseResolver` runs only `AggregateSql`. Only
`PatientLevelResolver` has a runner for `PatientSql`. Each builder declares which kind it returns, and
`viewAggregate`/`viewRows` take only builders of their kind. So running a cohort's own subquery as an
aggregate (it returns patient ids), or handing a patient-row builder to an aggregate view, does not
compile. `test/sql-kinds.test.ts` runs the compiler over each such mix (`test/fixtures/sql-kinds/`)
and fails if one of them compiles. The type records what a builder promises; what the text actually
returns is what the sweep in `test/boundary.test.ts` checks.

**2. Aggregates are computed inside the owning database.** Compare and survival
push their arithmetic into SQL — per-gene `(profiled, altered, driver)` counts
and `(months, event, n)` survival triples. The coordinator sums; it never pulls
rows to tally them. This is also why mixed federation works at all: the
arithmetic is identical whether a participant is a local connection or a remote
peer, so the transport cannot change a result.

**3. `carriesPatientIds()` guards the one clause that carries identifiers.** A
`sampleList`/`patientList` leaf embeds explicit ids into compiled SQL, or names a
stored set whose ids travel beside it. It is refused for
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

**6. A view is drawn over every patient of its cohorts, or not at all.** An oncoprint's
columns *are* patients, so a participant that will not disclose ids cannot contribute columns;
a remote peer does not yet serve the aggregates behind genome, pathways and the like. A view
that one study's participant cannot answer is not drawn — a figure of part of a cohort reads as
the whole one — and says which study and why ("Cannot be drawn without leaving out the patients
of …"). One rule decides it, `lib/view-coverage.ts`: the engine refuses by it before a view runs
(`lib/analysis.ts`), and the page does not offer such a view (the add-view buttons, disabled with
the reason) or such a cohort (its row in a view's cohort picker). Where every patient is counted
and only a per-patient detail is withheld — the labs waterfall's bars, composition's per-case
bars, a plot's cohort layer drawn as density — the view is drawn and says what is withheld.

## Opt-in patient-level federation (per study and kind of data)

The trust change this document anticipates ("that instance becomes patient-level for this
caller"), made in configuration on **both** sides and for named **kinds** of patient-level data
only: browsing patients of several portal instances in the patient views, each row labelled with
the instance it came from. Every other view treats the peer as aggregate-only, exactly as before.

The kinds (`lib/disclosure.ts`, `PATIENT_KINDS`), each one view's needs and nothing more:

| kind | view | what crosses |
|---|---|---|
| `timeline` | `timeline` | the cohort's patient list with timeline counts; one patient's events and samples |
| `alterations` | `alterations` | the cohort's patient list with alteration counts; one patient's samples, mutations, copy-number calls and structural variants |
| `plot` | `plot` | the cases a plot draws as points, with their case ids: every case up to the points cap, the outliers past it, a ranked layer's extremes, a cohort layer's cases |

A plot's **aggregates** cross for every peer, whatever its rules: `federated_plot` answers a whole
plot (density grid, quartiles, violin, contingency, coefficients) or one piece of a plot pooled
across sites (extent, bin counts on a shared grid and extent, the six sums behind a correlation,
box quartiles, contingency cells, coverage, a cohort layer's count, cells or quartiles), counts
only, so a plot is drawn over a peer's study like any other aggregate view. Its **cases** are the
`plot` kind: `federated_plot_cases`, registered with the other patient-level tools, answers them
only where the peer's rules disclose `plot` for the study, and the coordinator asks only where its
rules accept it. Without both, the plot draws the peer's study as density and its caption says so;
a peer that refuses mid-way leaves the density and names its reason, never failing the view.

Each side writes **rules**: a study (or `*`) and the kinds allowed for it, e.g.
`genie_public:timeline+alterations, *:timeline`. A bare study id allows the timeline alone; `*` as
a kind allows every kind (so `plot` too); an unknown kind is refused naming the setting, never
ignored.

| side | setting | effect |
|---|---|---|
| peer (data owner) | `MCP_DISCLOSE_PATIENTS=<rules>` | registers `federated_patient_rows` and `federated_patient_timeline`; without it the tools **do not exist**. Every call is checked against the rules — the study and the kind its table belongs to (`PEER_TABLES` in `lib/federation.ts`), before anything is read — and answers only for studies the peer holds itself at patient level (never a study it reaches through a peer of its own, never an aggregate-only one) |
| coordinator | `PEER_MCP_PATIENT_LEVEL=<rules>` | the `PEER_MCP` peer for a study becomes a `RemotePatientResolver` carrying the kinds accepted for it — a `RemoteTimelineResolver` when they include `timeline` — instead of a `RemoteAggregateResolver` |

Data crosses only where both sides' rules allow the same study and kind. A coordinator that
accepts a kind the peer does not disclose gets a refusal naming the peer's setting; a peer that
discloses a kind the coordinator does not accept is never asked, and the view is not drawn
("… is a remote peer, which does not share patient alterations with this instance").

The same structural rule holds. A remote patient resolver adds exactly `patientRows()` (the row
tables of its accepted kinds, refusing any other kind **before** the network is touched), with
timelines `patientTimeline()`, and with `plot` the four plot-case methods as the object's **own**
properties (never the class's, so a peer that does not share them has no way to be asked;
`plotCasesOf` in `lib/federation.ts`) — no `members()`, no Cox/logistic rows, no
`rowsPage` — and its instance stays `aggregate-only`, so every view outside the kinds treats it as
before (the clinical table and the oncoprint are not drawn over its studies). The coordinator never
sends SQL: it names a table and the cohort *definitions*, and the peer builds and runs the query
in its own database; an explicit id list in a cohort is still refused before the network is
touched. The patient whose record is shown is the one identifier the coordinator sends, and that
is the entitlement. Every list row carries its Source ("GENIE site (shares patient timelines and
patient alterations)"), a peer's patient is marked "from … over MCP", and the view's caveat names
the studies that came over MCP. A failed or refused peer call keeps the answer out of the result
cache, as a failed query does. A peer names the table it answered with, and an answer for any other table is refused:
a peer on a build from before named tables answers every call with the timeline's list.

**A simulated peer — how the public deployment, dev servers and the gate federate.** Federation
is offered over MCP; a second database is not queried directly. `LOOPBACK_PEER=<connection>` (e.g.
`b`, the `CLICKHOUSE2_*` database) has one app serve one of its own databases to itself over MCP
(`lib/loopback-peer.ts`): the studies on that connection are reached through the remote resolvers
at the app's own `/api/mcp` (`PORT` or `LOOPBACK_PEER_URL` names it), and the MCP side answers those
calls — recognised by a token — from that connection alone, never routing them back to the peer.
The token is `LOOPBACK_PEER_TOKEN` (32+ characters) where several processes serve the app, as on
Vercel, where the call back lands on another function instance; otherwise each process makes its
own. With it set, the disclosing tools answer only for that connection's studies, and only to the
app itself: an outside caller gets no patient-level data of either database. The study list reads
the connection directly and badges its studies as the peer's (`LOOPBACK_PEER_LABEL`). It does not
simulate two processes with their own settings or credentials, or a peer on another build.
`scripts/gate.sh` restarts its server this way and runs `scripts/e2e-federation.cjs` when a second
database is configured.

**A coordinator that holds none of a peer's databases** learns the peer's studies over MCP as
well: `/api/studies` asks each `PEER_MCP` peer once (`federated_studies`) and lists only the
studies `PEER_MCP` routes to it, and `/api/catalog` answers a peer-held study with the peer's
`federated_catalog`. Both are counts and vocabulary — what the study picker and the cohort
builder show for a local study — and name no patient. Every federation tool answers only for a
study the instance holds in its own databases: one it reaches through a peer of its own is refused,
never relayed and never looked up in its own database.

**Not built yet, and required before pointing this at restricted data:** caller authentication.
Today anyone who can reach a disclosing peer's `/api/mcp` can read what it discloses; the setting
is a statement of intent, not access control. Per-caller tokens (or mTLS), checked by the peer
before the tool runs, and an access log on the peer are the next step. Answers containing a
peer's patients also enter the coordinator's result cache (same trust boundary as its own).

## Federation: where it stands

Three modes, of which the prototype offers the two over MCP:

| mode | set by | status |
|---|---|---|
| direct second database | `CLICKHOUSE2_*` alone | every view; not how federation is offered (only as the simulated peer's database) |
| MCP, aggregates | `PEER_MCP`, or `LOOPBACK_PEER` | compare, survival, cooccurrence, coexpression, clinical, hotspots, attrition, course, sequence, Explore, study list, catalog. Not drawn over a peer's studies, and saying why: oncoprint, table, mutations, cox, logistic, riskmodel, plot, and every view on `viewAggregate`/`viewMeta` (genome, pathways, enrichment, overlap, incidence, cancertypes, clonality, paired, diffexpr, correlates, assays, labs, composition). Errors: percentile cut-offs |
| MCP, patient-level | the above + `MCP_DISCLOSE_PATIENTS` / `PEER_MCP_PATIENT_LEVEL` | the aggregate set plus the `timeline` and `alterations` views; every other patient-level view is not drawn, as for an aggregate-only peer |

Known gaps, in the order they matter:

1. **No caller authentication** (above), and the boundary is enforced by the coordinator, not
   the peer: a peer's own `run_analysis`, `query_cohort` and web API answer patient-level for
   its patient-level studies to any caller. A peer serving restricted data needs both closed.
2. **No governance beyond study × kind rules:** no per-caller rules, access log, rate limit,
   small-cell suppression or defence against differencing.
3. **Coverage:** a peer has no `viewAggregate`/`viewMeta`, pooled plot or percentile method, and
   patient-level federation has only two kinds.
4. **Cost:** each MCP call opens a session (two requests, no reuse, no timeout), and the peer
   recounts the cohort on every call. Measured on one machine (dev servers, loopback network,
   result cache off): +0.3–0.4 s per analysis for aggregate views on a small study, +2 s for the
   patient-level timeline and alterations (18 calls); on a large study the database dominates.

## What the tests cover

`test/boundary.test.ts` (26 checks, no database required, wired into
`npm test`, so the standard gate catches a breach):

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
- The opt-in mode: the rules parse as written (a bare study is the timeline alone; an unknown kind
  is refused); the coordinator builds a remote patient resolver only for a study
  `PEER_MCP_PATIENT_LEVEL` names, carrying only the kinds named; that resolver has no patient-level
  method beyond `patientRows()` (and `patientTimeline()` with timelines) and is not
  `isPatientLevel`; it refuses a table of a kind not accepted, and an id-list cohort, before
  `fetch`; a peer registers the disclosing tools only with `MCP_DISCLOSE_PATIENTS` set, and refuses
  a study or kind its rules do not allow; and only the timeline and alterations views ask a peer
  for rows (mutation-checked: removing the registration condition, or adding `members()` to the
  resolver, fails the suite).
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
  One entry is not a whole answer: a risk model's fit (`cachedRiskFit`), cached
  apart from its groups so that regrouping refits nothing, holds each modelled
  patient's survival time, entry, event, stratum and scores — by position, with
  no identifier — read through `PatientLevelResolver.viewRows` exactly as an
  uncached fit is. It is never sent to a browser; the view's answer carries
  only the groups' curves and the summaries.

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

- **Stored id sets are patient-level too, and follow the same rules.** A long
  `sampleList`/`patientList` is saved on the server (`lib/id-set-store.ts`,
  `db/migrations/0006`) and named by a document as `"set": "<id>"`, so the ids
  are in neither the document, its `?doc=` link nor the request. A route reads
  the sets its body names as the request's signed-in principal
  (`withRequestIdSets` in `lib/id-sets-server.ts`, reached through
  `withRequestCustomData`), and each study's ids go only to the connection of
  the patient-level instance holding that study: `lib/ch.ts` uploads a set's
  table (`idSetExternalsFor` in `lib/id-sets.ts`) only with a statement that
  names it, and refuses any other connection. `carriesPatientIds()` counts a
  `set` as identifiers, so such a cohort is refused for an aggregate-only or
  remote participant before any request is made. Sets are owned and shared by
  `lib/access.ts`, their members are immutable (a trigger), deletion is a soft
  delete that a document naming the set reports, every read and write is logged
  (`id_set_access_log`), and answers that read one are never written to the
  shared result cache (`hasIdSets()`). Without a signed-in request (MCP, a script,
  a signed-out link) a set is not read at all, and the clause is refused by name.
  Covered by `test/id-sets.test.ts` and `idSetContract` in
  `test/support/store-contracts.ts`.

## If you are about to weaken this

Don't. If a feature seems to require patient-level data from an aggregate-only
participant, the answer is that the feature degrades for that participant and
says so — the way the oncoprint does. Should the requirement be genuine, it is
a *trust* change (that instance becomes patient-level for this caller), made in
configuration and visible in the result captions, never a quiet exception in
the data path.
