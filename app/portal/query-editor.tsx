"use client";
// The Results page's query, as cBioPortal's home page asks it: studies from the same list Explore
// shows (one, or several pooled), Explore's filters when the query came from there, and a gene query
// (OQL) entered through the app's gene query dialog. Submitting opens the page for that query;
// nothing on the current page changes until then.
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "../_ui/button";
import { StudySearch, StudyRows, filterStudies } from "../_studies/study-list.tsx";
import { GeneQueryDialog } from "../_genes/GeneQueryDialog.tsx";
import { useStudies } from "../lab/use-catalogs.ts";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import CohortPills from "../lab/pills.tsx";
import { checkGeneQuery } from "../../lib/gene-query.ts";
import { resultsMaxStudies } from "../../lib/results-settings.ts";
import type { Clause } from "../../lib/types";
import { encodeParam, decodeParam } from "./page-doc.ts";
import { cn } from "../../lib/cn";

/** the most genes a Results page takes: the oncoprint's rows */
export const RESULTS_MAX_GENES = 12;

const LABEL = "text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase";

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

export function QueryEditor({ target, className }: { target: ResultsTarget; className?: string }) {
  const studies = useStudies();
  const max = resultsMaxStudies(usePublicEnv());
  const [chosen, setChosen] = useState<string[]>(target.studies);
  const [filters, setFilters] = useState<Clause[]>(target.filters);
  const [query, setQuery] = useState(target.query);
  const [search, setSearch] = useState("");
  const [caps, setCaps] = useState<Set<string>>(() => new Set());
  const [genesOpen, setGenesOpen] = useState(false);
  const hits = filterStudies(studies, search, caps);
  const byId = new Map(studies.map((s) => [s.id, s] as const));
  const check = checkGeneQuery(query, "oql");
  const why = studiesProblem(chosen.length, max) || (!check.genes.length ? "enter at least one gene" : null)
    || check.error || check.entries.find((e) => e.error)?.error
    || (check.genes.length > RESULTS_MAX_GENES ? "a results page takes at most " + RESULTS_MAX_GENES + " genes; this has " + check.genes.length : null);
  const href = resultsHref({ studies: chosen, filters, query });
  const toggle = (id: string) => setChosen((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);
  const patients = chosen.reduce((n, id) => n + (byId.get(id)?.patients ?? 0), 0);
  return (
    <div data-tw className={cn("grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_22rem]", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className={LABEL}>Studies</span>
          <span className="min-w-0 text-md">
            {chosen.length === 1 && byId.get(chosen[0]) ? <strong className="font-semibold">{byId.get(chosen[0])!.name}</strong>
              : chosen.length ? <strong className="font-semibold">{chosen.length} studies</strong> : <span className="text-muted-foreground">none chosen</span>}
            {chosen.length > 0 && <span className="text-muted-foreground"> · {patients.toLocaleString()} patients{filters.length ? " before filters" : ""}</span>}
          </span>
          {chosen.length > 1 && <Button variant="link" size="inline" onClick={() => setChosen([])}>clear</Button>}
        </div>
        {filters.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={LABEL}>Filters</span>
            <CohortPills def={{ all: filters }} onRemoveClause={(i) => setFilters((f) => f.filter((_, j) => j !== i))} />
          </div>
        )}
        <StudySearch query={search} onQuery={setSearch} caps={caps} onCaps={setCaps} matches={hits.length} total={studies.length} />
        <StudyRows hits={hits} loading={!studies.length} pick="many" selected={chosen} onToggle={toggle} />
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <span className={LABEL}>Genes</span>
        <button type="button" onClick={() => setGenesOpen(true)} aria-label="edit the gene query"
          className="min-h-28 rounded-md border bg-paper px-3 py-2 text-left hover:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          {check.entries.length
            ? <ul className="m-0 list-none p-0">{check.entries.map((e, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <code className={cn("font-mono text-md", e.error && "text-destructive")}>{e.text}</code>
                  <span className="min-w-0 truncate text-muted-foreground">{e.error || e.meaning}</span>
                </li>))}</ul>
            : <span className="text-md text-muted-foreground">Click to enter genes or an OQL query…</span>}
        </button>
        <Button variant="outline" size="sm" className="self-start" onClick={() => setGenesOpen(true)}><Pencil />Edit genes / OQL…</Button>
        <div className="mt-auto flex items-center gap-2.5 border-t pt-2.5">
          <Button asChild={!why} disabled={!!why} title={why || "open the results for this query"}>
            {why ? <span>Submit query</span> : <a href={href}>Submit query</a>}
          </Button>
          {why && <span className="text-sm text-muted-foreground">{why}</span>}
        </div>
      </div>
      <GeneQueryDialog open={genesOpen} onOpenChange={setGenesOpen} title="Genes to query" mode="oql" value={query} max={RESULTS_MAX_GENES}
        description="A patient is altered if any line matches. A bare gene means any alteration in it; add OQL to be specific."
        onApply={(text) => setQuery(text)} />
    </div>
  );
}

/**
 * "Query genes" from a study list (Explore): the gene query dialog for what is selected there —
 * one study, or several with their filters — whose Submit opens the Results page.
 */
export function QueryGenesDialog({ target, names, onClose }: {
  target: Omit<ResultsTarget, "query"> | null;
  /** study names by id, for the title */
  names: Map<string, string>;
  onClose: () => void;
}) {
  const n = target?.studies.length || 0;
  const what = n === 1 ? names.get(target!.studies[0]) || target!.studies[0] : n + " studies";
  const narrowed = target?.filters.length ? " The query keeps your " + target.filters.length + " Explore filter" + (target.filters.length === 1 ? "" : "s") + "." : "";
  return (
    <GeneQueryDialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }} mode="oql" value="" max={RESULTS_MAX_GENES}
      title={"Query genes in " + what} applyLabel="Submit query"
      description={"A patient is altered if any line matches; the results compare them with the profiled patients who are not." + narrowed}
      onApply={(text) => { if (target) window.location.assign(resultsHref({ ...target, query: text })); }} />
  );
}
