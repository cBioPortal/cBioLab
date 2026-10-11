// A view's method record as a Jupyter notebook (nbformat 4.5): the steps in prose, the data the
// script reads, the script itself, and a cell that compares what it recomputes with what the view
// reported. It opens in Jupyter, JupyterLab, VS Code or Colab; the only thing it asks of the
// environment is the libraries the script imports, which its first cell installs when missing.
//
// The data travels inside the notebook as one gzipped base64 payload, so the file stands alone —
// which is also why its size is capped (NOTEBOOK_MAX_BYTES): a deployment's response limit, and a
// notebook an editor can still open.
import { gzipSync } from "node:zlib";
import { RESULT_MARKER, type CheckValue, type MethodRecord } from "./method.ts";
import { ExportRefused, type MethodFiles } from "./method-data.ts";
import type { ViewResult } from "./types.ts";

/** Largest notebook served, in bytes of JSON. Serverless platforms cap a response near 4.5 MB. */
export const NOTEBOOK_MAX_BYTES = 4_000_000;

/**
 * The library releases the scripts' numbers are checked against (scripts/check-method-scripts.ts
 * runs every script under exactly these). The notebook installs them only when a library is
 * missing; one already present is used as it is, and its version is printed beside the tested one.
 */
export const PYTHON_PINS: Record<string, string> = {
  lifelines: "0.30.3", statsmodels: "0.15.0", scipy: "1.18.1", numpy: "2.5.3", pandas: "2.3.3",
};

interface Cell { cell_type: "code" | "markdown"; id: string; metadata: Record<string, unknown>; source: string[]; outputs?: unknown[]; execution_count?: null }

export interface MethodNotebookInput {
  view: Pick<ViewResult, "kind" | "cohorts" | "studies" | "queries">;
  method: MethodRecord;
  /** the files the script reads, by name, as methodFiles built them */
  files: MethodFiles;
  /** files the script reads that could not be built; the notebook says so instead of failing late */
  missing: string[];
  /** the analysis document the view came from, kept in the notebook's metadata */
  doc: unknown;
  viewIndex: number;
  origin: string;
}

const lines = (s: string): string[] => s.split("\n").map((l, i, a) => i === a.length - 1 ? l : l + "\n");
let n = 0;
const nextId = () => "c" + String(++n).padStart(3, "0");
const md = (s: string): Cell => ({ cell_type: "markdown", id: nextId(), metadata: {}, source: lines(s.trim()) });
const code = (s: string): Cell => ({ cell_type: "code", id: nextId(), metadata: {}, execution_count: null, outputs: [], source: lines(s.trim()) });
const b64gz = (o: unknown) => gzipSync(Buffer.from(JSON.stringify(o), "utf8"), { level: 9 }).toString("base64");
const num = (x: number) => x.toLocaleString("en-US");

