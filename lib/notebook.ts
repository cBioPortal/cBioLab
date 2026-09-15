// A drawn oncoprint as a real Jupyter notebook: nbformat 4 JSON, opening in Jupyter, JupyterLab,
// JupyterLite, Colab or VS Code without anything of ours running.
//
// The notebook is self-contained. Its first cell carries two gzipped base64 payloads — the
// cohortlab package exactly as committed, and this figure's contract as OPB1 bytes — so no
// install, no network and no credentials are needed to re-draw the figure or work with its
// arrays. The cells after it are the ones worth reading.

import type { Contract } from "./types.ts";

interface Cell { cell_type: "code" | "markdown"; metadata: Record<string, unknown>; source: string[]; outputs?: unknown[]; execution_count?: null }

const lines = (s: string): string[] => s.split("\n").map((l, i, a) => i === a.length - 1 ? l : l + "\n");
const md = (s: string): Cell => ({ cell_type: "markdown", metadata: {}, source: lines(s.trim()) });
const code = (s: string): Cell => ({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: lines(s.trim()) });

export interface NotebookInput {
  /** the spec this figure was drawn from, echoed for provenance and for re-running it live */
  spec: unknown;
  /** the figure itself, already packed to OPB1 and gzipped, base64 */
  contractB64: string;
  /** {"cohortlab/api.py": "...", ...} as one gzipped base64 JSON object */
  packageB64: string;
  /** what the contract holds, for the prose */
  stats: { columns: number; tracks: number; unit: string; genes: string[]; groups: string[] };
  /** where this figure came from, so the notebook can ask for a fresh one */
  origin: string;
  /** stated in the notebook when the link that produced it carried only part of the figure */
  cut?: string;
}

const num = (n: number) => n.toLocaleString("en-US");

export function oncoprintNotebook(o: NotebookInput): unknown {
  const s = o.stats;
  const cells: Cell[] = [
    md(`# Oncoprint — ${num(s.columns)} ${s.unit}s, ${s.tracks} tracks

${s.genes.length ? "Genes: **" + s.genes.join("**, **") + "**. " : ""}${s.groups.length > 1 ? "Groups: " + s.groups.join(", ") + ". " : ""}
Exported from [cbio-lab](${o.origin}). This notebook carries the figure's **contract** — the one
JSON object every cbio-lab renderer reads — and the \`cohortlab\` package itself, so it runs with
no install, no database and no network. \`numpy\` and \`matplotlib\` are the only outside packages.
${o.cut ? "\n> **" + o.cut + "** The numbers below are of that cut, not of the whole cohort.\n" : ""}
The spec that produced it, if you want to re-run it live against the server, is in the last cell.`),

    md(`## The payload

One cell, two gzipped blobs: the package as committed, and this figure. Run it and move on —
nothing below reads it again.`),

    code(`import base64, gzip, json, pathlib, sys

# JupyterLite's Pyodide kernel only preloads a package when it sees a literal
# "import" for it in the cell being run; numpy and matplotlib are needed by
# cohortlab (imported below) but never named literally here, so without these
# two lines JupyterLite fails the import below with ModuleNotFoundError while
# every other host (Jupyter, Colab, VS Code) already has them installed.
import numpy, matplotlib

PACKAGE = "${o.packageB64}"
CONTRACT = "${o.contractB64}"

_root = pathlib.Path("cohortlab_embedded")
for _name, _text in json.loads(gzip.decompress(base64.b64decode(PACKAGE))).items():
    _p = _root / _name
    _p.parent.mkdir(parents=True, exist_ok=True)
    _p.write_text(_text, encoding="utf-8")
sys.path.insert(0, str(_root))

from cohortlab import Oncoprint, read_opb1, BITS   # noqa: E402

op = Oncoprint(read_opb1(gzip.decompress(base64.b64decode(CONTRACT))))
print(op)`),

    md(`## The numbers

Frequencies use **panel-aware denominators**: a ${s.unit} whose gene panel omits a gene is not
profiled for it, never wild-type, so each row's percentage is over the ${s.unit}s profiled for
*that* gene. \`profiled\` says what the denominator was.`),

    code(`for row in op.frequencies():
    print(row)`),

    md(`## The figure

The drawing is level-of-detail: with more columns than pixels, each pixel column is the bitwise OR
of the cells behind it, so a figure of any width is drawn at the same cost. Every colour, band and
priority comes from \`style.json\`, generated from the TypeScript style module — this picture is the
one the web app draws.`),

    code(`import io
from IPython.display import Image, display

# op.figure() returns a matplotlib Figure drawn on the non-interactive "Agg"
# backend (there is no display server to draw to here), so returning it bare
# shows nothing unless the frontend already switched on inline display itself
# — not guaranteed on JupyterLite's Pyodide kernel. Rendering it to a PNG
# buffer and displaying that explicitly works the same way everywhere.
fig = op.figure(width=1200)
buf = io.BytesIO()
fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
display(Image(buf.getvalue()))`),

    md(`## The arrays

\`op.tracks\` is a dict of numpy arrays, one per track, one value per column: a bitmask of the
alteration types present, \`-1\` where the ${s.unit} was not profiled. Ordinary numpy answers
ordinary questions.`),

    code(`import numpy as np

labels = [t.label for t in op.contract.genes()][:2]
one, two = (op.tracks[l] for l in labels)
both_profiled = (one != -1) & (two != -1)
a, b = one > 0, two > 0
print(f"profiled for both {labels[0]} and {labels[1]}:", int(both_profiled.sum()))
print("altered for both:", int((a & b & both_profiled).sum()))
print(f"{labels[0]} truncating:", int(((one & BITS["TRUNCATING"]) > 0).sum()),
      " deep deletions:", int(((one & BITS["HOMDEL"]) > 0).sum()))
print("altered fraction per group:",
      {g["name"]: round(float(a[g["start"]:g["start"] + g["count"]].mean()), 3) for g in op.contract.groups})`),

    md(`## Out again

\`to_frame()\` is a pandas DataFrame of tracks × columns; \`to_tsv()\` is the portal's tabular export;
\`save()\` writes PNG, SVG, TSV or the binary contract, by extension.`),

    code(`print(op.to_tsv()[:400])
# op.save("oncoprint.png", width=1600)
# df = op.to_frame()`),

    md(`## The live figure

The contract above is a snapshot. This spec is what produced it; \`from_server\` compiles it again
against the warehouse and returns a fresh contract — the same call the web app makes.`),

    code(`spec = json.loads(r"""${JSON.stringify(o.spec, null, 2)}""")

# op = Oncoprint.from_server(spec, "${o.origin}")     # needs network access to that server
# pip install cohortlab   # to use the package outside this notebook`)
  ];
  return {
    cells,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python", version: "3.11" },
      cohortlab: { spec: o.spec, origin: o.origin, columns: s.columns, ...(o.cut ? { cut: o.cut } : {}) }
    },
    nbformat: 4,
    nbformat_minor: 5
  };
}

/** what the prose needs from a contract, without the cells */
export function notebookStats(c: Contract): NotebookInput["stats"] {
  return {
    columns: c.stats?.nColumns ?? c.columns.length,
    tracks: c.tracks.length,
    unit: c.unit || "patient",
    genes: c.tracks.filter((t) => t.kind === "gene").map((t) => t.label),
    groups: c.groups.map((g) => g.name)
  };
}
