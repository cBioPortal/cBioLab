"use client";
// The chrome every view card shares, and the small controls inside it: the header (ViewHead), its
// menus, the cohort and value pickers, the axis picker, the gene inputs. Module-level components,
// so React keeps their state across the analysis page's renders.
import { useState } from "react";
import { attributeLabel } from "../../lib/custom-data-names.ts";
import type { AnalysisSource, ViewParticipation } from "../../lib/types.ts";
import { VIEW_HELP } from "../../lib/view-help.ts";
import { SERIES, seriesStyle } from "../../lib/chart/style.ts";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { ArrowDown, ArrowUp, Ellipsis, ExternalLink, ListChecks, Lock, LockOpen, Pencil, Plus, Save, Split, StickyNote, Trash2 } from "lucide-react";
import { GeneQueryDialog } from "../_genes/GeneQueryDialog.tsx";
import type { GeneQueryMode, QueryCheck } from "../../lib/gene-query.ts";
import { oqlStatements } from "../../lib/oql-parse.ts";
import { OQL_STATEMENT_CAP } from "../../lib/plot-oql.ts";
import { plottableProfiles, profileGroup, profileUse, type ProfileInfo } from "../../lib/profile-catalog.ts";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../_ui/select";
import { Button } from "../_ui/button";
import { cn } from "../../lib/cn";
import { OptionSelect } from "../_ui/choice.tsx";
import { FIELD } from "../_ui/toolbar.ts";
import { Checkbox } from "../_ui/checkbox";
import { GearMenu, MenuItem, MenuSeparator } from "../_ui/gear-menu.tsx";

/** the cohort colours, in order, for every chart on the page: the figures' own (lib/chart/style.ts) */
export const CAT_COLORS = SERIES;

/** series `i`'s swatch, as the figures draw it: past the sixth, the colour repeats with the line's dash */
export function SeriesSwatch({ i }: { i: number }) {
  const st = seriesStyle(i);
  if (!st.dash) return <span className="cohortswatch" aria-hidden="true" style={{ background: st.color }} />;
  return (
    <svg className="cohortswatch dashed" viewBox="0 0 16 10" aria-hidden="true">
      <line x1="0" y1="5" x2="16" y2="5" stroke={st.color} strokeWidth="2.5" strokeDasharray={st.dash} />
    </svg>
  );
}

export function Participation({ p }: { p?: ViewParticipation }) {
  if (!p || !p.studies.length) return null;
  // Two ORTHOGONAL facts, deliberately not merged into one word. The method is
  // uniform — every view but the oncoprint is computed from aggregates no matter
  // who answers — so a label like "mixed" would wrongly suggest the feature
  // itself varies. What can vary is the SOURCES: whether some study was answered
  // by an instance that will not disclose patients, or by a remote peer.
  const restricted = p.studies.filter(x => x.mode === "aggregate-only");
  const remotes = restricted.filter(x => x.remote);
  const method = p.requiresPatientLevel ? "patient-level" : "aggregate-only";
  const methodTitle = p.requiresPatientLevel
    ? "This view's output IS patients, so it needs identities from each contributing instance; an aggregate-only participant cannot contribute columns."
    : "Computed entirely from aggregates. Every participant answered with counts — no identifier was needed from any of them, whatever each instance would have permitted.";
  const srcTitle = p.studies.map(x =>
    x.study + " — " + x.mode + (x.remote ? " (remote MCP peer)" : "")).join("\n");
  const srcLabel = !restricted.length ? null
    : remotes.length === restricted.length
      ? restricted.length + (restricted.length === 1 ? " source via MCP peer" : " sources via MCP peers")
      : restricted.length + (restricted.length === 1 ? " aggregate-only source" : " aggregate-only sources");
  return (
    <span className="partwrap">
      <span className={"partbadge " + (p.requiresPatientLevel ? "pl" : "agg")}
        title={methodTitle + "\n\n" + srcTitle}>
        <i aria-hidden="true" />{method}
      </span>
      {srcLabel && (
        <span className="partbadge src"
          title={srcTitle + "\n\nNo patient identifier left " +
            restricted.map(x => x.study).join(", ") + "."}>
          {srcLabel}
        </span>
      )}
    </span>
  );
}

/**
 * A field that takes genes or OQL, entered only through the app's gene query dialog (search, a check
 * of every entry, alias fixes, remembered lists): it shows the value and opens the dialog when
 * clicked or typed into, so a half-typed or misspelt gene never reaches the document. It does not
 * open on focus alone, because the dialog hands focus back to it on closing.
 */
