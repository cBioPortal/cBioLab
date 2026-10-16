"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExploreCharts } from "./explore-charts";
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";
import type { AnalysisDoc, CohortDef } from "../../lib/types.ts";
import { useLabTools, LAB_TOOL_NAMES } from "./agent-tools.ts";
import { AgentToolsMenu } from "../_agent/AgentToolsMenu.tsx";
import { useCustomDataState } from "./custom-data-panel.tsx";
import CustomDataDialog, { type CustomDataFocus } from "./custom-data-dialog.tsx";
import CustomDataManager from "./custom-data-panel.tsx";
import LoginButton from "./login-button.tsx";
import { upgradeDocument, type DocUpgrade } from "../../lib/doc-version.ts";
import type { OnCustomData } from "./pills";
import { requestLogin, referencedDatasets, bindUploads, unresolvedUploads } from "./custom-data-client.ts";
import { useDocStore, EMPTY_DOC } from "./doc-store.ts";
import { useDocHistory } from "./use-doc-history.ts";
import { useExploreState } from "./use-explore-state.ts";
import { useStudies, useStudyCatalog, useTrackAttrs } from "./use-catalogs.ts";
import { useExamplesUrl } from "./examples-tab.tsx";
import { useAnalysis, rerunAnalysis } from "./use-analysis.ts";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { api } from "./api.ts";
import { useSavedArtifacts } from "./use-saved.ts";
import { SavedTab } from "./saved-tab.tsx";
import { ExamplesTab } from "./examples-tab.tsx";
import { DrawAtWidth } from "./figure.tsx";
import { survivalSvg } from "../../lib/figures/survival.ts";
import { GenesDialog, CustomDataWarning, CohortColumn, DocDialog, ViewColumn, type AnalysisCtx } from "./analysis-sections.tsx";
import { StudyPicker, ExploreBar, AddChartDialog, DerivedFacets, ClinicalFacets, GeneFacets, StudyBreakdown, DataTypes, AlteredGenes, EventsAndCaseLists, type ExploreCtx } from "./explore-sections.tsx";
import { CohortEditDialog, ViewNoteDialog, WorkspaceDialog } from "./dialogs.tsx";
import { useViewOptions } from "./use-view-options.ts";
import { useViewEdits } from "./use-view-edits.ts";
import { useCohortEdits } from "./use-cohort-edits.ts";
import { useWorkspace } from "./use-workspace.ts";
import { useLibrary, EXAMPLES, docParam } from "./use-library.ts";
import type { DslExample } from "../../lib/dsl-reference.ts";
import { useToolActions } from "./use-tool-actions.ts";
import { AddCohortDialog, type AddCohortTarget } from "./add-cohort-dialog.tsx";
import { cellExplorerFor } from "../../lib/cell-explorer.ts";
import { Tabs, TabsList, TabsTrigger } from "../_ui/tabs";
import { Button } from "../_ui/button";
import { Input } from "../_ui/input";
import { PAGE_TAB } from "../_ui/toolbar.ts";

