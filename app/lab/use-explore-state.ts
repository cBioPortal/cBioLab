"use client";
// Explore's state: the studies being explored, the draft cohort being built from facet clicks, the
// facets' own view settings (filters, coverage, charted genes, the derived-timeline builder) and
// add-cohort mode — and every action on them. The analysis page calls this once and hands the
// result to Explore's sections (explore-sections.tsx); the facets themselves come from
// use-explore.ts.
import { useSaved } from "../_saved/saved-context.tsx";
import { useRef, useState } from "react";
import { normalizeDef } from "./pills";
import type { AnalysisDoc, Clause, CohortDef, DerivedRequest, PartitionDef } from "../../lib/types.ts";
import { foldEventNames, treatmentEventOf } from "../../lib/event-names.ts";
import { type SplitSpec } from "./partitions.tsx";
import { armsFromSelection, editSplits, splitKey, type ChartKey } from "../../lib/partition-arms.ts";
import { DOC_VERSION } from "../../lib/doc-version.ts";
import { saveToServer, customDataKey, featureFromCohort, type StoredDataset } from "./custom-data-client.ts";
import type { AddCohortTarget } from "./add-cohort-dialog.tsx";
import type { CustomDataTab } from "./custom-data-panel.tsx";
import { LINE_TYPE } from "../../lib/treatment-lines.ts";
import { useExplore, type ExploreAsk } from "./use-explore.ts";

/** how many clinical charts Explore draws until the reader picks — cBioPortal's own default
 *  (studyview_clinical_attribute_chart_count) */
export const DEFAULT_CLINICAL_CHARTS = 20;

/** a saved cohort open in Explore to change its filters */
export type EditingCohort = { id: string; name: string; def: CohortDef };

import type { DocStore } from "./doc-store.ts";
import type { SavedCohort } from "./use-saved.ts";

/** What Explore needs from the analysis page: the document, the study, and the page's own actions. */
export interface ExplorePage {
  doc: AnalysisDoc;
  docs: DocStore;
  study: string;
  setStudy: React.Dispatch<React.SetStateAction<string>>;
  goTab: (t: "explore" | "analysis" | "examples") => void;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setToast: React.Dispatch<React.SetStateAction<string | null>>;
  /** saving needs the login; asks for it, and says whether saving may go ahead */
  canSave: () => boolean;
  evalDef: (name: string, def: CohortDef) => Promise<{ count: number; text: string }>;
  persist: (name: string, def: CohortDef, lastEval: SavedCohort["lastEval"], id?: string) => Promise<unknown>;
  featureSaved: (d: StoredDataset) => string;
  /** the studies the open analysis reads — what add-cohort mode opens Explore on */
  analysisStudies: () => string[];
  /** run an edited document */
  runEdited: (d: AnalysisDoc) => void;
  proposePartition: (req: { doc: AnalysisDoc; cohort: string; attribute?: string; gene?: string; oql?: string[]; name?: string; maxArms?: number; minCount?: number }) => Promise<{ name: string; def: PartitionDef; note?: string }>;
  /** put a new cohort in the view add mode was opened for (use-view-edits.ts) */
  addCohortToView: (target: AddCohortTarget, name: string, def?: CohortDef, studyHint?: string) => void;
}

/** Explore's "Derived" card (data-shape facets: follow-up, history, distinct altered genes) is
 *  hidden for now, at the user's request — flip back on rather than delete the render. */
export const SHOW_DERIVED_FACETS = false;
/** The derived facets Explore asks for before the reader picks any: the card's three, or none while
 *  it is hidden. The server computes only what is asked for. */
const DEFAULT_DERIVED: DerivedRequest[] = SHOW_DERIVED_FACETS
  ? [{ metric: "followupMonths" }, { metric: "historyMonths" }, { metric: "alteredGenes" }] : [];

