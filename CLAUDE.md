# cbio-lab — project instructions

> **Before touching federation, explore, or MCP tools, read
> [`docs/DATA-BOUNDARY.md`](docs/DATA-BOUNDARY.md).** Patient-level data must never leave the
> database that holds it except to a participant entitled to it. That rule outranks any feature
> request; it is enforced by `test/boundary.test.ts` (`npm run test:boundary`), and those tests
> are mutation-verified to actually fail when the boundary is weakened.
>
> A gitignored `HANDOFF.local.md` beside this file, if your machine has one, holds that machine's
> own notes (credentials' locations, local instances, pending work). Read it when it exists.

## What this is

A working demonstration that a cBioPortal-class tool can be rebuilt around **one declarative
JSON object** — the *Analysis document* (`{study, cohorts: {name: def}, views: [...]}`) — that
the web UI and MCP clients all read and write. `cohorts` is a store: **every view names the cohorts it
draws in its own `cohorts` list** (there is no "all cohorts" default). The server compiles the
document to ClickHouse SQL; clients never send SQL. Live at https://cbiolab.vercel.app (UI at
`/lab`, MCP at `/api/mcp`, project rationale at `/rationale`).

## Where things are

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the map of the code — diagrams of the system and
of how a request is processed, then each part and the one place each rule lives. Read the section
for the area you are changing first. The parts most changes touch:

- **The document → SQL.** `lib/cohort2.ts` compiles cohorts; `lib/analysis.ts` `runAnalysis(doc)`
  evaluates them and hands each view to its runner.
- **View kinds** — a folder `lib/views/<kind>/` plus `app/lab/kinds/<kind>.tsx`, and one line in
  each registry: `lib/views/index.ts` (runners), `lib/views/kinds.ts` (descriptors),
  `lib/views/docs.ts` (its DSL reference, from its `doc.ts`), `app/lab/kinds/index.ts` (page files).
  **Everything a kind adds lives in its folder** — its reference text and examples included. **Kinds never import each other** (`local/kind-boundary`).
  A kind's queries go through `viewAggregate`/`viewMeta` (`lib/federation-views.ts`) or its own
  `sql.ts`; **don't add a method per view to the resolver interfaces in `lib/federation.ts`**.
- **Table views** supply a `RowSource`; `lib/table-query.ts` does the rest. Never build these per view.
- **Local mode and the importer** — `npm run local` (`scripts/local.ts`) starts a private ClickHouse
  and the app; `lib/importer/` turns a study folder into cBioPortal's base tables by the legacy
  importer's rules, then runs cBioPortal's own `populate_derived_tables.sql`; `/import` and
  `/api/import` exist only with `CBIOLAB_LOCAL=1`. [`docs/LOCAL.md`](docs/LOCAL.md).
- **Agents** — WebMCP tools `lib/webmcp.ts` / `app/lab/agent-tools.ts`; MCP server `mcp/tools.ts`.
  **Federation is not MCP**: peers talk through `lib/federation-api.ts` at `/api/federation/v1/<op>`;
  never register a federation op as an MCP tool. **The chat sidebar is the app's only model call and
  is just another WebMCP client** — never give it a private way in. **The campaign engine never
  calls a model**, and a locked campaign is immutable at the database level.

Other docs: [`DOMAIN.md`](docs/DOMAIN.md) (what the domain's words mean),
[`UI.md`](docs/UI.md) (layout and waiting rules — before any UI change),
[`TESTING.md`](docs/TESTING.md) (every suite, the gate, CI),
[`PERFORMANCE.md`](docs/PERFORMANCE.md) (measured against cbioportal.org — read before claiming
this project is "fast"), [`ENVIRONMENT.md`](docs/ENVIRONMENT.md) (settings),
[`SESSIONS.md`](docs/SESSIONS.md) (several working copies on one machine).

## Invariants — do not break these

1. **Loud rejection, never silent approximation.** Anything the data can't honestly answer
   (unsupported OQL token, unknown attribute/profile/study, VAF without allele counts) throws a
   specific error listing what IS available.
2. **Provenance everywhere.** Every result carries its definition readback, compiled SQL, the
   aggregate queries behind each view's numbers (a peer's marked as run there), a shareable
   `?doc=`/`?spec=` link, and its `sources` (`lib/provenance.ts`). OncoKB annotations are
   version-pinned, and the pin is echoed in results.
