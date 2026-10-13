"use client";
// The chrome every view card shares, and the small controls inside it: the header (ViewHead), its
// menus, the cohort and value pickers, the axis picker, the gene inputs. Module-level components,
// so React keeps their state across the analysis page's renders.
import { useEffect, useRef, useState } from "react";
import { attributeLabel } from "../../lib/custom-data-names.ts";
import type { ViewParticipation } from "../../lib/types.ts";
import { VIEW_HELP } from "../../lib/view-help.ts";
import { HIGHLIGHT_CAP, HIGHLIGHT_COLORS } from "../../lib/plot-highlight.ts";
import { Waiting } from "../_oncoprint/OncoprintCard.tsx";
import { ArrowDown, ArrowUp, Ellipsis, Pencil, Plus, Save, Split, StickyNote, Trash2, X } from "lucide-react";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { cn } from "../../lib/cn";
import { OptionSelect } from "../_ui/choice.tsx";
import { FIELD } from "../_ui/toolbar.ts";
import { Checkbox } from "../_ui/checkbox";
import { GearMenu, MenuItem, MenuSeparator } from "../_ui/gear-menu.tsx";

/** the cohort colours, in order, for every chart on the page */
export const CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];

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
 * One axis of a plot. The source decides what else is asked for: a clinical attribute, a gene
 * in a molecular profile, or a gene's alterations. It is the same vocabulary the engine uses,
 * so what the reader picks is what the document says.
 */
