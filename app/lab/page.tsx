"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExploreCharts } from "./explore-charts";
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";
import type { AnalysisDoc, TemplateDoc, AnalysisResult, CohortDef, PartitionDef } from "../../lib/types.ts";
import type { DslExample } from "../../lib/dsl-reference.ts";
import { installLabTools, LAB_TOOL_NAMES, type LabBridge } from "./agent-tools.ts";
import { AgentToolsMenu } from "../_agent/AgentToolsMenu.tsx";
import { useCustomDataState } from "./custom-data-panel.tsx";
import CustomDataDialog, { type CustomDataFocus } from "./custom-data-dialog.tsx";
import LoginButton from "./login-button.tsx";
import { upgradeDocument, type DocUpgrade } from "../../lib/doc-version.ts";
import type { OnCustomData } from "./pills";
import { requestLogin, referencedDatasets, bindUploads, unresolvedUploads } from "./custom-data-client.ts";
import { useDocStore, DEFAULT_VIEWS, EMPTY_DOC } from "./doc-store.ts";
import { useExploreState } from "./use-explore-state.ts";
import { useStudies, useStudyCatalog, useTrackAttrs } from "./use-catalogs.ts";
import { useAnalysis, seedAnalysis, rerunAnalysis } from "./use-analysis.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useGearmenuOpen } from "./view-chrome.tsx";
import { api } from "./api.ts";
import { useSavedArtifacts } from "./use-saved.ts";
import { SavedTab } from "./saved-tab.tsx";
import { ExamplesTab } from "./examples-tab.tsx";
import { KMChart } from "./view-cards.tsx";
import { GenesDialog, CustomDataWarning, CohortColumn, DocDialog, ViewColumn, type AnalysisCtx } from "./analysis-sections.tsx";
import { StudyPicker, ExploreBar, AddChartDialog, DerivedFacets, ClinicalFacets, GeneFacets, StudyBreakdown, DataTypes, AlteredGenes, EventsAndCaseLists, type ExploreCtx } from "./explore-sections.tsx";
import { CohortEditDialog, ViewNoteDialog, WorkspaceDialog } from "./dialogs.tsx";
import { LINE_TYPE } from "../../lib/treatment-lines.ts";
import { useViewOptions } from "./use-view-options.ts";
import { useViewEdits } from "./use-view-edits.ts";
import { useCohortEdits } from "./use-cohort-edits.ts";
import { useWorkspace } from "./use-workspace.ts";

const TABS = ["explore", "cohorts", "analysis", "examples"] as const;

type SearchParams = { [key: string]: string | string[] | undefined };

/**
 * The landing tab, from the SAME search params the server rendered this route
 * with (useSearchParams, below) — not a client-only re-parse of
 * window.location. That match is what avoids a hydration mismatch: read the URL again on the client
 * (even synchronously, even before paint) and the server's HTML — rendered
 * from ?tab=analysis — no longer matches what the client says the first
 * render should be, so React discards and re-renders the whole tree, which is
 * the flash. Reading the identical resolved value on both sides sidesteps it.
 * An explicit ?tab= wins; a shared ?doc= link without one implies Analysis.
 */
function tabFromParams(sp: SearchParams): typeof TABS[number] {
  const wanted = typeof sp.tab === "string" ? sp.tab : null;
  if (wanted && (TABS as readonly string[]).includes(wanted)) return wanted as typeof TABS[number];
  return typeof sp.doc === "string" ? "analysis" : "explore";
}

/**
 * Says, on every visualization, whether patient-level data was involved in
 * producing it. "aggregate-only" means no participant returned an identifier —
 * the chart was built from counts computed inside each owning database.
 */

/**
 * Over a view whose answer is being recomputed. Its header and controls stay visible and usable
 * — so the reader sees the setting they just changed, and can change it again — while the figure
 * below is covered by a skeleton with a spinner: a figure still showing the previous answer
 * reads as the new one. Measures where the card's header/toolbars end rather than assuming it,
 * since every view kind lays those out differently; a card with none is covered whole.
 */
/**
 * The bar across the top of Explore in add mode: name the cohort being built, then add it to the
 * open analysis or cancel. Owns its own text, so typing re-renders only this bar.
 */
