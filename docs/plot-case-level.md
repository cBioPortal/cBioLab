# Plot view: case-level points, colouring and interaction

Status: in progress on `session/plots`. Written so a later session can pick it up cold. Read the
whole file, then `docs/DATA-BOUNDARY.md` (this plan leans on it throughout).

## The gap

cBioPortal's results-view **Plots tab** draws every sample as a point and makes each one
interactive. Its rules are in `src/shared/components/plots/PlotsTabUtils.tsx`
(`makeScatterPlotPointAppearance`) in the reference clone at `~/cbioportal-frontend`:

- **Fill = mutation type** of the case's mutation in the chosen gene, using the oncoprint's
  palette. With driver annotation on, drivers and VUS get separate shades.
- **Border = copy number or structural variant**: amplification red, deep deletion blue, SV its
  own colour. SV takes precedence over CNA.
- **"Not profiled"** has its own look, distinct from "not mutated".
- **Clinical colouring** replaces all of the above (categorical, or a numeric gradient).
- Every point has a hover tooltip (sample link, both values, mutations, CNA, SV), cases can be
  searched by id or protein change and highlighted, a legend entry click highlights its class,
  and a brush on the scatter selects cases for the study view.
- A point is always a **sample**: a patient attribute is copied to each of its samples, and the
  only patient-aware option is "connect samples from the same patient" on a box plot.
- Everything is Victory SVG, one DOM node per point, with no cap and no downsampling.

Our plot view (`lib/plot.ts`, `lib/views/plot.ts`, `lib/federation.ts`, the figure in
`lib/figures/plot.ts`, the controls in `app/lab/plot-controls.tsx`) is aggregate-first: a scatter is
a density grid, a box is quartiles plus a violin, a table is counts.

## The model: every point when it is a drawing, the cases that matter when it is not

Past a few thousand cases a scatter is a density picture whatever renders it: points overlap and
a hover lands on an arbitrary one. So:

- **A point is a sample** by default, as on the portal. `unit: "patient"` makes it a patient and
  combines the patient's samples by a stated rule: a number is their mean, a category their common
  value or "Multiple" where they differ, an alteration counts if any sample has it, and the caption
  says how many patients had more than one sample.
- **At or under `POINTS_CAP` (5,000), every case is a point** (`allPoints`, default true), on a
  scatter as on a box — the portal's picture, and what most single studies get.
- **Over the cap, the crowd is density, and point layers draw chosen subsets in colour over it.**
  `points` is an ordered list of at most four layers (`lib/plot-layers.ts`):
  - `{rule:"outliers"}` (the default): where the plotted cohort is density, a box's values beyond
    its whiskers (the violin then stops at the whiskers) and a single study's scatter's cases in
    sparse cells (every cell holding at most `k` cases, `k` the largest value up to
    `OUTLIER_CELL_MAX` that fits the budget; those cells are left unshaded under their points).
  - `{rule:"extremes", axis, n}`: the `n` highest and lowest values of a numeric axis, per group
    on a box. Each study returns its own top `n`, so the pooled top `n` is exact.
  - `{rule:"trend", n}`: on a scatter, the `n` cases furthest from the fitted line.
  - `{cohort}`: the plotted cohort's cases that are also in that cohort (once called a highlight).
  `[]` draws none. Every layer shares one `POINTS_CAP` budget; a case two layers share is drawn by
  the first. A layer is never cut to its first cases: a cohort layer past the budget becomes density
  cells or a box per group, a rule layer is not drawn, and the caption says which and why. With a
  box's cases coloured by a category, a layer is a ring round the case.
- **Nothing is dropped silently.** `PlotData.pointSet` says whether the plotted cohort's own cases
  are points; each `PlotLayer` says what it holds, how many it drew, how many an earlier layer drew,
  and why it is not points when it is not. The caption says all of it in words, and that ties at a
  ranked layer's cut are broken by case id.
