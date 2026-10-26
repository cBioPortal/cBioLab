"use client";
// Explore's sections: the study picker, the action bar, the add-chart dialog and the facet grid's
// cards. The page owns Explore's state (app/lab/use-explore.ts and the draft) and hands every
// section the same ExploreCtx — what it reads and the edits it can make.
import { useState } from "react";
import type { Clause } from "../../lib/types";
import CohortPills from "./pills";
import { ChartMenu } from "./partitions.tsx";
import type { ChartKey } from "../../lib/partition-arms.ts";
import type { OnCustomData } from "./pills";
import { isCustomAttr } from "../../lib/custom-data-names.ts";
import { CAT_COLORS } from "./view-chrome.tsx";
import { useWidth } from "./figure.tsx";
import { textWidth } from "../../lib/chart/text.ts";
import { fmtInt, fmtNum, fmtPct } from "../../lib/chart/format.ts";
import { naturalOrder } from "../../lib/ordinal.ts";
import { SaveCohortDialog, SaveFeatureDialog } from "./dialogs.tsx";
import { DEFAULT_CLINICAL_CHARTS, SHOW_DERIVED_FACETS, type ExploreState } from "./use-explore-state.ts";
import { LINE_TYPE } from "../../lib/treatment-lines.ts";
import { Dna, Save, Tag, X } from "lucide-react";
import { Button } from "../_ui/button";
import { CHIP } from "../_ui/toolbar.ts";
import { GearMenu } from "../_ui/gear-menu.tsx";
import { Checkbox } from "../_ui/checkbox";
import { Input } from "../_ui/input";
import { Choice } from "../_ui/choice.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { StudyChooser } from "../_studies/study-chooser.tsx";
import { StudyRowActions } from "../_studies/study-actions.tsx";
import { QueryGenesDialog, studiesProblem } from "../portal/query-editor.tsx";
import { resultsMaxStudies } from "../../lib/results-settings.ts";
import { usePublicEnv } from "../_env/public-env-context.tsx";
import { EntityField } from "./entity-field.tsx";
import { plottableProfiles, profileUse } from "../../lib/profile-catalog.ts";
import { entityShortName } from "../../lib/profile-names.ts";

/** The most studies "add all" stages at once (each adds dozens of queries to Explore's facets). */
export const ADD_ALL_LIMIT = 30;

/**
 * Which clinical attributes draw as a pie rather than a table — a fixed
 * editorial choice, not a live count. It used to be "distinct values above
 * some limit renders as a table", computed from whichever studies happen to
 * be selected — so the SAME attribute could be a table in one study and a
 * pie in another, or flip mid-session the moment the study selection
 * changed: msk_chord_2024 alone has few enough Cancer Type values to clear
 * that bar, add genie_public and it doesn't. A chart's TYPE changing under
 * the reader is worse than a chart being the "wrong" shape for a given
 * study, so this is now a name-based allowlist, frozen regardless of the
 * data. Anything not listed here draws as a table — the safe default,
 * since a table degrades gracefully to any cardinality and a pie with 30
 * slices does not. Extend this list rather than reintroducing a threshold.
 */
const PIE_ATTRIBUTES = new Set([
  "SEX", "GENDER",
  "OS_STATUS", "DFS_STATUS", "DSS_STATUS", "PFS_STATUS", "RFS_STATUS",
  "SAMPLE_TYPE", "SOMATIC_STATUS"
]);



/** What Explore's sections read and the edits they can make: Explore's own state and actions
 *  (use-explore-state.ts), plus the few page values they show. */
export type ExploreCtx = ExploreState & {
  /** where the page keeps which of its menus are open */
  menuStore: Map<string, boolean>;
  showClauseData: (cohort?: string) => OnCustomData;
  studies: { id: string; name: string; cancerType?: string; patients: number; samples: number; timelinePatients: number; caps?: Record<string, boolean>; oncokb?: boolean; instance?: string; instanceLabel?: string; }[];
};

/** a search box in a toolbar row */
const SEARCH = "h-8 w-44 text-md md:text-md";
/** the × that removes a chip */
const CHIP_X = "ml-1 size-4 rounded-sm text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-3";
/** a study row's action icon */


