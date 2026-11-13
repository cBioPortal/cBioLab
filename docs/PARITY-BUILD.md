# Building portal parity

How a session works down one page's gaps against cBioPortal. The gaps are listed in
[`PORTAL-PARITY.md`](PORTAL-PARITY.md). Your page, worktree, branch and port are in your task prompt;
everything else is here.

## 1. Where the legacy behaviour is written down

- **The spec:** [`legacy-spec/`](legacy-spec/) has one file per tab. Each requirement has an ID
  (`ONC-SO-3`, `STS-BAR-5`). Statistics have `*-STM-*` IDs with the calculation written out.
- **The scorecard:** [`legacy-spec/parity/`](legacy-spec/parity/) has one file per tab. It gives cBioLab's
  verdict on every ID (match, partial, different, missing), with file:line for code checks and
  the numbers compared for statistics. Start from your tab's scorecard: it says what differs and where.
- **The work list:** `PORTAL-PARITY.md`. The bugs come first, under "cBioLab bugs found by the parity
  audit", and then the gaps for your page in its band.
- **The legacy code:** read-only, at `~/cbioportal-frontend` (commit `cd8c6df`, the one the spec cites).
  Never edit or build it. Use it when the spec is unclear or has a `[C]` (read from the code) mark you
  want to confirm.
- **The live portal:** www.cbioportal.org. Its REST API (`https://www.cbioportal.org/api/...`) is
  reachable with curl. The HTML pages sit behind a Cloudflare check.

Behaviour matches the portal's unless a cBioLab invariant (`CLAUDE.md`) says otherwise. When one
does, the PR says so and cites the ID.

## 2. How to work

- **Order:** bugs first, then anything that changes a number the page shows, then controls and
  layout. One PR per coherent group of IDs, small enough to review. Don't build a whole tab in one PR.
- **Before writing code,** read `CLAUDE.md` (all invariants apply), `docs/ARCHITECTURE.md`, `docs/UI.md`,
  `docs/TESTING.md` and `docs/DATA-BOUNDARY.md`, then the code the scorecard cites for your IDs.
- **Every changed behaviour gets a test** that would have failed before the change. A statistic gets a
  test with known numbers.
- **Check against the portal:** run the same query or filter in both and compare the numbers. The PR
  says exactly what you compared and what each side showed. An unverified claim is worse than a
  stated gap.
- **Look at what you built:** take a screenshot of the page.
- **Stay in your lane:**
  - mutation annotation (OncoKB, hotspots, Genome Nexus, mutation table columns) belongs to the
    mut-annotation session;
  - warehouse schema and importer changes belong to the db and import sessions.
  - If a gap needs either, leave it unticked with a `[data: …]` note saying what's missing, and
    report it.
- **Product decisions:** some gaps need a decision first, such as matching legacy's groups and
  virtual studies. Stop and ask with a short question; don't guess.

## 3. Rules for this machine (hard)

- **Never run `scripts/gate.sh` without asking the user first and getting a yes.** CI runs the gate
  on every PR. Never run `npm run build` or `npm start` in your worktree.
- **Iterate with:**
  - `npm test` or targeted `node --test test/<file>.test.ts`;
  - `npx eslint <files>`;
  - `UPDATE_SNAPSHOTS=1` for intended output changes, after reading the diff. This includes
    `test/snapshots/kinds.json` when help text changes;
  - `npm run docs:gen` when a view kind's doc changes.
- **Memory is tight:** an 11 GB box, with other sessions running. Your `serve-<port>.sh` dev server is
  already running; don't start a second one. Use headless Chromium only when you need to look, and
  close it when done.
- **Puppeteer/Playwright:** Chromium at
  `~/.cache/puppeteer/chrome/linux-146.0.7680.153/chrome-linux64/chrome`, headless, `--no-sandbox`.
  Run only your own browser check against your dev server, never the whole e2e suite.
- **Git:**
  - Don't edit anything outside your worktree.
  - Never use bare `git stash` (the stack is shared).
  - No "why I changed this" comments in code.

## 4. Shipping a PR

- **Commits:** coherent commits whose message body says what changed and what was verified. End them
  with the attribution lines your session was given.
- **Tick the tracker in the same change:** in `PORTAL-PARITY.md`, mark the item `- [x] … (#<PR>)`.
  Leave what you didn't do as unticked sub-items.
- **Rebase on `origin/master`** right before pushing. Then
  `git push -u origin <branch>` and `gh pr create --base master`.
- **PR body sections:**
  - Summary;
  - spec IDs covered, and IDs deliberately left out with why;
  - Verification: tests, numbers compared against cbioportal.org, what you looked at;
  - Not done / follow-ups;
  - a `## Preview` line with the page path a reviewer should open.
- **Don't merge,** and don't mention anyone with a bare `@`.
- **Report back:** the PR URL, what you verified (with numbers), what's incomplete or uncertain, and
  anything you expect CI to fail on.
- **CI:** when it fails, read the failing job's log (`gh run view <id> --log-failed`), fix it and push.
