"use client";
// A cBioPortal-style page over ONE analysis document (app/portal/page-doc.ts): tabs (and a tab's
// sub-tabs) list the indices of the views they show; opening a tab sends each of its views as its
// own slice — {study, the cohorts the view uses, views: [it]} (tabSlice) — an ordinary analysis
// request each, side by side, so a quick view is drawn without waiting for a slow one beside it, kept until one of its views
// changes. A setting changed here is an edit to the document (onDoc), which the page writes to the
// URL; the oncoprint's display and sort are applied in the browser and never re-run anything.
import { ViewFigure } from "../lab/figure.tsx";
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc, AnalysisResult, View, ViewResult } from "../../lib/types";
import { HotspotsBody } from "../_lollipop/HotspotsBody.tsx";
import { KindCardBody, KindCardControls, hasKindCard, drawsOwnWaiting, figureView } from "../lab/kind-cards";
import { dataPart } from "../_oncoprint/view-display.ts";
import { OncoprintCard, type TrackCatalog } from "../_oncoprint/OncoprintCard.tsx";
import { tabSlice, type PageTab } from "./page-doc";
import { api } from "../lab/api.ts";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { LINE_TABS, PAGE_TAB, SEG_TAB, SEG_TABS } from "../_ui/toolbar.ts";
import { ViewHead } from "../lab/view-chrome.tsx";
import { Updating } from "../lab/view-cards.tsx";
import { PlotControls } from "../lab/plot-controls.tsx";
import { cn } from "../../lib/cn";

type Patch = Record<string, unknown>;


type ViewState = { sent: string; result?: ViewResult; error?: string; loading: boolean };

