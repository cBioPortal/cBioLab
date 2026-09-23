# Non-oncoprint visualization: planned d3 math-module migration

Status: **agreed, not yet started.** Written up so a future session (any worktree — this
survives independently of the `cbio-next-onco-tweaks` project folder) can pick it up without
re-deriving the research. If you're that session: read this whole file before writing code, then
start at "Phased plan" step 1.

## Where this came from

A design discussion questioned why `lib/view-svg.ts` hand-rolls every chart (SVG built as
template strings) instead of using an existing plotting library, given a session had just spent a
while finding and fixing several axis/scale bugs in the Plot view. The conclusion, after research,
was **not** to adopt a charting framework — narrower than that.

### The oncoprint is out of scope here

The oncoprint's own canvas (browser) + SVG (server/CLI/MCP) rendering, and its Python port
(`python/cohortlab`) conformance tests, are unrelated and untouched by any of this. This doc is
about the *other* nine view kinds: `survival`, `hotspots`, `compare`, `cooccurrence`,
`coexpression`, `clinical`, `course`, `sequence`, `cox`, `plot`.

### Only 4 of those 9 are actually single-rendered

Checked directly against `app/lab/page.tsx`: `plot`, `sequence` (treatment-line Sankey), `course`
(clinical timeline), and `cox` (forest plot) have **no other renderer** — the SVG string in
`lib/view-svg.ts` is the only code that ever draws them, in the app itself as much as in chat/MCP.
The other five (`survival`, `hotspots`, `compare`, `cooccurrence`, `coexpression`, `clinical`)
already have an independent, better interactive renderer in the app (`survival` gets a live
`<canvas>` — `KMChart`, `app/lab/page.tsx` — the rest render as plain HTML `<table>`s or
positioned `<div>`s). For those five, `view-svg.ts`'s version is a low-traffic secondary path
(chat/MCP only) and is **not** part of this migration — no changes planned there beyond the shared
tick-generation fix noted for `hotspots`/`course` below.

### Only the oncoprint needs Python parity

Confirmed by grepping `python/cohortlab/*.py`: it's exactly one `Oncoprint` class wrapping a
matplotlib renderer, no survival/plot/Sankey/forest-plot code at all. So "must render identically
in a non-JS runtime" doesn't constrain any of these nine kinds — only "must render identically in
the browser, chat, and MCP" does (all three are JS/Node).

### Library survey verdict: no framework, three small math modules instead

| Library | Verdict |
|---|---|
| **Observable Plot** | Dead end — needs a real DOM; headless use means jsdom per chat/MCP request, reintroducing exactly the fragility/cold-start cost hand-rolling avoided. Don't revisit without a strong new reason. |
| **Vega / Vega-Lite** | Real headless SVG story, but Vega-Lite has no native Sankey, violin, or forest-plot marks — you'd relocate the hand-rolled logic into a Vega spec DSL instead of removing it, and add a third rendering paradigm to the app (canvas + React/tables + Vega specs). |
| **visx** | Genuinely can render server-side via `ReactDOMServer.renderToStaticMarkup`, zero DOM needed (confirmed React-19-compatible at v4). But it's primitives only — no off-the-shelf violin/Sankey/forest-plot component — so `plot` and `sequence` would be exactly as hand-built, just as JSX instead of template strings. Net wash for the two hardest charts. |
| **`d3-scale` + `d3-shape` + `d3-sankey`** | **Recommended.** Pure math/path-generator modules, DOM-independent by design (unlike `d3` selections/the full bundle). Map directly onto the specific pieces that are algorithmic rather than domain-bespoke, and are the ones that have actually produced bugs: tick generation, log/linear scale mapping, step-curve paths, Sankey layout. |

These are **three separate small npm packages**, not one library — `d3-scale`/`d3-shape` happen
to also be two of the ~30 modules bundled into the `d3` meta-package, `d3-sankey` is a related but
separately-published package in the same family, not part of the `d3` bundle. Installing the three
directly (not the `d3` umbrella) avoids pulling in the ~27 irrelevant modules, including the
DOM-mutation ones (`d3-selection`, `d3-transition`, `d3-drag`, `d3-zoom`) this codebase has no use
for. None of this touches client bundle size regardless — `lib/view-svg.ts` only ever runs
server-side (the API route and MCP process pre-render the `.svg` string; the browser receives the
finished string in JSON and never imports this file).

