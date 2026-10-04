"use client";
// A cBioPortal-style page over ONE analysis document (app/portal/page-doc.ts): tabs (and a tab's
// sub-tabs) list the indices of the views they show; opening a tab sends that slice —
// {study, cohorts, views: the tab's} — as an ordinary analysis request, kept until one of its views
// changes. A setting changed here is an edit to the document (onDoc), which the page writes to the
// URL; the oncoprint's display and sort are applied in the browser and never re-run anything.
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc, AnalysisResult, View } from "../../lib/types";
import { SERIES } from "../../lib/svg-kit";
import { MoreBody, MoreControls, isMoreKind } from "../lab/more-views";
import { dataPart } from "../_oncoprint/view-display.ts";
import { OncoprintCard, type TrackCatalog } from "../_oncoprint/OncoprintCard.tsx";
import type { PageTab } from "./page-doc";

type Patch = Record<string, unknown>;


type TabState = { sent: string; result?: AnalysisResult; error?: string; loading: boolean };

export function PortalTabs({ doc, tabs, titles, left, open, onOpen, onDoc, onCounts, catalog }: {
  doc: AnalysisDoc; tabs: PageTab[]; titles: string[]; left: string[];
  /** what the oncoprint's Tracks menu can offer: the study's attributes and profiles */
  catalog: TrackCatalog;
  /** the open tab, "Title" or "Title › Sub" */
  open: string;
  onOpen: (key: string) => void;
  /** the document after a setting changed on the page */
  onDoc: (d: AnalysisDoc) => void;
  /** the cohorts' sizes, once any tab has answered (the page header reports them) */
  onCounts?: (c: Record<string, number>) => void;
}) {
  const [state, setState] = useState<Record<string, TabState>>({});
  const gen = useRef<Record<string, number>>({});
  const views = doc.views || [];

  const [mainTitle, subTitle] = open.split(" › ");
  const tab = tabs.find((x) => x.title === mainTitle) || tabs[0];
  const sub = tab?.sub ? tab.sub.find((x) => x.title === subTitle) || tab.sub[0] : null;
  const key = tab ? (sub ? tab.title + " › " + sub.title : tab.title) : "";
  const idx = (sub ? sub.views : tab?.views) || [];
  const slice: AnalysisDoc = { study: doc.study, cohorts: doc.cohorts, views: idx.map((i) => views[i]) };
  // what decides a re-run: the slice without what the oncoprint applies in the browser
  const sent = JSON.stringify({ ...slice, views: (slice.views || []).map((v) => dataPart(v as unknown as Record<string, unknown>)) });

  useEffect(() => {
    if (!idx.length || state[key]?.sent === sent) return;
    const g = (gen.current[key] || 0) + 1;
    gen.current[key] = g;
    setState((s) => ({ ...s, [key]: { ...s[key], sent, loading: true, error: undefined } }));
    // the oncoprint comes back as a spec the interactive figure draws; every other view as a figure
    fetch("/api/analysis?oncoprint=spec&figures=svg", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(slice) })
      .then((r) => r.json())
      .then((j) => {
        if (gen.current[key] !== g) return;
        setState((s) => ({ ...s, [key]: j.error ? { sent, loading: false, error: j.error } : { sent, loading: false, result: j } }));
        if (!j.error && onCounts) onCounts(Object.fromEntries(Object.entries(j.cohorts || {}).map(([n, c]) => [n, (c as { count: number }).count])));
      })
      .catch((e) => { if (gen.current[key] === g) setState((s) => ({ ...s, [key]: { sent, loading: false, error: String(e) } })); });
  }, [key, sent]);   // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (i: number, next: View) => onDoc({ ...doc, views: views.map((v, j) => j === i ? next : v) });
  const counts = Object.values(state).find((s) => s.result)?.result?.cohorts;
  const st = state[key];
  const spinning = (k: string) => Object.entries(state).some(([x, s]) => (x === k || x.startsWith(k + " › ")) && s.loading);
  return (
    <div className="portal">
      <div className="portal-cohorts">
        <strong className="meta">Groups:</strong>
        {Object.keys(doc.cohorts || {}).map((n, i) => (
          <span key={n} className="portal-group" style={{ background: SERIES[i % SERIES.length] }}>{n}{counts && counts[n] ? " (" + counts[n].count.toLocaleString() + ")" : ""}</span>
        ))}
        {left.length > 0 && <span className="meta">left out: {left.join("; ")}</span>}
      </div>
      <div className="doctabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.title} role="tab" aria-selected={t === tab} className={t === tab ? "on" : undefined} onClick={() => onOpen(t.title)}>
            {t.title}{spinning(t.title) && <span className="spinner" />}
          </button>
        ))}
      </div>
      {tab?.sub && (
        <div className="doctabs doctabs-sub" role="tablist">
          {tab.sub.map((t) => (
            <button key={t.title} role="tab" aria-selected={t === sub} className={t === sub ? "on" : undefined} onClick={() => onOpen(tab.title + " › " + t.title)}>
              {t.title}{spinning(tab.title + " › " + t.title) && <span className="spinner" />}
            </button>
          ))}
        </div>
      )}
      {idx.map((vi, i) => {
        const spec = views[vi] as unknown as Record<string, unknown>;
        // a result belongs to the request that produced it; while a newer one runs, the cover says so
        const v = st?.result?.views[i];
        const busy = !!st?.loading;
        const mc = { vi: i, spec, v: v || {}, busy, attrs: [], profiles: [], assays: [], events: [],
          patch: (p: Patch) => edit(vi, { ...spec, ...p } as unknown as View), docJson: () => JSON.stringify(slice) };
        const body = v && !v.error && v.kind === "oncoprint" && v.spec
          // the lab's own oncoprint card; the page's cohorts are its own, so a drag counts but makes no cohort
          ? <OncoprintCard view={spec} spec={v.spec} busy={busy} cohortNames={Object.keys(doc.cohorts || {})} catalog={catalog}
              onView={(n) => edit(vi, n as unknown as View)} note={v.note} studies={v.studies} />
          : v && !v.error ? MoreBody({ c: { ...mc, v } }) : null;
        return (
          <section key={key + vi} className="card viewcard portal-view">
            {idx.length > 1 && <h3 className="vtitle">{titles[vi]}</h3>}
            {isMoreKind(spec.kind) && <MoreControls c={mc} />}
            {busy && !v && <div className="skeleton skeleton-view" />}
            {busy && v && <div className="view-updating"><span className="spinner" /> updating…</div>}
            {!busy && st?.error && <p className="note">{st.error}</p>}
            {v && v.error && <p className="note">{v.error}</p>}
            {v && !v.error && (body
              ? <>{body}{v.caveat && <p className="note vfoot">{v.caveat}</p>}</>
              : v.svg ? <div className="viewfig" dangerouslySetInnerHTML={{ __html: v.svg }} /> : <p className="note">nothing to draw</p>)}
          </section>
        );
      })}
    </div>
  );
}
