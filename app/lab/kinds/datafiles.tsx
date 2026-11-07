"use client";
// The datafiles view (cBioPortal's Results-page Download tab) on the analysis page and the portal: its
// entry in the add menu, the view a new one starts from, and its card — the files, each downloaded
// whole through POST /api/table; the altered / unaltered lists copied or opened as a cohort in the
// lab; the gene alteration frequencies; and the case table, on the shared table.
import { useState } from "react";
import { Copy, Download, ExternalLink } from "lucide-react";
import { DataTable, specQuery } from "../../_table/DataTable.tsx";
import { Button } from "../../_ui/button";
import { TB } from "../../_ui/toolbar.ts";
import { api } from "../api.ts";
import { docParam } from "../use-library.ts";
import { storeDocLists } from "../id-sets-client.ts";
import type { AnalysisDoc, DrawnResultOf, TableQuery } from "../../../lib/types";
import type { TableBody } from "../../../lib/api-schemas.ts";
import type { DataFile } from "../../../lib/views/datafiles/types.ts";
import type { KindUi } from "./kind-ui.ts";

type Result = DrawnResultOf<"datafiles">["datafiles"];

/** The document as it stands, for a file's request. */
function readDoc(docJson: () => string): TableBody["doc"] | null {
  try { return JSON.parse(docJson()) as TableBody["doc"]; } catch { return null; }
}

/** A sample list's ids, "<study>:<sample>", read from the file the download serves. */
async function listIds(docJson: () => string, vi: number, table: string): Promise<string[]> {
  const doc = readDoc(docJson);
  if (!doc) throw new Error("the document cannot be read");
  const res = await fetch("/api/table", { method: "POST", headers: { "content-type": "application/json" }, body: await api.tablePayload({ doc, view: vi, table }) });
  const text = await res.text();
  if (!res.ok) throw new Error(text.trim());
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.some((l) => l.startsWith("# DOWNLOAD INCOMPLETE"))) throw new Error(lines.find((l) => l.startsWith("#"))!.slice(2));
  const head = lines[0].split(",");
  const st = head.indexOf("study"), sm = head.indexOf("sample");
  // sample and study ids hold no commas or quotes, so a split reads them
  return lines.slice(1).map((l) => { const xs = l.split(","); return xs[st] + ":" + xs[sm]; });
}

function FileRow({ f, vi, docJson, updating }: { f: DataFile; vi: number; docJson?: () => string; updating: boolean }) {
  const [state, setState] = useState<string | null>(null);
  const download = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const doc = docJson ? readDoc(docJson) : null;
    if (!doc) return;
    (form.elements.namedItem("payload") as HTMLInputElement).value = await api.tablePayload({ doc, view: vi, table: f.id });
    form.submit();
  };
  /** read the list, act on it, and say what came of it: `act`'s message, or why it failed */
  const withIds = async (what: string, act: (ids: string[]) => Promise<string | null>) => {
    if (!docJson) return;
    setState(what + "…");
    try { setState(await act(await listIds(docJson, vi, f.id))); }
    catch (e) { setState("could not " + what + ": " + (e as Error).message); }
  };
  const copy = () => withIds("copy", async (ids) => { await navigator.clipboard.writeText(ids.join("\n")); return ids.length.toLocaleString() + " sample ids copied"; });
  const open = () => withIds("open", async (ids) => {
    const studies = [...new Set(ids.map((x) => x.slice(0, x.indexOf(":"))))];
    const name = f.name;
    const doc = await storeDocLists({ ...(studies.length === 1 ? { study: studies[0] } : { study: studies[0], studies }),
      cohorts: { [name]: { ...(studies.length === 1 ? { study: studies[0] } : { studies }), all: [{ kind: "sampleList", ids }] } }, views: [] } as unknown as AnalysisDoc);
    window.open("/lab?doc=" + docParam(doc), "_blank", "noopener");
    return null;
  });
  const off = updating ? "waiting for the view to update, so the file matches it" : !docJson ? "the document cannot be read here" : !f.rows ? "no rows to download" : null;
  return (
    <tr>
      <td>
        <div className="font-medium">{f.name}</div>
        <div className="text-sm text-muted-foreground">{f.description}{f.studies ? " · only " + f.studies.join(", ") + " hold it" : ""}</div>
        {state && <div className="text-sm" role="status">{state}</div>}
      </td>
      <td className="tabular-nums text-right whitespace-nowrap">{f.rows.toLocaleString()} rows</td>
      <td className="whitespace-nowrap">
        <span className="inline-flex gap-1.5">
          <form method="post" action="/api/table" target="_blank" onSubmit={download}>
            <input type="hidden" name="payload" />
            <Button variant="outline" size="sm" className={TB} type="submit" disabled={!!off} aria-label={"download " + f.name}
              data-tip={off || "every row as comma-separated text, with the cohort and study of each"}><Download />CSV</Button>
          </form>
          {(f.id === "altered" || f.id === "unaltered") && <>
            <Button variant="outline" size="sm" className={TB} type="button" disabled={!!off} onClick={() => void copy()} aria-label={"copy the " + f.name.toLowerCase()}
              data-tip={off || "copy the sample ids, one per line, as <study>:<sample>"}><Copy />Copy</Button>
            <Button variant="outline" size="sm" className={TB} type="button" disabled={!!off} onClick={() => void open()} aria-label={"open the " + f.name.toLowerCase() + " as a cohort in the lab"}
              data-tip={off || "open these samples in the lab as a cohort (a sampleList clause), in a new tab"}><ExternalLink />Open as cohort</Button>
          </>}
        </span>
      </td>
    </tr>
  );
}

