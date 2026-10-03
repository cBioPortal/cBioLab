"use client";
// The data sets table: search, filter by what a study carries, sort by any column. Every row links
// into Explore for that study, and to the study's files on the public cBioPortal datahub.
import { useMemo, useState } from "react";
import type { DatasetRow } from "../../lib/datasets.ts";

type Col = { key: keyof DatasetRow; label: string; title: string };
const COUNTS: Col[] = [
  { key: "patients", label: "Patients", title: "distinct patients" },
  { key: "samples", label: "Samples", title: "distinct samples" },
  { key: "mutation", label: "Mut", title: "samples sequenced for mutations" },
  { key: "cna", label: "CNA", title: "samples with discrete copy-number calls" },
  { key: "sv", label: "SV", title: "samples profiled for structural variants" },
  { key: "segments", label: "Seg", title: "samples with copy-number segments (the genome view reads these)" },
  { key: "mrna", label: "mRNA", title: "samples with mRNA expression" },
  { key: "protein", label: "Prot", title: "samples with protein data (RPPA or mass spectrometry)" },
  { key: "timeline", label: "Timeline", title: "patients with any timeline event" },
  { key: "treatments", label: "Tx", title: "patients with treatment records" }
];
const FILTERS: { id: string; label: string; test: (r: DatasetRow) => boolean }[] = [
  { id: "mrna", label: "mRNA", test: (r) => r.mrna > 0 },
  { id: "protein", label: "protein", test: (r) => r.protein > 0 },
  { id: "methylation", label: "methylation", test: (r) => r.methylation },
  { id: "segments", label: "segments", test: (r) => r.segments > 0 },
  { id: "timeline", label: "timeline", test: (r) => r.timeline > 0 },
  { id: "ascn", label: "FACETS", test: (r) => r.ascn },
  { id: "ga", label: "generic assays", test: (r) => r.genericAssays.length > 0 },
  { id: "hg38", label: "hg38", test: (r) => r.build === "hg38" }
];

const short = (t: string) => t.toLowerCase().replace(/_/g, " ");

export function DatasetsTable({ rows }: { rows: DatasetRow[] }) {
  const [q, setQ] = useState("");
  const [on, setOn] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: keyof DatasetRow; desc: boolean }>({ key: "samples", desc: true });
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filters = FILTERS.filter((f) => on.includes(f.id));
    const out = rows.filter((r) =>
      (!needle || [r.name, r.id, r.cancerType, r.citation || ""].some((x) => x.toLowerCase().includes(needle))) &&
      filters.every((f) => f.test(r)));
    const k = sort.key;
    return out.sort((a, b) => {
      const x = a[k], y = b[k];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -c : c;
    });
  }, [rows, q, on, sort]);
  const head = (key: keyof DatasetRow, label: string, title: string, num = true) => (
    <th key={String(key)} title={title} className={num ? "num" : undefined} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : num }))}>
      {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
    </th>
  );
  return (
    <section className="ds-table">
      <div className="ds-controls">
        <input type="search" placeholder="search studies, cancer types, citations" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ds-chips">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={"pill" + (on.includes(f.id) ? " on" : "")}
              onClick={() => setOn((o) => o.includes(f.id) ? o.filter((x) => x !== f.id) : [...o, f.id])}>{f.label}</button>
          ))}
        </div>
        <span className="meta">{shown.length.toLocaleString()} of {rows.length.toLocaleString()} studies</span>
      </div>
      <div className="ds-scroll">
        <table>
          <thead><tr>
            {head("name", "Study", "study name and citation", false)}
            {head("cancerType", "Cancer type", "the study's cancer type", false)}
            {COUNTS.map((c) => head(c.key, c.label, c.title))}
            <th title="other data the study carries">Also</th>
            <th />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="ds-study">
                  <a href={"/lab?tab=explore&study=" + encodeURIComponent(r.id)} title="explore this study">{r.name}</a>
                  <div className="meta">
                    <span className="mono">{r.id}</span>
                    {r.citation && <> · {r.pmids.length
                      ? <a href={"https://pubmed.ncbi.nlm.nih.gov/" + r.pmids[0]} target="_blank" rel="noreferrer">{r.citation}</a>
                      : r.citation}</>}
                    {r.build !== "hg19" && <> · {r.build}</>}
                    {r.instance !== "a" && <> · {r.instanceLabel}</>}
                  </div>
                </td>
                <td>{r.cancerType}</td>
                {COUNTS.map((c) => {
                  const v = Number(r[c.key]) || 0;
                  return <td key={String(c.key)} className="num">{v ? v.toLocaleString() : <span className="meta">—</span>}</td>;
                })}
                <td className="ds-also">
                  {[r.methylation && "methylation", r.ascn && "FACETS", ...r.genericAssays.map(short)].filter(Boolean).join(", ") || <span className="meta">—</span>}
                </td>
                <td><a href={"https://datahub.assets.cbioportal.org/" + encodeURIComponent(r.id) + ".tar.gz"} title="download this study's files from the public cBioPortal datahub">files ↓</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