export function AxisPicker({ side, axis, attrs, profiles, busy, loading, onChange, allowNone, categorical }: {
  side: string; axis: any; busy?: boolean;
  attrs: { attribute: string; kind: string }[]; profiles: string[];
  /** the attribute/profile catalog is still being fetched: its select waits with a loader */
  loading?: boolean;
  onChange: (a: any) => void;
  /** a colour is optional in a way an axis is not */
  allowNone?: boolean;
  /** colours come from categories, so a molecular value is not on offer */
  categorical?: boolean;
}) {
  const a = axis || {};
  const src = axis ? (a.source || "clinical") : "none";
  const set = (next: any) => onChange(next);
  return (
    <span className="axispick">
      <span className="tbl">{side}</span>
      <OptionSelect className="max-w-44" value={src} disabled={busy} title="what this axis measures"
        onValueChange={(v) => {
          const s = v;
          // Keep whatever this axis last held for each source (spreading `a` rather than
          // starting fresh), so switching away and back round-trips instead of always
          // reverting to the catalog's first entry — a molecular axis already did this for
          // its gene; clinical's attribute and molecular's profile now do too.
          set(s === "none" ? undefined
            : s === "clinical" ? { ...a, source: "clinical", attribute: a.attribute || (attrs[0] || {}).attribute || "" }
            : s === "molecular" ? { ...a, source: "molecular", profileType: a.profileType || profiles[0] || "", gene: a.gene || "TP53" }
            : { ...a, source: "alteration", gene: a.gene || "TP53", by: a.by || "mutationType" });
        }}>
        {allowNone && <option value="none">none</option>}
        <option value="clinical">clinical</option>
        {!categorical && <option value="molecular">molecular</option>}
        <option value="alteration">alteration</option>
      </OptionSelect>
      {src === "clinical" && loading && !attrs.length && <Waiting what="attributes" />}
      {src === "clinical" && !(loading && !attrs.length) && (
        <OptionSelect className="max-w-44" value={a.attribute || ""} disabled={busy} title="which clinical attribute"
          onValueChange={(v) => set({ ...a, attribute: v })}>
          {!attrs.some((x) => x.attribute === a.attribute) && <option value={a.attribute || ""}>{a.attribute || "(none)"}</option>}
          {attrs.map((x) => <option key={x.attribute} value={x.attribute}>{attributeLabel(x.attribute)}{x.kind === "num" ? "" : " (categorical)"}</option>)}
        </OptionSelect>
      )}
      {src === "molecular" && <>
        {loading && !profiles.length ? <Waiting what="profiles" /> :
        <OptionSelect className="max-w-44" value={a.profileType || ""} disabled={busy} title="which molecular profile"
          onValueChange={(v) => set({ ...a, profileType: v })}>
          {!profiles.includes(a.profileType || "") && <option value={a.profileType || ""}>{a.profileType || "(none)"}</option>}
          {profiles.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
        </OptionSelect>}
        <GeneInput gene={a.gene || ""} busy={busy} onCommit={(gene) => set({ ...a, gene })} />
      </>}
      {src === "alteration" && (() => {
        const isOql = a.oql != null;
        const genes: string[] = a.genes && a.genes.length ? a.genes : a.gene ? [a.gene] : [];
        const isSet = !isOql && genes.length > 1;
        return <>
          {isOql
            ? <OqlInput query={a.oql} busy={busy} onCommit={(oql) => set({ source: "alteration", oql })} />
            : <GeneSetInput genes={genes} busy={busy}
                onCommit={(next) => {
                  // A gene SET (2+) only supports "mutated vs not" — combining several genes'
                  // mutation types or copy-number states into one category has no honest reading,
                  // so switching to a set falls back to that rather than leaving an axis the
                  // engine would refuse.
                  const by = next.length > 1 && a.by && a.by !== "mutated" ? "mutated" : a.by;
                  set(next.length > 1 ? { ...a, gene: undefined, genes: next, by }
                    : { ...a, genes: undefined, gene: next[0] || "", by });
                }} />}
          <OptionSelect className="max-w-44" value={isOql ? "oql" : a.by || (isSet ? "mutated" : "mutationType")} disabled={busy}
            title={isOql ? "Altered when a case matches any line of the query, Unaltered otherwise"
              : isSet ? "a gene set is \"mutated vs not\", or write it as an OQL query" : "how the gene's alterations are grouped"}
            onValueChange={(v) => {
              const by = v;
              // to OQL: the genes become a query (a bare gene is "any alteration"); from OQL: the
              // query's first gene, so a round trip keeps the gene
              if (by === "oql") set({ source: "alteration", oql: genes.length ? genes.join("; ") : "TP53: MUT" });
              else if (isOql) set({ source: "alteration", gene: (/^\s*([A-Za-z0-9.-]+)/.exec(a.oql) || [])[1]?.toUpperCase() || "TP53", by });
              else set({ ...a, by });
            }}>
            <option value="mutationType" disabled={isSet}>mutation type</option>
            <option value="mutated">mutated vs not</option>
            <option value="cna" disabled={isSet}>copy number</option>
            <option value="oql">matches OQL</option>
          </OptionSelect>
        </>;
      })()}
    </span>
  );
}

/**
 * A plot's highlight cohorts: one chip per cohort in the view's list, in its figure colour, and a
 * select offering the document's other cohorts until the cap is reached. Order is colour, so a
 * removed chip shifts the ones after it to the next colour, as the figure does.
 */
export function HighlightPicker({ chosen, options, busy, onChange }: {
  chosen: string[];
  /** cohorts that may be highlighted: every cohort but the plotted one */
  options: { name: string; label: string; depth: number }[];
  busy?: boolean;
  onChange: (next: string[]) => void;
}) {
  const left = options.filter((o) => !chosen.includes(o.name));
  return (
    <span className="hlpick">
      <span className="tbl" title="other cohorts drawn over this one, each in its own colour">highlight</span>
      {chosen.map((n, i) => (
        <span key={n} className="hlchip" title={"“" + n + "” drawn over the plotted cohort"}>
          <span className="hldot" style={{ background: HIGHLIGHT_COLORS[i] }} />
          <span className="hlname">{n}</span>
          <Button type="button" variant="ghost" size="icon-xs" className="size-4 text-muted-foreground [&_svg:not([class*='size-'])]:size-3" disabled={busy}
            aria-label={"stop highlighting " + n} onClick={() => onChange(chosen.filter((x) => x !== n))}><X /></Button>
        </span>
      ))}
      {chosen.length < HIGHLIGHT_CAP && left.length > 0 && (
        <OptionSelect className="max-w-40" value="" disabled={busy} aria-label="add a cohort to highlight"
          onValueChange={(v) => { if (v) onChange([...chosen, v]); }}>
          <option value="">{chosen.length ? "+ another" : "+ cohort"}</option>
          {left.map((o) => <option key={o.name} value={o.name}>{"\u00a0".repeat(o.depth * 2) + o.label}</option>)}
        </OptionSelect>
      )}
    </span>
  );
}

/**
 * A gene name typed into a plot axis, debounced before it reaches the document/URL. Committing
 * on every keystroke (as the rest of this axis picker does for selects) meant an in-progress
 * edit — including the empty string between deleting the old gene and typing the new one —
 * briefly became the shareable link, which the compiler then rejects ("a molecular axis needs
 * one gene"). A short pause before committing keeps that mid-edit state local to the input.
 */
export function GeneInput({ gene, busy, onCommit }: { gene: string; busy?: boolean; onCommit: (gene: string) => void }) {
  const [draft, setDraft] = useState(gene);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(gene), [gene]);
  const commit = (v: string) => { if (timer.current) clearTimeout(timer.current); onCommit(v); };
  return (
    <Input className={cn(FIELD, "w-22 px-1.5 uppercase")} value={draft} disabled={busy} placeholder="gene"
      onChange={(e) => {
        const v = e.target.value.toUpperCase();
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onCommit(v), 500);
      }}
      onBlur={() => commit(draft)} />
  );
}

/**
 * One gene, or a gene SET typed as a comma-separated list ("TP53,KRAS,PIK3CA") — an alteration
 * axis's "is ANY of these altered" covariate. Same debounce-before-commit shape as GeneInput, for
 * the same reason: committing every keystroke would briefly make an empty or half-typed gene
 * list the shareable link, which the compiler then rejects.
 */
