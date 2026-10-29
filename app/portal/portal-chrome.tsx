"use client";
// The chrome the portal pages share: the summary card over the
// tabs (the study, the query, and on the Comparison page the groups and their sizes).
import { SeriesSwatch } from "../lab/view-chrome.tsx";
import { Badge } from "../_ui/badge";
import { Button } from "../_ui/button";
import { Info, Pencil } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../_ui/dialog";
import { fmtInt, fmtPct } from "../../lib/chart/format.ts";
import { cn } from "../../lib/cn";

/**
 * one group's swatch, name and size; the swatch is the colour the figures draw it in. With
 * `onToggle` the chip is a button that takes the group out of every tab and puts it back; a group
 * that is out (`i` null) shows no colour, since no figure draws it.
 */
function GroupChip({ name, i, n, onToggle, lock }: { name: string; i: number | null; n?: number; onToggle?: () => void; lock?: string }) {
  const body = <>
    {i == null ? <span className="cohortswatch border border-muted-foreground/50" aria-hidden="true" /> : <SeriesSwatch i={i} />}
    <span className={cn("font-medium", i == null && "text-muted-foreground line-through")}>{name}</span>
    {n != null && i != null && <span className="text-muted-foreground tabular-nums">{fmtInt(n)}</span>}
  </>;
  const chip = "inline-flex h-7 items-center gap-1.5 rounded-pill border bg-paper px-2.5 text-sm";
  if (!onToggle) return <span className={chip}>{body}</span>;
  return <button type="button" className={cn(chip, "groupchip cursor-pointer hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70")} aria-pressed={i != null}
    disabled={!!lock} data-tip={lock || (i == null ? "add " + name + " back to the comparison" : "leave " + name + " out of the comparison")} onClick={onToggle}>{body}</button>;
}

/** what the page leaves out for this study (tabs it has no data for, and caveats on its groups), behind a small info button */
function LeftOut({ left }: { left: string[] }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="ghost" size="icon-xs" className="leftout text-muted-foreground" aria-label="what this page leaves out" data-tip="what this page leaves out" aria-haspopup="dialog" onClick={() => setOpen(true)}><Info /></Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="max-w-lg">
        <DialogHeader><DialogTitle className="text-base">What this page leaves out</DialogTitle></DialogHeader>
        <ul className="m-0 list-disc space-y-1.5 pl-5 text-md">{left.map((l) => <li key={l}>{l}</li>)}</ul>
      </DialogContent>
    </Dialog>
  </>;
}

/**
 * The card over a portal page's tabs: what was asked (the study and, on the Results page, the
 * genes), the headline answer beside it, the groups every tab compares on a page that compares
 * them — and an info button listing what the page left out for this study, so a missing tab is never silent.
 */
export function PortalSummary({ eyebrow, title, study, studyTitle, detail, genes, onEditGenes, groups, counts, left, off = [], onToggleGroup, maxOn = Infinity, stat, action, aside, children }: {
  eyebrow: string; title: string;
  /** the study id, or the ids summarised; `studyTitle` lists them all */
  study: string; studyTitle?: string; detail?: React.ReactNode; genes?: string[];
  /** opens the gene query on the page's own genes (the Results page) */
  onEditGenes?: () => void;
  /** the groups every tab compares (the Comparison page); a page that draws one cohort lists none */
  groups?: string[]; counts?: Record<string, number> | null; left: string[];
  /** the groups taken out of the comparison, and how to take one out or put it back (the Comparison page) */
  off?: string[]; onToggleGroup?: (name: string) => void;
  /** the most groups compared at once: past it, a group taken out stays out until another is */
  maxOn?: number;
  /** the headline number, right of the title */
  stat?: { value: number; of: number; label: string } | null;
  /** a control over the whole page (the Results page's "Modify query"): at the end of the groups row, or right of the title without one */
  action?: React.ReactNode;
  /** right of the title, in place of `stat` (the Patient page's navigation through a cohort) */
  aside?: React.ReactNode;
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
            {left.length > 0 && <LeftOut left={left} />}
          </div>
        </div>
        {aside && <div className="sm:ml-auto">{aside}</div>}
        {(stat || (action && !groups)) && <div className="flex items-start gap-6 sm:ml-auto">
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
        {action && !groups && action}
        </div>}
      </div>
      {groups && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t pt-2.5">
          <span className="text-sm font-semibold tracking-[0.12em] text-muted-foreground uppercase">Groups</span>
          {groups.length ? groups.map((n) => {
            const on = groups.filter((g) => !off.includes(g)), i = on.indexOf(n);
            const lock = !onToggleGroup ? undefined : i >= 0 && on.length <= 2 ? "a comparison needs at least 2 groups"
              : i < 0 && on.length >= maxOn ? maxOn + " groups are compared at once — take one out to add " + n : undefined;
            return <GroupChip key={n} name={n} i={i < 0 ? null : i} n={counts?.[n]} lock={lock} onToggle={onToggleGroup && (() => onToggleGroup(n))} />;
          }) : <span className="skeleton h-7 w-48" />}
          {action && <span className="ml-auto">{action}</span>}
        </div>
      )}
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