export function StudyPicker({ ctx }: { ctx: ExploreCtx }) {
  const { addMode, analyzeDraft, exDraftStudies, exPanelOpen, exSel, exStudies, explore, exploreBusy, parseDraft, sCaps, sQuery, setExDraftStudies, setExPanelOpen, setExploreStudies, setSCaps, setSQuery, setStudyChipsOpen, studies, studyChipsOpen } = ctx;
  // what a gene query is being written for: the selection (the header's button) or one study (a row's icon)
  const [queryFor, setQueryFor] = useState<{ studies: string[]; filters: Clause[] } | null>(null);
  const maxStudies = resultsMaxStudies(usePublicEnv());
  const queryWhy = !exStudies.length ? "select a study first" : studiesProblem(exStudies.length, maxStudies);
  const selectionFilters = (parseDraft()?.all || []) as Clause[];
  const names = new Map(studies.map((s) => [s.id, s.name] as const));
  return <>
    <QueryGenesDialog target={queryFor} names={names} onClose={() => setQueryFor(null)} />
    {(() => {
      const byId = new Map(studies.map((s) => [s.id, s] as const));
      const selPts = exStudies.reduce((n: number, id: string) => n + (byId.get(id)?.patients ?? 0), 0);
      const ready = exStudies.length > 0;      // a study alone is enough to analyse
      // Two toggles on purpose. The chips in the header are an edit to a
      // selection the reader has already committed, so they apply at once.
      // The checkboxes below are them composing a new one, so they stage.
      const toggle = (id: any) => {
        const cur = exSel.current;
        setExploreStudies(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
      };
      const staged = exDraftStudies ?? exStudies;
      const dirty = exDraftStudies != null &&
        (staged.length !== exStudies.length || staged.some(x => !exStudies.includes(x)));
      const applyStaged = () => {
        setExDraftStudies(null);
        setExPanelOpen(false);
        setExploreStudies(staged);
      };
      return (
        <div className="card">
          <div className="row center g5">
            <h2 className="flush">Exploring <span className="plain">— {exStudies.length === 0 ? "no studies selected" :
              exStudies.length + (exStudies.length === 1 ? " study" : " studies") + " · " +
              // While a fetch is in flight the PREVIOUS result's totals are
              // not this selection's. Submitting 560 studies takes about a
              // minute, and showing the old 267,816 as though it described
              // the new set is worse than showing the study list's own sum
              // and saying it is still counting.
              (exploreBusy || !explore?.totals ? ""
                : explore.totals.patients.toLocaleString() + " patients · " + explore.totals.samples.toLocaleString() + " samples" +
                  (exStudies.length > 1 ? " (overlap not deduplicated)" : ""))}
              {/* the counts arrive with the facets; until then a placeholder holds their
                  place, so the header neither shows a wrong number nor jumps */}
              {exStudies.length > 0 && (exploreBusy || !explore?.totals) &&
                <span className="skeleton skeleton-counts" title={selPts ? "counting… (the selected studies hold " + selPts.toLocaleString() + " patients before deduplication)" : "counting…"} />}
            </span></h2>
            {/* One chip per study is fine for a handful and unreadable for
                560 — the header became a wall of identifiers that pushed
                everything else off screen. Past CHIP_CAP it summarises,
                with the full list in the tooltip and expandable in place.
                Expanded, the list scrolls rather than growing the header. */}
            {(() => {
              const CHIP_CAP = 5;
              const over = exStudies.length - CHIP_CAP;
              const shown = studyChipsOpen || over <= 1 ? exStudies : exStudies.slice(0, CHIP_CAP);
              const nameOf = (id: string) => byId.get(id)?.name ? id + " — " + byId.get(id)!.name : id;
              return (
                <span className={"studychips" + (studyChipsOpen ? " open" : "")}>
                  {shown.map(id => (
                    <span key={id} className="qchip" title={nameOf(id)}>
                      {id}
                      <Button variant="ghost" size="icon-xs" className={CHIP_X}
                        title={"remove " + id + " from the selection"} aria-label={"remove " + id}
                        onClick={() => toggle(id)}><X /></Button>
                    </span>
                  ))}
                  {over > 1 && (
                    <button className="qchip morechip" onClick={() => setStudyChipsOpen(!studyChipsOpen)}
                      title={studyChipsOpen ? "collapse the list" : exStudies.map(nameOf).join("\n")}>
                      {studyChipsOpen ? "show fewer" : "+" + over.toLocaleString() + " more"}
                    </button>
                  )}
                </span>
              );
            })()}
            <span className="spacer" />
            {!addMode && <Button onClick={analyzeDraft} disabled={!ready}
              title={ready ? "start a fresh analysis of this cohort (replaces the current document)" : "select a study first"}>
              Analyze
            </Button>}
            {!addMode && <Button variant="outline" className="querygenes" disabled={!!queryWhy}
              onClick={() => setQueryFor({ studies: exStudies, filters: selectionFilters })}
              title={queryWhy || "query genes in " + (exStudies.length === 1 ? exStudies[0] : exStudies.length + " studies") +
                (selectionFilters.length ? ", within your " + selectionFilters.length + " filter" + (selectionFilters.length === 1 ? "" : "s") : "") +
                ", and open the results — oncoprint, mutations, survival…"}>
              <Dna />Query genes…
            </Button>}
            {exStudies.length > 0 && <Button variant="outline" onClick={() => {
              if (exPanelOpen) { setExDraftStudies(null); setExPanelOpen(false); }   // close discards
              else { setExDraftStudies(exStudies); setExPanelOpen(true); }           // open seeds
            }}>{exPanelOpen ? "Cancel" : "Add / change studies"}</Button>}
          </div>
          {/* with nothing selected the picker is simply open: there is nothing else to do here */}
          {(exPanelOpen || exStudies.length === 0) && <>
            <div className="row applybar center g5">
              <strong>{staged.length.toLocaleString()}</strong>
              <span className="meta">
                {staged.length === 1 ? "study staged" : "studies staged"}
                {staged.length ? " · " + staged.reduce((n: number, id: string) => n + (byId.get(id)?.patients ?? 0), 0).toLocaleString() + " patients" : ""}
                {dirty ? " · not queried yet" : " · matches what is shown"}
              </span>
              <span className="spacer" />
              <Button size="sm" disabled={!dirty || !staged.length} onClick={applyStaged}
                title={staged.length ? "run the facets for these " + staged.length + " studies" : "stage at least one study"}>
                Submit
              </Button>
            </div>
            {/* the homepage's chooser: cancer types, search, filters, quick select; "add all" capped, since every study adds facet queries */}
            <StudyChooser className="mt-2.5" studies={studies} loading={!studies.length} selected={staged} onChange={setExDraftStudies}
              query={sQuery} onQuery={setSQuery} caps={sCaps} onCaps={setSCaps} addAllLimit={ADD_ALL_LIMIT}
              actions={(id) => <StudyActions id={id} ctx={ctx} onQuery={(one) => setQueryFor({ studies: [one], filters: [] })} />} />
          </>}
        </div>
      );
    })()}
  </>;
}

/** A study row's actions, like the portal home page's per-study icons. They act on this
 *  study alone, whatever is staged; a click on one does not tick the row. */
function StudyActions({ id, ctx, onQuery }: { id: string; ctx: ExploreCtx; onQuery: (id: string) => void }) {
  const { addMode, exploreStudy, analyzeStudy, addDataToStudy } = ctx;
  return <StudyRowActions id={id} acts={{
    explore: { title: "explore " + id + " now (replaces the current selection)", onClick: () => exploreStudy(id) },
    ...(addMode ? {} : {
      analyze: { title: "start a fresh analysis of all of " + id + " (replaces the current document)", onClick: () => analyzeStudy(id) },
      query: { title: "query genes in " + id + " and open its results", onClick: () => onQuery(id) },
    }),
    addData: { title: "explore " + id + " and add custom data to it", onClick: () => addDataToStudy(id) },
  }} />;
}

export function ExploreBar({ ctx }: { ctx: ExploreCtx }) {
  const { clearDraft, confirmSave, exMsg, exStudies, explore, exploreBusy, openSaveDialog, parseDraft, removeDraftClause, saveDraftAsFeature, confirmSaveFeature, saving, setSaving, savingFeature, setSavingFeature, showClauseData } = ctx;
  return <>
    {(() => {
      const d = parseDraft();
      const clauses = d && Array.isArray(d.all) ? d.all.length : 0;
      if (!clauses) return null;
      const ready = exStudies.length > 0;
      return (
        <div className="card exbar">
          <div className="row center g5">
            <strong className="t-md">{clauses + (clauses === 1 ? " filter" : " filters")}</strong>
            <span className="meta">
              {explore && explore.draftCount != null
                ? "· " + explore.draftCount.toLocaleString() + " patients match"
                : "· counting…"}
            </span>
            {exploreBusy && <span className="spinner" />}
            <span className="spacer" />
            {/* Naming is asked for on demand rather than sitting in the bar:
                Analyze needs no name, so a permanent field implied one was
                required for both. */}
            <Button variant="outline" size="sm" onClick={openSaveDialog} disabled={!ready}
              title={ready ? "keep this definition on the Saved tab without running anything" : "select a study first"}>
              <Save />Save as a Cohort
            </Button>
            <Button variant="outline" size="sm" onClick={saveDraftAsFeature} disabled={!ready}
              title={ready ? "freeze who matches these filters into a yes/no custom attribute you can chart, split and filter on" : "select a study first"}>
              <Tag />Save as feature
            </Button>
            <Button variant="ghost" size="sm" onClick={clearDraft}><X />Clear</Button>
          </div>
          <div className="row mt-1.5">
            {(() => { const dr = parseDraft(); return dr && <CohortPills def={dr} onRemoveClause={removeDraftClause} onCustomData={showClauseData()} />; })()}
          </div>
          {exMsg && <p className="note flush mt-1.5">{exMsg}</p>}
          {saving != null && <SaveCohortDialog initial={saving} onSave={confirmSave} onClose={() => setSaving(null)}
            meta={clauses + (clauses === 1 ? " filter" : " filters") + " on " + exStudies.length + " stud" + (exStudies.length === 1 ? "y" : "ies")} />}
          {savingFeature != null && <SaveFeatureDialog initial={savingFeature} onSave={confirmSaveFeature} onClose={() => setSavingFeature(null)}
            meta={clauses + (clauses === 1 ? " filter" : " filters") + " on " + exStudies.length + " stud" + (exStudies.length === 1 ? "y" : "ies")} />}
        </div>
      );
    })()}
  </>;
}

export function AddChartDialog({ ctx }: { ctx: ExploreCtx }) {
  const { addChartOpen, setAddChartOpen, addSeqFilter, attrCoverage, attrKey, chartGene, chartTab, clinFilter, exStudies, exploreBusy, fetchExplore, geneChartInput, openCustomManager, geneCharts, chartChecked, setChartsChecked, seq, seqReady, setAttrCoverage, setChartTab, setClinFilter, setGeneChartInput, setSeq, treatmentEventType, unchartGene } = ctx;
  const explore = ctx.explore!;
  return <>
    {explore && (
      <Dialog open={addChartOpen} onOpenChange={setAddChartOpen}>
      <DialogContent aria-describedby={undefined}
        className="addchart flex h-[90vh] w-[94vw] max-w-[94vw] flex-col gap-0 overflow-auto p-6 sm:max-w-[94vw]">
        <DialogHeader className="mb-2"><DialogTitle className="text-base">Add chart</DialogTitle></DialogHeader>
        <Tabs value={chartTab} onValueChange={(v) => setChartTab(v as typeof chartTab)} className="mb-3">
          <TabsList variant="line" className="w-full justify-start gap-1.5 border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-auto">
            {([["clinical", "Clinical"], ["gene", "Gene status"], ["assay", "Generic assays"], ["derived", "Derived timeline filters"], ["custom", "Custom data"]] as const).map(([t, label]) =>
              <TabsTrigger key={t} value={t} className="h-auto flex-none rounded-none px-3 pt-1.5 pb-1.5 text-md after:bottom-[-1px] data-[state=active]:text-accent-foreground data-[state=active]:after:bg-primary">{label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        {(() => {
          const custom = explore.clinical.filter((c) => isCustomAttr(c.attribute));
          const builtin = explore.clinical.filter((c) => !isCustomAttr(c.attribute));
          const keysOf = (list: typeof explore.clinical) => list.map(attrKey);
          /** check every attribute of `list` (shown) or none of it (hidden), leaving the other tab's alone */
          const setAll = (list: typeof explore.clinical, shown: boolean) => setChartsChecked(keysOf(list), shown);
          const checkedOf = (list: typeof explore.clinical) => list.filter((c) => chartChecked(attrKey(c))).length;
          const table = (rows: typeof explore.clinical, showDataset: boolean) => (
            <div className="attrtablewrap">
              <table className="attrtable">
                <thead>
                  <tr><th></th><th>Attribute</th>{showDataset && <th>Dataset</th>}<th>Type</th><th>Level</th></tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const toggle = () => setChartsChecked([attrKey(c)], !chartChecked(attrKey(c)));
                    // Shown regardless — the checklist is the union across the
                    // selection (see visibleClinical's own comment) — but an
                    // attribute only SOME of the selected studies actually carry
                    // reads as universal without this, so mark it rather than
                    // leave the reader to discover the gap study by study.
                    const partial = exStudies.length > 1 && (c.studyCount ?? 1) < exStudies.length;
                    return (
                      <tr key={attrKey(c)} onClick={(e) => { if (!(e.target as HTMLElement).closest("[role=checkbox]")) toggle(); }}>
                        <td><Checkbox checked={chartChecked(attrKey(c))} onCheckedChange={toggle} aria-label={"chart " + (c.displayName || c.attribute)} /></td>
                        <td>
                          {c.displayName || c.attribute}
                          {partial && (
                            <span className="meta" title={"carried by " + (c.studyCount ?? 1) + " of " + exStudies.length + " selected studies, not all of them"}> *</span>
                          )}
                        </td>
                        {showDataset && <td className="meta" title={c.description}>{(c.attribute || "").replace(/^custom:/, "").split("/")[0]}</td>}
                        <td className="meta">{c.kind === "num" ? "numeric" : "categorical"}</td>
                        <td className="meta">{c.per === "sample" ? "sample" : "patient"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
          if (chartTab === "custom") return (
            <div>
              <p className="note mt-0 mb-3">
                Check a custom attribute to draw it as a tile in the facet grid below; uncheck to hide it.
                These are the saved datasets that cover the explored {exStudies.length === 1 ? "study" : "studies"}.
              </p>
              <div className="row baseline">
                {custom.length > 0 && <>
                  <span className="meta">{checkedOf(custom)} of {custom.length} checked</span>
                  <Button variant="link" size="inline" onClick={() => setAll(custom, true)}>check all</Button>
                  <Button variant="link" size="inline" onClick={() => setAll(custom, false)}>check none</Button>
                </>}
                <span className="spacer" />
                <Button variant="outline" size="sm" onClick={() => { setAddChartOpen(false); openCustomManager(custom.length ? "manage" : "add"); }}>
                  {custom.length ? "Manage custom data…" : "Add custom data…"}</Button>
              </div>
              {custom.length ? table(custom, true)
                : <p className="note my-3">No custom data covers {exStudies.length === 1 ? exStudies[0] : "these studies"} yet.</p>}
            </div>
          );
          if (chartTab !== "clinical") return null;
          const q = clinFilter.trim().toLowerCase();
          const rows = !q ? builtin : builtin.filter((c) =>
            (c.attribute || "").toLowerCase().includes(q) || (c.displayName || "").toLowerCase().includes(q));
          return (
            <div>
              <p className="note mt-0 mb-3">
                Check an attribute to draw it as a tile in the facet grid below; uncheck to hide
                it. Until you change it, the first {DEFAULT_CLINICAL_CHARTS} by the portal's own priority are
                checked, as on cBioPortal's study view; an attribute you filter on is drawn either way.
                The search here only narrows this list — it doesn't touch the grid itself.
                {exStudies.length > 1 && <> An attribute marked <b>*</b> isn't carried by every
                selected study — hover it for which share of the {exStudies.length} do.</>}
              </p>
              <div className="row baseline">
                <Input type="search" className={SEARCH} placeholder="find an attribute" value={clinFilter}
                  title="narrows this checklist by attribute name" autoFocus
                  onChange={e => setClinFilter(e.target.value)} />
                <span className="meta">{checkedOf(builtin)} of {builtin.length} checked</span>
                <Button variant="link" size="inline" onClick={() => setAll(builtin, true)}>check all</Button>
                <Button variant="link" size="inline" onClick={() => setAll(builtin, false)}>check none</Button>
                {exStudies.length > 1 && (
                  <Choice className="w-44" value={String(attrCoverage)} disabled={exploreBusy}
                    title="attributes carried by only one study are that study's own vocabulary, not something the selection shares"
                    onChange={v => {
                      setAttrCoverage(Number(v));
                      // Refetch UNNARROWED so the bar can be lowered again
                      // later; the filtering below is what the reader sees,
                      // and subsequent fetches narrow the server's work.
                      setTimeout(() => fetchExplore(undefined, undefined, []), 0);
                    }}
                    options={[["0", "every attribute"], ["0.5", "in most studies"], ["1", "in every study"]]} />
                )}
              </div>
              {!rows.length && <p className="note my-3">No attribute matches “{clinFilter}”.</p>}
              {table(rows, false)}
            </div>
          );
        })()}
        {chartTab === "gene" && (
          <div>
            <div className="row baseline g5">
              <Input type="search" className={SEARCH} placeholder="chart a gene (e.g. EGFR)" autoFocus
                value={geneChartInput} disabled={exploreBusy}
                onChange={e => setGeneChartInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") chartGene(geneChartInput); }} />
              <Button variant="outline" size="sm" disabled={!geneChartInput.trim() || exploreBusy} onClick={() => chartGene(geneChartInput)}>Add</Button>
            </div>
            {!geneCharts.length && (
              <p className="note flush mt-1.5">
                Name a gene to see how many patients are altered, unaltered, or <strong>never tested</strong> for
                it. The third is the one a frequency cannot show: in GENIE public, 86,353 patients are on no panel
                covering EGFR copy number.
              </p>
            )}
            {geneCharts.map(g => (
              <span key={g} className="qchip mr-1">
                {g}
                <Button variant="ghost" size="icon-xs" className={CHIP_X} title={"stop charting " + g} aria-label={"stop charting " + g}
                  onClick={() => unchartGene(g)}><X /></Button>
              </span>
            ))}
            {geneCharts.length > 0 && (
              <p className="note flush mt-1.5">
                Each charted gene's mutation and copy-number status is drawn as its own tile in the
                facet grid, alongside the clinical attributes — close this dialog to see them.
              </p>
            )}
          </div>
        )}
        {chartTab === "assay" && <AssayChartPicker ctx={ctx} />}
        {chartTab === "derived" && (explore.events.length === 0 ? (
          <p className="note mt-0 mb-3">This study has no clinical timeline events to derive a filter from.</p>
        ) : (() => {
          const tx = treatmentEventType();
          return (
            <div>
              <div className="customseq">
                <h4>Custom sequence filter</h4>
                <p className="note flush mb-1">
                  Build any A/B temporal relationship — followed-by, during, not-followed-by —
                  with a duration constraint, from this study's own timeline.
                </p>
                  <div className="setrow">
                    <span className="meta">event</span>
                    <Choice className="flex-1" placeholder="choose…" value={seq.aType} onChange={v => setSeq(s => ({ ...s, aType: v }))}
                      options={[...(tx ? [[LINE_TYPE, "Treatment line (derived)"] as const] : []), ...[...explore.events].sort((x, y) => y.n - x.n).map(e => [e.type, e.type + " (" + e.n.toLocaleString() + ")"] as const)]} />
                    {seq.aType === LINE_TYPE ? (
                      <>
                        <Choice className="w-24" value={seq.aLineOp} onChange={v => setSeq(s => ({ ...s, aLineOp: v as any }))}
                          options={[["=", "line #"], [">=", "line ≥"], ["<=", "line ≤"]]} />
                        <Input type="number" min={1} placeholder="n" value={seq.aLineNo} className="h-8 w-16 text-md md:text-md"
                          onChange={e => setSeq(s => ({ ...s, aLineNo: e.target.value }))} />
                      </>
                    ) : seq.aType && (
                      <Choice className="w-40" value={seq.aOcc} onChange={v => setSeq(s => ({ ...s, aOcc: v as any }))}
                        options={[["ANY", "any occurrence"], ["FIRST", "first"], ["LAST", "last"]]} />
                    )}
                  </div>
                  <div className="setrow">
                    <span className="meta">relationship</span>
                    <Choice className="flex-1" value={seq.rel} onChange={v => setSeq(s => ({ ...s, rel: v as any }))}
                      options={[["NONE", "just has this event"], ["BEFORE", "→ followed by, within"], ["DURING", "happens during"], ["NOT_FOLLOWED_BY", "not followed by, within"]]} />
                    {(seq.rel === "BEFORE" || seq.rel === "NOT_FOLLOWED_BY") && (
                      <>
                        <Input type="number" min={1} value={seq.days} className="h-8 w-20 text-md md:text-md"
                          onChange={e => setSeq(s => ({ ...s, days: e.target.value }))} />
                        <span className="meta">days</span>
                      </>
                    )}
                  </div>
                  {seq.rel !== "NONE" && (
                    <div className="setrow">
                      <span className="meta">{seq.rel === "DURING" ? "during" : "second event"}</span>
                      <Choice className="flex-1" placeholder="choose…" value={seq.bType} onChange={v => setSeq(s => ({ ...s, bType: v }))}
                      options={[...(tx ? [[LINE_TYPE, "Treatment line (derived)"] as const] : []), ...[...explore.events].sort((x, y) => y.n - x.n).map(e => [e.type, e.type + " (" + e.n.toLocaleString() + ")"] as const)]} />
                      {seq.bType === LINE_TYPE ? (
                        <>
                          <Choice className="w-24" value={seq.bLineOp} onChange={v => setSeq(s => ({ ...s, bLineOp: v as any }))}
                          options={[["=", "line #"], [">=", "line ≥"], ["<=", "line ≤"]]} />
                          <Input type="number" min={1} placeholder="n" value={seq.bLineNo} className="h-8 w-16 text-md md:text-md"
                            onChange={e => setSeq(s => ({ ...s, bLineNo: e.target.value }))} />
                        </>
                      ) : seq.bType && (
                        <Choice className="w-40" value={seq.bOcc} onChange={v => setSeq(s => ({ ...s, bOcc: v as any }))}
                        options={[["ANY", "any occurrence"], ["FIRST", "first"], ["LAST", "last"]]} />
                      )}
                    </div>
                  )}
                  {(seq.aType === LINE_TYPE || seq.bType === LINE_TYPE) && (
                    <div className="setrow">
                      <span className="meta">new line after</span>
                      <Choice className="flex-1" value={String(seq.lineGap)} onChange={v => setSeq(s => ({ ...s, lineGap: Number(v) }))}
                        options={[30, 60, 90, 120, 180].map(g => [String(g), g + " days"] as const)} />
                    </div>
                  )}
                  <label className="chk" title="restricts the first event to patients with no treatment recorded before it">
                    <Checkbox checked={seq.priorGuard}
                      onCheckedChange={v => setSeq(s => ({ ...s, priorGuard: v === true }))} />
                    treatment-naive before the first event
                  </label>
                  <hr />
                  <Button variant="outline" size="sm" className="self-start" disabled={!seqReady} onClick={addSeqFilter}>Add filter</Button>
              </div>
            </div>
          );
        })())}
        <DialogFooter className="mt-auto pt-4">
          <DialogClose asChild><Button>Done</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    )}
  </>;
}

export function DerivedFacets({ ctx }: { ctx: ExploreCtx }) {
  const { TREATMENT_DERIVED_KINDS, addClause, explore, derivedOn, menuStore, parseDraft, toggleDerived, treatmentEventType } = ctx;
  return <>
    {SHOW_DERIVED_FACETS && explore && explore.derived && explore.derived.length > 0 && (
      <div className="card">
        <div className="row baseline">
          <h2 className="flush">Derived <span className="plain">— computed from the data's shape, so these mean the same thing in any study</span></h2>
          <span className="spacer" />
          <GearMenu menuId="explore:more-derivations" menuStore={menuStore} title="more ways to derive a facet from this study's own timeline"
            label="show more derivations" wide contentClassName="px-2.5">
              <span className="meta">from this study's own timeline events</span>
              {(() => {
                const tx = treatmentEventType();
                return TREATMENT_DERIVED_KINDS.map((k) => (
                  <label key={k.metric} className="chk"
                    title={tx ? "based on '" + tx.label + "' events" : "this study records no treatment-like timeline events, so this can't be derived here"}>
                    <Checkbox checked={derivedOn(k.metric)} disabled={!tx}
                      onCheckedChange={() => toggleDerived(k.metric)} />
                    {tx ? k.label(tx.label) : k.label("a treatment event")}
                    {!tx && <span className="meta"> — not available for this study</span>}
                  </label>
                ));
              })()}
          </GearMenu>
        </div>
        <div className="derivedgrid">
          {explore.derived.map(d => {
            const max = Math.max(...d.buckets.map(b => b.n), 1);
            const dEventType = (d as any).eventType as string | undefined;
            const dLineGap = (d as any).lineGap as number | undefined;
            const picked = (b: { gte?: number; lt?: number }) => {
              const dr = parseDraft();
              // Buckets OR together into an `any` group, so look inside one
              // as well as at top level or a second pick never highlights.
              const leaves = ((dr && dr.all) || []).flatMap((c: any) => Array.isArray(c.any) ? c.any : [c]);
              return leaves.some((c: any) => c && c.kind === "derived" && c.metric === d.metric
                && (c.eventType || undefined) === dEventType
                && (c.range || {}).gte === b.gte && (c.range || {}).lt === b.lt);
            };
            return (
              <div key={d.metric + "|" + (dEventType || "")} data-derived={d.metric} data-buckets={d.buckets.length}>
                {/* A metric already in the draft is counted WITHOUT its own
                    clauses so its other buckets stay selectable, which means
                    its total is the draft-minus-itself total. Say so, exactly
                    as the clinical facets do, rather than show a number that
                    cannot be reconciled with the draft. */}
                <div className="facettitle" title={d.note}>
                  {d.label} <span className="meta">· {d.covered.toLocaleString()} patients
                    {(d as any).disjunctive ? " · not narrowed by its own filter" : ""}</span>
                </div>
                <div className="vallist">
                  {d.buckets.map(b => (
                    <button key={b.label} className={picked(b) ? "valrow on" : "valrow"}
                      title={d.note + " — click to filter"}
                      onClick={() => addClause({ kind: "derived", metric: d.metric,
                        ...(dEventType ? { eventType: dEventType } : {}), ...(dLineGap != null ? { lineGap: dLineGap } : {}),
                        range: { ...(b.gte != null ? { gte: b.gte } : {}), ...(b.lt != null ? { lt: b.lt } : {}) } })}>
                      <span className="vname">{b.label}</span>
                      <span className="vbar"><i style={{ width: Math.max(2, Math.round(100 * b.n / max)) + "%" }} /></span>
                      <span className="vn">{b.n.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}
  </>;
}

/** rows a value list shows before it scrolls (`.vallist`'s max-height) */
const VALLIST_ROWS = 9;

/**
 * A facet's histogram: one clickable bar per bin, its start labelled under it — every label that
 * fits its bar's width, and every second (third, …) bin's when they do not, rather than letting
 * neighbouring labels run into each other.
 */
function Histogram({ ticks, na, children }: { ticks: string[]; na: string | null; children: React.ReactNode }) {
  const { ref, width } = useWidth(0);
  // the tick font is --t-xs, 0.66rem; the bars share the row with the NA note and 2px gaps
  const fs = 0.66 * 16;
  const room = ((width ?? 280) - (na ? textWidth(na, fs) + 8 : 0)) / Math.max(1, ticks.length);
  const widest = Math.max(...ticks.map((t) => textWidth(t, fs))) + 4;
  const every = Math.max(1, Math.ceil(widest / Math.max(1, room)));
  return (
    <div ref={ref} className="mt-1">
      <div className="histo">
        {children}
        {na && <span className="meta nacount">{na}</span>}
      </div>
      <div className="histo-ticks" aria-hidden="true" style={{ paddingRight: na ? textWidth(na, fs) + 8 : 0 }}>
        {ticks.map((t, i) => <span key={i}>{i % every === 0 ? t : ""}</span>)}
      </div>
    </div>
  );
}

export function ClinicalFacets({ ctx }: { ctx: ExploreCtx }) {
  const { addClause, addMode, parseDraft, selectionArmCount, splitDraftBy, splitDraftBySelection, splittingBy, visibleClinical } = ctx;
  const explore = ctx.explore!;
  return <>
    {(visibleClinical(explore.clinical as never) as unknown as typeof explore.clinical)
      .map(c => (
      /* data-attr / data-shape make the facet identifiable from outside
         React — the e2e suite asserts that an attribute's shape does not
         change when the draft does. One tile per attribute, the portal's
         own study-view density — see .facetgrid's own comment. */
      <div key={c.per + c.attribute} data-attr={c.per + "|" + c.attribute}
        data-shape={c.kind === "cat" ? (PIE_ATTRIBUTES.has(c.attribute) ? "pie" : "list") : c.kind}
        className="card">
          {(() => {
            // A facet already in the draft is re-queried WITHOUT its own
            // clauses (disjunctive faceting) so its other values stay
            // selectable — so its total is the draft-minus-itself total,
            // not the draft total. Say so rather than show two numbers
            // that cannot be reconciled.
            const disj = c.kind === "cat" && (c as any).disjunctive;
            const shown = disj ? c.values.reduce((n: number, v: any) => n + v.n, 0) : c.patients;
            const unit = c.per === "sample" ? " samples" : " patients";
            return (
              <div
 className="facettitle"                title={[c.displayName && c.displayName !== c.attribute ? c.attribute : "", c.description]
                  .filter(Boolean).join(" — ") || undefined}>
                {isCustomAttr(c.attribute) && <span className="customtag" title={c.description}>custom</span>}
                {c.displayName || c.attribute}{" "}
                <span className="meta">
                  {(c.per === "sample" ? "· sample-level · " : "· ") + shown.toLocaleString() + unit}
                  {disj ? " · not narrowed by its own filter" : ""}
                </span>
                {(() => {
                  const label = c.displayName || c.attribute;
                  const chart: ChartKey = { kind: "clinical", attribute: c.attribute, per: c.per === "sample" ? "sample" : "patient" };
                  const n = selectionArmCount(chart);
                  return <ChartMenu label={label} actions={addMode ? [] : [
                    { label: "Split by this", disabled: !!splittingBy, working: splittingBy === label,
                      title: "Analyze the current selection split by " + label + (c.kind === "num"
                        ? ": below / at or above its median within the selection" : ": one arm per value with at least 10 patients, the rest in Other") +
                        " — arms that never overlap and add up to the selection",
                      onClick: () => void splitDraftBy({ attribute: c.attribute }, label) },
                    ...(n > 0 ? [{ label: "Split by selected (" + (n > 8 ? "8+" : n) + ")",
                      title: "Analyze with each selected " + (c.kind === "num" ? "range" : "value") + " of " + label +
                        " as its own arm (tested in the order you clicked them), the rest of your selection as the cohort they split, and everyone else in Other",
                      onClick: () => splitDraftBySelection(chart, label) }] : [])
                  ]} />;
                })()}
              </div>
            );
          })()}
          {c.kind === "cat" && (() => {
            const total = c.values.reduce((n: number, v: any) => n + v.n, 0) || 1;
            const d = parseDraft();
            const isSel = (v: any) => !!(d && d.all.some((cl: any) => cl.kind === "clinical" && cl.attribute === c.attribute &&
              ((cl.values || []).includes(v.v) || cl.value === v.v)));
            const clause = (v: any) => ({ kind: "clinical", attribute: c.attribute, op: "=", value: v.v,
              ...(c.per === "sample" ? { per: "sample" } : {}) });
            // slice geometry: cumulative angles over the returned values.
            // The shape comes from PIE_ATTRIBUTES, a fixed allowlist — see
            // its own comment for why cardinality (the study's, or worse,
            // the draft's) can't be trusted to decide this.
            const asList = !PIE_ATTRIBUTES.has(c.attribute);
            // stage, grade and the like read in their own order (lib/ordinal.ts); the rest by count
            const values: any[] = naturalOrder(c.values, (v: any) => String(v.v));
            let acc = 0;
            const R = 34, CX = 36, CY = 36;
            const arcs = values.map((v: any, i: number) => {
              const frac = v.n / total, a0 = acc * 2 * Math.PI - Math.PI / 2;
              acc += frac;
              const a1 = acc * 2 * Math.PI - Math.PI / 2;
              const large = frac > 0.5 ? 1 : 0;
              const p = (a: number) => [CX + R * Math.cos(a), CY + R * Math.sin(a)];
              const [x0, y0] = p(a0), [x1, y1] = p(a1);
              // a single value covering everything cannot be drawn as an arc
              const path = frac >= 0.999
                ? "M " + CX + " " + (CY - R) + " A " + R + " " + R + " 0 1 1 " + (CX - 0.01) + " " + (CY - R) + " Z"
                : "M " + CX + " " + CY + " L " + x0 + " " + y0 + " A " + R + " " + R + " 0 " + large + " 1 " + x1 + " " + y1 + " Z";
              return { v, path, color: CAT_COLORS[i % CAT_COLORS.length], frac };
            });
            if (asList) {
              const max = Math.max(...c.values.map((v: any) => v.n), 1);
              return (<>
                <div className="vallist">
                  {values.map((v: any, i: number) => (
                    <button key={i} className={isSel(v) ? "valrow on" : "valrow"} onClick={() => addClause(clause(v))}
                      title={v.v + " — " + v.n.toLocaleString() + " (click to filter)"}>
                      <span className="vname">{v.v}</span>
                      <span className="vbar"><i style={{ width: Math.max(2, Math.round(100 * v.n / max)) + "%" }} /></span>
                      <span className="vn">{v.n.toLocaleString()}</span>
                      {/* share of the cases that HAVE a value for this
                          attribute, which is the facet's own total — not
                          the whole cohort, since that would make every
                          sparsely-recorded attribute look small. `total`,
                          not `c.patients`: once this attribute is itself
                          drafted, c.patients is the draft's (self-narrowed)
                          count, while `total` is the disjunctive-safe sum
                          of this facet's own values — the same one the pie
                          view's arcs already use, which is why only the
                          list view had every other value's share collapse
                          around whichever one you had just clicked. */}
                      <span className="vpct">{fmtPct(100 * v.n / total)}</span>
                    </button>
                  ))}
                </div>
                  {(c.distinct ?? 0) > c.values.length ? (
                    <span className="meta pad-tight vlistfoot">
                      showing {c.values.length.toLocaleString()} of {c.distinct!.toLocaleString()} values{c.values.length > VALLIST_ROWS ? " · scroll for more" : ""}
                    </span>
                  ) : c.values.length > VALLIST_ROWS && (
                    <span className="meta pad-tight vlistfoot">{c.values.length.toLocaleString()} values · scroll for more</span>
                  )}
              </>);
            }
            return (
              <div className="piewrap">
                <svg viewBox="0 0 72 72" className="pie" role="img" aria-label={c.attribute + " distribution"}>
                  {arcs.map((a: any, i: number) => (
                    <path key={i} d={a.path} fill={a.color} className={isSel(a.v) ? "slice on" : "slice"}
                      onClick={() => addClause(clause(a.v))}>
                      <title>{a.v.v + " — " + a.v.n.toLocaleString() + " (" + Math.round(1000 * a.frac) / 10 + "%)"}</title>
                    </path>
                  ))}
                </svg>
                <div className="pielegend">
                  {arcs.map((a: any, i: number) => (
                    <button key={i} className={isSel(a.v) ? "pikey on" : "pikey"} onClick={() => addClause(clause(a.v))}
                      title={"click to filter to " + a.v.v}>
                      <span className="swatch" style={{ background: a.color }} />
                      <span className="pname">{a.v.v}</span>
                      <span className="pn">{a.v.n.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          {c.kind === "num" && c.bins && c.bins.length > 1 && (() => {
            const maxN = Math.max(...c.bins.map((b: any) => b.count), 1);
            const clauseFor = (b: any) => {
              const per = c.per === "sample" ? { per: "sample" } : {};
              if (b.special === "<=") return { kind: "clinical", attribute: c.attribute, range: { lte: b.end }, ...per };
              if (b.special === ">") return { kind: "clinical", attribute: c.attribute, range: { gt: b.start }, ...per };
              return { kind: "clinical", attribute: c.attribute, range: { gt: b.start, lte: b.end }, ...per };
            };
            const label = (b: any) => b.special === "<=" ? "≤" + fmtNum(b.end) : b.special === ">" ? ">" + fmtNum(b.start) : fmtNum(b.start) + "–" + fmtNum(b.end);
            const tick = (b: any) => b.special === "<=" ? "≤" + fmtNum(b.end) : b.special === ">" ? ">" + fmtNum(b.start) : fmtNum(b.start);
            return (
              <Histogram ticks={c.bins.map(tick)} na={c.naCount ? "NA " + fmtInt(c.naCount) : null}>
                {c.bins.map((b: any, i: number) => (
                  <button key={i} className="hbar" title={label(b) + " · " + fmtInt(b.count) + " " + (c.per === "sample" ? "samples" : "patients") + " — click to filter"}
                    onClick={() => addClause(clauseFor(b))}>
                    <span className="hfill" style={{ height: Math.max(2, Math.round(100 * b.count / maxN)) + "%" }} />
                  </button>
                ))}
              </Histogram>
            );
          })()}
          {c.kind === "num" && <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className="meta">min {fmtNum(c.min)} · median {fmtNum(c.median)} · max {fmtNum(c.max)}</span>
            <Button variant="outline" size="xs" className={CHIP} onClick={() => addClause({ kind: "clinical", attribute: c.attribute, range: { gte: Math.round(c.median * 10) / 10 }, ...(c.per === "sample" ? { per: "sample" } : {}) })}>≥ median</Button>
            <Button variant="outline" size="xs" className={CHIP} onClick={() => addClause({ kind: "clinical", attribute: c.attribute, range: { lt: Math.round(c.median * 10) / 10 }, ...(c.per === "sample" ? { per: "sample" } : {}) })}>&lt; median</Button>
          </div>}
      </div>
    ))}
  </>;
}

/** the Add chart dialog's generic-assay tab: a profile, then one of its entities found by search */
function AssayChartPicker({ ctx }: { ctx: ExploreCtx }) {
  const { assayCharts, chartAssay, unchartAssay, exploreBusy } = ctx;
  const explore = ctx.explore!;
  const profiles = plottableProfiles(explore.profileCatalog || []).filter((p) => p.type === "GENERIC_ASSAY" && p.study);
  const [profile, setProfile] = useState("");
  const current = profiles.find((p) => p.profile === profile) || profiles[0];
  if (!profiles.length) return <p className="note mt-0 mb-3">No selected study has generic-assay data (mutational signatures, arm-level copy number, methylation, …).</p>;
  return (
    <div>
      <p className="note mt-0 mb-3">
        Chart one measurement of a generic assay — a mutational signature, a chromosome arm, a methylation probe — as a
        histogram or its values, counted in patients. Click a bar or value to filter on it.
      </p>
      <div className="row baseline g5">
        <Choice className="w-80" value={current.profile} onChange={setProfile}
          options={profiles.map((p) => [p.profile, p.name + (profileUse(p) === "assayCategory" ? " (categorical)" : "")] as const)} />
        <EntityField study={current.study || ""} profile={current.profile} value="" placeholder="choose what to chart…" busy={exploreBusy}
          side="chart" className="w-64" onPick={(e) => chartAssay(current.profile, e)} />
      </div>
      {assayCharts.map((c) => (
        <span key={c.profileType + "|" + c.entity} className="qchip mr-1 mt-1.5">
          {entityShortName(c.entity, c.profileType)}<span className="meta"> · {profiles.find((p) => p.profile === c.profileType)?.name || c.profileType}</span>
          <Button variant="ghost" size="icon-xs" className={CHIP_X} title={"stop charting " + c.entity} aria-label={"stop charting " + c.entity}
            onClick={() => unchartAssay(c.profileType, c.entity)}><X /></Button>
        </span>
      ))}
    </div>
  );
}

/** each charted generic-assay entity: a histogram or its values, a click a genericAssay clause */
export function AssayFacets({ ctx }: { ctx: ExploreCtx }) {
  const { addClause, exStudies, unchartAssay, addMode, splittingBy, splitDraftBy } = ctx;
  const explore = ctx.explore!;
  return <>
    {(explore.assayFacets || []).map((f) => {
      const profileName = (explore.profileCatalog || []).find((p) => p.profile === f.profileType)?.name || f.profileType;
      const title = (f.name || entityShortName(f.entity, f.profileType)) + ": " + profileName;
      // a study without the profile cannot compile the clause, so a partial chart only shows
      const clickable = f.studies.length >= exStudies.length;
      const why = clickable ? "" : " — held by " + f.studies.length + " of " + exStudies.length + " selected studies, so it cannot filter them all";
      const base = { kind: "genericAssay", profileType: f.profileType, entity: f.entity };
      return (
        <div key={f.profileType + "|" + f.entity} data-assayfacet={f.profileType + "|" + f.entity} className="card">
          <div className="facettitle flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate" title={f.entity}>{title}</span>
            <ChartMenu label={title} actions={addMode || exStudies.length > 1 ? [] : [
              { label: "Split by this", disabled: !!splittingBy, working: splittingBy === title,
                title: "Analyze the current selection split by " + title + (f.kind === "num"
                  ? ": above / at or below its median within the selection" : ": one arm per value with at least 10 patients, the rest in Other") +
                  "; patients with no value get their own arm",
                onClick: () => void splitDraftBy({ assay: { profileType: f.profileType, entity: f.entity } }, title) }]} />
            <Button variant="ghost" size="icon-xs" title="stop charting this" aria-label={"stop charting " + f.entity}
              onClick={() => unchartAssay(f.profileType, f.entity)}><X /></Button>
          </div>
          <span className="meta">patients · {fmtInt(f.measured)} of {fmtInt(f.total)} with a value{f.disjunctive ? " · counted without its own filter" : ""}{why}</span>
          {f.error && <p className="note flush mt-1">{f.error}</p>}
          {f.kind === "cat" && f.values && (() => {
            const max = Math.max(...f.values.map((v) => v.n), 1);
            return <div className="vallist">
              {f.values.map((v) => (
                <button key={v.v} className="valrow" disabled={!clickable}
                  title={v.v + " — " + fmtInt(v.n) + " patients" + (clickable ? " (click to filter)" : why)}
                  onClick={() => addClause({ ...base, values: [v.v] })}>
                  <span className="vname">{v.v}</span>
                  <span className="vbar"><i style={{ width: Math.max(2, Math.round(100 * v.n / max)) + "%" }} /></span>
                  <span className="vn">{fmtInt(v.n)}</span>
                  <span className="vpct">{f.measured ? fmtPct(100 * v.n / f.measured) : ""}</span>
                </button>
              ))}
            </div>;
          })()}
          {f.kind === "num" && f.bins && f.bins.length > 1 && (() => {
            const maxN = Math.max(...f.bins.map((b) => b.count), 1);
            const range = (b: NonNullable<typeof f.bins>[number]) => b.special === "<=" ? { lte: b.end } : b.special === ">" ? { gt: b.start } : { gt: b.start, lte: b.end };
            const label = (b: NonNullable<typeof f.bins>[number]) => b.special === "<=" ? "≤" + fmtNum(b.end!) : b.special === ">" ? ">" + fmtNum(b.start!) : fmtNum(b.start!) + "–" + fmtNum(b.end!);
            const tick = (b: NonNullable<typeof f.bins>[number]) => b.special === "<=" ? "≤" + fmtNum(b.end!) : b.special === ">" ? ">" + fmtNum(b.start!) : fmtNum(b.start!);
            return (
              <Histogram ticks={f.bins.map(tick)} na={f.total > f.measured ? "NA " + fmtInt(f.total - f.measured) : null}>
                {f.bins.map((b, i) => (
                  <button key={i} className="hbar" disabled={!clickable}
                    title={label(b) + " · " + fmtInt(b.count) + " patients" + (clickable ? " — click to filter" : why)}
                    onClick={() => addClause({ ...base, range: range(b) })}>
                    <span className="hfill" style={{ height: Math.max(2, Math.round(100 * b.count / maxN)) + "%" }} />
                  </button>
                ))}
              </Histogram>
            );
          })()}
          {f.kind === "num" && f.median != null && <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className="meta">min {fmtNum(f.min!)} · median {fmtNum(f.median)} · max {fmtNum(f.max!)}</span>
            {clickable && <>
              <Button variant="outline" size="xs" className={CHIP} onClick={() => addClause({ ...base, range: { gt: f.median } })}>&gt; median</Button>
              <Button variant="outline" size="xs" className={CHIP} onClick={() => addClause({ ...base, range: { lte: f.median } })}>≤ median</Button>
            </>}
          </div>}
        </div>
      );
    })}
  </>;
}

export function GeneFacets({ ctx }: { ctx: ExploreCtx }) {
  const { addClauses, geneStateClauses } = ctx;
  const explore = ctx.explore!;
  return <>
    {(explore.geneFacets || []).map(f => {
      const max = Math.max(...f.states.map(x => x.n), 1);
      return (
        <div key={f.gene + f.type} data-genefacet={f.gene + "|" + f.type} className="card">
          <div className="facettitle">
            {f.gene}: {f.type === "CNA" ? "copy-number alterations" : "somatic mutations"}
            <span className="meta"> · patient-level · {f.total.toLocaleString()} patients</span>
          </div>
          <div className="vallist">
            {f.states.map(st => (
              <button key={st.state} className="valrow"
                title={st.label + " — " + st.n.toLocaleString() + " patients (click to filter)"}
                onClick={() => addClauses(geneStateClauses(f.gene, f.type, st.state))}>
                <span className="vname" style={st.state === "notProfiled" ? { color: "var(--muted)" } : undefined}>
                  {st.label}
                </span>
                <span className="vbar"><i style={{ width: Math.max(2, Math.round(100 * st.n / max)) + "%" }} /></span>
                <span className="vn">{st.n.toLocaleString()}</span>
                <span className="vpct">{f.total ? fmtPct(100 * st.n / f.total) : ""}</span>
              </button>
            ))}
          </div>
          {f.overlap ? (
            <p className="note flush mt-1">
              {f.overlap.toLocaleString()} patient{f.overlap === 1 ? " is" : "s are"} counted in both
              Amplified and Deleted — amplified in one sample, deleted in another — so these rows
              over-sum the cohort by that much.
            </p>
          ) : null}
          {f.alteredUnprofiled ? (
            <p className="note flush mt-1">
              {f.alteredUnprofiled.toLocaleString()} patient{f.alteredUnprofiled === 1 ? " has" : "s have"} a
              call for {f.gene} but sit on no panel covering it — a contradiction in the source data. They are
              counted as not profiled.
            </p>
          ) : null}
        </div>
      );
    })}
  </>;
}

export function StudyBreakdown({ ctx }: { ctx: ExploreCtx }) {
  const { exStudies, setExploreStudies } = ctx;
  const explore = ctx.explore!;
  return <>
    {explore.studyBreakdown && explore.studyBreakdown.length > 0 && (
      <div className="card wide">
        <h2>Studies <span className="plain">— how {explore.draftCount != null ? "the draft" : "the selection"} breaks down{exStudies.length > 1 ? " across the " + exStudies.length + " selected studies" : ""}</span></h2>
        {(() => {
          const rows = explore.studyBreakdown!;
          const total = rows.reduce((n, r) => n + r.n, 0) || 1;
          return rows.map((r) => (
            <div key={r.study} className="sbrow" title={r.instanceLabel}>
              <span className="mono">{r.study}</span>
              <span className="meta inst">{r.instance !== "a" ? "⧉ " + r.instanceLabel : ""}</span>
              <span className="bar"><i style={{ width: Math.max(1, Math.round(100 * r.n / total)) + "%" }} /></span>
              <span className="meta pct">{fmtPct(100 * r.n / total)}</span>
              <span className="n">{r.n.toLocaleString()}</span>
              <span>{exStudies.length > 1 && (
                <Button variant="link" size="inline" title="explore only this study"
                  onClick={() => setExploreStudies([r.study])}>only</Button>
              )}</span>
            </div>
          ));
        })()}
        {exStudies.length > 1 && <p className="note mt-1.5">
          Patients are counted per study; a person enrolled in two studies counts in both (overlap is not deduplicated).
        </p>}
      </div>
    )}
  </>;
}

export function DataTypes({ ctx }: { ctx: ExploreCtx }) {
  const { addClause, parseDraft } = ctx;
  const explore = ctx.explore!;
  return <>
    {explore.dataTypes && explore.dataTypes.length > 0 && (
      <div className="card wide">
        <h2>Data types <span className="plain">— samples with each kind of molecular data</span></h2>
        {(() => {
          const FILTERABLE: Record<string, "MUTATION" | "CNA" | "SV"> = {
            MUTATION_EXTENDED: "MUTATION", COPY_NUMBER_ALTERATION: "CNA", STRUCTURAL_VARIANT: "SV"
          };
          const d = parseDraft();
          const selected = (t: string) => !!(d && d.all.some((cl: any) => cl.kind === "profiled" && cl.type === t));
          const max = Math.max(...explore.dataTypes!.map((x) => x.n), 1);
          return explore.dataTypes!.map((dt) => {
            const t = FILTERABLE[dt.alterationType];
            const row = (
              <>
                <span className="gname">{dt.profile}</span>
                <span className="meta dtlabel">{dt.label}</span>
                <span className="gbar"><i style={{ width: Math.max(2, Math.round(100 * dt.n / max)) + "%" }} /></span>
                <span className="gcount">{dt.n.toLocaleString()}</span>
              </>
            );
            return t ? (
              <button key={dt.profile} className={"generow dtrow" + (selected(t) ? " on" : "")}
                title={"click to require " + t + " data (profiled clause)"}
                onClick={() => addClause({ kind: "profiled", type: t })}>{row}</button>
            ) : (
              <div key={dt.profile} className="generow dtrow is-static"
                title="no membership filter for this data type in the DSL — shown for completeness">{row}</div>
            );
          });
        })()}
      </div>
    )}
  </>;
}

export function AlteredGenes({ ctx }: { ctx: ExploreCtx }) {
  const { addClause, addMode, geneFilter, geneRowLimit, selectionArmCount, setGeneFilter, setGeneRowLimit, splitDraftBy, splitDraftBySelection, splittingBy } = ctx;
  const explore = ctx.explore!;
  return <>
    {(["mutated", "cna", "sv"] as const).map((kind) => {
      const meta = {
        mutated: { title: "Mutated Genes", rows: explore.mutatedGenes, total: explore.geneTotals?.mutated, oql: (g: any) => g.gene + ": MUT" },
        cna:     { title: "CNA Genes",     rows: explore.cnaGenes,     total: explore.geneTotals?.cna,     oql: (g: any) => g.gene + (g.cna === 2 ? ": AMP" : ": HOMDEL") },
        sv:      { title: "SV Genes",      rows: explore.svGenes,      total: explore.geneTotals?.sv,      oql: (g: any) => g.gene + ": FUSION" }
      }[kind];
      const all = meta.rows || [];
      // Client-side, over the rows already loaded. The table is capped
      // at GENE_TABLE_LIMIT server-side, so this finds a gene among the
      // top 500 by alteration count and says so when it cannot — a box
      // that silently searched less than it appeared to would be worse
      // than no box.
      const needle = (geneFilter[kind] || "").trim().toUpperCase();
      const rows = needle ? all.filter((g: any) => g.gene.toUpperCase().includes(needle)) : all;
      if (!all.length) return null;
      return (
        <div className="card wide" key={kind} data-genetable={kind}>
          <div className="row baseline g5">
            <h2 className="flush">{meta.title} <span className="plain">— samples, panel-aware frequency</span></h2>
            <span className="spacer" />
            <span className="meta">{needle
              ? rows.length.toLocaleString() + " of " + all.length.toLocaleString() + " loaded match"
              : "showing " + Math.min(rows.length, geneRowLimit).toLocaleString() +
                " of " + (meta.total || rows.length).toLocaleString()}</span>
            <Input type="search" className={SEARCH} placeholder="find gene" value={geneFilter[kind] || ""}
              title={"filters the " + all.length + " genes loaded for this table, not all " + (meta.total || all.length)}
              onChange={e => setGeneFilter({ ...geneFilter, [kind]: e.target.value })} />
            {(() => {
              const chart: ChartKey = { kind: "genes", specs: kind === "mutated" ? [": MUT"] : kind === "cna" ? [": AMP", ": HOMDEL"] : [": FUSION"] };
              const n = selectionArmCount(chart);
              const exact = kind === "mutated" ? all.find((g: any) => g.gene.toUpperCase() === needle) : undefined;
              return <ChartMenu label={meta.title} actions={addMode ? [] : [
                ...(exact ? [{ label: "Split by " + exact.gene, disabled: !!splittingBy, working: splittingBy === exact.gene,
                  title: "Analyze the current selection split into " + exact.gene + " mutated / wild-type / not profiled for " + exact.gene,
                  onClick: () => splitDraftBy({ gene: exact.gene }, exact.gene) }] : []),
                ...(n > 0 ? [{ label: "Split by selected (" + (n > 8 ? "8+" : n) + ")",
                  title: "Analyze with each selected gene in this table as its own arm (tested in the order you clicked them), the rest of your selection as the cohort they split, and everyone else in Other or Not profiled",
                  onClick: () => splitDraftBySelection(chart, kind === "mutated" ? "mutated genes" : kind === "cna" ? "CNA genes" : "SV genes") }] : [])
              ]} />;
            })()}
          </div>
          <div className="generows">
            {rows.slice(0, geneRowLimit).map((g) => (
              <button key={g.gene + (g.cna ?? "")} className="generow" title={"click to add " + meta.oql(g)}
                onClick={() => addClause({ kind: "oql", q: meta.oql(g) })}>
                <span className="gname">{g.gene}</span>
                {/* altered / wild-type / NOT PROFILED, the three-way split
                    the portal draws as a per-gene pie. The third segment is
                    the point: a sample whose panel omits this gene is not
                    wild-type for it, it was never tested, and that is
                    invisible in "altered/profiled" alone. For CNA in
                    genie_public it is 70,450 of 289,869 samples — a quarter
                    of the cohort. Computed here from numbers already in the
                    payload; no extra query. */}
                {(() => {
                  // samples whose call is off-panel were not profiled for the gene: they sit in the
                  // not-profiled share, as on the portal, where they count in "#" but not in Freq
                  const total = explore.totals?.samples ?? g.profiled;
                  const onPanel = g.alteredOnPanel ?? g.altered;
                  const wild = Math.max(0, g.profiled - onPanel);
                  const unprofiled = Math.max(0, total - g.profiled);
                  const sum = onPanel + wild + unprofiled || 1;
                  const w = (n: number) => (100 * n / sum) + "%";
                  return (
                    <span className="gsplit" aria-hidden="true"
                      title={onPanel.toLocaleString() + " altered · " + wild.toLocaleString() +
                        " profiled and unaltered · " + unprofiled.toLocaleString() + " not profiled for " + g.gene}>
                      <i className="s-alt" style={{ width: w(onPanel) }} />
                      <i className="s-wt" style={{ width: w(wild) }} />
                      <i className="s-np" style={{ width: w(unprofiled) }} />
                    </span>
                  );
                })()}
                {/* cytoband for CNA and the event count for mutations were
                    already in the payload and simply not drawn. The event
                    count is not the same as the sample count: TP53 in
                    genie_public has 125,303 mutations across 111,368
                    samples, and only one of those is the frequency's
                    numerator. */}
                {kind === "cna" && <span className="gcyto" title="cytoband">{g.cytoband || ""}</span>}
                {kind !== "cna" && <span className="gevents" title={g.events.toLocaleString() + " events across " + g.altered.toLocaleString() + " samples"}>{g.events.toLocaleString()}</span>}
                <span className={g.cna != null ? "cnatag " + (g.cna === 2 ? "amp" : "del") : "cnatag none"}>{g.cna != null ? (g.cna === 2 ? "AMP" : "HOMDEL") : ""}</span>
                <span className="gfreq">{g.freqPct != null ? fmtPct(g.freqPct) : "—"}</span>
                {(() => {
                  const onPanel = g.alteredOnPanel ?? g.altered, off = g.altered - onPanel;
                  return (
                    <span className="gcount" title={off > 0 ? off.toLocaleString() + " more sample" + (off === 1 ? " has" : "s have") +
                      " a call in " + g.gene + " that their panel does not cover (off-panel): counted among the " +
                      g.altered.toLocaleString() + " altered, as cBioPortal's \"#\" does, but not in the frequency, since those samples were not profiled for it" : undefined}>
                      {onPanel.toLocaleString()}<span className="meta">/{g.profiled.toLocaleString()}</span>
                      {off > 0 && <span className="meta goff"> +{off.toLocaleString()} off-panel</span>}
                    </span>
                  );
                })()}
              </button>
            ))}
          </div>
          {needle && !rows.length && (
            <p className="note flush mt-1.5">
              No match among the {all.length.toLocaleString()} genes loaded for this table
              {meta.total && meta.total > all.length ? " (of " + meta.total.toLocaleString() + " altered in this cohort)" : ""}.
            </p>
          )}
          {!needle && rows.length > geneRowLimit && (
            <Button variant="link" size="inline" onClick={() => setGeneRowLimit(geneRowLimit + 50)}>show more</Button>
          )}
        </div>
      );
    })}
  </>;
}

export function EventsAndCaseLists({ ctx }: { ctx: ExploreCtx }) {
  const { addClause, parseDraft } = ctx;
  const explore = ctx.explore!;
  return <>
    <div className="card">
      <h2>Timeline events</h2>
      {explore.events.length === 0 && <p className="note">This study has no clinical timeline events.</p>}
      {(() => {
        const max = Math.max(...explore.events.map(e => e.n), 1);
        const dr = parseDraft();
        const isSel = (type: string) => ((dr && dr.all) || []).some((c: any) =>
          c && c.kind === "event" && c.rel?.type === "NONE" && c.a?.eventType === type);
        return (
          <div className="vallist">
            {explore.events.map(e => (
              <button key={e.type} className={isSel(e.type) ? "valrow on" : "valrow"}
                title={"has " + e.type + " — " + e.n.toLocaleString() + " patients (click to filter)"}
                onClick={() => addClause({ kind: "event", a: { eventType: e.type }, rel: { type: "NONE" } })}>
                <span className="vname">has {e.type}</span>
                <span className="vbar"><i style={{ width: Math.max(2, Math.round(100 * e.n / max)) + "%" }} /></span>
                <span className="vn">{e.n.toLocaleString()}</span>
              </button>
            ))}
          </div>
        );
      })()}
    </div>
    <div className="card">
      <h2>Case lists</h2>
      {(() => {
        const max = Math.max(...explore.caseLists.map(l => l.n), 1);
        const dr = parseDraft();
        const isSel = (id: string) => ((dr && dr.all) || []).some((c: any) => c && c.kind === "caseList" && c.id === id);
        return (
          <div className="vallist">
            {explore.caseLists.map(l => (
              <button key={l.id} className={isSel(l.id) ? "valrow on" : "valrow"}
                title={l.name + " — " + l.n.toLocaleString() + " patients (click to filter)"}
                onClick={() => addClause({ kind: "caseList", id: l.id })}>
                <span className="vname">{l.id}</span>
                <span className="vbar"><i style={{ width: Math.max(2, Math.round(100 * l.n / max)) + "%" }} /></span>
                <span className="vn">{l.n.toLocaleString()}</span>
              </button>
            ))}
          </div>
        );
      })()}
      <p className="note">Profiles here: {(explore.profiles || []).join(", ") || "none"}{explore.gaProfiles && explore.gaProfiles.length ? " · assays: " + explore.gaProfiles.join(", ") : ""} · facet counts {explore.draftCount != null ? "narrowed to your draft" : "study-wide"} · {explore.stats.ms}ms</p>
    </div>
  </>;
}
