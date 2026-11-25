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
import type { LollipopRows } from "../../lib/federation.ts";
import type { CodonSelection } from "../../lib/lollipop.ts";
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
import { legacyLink, type LegacyPage, type PortalHold } from "../../lib/legacy-link.ts";
import { LegacyLinkButton } from "./portal-chrome.tsx";
import { Button } from "../_ui/button.tsx";
import { LegacyComparisonButton } from "./legacy-comparison-button.tsx";

type Patch = Record<string, unknown>;


type ViewState = { sent: string; result?: ViewResult; error?: string; loading: boolean };

export function PortalTabs({ doc, tabs, titles, partial, open, onOpen, onDoc, onCounts, catalog, fixedPatient, sampleOrder, legacy }: {
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
  /** the patient's samples in the page's order (the header's numbered markers) */
  sampleOrder?: readonly string[];
  /** the page's state for its "Open in cBioPortal" link, and whether the portal holds its studies (null while the study list loads) */
  legacy: { page: LegacyPage; held: Record<string, PortalHold> | null };
}) {
  const [state, setState] = useState<Record<string, ViewState>>({});
  // the chooser's options with nothing to show, greyed (the Mutations tab's gene chips, MUT-GT-2), keyed by the request that found them
  const [greyed, setGreyed] = useState<{ sent: string; options: string[] } | null>(null);
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
  // the chooser's own check, beside the tab's views: one request over every option, its answer only greys chips
  const emptySlice = chooser?.empties && idx.length ? { ...tabSlice(doc, [idx[0]]), views: [chooser.empties.view(idx.map((i) => views[i]))] } : null;
  const emptySent = emptySlice ? JSON.stringify(emptySlice) : "";
  useEffect(() => {
    if (!emptySlice || !chooser?.empties) return;
    const ctl = new AbortController();
    api.analysis(emptySlice, { signal: ctl.signal, query: "?oncoprint=spec" })
      .then((r) => r.json())
      .then((j) => { const v = j?.views?.[0]; if (!j.error && v && !v.error) setGreyed({ sent: emptySent, options: chooser.empties!.empty(v) }); })
      .catch(() => { /* no answer: no chip greyed, as before */ });
    return () => ctl.abort();
  }, [emptySent]);   // eslint-disable-line react-hooks/exhaustive-deps -- the request, by value
  const grey = new Set(greyed && greyed.sent === emptySent ? greyed.options : []);
  const chooseFrom = (o: string) => {
    const next = chooser!.apply(idx.map((i) => views[i]), o);
    onDoc({ ...doc, views: views.map((v, j) => { const k = idx.indexOf(j); return k >= 0 ? next[k] : v; }) });
  };
  // the tab's status line and its switch (the Mutations tab's OQL banner)
  const banner = tab && !sub ? tab.banner : undefined;
  const mine = idx.map((i) => views[i]);
  const bannerText = banner ? banner.text(mine) : null;
  const bannerToggle = banner?.toggle ? banner.toggle.label(mine) : null;
  const toggleBanner = () => {
    const next = banner!.toggle!.apply(mine);
    onDoc({ ...doc, views: views.map((v, j) => { const k = idx.indexOf(j); return k >= 0 ? next[k] : v; }) });
  };
  const link = legacy.held ? legacyLink(legacy.page, { tab: tab?.title ?? mainTitle, sub: sub?.title ?? subTitle, gene: chooser?.value(idx.map((i) => views[i])) }, legacy.held) : null;
  return (
    <div className="portal">
      <div data-tw className="mb-4 flex items-end gap-2.5 border-b">
      <Tabs value={tab?.title ?? mainTitle ?? ""} onValueChange={onOpen} className="min-w-0 flex-1">
        <TabsList variant="line" aria-label="results tabs" className={cn(LINE_TABS, "border-b-0")}>
          {tabs.map((t) => (
            <TabsTrigger key={t.title} value={t.title} className={PAGE_TAB}>
              {t.title}
              {t.badge && <span className="ml-1 font-semibold !text-[var(--warn,#b45309)]">{t.badge}</span>}
            </TabsTrigger>
          ))}
          {waiting && <span data-tw className="skeleton my-auto block h-5 w-28" role="status" aria-label={"laying out " + open} />}
        </TabsList>
      </Tabs>
      {legacy.page.page === "comparison" ? <LegacyComparisonButton study={legacy.page.study} cohorts={doc.cohorts || {}} tab={tab?.title ?? mainTitle} held={legacy.held} className="mb-1.5" /> : <LegacyLinkButton link={link} className="mb-1.5" />}
      </div>
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
                  {chooser.options.map((o) => <TabsTrigger key={o} value={o} className={cn(SEG_TAB, "font-mono", grey.has(o) && "text-[#bbb]")}
                    data-tip={grey.has(o) ? "no " + o + " mutations in this query" : undefined} data-empty={grey.has(o) ? "1" : undefined}>{o}</TabsTrigger>)}
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>
      )}
      {banner && bannerText && (
        <p className="note mb-3 flex flex-wrap items-center gap-2" data-test="tabBanner">
          <span>{bannerText}</span>
          {banner.toggle && bannerToggle && <Button variant="outline" size="sm" onClick={toggleBanner}>{bannerToggle}</Button>}
        </p>
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
        const mc = { vi: 0, spec, v: v || {}, busy, updating: busy, attrs: [], profiles: [], assays: [], catalog: catalog.profileCatalog || [], events: [], locked: [...(tab?.chooser?.locks || []), ...(tab?.locks || [])], fixedPatient, sampleOrder,
          patch: (p: Patch) => edit(vi, { ...spec, ...p } as unknown as View), docJson: () => JSON.stringify(slice) };
        const body = v && !v.error && v.kind === "hotspots" && v.hotspots
          ? <HotspotsBody v={v} hide={spec.hide as string[] | undefined} onHide={(h) => edit(vi, { ...spec, hide: h } as unknown as View)}
              codons={spec.codons as CodonSelection | undefined} onCodons={(c) => edit(vi, { ...spec, codons: c } as unknown as View)}
              yMax={spec.yMax as Record<string, number> | undefined} onYMax={(y) => edit(vi, { ...spec, yMax: y } as unknown as View)}
              table={spec.table as LollipopRows | undefined} onTable={(t) => edit(vi, { ...spec, table: t } as unknown as View)} />
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