export function GeneSetInput({ genes, busy, onCommit }: { genes: string[]; busy?: boolean; onCommit: (genes: string[]) => void }) {
  const joined = genes.join(",");
  const [draft, setDraft] = useState(joined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(joined), [joined]);
  const parse = (v: string) => v.split(",").map((g) => g.trim().toUpperCase()).filter(Boolean);
  const commit = (v: string) => { if (timer.current) clearTimeout(timer.current); onCommit(parse(v)); };
  return (
    <Input className={cn(FIELD, "w-auto max-w-56 min-w-22 px-1.5 uppercase")} value={draft} disabled={busy} placeholder="gene, or gene,gene,... for a set" size={Math.max(8, Math.min(30, draft.length + 2))}
      title={'one gene, or a comma-separated gene set ("is any of these altered")'}
      onChange={(e) => {
        const v = e.target.value.toUpperCase();
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onCommit(parse(v)), 500);
      }}
      onBlur={() => commit(draft)} />
  );
}

/**
 * An OQL query typed into an alteration axis ("KRAS: G12C; STK11: MUT"), committed after a pause,
 * on Enter or on leaving the box — like the gene inputs, so a half-typed query never becomes the
 * shareable link. The engine checks it and the view says what it refused.
 */
export function OqlInput({ query, busy, onCommit }: { query: string; busy?: boolean; onCommit: (oql: string) => void }) {
  const [draft, setDraft] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(query), [query]);
  const commit = (v: string) => { if (timer.current) clearTimeout(timer.current); if (v.trim() && v !== query) onCommit(v.trim()); };
  return (
    <Input className={cn(FIELD, "w-auto max-w-88 px-1.5")} value={draft} disabled={busy} placeholder="KRAS: G12C; STK11: MUT" spellCheck={false}
      size={Math.max(16, Math.min(44, draft.length + 2))}
      title={"OQL, one gene per line or ';' — e.g. KRAS: G12C; STK11: MUT; EGFR: AMP; TP53: DRIVER; ERBB2: EXP>2. " +
        "A case is Altered when it matches any of them."}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), 900);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") commit(draft); }}
      onBlur={() => commit(draft)} />
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
export interface CohortNode { name: string; label: string; kind: "cohort" | "split" | "arm"; depth: number; count: number | null; groups?: number }

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
        <label title={last ? "a view draws at least one — tick another to switch" : full ? "this view draws at most " + max
            : implied ? "drawn as part of the split — click to draw only this group"
            : replaces ? (mine ? "a view draws one split's groups or whole cohorts — this replaces what is ticked"
              : "a view draws whole cohorts or one split's groups — this replaces “" + current + "”") : o.name}>
          {single && o.kind === "split" ? <span className="cpick-noinput" aria-hidden="true" /> :
            <input type={single ? "radio" : "checkbox"} checked={on || implied} disabled={busy || full}
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
  const swatch = (i: number) => drawn.length > 1 &&
    <span className="cohortswatch" aria-hidden="true" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />;
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
export function CohortEditMenu({ busy, canEdit, onEdit, onRemove, split, splitCount = 0, save, menuId, menuStore }: {
  busy?: boolean; canEdit: boolean; onEdit: () => void; onRemove: () => void;
  /** saving the cohort to the library, offered only while it has something to save */
  save?: { onSave: () => Promise<void>; label: string; title: string } | null;
  /** the split form; `done` closes this menu. A cohort may have several splits — each view draws one */
  split?: (done: () => void) => React.ReactNode;
  /** how many splits the cohort has already */
  splitCount?: number;
  menuId: string; menuStore: Map<string, boolean>;
}) {
  const [splitting, setSplitting] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <GearMenu menuId={menuId} menuStore={menuStore} className="cohortgear" label={<Ellipsis />} title="edit this cohort" ariaLabel="edit this cohort"
      wide={splitting} onOpenChange={(o) => { if (!o) setSplitting(false); }}>
      {(close) => <>
        {save && !splitting && <>
          <MenuItem disabled={busy || saving} title={save.title}
            onClick={async () => { setSaving(true); try { await save.onSave(); } finally { setSaving(false); } }}>
            <Save />{save.label}{saving && <span className="spinner ml-1.5" />}</MenuItem>
          <MenuSeparator />
        </>}
        {split && (splitting ? <>{split(() => { close(); setSplitting(false); })}<MenuSeparator /></> : <>
          <MenuItem disabled={busy} title="divide this cohort into arms that never overlap and add up to it"
            onClick={() => setSplitting(true)}><Split />{splitCount ? "split another way…" : "split into arms…"}</MenuItem>
          <MenuSeparator />
        </>)}
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

/** A figure the server drew (lib/view-svg*.ts, which escapes every label it writes), inlined as markup. */
export const ServerSvg = ({ html, className = "viewfig" }: { html: string; className?: string }) =>
  <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;

/** A view's server-drawn figure; with none, says so in words — unless the view's error says why already. */
export function ViewFigure({ svg, error, empty = "nothing to draw" }: { svg?: string | null; error?: string | null; empty?: string }) {
  if (svg) return <ServerSvg html={svg} />;
  return error ? null : <p className="note">{empty}</p>;
}
