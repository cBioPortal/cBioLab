"use client";
// A Results page's query, as its link carries it: the studies (one, or several pooled), Explore's
// filters when the query came from there, and the gene query (OQL) — read, written and checked
// against the page's limits here. The homepage's flow (app/_home/query-flow.tsx) asks for it; Explore
// asks for a filtered selection's genes in QueryGenesDialog, below.
import { GeneQueryDialog } from "../_genes/GeneQueryDialog.tsx";
import type { Clause } from "../../lib/types";
import { encodeParam, decodeParam } from "./page-doc.ts";

/** the most genes a Results page takes: the oncoprint's rows */
export const RESULTS_MAX_GENES = 12;

/** what a Results page queries, as its link carries it */
export interface ResultsTarget { studies: string[]; filters: Clause[]; query: string }

/** the Results page for a target: ?study= for one study, ?studies= for several, ?filters= when narrowed */
export function resultsHref(t: ResultsTarget): string {
  const p = new URLSearchParams();
  if (t.studies.length === 1) p.set("study", t.studies[0]); else p.set("studies", t.studies.join(","));
  if (t.filters.length) p.set("filters", encodeParam(t.filters));
  p.set("genes", t.query.trim());
  return "/portal/results?" + p.toString();
}

/** a Results link read back; `error` says what is wrong with one that cannot be */
export function readResultsTarget(q: URLSearchParams): ResultsTarget & { error?: string } {
  const ids = (q.get("studies") || q.get("study") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((s) => !/^[A-Za-z0-9._-]+$/.test(s));
  const raw = q.get("filters");
  const filters = raw ? decodeParam<Clause[]>(raw) : [];
  return {
    studies: [...new Set(ids)].filter((s) => !bad.includes(s)), query: q.get("genes") || "", filters: Array.isArray(filters) ? filters : [],
    error: bad.length ? "not a study id: " + bad.join(", ") : raw && !Array.isArray(filters) ? "this link's filters cannot be read" : undefined,
  };
}

/** why a set of studies cannot be queried together, or null when it can */
export function studiesProblem(n: number, max: number): string | null {
  if (!n) return "choose a study";
  return n > max ? "a gene query covers at most " + max + " studies; " + n + " are selected" : null;
}

/**
 * "Query genes": the gene query dialog for a set of studies (and the filters that narrow them, when
 * there are any), whose "Submit query" opens their Results page. The homepage, its rows' icons,
 * the Results page's "Modify query" and Explore all ask for genes with it.
 */
export function QueryGenesDialog({ target, names, onClose }: {
  /** what to query; `query` is the text the dialog starts from (the Results page's own, when modifying); `title` replaces "Query genes in …" */
  target: (Omit<ResultsTarget, "query"> & { query?: string; title?: string }) | null;
  /** study names by id, for the title */
  names: Map<string, string>;
  onClose: () => void;
}) {
  const n = target?.studies.length || 0;
  const what = n === 1 ? names.get(target!.studies[0]) || target!.studies[0] : n + " studies";
  const narrowed = target?.filters.length ? "The query keeps the " + target.filters.length + " filter" + (target.filters.length === 1 ? "" : "s") + " on them." : "";
  return (
    <GeneQueryDialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }} mode="oql" value={target?.query || ""} max={RESULTS_MAX_GENES}
      title={target?.title || "Query genes in " + what} applyLabel="Submit query"
      description={narrowed}
      onApply={(text) => { if (target) window.location.assign(resultsHref({ studies: target.studies, filters: target.filters, query: text })); }} />
  );
}
