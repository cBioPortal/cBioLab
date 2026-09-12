"use client";
// A small notebook: editable Python cells run in Pyodide (CPython compiled to WebAssembly),
// with numpy and matplotlib from the Pyodide distribution and cohortlab from this repo's
// source, written into the in-browser filesystem. Lines printed as __IMG__<base64> render
// as images; everything else is stdout.
import { useEffect, useRef, useState } from "react";
import { isLocalSpec } from "../../../lib/lab-links.ts";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

interface Cell { code: string; out: string[]; running: boolean; ms?: number }

const DEMO = {
  study: "msk_chord_2024",
  genes: ["TP53", "KRAS", "EGFR", "STK11", "KEAP1", "PIK3CA", "ARID1A"],
  clinical: ["CANCER_TYPE", "CURRENT_AGE_DEID"],
  layout: { groupBy: { kind: "cohorts", groups: [
    { name: "TP53 mut", dsl: { all: [{ kind: "oql", q: "TP53: MUT" }] } },
    { name: "TP53 wt", dsl: { all: [{ not: { kind: "oql", q: "TP53:" } }, { kind: "profiled", type: "MUTATION" }] } }] } }
};

/** the first cell: where the contract comes from — a handed-over spec, pasted tables, or the demo */
function sourceCell(spec: Record<string, unknown> | null): string {
  if (spec && isLocalSpec(spec)) {
    const tbl = (k: string) => JSON.stringify(String(spec[k] || "").trim());
    return `# 1 · your figure, from the tables the link carried — no server, no database
import json
from cohortlab import Oncoprint

events = ${tbl("events")}
clinical = ${spec.clinical ? tbl("clinical") : "None"}
coverage = ${spec.coverage ? tbl("coverage") : "None"}
opts = json.loads(r"""${JSON.stringify({ genes: spec.genes, group_by: spec.groupBy, sort: spec.sort, study: spec.study, unit: spec.unit, display: spec.display })}""")
op = Oncoprint.from_tables(events, clinical, coverage, **{k: v for k, v in opts.items() if v})
print(op)
for row in op.frequencies(): print(row)`;
  }
  return `# 1 · ${spec ? "your figure" : "a contract"} from this Cohort Lab instance: the engine compiles the spec, we receive OPB1 bytes
import json
from pyodide.http import pyfetch
from cohortlab import Oncoprint, read_opb1

spec = json.loads(r"""${JSON.stringify(spec || DEMO, null, 2)}""")

r = await pyfetch("/api/oncoprint?format=bin", method="POST", body=json.dumps(spec), headers={"Content-Type": "application/json"})
data = await r.bytes()
op = Oncoprint(read_opb1(data))
print(op)
print(f"{len(data)/1e6:.2f} MB received; cells are", type(list(op.tracks.values())[0]).__name__, list(op.tracks.values())[0].dtype)
for row in op.frequencies(): print(row)`;
}

const CELLS = (fx: { events: string; clinical: string; coverage: string }, spec: Record<string, unknown> | null): string[] => [
sourceCell(spec),

`# 2 · draw it: numpy level-of-detail raster + matplotlib, every column into 1,100 pixels
import io, base64, time
t0 = time.time()
fig = op.figure(width=1100)
buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=100)
print(f"{op.contract.n:,} columns rendered in {(time.time()-t0)*1000:.0f} ms")
print("__IMG__" + base64.b64encode(buf.getvalue()).decode())`,

`# 3 · work with the arrays: alteration co-occurrence straight from the bitmasks
import numpy as np
from cohortlab import BITS
labels = [t.label for t in op.contract.genes()][:2]
one, two = (op.tracks[l] for l in labels)
both_profiled = (one != -1) & (two != -1)
a, b = one > 0, two > 0
print(f"profiled for both {labels[0]} and {labels[1]}:", int(both_profiled.sum()))
print("both altered:", int((a & b & both_profiled).sum()))
print(f"{labels[0]} driver amp:", int(((one & BITS["AMP"]) > 0).sum()), f" {labels[1]} missense:", int(((two & BITS["MISSENSE"]) > 0).sum()))
print(f"{labels[0]} altered fraction per group:",
      {g["name"]: round(float(a[g["start"]:g["start"]+g["count"]].mean()), 3) for g in op.contract.groups})`,

`# 4 · no server at all: local tables in the portal's Oncoprinter shape (the repo's 12-patient fixture)
events = """${fx.events.trim()}"""
clinical = """${fx.clinical.trim()}"""
coverage = """${fx.coverage.trim()}"""
local = Oncoprint.from_tables(events, clinical, coverage, group_by="CANCER_TYPE", sort="STAGE")
print(local)
print(local.to_tsv()[:600])
fig = local.figure(width=900)
buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=100)
print("__IMG__" + base64.b64encode(buf.getvalue()).decode())`
];

const btn = (disabled: boolean): React.CSSProperties => ({
  font: "500 0.78rem 'IBM Plex Sans', sans-serif", padding: "0.3rem 0.7rem", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  border: "1px solid var(--accent)", background: disabled ? "transparent" : "var(--accent)", color: disabled ? "var(--muted)" : "#fff", opacity: disabled ? 0.6 : 1
});

