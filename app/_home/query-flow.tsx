"use client";
// cBioPortal's homepage flow: choose studies, then explore them (the lab's Explore, scoped to them)
// or query them by gene (the gene query dialog, whose "Submit query" opens the Results page). The
// homepage holds it full width and keeps the selection in its URL; the Results page's "Modify
// query" opens it with what the page queried, the dialog starting from the page's genes.
import { useState } from "react";
import { Dna, LayoutDashboard } from "lucide-react";
import { Button } from "../_ui/button";
import { StudyChooser, SelectionStats } from "../_studies/study-chooser.tsx";
import { StudyRowActions } from "../_studies/study-actions.tsx";
import { useStudies } from "../lab/use-catalogs.ts";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import CohortPills from "../lab/pills.tsx";
import { QueryGenesDialog, studiesProblem, type ResultsTarget } from "../portal/query-editor.tsx";
import { encodeParam } from "../portal/page-doc.ts";
import { resultsMaxStudies } from "../../lib/results-settings.ts";
import { DOC_VERSION } from "../../lib/doc-version.ts";
import { cn } from "../../lib/cn";

/** the lab's Explore, scoped to these studies */
const exploreHref = (studies: string[]): string => "/lab?" + new URLSearchParams({ tab: "explore", study: studies.join(",") }).toString();
/** a fresh analysis of all of one study, the document the lab's own "analyze" starts */
const analyzeHref = (id: string): string => "/lab?" + new URLSearchParams({ tab: "analysis",
  doc: encodeParam({ dsl: DOC_VERSION, study: id, cohorts: { ["all of " + id]: { study: id, all: [] } }, views: [] }) }).toString();
/** Explore on one study with Custom data → Add data open (the lab reads `custom=add`) */
const addDataHref = (id: string): string => "/lab?" + new URLSearchParams({ tab: "explore", study: id, custom: "add" }).toString();

export function QueryFlow({ initial, onStudies, queryTitle, className }: {
  initial: ResultsTarget;
  /** the gene dialog's title when "Query by gene" opens it (the homepage's own wording) */
  queryTitle?: string;
  /** the selection as it changes, for a page that keeps it in its URL */
  onStudies?: (ids: string[]) => void;
  className?: string;
}) {
  const studies = useStudies();
  const max = resultsMaxStudies(usePublicEnv());
  const [chosen, setChosen] = useState<string[]>(initial.studies);
  const [filters, setFilters] = useState(initial.filters);
  // the dialog's studies: the selection (the bar's button) or one study (a row's icon)
  const [asking, setAsking] = useState<(Omit<ResultsTarget, "query"> & { query?: string; title?: string }) | null>(null);
  const choose = (ids: string[]) => { setChosen(ids); onStudies?.(ids); };
  const names = new Map(studies.map((s) => [s.id, s.name] as const));
  const queryWhy = !chosen.length ? "select at least one study" : studiesProblem(chosen.length, max);

  return (
    <section data-tw className={cn("rounded-lg border bg-card px-4.5 py-4", className)} aria-label="choose studies">
      <QueryGenesDialog target={asking} names={names} onClose={() => setAsking(null)} />
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="m-0 text-lg font-semibold">Select studies to explore or query</h2>
        <SelectionStats studies={studies} selected={chosen} onClear={() => choose([])} />
      </div>
      {filters.length > 0 && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold tracking-[0.12em] text-muted-foreground uppercase">Filters</span>
          <CohortPills def={{ all: filters }} onRemoveClause={(i) => setFilters((f) => f.filter((_, j) => j !== i))} />
        </div>
      )}
      <StudyChooser studies={studies} loading={!studies.length} selected={chosen} onChange={choose}
        actions={(id) => <StudyRowActions id={id} acts={{
          explore: { title: "explore " + id + " — its summary, on its own", href: exploreHref([id]) },
          analyze: { title: "start an analysis of all of " + id, href: analyzeHref(id) },
          query: { title: "query genes in " + id + " alone", onClick: () => setAsking({ studies: [id], filters: [] }) },
          addData: { title: "explore " + id + " and add custom data to it", href: addDataHref(id) },
        }} />} />
      {/* the count on the left, the two ways on centred on the bar (a third, empty column balances the count) */}
      <div className="sticky bottom-0 z-10 -mx-4.5 -mb-4 mt-4 grid grid-cols-1 items-center gap-2.5 rounded-b-lg border-t bg-card px-4.5 py-3 sm:grid-cols-[1fr_auto_1fr]">
        <span className="justify-self-center sm:justify-self-start"><SelectionStats studies={studies} selected={chosen} /></span>
        <div className="flex flex-wrap justify-center gap-2.5">
          <Button className="querybygene" disabled={!!queryWhy} title={queryWhy || "enter genes to query in the selected studies"}
            onClick={() => setAsking({ studies: chosen, filters, query: initial.query, title: queryTitle })}><Dna />Query by gene</Button>
          <Button variant="outline" className="exploreselected" disabled={!chosen.length} asChild={!!chosen.length}
            title={chosen.length ? "open the selected studies' summary in Explore" + (filters.length ? " (the filters do not carry over)" : "") : "select at least one study"}>
            {chosen.length ? <a href={exploreHref(chosen)}><LayoutDashboard />Explore selected studies</a> : <><LayoutDashboard />Explore selected studies</>}
          </Button>
        </div>
        <span aria-hidden="true" />
      </div>
    </section>
  );
}
