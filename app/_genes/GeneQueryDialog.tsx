"use client";
// THE way a reader enters genes: one editor, in a dialog or in place, for every place a page asks
// for a gene list or an OQL query. Search (genes, their aliases, gene sets), the query as text, a check of every entry as it
// is typed (does it parse, is each symbol a gene, an alias of one, or neither), and the lists this
// browser has used or saved. `mode` decides what the text is: "oql" — each entry a gene and what
// counts as altered in it — or "genes", cBioPortal's gene list, where `[A B]` is one merged row.
import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, Check, CircleAlert, History, Search, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { Textarea } from "../_ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../_ui/tabs";
import { SEG_TAB, SEG_TABS, TB, FIELD } from "../_ui/toolbar.ts";
import { formatGeneList, MAX_GENE_SYMBOLS, type GeneTrackSpec } from "../../lib/gene-tracks.ts";
import { checkGeneQuery, replaceSymbol, OQL_HELP, OQL_REFUSED, type GeneQueryMode, type QueryCheck } from "../../lib/gene-query.ts";
import type { GeneCheck, GeneHit, GeneSetHit } from "../../lib/genes.ts";
import { api } from "../lab/api.ts";
import { useGeneLists, type GeneList } from "./gene-lists.ts";
import { cn } from "../../lib/cn";

// ---- the catalog, asked once per symbol per page ----------------------------------------------

const known = new Map<string, GeneCheck>();