function frequencyCsv(d: Result): string {
  const q = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  return ["gene,oql_line,altered,profiled,percent_altered",
    ...d.frequency.map((f) => [f.gene, q(f.line), f.altered, f.profiled, f.percent ?? ""].join(","))].join("\n") + "\n";
}

function DatafilesBody({ d, spec, vi, updating, docJson, onQuery }: { d: Result; spec: Record<string, unknown>; vi: number; updating: boolean; docJson?: () => string;
  onQuery: (q: TableQuery) => void }) {
  return (
    <div className="pb flex flex-col gap-5">
      <section aria-label="downloadable data files">
        <h4 className="mb-2 font-semibold">Downloadable data files</h4>
        <table className="w-full text-md [&_td]:border-b [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top">
          <tbody>{d.files.map((f) => <FileRow key={f.id} f={f} vi={vi} docJson={docJson} updating={updating} />)}</tbody>
        </table>
      </section>
      <section aria-label="gene alteration frequency">
        <div className="mb-2 flex items-center gap-3">
          <h4 className="m-0 font-semibold">Gene alteration frequency</h4>
          <span className="text-sm text-muted-foreground">altered ÷ samples profiled for the gene</span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" className={TB} asChild>
            <a href={"data:text/csv;charset=utf-8," + encodeURIComponent(frequencyCsv(d))} download="gene_alteration_frequency.csv" data-tip="this table as comma-separated text">
              <Download />CSV</a>
          </Button>
        </div>
        <table className="text-md [&_td]:border-b [&_td]:py-1 [&_td]:pr-6 [&_th]:pr-6 [&_th]:text-left">
          <thead><tr><th>Gene</th><th>OQL line</th><th className="text-right">Altered</th><th className="text-right">Profiled</th><th className="text-right">Altered %</th></tr></thead>
          <tbody>{d.frequency.map((f) => (
            <tr key={f.line}><td className="font-medium">{f.gene}</td><td className="mono">{f.line}</td>
              <td className="tabular-nums text-right">{f.altered.toLocaleString()}</td><td className="tabular-nums text-right">{f.profiled.toLocaleString()}</td>
              <td className="tabular-nums text-right">{f.percent == null ? "—" : f.percent.toFixed(1) + "%"}</td></tr>))}
          </tbody>
        </table>
        <p className="mt-2 mb-0 text-sm text-muted-foreground">
          Altered in {d.counts.altered.toLocaleString()} of {d.counts.samples.toLocaleString()} samples
          {d.counts.samples ? " (" + (Math.round(d.counts.altered / d.counts.samples * 1000) / 10) + "%)" : ""}; unaltered: {d.counts.unaltered.toLocaleString()}
          {d.counts.unprofiled ? "; neither (not altered, but not profiled for every queried gene and data type): " + d.counts.unprofiled.toLocaleString() : ""}.
        </p>
      </section>
      <section aria-label="type of genetic alterations across all samples">
        <h4 className="mb-2 font-semibold">Type of genetic alterations across all samples</h4>
        <DataTable t={d} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit="samples" onQuery={onQuery}
          cell={(id, x) => id !== "sample" && id !== "patient" && (x === "no alteration" || x === "not profiled" || x === "unaltered") ? <span className="text-muted-foreground">{x}</span> : undefined} />
      </section>
    </div>
  );
}

export const datafilesUi: KindUi<"datafiles"> = {
  kind: "datafiles",
  label: "Data files (the Download tab: per-gene files, altered / unaltered lists, frequencies)",
  category: "alterations",
  title: "Download",
  maxCohorts: 1,
  defaults: (known) => ({ kind: "datafiles", oql: (known.genes.length ? known.genes : ["TP53"]).slice(0, 12) }),
  sub: (spec, v) => ((spec.oql || []) as string[]).join(" · ") + (v.datafiles ? " · " + v.datafiles.counts.samples.toLocaleString() + " samples" : ""),
  body: (c) => c.v.datafiles ? <DatafilesBody d={c.v.datafiles} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} onQuery={(q) => c.patch({ ...q })} /> : null,
  drawsOwnWaiting: true,
};
