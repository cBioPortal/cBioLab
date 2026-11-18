"use client";
// The table view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DataTable, specQuery } from "../../_table/DataTable.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { useState } from "react";
import { Input } from "../../_ui/input";
import type { TableResult } from "../../../lib/views/table/types.ts";

const OWN = new Set(["patient", "sample", "samples"]);

/**
 * The table on its side, as the portal's Patient page lists clinical data (ClinicalInformationPatientTable,
 * ClinicalInformationSamplesTable): a row per attribute, in the study's order (priority, then name), and a
 * column per patient — "Value" for one — or per sample, a sample's own attributes only, "n/a" where a
 * sample has none; an attribute no one has is left out. A filter box narrows the attributes.
 */
function TransposedTable({ t }: { t: TableResult }) {
  const [filter, setFilter] = useState("");
  const perSample = t.unit === "sample";
  const skip = new Set([...OWN, ...(perSample ? t.patientAttrs || [] : [])]);
  const heads = t.rows.map((r) => perSample ? r.sample : r.patient);
  const attrs = t.columns.map((c, i) => ({ c, vals: t.rows.map((r) => r.values[i] ?? "") }))
    .filter(({ c, vals }) => !skip.has(c.id) && vals.some((v) => v !== ""));
  const f = filter.trim().toLowerCase();
  const shown = f ? attrs.filter(({ c, vals }) => (c.name + " " + c.id + " " + vals.join(" ")).toLowerCase().includes(f)) : attrs;
  return (
    <div data-tw className="flex flex-col gap-2">
      <div className="viewtb"><div className="tbz">
        <Input className="h-8 w-56" placeholder="filter attributes" aria-label="filter attributes" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-sm text-muted-foreground">{shown.length === attrs.length ? attrs.length + " attributes" : shown.length + " of " + attrs.length + " attributes"}</span>
      </div></div>
      <table className="dt-table [&_th]:text-left [&_td]:pr-4 [&_th]:pr-4">
        <thead><tr><th>Attribute</th>{heads.length === 1 && !perSample ? <th>Value</th> : heads.map((h) => <th key={h} className="mono">{h}</th>)}</tr></thead>
        <tbody>
          {shown.map(({ c, vals }) => (
            <tr key={c.id}><td data-tip={c.id}>{c.name}</td>{vals.map((v, i) => <td key={i}>{v === "" ? (perSample ? "n/a" : "") : v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The clinical data table's body, on the shared table (app/_table/DataTable.tsx). */
function ClinicalTableBody({ c }: { c: KindCardCtx }) {
  const t = c.v.table as TableResult;
  return <DataTable t={t} query={specQuery(c.spec)} updating={c.updating ?? c.busy} vi={c.vi} docJson={c.docJson} unit={t.unit + "s"}
    onQuery={(q) => c.patch({ ...q, attributes: undefined })}
    cell={(id, x) => (id === "patient" || id === "sample") ? <span className="mono">{x}</span> : undefined} />;
}

/** the table view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="a row per sample, carrying its patient's attributes too, or a row per patient with patient attributes only">
          rows per <OptionSelect value={spec.unit === "patient" ? "patient" : "sample"} disabled={busy}
            onValueChange={(v) => patch({ unit: v === "patient" ? "patient" : undefined, sort: undefined, filters: undefined, columns: undefined, attributes: undefined, search: undefined })}>
            <option value="sample">sample</option><option value="patient">patient</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const tableUi: KindUi<"table"> = {
  kind: "table",
  label: "Clinical data table (download)",
  category: "overview",
  title: "Clinical data",
  maxCohorts: 6,
  sub: (spec, v) => "one row per " + (spec.unit === "patient" ? "patient" : "sample") + (v.table ? " · " + v.table.total.toLocaleString() + " rows, " + v.table.columns.length + " attributes" : ""),
  Controls,
  body: (c) => c.v.table ? (c.spec.transpose ? <TransposedTable t={c.v.table as TableResult} /> : <ClinicalTableBody c={c} />) : null,
  drawsOwnWaiting: true,
};
