# Environment variables

Every setting cbio-lab reads from its environment, grouped by what it controls. For local
development put them in `.env.local`; on Vercel, Project Settings → Environment Variables. A
setting the process already has wins over `.env.local` (Next's `loadEnvConfig`), even an empty
one, which is how a script or a second process overrides it.

To run locally you need only the four `CLICKHOUSE_*` connection settings; everything else is
optional.

## Data

| var | default | meaning |
|---|---|---|
| `CLICKHOUSE_URL` | — | the warehouse, `https://<host>:8443` |
| `CLICKHOUSE_USER` | — | a read-only user scoped to the database below |
| `CLICKHOUSE_PASSWORD` | — | |
| `CLICKHOUSE_DB` | — | the cBioPortal database, e.g. `cbioportal_public_librechat_blue` |
| `CLICKHOUSE_LABEL` | `primary` | the name of this database in the UI (the study picker, a view's sources) |
| `STUDY_ID` | `msk_chord_2024` | the study a document without one, and the legacy single-study endpoints, use |
| `PORTAL_URL` | `https://www.cbioportal.org` | the cBioPortal that study and patient links open |
| `ONCOKB_PIN` | the store's newest release | the OncoKB release to annotate with, e.g. `v7.5`; every result echoes the one used |
| `GENOME_NEXUS_URL` | `https://www.genomenexus.org` | the Genome Nexus server the lollipop view asks for protein length and Pfam domains (a gene symbol only) |
| `STUDY_DENY` | — | study ids to exclude entirely, comma-separated |
| `STUDY_ALLOW_RESTRICTED` | — | `1`: also serve studies named `…-consortium` or `private`, which are otherwise never routed. Only for a deployment entitled to them |
| `AGGREGATE_ONLY_INSTANCES` / `AGGREGATE_ONLY_STUDIES` | — | connection ids (`a`, `b`) or study ids treated as aggregate-only: their patients are never listed, and views that need them are not drawn over them |

## Federation

One analysis can draw on studies in more than one cBioPortal database, and the prototype offers
that **over MCP**. Either one deployment holds both databases and serves the second to itself as
a simulated peer (`LOOPBACK_PEER`: the public portal, dev servers, the gate), or a second
instance holds it and this one reaches it at its `/api/mcp` (`PEER_MCP`). See the README's
Federation section for what each supports, and `docs/DATA-BOUNDARY.md` for the rules.

| var | where | meaning |
|---|---|---|
| `CLICKHOUSE2_URL`, `CLICKHOUSE2_USER`, `CLICKHOUSE2_PASSWORD`, `CLICKHOUSE2_DB`, `CLICKHOUSE2_LABEL` | the deployment holding both databases | the second database (connection id `b`). On its own it is queried directly; with `LOOPBACK_PEER=b` only through the simulated peer |
| `LOOPBACK_PEER` | same | `b`: serve the second database to this app as a simulated peer over MCP |
| `LOOPBACK_PEER_URL` | same | this deployment's own MCP endpoint, e.g. `https://cbiolab.vercel.app/api/mcp`. Unset, `http://127.0.0.1:$PORT/api/mcp` (needs `PORT`) |
| `LOOPBACK_PEER_TOKEN` | same, required where several processes serve the app (Vercel) | a secret of 32+ characters (`openssl rand -hex 24`) that marks the app's calls to itself. Unset, each process makes its own, which works for a single `next dev`/`next start` process only |
| `LOOPBACK_PEER_LABEL` | same | optional: how the peer's studies are labelled, e.g. `GENIE (via MCP)` (default `<CLICKHOUSE2_LABEL> (simulated peer)`) |
| `PEER_MCP` | a coordinator using a separate peer | which studies a peer serves: `study=url` pairs, comma-separated, e.g. `genie_public=http://peer:3000/api/mcp,nsclc_public_genie_bpc=http://peer:3000/api/mcp`. Only the studies listed are taken from that peer |
| `PEER_LABEL` | same | optional: how those studies are labelled (default `peer via MCP`) |
| `MCP_DISCLOSE_PATIENTS` | the peer (for a simulated peer: the deployment) | opt-in patient-level federation, what the peer sends: rules `study:kind+kind`, comma-separated, `*` for every study. Kinds: `timeline`, `alterations`, `plot` (a plot's cases; its aggregates cross without a rule) (a bare study means `timeline`). Unset, the peer sends aggregates only |
| `PEER_MCP_PATIENT_LEVEL` | the coordinator (for a simulated peer: the deployment) | the same rules, for what this app accepts. Patient-level data crosses only where both sides allow the study and kind |
| `FEDERATION_HIDE_SQL` | the peer | `1`: do not send the SQL it ran back with its answers (provenance then stops at the peer) |

### The public portal (Vercel), over MCP

Keep `CLICKHOUSE2_*` and add, for **Production** only (a preview deployment would otherwise call
production's endpoint):

```
LOOPBACK_PEER=b
LOOPBACK_PEER_URL=https://cbiolab.vercel.app/api/mcp
LOOPBACK_PEER_TOKEN=<openssl rand -hex 24, marked Sensitive>
LOOPBACK_PEER_LABEL=GENIE (via MCP)
MCP_DISCLOSE_PATIENTS=*:timeline+alterations
PEER_MCP_PATIENT_LEVEL=*:timeline+alterations
```

To let plots draw the peer's cases as points as well as its density, add `+plot` to both of the
last two lines (`*:timeline+alterations+plot`); without it a plot over a peer's study is its
density, and the caption says the peer shares no cases.

Then redeploy. The study picker labels the second database's studies `GENIE (via MCP)`, and a
view's "how these numbers were computed" marks the queries that ran on the peer. Without the last
two lines the peer is aggregate-only: the timeline and alterations views are not drawn over its
studies either.

### Dev servers

`scripts/session-setup.sh` turns the simulated peer on in each session's `serve-<port>.sh`:

```
export PORT=<port> LOOPBACK_PEER=b MCP_DISCLOSE_PATIENTS='*:timeline+alterations' PEER_MCP_PATIENT_LEVEL='*:timeline+alterations'
```

These go in the serve script, **not** `.env.local`: `scripts/gate.sh` builds and serves from the
same folder on its own port, reading `.env.local`, and a `PORT`/`LOOPBACK_PEER` there would send
its loopback calls to the dev server. The gate runs its own federation stage
(`scripts/e2e-federation.cjs`) with the simulated peer whenever `CLICKHOUSE2_*` is set.

### A separate peer

Run a second instance whose `CLICKHOUSE_*` is the other database (and no `CLICKHOUSE2_*`,
`PEER_MCP` or `LOOPBACK_PEER` of its own), with `MCP_DISCLOSE_PATIENTS` if it shares patient-level
data. On this instance, remove `CLICKHOUSE2_*` and set `PEER_MCP` (and `PEER_LABEL`,
`PEER_MCP_PATIENT_LEVEL`). The study list and each study's catalog then come from the peer
(`federated_studies`, `federated_catalog`). Bind the peer where only this instance can reach it:
see the security notes below.

## Sign-in and saved data

| var | default | meaning |
|---|---|---|
| `AUTH_OIDC_ISSUER` | — | an OpenID Connect provider (Google: `https://accounts.google.com`; MSK's Keycloak realm). With the two below, turns sign-in on |
| `AUTH_OIDC_CLIENT_ID` / `AUTH_OIDC_CLIENT_SECRET` | — | the client registered with that provider |
| `AUTH_OIDC_LABEL` | `Google` for Google, else `single sign-on` | the provider's name on the Sign in button |
| `AUTH_URL` | the request's own origin | this site's public origin, for the sign-in callback when it sits behind a proxy |
| `AUTH_SESSION_SECRET` | one per process (dev only) | signs the session cookie; 32+ characters, required with `AUTH_OIDC_ISSUER` |
| `AUTH_DEV_LOGIN` | — | `1`: the development sign-in (any email, no password). Refused on Vercel production |
| `DATABASE_URL` (or `SUPABASE_DB_URL`) | an in-process Postgres | the Postgres for saved cohorts and analyses, campaigns and custom data, as the app's role `cohort_lab_app`: `npm run db:app-role -- <file>` gives it a new password and writes this URL to the file |
| `MIGRATION_DATABASE_URL` | `DATABASE_URL` | the same Postgres as its tables' owner, for `npm run db:migrate` (run before deploying code that needs a new migration) and `db:app-role`. Never set on the deployment |
| `PGLITE_DIR` | `.data/pglite` under `next dev`, else memory | where the in-process Postgres keeps its files when `DATABASE_URL` is unset |

## The site

| var | default | meaning |
|---|---|---|
| `APP_BASE_URL` | `https://cohort-lab.vercel.app` (MCP links), the request's origin (notebooks) | this site's public address, in the links MCP results and exported notebooks carry. Set it on any deployment not at that address |
| `EXAMPLES_URL` | — | on an instance whose database is not the public warehouse, a deployment that holds the gallery's studies (e.g. `https://cbiolab.vercel.app`): the Examples tab opens each example there, after saying the reader is leaving, instead of running it here |
| `RESULTS_MAX_STUDIES` | `50` | the most studies one gene query (the Results page) covers; Explore's "Query genes…" and the page refuse more, naming the limit |
| `CROSS_STUDY_EXPRESSION` | `pancan` | when expression data (mRNA, microRNA, protein) may be compared across studies on the Results page, as cBioPortal's `enable_cross_study_expression`: `pancan` (every study a TCGA PanCancer Atlas study), `all` or `none`. Elsewhere Plots offers no expression axes and Co-expression covers one study only |
| `PUBLIC_ENV` | `EXAMPLES_URL,RESULTS_MAX_STUDIES,CROSS_STUDY_EXPRESSION` | the variables written into the page for the browser, comma-separated. Read per request, so one image serves every deployment; a name that looks like a secret (`PASSWORD`, `SECRET`, `KEY`, `TOKEN`, `CREDENTIAL`) is refused |

## The assistant (chat sidebar)

| var | default | meaning |
|---|---|---|
| `CHAT_PROVIDER` | — | `anthropic` or `bedrock`: turns on the Assistant sidebar on a dev server (`next dev`) |
| `ANTHROPIC_API_KEY` | — | with `anthropic` |
| `AWS_REGION` | — | with `bedrock`, plus AWS credentials from the standard chain (a credentials file, the pod's web identity) or `AWS_BEARER_TOKEN_BEDROCK` |
| `CHAT_MODEL` | Claude Sonnet 5.5 under the provider's id | the model |
| `CHAT_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh` or `max` |
| `CHAT_ON_DEPLOYMENT` | — | `1`: also on a built deployment (never on Vercel), for signed-in users only |

## Performance and limits

| var | default | meaning |
|---|---|---|
| `RESULT_CACHE` | on | `off`: answer every request directly, bypassing the result cache, to measure what a first reader waits for |
| `RESULT_CACHE_MB` | `50` | the result cache's size in MB where it is process memory (anywhere but Vercel); read at server start |
| `CLICKHOUSE_MAX_INFLIGHT` | `8` | ClickHouse queries in flight at once per process; the rest queue (`docs/PERFORMANCE.md`) |
| `EXPLORE_COHORT_EXTERNAL_LIMIT` | `50000` | the most patient ids Explore ships to ClickHouse for one draft cohort |
| `ONCOPRINT_CLUSTER_LIMIT` | `4000` | the most columns an oncoprint clusters (`cluster:<profile>` sort) |

## Building and serving

| var | default | meaning |
|---|---|---|
| `GIT_COMMIT` | Vercel's commit, else `git rev-parse HEAD` | the commit a build reports in its footer and `/api/version`; a Docker build passes it as a build argument |
| `NEXT_DIST_DIR` | `.next` | the build output directory; `scripts/gate.sh` builds to `.next-gate` so a running `next dev` keeps its own |
| `ALLOWED_DEV_ORIGINS` | — | hosts besides localhost allowed to load `next dev`'s scripts, e.g. a tailnet proxy, comma-separated |
| `PORT` | — | the port this app listens on, where the simulated peer's calls go (see `LOOPBACK_PEER_URL`) |
| `MCP_PORT` | `3201` | the standalone MCP server's port (`npm run mcp`) |
| `ONCOPRINT_PROFILE` | — | any value: log the oncoprint assembler's timings |

## Tests and checks

| var | used by | meaning |
|---|---|---|
| `GATE_PORT` | `scripts/gate.sh` | the port its e2e server uses (default `3100`); give concurrent sessions their own |
| `GATE_SKIP_LINT` | `scripts/gate.sh` | skip the lint stage (CI runs it as a job of its own) |
| `GATE_SERIAL` | `scripts/gate.sh` | run the warehouse checks one at a time before e2e, instead of beside it (less memory at peak, several minutes slower) |
| `E2E_PORT` | the e2e scripts | the server they drive (default `3100`) |
| `E2E_LOGIN_EMAIL` | the e2e scripts | the email the development sign-in uses |
| `CHROME_PATH` | `e2e-browser.cjs` | the Chromium Playwright launches |
| `RECORD` / `REPORT_DIR` | `check:portal`, `check:cohorts`, `check:mutants` | write the verification report, to `docs/verification/` or `REPORT_DIR` |
| `UPDATE_COUNTS` | `docs:check` | re-pin the gallery examples' cohort counts (`npm run docs:counts`) |
| `UPDATE_DENOM` | `check:denominators` | re-pin its expected denominators |
| `UPDATE_GOLDEN` | the oncoprint golden tests (TypeScript and Python) | accept an intentional change to the golden SVG and raster |
| `VISUAL_BASE` / `VISUAL_CONCURRENCY` / `VISUAL_NOISE_PX` | `npm run visual` | the server it screenshots (default `http://127.0.0.1:3109`), pages at once (`2`), and the pixel difference below which a change is noise (`50`) |
| `FIGURE_CHECK_ONLY` / `FIGURE_CHECK_VERBOSE` | `check:figures` | lint only figures whose name contains this; list every issue, not the first five per figure |
| `PORTAL_CACHE` | `check:portal` | keep cBioPortal's answers in this folder and reuse them for repeated requests (`check:mutants` sets it for its runs) |
| `METHOD_CHECK_ONLY` | `check:methods` | run only the examples whose name contains this |
| `MUTANT_ONLY` | `check:mutants` | plant only the bug with this id |

## Set by the platform or the app

`NODE_ENV`, `VERCEL`, `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` come from Next and Vercel;
`FONTCONFIG_PATH` and `FONTCONFIG_FILE` the app sets itself, for the bundled font. Don't set them.