function QueryField({ mode, value, shown, placeholder, max, title, description, busy, className, onApply }: {
  mode: GeneQueryMode; value: string; shown: string; placeholder: string; max: number; title: string; description: string;
  busy?: boolean; className?: string; onApply: (text: string, check: QueryCheck) => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" disabled={busy} aria-haspopup="dialog" aria-label={title + (shown ? ": " + shown : "")}
      title={(shown || placeholder) + " — click to choose"}
      className={cn(FIELD, "flex min-w-0 items-center gap-1.5 rounded-md border border-input px-1.5 text-left shadow-xs outline-none",
        "hover:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50", className)}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => { if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setOpen(true); } }}>
      <span className={cn("min-w-0 flex-1 truncate", !shown && "text-muted-foreground")}>{shown || placeholder}</span>
      <ListChecks className="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
    </button>
    <GeneQueryDialog open={open} onOpenChange={setOpen} title={title} description={description} mode={mode} value={value} max={max} onApply={onApply} />
  </>;
}


/**
 * One axis of a plot. Its Data is one choice from a grouped list: a clinical attribute, each of the
 * study's own profiles under its alteration type (named as the study names it), or a query across
 * genes (an OQL query). What the choice needs next follows from it: an attribute; a gene, and for
 * a mutation profile how to group the mutations; or the query.
 */
