# Quick add: an inline, chip-based cohort filter composer

Status: **draft, under discussion — not yet built.** This replaces the "Quick add" tab built on
`session/cohort-input-methods` (one textarea + a suggestion list below it, every add a click,
nothing ever parsed) with something considerably more capable: clauses that persist as chips
*inside* the input itself, contextual suggestions that change shape based on what kind of clause
is being built, and explicit and/or composition that follows the DSL's actual rules. The existing
tab is the fallback/reference implementation until this is built; nothing here is live yet.

## Why change course from the current Quick add

The current version is deliberately dumb: type a substring, get a flat list of matching
clinical-value / gene / event suggestions, click one, it's added, the box goes back to empty. That
avoids ever parsing free text — safe, but it means every clause takes a fresh search from zero,
there's no visible history of what you've built except the separate draft bar below, and there's
no way to build a *relationship* (a gene's alteration type, an event's temporal link to a second
event) without either a lot of typing precision or bailing out to the Cohort builder tab's forms.

The ask: keep typing as the primary gesture, but let the box **remember** what's already been
committed (as chips, inline, cursor continuing after them) and **change what it suggests** based
on the kind of clause currently being built — type a gene, get alteration-type suggestions; commit
an event, get relationship suggestions to chain a second one.

## Decided

**Interaction model: chip row + trailing input**, not a literal `<textarea>` and not a rich
contenteditable. Each finished clause is a real, individually-removable chip element (a `<span>` /
button, not text); a plain text `<input>` sits immediately after the last chip and is where typing
and the live suggestion list both happen. Committing a suggestion turns the current input's
content into a new chip, clears the input, and the cursor stays in it — visually "the cursor
follows the chips" without needing embedded widgets inside real text, which a `<textarea>` can't
host and a contenteditable can only host with real cross-browser fragility. This is the same shape
as Gmail's recipient field or Linear's filter bar. Wraps to a new line once the chip row plus input
don't fit one line, same as those.

**Every chip still comes from a clicked suggestion, never from parsing typed text as a clause.**
What's new relative to the current Quick add is that *building toward* a chip can take more than
one click (gene → alteration type → optional driver-only, or event → relationship → second event →
duration) — but at every step, the thing that advances state is a suggestion the user clicked, not
a guess at what a raw string means. This preserves the "loud rejection, never silent
approximation" principle the rest of the DSL/UI holds to.

**And/or semantics, grounded in what the compiler actually does** (`lib/cohort2.ts`,
`lib/oql.ts`), not invented fresh:

- `CohortDef.all` is an array that's always AND'd. Two clauses of **different** kinds (a gene
  condition and a clinical value, say) landing in `all` as two separate entries is already a true
  AND — no wrapping needed, no connector has to be typed for this case.
- Within **one** `oql` clause, multiple gene entries (semicolon-joined) compile to "altered by ANY
  entry" — OR. `addClause`'s existing oql branch already merges any second gene addition into the
  first clause's `q` this way, from every current surface (gene-table clicks, the Gene condition
  tab, today's Quick add). **Confirmed decision: keep matching that** — two gene chips committed
  back-to-back, no typed connector, merge into one OR'd oql clause. Typing "and" explicitly between
  two gene chips instead produces two separate top-level `all` entries (true AND — "both altered",
  which today has no UI path at all).
- Within one `clinical` categorical clause, multiple values on the *same* attribute are already an
  OR list (`values: [...]`) — same story, same default-OR-unless-"and"-typed rule applies.
- OR across **different** kinds needs the explicit `{any: [...]}` wrapper the compiler already
  supports (`{any:[leaf, leaf]}`) — this is new plumbing relative to what `addClause` does today
  (it only ever appends to flat `all`). **Scope question below** — is this in v1?
- `{not: leaf}` negation exists in the DSL. **Scope question below.**

**"Commits a clinical event" means a timeline event** (`event` clause kind — Progression,
Treatment, Diagnosis, ...), not a `clinical` attribute/value clause. After a timeline event chip is
building, suggest BEFORE / DURING / NOT_FOLLOWED_BY to chain a second event, mirroring the existing
Timeline sequence builder's `a` → `rel` → `b` shape (`seqSelector`/`addSeqFilter` in
`app/lab/page.tsx`) — reused, not reinvented.

## Per-kind suggestion flow (proposed — confirm before building)

**Clinical**: type → live-match clinical attribute names and values (as today) → click a value
suggestion → **one chip, done immediately.** No multi-step needed; a clinical value clause has no
further structure to build.

**Gene condition**: type a gene symbol → suggestions become alteration types (any alteration /
mutated / specific protein change… / mutation class… / amplified / homozygously deleted / any
copy-number alteration / fusion / expression threshold…, matching the Cohort builder's existing
Gene condition panel) → picking one either finishes the chip immediately (any/amplified/homdel/
fusion/CNA) or asks one more inline question (a protein-change text prompt, a class picker, a
threshold number+operator) → **then** offer "+ driver-annotated only" as a same-chip modifier
suggestion before finalizing → commit as one chip labeled like `TP53: MUT=DRIVER_R175H`.

**Timeline event**: type an event-type substring → suggestions are matching event types (plus
"Treatment line (derived)" when the study has treatment-like events, matching `LINE_TYPE` today) →
picking one asks for an occurrence modifier (any / first / last, or a line-number operator for the
derived line type) → then asks "just has this event" (commit as one chip) vs. chain a relationship
→ if chaining: relationship suggestions (followed-by/during/not-followed-by) → a duration number
for followed-by/not-followed-by → a second event, same flow as the first → optional
"treatment-naive before the first event" guard → commit as **one** chip representing the whole A/
rel/B clause.

*Open question in this flow*: the full Timeline sequence builder also has `lineGap` (the "new line
after N days" dropdown) and the prior-treatment guard checkbox. Cramming every one of those into
an inline chip-building sequence risks exactly the "overwhelms the user" outcome Quick add was
built to avoid. Proposal: support the common path (occurrence, relationship, duration) inline, and
surface an escape hatch — "…more options" suggestion that jumps to the Cohort builder tab's
Timeline panel with the in-progress event pre-filled — rather than building every rare option into
the inline flow. **Needs your confirmation.**

## Open questions

1. **Cross-kind OR (`{any:[...]}`)** — in scope for v1, or defer? Building it means `addClause`
   needs new logic to *restructure* an existing `all` entry into an `any` wrapper when the user
   types "or" between two different-kind chips, which today's `all`-only appending can't do.
2. **Negation (`{not:...}`)** — in scope for v1, or defer? No existing UI surface builds `not`
   clauses at all today (only hand-written JSON/examples use it).
3. **Editing a committed chip** — click to reopen and change it (e.g. "TP53: mutated" → "TP53:
   amplified"), or is the only path delete-and-retype? Backspace-when-input-is-empty removing the
   last chip (standard chip-field behavior) seems uncontroversial either way — confirm?
4. **The separate draft bar below** (count, live match, Save as a Cohort, clear) — does the chip
   row replace its pills entirely (no more duplicate display of the same clauses), with the bar
   below reduced to just count + Save/Analyze/clear? Assumed yes, unless you want the pills kept
   as a secondary always-visible list too.
5. **The event-flow escape hatch above** — confirm the "common path inline, rare options via a
   jump to Cohort builder" split, or say what should move inline instead.

## Not addressed here

Whether this replaces the existing Cohort builder tab (type-then-form) entirely, sits alongside it
as a third option, or Cohort builder's forms become the "advanced" escape hatches this doc's
open question 5 gestures at. Existing Quick add's simple flat-list-of-suggestions version is
untouched until this spec is settled and building starts.