function AddCohortBar({ existing, ready, error, onAdd, onCancel }: {
  existing: string[]; ready: boolean; error?: string | null; onAdd: (name: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(() => {
    for (let i = existing.length + 1; ; i++) if (!existing.includes("cohort " + i)) return "cohort " + i;
  });
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("details[open]")) cancel.current(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  // Explore's own sticky filter bar sits just below this one; this bar can wrap, so it says how tall it is
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current, host = el?.parentElement;
    if (!el || !host) return;
    const set = () => host.style.setProperty("--addbar-h", el.getBoundingClientRect().height + "px");
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clash = existing.includes(name.trim());
  return (
    <div className="addcohortbar" ref={bar}>
      <strong>Add a cohort to this analysis</strong>
      <span className="meta">filter below, then add it</span>
      <span className="spacer" />
      <label className="addcohortname">name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          onKeyDown={(e) => { if (e.key === "Enter" && ready && name.trim() && !clash) onAdd(name); }} />
      </label>
      <button className="primary" disabled={!ready || !name.trim() || clash} onClick={() => onAdd(name)}
        title={!ready ? "select a study first" : clash ? "the analysis already has a cohort with this name" : "add this selection to the analysis as “" + name.trim() + "”"}>
        Add to analysis
      </button>
      <button onClick={onCancel} title="close without adding (Esc)">Cancel</button>
      {(clash || error) && <p className="error fullrow flush">{clash ? "the analysis already has a cohort named “" + name.trim() + "”" : error}</p>}
    </div>
  );
}

const IMMUNO_EVENT: any = { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" } };

interface Example { name: string; desc: string; def: CohortDef }
const EXAMPLES: Example[] = [
  { name: "Immuno-treated", desc: "any immunotherapy on the timeline",
    def: { all: [IMMUNO_EVENT] } },
  { name: "STK11-driver", desc: "OQL: STK11 with an OncoKB driver call",
    def: { all: [{ kind: "oql", q: "STK11: DRIVER" }] } },
  { name: "OQL: KRAS G12C or STK11 driver", desc: "portal OQL syntax as a clause",
    def: { all: [{ kind: "oql", q: "KRAS: MUT=G12C; STK11: DRIVER" }] } },
  { name: "Never smokers", desc: "clinical attribute predicate",
    def: { all: [{ kind: "clinical", attribute: "SMOKING_PREDICTIONS_3_CLASSES", op: "=", value: "Never" }] } },
  { name: "Progressed ≤180d post-immuno", desc: "temporal relation on the timeline",
    def: { all: [{ kind: "event", a: IMMUNO_EVENT.a, b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "BEFORE", minDays: 0, maxDays: 180 } }] } },
  { name: "True 1L immuno (naïve)", desc: "first immuno, prior-treatment guard on",
    def: { all: [{ kind: "event", a: { ...IMMUNO_EVENT.a, occurrence: "FIRST" }, rel: { type: "NONE" }, priorGuard: true }] } },
  { name: "Reached 2nd line", desc: "derived treatment-line event",
    def: { all: [{ kind: "event", a: { eventType: LINE_TYPE, attrs: [{ key: "LINE_NO", value: "2" }] }, rel: { type: "NONE" } }] } },
  { name: "STK11-driver in IMPACT-50k", desc: "study override: runs in IMPACT-50k regardless of the picker",
    def: { study: "msk_impact_50k_2026", all: [{ kind: "oql", q: "STK11: DRIVER" }] } },
  { name: "TP53-mut across CHORD + MET", desc: "two-study union (overlap not deduplicated)",
    def: { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] } },
  { name: "EGFR-driver pan-MSK", desc: "union across three MSK studies",
    def: { studies: ["msk_chord_2024", "msk_met_2021", "msk_impact_50k_2026"], all: [{ kind: "oql", q: "EGFR: DRIVER" }] } },
  { name: "ERBB2 over-expressed (TCGA BRCA)", desc: "study override: OQL EXP>2 in TCGA BRCA, where mRNA exists",
    def: { study: "brca_tcga_pan_can_atlas_2018", all: [{ kind: "oql", q: "ERBB2: EXP>2" }] } }
];

export default function AnalysisPage() {
  // Read through useSearchParams, never `use(searchParams)`: every syncUrl() is a
  // history.replaceState, which hands the page a NEW searchParams promise, and
  // `use()` of an unresolved promise suspends the whole page — the layout's
  // Suspense then shows its empty fallback for React's minimum 300 ms, a white
  // flash on every click. The params only seed first-render state (the tab, a
  // ?doc= link's loading skeleton), so nothing here needs them to be reactive.
  const params = useSearchParams();
  const sp: SearchParams = Object.fromEntries(params.entries());
  // the ?doc= link as the page was opened with it: by the time the mount effect reads it, the
  // document store may already have written the URL
  const openedWith = useRef(typeof sp.doc === "string" ? sp.doc : null);
  const [tab, setTab] = useState<"explore" | "cohorts" | "analysis" | "examples">(() => tabFromParams(sp));
  /** The "Saved" tab's own sub-tabs (Cohorts / Analyses) — these used to be
   *  two separate top-level tabs ("Cohorts" and "Saved") with a cross-link
   *  between them ("manage on the Saved tab"); one tab, two sub-tabs instead. */
  const [cohortsSubTab, setCohortsSubTab] = useState<"cohorts" | "analyses">("cohorts");
  const [exTag, setExTag] = useState<string>("all");     // Examples tab filter
  /** set when an opened document was written for an older version and has been upgraded */
  const [upgradeNote, setUpgradeNote] = useState<DocUpgrade | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cdFocus, setCdFocus] = useState<CustomDataFocus | null>(null);
  /** the `custom` tag on a cohort's pill: that clause's upload, scoped to the clause */
  const showClauseData = (cohort?: string): OnCustomData => (attribute, leaf, negated) =>
    setCdFocus({ datasets: referencedDatasets({ a: attribute }), clause: { attribute, leaf, cohort, negated } });
  const [genesFor, setGenesFor] = useState<number | null>(null);
  const genesDialog = useRef<HTMLDialogElement | null>(null);
  const customState = useCustomDataState();
  const tabRef = useRef<string>(tabFromParams(sp));            // the tab syncUrl should record
  /** which gearmenus (view menu, cohorts picker, ...) are open; see useGearmenuOpen's comment */
  const menuOpenRef = useRef(new Map<string, boolean>());
  const moreDerivedMenu = useGearmenuOpen("explore:more-derivations", menuOpenRef.current);
  const [picked, setPicked] = useState<string[]>([]);        // Cohorts tab: keys "ex:<name>" / "saved:<name>"
  /**
   * The document's raw JSON is a place to inspect and share what was asked, not something to
   * read while interpreting a figure — so it lives behind a button, in a dialog, rather than
   * taking up permanent width beside the results.
   */
  const docDialog = useRef<HTMLDialogElement | null>(null);
  // the document, its views' ids and the JSON editor's text (app/lab/doc-store.ts); every new
  // document goes into the URL, so a refresh or a shared link shows exactly it
  const docs = useDocStore(EMPTY_DOC, (d) => syncUrl(undefined, d));
  const doc = docs.current.doc;
  // an analysis refused for want of its custom data runs once that data arrives (an import, an unlock)
  const unresolvedCount = unresolvedUploads(doc).length;
  const wasUnresolved = useRef(0);
  useEffect(() => {
    if (wasUnresolved.current > 0 && unresolvedCount === 0 && Object.keys(doc.cohorts || {}).length) { setError(null); rerunAnalysis(queryClient); }
    wasUnresolved.current = unresolvedCount;
  }, [unresolvedCount]); // eslint-disable-line
  const docText = docs.current.text;
  /**
   * Decoded oncoprint contracts, keyed by the spec they came from rather than by view index.
   * A re-run that leaves a figure's spec unchanged does not refetch it, so keying by index and
   * clearing on every run left the header and the provenance panel permanently empty.
   */
  const [contracts, setContracts] = useState<Record<string, UnpackedContract>>({});
  // Starts true exactly when a ?doc= link means the mount effect below is about to load it — same
  // reasoning, and the same `sp` (not a client-only re-read of window.location), as tabFromParams
  // above: without this, the first render shows "Nothing here yet" for one frame before the
  // document arrives, which is the flash. The mount effect clears it, a malformed link included.
  const [linkLoading, setLinkLoading] = useState(() => typeof sp.doc === "string");
  /** the AI tools' edit being checked by the engine before it reaches the page */
  const [validating, setValidating] = useState(false);
  /** what went wrong outside the analysis itself (a refused action, a bad link); the analysis's own error is the query's */
  const [uiError, setError] = useState<string | null>(null);
  // a different document starts with nothing to apologise for
  useEffect(() => { setError(null); }, [docs.current.doc]);
  const [exEvals, setExEvals] = useState<Record<string, { count?: number; error?: string; busy?: boolean } | null>>({});
  const studies = useStudies();
  const studyNames = useMemo(() => new Map(studies.map((s) => [s.id, s.name] as const)), [studies]);
  const [study, setStudy] = useState("msk_chord_2024");

  // ---- the analysis: queries keyed by what decides each answer (app/lab/use-analysis.ts) ----------
  // A document is asked about as the current version (lib/doc-version.ts) with any server-stored
  // custom data it names pinned, so a shared link reads the same version; the page then holds,
  // shows and saves that shape. Until it does, nothing is sent.
  const queryClient = useQueryClient();
  let normalized: AnalysisDoc | null = null, normalizeError: string | null = null;
  try { normalized = bindUploads(upgradeDocument(doc).doc); }
  catch (e) { normalizeError = String((e as Error)?.message || e); }
  useEffect(() => {
    // a linked document is normalized once it is loaded, not the empty one standing in for it
    if (linkLoading || !normalized || normalized === doc) return;
    const up = upgradeDocument(doc);
    if (up.upgrade) setUpgradeNote(up.upgrade);
    docs.set(normalized);
  }, [normalized, linkLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  const analysis = useAnalysis(doc, docs.current.ids, docs.current.epoch, study, normalized === doc);
  const result = analysis.result;
  /** each view's id, in the document's (and so the result's) order: what a card is keyed by */
  const viewIds = docs.current.ids;
  const pendingKeys = analysis.pending;
  const busy = analysis.busy || validating || linkLoading;
  const error = uiError || normalizeError || analysis.error;
  // what the pickers offer (app/lab/use-catalogs.ts): the study's timeline and survival endpoints,
  // and the clinical attributes and profiles across the result's studies; while either is being
  // fetched a picker shows a loader, not "none"
  const { cat, catLoading } = useStudyCatalog(study);
  const { trackAttrs, trackAttrsLoading } = useTrackAttrs(result);

  // Saved cohorts and analyses belong to the login (lib/auth.ts): see use-saved.ts.
  const loggedIn = customState.unlocked;
  const savedArtifacts = useSavedArtifacts(loggedIn);
  const { cohorts: saved, workspaces: spaces, saveCohort: persist, saveWorkspace: persistSpaces, removeWorkspace: removeSpace } = savedArtifacts;
  /** Saving needs the login: logged out, ask for it rather than fail. Returns true when saving may go ahead. */
  const canSave = (): boolean => {
    if (loggedIn) return true;
    if (customState.enabled) requestLogin();
    else setError("this deployment has no login, so cohorts and analyses cannot be saved on it");
    return false;
  };

  // A selection (from a ?doc= link) may name studies this deployment does not hold; once the list
  // arrives, keep only what is reachable. Nothing is chosen for the reader: with no selection
  // Explore asks.
  useEffect(() => {
    if (!studies.length) return;
    const have = new Set(studies.map((s) => s.id));
    const keep = exSel.current.filter((id) => have.has(id));
    if (keep.join(",") !== exSel.current.join(",")) setExploreStudies(keep);
  }, [studies]); // eslint-disable-line

  useEffect(() => {
    // tab itself is already correct from the initial render (see initialTab()) — this
    // only needs to fetch what that landing tab needs and hydrate a shared ?doc= link.
    // A ?doc= link's study must land in exSel BEFORE fetchExplore reads it: doing
    // that fetch first sent it out scoped to the hardcoded default studies, so
    // every facet on screen — cardinality included, hence a table rendering where
    // a pie belonged — reflected the wrong population until the next click
    // quietly re-scoped everything and the shapes changed under the reader.
    try {
      const b64 = openedWith.current;
      if (b64) {
        const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0))));
        if (d.study) { setStudy(d.study); setExStudies([d.study]); exSel.current = [d.study]; }
        docs.replace(d);
        if (tabRef.current === "explore") fetchExplore();
      } else {
        // ?study=a,b opens Explore scoped to those studies (the data sets page links here)
        const only = (new URLSearchParams(window.location.search).get("study") || "")
          .split(",").map((x) => x.trim().replace(/[^A-Za-z0-9._-]/g, "")).filter(Boolean);
        if (only.length) { setStudy(only[0]); setExStudies(only); exSel.current = only; }
        if (tabRef.current === "explore") fetchExplore();
      }
    } catch (e) { setError("bad ?doc= link: " + String((e as Error)?.message || e)); }
    setLinkLoading(false);
  }, []); // eslint-disable-line

  /**
   * Keep the URL describing where you are, so a refresh (or a shared link)
   * lands on the same tab. `doc` and `tab` are written together — writing one
   * with a bare "?tab=…" would drop the other.
   */
  // The document store writes the URL too, from whatever closure set the document — during the
  // mount effect that still holds the initial tab — so the current tab is read from a ref, never
  // from the render closure, or a shared ?doc= link would record the wrong tab.
  const syncUrl = (nextTab?: string, d?: AnalysisDoc | null) => {
    try {
      const q = new URLSearchParams(window.location.search);
      q.set("tab", nextTab || tabRef.current);
      if (d) q.set("doc", btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d))))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
      history.replaceState(null, "", "?" + q.toString());
    } catch { /* URL state is a convenience, never a failure */ }
  };
  /** every tab switch goes through here so the URL cannot drift from the UI */
  const goTab = (t: typeof TABS[number]) => { tabRef.current = t; setTab(t); syncUrl(t); };

  const applyText = () => {
    try { const d = JSON.parse(docText); docs.set(d); }
    catch (e) { setError("document JSON: " + String((e as Error)?.message || e)); }
  };

  // ---- cohort creator / library -----------------------------------------
  const evalDef = async (name: string, def: CohortDef) => {
    const res = await api.analysis({ study, cohorts: { [name || "preview"]: def }, views: [] });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    const c = Object.values(j.cohorts)[0] as { count: number; text: string };
    return { count: c.count, text: c.text };
  };

  const openGenes = (vi: number) => { setGenesFor(vi); genesDialog.current?.showModal(); };

  /**
   * Cohorts tab: analyse the ticked cohorts together. Like Explore's Analyze it
   * REPLACES the document — the selection is the analysis, not an addition to
   * whatever was there before.
   */
  const analyzePicked = () => {
    const chosen: [string, CohortDef][] = [];
    for (const key of picked) {
      const name = key.slice(key.indexOf(":") + 1);
      const def = key.startsWith("ex:")
        ? (EXAMPLES.find((e) => e.name === name) || {}).def
        : (saved[name] || {}).def;
      if (def) chosen.push([name, def]);
    }
    if (!chosen.length) return;
    // refused rather than cut to the first sixteen: the reader ticked these, so analysing some
    // of them without saying which would answer a different question than the one asked
    if (chosen.length > 16) {
      setError("an analysis takes at most 16 cohorts; " + chosen.length + " are ticked — untick " + (chosen.length - 16) + " and analyse again");
      return;
    }
    const nd: AnalysisDoc = { study, cohorts: Object.fromEntries(chosen), views: DEFAULT_VIEWS };
    docs.replace(nd);
    setError(null);
    goTab("analysis");
  };
  const togglePick = (key: string) =>
    setPicked((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key]);

  /** Load a documented example into the Analysis tab and run it. */
  const runDocExample = (ex: DslExample) => {
    const d = JSON.parse(JSON.stringify(ex.doc)) as AnalysisDoc;   // never hand the shared object to the editor
    docs.replace(d);
    setStudy(d.study || study);
    setError(null);
    goTab("analysis");
  };

  // Accepts the authored form: this only serialises, and a template is exactly
  // what you want to share when the point is that it can be re-pointed.
  const docLink = (d: AnalysisDoc | TemplateDoc): string =>
    location.origin + location.pathname + "?doc=" +
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const previewExample = async (ex: any) => {
    setExEvals(s => ({ ...s, [ex.name]: { busy: true } }));
    try { const ev = await evalDef(ex.name, ex.def); setExEvals(s => ({ ...s, [ex.name]: ev })); }
    catch (e) { setExEvals(s => ({ ...s, [ex.name]: { error: String((e as Error)?.message || e) } })); }
  };

  const saveExample = async (ex: any) => {
    let ev: { count?: number; error?: string; busy?: boolean } | null = exEvals[ex.name] && exEvals[ex.name]!.count != null ? exEvals[ex.name] : null;
    if (!ev) { try { ev = await evalDef(ex.name, ex.def); setExEvals(s => ({ ...s, [ex.name]: ev })); } catch { ev = null; } }
    const lastEval = ev && ev.count != null ? { count: ev.count } : null;
    try { await persist(ex.name, ex.def, lastEval); } catch { /* the Examples tab has no error banner of its own */ }
  };

  // ---- AI tools ----------------------------------------------------------
  // The page's analysis as WebMCP tools and window.cohortLab (app/lab/agent-tools.ts), for the
  // researcher's assistant in the browser. The bridge is rebuilt every render, so a tool always
  // sees the current document; edits are validated by the engine before they reach the page.
  const validateDoc = async (d: AnalysisDoc): Promise<AnalysisResult> => {
    setValidating(true);
    try {
      const res = await api.analysis({ study: d.study || study, ...d }, { query: "?oncoprint=spec" });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      return j as AnalysisResult;
    } finally {
      // released whatever happens next: an edit the tool then rejects never reaches commitDoc
      setValidating(false);
    }
  };
  /** the server's proposed arms for "split this cohort by X" — see proposePartition in lib/analysis.ts */
  const proposePartition = async (req: { doc: AnalysisDoc; cohort: string; attribute?: string; gene?: string; oql?: string[]; name?: string; maxArms?: number; minCount?: number }) => {
    const res = await api.partition({ ...req, doc: { study: req.doc.study || study, ...req.doc } });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j as { name: string; def: PartitionDef; note?: string };
  };
  // ---- Explore (app/lab/use-explore-state.ts) ------------------------------
  const workspace = useWorkspace({ canSave, doc, docs, goTab, persistSpaces, removeSpace, setError, setStudy, spaces, study });
  const { analysisSaved, clearAnalysis, confirmViewNoteEdit, confirmWorkspaceSave, deleteWorkspace, noteEdit, openWorkspace, openWorkspaceSave, setNotes, setParam, setViewNoteEditing, setWsOpen, viewNoteEditing, wsError, wsOpen } = workspace;
  const cohortEdits = useCohortEdits({ doc, docs, proposePartition, setError, setToast, study });
  const { analysisStudies, cohortEditing, cohortFromSelection, confirmCohortEdit, featureFromSelection, featureSaved, openCohortEdit, removeCohort, removePartitionNamed, renamePartitionRow, runEdited, setCohortEditing, setPartitionDef, splitCohortBy, splitsFlat } = cohortEdits;
  const exploreState = useExploreState({ analysisStudies, canSave, doc, docs, evalDef, featureSaved, goTab, persist, proposePartition, runEdited, setError, setStudy, setToast, study, tab });
  const { addChartDialog, addClause, addClauses, addDraftToAnalysis, addMode, analyzeDraft, barDef, clearDraft, closeAddCohort, exMsg, exSel, exStudies, explore, exploreBusy, fetchExplore, geneCharts, openAddCohort, openCustomManager, parseDraft, removeDraftClause, setChartTab, setExStudies, setExploreStudies } = exploreState;
  const viewOptions = useViewOptions({ cat, catLoading, doc, explore, exploreBusy, result, trackAttrs, trackAttrsLoading });
  const { VIEW_KINDS, assayOptions, attrsLoading, catalogAttrs, contProfile, drawsOwnHead, geneChoices, numericAttrs, profileOptions, viewAttrs, viewEvents, viewGenes } = viewOptions;
  const viewEdits = useViewEdits({ assayOptions, busy, catalogAttrs, contProfile, doc, docs, numericAttrs, profileOptions, result, viewAttrs, viewEvents, viewGenes, viewIds });
  const { addView, cohortChoice, docView, moveView, ocView, patchView, removeView, removeViews, setViewAttrs, setViewCohorts, setViewGenes, updateView, updateViewLocal } = viewEdits;
  /** what Explore's sections read and the edits they can make (app/lab/explore-sections.tsx) */
  const exploreCtx: ExploreCtx = { ...exploreState, moreDerivedMenu, showClauseData, studies };
  /** what every view card reads and the edits it can make (app/lab/view-cards.tsx) */
  const viewCtx = { VIEW_KINDS, assayOptions, attrsLoading, busy, cat, catLoading, catalogAttrs, cohortChoice, cohortFromSelection, contracts, doc, docView, drawsOwnHead, explore, featureFromSelection, menuOpenRef, moveView, noteEdit, ocView, openGenes, patchView, pendingKeys, profileOptions, removeView, setContracts, setViewAttrs, setViewCohorts, trackAttrs, trackAttrsLoading, updateView, updateViewLocal, viewEvents, viewIds };
  /** what the Analysis tab's sections read and the actions they take (app/lab/analysis-sections.tsx) */
  const analysisCtx: AnalysisCtx = { VIEW_KINDS, addView, applyText, busy, catalogAttrs, clearAnalysis, doc, docDialog, docText, docs, explore, fetchExplore, genesDialog, genesFor, goTab, menuOpenRef, openAddCohort, openCohortEdit, openCustomManager, openWorkspaceSave, removeCohort, removePartitionNamed, removeViews, renamePartitionRow, result, saved, setCdFocus, setGenesFor, setPartitionDef, setUpgradeNote, setViewGenes, showClauseData, spaces, splitCohortBy, splitsFlat, studyNames, tab, upgradeNote, viewCtx, viewIds };
  const commitDoc = (d0: AnalysisDoc, r: AnalysisResult) => {
    const d = upgradeDocument(d0).doc;
    // the engine has already answered this document: the page's queries find that answer
    // instead of asking again, and an unchanged view keeps its id, so its card is not remounted
    seedAnalysis(queryClient, d, d.study || study, r);
    docs.commit(d);
    if (d.study && d.study !== study) setStudy(d.study);
    setError(null);
    goTab("analysis");
  };
  const saveAs = async (name: string) => {
    const d = { ...doc, title: name };
    docs.set(d);
    await persistSpaces(name, d);
  };
  const labBridge = useRef<LabBridge | null>(null);
  labBridge.current = {
    doc, result, busy, error, tab, study, savedAs: analysisSaved ? doc.title || null : null,
    validate: validateDoc, proposePartition, commit: commitDoc, goTab: (t) => goTab(t as typeof TABS[number]),
    runExample: runDocExample, save: saveAs, link: docLink,
    exploreStudies: exSel.current, draft: parseDraft(), explore, exploreBusy,
    setExploreStudies, addClause, removeDraftClause, clearDraft, analyzeDraft,
    saveDraft: async (name: string) => {
      const def = barDef();
      if (!def) throw new Error("select at least one study first");
      const ev = await evalDef(name, def);
      await persist(name, def, ev);
      return { count: ev.count };
    },
    savedCohorts: saved, savedAnalyses: spaces, openSaved: openWorkspace
  };
  const [webmcp, setWebmcp] = useState<boolean | null>(null);
  useEffect(() => {
    const t = installLabTools(() => labBridge.current!);
    setWebmcp(t.webmcp);
    return t.cleanup;
  }, []);

  return (
    <>
      <header>
        <h1>cbio-lab</h1>
        <span className="sub">analysis documents — cohorts and views over one declarative object</span>
        <span className="spacer" />
        <a className="toplink" href="/datasets">data sets</a>
        <a className="toplink" href="/reproductions">paper reproductions</a>
        <a className="toplink" href="/campaign">hypothesis campaigns</a>
        <a className="toplink" href="/rationale">rationale</a>
        <AgentToolsMenu page="analysis" tools={LAB_TOOL_NAMES} webmcp={webmcp}
          intro="Your AI assistant — Claude in the Chrome sidebar — can read and edit this analysis with these tools. Every edit is run by the engine first and reaches the page only if it is accepted; analysis_undo reverts the assistant's edits." />
        <LoginButton />
      </header>
      <main className="analysis-main">
        {/* Suggestions for every view's gene editor: the most-altered genes this
            exploration found. Typing any symbol is still allowed — the list is a
            shortcut, not a whitelist. */}
        <datalist id="view-genes">
          {geneChoices().map(g => <option key={g} value={g} />)}
        </datalist>
        {/* One popup shared by every gene-bearing view — a modal rather than a
            dropdown, because picking several genes is a task you settle into,
            and a menu that closes on an outside click fights that. */}
        {wsOpen && <WorkspaceDialog doc={doc} saved={doc.title ? spaces[doc.title] : undefined} busy={busy}
          unusedParams={result?.unusedParams} error={wsError} onParam={setParam} onNotes={setNotes}
          onDelete={() => deleteWorkspace(doc.title!)} onSave={confirmWorkspaceSave} onClose={() => setWsOpen(false)} />}
        {cohortEditing != null && <CohortEditDialog name={cohortEditing} notes={doc.cohorts?.[cohortEditing]?.notes || ""}
          taken={(n) => !!doc.cohorts?.[n]} onSave={confirmCohortEdit} onClose={() => setCohortEditing(null)} />}
        {viewNoteEditing != null && <ViewNoteDialog note={(doc.views || [])[viewNoteEditing]?.note || ""}
          onSave={confirmViewNoteEdit} onClose={() => setViewNoteEditing(null)} />}
        <GenesDialog ctx={analysisCtx} />
        <div className="tabs">
          <button className={tab === "explore" ? "active" : ""} onClick={() => { goTab("explore"); if (!explore) fetchExplore(); }}>Explore</button>
          <button className={tab === "cohorts" ? "active" : ""} onClick={() => goTab("cohorts")}>Saved</button>
          <button className={tab === "analysis" ? "active" : ""} onClick={() => goTab("analysis")}>Analysis</button>
          <button className={tab === "examples" ? "active" : ""} onClick={() => goTab("examples")}>Examples</button>
        </div>
        {error && <div className="error">{error}</div>}
        <CustomDataWarning ctx={analysisCtx} />

        {/* ================= Explore tab ================= */}
        {(tab === "explore" || addMode) && <div className={addMode ? "exploremodal" : undefined}
          role={addMode ? "dialog" : undefined} aria-modal={addMode ? true : undefined} aria-label={addMode ? "add a cohort to this analysis" : undefined}>
          {addMode && <AddCohortBar existing={Object.keys(doc.cohorts || {})} ready={exStudies.length > 0} error={exMsg}
            onAdd={addDraftToAnalysis} onCancel={closeAddCohort} />}
          <StudyPicker ctx={exploreCtx} />
          {/* Underneath study selection, and only present once there's something to
              show — Analyze lives in the studies card above regardless of whether any
              filters exist, so this block's whole job now is the filters themselves. */}
          <ExploreBar ctx={exploreCtx} />
          {/* A facet click starts a recount, and a second click before it lands
              would race it — so the facets themselves greyscale until it does.
              The study picker above stays live: choosing studies is a staged,
              separately-submitted action, not an immediate filter. */}
          <div className={exploreBusy ? "busy" : undefined} aria-busy={exploreBusy}>
          {exStudies.length === 0 && <div className="card"><p className="note t-md flush">
            Choose one or more studies above to explore.</p></div>}
          {/* first load: placeholders shaped like the facet grid, so it does not jump when it lands */}
          {!explore && exStudies.length > 0 && <div className="facetgrid" aria-label="building study facets…">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton skeleton-facet" />)}
          </div>}
          {/* Clinical/gene-status/derived-timeline filter builders used to sit here as
              three permanent cards, pushing the facet grid below the fold before you'd
              touched any of them. One button, one modal with a tab per kind instead. */}
          {explore && (
            <div className="row mb-4">
              <button className="tbbtn" onClick={() => addChartDialog.current?.showModal()}>+ Add chart</button>
              <button className="tbbtn" title="upload your own annotations and chart, filter and analyse them like clinical attributes"
                onClick={() => { setChartTab("custom"); addChartDialog.current?.showModal(); }}>
                Custom data{customState.datasets.length ? " (" + customState.datasets.length + ")" : ""}</button>
              {geneCharts.length > 0 && <span className="meta">{geneCharts.length} gene{geneCharts.length === 1 ? "" : "s"} charted</span>}
            </div>
          )}
          <AddChartDialog ctx={exploreCtx} />
          <DerivedFacets ctx={exploreCtx} />
          {explore && <>
            <div className="facetgrid">
              <ExploreCharts studies={explore.studies && explore.studies.length ? explore.studies : [explore.study]} draft={parseDraft()}
                attrs={explore.clinical || []}
                endpoints={(() => {
                  // an endpoint is a <X>_MONTHS with its <X>_STATUS, the survival view's own convention
                  const names = new Set((explore.clinical || []).map((c: any) => c.attribute));
                  const eps = [...names].filter((a) => /_MONTHS$/.test(a) && names.has(a.replace(/_MONTHS$/, "_STATUS"))).map((a) => a.replace(/_MONTHS$/, ""));
                  return eps.sort((a, b) => (a === "OS" ? -1 : b === "OS" ? 1 : a.localeCompare(b)));
                })()}
                addClauses={addClauses} km={(curves) => <KMChart curves={curves as any} />} />
              <ClinicalFacets ctx={exploreCtx} />
              {/* Charted genes (added from "+ Add chart" > Gene status) — one tile per
                  gene per alteration type, the same tile shape a clinical attribute gets,
                  so a chart you configured actually reaches this grid rather than only
                  living inside the dialog that configured it. */}
              <GeneFacets ctx={exploreCtx} />
              <StudyBreakdown ctx={exploreCtx} />
              <DataTypes ctx={exploreCtx} />
              <AlteredGenes ctx={exploreCtx} />
              <EventsAndCaseLists ctx={exploreCtx} />
            </div>
          </>}
          </div>
        </div>}

        {/* ================= Saved tab ================= */}
        {tab === "cohorts" && <SavedTab login={customState} onLogin={requestLogin}
          sub={cohortsSubTab} onSub={setCohortsSubTab} examples={EXAMPLES}
          picked={picked} onTogglePick={togglePick} onClearPicked={() => setPicked([])} onAnalyze={analyzePicked}
          evals={exEvals} onPreview={previewExample} onSaveExample={saveExample}
          saved={savedArtifacts} onOpenWorkspace={openWorkspace} onDeleteWorkspace={deleteWorkspace}
          wsError={wsError} onCustomData={showClauseData} />}

        {/* ================= Examples tab ================= */}
        {tab === "examples" && <ExamplesTab tag={exTag} onTag={setExTag} busy={busy}
          onRun={runDocExample} link={(ex) => docLink(ex.doc)} onError={setError} />}

        {/* ================= Analysis tab ================= */}
        {tab === "analysis" && <div className="ana-grid">
          <CohortColumn ctx={analysisCtx} />
          <DocDialog ctx={analysisCtx} />
          <ViewColumn ctx={analysisCtx} />
        </div>}
      </main>
      {toast && <div className="toast" role="status" onClick={() => setToast(null)}>{toast}</div>}
      <CustomDataDialog focus={cdFocus} onClose={() => setCdFocus(null)}
        bindings={doc.uploads || []}
        onRepin={(as, version) => {
          const d = { ...doc, uploads: (doc.uploads || []).map((b) => b.as === as ? { ...b, version } : b) };
          docs.set(d);
        }}
        onManage={openCustomManager} />
    </>
  );
}