export function PortalTabs({ doc, tabs, titles, partial, open, onOpen, onDoc, onCounts, catalog, fixedPatient }: {
  doc: AnalysisDoc; tabs: PageTab[]; titles: string[];
  /** the page's first tabs only (PageLayout.partial): a tab the page opens on that is not among them yet is waited for */
  partial?: boolean;
  /** what the oncoprint's Tracks menu can offer: the study's attributes and profiles */
  catalog: TrackCatalog;
  /** the open tab, "Title" or "Title › Sub" */
  open: string;
  onOpen: (key: string) => void;
  /** the document after a setting changed on the page */
  onDoc: (d: AnalysisDoc) => void;
  /** the cohorts' sizes, once any tab has answered (the page header reports them) */
  onCounts?: (c: Record<string, number>) => void;
  /** the page is about one patient (the Patient page), so its patient views do not step through others */
  fixedPatient?: boolean;
}) {
  const [state, setState] = useState<Record<string, ViewState>>({});
  const gen = useRef<Record<string, number>>({});
  // which header menus are open, kept outside the cards so a re-render does not close them
  const menus = useRef(new Map<string, boolean>());
  const views = doc.views || [];

  const [mainTitle, subTitle] = open.split(" › ");
  const named = tabs.find((x) => x.title === mainTitle);
  // a tab the page has not laid out yet is waited for, not swapped for the first
  const waiting = partial && !!mainTitle && (!named || (!!subTitle && !!named.sub && !named.sub.some((x) => x.title === subTitle)));
  const tab = waiting ? undefined : named || tabs[0];
  const sub = tab?.sub ? tab.sub.find((x) => x.title === subTitle) || tab.sub[0] : null;
  const key = tab ? (sub ? tab.title + " › " + sub.title : tab.title) : "";
  const idx = (sub ? sub.views : tab?.views) || [];
  // each view's request, by the view's place on the page; what decides a re-run is the request
  // without what the oncoprint applies in the browser
  const asked = idx.map((vi) => {
    const slice = tabSlice(doc, [vi]);
    return { vi, at: key + " › " + titles[vi], slice,
      sent: JSON.stringify({ ...slice, views: (slice.views || []).map((v) => dataPart(v as unknown as Record<string, unknown>)) }) };
  });
  const sentAll = asked.map((a) => a.sent).join("\n");

  useEffect(() => {
    for (const { at, slice, sent } of asked) {
      if (state[at]?.sent === sent) continue;
      const g = (gen.current[at] || 0) + 1;
      gen.current[at] = g;
      setState((s) => ({ ...s, [at]: { ...s[at], sent, loading: true, error: undefined } }));
      // the oncoprint comes back as a spec the interactive figure draws; every other view as a figure
      api.analysis(slice, { query: "?oncoprint=spec" })
        .then((r) => r.json())
        .then((j) => {
          if (gen.current[at] !== g) return;
          setState((s) => ({ ...s, [at]: j.error ? { sent, loading: false, error: j.error } : { sent, loading: false, result: (j as AnalysisResult).views[0] } }));
          if (!j.error && onCounts) onCounts(Object.fromEntries(Object.entries(j.cohorts || {}).map(([n, c]) => [n, (c as { count: number }).count])));
        })
        .catch((e) => { if (gen.current[at] === g) setState((s) => ({ ...s, [at]: { sent, loading: false, error: String(e) } })); });
    }
  }, [key, sentAll]);   // eslint-disable-line react-hooks/exhaustive-deps

  // an edit to one view; a tab that keeps its views in step (its link) adjusts the others
  const edit = (i: number, next: View) => {
    const k = idx.indexOf(i), link = (sub ? undefined : tab?.link);
    if (!link || k < 0) return onDoc({ ...doc, views: views.map((v, j) => j === i ? next : v) });
    const mine = link(idx.map((j) => j === i ? next : views[j]), k);
    onDoc({ ...doc, views: views.map((v, j) => { const m = idx.indexOf(j); return m >= 0 ? mine[m] : v; }) });
  };
  const chooser = tab && !sub ? tab.chooser : undefined;
  const chooseFrom = (o: string) => {
    const next = chooser!.apply(idx.map((i) => views[i]), o);
    onDoc({ ...doc, views: views.map((v, j) => { const k = idx.indexOf(j); return k >= 0 ? next[k] : v; }) });
  };
  return (
    <div className="portal">
      <Tabs data-tw value={tab?.title ?? mainTitle ?? ""} onValueChange={onOpen} className="mb-4">
        <TabsList variant="line" aria-label="results tabs" className={LINE_TABS}>
          {tabs.map((t) => (
            <TabsTrigger key={t.title} value={t.title} className={PAGE_TAB}>
              {t.title}
            </TabsTrigger>
          ))}
          {waiting && <span data-tw className="skeleton my-auto block h-5 w-28" role="status" aria-label={"laying out " + open} />}
        </TabsList>
      </Tabs>
      {waiting && <div className="card viewcard viewloading" aria-busy="true"><div className="vhead"><span data-tw className="skeleton block h-[34px] w-56" /></div><div className="skeleton skeleton-view" /></div>}
      {(tab?.sub || chooser) && (
        <div className="viewtb mt-0 mb-4">
          {tab?.sub && (
            <div className="tbz">
              <Tabs value={sub?.title ?? ""} onValueChange={(v) => onOpen(tab.title + " › " + v)}>
                <TabsList aria-label={tab.title + " tabs"} className={SEG_TABS}>
                  {tab.sub.map((t) => (
                    <TabsTrigger key={t.title} value={t.title} className={SEG_TAB}>
                      {t.title}
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
      {tab?.pending && !sub && (
        <section className="card viewcard" aria-label={tab.title + " (not built yet)"}>
          <div className="vhead"><h2 className="vtitle">{tab.title}<span className="plain"> — not built yet</span></h2></div>
          <p className="note">{tab.pending}</p>
        </section>
      )}
      {idx.map((vi, i) => {
        const spec = views[vi] as unknown as Record<string, unknown>;
        // a result belongs to the request that produced it; while a newer one runs, the cover says so
        const { at, slice, sent } = asked[i];
        const st = state[at];
        const v = st?.result;
        // waiting from the render the edit lands in, not only once the effect has sent it
        const busy = !st || st.loading || st.sent !== sent;
        // vi and docJson name the view in the request it came from, which a table pages through
        const mc = { vi: 0, spec, v: v || {}, busy, updating: busy, attrs: [], profiles: [], assays: [], events: [], locked: tab?.chooser?.locks || [], fixedPatient,
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
          {busy && v && !(drawsOwnWaiting(v.kind) && !v.error) && <Updating />}
          {!busy && st?.error && <p className="note">{st.error}</p>}
          {v && v.error && <p className="note">{v.error}</p>}
          {v && !v.error && (body
            ? <>{body}{v.caveat && <p className="note vfoot">{v.caveat}</p>}</>
            : <ViewFigure v={figureView(spec, v)} />)}
        </>;
        return (
          <section key={at} className={cn("card viewcard", busy && !v && "viewloading")} aria-busy={busy || undefined}>
            <ViewHead menuStore={menus.current} v={v && !v.error ? v : { kind: spec.kind }} title={titles[vi]}
              sub={drawn.length ? drawn.join(drawn.length === 2 ? " vs " : ", ") : undefined} />
            {hasKindCard(spec.kind as string) && <KindCardControls c={mc} />}
            {spec.kind === "plot" && <PlotControls spec={spec} plot={v && !v.error && v.kind === "plot" ? v.plot : undefined} studies={v?.studies} attrs={catalog.attrs} catalog={catalog.profileCatalog || []}
              loading={catalog.loading} busy={busy} update={(fn) => edit(vi, fn(spec))}
              cohortOptions={Object.keys(doc.cohorts || {}).filter((n) => n !== drawn[0]).map((n) => ({ name: n, label: n, depth: 0 }))}>
              {figureArea}
            </PlotControls>}
            {spec.kind !== "plot" && figureArea}
          </section>
        );
      })}
    </div>
  );
}
