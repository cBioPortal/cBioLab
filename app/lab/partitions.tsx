"use client";
// A split on the analysis page: the cohort it splits, each child with its count and share of
// the parent, and whether the children add up. Arms can be reordered (first match wins, so order
// decides who goes where), merged, removed, added as OQL, and split again; the panel edits the
// split (stored on its cohort, edited here in its flat form) and the page re-runs the document,
// so every number shown is the engine's.
import { useState } from "react";
import type { PartitionDef, PartitionResult } from "../../lib/types.ts";
import { moveArm, removeArm, mergeArms, canMergeArms } from "../../lib/partition-arms.ts";
import { ArrowDown, ArrowUp, Ellipsis, LoaderCircle, Merge, Minus, Plus, Split, X } from "lucide-react";
import { Button } from "../_ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../_ui/dropdown-menu";
import { Input } from "../_ui/input";
import { Textarea } from "../_ui/textarea";
import { Choice } from "../_ui/choice.tsx";
import { GearMenu } from "../_ui/gear-menu.tsx";
import { FIELD, TB } from "../_ui/toolbar.ts";

export type SplitSpec = { attribute: string } | { gene: string } | { oql: string[] } | { assay: { profileType: string; entity: string } };

type SplitProps = {
  cohort: string; attrs: { attribute: string; kind: string }[]; busy?: boolean;
  onSplit: (cohort: string, spec: SplitSpec) => Promise<void>;
};

/** "split this cohort by …" behind its own button */
export function SplitMenu({ label, ...props }: SplitProps & { label?: React.ReactNode }) {
  return (
    <GearMenu menuId={"split:" + props.cohort} label={label || "Split…"} wide className="splitmenu h-6 px-1.5"
      title={"split “" + props.cohort + "” into arms that add up to it"} ariaLabel={"split “" + props.cohort + "”"}>
      {(close) => <SplitForm {...props} onDone={close} />}
    </GearMenu>
  );
}

/** the choice itself: an attribute from the study's catalog, a gene, or OQL queries. Closes the
 *  menu it sits in once the split is made. */
export function SplitForm({ cohort, attrs, busy, onSplit, onDone }: SplitProps & {
  /** after a successful split — e.g. to record that the menu holding this form is now closed */
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<"attribute" | "gene" | "oql">("attribute");
  const [attribute, setAttribute] = useState("");
  const [gene, setGene] = useState("");
  const [oql, setOql] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const spec = (): SplitSpec | null =>
    mode === "attribute" ? (attribute ? { attribute } : null)
      : mode === "gene" ? (gene.trim() ? { gene: gene.trim() } : null)
        : (oql.trim() ? { oql: oql.split("\n").map((q) => q.trim()).filter(Boolean) } : null);
  const go = async () => {
    const s = spec();
    if (!s) return;
    setErr(null); setWorking(true);
    try {
      await onSplit(cohort, s);
      // the page may have remounted the menu while the split ran; onDone closes it wherever it is now
      onDone?.();
    }
    catch (x) { setErr(String((x as Error)?.message || x)); }
    setWorking(false);
  };
  return (
      <>
        <div className="setrow">
          <span className="meta">split by</span>
          <Choice className="flex-1" value={mode} onChange={(m) => setMode(m as typeof mode)}
            options={[["attribute", "a clinical attribute"], ["gene", "a gene (mutated / wild-type)"], ["oql", "OQL queries, one arm each"]]} />
        </div>
        {mode === "attribute" && <div className="setrow">
          <span className="meta">attribute</span>
          {attrs.length
            ? <Choice className="flex-1" value={attribute} onChange={setAttribute} placeholder="choose…"
                options={attrs.map((a) => [a.attribute, a.attribute + (a.kind === "num" ? " (numeric: median split)" : "")] as const)} />
            : <span className="waiting"><span className="spinner" />loading attributes…</span>}
        </div>}
        {mode === "gene" && <div className="setrow">
          <span className="meta">gene</span>
          <Input className="h-8 flex-1 text-md md:text-md" value={gene} onChange={(e) => setGene(e.target.value)} placeholder="KRAS" spellCheck={false} />
        </div>}
        {mode === "oql" && <div className="setcol">
          <span className="meta">one query per line, tested in order; the first match wins</span>
          <Textarea className="min-h-18 bg-muted font-mono text-md md:text-md" value={oql} onChange={(e) => setOql(e.target.value)} placeholder={"KRAS: G12C\nKRAS: MUT"} spellCheck={false} />
        </div>}
        <p className="m-0 text-sm text-muted-foreground">
          The arms never overlap and add up to “{cohort}”. Patients not profiled for the gene, or with
          no value recorded, get their own row rather than counting as wild-type or Other.
        </p>
        {err && <p className="error m-0">{err}</p>}
        <Button size="sm" className="self-start" disabled={busy || working || !spec()} onClick={go}>
          {working ? <LoaderCircle className="animate-spin" /> : <Split />}Split
        </Button>
      </>
  );
}

function AddArm({ busy, onAdd }: { busy?: boolean; onAdd: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <form className="partadd" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { onAdd(q.trim()); setQ(""); } }}>
      <Input className={FIELD} value={q} onChange={(e) => setQ(e.target.value)} placeholder="add an arm: OQL, e.g. KRAS: G12D" spellCheck={false} />
      <Button variant="outline" size="sm" className={TB} type="submit" disabled={busy || !q.trim()}
        title="added as the FIRST arm, so a broader arm below cannot take its patients; move it with ↑ ↓"><Plus />add arm</Button>
    </form>
  );
}

