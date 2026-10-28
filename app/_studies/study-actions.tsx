"use client";
// A study row's quick jumps, as the portal's study list has them: explore this study, start an
// analysis of all of it, query it by gene, add custom data to it. Each acts on that study alone,
// whatever is ticked; a click on one never ticks the row. Explore runs them in place, the homepage
// links to them — the same icons either way.
import { Dna } from "lucide-react";
import { Button } from "../_ui/button";
import { cn } from "../../lib/cn";

/** what one icon does: a click, or a link */
export interface RowAct { title: string; onClick?: () => void; href?: string }
export interface RowActs { explore: RowAct; analyze?: RowAct; query?: RowAct; addData: RowAct }

const ICON = "text-muted-foreground hover:text-accent-foreground [&_svg]:size-3.5 [&_svg]:fill-current";

const ICONS = {
  explore: <svg viewBox="0 0 16 16" aria-hidden><path d="M7.25 1.54A6.5 6.5 0 1 0 14.46 8.75H7.25Z" /><path d="M8.75.04v6.71h6.71A6.5 6.5 0 0 0 8.75.04Z" /></svg>,
  analyze: <svg viewBox="0 0 16 16" aria-hidden><path d="M1.5 1v13.5H15V13H3V1Z" /><path d="M4.5 8h2v4h-2ZM8 5h2v7H8ZM11.5 2.5h2V12h-2Z" /></svg>,
  query: <Dna />,
  addData: <svg viewBox="0 0 16 16" aria-hidden><path d="M8 1c-3.6 0-6.5 1.1-6.5 2.5v9C1.5 13.9 4.4 15 8 15c.4 0 .8 0 1.2-.04a4.5 4.5 0 0 1-.9-1.48H8c-3.1 0-5-.9-5-1.48V9.9c1.2.65 3 1.03 5 1.08.05-.5.17-.98.36-1.43C5 9.5 3 8.6 3 8V5.4C4.2 6 6 6.5 8 6.5s3.8-.5 5-1.1V8a4.5 4.5 0 0 1 1.5.5v-5C14.5 2.1 11.6 1 8 1Zm0 4C5 5 3 4.1 3 3.5S5 2 8 2s5 .9 5 1.5S11 5 8 5Z" /><path d="M12 9.5a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 12 9.5Z" /></svg>,
};
const LABEL: Record<keyof RowActs, string> = { explore: "explore", analyze: "analyze", query: "query genes in", addData: "add custom data to" };

export function StudyRowActions({ id, acts }: { id: string; acts: RowActs }) {
  const order: (keyof RowActs)[] = ["explore", "analyze", "query", "addData"];
  return (
    <span className="studyacts">
      {order.map((k) => {
        const a = acts[k];
        if (!a) return null;
        const cls = cn(ICON, k === "query" && "[&_svg]:fill-none");
        // inside the row's <label>, so a click must not reach it and tick the row
        if (a.href) return (
          <Button key={k} asChild variant="ghost" size="icon-xs" className={cls}>
            <a href={a.href} data-tip={a.title} aria-label={LABEL[k] + " " + id} onClick={(e) => e.stopPropagation()}>{ICONS[k]}</a>
          </Button>
        );
        return (
          <Button key={k} variant="ghost" size="icon-xs" className={cls} data-tip={a.title} aria-label={LABEL[k] + " " + id}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); a.onClick?.(); }}>{ICONS[k]}</Button>
        );
      })}
    </span>
  );
}
