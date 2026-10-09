"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import CohortPills from "./pills";
import { MORE_KINDS, isMoreKind, defaultMoreView } from "./more-views";
import { ExploreCharts } from "./explore-charts";
import type { ColumnSelection } from "../_oncoprint/OncoprintFigure.tsx";
import { GeneListEditor, pruneSort } from "../_oncoprint/OncoprintCard.tsx";
import { type GeneTrackSpec } from "../../lib/gene-tracks.ts";
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";
import { parameterize } from "../../lib/params.ts";
import type { AnalysisDoc, TemplateDoc, AnalysisResult, CohortDef, OncoprintView, PartitionDef } from "../../lib/types.ts";
import type { DslExample } from "../../lib/dsl-reference.ts";
import { foldEventNames } from "../../lib/event-names.ts";
import { installLabTools, LAB_TOOL_NAMES, type LabBridge } from "./agent-tools.ts";
import { AgentToolsMenu } from "../_agent/AgentToolsMenu.tsx";
import { useCustomDataState } from "./custom-data-panel.tsx";
import CustomDataDialog, { type CustomDataFocus } from "./custom-data-dialog.tsx";
import LoginButton from "./login-button.tsx";
import { PartitionPanel, SplitForm, type SplitSpec } from "./partitions.tsx";
import { withoutPartition, renamePartitionChild, expandSplits, flattenSplits, editSplits, splitKey, renameInViews, type PartitionShape } from "../../lib/partition-arms.ts";
import { DOC_VERSION, upgradeDocument, type DocUpgrade } from "../../lib/doc-version.ts";
import type { OnCustomData } from "./pills";
import { saveToServer, requestLogin, referencedDatasets, customDataKey, bindUploads, unresolvedUploads, featureFromColumns, type StoredDataset } from "./custom-data-client.ts";
import { isCustomAttr } from "../../lib/custom-data-names.ts";
import { useDocStore, DEFAULT_VIEWS } from "./doc-store.ts";
import { useExploreState } from "./use-explore-state.ts";
import { useAnalysis, seedAnalysis, rerunAnalysis } from "./use-analysis.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useGearmenuOpen, CohortNode, CohortStudies, ViewHead, CohortEditMenu, CAT_COLORS } from "./view-chrome.tsx";
import { api } from "./api.ts";
import { useSavedArtifacts } from "./use-saved.ts";
import { SavedTab } from "./saved-tab.tsx";
import { ExamplesTab } from "./examples-tab.tsx";
import { ViewCard, KMChart } from "./view-cards.tsx";
import { StudyPicker, ExploreBar, AddChartDialog, DerivedFacets, ClinicalFacets, GeneFacets, StudyBreakdown, DataTypes, AlteredGenes, EventsAndCaseLists, type ExploreCtx } from "./explore-sections.tsx";
import { CohortEditDialog, ViewNoteDialog, WorkspaceDialog } from "./dialogs.tsx";

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
      {(clash || error) && <p className="error" style={{ flexBasis: "100%", margin: 0 }}>{clash ? "the analysis already has a cohort named “" + name.trim() + "”" : error}</p>}
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
    def: { all: [{ kind: "event", a: { eventType: "Treatment line (derived)", attrs: [{ key: "LINE_NO", value: "2" }] }, rel: { type: "NONE" } }] } },
  { name: "STK11-driver in IMPACT-50k", desc: "study override: runs in IMPACT-50k regardless of the picker",
    def: { study: "msk_impact_50k_2026", all: [{ kind: "oql", q: "STK11: DRIVER" }] } },
  { name: "TP53-mut across CHORD + MET", desc: "two-study union (overlap not deduplicated)",
    def: { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] } },
  { name: "EGFR-driver pan-MSK", desc: "union across three MSK studies",
    def: { studies: ["msk_chord_2024", "msk_met_2021", "msk_impact_50k_2026"], all: [{ kind: "oql", q: "EGFR: DRIVER" }] } },
  { name: "ERBB2 over-expressed (TCGA BRCA)", desc: "study override: OQL EXP>2 in TCGA BRCA, where mRNA exists",
    def: { study: "brca_tcga_pan_can_atlas_2018", all: [{ kind: "oql", q: "ERBB2: EXP>2" }] } }
];

