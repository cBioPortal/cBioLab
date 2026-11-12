"use client";
// The mutations view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { AnnotationBadge } from "../portal-bodies.tsx";
import { DataTable, specQuery } from "../../_table/DataTable.tsx";
import { DraftInput } from "./parts.tsx";
import { sampleHref } from "../../portal/cohort-navigation.ts";
import type { DrawnResultOf, TableQuery } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { ClinvarCell, DbsnpCell, FunctionalImpactCell, FunctionalImpactHead, GnomadCell, HgvscCell, HgvsgCell, SignalCell, useCellTips } from "../mutation-cells.tsx";

// ---- Mutations: one gene's mutation table, on the shared table (app/_table/DataTable.tsx) ---------

function MutationsBody({ v, spec, vi, updating, docJson, onQuery }: { v: DrawnResultOf<"mutations">; spec: Record<string, unknown>; vi: number; updating: boolean; docJson?: () => string;
  onQuery: (q: TableQuery) => void }) {
  const t = v.mutations;
  const tips = useCellTips();
  return (
    <div className="pb">
      {tips.node}
      <DataTable t={t} query={specQuery(spec)} updating={updating} vi={vi} docJson={docJson} unit={t.gene + " mutations"} onQuery={onQuery}
        num={(id, x) => id === "vaf" ? x.toFixed(2) : x.toLocaleString()}
        colHead={(id) => id === "functionalImpact" ? <FunctionalImpactHead show={tips.show} /> : null}
        cell={(id, x, r) => id === "annotation" && x ? <AnnotationBadge text={String(x)} />
          : id === "hgvsg" ? <HgvsgCell hgvsg={String(x ?? "")} detail={r.detail} show={tips.show} />
          : id === "hgvsc" ? <HgvscCell hgvsc={String(x ?? "")} detail={r.detail} />
          : id === "clinvar" ? <ClinvarCell detail={r.detail} show={tips.show} />
          : id === "signal" ? <SignalCell value={String(x ?? "")} detail={r.detail} show={tips.show} />
          : id === "gnomad" ? <GnomadCell detail={r.detail} show={tips.show} />
          : id === "dbsnp" ? <DbsnpCell rsid={String(x ?? "")} detail={r.detail} />
          : id === "functionalImpact" ? <FunctionalImpactCell detail={r.detail} show={tips.show} />
          // as on the portal's table, a sample id opens that sample's page, in a new tab so the table keeps its place
          : id === "sample" ? (r.study && x ? <a className="mono" href={sampleHref(r.study, String(x))} target="_blank" rel="noreferrer"
            data-tip={"open sample " + x + "'s page"}>{x}</a> : <span className="mono">{x}</span>) : undefined} />
    </div>
  );
}

/** the mutations view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (c.locked || []).includes("gene") ? null : (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        {!(c.locked || []).includes("gene") && <label className="tbfield" data-tip="the gene whose mutations are listed">
          gene <DraftInput value={spec.gene || ""} disabled={busy} width="6rem" placeholder="KRAS" onCommit={(t) => patch({ gene: t.trim().toUpperCase() })} />
        </label>}

      </div>
    </div>
  );
}

export const mutationsUi: KindUi<"mutations"> = {
  kind: "mutations",
  label: "Mutation table (one gene)",
  category: "alterations",
  title: "Mutations",
  maxCohorts: 6,
  defaults: (known) => ({ kind: "mutations", gene: known.genes[0] || "TP53" }),
  sub: (spec, v) => (spec.gene || "no gene") + " · every mutation call" + (v.mutations ? " · " + v.mutations.total.toLocaleString() + " rows" : ""),
  Controls,
  body: (c) => c.v.mutations ? <MutationsBody v={c.v} spec={c.spec} vi={c.vi} updating={c.updating ?? c.busy} docJson={c.docJson} onQuery={(q) => c.patch({ ...q })} /> : null,
  drawsOwnWaiting: true,
};
