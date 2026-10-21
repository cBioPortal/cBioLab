"use client";
// A portal page's state is one ordinary analysis document — the page's cohorts and ALL its views —
// carried in the URL as the lab carries its own (?doc=), plus the open tab (?tab=). The tabs are
// the page's: each lists the indices of the views it shows, and opening one sends only that slice
// as an analysis request, so the engine never sees a tab or more views than one run computes.
// A setting changed on the page is an edit to that view in this document, so a shared link
// reproduces it.
import { useEffect, useState } from "react";
import type { AnalysisDoc, View } from "../../lib/types";

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

export interface PageTab { title: string; views?: number[]; sub?: { title: string; views: number[] }[]; chooser?: TabChooser; link?: TabLink }
export interface PageLayout {
  doc: AnalysisDoc;
  tabs: PageTab[];
  /** each view's title on the page, by index */
  titles: string[];
  /** tabs left out for this study, and why */
  left: string[];
}

/** any JSON value as a URL parameter (base64url) */
export function encodeParam(x: unknown): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(x)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** a URL parameter written by encodeParam; null when there is none or it does not decode */
export function decodeParam<T>(b64: string | null): T | null {
  if (!b64) return null;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))); }
  catch { return null; }
}
export const encodeDoc = (d: AnalysisDoc): string => encodeParam(d);
export const decodeDoc = (b64: string | null): AnalysisDoc | null => decodeParam<AnalysisDoc>(b64);

/**
 * The document a link carries, if it is this page's: the same cohorts and the same kinds of view
 * in the same places as the page lays out now. Otherwise null — the page was changed since the
 * link was made, or the link is another page's — and the page falls back to its defaults and
 * says so.
 */
export function compatible(linked: AnalysisDoc | null, fresh: AnalysisDoc): AnalysisDoc | null {
  if (!linked || !Array.isArray(linked.views)) return null;
  const a = linked.views, b = fresh.views || [];
  if (a.length !== b.length || a.some((v, i) => (v as View).kind !== b[i].kind)) return null;
  // the cohorts must be the page's own exactly: on a results page they ARE the genes asked for
  if (JSON.stringify(linked.cohorts || {}) !== JSON.stringify(fresh.cohorts || {})) return null;
  return { ...fresh, views: a };
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
export type TabSpec = { title: string; views?: { title: string; view: View }[]; sub?: { title: string; views: { title: string; view: View }[] }[]; chooser?: TabChooser; link?: TabLink };

/** The page's one document and the tabs' index maps, from the tabs as written. */
export function arrange(base: Omit<AnalysisDoc, "views">, spec: TabSpec[], left: string[]): PageLayout {
  const views: View[] = [], titles: string[] = [];
  const place = (vs: { title: string; view: View }[]) => vs.map((x) => { titles.push(x.title); return views.push(x.view) - 1; });
  const tabs: PageTab[] = spec.map((t) => t.sub
    ? { title: t.title, sub: t.sub.map((s) => ({ title: s.title, views: place(s.views) })) }
    : { title: t.title, views: place(t.views || []), ...(t.chooser ? { chooser: t.chooser } : {}), ...(t.link ? { link: t.link } : {}) });
  return { doc: { ...base, views }, tabs, titles, left };
}


/**
 * The page's document and open tab, kept in the URL: the link's document when it is this page's,
 * else the page's own defaults (and a note saying the link's could not be used).
 */
export function usePageDoc(fresh: PageLayout | null, linked: AnalysisDoc | null) {
  const [doc, setDoc] = useState<AnalysisDoc | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string>(() => { try { return new URLSearchParams(window.location.search).get("tab") || ""; } catch { return ""; } });
  const freshKey = fresh ? JSON.stringify(fresh.doc) : "";
  useEffect(() => {
    if (!fresh) return;
    const kept = compatible(linked, fresh.doc);
    setDoc(kept || fresh.doc);
    setNote(linked && linked.views && linked.views.length && !kept ? "the views in this link are not this page's own, so the page's are shown with their defaults" : null);
  }, [freshKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const update = (d: AnalysisDoc) => { setDoc(d); syncUrl({ doc: encodeDoc(d) }); };
  const openTab = (k: string) => { setOpen(k); syncUrl({ tab: k }); };
  return { doc, note, open, update, openTab };
}
