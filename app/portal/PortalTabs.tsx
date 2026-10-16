"use client";
// A cBioPortal-style page over ONE analysis document (app/portal/page-doc.ts): tabs (and a tab's
// sub-tabs) list the indices of the views they show; opening a tab sends that slice —
// {study, cohorts, views: the tab's} — as an ordinary analysis request, kept until one of its views
// changes. A setting changed here is an edit to the document (onDoc), which the page writes to the
// URL; the oncoprint's display and sort are applied in the browser and never re-run anything.
import { ViewFigure } from "../lab/figure.tsx";
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc, AnalysisResult, View } from "../../lib/types";
import { HotspotsBody } from "../_lollipop/HotspotsBody.tsx";
import { KindCardBody, KindCardControls, hasKindCard, drawsOwnWaiting, figureView } from "../lab/kind-cards";
import { dataPart } from "../_oncoprint/view-display.ts";
import { OncoprintCard, type TrackCatalog } from "../_oncoprint/OncoprintCard.tsx";
import type { PageTab } from "./page-doc";
import { api } from "../lab/api.ts";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { LINE_TABS, PAGE_TAB, SEG_TAB, SEG_TABS } from "../_ui/toolbar.ts";
import { ViewHead } from "../lab/view-chrome.tsx";
import { PlotControls } from "../lab/plot-controls.tsx";
import { cn } from "../../lib/cn";

type Patch = Record<string, unknown>;


type TabState = { sent: string; result?: AnalysisResult; error?: string; loading: boolean };

export function PortalTabs({ doc, tabs, titles, open, onOpen, onDoc, onCounts, catalog }: {
  doc: AnalysisDoc; tabs: PageTab[]; titles: string[];
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
  // which header menus are open, kept outside the cards so a re-render does not close them
  const menus = useRef(new Map<string, boolean>());
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
    api.analysis(slice, { query: "?oncoprint=spec" })
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
  const st = state[key];
  const spinning = (k: string) => Object.entries(state).some(([x, s]) => (x === k || x.startsWith(k + " › ")) && s.loading);
  const chooser = tab && !sub ? tab.chooser : undefined;
  const chooseFrom = (o: string) => {
    const next = chooser!.apply(idx.map((i) => views[i]), o);
    onDoc({ ...doc, views: views.map((v, j) => { const k = idx.indexOf(j); return k >= 0 ? next[k] : v; }) });
  };
  return (
    <div className="portal">
      <Tabs data-tw value={tab?.title ?? ""} onValueChange={onOpen} className="mb-4">
        <TabsList variant="line" aria-label="results tabs" className={LINE_TABS}>
          {tabs.map((t) => (
            <TabsTrigger key={t.title} value={t.title} className={PAGE_TAB}>
              {t.title}{spinning(t.title) && <span className="spinner" />}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {(tab?.sub || chooser) && (
        <div className="viewtb mt-0 mb-4">
          {tab?.sub && (
            <div className="tbz">
              <Tabs value={sub?.title ?? ""} onValueChange={(v) => onOpen(tab.title + " › " + v)}>
                <TabsList aria-label={tab.title + " tabs"} className={SEG_TABS}>
                  {tab.sub.map((t) => (
                    <TabsTrigger key={t.title} value={t.title} className={SEG_TAB}>
                      {t.title}{spinning(tab.title + " › " + t.title) && <span className="spinner" />}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}
          {chooser && (
            <div className="tbz"><span className="tbl">{chooser.label}</span>
              <Tabs value={chooser.value(idx.map((i) => views[i]))} onValueChange={chooseFrom}>
                <TabsList aria-label={chooser.label} className={SEG_TABS}>
                  {chooser.options.map((o) => <TabsTrigger key={o} value={o} className={cn(SEG_TAB, "font-mono")}>{o}</TabsTrigger>)}
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>
      )}
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
        const drawn = Array.isArray(spec.cohorts) ? (spec.cohorts as string[]) : Object.keys(doc.cohorts || {});
        // the figure and what covers it while it waits; a plot holds it beside its axis sidebar
        const figureArea = <>
          {busy && !v && <div className="skeleton skeleton-view" />}
          {busy && v && !(drawsOwnWaiting(v.kind) && !v.error) && <div className="view-updating"><span className="spinner" /> updating…</div>}
          {!busy && st?.error && <p className="note">{st.error}</p>}
          {v && v.error && <p className="note">{v.error}</p>}
          {v && !v.error && (body
            ? <>{body}{v.caveat && <p className="note vfoot">{v.caveat}</p>}</>
            : <ViewFigure v={figureView(spec, v)} />)}
        </>;
        return (
          <section key={key + vi} className={cn("card viewcard", busy && !v && "viewloading")} aria-busy={busy || undefined}>
            <ViewHead menuStore={menus.current} v={v && !v.error ? v : { kind: spec.kind }} title={titles[vi]}
              sub={drawn.length ? drawn.join(drawn.length === 2 ? " vs " : ", ") : undefined} />
            {hasKindCard(spec.kind as string) && <KindCardControls c={mc} />}
            {spec.kind === "plot" && <PlotControls spec={spec} plot={v && !v.error ? v.plot : undefined} attrs={catalog.attrs} profiles={catalog.profiles}
              loading={catalog.loading} busy={busy} update={(fn) => edit(vi, fn(spec))}
              highlightOptions={Object.keys(doc.cohorts || {}).filter((n) => n !== drawn[0]).map((n) => ({ name: n, label: n, depth: 0 }))}>
              {figureArea}
            </PlotControls>}
            {spec.kind !== "plot" && figureArea}
          </section>
        );
      })}
    </div>
  );
}
