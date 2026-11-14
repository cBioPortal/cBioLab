"use client";
// The oncoprint card every page draws from a document — the figure plus everything around it: the
// genes, columns, annotation and drivers-only controls, the Tracks menu (clinical, heatmap and
// cohort rows), moving, removing and expanding tracks, and the provenance footer. One component,
// so the lab's analysis page and the portal pages cannot drift apart. It reads the VIEW (the
// document) and hands back the next view; whether that re-runs is the page's to decide, with
// the rule from view-display.ts: the figure's own display options and sort never re-run.
import React, { useState } from "react";
import type { ProfileInfo } from "../../lib/profile-catalog.ts";
import OncoprintFigure, { type ColumnSelection } from "./OncoprintFigure.tsx";
import { figureDisplayOf, withFigureDisplay, sortKeysOf, withSortKeys, DRIVER_SCOPE } from "./view-display.ts";
import { driversOf, withDrivers } from "../../lib/driver-settings.ts";
import { assayTrackLabel, SPECTRUM_TRACK } from "../../lib/profile-names.ts";
import { STYLE } from "../../lib/oncoprint-style.ts";
import { CLINICAL_TRACK_LIMIT } from "../../lib/views/oncoprint/types.ts";
import { clinicalTrackRows, trackFreqText, type TrackAttr, geneRowCount, withClinical, withHeatmap, withDerived, withGenes, moveTrack, removeTrack, canRemoveTrack, splitGeneTrack } from "./track-edits.ts";
import { isCustomAttr, attributeLabel, parseCustomAttr } from "../../lib/custom-data-names.ts";
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";
import type { UploadBinding } from "../lab/custom-data-client.ts";
import { EntityField, searchEntities } from "../lab/entity-field.tsx";
import { profileUse } from "../../lib/profile-catalog.ts";
import { Rows3 } from "lucide-react";
import { Button } from "../_ui/button";
import { Checkbox } from "../_ui/checkbox";
import { ViewGenesDialog } from "../_genes/GeneQueryDialog.tsx";
import { GearMenu, closeGearMenu } from "../_ui/gear-menu.tsx";
import { Input } from "../_ui/input";
import { OptionSelect } from "../_ui/choice.tsx";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { FIELD, TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";
import { DriverSettingsMenu } from "./DriverSettingsMenu.tsx";


type V = Record<string, any>;

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
type HeatEntry = { profileType: string; genes?: string[]; entities?: string[] };
export function TracksMenu({ attrs, totals, spectrum, profiles, assays = [], clinical, heatmap, cohorts, derivedCohorts, busy, loading, onClinical, onHeatmap, onDerived }: {
  attrs: TrackAttr[];
  /** the queried patients and samples, each attribute's Freq denominator */
  totals?: { patients: number; samples: number };
  /** the studies hold mutations, so the mutation spectrum row can be drawn: listed first, as in the portal */
  spectrum?: boolean;
  /** the attribute/profile catalog is still being fetched */
  loading?: boolean;
  profiles: string[];
  /** the numeric generic-assay profiles, whose tracks are entities rather than genes */
  assays?: ProfileInfo[];
  clinical: string[];
  heatmap: HeatEntry[];
  cohorts: string[];
  derivedCohorts: string[];
  busy: boolean;
  onClinical: (next: string[]) => void;
  onHeatmap: (next: HeatEntry[]) => void;
  onDerived: (next: string[]) => void;
}) {
  const [tab, setTab] = useState<"clinical" | "custom" | "heatmap" | "cohorts">("clinical");
  // clinical ticks are staged, as the portal's are, and applied together by "Update tracks"
  const [staged, setStaged] = useState<string[] | null>(null);
  const pending = staged ?? clinical;
  const changed = staged !== null && (staged.length !== clinical.length || staged.some((x, i) => x !== clinical[i]));
  const rows = [...(spectrum ? [{ attribute: SPECTRUM_TRACK, kind: "spectrum", patients: 0, label: STYLE.glyph.spectrum.label, pct: null, unit: "samples" as const }] : []),
    ...clinicalTrackRows(attrs.filter((a) => !isCustomAttr(a.attribute)), totals)];
  const [q, setQ] = useState("");
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const heatOptions = ["VAF", ...profiles, ...assays.map((p) => p.profile)];
  const assayOf = (name: string) => assays.find((p) => p.profile === name);
  // uploads get their own tab, but they are clinical tracks to the engine: one list, one cap of 8
  const studyAttrs = [...(spectrum ? [{ attribute: SPECTRUM_TRACK, kind: "spectrum", patients: 0 }] : []), ...attrs.filter((a) => !isCustomAttr(a.attribute))];
  const customAttrs = attrs.filter((a) => isCustomAttr(a.attribute));
  const isClin = tab === "clinical" || tab === "custom";
  const chosen = isClin ? pending : tab === "heatmap" ? heatmap.map((h) => h.profileType) : derivedCohorts;
  const shown = (tab === "clinical" ? rows.map((a) => a.attribute) : tab === "custom" ? customAttrs.map((a) => a.attribute)
    : tab === "heatmap" ? heatOptions : cohorts).filter((n) => match(n) || match(attributeLabel(n)));
  const cap = isClin ? CLINICAL_TRACK_LIMIT : tab === "heatmap" ? 4 : 3;
  const rowOf = (name: string) => rows.find((r) => r.attribute === name);
  const toggle = (name: string) => {
    if (isClin) setStaged(pending.includes(name) ? pending.filter((x) => x !== name) : pending.length < cap ? [...pending, name] : pending);
    else if (tab === "heatmap") {
      const ga = assayOf(name);
      if (chosen.includes(name)) onHeatmap(heatmap.filter((h) => h.profileType !== name));
      else if (heatmap.length >= 4) return;
      // a generic assay starts on its first entity; more are added by search
      else if (ga) searchEntities(ga.study || "", ga.profile, "").then((r) => r.entities[0] &&
        onHeatmap([...heatmap, { profileType: name, entities: [r.entities[0].entity] }]), () => {});
      else onHeatmap([...heatmap, { profileType: name }]);
    }
    else onDerived(derivedCohorts.includes(name) ? derivedCohorts.filter((x) => x !== name) : derivedCohorts.length < 3 ? [...derivedCohorts, name] : derivedCohorts);
  };
  const setHeatGenes = (profileType: string, text: string) => {
    const genes = text.split(/[\s,]+/).map((g) => g.trim().toUpperCase()).filter(Boolean).slice(0, 12);
    onHeatmap(heatmap.map((h) => h.profileType === profileType ? (genes.length ? { ...h, genes } : { profileType }) : h));
  };
  const setEntities = (profileType: string, entities: string[]) => onHeatmap(entities.length
    ? heatmap.map((h) => h.profileType === profileType ? { profileType, entities } : h) : heatmap.filter((h) => h.profileType !== profileType));
  return (
    <GearMenu menuId="onco-tracks" title="add or remove tracks" wide contentClassName="min-w-[340px] max-w-[34rem] px-2.5"
      label={<><Rows3 />tracks{chosen.length ? " (" + chosen.length + ")" : ""}</>}>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="h-7">
              <TabsTrigger value="clinical" className="px-2 text-sm">Clinical {studyAttrs.length ? "(" + studyAttrs.length + ")" : ""}</TabsTrigger>
              <TabsTrigger value="custom" className="px-2 text-sm" data-tip="attributes from your uploads (Explore → Custom data)">Custom ({customAttrs.length})</TabsTrigger>
              <TabsTrigger value="heatmap" className="px-2 text-sm">Heatmap ({heatOptions.length})</TabsTrigger>
              <TabsTrigger value="cohorts" className="px-2 text-sm">Cohort rows ({cohorts.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" className={cn(FIELD, "ml-auto w-32")} />
        </div>
        {isClin && <div className="flex flex-wrap items-center gap-1.5">
          {/* Select all / Deselect all apply at once, as the portal's do; single ticks wait for Update tracks */}
          <Button variant="outline" size="xs" disabled={busy || !shown.length} onClick={() => { setStaged(null);
            onClinical([...clinical, ...shown.filter((n) => !clinical.includes(n) && (rowOf(n)?.pct ?? 1) > 0)].slice(0, cap)); }}>
            Select all ({shown.filter((n) => (rowOf(n)?.pct ?? 1) > 0).length})</Button>
          <Button variant="outline" size="xs" disabled={busy || !clinical.some((n) => shown.includes(n))}
            onClick={() => { setStaged(null); onClinical(clinical.filter((n) => !shown.includes(n))); }}>Deselect all</Button>
          {changed && <Button size="xs" className="ml-auto" disabled={busy} onClick={() => { onClinical(pending); setStaged(null); closeGearMenu("onco-tracks"); }}>Update tracks</Button>}
        </div>}
        <span className="meta">{chosen.length} chosen{
          tab === "clinical" ? " · Freq: the queried cases with data, most first"
          : tab === "custom" ? " · your uploads, kept in this browser; they are clinical tracks too"
          : tab === "heatmap" ? " · a profile draws one row per gene (blank genes follow the figure); a generic assay one per entity"
          : " · any cohort in this document can be a binary row (patients only, one study)"}</span>
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: "0.3rem" }}>
          {!shown.length && (loading && !attrs.length ? <Waiting what="tracks" />
            : <span className="meta">{q.trim() ? "nothing matches"
              : tab === "custom" ? "no uploads for this study in this browser: add one under Explore → Custom data" : "nothing to choose from"}</span>)}
          {shown.map((name) => {
            const on = chosen.includes(name);
            const a = isClin ? attrs.find((x) => x.attribute === name) : undefined;
            const r = tab === "clinical" ? rowOf(name) : undefined;
            const h = tab === "heatmap" && on ? heatmap.find((x) => x.profileType === name) : undefined;
            const ga = tab === "heatmap" ? assayOf(name) : undefined;
            return (
              <div key={name}>
                <label className="meta" style={{ display: "flex", gap: "0.4rem", alignItems: "baseline", padding: "0.1rem 0" }}>
                  <Checkbox className="self-center" checked={on} disabled={busy || (!on && (chosen.length >= cap || r?.pct === 0))} onCheckedChange={() => toggle(name)} />
                  <span style={{ flex: 1 }} data-tip={tab === "custom" || ga || r ? name : undefined}>{name === "VAF" ? "VAF (mutation allele fraction)" : ga ? ga.name + " (generic assay)"
                    : r ? r.label : attributeLabel(name, tab === "custom" ? "short" : "long")}{a?.kind === "num" ? " (numeric)" : ""}
                    {tab === "custom" && <span className="meta"> · {parseCustomAttr(name)?.dataset}</span>}</span>
                  {r && r.pct != null ? <span style={{ fontVariantNumeric: "tabular-nums" }}
                    data-tip={a!.patients.toLocaleString() + " of " + (r.unit === "samples" ? totals!.samples : totals!.patients).toLocaleString() + " queried " + r.unit + " have a value" +
                      (r.unit === "patients" ? " (a patient attribute: the portal counts these patients' samples)" : "")}>{trackFreqText(r.pct)}</span>
                    : a && a.kind !== "spectrum" && <span style={{ fontVariantNumeric: "tabular-nums" }}>{a.patients.toLocaleString()}</span>}
                </label>
                {h && ga && <div className="mb-1.5 ml-6 flex flex-wrap items-center gap-1">
                  {(h.entities || []).map((e) => <span key={e} className="flex items-center gap-1 rounded border border-input px-1 text-sm">
                    <span className="max-w-40 truncate" data-tip={e}>{assayTrackLabel(e, name)}</span>
                    <button type="button" aria-label={"remove " + e} disabled={busy} className="text-muted-foreground hover:text-foreground"
                      onClick={() => setEntities(name, (h.entities || []).filter((x) => x !== e))}>×</button></span>)}
                  {(h.entities || []).length < 12 && <EntityField study={ga.study || ""} profile={name} value="" placeholder="add an entity…" busy={busy}
                    side={name} className="h-7 w-40 text-sm"
                    onPick={(e) => !(h.entities || []).includes(e) && setEntities(name, [...(h.entities || []), e])} />}
                </div>}
                {h && !ga && <Input defaultValue={(h.genes || []).join(" ")} placeholder="genes for this profile — blank follows the figure"
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

export interface TrackCatalog { attrs: TrackAttr[]; profiles: string[]; loading: boolean;
  /** the queried patients and samples: the Tracks menu's Freq denominators */
  totals?: { patients: number; samples: number };
  /** the studies hold mutations: the Tracks menu offers the mutation spectrum row */
  spectrum?: boolean;
  /** every profile as the studies describe them, for a plot axis's Data picker */
  profileCatalog?: ProfileInfo[] }

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
        canRemoveTrack={(label) => canRemoveTrack(view, label)}
        onExpandTrack={(label) => edit(splitGeneTrack(view, label))}
        onContract={(ct) => { setOwn(ct); onContract?.(ct); }}
        onCreateCohort={onCreateCohort}
        onSaveFeature={onSaveFeature}
        busy={busy}
        controls={<>
          <Button variant="outline" size="sm" className={cn(TB, "genesbtn")} disabled={busy}
            data-tip="choose the genes this oncoprint draws" onClick={() => onGenes ? onGenes() : setGenesOpen(true)}>genes ({geneRowCount(view)})</Button>
          <label className="tbfield" data-tip="a cohort selects patients; sample mode draws every sample of those patients">columns <OptionSelect
            value={view.unit || "patient"} disabled={busy}
            onValueChange={(v) => { const n = { ...view }; if (v === "sample") n.unit = "sample"; else delete n.unit; edit(n); }}>
            <option value="patient">patients</option><option value="sample">samples</option>
          </OptionSelect></label>
          <DriverSettingsMenu drivers={driversOf(view)} busy={busy} scope={DRIVER_SCOPE}
            report={c ? c.conventions?.customDrivers || { binary: false, tiers: [] } : null}
            onChange={(d) => edit(withDrivers(view, d))} />
        </>}
        tracksMenu={<TracksMenu
          attrs={catalog.attrs} totals={catalog.totals} spectrum={catalog.spectrum} profiles={catalog.profiles} loading={catalog.loading}
          assays={(catalog.profileCatalog || []).filter((p) => profileUse(p) === "assayNumber" && p.study)}
          clinical={view.clinical || []} heatmap={view.heatmap || []}
          cohorts={cohortNames} derivedCohorts={view.derivedCohorts || []}
          busy={busy}
          onClinical={(next) => edit(withClinical(view, next))}
          onHeatmap={(next) => edit(withHeatmap(view, next))}
          onDerived={(next) => edit(withDerived(view, next))} />}
        footer={<>
          {note && <p className="note" data-tip={(studies || []).join(", ") || undefined}
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