export default function PyNotebook({ files, fixtures, spec, cut }: { files: Record<string, string>; fixtures: { events: string; clinical: string; coverage: string }; spec?: Record<string, unknown> | null; cut?: string | null }) {
  const [status, setStatus] = useState("loading Pyodide (≈15 MB) …");
  const [ready, setReady] = useState(false);
  const [autoRan, setAutoRan] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [cells, setCells] = useState<Cell[]>(() => CELLS(fixtures, spec || null).map((code) => ({ code, out: [], running: false })));
  const py = useRef<any>(null);
  const sink = useRef<(s: string) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!(window as any).loadPyodide) {
          await new Promise<void>((res, rej) => { const s = document.createElement("script"); s.src = PYODIDE + "pyodide.js"; s.onload = () => res(); s.onerror = () => rej(new Error("could not load pyodide.js from " + PYODIDE)); document.head.appendChild(s); });
        }
        const p = await (window as any).loadPyodide({ indexURL: PYODIDE });
        if (cancelled) return;
        setStatus("loading numpy and matplotlib …");
        await p.loadPackage(["numpy", "matplotlib"]);
        p.FS.mkdirTree("/home/pyodide/cohortlab");
        for (const [path, src] of Object.entries(files)) p.FS.writeFile("/home/pyodide/" + path, src);
        p.setStdout({ batched: (s: string) => sink.current(s) });
        p.setStderr({ batched: (s: string) => sink.current("⚠ " + s) });
        await p.runPythonAsync("import sys; sys.path.insert(0, '/home/pyodide'); import matplotlib; matplotlib.use('Agg'); import cohortlab; print('cohortlab', cohortlab.__name__, 'loaded from', cohortlab.__file__)");
        py.current = p;
        setStatus("ready — Python " + p.runPython("import sys; sys.version.split()[0]") + ", numpy " + p.runPython("import numpy; numpy.__version__") + ", matplotlib " + p.runPython("import matplotlib; matplotlib.__version__"));
        setReady(true);
      } catch (e) { setStatus("failed: " + String((e as Error).message || e)); }
    })();
    return () => { cancelled = true; };
  }, [files]);

  const runCell = async (i: number) => {
    const p = py.current; if (!p) return;
    setCells((cs) => cs.map((c, j) => j === i ? { ...c, out: [], running: true } : c));
    const lines: string[] = [];
    sink.current = (s: string) => { lines.push(s); setCells((cs) => cs.map((c, j) => j === i ? { ...c, out: [...lines] } : c)); };
    const t0 = performance.now();
    try { await p.runPythonAsync(cells[i].code); }
    catch (e) { lines.push("⚠ " + String((e as Error).message || e)); }
    setCells((cs) => cs.map((c, j) => j === i ? { ...c, out: [...lines], running: false, ms: Math.round(performance.now() - t0) } : c));
  };
  const runAll = async () => {
    for (let i = 0; i < cells.length; i++) { setProgress("running cell " + (i + 1) + " of " + cells.length + " …"); await runCell(i); }
    setProgress(null);
  };
  // run everything once as soon as the runtime is up, so the page shows results, not just code
  useEffect(() => { if (ready && !autoRan) { setAutoRan(true); void runAll(); } }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { (window as any).__pynb = { ready, runAll, runCell, cells }; });

  return (
    <div>
      <div className="row" style={{ alignItems: "center", marginBottom: "0.6rem" }}>
        <span className="meta" style={{ color: status.startsWith("failed") ? "var(--err)" : undefined }}>{progress || status}</span>
        <span className="spacer" />
        <button disabled={!ready || !!progress} onClick={runAll} style={btn(!ready || !!progress)}>{progress ? "running…" : "run all cells"}</button>
      </div>
      <p className="meta" style={{ maxWidth: "72ch", margin: "0 0 0.8rem" }}>
        This is CPython in your browser. The <code>cohortlab</code> package is loaded from this repo&apos;s <code>python/cohortlab/*.py</code> exactly
        as committed; {spec ? "cell 1 is the figure you came from — its spec travelled in the link, and the numbers below are recomputed here, not copied" : "cells 1\u20133 talk to this instance\u2019s engine"}; cell 4 needs no server at all. Edit any cell and run it again.
      </p>
      {cut && <div className="error" style={{ marginBottom: "0.6rem" }}>{cut} — what runs below is the cut, not the whole cohort.</div>}
      {cells.map((c, i) => (
        <div className="card" key={i} style={{ padding: "0.7rem 0.9rem" }}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span className="meta" style={{ fontFamily: "IBM Plex Mono, monospace", width: 44, paddingTop: 6 }}>[{i + 1}]</span>
            <textarea value={c.code} spellCheck={false} onChange={(e) => setCells((cs) => cs.map((x, j) => j === i ? { ...x, code: e.target.value } : x))}
              style={{ flex: 1, minHeight: Math.min(320, 20 + c.code.split("\n").length * 18), font: "12.5px/1.45 'IBM Plex Mono', monospace", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 6, padding: "0.5rem 0.6rem", resize: "vertical" }} />
            <button disabled={!ready || c.running} onClick={() => runCell(i)} style={{ ...btn(!ready || c.running), alignSelf: "flex-start" }}>{c.running ? "running…" : "run ▶"}</button>
          </div>
          {(c.out.length > 0 || c.ms != null) && (
            <div style={{ marginLeft: 44, marginTop: "0.4rem" }}>
              {c.out.map((l, k) => l.startsWith("__IMG__")
                ? <img key={k} alt="matplotlib output" src={"data:image/png;base64," + l.slice(7).trim()} style={{ maxWidth: "100%", border: "1px solid var(--line)", borderRadius: 6, background: "#fff", display: "block", margin: "0.3rem 0" }} />
                : <pre key={k} style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "12px", color: l.startsWith("⚠") ? "var(--err)" : undefined }}>{l}</pre>)}
              {c.ms != null && !c.running && <div className="meta">{c.ms.toLocaleString()} ms</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
