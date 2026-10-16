"use client";
// The oncoprint card every page draws from a document — the figure plus everything around it: the
// genes, columns, annotation and drivers-only controls, the Tracks menu (clinical, heatmap and
// cohort rows), moving, removing and expanding tracks, and the provenance footer. One component,
// so the lab's analysis page and the portal pages cannot drift apart. It reads the VIEW (the
// document) and hands back the next view; whether that re-runs is the page's to decide, with
// the rule from view-display.ts: the figure's own display options and sort never re-run.
import React, { useState } from "react";
import OncoprintFigure, { type ColumnSelection } from "./OncoprintFigure.tsx";
import { figureDisplayOf, withFigureDisplay, sortKeysOf, withSortKeys, sortKeyText } from "./view-display.ts";
import { normalizeGeneTracks, type GeneTrackSpec } from "../../lib/gene-tracks.ts";
import { heatmapTrackLabel, STUDY_TRACK } from "../../lib/profile-names.ts";
import { isCustomAttr, attributeLabel, parseCustomAttr } from "../../lib/custom-data-names.ts";
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";
import type { UploadBinding } from "../lab/custom-data-client.ts";
import { Rows3 } from "lucide-react";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { ViewGenesDialog } from "../_genes/GeneQueryDialog.tsx";
import { GearMenu } from "../_ui/gear-menu.tsx";
import { Input } from "../_ui/input";
import { OptionSelect } from "../_ui/choice.tsx";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { FIELD, TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";

type V = Record<string, any>;

// ---- the view as tracks: pure edits, each returning the next view --------------------------------

export const heatmapLabels = (v: V): string[] => (v.heatmap || []).flatMap((h: V) =>
  (h.genes && h.genes.length ? h.genes : v.genes || []).map((g: unknown) => heatmapTrackLabel(String(g).toUpperCase(), h.profileType)));

/** drop sort keys whose track no longer exists */
export const pruneSort = (v: V): V => {
  const keep = new Set(["genomic", "id", STUDY_TRACK, ...(v.clinical || []), ...heatmapLabels(v)]);
  const sort = (v.sort || []).filter((s: unknown) => keep.has(sortKeyText(s).replace(/^-/, "")));
  const next = { ...v };
  if (sort.length) next.sort = sort; else delete next.sort;
  return next;
};

/** the row a gene-list entry draws, which is the label the figure sends back */
export const geneRowLabel = (e: GeneTrackSpec): string => typeof e === "string" ? e.toUpperCase()
  : (e.label || (e.genes || []).map((g) => String(g).toUpperCase()).join(" / "));

/** how many rows a view's gene list draws */
export const geneRowCount = (v: V): number => { try { return normalizeGeneTracks(v.genes || []).tracks.length; } catch { return (v.genes || []).length; } };

/** a track's label back to what produced it: the genes, a heatmap profile, or a clinical attribute */
export const trackOwner = (v: V, label: string): "genes" | "clinical" | "heatmap" | null => {
  if ((v.genes || []).some((g: GeneTrackSpec) => geneRowLabel(g) === label)) return "genes";
  if ((v.clinical || []).includes(label)) return "clinical";
  if (heatmapLabels(v).includes(label)) return "heatmap";
  return null;
};

export const withGenes = (v: V, genes: GeneTrackSpec[]): V => pruneSort({ ...v, genes });
export const withClinical = (v: V, attrs: string[]): V => pruneSort({ ...v, clinical: attrs });
export const withHeatmap = (v: V, entries: unknown[]): V => { const n = { ...v }; if (entries.length) n.heatmap = entries; else delete n.heatmap; return pruneSort(n); };
export const withDerived = (v: V, names: string[]): V => { const n = { ...v }; if (names.length) n.derivedCohorts = names; else delete n.derivedCohorts; return n; };

export const moveTrack = (v: V, label: string, dir: -1 | 1): V => {
  const owner = trackOwner(v, label);
  const list = owner === "genes" ? (v.genes || []).map((g: string) => g) : owner === "clinical" ? [...(v.clinical || [])] : null;
  if (!list) return v;   // heatmap tracks follow their profile's gene list
  const i = list.findIndex((x: GeneTrackSpec) => (owner === "genes" ? geneRowLabel(x) : x) === label), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return v;
  [list[i], list[j]] = [list[j], list[i]];
  return owner === "genes" ? { ...v, genes: list } : { ...v, clinical: list };
};

export const removeTrack = (v: V, label: string): V => {
  const owner = trackOwner(v, label);
  if (owner === "genes") {
    const genes = (v.genes || []).filter((g: GeneTrackSpec) => geneRowLabel(g) !== label);
    return genes.length ? pruneSort({ ...v, genes }) : v;   // a figure needs at least one gene
  }
  if (owner === "clinical") return pruneSort({ ...v, clinical: (v.clinical || []).filter((a: string) => a !== label) });
  if (owner === "heatmap") return withHeatmap(v, (v.heatmap || []).filter((h: V) => !heatmapLabels({ ...v, heatmap: [h] }).includes(label)));
  return v;
};

/** replace a merged row with its members, in place — the figure's "expand" */
export const splitGeneTrack = (v: V, label: string): V => {
  const out: GeneTrackSpec[] = [];
  for (const e of (v.genes || []) as GeneTrackSpec[]) {
    const members = e && typeof e === "object" ? (e.genes || []).map((g) => String(g).toUpperCase()) : null;
    if (members && geneRowLabel(e) === label) out.push(...members); else out.push(e);
  }
  // the same gene may already be drawn on its own; expanding must not create two rows with one name
  return withGenes(v, out.filter((e, i) => typeof e !== "string" || out.indexOf(e) === i));
};

/** set or clear one display option on a view, keeping the document free of defaults */
export const setDisplayKey = (v: V, key: string, value: unknown): V => {
  const display = { ...(v.display || {}) };
  if (value === undefined) delete display[key]; else display[key] = value;
  const next = { ...v };
  if (Object.keys(display).length) next.display = display; else delete next.display;
  return next;
};

/**
 * A control whose options are still being fetched. It stands where the select will be, so the
 * toolbar doesn't jump when the options arrive, and it says what it is waiting for — an empty
 * select would read as "this study has none".
 */
export function Waiting({ what }: { what: string }) {
  return <span className="waiting" role="status"><span className="spinner" /> loading {what}…</span>;
}

/**
 * What a figure can draw, chosen from what the involved studies actually hold. Two tabs
 * because clinical attributes and molecular profiles are picked differently; a search box
 * because a study can declare sixty attributes; the count of cases carrying each one, most
 * first, because that is what decides whether a track is worth a row.
 */
export function TracksMenu({ attrs, profiles, clinical, heatmap, cohorts, derivedCohorts, busy, loading, onClinical, onHeatmap, onDerived }: {
  attrs: { attribute: string; kind: string; patients: number }[];
  /** the attribute/profile catalog is still being fetched */
  loading?: boolean;
  profiles: string[];
  clinical: string[];
  heatmap: { profileType: string; genes?: string[] }[];
  cohorts: string[];
  derivedCohorts: string[];
  busy: boolean;
  onClinical: (next: string[]) => void;
  onHeatmap: (next: { profileType: string; genes?: string[] }[]) => void;
  onDerived: (next: string[]) => void;
}) {
  const [tab, setTab] = useState<"clinical" | "custom" | "heatmap" | "cohorts">("clinical");
  const [q, setQ] = useState("");
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const heatOptions = ["VAF", ...profiles];
  // uploads get their own tab, but they are clinical tracks to the engine: one list, one cap of 8
  const studyAttrs = attrs.filter((a) => !isCustomAttr(a.attribute)), customAttrs = attrs.filter((a) => isCustomAttr(a.attribute));
  const isClin = tab === "clinical" || tab === "custom";
  const chosen = isClin ? clinical : tab === "heatmap" ? heatmap.map((h) => h.profileType) : derivedCohorts;
  const shown = (tab === "clinical" ? studyAttrs.map((a) => a.attribute) : tab === "custom" ? customAttrs.map((a) => a.attribute)
    : tab === "heatmap" ? heatOptions : cohorts).filter((n) => match(n) || match(attributeLabel(n)));
  const cap = isClin ? 8 : tab === "heatmap" ? 4 : 3;
  const toggle = (name: string) => {
    if (isClin) onClinical(clinical.includes(name) ? clinical.filter((x) => x !== name) : clinical.length < 8 ? [...clinical, name] : clinical);
    else if (tab === "heatmap") onHeatmap(chosen.includes(name) ? heatmap.filter((h) => h.profileType !== name) : heatmap.length < 4 ? [...heatmap, { profileType: name }] : heatmap);
    else onDerived(derivedCohorts.includes(name) ? derivedCohorts.filter((x) => x !== name) : derivedCohorts.length < 3 ? [...derivedCohorts, name] : derivedCohorts);
  };
  const setHeatGenes = (profileType: string, text: string) => {
    const genes = text.split(/[\s,]+/).map((g) => g.trim().toUpperCase()).filter(Boolean).slice(0, 12);
    onHeatmap(heatmap.map((h) => h.profileType === profileType ? (genes.length ? { ...h, genes } : { profileType }) : h));
  };
  return (
    <GearMenu menuId="onco-tracks" title="add or remove tracks" wide contentClassName="min-w-[340px] max-w-[34rem] px-2.5"
      label={<><Rows3 />tracks{chosen.length ? " (" + chosen.length + ")" : ""}</>}>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="h-7">
              <TabsTrigger value="clinical" className="px-2 text-sm">Clinical {studyAttrs.length ? "(" + studyAttrs.length + ")" : ""}</TabsTrigger>
              <TabsTrigger value="custom" className="px-2 text-sm" title="attributes from your uploads (Explore → Custom data)">Custom ({customAttrs.length})</TabsTrigger>
              <TabsTrigger value="heatmap" className="px-2 text-sm">Heatmap ({heatOptions.length})</TabsTrigger>
              <TabsTrigger value="cohorts" className="px-2 text-sm">Cohort rows ({cohorts.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" className={cn(FIELD, "ml-auto w-32")} />
        </div>
        <span className="meta">{chosen.length} of {cap} chosen{
          tab === "clinical" ? " · cases with data, most first"
          : tab === "custom" ? " · your uploads, kept in this browser; they share the 8 clinical tracks"
          : tab === "heatmap" ? " · a profile draws one row per gene; leave the genes blank to follow the figure"
          : " · any cohort in this document can be a binary row (patients only, one study)"}</span>
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: "0.3rem" }}>
          {!shown.length && (loading && !attrs.length ? <Waiting what="tracks" />
            : <span className="meta">{q.trim() ? "nothing matches"
              : tab === "custom" ? "no uploads for this study in this browser: add one under Explore → Custom data" : "nothing to choose from"}</span>)}
          {shown.map((name) => {
            const on = chosen.includes(name);
            const a = isClin ? attrs.find((x) => x.attribute === name) : undefined;
            const h = tab === "heatmap" && on ? heatmap.find((x) => x.profileType === name) : undefined;
            return (
              <div key={name}>
                <label className="meta" style={{ display: "flex", gap: "0.4rem", alignItems: "baseline", padding: "0.1rem 0" }}>
                  <Checkbox className="self-center" checked={on} disabled={busy || (!on && chosen.length >= cap)} onCheckedChange={() => toggle(name)} />
                  <span style={{ flex: 1 }} title={tab === "custom" ? name : undefined}>{name === "VAF" ? "VAF (mutation allele fraction)" : attributeLabel(name, tab === "custom" ? "short" : "long")}{a?.kind === "num" ? " (numeric)" : ""}
                    {tab === "custom" && <span className="meta"> · {parseCustomAttr(name)?.dataset}</span>}</span>
                  {a && <span style={{ fontVariantNumeric: "tabular-nums" }}>{a.patients.toLocaleString()}</span>}
                </label>
                {h && <Input defaultValue={(h.genes || []).join(" ")} placeholder="genes for this profile — blank follows the figure"
                  disabled={busy} onBlur={(e) => setHeatGenes(name, e.target.value)}
                  className="mb-1.5 ml-6 h-7 w-[calc(100%-1.5rem)] text-sm md:text-sm" />}
              </div>
            );
          })}
        </div>
    </GearMenu>
  );
}


// ---- the card ----------------------------------------------------------------------------------

export interface TrackCatalog { attrs: { attribute: string; kind: string; patients: number }[]; profiles: string[]; loading: boolean }

export function OncoprintCard({ view, spec, busy, cohortNames, catalog, onView, onGenes, onCreateCohort, onSaveFeature, onContract, contract, note, studies, uploads, onUndo }: {
  /** the view as the document holds it */
  view: V;
  /** the render request the engine returned for it */
  spec: unknown;
  busy: boolean;
  /** every cohort in the document, for cohort rows */
  cohortNames: string[];
  /** what tracks the involved studies can draw */
  catalog: TrackCatalog;
  /** the next view; rerun false means only the figure's own viewing state changed */
  onView: (next: V, rerun: boolean) => void;
  /** open the page's gene editor (absent: the card shows its own in a dialog) */
  onGenes?: () => void;
  onCreateCohort?: (sel: ColumnSelection) => void | Promise<void>;
  /** save the selection as a custom-data attribute */
  onSaveFeature?: (sel: ColumnSelection, all: string[]) => void | Promise<void>;
  onContract?: (c: UnpackedContract) => void;
  /** the decoded contract, for the provenance footer */
  contract?: UnpackedContract | null;
  /** the result's own note, and the studies it spans */
  note?: string; studies?: string[];
  /** the document's pinned uploads, for the figure's own requests */
  uploads?: UploadBinding[];
  /** step the document back one change, offered beside the figure's own error */
  onUndo?: () => void;
}) {
  const [own, setOwn] = useState<UnpackedContract | null>(null);
  const c = contract !== undefined ? contract : own;
  const [genesOpen, setGenesOpen] = useState(false);
  const edit = (next: V) => onView(next, true);
  const disp = (view.display || {}) as V;
  return (
    <>
      <OncoprintFigure
        spec={spec}
        onUndo={onUndo}
        uploads={uploads}
        display={figureDisplayOf(view)}
        sortKeys={sortKeysOf(view)}
        onDisplay={(d) => onView(withFigureDisplay(view, d), false)}
        onSortKeys={(keys) => onView(withSortKeys(view, keys), false)}
        onMoveTrack={(label, dir) => edit(moveTrack(view, label, dir))}
        onRemoveTrack={(label) => edit(removeTrack(view, label))}
        onExpandTrack={(label) => edit(splitGeneTrack(view, label))}
        onContract={(ct) => { setOwn(ct); onContract?.(ct); }}
        onCreateCohort={onCreateCohort}
        onSaveFeature={onSaveFeature}
        busy={busy}
        controls={<>
          <Button variant="outline" size="sm" className={cn(TB, "genesbtn")} disabled={busy}
            title="choose the genes this oncoprint draws" onClick={() => onGenes ? onGenes() : setGenesOpen(true)}>genes ({geneRowCount(view)})</Button>
          <label className="tbfield" title="a cohort selects patients; sample mode draws every sample of those patients">columns <OptionSelect
            value={view.unit || "patient"} disabled={busy}
            onValueChange={(v) => { const n = { ...view }; if (v === "sample") n.unit = "sample"; else delete n.unit; edit(n); }}>
            <option value="patient">patients</option><option value="sample">samples</option>
          </OptionSelect></label>
          <label className="tbfield" title="driver calls come from the version-pinned OncoKB store">annotate <OptionSelect
            value={disp.annotate || "oncokb"} disabled={busy}
            onValueChange={(v) => edit(setDisplayKey(view, "annotate", v === "none" ? "none" : undefined))}>
            <option value="oncokb">OncoKB</option><option value="none">none</option>
          </OptionSelect></label>
          <label className="chk tbchk" title="drop alterations the annotation source does not call drivers — this changes the percentages too, so it re-runs">
            <Checkbox checked={!!disp.hideVUS} disabled={busy}
              onCheckedChange={(on) => edit(setDisplayKey(view, "hideVUS", on === true || undefined))} /> drivers only</label>
        </>}
        tracksMenu={<TracksMenu
          attrs={catalog.attrs} profiles={catalog.profiles} loading={catalog.loading}
          clinical={view.clinical || []} heatmap={view.heatmap || []}
          cohorts={cohortNames} derivedCohorts={view.derivedCohorts || []}
          busy={busy}
          onClinical={(next) => edit(withClinical(view, next))}
          onHeatmap={(next) => edit(withHeatmap(view, next))}
          onDerived={(next) => edit(withDerived(view, next))} />}
        footer={<>
          {note && <p className="note" title={(studies || []).join(", ") || undefined}
            style={studies && studies.length > 2 ? { cursor: "help", textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>{note}</p>}
          {c && c.queries && c.queries.length > 0 && (
            <details className="provsql">
              <summary className="meta">
                how these numbers were computed — {c.queries.length} {c.queries.length === 1 ? "query" : "queries"} in {(c.stats.ms || 0).toLocaleString()}ms
              </summary>
              {c.queries.map((q: { label: string; sql: string; ms?: number; study?: string }, qi: number) => (
                <div className="provq" key={qi}>
                  <div className="provhead">
                    <code>{q.label}</code>
                    <span className="meta">{q.study}</span>
                    {q.ms != null && <span className="meta">{q.ms.toLocaleString()}ms</span>}
                  </div>
                  <pre>{q.sql}</pre>
                </div>
              ))}
            </details>
          )}
        </>}
      />
      {!onGenes && (
        <ViewGenesDialog view={view} open={genesOpen} onOpenChange={setGenesOpen} onGenes={(g) => edit(withGenes(view, g))} />
      )}
    </>
  );
}
