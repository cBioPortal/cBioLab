"use client";
// The compare view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Button } from "../../_ui/button";
import type { CardProps } from "../view-cards.tsx";
import type { KindUi } from "./kind-ui.ts";
import { SeriesSwatch, ViewHead } from "../view-chrome.tsx";
import { placement } from "./parts.tsx";

function CompareCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, menuOpenRef, openGenes } = ctx;
  return <>
    {v.kind === "compare" && v.rows && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Compare" cohorts={cohortChoice(vi, docView(vi))} sub={<>alteration frequencies · {v.annotation}</>} {...placement(ctx, vi)}
        actions={<Button variant="link" size="inline" className="genesbtn text-md" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</Button>} />
      {v.note && <p className="note" title={(v.studies || []).join(", ") || undefined}
        style={v.studies && v.studies.length > 2 ? { cursor: "help", textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>{v.note}</p>}
      <div className="vscroll">
        <table className="vtable">
          <thead><tr>
            <th className="l">gene</th>
            {v.cohorts!.map((n, i: number) => <th key={n} className="r"><SeriesSwatch i={i} /> {n}<br /><span className="thsub">driver / any</span></th>)}
            {v.rows[0] && v.rows[0].pAny != null && <th className="r">p (any)</th>}
            {v.rows[0] && v.rows[0].qAny != null && <th className="r">q (any)</th>}
          </tr></thead>
          <tbody>{v.rows.map(r => (
            <tr key={r.gene} className="ruled">
              <td className="bold">{r.gene}</td>
              {r.cells.map(c => {
                const bt = c.byType;
                const missing = bt && (["mutation", "cna", "structuralVariant"] as const)
                  .filter(t => bt[t].profiled === 0 && (bt.mutation.profiled > 0 || bt.cna.profiled > 0 || bt.structuralVariant.profiled > 0));
                const label = { mutation: "mutation", cna: "copy-number", structuralVariant: "structural-variant" };
                const title = bt ? "mutation " + bt.mutation.altered + "/" + bt.mutation.profiled +
                  " · copy-number " + bt.cna.altered + "/" + bt.cna.profiled +
                  " · structural-variant " + bt.structuralVariant.altered + "/" + bt.structuralVariant.profiled +
                  (missing && missing.length ? " — no " + missing.map(t => label[t]).join("/") + " data for this cohort's study" : "") : undefined;
                return (
                  <td key={c.cohort} className="r tnum" title={title}>
                    {c.driverPct}% / {c.anyPct}%{missing && missing.length ? <sup className="warnmark">*</sup> : null}
                  </td>
                );
              })}
              {r.pAny != null && <td className={"r tnum" + (r.pAny < 0.001 ? " bold" : "")}>{r.pAny < 1e-4 ? r.pAny.toExponential(1) : r.pAny.toFixed(3)}</td>}
              {r.qAny != null && <td className={"r tnum" + (r.qAny < 0.05 ? " bold" : "")}>{r.qAny < 1e-4 ? r.qAny.toExponential(1) : r.qAny.toFixed(3)}</td>}
            </tr>))}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

export const compareUi: KindUi<"compare"> = {
  kind: "compare",
  label: "Compare genes",
  title: "Compare",
  defaults: (k) => ({ kind: "compare", genes: k.genes }),
  Card: CompareCard,
  drawsOwnHead: (v) => !!v.rows,
};