- **The boundary.** Only `PatientLevelResolver` returns points (`plotPoints`, `plotScatterPoints`,
  `plotRankedPoints`, `plotHighlightPoints`), and only it may build their SQL. An aggregate-only
  participant gets the density, its rule layers are not drawn, its cohort layers are aggregates,
  and the caption says why.
- **The document holds the rules** (`unit`, `allPoints`, `points` — invariant 9: they change the
  server SVG). Hover, search text, a legend-click highlight and a brush stay in browser state.
- **SVG stays.** Canvas would mean a second renderer to keep in step with MCP, the exports and the
  figure lint, for point counts nobody can tell apart. Interaction (phase 3) goes through one hover
  overlay over the SVG, not one listener per circle.

## Order of work

One commit per item; `npm test` and a focused check per item; the gate before each push.

1. **Done.** Point subsets on the server: every case at or under the cap, density plus outliers
   over it; `pointSet` and captions; the box axis spans the points it draws; one point radius.
2. **Done.** The legacy Plots tab's layout: each axis defined in a block of a sidebar, Swap axes,
   the figure beside it (`PlotControls`, shared by the lab card and the Results page).
3. **Done.** A point is a sample by default; patient mode combines samples by a stated rule.
4. **Done.** Point layers (above), replacing `highlight`, with the sidebar's Points section.
5. **Done.** Show one layer alone: each layer is a group in the SVG tagged with its place in the
   list (its cases an earlier layer drew are a hidden group of their own), and a row of buttons
   above the figure steps the rest back with one CSS rule; Esc restores. Browser state only.
6. **Measure the cap.** SVG draw time and payload at 5k, 10k, 20k and 50k points on msk_chord;
   set `POINTS_CAP` from it.
7. **Multiple genes.** An alteration axis whose OQL has several statements gets one category per
   statement (overlaps as their own category, never assigned arbitrarily), and commas separate
   statements as well as `;` and newlines.
8. **Colour by gene per case** (phase 2). `colorBy: { source: "gene", gene }`: fill from the case's
   highest-priority mutation (oncoprint priority, driver/VUS by the pinned OncoKB), ring from
   CNA/SV, "not profiled" its own class (panel coverage, reuse the oncoprint's). On scatters too;
   the rare classes become a point layer over the cap. Check per-class counts against the portal's
   Plots tab for one study and gene.
9. **Interaction** (phase 3): one overlay over the SVG maps the cursor to the nearest point (a grid
   index over the drawn points); hover tooltip (sample id linking to the patient view, values,
   alterations), case-id / protein-change search whose matches come back
   from the server as a layer.
10. **Brush and drill-down** (phase 4): a region or a cell returns its cases as a layer; "N cases →
   study view" built from the full list on the server.
11. **Sidebar parity** (phase 5): "same gene", Driver vs VUS and VAF axes, box category filter and
    sort-by-median, regression line toggle, R² and the equation, connect samples from the same
    patient.

Backlog: waterfall ("ordered samples"), generic assays and SV axes, bar charts for two
categoricals, the examples bar, SVG/PNG/data export, a method record for the plot's correlations
(it is on the method-check exempt list as "no statistic", which it is not), a horizontal box (a box
is always drawn with its categories across today).

## Open questions

- **`OUTLIER_CELL_MAX`**: 3 on the default 240×160 grid. A coarser grid makes "sparse" mean
  more; revisit if `bins` becomes a UI control.
- **Federated scatter outliers**: a pooled scatter's sparse cells are known only after pooling, so
  it needs a second pass per site with the pooled cell list; until then that layer says so.
- **Driver definition**: OncoKB-only here; the portal also counts hotspots and custom
  annotations. Say so in the legend, as the lollipop's note already does.
- **Sample vs patient unit for colour**: in patient mode, which of a patient's samples sets the
  colour? Probably the highest-priority alteration across them. Decide and caption it.
