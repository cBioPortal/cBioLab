"use client";
// A view's method record (lib/method.ts), drawn under its queries in the provenance panel:
// each step from fetched rows to reported numbers, the code that ran, and a Python refit.
import { useState } from "react";
import type { MethodRecord } from "../../lib/method.ts";

const REPO = "https://github.com/cBioPortal/cohort-lab";

function Commit({ commit, file }: { commit: string | null; file: string }) {
  if (!commit) return <>at an unrecorded commit</>;
  if (commit === "dev") return <>as it stands in the working tree this development server is serving</>;
  const dirty = commit.endsWith("+dirty"), sha = commit.replace(/\+dirty$/, "");
  return dirty
    ? <>at commit <code>{sha.slice(0, 7)}</code> plus uncommitted changes</>
    : <>at commit <a href={REPO + "/blob/" + sha + "/" + file} target="_blank" rel="noreferrer"><code>{sha.slice(0, 7)}</code></a></>;
}

export function MethodPanel({ method }: { method: MethodRecord }) {
  const [copied, setCopied] = useState(false);
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
          </div>
          <pre>{method.python}</pre>
        </div>
      </details>}
    </div>
  );
}
