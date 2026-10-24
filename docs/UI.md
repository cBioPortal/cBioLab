# UI conventions

How the pages are laid out, and how they wait and disclose. These hold for every view kind, and for
the chat/MCP figures that share its renderers. [`CLAUDE.md`](../CLAUDE.md) indexes them.

## UI conventions — the layout system

Added by a design audit of the analysis page; `scripts/layout-metrics.cjs` measures whether it
still holds, against a running server.

- **A figure is the data alone; anything the reader clicks is HTML beside it.** A selector, a
  legend that filters, a summary with links (the lollipop's gene summary and Driver/VUS × class
  grid, `app/_lollipop/HotspotsBody.tsx`) is a control, not part of the SVG: the figure the server
  draws for MCP and exports carries what those controls show *in words* in its caption — including
  what a selection hides — so an image that travels alone is still complete. A selection that only
  changes what is drawn is kept in the view's spec (so a link reproduces it) but applied in the
  browser from the whole result, so a click re-runs nothing (`dataPart` leaves it out of the
  re-run key). Code the browser draws with must not import server modules — `node:async_hooks`
  in a client bundle fails the whole page — which is why what the plot figure needs from
  `lib/plot.ts` lives in `lib/plot-draw.ts`.
- **One scale, in `app/globals.css`.** Seven type steps (`--t-xs` … `--t-2xl`), seven spacing
  steps (`--s0` … `--s6`), four radii, one control height (`--ctl-h`). Nothing declares a font
  size or a border radius outside it — the app once had 36 distinct font sizes, five of them
  meaning "small text".