// already the current version, so opening the page normalizes (and writes into the URL) nothing
const EMPTY_DOC: AnalysisDoc = { dsl: DOC_VERSION, cohorts: {}, views: [] };

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
  const [cat, setCat] = useState<any>(null);                 // event/endpoint catalog for the survival control
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
  const [studies, setStudies] = useState<{ id: string; name: string; cancerType?: string; patients: number; samples: number; timelinePatients: number; caps?: Record<string, boolean>; oncokb?: boolean; instance?: string; instanceLabel?: string }[]>([]);
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
  const [trackAttrs, setTrackAttrs] = useState<{ key: string; attrs: { attribute: string; kind: string; patients: number }[]; profiles: string[]; gaProfiles: string[] }>({ key: "", attrs: [], profiles: [], gaProfiles: [] }); // track picker options
  /** the clinical-attribute catalog above is being fetched — a picker shows a loader, not "none" */
  const [trackAttrsLoading, setTrackAttrsLoading] = useState(false);
  /** the study catalog (`cat`: endpoints, event types) is being fetched */
  const [catLoading, setCatLoading] = useState(false);

  const [wsOpen, setWsOpen] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);

  // ---- editing a cohort's name/note (the gear menu's "edit…") -------------
  const [cohortEditing, setCohortEditing] = useState<string | null>(null); // the name AS IT IS in doc.cohorts right now

  // ---- editing a view's note (the gear menu's "add note…" / "edit note…") -
  const [viewNoteEditing, setViewNoteEditing] = useState<number | null>(null); // index into doc.views / result.views

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

  useEffect(() => {
    fetch("/api/studies").then(r => r.json()).then(j => {
      const list = j.studies || [];
      setStudies(list);
      // A selection (from a ?doc= link) may name studies this deployment does not hold; keep only
      // what is reachable. Nothing is chosen for the reader: with no selection Explore asks.
      const have = new Set(list.map((s: { id: string }) => s.id));
      const keep = exSel.current.filter((id) => have.has(id));
      if (list.length && keep.join(",") !== exSel.current.join(",")) setExploreStudies(keep);
    }).catch(() => {});
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

  // ---- save as feature: a selection frozen into a yes/no custom attribute ----
  const featureSaved = (d: StoredDataset) => {
    const yes = d.rows.filter((r) => r.values[0] === "Yes").length;
    return "saved feature \u201c" + d.name + "\u201d (custom:" + d.id + "/" + d.columns[0].name + "): " +
      yes.toLocaleString() + " " + d.level + "s Yes, " + (d.rows.length - yes).toLocaleString() + " No";
  };
  const featureFromSelection = async (sel: ColumnSelection, all: string[], studies: string[]) => {
    const d = await featureFromColumns(sel.name || "selection", sel.unit, sel.ids, all, studies);
    await saveToServer(d);
    setToast(featureSaved(d) + " \u2014 add it as a track, a split or a filter like any attribute");
    setTimeout(() => setToast(null), 6000);
  };

  // ---- composing views without editing JSON --------------------------------
  /** Genes to prefill a new view with: whatever the document already studies,
   *  else the most-altered genes from the current exploration. */
  const viewGenes = (): string[] => {
    const inDoc = (doc.views || []).flatMap((v: any) => v.genes || []).map(String);
    if (inDoc.length) return [...new Set(inDoc)].slice(0, 6);
    if (explore && explore.genes && explore.genes.length) return explore.genes.slice(0, 6).map((g: any) => g.gene);
    return ["TP53", "KRAS", "EGFR", "PIK3CA"];
  };
  const viewAttrs = (): string[] => {
    const inDoc = (doc.views || []).flatMap((v: any) => v.attributes || []).map(String);
    if (inDoc.length) return [...new Set(inDoc)].slice(0, 5);
    return catalogAttrs().slice(0, 4).map((c) => c.attribute);
  };
  /**
   * Timeline event types this study actually has, most common first, folded by
   * case so `Treatment` and `TREATMENT` offer one choice — the same fold the
   * engine applies (lib/event-names.ts).
   */
  const viewEvents = (): { canonical: string; label: string; n: number; perPatient?: number; hasDurations?: boolean }[] => {
    // A course result knows this cohort's OWN timeline, including which types
    // carry durations; Explore only knows the study's. Prefer the former.
    const fromResult = (result && result.views || []).find((v: any) => v.eventOptions && v.eventOptions.length);
    if (fromResult) return (fromResult as any).eventOptions.map((e: any) =>
      ({ canonical: e.canonical, label: e.label, n: e.patients, perPatient: e.perPatient, hasDurations: e.hasDurations }));
    // Explore's events if it has been opened, else the study catalog's — a shared ?doc= link lands
    // on Analysis without ever fetching Explore, and the course/sequence buttons would otherwise
    // report "no timeline events" for a study that has plenty. The derived treatment-line type is
    // the catalog's own synthesis, not a recorded event type, so it isn't offered here.
    const raw: { type: string; n: number }[] = (explore && explore.events && explore.events.length) ? explore.events
      : ((cat && cat.types) || []).filter((t: any) => t.t !== "Treatment line (derived)").map((t: any) => ({ type: String(t.t), n: Number(t.n_pat) || 0 }));
    return foldEventNames(raw.map((e) => ({ name: String(e.type), n: e.n })))
      .map((f) => ({ canonical: f.canonical, label: f.label, n: f.n }));
  };
  /** a continuous profile for co-expression / heatmaps, if this study has one */
  /**
   * The clinical attribute catalog, for a plot's default axes. `trackAttrs` is the richer,
   * multi-study union (populated once a plot/clinical/cox/oncoprint view exists in the result),
   * but the very FIRST plot added to an empty document runs before any result exists to trigger
   * that fetch — so it falls back to Explore's own per-study facets, already in hand by the time
   * a reader has gotten as far as adding a view.
   */
  const catalogAttrs = (): { attribute: string; kind: string }[] =>
    trackAttrs.attrs.length ? trackAttrs.attrs : ((explore && explore.clinical) || []);
  /** the numeric clinical attributes this study declares, for a plot's default axes */
  const numericAttrs = (): string[] => catalogAttrs().filter((a) => a.kind === "num").map((a) => a.attribute);
  /** still waiting on an attribute catalog, and nothing to offer yet — show a loader, not "none" */
  const attrsLoading = (): boolean => !catalogAttrs().length && (trackAttrsLoading || exploreBusy);
  /** continuous molecular profiles for an axis picker: Explore's if loaded, else the shared catalog's */
  const profileOptions = (): string[] => (explore && explore.profiles && explore.profiles.length ? explore.profiles : trackAttrs.profiles);
  const assayOptions = (): string[] => (explore && explore.gaProfiles && explore.gaProfiles.length ? explore.gaProfiles : trackAttrs.gaProfiles);

  const contProfile = (): string | null => {
    const ps = profileOptions();
    return ps.find((p: string) => /zscore/i.test(p)) || ps.find((p: string) => /mrna|rna_seq/i.test(p)) || null;
  };

  /**
   * Survival and Cox both fit a <X>_MONTHS/<X>_STATUS endpoint. When every cohort lives in one
   * study and that study's catalog says it declares none (AACR GENIE's public release, say),
   * adding either view can only produce an error card, so the button says why instead. Unknown
   * (catalog not loaded, lookup failed, cohorts spanning several studies) leaves them enabled.
   */
  const noSurvivalWhy = (): string | null => {
    const studies = new Set(Object.values(doc.cohorts || {}).flatMap((c: any) =>
      Array.isArray(c?.studies) && c.studies.length ? c.studies : [c?.study || doc.study]));
    if (studies.size !== 1 || !cat || cat.study !== [...studies][0]) return null;
    if (!Array.isArray(cat.survivalEndpoints) || cat.survivalEndpoints.length) return null;
    return cat.study + " has no survival data (no <X>_MONTHS/<X>_STATUS pair), so there is no endpoint to fit";
  };
  /**
   * `loading`: the data this button's `why` decides on is still being fetched. The button waits
   * with a spinner rather than guessing — enabling it could add a view that can only error, and
   * `why` alone would call a study empty when its catalog simply hasn't arrived.
   */
  const VIEW_KINDS: { kind: string; label: string; why?: () => string | null; loading?: () => boolean }[] = [
    { kind: "compare", label: "Compare genes" },
    { kind: "survival", label: "Survival", why: noSurvivalWhy, loading: () => catLoading },
    { kind: "cox", label: "Cox regression (forest plot)", why: noSurvivalWhy, loading: () => catLoading },
    { kind: "logistic", label: "Logistic regression (odds ratios)" },
    { kind: "oncoprint", label: "Oncoprint" },
    { kind: "hotspots", label: "Lollipop (hotspots)" },
    { kind: "plot", label: "Plot", loading: attrsLoading,
      why: () => viewAttrs().length ? null : "this study declares no clinical attributes to plot" },
    { kind: "cooccurrence", label: "Co-occurrence" },
    { kind: "clinical", label: "Clinical comparison", loading: attrsLoading,
      why: () => viewAttrs().length ? null : "this study declares no clinical attributes to compare" },
    { kind: "coexpression", label: "Co-expression", loading: () => !contProfile() && (trackAttrsLoading || exploreBusy),
      why: () => contProfile() ? null : "this study has no continuous molecular profile (mRNA z-scores) to correlate" },
    { kind: "course", label: "Clinical course", loading: () => !viewEvents().length && (catLoading || exploreBusy),
      why: () => viewEvents().length ? null
        : "this study records no timeline events (only 131 of 545 studies have any)" },
    { kind: "sequence", label: "Treatment sequence", loading: () => !viewEvents().length && (catLoading || exploreBusy),
      why: () => viewEvents().some(e => /treat|therap|regimen|drug|medicat/.test(e.canonical)) ? null
        : "this study records no treatment events, so there are no lines of therapy to sequence" },
    ...Object.entries(MORE_KINDS).map(([kind, k]) => ({ kind, label: k.label,
      ...(k.why ? { why: () => k.why!({ genes: [], attrs: catalogAttrs(), profiles: profileOptions(), assays: assayOptions(), events: viewEvents(), cohorts: Object.keys(doc.cohorts || {}) }),
                    loading: () => !profileOptions().length && (trackAttrsLoading || exploreBusy) } : {}) }))
  ];

  /**
   * Whether this view's own block renders its header (and with it the remove/move controls).
   * Most kinds only draw theirs once they have data, so a view that came back with only an error
   * would otherwise be a bare red box the reader can't remove without editing the JSON.
   */
  const drawsOwnHead = (v: any): boolean =>
    isMoreKind(v.kind) || v.kind === "cox" || v.kind === "logistic" || v.kind === "plot" ||
    (v.kind === "compare" && !!v.rows) || (v.kind === "hotspots" && !!v.hotspots) ||
    (v.kind === "coexpression" && !!v.coexpression) || (v.kind === "clinical" && !!v.clinical) ||
    (v.kind === "cooccurrence" && !!v.pairs) || (v.kind === "survival" && !!v.curves) ||
    ((v.kind === "sequence" || v.kind === "course") && !!v.svg) || (v.kind === "oncoprint" && !!v.spec);

  /** Drop one view from the document. Removing a view can't change any OTHER
   *  view's answer — each view's result depends only on its own definition
   *  and the cohort definitions it draws from, neither of which removal
   *  touches — so this splices `result.views` locally instead of re-running
   *  everything, the same way moveView (below) already does. */
  const removeViews = (drop: (v: any, i: number) => boolean) => {
    const all = doc.views || [];
    const keep = all.map((v: any, j: number) => !drop(v, j));
    const views = all.filter((_: any, j: number) => keep[j]);
    docs.set({ ...doc, views });
  };
  const removeView = (i: number) => removeViews((_, j) => j === i);

  /** Swap a view with its neighbour. Order is cosmetic — the computed result for
   *  each view is unchanged, so this reorders `result.views` too rather than
   *  re-running the document just to move a card. */
  const moveView = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    const views = [...(doc.views || [])];
    if (j < 0 || j >= views.length) return;
    [views[i], views[j]] = [views[j], views[i]];
    docs.set({ ...doc, views });
  };

  const addView = (kind: string) => {
    const genes = viewGenes();
    const v: any =
      kind === "survival" ? { kind }
      : kind === "clinical" ? { kind, attributes: viewAttrs() }
      : kind === "coexpression" ? { kind, genes: genes.slice(0, 5), profileType: contProfile() }
      : kind === "hotspots" ? { kind, genes: genes.slice(0, 4), minCount: 1 }
      : kind === "plot" ? (() => {
          // start from two attributes this study actually declares, and fall back to an
          // alteration axis, which every study can answer
          const nums = numericAttrs();
          if (nums.length >= 2) return { kind, x: { source: "clinical", attribute: nums[0] }, y: { source: "clinical", attribute: nums[1] }, unit: "sample" };
          const cat = catalogAttrs().find((a) => a.kind !== "num");
          return { kind, unit: "sample",
            x: { source: "alteration", gene: genes[0] || "TP53", by: "mutationType" },
            y: cat ? { source: "clinical", attribute: cat.attribute } : { source: "alteration", gene: genes[1] || "KRAS", by: "mutated" } };
        })()
      : kind === "course" ? (() => {
          const evs = viewEvents();
          // Rank by STRUCTURE, not by how common the type is. Picking the two
          // commonest gives Sequencing and Sample acquisition on MSK-CHORD —
          // exactly one event per patient and no duration, i.e. filing records
          // that draw a spike and nothing else. A type that carries durations is
          // a state worth plotting; one that recurs is an event worth counting;
          // one that happens once per patient is neither.
          const tier = (e: any) => e.hasDurations ? 2 : (e.perPatient || 0) >= 1.5 ? 1 : 0;
          const ranked = [...evs].sort((a, b) => tier(b) - tier(a) || b.n - a.n);
          // The anchor wants the opposite property: a landmark nearly everyone
          // has. A therapy start is the classic one; failing that, the most
          // universal event.
          const anchorOn = evs.find(e => e.hasDurations)
            || [...evs].sort((a, b) => b.n - a.n)[0];
          return { kind, eventTypes: ranked.slice(0, 2).map(e => e.canonical),
                   ...(anchorOn ? { anchor: { eventType: anchorOn.label, occurrence: "FIRST" } } : {}),
                   binMonths: 3, fromMonths: -12, toMonths: 60 };
        })()
      : kind === "sequence" ? (() => {
          const tx = viewEvents().find(e => /treat|therap|regimen|drug|medicat/.test(e.canonical));
          return { kind, ...(tx ? { eventType: tx.canonical } : {}), labelKey: "SUBTYPE",
                   lineGap: 90, maxSteps: 3, topN: 8 };
        })()
      : kind === "cooccurrence" ? { kind, genes: genes.slice(0, 6) }
      : kind === "oncoprint" ? { kind, genes: genes.slice(0, 5) }
      : kind === "cox" ? { kind, covariates: [{ source: "alteration", gene: genes[0] || "TP53", by: "mutated" }] }
      : isMoreKind(kind) ? defaultMoreView(kind, { genes, attrs: catalogAttrs(), profiles: profileOptions(), assays: assayOptions(), events: viewEvents(), cohorts: Object.keys(doc.cohorts || {}) })
      : kind === "logistic" ? { kind,
          outcome: { source: "alteration", gene: genes[0] || "TP53", by: "mutated" }, outcomeEvent: "Mutated",
          covariates: [{ source: "clinical", attribute: viewAttrs()[0] || "SEX" }] }
      : { kind, genes };
    // only the new view is asked for: every other card's answer is already cached under its key
    docs.set({ ...doc, views: [v, ...(doc.views || [])] });
  };

  // clinical-attribute catalog: union of attribute names across the result's involved
  // studies (an attribute absent in one study just renders gaps there). Every kind that
  // offers a clinical-attribute picker shares this one fetch — the oncoprint's track menu,
  // a plot's axis pickers, the clinical view's attribute menu, Cox's covariate picker — and so
  // do the add-view buttons, which is why it runs for any result rather than waiting for one of
  // those views to exist.
  const trackAttrsWant = useRef("");
  useEffect(() => {
    if (!result) return;
    const studies = result.involvedStudies && result.involvedStudies.length ? result.involvedStudies : [result.study];
    // an upload adds attributes to the same studies, so the datasets are part of what was asked
    const key = studies.join(",") + "|" + customDataKey();
    if (trackAttrs.key === key || trackAttrsWant.current === key) return;
    trackAttrsWant.current = key;
    setTrackAttrsLoading(true);
    Promise.all(studies.map(s =>
      api.explore({ study: s })
        .then(r => r.json()).catch(() => null)))
      .then(js => {
        const seen = new Map<string, { kind: string; patients: number }>(); // attribute -> kind + how many carry it
        const profs = new Set<string>(); // continuous molecular profiles (for heatmap tracks)
        const gas = new Set<string>(); // generic-assay profiles (for the assays view)
        for (const j of js) if (j) {
          if (j.clinical) for (const a of j.clinical) {
            const prev = seen.get(a.attribute);
            seen.set(a.attribute, { kind: prev?.kind || a.kind, patients: (prev?.patients || 0) + (a.patients || 0) });
          }
          for (const p of j.profiles || []) if (p !== "cna") profs.add(p); // discrete cna isn't a heatmap
          for (const p of j.gaProfiles || []) gas.add(p);
        }
        // the reader's own uploads first, then most-covered first, the way the portal orders its picker
        if (trackAttrsWant.current !== key) return; // a newer study set was asked for meanwhile
        setTrackAttrs({ key, attrs: [...seen.entries()].map(([attribute, v]) => ({ attribute, ...v }))
          .sort((x, y) => Number(isCustomAttr(y.attribute)) - Number(isCustomAttr(x.attribute)) ||
            y.patients - x.patients || (x.attribute < y.attribute ? -1 : 1)), profiles: [...profs].sort(), gaProfiles: [...gas].sort() });
      })
      .finally(() => { if (trackAttrsWant.current === key) setTrackAttrsLoading(false); });
  }, [result, customState]); // eslint-disable-line

  // the survival "measured from" control needs this study's event types,
  // their attributes, and the endpoints it declares
  useEffect(() => {
    // a templated document holds "$study" until its parameter is resolved; asking the warehouse
    // for a study by that name is a question with no answer, so it is not asked
    if (!study || study.startsWith("$")) return;
    let dead = false;
    setCatLoading(true);
    fetch("/api/catalog?study=" + encodeURIComponent(study))
      .then(r => r.json()).then(j => { if (!dead && !j.error) setCat(j); }).catch(() => {})
      .finally(() => { if (!dead) setCatLoading(false); });
    return () => { dead = true; };
  }, [study]);

  /** Rewrite one view in the document; only its own query re-runs (use-analysis.ts) — editing this
   *  view's settings can't change any OTHER view's answer. */
  const patchView = (i: number, patch: Record<string, unknown>) => {
    // a new object at the same position keeps its view id (app/lab/doc-store.ts), so the card is not remounted
    const views = (doc.views || []).map((v: any, j: number) => j === i ? { ...v, ...patch } : v);
    for (const v of views as any[]) if (v.anchor == null) delete v.anchor;   // null means "study baseline"
    docs.set({ ...doc, views });
  };

  const updateView = (vi: number, patch: (v: any) => any) => {
    // the edited view keeps its id (app/lab/doc-store.ts): its card is not remounted, and the
    // re-run's answer finds its slot
    const views = (doc.views || []).map((v, i: number) => i === vi ? patch(v) : v);
    docs.set({ ...doc, views });
  };

  /**
   * A view change the browser can apply itself — how the oncoprint is drawn, not what it
   * draws. The document and the URL still record it, so the link, the server SVG, the CLI
   * and the Python package reproduce the same figure; only the round trip is skipped.
   */
  const updateViewLocal = (vi: number, patch: (v: any) => any) => {
    const views = (doc.views || []).map((v, i: number) => i === vi ? patch(v) : v);
    const d = { ...doc, views };
    docs.set(d);
  };

  /**
   * The gene list of a view, editable in place.
   *
   * Genes used to be settable only by hand-editing the document JSON: addView
   * seeded them from the most-altered genes in Explore (or a hardcoded fallback)
   * and nothing could change them afterwards. Five view kinds take genes, so
   * this is one control rendered in each one's settings panel rather than five
   * near-identical ones.
   */
  const GENE_VIEWS = ["compare", "oncoprint", "cooccurrence", "coexpression", "hotspots"];
  /** the most-altered genes this exploration found, for the suggestion list */
  const geneChoices = (): string[] => {
    const fromExplore = (explore?.mutatedGenes || []).map((g: any) => String(g.gene));
    const legacy = (explore?.genes || []).map((g: any) => String(g.gene));
    return [...new Set([...fromExplore, ...legacy])].slice(0, 60);
  };
  // ---- workspaces ----------------------------------------------------------
  const openWorkspaceSave = () => {
    if (!canSave()) return;
    setWsOpen(true);
  };
  const confirmWorkspaceSave = async (name: string) => {
    const d = { ...doc, title: name };
    docs.set(d);
    setWsError(null);
    try {
      await persistSpaces(name, d);
    } catch (e) { setWsError("could not save: " + String((e as Error)?.message || e)); }
  };
  const openWorkspace = (name: string) => {
    const w = spaces[name];
    if (!w) return;
    const d = w.doc;
    docs.replace(d);
    setError(null);
    if (d.study) setStudy(d.study);
    goTab("analysis");
  };
  const deleteWorkspace = async (name: string) => {
    setWsError(null);
    try { await removeSpace(name); }
    catch (e) { setWsError("could not delete: " + String((e as Error)?.message || e)); }
  };
  /** Lift the study and a shared gene list into parameters — see lib/params.ts. */
  const makeTemplate = () => {
    // parameterize returns the AUTHORED form, where a `genes` field may hold
    // "$genes". The editor state is typed as the resolved document because
    // every other reader wants that; this is the one place a reference enters,
    // so it is the one place that says so.
    const d = parameterize(doc) as AnalysisDoc;
    if (d === doc) { setError("nothing to lift: a template needs a study, or a gene list that every gene view shares"); return; }
    setError(null);
    docs.set(d);
  };
  /** Change one parameter and re-run — the whole point of a template. */
  const setParam = (key: string, value: unknown) => {
    const d = { ...doc, params: { ...(doc.params || {}), [key]: value } };
    docs.set(d);
  };
  const setNotes = (text: string) => {
    const d = { ...doc, notes: text };
    docs.set(d);   // no re-run: prose changes no numbers
  };

  const openGenes = (vi: number) => { setGenesFor(vi); genesDialog.current?.showModal(); };
  /**
   * Which cohorts a view draws. Absent means all of them, so ticking every cohort removes the
   * field rather than freezing today's list into the document.
   */
  const setViewCohorts = (vi: number, names: string[], all: string[]) => updateView(vi, (v: any) => {
    const next = { ...v };
    const picked = all.filter((n) => names.includes(n));
    const authored = Object.keys(doc.cohorts || {});
    if (!picked.length || (picked.length === authored.length && picked.every((n, k) => n === authored[k]))) delete next.cohorts;
    else next.cohorts = picked;
    // a document's splitBy targets the view's own single chosen cohort (it has no picker of its
    // own) — so narrowing to exactly one carries an existing splitBy along to it,
    // same attribute/gene/oql, rather than leaving it pointed at whatever it last targeted.
    if (next.splitBy && names.length === 1 && next.splitBy.cohort !== names[0])
      next.splitBy = { ...next.splitBy, cohort: names[0] };
    return next;
  });
  const setViewAttrs = (vi: number, attributes: string[]) => updateView(vi, (v: any) => ({ ...v, attributes }));

  const setViewGenes = (vi: number, genes: GeneTrackSpec[]) =>
    updateView(vi, v => pruneSort({ ...v, genes }));

  /** the document's view at vi, whatever its kind */
  const docView = (vi: number): any => ((doc.views || [])[vi] || {});

  /** what a view's cohort picker needs: today's choice, everything on offer, and where to write it */
  /** the document's splits as the engine sees them, from the last result */
  const partitionShapes = (): PartitionShape[] => Object.entries((result && result.splits) || {}).map(([name, p]) =>
    ({ name, of: p.of, comparable: p.children.filter((c) => c.role !== "notEvaluable").map((c) => c.name) }));
  const cohortChoice = (vi: number, v: any, max?: number) => {
    // On offer: each cohort, whole; under it each of its splits (drawn as its arms); under that
    // each arm, and any split of an arm, the same way. A view chooses any of them — a cohort and
    // its split can be drawn by different views, or side by side in one. With no list of its own
    // a view shows the authored cohorts, whole.
    const shapes = partitionShapes();
    const authored = Object.keys(doc.cohorts || {});
    const nodes: CohortNode[] = [];
    const countOf = (n: string) => result?.cohorts[n]?.count ?? null;
    const offer = (n: string, label: string, kind: CohortNode["kind"], depth: number) => {
      if (result && !result.cohorts[n]) return;
      nodes.push({ name: n, label, kind, depth, count: countOf(n) });
      for (const p of shapes.filter((x) => x.of === n)) {
        nodes.push({ name: p.name, label: p.name.slice(n.length + 3), kind: "split", depth: depth + 1, count: countOf(n), groups: p.comparable.length });
        for (const c of p.comparable) offer(c, c.slice(p.name.length + 3), "arm", depth + 2);
      }
    };
    for (const n of authored) offer(n, n, "cohort", 0);
    const all = nodes.map((x) => x.name);
    let chosen = (Array.isArray(v.cohorts) && v.cohorts.length ? v.cohorts : authored).filter((n: string) => all.includes(n));
    // a view that draws one cohort draws the first group its list stands for: show that, not the list
    if (max === 1 && chosen.length) chosen = [expandSplits(chosen, shapes)[0]].filter((n) => all.includes(n));
    // what the view draws, in the order it colours them (the engine expands the list the same way)
    const drawn = expandSplits(chosen, shapes).filter((n) => !result || result.cohorts[n]);
    return { chosen, all, nodes, drawn, max, busy, viewKey: viewIds[vi] ?? vi, onChange: (next: string[]) => setViewCohorts(vi, next, all) };
  };

  /** the view at index vi, read as an oncoprint view (its editor only renders there) */
  const ocView = (vi: number): OncoprintView => ((doc.views || [])[vi] || {}) as OncoprintView;

  /**
   * A drag across an oncoprint becomes a cohort of exactly those patients — an explicit list,
   * not a rule, so the document says plainly that it was picked by hand.
   *
   * Sample columns are resolved to their patients first: a cohort selects patients, so a
   * cohort named from a sample selection carries those patients (and therefore their other
   * samples too). Throwing is how the figure's dialog is told why it cannot be done.
   */
  const cohortFromSelection = async (sel: ColumnSelection, studies: string[]) => {
    const one = studies.length === 1 ? studies[0] : null;
    if (!one) throw new Error("a cohort is evaluated against one study; this figure pools " +
      studies.length + " (" + studies.join(", ") + "), and the columns are study-qualified — select within a single-study figure");
    let ids = sel.ids;
    if (sel.unit === "sample") {
      const res = await api.patientsOf({ study: one, samples: ids });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || res.statusText);
      ids = j.patients as string[];
      if (!ids.length) throw new Error("no patients found for those samples");
    }
    const taken = new Set(Object.keys(doc.cohorts || {}));
    let name = sel.name || "selection";
    for (let i = 2; taken.has(name); i++) name = (sel.name || "selection") + " " + i;
    const qualified = ids.map(id => one + ":" + id);
    const d: AnalysisDoc = { ...doc, cohorts: { ...doc.cohorts, [name]: { all: [{ kind: "patientList", ids: qualified }] } } };
    docs.set(d);
  };

  const removeCohort = (name: string) => {
    // its splits go with it (they are stored on it), and so does every view reference to their arms
    const base: AnalysisDoc = doc;
    const cs = { ...base.cohorts }; delete cs[name];
    // views naming the cohort explicitly drop it; a view with no cohorts left goes too
    const views = (base.views || [])
      .map(v => Array.isArray(v.cohorts) ? { ...v, cohorts: v.cohorts.filter(c => c !== name && !c.startsWith(name + " / ")) } : v)
      .filter(v => !Array.isArray(v.cohorts) || v.cohorts.length);
    const d = { ...base, cohorts: cs, views };
    docs.set(d);
  };

  // ---- partitions: a cohort split into arms that add up to it ------------------------------
  const runEdited = (d: AnalysisDoc) => { docs.set(d); };
  // the page edits splits in their flat form (keyed "<cohort> / <split>") and writes them back
  // onto their cohorts as a tree (editSplits)
  const splitsFlat = () => flattenSplits(doc.cohorts || {});
  const setPartitionDef = (name: string, def: PartitionDef) =>
    runEdited(editSplits(doc, (f) => ({ ...f, partitions: { ...f.partitions, [name]: def } })));
  const removePartitionNamed = (name: string) => runEdited(editSplits(doc, (f) => withoutPartition(f, name).doc));
  const renamePartitionRow = (name: string, from: string, to: string) => {
    try { runEdited(editSplits(doc, (f) => renamePartitionChild(f, name, from, to))); }
    catch (e) { setError(String((e as Error)?.message || e)); }
  };
  /** Split a cohort (or an arm) by what the server proposes from the data, and switch the views
   *  that were showing only it to the new split — an edit to their lists, which each view's
   *  cohorts menu can change back. */
  const splitCohortBy = async (cohort: string, spec: SplitSpec) => {
    const { name, def } = await proposePartition({ doc, cohort, ...spec });
    const key = splitKey(cohort, name);
    const withSplit = editSplits(doc, (f) => ({ ...f, partitions: { ...f.partitions, [key]: { ...def, split: name } } }));
    // only a view showing just this cohort switches: one showing other cohorts too would then mix
    // whole cohorts with a split's groups, which a view does not draw
    const authored = Object.keys(doc.cohorts || {});
    const views = (withSplit.views || []).map((v) => {
      const list = Array.isArray(v.cohorts) && v.cohorts.length ? v.cohorts : authored;
      return list.length === 1 && list[0] === cohort ? { ...v, cohorts: [key] } : v;
    });
    runEdited({ ...withSplit, views });
  };

  // ---- "+ Add cohort": Explore over the analysis, adding to it instead of replacing it ---------
  /** the studies the analysis already uses: its default study and every cohort's own */
  const analysisStudies = (): string[] => {
    const ids = new Set<string>();
    if (doc.study) ids.add(doc.study);
    for (const c of Object.values(doc.cohorts || {})) {
      if (c.study) ids.add(c.study);
      for (const st of c.studies || []) ids.add(st);
    }
    if (!ids.size && study) ids.add(study);
    return [...ids];
  };

  const openCohortEdit = (name: string) => {
    setCohortEditing(name);
  };

  /** Rename a cohort and/or change its note, from the gear menu's "edit…" dialog.
   *  Renaming rewrites every `view.cohorts` reference too, so a view already
   *  scoped to this cohort keeps drawing it under its new name — and since
   *  the server keys everything (result.cohorts, every row/curve) by name,
   *  a rename re-runs the analysis, unlike a note-only edit, which changes no
   *  number and so re-runs nothing (use-analysis.ts leaves notes out of its keys). */
  const confirmCohortEdit = (newName: string, notes: string) => {
    if (!cohortEditing) return;
    const oldName = cohortEditing;
    const nextCohorts: Record<string, CohortDef> = {};
    for (const [k, v] of Object.entries(doc.cohorts || {})) {
      nextCohorts[k === oldName ? newName : k] = k === oldName ? { ...v, notes } : v;
    }
    if (newName === oldName) {
      // a note-only edit re-runs nothing, so nothing else would put it in the shareable link
      const d = { ...doc, cohorts: nextCohorts };
      docs.set(d);
      return;
    }
    // its splits travel with it; their arms are named after it, so views naming them follow too
    const views = renameInViews(doc.views, oldName, newName) as AnalysisDoc["views"];
    const d = { ...doc, cohorts: nextCohorts, views };
    docs.set(d);
  };

  /** the analysis exists as a saved workspace — what a view's note, like a cohort's, belongs to */
  const analysisSaved = !!(doc.title && spaces[doc.title]);
  /** a view's note belongs to a saved analysis, so its menu item exists only once there is one */
  const noteEdit = (vi: number) => analysisSaved ? () => openViewNoteEdit(vi) : undefined;
  const openViewNoteEdit = (vi: number) => {
    if (!analysisSaved) return;
    setViewNoteEditing(vi);
  };

  /** A view's note is exactly like a cohort's or the workspace's: prose the
   *  server never computes anything from, so this never re-runs — it patches
   *  `doc.views[vi].note` (what gets saved/shared) AND mirrors the same text
   *  straight into `result.views[vi].annotationNote` (what ViewHead actually
   *  reads to display it), since nothing else would otherwise tell the
   *  already-rendered card that its own annotation changed. */
  const confirmViewNoteEdit = (trimmed: string) => {
    if (viewNoteEditing == null) return;
    const vi = viewNoteEditing;
    const views = (doc.views || []).map((v: any, i: number) => {
      if (i !== vi) return v;
      const nv = { ...v };
      if (trimmed) nv.note = trimmed; else delete nv.note;
      return nv;
    });
    // the note is read from the document (use-analysis.ts): nothing re-runs
    docs.set({ ...doc, views });
  };

  const clearAnalysis = () => {
    const d = { ...EMPTY_DOC, study };
    docs.set(d); setError(null);
  };

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
  const exploreState = useExploreState({ analysisStudies, canSave, doc, docs, evalDef, featureSaved, goTab, persist, proposePartition, runEdited, setError, setStudy, setToast, study, tab });
  const { addChartDialog, addClause, addClauses, addDraftToAnalysis, addMode, analyzeDraft, barDef, clearDraft, closeAddCohort, exMsg, exSel, exStudies, explore, exploreBusy, fetchExplore, geneCharts, openAddCohort, openCustomManager, parseDraft, removeDraftClause, setChartTab, setExStudies, setExploreStudies } = exploreState;
  /** what Explore's sections read and the edits they can make (app/lab/explore-sections.tsx) */
  const exploreCtx: ExploreCtx = { ...exploreState, moreDerivedMenu, showClauseData, studies };
  /** what every view card reads and the edits it can make (app/lab/view-cards.tsx) */
  const viewCtx = { VIEW_KINDS, assayOptions, attrsLoading, busy, cat, catLoading, catalogAttrs, cohortChoice, cohortFromSelection, contracts, doc, docView, drawsOwnHead, explore, featureFromSelection, menuOpenRef, moveView, noteEdit, ocView, openGenes, patchView, pendingKeys, profileOptions, removeView, setContracts, setViewAttrs, setViewCohorts, trackAttrs, trackAttrsLoading, updateView, updateViewLocal, viewEvents, viewIds };
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
        <a href="/datasets" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>data sets</a>
        <a href="/reproductions" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>paper reproductions</a>
        <a href="/campaign" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>hypothesis campaigns</a>
        <a href="/rationale" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>rationale</a>
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
        <dialog ref={genesDialog} className="genedialog"
          onClose={() => setGenesFor(null)}
          onClick={e => { if (e.target === genesDialog.current) genesDialog.current?.close(); }}>
          {genesFor != null && (
            <>
              <h3>Genes <span className="plain">— {String(((doc.views || [])[genesFor] as any)?.kind || "view")}</span></h3>
              {/* the DOCUMENT's view, never the result (a result's genes are {gene, driverPct, …}) */}
              <GeneListEditor view={(doc.views || [])[genesFor] || {}} busy={busy} onGenes={(g) => setViewGenes(genesFor, g)} />
              <div className="row" style={{ marginTop: "0.8rem", justifyContent: "flex-end" }}>
                <button className="primary" onClick={() => genesDialog.current?.close()}>Done</button>
              </div>
            </>
          )}
        </dialog>
        <div className="tabs">
          <button className={tab === "explore" ? "active" : ""} onClick={() => { goTab("explore"); if (!explore) fetchExplore(); }}>Explore</button>
          <button className={tab === "cohorts" ? "active" : ""} onClick={() => goTab("cohorts")}>Saved</button>
          <button className={tab === "analysis" ? "active" : ""} onClick={() => goTab("analysis")}>Analysis</button>
          <button className={tab === "examples" ? "active" : ""} onClick={() => goTab("examples")}>Examples</button>
        </div>
        {error && <div className="error">{error}</div>}
        {tab === "analysis" && (() => {
          // a shared document can name server custom data that is locked here, deleted, or absent
          const unresolved = unresolvedUploads(doc);
          const of = (why: string) => unresolved.filter((u) => u.why === why).map((u) => u.as);
          const manage = <button className="linklike" onClick={openCustomManager}>Explore → Custom data</button>;
          const names = (ids: string[]) => ids.map((id, i) => <span key={id}>{i ? ", " : ""}<code>custom:{id}</code></span>);
          return unresolved.length > 0 && (
            <div className="card customwarn">
              {of("locked").length > 0 && <p style={{ margin: 0 }}>This analysis uses custom data ({names(of("locked"))}).{" "}
                <button className="linklike" onClick={requestLogin}>Log in</button> to run it.</p>}
              {of("deleted").length > 0 && <p style={{ margin: 0 }}>This analysis is pinned to custom data that has since been deleted: {names(of("deleted"))}.</p>}
              {of("missing").length > 0 && <p style={{ margin: 0 }}>This analysis uses custom data that is not on the server: {names(of("missing"))}.</p>}
              {of("unavailable").length > 0 && <p style={{ margin: 0 }}>This analysis uses custom data ({names(of("unavailable"))}), which this deployment does not store.</p>}
            </div>
          );
        })()}

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
          {exStudies.length === 0 && <div className="card"><p className="note" style={{ fontSize: "var(--t-md)", margin: 0 }}>
            Choose one or more studies above to explore.</p></div>}
          {/* first load: placeholders shaped like the facet grid, so it does not jump when it lands */}
          {!explore && exStudies.length > 0 && <div className="facetgrid" aria-label="building study facets…">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton skeleton-facet" />)}
          </div>}
          {/* Clinical/gene-status/derived-timeline filter builders used to sit here as
              three permanent cards, pushing the facet grid below the fold before you'd
              touched any of them. One button, one modal with a tab per kind instead. */}
          {explore && (
            <div className="row" style={{ marginBottom: "1rem" }}>
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
          <div>
            {/* Cohorts, bare: each is its own labelled, bordered box, with no
                enclosing card — they ARE the leftbar, not a section within it.
                Each box's gear menu (CohortEditMenu) covers a note and
                removing the cohort. It deliberately does NOT cover the
                cohort's own filters yet: those are pills built from Explore's
                facets or hand-typed JSON, and editing them in place would mean
                either Explore or the JSON editor opening ON TOP of an
                analysis already in progress (a modal, most likely) — a bigger
                piece of work than this pass, and not yet scoped. */}
            {(busy || result) && (
              <h2 className="vtitle" style={{ marginBottom: "0.9rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                Cohorts{busy && <span className="spinner" />}
                <button className="tbbtn addcohortbtn" disabled={busy} onClick={openAddCohort}
                  title="build another cohort in Explore and add it to this analysis">+ Add cohort</button>
              </h2>
            )}
            {upgradeNote && (
              <p className="note upgradenote">
                This analysis was written {upgradeNote.from === "unversioned" ? "before analyses carried a version" : "for DSL " + upgradeNote.from} and has been upgraded to {upgradeNote.to}
                {upgradeNote.changes.length ? ": " + upgradeNote.changes.join("; ") : ""}. Saving it, or sharing its link, uses the new version.{" "}
                <button className="linklike" onClick={() => setUpgradeNote(null)}>dismiss</button>
              </p>
            )}
            <div className="cohortlist">
              {busy && !result
                ? Array.from({ length: Math.max(1, Object.keys(doc.cohorts || {}).length) }).map((_, i) => (
                    <div key={i} className="skeleton skeleton-cohort" />
                  ))
                : result && Object.entries(result.cohorts).filter(([n]) => doc.cohorts?.[n]).map(([n, c], i) => {
                  // a cohort's splits are drawn attached to it, so which cohort a split divides is
                  // seen, not read; splits of a split's arms are nested inside that split's panel
                  const flat = splitsFlat();
                  const splits = Object.keys(flat).filter((k) => flat[k].of === n);
                  return (
                  <div key={n} className={"cohortgroup" + (splits.length ? " hassplit" : "")}>
                    <div className="cohortbox">
                      <CohortEditMenu busy={busy} canEdit={!!(doc.title && spaces[doc.title])}
                        onEdit={() => openCohortEdit(n)} onRemove={() => removeCohort(n)}
                        split={(done: () => void) => <SplitForm cohort={n} attrs={catalogAttrs()} busy={busy} onSplit={splitCohortBy} onDone={done} />}
                        splitCount={splits.length}
                        menuId={"cohort:" + n} menuStore={menuOpenRef.current} />
                      <div className="cohortbox-head">
                        <span className="cohortbox-name"><span className="cohortswatch" aria-hidden="true" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />{n}</span>
                        <strong>{c.count.toLocaleString()}</strong> <span className="meta">patients</span>
                      </div>
                      <CohortStudies ids={c.studies && c.studies.length ? c.studies : [doc.cohorts?.[n]?.study || doc.study || result.study].filter(Boolean) as string[]}
                        names={studyNames} />
                      {doc.cohorts && doc.cohorts[n] && <CohortPills def={doc.cohorts[n]} onCustomData={showClauseData(n)} />}
                      {/* A note only shows here — passively, read-only — once the
                          cohort is actually saved as a reusable artifact AND
                          someone bothered to write one; an ad-hoc cohort that
                          might be gone in a minute doesn't need an invitation to
                          write prose about it. Writing or changing the note
                          itself always happens through the gear menu above. */}
                      {saved[n] && doc.cohorts?.[n]?.notes && (
                        <p className="note">{doc.cohorts[n].notes}</p>
                      )}
                    </div>
                    {splits.length > 0 && <div className="cohortgroup-splits">
                      {splits.map((k) => (
                        <PartitionPanel key={k} name={k} partitions={flat} results={result.splits}
                          cohortText={(x) => result.cohorts[x]?.text} attrs={catalogAttrs()} busy={busy}
                          onChange={setPartitionDef} onRename={renamePartitionRow} onRemove={removePartitionNamed} onSplit={splitCohortBy} />
                      ))}
                    </div>}
                  </div>
                  );
                })}
            </div>
          </div>
          {/* The document's JSON, generated SQL and run/clear controls: a dialog
              rather than a permanent column, so the leftbar can just be cohorts. */}
          <dialog ref={docDialog} className="docdialog"
            onClick={e => { if (e.target === docDialog.current) docDialog.current?.close(); }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
              <h3 style={{ margin: 0 }}>The document <span className="plain">— views</span></h3>
              <button className="linklike" onClick={() => docDialog.current?.close()}>close</button>
            </div>
            {/* id, because the notes textarea above it also matches "textarea" —
                anything reading the document from outside React needs to be
                able to say WHICH one. */}
            <textarea id="docjson" value={docText} onChange={e => docs.setText(e.target.value)} spellCheck={false}
              style={{ width: "100%", height: "20rem", font: "0.72rem 'IBM Plex Mono',monospace", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "0.6rem" }} />
            <div className="row" style={{ marginTop: "0.6rem" }}>
              <button className="primary" disabled={busy} onClick={applyText}>{busy && <span className="spinner onprimary" />}{busy ? "Running…" : "Run document"}</button>
              {doc.cohorts && Object.keys(doc.cohorts).length > 0 &&
                <button disabled={busy} title="empty the document — removes all cohorts and views" onClick={clearAnalysis}>Clear analysis</button>}
              {result && <span className="meta">{result.stats.ms}ms · OncoKB {result.oncokbPin}</span>}
            </div>
            <p className="note">Views: <code>{`{"kind":"compare","genes":[…]}`}</code> · <code>{`{"kind":"survival"}`}</code> · <code>{`{"kind":"oncoprint","genes":[…],"clinical":[attrs…]}`}</code></p>
            {result && (
              <details style={{ marginTop: "0.5rem" }}>
                <summary className="meta" style={{ cursor: "pointer" }}>
                  Generated SQL (provenance) — the exact query each cohort compiled to, per study · OncoKB pin {result.oncokbPin || "none"}
                </summary>
                {Object.entries(result.cohorts).map(([n, c]) => (
                  <div key={n} style={{ marginTop: "0.5rem" }}>
                    <p className="meta" style={{ margin: "0 0 0.25rem" }}><strong>{n}</strong> — {c.count.toLocaleString()} patients{c.studies && c.studies.length > 1 ? " across " + c.studies.length + " studies" : ""}</p>
                    <pre style={{ maxHeight: "16rem", overflow: "auto", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "0.6rem", fontSize: "var(--t-xs)", whiteSpace: "pre" }}>{c.sql}</pre>
                  </div>
                ))}
              </details>
            )}
          </dialog>
          <div>
            {(busy || result) && (
              <div className="row" style={{ alignItems: "baseline", marginBottom: "0.9rem", gap: "0.6rem" }}>
                <h2 className="vtitle">
                  Analysis{busy && <span className="spinner" style={{ marginLeft: "0.5rem" }} />}
                </h2>
                <div className="vmeta">
                  {/* The workspace lives behind this one button + a dialog, not
                      a permanent card at the top of the column — it is read
                      when setting the workspace up and almost never while
                      reading the figures. What it's called and whether it's
                      saved is what the dialog it opens is for; this button's
                      own label stays fixed. */}
                  {((doc.views || []).length > 0 || doc.title || doc.params || doc.notes) && (
                    <button disabled={busy} onClick={openWorkspaceSave}
                      style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
                      title={doc.title
                        ? "“" + doc.title + "” — " + (spaces[doc.title] && JSON.stringify(spaces[doc.title].doc) === JSON.stringify(doc)
                            ? "saved " + spaces[doc.title].savedAt : "unsaved changes")
                        : "save this analysis as a named, reopenable workspace"}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                        <path d="M17 21v-8H7v8" />
                        <path d="M7 3v5h8" />
                      </svg>
                      Save analysis
                    </button>
                  )}
                  {(() => {
                    const used = referencedDatasets(doc);
                    return used.length > 0 && (
                      <button className="linklike" onClick={() => setCdFocus({ datasets: used })}
                        title="the uploads this analysis names, as stored in this browser">
                        custom data ({used.length})
                      </button>
                    );
                  })()}
                  <button className="linklike" onClick={() => docDialog.current?.showModal()}
                    title="open the document's raw JSON — edit it, run it, or view generated SQL">
                    show document json
                  </button>
                </div>
              </div>
            )}
            {busy && !result && <div className="skeleton skeleton-addview" />}
            {busy && !result && Array.from({ length: Math.max(1, (doc.views || []).length) }).map((_, i) => (
              <div key={i} className="skeleton skeleton-view" />
            ))}
            {!busy && !result && (
              <div className="card">
                <p className="note" style={{ fontSize: "var(--t-md)", margin: 0, display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                  <button className="primary" onClick={openAddCohort}>+ Add cohort</button>
                  <span>to start an analysis here, or make one on the <button className="linklike" onClick={() => { goTab("explore"); if (!explore) fetchExplore(); }}>Explore page</button>
                  {" "}or choose cohorts on the <button className="linklike" onClick={() => goTab("cohorts")}>Cohorts page</button>.</span>
                </p>
              </div>
            )}
            {result && !result.views.length && (
              <div className="card">
                <h2>Cohorts evaluated — no views defined</h2>
                <p className="note" style={{ fontSize: "var(--t-md)" }}>
                  Add a views array to the document (e.g. <code>{`{"kind":"survival"}`}</code>),{" "}
                  <button className="linklike" onClick={() => { const d = { ...doc, views: DEFAULT_VIEWS }; docs.set(d); }}>add the default views</button>, or ask your AI assistant in the browser sidebar.
                </p>
              </div>
            )}
            {!(busy && !result) && Object.keys(doc.cohorts || {}).length > 0 && (
              <div className="card addview">
                <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
                  <strong className="addview-title">Add a view</strong>
                  <span className="meta">{(doc.views || []).length} of 6 in this document</span>
                  <span className="spacer" />
                  {VIEW_KINDS.map(({ kind, label, why, loading }) => {
                    // a kind already in the document is selected; clicking it again removes it
                    const present = (doc.views || []).filter((v: any) => v.kind === kind).length;
                    if (present) return (
                      <button key={kind} className="facet on" disabled={busy}
                        title={"remove the " + label.toLowerCase() + " view" + (present > 1 ? "s (" + present + ")" : "")}
                        onClick={() => removeViews((v) => v.kind === kind)}>{label}{present > 1 && " ×" + present} <span aria-hidden="true">✕</span></button>
                    );
                    const full = (doc.views || []).length >= 6;
                    const waiting = !full && !!loading && loading();
                    const blocked = full ? "this document already has the maximum of 6 views"
                      : waiting ? "loading this study's catalog — a moment"
                      : (why ? why() : null);
                    return (
                      <button key={kind} className="facet" disabled={!!blocked}
                        title={blocked || ("add a " + label.toLowerCase() + " view and run it")}
                        onClick={() => addView(kind)}>+ {label}{waiting && <span className="spinner" />}</button>
                    );
                  })}
                </div>
              </div>
            )}
            {result && result.views.map((v, vi) => (
              <ViewCard key={viewIds[vi] ?? vi} ctx={{ ...viewCtx, result }} v={v} vi={vi} />
            ))}
          </div>
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

