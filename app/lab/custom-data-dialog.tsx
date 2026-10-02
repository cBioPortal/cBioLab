"use client";
// "What is this built on?" for custom data: the uploads a cohort clause or a whole document
// names, shown as they are stored in this browser. Opened from the `custom` tag on a cohort's
// pill (scoped to that clause) or from the analysis header (every upload the document names).
//
// The rows a clause matches are re-derived here from the stored values, folding case and
// whitespace the way the engine does, as a reading aid. The cohort's own count is the engine's.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCustomDatasets } from "./custom-data-panel.tsx";
import { datasetStudies, datasetToTsv, fetchServerVersion, serverBySlug, serverState, type StoredDataset, type UploadBinding } from "./custom-data-client.ts";
import { parseCustomAttr, type CustomDataset } from "../../lib/custom-data-names.ts";

export interface CustomDataFocus {
  /** dataset ids to show, in order */
  datasets: string[];
  /** the clause that opened it, when it was a cohort pill */
  clause?: { attribute: string; leaf: Record<string, unknown>; cohort?: string; negated?: boolean };
}

/** rows drawn at once; the count of the rest is always stated */
const ROW_CAP = 500;

const fold = (v: unknown) => String(v ?? "").trim().toLowerCase();
const CMP: Record<string, (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b
};

/** Does one stored value satisfy a clinical leaf? null when it cannot be decided here (a percentile). */
function leafMatcher(leaf: Record<string, any>): ((v: string) => boolean) | null {
  if (leaf.percentile != null) return null;
  const tests: ((v: string) => boolean)[] = [];
  if (Array.isArray(leaf.values) && leaf.values.length) {
    const set = new Set(leaf.values.map(fold));
    tests.push((v) => set.has(fold(v)));
  }
  if (leaf.range && typeof leaf.range === "object") {
    const r = leaf.range;
    tests.push((v) => {
      const x = Number(v);
      if (v === "" || !Number.isFinite(x)) return false;
      return (r.gt == null || x > r.gt) && (r.gte == null || x >= r.gte) && (r.lt == null || x < r.lt) && (r.lte == null || x <= r.lte);
    });
  }
  if (leaf.op != null) {
    const op = String(leaf.op);
    if (op === "=" || op === "!=") {
      if (typeof leaf.value === "number") tests.push((v) => (Number(v) === leaf.value) === (op === "=") && v !== "");
      else tests.push((v) => (fold(v) === fold(leaf.value)) === (op === "="));
    } else if (CMP[op]) {
      tests.push((v) => v !== "" && Number.isFinite(Number(v)) && CMP[op](Number(v), Number(leaf.value)));
    }
  }
  return tests.length ? (v) => tests.every((t) => t(v)) : null;
}

function columnStats(d: CustomDataset) {
  return d.columns.map((c, i) => {
    const counts = new Map<string, number>();
    let filled = 0;
    for (const r of d.rows) {
      const v = r.values[i];
      if (v === "" || v == null) continue;
      filled++;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]);
    return { ...c, filled, distinct: counts.size, top };
  });
}

/** Where one name the document uses resolves: a pinned server version, a local upload, or the server's latest. */
function ServerDataset({ id, version, latest, clause, onRepin }: { id: string; version: number; latest: number; clause?: CustomDataFocus["clause"]; onRepin?: () => void }) {
  const [d, setD] = useState<StoredDataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setD(null); setErr(null);
    fetchServerVersion(id, version).then((x) => { if (alive) setD(x); }, (e) => { if (alive) setErr(String(e?.message || e)); });
    return () => { alive = false; };
  }, [id, version]);
  const pinNote = (
    <p className="meta" style={{ margin: "0 0 var(--s1)" }}>
      <span className="customtag">server</span> version {version}{latest > version ? <> · <b>v{latest} is newer</b></> : latest ? " (latest)" : ""}
      {latest > version && onRepin && <> <button className="linklike" onClick={onRepin}>use v{latest} in this analysis</button></>}
    </p>
  );
  if (err) return <section className="cdview">{pinNote}<p className="error">{err}</p></section>;
  if (!d) return <section className="cdview">{pinNote}<p className="meta"><span className="spinner" /> loading the stored rows…</p></section>;
  return <DatasetView d={d} clause={clause} note={pinNote} />;
}