/** Python modules imported at the top level of a script. */
export function importedModules(python: string): string[] {
  return [...new Set([...python.matchAll(/^(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map((m) => m[1]))];
}

/** The script without its trailing machine-readable result line, which only the automated check reads. */
function readableScript(python: string): string {
  const at = python.indexOf("# for the check that this script reproduces the view");
  return (at >= 0 ? python.slice(0, at) : python).trimEnd();
}

const SETUP = (pins: Record<string, string>) => `# Installs a library only when it is missing. The numbers this notebook recomputes were checked
# against the versions listed; a different version you already have is used as it is.
import importlib.metadata, importlib.util, subprocess, sys

TESTED = ${JSON.stringify(pins)}

def _ensure(pkg, version):
    if importlib.util.find_spec(pkg) is None:
        for spec in (pkg + "==" + version, pkg):
            if subprocess.call([sys.executable, "-m", "pip", "install", "-q", spec]) == 0:
                break
    have = importlib.metadata.version(pkg)
    print(pkg.ljust(12), have, "" if have == version else "(checked against " + version + ")")

for _pkg, _ver in TESTED.items():
    _ensure(_pkg, _ver)`;

const WRITE_DATA = (payloadB64: string) => `# The data the script reads, written to ./method_data/ and made the working directory.
import base64, gzip, json, os, pathlib

PAYLOAD = "${payloadB64}"

_dir = pathlib.Path("method_data")
_dir.mkdir(exist_ok=True)
for _name, _text in json.loads(gzip.decompress(base64.b64decode(PAYLOAD))).items():
    (_dir / _name).write_text(_text, encoding="utf-8")
    print(_name, len(_text.splitlines()) - 1, "rows")
os.chdir(_dir)`;

const COMPARE = (checkB64: string) => `# What the view reported, against what the script above recomputed.
import base64, gzip, json, math

CHECK = json.loads(gzip.decompress(base64.b64decode("${checkB64}")))

def _num(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) or math.isinf(x) else x

bad = []
for key, want in CHECK.items():
    got = _num(RESULT.get(key))
    v = want["v"]
    if v is None or got is None:
        if v != got:
            bad.append((key, v, got))
        continue
    abs_tol = want.get("abs")
    rel_tol = want.get("rel", 0 if abs_tol is not None else 1e-6)
    if not abs(got - v) <= max(abs_tol if abs_tol is not None else 1e-300, rel_tol * abs(v)):
        bad.append((key, v, got))

print(len(CHECK) - len(bad), "of", len(CHECK), "numbers match what the view reported")
for key, v, got in bad[:20]:
    print("  differs:", key, "view", v, "script", got)`;

export function methodNotebook(o: MethodNotebookInput): unknown {
  n = 0;
  const m = o.method;
  if (!m.python) throw new ExportRefused("this view has no Python script to export", 422);
  const script = readableScript(m.python);
  const modules = importedModules(script);
  const pins = Object.fromEntries(Object.entries(PYTHON_PINS).filter(([pkg]) => modules.includes(pkg)));
  const cohorts = o.view.cohorts?.length ? o.view.cohorts.join(" vs ") : "";
  const rowCount = Object.values(o.files).reduce((t, f) => t + Math.max(0, f.split("\n").length - 2), 0);
  const check = (m.check || {}) as Record<string, CheckValue>;
  const checked = Object.keys(check).length;

  const cells: Cell[] = [
    md(`# ${o.view.kind}${cohorts ? " — " + cohorts : ""}

Exported from [cbio-lab](${o.origin}). This notebook recomputes the numbers of one view from the
rows its queries returned, with standard libraries (${modules.filter((x) => x in PYTHON_PINS).join(", ") || "standard library only"}).
${Object.keys(o.files).length
  ? `The data it reads — ${num(rowCount)} rows in ${Object.keys(o.files).length} file${Object.keys(o.files).length === 1 ? "" : "s"} — is embedded below and written to \`method_data/\` when you run it. ` +
    "It is what the view's own queries returned, one row per patient where a model is fitted, with no patient identifier."
  : "The data it reads is inside the script itself."}
${checked ? `\nThe last cell compares ${num(checked)} of the recomputed numbers with the ones the view reported.\n` : ""}${o.missing.length ? `
> **Not included:** the script also reads ${o.missing.map((f) => "\`" + f + "\`").join(", ")}, which this export cannot rebuild for a ${o.view.kind} view. Export ${o.missing.length === 1 ? "it" : "them"} from the queries listed at the end, or the script will stop at that line.
` : ""}`),

    md(`## What was done

${m.steps.map((s, i) => `${i + 1}. **${s.title}**${s.scope ? " (" + s.scope + ")" : ""}${s.rowsIn != null && s.rowsOut != null ? " — " + num(s.rowsIn) + " → " + num(s.rowsOut) + " rows" : ""}. ${s.detail.replace(/\n/g, " ")}`).join("\n")}`),

  ];
  if (Object.keys(pins).length) cells.push(md("## Setup"), code(SETUP(pins)));

  if (Object.keys(o.files).length) cells.push(md("## The data"), code(WRITE_DATA(b64gz(o.files))));
  cells.push(md("## The recomputation\n\n" + (m.verification ? m.verification : "")), code(script));
  if (checked) cells.push(md("## Against what the view reported"), code(COMPARE(b64gz(check))));

  const queries = (o.view.queries || []).map((q) =>
    `**${q.label}** — ${q.study}${q.remote ? " (ran on a federated peer)" : ""}\n\n\`\`\`sql\n${q.sql}\n\`\`\``).join("\n\n");
  if (queries) cells.push(md("## The queries\n\nThe SQL the view ran, in order. The data above is what they returned.\n\n" + queries));

  const nb = {
    cells,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
      cohortlab: { kind: o.view.kind, view: o.viewIndex, doc: o.doc, resultMarker: RESULT_MARKER.trim() },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  const size = Buffer.byteLength(JSON.stringify(nb));
  if (size > NOTEBOOK_MAX_BYTES)
    throw new ExportRefused("the notebook for this view would be " + (size / 1e6).toFixed(1) + " MB, over the " + (NOTEBOOK_MAX_BYTES / 1e6) + " MB limit; narrow the cohort to export it", 413);
  return nb;
}
