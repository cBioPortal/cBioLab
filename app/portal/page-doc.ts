"use client";
// A portal page's state is one ordinary analysis document — the page's cohorts and ALL its views —
// plus the open tab (?tab=). The tabs are the page's: each lists the indices of the views it shows,
// and opening one sends only that slice as an analysis request, so the engine never sees a tab or
// more views than one run computes. A setting changed on the page is an edit to that view in this
// document, and the URL carries how the views differ from the page's defaults (?changes=,
// page-changes.ts), each by the view's name, so a shared link reproduces it.
import { useEffect, useRef, useState } from "react";
import type { AnalysisDoc, View } from "../../lib/types";
import { encodeUrlJson, readUrlJson } from "../../lib/url-json.ts";
import { applyChanges, pageChanges, type PageChanges } from "./page-changes.ts";

/**
 * A control over a whole tab — the portal's gene chips over its Mutations tab: one choice that
 * every view in the tab follows. It reads the current choice from the tab's own views and writes a
 * new one into them, so the choice is part of the document (and the link) like any setting.
 */
export interface TabChooser {
  label: string; options: string[]; value: (views: View[]) => string; apply: (views: View[], value: string) => View[];
  /** the view settings the chooser sets, which the views' own settings bars therefore leave out */
  locks: string[];
}

/**
 * Keeps a tab's views in step — the Results page's lollipop grid and its mutation table: after an
 * edit to the tab's view `changed`, the tab's views as they should now be. The page does this; the
 * document only ever holds each view's own settings.
 */
export type TabLink = (views: View[], changed: number) => View[];

export interface PageTab {
  title: string; views?: number[]; sub?: { title: string; views: number[] }[]; chooser?: TabChooser; link?: TabLink;
  /** a tab whose view is not built yet: what it will show, which the page says in its place */
  pending?: string;
}
export interface PageLayout {
  doc: AnalysisDoc;
  tabs: PageTab[];
  /** each view's title on the page, by index */
  titles: string[];
  /** each view's name in a link's changes, by index: "Tab › View", or "Tab › Sub-tab › View" */
  names: string[];
  /** the page's first tabs only: what decides the rest is still being asked, and they follow */
  partial?: boolean;
  /** tabs left out for this study, and why */
  left: string[];
}

/** any JSON value as a URL parameter (lib/url-json.ts) */
export const encodeParam = (x: unknown): string => encodeUrlJson(x);
/** a URL parameter written by encodeParam; null when there is none or it does not decode */
export const decodeParam = <T,>(s: string | null): T | null => readUrlJson<T>(s);
export const encodeDoc = (d: AnalysisDoc): string => encodeParam(d);
export const decodeDoc = (s: string | null): AnalysisDoc | null => decodeParam<AnalysisDoc>(s);

/**
 * What opening a tab sends: its views, and only the page's cohorts they draw or name — a view
 * without its own `cohorts` draws them all, and a cohort a view names anywhere else (a plot's
 * points, an oncoprint's derived rows) or one a kept cohort extends comes along — so a tab is not
 * kept waiting on counting cohorts it never shows.
 */
export function tabSlice(doc: AnalysisDoc, idx: number[]): AnalysisDoc {
  const all = doc.cohorts || {};
  const views = idx.map((i) => (doc.views || [])[i]);
  const names = new Set<string>();
  const named = (x: unknown): void => {
    if (typeof x === "string") { if (Object.hasOwn(all, x)) names.add(x); }
    else if (Array.isArray(x)) x.forEach(named);
    else if (x && typeof x === "object") Object.values(x).forEach(named);
  };
  for (const v of views) {
    if (!Array.isArray((v as { cohorts?: unknown }).cohorts)) Object.keys(all).forEach((n) => names.add(n));
    named(v);
  }
  for (const n of [...names]) for (let p = all[n]?.extends; p && !names.has(p); p = all[p]?.extends) names.add(p);
  return { study: doc.study, cohorts: Object.fromEntries(Object.entries(all).filter(([n]) => names.has(n))), views };
}

