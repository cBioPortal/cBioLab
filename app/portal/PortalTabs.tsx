"use client";
// A cBioPortal-style page: tabs (and a tab's sub-tabs), each a handful of views over cohorts the
// PAGE owns. A tab is one ordinary analysis request — {study, cohorts, views: that tab's} — sent the
// first time the tab is opened, and drawn by the shared server renderer (?figures=svg) or, for the
// views that reproduce a portal tab, by its portal-style body. The analysis engine knows nothing
// about pages or tabs; this component is the whole of the layout.
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc, AnalysisResult, CohortDef, View } from "../../lib/types";
import { SERIES } from "../../lib/svg-kit";
import { MoreBody } from "../lab/more-views";
import OncoprintFigure, { DEFAULT_FIGURE_DISPLAY, type FigureDisplay } from "../_oncoprint/OncoprintFigure.tsx";

/**
 * The interactive oncoprint, as the lab draws it: zoom, sort, the viewing options and a drag to
 * count columns. How it is viewed is this page's (browser state); a setting that changes the
 * numbers — patients or samples as columns, drivers only — re-runs the tab.
 */
function PortalOncoprint({ spec, view, busy, patch }: { spec: unknown; view: Record<string, unknown>; busy: boolean; patch: (p: Record<string, unknown>) => void }) {
  const [display, setDisplay] = useState<FigureDisplay>(DEFAULT_FIGURE_DISPLAY);
  const [sortKeys, setSortKeys] = useState<string[]>([]);
  const d = (view.display || {}) as { hideVUS?: boolean };
  return (
    <OncoprintFigure spec={spec} display={display} onDisplay={setDisplay} sortKeys={sortKeys} onSortKeys={setSortKeys} busy={busy}
      controls={<>
        <label className="tbfield" title="a cohort selects patients; sample mode draws every sample of those patients">columns <select
          value={view.unit === "sample" ? "sample" : "patient"} disabled={busy} onChange={(e) => patch({ unit: e.target.value === "sample" ? "sample" : undefined })}>
          <option value="patient">patients</option><option value="sample">samples</option>
        </select></label>
        <label className="chk tbchk" title="drop alterations the annotation source does not call drivers — this changes the percentages too, so it re-runs">
          <input type="checkbox" checked={!!d.hideVUS} disabled={busy}
            onChange={(e) => patch({ display: { ...(view.display as object || {}), hideVUS: e.target.checked || undefined } })} /> drivers only</label>
      </>} />
  );
}

export interface PortalTab { title: string; views?: { title: string; view: View }[]; sub?: { title: string; views: { title: string; view: View }[] }[] }

type TabState = { views: View[]; result?: AnalysisResult; error?: string; loading: boolean };

