"use client";
// What the analysis page shows, as queries keyed by what decides each answer.
//
// One query for the document's cohorts (its sizes, readbacks and splits), then one per view, keyed
// by the cohorts and that view's data part — so an edit re-runs exactly the views whose answer it
// changes, a move or a removal re-runs nothing, and an answer can only ever be shown under the key
// it was asked for: a slow, superseded request has no slot to land in. The view queries wait for
// the cohorts query, so the counts every view request needs are already cached on the server
// (lib/next-cache.ts, cachedCount) when they start.
//
// While a key changes, a view keeps its previous answer — matched by view id, never by position —
// under the page's "updating" cover. A different document (a new epoch) starts from nothing, so
// the previous analysis's numbers never stand in for this one's.
import { QueryClient, useQueries, useQuery, type QueryClient as QC } from "@tanstack/react-query";
import { useRef } from "react";
import { dataPart } from "../_oncoprint/view-display.ts";
import type { AnalysisDoc, AnalysisResult } from "../../lib/types.ts";

/** Analyses are a function of the document and the data: never stale in a session, never refetched
 *  on focus, and an engine error is a refusal, not something to retry. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: {
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: Infinity, gcTime: 30 * 60 * 1000,
  } } });
}

type ViewResult = AnalysisResult["views"][number];
type V = Record<string, unknown>;

/** The document as sent for its cohorts: everything but its views and its prose (its own notes,
 *  and each cohort's), which change no number. */
function cohortsPart(doc: AnalysisDoc, study: string): AnalysisDoc {
  const { views, title, notes, cohorts, ...rest } = doc as AnalysisDoc & { title?: unknown; notes?: unknown };
  void views; void title; void notes;
  const plain = Object.fromEntries(Object.entries(cohorts || {}).map(([k, c]) => {
    const { notes: cohortNotes, ...def } = c as typeof c & { notes?: unknown };
    void cohortNotes;
    return [k, def];
  }));
  return { ...rest, cohorts: plain, study: doc.study || study } as AnalysisDoc;
}
/** A view as far as its answer goes: its data part (view-display.ts), without the author's note. */
function viewPart(v: V): V {
  const { note, ...rest } = dataPart(v);
  void note;
  return rest;
}
const cohortsKey = (base: AnalysisDoc) => ["analysis", "cohorts", JSON.stringify(base)] as const;
const viewKey = (base: AnalysisDoc, v: V) => ["analysis", "view", JSON.stringify(base), JSON.stringify(viewPart(v))] as const;

async function post(body: unknown, signal: AbortSignal): Promise<AnalysisResult> {
  // the page draws its own oncoprints from the binary contract, so a run returns a spec for each
  const res = await fetch("/api/analysis?oncoprint=spec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j as AnalysisResult;
}

/** The view's note is the author's, read from the document: editing it re-runs nothing. */
function withNote(r: ViewResult, v: V): ViewResult {
  const note = typeof v.note === "string" ? v.note.trim() : "";
  const out = { ...r } as ViewResult & { annotationNote?: string };
  if (note) out.annotationNote = note; else delete out.annotationNote;
  return out;
}

export interface Analysis {
  /** cohorts and every view, in the document's order; a view not answered yet is `{kind, pending: true}` */
  result: AnalysisResult | null;
  /** the cohorts are being (re-)evaluated: every view waits on them */
  busy: boolean;
  /** ids of the views whose own query is running */
  pending: Set<number>;
  error: string | null;
}

export function useAnalysis(doc: AnalysisDoc, ids: number[], epoch: number, study: string, ready: boolean): Analysis {
  const base = cohortsPart(doc, study);
  const views = (doc.views || []) as unknown as V[];
  const enabled = ready && Object.keys(doc.cohorts || {}).length > 0;

  // what each view (by id) and the cohorts (by epoch) last showed, to stand in while a key changes
  const lastCohorts = useRef<{ epoch: number; data: AnalysisResult } | null>(null);
  const lastViews = useRef(new Map<number, ViewResult>());

  const cohorts = useQuery<AnalysisResult, Error, AnalysisResult, readonly unknown[]>({
    queryKey: cohortsKey(base),
    queryFn: ({ signal }) => post({ ...base, views: [] }, signal),
    enabled,
    placeholderData: (): AnalysisResult | undefined => lastCohorts.current?.epoch === epoch ? lastCohorts.current.data : undefined,
  });
  const cohortsCurrent = cohorts.isSuccess && !cohorts.isPlaceholderData;
  const viewQs = useQueries({ queries: views.map((v, i) => ({
    queryKey: viewKey(base, v),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ViewResult> => {
      const r = await post({ ...base, views: [v] }, signal);
      if (!r.views || !r.views[0]) throw new Error("no result for this view");
      return r.views[0];
    },
    enabled: enabled && cohortsCurrent,
    placeholderData: (): ViewResult | undefined => lastViews.current.get(ids[i]),
  })) });

  if (cohorts.data && !cohorts.isPlaceholderData) lastCohorts.current = { epoch, data: cohorts.data };
  const shown = viewQs.map((q, i): ViewResult => {
    const v = views[i];
    const r: ViewResult = q.data ?? (q.error ? { kind: v.kind, error: String((q.error as Error).message || q.error) } as ViewResult
      : { kind: v.kind, pending: true } as unknown as ViewResult);
    if (q.data && !q.isPlaceholderData) lastViews.current.set(ids[i], q.data);
    return withNote(r, v);
  });
  // only ids still on the page are worth remembering
  for (const id of lastViews.current.keys()) if (!ids.includes(id)) lastViews.current.delete(id);

  const result = enabled && cohorts.data ? { ...cohorts.data, views: shown } : null;
  const pending = new Set<number>();
  viewQs.forEach((q, i) => { if (q.isFetching || (enabled && !cohortsCurrent)) pending.add(ids[i]); });
  return {
    result,
    busy: enabled && (cohorts.isFetching || cohorts.isPending),
    pending,
    error: cohorts.error ? String((cohorts.error as Error).message || cohorts.error) : null,
  };
}

/** Put an answer computed elsewhere (the AI tools validate before they commit) where the page's queries will find it. */
export function seedAnalysis(qc: QC, doc: AnalysisDoc, study: string, r: AnalysisResult): void {
  const base = cohortsPart(doc, study);
  qc.setQueryData(cohortsKey(base), { ...r, views: [] });
  ((doc.views || []) as unknown as V[]).forEach((v, i) => { if (r.views[i]) qc.setQueryData(viewKey(base, v), r.views[i]); });
}

/** Ask every analysis again (data the document named has arrived, say). */
export function rerunAnalysis(qc: QC): Promise<void> {
  return qc.invalidateQueries({ queryKey: ["analysis"] });
}
