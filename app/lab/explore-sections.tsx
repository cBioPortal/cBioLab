"use client";
// Explore's sections: the study picker, the action bar, the add-chart dialog and the facet grid's
// cards. The page owns Explore's state (app/lab/use-explore.ts and the draft) and hands every
// section the same ExploreCtx — what it reads and the edits it can make.
import { useEffect, useMemo, useState } from "react";
import type { Clause, Leaf, PartitionArm } from "../../lib/types";
import StudyViewPills from "./study-view-pills";
import CustomBinsDialog from "./custom-bins-dialog";
import { binsAfterEdit, logScaleOffered, oneValueBars, binMethodName } from "../../lib/study-view-bins.ts";
import { ChartMenu, type ChartAction } from "./partitions.tsx";
import { ANALYSIS_MAX_COHORTS, armLabel, COMPARISON_MAX_ACTIVE, COMPARISON_MAX_GROUPS, type ChartKey } from "../../lib/partition-arms.ts";
import type { OnCustomData } from "./pills";
import { isCustomAttr } from "../../lib/custom-data-names.ts";
import { CAT_COLORS } from "./view-chrome.tsx";
import { useWidth } from "./figure.tsx";
import { textWidth } from "../../lib/chart/text.ts";
import { fmtInt, fmtNum, fmtPct, portalFreq } from "../../lib/chart/format.ts";
import { naturalOrder } from "../../lib/ordinal.ts";
import { barFigureSvg, pieFigureSvg, type FigureBar, type PieSlice } from "../../lib/study-view-figures.ts";
import { caseFileAction, figureActions, saveCaseFile } from "./chart-files.ts";
import { caseFileName } from "../../lib/study-view-case-files.ts";
import { addChartLines, bulkButtons } from "../../lib/study-view-add-chart.ts";
import { StudyHeader } from "./explore-study-header.tsx";
import type { CohortDef } from "../../lib/types.ts";
import { alteredHeaderTip, appliedLines, queuedQuery, defaultGeneSort, freqTipLines, geneHeaderTips, geneSelection, geneTableName, geneTableTitle, geneTableTsv, intersectionRefusal, nextGeneSort, profiledSamples, qValueIcon, sortGeneRows, type GeneSort, type GeneSortColumn } from "../../lib/study-view-gene-tables.ts";
import { chartFileName, saveText, summaryCut, summaryDataTsv, type CategoryCount, type DownloadUnit } from "../../lib/study-view-download.ts";
import { binSelected, chartSelection, naSelected } from "../../lib/explore-selection.ts";
import { PORTAL_NA } from "../../lib/chart/style.ts";
import { cn } from "../../lib/cn.ts";
import { SaveCohortDialog, SaveFeatureDialog } from "./dialogs.tsx";
import { DEFAULT_CLINICAL_CHARTS, SHOW_DERIVED_FACETS, type ExploreState, type GroupsTarget } from "./use-explore-state.ts";
import { LINE_TYPE } from "../../lib/treatment-lines.ts";
import { Dna, Download, Filter, LoaderCircle, Save, Search, Tag, Users, X } from "lucide-react";
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
import { PickBar, PickRow, ValueList, VirtualRows, usePicks } from "./pick-list.tsx";
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
  const { addMode, analyzeDraft, viewPatients, exDraftStudies, exPanelOpen, exSel, exStudies, explore, exploreBusy, parseDraft, queuedGenes, sCaps, sQuery, setExDraftStudies, setExPanelOpen, setExploreStudies, setSCaps, setSQuery, setStudyChipsOpen, studies, studyChipsOpen } = ctx;
  // what a gene query is being written for: the selection (the header's button) or one study (a row's icon)
  const [queryFor, setQueryFor] = useState<{ studies: string[]; filters: Clause[]; query?: string } | null>(null);
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
                <span className="skeleton skeleton-counts" data-tip={selPts ? "counting… (the selected studies hold " + selPts.toLocaleString() + " patients before deduplication)" : "counting…"} />}
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
                    <span key={id} className="qchip" data-tip={nameOf(id)}>
                      {id}
                      <Button variant="ghost" size="icon-xs" className={CHIP_X}
                        data-tip={"remove " + id + " from the selection"} aria-label={"remove " + id}
                        onClick={() => toggle(id)}><X /></Button>
                    </span>
                  ))}
                  {over > 1 && (
                    <button className="qchip morechip" onClick={() => setStudyChipsOpen(!studyChipsOpen)}
                      data-tip={studyChipsOpen ? "collapse the list" : exStudies.map(nameOf).join("\n")}>
                      {studyChipsOpen ? "show fewer" : "+" + over.toLocaleString() + " more"}
                    </button>
                  )}
                </span>
              );
            })()}
            <span className="spacer" />
            {!addMode && <Button onClick={analyzeDraft} disabled={!ready}
              data-tip={ready ? "start a fresh analysis of this cohort (replaces the current document)" : "select a study first"}>
              Analyze
            </Button>}
            {!addMode && <Button variant="outline" className="querygenes" disabled={!!queryWhy}
              onClick={() => setQueryFor({ studies: exStudies, filters: selectionFilters, ...(queuedGenes.length ? { query: queuedQuery(queuedGenes) } : {}) })}
              data-tip={queryWhy || "query genes in " + (exStudies.length === 1 ? exStudies[0] : exStudies.length + " studies") +
                (selectionFilters.length ? ", within your " + selectionFilters.length + " filter" + (selectionFilters.length === 1 ? "" : "s") : "") +
                ", and open the results — oncoprint, mutations, survival…"}>
              <Dna />Query genes…{queuedGenes.length ? " (" + queuedGenes.length + ")" : ""}
            </Button>}
            {!addMode && <Button variant="outline" className="viewpatients" disabled={!ready} onClick={() => void viewPatients()}
              data-tip={ready ? "open the Patient page on the first of " + (parseDraft() ? "the patients your filters select" : "the selected studies' patients") +
                ", and step through the rest" : "select a study first"}>
              <Users />View patients
            </Button>}
            {!addMode && <ClinicalDataButton ctx={ctx} ready={ready} />}
            {exStudies.length > 0 && <Button variant="outline" onClick={() => {
              if (exPanelOpen) { setExDraftStudies(null); setExPanelOpen(false); }   // close discards
              else { setExDraftStudies(exStudies); setExPanelOpen(true); }           // open seeds
            }}>{exPanelOpen ? "Cancel" : "Add / change studies"}</Button>}
          </div>
          {exStudies.length > 0 && !exPanelOpen && <StudyHeader studies={exStudies.map((id) => ({ id, name: names.get(id) || id }))} />}
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
                data-tip={staged.length ? "run the facets for these " + staged.length + " studies" : "stage at least one study"}>
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
  const { addMode, applyOrSay, chartBins, setChartBins, clearDraft, confirmSave, exMsg, exStudies, explore, exploreBusy, openSaveDialog, parseDraft, removeDraftClause, saveDraftAsFeature, confirmSaveFeature, saving, setSaving, savingFeature, setSavingFeature, showClauseData } = ctx;
  return <>
    {(() => {
      const d = parseDraft();
      const clauses = d && Array.isArray(d.all) ? d.all.length : 0;
      // with no filters there is no bar, but a chart menu's refusal ("Could not compare: …") still shows
      if (!clauses) return exMsg && !addMode ? <p className="note exmsg">{exMsg}</p> : null;
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
            {/* editing a saved cohort, its bar above saves the filters over it */}
            {!addMode?.editing && <>
              <Button variant="outline" size="sm" onClick={openSaveDialog} disabled={!ready}
                data-tip={ready ? "keep this definition on the Saved tab without running anything" : "select a study first"}>
                <Save />Save as a Cohort
              </Button>
              <Button variant="outline" size="sm" onClick={saveDraftAsFeature} disabled={!ready}
                data-tip={ready ? "freeze who matches these filters into a yes/no custom attribute you can chart, split and filter on" : "select a study first"}>
                <Tag />Save as feature
              </Button>
            </>}
            <Button variant="ghost" size="sm" onClick={clearDraft} data-tip="remove every filter, keeping the studies"><X />Clear All Filters</Button>
          </div>
          <div className="row mt-1.5">
            {(() => {
              const dr = parseDraft();
              if (!dr) return null;
              const names = new Map<string, string>();
              for (const f of explore?.clinical || []) if (f.displayName && !names.has(f.attribute)) names.set(f.attribute, f.displayName);
              const edited = (attribute: string, ends: number[]) => {
                const f = explore?.clinical.find((x) => x.attribute === attribute && x.kind === "num");
                if (f?.kind === "num" && f.bins && !oneValueBars(f.bins)) setChartBins(attribute, binsAfterEdit(chartBins(attribute), f.bins, ends), false);
              };
              return <StudyViewPills draft={dr} labelOf={(a) => names.get(a)} apply={applyOrSay} onIntervalEdited={edited}
                onRemoveClause={removeDraftClause} onCustomData={showClauseData()} />;
            })()}
          </div>
          {exMsg && <p className="note flush mt-1.5">{exMsg}</p>}
          {!!explore?.unknownAttributes?.length && <p className="error flush mt-1.5" data-unknown-attrs>
            {explore.unknownAttributes.map((a) => "The clinical attribute " + a + " is not available for " + (exStudies.length === 1 ? "this study" : "these studies")).join(". ")}
            {" — a filter on it selects nobody; remove its pill."}</p>}
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
  const { addChartOpen, setAddChartOpen, addSeqFilter, clearAttributeFilters, attrCoverage, attrKey, chartGene, chartTab, clinFilter, exStudies, exploreBusy, fetchExplore, geneChartInput, openCustomManager, geneCharts, chartChecked, setChartsChecked, seq, seqReady, setAttrCoverage, setChartTab, setClinFilter, setGeneChartInput, setSeq, treatmentEventType, unchartGene } = ctx;
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
          // with the declared attributes no selected sample has data for: the portal lists them, 0% and disabled;
          // only those the query counted (one it was not asked for, or cut at its limit, is unknown, not 0%)
          const builtin = [...explore.clinical.filter((c) => !isCustomAttr(c.attribute)),
            ...(explore.declaredAttributes || []).filter((d) => d.counted !== false && !isCustomAttr(d.attribute) && !explore.clinical.some((c) => c.attribute === d.attribute))
              .map((d) => ({ ...d, kind: "cat" as const, values: [], patients: 0, samples: 0, absent: true }))] as typeof explore.clinical;
          const keysOf = (list: typeof explore.clinical) => list.map(attrKey);
          const checkedOf = (list: typeof explore.clinical) => list.filter((c) => chartChecked(attrKey(c))).length;
          // the portal's Freq: the selected samples with data, of the selection's samples (add-chart-cases.md)
          const selected = explore.totals?.samples ?? 0;
          const lines = (list: typeof explore.clinical) => {
            const byKey = new Map(list.map((c) => [attrKey(c), c] as const));
            return addChartLines(list.map((c) => ({ key: attrKey(c), name: c.displayName || c.attribute, samples: c.samples ?? 0, checked: chartChecked(attrKey(c)) })), selected)
              .map((l) => ({ ...l, c: byKey.get(l.key)! }));
          };
          /** check or uncheck charts; an unchecked chart takes its filter with it */
          const check = (list: typeof explore.clinical, on: boolean) => {
            setChartsChecked(keysOf(list), on);
            if (!on) clearAttributeFilters(list.map((c) => c.attribute));
          };
          /** Select all (N) and Deselect all over the rows the search keeps, as the portal's list has them */
          const bulk = (shown: typeof explore.clinical, all: typeof explore.clinical) => {
            const b = bulkButtons(lines(shown), lines(all));
            const pick = (keys: string[]) => all.filter((c) => keys.includes(attrKey(c)));
            return <>
              {b.selectAll && <Button variant="link" size="inline" disabled={!b.selectAll.keys.length} onClick={() => check(pick(b.selectAll!.keys), true)}>Select all ({b.selectAll.n})</Button>}
              {b.deselectAll && <Button variant="link" size="inline" onClick={() => check(pick(b.deselectAll!), false)}>Deselect all</Button>}
            </>;
          };
          const table = (rows: typeof explore.clinical, showDataset: boolean) => (
            <div className="attrtablewrap">
              <table className="attrtable">
                <thead>
                  <tr><th></th><th>Attribute</th><th className="num" data-tip="% samples with data">Freq</th>{showDataset && <th>Dataset</th>}<th>Type</th><th>Level</th></tr>
                </thead>
                <tbody>
                  {lines(rows).map(({ c, freq, disabled }) => {
                    const toggle = () => { if (!disabled) check([c], !chartChecked(attrKey(c))); };
                    // Shown regardless — the checklist is the union across the
                    // selection (see visibleClinical's own comment) — but an
                    // attribute only SOME of the selected studies actually carry
                    // reads as universal without this, so mark it rather than
                    // leave the reader to discover the gap study by study.
                    const partial = exStudies.length > 1 && (c.studyCount ?? 1) < exStudies.length;
                    return (
                      <tr key={attrKey(c)} className={disabled ? "text-muted-foreground" : undefined} aria-disabled={disabled || undefined}
                        onClick={(e) => { if (!(e.target as HTMLElement).closest("[role=checkbox]")) toggle(); }}>
                        <td><Checkbox checked={chartChecked(attrKey(c))} disabled={disabled} onCheckedChange={toggle} aria-label={"chart " + (c.displayName || c.attribute)}
                          data-tip={disabled ? "no selected sample has data for this attribute" : undefined} /></td>
                        <td>
                          {c.displayName || c.attribute}
                          {partial && (
                            <span className="meta" data-tip={"carried by " + (c.studyCount ?? 1) + " of " + exStudies.length + " selected studies, not all of them"}> *</span>
                          )}
                        </td>
                        <td className="num meta">{portalFreq(freq)}</td>
                        {showDataset && <td className="meta" data-tip={c.description}>{(c.attribute || "").replace(/^custom:/, "").split("/")[0]}</td>}
                        <td className="meta">{(c as { absent?: boolean }).absent ? "—" : c.kind === "num" ? "numeric" : "categorical"}</td>
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
                  {bulk(custom, custom)}
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
                  data-tip="narrows this checklist by attribute name" autoFocus
                  onChange={e => setClinFilter(e.target.value)} />
                <span className="meta">{checkedOf(builtin)} of {builtin.length} checked</span>
                {bulk(rows, builtin)}
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
                <Button variant="ghost" size="icon-xs" className={CHIP_X} data-tip={"stop charting " + g} aria-label={"stop charting " + g}
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
                  <label className="chk" data-tip="restricts the first event to patients with no treatment recorded before it">
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
                    data-tip={tx ? "based on '" + tx.label + "' events" : "this study records no treatment-like timeline events, so this can't be derived here"}>
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
                <div className="facettitle" data-tip={d.note}>
                  {d.label} <span className="meta">· {d.covered.toLocaleString()} patients
                    {(d as any).disjunctive ? " · not narrowed by its own filter" : ""}</span>
                </div>
                <div className="vallist">
                  {d.buckets.map(b => (
                    <button key={b.label} className={picked(b) ? "valrow on" : "valrow"}
                      data-tip={d.note + " — click to filter"}
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

/**
 * How a chart menu's group actions read for each place the groups can open: cBioPortal's group
 * comparison (a new tab), or a fresh analysis on this page with each group a cohort.
 */
const GROUPS: Record<GroupsTarget, { verb: string; doing: string; opens: string; holds: string; max: number; past: (n: number) => string }> = {
  comparison: { verb: "Compare", doing: "compare", opens: "open group comparison with", holds: "the comparison page holds", max: COMPARISON_MAX_GROUPS, past: (n) => past(n) },
  analysis: { verb: "Analyze", doing: "analyze", opens: "start a fresh analysis (replacing the current one) with", holds: "an analysis document holds", max: ANALYSIS_MAX_COHORTS, past: () => "" }
};
/** a chart's group action for both targets — compare, then analyze — leaving out what one target has nothing to add to */
const forBoth = (make: (t: GroupsTarget) => ChartAction | null): ChartAction[] =>
  (["comparison", "analysis"] as const).map(make).filter((a): a is ChartAction => !!a);

/**
 * A categorical chart's "Download ▸ Summary Data", the portal's last chart-menu item: a row per
 * value with its count and share (docs/legacy-spec/parity/download-cases.md). Disabled, saying
 * why, when the chart holds only its most frequent values.
 */
function summaryDownload(name: string, unit: DownloadUnit, values: CategoryCount[], na: number, distinct: number | undefined,
  onError: (message: string) => void, order?: (vs: CategoryCount[]) => CategoryCount[], full?: ChartAction): ChartAction {
  const cut = summaryCut(values.length, distinct);
  const counts = na > 0 ? [...values, { value: "NA", count: na }] : values;
  const file = chartFileName(name, "summary");
  return { label: "Download", title: "save this chart's data as a file", sub: [
    { label: "Summary Data", disabled: !!cut, title: cut || "each value with its count and percentage, as " + file,
      onClick: () => saveText(file, summaryDataTsv(counts, unit)) },
    ...(full ? [full] : []),
    ...figureActions(name, () => pieFigureSvg(name, pieSlices(order ? order(values) : values, na)), onError)
  ] };
}

/**
 * The portal's "Download clinical data": every clinical attribute of each selected sample, as
 * <study>_clinical_data.tsv (download-cases.md PC9), through the patient-level table route.
 */
function ClinicalDataButton({ ctx, ready }: { ctx: ExploreCtx; ready: boolean }) {
  const [busy, setBusy] = useState(false);
  const file = caseFileName({ kind: "clinical" }, "", ctx.exStudies);
  const save = () => {
    const sel = selectionOf(ctx);
    if (!sel) { ctx.setExMsg("select a study first"); return; }
    setBusy(true);
    ctx.setExMsg(null);
    saveCaseFile({ kind: "clinical" }, file, sel.def, sel.study)
      .then((left) => ctx.setExMsg(left ? file + " leaves out the studies that may not list their patients: " + left : null))
      .catch((e) => ctx.setExMsg("Could not download the clinical data: " + String((e as Error)?.message || e)))
      .finally(() => setBusy(false));
  };
  return (
    <Button variant="outline" className="clinicaldata" disabled={!ready || busy} onClick={save}
      data-tip={!ready ? "select a study first" : busy ? "preparing " + file + "…" : "download clinical data for the selected cases, as " + file}>
      {busy ? <LoaderCircle className="animate-spin" /> : <Download />}Download clinical data
    </Button>
  );
}

/** the selection a per-case file lists: the draft (or every selected study), in the first study's document */
function selectionOf(ctx: ExploreCtx): { def: CohortDef; study: string } | null {
  const def = ctx.barDef();
  return def ? { def, study: ctx.exSel.current[0] } : null;
}

/** a categorical chart's values as the pie draws them: the page's colours in order, NA grey and last */
function pieSlices(values: CategoryCount[], na: number): PieSlice[] {
  return [...values.map((v, i) => ({ value: v.value, count: v.count, color: CAT_COLORS[i % CAT_COLORS.length] })),
    ...(na > 0 ? [{ value: "NA", count: na, color: PORTAL_NA }] : [])];
}

/** the width a histogram is saved at, as a card draws it */
const BAR_FIGURE_W = 300;

/** a histogram's bars as a file draws them: its ticks thinned as the card thins them at the saved width */
function barFigure(bars: FigureBar[], naNote: string | null): string {
  const fs = FS_TICK;
  const room = (BAR_FIGURE_W - 16 - (naNote ? textWidth(naNote, fs) + 8 : 0)) / Math.max(1, bars.length);
  const widest = Math.max(...bars.map((b) => textWidth(b.tick, fs))) + 4;
  const every = Math.max(1, Math.ceil(widest / Math.max(1, room)));
  return barFigureSvg(bars.map((b, i) => ({ ...b, tick: i % every === 0 ? b.tick : "" })), { width: BAR_FIGURE_W, ...(naNote ? { naNote } : {}) });
}
/** the tick font of a saved histogram, the figures' small size */
const FS_TICK = 10;

/**
 * A chart menu's "Compare groups" (or "Analyze groups"), as the portal's study view opens group
 * comparison from a chart: the rows the reader checked, each a group, or — with none checked — the
 * chart's values, the most frequent first, up to the most groups the target takes (20 for the comparison
 * page, 16 for an analysis document; the item says when it leaves values out). `checked` is null for a chart without checkboxes. With one
 * row checked only the comparison's "check another" hint is given, so the menu says it once.
 */
function compareAction(values: (PartitionArm & { n: number })[], checked: PartitionArm[] | null, what: string, onCompare: (arms: PartitionArm[]) => void, target: GroupsTarget = "comparison"): ChartAction | null {
  const g = GROUPS[target];
  if (checked && checked.length === 1)
    return target === "comparison" ? { label: "Check another row to compare or analyze", disabled: true, title: "groups need at least 2 rows — check another " + what } : null;
  if (checked && checked.length > g.max)
    return { label: g.verb + " checked groups (" + checked.length + ")", disabled: true, title: g.holds + " at most " + g.max + " groups — uncheck " + (checked.length - g.max) };
  if (checked && checked.length)
    return { label: g.verb + " checked groups (" + checked.length + ")", onClick: () => onCompare(checked),
      title: g.opens + " each checked " + what + " as a group (the rest of your selection, without this chart's own filter)" + g.past(checked.length) };
  const top = [...values].filter((v) => v.n > 0).sort((x, y) => y.n - x.n).slice(0, g.max);
  const more = values.filter((v) => v.n > 0).length - top.length;
  if (top.length < 2) return { label: g.verb + " groups", disabled: true, title: g.doing + " needs at least 2 groups, and this chart has " + top.length + " " + what };
  return { label: more ? g.verb + " top " + top.length + " groups" : g.verb + " groups", onClick: () => onCompare(top),
    title: g.opens + " each " + what + " as a group" + (more ? " — the " + top.length + " most frequent; " + more + " more are left out (check rows to choose)" : "") +
      ", over the rest of your selection" + g.past(top.length) };
}

/** what a tooltip adds when the page will open with some groups taken out */
const past = (n: number) => n > COMPARISON_MAX_ACTIVE ? "; the page compares " + COMPARISON_MAX_ACTIVE + " at a time, so it opens with the first " + COMPARISON_MAX_ACTIVE + " and you swap the others in" : "";

/** a numeric chart's "Compare groups ▸ Quartiles / Median / Current bins", as on cBioPortal (or "Analyze groups ▸ …") */
function compareNumeric(label: string, singleStudy: boolean, working: boolean, quantiles: (n: number) => void, bins: PartitionArm[], onBins: () => void, target: GroupsTarget = "comparison"): ChartAction {
  const g = GROUPS[target];
  const multi = "cut points are computed within one study; select a single study to " + g.doing + " its quartiles or median";
  return { label: g.verb + " groups", working, disabled: working, title: g.opens + " " + label + " divided into groups", sub: [
    { label: "Quartiles", disabled: !singleStudy, onClick: () => quantiles(4), title: singleStudy ? "four groups of (near) equal size, cut at " + label + "'s quartiles within your selection" : multi },
    { label: "Median", disabled: !singleStudy, onClick: () => quantiles(2), title: singleStudy ? "two groups, at or below / above " + label + "'s median within your selection" : multi },
    { label: "Current bins", disabled: bins.length < 2 || bins.length > g.max, onClick: onBins,
      title: bins.length < 2 ? "the chart has fewer than 2 bins with cases" : bins.length > g.max
        ? "the chart has " + bins.length + " bins with cases, and " + g.holds + " at most " + g.max : "one group per bar of the chart (" + bins.length + ")" + g.past(bins.length) }
  ] };
}

/** a value list's key for its NA row, which no value can spell */
const NA_KEY = "\u0000NA";

/** a clinical histogram bar as a filter: a word ("Negative"), one value (start = end), an outlier bar or an interval (start, end] */
function binClause(attribute: string, b: any): Clause {
  if (b.value != null) return { kind: "clinical", attribute, values: [b.value] };
  if (b.special === "<=") return { kind: "clinical", attribute, range: { lte: b.end } };
  if (b.special === ">") return { kind: "clinical", attribute, range: { gt: b.start } };
  if (b.start === b.end) return { kind: "clinical", attribute, op: "=", value: b.start };
  return { kind: "clinical", attribute, range: { gt: b.start, lte: b.end } };
}
const binLabel = (b: any): string => b.value != null ? b.value : b.special === "<=" ? "≤" + fmtNum(b.end) : b.special === ">" ? ">" + fmtNum(b.start)
  : b.start === b.end ? fmtNum(b.start) : fmtNum(b.start) + "–" + fmtNum(b.end);

export function ClinicalFacets({ ctx }: { ctx: ExploreCtx }) {
  const { visibleClinical } = ctx;
  const explore = ctx.explore!;
  return <>
    {(visibleClinical(explore.clinical as never) as unknown as typeof explore.clinical)
      .map((c) => <ClinicalFacet key={c.per + c.attribute} c={c} ctx={ctx} />)}
  </>;
}

/* data-attr / data-shape make the facet identifiable from outside
   React — the e2e suite asserts that an attribute's shape does not
   change when the draft does. One tile per attribute, the portal's
   own study-view density — see .facetgrid's own comment. */
function ClinicalFacet({ c, ctx }: { c: NonNullable<ExploreCtx["explore"]>["clinical"][number]; ctx: ExploreCtx }) {
  const { addClause, addMode, chartBins, setChartBins, exStudies, parseDraft, selectionArmCount, compareQuantiles, compareItems, compareSelection, splittingBy, toggleBar, togglePieValue, toggleNaValue } = ctx;
  const picks = usePicks();
  const [binsOpen, setBinsOpen] = useState(false);
  const binSet = c.kind === "num" ? chartBins(c.attribute) : undefined;
  const showNa = !!binSet?.showNa && c.kind === "num" && !!c.naCount;
  return (
    <div data-attr={c.per + "|" + c.attribute}
      data-shape={c.kind === "cat" ? (PIE_ATTRIBUTES.has(c.attribute) ? "pie" : "list") : c.kind}
      className="card">
        {(() => {
          // A facet already in the draft is re-queried WITHOUT its own
          // clauses (disjunctive faceting) so its other values stay
          // selectable — so its total is the draft-minus-itself total,
          // not the draft total. Say so rather than show two numbers
          // that cannot be reconciled.
          const disj = !!(c as any).disjunctive;
          const shown = !disj ? c.patients : c.kind === "cat" ? c.values.reduce((n: number, v: any) => n + v.n, 0)
            : (c.bins || []).reduce((n: number, b: any) => n + b.count, 0);
          const unit = c.per === "sample" ? " samples" : " patients";
          return (
            <div
 className="facettitle"                data-tip={[c.displayName && c.displayName !== c.attribute ? c.attribute : "", c.description]
                .filter(Boolean).join(" — ") || undefined}>
              {isCustomAttr(c.attribute) && <span className="customtag" data-tip={c.description}>custom</span>}
              {c.displayName || c.attribute}{" "}
              <span className="meta">
                {(c.per === "sample" ? "· sample-level · " : "· ") + shown.toLocaleString() + unit}
                {disj ? " · not narrowed by its own filter" : ""}
              </span>
              {(() => {
                const label = c.displayName || c.attribute;
                const chart: ChartKey = { kind: "clinical", attribute: c.attribute };
                const n = selectionArmCount(chart);
                const checked = c.kind === "cat" ? c.values.filter((v: any) => picks.has(String(v.v)))
                  .sort((x: any, y: any) => picks.picked.indexOf(String(x.v)) - picks.picked.indexOf(String(y.v))) : [];
                const valueArm = (v: any) => ({ name: armLabel(String(v.v)), where: { kind: "clinical", attribute: c.attribute, values: [v.v] } as Leaf, n: v.n });
                const selected = n > 1 ? forBoth((t) => ({ label: GROUPS[t].verb + " selected (" + (n > 8 ? "8+" : n) + ")",
                  title: GROUPS[t].opens + " each selected " + (c.kind === "num" ? "range" : "value") + " of " + label + " as a group, over the rest of your selection",
                  onClick: () => compareSelection(chart, t) })) : [];
                if (c.kind === "cat") return <ChartMenu label={label} actions={[...(addMode ? [] : [
                  ...forBoth((t) => compareAction(c.values.map(valueArm), PIE_ATTRIBUTES.has(c.attribute) ? null : checked.map(valueArm), "value of " + label, (arms) => compareItems(chart, arms, t), t)),
                  ...selected]),
                  summaryDownload(label, c.per, c.values.map((v: any) => ({ value: String(v.v), count: v.n })), c.na || 0, c.distinct, ctx.setExMsg,
                    (vs) => naturalOrder(vs, (v) => v.value),
                    caseFileAction("Full Data", { kind: "full", attribute: c.attribute, per: c.per }, caseFileName({ kind: "full", attribute: c.attribute, per: c.per }, label, []), () => selectionOf(ctx), ctx.setExMsg))]} />;
                const bins = (c.bins || []).filter((b: any) => b.count > 0).map((b: any) => ({ name: armLabel(c.attribute + " " + binLabel(b)), where: binClause(c.attribute, b) as Leaf }));
                const fixed = oneValueBars(c.bins);
                return <ChartMenu label={label} actions={[
                  ...(logScaleOffered(c.bins, binSet) ? [{ label: "Log Scale", checked: !binSet?.disableLog,
                    title: binSet?.disableLog ? "draw the bars on a log scale again" : "draw the bars on a linear scale",
                    onClick: () => setChartBins(c.attribute, { ...binSet, disableLog: !binSet?.disableLog }) }] : []),
                  ...(addMode ? [] : [
                    ...forBoth((t) => compareNumeric(label, exStudies.length === 1, splittingBy === label, (q) => compareQuantiles({ attribute: c.attribute }, q, label, t), bins, () => compareItems(chart, bins, t), t)),
                    ...selected]),
                  { label: "Custom Bins…", disabled: fixed, onClick: () => setBinsOpen(true),
                    title: fixed ? "every value of " + label + " already has a bar of its own (10 or fewer values), so bins don't apply"
                      : binSet?.bins ? "change the bars (now " + binMethodName(binSet.bins) + "), or go back to the default" : "quartiles, a median split, bins of a size you pick, or your own edges" },
                  ...(c.naCount ? [{ label: "Show NA", checked: !!binSet?.showNa,
                    title: binSet?.showNa ? "show the cases with no " + label + " as a count beside the bars" : "draw the cases with no " + label + " as a bar of their own",
                    onClick: () => setChartBins(c.attribute, { ...binSet, showNa: !binSet?.showNa }, false) }] : []),
                  { label: "Download", title: "save this chart as a file", sub: [
                    caseFileAction("Data", { kind: "full", attribute: c.attribute, per: c.per }, chartFileName(label, "data"), () => selectionOf(ctx), ctx.setExMsg),
                    ...figureActions(label, () => c.bins && c.bins.length > 1 ? barFigure([
                    ...c.bins.map((b: any) => ({ count: b.count, tick: String(b.value != null ? b.value : b.special === "<=" ? "≤" + fmtNum(b.end) : b.special === ">" ? ">" + fmtNum(b.start) : fmtNum(b.start)) })),
                    ...(showNa ? [{ count: c.naCount!, tick: "NA", na: true }] : [])], c.naCount && !showNa ? "NA " + fmtInt(c.naCount) : null) : null, ctx.setExMsg)] },
                ]} />;
              })()}
            </div>
          );
        })()}
        {c.kind === "cat" && (() => {
          const d = parseDraft();
          const isSel = (v: any) => v.isNa ? naSelected(d, c.attribute) : !!(d && d.all.some((cl: any) => cl.kind === "clinical" && cl.attribute === c.attribute &&
            ((cl.values || []).includes(v.v) || cl.value === v.v)));
          const pick = (v: any) => v.isNa ? toggleNaValue(c.attribute) : togglePieValue(c.attribute, String(v.v));
          const clause = (v: any) => ({ kind: "clinical", attribute: c.attribute, op: "=", value: v.v });
          // slice geometry: cumulative angles over the returned values.
          // The shape comes from PIE_ATTRIBUTES, a fixed allowlist — see
          // its own comment for why cardinality (the study's, or worse,
          // the draft's) can't be trusted to decide this.
          const asList = !PIE_ATTRIBUTES.has(c.attribute);
          // stage, grade and the like read in their own order (lib/ordinal.ts); the rest by count; NA last,
          // its own slice or row, and every share is of all the chart's cases, NA among them (STS-PIE-9, STS-STM-3)
          const values: any[] = [...naturalOrder(c.values, (v: any) => String(v.v)), ...(c.na ? [{ v: "NA", n: c.na, isNa: true }] : [])];
          const total = values.reduce((n: number, v: any) => n + v.n, 0) || 1;
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
            return { v, path, color: v.isNa ? PORTAL_NA : CAT_COLORS[i % CAT_COLORS.length], frac };
          });
          if (asList) {
            const byKey = new Map(values.map((v: any) => [String(v.v), v]));
            return (<>
              <ValueList picks={picks} pct={portalFreq} hint={"keep the cases whose " + (c.displayName || c.attribute) + " is any of the checked values"}
                rows={values.map((v: any) => ({ key: v.isNa ? NA_KEY : String(v.v), name: String(v.v), n: v.n, total, on: isSel(v), muted: v.isNa,
                  title: v.isNa ? "no " + (c.displayName || c.attribute) + " recorded — " + v.n.toLocaleString() : v.v + " — " + v.n.toLocaleString() }))}
                why={(keys) => keys.includes(NA_KEY) && keys.length > 1 ? "NA can't be combined with other values" : null}
                onApply={(keys) => {
                  if (keys.includes(NA_KEY)) { toggleNaValue(c.attribute); return; }
                  const vs = keys.map((k) => byKey.get(k).v);
                  addClause(vs.length === 1 ? clause(byKey.get(keys[0])) : { kind: "clinical", attribute: c.attribute, values: vs });
                }} />
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
                    onClick={() => pick(a.v)}
                    data-tip={a.v.v + " — " + a.v.n.toLocaleString() + " (" + portalFreq(100 * a.frac) + ")"} />
                ))}
              </svg>
              <div className="pielegend">
                {arcs.map((a: any, i: number) => (
                  <button key={i} className={isSel(a.v) ? "pikey on" : "pikey"} onClick={() => pick(a.v)}
                    aria-pressed={isSel(a.v)} data-tip={isSel(a.v) ? "click to take " + a.v.v + " out of the filter" : "click to filter to " + a.v.v}>
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
          const maxN = Math.max(...c.bins.map((b: any) => b.count), showNa ? c.naCount! : 0, 1);
          // a bar is a word ("Negative"), one value (start = end), an outlier bar or an interval (start, end]
          const label = binLabel;
          const tick = (b: any) => b.value != null ? b.value : b.special === "<=" ? "≤" + fmtNum(b.end) : b.special === ">" ? ">" + fmtNum(b.start) : fmtNum(b.start);
          const sel = chartSelection(parseDraft(), c.attribute);
          const unit = c.per === "sample" ? "samples" : "patients";
          return (
            <Histogram ticks={[...c.bins.map(tick), ...(showNa ? ["NA"] : [])]} na={c.naCount && !showNa ? "NA " + fmtInt(c.naCount) : null}>
              {c.bins.map((b: any, i: number) => {
                const on = binSelected(sel, b);
                const tip = label(b) + " · " + fmtInt(b.count) + " " + unit + " — click to " + (on ? "take it out of the filter" : sel.length ? "add it to the filter" : "filter");
                return (
                  <button key={i} className={cn("hbar", sel.length > 0 && (on ? "on" : "off"))} data-tip={tip} aria-label={tip} aria-pressed={on}
                    onClick={() => toggleBar(c.attribute, c.bins!, i)}>
                    <span className="hfill" style={{ height: Math.max(2, Math.round(100 * b.count / maxN)) + "%" }} />
                  </button>
                );
              })}
              {showNa && (() => {
                const on = naSelected(parseDraft(), c.attribute);
                const tip = "NA · " + fmtInt(c.naCount!) + " " + unit + " with no " + (c.displayName || c.attribute) + " — click to " + (on ? "take it out of the filter" : "filter to them");
                return <button className={cn("hbar nabar", (sel.length > 0 || on) && (on ? "on" : "off"))} data-tip={tip} aria-label={tip} aria-pressed={on}
                  onClick={() => toggleNaValue(c.attribute)}>
                  <span className="hfill" style={{ height: Math.max(2, Math.round(100 * c.naCount! / maxN)) + "%" }} />
                </button>;
              })()}
            </Histogram>
          );
        })()}
        {c.kind === "num" && <div className="flex items-center gap-1 mt-1 flex-wrap">
          <span className="meta">min {fmtNum(c.min)} · median {fmtNum(c.median)} · max {fmtNum(c.max)}</span>
          <Button variant="outline" size="xs" className={CHIP} onClick={() => addClause({ kind: "clinical", attribute: c.attribute, range: { gte: Math.round(c.median * 10) / 10 } })}>≥ median</Button>
          <Button variant="outline" size="xs" className={CHIP} onClick={() => addClause({ kind: "clinical", attribute: c.attribute, range: { lt: Math.round(c.median * 10) / 10 } })}>&lt; median</Button>
        </div>}
        {binsOpen && c.kind === "num" && <CustomBinsDialog label={c.displayName || c.attribute} bars={c.bins} current={binSet}
          onApply={(b) => setChartBins(c.attribute, { ...binSet, bins: b })} onClose={() => setBinsOpen(false)} />}
    </div>
  );
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
          <Button variant="ghost" size="icon-xs" className={CHIP_X} data-tip={"stop charting " + c.entity} aria-label={"stop charting " + c.entity}
            onClick={() => unchartAssay(c.profileType, c.entity)}><X /></Button>
        </span>
      ))}
    </div>
  );
}

/** each charted generic-assay entity: a histogram or its values, a click a genericAssay clause */
export function AssayFacets({ ctx }: { ctx: ExploreCtx }) {
  return <>
    {(ctx.explore!.assayFacets || []).map((f) => <AssayFacet key={f.profileType + "|" + f.entity} f={f} ctx={ctx} />)}
  </>;
}

function AssayFacet({ f, ctx }: { f: NonNullable<NonNullable<ExploreCtx["explore"]>["assayFacets"]>[number]; ctx: ExploreCtx }) {
  const { addClause, exStudies, unchartAssay, addMode, splittingBy, compareQuantiles, compareItems } = ctx;
  const explore = ctx.explore!;
  const picks = usePicks();
  const profileName = (explore.profileCatalog || []).find((p) => p.profile === f.profileType)?.name || f.profileType;
  const title = (f.name || entityShortName(f.entity, f.profileType)) + ": " + profileName;
  // a study without the profile cannot compile the clause, so a partial chart only shows
  const clickable = f.studies.length >= exStudies.length;
  const why = clickable ? "" : " — held by " + f.studies.length + " of " + exStudies.length + " selected studies, so it cannot filter them all";
  const base = { kind: "genericAssay", profileType: f.profileType, entity: f.entity };
  const checked = f.kind === "cat" ? picks.picked.filter((k) => (f.values || []).some((v) => v.v === k)) : [];
  const chart: ChartKey = { kind: "assay", profileType: f.profileType, entity: f.entity };
  const short = f.name || entityShortName(f.entity, f.profileType);
  const valueArm = (v: string) => ({ name: armLabel(v), where: { ...base, values: [v] } as Leaf });
  const binRange = (b: NonNullable<typeof f.bins>[number]) => b.special === "<=" ? { lte: b.end } : b.special === ">" ? { gt: b.start } : { gt: b.start, lte: b.end };
  const binText = (b: NonNullable<typeof f.bins>[number]) => b.special === "<=" ? "≤" + fmtNum(b.end!) : b.special === ">" ? ">" + fmtNum(b.start!) : fmtNum(b.start!) + "–" + fmtNum(b.end!);
  const binArms = (f.bins || []).filter((b) => b.count > 0).map((b) => ({ name: armLabel(short + " " + binText(b)), where: { ...base, range: binRange(b) } as Leaf }));
  return (
    <div data-assayfacet={f.profileType + "|" + f.entity} className="card">
      <div className="facettitle flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate" data-tip={f.entity}>{title}</span>
        <ChartMenu label={title} actions={[...(addMode || exStudies.length > 1 ? [] : f.kind === "cat"
          ? forBoth((t) => compareAction((f.values || []).map((v) => ({ ...valueArm(v.v), n: v.n })), checked.map(valueArm), "value of " + title, (arms) => compareItems(chart, arms, t), t))
          : forBoth((t) => compareNumeric(title, true, splittingBy === title, (q) => compareQuantiles({ assay: { profileType: f.profileType, entity: f.entity } }, q, title, t),
            binArms, () => compareItems(chart, binArms, t), t))),
          ...(f.kind === "num" && f.bins && f.bins.length > 1 ? [{ label: "Download", title: "save this chart as a file", sub: figureActions(title, () => barFigure(
            f.bins!.map((b) => ({ count: b.count, tick: b.special === "<=" ? "≤" + fmtNum(b.end!) : b.special === ">" ? ">" + fmtNum(b.start!) : fmtNum(b.start!) })),
            f.total > f.measured ? "NA " + fmtInt(f.total - f.measured) : null), ctx.setExMsg) }] : []),
          ...(f.kind === "cat" && f.values && f.unit ? [summaryDownload(title, f.unit, f.values.map((v) => ({ value: v.v, count: v.n })), f.total - f.measured, f.distinct, ctx.setExMsg)] : [])]} />
        <Button variant="ghost" size="icon-xs" data-tip="stop charting this" aria-label={"stop charting " + f.entity}
          onClick={() => unchartAssay(f.profileType, f.entity)}><X /></Button>
      </div>
      <span className="meta">{f.unit === "patient" ? "patients" : "samples"} · {fmtInt(f.measured)} of {fmtInt(f.total)} with a value{f.disjunctive ? " · counted without its own filter" : ""}{why}</span>
      {f.error && <p className="note flush mt-1">{f.error}</p>}
      {f.kind === "cat" && f.values && (
        <ValueList picks={picks} hint={"keep the patients whose " + title + " is any of the checked values"}
          rows={f.values.map((v) => ({ key: v.v, name: v.v, n: v.n, total: f.measured, disabled: !clickable,
            title: v.v + " — " + fmtInt(v.n) + " patients" + why }))}
          onApply={(vs) => addClause({ ...base, values: vs })} />
      )}
      {f.kind === "num" && f.bins && f.bins.length > 1 && (() => {
        const maxN = Math.max(...f.bins.map((b) => b.count), 1);
        const range = binRange;
        const label = binText;
        const tick = (b: NonNullable<typeof f.bins>[number]) => b.special === "<=" ? "≤" + fmtNum(b.end!) : b.special === ">" ? ">" + fmtNum(b.start!) : fmtNum(b.start!);
        return (
          <Histogram ticks={f.bins.map(tick)} na={f.total > f.measured ? "NA " + fmtInt(f.total - f.measured) : null}>
            {f.bins.map((b, i) => (
              <button key={i} className="hbar" disabled={!clickable}
                data-tip={label(b) + " · " + fmtInt(b.count) + " patients" + (clickable ? " — click to filter" : why)} aria-label={label(b) + " · " + fmtInt(b.count) + " patients"}
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
}

export function GeneFacets({ ctx }: { ctx: ExploreCtx }) {
  const { addClauses, geneStatesClauses } = ctx;
  const explore = ctx.explore!;
  return <>
    {(explore.geneFacets || []).map(f => {
      const apply = (states: string[]) => geneStatesClauses(f.gene, f.type, states);
      return (
        <div key={f.gene + f.type} data-genefacet={f.gene + "|" + f.type} className="card">
          <div className="facettitle">
            {f.gene}: {f.type === "CNA" ? "copy-number alterations" : "somatic mutations"}
            <span className="meta"> · sample-level · {f.total.toLocaleString()} samples</span>
            <ChartMenu label={f.gene} actions={[summaryDownload(f.gene + ": " + (f.type === "CNA" ? "copy-number alterations" : "somatic mutations"), "sample",
              f.states.map((st) => ({ value: st.label, count: st.n })), 0, undefined, ctx.setExMsg)]} />
          </div>
          <ValueList hint={"keep the samples in any of the checked states of " + f.gene}
            rows={f.states.map((st) => ({ key: st.state, name: st.label, n: st.n, total: f.total, muted: st.state === "notProfiled",
              title: st.label + " — " + st.n.toLocaleString() + " samples" }))}
            why={(states) => { const r = apply(states); return "why" in r ? r.why : null; }}
            onApply={(states) => { const r = apply(states); if ("clauses" in r) addClauses(r.clauses); }} />
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
  const picks = usePicks();
  const rows = explore.studyBreakdown || [];
  if (!rows.length) return null;
  const total = rows.reduce((n, r) => n + r.n, 0) || 1;
  const many = exStudies.length > 1;
  return (
    <div className="card wide">
      <h2>Studies <span className="plain">— how {explore.draftCount != null ? "the draft" : "the selection"} breaks down{many ? " across the " + exStudies.length + " selected studies" : ""}</span></h2>
      <VirtualRows items={rows} rowKey={(r) => r.study} estimate={26} className="sbrows">
        {(r) => (
          <PickRow className="sbrow" picks={picks} k={r.study} label={r.study} disabled={!many}
            title={(r.instance !== "a" ? r.instanceLabel + " · " : "") + (many ? r.study : "the only study selected")}>
            <span className="mono">{r.study}</span>
            <span className="meta inst">{r.instance !== "a" ? "⧉ " + r.instanceLabel : ""}</span>
            <span className="bar"><i style={{ width: Math.max(1, Math.round(100 * r.n / total)) + "%" }} /></span>
            <span className="meta pct">{fmtPct(100 * r.n / total)}</span>
            <span className="n">{r.n.toLocaleString()}</span>
          </PickRow>
        )}
      </VirtualRows>
      <PickBar picks={picks} action="Explore only these" hint="narrow Explore to the checked studies"
        onApply={(ids) => setExploreStudies(ids)} />
      {many && <p className="note mt-1.5">
        Patients are counted per study; a person enrolled in two studies counts in both (overlap is not deduplicated).
      </p>}
    </div>
  );
}

/** the data types a `profiled` clause can require, by the profile's alteration type */
const PROFILED_TYPE: Record<string, "MUTATION" | "CNA" | "SV"> = {
  MUTATION_EXTENDED: "MUTATION", COPY_NUMBER_ALTERATION: "CNA", STRUCTURAL_VARIANT: "SV"
};

export function DataTypes({ ctx }: { ctx: ExploreCtx }) {
  const { addClause, parseDraft } = ctx;
  const explore = ctx.explore!;
  const picks = usePicks();
  const rows = explore.dataTypes || [];
  if (!rows.length) return null;
  const d = parseDraft();
  const selected = (t: string) => !!(d && d.all.some((cl: any) => cl.kind === "profiled" && cl.type === t));
  const max = Math.max(...rows.map((x) => x.n), 1);
  const typeOf = new Map(rows.map((dt) => [dt.profile, PROFILED_TYPE[dt.alterationType]]));
  return (
    <div className="card wide">
      <h2>Data types <span className="plain">— samples with each kind of molecular data</span></h2>
      <VirtualRows items={rows} rowKey={(dt) => dt.profile} estimate={26} className="generows">
        {(dt) => {
          const t = PROFILED_TYPE[dt.alterationType];
          return (
            <PickRow className="generow dtrow" picks={picks} k={dt.profile} label={dt.profile} on={!!t && selected(t)} disabled={!t}
              title={t ? "require " + t + " data (profiled clause)" : "no membership filter for this data type in the DSL — shown for completeness"}>
              <span className="gname">{dt.profile}</span>
              <span className="meta dtlabel">{dt.label}</span>
              <span className="gbar"><i style={{ width: Math.max(2, Math.round(100 * dt.n / max)) + "%" }} /></span>
              <span className="gcount">{dt.n.toLocaleString()}</span>
            </PickRow>
          );
        }}
      </VirtualRows>
      <PickBar picks={picks} hint="keep the samples with any of the checked kinds of data"
        onApply={(profiles) => {
          const leaves = [...new Set(profiles.map((p) => typeOf.get(p)).filter(Boolean))].map((type) => ({ kind: "profiled", type }));
          if (leaves.length) addClause(leaves.length === 1 ? leaves[0] : { any: leaves });
        }} />
    </div>
  );
}

export function AlteredGenes({ ctx }: { ctx: ExploreCtx }) {
  return <>{(["mutated", "cna", "sv"] as const).map((kind) => <GeneTable key={kind} kind={kind} ctx={ctx} />)}</>;
}

/** a gene table row's height in px: one line of --t-md plus the row's padding */
const GENEROW_H = 26;

/** where the browser keeps the gene tables' Union / Intersection choice, shared by the three as on the portal */
const GENE_OP_KEY = "cbiolab.explore.geneTableOp";
type GeneOp = "union" | "intersection";

function GeneTable({ kind, ctx }: { kind: "mutated" | "cna" | "sv"; ctx: ExploreCtx }) {
  const { addClauses, addMode, geneFilter, setGeneFilter, compareItems, callOql, parseDraft, queuedGenes, toggleQueuedGene } = ctx;
  const [op, setOp] = useState<GeneOp>("union");
  useEffect(() => {
    try { if (localStorage.getItem(GENE_OP_KEY) === "intersection") setOp("intersection"); } catch { /* the default stands */ }
  }, []);
  const chooseOp = (v: GeneOp) => {
    setOp(v);
    try { localStorage.setItem(GENE_OP_KEY, v); } catch { /* kept for this page only */ }
  };
  const explore = ctx.explore!;
  const picks = usePicks();
  // counting OncoKB drivers only, every number here and every clause a click writes is a driver call
  const drivers = !!explore.drivers;
  const [sort, setSort] = useState<GeneSort>(() => defaultGeneSort(kind));
  const profiledByKind = Object.fromEntries((explore.dataTypes || []).map((d) => [d.profile, d.n]));
  const meta = {
    mutated: { rows: explore.mutatedGenes, oql: (g: any) => g.gene + ": " + callOql("MUT") },
    cna:     { rows: explore.cnaGenes,     oql: (g: any) => g.gene + ": " + callOql(g.cna === 2 ? "AMP" : "HOMDEL") },
    sv:      { rows: explore.svGenes,      oql: (g: any) => g.gene + ": " + callOql("FUSION") }
  }[kind];
  const name = geneTableName(kind);
  const title = geneTableTitle(kind, profiledSamples(kind, profiledByKind));
  const tips = geneHeaderTips(kind);
  const all = meta.rows || [];
  const needle = (geneFilter[kind] || "").trim().toUpperCase();
  const draftClauses = (parseDraft()?.all || []) as unknown[];
  const sorted = useMemo(() => {
    const loaded = meta.rows || [];
    return sortGeneRows(needle ? loaded.filter((g: any) => g.gene.toUpperCase().includes(needle)) : loaded, sort);
  }, [meta.rows, needle, sort]);
  // the genes the selection already filters on in this table come first, as the portal pins them
  const applied = appliedLines(draftClauses, sorted.map((g: any) => meta.oql(g)));
  const appliedSet = new Set(applied);
  const rows = applied.length ? [...applied.map((l) => sorted.find((g: any) => meta.oql(g) === l)!),
    ...sorted.filter((g: any) => !appliedSet.has(meta.oql(g)))] : sorted;
  const head = (column: GeneSortColumn, label: string, numeric = false) => (
    <button type="button" className={cn("gsort", numeric && "gnum", sort.column === column && "on")} data-tip={column === "altered" ? alteredHeaderTip(kind, drivers) : tips[column]}
      aria-sort={sort.column === column ? (sort.desc ? "descending" : "ascending") : undefined}
      onClick={() => setSort(nextGeneSort(sort, column))}>
      {label}{sort.column === column ? (sort.desc ? " ↓" : " ↑") : ""}
    </button>
  );
  if (!all.length) return null;
  const rowKey = (g: any) => g.gene + (g.cna ?? "");
  const byKey = new Map(all.map((g: any) => [rowKey(g), g]));
  return (
    <div className="card" data-genetable={kind}>
      <div className="row baseline g5">
        <h2 className="flush">{title}</h2>
        {drivers && <span className="meta" data-tip={"counting only the calls OncoKB " + explore.drivers + " makes drivers (oncogenic, likely oncogenic or resistance); a sample with only other calls counts as unaltered"}>OncoKB drivers</span>}
        <span className="spacer" />
        <Input type="search" className="h-7 w-24 text-md md:text-md" placeholder="find gene" value={geneFilter[kind] || ""}
          data-tip={"show the genes whose symbol contains this, of all " + all.length.toLocaleString()}
          onChange={e => setGeneFilter({ ...geneFilter, [kind]: e.target.value })} />
        {(() => {
          const chart: ChartKey = { kind: "genes", specs: (kind === "mutated" ? ["MUT"] : kind === "cna" ? ["AMP", "HOMDEL"] : ["FUSION"]).map((c) => ": " + callOql(c)) };
          const checked = picks.picked.map((k) => byKey.get(k)).filter(Boolean);
          const file = chartFileName(name, "data");
          return <ChartMenu label={name} actions={[...(addMode ? [] : checked.length < 2
            ? [{ label: "Check genes to compare or analyze", disabled: true, title: "check at least 2 genes: each becomes a group of the cases altered in it (a case altered in both is in both)" }]
            : forBoth((t) => compareAction([], checked.map((g: any) => ({ name: armLabel(meta.oql(g)), where: { kind: "oql", q: meta.oql(g) } as Leaf })), "gene", (arms) => compareItems(chart, arms, t), t))),
            { label: "Download", title: "save this table as a file", sub: [{ label: "Data", title: "every gene in the table, as " + file,
              onClick: () => saveText(file, geneTableTsv(kind, all)) }] }]} />;
        })()}
      </div>
      {/* the portal's columns: the gene, its event count (mutations, SVs) or cytoband and call
          (CNA), "#" altered samples and the panel-aware frequency */}
      <VirtualRows items={rows} rowKey={rowKey} estimate={GENEROW_H} className="generows"
        header={
          <div className={"generow ghead gk-" + kind}>
            <span />
            {head("gene", "Gene")}
            {kind === "cna" ? <>{head("cytoband", "Cytoband")}{head("cna", "CNA")}</> : head("events", kind === "sv" ? "# SV" : "# Mut", true)}
            <span className="gnum gfiltered">
              <Filter className={cn("gfilter", drivers && "on")} aria-hidden="true" />
              {head("altered", "#", true)}
            </span>
            {head("freq", "Freq", true)}
          </div>
        }>
        {(g: any) => {
          // "#" counts every altered sample, as the portal's does; the frequency counts only calls a
          // covering panel made, over the samples profiled for the gene (off-panel calls are in neither)
          const onPanel = g.alteredOnPanel ?? g.altered, off = g.altered - onPanel;
          return (
            <PickRow className={"generow gk-" + kind} picks={picks} k={rowKey(g)} label={meta.oql(g)} title={meta.oql(g)}
              applied={appliedSet.has(meta.oql(g))}>
              <span className="gname">
                {g.gene}
                {(() => {
                  const icon = qValueIcon(kind, g.qValue);
                  return icon && <span className="qicon ml-1 inline-flex size-3.5 items-center justify-center rounded-sm border border-border text-[10px] font-semibold leading-none text-muted-foreground"
                    data-tip={icon.tip.join("\n\n")} aria-label={(icon.text === "M" ? "MutSig" : "GISTIC") + " " + icon.tip[icon.tip.length - 1]}>{icon.text}</span>;
                })()}
                <button type="button" className={cn("gqueue", queuedGenes.includes(g.gene) && "on")} aria-label={"Select gene " + g.gene}
                  aria-pressed={queuedGenes.includes(g.gene)}
                  data-tip={queuedGenes.includes(g.gene) ? "remove " + g.gene + " from the query queue" : "queue " + g.gene + " for a query (Query genes…)"}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleQueuedGene(g.gene); }}>
                  <Search aria-hidden="true" />
                </button>
              </span>
              {kind === "cna" ? <>
                <span className="gcyto" data-tip={g.cytoband || undefined}>{g.cytoband || ""}</span>
                <span className={"cnatag " + (g.cna === 2 ? "amp" : "del")}>{g.cna === 2 ? "AMP" : "HOMDEL"}</span>
              </> : (
                <span className="gnum" data-tip={g.events.toLocaleString() + " events across " + g.altered.toLocaleString() + " samples"}>{g.events.toLocaleString()}</span>
              )}
              <span className="gnum" data-tip={g.altered.toLocaleString() + " samples " + (drivers ? "with an OncoKB driver call in " : "altered in ") + g.gene + (off > 0 ? ", " + off.toLocaleString() +
                " of them by a call their panel does not cover (off-panel): counted here, as cBioPortal's \"#\" does, but not in the frequency" : "")}>
                {g.altered.toLocaleString()}
              </span>
              <span className="gnum" data-tip={freqTipLines(kind, g).join("\n")}>
                {g.freqPct != null ? fmtPct(g.freqPct) : "—"}
              </span>
            </PickRow>
          );
        }}
      </VirtualRows>
      <span className="meta pad-tight vlistfoot">{needle
        ? rows.length.toLocaleString() + " of " + all.length.toLocaleString() + " genes match"
        : all.length.toLocaleString() + " genes"}</span>
      {(() => {
        const n = picks.picked.length;
        const refusal = op === "intersection" && n > 1 ? intersectionRefusal(draftClauses.length, n) : null;
        const how = op === "union" || n < 2 ? "any of" : "every one of";
        return (
          <PickBar picks={picks} why={refusal} hint={"keep the samples " + (drivers ? "with an OncoKB driver call in" : "altered in") + " " + how + " the checked genes"}
            onApply={(keys) => addClauses(geneSelection(keys.map((k) => meta.oql(byKey.get(k))), n > 1 ? op : "union"))}>
            {n > 1 && <Choice value={op} onChange={(v) => chooseOp(v as GeneOp)} className="geneop"
              title="Union keeps the samples altered in any of the checked genes; Intersection, those altered in every one"
              options={[["union", "Union"], ["intersection", "Intersection"]]} />}
          </PickBar>
        );
      })()}
      {needle && !rows.length && (
        <p className="note flush mt-1.5">
          No match among the {all.length.toLocaleString()} genes in this table.
        </p>
      )}
    </div>
  );
}

export function EventsAndCaseLists({ ctx }: { ctx: ExploreCtx }) {
  const { addClause, parseDraft } = ctx;
  const explore = ctx.explore!;
  const leaves = ((parseDraft()?.all) || []).flatMap((c: any) => Array.isArray(c?.any) ? c.any : [c]);
  const eventOn = (type: string) => leaves.some((c: any) => c && c.kind === "event" && c.rel?.type === "NONE" && c.a?.eventType === type);
  const listOn = (id: string) => leaves.some((c: any) => c && c.kind === "caseList" && c.id === id);
  const anyOf = (ls: any[]) => { if (ls.length) addClause(ls.length === 1 ? ls[0] : { any: ls }); };
  return <>
    <div className="card">
      <h2>Timeline events</h2>
      {explore.events.length === 0 && <p className="note">This study has no clinical timeline events.</p>}
      {explore.events.length > 0 && (
        <ValueList hint="keep the patients with any of the checked events"
          rows={explore.events.map((e) => ({ key: e.type, name: "has " + e.type, n: e.n, on: eventOn(e.type),
            title: "has " + e.type + " — " + e.n.toLocaleString() + " patients" }))}
          onApply={(types) => anyOf(types.map((t) => ({ kind: "event", a: { eventType: t }, rel: { type: "NONE" } })))} />
      )}
    </div>
    <div className="card">
      <h2>Case lists</h2>
      <ValueList hint="keep the samples on any of the checked case lists" pct={portalFreq}
        rows={explore.caseLists.map((l) => ({ key: l.id, name: l.name, n: l.n, total: explore.totals?.samples, on: listOn(l.id),
          title: l.id + " — " + l.n.toLocaleString() + " of " + (explore.totals?.samples ?? 0).toLocaleString() + " selected samples" }))}
        onApply={(ids) => anyOf(ids.map((id) => ({ kind: "caseList", id })))} />
      <p className="note">Profiles here: {(explore.profiles || []).join(", ") || "none"}{explore.gaProfiles && explore.gaProfiles.length ? " · assays: " + explore.gaProfiles.join(", ") : ""} · facet counts {explore.draftCount != null ? "narrowed to your draft" : "study-wide"} · {explore.stats.ms}ms</p>
    </div>
  </>;
}
