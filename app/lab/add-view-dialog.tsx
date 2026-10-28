"use client";
// The analysis page's "Add view" dialog: every view kind, grouped by category (VIEW_CATEGORIES in
// kinds/kind-ui.ts). The sidebar picks a category, all of them, or the kinds cBioPortal already draws
// (Classic cBioPortal: every kind not marked NEW, still listed under its own category too); the search narrows by name and
// description, and each row says why it cannot be added when it cannot. A click adds the view and
// closes the dialog.
import { Fragment, useMemo, useState } from "react";
import { LoaderCircle, Plus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { cn } from "../../lib/cn";
import { kindOf } from "../../lib/views/kinds.ts";
import { isNewKind } from "../../lib/new-in-lab.ts";
import { NewMark } from "./new-mark.tsx";
import { VIEW_CATEGORIES, type ViewCategory } from "./kinds/kind-ui.ts";

/** One kind as the dialog lists it: whether it can be added now, and if not why. */
export interface AddViewItem {
  kind: string;
  label: string;
  category: ViewCategory;
  /** why it cannot be added, or null */
  blocked: string | null;
  /** its study's catalog is still loading, so `blocked` is a wait rather than a refusal */
  waiting: boolean;
}

/** The sidebar's filters above the categories: every kind, and the kinds cBioPortal also has. */
const FILTERS = [
  { id: "all", label: "All views" },
  { id: "classic", label: "Classic cBioPortal" },
] as const;
type Filter = (typeof FILTERS)[number]["id"] | ViewCategory;

/** a label's name and its trailing parenthetical: "Cox regression (forest plot)" → ["Cox regression", "forest plot"] */
function splitLabel(label: string): [string, string | null] {
  const m = /^(.*?) \((.*)\)$/.exec(label);
  return m ? [m[1], m[2]] : [label, null];
}

/** the first sentence of a kind's "What is this?" text */
function blurb(kind: string): string {
  const text = kindOf(kind)?.help.text || "";
  const m = /^.*?[.?!](?=\s|$)/.exec(text);
  return m ? m[0] : text;
}

export function AddViewDialog({ open, onOpenChange, items, onAdd }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: AddViewItem[];
  onAdd: (kind: string) => void;
}) {
  const [cat, setCat] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => items.map((it) => {
    const [name, detail] = splitLabel(it.label);
    return { ...it, name, detail, about: blurb(it.kind), classic: !isNewKind(it.kind) };
  }), [items]);

  const needle = q.trim().toLowerCase();
  const matches = (r: (typeof rows)[number]) => !needle ||
    [r.label, r.about, r.kind].some((s) => s.toLowerCase().includes(needle));
  const inFilter = (r: (typeof rows)[number], f: Filter) => f === "all" || (f === "classic" ? r.classic : r.category === f);
  // a search looks across every category, so the reader need not guess where a kind lives
  const shown = rows.filter((r) => matches(r) && (needle || inFilter(r, cat)));
  // headings name each kind's category wherever the list spans several
  const headed = !!needle || cat === "all" || cat === "classic";
  const groups = VIEW_CATEGORIES
    .map((c) => ({ ...c, rows: shown.filter((r) => r.category === c.id) }))
    .filter((g) => g.rows.length);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}>
      <DialogContent aria-describedby={undefined}
        className="addviewdialog flex h-[80vh] w-[min(64rem,94vw)] max-w-[94vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(64rem,94vw)]">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="text-base">Add a view</DialogTitle>
        </DialogHeader>
        <div data-tw className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="addview-cats flex flex-none gap-0.5 overflow-x-auto border-b bg-muted/40 p-2 md:w-60 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0" aria-label="view categories">
            {[...FILTERS, ...VIEW_CATEGORIES].map((c, i) => {
              const n = rows.filter((r) => inFilter(r, c.id)).length;
              const active = !needle && cat === c.id;
              return (<Fragment key={c.id}>
                <Button variant="ghost" size="sm" data-cat={c.id} data-tip={c.id === "classic" ? "views cBioPortal also draws (no NEW mark)" : undefined} aria-current={active || undefined}
                  onClick={() => { setCat(c.id); setQ(""); }}
                  className={cn("flex-none justify-between gap-3 font-normal md:w-full",
                    active ? "bg-card font-medium text-accent-foreground shadow-xs hover:bg-card" : "text-muted-foreground hover:bg-card/70")}>
                  <span>{c.label}</span><span className="text-xs tabular-nums opacity-70">{n}</span>
                </Button>
                {i === FILTERS.length - 1 && <div role="separator" className="mx-1 flex-none border-l md:my-1.5 md:border-t md:border-l-0" />}
              </Fragment>);
            })}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative border-b px-4 py-2.5">
              <Search className="pointer-events-none absolute top-1/2 left-6.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search views — survival, copy number, PSA…"
                className="addview-search pl-8" aria-label="search views" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {!groups.length && <p className="note mt-4">No view matches “{q}”.</p>}
              {groups.map((g) => (
                <section key={g.id} className="mt-3">
                  {headed && (
                    <h3 className="sticky top-0 z-10 bg-card py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</h3>
                  )}
                  <ul className="grid list-none gap-1.5 p-0 md:grid-cols-2">
                    {g.rows.map((r) => (
                      <li key={r.kind}>
                        <Button variant="outline" data-kind={r.kind} disabled={!!r.blocked} aria-busy={r.waiting || undefined}
                          data-tip={r.blocked || ("add a " + r.name.toLowerCase() + " view, then choose its cohorts")}
                          onClick={() => { onAdd(r.kind); onOpenChange(false); setQ(""); }}
                          className={cn("addview-item group h-full w-full items-start justify-start gap-2.5 px-3 py-2 text-left font-normal whitespace-normal shadow-none",
                            !r.blocked && "hover:border-primary/60")}>
                          {r.waiting
                            ? <LoaderCircle className="mt-0.5 size-4 flex-none animate-spin text-muted-foreground" />
                            : <Plus className="mt-0.5 size-4 flex-none text-muted-foreground group-enabled:group-hover:text-primary" />}
                          <span className="min-w-0">
                            <span className="addview-name text-sm font-medium">{r.name}</span>
                            {isNewKind(r.kind) && <NewMark />}
                            {r.detail && <span className="ml-1.5 text-xs text-muted-foreground">{r.detail}</span>}
                            {r.about && <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.about}</span>}
                            {r.blocked && !r.waiting && <span className="mt-0.5 block text-xs text-destructive/80">{r.blocked}</span>}
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
