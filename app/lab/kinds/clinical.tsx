"use client";
// The clinical view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { CardProps } from "../view-cards.tsx";
import type { KindUi } from "./kind-ui.ts";
import { PickMenu, SeriesSwatch, ViewHead } from "../view-chrome.tsx";
import { pCell, placement } from "./parts.tsx";
import { type Col, PortalTable } from "../portal-bodies.tsx";
import { portalPMin } from "../../../lib/chart/format.ts";
import type { ClinicalRow } from "../../../lib/views/clinical/types.ts";
import type { DrawnResultOf } from "../../../lib/types.ts";

/** a test's name as the table writes it: the portal's, and ours for the moment tests */
const TEST_NAME: Record<string, string> = { "chi-squared": "Chi-squared Test", "Wilcoxon": "Wilcoxon Test", "Kruskal-Wallis": "Kruskal Wallis Test",
  "Welch t": "Welch's t-test", "Welch ANOVA": "Welch's ANOVA" };

/**
 * The Comparison page's Clinical tab, as the portal's enrichments table: every attribute with its
 * type, test, p and q, sorted by q, the significant ones bold; one the data cannot test is listed with
 * its reason and no p.
 */
function ClinicalTableBody({ v }: { v: DrawnResultOf<"clinical"> }) {
  const sig = (r: ClinicalRow) => r.q != null && r.q < 0.05;
  const bold = (r: ClinicalRow, text: string) => <span style={{ fontWeight: sig(r) ? 700 : 400 }}>
    {text.startsWith("< 10^") ? <>&lt; 10<sup>{text.slice(5)}</sup></> : text}</span>;
  const cols: Col<ClinicalRow>[] = [
    { key: "name", label: "Clinical Attribute", value: (r) => r.label || r.attribute, render: (r) => <span data-tip={r.attribute}>{bold(r, r.label || r.attribute)}</span> },
    { key: "per", label: "Attribute Type", value: (r) => r.per === "patient" ? "Patient" : "Sample" },
    { key: "test", label: "Statistical Test", value: (r) => r.skipped ? "not tested" : TEST_NAME[r.test || ""] || r.test || "",
      render: (r) => r.skipped ? <span className="muted italic">not tested: {r.skipped}</span> : TEST_NAME[r.test || ""] || r.test },
    { key: "p", label: "p-Value", num: true, value: (r) => r.p ?? null, render: (r) => r.p == null ? "" : bold(r, portalPMin(r.p)),
      title: "p-value of null Hypothesis, derived from Chi-Squared test or Kruskal-Wallis test" },
    { key: "q", label: "q-Value", num: true, value: (r) => r.p == null ? null : r.q ?? null, render: (r) => r.p == null || r.q == null ? "" : bold(r, portalPMin(r.q)),
      title: "Derived from Benjamini-Hochberg FDR correction procedure." },
  ];
  const rows = v.clinical || [];
  const tested = rows.filter((r) => r.p != null).length;
  return (
    <div className="pb" data-test="clinical-table">
      <PortalTable wide rows={rows} cols={cols} initialSort={{ key: "q" }} pageSize={20}
        search={(r) => [r.label, r.attribute, r.per, r.test, r.skipped].filter(Boolean).join(" ")}
        filters={[{ label: "Significant only", test: sig }]}
        note={tested < rows.length ? tested + " tested, " + (rows.length - tested) + " not" : undefined} />
      {v.note && <p className="note vfoot">{v.note}</p>}
    </div>
  );
}

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
                    data-tip={r.statistic != null ? r.test + " = " + r.statistic + ", df = " + r.df + (r.df2 != null ? ", " + r.df2 : "") + (r.minExpected != null ? ", smallest expected cell = " + r.minExpected : "") +
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
  category: "overview",
  title: "Clinical comparison",
  why: (_k, p) => p.viewAttrs().length ? null : "this study declares no clinical attributes to compare",
  loading: (_k, p) => p.attrsLoading(),
  defaults: (_k, p) => ({ kind: "clinical", attributes: p.viewAttrs() }),
  Card: ClinicalCard,
  // on a portal page, which draws no card of a kind's own: the portal's table
  body: (c) => c.v.clinical ? <ClinicalTableBody v={c.v} /> : null,
  drawsOwnHead: (v) => !!v.clinical,
};
