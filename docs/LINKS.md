# Links: long URLs, stored links and stored id lists

How a page's state stays in a link however much it holds, how a link that names a list of ids is
read, and who may withdraw such a list. Read this before changing how any page reads or writes its
URL, or how stored id sets are read.

## The problem, and what legacy cBioPortal does

Every page here keeps its state in its URL: the lab's whole analysis document in `?doc=`, a portal
page's settings in `?changes=`, the Patient page's cohort in `?cohort=`. That makes a link the
state itself, reproducible by anyone with no server involved. But a URL has a ceiling: Node refuses
a request line past 16 KB, and mail clients and chat tools cut links well before that. A document
with many cohorts, or a cohort written as a list of ids, passes it.

Legacy cBioPortal's `URLWrapper` handles this with its **session service**. Past 1,500 characters
of "session" parameters, a page saves them as a `main_session` and its URL becomes
`?session_id=<id>`. Group comparisons are always `comparison_session`s, holding each group as an
explicit list of sample ids. This app takes the same idea and closes the gaps the legacy version
has:

| | legacy cBioPortal | this app |
|---|---|---|
| short form | `?session_id=<id>` | `?s=<id>` |
| when a link is stored | on every change, once past 1,500 chars | only once past `LINK_URL_MAX` (8,000), and once the page has been idle for `LINK_IDLE_MS`; shorter links stay self-contained `?doc=` |
| id | a new random id per save | the hash of what is stored: same parameters, same id; an id never changes meaning |
| while saving | the URL says `session_id=pending`, which can be copied or reloaded | the full URL until the store answers, then the short one; never a placeholder |
| save fails | the page spins forever | the long URL stays, and the page says why it could not be shortened |
| link missing or unreadable | the page fails to render | the page says the link could not be opened, and why |
| pages covered | Results and Group Comparison only (study view: unbounded `#filterJson`) | every page that keeps state in its URL |
| comparison groups | explicit sample-id lists | definitions, re-run on the data; explicit lists only where a reader made one |
| id lists in a stored state | copied into every session | stored once as an id set; the link names it, signed in or not |
| ids at rest | anyone with a session id reads its sample lists | anyone with a link reads the lists it names; only their owner withdraws them |

## Stored links (`?s=`)

**What is stored.** When a page writes its URL and the query string is longer than
`LINK_URL_MAX`, its *long* parameters (each longer than `LONG_PARAM`, 256 characters: `doc`,
`changes`, `cohort`, …) are stored on the server under an id. The address bar becomes `?s=<id>`
followed by the short parameters (`tab`, `study`, `patient`, …), which stay readable and editable.
The stored parameters are kept exactly as the URL carried them, so a stored link holds no more and
no less than the `?doc=` link it stands for.

**The id** is the first 132 bits of the SHA-256 of the stored parameters with their names sorted:
22 base64url characters. The same parameters always get the same id, so storing a link twice is
one row, and a row never changes (a database trigger refuses updates and deletes).

**Who may store or read one:** anyone, signed in or not, as anyone may write or open a `?doc=`
link. The first person to store a link is recorded in `created_by` when signed in, and nothing
depends on it.

**Reading a page's parameters.** A page never reads `location.search` directly. It asks
`linkParams()` (or the hook `useLinkParams()`), which returns the URL's own parameters with a known
stored link's put back. A parameter written in the URL beside `s` wins over the stored one of the
same name, because the page wrote it after the link was opened.

**Opening a link.** The lab and portal layouts wrap every page in `LinkGate`. When the URL names a
stored link this tab has not read, the gate reads it (`GET /api/links/<id>`) before the page
renders. Until then it shows "loading this link…", and if the read fails it shows the reason
instead of opening the page without its parameters. A link this tab has read is remembered in
memory and in that history entry's `history.state`, so Back, Forward and a reload don't wait for
the server again.

**Writing a page's URL.** Pages write through `writeSearch(search, { push, state })`:
1. If the URL still names a known stored link, its parameters are folded back in, so a write that
   changes only `?changes=` doesn't lose the stored `?doc=`.
