"use client";
import { useEffect, useRef, useState } from "react";
import CohortPills, { normalizeDef } from "./pills";
import { heatmapTrackLabel } from "../../lib/profile-names.ts";
import type { AnalysisDoc, AnalysisResult, CohortDef, View, OncoprintView, ExploreResult, KmCurve } from "../../lib/types.ts";
import { EXAMPLES as DOC_EXAMPLES, type DslExample } from "../../lib/dsl-reference.ts";
import type { ViewParticipation } from "../../lib/types.ts";

const CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];
/** beyond this many distinct values a pie is unreadable — the portal shows a table */
const PIE_MAX_SLICES = 8;

/** p-values: exponent notation once fixed notation would round to zero, and an
 *  honest floor when the true value underflows double precision. Returns the
 *  whole "p=..." / "p<..." label so the relation stays attached to the number. */
const fmtP = (p: number): string =>
  p === 0 ? "p < 1e-300" : p < 1e-4 ? "p=" + p.toExponential(1) : "p=" + p.toFixed(4);
/**
 * Says, on every visualization, whether patient-level data was involved in
 * producing it. "aggregate-only" means no participant returned an identifier —
 * the chart was built from counts computed inside each owning database.
 */
function Participation({ p }: { p?: ViewParticipation }) {
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

/** the same value for a table cell, where the column header already says "p" */
const pCell = (p: number): string =>
  p === 0 ? "< 1e-300" : p < 1e-4 ? p.toExponential(1) : p.toFixed(4);
/** true when two p-values land on opposite sides of the conventional threshold */
const crossesThreshold = (a: number, b: number): boolean => (a < 0.05) !== (b < 0.05);
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

function KMChart({ curves }: { curves: KmCurve[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = 260;
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + "px";
    const ctx = c.getContext("2d"); if (!ctx) return; ctx.scale(dpr, dpr);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const grid = dark ? "#2a353c" : "#dde4e8", muted = dark ? "#93a3ad" : "#5b6b76";
    const L = 44, R = 10, T = 10, B = 28;
    const tMax = Math.max(12, ...curves.flatMap((cv) => cv.points.map((p) => p.t)));
    const x = (t: number) => L + (W - L - R) * t / tMax, y = (s: number) => T + (H - T - B) * (1 - s);
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.font = "10px 'IBM Plex Sans',sans-serif";
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.beginPath(); ctx.moveTo(L, y(s)); ctx.lineTo(W - R, y(s)); ctx.stroke();
      ctx.fillText(Math.round(s * 100) + "%", 8, y(s) + 3);
    }
    const step = tMax > 60 ? 24 : 12;
    for (let t = 0; t <= tMax; t += step) ctx.fillText(t + "mo", x(t) - 8, H - 10);
    curves.forEach((cv, i: number) => {
      ctx.strokeStyle = CAT_COLORS[i % CAT_COLORS.length]; ctx.lineWidth = 2; ctx.beginPath();
      let py = y(1); ctx.moveTo(x(0), py);
      for (const p of cv.points) { const nx = x(p.t), ny = y(p.s); ctx.lineTo(nx, py); ctx.lineTo(nx, ny); py = ny; }
      ctx.lineTo(x(tMax), py); ctx.stroke();
    });
  }, [curves]);
  return <canvas ref={ref} style={{ width: "100%", display: "block" }} />;
}

/** Explore opens on these: one deeply-annotated MSK study and one large
 *  consortium cohort on the peer instance, so federation is visible up front. */
const DEFAULT_EXPLORE_STUDIES = ["msk_chord_2024", "genie_public"];

const EMPTY_DOC: AnalysisDoc = { cohorts: {}, views: [] };
const DEFAULT_VIEWS: View[] = [
  { kind: "compare", genes: ["TP53", "KRAS", "STK11", "KEAP1", "EGFR", "ARID1A", "MSH3"] },
  { kind: "survival" },
  { kind: "oncoprint", genes: ["TP53", "KRAS", "STK11", "KEAP1", "EGFR"] }
];

