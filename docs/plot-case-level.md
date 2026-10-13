# Plot view: case-level points, colouring and interaction

Status: **phase 1 in progress** (`session/plots`). Written so a later session can pick it up
cold. Read the whole file, then `docs/DATA-BOUNDARY.md` (this plan leans on it throughout).

## The gap

cBioPortal's results-view **Plots tab** draws every case as a point and makes each one
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
- Everything is Victory SVG, one DOM node per point, with no cap and no downsampling.

Our plot view (`lib/plot.ts`, `lib/federation.ts` `plot()`/`plotPoints()`, `plotSvg` in
`lib/view-svg.ts`) is aggregate-first: a scatter is a density grid, a box is quartiles plus a
violin, a table is counts. Case-level points existed only as the box plot's overlay below
`POINTS_CAP` (5,000) and as highlight cohorts.

## The model: every point when it is a drawing, the cases that matter when it is not

Past a few thousand cases a scatter is a density picture whatever renders it: points overlap and
a hover lands on an arbitrary one. Shipping and drawing every case (the "WebGL, a million
points" design) buys interaction with cases nobody can tell apart. So:

- **At or under `POINTS_CAP`, every case is a point**, on a scatter as on a box — the portal's
  picture, and what most single studies get.
- **Over the cap, the crowd is density and a chosen subset is points.** The subset is decided
  in the database and is always small enough to draw (and to send with ids inline, so no
  binary columns, no lazy tooltip fetch, no client spatial index):
  1. **Outliers.** On a box, the values beyond each group's Tukey whiskers. On a scatter, the
     cases in *sparse* cells of the density grid: every cell holding at most `k` cases is
     replaced by its points, `k` the largest value up to `OUTLIER_CELL_MAX` whose points fit
     under the cap (`sparseCellMax`). Dense regions stay density; the fringe becomes cases.
     This falls out of the bin query the scatter already runs.
  2. **Matches** (phase 3): cases matching a search (case id, protein change) or a highlight —
     the reader asked for them, so they are always points.
  3. **Rare colour classes** (phase 2): with colour by gene, the mutated / amplified minority
     drawn as points over a grey density of the rest — the reading the portal's colouring
     exists for ("where do the mutated cases sit?").
  4. **Drill-down** (phase 4): a brushed region or a clicked cell returns its cases as points;
     "open in study view" resolves the region to the FULL case list on the server.
- **Nothing is dropped silently.** `PlotData.pointSet` says which rule drew the points, how
  many, and why there are none when there are none; the caption says it in words ("312 cases
  in sparse cells drawn as points; 12,775 as density").
- **The boundary.** Only `PatientLevelResolver` returns points (`plotPoints`,
  `plotScatterPoints`, `plotHighlightPoints`). An aggregate-only or federated participant gets
  the density alone and the caption says why.
- **The document holds the rule** (`points: false` turns points off — invariant 9: it changes
  the server SVG). Hover, search text, a legend-click highlight and a brush stay in browser
  state.

## Phases

Each ships on its own. `npm test` and a focused check per phase; the gate before each push.

1. **Point subsets on the server (done on `session/plots`).** Scatter: every point at or
   under the cap, sparse-cell outliers over it. Box: every point at or under, whisker outliers
   over it (over a violin clipped to the whiskers). `pointSet` and captions. The box axis now
   spans the points it draws (points beyond the whiskers used to spill outside the frame).
2. **Colour by gene per case.** `colorBy: { source: "gene", gene }`: fill from the case's
   highest-priority mutation (oncoprint priority, driver/VUS by the pinned OncoKB), stroke from
   CNA/SV, "not profiled" its own class (panel coverage, reuse the oncoprint's). Colour on
   scatters too, not only boxes; the rare classes are added to the point subset over the cap.
   Check per-class counts against the portal's Plots tab for one study and gene.
3. **Interactive `PlotFigure`** (canvas, beside the server SVG, which stays for chat/MCP):
   hover tooltip (sample id linking to the patient view, values, alterations), legend-click
   highlight, case-id / protein-change search whose matches come back from the server as
   points.
4. **Brush and drill-down**: a region or a cell returns its cases as points; "N cases → study
   view" built from the full list on the server.
5. **Sidebar parity**: log toggle, "same gene", Driver vs VUS and VAF axes, box category filter
   and sort-by-median, regression line toggle, R² and the equation.

Backlog: waterfall ("ordered samples"), generic assays and SV axes, bar charts for two
categoricals, the examples bar, SVG/PNG/data export, a method record for the plot's
correlations (it is on the method-check exempt list as "no statistic", which it is not).

## Open questions

- **The cap**: 5,000 for points is the box plot's existing value. Measure the canvas figure
  before raising it.
- **`OUTLIER_CELL_MAX`**: 3 on the default 240×160 grid. A coarser grid makes "sparse" mean
  more; revisit if `bins` becomes a UI control.
- **Federated points**: a federated box concatenates each entitled site's points; a federated
  scatter draws none yet (its sparse cells are only known after pooling, so it needs a second
  pass per site with the pooled cell list).
- **Driver definition**: OncoKB-only here; the portal also counts hotspots and custom
  annotations. Say so in the legend, as the lollipop's note already does.
- **Sample vs patient unit**: in patient mode, which of a patient's samples sets the colour?
  Probably the highest-priority alteration across them. Decide and caption it.