function DatasetView({ d, clause, note }: { d: StoredDataset; clause?: CustomDataFocus["clause"]; note?: React.ReactNode }) {
  const focusCol = clause ? parseCustomAttr(clause.attribute) : null;
  const colIdx = focusCol && focusCol.dataset === d.id ? d.columns.findIndex((c) => c.name === focusCol.column) : -1;
  const matcher = useMemo(() => colIdx >= 0 && clause ? leafMatcher(clause.leaf as Record<string, any>) : null, [colIdx, clause]);
  const [onlyMatching, setOnlyMatching] = useState(true);
  const [q, setQ] = useState("");
  const stats = useMemo(() => columnStats(d), [d]);
  const idOf = (r: CustomDataset["rows"][number]) => r.study + ":" + (d.level === "sample" ? r.sample : r.patient);

  const matching = useMemo(() => matcher ? d.rows.filter((r) => matcher(r.values[colIdx] ?? "")) : null, [matcher, d, colIdx]);
  const matchedPatients = useMemo(() => matching ? new Set(matching.map((r) => r.study + ":" + r.patient)).size : 0, [matching]);
  const base = matching && onlyMatching ? matching : d.rows;
  const needle = q.trim().toLowerCase();
  const shown = needle ? base.filter((r) => idOf(r).toLowerCase().includes(needle) || r.values.some((v) => v.toLowerCase().includes(needle))) : base;

  const download = () => {
    const url = URL.createObjectURL(new Blob([datasetToTsv(d)], { type: "text/tab-separated-values" }));
    const a = document.createElement("a"); a.href = url; a.download = d.id + ".tsv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="cdview">
      <div className="row" style={{ alignItems: "baseline" }}>
        <h4 style={{ margin: 0 }}>{d.name}</h4>
        <code className="meta">custom:{d.id}</code>
        <span className="spacer" />
        <button className="tbbtn" onClick={download} title="download as a tab-separated file you can upload again">Export</button>
      </div>
      {note}
      <p className="meta" style={{ margin: "var(--s1) 0 var(--s3)" }}>
        {d.level} level · {d.rows.length.toLocaleString()} {d.level}s in {datasetStudies(d).join(", ")} ·
        added {new Date(d.createdAt).toLocaleDateString()} ·{" "}
        {d.source.unmatched
          ? d.source.rowsIn.toLocaleString() + " rows uploaded, " + d.source.unmatched.toLocaleString() + " matched no " + d.level + " and were left out"
          : "every uploaded row matched"}
        {d.source.duplicates ? " · " + d.source.duplicates + " repeated cases kept once" : ""}
      </p>

      <table className="attrtable cdcols">
        <thead><tr><th>Attribute</th><th>Type</th><th>Values</th><th>Most common</th></tr></thead>
        <tbody>
          {stats.map((c, i) => (
            <tr key={c.name} className={i === colIdx ? "focus" : undefined} style={{ cursor: "default" }}>
              <td><code>custom:{d.id}/{c.name}</code></td>
              <td className="meta">{c.datatype === "NUMBER" ? "numeric" : "categorical"}</td>
              <td className="meta">{c.filled.toLocaleString()} of {d.rows.length.toLocaleString()} · {c.distinct.toLocaleString()} distinct</td>
              <td className="meta">
                {c.top.slice(0, 6).map(([v, n]) => v + " " + n.toLocaleString()).join(" · ")}
                {c.top.length > 6 ? " · +" + (c.top.length - 6) + " more" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {clause && colIdx >= 0 && (
        <p className="meta" style={{ margin: "var(--s3) 0 0" }}>
          {matching
            ? <><b>{matching.length.toLocaleString()}</b> of {d.rows.length.toLocaleString()} {d.level}s satisfy this clause
                {d.level === "sample" ? <> — {matchedPatients.toLocaleString()} patients{clause.leaf.per === "sample" ? " (a patient matches if any sample does)" : ""}</> : null}
                {clause.negated ? <> · the clause is negated, so the cohort <b>excludes</b> these</> : null}
                {clause.cohort ? <> · &ldquo;{clause.cohort}&rdquo; may combine this with other clauses</> : null}</>
            : "this clause is resolved by the engine (a percentile), so its matching rows are not listed here"}
        </p>
      )}
      {clause && colIdx < 0 && focusCol && focusCol.dataset === d.id && (
        <p className="error">this dataset has no column {focusCol.column}; the clause cannot match anything in it</p>
      )}

      <div className="row" style={{ alignItems: "center", marginTop: "var(--s3)" }}>
        <input type="search" placeholder="find a case id or value" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: "16rem" }} />
        {matching && <label className="chk"><input type="checkbox" checked={onlyMatching} onChange={(e) => setOnlyMatching(e.target.checked)} /> only rows this clause matches</label>}
        <span className="meta">
          {shown.length > ROW_CAP ? "showing the first " + ROW_CAP.toLocaleString() + " of " + shown.length.toLocaleString() + " rows — search to narrow"
            : shown.length.toLocaleString() + " row" + (shown.length === 1 ? "" : "s")}
        </span>
      </div>
      <div className="attrtablewrap" style={{ maxHeight: "42vh" }}>
        <table className="attrtable cdrows">
          <thead><tr>
            <th>{d.level === "sample" ? "Sample" : "Patient"}</th>
            {d.level === "sample" && <th>Patient</th>}
            {d.columns.map((c, i) => <th key={c.name} className={i === colIdx ? "focus" : undefined}>{c.name}</th>)}
          </tr></thead>
          <tbody>
            {shown.slice(0, ROW_CAP).map((r) => (
              <tr key={idOf(r)} style={{ cursor: "default" }}>
                <td><code>{idOf(r)}</code></td>
                {d.level === "sample" && <td className="meta"><code>{r.patient}</code></td>}
                {r.values.map((v, i) => <td key={i} className={i === colIdx ? "focus" : undefined}>{v || <span className="meta">—</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CustomDataDialog({ focus, onClose, demos, onImportDemos, onManage, bindings, onRepin }: {
  focus: CustomDataFocus | null;
  onClose: () => void;
  /** the document's pins (`uploads`): a pinned name shows that server version */
  bindings: UploadBinding[];
  /** move a pin to the server's latest version */
  onRepin: (as: string, version: number) => void;
  /** gallery demo uploads that ship with the app, offered when one is missing */
  demos: StoredDataset[] | CustomDataset[];
  onImportDemos: (ids: string[]) => void | Promise<void>;
  /** open Explore → Custom data */
  onManage: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const list = useCustomDatasets();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focus && !el.open) el.showModal();
    if (!focus && el.open) el.close();
  }, [focus]);
  const ids = focus?.datasets ?? [];
  // the same precedence the requests use (custom-data-client.ts attach): a pin, then a local upload, then the server's latest
  const where = ids.map((id) => {
    const pin = bindings.find((b) => b.as === id), local = list.find((d) => d.id === id), s = serverBySlug(id);
    if (pin) return { id, server: { dataset: pin.dataset, version: pin.version, latest: serverState().datasets.find((d) => d.id === pin.dataset)?.latestVersion ?? 0 } };
    if (local) return { id, local };
    if (s) return { id, server: { dataset: s.id, version: s.latestVersion, latest: s.latestVersion } };
    return { id };
  });
  const missing = where.filter((w) => !w.local && !w.server).map((w) => w.id);
  const demoMissing = missing.filter((id) => demos.some((d) => d.id === id));

  return (
    <dialog ref={ref} className="addchartdialog customdatadialog" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="row" style={{ alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>
          {focus?.clause ? <>Custom data behind {focus.clause.cohort ? <>&ldquo;{focus.clause.cohort}&rdquo;</> : "this clause"}</> : "Custom data this analysis uses"}
        </h3>
        <span className="spacer" />
        <button className="linklike" onClick={() => { ref.current?.close(); onManage(); }}>manage uploads</button>
        <button className="primary" onClick={() => ref.current?.close()}>Done</button>
      </div>
      <p className="note" style={{ marginTop: "var(--s1)" }}>
        A local upload is stored in this browser only and sent with each request that names it; a
        server one is pinned by version and read by the server. Either way the document holds the
        attribute names (and, for server data, the version), never these values.
      </p>
      {missing.length > 0 && (
        <div className="card customwarn">
          Not in this browser: {missing.map((id, i) => <span key={id}>{i ? ", " : ""}<code>custom:{id}</code></span>)}.
          The analysis cannot run until it is added under Explore → Custom data with the same name.
          {demoMissing.length > 0 && <div className="row" style={{ marginTop: "var(--s2)" }}>
            <button className="primary" onClick={() => onImportDemos(demoMissing)}>Add the demo upload{demoMissing.length > 1 ? "s" : ""}</button>
          </div>}
        </div>
      )}
      {where.map((w) => w.local ? <DatasetView key={w.id} d={w.local} clause={focus?.clause} />
        : w.server ? <ServerDataset key={w.id} id={w.server.dataset} version={w.server.version} latest={w.server.latest} clause={focus?.clause}
            onRepin={bindings.some((b) => b.as === w.id) ? () => onRepin(w.id, w.server!.latest) : undefined} />
        : null)}
    </dialog>
  );
}
