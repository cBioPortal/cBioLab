"use client";
// Explore's "Custom data" tab: upload a table of curated annotations, check how it matched the
// selected studies, and manage what is stored in this browser. Owns its own draft state, so
// typing into the paste box never re-renders the analysis page (see "Keystrokes stay in the
// field" in CLAUDE.md).
import { useEffect, useState } from "react";
import {
  customDatasets, onCustomDataChange, saveCustomDataset, deleteCustomDataset, parseUpload, buildDataset,
  datasetStudies, datasetToTsv, type ParsedUpload, type ResolveResponse, type StoredDataset
} from "./custom-data-client.ts";
import { LIMITS } from "../../lib/custom-data-names.ts";

const EXAMPLE = "PATIENT_ID\tMET_SITE\tKPS\nP-0000012\tBrain\t80\nP-0000015\tPrimary\t90\n";
/** a match rate under this needs a deliberate second click: the ids are probably the wrong kind */
const LOW_MATCH = 0.5;

export function useCustomDatasets(): StoredDataset[] {
  const [list, setList] = useState<StoredDataset[]>(customDatasets());
  useEffect(() => onCustomDataChange(() => setList(customDatasets())), []);
  return list;
}

export default function CustomDataPanel({ studies, onChanged }: { studies: string[]; onChanged: () => void }) {
  const list = useCustomDatasets();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [types, setTypes] = useState<Record<string, "STRING" | "NUMBER">>({});
  const [resolved, setResolved] = useState<ResolveResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmLow, setConfirmLow] = useState(false);

  const reset = () => { setText(""); setName(""); setParsed(null); setResolved(null); setTypes({}); setErr(null); setConfirmLow(false); };

  const preview = async () => {
    setErr(null); setResolved(null); setConfirmLow(false);
    let p: ParsedUpload;
    try { p = parseUpload(text); } catch (e) { setParsed(null); setErr(String((e as Error).message || e)); return; }
    setParsed(p);
    setTypes(Object.fromEntries(p.columns.map((c) => [c.name, c.datatype])));
    if (!studies.length) { setErr("select a study above first: ids are matched against the studies being explored"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/custom-data/resolve", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studies, level: p.level, ids: p.rows.map((r) => r[0]) }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setResolved(j);
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!parsed || !resolved) return;
    const d = buildDataset(name || "Custom data", parsed, resolved, studies, types);
    if (!d.rows.length) { setErr("no row matched a " + parsed.level + " of " + studies.join(", ") + ": nothing to save"); return; }
    if (d.rows.length * d.columns.length > LIMITS.cells) {
      setErr("this upload has " + (d.rows.length * d.columns.length).toLocaleString() + " values; the limit is " + LIMITS.cells.toLocaleString()); return;
    }
    await saveCustomDataset(d);
    reset();
    onChanged();
  };

  const remove = async (d: StoredDataset) => {
    if (!confirm("Delete “" + d.name + "” from this browser? Analyses that use it will stop running until it is uploaded again.")) return;
    await deleteCustomDataset(d.id);
    onChanged();
  };
  const download = (d: StoredDataset) => {
    const url = URL.createObjectURL(new Blob([datasetToTsv(d)], { type: "text/tab-separated-values" }));
    const a = document.createElement("a"); a.href = url; a.download = d.id + ".tsv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const matchedRows = resolved ? resolved.matches.filter((m) => m.length).length : 0;
  const rate = parsed && parsed.rows.length ? matchedRows / parsed.rows.length : 0;
  const unmatchedExamples = resolved && parsed
    ? parsed.rows.filter((_, i) => !resolved.matches[i]?.length).slice(0, 5).map((r) => r[0]) : [];

  return (
    <div className="customdata">
      <p className="note" style={{ marginTop: 0 }}>
        Add your own annotations (a curated metastasis site, a field extracted from the record) and use
        them like any clinical attribute: as a chart and filter here, as an oncoprint track or split, and
        in comparisons and survival. <b>Uploads are kept in this browser only.</b> Nothing is stored on
        the server, so a shared analysis that uses one needs the dataset imported by whoever opens it.
      </p>

      {list.length > 0 && <>
        <h4>In this browser</h4>
        <div className="attrtablewrap" style={{ maxHeight: "30vh" }}>
          <table className="attrtable customlist">
            <thead><tr><th>Dataset</th><th>Columns</th><th>Matched</th><th>Studies</th><th></th></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} style={{ cursor: "default" }}>
                  <td><b>{d.name}</b> <span className="meta">custom:{d.id} · {d.level} level · {new Date(d.createdAt).toLocaleDateString()}</span></td>
                  <td className="meta" title={d.columns.map((c) => c.name + " (" + (c.datatype === "NUMBER" ? "numeric" : "categorical") + ")").join("\n")}>
                    {d.columns.map((c) => c.name).join(", ")}
                  </td>
                  <td className="meta" title={d.source.unmatched ? d.source.unmatched + " uploaded rows matched no " + d.level + " and were left out" : "every uploaded row matched"}>
                    {d.rows.length.toLocaleString()} {d.level}s{d.source.unmatched ? " · " + d.source.unmatched + " unmatched" : ""}
                  </td>
                  <td className="meta">{datasetStudies(d).join(", ")}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="tbbtn" onClick={() => download(d)} title="download as a tab-separated file you can upload again">Export</button>{" "}
                    <button className="tbbtn" onClick={() => remove(d)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      <h4>Add custom data</h4>
      <p className="note">
        A header row, then one row per case, tab- or comma-separated. The first column is the case id:
        name it <code>PATIENT_ID</code> or <code>SAMPLE_ID</code>. Ids are matched against{" "}
        {studies.length ? <b>{studies.join(", ")}</b> : "the selected studies"}; prefix one as{" "}
        <code>study:id</code> to pin it to one study. Every other column becomes an attribute.
      </p>
      <div className="row" style={{ alignItems: "center" }}>
        <input type="file" accept=".tsv,.txt,.csv,text/plain,text/csv,text/tab-separated-values"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); setParsed(null); setResolved(null); } }} />
        <button className="linklike" onClick={() => { setText(EXAMPLE); setParsed(null); setResolved(null); }}>paste an example</button>
      </div>
      <textarea className="customdata-text" rows={8} spellCheck={false} value={text}
        placeholder={EXAMPLE} onChange={(e) => { setText(e.target.value); setParsed(null); setResolved(null); }} />
      <div className="row" style={{ alignItems: "center" }}>
        <input type="text" placeholder="dataset name (e.g. Brain mets — curated)" value={name}
          onChange={(e) => setName(e.target.value)} style={{ minWidth: "18rem" }} />
        <button className="tbbtn" disabled={!text.trim() || busy} onClick={preview}>
          {busy ? <><span className="spinner" /> matching ids…</> : "Preview"}
        </button>
        {(text || parsed) && <button className="linklike" onClick={reset}>clear</button>}
      </div>
      {err && <p className="error">{err}</p>}

      {parsed && <>
        <p className="meta" style={{ marginTop: "0.6rem" }}>
          {parsed.rows.length.toLocaleString()} rows · id column <code>{parsed.idColumn}</code> → <b>{parsed.level}</b> level
          {parsed.warnings.length > 0 && <> · {parsed.warnings.join("; ")}</>}
        </p>
        <div className="attrtablewrap" style={{ maxHeight: "30vh" }}>
          <table className="attrtable">
            <thead><tr><th>Attribute</th><th>Type</th><th>Values</th><th>Distinct</th><th></th></tr></thead>
            <tbody>
              {parsed.columns.map((c) => (
                <tr key={c.name} style={{ cursor: "default" }}>
                  <td><code>custom:…/{c.name}</code></td>
                  <td>
                    <select value={types[c.name] ?? c.datatype}
                      onChange={(e) => setTypes((t) => ({ ...t, [c.name]: e.target.value as "STRING" | "NUMBER" }))}>
                      <option value="STRING">categorical</option>
                      <option value="NUMBER" disabled={c.datatype !== "NUMBER"}>numeric</option>
                    </select>
                  </td>
                  <td className="meta">{c.filled.toLocaleString()} of {parsed.rows.length.toLocaleString()}</td>
                  <td className="meta">{c.distinct.toLocaleString()}</td>
                  <td className="meta">
                    {c.datatype !== "NUMBER" && c.distinct > 50 && "many distinct values: free text charts poorly"}
                    {c.looksLikeDate && "dates are kept as text"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      {parsed && resolved && <div style={{ marginTop: "0.6rem" }}>
        <p className={rate < LOW_MATCH ? "error" : "meta"}>
          <b>{matchedRows.toLocaleString()} of {parsed.rows.length.toLocaleString()}</b> rows matched a {parsed.level} of {studies.join(", ")}
          {resolved.unmatched > 0 && <> — {resolved.unmatched.toLocaleString()} matched nothing and will be left out
            (e.g. {unmatchedExamples.map((x) => <code key={x}>{x}</code>).reduce((a: React.ReactNode[], x, i) => i ? [...a, ", ", x] : [x], [])})</>}
          {resolved.multiStudy > 0 && <> · {resolved.multiStudy} ids exist in more than one study and apply to each</>}
          {resolved.refused.length > 0 && <> · not matched against {resolved.refused.map((r) => r.study + " (" + r.reason + ")").join(", ")}</>}
          {rate < LOW_MATCH && <> — are these {parsed.level === "patient" ? "sample" : "patient"} ids, or ids from another study?</>}
        </p>
        <div className="row" style={{ alignItems: "center" }}>
          {rate < LOW_MATCH && !confirmLow
            ? <button className="tbbtn" disabled={!matchedRows} onClick={() => setConfirmLow(true)}>Save anyway…</button>
            : <button className="primary" disabled={!matchedRows} onClick={save}>Save {matchedRows.toLocaleString()} {parsed.level}s to this browser</button>}
        </div>
      </div>}
    </div>
  );
}