3. **Compilers are single-study; federation happens at the analysis layer** with study-qualified
   ids. Cross-study overlap is deliberately NOT deduplicated, vocabularies NOT harmonized — and
   views and captions must say so.
4. **Docs are generated.** Never hand-edit `docs/dsl.md`: change `lib/dsl-reference.ts` (or the
   kind's `lib/views/<kind>/doc.ts`), run `npm run docs:gen`, commit both. The same module feeds the Examples tab, MCP `describe_dsl` and
   the agent grammar. Every example runs in the gate and its cohort counts are pinned
   (`npm run docs:counts` re-pins after an intentional change — [`TESTING.md`](docs/TESTING.md)).
5. **SQL injection surface**: user values reach SQL only through `sq()`, and cohort SQL passes
   between modules only via the `PIDS_SQL` Symbol (JSON can't forge Symbol keys).
6. **Track labels are sort keys** — engine and UI derive them from `lib/profile-names.ts`; never
   fork that logic.
7. **Methodology caveats are attached by the engine**, not left to prose: panel-aware
   denominators, left truncation, the prior-treatment guard, `observed:true` on absence queries.
   **A frequency is `altered ÷ samples profiled for THAT gene`** — a sample whose panel omits a gene
   is NOT PROFILED, never wild-type; dividing by a study total silently reports every gene as rarer
   than it is. Never average per-study percentages. (`docs/PERFORMANCE.md` §1, `docs/DOMAIN.md`.)
8. **Renderers read `lib/oncoprint-style.ts`**; they never define a colour, band, priority or
   legend label of their own. The Python port is held to the TypeScript by cross-language
   conformance tests in the gate.
9. **The document holds anything that changes what a reader sees; the browser holds the rest.** A
   setting that would change a shared link, the server SVG, the CLI or the Python package belongs
   in the view (e.g. the oncoprint's `display`). Zoom, scroll, hover, an open menu and a drag
   selection stay out.
10. **The patient-data boundary** ([`docs/DATA-BOUNDARY.md`](docs/DATA-BOUNDARY.md)) — aggregate-only
   and remote participants never emit or receive patient identifiers, and the guarantee is a
   *missing method* rather than a flag. A view is drawn over every patient of its cohorts or not at
   all: `lib/view-coverage.ts` is the one rule, and a kind that leaves a participant out needs its
   entry there. Never add an id-returning path to `AggregateResolver` / `RemoteAggregateResolver`. A
   statement's type says what its rows may hold (`lib/sql-kinds.ts`); only `PatientLevelResolver`
   runs `PatientSql`.
11. **Results are cached** (`lib/next-cache.ts`). Only a returned value is stored: a refusal, a
   partial answer or an abandoned query must THROW, or it is served to everyone for a day. Read
   through `throughCache`, and make everything that changes the answer an argument of the cached
   function. Details: ARCHITECTURE.md, "The result cache".
12. **Every view states how its numbers were computed, and that statement is checked.** A result
   carries a method record (`lib/method.ts`) with a Python script that recomputes its numbers; **a
   change to how a view computes updates its method builder in the same commit**, and
   `check:methods` fails on any number the script does not reproduce.
13. **`/verification` reports what the checks found; it never restates a claim by hand.** A new
   statistic gets a row in `lib/verification.ts`; new cohort or count logic should get a planted bug
   that proves a check would notice it breaking ([`TESTING.md`](docs/TESTING.md)).

## UI conventions

The layout system and the waiting rules are [`docs/UI.md`](docs/UI.md) — read it before any UI
change. The ones most often broken:

- **A figure is the data alone; anything the reader clicks is HTML beside it**, and the figure's
  caption says in words what the controls show. Figures are drawn in the browser at the card's
  width by the renderer MCP uses, with `lib/chart/` — never a colour, size or tick rule of their own.
- **One scale** (`app/globals.css`); new UI is Tailwind and shadcn (`app/_ui/`), joined with `cn()`.
  One header per view (`ViewHead`); controls side by side are a toolbar (`.viewtb` > `.tbz`).
- **Every screen answers "is this current?" and "is this everything?"**: a change that waits on the
  server covers the figure with "updating…"; a fetched control shows a loader; loading, empty and
  failed are three states; a disabled control says why; nothing is dropped without saying so; a
  request past a limit is refused with the limit named.
- **Tooltips are `data-tip`, never `title`** (`app/_ui/tooltip.tsx`; docs/UI.md says why).
- **Keystrokes stay in the field** (a small component owns the draft); **one way to change the
  document** (`app/lab/doc-store.ts`).
- **Look at a UI change, then measure it** (`misalignedControls` in `test/e2e/helpers.cjs`), and verify waiting
  states by holding the request.

## Code standards — what `npm run lint` enforces

`npm run lint` (ESLint, knip, ruff) is the gate's first stage; its messages say what to fix. What
they can't tell you:
- **API GET handlers call `await connection()` (`next/server`) first.** One that never reads the
  request is prerendered at build time and serves that answer forever; `scripts/gate.sh` fails on
  any prerendered API route outside its allowlist.
- A promise you deliberately don't wait for is marked `void load();` — don't add an `await` just to
  satisfy the rule. Delete code you stop using; don't park it as `void x;` or an `_` name.
- Disable a rule only on the line where it is wrong, with the reason:
  `// eslint-disable-next-line <rule> -- <why>` (Python: `# noqa: <code>` plus a comment). Never
  change `eslint.config.mjs`, `knip.json` or the ruff rules as part of other work.
- Off on purpose, so don't "fix" code for them: `any` / `no-unsafe-*`, complexity, nesting, formatting.
- Accessibility (`jsx-a11y-x`, `app/**/*.tsx`): clickable things are `<button>`s, every input or
  select has a name (label text or `aria-label`; a `data-tip` tooltip is not a name). A native
  `<dialog>`'s backdrop click is the accepted exception: disable on that line, since Escape closes it.
- The Semgrep and jscpd reports (`npm run report:security`, `report:dupes`): never turn off TLS
  verification (`lib/db.ts`'s `rejectUnauthorized: false` is the one open finding), and factor out
  rather than copy a long block.

## Workflow

- **Iterate with `next dev`'s hot reload and `npm test`** (fast, no build, no database); `npx eslint
  <files you touched>` for lint. [`docs/TESTING.md`](docs/TESTING.md) lists every suite.
- **CI runs the full gate on every PR** (`.github/workflows/verify.yml`: lint, build, unit, database,
  docs, methods, parity, Python, e2e). `scripts/gate.sh` runs the same locally — a slow, real build
  plus ~110 browser checks, never a per-edit loop. **Never run `npm run build` in a folder whose
  `next dev` is running** ([`docs/SESSIONS.md`](docs/SESSIONS.md)); the gate builds to `.next-gate`
  for that reason.
- **Verify with real numbers before you push**: look at the change (a Playwright screenshot for UI)
  and cross-check counts against known values. Passing tests are not the same as looking.
- Secrets come from `.env.local` at runtime; never hardcode them anywhere, including tests.
- **Branch from `master`, name the branch after the work, push it and open a PR. Leave the merge to
  a person.** `master` is the deploy branch of a repo under the `cBioPortal` org — advancing it is a
  publishing act. Never merge or fast-forward it on your own initiative; when told to, merge with
  `--no-ff` and delete the branch afterwards.
- Commits: author is the person you work for; end messages with the Claude co-author trailer. One
  commit per piece of work, with a body that explains the semantics and what was verified.
