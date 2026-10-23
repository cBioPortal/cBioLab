"use client";
// The coexpression view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Button } from "../../_ui/button";
import type { CardProps } from "../view-cards.tsx";
import { Choice } from "../../_ui/choice.tsx";
import type { KindUi } from "./kind-ui.ts";
import { ViewHead } from "../view-chrome.tsx";
import { isDrawn } from "../../../lib/types.ts";
import { pCell, placement } from "./parts.tsx";

function CoexpressionCard({ ctx, v, vi }: CardProps) {
  const { busy, cohortChoice, docView, explore, menuOpenRef, openGenes, updateView } = ctx;
  return <>
    {v.kind === "coexpression" && isDrawn(v) && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Co-expression" cohorts={cohortChoice(vi, docView(vi), 1)} sub="Pearson correlation from per-site sums" {...placement(ctx, vi)}
        actions={<>
          <label className="tbfield" title="the molecular profile the correlation is computed over">profile <Choice size="ctl"
            value={docView(vi).profileType || ""} disabled={busy} placeholder="(none)"
            onChange={(v) => updateView(vi, (vv: any) => ({ ...vv, profileType: v }))}
            options={((explore && explore.profiles) || []).map((pt: string) => [pt, pt] as const)} /></label>
          <Button variant="link" size="inline" className="genesbtn text-md" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</Button>
        </>} />
      {v.note && <p className="note">{v.note}</p>}
      <div className="vscroll">
        <table className="vtable">
          <thead><tr>
            <th className="l">pair</th>
            <th className="r">n</th>
            <th className="barhead" style={{ width: "9rem" }} aria-label="correlation, visualised" />
            <th className="r">r</th>
            {v.coexpression.some(x => x.rMeta != null) && <th className="r">r (meta)</th>}
            <th className="r">p</th>
            <th className="r">q</th>
          </tr></thead>
          <tbody>{v.coexpression.map(r => (
            <tr key={r.a + "|" + r.b} className="ruled"
              title={(r.perStudy || []).map(s2 => s2.study + ": r=" + s2.r + " (n=" + s2.n + ")").join("\n") || undefined}>
              <td className="bold">{r.a} / {r.b}</td>
              <td className="r tnum muted">{r.n.toLocaleString()}</td>
              <td >
                {r.r != null && <span className="rbar"><i style={{
                  width: Math.abs(r.r) * 50 + "%",
                  marginLeft: r.r < 0 ? (50 - Math.abs(r.r) * 50) + "%" : "50%",
                  background: r.r < 0 ? "#D55E00" : "#0072B2" }} /></span>}
              </td>
              <td className={"r tnum" + (Math.abs(r.r ?? 0) > 0.5 ? " bold" : "")}>{r.r ?? "—"}</td>
              {v.coexpression.some(x => x.rMeta != null) && <td className="r tnum">{r.rMeta ?? "—"}</td>}
              <td className="r tnum">{pCell(r.pMeta ?? r.p)}</td>
              <td className="r tnum muted">{pCell(r.q)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

export const coexpressionUi: KindUi<"coexpression"> = {
  kind: "coexpression",
  label: "Co-expression",
  title: "Co-expression",
  maxCohorts: 1,
  why: (_k, p) => p.contProfile() ? null : "this study has no continuous molecular profile (mRNA z-scores) to correlate",
  loading: (_k, p) => !p.contProfile() && (p.trackAttrsLoading || p.exploreBusy),
  defaults: (k, p) => ({ kind: "coexpression", genes: k.genes.slice(0, 5), profileType: p.contProfile() }),
  Card: CoexpressionCard,
  drawsOwnHead: (v) => !!v.coexpression,
};
