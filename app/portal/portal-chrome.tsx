"use client";
// The chrome the portal pages share: the summary card over the
// tabs (the study, the query, the groups and their sizes).
import { SeriesSwatch } from "../lab/view-chrome.tsx";
import { Badge } from "../_ui/badge";
import { Button } from "../_ui/button";
import { Pencil } from "lucide-react";
import { fmtInt, fmtPct } from "../../lib/chart/format.ts";

/** one group's swatch, name and size; the swatch is the colour the figures draw it in */
function GroupChip({ name, i, n }: { name: string; i: number; n?: number }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-pill border bg-paper px-2.5 text-sm">
      <SeriesSwatch i={i} />
      <span className="font-medium">{name}</span>
      {n != null && <span className="text-muted-foreground tabular-nums">{fmtInt(n)}</span>}
    </span>
  );
}

/**
 * The card over a portal page's tabs: what was asked (the study and, on the Results page, the
 * genes), the headline answer beside it, and the groups every tab compares — with what the page
 * left out for this study, so a missing tab is never silent.
 */
export function PortalSummary({ eyebrow, title, study, studyTitle, detail, genes, onEditGenes, groups, counts, left, stat, action, children }: {
  eyebrow: string; title: string;
  /** the study id, or the ids summarised; `studyTitle` lists them all */
  study: string; studyTitle?: string; detail?: React.ReactNode; genes?: string[];
  /** opens the gene query on the page's own genes (the Results page) */
  onEditGenes?: () => void;
  groups: string[]; counts: Record<string, number> | null; left: string[];
  /** the headline number, right of the title */
  stat?: { value: number; of: number; label: string } | null;
  /** a control over the whole page (the Results page's "Modify query"), at the end of the groups row */
  action?: React.ReactNode;
  /** below the groups */
  children?: React.ReactNode;
}) {
  return (
    <section data-tw className="mb-4 rounded-lg border bg-card px-4.5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-9 gap-y-4">
        <div className="min-w-0 flex-1 basis-96">
          <div className="text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</div>
          <h2 className="mt-1 mb-1.5 font-serif text-xl font-semibold">{title}</h2>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-md text-muted-foreground">
            <span className="font-mono text-sm" data-tip={studyTitle}>{study}</span>
            {detail && <><span aria-hidden="true">·</span>{detail}</>}
            {genes && genes.length > 0 && <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex flex-wrap items-center gap-1">{genes.map((g) => <Badge key={g} variant="outline" className="font-mono">{g}</Badge>)}
                {onEditGenes && <Button variant="ghost" size="icon-xs" className="editgenes" aria-label="edit genes" data-tip="edit the query's genes" onClick={onEditGenes}><Pencil /></Button>}</span>
            </>}
          </div>
        </div>
        {stat && (
          <div className="min-w-56 sm:text-right">
            <div className="text-2xl leading-tight font-semibold text-accent-foreground tabular-nums">
              {fmtInt(stat.value)} <span className="text-lg font-normal text-muted-foreground">({fmtPct(stat.of ? 100 * stat.value / stat.of : 0)})</span>
            </div>
            <div className="text-sm text-muted-foreground">{stat.label}</div>
            <div className="mt-1.5 h-1.5 w-56 sm:ml-auto overflow-hidden rounded-pill bg-muted" aria-hidden="true">
              <div className="h-full rounded-pill bg-primary" style={{ width: Math.min(100, stat.of ? 100 * stat.value / stat.of : 0) + "%" }} />
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t pt-2.5">
        <span className="text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">Groups</span>
        {groups.length ? groups.map((n, i) => <GroupChip key={n} name={n} i={i} n={counts?.[n]} />) : <span className="skeleton h-7 w-48" />}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
          {left.length > 0 && <span className="text-sm text-muted-foreground" data-tip="tabs this page leaves out for this study">not shown: {left.join("; ")}</span>}
          {action}
        </span>
      </div>
      {children}
    </section>
  );
}

/**
 * A portal page while it learns what its studies hold (which decides its tabs): shaped like what
 * replaces it — the tab row, then a view card's title, toolbar and figure — so the page does not
 * change shape on the way to its first view.
 */
export function PortalLoading() {
  return (
    <div role="status" aria-label="loading the page">
      <div data-tw className="mb-4 flex flex-wrap gap-x-7 gap-y-2.5 border-b px-3.5 pt-2 pb-2.5">
        {[6, 9.5, 8, 3.5, 5.5, 7, 9, 6.5].map((w, i) => <span key={i} className="skeleton block h-5" style={{ width: w + "rem" }} />)}
      </div>
      <div className="card viewcard viewloading" aria-busy="true">
        <div className="vhead"><span data-tw className="skeleton block h-[34px] w-56" /></div>
        <div className="viewtb"><span data-tw className="skeleton block h-9 w-[34rem] max-w-full" /></div>
        <div className="skeleton skeleton-view" />
      </div>
    </div>
  );
}