- **New UI is Tailwind and shadcn; the app is moving onto them area by area.** The `@theme` in
  `app/globals.css` IS the scale above under Tailwind's names: `text-xs` … `text-2xl` are the
  seven type steps (Tailwind's own sizes are cleared, so an off-scale size does not exist);
  spacing is Tailwind's 4px grid, on which the steps are `1`, `1.5`, `2.5`, `4`, `6`, `9` (prefer
  those; `h-ctl` is the control height); colours use shadcn's semantic names mapped onto the
  palette — `primary` is the teal, `accent` the soft tint, `muted-foreground` the grey text,
  `destructive`, `border`, `ring`. shadcn components live in `app/_ui/` (`npx shadcn add …`,
  configured by `components.json`; the CLI writes `cn` imports as `from "cn"` and tries to
  install an unrelated `cn` package — point them at `@/lib/cn` and revert `package.json`) and are
  this repo's code to edit; join classes with `cn()` from `lib/cn.ts`, never by string
  concatenation (it knows the app's theme names, so a later class overrides an earlier one of
  the same kind). Beside them in `app/_ui/` are the app's own primitives — use these rather than
  rebuilding them: `Choice` (a dropdown from `[value, label]` pairs, where `""` may be a real
  option such as "auto") and `OptionSelect` (the same from `<option>` children) in `choice.tsx`;
  `GearMenu` / `MenuItem` / `closeGearMenu` in `gear-menu.tsx` (a button that opens a popover,
  whose open state can live in the page's `menuOpenRef` store so it survives its card
  remounting); `RemoveBadge` in `remove-badge.tsx` (a listed value a click removes, such as a
  gene); and in `toolbar.ts` the toolbar class strings `TB`, `CHIP`, `FIELD` and the tab classes
  `LINE_TABS` / `LINE_TAB` (page tabs over a rule) and `SEG_TABS` / `SEG_TAB` (a body's own selector). A
  link-looking action is `<Button variant="link" size="inline">`; a toggle chip is an outline
  `Button` with `aria-pressed`. The old stylesheet sits in the `legacy` layer, below Tailwind's
  utilities, so a utility always wins over a legacy rule; its first block restores the browser
  defaults it was written against for legacy markup, wherever it sits (a shadcn dialog
  included), but not for shadcn's own parts (`[data-slot]`) or inside `[data-tw]` — **mark the
  root of each area you convert with `data-tw`**, and delete that area's legacy rules in the
  same commit. Converting must not change what the page shows except where meant: run
  `npm run visual` (baseline first with `-- --update`, from the commit before) and account for
  every diff it reports.
- **e2e finds shadcn parts by role, not by legacy class.** A dialog is `[role=dialog].<its class>`
  (Radix unmounts a closed one, so wait for it rather than for `[open]`); a menu's items are in
  `[data-slot=popover-content]`; a select is `[role=combobox]` and its choices `[role=option]`
  (it is not a native `<select>`, so no `selectOption`); a checkbox is `[role=checkbox]`; a tab is
  `getByRole("tab")`; a removable value is `[data-slot=badge]`; a slider's handle is
  `[data-slot=slider-thumb]`. A dialog's content is portalled to `<body>`, so it is not inside the
  card that opened it. Keep a
  stable class on a component the tests target (`genesbtn`, `cohortgear`, `viewgear`), and keep
  native elements where something outside React reads them while closed — the document dialog
  is a native `<dialog>` so `#docjson` stays in the page.
- **One header per view: `ViewHead`.** Title, then this view's actions, then its status chips,
  then remove, on one baseline. Every view kind renders through it; a view that builds its own
  header is a bug, because the timing chip and the close control then move between cards.
- **Toolbars are labelled zones, not a row of controls** (`.viewtb` / `.tbz` / `.tbl`). A zone
  holds one kind of control and **never wraps inside itself**, so a pair like the zoom triple
  cannot be split by a line break; zones wrap as units and the divider is where the break
  happens. Where a view has both kinds, `data` (re-runs a query) sits left of `view` (instant).
- **One idiom per job.** In a toolbar: an outline `Button` with `TB` for a button, a `GearMenu`
  for a disclosure, a `.tbfield` label around a `Choice`/`OptionSelect` for a labelled select,
  a `.chk` label around a `Checkbox` for a checkbox — all at `h-ctl`.
- **Controls side by side are a toolbar, wherever they sit** — a card's body, a line above a
  figure, a dialog: `.viewtb` > `.tbz`, never a hand-rolled `display: flex` row. The one-height
  rule (`--ctl-h`, one font size) is the controls' own (`TB`, `FIELD`, `Choice size="ctl"`); a
  control built without it sits on another centre line at another height beside the rest. (The
  timeline's controls once shipped that way; e2e's `misalignedControls` checks it.)
- **Look at a UI change, then measure it — "renders without errors" is not done.** Screenshot the
  changed region itself at `deviceScaleFactor: 2` (a whole card at 1× hides a few pixels of
  misalignment) and compare it with the same kind of control in a neighbouring view: centre
  lines, heights, type size, spacing. Then assert the geometry in `e2e.cjs`:
  `misalignedControls(page, scope)` fails any toolbar zone under `scope` whose controls are not
  one `--ctl-h` tall on one centre line. A view that adds a control row calls it.
- **Apparatus goes in `.vfoot`.** Legend, methodology caveats and provenance stay on the page and
  a step down in weight, so they read as apparatus rather than as findings.
- **Figures are drawn in the browser at the card's width, by the renderer MCP uses.** The page
  never inlines an SVG the server drew: `ViewFigure` / `DrawAtWidth` (`app/lab/figure.tsx`)
  measure the card and call `viewToSvg(v, { width })`, and the figure is shown 1:1 — never
  scaled down (unreadable text) or up. Narrower than `MIN_FIGURE_W` it keeps that width and
  scrolls, with a fading edge and a "scroll →" cue. The analysis API therefore sends the page no
  `svg` (`?oncoprint=spec`); MCP and `?figures=svg` draw on demand. A renderer must lay itself
  out for whatever `o.width` it is given — wider means more room, not bigger type.
- **Figures share one layout kit, `lib/chart/`** (re-exported by `lib/svg-kit.ts`), and never
  guess: text is measured from IBM Plex Sans's advance widths (`textWidth`, `ellipsize`,
  `wrapWidth`, `label` — a label cut to its room keeps its full text as a `<title>`); margins
  come from the widest label (`leftAxisWidth`); ticks are round steps or powers of ten
  (`linear` / `log` / `symlog`); axes (`axisLeft`, `axisBottom`, `bandLabels`) thin or turn
  labels rather than overprint them; legends (`legend`, flowing or `grid`) wrap at the width.
  Numbers go through `lib/chart/format.ts` — `fmtInt`, `fmtNum`, `fmtPct`, `fmtP`/`pDigits`,
  `fmtRatio`, `fmtMonths` — in the figures and the HTML tables beside them alike, so a p-value
  reads the same everywhere. Type is `FS.small` / `FS.body` / `FS.title` (10 / 11 / 12), never
  below `MIN_FS`; strokes `SW`; the neutral grey `OTHER`. Series colours are `seriesStyle(i)`:
  Okabe–Ito for six, then the same hues with a dash, so a seventh cohort is never a repeat; the
  page's swatches (`SeriesSwatch`) match. Text on a fill takes `textOn(fill)`. A renderer that
  invents a colour, a size or a tick rule is drifting from every other view. Page CSS never
  reaches figures — the same drawing goes to MCP, exports, the CLI and the Python port — so they
  stay out of the Tailwind migration.
- **A figure's text is linted, at every width a card takes.** `lib/chart/lint.ts` reads a drawn
  SVG back and reports type below `MIN_FS`, text running off the figure, and text printed over
  text. `npm run check:figures` runs every documented example and every stress document
  (`scripts/figure-stress.json`: the largest studies, many cohorts and categories, long names)
  and lints each figure at 560, 936 and 1352px; it must report 0. A new view kind, or a change to
  a renderer, adds a stress document when the existing ones do not reach its crowded case.
- **Geometry stays inline, styling does not.** A tooltip's position and a legend swatch's colour
  are data computed from the drawing; borders, padding and type are classes.

## UI conventions — waiting, and never hiding what isn't shown

Every screen answers "is this current?" and "is this everything?" without the reader having to
ask. These hold for every view kind, and for the chat/MCP figures that share its renderers.

