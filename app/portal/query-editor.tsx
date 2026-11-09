"use client";
// A Results page's query, as its link carries it: the studies (one, or several pooled), Explore's
// filters when the query came from there, the gene query (OQL), and the query page's profile and
// case-set choice (lib/query-options.ts) — read, written and checked against the page's limits here. The homepage's flow (app/_home/query-flow.tsx) asks for it; Explore
// asks for a filtered selection's genes in QueryGenesDialog, below.
import { useCallback, useState } from "react";
import { GeneQueryDialog } from "../_genes/GeneQueryDialog.tsx";
import type { Clause } from "../../lib/types";
import { encodeParam, decodeParam } from "./page-doc.ts";
import { readOptions, writeOptions, resolveQuery, queryLimitProblem, CUSTOM_CASE_SET, type QueryOptions } from "../../lib/query-options.ts";
import { QueryOptionsPanel, type QueryOptionsStatus } from "./query-options.tsx";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import { queryProductLimit } from "../../lib/results-settings.ts";

/** the most genes a Results page takes: the oncoprint's rows */
export const RESULTS_MAX_GENES = 12;

/** what a Results page queries, as its link carries it; `options` null for a link that carries none (any alteration, every case) */
export interface ResultsTarget { studies: string[]; filters: Clause[]; query: string; options?: QueryOptions | null }

/** the Results page for a target: ?study= for one study, ?studies= for several, ?filters= when narrowed */
export function resultsHref(t: ResultsTarget): string {
  const p = new URLSearchParams();
  if (t.studies.length === 1) p.set("study", t.studies[0]); else p.set("studies", t.studies.join(","));
  if (t.filters.length) p.set("filters", encodeParam(t.filters));
  p.set("genes", t.query.trim());
  writeOptions(p, t.options);
  return "/portal/results?" + p.toString();
}

/** a Results link read back; `error` says what is wrong with one that cannot be */
export function readResultsTarget(q: URLSearchParams): ResultsTarget & { error?: string } {
  const ids = (q.get("studies") || q.get("study") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((s) => !/^[A-Za-z0-9._-]+$/.test(s));
  const raw = q.get("filters");
  const filters = raw ? decodeParam<Clause[]>(raw) : [];
  const opts = readOptions(q);
  return {
    studies: [...new Set(ids)].filter((s) => !bad.includes(s)), query: q.get("genes") || "", filters: Array.isArray(filters) ? filters : [],
    options: opts.options,
    error: bad.length ? "not a study id: " + bad.join(", ") : raw && !Array.isArray(filters) ? "this link's filters cannot be read" : opts.error ? "this link's query options cannot be read — " + opts.error : undefined,
  };
}

/** why a set of studies cannot be queried together, or null when it can */
export function studiesProblem(n: number, max: number): string | null {
  if (!n) return "choose a study";
  return n > max ? "a gene query covers at most " + max + " studies; " + n + " are selected" : null;
}

/** the ids typed into "User-defined Case List", saved as a stored id set; the portal's error for those that match no case */
async function saveCaseIds(studies: string[], ids: string[], level: "sample" | "patient"): Promise<{ set: string; n: number } | string> {
  const r = await fetch("/api/id-sets", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User-defined Case List", level, studies, ids }) });
  const j = await r.json().catch(() => ({ error: "the case list could not be saved (" + r.status + ")" }));
  if (j.error) return "Error in custom case set: " + j.error;
  if (j.refused?.length) return "Error in custom case set: " + j.refused.map((x: { study: string; reason: string }) => x.study + " — " + x.reason).join("; ");
  if (j.unmatched) {
    const shown = (j.unmatchedExamples as string[]).map((x) => (studies.length === 1 ? x.replace(studies[0] + ":", "") : "(" + x.split(":").join(", ") + ")"));
    const more = j.unmatched > shown.length ? " and " + (j.unmatched - shown.length) + " more" : "";
    return studies.length === 1
      ? "Invalid " + level + (j.unmatched > 1 ? "s" : "") + " for the selected cancer study: " + shown.join(", ") + more
      : "Invalid (study, " + level + ") pair" + (j.unmatched > 1 ? "s" : "") + ": " + shown.join(", ") + more;
  }
  return { set: j.set.id, n: j.set.count };
}

/**
 * "Query genes": the gene query dialog for a set of studies (and the filters that narrow them, when
 * there are any), with the query page's profile and case-set choice above the genes, whose "Submit
 * query" opens their Results page. The homepage, its rows' icons, the Results page's "Modify query"
 * and Explore all ask for genes with it; the Results page's "Edit genes" asks for genes alone
 * (`options: false`), keeping the page's choice.
 */
export function QueryGenesDialog({ target, names, onClose, options = true }: {
  /** what to query; `query` is the text the dialog starts from (the Results page's own, when modifying); `title` replaces "Query …" */
  target: (Omit<ResultsTarget, "query"> & { query?: string; title?: string }) | null;
  /** study names by id, for the title */
  names: Map<string, string>;
  onClose: () => void;
  /** offer the profile and case-set choice */
  options?: boolean;
}) {
  const [chosen, setChosen] = useState<QueryOptionsStatus | null>(null);
  const onOptions = useCallback((s: QueryOptionsStatus) => setChosen(s), []);
  const n = target?.studies.length || 0;
  const what = n === 1 ? names.get(target!.studies[0]) || target!.studies[0] : n + " studies";
  const narrowed = target?.filters.length ? "The query keeps the " + target.filters.length + " filter" + (target.filters.length === 1 ? "" : "s") + " on them." : "";
  const exploreHref = target ? "/lab?" + new URLSearchParams({ tab: "explore", study: target.studies.join(",") }).toString() : "/lab";
  const limit = queryProductLimit(usePublicEnv());
  const submit = async (text: string, entries: string[], genes: number): Promise<string | void> => {
    if (!target) return;
    let picked: QueryOptions | null | undefined = target.options;
    if (options) {
      if (!chosen?.options) return "the profiles and case sets are still loading";
      picked = chosen.options;
      // what the Results page would refuse of these genes with this choice (the portal's submitError), said before leaving
      const r = resolveQuery(picked, entries, target.studies.length, new Set(chosen.held), chosen.expression);
      if (r.error) return r.error;
      const big = queryLimitProblem(genes, chosen.samples, limit);
      if (big) return big;
      if (picked.caseSet === CUSTOM_CASE_SET) {
        if (!chosen.customIds) return "Please enter at least one ID in your custom case set.";
        const saved = await saveCaseIds(target.studies, chosen.customIds.ids, chosen.customIds.level);
        if (typeof saved === "string") return saved;
        picked = { ...picked, cases: { set: saved.set, level: chosen.customIds.level, n: saved.n } };
      }
    }
    window.location.assign(resultsHref({ studies: target.studies, filters: target.filters, query: text, options: picked }));
    // the page is leaving: keep the dialog as it is until it has
    return new Promise<void>(() => {});
  };
  return (
    <GeneQueryDialog open={!!target} onOpenChange={(o) => { if (!o) { setChosen(null); onClose(); } }} mode="oql" value={target?.query || ""} max={RESULTS_MAX_GENES}
      title={target?.title || "Query " + what} applyLabel="Submit query"
      description={narrowed}
      above={options && target ? <QueryOptionsPanel studies={target.studies} filtered={target.filters.length > 0} initial={target.options || null}
        exploreHref={exploreHref} onChange={onOptions} /> : undefined}
      blockers={options ? chosen?.problems || [] : []} waiting={options && (!chosen || chosen.pending)}
      onApply={(text, c) => submit(text, c.entries.map((e) => e.text), c.genes.length)} />
  );
}