/** a row's name, editable in place: click it, type, Enter (Esc cancels) */
function RowName({ label, editable, busy, onRename }: { label: string; editable: boolean; busy?: boolean; onRename: (to: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  if (!editable) return <>{label}</>;
  if (!editing)
    return <button type="button" className="partrename" disabled={busy} title="rename" onClick={() => { setDraft(label); setEditing(true); }}>{label}</button>;
  const commit = () => { setEditing(false); if (draft.trim() && draft.trim() !== label) onRename(draft.trim()); };
  return <input className="partrenameinput" autoFocus value={draft} maxLength={80}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />;
}

const ROLE_MARK = { arm: "▸", other: "∘", notEvaluable: "?" } as const;

export function PartitionPanel({ name, partitions, results, cohortText, attrs, busy, depth = 0, onChange, onRename, onRemove, onSplit }: {
  name: string;
  partitions: Record<string, PartitionDef>;
  results?: Record<string, PartitionResult>;
  cohortText: (cohort: string) => string | undefined;
  attrs: { attribute: string; kind: string }[];
  busy?: boolean; depth?: number;
  onChange: (name: string, def: PartitionDef) => void;
  /** rename an arm or the remainder; the page also updates what refers to it */
  onRename: (name: string, from: string, to: string) => void;
  onRemove: (name: string) => void;
  onSplit: (cohort: string, spec: SplitSpec) => Promise<void>;
}) {
  const def = partitions[name];
  const res = results?.[name];
  // Before the first run there are no counts: show the arms as written, waiting. After it, the
  // names still come from the document, which an edit (a rename) changes at once, while the
  // counts come from the last result until the re-run lands.
  const resArms = res ? res.children.filter((c) => c.role === "arm") : [];
  const sameShape = !!res && resArms.length === def.arms.length;
  const rows = res && sameShape ? res.children.map((c) => {
    const label = c.role === "arm" ? def.arms[resArms.indexOf(c)].name : c.role === "other" ? def.other || "Other" : c.label;
    return { ...c, label, name: name + " / " + label };
  }) : res ? res.children : [
    ...def.arms.map((a) => ({ name: name + " / " + a.name, label: a.name, role: "arm" as const, count: null as number | null })),
    { name: name + " / " + (def.other || "Other"), label: def.other || "Other", role: "other" as const, count: null as number | null }
  ];
  const armIndex = (label: string) => def.arms.findIndex((a) => a.name === label);
  const pct = (n: number | null) => res && n != null && res.parentCount ? 100 * n / res.parentCount : null;
  const nestedUnder = (child: string) => Object.keys(partitions).filter((k) => partitions[k].of === child);
  const pooled = def.source?.otherValues || [];
  return (
    <div className={"partbox" + (depth ? " nested" : "")} data-partition={name}>
      <div className="parthead">
        <span className="partname" title={"split “" + name + "”: arms tested in order, the first match wins"}>⑂ {def.split || name}</span>
        <span className="meta">splits “{def.of}”{res ? " · " + res.parentCount.toLocaleString() + " patients" : ""}</span>
        <Button variant="ghost" size="icon-xs" className="partrm ml-auto text-muted-foreground" disabled={busy} title="remove this split (and any split nested under it)"
          aria-label="remove this split" onClick={() => onRemove(name)}><X /></Button>
      </div>
      <div className="partrows" role="table">
        {rows.map((c) => {
          const i = c.role === "arm" ? armIndex(c.label) : -1;
          const p = pct(c.count);
          const nested = nestedUnder(c.name);
          return (
            <div key={c.name}>
              <div className={"partrow " + c.role} role="row" title={cohortText(c.name) || c.name}>
                <span className="partmark" aria-hidden="true">{ROLE_MARK[c.role]}</span>
                <span className="partlabel">
                  <RowName label={c.label} editable={c.role !== "notEvaluable"} busy={busy} onRename={(to) => onRename(name, c.label, to)} />
                  {c.role === "other" && <span className="meta"> · no arm matched</span>}
                  {c.role === "notEvaluable" && <span className="meta"> · not compared</span>}
                  {c.role === "arm" && c.count === 0 && i > 0 &&
                    <span className="meta" title="arms are tested in order: an earlier arm already took every patient this one matches, or nobody matches it"> · empty — an earlier arm may take its patients</span>}
                </span>
                <span className="partcount">{c.count == null ? <span className="spinner" /> : c.count.toLocaleString()}</span>
                <span className="partbar" aria-hidden="true" title={p == null ? "" : p.toFixed(1) + "% of “" + def.of + "”"}>
                  {p != null && <span style={{ width: Math.max(p, p > 0 ? 1.5 : 0) + "%" }} />}
                </span>
                <span className="partacts">
                  {i >= 0 && <>
                    <Button variant="ghost" size="icon-xs" disabled={busy || i === 0} title="test this arm earlier" aria-label="move this arm up"
                      onClick={() => onChange(name, moveArm(def, i, i - 1))}><ArrowUp /></Button>
                    <Button variant="ghost" size="icon-xs" disabled={busy || i === def.arms.length - 1} title="test this arm later" aria-label="move this arm down"
                      onClick={() => onChange(name, moveArm(def, i, i + 1))}><ArrowDown /></Button>
                    <Button variant="ghost" size="icon-xs" disabled={busy || !canMergeArms(def, i, i + 1)} aria-label="merge with the next arm"
                      title={i === def.arms.length - 1 ? "the last arm has no next arm to merge with" : "merge with the next arm: one arm matching either"}
                      onClick={() => onChange(name, mergeArms(def, i, i + 1))}><Merge /></Button>
                    <Button variant="ghost" size="icon-xs" disabled={busy || def.arms.length < 2} aria-label="remove this arm"
                      title={def.arms.length < 2 ? "a split needs at least one arm — remove the split instead" : "remove this arm: its patients move to a later arm or Other"}
                      onClick={() => onChange(name, removeArm(def, i))}><Minus /></Button>
                  </>}
                  {c.role !== "notEvaluable" && !nested.length &&
                    <SplitMenu cohort={c.name} attrs={attrs} busy={busy} label={<Split />} onSplit={onSplit} />}
                </span>
              </div>
              {nested.map((n) => (
                <PartitionPanel key={n} name={n} partitions={partitions} results={results} cohortText={cohortText} attrs={attrs}
                  busy={busy} depth={depth + 1} onChange={onChange} onRename={onRename} onRemove={onRemove} onSplit={onSplit} />
              ))}
            </div>
          );
        })}
      </div>
      {res && (res.conserved
        ? <p className="partsum ok">= {res.sum.toLocaleString()} samples, all of “{def.of}”: every sample is in exactly one row</p>
        : <p className="partsum bad">The rows add up to {res.sum.toLocaleString()} samples, not “{def.of}”’s {res.parentSamples.toLocaleString()} — these groups are not a clean split; do not compare them until this is explained.</p>)}
      {res && res.unchecked.length > 0 &&
        <p className="note">Not checked whether every patient has data for {res.unchecked.join(", ")}: “{def.other || "Other"}” may include patients with no data for it.</p>}
      {pooled.length > 0 &&
        <p className="note">From {def.source?.attribute}: values with too few patients for an arm of their own (under {def.source?.minCount ?? 10}, or past 7 arms) are in “{def.other || "Other"}” — {pooled.slice(0, 8).join(", ")}{pooled.length > 8 || def.source?.otherValuesTruncated ? ", and more" : ""}.</p>}
      <AddArm busy={busy} onAdd={(q) => onChange(name, { ...def, arms: [{ name: q, where: { kind: "oql", q } }, ...def.arms] })} />
    </div>
  );
}

export interface ChartAction { label: string; title: string; onClick: () => void; disabled?: boolean; working?: boolean }

/** an Explore chart's "⋯" menu, pinned to the chart's corner; renders nothing without actions */
export function ChartMenu({ actions, label }: { actions: ChartAction[]; label: string }) {
  if (!actions.length) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-xs" className="chartgear" title={"actions for " + label} aria-label={"actions for " + label}><Ellipsis /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {actions.map((a) => (
          <DropdownMenuItem key={a.label} disabled={a.disabled} title={a.title} onSelect={a.onClick}>
            {a.working && <LoaderCircle className="animate-spin" />}{a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
