"use client";
// The portal pages' WebMCP tools (patient, sample, query results, group comparison): read what the
// page shows, and open one of its tabs. Read-only for now — a portal page's state is one analysis
// document (page-doc.ts), so editing it can follow /lab's validate-then-commit tools.
//
// The three pages share this module: each passes a bridge naming the page, what it is about, and
// its page-doc state. The bridge is refreshed on every render, so a tool reads the page as it is
// now. A tab's numbers are asked of the engine the way the page asks (one request over the tab's
// views) and described by the same text every other agent surface uses (lib/result-text.ts).
import { useEffect, useRef } from "react";
import { exposeTools, type AgentTool } from "../../lib/webmcp.ts";
import { analysisText } from "../../lib/result-text.ts";
import type { AnalysisDoc, AnalysisResult } from "../../lib/types.ts";
import { api } from "../lab/api.ts";
import { tabSlice, type PageLayout } from "./page-doc.ts";

export interface PortalBridge {
  /** which page: "patient", "sample", "query results" or "group comparison" */
  page: string;
  /** what the page is about — the study and patient, the queried genes, the compared cohorts */
  subject: Record<string, unknown>;
  /** the page's document and layout; null while it is being laid out */
  doc: AnalysisDoc | null;
  layout: PageLayout | null;
  open: string;
  openTab: (key: string) => void;
  /** a note the page shows about its link's settings */
  note?: string | null;
}

const SEP = " › ";
const cap = (s: string, n = 30000) => s.length <= n ? s : s.slice(0, n) + `\n… [${(s.length - n).toLocaleString()} more characters not shown]`;

/** The tab a name or the open tab points at, and the views it shows: "Title" or "Title › Sub". */
export function resolveTab(layout: PageLayout, name: string | undefined, open: string):
  { key: string; views: number[]; pending?: string } {
  const want = (name || open || layout.tabs[0]?.title || "").trim();
  const [main, subName] = want.split(SEP).map((s) => s.trim());
  const have = layout.tabs.map((t) => t.title).join(", ");
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const tab = layout.tabs.find((t) => same(t.title, main));
  if (!tab) throw new Error(`no tab "${main}" on this page${layout.partial ? " (yet — the page is still laying out its tabs)" : ""}; the tabs are: ${have}`);
  if (tab.sub) {
    const sub = subName ? tab.sub.find((s) => same(s.title, subName)) : tab.sub[0];
    if (!sub) throw new Error(`no sub-tab "${subName}" in ${tab.title}; its sub-tabs are: ${tab.sub.map((s) => s.title).join(", ")}`);
    return { key: tab.title + SEP + sub.title, views: sub.views };
  }
  return { key: tab.title, views: tab.views || [], ...(tab.pending ? { pending: tab.pending } : {}) };
}

const NOT_READY = "The page is still laying itself out (its study is being read). Call again in a moment.";

export function portalTools(get: () => PortalBridge): AgentTool[] {
  return [
    { name: "portal_get_page", description: "What this page is and what it holds: which page, what it is about (study and patient, queried genes, compared cohorts), the open tab, every tab with its sub-tabs and the views each shows, and the tabs left out for this study and why.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const b = get();
        const l = b.layout;
        if (!l || !b.doc) return { page: b.page, subject: b.subject, ready: false, note: NOT_READY };
        const view = (i: number) => ({ index: i, title: l.titles[i] });
        return {
          page: b.page, subject: b.subject, ready: true, openTab: b.open || l.tabs[0]?.title,
          ...(l.partial ? { partial: "only the first tabs are laid out; the rest follow" } : {}),
          tabs: l.tabs.map((t) => ({
            title: t.title,
            ...(t.sub ? { subTabs: t.sub.map((s) => ({ title: s.title, views: s.views.map(view) })) } : { views: (t.views || []).map(view) }),
            ...(t.pending ? { notBuiltYet: t.pending } : {})
          })),
          leftOut: l.left,
          ...(b.note ? { note: b.note } : {})
        };
      } },
    { name: "portal_get_page_text", description: "The page's visible text as the reader sees it: the header (patient or sample details, samples, queried genes) and whatever the open tab has drawn so far. Use portal_get_tab_results for the numbers behind the figures.",
      inputSchema: { type: "object", properties: {} },
      run: async () => cap((document.querySelector("main") || document.body).innerText) },
    { name: "portal_get_document", description: "The Analysis document behind the page — its cohorts and every view with its settings — as the engine runs it.",
      inputSchema: { type: "object", properties: {} },
      run: async () => get().doc ?? NOT_READY },
    { name: "portal_get_tab_results", description: "The numbers behind one tab as text: every cohort's size and definition, and each view's results with the engine's caveats (surface them to the user). `tab` is \"Title\" or \"Title › Sub-tab\" as portal_get_page lists them; omit it for the open tab. Runs the tab's views on the server, so it can take a few seconds.",
      inputSchema: { type: "object", properties: { tab: { type: "string" } } },
      run: async ({ tab }) => {
        const b = get();
        if (!b.layout || !b.doc) return NOT_READY;
        const t = resolveTab(b.layout, tab, b.open);
        if (t.pending) return `The "${t.key}" tab is not built yet. It will show: ${t.pending}`;
        if (!t.views.length) return `The "${t.key}" tab holds no views.`;
        const slice = tabSlice(b.doc, t.views);
        const r = await api.analysis(slice);
        const j = await r.json();
        if (j.error) throw new Error(String(j.error));
        return `Tab "${t.key}" — views ${t.views.map((i) => i + " (" + b.layout!.titles[i] + ")").join(", ")}\n\n` +
          cap(analysisText(slice, j as AnalysisResult).join("\n\n"));
      } },
    { name: "portal_open_tab", description: "Show one of the page's tabs to the reader (the same as clicking it): \"Title\" or \"Title › Sub-tab\", as portal_get_page lists them.",
      inputSchema: { type: "object", required: ["tab"], properties: { tab: { type: "string" } } },
      run: async ({ tab }) => {
        const b = get();
        if (!b.layout) return NOT_READY;
        const t = resolveTab(b.layout, String(tab || ""), b.open);
        b.openTab(t.key);
        return `Opened "${t.key}". Call portal_get_tab_results to read it.`;
      } }
  ];
}

/** Install the page's tools once, and keep what they see current: `bridge` is rebuilt every render. */
export function usePortalTools(bridge: PortalBridge): void {
  const ref = useRef(bridge);
  ref.current = bridge;
  useEffect(() => {
    const t = exposeTools(ref.current.page, portalTools(() => ref.current), {});
    return t.cleanup;
  }, []);
}