/** each symbol's check, fetched for those not yet asked; `pending` while any is in flight */
function useSymbolChecks(symbols: string[]): { checks: Map<string, GeneCheck>; pending: boolean; error: string | null } {
  const [, bump] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const missing = symbols.filter((s) => !known.has(s));
  const key = missing.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    setError(null);
    const t = setTimeout(() => {
      api.genes({ symbols: key.split(",") }).then((r) => r.json()).then((j) => {
        if (j.error) throw new Error(j.error);
        for (const c of j.checks as GeneCheck[]) known.set(c.symbol, c);
        if (live) bump((n) => n + 1);
      }).catch((e) => { if (live) setError(String(e.message || e)); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key]);
  return { checks: known, pending: missing.length > 0 && !error, error };
}

function useSearch(q: string): { genes: GeneHit[]; sets: GeneSetHit[]; loading: boolean } {
  const [res, setRes] = useState<{ q: string; genes: GeneHit[]; sets: GeneSetHit[] }>({ q: "", genes: [], sets: [] });
  useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    const t = setTimeout(() => {
      api.genes({ search: q }).then((r) => r.json()).then((j) => { if (live && !j.error) setRes({ q, genes: j.genes, sets: j.sets }); }).catch(() => {});
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return { genes: res.q === q ? res.genes : [], sets: res.q === q ? res.sets : [], loading: !!q.trim() && res.q !== q };
}

// ---- the dialog -----------------------------------------------------------------------------

export interface GeneQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** what the query is for, under the title; "" for none */
  description?: string;
  mode: GeneQueryMode;
  /** the query as the page holds it */
  value: string;
  /** the query applied: its text, as the reader left it, and what it says */
  onApply: (text: string, check: QueryCheck) => void;
  /** the fewest and most distinct genes the place it is for takes */
  min?: number;
  max?: number;
  /** in "genes" mode, whether `[A B]` merged rows are taken (the oncoprint's) */
  groups?: boolean;
  /** what the confirming button says, when it does more than apply the text ("Submit query") */
  applyLabel?: string;
}

export function GeneQueryDialog(p: GeneQueryDialogProps) {
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      {p.open && <GeneQueryBody {...p} />}
    </Dialog>
  );
}

const PLACEHOLDER: Record<GeneQueryMode, string> = {
  oql: "KRAS: MUT\nBRAF: V600E\nCDKN2A: HOMDEL",
  genes: "TP53 KRAS PIK3CA",
};

/** what the editor's text says, and what stands between it and being used */
export interface GeneEditorStatus {
  text: string; check: QueryCheck;
  /** each problem in words; empty when the text can be used */
  problems: string[];
  /** symbols are still being checked */
  pending: boolean;
  blocked: boolean;
}

/**
 * The gene query editor itself — search, the text, the check of every line, the lists and the help —
 * for a dialog (GeneQueryDialog) or a page that asks for genes in place (the homepage's query step).
 * It keeps the text being typed to itself and reports it, with what it says, through `onChange`.
 */
export function GeneQueryEditor({ mode, value, onChange, onSubmit, min = 1, max = 30, groups = false, sideClass }: {
  mode: GeneQueryMode;
  /** the text it starts from */
  value: string;
  onChange?: (status: GeneEditorStatus) => void;
  /** ⌘/Ctrl+Enter, when the text can be used */
  onSubmit?: () => void;
  min?: number; max?: number; groups?: boolean;
  /** the side panel's height limit (a dialog caps it to the window) */
  sideClass?: string;
}) {
  const [text, setText] = useState(value);
  const [q, setQ] = useState("");
  const [setError, setSetError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const lists = useGeneLists();
  const check = useMemo(() => checkGeneQuery(text, mode), [text, mode]);
  const { checks, pending, error: checkError } = useSymbolChecks(check.genes);
  const found = useSearch(q);

  const sep = mode === "oql" ? "\n" : " ";
  const append = (more: string[]) => {
    const have = new Set(check.genes);
    const add = more.map((g) => g.toUpperCase()).filter((g) => !have.has(g));
    if (!add.length) return;
    setText((t) => (t.trim() ? t.replace(/\s+$/, "") + sep : "") + add.join(sep));
    setQ("");
    area.current?.focus();
  };
  const addSet = (name: string) => {
    setSetError(null);
    api.genes({ geneset: name }).then((r) => r.json()).then((j) => { if (j.error) setSetError(j.error); else append(j.members); })
      .catch((e) => setSetError(String(e.message || e)));
  };

  // what stands between the text and Apply, each said in words
  const aliases = check.genes.map((g) => checks.get(g)).filter((c): c is GeneCheck => c?.status === "alias");
  const unknown = check.genes.map((g) => checks.get(g)).filter((c): c is GeneCheck => c?.status === "unknown");
  const entryErrors = check.entries.filter((e) => e.error);
  const problems = [
    check.error,
    mode === "genes" && !groups && check.tracks?.some((t) => typeof t !== "string") ? "merged rows ([A B]) are the oncoprint's; list each gene on its own here" : null,
    ...entryErrors.map((e) => e.text + " — " + e.error),
    ...unknown.map((c) => c.symbol + " is not a gene symbol"),
    ...aliases.map((c) => c.symbol + " is an alias of " + c.hugo!.join(" / ")),
    !check.genes.length ? "enter at least " + (min === 1 ? "one gene" : min + " genes") : null,
    check.genes.length && check.genes.length < min ? "this takes at least " + min + " genes; there are " + check.genes.length : null,
    check.genes.length > max ? "this takes at most " + max + " genes; there are " + check.genes.length : null,
  ].filter(Boolean) as string[];
  const blocked = problems.length > 0 || pending;
  const fixAll = () => setText((t) => aliases.reduce((acc, c) => c.hugo!.length === 1 ? replaceSymbol(acc, c.symbol, c.hugo![0]) : acc, t));

  const mine = (l: GeneList) => l.mode === mode;

  useEffect(() => { onChange?.({ text, check, problems, pending, blocked }); }, [text, check, problems.join("\n"), pending]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_17rem]">
          {/* ---- the query ---- */}
          <div className="flex min-w-0 flex-col gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search genes, aliases or gene sets…" aria-label="search genes"
                className={cn(FIELD, "h-9 pl-8")}
                onKeyDown={(e) => { if (e.key === "Enter" && found.genes[0]) { e.preventDefault(); append([found.genes[0].symbol]); } }} />
              {q.trim() && (
                <div role="listbox" aria-label="matching genes" className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                  {found.loading && <div className="waiting px-2 py-1.5"><span className="spinner" /> searching…</div>}
                  {!found.loading && !found.genes.length && !found.sets.length && <div className="px-2 py-1.5 text-sm text-muted-foreground">no gene or gene set matches “{q}”</div>}
                  {found.genes.map((g) => (
                    <button key={g.symbol} type="button" role="option" aria-selected={false} onClick={() => append([g.symbol])}
                      className="flex w-full items-baseline gap-2 rounded-sm border-0 bg-transparent px-2 py-1 text-left hover:bg-accent">
                      <span className="font-mono text-md font-medium">{g.symbol}</span>
                      <span className="text-sm text-muted-foreground">{g.aliasOf ? "for “" + g.aliasOf + "” (alias)" : g.type}</span>
                      {check.genes.includes(g.symbol.toUpperCase()) && <Check className="ml-auto size-3.5 text-primary" aria-label="already in the query" />}
                    </button>
                  ))}
                  {found.sets.length > 0 && <div className="mt-1 border-t px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Gene sets</div>}
                  {found.sets.map((s) => (
                    <button key={s.name} type="button" role="option" aria-selected={false} disabled={s.size > 30} onClick={() => addSet(s.name)}
                      data-tip={s.size > 30 ? "has " + s.size + " genes; a query takes at most 30" : "add its " + s.size + " genes"}
                      className="flex w-full items-baseline gap-2 rounded-sm border-0 bg-transparent px-2 py-1 text-left hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent">
                      <span className="min-w-0 truncate font-mono text-sm">{s.name}</span>
                      <span className="ml-auto shrink-0 text-sm text-muted-foreground tabular-nums">{s.size} genes</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {setError && <p className="m-0 text-sm text-destructive">{setError}</p>}
            <Textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={6}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !blocked) onSubmit?.(); }}
              aria-label={mode === "oql" ? "OQL query" : "gene list"} placeholder={PLACEHOLDER[mode] + (groups ? " [\"RTK\" EGFR ERBB2 MET]" : "")}
              className="min-h-36 bg-paper font-mono text-md md:text-md" />
            {/* every entry as it reads */}
            <div className="rounded-md border" aria-live="polite">
              <div className="flex items-center gap-2 border-b px-2.5 py-1.5 text-sm text-muted-foreground">
                <span className="font-semibold tracking-wide uppercase">Check</span>
                <span className="tabular-nums">{check.genes.length} gene{check.genes.length === 1 ? "" : "s"}</span>
                {pending && <span className="waiting"><span className="spinner" /> checking symbols…</span>}
                {checkError && <span className="text-destructive">could not check symbols: {checkError}</span>}
                {aliases.some((c) => c.hugo!.length === 1) && (
                  <Button variant="link" size="inline" className="ml-auto" onClick={fixAll}>use the official symbols</Button>
                )}
              </div>
              <ul className="m-0 max-h-48 list-none overflow-y-auto p-0">
                {check.error && <li className="flex gap-2 px-2.5 py-1 text-sm text-destructive"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{check.error}</li>}
                {!check.entries.length && !check.error && <li className="px-2.5 py-1.5 text-sm text-muted-foreground">nothing entered yet</li>}
                {check.entries.map((e, i) => {
                  const cs = e.genes.map((g) => checks.get(g));
                  const bad = e.error || cs.some((c) => c?.status === "unknown");
                  const alias = cs.find((c) => c?.status === "alias");
                  const wait = cs.some((c) => !c);
                  return (
                    <li key={i} className="flex items-baseline gap-2 border-b px-2.5 py-1 text-sm last:border-b-0">
                      {bad ? <CircleAlert className="size-3.5 shrink-0 translate-y-0.5 text-destructive" aria-label="problem" />
                        : alias ? <TriangleAlert className="size-3.5 shrink-0 translate-y-0.5 text-mark" aria-label="alias" />
                        : wait ? <span className="spinner shrink-0" />
                        : <Check className="size-3.5 shrink-0 translate-y-0.5 text-primary" aria-label="ok" />}
                      <code className="shrink-0 font-mono text-md">{e.text}</code>
                      <span className={cn("min-w-0", bad ? "text-destructive" : "text-muted-foreground")}>
                        {e.error ? e.error
                          : cs.filter((c) => c?.status === "unknown").length ? cs.filter((c) => c?.status === "unknown").map((c) => c!.symbol).join(", ") + " is not a gene symbol"
                          : alias ? <>alias of {alias.hugo!.map((h, k) => <span key={h}>{k ? " / " : ""}
                              <Button variant="link" size="inline" className="font-mono" onClick={() => setText((t) => replaceSymbol(t, alias.symbol, h))}>{h}</Button></span>)} — click to use it</>
                          : e.meaning}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex items-center gap-2">
          {saving == null
                ? <Button variant="outline" size="sm" className={TB} disabled={!check.genes.length} onClick={() => setSaving("")}><BookmarkPlus />Save list…</Button>
                : <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (saving.trim()) { lists.save(saving, text, mode); setSaving(null); } }}>
                    <Input autoFocus value={saving} onChange={(e) => setSaving(e.target.value)} placeholder="name this list" aria-label="list name" className={cn(FIELD, "w-48")} />
                    <Button size="sm" className={cn(TB, "font-medium")} type="submit" disabled={!saving.trim()}>Save</Button>
                    <Button variant="ghost" size="icon-xs" type="button" aria-label="cancel saving" onClick={() => setSaving(null)}><X /></Button>
                  </form>}
            </div>
          </div>
          {/* ---- lists and help ---- */}
          <Tabs defaultValue={lists.recent.some(mine) || lists.saved.some(mine) ? "recent" : "help"} className="min-w-0 gap-2.5">
            <TabsList className={SEG_TABS} aria-label="gene lists and help">
              <TabsTrigger value="recent" className={SEG_TAB}><History />Recent</TabsTrigger>
              <TabsTrigger value="saved" className={SEG_TAB}><Star />Saved</TabsTrigger>
              <TabsTrigger value="help" className={SEG_TAB}>{mode === "oql" ? "OQL help" : "Syntax"}</TabsTrigger>
            </TabsList>
            <TabsContent value="recent" className={cn("m-0 overflow-y-auto pr-1", sideClass)}>
              <ListOf items={lists.recent.filter(mine)} empty="Queries you apply are kept here, in this browser." onUse={setText}
                onRemove={(l) => lists.forget(l.at)} />
            </TabsContent>
            <TabsContent value="saved" className={cn("m-0 overflow-y-auto pr-1", sideClass)}>
              <ListOf items={lists.saved.filter(mine)} empty="Save a query you will reuse — “Save list…” below. Saved in this browser." onUse={setText}
                onRemove={(l) => lists.unsave(l.name!)} />
            </TabsContent>
            <TabsContent value="help" className={cn("m-0 overflow-y-auto pr-1", sideClass)}>
              {mode === "oql" ? (
                <div className="flex flex-col gap-1">
                  {OQL_HELP.map((h) => (
                    <button key={h.q} type="button" onClick={() => setText((t) => (t.trim() ? t.replace(/\s+$/, "") + "\n" : "") + h.q)}
                      data-tip="add this line to the query" className="rounded-sm border-0 bg-transparent px-1.5 py-1 text-left hover:bg-accent">
                      <code className="block font-mono text-sm font-medium">{h.q}</code>
                      <span className="block text-xs text-muted-foreground">{h.means}</span>
                    </button>
                  ))}
                  <p className="mt-1.5 mb-0 text-xs text-muted-foreground">Entries on separate lines (or split by “;” or “,”) are alternatives: a patient is altered if any of them matches. {OQL_REFUSED}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <p className="m-0">Symbols separated by spaces, commas or new lines: <code className="font-mono">TP53 KRAS PIK3CA</code>.</p>
                  {groups && <p className="m-0"><code className="font-mono">[EGFR ERBB2]</code> draws both as one merged row; a label goes first in quotes: <code className="font-mono">[&quot;RTK&quot; EGFR ERBB2 MET]</code>.</p>}
                  <p className="m-0">Per-gene OQL (<code className="font-mono">TP53: MUT</code>) is not taken here — a row draws every alteration type its gene has. To restrict the patients, give the view a cohort with an OQL clause.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
    </div>
  );
}

function GeneQueryBody({ onOpenChange, title, description, mode, value, onApply, min = 1, max = 30, groups = false, applyLabel = "Apply" }: GeneQueryDialogProps) {
  const lists = useGeneLists();
  const [status, setStatus] = useState<GeneEditorStatus | null>(null);
  const blocked = !status || status.blocked;
  const about = description ?? (mode === "oql" ? "One gene per line, optionally with what counts as altered in it (OQL)." : "Gene symbols separated by spaces" + (groups ? "; [A B] draws A and B as one row." : "."));
  const apply = () => { if (!status || status.blocked) return; lists.remember(status.text, mode); onApply(status.text.trim(), status.check); onOpenChange(false); };
  return (
    <DialogContent data-tw className="gene-query-dialog top-[6vh] max-h-[88vh] translate-y-0 gap-4 overflow-y-auto sm:max-w-4xl" {...(about ? {} : { "aria-describedby": undefined })}>
      <DialogHeader>
        <DialogTitle className="text-lg">{title}</DialogTitle>
        {about && <DialogDescription className="text-md">{about}</DialogDescription>}
      </DialogHeader>
      <GeneQueryEditor mode={mode} value={value} min={min} max={max} groups={groups} onChange={setStatus} onSubmit={apply}
        sideClass="max-h-[max(10rem,calc(88vh-15rem))]" />
      <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 items-center gap-2 border-t bg-card px-6 py-3">
        <span className="text-sm text-muted-foreground" data-tip={status?.problems.join("\n")}>
          {status?.pending ? "checking symbols…" : status?.problems.length ? status.problems.length + " to fix" : ""}
        </span>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={apply} disabled={blocked} data-tip={blocked ? (status?.pending ? "waiting for the symbols to be checked" : status?.problems.join("\n")) : applyLabel.toLowerCase() + " (⌘/Ctrl+Enter)"}>{applyLabel}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ListOf({ items, empty, onUse, onRemove }: { items: GeneList[]; empty: string; onUse: (text: string) => void; onRemove: (l: GeneList) => void }) {
  if (!items.length) return <p className="m-0 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((l) => (
        <li key={l.name ?? l.at} className="group flex items-start gap-1 rounded-sm hover:bg-accent">
          <button type="button" className="min-w-0 flex-1 border-0 bg-transparent px-1.5 py-1 text-left" onClick={() => onUse(l.text)} data-tip={"use this query:\n" + l.text}>
            {l.name && <span className="block text-sm font-medium">{l.name}</span>}
            <code className="line-clamp-2 block font-mono text-xs break-all text-muted-foreground">{l.text.replace(/\n/g, "; ")}</code>
          </button>
          <Button variant="ghost" size="icon-xs" className="mt-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="remove from this list" onClick={() => onRemove(l)}><Trash2 /></Button>
        </li>
      ))}
    </ul>
  );
}

/** the dialog over a gene view's `genes` — the lab's gene views and the oncoprint card alike */
export function ViewGenesDialog({ view, open, onOpenChange, onGenes }: {
  view: { kind?: string; genes?: unknown } | null; open: boolean; onOpenChange: (open: boolean) => void;
  onGenes: (genes: GeneTrackSpec[]) => void;
}) {
  const kind = view?.kind || "view";
  // co-occurrence and co-expression are pairwise: one gene yields no pairs
  const min = kind === "cooccurrence" || kind === "coexpression" ? 2 : 1;
  return (
    <GeneQueryDialog open={open && !!view} onOpenChange={onOpenChange} title={"Genes — " + (VIEW_NOUN[kind] || kind)} mode="genes"
      value={formatGeneList(view?.genes)} min={min} max={MAX_GENE_SYMBOLS} groups={kind === "oncoprint"}
      description={min === 2 ? "This view compares genes in pairs, so it needs at least two." : undefined}
      onApply={(_, c) => { if (c.tracks) onGenes(c.tracks); }} />
  );
}
const VIEW_NOUN: Record<string, string> = { oncoprint: "oncoprint", compare: "compare", cooccurrence: "co-occurrence", coexpression: "co-expression", hotspots: "lollipop" };
