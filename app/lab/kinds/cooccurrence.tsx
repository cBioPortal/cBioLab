"use client";
// The cooccurrence view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Button } from "../../_ui/button";
import type { CardProps } from "../view-cards.tsx";
import type { KindUi } from "./kind-ui.ts";
import { ViewHead } from "../view-chrome.tsx";
import { pCell, placement } from "./parts.tsx";

function CooccurrenceCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, menuOpenRef, openGenes } = ctx;
  return <>
    {v.kind === "cooccurrence" && v.pairs && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Co-occurrence" cohorts={cohortChoice(vi, docView(vi), 1)} sub="pairwise, among patients profiled for both genes" {...placement(ctx, vi)}
        actions={<Button variant="link" size="inline" className="genesbtn text-md" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</Button>} />
      {v.note && <p className="note">{v.note}</p>}
      <div className="vscroll">
        <table className="vtable">
          <thead><tr>
            <th className="l">pair</th>
            <th className="r">both</th>
            <th className="r">A only</th>
            <th className="r">B only</th>
            <th className="r">neither</th>
            <th className="r">log<sub>2</sub> OR</th>
            <th className="r">p</th>
            <th className="r">q</th>
            <th className="l">tendency</th>
          </tr></thead>
          <tbody>{v.pairs.map(r => {
            const lor = r.oddsRatioMH != null ? Math.log2(r.oddsRatioMH) : r.log2Odds;
            const pShown = r.pStratified ?? r.p;
            return (
            <tr key={r.a + "|" + r.b} className="ruled"
              title={"profiled for both: " + r.profiled.toLocaleString() +
                (r.pStratified != null ? "  ·  stratified over " + r.strata + " studies (CMH); pooled Fisher p=" + r.p.toExponential(1) : "")}>
              <td className="bold">{r.a} / {r.b}</td>
              <td className="r tnum">{r.both.toLocaleString()}</td>
              <td className="r tnum">{r.onlyA.toLocaleString()}</td>
              <td className="r tnum">{r.onlyB.toLocaleString()}</td>
              <td className="r tnum muted">{r.neither.toLocaleString()}</td>
              <td className="r tnum">{lor == null ? "—" : lor.toFixed(2)}</td>
              <td className={"r tnum" + (pShown < 0.001 ? " bold" : "")}>{pCell(pShown)}</td>
              <td className="r tnum muted">{pCell(r.q)}</td>
              <td >
                {r.tendency && <span className={r.tendency === "co-occurrence" ? "tend co" : "tend mx"}>{r.tendency}</span>}
              </td>
            </tr>); })}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

export const cooccurrenceUi: KindUi<"cooccurrence"> = {
  kind: "cooccurrence",
  label: "Co-occurrence",
  title: "Co-occurrence",
  maxCohorts: 1,
  defaults: (k) => ({ kind: "cooccurrence", genes: k.genes.slice(0, 6) }),
  Card: CooccurrenceCard,
  drawsOwnHead: (v) => !!v.pairs,
};