2. The full URL is written at once (a new history entry when `push`).
3. If it is past the limit, its long parameters are stored once the page has written nothing for
   `LINK_IDLE_MS` (1.5 s), so a run of edits to a long document is one stored link, not one per
   edit. The long URL works meanwhile. When the server answers, and only if the page hasn't written
   another URL meanwhile, the same history entry is rewritten to the short form, keeping its state
   (the lab's undo depth, for one). `flushLink()` stores a waiting link at once, for a page about to
   copy its own address.
4. If storing fails, the long URL stays and the page shows a notice saying the address is too long
   to reload or share, and why storing failed. The notice disappears after the next successful
   store.

**Id lists are stored apart from the link.** In the lab, a document past the limit that still
holds inline id lists (typed in the editor, set by an agent) has them stored as id sets first
(`listsOutOfLink` in `app/lab/page.tsx`), so its stored links name each list instead of copying
it once per edit. A reader who is not signed in stores unowned sets for this (below).

**How many rows to expect.** A row is written only for a distinct state past the limit, after an
idle pause, and states differing only in short parameters (`tab`, `study`) share the long ones'
row, so most pages never write one. Each row is at most `LINK_STORE_MAX` characters, and an id
list in it is a reference, not its ids.

**Opening another page.** `linkTo(path, params)` returns a URL that is short however much it
carries, storing first if it must. Explore's group comparison and "View patients" use it. On the
Patient page, a stored link that holds exactly the cohort is carried as `?s=` in the pager's links
instead of the long `?cohort=` (`CohortNavigation.link`).

## Stored id lists (id sets)

A cohort can name a list of sample or patient ids stored on the server
(`{"kind": "sampleList", "set": "<uuid>"}`) instead of carrying the ids
(`lib/id-set-store.ts`, `db/migrations/0006`). Lists are stored when a signed-in reader pastes one or
locks a cohort, and for any reader when they drag a selection on an oncoprint, when a document
grows too long for the address bar, or when they save a cohort or analysis that still holds an
inline list. They exist for two reasons: they keep the document and its link small, and a long
inlined list would break ClickHouse's query-size limit at around 12,000 ids.

**Unowned sets** (`db/migrations/0013`). A reader who is not signed in still has their lists
stored: an oncoprint selection, Cell Explorer donors, a long document's lists. Such a set has no
owner, so nobody manages it: it is never withdrawn, shared or listed in anyone's saved work, and
`withdrawIdSet` and the rest refuse it as having no owner. Unowned sets are stored by content: the
same ids at the same level are one row (the first name given is kept), so the same list stored
again, by anyone not signed in, answers the same id. A signed-in reader's set is always their own
row, never the unowned one, so they can withdraw it. Locking a cohort needs a sign-in, and so
does pasting a list in "From a list of ids", where the list is made to be managed.

**Reading is by id.** Anyone holding a link, document or saved item that names a set may read its
members, signed in or not: the set is as public as the link. A set's sharing (`lib/access.ts`) only
decides whose saved-work list it appears in. This is a deliberate decision (2026-11-05): sample and
patient ids reached through a link are not a protected audience. It does **not** change the
federation boundary ([DATA-BOUNDARY.md](DATA-BOUNDARY.md)): a set's ids still go only to the
patient-level instance holding each study, and never to an aggregate-only or remote participant.
Every read is logged (`id_set_access_log`; "anonymous" when no one is signed in).

**Only the owner manages a set.** Renaming, sharing, withdrawing, restoring and counting what uses
it are the owner's alone (`canShare`); anyone else is refused with 403. A set's members never
change, not even for its owner (a trigger), so a link that names a set always means the same ids.

**Withdrawing** is the owner saying "don't use this list any more":
- The row and its members stay. `deleted_at` records when, `withdrawn_note` why (up to 1,000
  characters), and `replaced_by` the set readers should use instead, if any (it must exist and be
  in use, and can't be the set itself).
- Every document, link or saved item naming the set is then refused (410) with who withdrew it,
  when, the note and the replacement, for example: *stored id set “responders” was withdrawn by its
  owner (pi@lab.org) on 2026-11-05: pilot patients included. Its owner points to “responders v2”
  (set …) instead.* The refusal (`WithdrawnIdSetError`) carries this as `withdrawal` too.
- **Withdrawal belongs to one set.** Another set holding exactly the same ids is a different row
  with its own id, and stays readable. Sets are never matched by content.
- Before withdrawing, the owner is shown how many saved cohorts, saved analyses and stored links
  name the set, counted across everyone's saved work but never listed (`idSetUsage`).
- **Restoring** clears the withdrawal; everything naming the set reads it again.
- A withdrawal takes effect at once in the process that made it. Other server replicas see it
  within a minute (`ACCESS_TTL_MS` in `loadIdSetForRequest`).

The **Id lists** tab of saved work (`app/_saved/lists-panel.tsx`, `/saved?tab=lists`) lists the
reader's sets, their own withdrawn ones included, with Export, Withdraw… and Restore.

## Where the code is

| | |
|---|---|
| `lib/links.ts` | the rules, pure and browser-safe: `planLink`, `effectiveParams`, `resolveWrite`, `shortSearch`, `validateLinkParams`, limits |
| `lib/link-store.ts` | the only module touching `stored_link`: `saveLink`, `readLink`, `linksNaming`, `linkId` |
| `db/migrations/0012_stored_links.sql` | the table, its immutability trigger and grants |
| `app/api/links/route.ts`, `app/api/links/[id]/route.ts` | `POST {params}` → `{id}`; `GET` → `{params}` (cacheable forever) |
| `app/_links/link-state.ts` | the page's side, no React: `linkParams`, `writeSearch`, `openLink`, `linkTo`, `onLinkProblem` |
| `app/_links/use-link.ts` | the hooks: `useLinkParams`, `useAddressLink` |
| `app/_links/link-gate.tsx` | opens a stored link before the page renders; says when one could not be stored |
| `lib/id-set-store.ts` | stored id sets: read by id, `withdrawIdSet`, `restoreIdSet`, `idSetUsage` |
| `lib/id-set-withdrawal.ts` | the withdrawal's shape and the refusal's wording, pure |
| `db/migrations/0011_id_set_withdrawal.sql` | `withdrawn_note`, `replaced_by`, the access log's new actions |
| `app/api/id-sets/[id]/withdrawal/route.ts` | `PUT {note?, replacedBy?}` withdraws; `DELETE` restores |
| `app/api/id-sets/[id]/usage/route.ts` | what names a set, counted (owner only) |

## Testing it

Each layer can be tested without the ones around it:

- **The rules** — `test/links.test.ts`: what is stored and kept, reading back, writes beside a link,
  validation, ids, the withdrawal's wording. No server, no browser.
- **The page's side** — `test/link-state.test.ts` drives `link-state.ts` with a stand-in address
  bar, history and `/api/links` whose answers the test can hold or fail: shortening, a write that
  races a store, a failed store, a run of edits stored once when idle, `flushLink`, Back to a
  shortened entry, opening and making links.
- **The stores** — `linkContract` and `idSetContract` in `test/support/store-contracts.ts`, run on
  an in-process Postgres (`npm run test:db`) and on `lib/db.ts`'s own fallback (`npm test`): ids,
  immutability, read-by-id for anyone, owner-only management, withdrawal and restore, twins, usage
  counts, unowned sets stored once and managed by nobody.
- **The request boundary** — `test/request-boundary.db-test.ts`: a request reads a set for anyone,
  and a withdrawn set stops the request before it runs.
- **The browser** — `test/e2e/links.cjs` (an area of `node e2e.cjs`): the round trip through
  `?s=`, a reload, a fresh signed-out browser, loading and missing links, a failed store, the
  comparison page, a signed-out reader's long document storing its list once as an unowned set its
  link names, and withdrawing and restoring from the Id lists tab. Its helpers steer the page
  without touching the server, and any other area can import them:
  - `linkMax(ctx, n)` shortens past `n` characters, by setting `window.__cbioLinkUrlMax` before the
    page loads. That is the test hook `currentLinkUrlMax()` reads; it overrides `LINK_URL_MAX`.
  - `holdLinks(page)` holds every `GET /api/links/<id>` until the `release()` it returns is called.
  - `failStore(page)` answers every `POST /api/links` with a 500.
  - `window.__cbioLinkIdleMs` sets the idle wait before storing (`currentLinkIdleMs()`), as
    `__cbioLinkUrlMax` sets the limit; the unit tests set it to 0, or wait it out.

  The e2e server runs on `lib/db.ts`'s in-memory Postgres, so links and sets a check stores are
  real and disappear when the server stops.

## Not yet covered

- **Links a page builds as `href`s** still carry their parameters in full. This applies to the
  Results page's `?filters=` from the query editor, the examples' "copy link", and the
  `/oncoprint-lab` `?spec=` links, which have their own cut (`lib/lab-links.ts`). A soft navigation
  to one that is past 16 KB would fail.
- **Stored links and unowned sets are never deleted** and have no per-client rate limit. A link
  holds at most `LINK_STORE_MAX` characters and a set `ID_SET_MAX` ids, so they grow with use; a
  deployment open to the internet may want a limit in front of `POST /api/links` and
  `POST /api/id-sets`. Neither records when it was last read, so nothing yet tells a link someone
  opened from one only its maker's page wrote.
- **A stored link belongs to the deployment that stored it.** Opening it on another one says it
  isn't held there.
- **Legacy links** (`session_id`, `comparisonId`, `#filterJson`) are not read.
