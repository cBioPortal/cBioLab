# cohortlab

The Cohort Lab oncoprint render contract, in Python: decode it, build it from local tables,
draw it, export it.

An oncoprint here is one JSON object — the *render contract* — carrying a bitmask per cell, the
tracks, the column groups and the conventions the numbers were computed under. The server
compiles a spec to SQL and produces that contract; this package reads the same contract, builds
one from tables of your own, and renders it. The TypeScript implementation in `lib/` is the
reference, and a conformance test asserts this port produces byte-identical contracts and
identical level-of-detail buckets for the same input.

```bash
pip install cohortlab            # numpy only; matplotlib for figures
pip install 'cohortlab[plot]'
```

## Three ways in

```python
from cohortlab import Oncoprint

# 1. local tables, no server: the shape cBioPortal's Oncoprinter accepts
op = Oncoprint.from_tables("events.tsv", "clinical.tsv", "coverage.tsv",
                           group_by="CANCER_TYPE", sort="STAGE")

# 2. a Cohort Lab instance: it compiles the cohort DSL and returns the binary contract
op = Oncoprint.from_server({"study": "msk_chord_2024",
                            "genes": ["TP53", "KRAS", "EGFR"],
                            "clinical": ["CANCER_TYPE"]},
                           server="http://localhost:3107")

# 3. a contract saved earlier
op = Oncoprint.from_file("figure.opb1")
```

## Merged rows

A gene list entry may be a group, drawn as one row — cBioPortal's `[TP53 MDM2 MDM4]`. The row is
altered where any member is altered and profiled where any member was profiled, so its percentage
is over the union of the members' panels.

```python
op = Oncoprint.from_tables("events.tsv", genes='["TP53 pathway" TP53 MDM2 MDM4] KRAS')
op = Oncoprint.from_tables("events.tsv", genes=[{"label": "TP53 pathway", "genes": ["TP53", "MDM2"]}, "KRAS"])
op.tracks["TP53 pathway"]        # the merged cells
op.contract.track("TP53 pathway").meta["members"]
```

Per-track OQL inside a bracket (`[TP53: MUT MDM2: AMP]`) is refused rather than quietly drawn as
the whole gene.

## What you get

```python
op.tracks["TP53"]        # numpy int16, one cell per column; -1 is not profiled
op.columns               # the ids, in drawn order
op.frequencies()         # altered % and driver % per gene, overall and per column group
op.to_frame()            # pandas: tracks x columns, values spelled out
op.contract.conventions  # what a column is, what the denominator was, which annotation pin
```

The cells are a bitmask, so ordinary numpy answers ordinary questions:

```python
from cohortlab import BITS
tp53, kras = op.tracks["TP53"], op.tracks["KRAS"]
both = (tp53 > 0) & (kras > 0) & (tp53 != -1) & (kras != -1)
print("co-altered:", int(both.sum()))
print("TP53 truncating:", int(((tp53 & BITS["TRUNCATING"]) > 0).sum()))
```

## Drawing

```python
op.save("figure.png", width=1400)   # matplotlib
op.save("cells.tsv")                # the portal's tabular export
op.save("figure.opb1")              # the binary contract
fig = op.figure(width=1400)         # a matplotlib Figure to compose with
img = op.raster(width=1400)         # RGB uint8 array, no matplotlib needed
```

Rendering is level-of-detail: when there are more columns than pixels, each output pixel
aggregates the columns under it — a bitwise OR for gene tracks, a mean for numeric ones, the
most frequent category otherwise. A 400,000-column contract rasterises at 1,500 pixels wide in
tens of milliseconds, and it is the same rule the browser and the server SVG use.

## Style

Every visual decision — the palette, the glyph bands, which alteration a mixed cell shows, the
legend — is data in `style.json`, generated from the TypeScript module so the two cannot drift.
Override any of it per figure:

```python
op = Oncoprint.from_tables("events.tsv", display={
    "style": {"palette": {"unaltered": "#f0f0f0"}, "glyph": {"vusStyle": "fade"}},
    "colors": {"CANCER_TYPE": {"Lung": "#1d3557"}},
})
```

Overrides are validated loudly: an unknown key, a colour that is not `#rrggbb`, or a change
that would make not-profiled indistinguishable from unaltered raises rather than being ignored.
Keys that change *meaning* rather than appearance — the bitmask, the alteration priority — are
refused outright.

## Command line

```bash
python -m cohortlab --events events.tsv --clinical clinical.tsv \
                    --group-by CANCER_TYPE --sort=STAGE --out figure.png
python -m cohortlab --spec spec.json --server http://localhost:3107 --out figure.png
python -m cohortlab --contract figure.opb1 --out cells.tsv
```

## Honesty is the caller's, for local data

With no coverage table every case counts as profiled for every gene, and with no driver column
nothing is called a driver. The library will not guess what was assayed or what is oncogenic;
it draws what it is given and says what it drew in `contract.conventions`.