export function useExploreState(page: ExplorePage) {
  const { addCohortToView, analysisStudies, canSave, doc, docs, evalDef, featureSaved, goTab, persist, proposePartition, setError, setStudy, study } = page;
  const [exMsg, setExMsg] = useState<string | null>(null);
  /** the facet whose "split by this" is waiting on the server's proposed arms */
  const [splittingBy, setSplittingBy] = useState<string | null>(null);
  /**
   * Explore opened over the page for one cohort, with the Explore state it replaced, restored when
   * it closes so the Explore tab is as the reader left it: adding one to the analysis ("+ Add
   * cohort", `target`), or changing a saved cohort's filters (`editing`).
   */
  const [addMode, setAddMode] = useState<null | { ids: string[]; text: string; explore: ExploreAsk | null } &
    ({ target: AddCohortTarget; editing?: undefined } | { target?: undefined; editing: EditingCohort })>(null);
  /** the Custom data dialog's open tab, or null when it is closed */
  const [customTab, setCustomTab] = useState<CustomDataTab | null>(null);
  /** Explore's save dialog is open, prefilled with this name */
  const [saving, setSaving] = useState<string | null>(null);
  const [savingFeature, setSavingFeature] = useState<string | null>(null);
  /** Explore's "+ Add chart": clinical/gene/derived-timeline filter builders live
   *  here instead of as three permanent cards above the facet grid. */
  const [addChartOpen, setAddChartOpen] = useState(false);
  const [chartTab, setChartTab] = useState<"clinical" | "gene" | "assay" | "derived" | "custom">("clinical");
  const [cName, setCName] = useState("");
  const [cDefText, setCDefText] = useState(JSON.stringify({ all: [] }, null, 2));
  const exploring = useExplore(setError);
  const { explore, busy: exploreBusy } = exploring;
  const [sQuery, setSQuery] = useState("");                             // study-panel search
  const [sCaps, setSCaps] = useState<Set<string>>(() => new Set());                  // study-panel capability filters
  const [exStudies, setExStudies] = useState<string[]>([]); // studies being explored (checkboxes); none until the reader picks
  const [exPanelOpen, setExPanelOpen] = useState(false);                // study panel expanded?
  const exSel = useRef<string[]>([]);                   // current selection (ref: immune to state races)
  const exFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);                                    // debounce for multi-toggle refetch
  const [geneRowLimit, setGeneRowLimit] = useState(12);                 // rows shown per gene table
  /**
   * Minimum share of the selected studies an attribute must appear in to be
   * shown. Across 64 studies the union of vocabularies is 1,634 facets, and the
   * ones every study shares — CANCER_TYPE, SEX, OS_STATUS — are lost in it. This
   * also narrows the NEXT request: the server is told which attributes to facet,
   * so it stops computing the ones being hidden.
   */
  /**
   * The study picker's STAGED selection. null means "not staging" — the picker
   * is closed and the applied set is authoritative.
   *
   * Ticking a box used to call setExploreStudies, which debounces a facet fetch
   * 350ms later: assembling a ten-study selection fired ten requests, nine of
   * them for a selection the reader was still in the middle of describing, and
   * at this scale each one is seconds of ClickHouse work. Staging makes the
   * cost proportional to intent — one request when they say they are done.
   */
  const [exDraftStudies, setExDraftStudies] = useState<string[] | null>(null);
  /** genes charted as their own alteration facet (the portal's per-gene charts) */
  const [geneCharts, setGeneCharts] = useState<string[]>([]);
  const geneChartsRef = useRef<string[]>([]);   // fetchExplore reads this, not the closure
  /** generic-assay entities charted one each (a signature, an arm, a probe) */
  const [assayCharts, setAssayCharts] = useState<{ profileType: string; entity: string }[]>([]);
  const assayChartsRef = useRef<{ profileType: string; entity: string }[]>([]);
  /** derived facets beyond the fixed three, switched on from "show more derivations" */
  const [exDerived, setExDerived] = useState<DerivedRequest[]>(DEFAULT_DERIVED);
  const exDerivedRef = useRef<DerivedRequest[]>(DEFAULT_DERIVED);   // fetchExplore reads this, not the closure
  const [geneChartInput, setGeneChartInput] = useState("");
  /** the header lists selected studies as chips; past a handful it is summarised */
  const [studyChipsOpen, setStudyChipsOpen] = useState(false);
  const [geneFilter, setGeneFilter] = useState<Record<string, string>>({});   // per-table gene box, client-side
  const [clinFilter, setClinFilter] = useState("");                            // narrows the attribute checklist in "+ Add chart", not the grid itself
  /** the reader's own changes to the "+ Add chart" > Clinical checklist, keyed "per|attribute"
   *  (matching data-attr), over the default charts (defaultCharts): checked beyond it, and
   *  unchecked out of it. Kept as changes so the default can follow the studies explored. */
  const [chartPicks, setChartPicks] = useState<{ added: Set<string>; removed: Set<string> }>(
    () => ({ added: new Set(), removed: new Set() }));
  const [attrCoverage, setAttrCoverage] = useState(0);                       // clinical attributes shown
  /**
   * The "sequence / line filter" popover's draft — an A/[B] pair plus a
   * temporal relation, built into one `event` clause on submit. Kept as its
   * own form state (not applied to the draft until "add filter") because,
   * unlike every other facet, it has several fields that only mean something
   * together — a lone eventType pick here is not itself a valid clause.
   */
  const [seq, setSeq] = useState<{
    aType: string; aOcc: "ANY" | "FIRST" | "LAST"; aLineOp: "=" | ">=" | "<="; aLineNo: string;
    rel: "NONE" | "BEFORE" | "DURING" | "NOT_FOLLOWED_BY";
    bType: string; bOcc: "ANY" | "FIRST" | "LAST"; bLineOp: "=" | ">=" | "<="; bLineNo: string;
    days: string; priorGuard: boolean; lineGap: number;
  }>({ aType: "", aOcc: "ANY", aLineOp: "=", aLineNo: "", rel: "NONE",
       bType: "", bOcc: "ANY", bLineOp: "=", bLineNo: "", days: "180", priorGuard: false, lineGap: 90 });

  /** Explore's top action bar: acting on the draft you have built by clicking facets. */
  /**
   * What the top bar acts on. With no clauses that is every patient in the
   * selected studies — a real cohort, and the denominator for everything else —
   * so exploring a study and hitting Analyze works without filtering first.
   */
  const barDef = (): CohortDef | null => {
    if (!exSel.current.length) return null;
    return parseDraft() || draftScaffold(exSel.current);
  };
  const barDefaultName = () =>
    parseDraft() ? "explored cohort"
      : exSel.current.length === 1 ? "all of " + exSel.current[0] : "all selected studies";
  /**
   * Analyze starts a FRESH analysis of the explored cohort: it replaces the
   * document rather than merging into it, because that is what the word means —
   * you asked to analyse this, not to add it to whatever was there before.
   * It starts with no views: the reader chooses what to see of it.
   * Build a multi-cohort comparison by ticking cohorts in the Cohorts tab and
   * hitting "Analyze selected".
   */
  const analyzeDraft = () => {
    const d = barDef();
    if (!d) { setExMsg("select at least one study first"); return; }
    setExMsg(null);
    // Named from the draft, not from cName: that field lives on the Cohorts tab
    // and is invisible here, so inheriting it made the analysis arrive under a
    // name with no on-screen explanation.
    const name = barDefaultName();
    const nextStudy = exSel.current[0] || study;
    const nd: AnalysisDoc = { dsl: DOC_VERSION, study: nextStudy, cohorts: { [name]: d }, views: [] };
    setStudy(nextStudy);
    docs.replace(nd);
    setError(null);     // never leave the previous run's numbers on screen
    goTab("analysis");
  };
  /**
   * Analyze the selection split by one facet: the same fresh analysis as Analyze, with the
   * selection divided into arms that add up to it, for the views the reader adds to compare. The arms
   * come from the server (counted per patient within the selection), not from the facet's own
   * bars, which may count samples or show only the top values.
   */
  const splitDraftBy = async (spec: SplitSpec, label: string) => {
    const d = barDef();
    if (!d) { setExMsg("select at least one study first"); return; }
    setExMsg(null); setSplittingBy(label);
    const name = barDefaultName();
    const nextStudy = exSel.current[0] || study;
    const base: AnalysisDoc = { dsl: DOC_VERSION, study: nextStudy, cohorts: { [name]: d }, views: [] };
    try {
      const { name: sn, def } = await proposePartition({ doc: base, cohort: name, ...spec });
      const nd: AnalysisDoc = editSplits(base,
        (f) => ({ ...f, partitions: { [splitKey(name, sn)]: { ...def, split: sn } } }));
      setStudy(nextStudy);
      docs.replace(nd);
      setError(null);
      goTab("analysis");
    } catch (e) { setExMsg("Could not split by " + label + ": " + String((e as Error)?.message || e)); }
    setSplittingBy(null);
  };
  /**
   * Analyze the selection with one chart's selected items as the arms: each item an arm, in the
   * order clicked, and the rest of the selection as the cohort being split. No server proposal —
   * the arms are the clauses already on screen.
   */
  const selectionArmCount = (chart: ChartKey): number => {
    const d = parseDraft();
    if (!d) return 0;
    try { return armsFromSelection(d, chart)?.arms.length ?? 0; } catch { return 9; }
  };
  const splitDraftBySelection = (chart: ChartKey, label: string) => {
    const d = parseDraft();
    if (!d) return;
    let r: ReturnType<typeof armsFromSelection>;
    try { r = armsFromSelection(d, chart); } catch (e) { setExMsg("Could not split by the selected " + label + ": " + String((e as Error)?.message || e)); return; }
    if (!r) return;
    setExMsg(null);
    const name = r.base.all.length ? "explored cohort"
      : exSel.current.length === 1 ? "all of " + exSel.current[0] : "all selected studies";
    const parent: CohortDef = r.base.all.length ? { ...d, all: r.base.all } : { ...(draftScaffold(exSel.current) as CohortDef) };
    const nextStudy = exSel.current[0] || study;
    const nd: AnalysisDoc = { dsl: DOC_VERSION, study: nextStudy, cohorts: { [name]: { ...parent, splits: { [label]: { arms: r.arms } } } },
      views: [] };
    setStudy(nextStudy);
    docs.replace(nd);
    setError(null);
    goTab("analysis");
  };
  /**
   * Saving asks for a name when you ask to save, rather than keeping a field in
   * the bar. The bar's job is Analyze; a permanent name box next to it implied
   * Analyze wanted one too.
   */
  const openSaveDialog = () => {
    if (!barDef()) { setExMsg("select at least one study first"); return; }
    if (!canSave()) return;
    setExMsg(null);
    setSaving(cName.trim() || barDefaultName());
  };
  const confirmSave = async (name: string) => {
    const def = barDef();
    if (!def) return;
    // Evaluated with the name and definition in hand rather than through the
    // shared cName/cDefText state, which React would not have flushed yet.
    try {
      const ev = await evalDef(name, def);
      setCName(name);
      await persist(name, def, ev);
      setExMsg("saved \u201c" + name + "\u201d to Cohorts \u2014 " + ev.count.toLocaleString() + " patients");
    } catch (e) {
      setExMsg("could not save: " + String((e as Error)?.message || e));
    }
    setTimeout(() => setExMsg(null), 3200);
  };

  /** the Custom data dialog, over Explore: an upload is matched against the explored studies, and its charts land there */
  const saved = useSaved();
  /** adding an upload opens on Explore, where its ids are matched; the saved ones are in the saved-work manager */
  const openCustomManager = (on: CustomDataTab = "manage") => {
    if (on === "manage") { saved.open("data"); return; }
    goTab("explore");
    setCustomTab(on);
  };
  const saveDraftAsFeature = () => {
    if (!barDef()) { setExMsg("select at least one study first"); return; }
    if (!canSave()) return;
    setExMsg(null);
    setSavingFeature(parseDraft() ? "explored cohort" : "selected studies");
  };
  const confirmSaveFeature = async (name: string) => {
    const def = barDef();
    if (!def) return;
    setExMsg("saving feature\u2026");
    try {
      const d = await featureFromCohort(name, def, exSel.current);
      await saveToServer(d);
      setExMsg(featureSaved(d) + " \u2014 charted below");
      fetchExplore();
    } catch (e) { setExMsg("could not save the feature: " + String((e as Error)?.message || e)); }
  };

  const parseDraft = () => { try { const d = JSON.parse(cDefText); return d.all && d.all.length ? d : null; } catch { return null; } };

  /** "per|attribute", matching data-attr — the one key format every attribute lookup here uses */
  const attrKey = (c: { per: string; attribute: string }) => c.per + "|" + c.attribute;

  /**
   * Which clinical facets are on screen. ONE definition, because this was two
   * copies — one computing the header's count, one filtering the render — and
   * they disagreed the moment a search box was added: the header read
   * "8 attributes" while all 20 were still drawn.
   *
   * Coverage (carried by enough of the selected studies) and the reader's own
   * checklist ("+ Add chart" > Clinical) are both "is this attribute allowed to
   * show" concerns, so both live here; clinFilter is a different thing now — it
   * narrows the CHECKLIST's own rows, not this. An attribute the draft filters on
   * always shows, so a filter in force is never hidden from the grid.
   */
  const coverageOk = (c: { studyCount?: number }) =>
    attrCoverage === 0 || (c.studyCount ?? 1) >= Math.ceil(attrCoverage * exStudies.length);
  /**
   * The charts checked until the reader changes them: cBioPortal's study-view default — the
   * first DEFAULT_CLINICAL_CHARTS attributes with a priority above 0, in priority order
   * (priority 0 is the portal's "available, hidden by default"). Read from the answer with no
   * draft applied (use-explore.ts `vocab`), so a facet click never changes which charts show.
   */
  const defaultCharts = (): Set<string> => new Set(exploring.vocab.current
    .filter((a) => a.priority > 0 && coverageOk(a)).slice(0, DEFAULT_CLINICAL_CHARTS).map((a) => a.key));
  const draftedAttrs = (): Set<string> => {
    const keys = new Set<string>();
    const walk = (cs: any[]) => { for (const c of cs || []) {
      if (c?.kind === "clinical") keys.add((c.per === "sample" ? "sample" : "patient") + "|" + c.attribute);
      if (Array.isArray(c?.any)) walk(c.any);
      if (c?.not) walk([c.not]);
    } };
    walk(parseDraft()?.all || []);
    return keys;
  };
  /** whether the checklist has this attribute checked */
  const chartChecked = (key: string, defaults = defaultCharts()) =>
    chartPicks.added.has(key) || (defaults.has(key) && !chartPicks.removed.has(key));
  /** check (or uncheck) every attribute in `keys` */
  const setChartsChecked = (keys: string[], checked: boolean) => {
    const defaults = defaultCharts();
    setChartPicks((prev) => {
      const added = new Set(prev.added), removed = new Set(prev.removed);
      for (const k of keys) {
        if (checked) { removed.delete(k); if (!defaults.has(k)) added.add(k); }
        else { added.delete(k); if (defaults.has(k)) removed.add(k); }
      }
      return { added, removed };
    });
  };
  const visibleClinical = (list: { attribute: string; per: string; studyCount?: number }[]): typeof list => {
    const defaults = defaultCharts(), drafted = draftedAttrs();
    return list.filter((c) => coverageOk(c) && (chartChecked(attrKey(c), defaults) || drafted.has(attrKey(c))));
  };

  const attrsForBar = (bar: number, studiesOverride?: string[] | string): string[] => {
    if (bar <= 0 || !exploring.fullAttrs.current.length) return [];
    const n = (studiesOverride ? (Array.isArray(studiesOverride) ? studiesOverride : [studiesOverride]) : exSel.current).length;
    return exploring.fullAttrs.current.filter(a => a.studyCount >= Math.ceil(bar * n)).map(a => a.attribute);
  };

  /** Ask Explore for the facets of the current selection (app/lab/use-explore.ts); each override
   *  stands in for what the page holds, for a caller whose state has not landed yet. */
  const fetchExplore = (draftOverride?: CohortDef | null, studiesOverride?: string[] | string, attrsOverride?: string[]) => {
    const studies = studiesOverride ? (Array.isArray(studiesOverride) ? studiesOverride : [studiesOverride]) : exSel.current;
    exploring.ask({
      studies,
      draft: draftOverride !== undefined ? draftOverride : parseDraft(),
      attributes: attrsOverride ?? attrsForBar(attrCoverage, studiesOverride),
      geneCharts: geneChartsRef.current,
      assayCharts: assayChartsRef.current,
      derived: exDerivedRef.current,
      uploads: customDataKey(),
    }, !(attrsOverride ?? []).length && !(attrCoverage > 0));
  };

  const addClause = (clause: any) => {
    let d; try { d = normalizeDef(JSON.parse(cDefText)); } catch { d = null; }
    if (!d || !Array.isArray(d.all)) d = { all: [] };
    if (clause.kind === "clinical" && clause.op === "=") {
      const same = d.all.find((c: any) => c.kind === "clinical" && c.attribute === clause.attribute && (c.per || "patient") === (clause.per || "patient") && (c.op === "=" || c.values));
      if (same) { // second value on the same attribute becomes an OR list
        const vals = new Set([...(same.values || []), ...(same.op === "=" ? [same.value] : []), clause.value]);
        delete same.op; delete same.value; same.values = [...vals];
        const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d); return;
      }
    }
    // Buckets of ONE derived metric are alternatives, not conjuncts: clicking a
    // second bucket used to AND two mutually exclusive ranges, giving 0 patients
    // — which then emptied every other facet, since a bucket with no patients is
    // dropped. Same click also toggles a chosen bucket back off.
    if (clause.kind === "derived") {
      const sameRange = (a: any, b: any) =>
        (a.range || {}).gte === (b.range || {}).gte && (a.range || {}).lt === (b.range || {}).lt;
      const isMine = (l: any) => l && l.kind === "derived" && l.metric === clause.metric && (l.eventType || "") === (clause.eventType || "");
      const idx = d.all.findIndex((c: any) => isMine(c) || (Array.isArray(c.any) && c.any.every(isMine) && c.any.length));
      if (idx >= 0) {
        const cur = d.all[idx];
        const leaves: any[] = Array.isArray(cur.any) ? [...cur.any] : [cur];
        const at = leaves.findIndex((l) => sameRange(l, clause));
        if (at >= 0) leaves.splice(at, 1); else leaves.push(clause);
        if (!leaves.length) d.all.splice(idx, 1);
        else d.all[idx] = leaves.length === 1 ? leaves[0] : { any: leaves };
        const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d.all.length ? d : null); return;
      }
    }
    if (clause.kind === "oql") {
      const same = d.all.find((c: any) => c.kind === "oql");
      if (same) { same.q += "; " + clause.q; const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d); return; }
    }
    d.all.push(clause);
    const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d);
  };

  /**
   * Append several clauses as one action. A gene-state pick is two of them —
   * "profiled for this gene" AND the alteration — and it has to be both: the
   * facet counted 14,690 EGFR-mutant patients inside the profiled set, while
   * the OQL clause alone selects 14,697, because 7 patients carry a call for a
   * gene no panel of theirs covers. A facet whose number changed when you
   * clicked it would be the worst of the options.
   *
   * Deliberately plainer than addClause: no kind-specific merging, because
   * these clauses only mean what they mean together.
   */
  const addClauses = (clauses: any[]) => {
    let d; try { d = normalizeDef(JSON.parse(cDefText)); } catch { d = null; }
    if (!d || !Array.isArray(d.all)) d = { all: [] };
    for (const c of clauses) d.all.push(c);
    setCDefText(JSON.stringify(d, null, 2));
    fetchExplore(d);
  };

  /** the clauses that select one state of one gene's alteration facet */
  const geneStateClauses = (gene: string, type: "MUTATION" | "CNA", state: string): any[] => {
    const prof = { kind: "profiled", type, gene };
    const oql = (q: string) => ({ kind: "oql", q: gene + ": " + q });
    if (state === "notProfiled") return [{ not: prof }];
    if (state === "altered") return [prof, oql("MUT")];
    if (state === "amp") return [prof, oql("AMP")];
    if (state === "del") return [prof, oql("HOMDEL")];
    // unaltered: profiled and none of the calls this facet counts
    return [prof, { not: oql(type === "CNA" ? "AMP HOMDEL" : "MUT") }];
  };

  const chartGene = (raw: string) => {
    const g = String(raw || "").toUpperCase().trim();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(g)) return;
    const next = geneCharts.includes(g) ? geneCharts : [...geneCharts, g].slice(-6);
    geneChartsRef.current = next;
    setGeneCharts(next);
    setGeneChartInput("");
    fetchExplore();
  };
  const unchartGene = (g: string) => {
    const next = geneCharts.filter((x) => x !== g);
    geneChartsRef.current = next;
    setGeneCharts(next);
    fetchExplore();
  };

  const chartAssay = (profileType: string, entity: string) => {
    if (assayCharts.some((c) => c.profileType === profileType && c.entity === entity)) return;
    const next = [...assayCharts, { profileType, entity }].slice(-6);
    assayChartsRef.current = next;
    setAssayCharts(next);
    fetchExplore();
  };
  const unchartAssay = (profileType: string, entity: string) => {
    const next = assayCharts.filter((c) => !(c.profileType === profileType && c.entity === entity));
    assayChartsRef.current = next;
    setAssayCharts(next);
    fetchExplore();
  };

  /** timeline event types this study's Explore facets actually have, folded by case */
  const exploreEventTypes = (): { canonical: string; label: string; n: number }[] => {
    const raw: { type: string; n: number }[] = (explore && explore.events) || [];
    return foldEventNames(raw.map((e) => ({ name: String(e.type), n: e.n })))
      .map((f) => ({ canonical: f.canonical, label: f.label, n: f.n }));
  };
  /** the study's own best guess at "a therapy" — the same heuristic addView's sequence default uses */
  const treatmentEventType = (): { canonical: string; label: string } | null =>
    treatmentEventOf(exploreEventTypes());

  // the derived facets built on the study's treatment-like event, each opted into from the Derived card
  const TREATMENT_DERIVED_KINDS: { metric: "lines" | "treatmentSpan"; label: (name: string) => string }[] = [
    { metric: "lines", label: (name) => "Lines of '" + name + "'" },
    { metric: "treatmentSpan", label: (name) => "Time in '" + name + "' records" }
  ];
  const derivedOn = (metric: string) => exDerived.some((x) => x.metric === metric);
  const toggleDerived = (metric: "lines" | "treatmentSpan") => {
    const tx = treatmentEventType();
    if (!tx) return;
    const next = derivedOn(metric)
      ? exDerived.filter((x) => x.metric !== metric)
      : [...exDerived, { metric, eventType: tx.label, ...(metric === "lines" ? { lineGap: 90 } : {}) }];
    exDerivedRef.current = next;
    setExDerived(next);
    fetchExplore();
  };

  /**
   * One side of the sequence-filter form -> an EventSelector, or null while
   * that side is incomplete. A treatment-line pick reads LINE_NO as an
   * attrs-equality (exact line) or a numeric predicate (>=/<=) — the same two
   * shapes lib/compiler.ts's lineSelectorCte accepts, see EXAMPLES's
   * "Reached 2nd line" for the equality form.
   */
  const seqSelector = (type: string, occ: "ANY" | "FIRST" | "LAST", lineOp: "=" | ">=" | "<=", lineNo: string): any => {
    if (type === LINE_TYPE) {
      const n = Number(lineNo);
      if (!Number.isFinite(n) || lineNo.trim() === "") return null;
      return lineOp === "="
        ? { eventType: LINE_TYPE, attrs: [{ key: "LINE_NO", value: String(n) }] }
        : { eventType: LINE_TYPE, numeric: { key: "LINE_NO", op: lineOp, value: n } };
    }
    if (!type) return null;
    return { eventType: type, ...(occ !== "ANY" ? { occurrence: occ } : {}) };
  };
  const seqReady = (() => {
    const a = seqSelector(seq.aType, seq.aOcc, seq.aLineOp, seq.aLineNo);
    if (!a) return false;
    if (seq.rel === "NONE") return true;
    if ((seq.rel === "BEFORE" || seq.rel === "NOT_FOLLOWED_BY") && !(Number(seq.days) > 0)) return false;
    return !!seqSelector(seq.bType, seq.bOcc, seq.bLineOp, seq.bLineNo);
  })();
  const addSeqFilter = () => {
    const a = seqSelector(seq.aType, seq.aOcc, seq.aLineOp, seq.aLineNo);
    if (!a) return;
    const clause: any = { kind: "event", a, rel: { type: seq.rel } };
    if (seq.rel !== "NONE") {
      const b = seqSelector(seq.bType, seq.bOcc, seq.bLineOp, seq.bLineNo);
      if (!b) return;
      clause.b = b;
      if (seq.rel === "BEFORE") clause.rel = { type: "BEFORE", maxDays: Number(seq.days) };
      else if (seq.rel === "NOT_FOLLOWED_BY") clause.rel = { type: "NOT_FOLLOWED_BY", withinDays: Number(seq.days) };
    }
    if (seq.priorGuard) clause.priorGuard = true;
    if (seq.lineGap !== 90 && (a.eventType === LINE_TYPE || (clause.b && clause.b.eventType === LINE_TYPE)))
      clause.lineGap = seq.lineGap;
    addClause(clause);
    setSeq(s => ({ ...s, aType: "", aLineNo: "", rel: "NONE", bType: "", bLineNo: "" }));
  };

  const removeDraftClause = (i: number) => {
    try {
      const d = normalizeDef(JSON.parse(cDefText));
      d.all = d.all.filter((_: any, j: any) => j !== i);
      setCDefText(JSON.stringify(d, null, 2));
      fetchExplore(d.all.length ? d : null);
    } catch {}
  };

  // studies-explicit draft scaffold for the current explore selection
  const draftScaffold = (ids: string[]): CohortDef => {
    const d: CohortDef = { all: [] };
    if (ids.length > 1) d.studies = ids; else if (ids.length === 1) d.study = ids[0];
    return d;
  };

  const clearDraft = () => { setCDefText(JSON.stringify(draftScaffold(exSel.current), null, 2)); fetchExplore(null); };

  // toggle a study in the explore selection. The draft def is STUDY-EXPLICIT —
  // it carries "study" (one selected) or "studies" (several) itself, so Save /
  // Preview / Add-to-analysis evaluate against the selection with no separate
  // "working study" concept. exSel (ref) is the always-current selection so
  // rapid checkbox toggles don't race on stale render-time state; the refetch
  // is debounced so checking many boxes fires one request.
  const setExploreStudies = (ids: string[]) => {
    exSel.current = ids;
    setExStudies(ids);
    if (ids.length) setStudy(ids[0]); // doc-level default for study-less defs (examples, hand edits)
    let d; try { d = normalizeDef(JSON.parse(cDefText)); } catch { d = null; }
    if (!d || !Array.isArray(d.all)) d = { all: [] };
    if (ids.length > 1) { d.studies = ids; delete d.study; }
    else { delete d.studies; if (ids.length === 1) d.study = ids[0]; else delete d.study; }
    setCDefText(JSON.stringify(d, null, 2));
    if (exFetchTimer.current) clearTimeout(exFetchTimer.current);
    if (!ids.length) { exploring.clear(); setExPanelOpen(true); return; } // empty selection: clear facets (and drop any in-flight fetch), keep the picker open
    exFetchTimer.current = setTimeout(() => fetchExplore(d.all!.length ? d : null, ids), 350);
  };

  /** The study list's row actions, which act on that one study rather than on the staged set. */
  const exploreStudy = (id: string) => {
    setExDraftStudies(null);
    setExPanelOpen(false);
    setExploreStudies([id]);
  };
  /** A fresh analysis of the whole of one study, as Analyze does for the explored cohort. */
  const analyzeStudy = (id: string) => {
    setExMsg(null);
    setStudy(id);
    docs.replace({ dsl: DOC_VERSION, study: id, cohorts: { ["all of " + id]: draftScaffold([id]) }, views: [] });
    setError(null);
    goTab("analysis");
  };
  /** Explore one study and open Custom data → Add data on it: an upload matches its ids against the explored studies. */
  const addDataToStudy = (id: string) => {
    exploreStudy(id);
    setCustomTab("add");
  };

  /** Explore over the page, on these studies and filters, keeping what it replaces to restore */
  const openOver = (mode: { target: AddCohortTarget } | { editing: EditingCohort }, ids: string[], all: Clause[]) => {
    setAddMode({ ids: exSel.current, text: cDefText, explore: exploring.current, ...mode });
    exSel.current = ids; setExStudies(ids);
    const d = { ...draftScaffold(ids), all };
    setCDefText(JSON.stringify(d, null, 2));
    setExMsg(null);
    fetchExplore(all.length ? d : null, ids);
  };
  const openAddCohort = (target: AddCohortTarget) => openOver({ target }, analysisStudies(), []);
  /** A saved cohort's studies and filters in Explore, to change and save back over it. */
  const openEditCohort = (editing: EditingCohort) => {
    const { def } = editing;
    openOver({ editing }, def.studies?.length ? def.studies : [def.study || study], def.all || []);
  };
  /** Save Explore's filters over the cohort being edited, keeping its name, note and splits. A
   *  cohort locked to its patients follows its definition again, since that is what changed. */
  const saveEditedCohort = async (): Promise<{ name: string; count: number } | null> => {
    const edit = addMode?.editing, d = barDef();
    if (!edit || !d) { setExMsg("select at least one study first"); return null; }
    const { lock: _lock, study: _s, studies: _ss, ...keep } = edit.def;
    const def: CohortDef = { ...keep, ...d };
    try {
      const ev = await evalDef(edit.name, def);
      await persist(edit.name, def, ev, edit.id);
      closeAddCohort();
      return { name: edit.name, count: ev.count };
    } catch (e) { setExMsg("could not save: " + String((e as Error)?.message || e)); return null; }
  };
  const closeAddCohort = () => {
    if (!addMode) return;
    exSel.current = addMode.ids; setExStudies(addMode.ids);
    setCDefText(addMode.text); exploring.restore(addMode.explore);
    setAddMode(null);
  };
  /** Add Explore's current selection to the view add mode was opened for, as a new cohort of the analysis. */
  const addDraftToAnalysis = (name: string) => {
    const def = barDef();
    if (!def) { setExMsg("select at least one study first"); return; }
    const n = name.trim();
    if (!n) { setExMsg("give the cohort a name"); return; }
    if (doc.cohorts?.[n]) { setExMsg("this analysis already has a cohort named “" + n + "”"); return; }
    const target = addMode?.target;
    const studyHint = exSel.current[0];
    closeAddCohort();
    if (target) addCohortToView(target, n, def, studyHint);
  };

  return { openEditCohort, saveEditedCohort, exMsg, setExMsg, splittingBy, setSplittingBy, addMode, setAddMode, customTab, setCustomTab, saving, setSaving, savingFeature, setSavingFeature, addChartOpen, setAddChartOpen, chartTab, setChartTab, cName, setCName, cDefText, setCDefText, exploring, explore, exploreBusy, sQuery, setSQuery, sCaps, setSCaps, exStudies, setExStudies, exPanelOpen, setExPanelOpen, exSel, exFetchTimer, geneRowLimit, setGeneRowLimit, exDraftStudies, setExDraftStudies, geneCharts, setGeneCharts, geneChartsRef, exDerived, setExDerived, exDerivedRef, geneChartInput, setGeneChartInput, studyChipsOpen, setStudyChipsOpen, geneFilter, setGeneFilter, clinFilter, setClinFilter, chartChecked, setChartsChecked, attrCoverage, setAttrCoverage, seq, setSeq, barDef, barDefaultName, analyzeDraft, splitDraftBy, selectionArmCount, splitDraftBySelection, openSaveDialog, confirmSave, openCustomManager, saveDraftAsFeature, confirmSaveFeature, parseDraft, attrKey, visibleClinical, attrsForBar, fetchExplore, addClause, addClauses, geneStateClauses, chartGene, unchartGene, assayCharts, chartAssay, unchartAssay, exploreEventTypes, treatmentEventType, TREATMENT_DERIVED_KINDS, derivedOn, toggleDerived, seqSelector, seqReady, addSeqFilter, removeDraftClause, draftScaffold, clearDraft, setExploreStudies, exploreStudy, analyzeStudy, addDataToStudy, openAddCohort, closeAddCohort, addDraftToAnalysis };
}

export type ExploreState = ReturnType<typeof useExploreState>;