const TABS = ["explore", "cohorts", "analysis", "examples"] as const;
const TAB_LABELS: [typeof TABS[number], string][] = [["explore", "Explore"], ["cohorts", "Saved"], ["analysis", "Analysis"], ["examples", "Examples"]];

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
function AddCohortBar({ existing, target, ready, error, onAdd, onCancel }: {
  existing: string[]; target: string; ready: boolean; error?: string | null; onAdd: (name: string) => void; onCancel: () => void;
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
      <strong>Adding a cohort to {target}</strong>
      <span className="meta">filter below, name it, then add it — Cancel returns to the analysis</span>
      <span className="spacer" />
      <label className="addcohortname">name
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-8 w-56 bg-card text-md md:text-md"
          onKeyDown={(e) => { if (e.key === "Enter" && ready && name.trim() && !clash) onAdd(name); }} />
      </label>
      <Button disabled={!ready || !name.trim() || clash} onClick={() => onAdd(name)}
        title={!ready ? "select a study first" : clash ? "the analysis already has a cohort with this name" : "add this selection to " + target + " as “" + name.trim() + "”"}>
        <Plus />Add to {target}
      </Button>
      <Button variant="outline" onClick={onCancel} title="close without adding (Esc)">Cancel</Button>
      {(clash || error) && <p className="error fullrow flush">{clash ? "the analysis already has a cohort named “" + name.trim() + "”" : error}</p>}
    </div>
  );
}

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
  /** set when an opened document was written for an older version and has been upgraded */
  const [upgradeNote, setUpgradeNote] = useState<DocUpgrade | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** the view whose "+ Add cohort" dialog is open */
  const [chooser, setChooser] = useState<AddCohortTarget | null>(null);
  const [cdFocus, setCdFocus] = useState<CustomDataFocus | null>(null);
  /** the `custom` tag on a cohort's pill: that clause's upload, scoped to the clause */
  const showClauseData = (cohort?: string): OnCustomData => (attribute, leaf, negated) =>
    setCdFocus({ datasets: referencedDatasets({ a: attribute }), clause: { attribute, leaf, cohort, negated } });
  const [genesFor, setGenesFor] = useState<number | null>(null);
  const customState = useCustomDataState();
  const tabRef = useRef<string>(tabFromParams(sp));            // the tab syncUrl should record
  /** which menus (view menu, cohorts picker, ...) are open, so a menu outlives its card remounting (GearMenu) */
  const menuOpenRef = useRef(new Map<string, boolean>());
  /**
   * The document's raw JSON is a place to inspect and share what was asked, not something to
   * read while interpreting a figure — so it lives behind a button, in a dialog, rather than
   * taking up permanent width beside the results.
   */
  const docDialog = useRef<HTMLDialogElement | null>(null);
  // the document, its views' ids and the JSON editor's text (app/lab/doc-store.ts); every new
  // document goes into the URL, so a refresh or a shared link shows exactly it
  const docs = useDocStore(EMPTY_DOC, (d, undoable) => syncUrl(undefined, d, undoable));
  // each change the reader makes is a browser history entry: Back, Forward, Undo and Redo step through them
  const docHistory = useDocHistory(docs, EMPTY_DOC, () => tabRef.current);
  const doc = docs.current.doc;
  // an analysis refused for want of its custom data runs once that data arrives (an import, an unlock)
  const unresolvedCount = unresolvedUploads(doc).length;
  const wasUnresolved = useRef(0);
  useEffect(() => {
    if (wasUnresolved.current > 0 && unresolvedCount === 0 && Object.keys(doc.cohorts || {}).length) { setError(null); void rerunAnalysis(queryClient); }
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
    docs.set(normalized, { undoable: false });   // the document as opened, in the current version — not a step of the reader's
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
  // fetched a picker shows a loader, not "none". Only the Analysis tab shows those pickers, and
  // `study` is settled only once a ?doc= link has been read.
  const { cat, catLoading } = useStudyCatalog(study, tab === "analysis" && !linkLoading);
  const { trackAttrs, trackAttrsLoading } = useTrackAttrs(result);

  // Saved cohorts and analyses belong to the signed-in user (lib/auth.ts): see use-saved.ts.
  const loggedIn = customState.unlocked;
  const savedArtifacts = useSavedArtifacts(customState.user?.id ?? null);
  const { cohorts: saved, workspaces: spaces, saveCohort: persist, saveWorkspace: persistSpaces, removeWorkspace: removeSpace } = savedArtifacts;
  /** Saving needs the login: logged out, ask for it rather than fail. Returns true when saving may go ahead. */
  const canSave = (): boolean => {
    if (loggedIn) return true;
    if (customState.enabled) requestLogin();
    else setError("this deployment has no sign-in, so cohorts and analyses cannot be saved on it");
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
        docs.replace(d, { undoable: false });   // the link the page opened: the first step, not a new one
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
  // A document change the reader made adds a history entry (use-doc-history.ts); a tab switch, or a
  // change they did not make, rewrites the current one.
  const syncUrl = (nextTab?: string, d?: AnalysisDoc | null, push = false) => {
    try {
      const q = new URLSearchParams(window.location.search);
      q.set("tab", nextTab || tabRef.current);
      if (d) q.set("doc", btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d))))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
      docHistory.record("?" + q.toString(), push);
    } catch { /* URL state is a convenience, never a failure */ }
  };
  /** every tab switch goes through here so the URL cannot drift from the UI */
  const goTab = (t: typeof TABS[number]) => { tabRef.current = t; setTab(t); syncUrl(t); };

  const applyText = () => {
    try { const d = JSON.parse(docText); docs.set(d); }
    catch (e) { setError("document JSON: " + String((e as Error)?.message || e)); }
  };

  /** a cohort definition's size and readback, for previews and saving */
  const evalDef = async (name: string, def: CohortDef) => {
    const res = await api.analysis({ study, cohorts: { [name || "preview"]: def }, views: [] });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    const c = Object.values(j.cohorts)[0] as { count: number; text: string };
    return { count: c.count, text: c.text };
  };

  const openGenes = (vi: number) => setGenesFor(vi);

  // ---- the page's actions, each group in its own hook; later groups use earlier ones ----------
  const toolActions = useToolActions({ doc, docs, goTab, persistSpaces, queryClient, setError, setStudy, setValidating, study });
  const { commitDoc, proposePartition, saveAs, validateDoc } = toolActions;
  const library = useLibrary({ docs, evalDef, goTab, persist, saved, sharedSaved: savedArtifacts.sharedCohorts, setError, setStudy, study });
  const { analyzePicked, cohortsSubTab, docLink, exEvals, exTag, picked, previewExample, runDocExample, saveExample, setCohortsSubTab, setExTag, setPicked, togglePick } = library;
  // where the gallery examples run (EXAMPLES_URL): here, or a deployment that holds their studies
  const { examplesUrl, examplesUrlError } = useExamplesUrl();
  const exampleLink = (ex: DslExample) => examplesUrl ? examplesUrl + "/lab?doc=" + docParam(ex.doc) : docLink(ex.doc);
  const workspace = useWorkspace({ canSave, doc, docs, goTab, persistSpaces, removeSpace, setError, setStudy, spaces, study,
    sharedSpaces: savedArtifacts.sharedWorkspaces,
    saveShared: (id, name, d, version) => savedArtifacts.saveShared("workspace", id, name, d, version) });
  const { sharedOpen, openShared, confirmSharedSave, analysisSaved, clearAnalysis, confirmViewNoteEdit, confirmWorkspaceSave, deleteWorkspace, noteEdit, openWorkspace, openWorkspaceSave, setNotes, setParam, setViewNoteEditing, setWsOpen, viewNoteEditing, wsError, wsOpen } = workspace;
  const savedReady = loggedIn && !savedArtifacts.cohortsState.pending && !savedArtifacts.cohortsState.error;
  const cohortEdits = useCohortEdits({ doc, docs, evalOf: (n) => { const c = result?.cohorts[n]; return c ? { count: c.count, text: c.text } : null; }, persist, proposePartition, saved, savedReady, setError, setToast, study });
  const { analysisStudies, cohortEditing, cohortFromSelection, confirmCohortEdit, featureFromSelection, featureSaved, openCohortEdit, removeCohort, removePartitionNamed, renamePartitionRow, runEdited, setCohortEditing, setPartitionDef, splitCohortBy, splitsFlat, cohortSource, updateFromSaved, cohortSaveState, saveCohortToLibrary, cohortCells, openCohortCells } = cohortEdits;
  const exploreState = useExploreState({ addCohortToView: (...a) => addCohortToView(...a), analysisStudies, canSave, doc, docs, evalDef, featureSaved, goTab, persist, proposePartition, runEdited, setError, setStudy, setToast, study, tab });
  const { setAddChartOpen, addClause, addClauses, addDraftToAnalysis, addMode, analyzeDraft, barDef, clearDraft, closeAddCohort, exMsg, exSel, exStudies, explore, exploreBusy, fetchExplore, geneCharts, openAddCohort, openCustomManager, parseDraft, removeDraftClause, setExStudies, setExploreStudies } = exploreState;
  const openTab = (t: typeof TABS[number]) => { goTab(t); if (t === "explore" && !explore) fetchExplore(); };
  const viewOptions = useViewOptions({ cat, catLoading, doc, explore, exploreBusy, result, trackAttrs, trackAttrsLoading });
  const { VIEW_KINDS, assayOptions, attrsLoading, catalogAttrs, contProfile, drawsOwnHead, geneChoices, numericAttrs, profileOptions, viewAttrs, viewEvents, viewGenes } = viewOptions;
  const viewEdits = useViewEdits({ VIEW_KINDS, assayOptions, busy, catalogAttrs, contProfile, doc, docs, numericAttrs, profileOptions, result, setChooser, setToast, study, viewAttrs, viewEvents, viewGenes, viewIds });
  const { addCohortToView, addView, cohortChoice, docView, emptyViewHint, maxCohortsOf, moveView, ocView, openCohortChooser, patchView, removeView, removeViews, setViewAttrs, setViewCohorts, setViewGenes, updateView, updateViewLocal, viewTitle } = viewEdits;

  // ---- what the sections read ------------------------------------------------------------
  /** what Explore's sections read and the edits they can make (app/lab/explore-sections.tsx) */
  const exploreCtx: ExploreCtx = { ...exploreState, menuStore: menuOpenRef.current, showClauseData, studies };
  /** what every view card reads and the edits it can make (app/lab/view-cards.tsx) */
  const viewCtx = { VIEW_KINDS, docHistory, study, assayOptions, attrsLoading, busy, cat, catLoading, catalogAttrs, cohortChoice, cohortFromSelection, contracts, doc, docView, drawsOwnHead, explore, featureFromSelection, maxCohortsOf, menuOpenRef, moveView, noteEdit, ocView, openCohortChooser, openGenes, patchView, pendingKeys, profileOptions, removeView, setContracts, setViewAttrs, setViewCohorts, trackAttrs, trackAttrsLoading, updateView, updateViewLocal, viewEvents, viewIds };
  /** what the Analysis tab's sections read and the actions they take (app/lab/analysis-sections.tsx) */
  const analysisCtx: AnalysisCtx = { VIEW_KINDS, addView, docHistory, applyText, busy, catalogAttrs, clearAnalysis, doc, docDialog, docText, docs, explore, fetchExplore, cohortCells, cohortSaveState, cohortSource, openCohortCells, emptyViewHint, genesFor, goTab, loggedIn, menuOpenRef, moveView, openCohortChooser, openCohortEdit, openCustomManager, openWorkspaceSave, removeCohort, removePartitionNamed, removeView, removeViews, renamePartitionRow, result, saveCohortToLibrary, saved, setCdFocus, setGenesFor, setPartitionDef, setUpgradeNote, setViewGenes, showClauseData, spaces, splitCohortBy, splitsFlat, studyNames, tab, updateFromSaved, upgradeNote, viewCtx, viewIds, viewTitle };
  // what the page offers the researcher's AI assistant (app/lab/agent-tools.ts), current every render
  const webmcp = useLabTools({
    doc, result, busy, error, tab, study, savedAs: analysisSaved ? doc.title || null : null,
    validate: validateDoc, proposePartition, commit: commitDoc, goTab: (t) => goTab(t as typeof TABS[number]),
    runExample: runDocExample, examplesElsewhere: examplesUrl, exampleLink, save: saveAs, link: docLink,
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
  });

  return (
    <>
      <header>
        <h1>cbio-lab</h1>
        <span className="sub">analysis documents — cohorts and views over one declarative object</span>
        <span className="spacer" />
        <a className="toplink" href="/reproductions">paper reproductions</a>
        <a className="toplink" href="/verification">how we verify</a>
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
          shared={sharedOpen} onSaveShared={confirmSharedSave}
          unusedParams={result?.unusedParams} error={wsError} onParam={setParam} onNotes={setNotes}
          onDelete={() => deleteWorkspace(doc.title!)} onSave={confirmWorkspaceSave} onClose={() => setWsOpen(false)} />}
        {cohortEditing != null && <CohortEditDialog name={cohortEditing} notes={doc.cohorts?.[cohortEditing]?.notes || ""}
          taken={(n) => !!doc.cohorts?.[n]} onSave={confirmCohortEdit} onClose={() => setCohortEditing(null)} />}
        {viewNoteEditing != null && <ViewNoteDialog note={(doc.views || [])[viewNoteEditing]?.note || ""}
          onSave={confirmViewNoteEdit} onClose={() => setViewNoteEditing(null)} />}
        <GenesDialog ctx={analysisCtx} />
        {/* a click on the open tab still writes it to the URL */}
        <Tabs value={tab} className="mb-4" onValueChange={(v) => openTab(v as typeof TABS[number])}>
          <TabsList variant="line" aria-label="lab sections" className="w-full justify-start gap-1.5 border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-auto">
            {TAB_LABELS.map(([t, label]) => <TabsTrigger key={t} value={t} onClick={() => { if (t === tab) openTab(t); }}
              className={PAGE_TAB}>{label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        {error && <div className="error">{error}</div>}
        <CustomDataWarning ctx={analysisCtx} />

        {/* ================= Explore tab ================= */}
        {(tab === "explore" || addMode) && <div className={addMode ? "exploremodal" : undefined}
          role={addMode ? "dialog" : undefined} aria-modal={addMode ? true : undefined} aria-label={addMode ? "add a cohort to " + addMode.target.title : undefined}>
          {addMode && <AddCohortBar existing={Object.keys(doc.cohorts || {})} target={addMode.target.title} ready={exStudies.length > 0} error={exMsg}
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
              <Button variant="outline" size="sm" onClick={() => setAddChartOpen(true)}><Plus />Add chart</Button>
              <Button variant="outline" size="sm" title="upload your own annotations and chart, filter and analyse them like clinical attributes"
                onClick={() => openCustomManager(customState.unlocked && customState.datasets.length ? "manage" : "add")}>
                <Upload />Custom data{customState.datasets.length ? " (" + customState.datasets.length + ")" : ""}</Button>
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
                addClauses={addClauses} km={(curves) => <DrawAtWidth min={320} draw={(width) => survivalSvg({ kind: "survival", curves: curves as any }, { width })} deps={[curves]} />} />
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
          saved={savedArtifacts} onOpenWorkspace={openWorkspace} onOpenShared={openShared} onDeleteWorkspace={deleteWorkspace}
          wsError={wsError} onCustomData={showClauseData} />}

        {/* ================= Examples tab ================= */}
        {tab === "examples" && <ExamplesTab tag={exTag} onTag={setExTag} busy={busy}
          onRun={runDocExample} link={exampleLink} elsewhere={examplesUrl} elsewhereError={examplesUrlError} onError={setError} />}

        {/* ================= Analysis tab ================= */}
        {tab === "analysis" && <div className="ana-grid">
          <CohortColumn ctx={analysisCtx} />
          <DocDialog ctx={analysisCtx} />
          <ViewColumn ctx={analysisCtx} />
        </div>}
      </main>
      <AddCohortDialog target={chooser}
        analysis={Object.entries(doc.cohorts || {}).map(([name, def]) => ({ name, def, count: result?.cohorts[name]?.count ?? null,
          views: (doc.views || []).filter((v: any) => Array.isArray(v.cohorts) && v.cohorts.includes(name)).map((v: any) => viewTitle(v.kind)) }))}
        library={{
          saved: !customState.enabled ? "off" : !loggedIn ? "locked"
            : savedArtifacts.cohortsState.pending ? "loading" : savedArtifacts.cohortsState.error ? "error" : "ready",
          savedError: savedArtifacts.cohortsState.error,
          cohorts: Object.entries(saved).map(([name, x]) => ({ id: x.id, name, def: x.def, savedAt: x.savedAt })),
          examples: EXAMPLES,
        }}
        onAdd={(name, def) => { if (chooser) addCohortToView(chooser, name, def); }}
        onExplore={() => { if (!chooser) return; const t = chooser; setChooser(null); openAddCohort(t); }}
        onLogin={requestLogin}
        cells={cellExplorerFor(doc.study || study)}
        onClose={() => setChooser(null)} />
      {toast && <div className="toast" role="status"><button type="button" title="dismiss" onClick={() => setToast(null)}>{toast}</button></div>}
      <CustomDataManager tab={exploreState.customTab} setTab={exploreState.setCustomTab} studies={exStudies} onChanged={() => fetchExplore()} />
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

