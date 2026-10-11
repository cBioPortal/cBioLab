"use client";
// A view's method record (lib/method.ts), drawn under its queries in the provenance panel:
// each step from fetched rows to reported numbers, the code that ran, and a Python refit.
import { useState } from "react";
import type { MethodRecord } from "../../lib/method.ts";
import type { AnalysisDoc } from "../../lib/types.ts";
import { api } from "./api.ts";

const REPO = "https://github.com/cBioPortal/cohort-lab";

function Commit({ commit, file }: { commit: string | null; file: string }) {
  if (!commit) return <>at an unrecorded commit</>;
  if (commit === "dev") return <>as it stands in the working tree this development server is serving</>;
  const dirty = commit.endsWith("+dirty"), sha = commit.replace(/\+dirty$/, "");
  return dirty
    ? <>at commit <code>{sha.slice(0, 7)}</code> plus uncommitted changes</>
    : <>at commit <a href={REPO + "/blob/" + sha + "/" + file} target="_blank" rel="noreferrer"><code>{sha.slice(0, 7)}</code></a></>;
}

/** Where a method record came from, so the server can rebuild its data for a notebook. */
export interface MethodSource { doc: AnalysisDoc; index: number; kind: string }

export function MethodPanel({ method, source }: { method: MethodRecord; source?: MethodSource }) {
  const [copied, setCopied] = useState(false);
  const [nb, setNb] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const download = async () => {
    if (!source) return;
    setNb({ busy: true });
    try {
      const res = await api.methodNotebook({ ...(source.doc as object), notebookView: { index: source.index, kind: source.kind } });
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try { msg = JSON.parse(text).error || text; } catch { /* not JSON: show it as it is */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || source.kind + ".ipynb";
      a.click();
      URL.revokeObjectURL(url);
      setNb({ busy: false });
    } catch (e) {
      setNb({ busy: false, error: String((e as Error).message || e) });
    }
  };
  const copy = () => {
    if (!method.python) return;
    navigator.clipboard?.writeText(method.python).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <div className="provmethod">
      <p className="provsub">Computation — what was done with the rows these queries returned</p>
      <ol className="msteps">
        {method.steps.map((s, i) => (
          <li key={i} className="mstep">
            <div className="provhead">
              <span className={"mkind mkind-" + s.kind}>{s.kind}</span>
              <strong>{s.title}</strong>
              {s.scope && <span className="meta">{s.scope}</span>}
              {s.rowsIn != null && s.rowsOut != null &&
                <span className="meta">{s.rowsIn.toLocaleString()} → {s.rowsOut.toLocaleString()} rows</span>}
            </div>
            <p className="mdetail">{s.detail}</p>
            {s.params && s.params.length > 0 && (
              <dl className="mparams">
                {s.params.map(([k, v], j) => <div key={j}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            )}
          </li>
        ))}
      </ol>
      <p className="mdetail">
        Code: {method.implementation.functions.length > 0 && <><code>{method.implementation.functions.join(", ")}</code> in </>}
        <code>{method.implementation.file}</code>{" "}
        <Commit commit={method.implementation.commit} file={method.implementation.file} />.
        {method.verification && <> {method.verification}</>}
      </p>
      {method.python && <details className="mpy">
        <summary className="meta">Python equivalent — recompute these numbers with standard libraries</summary>
        <div className="provq">
          <div className="provhead">
            <button className="tbbtn" onClick={copy}>{copied ? "copied" : "copy"}</button>
            {source && <button className="tbbtn" onClick={download} disabled={nb.busy}
              title="A Jupyter notebook with this script, the data it reads and a check against these numbers. Opens in JupyterLab, VS Code or Colab.">
              {nb.busy ? "building notebook…" : "download as notebook (.ipynb)"}</button>}
            {nb.error && <span className="meta" role="alert">{nb.error}</span>}
          </div>
          <pre>{method.python}</pre>
        </div>
      </details>}
    </div>
  );
}
