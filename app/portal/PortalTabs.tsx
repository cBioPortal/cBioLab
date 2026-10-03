"use client";
// A cBioPortal-style page: tabs, each a handful of views over cohorts the PAGE owns. A tab is one
// ordinary analysis request — {study, cohorts, views: that tab's} — sent the first time the tab is
// opened, and drawn by the shared server renderer (?figures=svg). The analysis engine knows nothing
// about pages or tabs; this component is the whole of the layout.
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc, AnalysisResult, CohortDef, View } from "../../lib/types";
import { MoreBody } from "../lab/more-views";

export interface PortalTab { title: string; views: { title: string; view: View }[] }

type TabState = { views: View[]; result?: AnalysisResult; error?: string; loading: boolean };

export function PortalTabs({ study, cohorts, tabs, left }: {
  study: string; cohorts: Record<string, CohortDef>; tabs: PortalTab[];
  /** tabs the page left out, and why */
  left: string[];
}) {
  const [open, setOpen] = useState(tabs[0]?.title || "");
  const [state, setState] = useState<Record<string, TabState>>({});
  const gen = useRef<Record<string, number>>({});
  const docFor = (views: View[]): AnalysisDoc => ({ study, cohorts, views });

  const load = (title: string, views: View[]) => {
    const g = (gen.current[title] || 0) + 1;
    gen.current[title] = g;
    setState((s) => ({ ...s, [title]: { ...s[title], views, loading: true, error: undefined } }));
    fetch("/api/analysis?figures=svg", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(docFor(views)) })
      .then((r) => r.json())
      .then((j) => {
        if (gen.current[title] !== g) return;
        setState((s) => ({ ...s, [title]: j.error ? { views, loading: false, error: j.error } : { views, loading: false, result: j } }));
      })
      .catch((e) => { if (gen.current[title] === g) setState((s) => ({ ...s, [title]: { views, loading: false, error: String(e) } })); });
  };

  // a tab is computed the first time it is opened, then kept
  useEffect(() => {
    const t = tabs.find((x) => x.title === open);
    if (t && !state[open]) load(open, t.views.map((v) => v.view));
  }, [open, tabs]);   // eslint-disable-line react-hooks/exhaustive-deps

  const counts = Object.values(state).find((s) => s.result)?.result?.cohorts;
  const tab = tabs.find((x) => x.title === open);
  const st = state[open];
  return (
    <div className="portal">
      <div className="portal-cohorts">
        {Object.keys(cohorts).map((n) => (
          <span key={n} className="pill">{n}{counts && counts[n] ? " · " + counts[n].count.toLocaleString() + " patients" : ""}</span>
        ))}
        {left.length > 0 && <span className="meta">left out: {left.join("; ")}</span>}
      </div>
      <div className="doctabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.title} role="tab" aria-selected={t.title === open} className={t.title === open ? "on" : undefined} onClick={() => setOpen(t.title)}>
            {t.title}{state[t.title]?.loading && <span className="spinner" />}
          </button>
        ))}
      </div>
      {tab && tab.views.map((entry, i) => {
        const v = st?.result?.views[i];
        const spec = st?.views[i] || entry.view;
        const body = v && !v.error ? MoreBody({ c: { vi: i, spec, v, busy: !!st?.loading, attrs: [], profiles: [], assays: [], events: [],
          patch: (p) => load(open, (st?.views || tab.views.map((x) => x.view)).map((x, j) => j === i ? { ...x, ...p } as View : x)),
          docJson: () => JSON.stringify(docFor(st?.views || tab.views.map((x) => x.view))) } }) : null;
        return (
          <section key={entry.title} className="card viewcard portal-view">
            <h3 className="vtitle">{entry.title}</h3>
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
