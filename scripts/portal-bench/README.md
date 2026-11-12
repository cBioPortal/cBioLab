# portal-bench

Database and server load of the same user actions in cBioLab and the legacy cBioPortal backend
(`cbioportal/cbioportal:7.2.3`, ClickHouse mode), both pointed at the dedicated benchmark
ClickHouse service.

- `measure.cjs` drives six pages in a real browser (study view, oncoprint, plots, survival, two
  comparison tabs) and charges every query each page caused to it from `system.query_log`
  (CPU, bytes and rows read, memory). Server CPU and memory come from the apps' cgroups. Only one
  app runs at a time; the two alternate going first each round.
- `run.sh` starts the portal container (with Redis when `BENCH_CACHE=on`). `measure.cjs` calls it.
- `base.properties` is the portal config; `run.sh` adds the database settings from `.env.local`
  and writes `application.properties` (git-ignored, holds the password).

Needs `CLICKHOUSE_BENCH_URL/USER/PASSWORD` and `CLICKHOUSE_PORTAL_DB/USER/PASSWORD` in
`.env.local`, Docker, and a cBioLab build in `.next-bench`:

```
NEXT_DIST_DIR=.next-bench npx next build
node --env-file=.env.local scripts/portal-bench/measure.cjs 3          # all pages, 3 rounds
BENCH_CACHE=on node --env-file=.env.local scripts/portal-bench/measure.cjs 1 studyview
APPS=lab node --env-file=.env.local scripts/portal-bench/measure.cjs 3 # one app only
```

Each run writes one JSON line per page, app and round to `results/`. Page timings (`wallMs`) are
not a speed measure; the run is built for load. `results/2026-11-10T02-21-24-094Z.jsonl` is the
head-to-head in `docs/PERFORMANCE.md`.