export function PortalTabs({ study, cohorts, tabs, left, onCounts }: {
  study: string; cohorts: Record<string, CohortDef>; tabs: PortalTab[];
  /** tabs the page left out, and why */
  left: string[];
  /** the cohorts' sizes, once any tab has answered (the page header reports them) */
  onCounts?: (c: Record<string, number>) => void;
}) {
  const [open, setOpen] = useState(tabs[0]?.title || "");
  const [subOpen, setSubOpen] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, TabState>>({});
  const gen = useRef<Record<string, number>>({});
  const docFor = (views: View[]): AnalysisDoc => ({ study, cohorts, views });

  const tab = tabs.find((x) => x.title === open);
  const sub = tab?.sub ? tab.sub.find((x) => x.title === subOpen[open]) || tab.sub[0] : null;
  const key = sub ? open + " › " + sub.title : open;
  const entries = (sub ? sub.views : tab?.views) || [];

  const load = (k: string, views: View[]) => {
    const g = (gen.current[k] || 0) + 1;
    gen.current[k] = g;
    setState((s) => ({ ...s, [k]: { ...s[k], views, loading: true, error: undefined } }));
    // the oncoprint comes back as a spec the interactive figure draws; every other view as a figure
    fetch("/api/analysis?oncoprint=spec&figures=svg", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(docFor(views)) })
      .then((r) => r.json())
      .then((j) => {
        if (gen.current[k] !== g) return;
        setState((s) => ({ ...s, [k]: j.error ? { views, loading: false, error: j.error } : { views, loading: false, result: j } }));
        if (!j.error && onCounts) onCounts(Object.fromEntries(Object.entries(j.cohorts || {}).map(([n, c]) => [n, (c as { count: number }).count])));
      })
      .catch((e) => { if (gen.current[k] === g) setState((s) => ({ ...s, [k]: { views, loading: false, error: String(e) } })); });
  };

  // a tab is computed the first time it is opened, then kept
  useEffect(() => { if (entries.length && !state[key]) load(key, entries.map((v) => v.view)); }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  const counts = Object.values(state).find((s) => s.result)?.result?.cohorts;
  const st = state[key];
  const spinning = (k: string) => Object.entries(state).some(([x, s]) => (x === k || x.startsWith(k + " › ")) && s.loading);
  return (
    <div className="portal">
      <div className="portal-cohorts">
        <strong className="meta">Groups:</strong>
        {Object.keys(cohorts).map((n, i) => (
          <span key={n} className="portal-group" style={{ background: SERIES[i % SERIES.length] }}>{n}{counts && counts[n] ? " (" + counts[n].count.toLocaleString() + ")" : ""}</span>
        ))}
        {left.length > 0 && <span className="meta">left out: {left.join("; ")}</span>}
      </div>
      <div className="doctabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.title} role="tab" aria-selected={t.title === open} className={t.title === open ? "on" : undefined} onClick={() => setOpen(t.title)}>
            {t.title}{spinning(t.title) && <span className="spinner" />}
          </button>
        ))}
      </div>
      {tab?.sub && (
        <div className="doctabs doctabs-sub" role="tablist">
          {tab.sub.map((t) => (
            <button key={t.title} role="tab" aria-selected={t === sub} className={t === sub ? "on" : undefined} onClick={() => setSubOpen((s) => ({ ...s, [open]: t.title }))}>
              {t.title}{spinning(open + " › " + t.title) && <span className="spinner" />}
            </button>
          ))}
        </div>
      )}
      {entries.map((entry, i) => {
        const v = st?.result?.views[i];
        const spec = st?.views[i] || entry.view;
        const patchView = (p: Record<string, unknown>) => load(key, (st?.views || entries.map((x) => x.view)).map((x, j) => j === i ? { ...x, ...p } as View : x));
        const body = v && !v.error && v.kind === "oncoprint" && v.spec
          ? <PortalOncoprint spec={v.spec} view={spec as unknown as Record<string, unknown>} busy={!!st?.loading} patch={patchView} />
          : v && !v.error ? MoreBody({ c: { vi: i, spec, v, busy: !!st?.loading, attrs: [], profiles: [], assays: [], events: [],
          patch: (p) => load(key, (st?.views || entries.map((x) => x.view)).map((x, j) => j === i ? { ...x, ...p } as View : x)),
          docJson: () => JSON.stringify(docFor(st?.views || entries.map((x) => x.view))) } }) : null;
        return (
          <section key={key + entry.title} className="card viewcard portal-view">
            {entries.length > 1 && <h3 className="vtitle">{entry.title}</h3>}
            {st?.loading && <div className="skeleton skeleton-view" />}
            {!st?.loading && st?.error && <p className="note">{st.error}</p>}
            {!st?.loading && v && v.error && <p className="note">{v.error}</p>}
            {!st?.loading && v && !v.error && (body
              ? <>{body}{v.caveat && <p className="note vfoot">{v.caveat}</p>}</>
              : v.svg ? <div className="viewfig" dangerouslySetInnerHTML={{ __html: v.svg }} /> : <p className="note">nothing to draw</p>)}
          </section>
        );
      })}
    </div>
  );
}
