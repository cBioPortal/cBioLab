"use client";
// The table view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DataTable, specQuery } from "../../_table/DataTable.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** The clinical data table's body, on the shared table (app/_table/DataTable.tsx). */
function ClinicalTableBody({ c }: { c: KindCardCtx }) {
  const t = c.v.table as import("../../../lib/views/table/types.ts").TableResult;
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
        <label className="tbfield" title="a row per sample, carrying its patient's attributes too, or a row per patient with patient attributes only">
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
  title: "Clinical data",
  maxCohorts: 6,
  sub: (spec, v) => "one row per " + (spec.unit === "patient" ? "patient" : "sample") + (v.table ? " · " + v.table.total.toLocaleString() + " rows, " + v.table.columns.length + " attributes" : ""),
  Controls,
  body: (c) => c.v.table ? <ClinicalTableBody c={c} /> : null,
  drawsOwnWaiting: true,
};
