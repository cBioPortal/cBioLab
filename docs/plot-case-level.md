# Plot view: case-level colouring (gene alterations, clinical values)

Status: **proposed, not started.** Written so a later session can pick it up cold. Read the
whole file, then `docs/DATA-BOUNDARY.md` (this plan leans on it throughout), then start at
"Phases" step 1.

## The gap

cBioPortal's results-view **Plots tab** colours each case. Its rules are in
`src/shared/components/plots/PlotsTabUtils.tsx`, `makeScatterPlotPointAppearance`, in the
reference clone at `~/cbioportal-frontend`:

- **Fill = mutation type** of the case's mutation in the chosen gene, using the oncoprint's
  palette. With driver annotation on, drivers and VUS get separate shades
  (`oncoprintMutationTypeToAppearanceDrivers`).
- **Border = copy number or structural variant**: amplification red, deep deletion blue
  (`CNA_COLOR_AMP` / `CNA_COLOR_HOMDEL`), SV its own colour (`getCnaAndSvAppearance`).
- **"Not profiled"** has its own look (`notProfiledMutationsAppearance`), distinct from "not
  mutated". This is the panel-aware distinction this repo already insists on elsewhere.
- **Clinical colouring** (`ColoringType.ClinicalData`) replaces all of the above.
- Every point has a hover tooltip naming the sample, and cases can be searched and highlighted.
- The portal fetches every case to the browser and, for big scatters, merges nearby points
  with a quadtree (`downsampleByGrouping.ts`).

Our plot view (`lib/plot.ts`, `lib/federation.ts` `plot()`/`plotPoints()`, `plotSvg` in
`lib/view-svg.ts`) is aggregate-first:

- A scatter is a density grid, a box is quartiles plus a violin, a table is counts.
- Colour and ring exist **only on box plots**.
- Case-level points exist only as the box plot's overlay: `PatientLevelResolver.plotPoints`,
  capped at `POINTS_CAP` = 5,000.

So a scatter can't be coloured by gene alteration at all.

## Constraints that shape the design

- **The patient-data boundary** (`docs/DATA-BOUNDARY.md`, invariant 10). Only a patient-level
  participant can return case rows. `plotPoints` lives on `PatientLevelResolver` alone, and
  `isPatientLevel` is the type guard; this is the "missing method, not a flag" rule. An
  aggregate-only or remote participant must still get a useful, honest answer.
- **Nothing is dropped without saying so** (`CLAUDE.md`, UI conventions). If points are merged,
  or the plot falls back to density, the caption says so and says why. A legend lists every
  category it colours, or pools the rest into a disclosed "other" (`legendFor`, `COLOR_CAP`).
- **Panel-aware profiling.** "Not profiled" is a category of its own, never folded into "not
  mutated". Reuse the oncoprint's coverage logic; don't re-derive it.
- **One renderer per figure.** Chat and MCP need a static image, so the server SVG stays. An
  interactive client renderer is added *next to* it, the way the oncoprint has both. The
  interactive version is not a replacement.
- **The document holds what changes the picture** (invariant 9). A colour choice goes in the
  view (`colorBy`); hover and highlighted cases stay in browser state.

## Design: two tiers

### Tier 1: case-level, for entitled participants

When every site in the plot is patient-level (the common single-study case):

1. **One row per case**, from a generalised `plotPoints` that covers scatter and table as well
   as box. Each row carries:
   - `id` (sample or patient id; allowed here because the participant is entitled)
   - `x` and `y` (numbers, or categories for a categorical axis)
   - `fill`: the mutation class
   - `stroke`: the CNA/SV class
   - optionally a clinical colour value
2. **Colour by gene**, as a new colour source mirroring the portal's `ColoringType`:
   `colorBy: { source: "gene", gene, show?: ["mutation", "cna", "sv"] }`. Computed per case in
   SQL, in one pass beside the axis selects:
   - `fill`: the case's highest-priority mutation in the gene, using the oncoprint's mutation
     priority (`lib/oncoprint-style.ts`, so nothing forks), split driver/VUS by the pinned
     OncoKB, as the oncoprint and the lollipop do.
   - `stroke`: amplification / deep deletion / SV / none.
   - Not profiled for the gene (panel coverage) is its own class.
   - Clinical `colorBy` stays as it is and replaces gene colouring, as on the portal.
3. **Payload and the cap.** About 30 bytes a case gives roughly 0.75 MB for MSK-CHORD's 25k
   samples, which is fine. GENIE's 290k would be about 9 MB, which is not. Raise the case cap
   (start at ~50k and measure). Above the cap, or on any aggregate-only site, the plot uses
   tier 2 and says so. Don't copy the portal's silent quadtree merge. If merging is ever
   added, each merged glyph must state how many cases it stands for.
4. **Rendering.** Add a client `PlotFigure` on a `<canvas>`, like `OncoprintFigure`: points by
   fill and stroke, hover showing the sample id, the axis values and the alterations,
   search-to-highlight, and a legend of the classes actually present. `plotSvg` keeps drawing
   the same points for chat and MCP (SVG up to a few thousand, density above that, with a
   caption).

### Tier 2: aggregates, for everyone else

For federated, aggregate-only or over-cap plots, colour still works, as **counts per (bin,
category)**. That's an aggregate, so any participant can answer it, and sites pool by summing
against the shared extent the federated scatter already negotiates (`plotExtent` /
`plotBinCounts`):

- **Scatter:** each density cell is coloured by its commonest class. Its mix shows on hover,
  and the caption states the share of cases in mixed cells.
- **Box:** unchanged. The violin already splits by colour class.
- **Table:** each cell shows its class split as a small stacked bar.
- The site applies the suppression floor before returning (`minCount`, as `lollipopCte` does)
  wherever a (bin, category) count could single someone out.

## Phases

Do these in order; each one ships on its own. Run `npm test` and a focused Playwright check
per phase, not the full gate each time.

1. **Per-case gene classes, in SQL.** A builder next to `plotPointsSql` that produces `fill`
   and `stroke` per case for one gene: mutation priority, driver split, CNA, SV, not profiled.
   Unit tests for the class rules. A boundary test that only `PatientLevelResolver` can call it.
2. **Scatter points, tier 1.** Generalise `plotPoints` beyond box. Add `colorBy.source =
   "gene"` to the document, `validateAxis` and `lib/dsl-reference.ts` (then `npm run
   docs:gen`). Have `plotSvg` draw coloured points for a small cohort. Check against the
   portal: for one study and gene, the per-class case counts must match its Plots tab.
3. **The interactive `PlotFigure`** (canvas): hover with sample id, search/highlight, legend.
   The app uses it; chat and MCP keep the SVG.
4. **Borders and clinical colouring on scatter**: CNA/SV strokes, the not-profiled look,
   clinical colour, `ringBy` carried over.
5. **Tier 2**: `(bin, category)` count builders (boundary-swept), pooled across sites,
   rendered as dominant-class cells with the mix on hover. Captions for every fallback.

## Open questions

- **The cap**: 50k to start? Measure the SQL time and payload on GENIE before deciding.
- **Driver definition**: OncoKB-only here; the portal also counts hotspots and custom
  annotations. Say so in the legend, as the lollipop's note already does.
- **Multiple genes**: the portal colours by one gene at a time. Keep it to one unless asked.
- **Sample vs patient unit**: in patient mode, which of a patient's samples sets the colour?
  Probably the highest-priority alteration across them. Decide and caption it.