export default function AnalysisPage() {
  const [tab, setTab] = useState<"explore" | "cohorts" | "analysis" | "examples">("cohorts");
  const [exTag, setExTag] = useState<string>("all");     // Examples tab filter
  const [copied, setCopied] = useState<string | null>(null);
  const [exMsg, setExMsg] = useState<string | null>(null);   // Explore action-bar feedback
  const tabRef = useRef<string>("cohorts");                  // the tab syncUrl should record
  const [picked, setPicked] = useState<string[]>([]);        // Cohorts tab: keys "ex:<name>" / "saved:<name>"
  const [doc, setDoc] = useState<AnalysisDoc>(EMPTY_DOC);
  const [docText, setDocText] = useState(JSON.stringify(EMPTY_DOC, null, 2));
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<{ role: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatReady, setChatReady] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<Record<string, { def: CohortDef; savedAt: string; lastEval?: { count: number; text: string } | null }>>({});
  const [cName, setCName] = useState("");
  const [cDefText, setCDefText] = useState(JSON.stringify({ studies: [...DEFAULT_EXPLORE_STUDIES], all: [] }, null, 2));
  const [cPreview, setCPreview] = useState<{ error?: string; count?: number; text?: string } | null>(null);
  const [cBusy, setCBusy] = useState(false);
  const [exEvals, setExEvals] = useState<Record<string, { count?: number; error?: string; busy?: boolean } | null>>({});
  const [studies, setStudies] = useState<{ id: string; name: string; cancerType?: string; patients: number; samples: number; timelinePatients: number; caps?: Record<string, boolean>; oncokb?: boolean; instance?: string; instanceLabel?: string }[]>([]);
  const [study, setStudy] = useState("msk_chord_2024");
  const [explore, setExplore] = useState<ExploreResult | null>(null);
  const [exploreBusy, setExploreBusy] = useState(false);
  const [trackAttrs, setTrackAttrs] = useState<{ key: string; attrs: { attribute: string; kind: string }[]; profiles: string[] }>({ key: "", attrs: [], profiles: [] }); // track picker options
  const [sQuery, setSQuery] = useState("");                             // study-panel search
  const [sCaps, setSCaps] = useState<Set<string>>(() => new Set());                  // study-panel capability filters
  const [exStudies, setExStudies] = useState<string[]>([...DEFAULT_EXPLORE_STUDIES]); // studies being explored (checkboxes)
  const [exPanelOpen, setExPanelOpen] = useState(false);                // study panel expanded?
  const exSel = useRef<string[]>([...DEFAULT_EXPLORE_STUDIES]);                   // current selection (ref: immune to state races)
  const exFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);                                    // debounce for multi-toggle refetch
  const exFetchSeq = useRef(0);                                         // stale-response guard for explore fetches
  const [qaAttr, setQaAttr] = useState("");                             // creator quick-add: attribute
  const [qaVal, setQaVal] = useState("");                               // creator quick-add: numeric threshold
  const [qaGene, setQaGene] = useState("");                             // creator quick-add: gene
  const [geneSearch, setGeneSearch] = useState("");                     // server-side gene filter for the three tables
  const [geneRowLimit, setGeneRowLimit] = useState(12);                 // rows shown per gene table
  const [attrLimit, setAttrLimit] = useState(20);                       // clinical attributes shown
  const valueLimit = 10;                                                // values per ranked-list facet

  const LS_KEY = "cohortlab.savedCohorts";
  const persist = (next: typeof saved) => { setSaved(next); try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {} };

  const run = async (d: AnalysisDoc = doc) => {
    if (!Object.keys(d.cohorts || {}).length) { setResult(null); return; }
    setBusy(true); setError(null);
    try {
      const payload = { study: d.study || study, ...d };
      const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setResult(j);
      syncUrl(undefined, d);
    } catch (e) { setError(String((e as Error)?.message || e)); }
    setBusy(false);
  };

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem(LS_KEY) || "{}")); } catch {}
    fetch("/api/chat").then(r => setChatReady(r.status !== 501)).catch(() => setChatReady(false));
    fetch("/api/studies").then(r => r.json()).then(j => {
      const list = j.studies || [];
      setStudies(list);
      // The default selection names studies that a given deployment may not hold
      // (a peer instance need not be configured). Keep only what is reachable,
      // and fall back to the largest available study rather than an empty state.
      const have = new Set(list.map((s: { id: string }) => s.id));
      const keep = exSel.current.filter((id) => have.has(id));
      const next = keep.length ? keep : (list.length ? [list[0].id] : []);
      if (list.length && next.join(",") !== exSel.current.join(",")) setExploreStudies(next);
    }).catch(() => {});
    try {
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get("tab");
      const b64 = params.get("doc");
      if (wanted && (TABS as readonly string[]).includes(wanted)) {
        tabRef.current = wanted;
        setTab(wanted as typeof TABS[number]);
        if (wanted === "explore") fetchExplore();
      }
      if (b64) {
        const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0))));
        if (d.study) { setStudy(d.study); setExStudies([d.study]); exSel.current = [d.study]; }
        setDoc(d); setDocText(JSON.stringify(d, null, 2));
        // an explicit ?tab= wins; otherwise a shared document means the analysis
        if (!wanted) goTab("analysis");
        run(d);
      }
    } catch (e) { setError("bad ?doc= link: " + String((e as Error)?.message || e)); }
  }, []); // eslint-disable-line

  /**
   * Keep the URL describing where you are, so a refresh (or a shared link)
   * lands on the same tab. `doc` and `tab` are written together — writing one
   * with a bare "?tab=…" would drop the other.
   */
  const TABS = ["explore", "cohorts", "analysis", "examples"] as const;
  // run() writes the URL too, and during the mount effect its closure still
  // holds the initial tab — so the current tab is read from a ref, never from
  // the render closure, or a shared ?doc= link would record the wrong tab.
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
    try { const d = JSON.parse(docText); setDoc(d); run(d); }
    catch (e) { setError("document JSON: " + String((e as Error)?.message || e)); }
  };

  // ---- cohort creator / library -----------------------------------------
  const evalDef = async (name: string, def: CohortDef) => {
    const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study, cohorts: { [name || "preview"]: def }, views: [] }) });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    const c = Object.values(j.cohorts)[0] as { count: number; text: string };
    return { count: c.count, text: c.text };
  };

  const previewCohort = async () => {
    setCBusy(true); setCPreview(null);
    try {
      const def = JSON.parse(cDefText);
      const ev = await evalDef(cName, def);
      setCPreview(ev);
      return { def, ev };
    } catch (e) { setCPreview({ error: String((e as Error)?.message || e) }); return null; }
    finally { setCBusy(false); }
  };

  const saveCohort = async () => {
    const name = cName.trim();
    if (!name) { setCPreview({ error: "give the cohort a name" }); return; }
    const r = await previewCohort();
    if (!r) return;
    persist({ ...saved, [name]: { def: r.def, savedAt: new Date().toISOString().slice(0, 16).replace("T", " "), lastEval: r.ev } });
  };

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
   * Build a multi-cohort comparison by ticking cohorts in the Cohorts tab and
   * hitting "Analyze selected".
   */
  const analyzeDraft = () => {
    const d = barDef();
    if (!d) { setExMsg("select at least one study first"); return; }
    setExMsg(null);
    const name = cName.trim() || barDefaultName();
    const nextStudy = exSel.current[0] || study;
    const nd: AnalysisDoc = { study: nextStudy, cohorts: { [name]: d }, views: DEFAULT_VIEWS };
    setStudy(nextStudy);
    setDoc(nd); setDocText(JSON.stringify(nd, null, 2));
    setResult(null); setError(null);     // never leave the previous run's numbers on screen
    goTab("analysis");
    run(nd);
  };
  const saveDraftAsCohort = async () => {
    const d = barDef();
    if (!d) { setExMsg("select at least one study first"); return; }
    if (!cName.trim()) { setExMsg("give the cohort a name first"); return; }
    setExMsg(null);
    await saveCohort();
    setExMsg("saved \u201c" + cName.trim() + "\u201d to Cohorts");
    setTimeout(() => setExMsg(null), 2600);
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
    if (explore && explore.clinical) return explore.clinical.slice(0, 4).map((c: any) => c.attribute);
    return [];
  };
  /** a continuous profile for co-expression / heatmaps, if this study has one */
  const contProfile = (): string | null => {
    const ps = (explore && explore.profiles) || [];
    return ps.find((p: string) => /zscore/i.test(p)) || ps.find((p: string) => /mrna|rna_seq/i.test(p)) || null;
  };

  const VIEW_KINDS: { kind: string; label: string; why?: () => string | null }[] = [
    { kind: "compare", label: "Compare genes" },
    { kind: "survival", label: "Survival" },
    { kind: "oncoprint", label: "Oncoprint" },
    { kind: "hotspots", label: "Lollipop (hotspots)" },
    { kind: "cooccurrence", label: "Co-occurrence" },
    { kind: "clinical", label: "Clinical comparison",
      why: () => viewAttrs().length ? null : "no clinical attributes known yet — open Explore once so the app can read this study's attributes" },
    { kind: "coexpression", label: "Co-expression",
      why: () => contProfile() ? null : "this study has no continuous molecular profile (mRNA z-scores) to correlate" }
  ];

  /** Drop one view from the document and re-run what is left. */
  const removeView = (i: number) => {
    const views = (doc.views || []).filter((_: any, j: number) => j !== i);
    const d = { ...doc, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    if (views.length) run(d);
    else { setResult(null); syncUrl(undefined, d); }   // nothing left to run
  };

  const addView = (kind: string) => {
    const genes = viewGenes();
    const v: any =
      kind === "survival" ? { kind }
      : kind === "clinical" ? { kind, attributes: viewAttrs() }
      : kind === "coexpression" ? { kind, genes: genes.slice(0, 5), profileType: contProfile() }
      : kind === "hotspots" ? { kind, genes: genes.slice(0, 4), minCount: 1 }
      : kind === "cooccurrence" ? { kind, genes: genes.slice(0, 6) }
      : kind === "oncoprint" ? { kind, genes: genes.slice(0, 5) }
      : { kind, genes };
    const d = { ...doc, views: [...(doc.views || []), v] };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    run(d);
  };

  const parseDraft = () => { try { const d = JSON.parse(cDefText); return d.all && d.all.length ? d : null; } catch { return null; } };

  const fetchExplore = async (draftOverride?: CohortDef | null, studiesOverride?: string[] | string) => {
    const seq = ++exFetchSeq.current; // a later call (or an emptied selection) supersedes this one
    setExploreBusy(true);
    try {
      const list = studiesOverride ? (Array.isArray(studiesOverride) ? studiesOverride : [studiesOverride]) : exSel.current;
      if (!list.length) { setExplore(null); setExploreBusy(false); return; }
      const res = await fetch("/api/explore", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studies: list, draft: draftOverride !== undefined ? draftOverride : parseDraft(), geneSearch: geneSearch || undefined }) });
      const j = await res.json();
      if (seq !== exFetchSeq.current) return; // superseded while in flight — discard
      if (!j.error) setExplore(j); else setError(j.error);
    } catch (e) { if (seq === exFetchSeq.current) setError(String((e as Error)?.message || e)); }
    if (seq === exFetchSeq.current) setExploreBusy(false);
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
    if (clause.kind === "oql") {
      const same = d.all.find((c: any) => c.kind === "oql");
      if (same) { same.q += "; " + clause.q; const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d); return; }
    }
    d.all.push(clause);
    const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d);
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
    if (!ids.length) { exFetchSeq.current++; setExplore(null); setExploreBusy(false); setExPanelOpen(true); return; } // empty selection: clear facets (and void in-flight fetches), keep the picker open
    exFetchTimer.current = setTimeout(() => fetchExplore(d.all!.length ? d : null, ids), 350);
  };

  // clinical-track options for oncoprint views: union of attribute names across the
  // result's involved studies (an attribute absent in one study just renders gaps there)
  useEffect(() => {
    if (!result || !result.views.some(v => v.kind === "oncoprint" && v.svg)) return;
    const studies = result.involvedStudies && result.involvedStudies.length ? result.involvedStudies : [result.study];
    const key = studies.join(",");
    if (trackAttrs.key === key) return;
    Promise.all(studies.map(s =>
      fetch("/api/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ study: s }) })
        .then(r => r.json()).catch(() => null)))
      .then(js => {
        const seen = new Map<string, string>(); // attribute -> kind
        const profs = new Set<string>(); // continuous molecular profiles (for heatmap tracks)
        for (const j of js) if (j) {
          if (j.clinical) for (const a of j.clinical) if (!seen.has(a.attribute)) seen.set(a.attribute, a.kind);
          for (const p of j.profiles || []) if (p !== "cna") profs.add(p); // discrete cna isn't a heatmap
        }
        setTrackAttrs({ key, attrs: [...seen.entries()].map(([attribute, kind]) => ({ attribute, kind })).sort((x, y) => x.attribute < y.attribute ? -1 : 1),
          profiles: [...profs].sort() });
      });
  }, [result]); // eslint-disable-line

  // the creator's quick-add row needs the study catalog even before Explore is visited
  useEffect(() => {
    if (tab === "cohorts" && !explore && !exploreBusy && exStudies.length) fetchExplore(null);
  }, [tab, study, explore]); // eslint-disable-line

  const updateView = (vi: number, patch: (v: any) => any) => {
    const views = (doc.views || []).map((v, i: number) => i === vi ? patch(v) : v);
    const d = { ...doc, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); run(d);
  };

  /** the view at index vi, read as an oncoprint view (its editor only renders there) */
  const ocView = (vi: number): OncoprintView => ((doc.views || [])[vi] || {}) as OncoprintView;

  const heatmapLabels = (v: any): string[] => (v.heatmap || []).flatMap((h: any) =>
    (h.genes && h.genes.length ? h.genes : v.genes || []).map((g: any) => heatmapTrackLabel(String(g).toUpperCase(), h.profileType)));

  const pruneSort = (v: any) => {
    // drop sort keys whose track no longer exists
    const keep = new Set(["genomic", "Study", ...(v.clinical || []), ...heatmapLabels(v)]);
    const sort = (v.sort || []).filter((s: any) => keep.has(String(s).replace(/^-/, "")));
    if (sort.length) v.sort = sort; else delete v.sort;
    return v;
  };

  const setViewClinical = (vi: number, attrs: string[]) => updateView(vi, v => pruneSort({ ...v, clinical: attrs }));

  const setViewHeatmap = (vi: number, entries: any[]) => updateView(vi, v => {
    const next = { ...v };
    if (entries.length) next.heatmap = entries; else delete next.heatmap;
    return pruneSort(next);
  });

  const setViewSort = (vi: number, key: string) => updateView(vi, v => {
    if (key === "genomic") { const { sort, ...rest } = v; return rest; }
    return { ...v, sort: [key] };
  });

  const removeCohort = (name: string) => {
    const cs = { ...doc.cohorts }; delete cs[name];
    // views naming the cohort explicitly drop it; a view with no cohorts left goes too
    const views = (doc.views || [])
      .map(v => Array.isArray(v.cohorts) ? { ...v, cohorts: v.cohorts.filter(c => c !== name) } : v)
      .filter(v => !Array.isArray(v.cohorts) || v.cohorts.length);
    const d = { ...doc, cohorts: cs, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    if (Object.keys(cs).length) run(d); else setResult(null);
  };

  const clearAnalysis = () => {
    const d = { ...EMPTY_DOC, study };
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); setResult(null); setError(null);
    syncUrl(undefined, d);   // the shared link should describe the empty document too
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
    const nd: AnalysisDoc = { study, cohorts: Object.fromEntries(chosen.slice(0, 6)), views: DEFAULT_VIEWS };
    setDoc(nd); setDocText(JSON.stringify(nd, null, 2));
    setResult(null); setError(null);
    goTab("analysis");
    run(nd);
  };
  const togglePick = (key: string) =>
    setPicked((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key]);

  /** Load a documented example into the Analysis tab and run it. */
  const runDocExample = (ex: DslExample) => {
    const d = JSON.parse(JSON.stringify(ex.doc)) as AnalysisDoc;   // never hand the shared object to the editor
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    setStudy(d.study || study);
    setResult(null); setError(null);
    goTab("analysis");
    run(d);
  };

  const docLink = (d: AnalysisDoc): string =>
    location.origin + location.pathname + "?doc=" +
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const copyDocLink = async (ex: DslExample) => {
    try { await navigator.clipboard.writeText(docLink(ex.doc)); setCopied(ex.title); setTimeout(() => setCopied(null), 1800); }
    catch { setError("could not copy to clipboard"); }
  };

  const previewExample = async (ex: any) => {
    setExEvals(s => ({ ...s, [ex.name]: { busy: true } }));
    try { const ev = await evalDef(ex.name, ex.def); setExEvals(s => ({ ...s, [ex.name]: ev })); }
    catch (e) { setExEvals(s => ({ ...s, [ex.name]: { error: String((e as Error)?.message || e) } })); }
  };

  const saveExample = async (ex: any) => {
    let ev: { count?: number; error?: string; busy?: boolean } | null = exEvals[ex.name] && exEvals[ex.name]!.count != null ? exEvals[ex.name] : null;
    if (!ev) { try { ev = await evalDef(ex.name, ex.def); setExEvals(s => ({ ...s, [ex.name]: ev })); } catch { ev = null; } }
    persist({ ...saved, [ex.name]: { def: ex.def, savedAt: new Date().toISOString().slice(0, 16).replace("T", " "), lastEval: ev } });
  };

  // ---- chat ---------------------------------------------------------------
  const summarize = (r: any) => {
    if (!r) return "no results yet (document may be empty)";
    const parts = Object.entries(r.cohorts as Record<string, { count: number; text: string }>).map(([n, c]) => `${n}: ${c.count} patients (${c.text})`);
    for (const v of r.views) {
      if (v.kind === "compare" && v.rows) parts.push("compare top: " + v.rows.slice(0, 4).map((x: any) => `${x.gene} ${x.cells[0].anyPct}% vs ${x.cells[1] ? x.cells[1].anyPct : "-"}% p=${x.pAny ? x.pAny.toExponential(1) : "-"}`).join("; "));
      if (v.kind === "survival") parts.push("survival medians: " + v.curves.map((c: any) => `${c.cohort}=${c.median ? c.median.toFixed(1) : ">obs"}mo (n=${c.n})`).join("; "));
    }
    return parts.join(" | ");
  };

  const sendChat = async () => {
    const msg = chatInput.trim(); if (!msg || chatBusy) return;
    setChatInput(""); setChatBusy(true);
    const msgs = [...chat, { role: "user", text: msg }];
    setChat(msgs);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })), doc: { study, ...doc }, resultSummary: summarize(result) }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setChat([...msgs, { role: "assistant", text: j.reply }]);
      if (j.doc) {
        setDoc(j.doc); setDocText(JSON.stringify(j.doc, null, 2)); goTab("analysis"); run(j.doc);
      }
    } catch (e) { setChat([...msgs, { role: "assistant", text: "⚠ " + String((e as Error)?.message || e) }]); }
    setChatBusy(false);
  };

  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">analysis documents — cohorts, views, and chat over one declarative object</span>
        <span className="spacer" />
        <a href="/oncoprint" style={{ color: "var(--accent-ink)", fontSize: "0.8rem", marginRight: "0.8rem" }}>oncoprint</a>
        <a href="/" style={{ color: "var(--accent-ink)", fontSize: "0.8rem" }}>builder</a>
      </header>
      <main style={{ maxWidth: "96rem" }}>
        {/* ---- Chat: always at the top ---- */}
        <div className="card">
          <h2>Chat <span className="plain">— define cohorts, add views, ask about results; it edits the document below</span></h2>
          {chatReady === false && <p className="note">Chat needs <code>ANTHROPIC_API_KEY</code> (with API credits) in the server environment. Everything else works without it.</p>}
          {(chat.length > 0 || chatBusy) && (
            <div style={{ maxHeight: "14rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.6rem" }}>
              {chat.map((m, i) => (
                <div key={i} style={{ fontSize: "0.82rem", background: m.role === "user" ? "var(--accent-soft)" : "var(--code-bg)", borderRadius: 8, padding: "0.45rem 0.65rem", whiteSpace: "pre-wrap" }}>{m.text}</div>
              ))}
              {chatBusy && <div className="loading-block" style={{ padding: "0.2rem 0" }}><span className="spinner" /> thinking…</div>}
            </div>
          )}
          <div className="row">
            <input style={{ flex: 1 }} placeholder="e.g. compare STK11-driver vs wild-type immunotherapy patients — survival and an oncoprint" value={chatInput}
              onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} disabled={chatReady === false} />
            <button className="primary" onClick={sendChat} disabled={chatBusy || chatReady === false}>Send</button>
          </div>
        </div>

        <div className="tabs">
          <button className={tab === "explore" ? "active" : ""} onClick={() => { goTab("explore"); if (!explore) fetchExplore(); }}>Explore</button>
          <button className={tab === "cohorts" ? "active" : ""} onClick={() => goTab("cohorts")}>Cohorts</button>
          <button className={tab === "analysis" ? "active" : ""} onClick={() => goTab("analysis")}>Analysis</button>
          <button className={tab === "examples" ? "active" : ""} onClick={() => goTab("examples")}>Examples</button>
        </div>
        {error && <div className="error">{error}</div>}

        {/* ================= Explore tab ================= */}
        {tab === "explore" && <div>
          {(() => {
            // Acting on the draft is the point of this page, so the actions live at
            // the top and stay there while you scroll the facets that build it.
            const d = parseDraft();
            const clauses = d && Array.isArray(d.all) ? d.all.length : 0;
            const ready = exStudies.length > 0;      // a study alone is enough to analyse
            return (
              <div className="card exbar">
                <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                  <strong style={{ fontSize: "0.82rem" }}>
                    {!ready ? "No studies selected"
                      : clauses ? clauses + (clauses === 1 ? " filter" : " filters")
                      : "No filters"}
                  </strong>
                  <span className="meta">
                    {!ready ? "— pick a study below"
                      : clauses
                        ? (explore && explore.draftCount != null
                            ? "· " + explore.draftCount.toLocaleString() + " patients match"
                            : "· counting…")
                        : "· every patient in " + (exStudies.length === 1 ? exStudies[0] : exStudies.length + " selected studies") +
                          (explore?.totals ? " (" + explore.totals.patients.toLocaleString() + ")" : "")}
                  </span>
                  {exploreBusy && <span className="spinner" />}
                  <span className="spacer" />
                  <button className="primary" onClick={analyzeDraft} disabled={!ready}
                    title={ready ? "start a fresh analysis of this cohort (replaces the current document)" : "select a study first"}>
                    Analyze
                  </button>
                  <span className="meta">or</span>
                  {/* the name belongs to Save — Analyze needs no name, and pairing the
                      field with the button that consumes it says so without a label */}
                  <span className="savegroup">
                    <button onClick={saveDraftAsCohort} disabled={!ready}
                      title={ready ? "keep this definition in the Cohorts tab without running anything" : "select a study first"}>
                      Save as a Cohort
                    </button>
                    <input placeholder="name…" value={cName} style={{ width: "10rem" }} disabled={!ready}
                      onChange={e => setCName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && ready) saveDraftAsCohort(); }} />
                  </span>
                  {clauses > 0 && <button className="linklike" onClick={clearDraft}>clear</button>}
                </div>
                {exMsg && <p className="note" style={{ margin: "0.35rem 0 0" }}>{exMsg}</p>}
              </div>
            );
          })()}
          {(() => {
            const CAP_FILTERS: [string, string, (s: any) => boolean][] = [
              ["timeline", "timeline events", (s: any) => s.timelinePatients > 0],
              ["mrna", "mRNA", (s: any) => s.caps && s.caps.mrna],
              ["protein", "protein", (s: any) => s.caps && s.caps.protein],
              ["ga", "generic assay", (s: any) => s.caps && s.caps.ga],
              ["oncokb", "OncoKB-synced", (s: any) => s.oncokb],
              ["peer", "other instance", (s: any) => s.instance && s.instance !== "a"]
            ];
            const byId = new Map(studies.map((s) => [s.id, s] as const));
            const selPts = exStudies.reduce((n: number, id: string) => n + (byId.get(id)?.patients ?? 0), 0);
            const toggle = (id: any) => {
              const cur = exSel.current;
              setExploreStudies(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
            };
            const q = sQuery.trim().toLowerCase();
            const hits = studies.filter(s =>
              (!q || (s.name + " " + s.id + " " + (s.cancerType || "")).toLowerCase().includes(q)) &&
              CAP_FILTERS.every(([k, , pred]) => !sCaps.has(k) || pred(s)));
            return (
              <div className="card">
                <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                  <h2 style={{ margin: 0 }}>Exploring <span className="plain">— {exStudies.length === 0 ? "no studies selected" :
                    exStudies.length + (exStudies.length === 1 ? " study" : " studies") + " · " +
                    (explore?.totals
                      ? explore.totals.patients.toLocaleString() + " patients · " + explore.totals.samples.toLocaleString() + " samples"
                      : selPts.toLocaleString() + " patients") +
                    (exStudies.length > 1 ? " (overlap not deduplicated)" : "")}</span></h2>
                  {exStudies.map(id => (
                    <span key={id} className="qchip" title={byId.get(id)?.name ?? id}>
                      {id}
                      <button className="linklike" style={{ marginLeft: "0.3rem" }} onClick={() => toggle(id)}>×</button>
                    </span>
                  ))}
                  <span className="spacer" />
                  <button onClick={() => setExPanelOpen(!exPanelOpen)}>{exPanelOpen ? "done" : "add / change studies"}</button>
                </div>
                {exPanelOpen && <>
                  <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center", margin: "0.6rem 0" }}>
                    <input placeholder="search name, id, or cancer type…" value={sQuery} onChange={e => setSQuery(e.target.value)}
                      style={{ flex: 1, minWidth: "16rem" }} />
                    {CAP_FILTERS.map(([k, label]) => (
                      <button key={k} className={"facet" + (sCaps.has(k) ? " on" : "")}
                        onClick={() => setSCaps(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; })}>
                        {label}
                      </button>
                    ))}
                    <span className="meta">{hits.length.toLocaleString()} of {studies.length.toLocaleString()}</span>
                  </div>
                  {!studies.length && <div className="loading-block"><span className="spinner" /> Loading studies…</div>}
                  <div style={{ maxHeight: "22rem", overflowY: "auto" }}>
                    {hits.slice(0, 200).map(s => (
                      <label key={s.id} title={s.name} className={"study-row" + (exStudies.includes(s.id) ? " sel" : "")}>
                        <input type="checkbox" checked={exStudies.includes(s.id)} onChange={() => toggle(s.id)} />
                        <strong>{s.name}</strong>
                        <span className="meta mono">{s.id}</span>
                        <span className="meta">{s.cancerType}</span>
                        {s.instance && s.instance !== "a" &&
                          <span className="meta" style={{ color: "var(--accent-ink)" }} title={"held by " + s.instanceLabel}>⧉ {s.instanceLabel}</span>}
                        <span className="meta pts">{s.patients.toLocaleString()}</span>
                        <span className="meta caps">{[
                          s.timelinePatients > 0 ? "timeline" : null,
                          s.caps && s.caps.mrna ? "mRNA" : null,
                          s.caps && s.caps.protein ? "protein" : null,
                          s.oncokb ? "OncoKB ✓" : null
                        ].filter(Boolean).join(" · ")}</span>
                      </label>
                    ))}
                    {hits.length > 200 && <p className="note">Showing the 200 largest of {hits.length.toLocaleString()} matches — refine the search.</p>}
                  </div>
                </>}
              </div>
            );
          })()}
          <div className="card">
            <h2>Draft cohort <span className="plain">— click anything below to add a clause; counts narrow to your draft</span></h2>
            <div className="row" style={{ alignItems: "center" }}>
              {(() => { const d = parseDraft(); return d
                ? <CohortPills def={d} onRemoveClause={removeDraftClause} />
                : <span className="meta">no clauses yet — the numbers below describe the whole study</span>; })()}
              {explore && explore.draftCount != null && <strong style={{ marginLeft: "0.5rem" }}>{explore.draftCount.toLocaleString()} patients</strong>}
              {exploreBusy && <span className="spinner" />}
            </div>
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <span className="meta">Analyze / Save as cohort are at the top of the page.</span>
              <span className="spacer" />
              <input placeholder="find a gene…" value={geneSearch} style={{ width: "9rem", fontSize: "0.78rem" }}
                onChange={e => setGeneSearch(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === "Enter") fetchExplore(); }} />
              <button className="facet" onClick={() => fetchExplore()} title="filter the gene tables (searches all genes, not just those shown)">search</button>
              {geneSearch && <button className="linklike" onClick={() => { setGeneSearch(""); setTimeout(() => fetchExplore(), 0); }}>clear</button>}
            </div>
          </div>
          {exStudies.length === 0 && <div className="card"><p className="note" style={{ fontSize: "0.85rem", margin: 0 }}>
            No studies selected — check one or more above to explore.</p></div>}
          {!explore && exStudies.length > 0 && <div className="card"><div className="loading-block"><span className="spinner" /> Building study facets…</div></div>}
          {explore && <div className="two-col" style={{ alignItems: "start" }}>
            <div>
              <div className="card">
                {(() => {
                  const shown = Math.min(explore.clinical.length, attrLimit);
                  return (
                    <div className="row" style={{ alignItems: "baseline" }}>
                      <h2 style={{ margin: 0 }}>Clinical <span className="plain">— counted in each attribute's own unit, as the portal does</span></h2>
                      <span className="spacer" />
                      <span className="meta">{shown < explore.clinical.length
                        ? "showing " + shown + " of " + explore.clinical.length + " attributes"
                        : explore.clinical.length + " attributes"}</span>
                    </div>
                  );
                })()}
                {explore.clinical.slice(0, attrLimit).map(c => (
                  <div key={c.per + c.attribute} style={{ borderTop: "1px solid var(--line)", padding: "0.45rem 0" }}>
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
                        <div style={{ fontSize: "0.78rem", fontWeight: 600 }}
                          title={[c.displayName && c.displayName !== c.attribute ? c.attribute : "", c.description]
                            .filter(Boolean).join(" — ") || undefined}>
                          {c.displayName || c.attribute}{" "}
                          <span className="meta">
                            {(c.per === "sample" ? "· sample-level · " : "· ") + shown.toLocaleString() + unit}
                            {disj ? " · not narrowed by its own filter" : ""}
                          </span>
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
                      // slice geometry: cumulative angles over the returned values
                      const asList = (c.distinct ?? c.values.length) > PIE_MAX_SLICES;
                      let acc = 0;
                      const R = 34, CX = 36, CY = 36;
                      const arcs = c.values.map((v: any, i: number) => {
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
                        return (
                          <div className="vallist">
                            {c.values.slice(0, valueLimit).map((v: any, i: number) => (
                              <button key={i} className={isSel(v) ? "valrow on" : "valrow"} onClick={() => addClause(clause(v))}
                                title={v.v + " — " + v.n.toLocaleString() + " (click to filter)"}>
                                <span className="vname">{v.v}</span>
                                <span className="vbar"><i style={{ width: Math.max(1, Math.round(100 * v.n / max)) + "%" }} /></span>
                                <span className="vn">{v.n.toLocaleString()}</span>
                              </button>
                            ))}
                            {(c.distinct ?? 0) > Math.min(c.values.length, valueLimit) && (
                              <span className="meta" style={{ padding: "0.1rem 0.3rem" }}>
                                showing {Math.min(c.values.length, valueLimit)} of {c.distinct!.toLocaleString()} values
                              </span>
                            )}
                          </div>
                        );
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
                      const label = (b: any) => b.special === "<=" ? "≤" + b.end : b.special === ">" ? ">" + b.start : b.start + "–" + b.end;
                      return (
                        <div className="histo" style={{ marginTop: "0.3rem" }}>
                          {c.bins.map((b: any, i: number) => (
                            <button key={i} className="hbar" title={label(b) + " · " + b.count.toLocaleString() + " " + (c.per === "sample" ? "samples" : "patients") + " — click to filter"}
                              onClick={() => addClause(clauseFor(b))}>
                              <span className="hfill" style={{ height: Math.max(2, Math.round(100 * b.count / maxN)) + "%" }} />
                              <span className="hlab">{b.special === "<=" ? "≤" + b.end : b.special === ">" ? ">" + b.start : b.start}</span>
                            </button>
                          ))}
                          {!!c.naCount && <span className="meta" style={{ alignSelf: "end", paddingLeft: "0.3rem" }}>NA {c.naCount.toLocaleString()}</span>}
                        </div>
                      );
                    })()}
                    {c.kind === "num" && <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", marginTop: "0.25rem", flexWrap: "wrap" }}>
                      <span className="meta">min {Math.round(c.min * 10) / 10} · median {Math.round(c.median * 10) / 10} · max {Math.round(c.max * 10) / 10}</span>
                      <button className="facet" onClick={() => addClause({ kind: "clinical", attribute: c.attribute, range: { gte: Math.round(c.median * 10) / 10 }, ...(c.per === "sample" ? { per: "sample" } : {}) })}>≥ median</button>
                      <button className="facet" onClick={() => addClause({ kind: "clinical", attribute: c.attribute, range: { lt: Math.round(c.median * 10) / 10 }, ...(c.per === "sample" ? { per: "sample" } : {}) })}>&lt; median</button>
                    </div>}
                  </div>
                ))}
              </div>
            </div>
              {explore.clinical.length > attrLimit && (
                <button className="linklike" onClick={() => setAttrLimit(attrLimit + 20)}>
                  show {Math.min(20, explore.clinical.length - attrLimit)} more attributes
                </button>
              )}
            <div>
              {explore.studyBreakdown && explore.studyBreakdown.length > 0 && (
                <div className="card">
                  <h2>Studies <span className="plain">— how {explore.draftCount != null ? "the draft" : "the selection"} breaks down{exStudies.length > 1 ? " across the " + exStudies.length + " selected studies" : ""}</span></h2>
                  {(() => {
                    const rows = explore.studyBreakdown!;
                    const total = rows.reduce((n, r) => n + r.n, 0) || 1;
                    return rows.map((r) => (
                      <div key={r.study} className="sbrow" title={r.instanceLabel}>
                        <span className="mono">{r.study}</span>
                        <span className="meta inst">{r.instance !== "a" ? "⧉ " + r.instanceLabel : ""}</span>
                        <span className="bar"><i style={{ width: Math.max(1, Math.round(100 * r.n / total)) + "%" }} /></span>
                        <span className="meta pct">{Math.round(1000 * r.n / total) / 10}%</span>
                        <span className="n">{r.n.toLocaleString()}</span>
                        <span>{exStudies.length > 1 && (
                          <button className="linklike" title="explore only this study"
                            onClick={() => setExploreStudies([r.study])}>only</button>
                        )}</span>
                      </div>
                    ));
                  })()}
                  {exStudies.length > 1 && <p className="note" style={{ marginTop: "0.4rem" }}>
                    Patients are counted per study; a person enrolled in two studies counts in both (overlap is not deduplicated).
                  </p>}
                </div>
              )}
              {explore.dataTypes && explore.dataTypes.length > 0 && (
                <div className="card">
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
                          <span className="gbar"><i style={{ width: Math.max(1, Math.round(100 * dt.n / max)) + "%" }} /></span>
                          <span className="gcount">{dt.n.toLocaleString()}</span>
                        </>
                      );
                      return t ? (
                        <button key={dt.profile} className={"generow dtrow" + (selected(t) ? " on" : "")}
                          title={"click to require " + t + " data (profiled clause)"}
                          onClick={() => addClause({ kind: "profiled", type: t })}>{row}</button>
                      ) : (
                        <div key={dt.profile} className="generow dtrow static"
                          title="no membership filter for this data type in the DSL — shown for completeness">{row}</div>
                      );
                    });
                  })()}
                </div>
              )}
              {(["mutated", "cna", "sv"] as const).map((kind) => {
                const meta = {
                  mutated: { title: "Mutated Genes", rows: explore.mutatedGenes, total: explore.geneTotals?.mutated, oql: (g: any) => g.gene + ": MUT" },
                  cna:     { title: "CNA Genes",     rows: explore.cnaGenes,     total: explore.geneTotals?.cna,     oql: (g: any) => g.gene + (g.cna === 2 ? ": AMP" : ": HOMDEL") },
                  sv:      { title: "SV Genes",      rows: explore.svGenes,      total: explore.geneTotals?.sv,      oql: (g: any) => g.gene + ": FUSION" }
                }[kind];
                const rows = meta.rows || [];
                if (!rows.length && !geneSearch) return null;
                return (
                  <div className="card" key={kind}>
                    <div className="row" style={{ alignItems: "baseline", gap: "0.5rem" }}>
                      <h2 style={{ margin: 0 }}>{meta.title} <span className="plain">— samples, panel-aware frequency</span></h2>
                      <span className="spacer" />
                      <span className="meta">{"showing " + Math.min(rows.length, geneRowLimit).toLocaleString() +
                        " of " + (meta.total || rows.length).toLocaleString() +
                        (geneSearch ? " matching “" + geneSearch + "”" : "")}</span>
                    </div>
                    <div className="generows">
                      {rows.slice(0, geneRowLimit).map((g) => (
                        <button key={g.gene + (g.cna ?? "")} className="generow" title={"click to add " + meta.oql(g)}
                          onClick={() => addClause({ kind: "oql", q: meta.oql(g) })}>
                          <span className="gname">{g.gene}</span>
                          <span className={g.cna != null ? "cnatag " + (g.cna === 2 ? "amp" : "del") : "cnatag none"}>{g.cna != null ? (g.cna === 2 ? "AMP" : "HOMDEL") : ""}</span>
                          <span className="gfreq">{g.freqPct != null ? g.freqPct + "%" : "—"}</span>
                          <span className="gcount">{g.altered.toLocaleString()}<span className="meta">/{g.profiled.toLocaleString()}</span></span>
                        </button>
                      ))}
                    </div>
                    {rows.length > geneRowLimit && (
                      <button className="linklike" onClick={() => setGeneRowLimit(geneRowLimit + 50)}>show more</button>
                    )}
                  </div>
                );
              })}
              <div className="card" style={{ display: "none" }}>
                <h2>Genes <span className="plain">— most-altered (click = OQL clause)</span></h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                  {explore.genes.map(g => (
                    <button key={g.gene} className="facet" onClick={() => addClause({ kind: "oql", q: g.gene + ":" })}>
                      {g.gene} <span className="meta">{g.n.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
                <p className="note">Bare gene = any alteration; edit the OQL pill afterwards for MUT/AMP/DRIVER specifics.</p>
              </div>
              <div className="card">
                <h2>Timeline events</h2>
                {explore.events.length === 0 && <p className="note">This study has no clinical timeline events.</p>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                  {explore.events.map(e => (
                    <button key={e.type} className="facet" onClick={() => addClause({ kind: "event", a: { eventType: e.type }, rel: { type: "NONE" } })}>
                      has {e.type} <span className="meta">{e.n.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="card">
                <h2>Case lists</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                  {explore.caseLists.map(l => (
                    <button key={l.id} className="facet" title={l.name} onClick={() => addClause({ kind: "caseList", id: l.id })}>
                      {l.id} <span className="meta">{l.n.toLocaleString()}</span>
                    </button>
                  ))}
                </div>
                <p className="note">Profiles here: {(explore.profiles || []).join(", ") || "none"}{explore.gaProfiles && explore.gaProfiles.length ? " · assays: " + explore.gaProfiles.join(", ") : ""} · facet counts {explore.draftCount != null ? "narrowed to your draft" : "study-wide"} · {explore.stats.ms}ms</p>
              </div>
            </div>
          </div>}
        </div>}

        {/* ================= Cohorts tab ================= */}
        {tab === "cohorts" && <div className="grid2">
          <div className="card">
            <h2>Create a cohort</h2>
            <label>Name</label>
            <input style={{ width: "100%" }} value={cName} onChange={e => setCName(e.target.value)} placeholder="e.g. KRAS-driver never-smokers" />
            <label>Definition</label>
            <textarea value={cDefText} onChange={e => setCDefText(e.target.value)} spellCheck={false}
              style={{ width: "100%", height: "16rem", font: "0.72rem 'IBM Plex Mono',monospace", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "0.6rem" }} />
            {explore && (
              <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.4rem" }}>
                <span className="meta">quick add:</span>
                <select value={qaAttr} onChange={e => { setQaAttr(e.target.value); setQaVal(""); }} style={{ fontSize: "0.78rem", maxWidth: "14rem" }}>
                  <option value="">attribute…</option>
                  {explore.clinical.map(a => <option key={a.per + a.attribute} value={a.per + "|" + a.attribute}>{a.attribute}{a.kind === "num" ? " (numeric)" : ""}{a.per === "sample" ? " ·sample" : ""}</option>)}
                </select>
                {(() => {
                  const a = explore.clinical.find(x => qaAttr === x.per + "|" + x.attribute);
                  if (!a) return null;
                  const perExtra = a.per === "sample" ? { per: "sample" } : {};
                  if (a.kind === "num") return (
                    <>
                      <span className="meta">min {a.min} · median {a.median} · max {a.max} —</span>
                      <input placeholder="≥" value={qaVal} onChange={e => setQaVal(e.target.value)} style={{ width: "4.5rem", fontSize: "0.78rem" }} />
                      <button className="facet" disabled={!Number.isFinite(Number(qaVal)) || qaVal === ""}
                        onClick={() => { addClause({ kind: "clinical", attribute: a.attribute, range: { gte: Number(qaVal) }, ...perExtra }); setQaVal(""); }}>add ≥</button>
                      <button className="facet" disabled={!Number.isFinite(Number(qaVal)) || qaVal === ""}
                        onClick={() => { addClause({ kind: "clinical", attribute: a.attribute, range: { lt: Number(qaVal) }, ...perExtra }); setQaVal(""); }}>add &lt;</button>
                    </>
                  );
                  return (
                    <select value="" onChange={e => { if (e.target.value !== "") addClause({ kind: "clinical", attribute: a.attribute, op: "=", value: e.target.value, ...perExtra }); }}
                      style={{ fontSize: "0.78rem", maxWidth: "14rem" }}>
                      <option value="">value… (patients)</option>
                      {a.values.map(v => <option key={v.v} value={v.v}>{v.v} ({v.n.toLocaleString()})</option>)}
                    </select>
                  );
                })()}
                <input list="qa-genes" placeholder="gene → OQL" value={qaGene} onChange={e => setQaGene(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && qaGene.trim()) { addClause({ kind: "oql", q: qaGene.trim().toUpperCase() + ":" }); setQaGene(""); } }}
                  style={{ width: "9rem", fontSize: "0.78rem" }} />
                <datalist id="qa-genes">
                  {explore.genes.map(g => <option key={g.gene} value={g.gene}>{g.n.toLocaleString()} altered</option>)}
                </datalist>
                <button className="facet" disabled={!qaGene.trim()}
                  onClick={() => { addClause({ kind: "oql", q: qaGene.trim().toUpperCase() + ":" }); setQaGene(""); }}>add gene</button>
              </div>
            )}
            {(() => { let d = null; try { d = JSON.parse(cDefText); } catch {} return d ? (
              <div style={{ margin: "0.55rem 0" }}>
                <CohortPills def={d} onRemoveClause={(i: any) => {
                  const nd = normalizeDef(JSON.parse(cDefText));
                  nd.all = nd.all.filter((_: any, j: any) => j !== i);
                  setCDefText(JSON.stringify(nd, null, 2)); setCPreview(null);
                }} />
              </div>) : <p className="note">⚠ definition JSON doesn’t parse yet</p>; })()}
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <button className="primary" disabled={cBusy} onClick={previewCohort}>{cBusy && <span className="spinner onprimary" />}Preview</button>
              <button className="primary" disabled={cBusy} onClick={saveCohort}>Save</button>
            </div>
            {cPreview && (cPreview.error
              ? <div className="error">{cPreview.error}</div>
              : <p className="qdesc" style={{ marginTop: "0.6rem" }}><strong>{cPreview.count?.toLocaleString()}</strong> patients — {cPreview.text}</p>)}
            <p className="note">Clause kinds: <code>oql</code> (genomic status, portal OQL syntax), <code>clinical</code> (attribute/op/value), <code>event</code> (timeline), <code>patients</code>; composed with <code>all</code> / <code>any</code> / <code>not</code>. Start from an example on the right, or ask chat above.</p>
          </div>
          <div className="card">
            <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.2rem" }}>
              <h2 style={{ margin: 0 }}>Cohorts <span className="plain">— tick any, then analyse them together</span></h2>
              <span className="spacer" />
              <span className="meta">
                {picked.length === 0 ? "none selected"
                  : picked.length + " selected" + (picked.length > 6 ? " — only the first 6 are analysed" : "")}
              </span>
              <button className="primary" disabled={!picked.length} onClick={analyzePicked}
                title={picked.length ? "analyse the ticked cohorts together (replaces the current document)" : "tick at least one cohort"}>
                Analyze selected
              </button>
              {picked.length > 0 && <button className="linklike" onClick={() => setPicked([])}>clear</button>}
            </div>
            <h2 style={{ marginTop: "0.6rem" }}>Examples</h2>
            {EXAMPLES.map(ex => {
              const ev = exEvals[ex.name];
              return (
                <div key={ex.name} style={{ borderTop: "1px solid var(--line)", padding: "0.5rem 0" }}>
                  <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
                    <label className="pick">
                      <input type="checkbox" checked={picked.includes("ex:" + ex.name)} onChange={() => togglePick("ex:" + ex.name)} />
                      <strong>{ex.name}</strong>
                    </label>
                    <span className="meta">{ex.desc}</span>
                    {ev && ev.count != null && <span className="meta"><strong>{ev.count.toLocaleString()}</strong> pts</span>}
                    {ev && ev.busy && <span className="spinner" />}
                    <span className="spacer" />
                    <button className="linklike" onClick={() => previewExample(ex)}>preview</button>
                    <button className="linklike" onClick={() => { setCName(ex.name); setCDefText(JSON.stringify(ex.def, null, 2)); setCPreview(null); }}>open in editor</button>
                    <button className="linklike" onClick={() => saveExample(ex)}>save</button>
                  </div>
                  {ev && ev.error && <div className="error">{ev.error}</div>}
                </div>
              );
            })}
            <h2 style={{ marginTop: "1.2rem" }}>Saved cohorts <span className="plain">— this browser (localStorage)</span></h2>
            {Object.keys(saved).length === 0 && <p className="note">Nothing saved yet — save an example above, create one on the left, or ask chat.</p>}
            {Object.entries(saved).map(([n, s2]) => (
              <div key={n} style={{ borderTop: "1px solid var(--line)", padding: "0.55rem 0" }}>
                <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <label className="pick">
                    <input type="checkbox" checked={picked.includes("saved:" + n)} onChange={() => togglePick("saved:" + n)} />
                    <strong>{n}</strong>
                  </label>
                  {s2.lastEval && <span className="meta">{s2.lastEval.count.toLocaleString()} pts</span>}
                  <span className="meta">saved {s2.savedAt}</span>
                  <span className="spacer" />
                  <button className="linklike" onClick={() => { setCName(n); setCDefText(JSON.stringify(s2.def, null, 2)); setCPreview(s2.lastEval || null); }}>edit</button>
                  <button className="linklike" onClick={() => { const nx = { ...saved }; delete nx[n]; persist(nx); }}>delete</button>
                </div>
                <div style={{ marginTop: "0.25rem" }}><CohortPills def={s2.def} /></div>
              </div>
            ))}
          </div>
        </div>}

        {/* ================= Examples tab ================= */}
        {tab === "examples" && (() => {
          const tags = [...new Set(DOC_EXAMPLES.flatMap(e => e.tags || []))].sort();
          const shown = exTag === "all" ? DOC_EXAMPLES : DOC_EXAMPLES.filter(e => (e.tags || []).includes(exTag));
          const viewKinds = (ex: DslExample): string[] => [...new Set((ex.doc.views || []).map(v => String(v.kind)))];
          return (
            <div>
              <div className="card">
                <h2>Examples <span className="plain">— every one of these is executed by the test gate</span></h2>
                <p className="note" style={{ marginTop: "0.2rem" }}>
                  These are the same analysis documents that <code>docs/dsl.md</code> is generated from, and{" "}
                  <code>npm run docs:check</code> runs each of them against the live compiler on every build — so an
                  example that stopped working would fail the suite rather than sit here broken. Running one loads it
                  into the Analysis tab, where you can edit the JSON and re-run.
                </p>
                <div className="extags">
                  <button className={exTag === "all" ? "extag on" : "extag"} onClick={() => setExTag("all")}>
                    all <span className="meta">{DOC_EXAMPLES.length}</span>
                  </button>
                  {tags.map(t => (
                    <button key={t} className={exTag === t ? "extag on" : "extag"} onClick={() => setExTag(t)}>
                      {t} <span className="meta">{DOC_EXAMPLES.filter(e => (e.tags || []).includes(t)).length}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="exgrid">
                {shown.map(ex => {
                  const cohortNames = Object.keys(ex.doc.cohorts || {});
                  const studies = [...new Set(Object.values(ex.doc.cohorts || {})
                    .flatMap((c: any) => (c && c.studies) || (c && c.study ? [c.study] : []))
                    .concat(ex.doc.study ? [ex.doc.study] : []))];
                  return (
                    <div className="card excard" key={ex.title}>
                      <h3>{ex.title}</h3>
                      <div className="extags small">
                        {viewKinds(ex).map(k => <span key={k} className="vkind">{k}</span>)}
                        {(ex.tags || []).filter(t => !viewKinds(ex).includes(t)).map(t => <span key={t} className="extag static">{t}</span>)}
                      </div>
                      {ex.demonstrates && <p className="exdem">{ex.demonstrates}</p>}
                      <p className="exnote">{ex.note}</p>
                      <div className="exmeta">
                        <span title={studies.join(", ")}>
                          {studies.length === 1 ? studies[0] : studies.length + " studies"}
                        </span>
                        <span>{cohortNames.length} cohort{cohortNames.length === 1 ? "" : "s"}: {cohortNames.join(", ")}</span>
                      </div>
                      <details>
                        <summary className="meta">document</summary>
                        <pre className="exjson">{JSON.stringify(ex.doc, null, 2)}</pre>
                      </details>
                      <div className="row" style={{ marginTop: "auto", paddingTop: "0.5rem", gap: "0.4rem" }}>
                        <button onClick={() => runDocExample(ex)} disabled={busy}>Run</button>
                        <button className="ghost" onClick={() => copyDocLink(ex)}>
                          {copied === ex.title ? "copied" : "copy link"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ================= Analysis tab ================= */}
        {tab === "analysis" && <div className="ana-grid">
          <div>
            <div className="card">
              <h2>The document <span className="plain">— cohorts &amp; views</span></h2>
              {result && Object.entries(result.cohorts).map(([n, c], i) => (
                <div key={n} style={{ marginBottom: "0.65rem" }}>
                  <p className="qdesc" style={{ marginBottom: "0.25rem" }}>
                    <span className="qchip"><span className="qletter" style={{ color: CAT_COLORS[i % CAT_COLORS.length] }}>■</span>{n}</span>{" "}
                    <strong>{c.count.toLocaleString()}</strong> patients{" "}
                    <button className="linklike" disabled={busy} title="remove this cohort from the analysis" onClick={() => removeCohort(n)}>remove</button>
                  </p>
                  {doc.cohorts && doc.cohorts[n] && <CohortPills def={doc.cohorts[n]} />}
                </div>
              ))}
              <textarea value={docText} onChange={e => setDocText(e.target.value)} spellCheck={false}
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
                      <pre style={{ maxHeight: "16rem", overflow: "auto", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "0.6rem", fontSize: "0.68rem", whiteSpace: "pre" }}>{c.sql}</pre>
                    </div>
                  ))}
                </details>
              )}
            </div>
          </div>
          <div>
            {!result && !busy && (
              <div className="card">
                <h2>Nothing here yet</h2>
                <p className="note" style={{ fontSize: "0.85rem" }}>
                  The analysis document is empty. Add cohorts from the <button className="linklike" onClick={() => goTab("cohorts")}>Cohorts tab</button>,
                  ask chat above (e.g. “compare STK11-driver vs wild-type immunotherapy patients”), or paste a document on the left and run it.
                </p>
              </div>
            )}
            {busy && !result && <div className="card"><div className="loading-block"><span className="spinner" /> Evaluating analysis document…</div></div>}
            {result && !result.views.length && (
              <div className="card">
                <h2>Cohorts evaluated — no views defined</h2>
                <p className="note" style={{ fontSize: "0.85rem" }}>
                  Add a views array to the document (e.g. <code>{`{"kind":"survival"}`}</code>),{" "}
                  <button className="linklike" onClick={() => { const d = { ...doc, views: DEFAULT_VIEWS }; setDoc(d); setDocText(JSON.stringify(d, null, 2)); run(d); }}>add the default views</button>, or ask chat.
                </p>
              </div>
            )}
            {Object.keys(doc.cohorts || {}).length > 0 && (
              <div className="card addview">
                <div className="row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.8rem" }}>Add a view</strong>
                  <span className="meta">{(doc.views || []).length} of 6 in this document</span>
                  <span className="spacer" />
                  {VIEW_KINDS.map(({ kind, label, why }) => {
                    const blocked = (doc.views || []).length >= 6
                      ? "this document already has the maximum of 6 views"
                      : (why ? why() : null);
                    return (
                      <button key={kind} className="facet" disabled={!!blocked}
                        title={blocked || ("add a " + label.toLowerCase() + " view and run it")}
                        onClick={() => addView(kind)}>+ {label}</button>
                    );
                  })}
                </div>
              </div>
            )}
            {result && result.views.map((v, vi) => (
              <div className="card viewcard" key={vi}>
                <button className="removeview" title="remove this view from the document"
                  aria-label="remove this view" onClick={() => removeView(vi)}>×</button>
                {v.kind === "compare" && v.rows && <>
                  <div className="viewhead"><h2 style={{ margin: 0 }}>Compare <span className="plain">— alteration frequencies · {v.annotation}</span></h2><span className="spacer" /><>{v.ms != null && (
                      <span className="lat" title={
                        "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
                        (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
                        {v.ms.toLocaleString()}ms
                        {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
                      </span>
                    )}<Participation p={v.participation} /></></div>
                  {v.note && <p className="note" title={(v.studies || []).join(", ") || undefined}
                    style={v.studies && v.studies.length > 2 ? { cursor: "help", textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "0.8rem", width: "100%" }}>
                      <thead><tr>
                        <th style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>gene</th>
                        {v.cohorts!.map((n, i: number) => <th key={n} style={{ textAlign: "right", padding: "0.3rem 0.6rem", color: CAT_COLORS[i] }}>{n}<br /><span style={{ fontWeight: 400, color: "var(--muted)" }}>driver / any</span></th>)}
                        {v.rows![0] && v.rows![0].pAny != null && <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>p (any)</th>}
                      </tr></thead>
                      <tbody>{v.rows.map(r => (
                        <tr key={r.gene} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: "0.3rem 0.6rem", fontWeight: 600 }}>{r.gene}</td>
                          {r.cells.map(c => <td key={c.cohort} style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums" }}>{c.driverPct}% / {c.anyPct}%</td>)}
                          {r.pAny != null && <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", fontWeight: r.pAny < 0.001 ? 600 : 400 }}>{r.pAny < 1e-4 ? r.pAny.toExponential(1) : r.pAny.toFixed(3)}</td>}
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                </>}
                {v.kind === "hotspots" && v.hotspots && <>
                  <div className="viewhead"><h2 style={{ margin: 0 }}>Hotspots <span className="plain">— recurrent protein changes, counted per patient</span></h2><span className="spacer" /><>{v.ms != null && (
                      <span className="lat" title={
                        "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
                        (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
                        {v.ms.toLocaleString()}ms
                        {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
                      </span>
                    )}<Participation p={v.participation} /></></div>
                  {v.note && <p className="note">{v.note}</p>}
                  {v.hotspots.map(h => {
                    const positioned = h.variants.filter(x => x.pos != null);
                    const maxPos = Math.max(1, ...positioned.map(x => x.pos!));
                    const maxN = Math.max(1, ...h.variants.map(x => x.n));
                    // axis ticks on round codon numbers rather than fractions of the max
                    const rawStep = maxPos / 4;
                    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))));
                    const step = Math.max(1, [1, 2, 2.5, 5, 10].map(m => m * mag).find(v2 => v2 >= rawStep) ?? mag * 10);
                    const axisMax = Math.ceil(maxPos / step) * step;
                    const ticks: number[] = [];
                    for (let t = 0; t <= axisMax + 1e-9; t += step) ticks.push(Math.round(t));
                    return (
                      <div key={h.gene} className="lolli">
                        <div className="row" style={{ alignItems: "baseline" }}>
                          <strong style={{ fontSize: "0.82rem" }}>{h.gene}</strong>
                          <span className="meta">{h.mutated.toLocaleString()} mutated patients · {h.variants.length} shown
                            {h.withheld ? " of " + (h.variants.length + h.withheld) + " distinct changes" : ""}</span>
                          <span className="spacer" />
                          <span className="meta">by codon · tallest = {maxN.toLocaleString()} patients</span>
                        </div>
                        {/* laid out in HTML, not a stretched SVG: a viewBox scaled to the
                            container turns circles into ellipses and shears any label */}
                        <div className="lolliplot">
                          {positioned.map((x, i2) => (
                            <span key={i2} className="stem"
                              style={{ left: (100 * x.pos!) / axisMax + "%", height: (12 + 52 * x.n / maxN) + "px" }}
                              title={x.variant + " · " + x.n.toLocaleString() + " patients (" + x.pct + "% of those mutated in " + h.gene + ") · codon " + x.pos + " · " + x.type}>
                              <i className="dot" style={{
                                width: Math.max(6, Math.min(13, 5 + 9 * x.n / maxN)) + "px",
                                height: Math.max(6, Math.min(13, 5 + 9 * x.n / maxN)) + "px",
                                background: x.type && x.type.startsWith("Missense") ? "#0072B2" : "#D55E00" }} />
                            </span>
                          ))}
                          <div className="axis" />
                        </div>
                        <div className="lolliaxis">
                          {ticks.map((t, ti) => (
                            <span key={t} className={ti === ticks.length - 1 ? "last" : undefined}
                              style={{ left: (100 * t) / axisMax + "%" }}>{t || "1"}</span>
                          ))}
                        </div>
                        <div className="lollilist">
                          {h.variants.slice(0, 6).map((x, i2) => (
                            <span key={i2} title={x.type + (x.pos == null ? " · no parseable codon" : " · codon " + x.pos)}>
                              <b>{x.variant}</b> {x.n.toLocaleString()} <span className="meta">({x.pct}%)</span>
                            </span>
                          ))}
                          {h.variants.some(x => x.pos == null) &&
                            <span className="meta">{h.variants.filter(x => x.pos == null).length} change(s) with no parseable codon, not plotted</span>}
                        </div>
                      </div>
                    );
                  })}
                </>}
                {v.kind === "coexpression" && v.coexpression && <>
                  <div className="viewhead"><h2 style={{ margin: 0 }}>Co-expression <span className="plain">— Pearson correlation from per-site sums</span></h2><span className="spacer" /><>{v.ms != null && (
                      <span className="lat" title={
                        "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
                        (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
                        {v.ms.toLocaleString()}ms
                        {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
                      </span>
                    )}<Participation p={v.participation} /></></div>
                  {v.note && <p className="note">{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "0.8rem", width: "100%" }}>
                      <thead><tr>
                        <th style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>pair</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>n</th>
                        <th style={{ width: "9rem" }} aria-label="correlation, visualised" />
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>r</th>
                        {v.coexpression.some(x => x.rMeta != null) && <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>r (meta)</th>}
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>p</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>q</th>
                      </tr></thead>
                      <tbody>{v.coexpression.map(r => (
                        <tr key={r.a + "|" + r.b} style={{ borderTop: "1px solid var(--line)" }}
                          title={(r.perStudy || []).map(s2 => s2.study + ": r=" + s2.r + " (n=" + s2.n + ")").join("\n") || undefined}>
                          <td style={{ padding: "0.3rem 0.6rem", fontWeight: 600 }}>{r.a} / {r.b}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{r.n.toLocaleString()}</td>
                          <td style={{ padding: "0.3rem 0.6rem" }}>
                            {r.r != null && <span className="rbar"><i style={{
                              width: Math.abs(r.r) * 50 + "%",
                              marginLeft: r.r < 0 ? (50 - Math.abs(r.r) * 50) + "%" : "50%",
                              background: r.r < 0 ? "#D55E00" : "#0072B2" }} /></span>}
                          </td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", fontWeight: Math.abs(r.r ?? 0) > 0.5 ? 600 : 400 }}>{r.r ?? "—"}</td>
                          {v.coexpression!.some(x => x.rMeta != null) && <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums" }}>{r.rMeta ?? "—"}</td>}
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums" }}>{pCell(r.pMeta ?? r.p)}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{pCell(r.q)}</td>
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                </>}
                {v.kind === "clinical" && v.clinical && <>
                  <div className="viewhead"><h2 style={{ margin: 0 }}>Clinical comparison <span className="plain">— attribute distributions across cohorts</span></h2><span className="spacer" /><>{v.ms != null && (
                      <span className="lat" title={
                        "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
                        (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
                        {v.ms.toLocaleString()}ms
                        {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
                      </span>
                    )}<Participation p={v.participation} /></></div>
                  {v.note && <p className="note">{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "0.8rem", width: "100%" }}>
                      <thead><tr>
                        <th style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>attribute</th>
                        {v.cohorts!.map((n, i: number) => <th key={n} style={{ textAlign: "left", padding: "0.3rem 0.6rem", color: CAT_COLORS[i] }}>{n}</th>)}
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>test</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>p</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>q</th>
                      </tr></thead>
                      <tbody>{v.clinical.map(r => (
                        <tr key={r.attribute} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: "0.3rem 0.6rem", fontWeight: 600, whiteSpace: "nowrap" }}>
                            {r.attribute}<br /><span className="meta" style={{ fontWeight: 400 }}>{r.per}-level · {r.kind === "num" ? "numeric" : (r.distinct ?? 0) + " values"}</span>
                          </td>
                          {r.skipped
                            ? <td colSpan={v.cohorts!.length + 3} style={{ padding: "0.3rem 0.6rem", color: "var(--muted)", fontStyle: "italic" }}>not compared — {r.skipped}</td>
                            : <>
                              {r.cells.map(c => (
                                <td key={c.cohort} style={{ padding: "0.3rem 0.6rem", verticalAlign: "top" }}>
                                  {r.kind === "num"
                                    ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{c.mean} <span className="meta">± {c.sd} (n={c.n.toLocaleString()})</span></span>
                                    : <span className="meta">{(c.top || []).slice(0, 3).map(t2 => t2.v + " " + Math.round(1000 * t2.n / (c.n || 1)) / 10 + "%").join(" · ")}</span>}
                                </td>
                              ))}
                              <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }}
                                title={r.statistic != null ? r.test + " = " + r.statistic + ", df = " + r.df + (r.minExpected != null ? ", smallest expected cell = " + r.minExpected : "") : undefined}>
                                <span className="meta">{r.test}</span>
                              </td>
                              <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", fontWeight: (r.p ?? 1) < 0.001 ? 600 : 400 }}>{r.p != null ? pCell(r.p) : "—"}</td>
                              <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{r.q != null ? pCell(r.q) : "—"}</td>
                            </>}
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                </>}
                {v.kind === "cooccurrence" && v.pairs && <>
                  <div className="viewhead"><h2 style={{ margin: 0 }}>Co-occurrence <span className="plain">— pairwise, among patients profiled for both genes</span></h2><span className="spacer" /><>{v.ms != null && (
                      <span className="lat" title={
                        "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
                        (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
                        {v.ms.toLocaleString()}ms
                        {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
                      </span>
                    )}<Participation p={v.participation} /></></div>
                  {v.note && <p className="note">{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "0.8rem", width: "100%" }}>
                      <thead><tr>
                        <th style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>pair</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>both</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>A only</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>B only</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>neither</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>log<sub>2</sub> OR</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>p</th>
                        <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>q</th>
                        <th style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>tendency</th>
                      </tr></thead>
                      <tbody>{v.pairs.map(r => {
                        const lor = r.oddsRatioMH != null ? Math.log2(r.oddsRatioMH) : r.log2Odds;
                        const pShown = r.pStratified ?? r.p;
                        return (
                        <tr key={r.a + "|" + r.b} style={{ borderTop: "1px solid var(--line)" }}
                          title={"profiled for both: " + r.profiled.toLocaleString() +
                            (r.pStratified != null ? "  ·  stratified over " + r.strata + " studies (CMH); pooled Fisher p=" + r.p.toExponential(1) : "")}>
                          <td style={{ padding: "0.3rem 0.6rem", fontWeight: 600 }}>{r.a} / {r.b}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums" }}>{r.both.toLocaleString()}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums" }}>{r.onlyA.toLocaleString()}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums" }}>{r.onlyB.toLocaleString()}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{r.neither.toLocaleString()}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums" }}>{lor == null ? "—" : lor.toFixed(2)}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", fontWeight: pShown < 0.001 ? 600 : 400 }}>{pCell(pShown)}</td>
                          <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{pCell(r.q)}</td>
                          <td style={{ padding: "0.3rem 0.6rem" }}>
                            {r.tendency && <span className={r.tendency === "co-occurrence" ? "tend co" : "tend mx"}>{r.tendency}</span>}
                          </td>
                        </tr>); })}
                      </tbody>
                    </table>
                  </div>
                </>}
                {v.kind === "survival" && <>
                  <div className="viewhead"><h2 style={{ margin: 0 }}>Survival <span className="plain">— Kaplan–Meier, overall survival</span></h2><span className="spacer" /><>{v.ms != null && (
                      <span className="lat" title={
                        "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
                        (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
                        {v.ms.toLocaleString()}ms
                        {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
                      </span>
                    )}<Participation p={v.participation} /></></div>
                  <KMChart curves={v.curves!} />
                  <div style={{ display: "flex", gap: "1.2rem", fontSize: "0.76rem", color: "var(--muted)", marginTop: "0.4rem", flexWrap: "wrap" }}>
                    {v.curves!.map((c, i: number) => <span key={c.cohort}><span style={{ display: "inline-block", width: 10, height: 10, background: CAT_COLORS[i], borderRadius: 2, marginRight: 5 }} />{c.cohort}: median {c.median ? c.median.toFixed(1) + "mo" : "not reached"} (n={c.n}, {c.events} events)</span>)}
                  </div>
                  {v.logrank && (
                    <div className="logrank" title={"observed " + v.logrank.observed.join(" / ") + " events vs expected " + v.logrank.expected.join(" / ") + " under the null"}>
                      <strong>log-rank</strong> χ²={v.logrank.chi2.toFixed(2)} ({v.logrank.df} df) · <strong>{fmtP(v.logrank.p)}</strong>
                      {v.logrank.strata > 1 && <span className="meta"> · stratified by study, {v.logrank.strata} strata</span>}
                      {v.logrankPooled && (
                        <span className="meta" title="the unstratified test, which pools risk sets across studies and assumes a common baseline hazard">
                          {"  ·  pooled " + fmtP(v.logrankPooled.p)}
                          {crossesThreshold(v.logrank.p, v.logrankPooled.p) && <strong style={{ color: "var(--warn, #b45309)" }}> — the two disagree at p=0.05</strong>}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="note">{v.caveat}</p>
                </>}
                {v.kind === "oncoprint" && v.svg && <>
                  <div className="row" style={{ alignItems: "baseline" }}>
                    <h2 style={{ margin: 0 }}>Oncoprint <span className="plain">— {v.nColumns!.toLocaleString()} patients · {v.annotation}</span></h2>
                    <span className="spacer" />
                    <>{v.ms != null && (
                      <span className="lat" title={
                        "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
                        (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
                        {v.ms.toLocaleString()}ms
                        {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
                      </span>
                    )}<Participation p={v.participation} /></>
                    <details className="gearmenu">
                      <summary title="oncoprint options">⚙</summary>
                      <div className="gearmenu-items">
                        {(() => {
                          const vNames = ocView(vi).cohorts || Object.keys(result.cohorts);
                          const vStudies = [...new Set(vNames.flatMap(n => (result.cohorts[n] && result.cohorts[n].studies) || []))];
                          const genes = (v.genes || []).map(g => g.gene);
                          const url = "https://www.cbioportal.org/results/oncoprint?cancer_study_list=" + vStudies.join(",") +
                            "&case_set_id=" + (vStudies.length === 1 ? vStudies[0] + "_all" : "all") +
                            "&gene_list=" + encodeURIComponent(genes.join(" ")) +
                            "&profileFilter=mutations%2Cstructural_variants%2Cgistic&Z_SCORE_THRESHOLD=2.0&tab_index=tab_visualize&Action=Submit";
                          return <>
                            <a target="_blank" rel="noopener noreferrer" href={url}>Open these genes in the cBioPortal oncoprint ↗</a>
                            <span className="meta">full {vStudies.length === 1 ? "study" : vStudies.length + "-study"} view, all samples — the portal can't express Cohort Lab cohorts or tracks</span>
                          </>;
                        })()}
                      </div>
                    </details>
                  </div>
                  {v.note && <p className="note" title={(v.studies || []).join(", ") || undefined}
                    style={v.studies && v.studies.length > 2 ? { cursor: "help", textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>{v.note}</p>}
                  <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap", alignItems: "center", margin: "0.35rem 0 0.5rem" }}>
                    <span className="meta">clinical tracks:</span>
                    {(ocView(vi).clinical || []).map((a: any) => (
                      <button key={a} className="linklike" disabled={busy} title="remove this track"
                        onClick={() => setViewClinical(vi, (ocView(vi).clinical || []).filter((x: any) => x !== a))}>{a} ✕</button>
                    ))}
                    <select value="" disabled={busy || !trackAttrs.attrs.length}
                      onChange={e => { const a = e.target.value; if (!a) return;
                        const cur = (ocView(vi).clinical || []);
                        if (!cur.includes(a) && cur.length < 8) setViewClinical(vi, [...cur, a]); }}
                      style={{ fontSize: "0.78rem" }}>
                      <option value="">{trackAttrs.attrs.length ? "add clinical track…" : "loading attributes…"}</option>
                      {trackAttrs.attrs.filter(a => !(ocView(vi).clinical || []).includes(a.attribute))
                        .map(a => <option key={a.attribute} value={a.attribute}>{a.attribute}{a.kind === "num" ? " (numeric)" : ""}</option>)}
                    </select>
                    <span className="meta">heatmap:</span>
                    {(ocView(vi).heatmap || []).map((h: any, hi: any) => (
                      <button key={h.profileType} className="linklike" disabled={busy} title="remove this heatmap"
                        onClick={() => setViewHeatmap(vi, (ocView(vi).heatmap || []).filter((_: any, j: any) => j !== hi))}>{h.profileType} ✕</button>
                    ))}
                    <select value="" disabled={busy}
                      onChange={e => { const p = e.target.value; if (!p) return;
                        const cur = (ocView(vi).heatmap || []);
                        if (!cur.some((h: any) => h.profileType === p) && cur.length < 4) setViewHeatmap(vi, [...cur, { profileType: p }]); }}
                      style={{ fontSize: "0.78rem" }}>
                      <option value="">add heatmap…</option>
                      {["VAF", ...(trackAttrs.profiles || [])].filter(p => !(ocView(vi).heatmap || []).some((h: any) => h.profileType === p))
                        .map(p => <option key={p} value={p}>{p === "VAF" ? "VAF (mutation allele fraction)" : p}</option>)}
                    </select>
                    <span className="meta">sort:</span>
                    <select value={ocView(vi).sort?.[0] || "genomic"}
                      disabled={busy} onChange={e => setViewSort(vi, e.target.value)} style={{ fontSize: "0.78rem" }}>
                      <option value="genomic">genomic (staircase)</option>
                      {(result.involvedStudies || []).length > 1 && <option value="Study">Study</option>}
                      {(ocView(vi).clinical || []).flatMap((a: any) => [
                        <option key={a} value={a}>{a} ↑</option>,
                        <option key={"-" + a} value={"-" + a}>{a} ↓</option>
                      ])}
                      {heatmapLabels(ocView(vi)).flatMap(l => [
                        <option key={l} value={l}>{l} ↑</option>,
                        <option key={"-" + l} value={"-" + l}>{l} ↓</option>
                      ])}
                    </select>
                  </div>
                  <div style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid var(--line)" }} dangerouslySetInnerHTML={{ __html: v.svg }} />
                </>}
                {v.queries && v.queries.length > 0 && (
                  <details className="provsql">
                    <summary className="meta">
                      how these numbers were computed — {v.queries.length} {v.queries.length === 1 ? "query" : "queries"}
                      {v.ms != null && <> in {v.ms.toLocaleString()}ms</>}
                      {v.queries.some(q => q.remote) && <> · <span className="prem">{v.queries.filter(q => q.remote).length} ran on a peer</span></>}
                    </summary>
                    {v.queries.map((q, qi) => (
                      <div className="provq" key={qi}>
                        <div className="provhead">
                          <code>{q.label}</code>
                          <span className="meta">{q.study}</span>
                          {q.ms != null && <span className="meta">{q.ms.toLocaleString()}ms</span>}
                          {q.remote && <span className="prem" title="compiled and executed by the peer against its own schema; only aggregates came back">ran on peer</span>}
                        </div>
                        <pre>{q.sql}</pre>
                      </div>
                    ))}
                  </details>
                )}
                {v.error && <div className="error">{v.kind}: {v.error}{v.participation ? <> <>{v.ms != null && (
                      <span className="lat" title={
                        "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
                        (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
                        {v.ms.toLocaleString()}ms
                        {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
                      </span>
                    )}<Participation p={v.participation} /></></> : null}</div>}
              </div>
            ))}
          </div>
        </div>}
      </main>
    </>
  );
}
