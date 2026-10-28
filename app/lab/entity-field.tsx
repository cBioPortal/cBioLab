"use client";
// The entity a generic-assay track or axis reads, found by search: a profile can hold tens of
// thousands (probes, phosphosites), so it is never offered as a list of them all.
import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { api } from "./api.ts";
import { Popover, PopoverContent, PopoverTrigger } from "../_ui/popover";
import { Input } from "../_ui/input";
import { cn } from "../../lib/cn";
import { FIELD } from "../_ui/toolbar.ts";

type AssayEntity = { entity: string; name?: string; gene?: string };
/** a profile's entities matching `q`, from a study that holds it */
export async function searchEntities(study: string, profile: string, q: string, signal?: AbortSignal): Promise<{ entities: AssayEntity[]; total: number }> {
  const r = await api.assayEntities({ study, profile, q }, { signal });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || "the entity search failed");
  return j;
}

/**
 * The entity a generic-assay axis reads: a signature, an arm, a probe. A profile can hold tens of
 * thousands, so it is found by searching its ids, names and linked genes rather than listed.
 */
export function EntityField({ study, profile, value, busy, className, side, placeholder = "choose…", onPick }: {
  study: string; profile: string; value: string; busy?: boolean; className?: string; side: string;
  /** what the field says before an entity is chosen */
  placeholder?: string;
  onPick: (entity: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // the search follows the typing once it pauses
  const [asked, setAsked] = useState("");
  useEffect(() => { const t = setTimeout(() => setAsked(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  const found = useQuery({
    queryKey: ["assayEntities", study, profile, asked],
    enabled: open && !!study,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => searchEntities(study, profile, asked, signal),
  });
  // the chosen entity's display name, where the study gives one
  const named = useQuery({
    queryKey: ["assayEntity", study, profile, value],
    enabled: !!study && !!value,
    queryFn: ({ signal }) => searchEntities(study, profile, value, signal).then((r) => r.entities.find((e) => e.entity === value) || null),
  });
  const shown = named.data?.name || value;
  const list = found.data?.entities || [];
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setQ(""); setAsked(""); } }}>
      <PopoverTrigger asChild>
        <button type="button" disabled={busy} aria-label={side + " entity"} data-tip={(value ? shown + (shown !== value ? " (" + value + ")" : "") : "choose what this axis reads") + " — click to search"}
          className={cn(FIELD, "flex min-w-0 items-center gap-1.5 rounded-md border border-input px-1.5 text-left shadow-xs outline-none",
            "hover:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50", className)}>
          <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}>{value ? shown : placeholder}</span>
          <ListChecks className="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="search by name, id or gene"
          aria-label="search entities" className="h-ctl text-md md:text-md" />
        <div className={cn("mt-1.5 max-h-72 overflow-y-auto", (found.isPlaceholderData || asked !== q.trim()) && "opacity-60")} role="listbox" aria-label="entities"
          aria-busy={found.isFetching || asked !== q.trim()}>
          {found.isError && <p className="px-1 py-1 text-sm text-destructive">{(found.error as Error).message}</p>}
          {!found.isError && !list.length && <p className="px-1 py-1 text-sm text-muted-foreground">{found.isFetching || asked !== q.trim() ? "searching…" : "nothing matches"}</p>}
          {list.map((e) => (
            <button key={e.entity} type="button" role="option" aria-selected={e.entity === value}
              className={cn("flex w-full flex-col rounded px-1.5 py-1 text-left text-md hover:bg-accent", e.entity === value && "bg-accent")}
              onClick={() => { onPick(e.entity); setOpen(false); setQ(""); setAsked(""); }}>
              <span className="truncate">{e.name || e.entity}</span>
              {(e.name || e.gene) && <span className="truncate text-sm text-muted-foreground">{e.entity}{e.gene ? " · " + e.gene : ""}</span>}
            </button>
          ))}
          {found.data && found.data.total > list.length &&
            <p className="px-1 pt-1 text-sm text-muted-foreground">{list.length} of {found.data.total.toLocaleString("en-US")} shown; type to narrow</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
