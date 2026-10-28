"use client";
// The data sets table, laid out as cBioPortal's Datasets page: study name (into Explore) with its
// download, the reference, and per-data-type sample counts, sorted by name; more columns and
// filters on request. Search matches name, id, cancer type and reference.
import { useMemo, useState } from "react";
import type { DatasetRow } from "../../lib/datasets.ts";
import { Columns3, ListFilter } from "lucide-react";
import { Checkbox } from "../_ui/checkbox";
import { GearMenu } from "../_ui/gear-menu.tsx";
import { Input } from "../_ui/input";

/** a checkbox row in a menu */
const CHK = "flex cursor-pointer items-center gap-2 py-1 text-md";

type Col = { key: keyof DatasetRow; label: string; title: string; shown?: boolean };
const COUNTS: Col[] = [
  { key: "samples", label: "All", title: "distinct samples", shown: true },
  { key: "mutation", label: "Mutations", title: "samples sequenced for mutations", shown: true },
  { key: "cna", label: "CNA", title: "samples with discrete copy-number calls", shown: true },
  { key: "rnaseq", label: "RNA-Seq", title: "samples with RNA-seq expression", shown: true },
  { key: "microarray", label: "mRNA Microarray", title: "samples with microarray expression" },
  { key: "patients", label: "Patients", title: "distinct patients" },
  { key: "sv", label: "Structural Variants", title: "samples profiled for structural variants" },
  { key: "segments", label: "Segments", title: "samples with copy-number segments (the genome view reads these)" },
  { key: "protein", label: "Protein", title: "samples with protein data (RPPA or mass spectrometry)" },
  { key: "timeline", label: "Timeline", title: "patients with any timeline event" },
  { key: "treatments", label: "Treatments", title: "patients with treatment records" }
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

export function DatasetsTable({ rows }: { rows: DatasetRow[] }) {
  const [q, setQ] = useState("");
  const [on, setOn] = useState<string[]>([]);
  const [cols, setCols] = useState<string[]>(COUNTS.filter((c) => c.shown).map((c) => String(c.key)));
  const [sort, setSort] = useState<{ key: keyof DatasetRow; desc: boolean }>({ key: "name", desc: false });
  const shownCols = COUNTS.filter((c) => cols.includes(String(c.key)));
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filters = FILTERS.filter((f) => on.includes(f.id));
    const out = rows.filter((r) =>
      (!needle || [r.name, r.id, r.cancerType, r.citation || ""].some((x) => x.toLowerCase().includes(needle))) &&
      filters.every((f) => f.test(r)));
    const k = sort.key;
    return out.sort((a, b) => {
      const x = a[k], y = b[k];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
      return sort.desc ? -c : c;
    });
  }, [rows, q, on, sort]);
  const head = (key: keyof DatasetRow, label: string, title: string, num = true) => (
    <th key={String(key)} data-tip={title} className={num ? "num" : undefined} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : num }))}>
      {label}{sort.key === key ? (sort.desc ? " ▾" : " ▴") : ""}
    </th>
  );
  return (
    <section className="ds-table">
      <div className="ds-controls">
        <Input type="search" placeholder="search studies, cancer types, references" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-80 bg-card text-md md:text-md" />
        <span className="meta">{shown.length.toLocaleString()} of {rows.length.toLocaleString()} studies</span>
        <span className="spacer" />
        <GearMenu menuId="ds-filters" title="show only studies with these data" contentClassName="px-2.5"
          label={<><ListFilter />Filters{on.length ? " (" + on.length + ")" : ""}</>}>
            <span className="meta">studies with:</span>
            {FILTERS.map((f) => (
              <label key={f.id} className={CHK}><Checkbox checked={on.includes(f.id)}
                onCheckedChange={() => setOn((o) => o.includes(f.id) ? o.filter((x) => x !== f.id) : [...o, f.id])} /> {f.label}</label>
            ))}
        </GearMenu>
        <GearMenu menuId="ds-columns" title="choose the count columns shown" contentClassName="px-2.5"
          label={<><Columns3 />Columns</>}>
            {COUNTS.map((c) => (
              <label key={String(c.key)} className={CHK} data-tip={c.title}><Checkbox checked={cols.includes(String(c.key))}
                onCheckedChange={() => setCols((o) => o.includes(String(c.key)) ? o.filter((x) => x !== String(c.key)) : [...o, String(c.key)])} /> {c.label}</label>
            ))}
        </GearMenu>
      </div>
      <div className="ds-scroll">
        <table>
          <thead><tr>
            {head("name", "Name", "study name", false)}
            <th />
            {head("citation", "Reference", "the study's publication", false)}
            {shownCols.map((c) => head(c.key, c.label, c.title))}
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="ds-study">
                  <a href={"/lab?tab=explore&study=" + encodeURIComponent(r.id)} data-tip={r.id + " — explore this study"}>{r.name}</a>
                  {r.instance !== "a" && <span className="meta"> · {r.instanceLabel}</span>}
                </td>
                <td className="ds-dl"><a href={"https://datahub.assets.cbioportal.org/" + encodeURIComponent(r.id) + ".tar.gz"} data-tip="download this study's files from the public cBioPortal datahub" aria-label={"download " + r.id}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></svg>
                </a></td>
                <td>{r.citation ? (r.pmids.length
                  ? <a href={"https://pubmed.ncbi.nlm.nih.gov/" + r.pmids[0]} target="_blank" rel="noreferrer">{r.citation}</a>
                  : r.citation) : null}</td>
                {shownCols.map((c) => <td key={String(c.key)} className="num">{(Number(r[c.key]) || 0).toLocaleString()}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
