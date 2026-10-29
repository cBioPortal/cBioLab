# Several sessions on one machine

How to run more than one working copy (and agent) on one machine without them breaking each
other. Nothing here is needed for a single checkout.

## One folder, one branch, one dev server

| | |
|---|---|
| folder | a git worktree of its own |
| branch | `session/<name>`, checked out only there |
| port | `next dev`, kept alive by `serve-<port>.sh`, serving that folder |
| gate port | a per-session port for `scripts/gate.sh`'s ephemeral e2e server (default 3100 — override with `GATE_PORT` so two gates running at once don't kill each other's server mid-suite) |

`scripts/session-setup.sh <name> <port> [gate-port]` creates it — worktree, branch, `.env.local`
copy, `npm ci`, the dev server, and a `CLAUDE.md` beside the worktree with all of the above filled
in. Its header comment says where folders go and why.

## Never build where `next dev` is running

`next dev` and `next build` both write `.next`, so they must not share a directory. Serving a
production build from a directory that is also built in broke a shared instance three times: each
build rewrote the content-hashed chunk filenames and deleted the ones the running server still
referenced, so the client JS 404ed and every interaction fell back to a server render — with no
error anywhere except a failed request in the browser console.

So builds in a session's folder run only through `scripts/gate.sh`, which builds to `.next-gate`
via `NEXT_DIST_DIR` and never touches the `.next` the dev server owns. A build with
`NEXT_DIST_DIR` set makes Next append `.next-gate/types/**/*.ts` to `tsconfig.json`; that line is
committed deliberately and is inert for anyone who does not set the variable.

After any change meant to reach a reviewer on a served instance, **check the URL they will open** —
one curl for the page plus one for a chunk it references. Asserting it works is not the same as
looking.
