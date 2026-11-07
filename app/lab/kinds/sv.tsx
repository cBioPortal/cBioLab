"use client";
// The sv view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { AnnotationBadge } from "../portal-bodies.tsx";
import { DataTable, specQuery } from "../../_table/DataTable.tsx";
import { sampleHref } from "../../portal/cohort-navigation.ts";
import type { DrawnResultOf, TableQuery } from "../../../lib/types";
import type { KindUi } from "./kind-ui.ts";

// ---- Structural variants: the queried genes' structural-variant table, on the shared table (app/_table/DataTable.tsx) ----

function SvBody({ v, spec, vi, updating, docJson, onQuery }: { v: DrawnResultOf<"sv">; spec: Record<string, unknown>; vi: number; updating: boolean; docJson?: () => string;
  onQuery: (q: TableQuery) => void }) {
  const t = v.sv;
  return (
    <div className="pb">
      <DataTable t={t} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit={t.genes.join(", ") + " structural variants"} onQuery={onQuery}
        num={(_id, x) => x.toLocaleString()}
        cell={(id, x, r) => id === "annotation" && x ? <AnnotationBadge text={String(x)} />
          // as on the portal's table, a sample id opens that sample's page, in a new tab so the table keeps its place
          : id === "sample" ? (r.study && x ? <a className="mono" href={sampleHref(r.study, String(x))} target="_blank" rel="noreferrer"
            data-tip={"open sample " + x + "'s page"}>{x}</a> : <span className="mono">{x}</span>) : undefined} />
    </div>
  );
}

export const svUi: KindUi<"sv"> = {
  kind: "sv",
  label: "Structural variant table (genes)",
  category: "alterations",
  title: "Structural variants",
  genes: true,
  maxCohorts: 6,
  defaults: (known) => ({ kind: "sv", genes: known.genes.length ? known.genes.slice(0, 5) : ["ALK", "ROS1", "RET"] }),
  sub: (spec, v) => ((spec.genes || []).join(", ") || "no genes") + " · every structural variant" + (v.sv ? " · " + v.sv.total.toLocaleString() + " rows" : ""),
  body: (c) => c.v.sv ? <SvBody v={c.v} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} onQuery={(q) => c.patch({ ...q })} /> : null,
  drawsOwnWaiting: true,
};