/** the URL's state written back in place (no history entry per click, as the lab does) */
export function syncUrl(params: Record<string, string | null>) {
  try {
    const q = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(params)) { if (v == null) q.delete(k); else q.set(k, v); }
    history.replaceState(null, "", "?" + q.toString());
  } catch { /* URL state is a convenience, never a failure */ }
}

/** A page as written: its tabs, each with titled views (or sub-tabs of them). */
export type TabSpec = { title: string; views?: { title: string; view: View }[]; sub?: { title: string; views: { title: string; view: View }[] }[]; chooser?: TabChooser; link?: TabLink; pending?: string };

/** The page's one document and the tabs' index maps, from the tabs as written. */
export function arrange(base: Omit<AnalysisDoc, "views">, spec: TabSpec[], left: string[], opts: { partial?: boolean } = {}): PageLayout {
  const views: View[] = [], titles: string[] = [], names: string[] = [];
  const place = (where: string, vs: { title: string; view: View }[]) => vs.map((x) => {
    titles.push(x.title);
    let name = where + " › " + x.title;
    for (let n = 2; names.includes(name); n++) name = where + " › " + x.title + " " + n;
    names.push(name);
    return views.push(x.view) - 1;
  });
  const tabs: PageTab[] = spec.map((t) => t.sub
    ? { title: t.title, sub: t.sub.map((s) => ({ title: s.title, views: place(t.title + " › " + s.title, s.views) })) }
    : { title: t.title, views: place(t.title, t.views || []), ...(t.chooser ? { chooser: t.chooser } : {}), ...(t.link ? { link: t.link } : {}), ...(t.pending ? { pending: t.pending } : {}) });
  return { doc: { ...base, views }, tabs, titles, names, left, ...(opts.partial ? { partial: true } : {}) };
}


const param = (k: string): string | null => { try { return new URLSearchParams(window.location.search).get(k); } catch { return null; } };

/**
 * The page's document and open tab, kept in the URL: the page's defaults with the link's changes
 * made to them. A page laid out in two steps (`partial`) keeps the changes for views it does not
 * have yet, and applies them when they arrive; once the whole page is laid out, a change that
 * still names no view of it is reported. `input` is what of the link's ?doc= the page is built from
 * (the comparison page's cohorts), kept in the URL beside the changes.
 */
export function usePageDoc(fresh: PageLayout | null, input: AnalysisDoc | null = null) {
  const [doc, setDoc] = useState<AnalysisDoc | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string>(() => param("tab") || "");
  const [linked] = useState(() => readUrlJson<PageChanges>(param("changes")) || {});
  const changes = useRef<PageChanges>(linked);
  const freshKey = fresh ? JSON.stringify(fresh.doc) + (fresh.partial ? "…" : "") : "";
  useEffect(() => {
    if (!fresh) return;
    const { views, missed } = applyChanges(fresh.names, fresh.doc.views || [], changes.current);
    setDoc({ ...fresh.doc, views });
    setNote(missed.length && !fresh.partial
      ? "this link's settings for " + missed.join(", ") + " do not apply to this page as it is now, so " + (missed.length === 1 ? "that view shows its" : "those views show their") + " defaults"
      : null);
  }, [freshKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const update = (d: AnalysisDoc) => {
    setDoc(d);
    if (!fresh) return;
    // changes for views the page has not laid out yet are kept until it has
    const waiting = fresh.partial ? Object.fromEntries(Object.entries(changes.current).filter(([n]) => !fresh.names.includes(n))) : {};
    const c = { ...waiting, ...pageChanges(fresh.names, fresh.doc.views || [], d.views || []) };
    changes.current = c;
    syncUrl({ changes: Object.keys(c).length ? encodeUrlJson(c) : null, doc: input ? encodeDoc(input) : null });
  };
  const openTab = (k: string) => { setOpen(k); syncUrl({ tab: k }); };
  return { doc, note, open, update, openTab };
}
