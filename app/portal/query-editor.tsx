"use client";
// The Results page's query, as cBioPortal's home page asks it: a study from the same list Explore
// shows, and a gene query (OQL) entered through the app's gene query dialog. Submitting opens the
// page for that query; nothing on the current page changes until then.
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "../_ui/button";
import { StudySearch, StudyRows, filterStudies } from "../_studies/study-list.tsx";
import { GeneQueryDialog } from "../_genes/GeneQueryDialog.tsx";
import { useStudies } from "../lab/use-catalogs.ts";
import { checkGeneQuery } from "../../lib/gene-query.ts";
import { cn } from "../../lib/cn";

/** the most genes a Results page takes: the oncoprint's rows */
export const RESULTS_MAX_GENES = 12;

const LABEL = "text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase";

export function QueryEditor({ study: study0, query: query0, className }: { study: string; query: string; className?: string }) {
  const studies = useStudies();
  const [study, setStudy] = useState(study0);
  const [query, setQuery] = useState(query0);
  const [search, setSearch] = useState("");
  const [caps, setCaps] = useState<Set<string>>(() => new Set());
  const [genesOpen, setGenesOpen] = useState(false);
  const hits = filterStudies(studies, search, caps);
  const chosen = studies.find((s) => s.id === study);
  const check = checkGeneQuery(query, "oql");
  const why = !study ? "choose a study" : !check.genes.length ? "enter at least one gene"
    : check.error || check.entries.find((e) => e.error)?.error
    || (check.genes.length > RESULTS_MAX_GENES ? "a results page takes at most " + RESULTS_MAX_GENES + " genes; this has " + check.genes.length : null);
  const href = "/portal/results?" + new URLSearchParams({ study, genes: query.trim() }).toString();
  return (
    <div data-tw className={cn("grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_22rem]", className)}>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          <span className={LABEL}>Study</span>
          <span className="min-w-0 truncate text-md">{chosen ? <><strong className="font-semibold">{chosen.name}</strong> <span className="text-muted-foreground">· {chosen.patients.toLocaleString()} patients</span></> : study || <span className="text-muted-foreground">none chosen</span>}</span>
        </div>
        <StudySearch query={search} onQuery={setSearch} caps={caps} onCaps={setCaps} matches={hits.length} total={studies.length} />
        <StudyRows hits={hits} loading={!studies.length} pick="one" selected={study ? [study] : []} onToggle={setStudy} />
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