export function AxisPicker({ side, axis, attrs, catalog, busy, loading, onChange, allowNone, categorical, stacked }: {
  side: string; axis: any; busy?: boolean;
  attrs: { attribute: string; kind: string }[];
  /** the studies' profiles as they describe them (lib/profile-catalog.ts) */
  catalog: ProfileInfo[];
  /** the attribute/profile catalog is still being fetched: its select waits with a loader */
  loading?: boolean;
  onChange: (a: any) => void;
  /** a colour is optional in a way an axis is not */
  allowNone?: boolean;
  /** colours come from categories, so a profile of numbers is not on offer */
  categorical?: boolean;
  /** one labelled field per row at the box's full width (a plot's axis sidebar), not a toolbar run */
  stacked?: boolean;
}) {
  const a = axis || {};
  const set = (next: any) => onChange(next);
  const w = stacked ? "w-full max-w-none" : "max-w-44";
  /** a control with its name above it when stacked; inline, the toolbar's side label names the run */
  const field = (name: string, control: React.ReactNode, extra?: React.ReactNode) =>
    stacked ? <div className="axfield flex flex-col gap-1"><span className="axfield-name text-sm font-semibold text-foreground">{name}</span>
      {extra ? <div className="flex min-w-0 gap-1">{control}{extra}</div> : control}</div>
      : <>{control}{extra}</>;
  const profiles = plottableProfiles(catalog);
  const offered = (p: ProfileInfo) => { const u = profileUse(p); return !categorical || u === "mutation" || u === "sv" || u === "discrete" || u === "assayCategory"; };
  // what the axis holds, as one of the Data list's values; a form the document gives directly
  // (a molecular profile, a gene's alterations) shows as the profile it reads
  const byUse = (u: string) => profiles.find((p) => profileUse(p) === u)?.profile;
  const data: string = !axis ? "none"
    : a.source === "clinical" ? "clinical"
    : a.source === "profile" ? "profile:" + a.profile
    : a.source === "molecular" ? "profile:" + a.profileType
    : a.source === "alteration" && a.oql != null ? "oql"
    // a gene set (any mutated) shows as the OQL query that asks the same
    : a.source === "alteration" && Array.isArray(a.genes) && a.genes.length > 1 ? "oql"
    : a.source === "alteration" ? "profile:" + (byUse(a.by === "cna" ? "discrete" : a.by === "sv" ? "sv" : "mutation") || "")
    : "clinical";
  const current = data.startsWith("profile:") ? catalog.find((p) => "profile:" + p.profile === data) : undefined;
  const use = current ? profileUse(current) : null;
  const gene = String(a.gene || (Array.isArray(a.genes) ? a.genes[0] : "") || (a.oql ? (/^\s*([A-Za-z0-9.-]+)/.exec(a.oql) || [])[1] || "" : "") || "TP53").toUpperCase();
  const choose = (v: string) => {
    if (v === "none") return set(undefined);
    if (v === "clinical") return set({ source: "clinical", attribute: a.attribute || (attrs[0] || {}).attribute || "" });
    if (v === "oql") return set({ source: "alteration", oql: a.oql || gene + ": MUT" });
    const p = catalog.find((x) => "profile:" + x.profile === v);
    if (p) set({ source: "profile", profile: p.profile, gene, ...(profileUse(p) === "mutation" ? { by: a.by === "mutated" ? "mutated" : "mutationType" } : {}) });
  };
  // the Data list: the profiles grouped under their type, in the study's own order
  const groups: { label: string; items: { value: string; label: string; disabled?: string }[] }[] = [];
  groups.push({ label: "Clinical", items: [{ value: "clinical", label: "Clinical attribute" }] });
  for (const p of profiles) {
    if (!offered(p)) continue;
    const g = profileGroup(p);
    const at = groups.find((x) => x.label === g) || (groups.push({ label: g, items: [] }), groups[groups.length - 1]);
    const assay = p.type === "GENERIC_ASSAY";
    at.items.push({ value: "profile:" + p.profile, label: p.name, ...(assay ? { disabled: "generic assays (" + p.name + ") come to plot axes next" } : {}) });
  }
  groups.push({ label: "Across genes", items: [{ value: "oql", label: "OQL query" }] });
  const dataPicker = loading && !catalog.length && !attrs.length ? <Waiting what="profiles" /> : (
    <Select value={data} onValueChange={choose} disabled={busy}>
      <SelectTrigger size="sm" aria-label={side + " data"} title={current ? current.name : "what this axis measures"}
        className={cn("h-ctl gap-1 bg-card px-2 text-md data-[size=sm]:h-ctl [&_svg:not([class*='size-'])]:size-3.5 [&>span]:truncate", w)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-96">
        {allowNone && <SelectItem value="none" className="text-md">none</SelectItem>}
        {!groups.some((g) => g.items.some((i) => i.value === data)) && data !== "none" &&
          <SelectItem value={data} className="text-md">{data.replace(/^profile:/, "")} (not in this study)</SelectItem>}
        {groups.map((g, gi) => (
          <SelectGroup key={g.label} className={cn(gi > 0 && "mt-1 border-t pt-1")}>
            <SelectLabel className="mx-1 rounded-xs bg-muted px-2 py-1 text-xs font-semibold text-foreground">{g.label}</SelectLabel>
            {g.items.map((i) => <SelectItem key={i.value} value={i.value} disabled={!!i.disabled} title={i.disabled || i.label} className="pl-5 text-md">{i.label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
  const isOql = data === "oql";
  // the query as the OQL field shows it: the axis's own, or a gene set's equivalent ("any mutated")
  const oql: string = a.oql != null ? a.oql : Array.isArray(a.genes) ? a.genes.map((g: string) => String(g).toUpperCase() + ": MUT").join(", ") : "";
  return (
    <span className={stacked ? "axispick-stack flex flex-col gap-2.5" : "axispick"}>
      {!stacked && <span className="tbl">{side}</span>}
      {field("Data", dataPicker)}
      {data === "clinical" && loading && !attrs.length && field("Clinical attribute", <Waiting what="attributes" />)}
      {data === "clinical" && !(loading && !attrs.length) && field("Clinical attribute",
        <OptionSelect className={w} value={a.attribute || ""} disabled={busy} title="which clinical attribute" ariaLabel={side + " clinical attribute"}
          onValueChange={(v) => set({ ...a, attribute: v })}>
          {!attrs.some((x) => x.attribute === a.attribute) && <option value={a.attribute || ""}>{a.attribute || "(none)"}</option>}
          {attrs.map((x) => <option key={x.attribute} value={x.attribute}>{attributeLabel(x.attribute)}{x.kind === "num" ? "" : " (categorical)"}</option>)}
        </OptionSelect>
      )}
      {current && use !== "assayNumber" && use !== "assayCategory" && <>
        {field("Gene", <QueryField mode="genes" value={gene} shown={gene} placeholder="choose a gene" busy={busy}
            className={stacked ? "w-full" : "w-28"} title="Gene for this axis"
            // a mutation axis reads one gene; several become an OQL query with a group per gene
            max={use === "mutation" ? OQL_STATEMENT_CAP : 1}
            description={use === "mutation"
              ? "The gene whose mutations this axis groups. Apply several to give each its own group: the axis becomes an OQL query, one group per gene."
              : "The gene whose " + current.name + " this axis reads. To compare several genes, choose OQL query under Data."}
            onApply={(_t, c) => c.genes.length > 1 && use === "mutation"
              ? set({ source: "alteration", oql: c.genes.map((g) => g + ": MUT").join(", "), by: "statement" })
              : set({ ...(a.source === "profile" ? a : { source: "profile", profile: current.profile }), gene: c.genes[0] || "" })} />)}
        {use === "mutation" && field("Plot mutations by",
          <OptionSelect className={w} value={a.by === "mutated" ? "mutated" : "mutationType"} disabled={busy} ariaLabel={side + " mutations by"}
            title="group the cases by their mutation's type, or by whether they have one"
            onValueChange={(v) => set({ source: "profile", profile: current.profile, gene, by: v })}>
            <option value="mutationType">mutation type</option>
            <option value="mutated">mutated vs not</option>
          </OptionSelect>)}
      </>}
      {isOql && <>
        {field("Group cases by",
          <OptionSelect className={w} value={a.by === "statement" ? "statement" : "any"} disabled={busy} ariaLabel={side + " OQL grouping"}
            title={a.by === "statement" ? "a group for each line of the query; a case matching two is their pair, none Unaltered (or Not profiled)"
              : "Altered when a case matches any line of the query; Unaltered when it matches none and is profiled for every gene, else Not profiled"}
            onValueChange={(v) => set(v === "statement" ? { source: "alteration", oql, by: "statement" } : { source: "alteration", oql })}>
            <option value="any">any line (Altered or not)</option>
            <option value="statement">one group per line</option>
          </OptionSelect>)}
        {field("OQL query", <QueryField mode="oql" value={oqlStatements(oql).join("\n")} shown={oqlStatements(oql).join(", ")} placeholder="choose genes or OQL"
            className={stacked ? "w-full" : "w-56"} busy={busy} title="OQL for this axis"
            max={a.by === "statement" ? OQL_STATEMENT_CAP : 30}
            description={a.by === "statement" ? "Each line is its own group; a case matching two is their pair. A bare gene means any alteration in it."
              : "A case is Altered if any line matches. A bare gene means any alteration in it; add OQL to be specific."}
            onApply={(text) => set({ source: "alteration", oql: oqlStatements(text).join(", "), ...(a.by === "statement" ? { by: "statement" } : {}) })} />)}
      </>}
    </span>
  );
}

/**
 * The "?" in every view's header: a plain-language explanation of what this KIND of view is —
 * for a reader who isn't a scientist, not the DSL's own precise documentation (lib/dsl-reference.ts
 * is for someone writing a document; this is for someone reading the figure). One component in
 * ViewHead means every view kind gets it for free, with nothing to add at each view's own JSX.
 */
export function ViewHelpButton({ kind, menuId, menuStore }: { kind: string; menuId: string; menuStore: Map<string, boolean> }) {
  const help = VIEW_HELP[kind];
  if (!help) return null;
  return (
    <GearMenu menuId={menuId} menuStore={menuStore} label="?" title="what this view is, in plain language"
      ariaLabel="what this view is, in plain language" wide contentClassName="p-3">
      <p className="viewhelp-text">{help.text}</p>
    </GearMenu>
  );
}

/**
 * What a view's `splitBy` (set in the document; the page no longer offers it — cohort splits
 * replace it) actually did, once results are in: which raw values got pooled into
 * "Other" rather than getting their own arm, and how many patients landed in more than one arm.
 * Arms are never forced into a strict partition (a patient can match 2+ oql queries, or already
 * hold 2+ values of a sample-level attribute), so this is the one place that says by how much —
 * silence here would read as "these arms are disjoint," which isn't always true. Renders nothing
 * when there's nothing to disclose (a clean split with no pooling and no overlap).
 */
export function SplitByNote({ v }: { v: any }) {
  const sb = v.splitBy;
  if (!sb) return null;
  const label = sb.gene ? "gene " + sb.gene : sb.oql ? "oql (" + sb.oql.length + " quer" + (sb.oql.length === 1 ? "y" : "ies") + ")" : sb.attribute;
  const bits: string[] = [];
  if (sb.otherValues && sb.otherValues.length)
    bits.push("“Other” pools " + sb.otherValues.length + " value" + (sb.otherValues.length === 1 ? "" : "s") +
      " not shown as its own arm: " + sb.otherValues.join(", "));
  if (sb.overlapCount)
    bits.push(sb.overlapCount.toLocaleString() + " patient" + (sb.overlapCount === 1 ? "" : "s") +
      " counted toward more than one arm — split arms aren't a strict partition, so this can happen even outside “Other”");
  if (!bits.length) return null;
  return <p className="viewnote" title={"split “" + sb.cohort + "” by " + label}>{bits.join(" · ")}</p>;
}

/**
 * A checkbox menu in a view's header: which cohorts it uses, which attributes it compares.
 * One component, because these were the settings you could only reach by editing the JSON.
 */
export function PickMenu({ label, title, options, chosen, onChange, min, max, busy, loading, menuId, menuStore }: {
  label: string; title: string; busy?: boolean; min?: number; max?: number; menuId: string; menuStore: Map<string, boolean>;
  /** the options are still being fetched */
  loading?: boolean;
  options: { value: string; label: string; hint?: string }[];
  chosen: string[]; onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    const has = chosen.includes(v);
    if (has && min != null && chosen.length <= min) return;
    onChange(has ? chosen.filter((x) => x !== v) : [...chosen, v]);
  };
  return (
    <GearMenu menuId={menuId} menuStore={menuStore} title={title} contentClassName="max-h-[65vh] overflow-y-auto px-2.5"
      label={<>{label} ({chosen.length}){loading && !options.length && <span className="spinner" />}</>}>
        {options.length === 0 && (loading ? <Waiting what={label} /> : <span className="meta">nothing to choose from</span>)}
        {options.map((o) => {
          const on = chosen.includes(o.value);
          const stuck = on ? (min != null && chosen.length <= min) : (max != null && chosen.length >= max);
          return (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 py-1 text-md" title={stuck ? (on ? "a view needs at least " + min : "at most " + max) : undefined}>
              <Checkbox checked={on} disabled={busy || stuck} onCheckedChange={() => toggle(o.value)} />
              <span>{o.label}{o.hint && <span className="meta"> — {o.hint}</span>}</span>
            </label>
          );
        })}
    </GearMenu>
  );
}

/** one row of a view's cohort picker: a cohort, one of its splits, or one of a split's groups */
export interface CohortNode { name: string; label: string; kind: "cohort" | "split" | "arm"; depth: number; count: number | null; groups?: number;
  /** why this view cannot draw it whole (lib/view-coverage.ts): offered disabled, saying so */
  blocked?: string }

/**
 * Which cohorts a view draws, as the tree they come from: each cohort, its splits under it, each
 * split collapsed to one row that draws all its groups, opened (▸) to pick single groups. Rules,
 * applied as you click rather than refused after:
 *   - ticking anything unticks its own parent and children (a cohort and its own split's groups
 *     would count the same patients twice), so moving between levels is one click;
 *   - a view draws EITHER whole cohorts OR the groups of one split: ticking a split, or a group of
 *     one, replaces whole cohorts and any other split's; ticking a whole cohort replaces a split;
 *   - whole cohorts combine with each other; a one-cohort view (max 1) behaves like radio buttons;
 *   - unticking the last item leaves the view empty, waiting for a cohort (with `onAdd`; without
 *     it the last cannot be unticked — ticking another switches to it);
 *   - "+ add a cohort…" at the foot (`onAdd`) brings in one the analysis does not have yet.
 */
export function CohortPicker({ nodes, chosen, max, busy, onChange, onAdd, menuId, menuStore }: {
  nodes: CohortNode[]; chosen: string[]; max?: number; busy?: boolean;
  onChange: (next: string[]) => void; onAdd?: () => void; menuId: string; menuStore: Map<string, boolean>;
}) {
  const byName = new Map(nodes.map((x) => [x.name, x] as const));
  const splits = nodes.filter((x) => x.kind === "split");
  /** the split a name draws from: itself if a split, else the deepest split it sits under */
  const ownerOf = (n: string): string | null => byName.get(n)?.kind === "split" ? n
    : splits.filter((x) => n.startsWith(x.name + " / ")).sort((a, b) => b.name.length - a.name.length)[0]?.name ?? null;
  const related = (a: string, b: string) => a === b || a.startsWith(b + " / ") || b.startsWith(a + " / ");
  const groupsOf = (n: string) => byName.get(n)?.groups ?? 1;
  const drawn = chosen.reduce((k, n) => k + groupsOf(n), 0);
  const current = chosen.map(ownerOf).find((x) => x) ?? null;
  // a split opens when one of its single groups is chosen, so what is ticked is always visible
  const [open, setOpen] = useState<Set<string>>(() => new Set(chosen.map(ownerOf).filter((o, k) => o && o !== chosen[k]) as string[]));
  // a view drawing one cohort cannot take a whole split: its splits are headings, open, to pick a group
  const single = max === 1;
  const hidden = (n: string) => !single && splits.some((x) => !open.has(x.name) && n.startsWith(x.name + " / "));
  const choose = (n: string) => {
    if (chosen.includes(n)) { if (chosen.length > 1 || onAdd) onChange(chosen.filter((c) => c !== n)); return; }
    const owner = ownerOf(n);
    let kept = max === 1 ? [] : chosen.filter((c) => !related(c, n));
    // whole cohorts, or one split's groups — never a mix
    kept = kept.filter((c) => ownerOf(c) === owner);
    if (max != null && kept.length >= max) return;
    onChange([...kept, n]);
  };
  const row = (o: CohortNode) => {
    const on = chosen.includes(o.name);
    const implied = !on && chosen.some((c) => o.name.startsWith(c + " / ") && byName.get(c)?.kind === "split");
    const last = on && chosen.length === 1 && !onAdd;
    const full = !on && max != null && max > 1 && chosen.filter((c) => !related(c, o.name)).length >= max;
    const mine = ownerOf(o.name);
    const replaces = !on && !implied && chosen.some((c) => ownerOf(c) !== mine);
    const kids = o.kind === "split" ? nodes.filter((x) => x.kind === "arm" && x.name.startsWith(o.name + " / ") && x.depth === o.depth + 1) : [];
    return (
      <div key={o.name} className={"cpick " + o.kind + (implied ? " implied" : "") + (on ? " on" : "")} style={{ paddingLeft: (0.5 + o.depth * 1.15) + "rem" }}>
        <label title={o.blocked && !on ? o.blocked : last ? "a view draws at least one — tick another to switch" : full ? "this view draws at most " + max
            : implied ? "drawn as part of the split — click to draw only this group"
            : replaces ? (mine ? "a view draws one split's groups or whole cohorts — this replaces what is ticked"
              : "a view draws whole cohorts or one split's groups — this replaces “" + current + "”") : o.name}>
          {single && o.kind === "split" ? <span className="cpick-noinput" aria-hidden="true" /> :
            <input type={single ? "radio" : "checkbox"} checked={on || implied} disabled={busy || full || (!!o.blocked && !on)}
              onChange={() => choose(o.name)} onClick={() => { if (last) choose(o.name); }} />}
          <span className="cpick-label">
            <span className="cpick-line">
              {o.kind === "split" ? <><span className="cpick-fork" aria-hidden="true">⑂</span>by {o.label} <span className="meta">· {o.groups} groups</span></> : o.label}
            </span>
            {o.kind === "split" && !open.has(o.name) && !single && <span className="cpick-kids">{kids.map((k) => k.label).join(" · ")}</span>}
          </span>
        </label>
        {o.kind === "split" && single ? <span />
          : o.kind === "split"
          ? <button type="button" className="cpick-open" aria-expanded={open.has(o.name)}
              title={open.has(o.name) ? "hide its groups" : "pick single groups"}
              onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(o.name)) n.delete(o.name); else n.add(o.name); return n; })}>
              {open.has(o.name) ? "▾" : "▸"}
            </button>
          : <span className="cpick-n">{o.count == null ? "" : o.count.toLocaleString()}</span>}
      </div>
    );
  };
  return (
    <GearMenu menuId={menuId} menuStore={menuStore} className="cohortpick" title="which cohorts this view draws — a split draws each of its groups"
      label={"cohorts (" + (drawn === chosen.length ? drawn : drawn + " groups") + ")"}
      contentClassName="max-h-[65vh] max-w-[30rem] min-w-[22rem] gap-0 overflow-y-auto px-0 pt-0 pb-1">
      {(close) => <>
        <div className="cpick-head">Draw in this view</div>
        {nodes.filter((o) => !hidden(o.name)).map(row)}
        {single ? <p className="cpick-foot">This view draws one cohort — pick one, or one group of a split.</p>
          : splits.length > 0 && <p className="cpick-foot">A view draws whole cohorts, or the groups of one split — not both. Choosing one replaces the other.</p>}
        {onAdd && <Button type="button" variant="link" size="inline" className="mx-2.5 mt-1 self-start text-md" disabled={busy}
          title="add a cohort from your library, or build one in Explore"
          onClick={() => { close(); onAdd(); }}><Plus />add a cohort…</Button>}
      </>}
    </GearMenu>
  );
}

/**
 * The line under a view's title saying what it draws: the cohorts, or the split and its groups,
 * each with the colour its curve / column / bar has in the figure (the view colours by position
 * in the list it drew), so the line is both the title and the key.
 */
export function DrawnCohorts({ drawn, nodes }: { drawn: string[]; nodes: CohortNode[] }) {
  if (!drawn.length) return null;
  const byName = new Map(nodes.map((x) => [x.name, x] as const));
  const splits = nodes.filter((x) => x.kind === "split");
  const owner = drawn.map((n) => splits.filter((x) => n.startsWith(x.name + " / ")).sort((a, b) => b.name.length - a.name.length)[0])
    .find((x) => x) || null;
  const swatch = (i: number) => drawn.length > 1 && <SeriesSwatch i={i} />;
  const parent = owner && owner.name.slice(0, owner.name.length - owner.label.length - 3);
  return (
    <p className="viewcohorts">
      <span className="vc-label">Showing</span>
      {owner && <span className="vc-split"><strong>{parent!.split(" / ").join(" › ")}</strong> by {owner.label}:</span>}
      {drawn.map((n, i) => (
        <span key={n} className="vc-item" title={n}>{swatch(i)}
          {owner ? (byName.get(n)?.label ?? n.slice(owner.name.length + 3)) : <strong>{byName.get(n)?.label ?? n}</strong>}
        </span>
      ))}
    </p>
  );
}

/**
 * Which studies a cohort was evaluated in, on one line: the first study's name, and past one a
 * count of the rest that stays visible however long that name is. The tooltip lists every
 * study's id and name.
 */
export function CohortStudies({ ids, names }: { ids: string[]; names: Map<string, string> }) {
  if (!ids.length) return null;
  const more = ids.length - 1;
  const title = (more ? ids.length.toLocaleString() + " studies:\n" : "") +
    ids.map((id) => names.get(id) ? id + " — " + names.get(id) : id).join("\n");
  return (
    <div className="cohortbox-studies meta" title={title}>
      <span className="cohortbox-study">{names.get(ids[0]) || ids[0]}</span>
      {more > 0 && <span className="cohortbox-more">+{more.toLocaleString()} more {more === 1 ? "study" : "studies"}</span>}
    </div>
  );
}

/**
 * Where an analysis's data came from (the result's `sources`): each database of this deployment and
 * each peer reached over MCP, with what the peer reported about itself and when each study's data
 * was imported. Said only when there is more than one source or a remote one; one local database
 * is the default and goes without saying.
 */
export function AnalysisSources({ sources, names }: { sources?: AnalysisSource[]; names: Map<string, string> }) {
  if (!sources || !(sources.length > 1 || sources.some((s) => s.remote))) return null;
  const day = (t: string | null) => (t ? t.slice(0, 10) : "import date unknown");
  const studies = (s: AnalysisSource) => s.studies.map((x) => (names.get(x.study) || x.study) + ", imported " + day(x.imported)).join("; ");
  return (
    <p data-tw className="text-xs text-muted-foreground mt-2.5 mb-0" aria-label="where this analysis's data came from">
      <span className="font-semibold text-foreground">Data from:</span>{" "}
      {sources.map((s, i) => {
        const peer = s.remote ? [
          "over MCP at " + (s.url || "an unknown address"),
          s.reportedName ? "which calls itself “" + s.reportedName + "”" : "which has not described itself",
          s.build ? "build " + s.build : null,
          s.answeredAt ? "first answered " + new Date(s.answeredAt).toLocaleString() : null
        ].filter(Boolean).join(", ") : "this deployment's own database" + (s.build ? ", build " + s.build : "");
        return (
          <span key={i} title={s.label + " — " + peer + "\n" + s.studies.map((x) => x.study + ": imported " + (x.imported || "unknown")).join("\n")}>
            {i > 0 && " · "}<strong className="font-medium text-foreground">{s.label}</strong>
            {" "}({s.remote ? "via MCP" + (s.reportedName && s.reportedName !== s.label ? ", calls itself “" + s.reportedName + "”" : "") : "local"}) — {studies(s)}
          </span>
        );
      })}
    </p>
  );
}

/**
 * Every view's header, with one anatomy: the title and what it is, then the actions that
 * belong to this view, then its status chips, then the controls that reorder and remove it.
 * Before this each view kind built its own, so the timing chip landed in a different place
 * in each card.
 */
export function ViewHead({ v, title, sub, actions, chips, cohorts, cohortInSub, onMoveUp, onMoveDown, onRemove, onEditNote, menuStore }: {
  v: any; title: string; sub?: React.ReactNode; actions?: React.ReactNode; chips?: React.ReactNode;
  /** `sub` names the cohort drawn, so the "Showing" line under the header is left out */
  cohortInSub?: boolean;
  onMoveUp?: () => void; onMoveDown?: () => void; onRemove?: () => void; onEditNote?: () => void; menuStore: Map<string, boolean>;
  /** which cohorts this view draws; absent when the document has only one */
  cohorts?: { chosen: string[]; all: string[]; nodes: CohortNode[]; drawn: string[]; max?: number; busy?: boolean; viewKey: number | string; onChange: (n: string[]) => void; onAdd?: () => void };
}) {
  const menuKey = cohorts?.viewKey ?? "vh";
  return (
    <>
      <div className="vhead">
        <h2 className="vtitle">{title}{sub != null && <span className="plain"> — {sub}</span>}</h2>
        <div className="vmeta">
          <ViewHelpButton kind={v.kind} menuId={"help:" + menuKey} menuStore={menuStore} />
          {cohorts && (cohorts.onAdd || cohorts.all.length > 1) && (
            <CohortPicker nodes={cohorts.nodes} chosen={cohorts.chosen} max={cohorts.max} busy={cohorts.busy}
              onChange={cohorts.onChange} onAdd={cohorts.onAdd} menuId={"pick:" + menuKey} menuStore={menuStore} />
          )}
          {actions}
          {chips}
          <Latency v={v} />
          <Participation p={v.participation} />
          {(onMoveUp || onMoveDown || onRemove || onEditNote) && (
            <ViewMenu menuId={"reorder:" + menuKey} menuStore={menuStore} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
              onRemove={onRemove} onEditNote={onEditNote} hasNote={!!v.annotationNote} />
          )}
        </div>
      </div>
      {/* The analyst's own one-line annotation (doc.views[i].note, echoed
          through as v.annotationNote) — below the title, not above: it's a
          reader's aside about the figure ViewHead just named, not something
          that competes with the title for the first thing read. Plain text
          by design, see .viewnote in globals.css for why it's never markdown. */}
      {cohorts && !cohortInSub && !v.error && <DrawnCohorts drawn={cohorts.drawn} nodes={cohorts.nodes} />}
      {v.annotationNote && <p className="viewnote">{v.annotationNote}</p>}
      <SplitByNote v={v} />
    </>
  );
}

/** The gear at the end of every card's header: reorder this view, or drop it. */
export function ViewMenu({ menuId, menuStore, onMoveUp, onMoveDown, onRemove, onEditNote, hasNote }: {
  menuId: string; menuStore: Map<string, boolean>; onMoveUp?: () => void; onMoveDown?: () => void; onRemove?: () => void;
  onEditNote?: () => void; hasNote?: boolean;
}) {
  return (
    <GearMenu menuId={menuId} menuStore={menuStore} className="viewgear" label={<Ellipsis />} title="reorder or remove this view" ariaLabel="reorder or remove this view">
      {(close) => <>
        <MenuItem disabled={!onMoveUp} onClick={() => { close(); onMoveUp?.(); }}><ArrowUp />move up</MenuItem>
        <MenuItem disabled={!onMoveDown} onClick={() => { close(); onMoveDown?.(); }}><ArrowDown />move down</MenuItem>
        {/* a note belongs to a saved analysis, as a cohort's edits do (see CohortEditMenu), so the
            item only exists once there is a saved analysis for it to belong to */}
        {onEditNote && <>
          <MenuSeparator />
          <MenuItem onClick={() => { close(); onEditNote(); }}><StickyNote />{hasNote ? "edit note…" : "add note…"}</MenuItem>
        </>}
        {onRemove && <>
          <MenuSeparator />
          <MenuItem className="text-destructive hover:text-destructive" onClick={() => { close(); onRemove(); }}><Trash2 />remove</MenuItem>
        </>}
      </>}
    </GearMenu>
  );
}

/**
 * The gear at the top-right of a cohort box: rename it, note it, or drop it
 * from the analysis — "edit…" opens a small dialog for the name and note
 * together (see cohortEditDialog), rather than a form crammed into this
 * dropdown. "edit…" is left OUT of the menu entirely (not just disabled)
 * until the workspace itself is saved: a rename/note on a cohort inside a
 * document that isn't saved anywhere yet has nothing to attach to, and a
 * greyed-out option in an otherwise-live menu reads as broken rather than
 * as "do something else first". Editing the FILTERS themselves isn't here
 * yet — a cohort's clauses come from Explore or hand-typed JSON, and
 * neither has a form this menu could hold; see the comment above the
 * "Cohorts" heading for why that is deliberately a separate, unscoped piece
 * of work.
 */
export function CohortEditMenu({ busy, canEdit, onEdit, onRemove, split, splitCount = 0, save, lock, cells, onCells, menuId, menuStore }: {
  busy?: boolean; canEdit: boolean; onEdit: () => void; onRemove: () => void;
  /** freezing the cohort to the patients it selects now (lib/cohort-lock.ts), or following its definition again */
  lock?: { locked: boolean; onLock: () => Promise<void>; onUnlock: () => void };
  /** the single-cell dataset this cohort's patients can be opened in, when its study has one */
  cells?: { label: string } | null;
  onCells?: () => Promise<void>;
  /** saving the cohort to the library (opening its naming dialog), offered only while it has something to save */
  save?: { onSave: () => Promise<void>; label: string; title: string } | null;
  /** the split form; `done` closes this menu. A cohort may have several splits — each view draws one */
  split?: (done: () => void) => React.ReactNode;
  /** how many splits the cohort has already */
  splitCount?: number;
  menuId: string; menuStore: Map<string, boolean>;
}) {
  const [splitting, setSplitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  return (
    <GearMenu menuId={menuId} menuStore={menuStore} className="cohortgear" label={<Ellipsis />} title="edit this cohort" ariaLabel="edit this cohort"
      wide={splitting} onOpenChange={(o) => { if (!o) setSplitting(false); }}>
      {(close) => <>
        {save && !splitting && <>
          <MenuItem disabled={busy || saving} title={save.title}
            onClick={async () => { setSaving(true); try { await save.onSave(); close(); } finally { setSaving(false); } }}>
            <Save />{save.label}{saving && <span className="spinner ml-1.5" />}</MenuItem>
          <MenuSeparator />
        </>}
        {split && (splitting ? <>{split(() => { close(); setSplitting(false); })}<MenuSeparator /></> : <>
          <MenuItem disabled={busy} title="divide this cohort into arms that never overlap and add up to it"
            onClick={() => setSplitting(true)}><Split />{splitCount ? "split another way…" : "split into arms…"}</MenuItem>
          <MenuSeparator />
        </>)}
        {lock && !splitting && <>
          {lock.locked
            ? <MenuItem disabled={busy} title="follow the definition again: patients who match it from now on join, and those who stop matching leave"
                onClick={() => { close(); lock.onUnlock(); }}><LockOpen />unlock</MenuItem>
            : <MenuItem disabled={busy || locking} title="freeze this cohort, and its split arms, to the patients it selects now, so it stays the same as patients are added to the data"
                onClick={async () => { setLocking(true); try { await lock.onLock(); close(); } finally { setLocking(false); } }}>
                <Lock />lock to these patients{locking && <span className="spinner ml-1.5" />}</MenuItem>}
          <MenuSeparator />
        </>}
        {cells && onCells && !splitting && <>
          <MenuItem disabled={busy} title={"open this cohort's patients' cells in Cell Explorer: " + cells.label}
            onClick={() => { close(); void onCells(); }}><ExternalLink />open cells in Cell Explorer</MenuItem>
          <MenuSeparator />
        </>}
        {canEdit && <>
          <MenuItem disabled={busy} onClick={() => { close(); onEdit(); }}><Pencil />edit…</MenuItem>
          <MenuSeparator />
        </>}
        <MenuItem className="text-destructive hover:text-destructive" disabled={busy} title="remove it from the analysis and from every view that draws it"
          onClick={() => { close(); onRemove(); }}><Trash2 />remove from analysis</MenuItem>
      </>}
    </GearMenu>
  );
}

/** the server-side wall clock for one view, and what that number does and does not include */
export function Latency({ v }: { v: any }) {
  if (v.ms == null) return null;
  return (
    <span className="lat" title={
      "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
      (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
      {v.ms.toLocaleString()}ms
      {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
    </span>
  );
}


