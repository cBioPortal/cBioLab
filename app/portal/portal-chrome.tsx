"use client";
// The chrome the portal pages share: the app's header (the lab's own), the summary card over the
// tabs (the study, the query, the groups and their sizes).
import { SeriesSwatch } from "../lab/view-chrome.tsx";
import { Badge } from "../_ui/badge";
import { fmtInt, fmtPct } from "../../lib/chart/format.ts";

/** the app's header, as the lab draws it, naming which portal page this is */
export function PortalHeader({ page }: { page: string }) {
  return (
    <header>
      <h1><a href="/lab" className="text-foreground no-underline">cbio-lab</a></h1>
      <span className="sub">{page}</span>
      <span className="spacer" />
      <a className="toplink" href="/lab?tab=explore">explore studies</a>
      <a className="toplink" href="/lab?tab=analysis">analysis</a>
      <a className="toplink" href="/verification">how we verify</a>
    </header>
  );
}

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
export function PortalSummary({ eyebrow, title, study, detail, genes, groups, counts, left, stat, action, children }: {
  eyebrow: string; title: string; study: string; detail?: React.ReactNode; genes?: string[];
  groups: string[]; counts: Record<string, number> | null; left: string[];
  /** the headline number, right of the title */
  stat?: { value: number; of: number; label: string } | null;
  /** a control over the whole page (the Results page's "Modify query"), at the end of the groups row */
  action?: React.ReactNode;
  /** below the groups: the query form when it is open */
  children?: React.ReactNode;
}) {
  return (
    <section data-tw className="mb-4 rounded-lg border bg-card px-4.5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-9 gap-y-4">
        <div className="min-w-0 flex-1 basis-96">
          <div className="text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</div>
          <h2 className="mt-1 mb-1.5 font-serif text-xl font-semibold">{title}</h2>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-md text-muted-foreground">
            <span className="font-mono text-sm">{study}</span>
            {detail && <><span aria-hidden="true">·</span>{detail}</>}
            {genes && genes.length > 0 && <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex flex-wrap gap-1">{genes.map((g) => <Badge key={g} variant="outline" className="font-mono">{g}</Badge>)}</span>
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
          {left.length > 0 && <span className="text-sm text-muted-foreground" title="tabs this page leaves out for this study">not shown: {left.join("; ")}</span>}
          {action}
        </span>
      </div>
      {children}
    </section>
  );
}
