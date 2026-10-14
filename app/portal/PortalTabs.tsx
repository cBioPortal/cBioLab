"use client";
// A cBioPortal-style page over ONE analysis document (app/portal/page-doc.ts): tabs (and a tab's
// sub-tabs) list the indices of the views they show; opening a tab sends that slice —
// {study, cohorts, views: the tab's} — as an ordinary analysis request, kept until one of its views
// changes. A setting changed here is an edit to the document (onDoc), which the page writes to the
// URL; the oncoprint's display and sort are applied in the browser and never re-run anything.
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc, AnalysisResult, View } from "../../lib/types";
import { SERIES } from "../../lib/svg-kit";
import { HotspotsBody } from "../_lollipop/HotspotsBody.tsx";
import { KindCardBody, KindCardControls, hasKindCard, drawsOwnWaiting } from "../lab/kind-cards";
import { dataPart } from "../_oncoprint/view-display.ts";
import { OncoprintCard, type TrackCatalog } from "../_oncoprint/OncoprintCard.tsx";
import type { PageTab } from "./page-doc";
import { api } from "../lab/api.ts";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { LINE_TAB, LINE_TABS, SEG_TAB, SEG_TABS } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";

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
    api.analysis(slice, { query: "?oncoprint=spec&figures=svg" })
      .then((r) => r.json())
      .then((j) => {
        if (gen.current[key] !== g) return;
        setState((s) => ({ ...s, [key]: j.error ? { sent, loading: false, error: j.error } : { sent, loading: false, result: j } }));
        if (!j.error && onCounts) onCounts(Object.fromEntries(Object.entries(j.cohorts || {}).map(([n, c]) => [n, (c as { count: number }).count])));
      })
      .catch((e) => { if (gen.current[key] === g) setState((s) => ({ ...s, [key]: { sent, loading: false, error: String(e) } })); });
  }, [key, sent]);   // eslint-disable-line react-hooks/exhaustive-deps

  // an edit to one view; a tab that keeps its views in step (its link) adjusts the others
  const edit = (i: number, next: View) => {
    const k = idx.indexOf(i), link = (sub ? undefined : tab?.link);
    if (!link || k < 0) return onDoc({ ...doc, views: views.map((v, j) => j === i ? next : v) });
    const mine = link(idx.map((j) => j === i ? next : views[j]), k);
    onDoc({ ...doc, views: views.map((v, j) => { const m = idx.indexOf(j); return m >= 0 ? mine[m] : v; }) });
  };
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
      <Tabs value={tab?.title ?? ""} onValueChange={onOpen} className="my-3">
        <TabsList variant="line" aria-label="results tabs" className={LINE_TABS}>
          {tabs.map((t) => (
            <TabsTrigger key={t.title} value={t.title} className={LINE_TAB}>
              {t.title}{spinning(t.title) && <span className="spinner" />}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab?.sub && (
        <Tabs value={sub?.title ?? ""} onValueChange={(v) => onOpen(tab.title + " › " + v)} className="-mt-1 mb-3">
          <TabsList variant="line" aria-label={tab.title + " tabs"} className={LINE_TABS}>
            {tab.sub.map((t) => (
              <TabsTrigger key={t.title} value={t.title} className={cn(LINE_TAB, "px-2.5 pt-1 pb-1 text-sm")}>
                {t.title}{spinning(tab.title + " › " + t.title) && <span className="spinner" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {tab && !sub && tab.chooser && (() => {
        const ch = tab.chooser, mine = idx.map((i) => views[i]), on = ch.value(mine);
        return (
          <div className="portal-chooser">
            <span className="meta">{ch.label}</span>
            <Tabs value={on} onValueChange={(o) => { const next = ch.apply(mine, o); onDoc({ ...doc, views: views.map((v, j) => { const k = idx.indexOf(j); return k >= 0 ? next[k] : v; }) }); }}>
              <TabsList aria-label={ch.label} className={SEG_TABS}>
                {ch.options.map((o) => <TabsTrigger key={o} value={o} className={SEG_TAB}>{o}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          </div>
        );
      })()}
      {idx.map((vi, i) => {
        const spec = views[vi] as unknown as Record<string, unknown>;
        // a result belongs to the request that produced it; while a newer one runs, the cover says so
        const v = st?.result?.views[i];
        const busy = !!st?.loading;
        const mc = { vi: i, spec, v: v || {}, busy, updating: busy, attrs: [], profiles: [], assays: [], events: [], locked: tab?.chooser?.locks || [],
          patch: (p: Patch) => edit(vi, { ...spec, ...p } as unknown as View), docJson: () => JSON.stringify(slice) };
        const body = v && !v.error && v.kind === "hotspots" && v.hotspots
          ? <HotspotsBody v={v} hide={spec.hide as string[] | undefined} onHide={(h) => edit(vi, { ...spec, hide: h } as unknown as View)} />
          : v && !v.error && v.kind === "oncoprint" && v.spec
          // the lab's own oncoprint card; the page's cohorts are its own, so a drag counts but makes no cohort
          ? <OncoprintCard view={spec} spec={v.spec} uploads={doc.uploads} busy={busy} cohortNames={Object.keys(doc.cohorts || {})} catalog={catalog}
              onView={(n) => edit(vi, n as unknown as View)} note={v.note} studies={v.studies} />
          : v && !v.error ? KindCardBody({ c: { ...mc, v } }) : null;
        return (
          <section key={key + vi} className="card viewcard portal-view">
            {idx.length > 1 && <h3 className="vtitle">{titles[vi]}</h3>}
            {hasKindCard(spec.kind) && <KindCardControls c={mc} />}
            {busy && !v && <div className="skeleton skeleton-view" />}
            {busy && v && !(drawsOwnWaiting(v.kind) && !v.error) && <div className="view-updating"><span className="spinner" /> updating…</div>}
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
