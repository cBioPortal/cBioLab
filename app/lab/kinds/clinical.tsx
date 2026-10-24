"use client";
// The clinical view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CardProps } from "../view-cards.tsx";
import type { KindUi } from "./kind-ui.ts";
import { PickMenu, SeriesSwatch, ViewHead } from "../view-chrome.tsx";
import { pCell, placement } from "./parts.tsx";

function ClinicalCard({ ctx, v, vi }: CardProps) {
  const { attrsLoading, busy, catalogAttrs, cohortChoice, docView, menuOpenRef, setViewAttrs, viewIds } = ctx;
  return <>
    {v.kind === "clinical" && v.clinical && <>
      <ViewHead menuStore={menuOpenRef.current} v={v} title="Clinical comparison" cohorts={cohortChoice(vi, docView(vi))} sub="attribute distributions across cohorts" {...placement(ctx, vi)}
        actions={<PickMenu label="attributes" title="which clinical attributes this view compares" busy={busy}
          menuId={"attrs:" + (viewIds[vi] ?? vi)} menuStore={menuOpenRef.current} loading={attrsLoading()}
          options={catalogAttrs().map((a) => ({ value: a.attribute, label: a.attribute, hint: a.kind }))}
          chosen={(docView(vi).attributes || []).map(String)} min={1} max={20}
          onChange={(next) => setViewAttrs(vi, next)} />} />
      {v.note && <p className="note">{v.note}</p>}
      <div className="vscroll">
        <table className="vtable">
          <thead><tr>
            <th className="l">attribute</th>
            {v.cohorts!.map((n, i: number) => <th key={n} className="l"><SeriesSwatch i={i} /> {n}</th>)}
            <th className="r">test</th>
            <th className="r">p</th>
            <th className="r">q</th>
          </tr></thead>
          <tbody>{v.clinical.map(r => (
            <tr key={r.attribute} className="ruled">
              <td className="bold nowrap">
                {r.attribute}<br /><span className="meta thlight">{r.per}-level · {r.kind === "num" ? "numeric" : (r.distinct ?? 0) + " values"}</span>
              </td>
              {r.skipped
                ? <td colSpan={v.cohorts!.length + 3} className="muted italic">not compared — {r.skipped}</td>
                : <>
                  {r.cells.map(c => (
                    <td key={c.cohort} className="top">
                      {r.kind === "num"
                        ? <span className="tnum">{c.mean} <span className="meta">± {c.sd} (n={c.n.toLocaleString()})</span>
                            {c.median != null && <><br /><span className="meta">median {c.median} ({c.q1}–{c.q3})</span></>}</span>
                        : <span className="meta">{(c.top || []).slice(0, 3).map(t2 => t2.v + " " + Math.round(1000 * t2.n / (c.n || 1)) / 10 + "%").join(" · ")}</span>}
                    </td>
                  ))}
                  <td className="r nowrap"
                    title={r.statistic != null ? r.test + " = " + r.statistic + ", df = " + r.df + (r.df2 != null ? ", " + r.df2 : "") + (r.minExpected != null ? ", smallest expected cell = " + r.minExpected : "") +
                      (r.rankP != null ? "; " + (r.test === "Welch ANOVA" ? "Kruskal-Wallis H = " : "Mann-Whitney U = ") + r.rankStatistic + ", p = " + r.rankP + " (single-study only, not part of the q-value correction)" : "") : undefined}>
                    <span className="meta">{r.test}{r.rankP != null && "*"}</span>
                  </td>
                  <td className={"r tnum" + ((r.p ?? 1) < 0.001 ? " bold" : "")}>{r.p != null ? pCell(r.p) : "—"}</td>
                  <td className="r tnum muted">{r.q != null ? pCell(r.q) : "—"}</td>
                </>}
            </tr>))}
          </tbody>
        </table>
      </div>
    </>}
  </>;
}

export const clinicalUi: KindUi<"clinical"> = {
  kind: "clinical",
  label: "Clinical comparison",
  title: "Clinical comparison",
  why: (_k, p) => p.viewAttrs().length ? null : "this study declares no clinical attributes to compare",
  loading: (_k, p) => p.attrsLoading(),
  defaults: (_k, p) => ({ kind: "clinical", attributes: p.viewAttrs() }),
  Card: ClinicalCard,
  drawsOwnHead: (v) => !!v.clinical,
};