**What this buys, honestly:** fewer axis/scale/step-path/Sankey-layout bugs, using tested
algorithms for the genuinely algorithmic parts. **What it does not buy:** no violin/box-whisker
primitive, no log-density heatmap shading, no fixed-per-case-jitter point logic — `plotSvg`'s
hardest parts stay exactly as bespoke as today in any architecture surveyed. No new
interactivity/tooltips/zoom on the static charts either.

### The aggregation-first design question (raised separately, resolved: mostly keep it)

Whether to relax "server pre-aggregates, never sends raw points" (bins/quartiles/contingency
cells instead of rows) was reconsidered alongside the library question. Conclusion: the existing
`POINTS_CAP`-gated pattern in `lib/federation.ts` (raw points for small, patient-level-entitled
cohorts; aggregate fallback for huge or federated/aggregate-only ones — see
`docs/DATA-BOUNDARY.md` invariant 10, "a missing method, not a flag") is already the right shape
and should be the template for any further relaxation, not special-cased again per view kind.

- Worth relaxing further: **`sequence`** (Sankey) and **`course`** (clinical timeline) — both
  typically small per-patient cohorts where raw paths/timelines would let the browser do more
  (e.g. interactive hover), currently pre-flattened server-side unconditionally.
  Any such change must stay conditional on `isPatientLevel`/entitlement, exactly like the existing
  `plot` points overlay.
- Not worth relaxing: **`survival`** (the KM curve's aggregate literally *is* the answer — raw
  (time, event) tuples buy nothing over the already-tiny step-point list, and log-rank
  stratification has to happen server-side once regardless of participant type) and **`cox`**
  (the forest plot itself is tiny; the fit already needs patient-level rows through a separate,
  existing path — the plot output doesn't need raw rows).
- This is a separate, independent decision from the library migration below — do it if/when it
  comes up again, not gated on the d3 work.

## Phased plan

Do these **in order**, smallest/lowest-risk first, one commit per step, running `npm test` after
each (there's a golden-SVG-style pinning convention elsewhere in this repo —
`test/view-svg.test.ts` may need `UPDATE_GOLDEN=1`-equivalent review if any exact-string
assertions break; that's expected and fine, review the diff rather than blindly re-pinning).
`npm install d3-scale d3-shape d3-sankey` (plus `@types/d3-scale @types/d3-shape @types/d3-sankey`
as dev dependencies) is the only setup step — do it once, before step 1.

1. **`coxSvg`** (`lib/view-svg.ts`, ~28 lines, forest plot). Swap the manual log-axis math for
   `d3-scale`'s `scaleLog()`. Smallest possible change, proves the import/pattern works in this
   server-only module with no regression surface beyond one axis.
2. **`sequenceSvg`** (~111 lines, the treatment-line Sankey — currently the densest, most
   bug-prone function in the file). Replace the hand-rolled node-stacking and ribbon-offset
   bookkeeping (`box`/`outOff`/`inOff`) with `d3-sankey`'s layout solver
   (`sankey().nodeWidth().nodePadding().extent()`). Keep the existing bezier-ribbon SVG path
   template and this view's genuinely custom semantics (stopped-vs-censored terminal
   distinction, one shared scale across all panels, global regimen color ranking) — only the
   node/link layout math is worth outsourcing, `d3-sankey` doesn't need to know about any of that.
3. **`survivalSvg`** (KM step function). Replace the hand-rolled "hold then drop" step-path string
   construction with `d3-shape`'s `line().curve(d3.curveStepAfter)`, and swap the axis math for
   `d3-scale`.
4. **`hotspotsSvg`** and **`courseSvg`**: both hand-roll the identical "nice tick step" rounding
   array (`[1, 2, 2.5, 5, 10]` magnitude search) independently. Replace both with `d3-scale`'s
   `scaleLinear().nice().ticks()` — one fix, same bug class, applied twice.
5. **`plotSvg`** (~200 lines, biggest, do last). Only the linear/log axis-scale math is worth
   swapping to `d3-scale` here — box/violin/log-density-shading/jittered-points logic stays
   exactly as bespoke as it is today; no library surveyed solves any of that.

No changes planned to `compareSvg`/`cooccurrenceSvg`/`coexpressionSvg`/`clinicalSvg`/`barsSvg`
beyond whatever incidental cleanup falls out of the above — they already have independent, better
interactive renderers, so their SVG path is low-traffic and not worth further investment on its
own.
