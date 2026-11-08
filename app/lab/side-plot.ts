"use client";
// A plot a card draws beside its table for the row picked there (co-expression's gene pair,
// differential expression's gene per group): an ordinary plot view sent for the pick over the
// card's own cohorts, drawn by the shared renderer. Which row is picked is this browser's
// (invariant 9), so the plot is never part of the document. A newer pick supersedes one in flight.
import { useEffect, useRef, useState } from "react";
import type { CohortDef, View, ViewResult } from "../../lib/types";
import { api } from "./api.ts";

export function useSidePlot(docJson: (() => string) | undefined, cohorts: string[], view: Record<string, unknown> | null) {
  const [state, setState] = useState<{ key: string; view?: ViewResult; error?: string } | null>(null);
  const want = useRef("");
  const key = JSON.stringify([cohorts, view]);
  useEffect(() => {
    if (!view || !docJson) return;
    want.current = key;
    setState(null);
    let doc: { study?: string; cohorts?: Record<string, CohortDef> };
    try { doc = JSON.parse(docJson()); } catch { setState({ key, error: "no document to plot from" }); return; }
    const missing = cohorts.filter((n) => !(doc.cohorts && doc.cohorts[n]));
    if (missing.length) { setState({ key, error: "cohort “" + missing[0] + "” is not in the document" }); return; }
    const defs = Object.fromEntries(cohorts.map((n) => [n, doc.cohorts![n]]));
    api.analysis({ study: doc.study, cohorts: defs, views: [{ ...view, cohorts } as View] }, { query: "?oncoprint=spec" })
      .then((r) => r.json())
      .then((j) => { if (want.current !== key) return; const pv = j.views && j.views[0]; setState({ key, ...(j.error || pv?.error ? { error: j.error || pv.error } : { view: pv }) }); })
      .catch((e) => { if (want.current === key) setState({ key, error: String(e) }); });
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  return state && state.key === key ? state : null;
}