- **A settings change that waits on the server shows the view waiting.** The header and its
  controls stay visible and usable, so the reader sees what they just changed and can change it
  again; the figure area below is covered by a skeleton with an "updating…" spinner until the
  new answer lands (`Updating` in `app/lab/view-cards.tsx`, `.view-updating`). A stale figure left on
  screen reads as the new answer. The same cover goes over every view during a full document
  run, and over the oncoprint's plot during its own contract fetch. A change applied in the
  browser alone (the oncoprint's display options, zoom) is instant and gets none.
- **A control whose options come from a fetch shows a loader while it is in flight** — `Waiting`
  ("loading attributes…") in place of the select, a spinner on a menu's summary. Loading, empty
  and failed are three different states and each must say which it is: an empty select during a
  fetch reads as "this study has none". A button gated on fetched data (the add-view buttons'
  `why`) waits with a spinner via its `loading` predicate rather than guessing either way.
- **Every request a table view makes shows, in the table, that it is running** — a query change
  (search, filter, sort, columns: the view re-runs), another page, the whole document re-running.
  The rows on screen are the last answer, so they are covered ("updating…", "loading page 3…",
  `.dt-wait` in `app/_table/DataTable.tsx`) and the count is dimmed with a spinner beside it; the
  bar, chips and headers stay visible and usable, and an action that would act on the stale
  answer (the download) waits, saying why. Such a view draws its own waiting state, so the page
  must not cover its card (`drawsOwnWaiting` in its `app/lab/kinds/<kind>.tsx`, honoured by the lab and
  `PortalTabs`). Its controls show and edit the query **the document holds**, not the last result's,
  so a second edit made while the first is running keeps the first. A page not yet on hand is
  loading from the render that asks for it — never a flash of "no rows" first.
- **A menu, popover or list whose contents load never opens empty.** Its fixed controls (a
  filter's condition and text, a range's inputs) are there and usable at once; where the loaded
  part goes, a `Waiting` loader with skeleton rows stands in until it lands; controls that act on
  it (all / none) are disabled with a title saying what they wait for. Loaded-but-empty says so
  ("no values in the rows kept"), and a failed load names the error and offers retry — three
  states, never one blank box.
- **A loader must be tied to a request that will end it.** Before showing "loading…", make sure
  something is actually fetching (that is why the clinical-attribute catalog loads for any
  result, not only once a plot exists) and that failure clears it (`.finally`), or the spinner
  never stops. A failed lookup reads as unknown, never as "none" (`survivalEndpoints: null`).
- **A disabled control says why** in its title — what it is waiting for, or what the data lacks
  ("genie_public has no survival data…"), never an instruction to go somewhere else to make it
  work. The exception is an action that belongs to a *saved* analysis — editing a cohort, adding
  or editing a view's note: it is **hidden**, not disabled, until the analysis is saved
  (`analysisSaved`, `CohortEditMenu`'s `canEdit`), by the user's choice.
- **First render is a skeleton shaped like what it stands in for** (`.skeleton-view`,
  `.skeleton-cohort`), so the page doesn't collapse to a spinner and jump back to full height.
- **Nothing is dropped without saying so — in the engine, the renderers, or the UI.** A figure
  that cannot fit everything widens and scrolls (`frame(…, grown)` keeps a `min-width`), pools the
  remainder into a disclosed "other", or refuses; it never draws the first N. Captions are never
  cut — they are where the caveats live. A view states what its inputs left out (a plot's
  coverage: "145,220 of 289,869 samples have a value on both axes…"). The oncoprint legend's
  "+N more" and the sequence view's pooled "other" are the pattern to copy.
- **A request past a limit is refused with the limit named** ("a compare view takes at most 20
  genes; this asks for 25"), never cut to its first N, in the engine (`overLimit` in
  `lib/analysis.ts`) and in the UI (ticked cohorts, event pills).
- **An errored view keeps its header** (`drawsOwnHead`), so it can still be removed or moved
  without editing the JSON.
- **Keystrokes stay in the field.** A text field on the analysis page must not keep what is being
  typed in page state: `AnalysisPage` is one very large component, so every keystroke re-renders
  every view card, the oncoprint and the inlined figures (a dialog's textarea measured ~350 ms a
  key). Give the field a small component that owns its own draft and hands the page the value on
  save — the text dialogs in `app/lab/dialogs.tsx` are the pattern: mounted when opened, they start
  from the values they are given and report the result.
- **One way to change the document.** The analysis page's document lives in `app/lab/doc-store.ts`:
  `docs.set` for an edit, `docs.replace` for a different document (an example, a link, a new
  analysis), `docs.commit` for one the AI tools validated. It gives each view a stable id that keys
  its card and lets a one-view re-run find its slot, and puts every new document in the URL — so an
  edit that re-runs nothing is not lost on refresh. Never set the document any other way.
- **Verify waiting states by holding the request.** A loader that flashes past in a normal run
  proves nothing; in Playwright, `page.route()` the endpoint and hold it, check the loader is on
  screen and the controls are still usable, then release it and check the loader is gone.
