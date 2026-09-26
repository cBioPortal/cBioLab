"use client";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import CohortPills, { normalizeDef } from "./pills";
import OncoprintFigure, { DEFAULT_FIGURE_DISPLAY, type ColumnSelection, type FigureDisplay } from "../_oncoprint/OncoprintFigure.tsx";
import { formatGeneList, geneSymbols, normalizeGeneTracks, parseGeneList, type GeneTrackSpec } from "../../lib/gene-tracks.ts";
import type { UnpackedContract } from "../../lib/oncoprint-binary.ts";
import { heatmapTrackLabel } from "../../lib/profile-names.ts";
import { parameterize } from "../../lib/params.ts";
import type { AnalysisDoc, TemplateDoc, AnalysisResult, CohortDef, View, OncoprintView, ExploreResult, KmCurve } from "../../lib/types.ts";
import { EXAMPLES as DOC_EXAMPLES, type DslExample } from "../../lib/dsl-reference.ts";
import type { ViewParticipation } from "../../lib/types.ts";
import { survivalAxis } from "../../lib/stats.ts";

const TABS = ["explore", "cohorts", "saved", "analysis", "examples"] as const;

type SearchParams = { [key: string]: string | string[] | undefined };

/**
 * The landing tab, from the SAME searchParams Next.js already resolves on the
 * server for this route — not a client-only re-parse of window.location. That
 * match is what avoids a hydration mismatch: read the URL again on the client
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

const CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];
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

/** Prompts where a figure is the answer, not decoration. */
const CHAT_STARTERS = [
  "Do STK11-mutant lung cancers do worse on immunotherapy? Measure survival from when they started it, not from sequencing.",
  "Which KRAS mutations actually occur in colorectal cancer here?",
  "Are EGFR and KRAS mutually exclusive in lung cancer?"
];

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
/**
 * A control whose options are still being fetched. It stands where the select will be, so the
 * toolbar doesn't jump when the options arrive, and it says what it is waiting for — an empty
 * select would read as "this study has none".
 */
function Waiting({ what }: { what: string }) {
  return <span className="waiting" role="status"><span className="spinner" /> loading {what}…</span>;
}

/**
 * Over a view whose answer is being recomputed. Its header and controls stay visible and usable
 * — so the reader sees the setting they just changed, and can change it again — while the figure
 * below is covered by a skeleton with a spinner: a figure still showing the previous answer
 * reads as the new one. Measures where the card's header/toolbars end rather than assuming it,
 * since every view kind lays those out differently; a card with none is covered whole.
 */
function Updating() {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const card = ref.current?.parentElement;
    if (!card) return;
    const measure = () => {
      const at = card.getBoundingClientRect().top;
      let bottom = 0;
      card.querySelectorAll(":scope > .vhead, :scope > .viewtb, :scope > .viewtb-more, :scope > .basis")
        .forEach((n) => { bottom = Math.max(bottom, n.getBoundingClientRect().bottom - at); });
      setTop(bottom ? bottom + 6 : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="view-updating" style={{ top }} role="status" aria-live="polite">
      <div className="loading-block"><span className="spinner" /> updating…</div>
      <div className="skeleton" />
    </div>
  );
}

/**
 * A dialog's text field that keeps its keystrokes to itself. As page state, every keystroke
 * re-rendered the whole analysis page — every view card, the oncoprint, the inlined figures —
 * about 350 ms a key with a few views open. The page reads the text from `draft` (a ref, so
 * writing it renders nothing) when the dialog is saved, and hears only when the field turns
 * empty or non-empty, which is all a Save button's disabled state needs. Give it a fresh `key`
 * each time its dialog opens so it starts from `initial`.
 */
function DraftText({ draft, initial, multiline, onFilled, ...rest }: {
  draft: React.MutableRefObject<string>; initial: string; multiline?: boolean; onFilled?: (filled: boolean) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "defaultValue">) {
  const [v, setV] = useState(() => { draft.current = initial; return initial; });
  const change = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    if (onFilled && !!next.trim() !== !!draft.current.trim()) onFilled(!!next.trim());
    draft.current = next;
    setV(next);
  };
  return multiline ? <textarea {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} value={v} onChange={change} />
    : <input {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} value={v} onChange={change} />;
}

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
/** the synthetic eventType the server's derived treatment-line logic (lib/compiler.ts LINE_TYPE) recognizes */
const LINE_TYPE = "Treatment line (derived)";

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

function KMChart({ curves, cutoffMonths, tickMonths, incidence }:
  { curves: KmCurve[]; cutoffMonths?: number; tickMonths?: number; incidence?: boolean }) {
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
    const { tMax, step } = survivalAxis(curves, { cutoffMonths, tickMonths });
    const x = (t: number) => L + (W - L - R) * t / tMax, y = (s: number) => T + (H - T - B) * (1 - s);
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.font = "10px 'IBM Plex Sans',sans-serif";
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.beginPath(); ctx.moveTo(L, y(s)); ctx.lineTo(W - R, y(s)); ctx.stroke();
      ctx.fillText(Math.round(s * 100) + "%", 8, y(s) + 3);
    }
    for (let t = 0; t <= tMax; t += step) ctx.fillText(t + "mo", x(t) - 8, H - 10);
    curves.forEach((cv, i: number) => {
      ctx.strokeStyle = CAT_COLORS[i % CAT_COLORS.length]; ctx.lineWidth = 2; ctx.beginPath();
      let py = y(incidence ? 0 : 1); ctx.moveTo(x(0), py);
      for (const p of cv.points) { const nx = x(p.t), ny = y(p.s); ctx.lineTo(nx, py); ctx.lineTo(nx, ny); py = ny; }
      ctx.lineTo(x(tMax), py); ctx.stroke();
    });
  }, [curves, cutoffMonths, tickMonths, incidence]);
  return <canvas ref={ref} style={{ width: "100%", display: "block" }} />;
}

/**
 * A gene symbol box + button: the fastest way to compare two survival curves by mutation
 * status without hand-editing cohort definitions. Submitting hands the gene up to the caller,
 * which builds the mutant/wildtype cohort pair and re-points the survival view at them.
 */
function GeneSplitControl({ busy, onSplit }: { busy?: boolean; onSplit: (gene: string) => void }) {
  const [gene, setGene] = useState("");
  const submit = () => { const g = gene.trim().toUpperCase(); if (g) { onSplit(g); setGene(""); } };
  return (
    <span style={{ display: "inline-flex", gap: "0.3rem" }}>
      <input value={gene} disabled={busy} placeholder="gene" style={{ width: "5.5rem" }}
        onChange={e => setGene(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }} />
      <button type="button" className="tbbtn" disabled={busy || !gene.trim()} onClick={submit}>split</button>
    </span>
  );
}

/** Explore opens on these: one deeply-annotated MSK study and one large
 *  consortium cohort on the peer instance, so federation is visible up front. */
const DEFAULT_EXPLORE_STUDIES = ["msk_chord_2024", "genie_public"];

const EMPTY_DOC: AnalysisDoc = { cohorts: {}, views: [] };
// "compare" dropped from the default set: computing driver/any/p for 7 genes
// across every cohort is by far the slowest of the three, and this set exists
// to make Analyze feel instant, not to be exhaustive — add it back per-document
// with "+ Compare genes" when you actually want it.
const DEFAULT_VIEWS: View[] = [
  { kind: "survival" },
  { kind: "oncoprint", genes: ["TP53", "KRAS", "STK11", "KEAP1", "EGFR"] }
];

/**
 * One editable template parameter. The control follows the value's TYPE, so a
 * gene list edits as chips and a study edits as text — the point of a template
 * is that retargeting is a normal edit, not JSON surgery.
 */
function ParamRow({ name, value, busy, onChange }:
  { name: string; value: unknown; busy: boolean; onChange: (v: unknown) => void }) {
  const [add, setAdd] = useState("");
  if (Array.isArray(value)) {
    const items = value.map(String);
    return (
      <div className="paramrow">
        <code>${name}</code>
        <div className="pillwrap">
          {items.map(x => (
            <button key={x} type="button" className="pill" disabled={busy}
              title={"remove " + x} onClick={() => onChange(items.filter(y => y !== x))}>
              {x} <span aria-hidden="true">×</span>
            </button>
          ))}
          <input list="view-genes" placeholder="add…" value={add} disabled={busy}
            style={{ width: "7rem" }}
            onChange={e => setAdd(e.target.value.toUpperCase())}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const v = add.trim().toUpperCase();
              if (v && !items.includes(v)) onChange([...items, v]);
              setAdd("");
            }} />
        </div>
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <div className="paramrow">
        <code>${name}</code>
        <input type="number" value={value} disabled={busy}
          onChange={e => onChange(Number(e.target.value))} />
      </div>
    );
  }
  return (
    <div className="paramrow">
      <code>${name}</code>
      <input value={String(value ?? "")} disabled={busy}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}

export default function AnalysisPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = use(searchParams);
  const [tab, setTab] = useState<"explore" | "cohorts" | "saved" | "analysis" | "examples">(() => tabFromParams(sp));
  const [exTag, setExTag] = useState<string>("all");     // Examples tab filter
  const [copied, setCopied] = useState<string | null>(null);
  const [exMsg, setExMsg] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [genesFor, setGenesFor] = useState<number | null>(null);
  const genesDialog = useRef<HTMLDialogElement | null>(null);
  const saveDialog = useRef<HTMLDialogElement | null>(null);   // Explore action-bar feedback
  const tabRef = useRef<string>(tabFromParams(sp));            // the tab syncUrl should record
  const exInflight = useRef<string | null>(null);            // dedupe identical in-flight facet requests
  const exAbort = useRef<AbortController | null>(null);      // cancel a facet request the reader has moved past
  /**
   * Stable React keys for view cards, by the identity of the DRAFT view object
   * that produced each one — not the array index, and not the objects in
   * `result.views` itself, which the server rebuilds from scratch on every
   * run() and so would remount every card on every edit, including ones
   * nobody touched. `doc.views[i]` keeps its object reference across
   * addView, removeView and patchView (they only ever replace the one view
   * that changed), and moveView explicitly swaps those references rather
   * than cloning them, so a card's key travels with it when it moves.
   *
   * `resultViewKeys` is the actual per-render lookup (index in result.views
   * -> stable key), snapshotted by run() from the SAME `d` it just sent,
   * not re-derived from the live `doc` state at render time — `doc` can
   * already hold the next edit (one more/fewer view) by the time a slower
   * run() resolves, and indexing into it with `result.views`' index during
   * that window pairs each view with the WRONG doc entry, which briefly
   * looks to React like every view past the edit point turned into a
   * different one and remounted it (an oncoprint losing its already-drawn
   * canvas to a needless refetch, mid-edit).
   */
  const viewKeys = useRef(new WeakMap<object, number>());
  const nextViewKey = useRef(0);
  const resultViewKeys = useRef<number[]>([]);
  /** which gearmenus (view menu, cohorts picker, ...) are open; see useGearmenuOpen's comment */
  const menuOpenRef = useRef(new Map<string, boolean>());
  const moreDerivedMenu = useGearmenuOpen("explore:more-derivations", menuOpenRef.current);
  const seqFilterMenu = useGearmenuOpen("explore:sequence-filter", menuOpenRef.current);
  const keyFor = (v: object): number => {
    let k = viewKeys.current.get(v);
    if (k == null) { k = nextViewKey.current++; viewKeys.current.set(v, k); }
    return k;
  };
  /**
   * Which view cards are mid-recompute from a ONE-view delta request (see
   * runViewDelta below) — not the same thing as `busy`, which also covers a
   * full run() of the whole document. Keyed by the same stable `keyFor` id
   * as `resultViewKeys`, so a card's own spinner tracks whether ITS query is
   * running, not whether some unrelated view's is.
   */
  const [pendingKeys, setPendingKeys] = useState<Set<number>>(new Set());
  // per-key generation counter: a delta response only applies if it's still
  // the newest one requested for that key, so firing a second edit before
  // the first one's response lands can't have the first response clobber it
  const deltaGen = useRef(new Map<number, number>());
  const [cat, setCat] = useState<any>(null);                 // event/endpoint catalog for the survival control
  const [picked, setPicked] = useState<string[]>([]);        // Cohorts tab: keys "ex:<name>" / "saved:<name>"
  /**
   * The document's raw JSON is a place to inspect and share what was asked, not something to
   * read while interpreting a figure — so it lives behind a button, in a dialog, rather than
   * taking up permanent width beside the results.
   */
  const docDialog = useRef<HTMLDialogElement | null>(null);
  const [doc, setDoc] = useState<AnalysisDoc>(EMPTY_DOC);
  const [docText, setDocText] = useState(JSON.stringify(EMPTY_DOC, null, 2));
  const [result, setResult] = useState<AnalysisResult | null>(null);
  /**
   * Decoded oncoprint contracts, keyed by the spec they came from rather than by view index.
   * A re-run that leaves a figure's spec unchanged does not refetch it, so keying by index and
   * clearing on every run left the header and the provenance panel permanently empty.
   */
  const [contracts, setContracts] = useState<Record<string, UnpackedContract>>({});
  // Starts true exactly when a ?doc= link means the mount effect below is
  // about to call run(d) — same reasoning, and the same `sp` (not a
  // client-only re-read of window.location), as tabFromParams above: without
  // this, the first render shows "Nothing here yet" (busy=false, no result
  // yet) for one frame before that effect flips busy on, which is the flash.
  // A malformed link's catch block below resets this, so a bad ?doc= doesn't
  // leave the page stuck on the loading skeleton forever.
  const [busy, setBusy] = useState(() => typeof sp.doc === "string");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, { id: string; def: CohortDef; savedAt: string; lastEval?: { count: number; text?: string } | null }>>({});
  const [cName, setCName] = useState("");
  const [cDefText, setCDefText] = useState(JSON.stringify({ studies: [...DEFAULT_EXPLORE_STUDIES], all: [] }, null, 2));
  const [cPreview, setCPreview] = useState<{ error?: string; count?: number; text?: string } | null>(null);
  const [cBusy, setCBusy] = useState(false);
  const [exEvals, setExEvals] = useState<Record<string, { count?: number; error?: string; busy?: boolean } | null>>({});
  const [studies, setStudies] = useState<{ id: string; name: string; cancerType?: string; patients: number; samples: number; timelinePatients: number; caps?: Record<string, boolean>; oncokb?: boolean; instance?: string; instanceLabel?: string }[]>([]);
  const [study, setStudy] = useState("msk_chord_2024");
  const [explore, setExplore] = useState<ExploreResult | null>(null);
  const [exploreBusy, setExploreBusy] = useState(false);
  const [trackAttrs, setTrackAttrs] = useState<{ key: string; attrs: { attribute: string; kind: string; patients: number }[]; profiles: string[] }>({ key: "", attrs: [], profiles: [] }); // track picker options
  /** the clinical-attribute catalog above is being fetched — a picker shows a loader, not "none" */
  const [trackAttrsLoading, setTrackAttrsLoading] = useState(false);
  /** the study catalog (`cat`: endpoints, event types) is being fetched */
  const [catLoading, setCatLoading] = useState(false);
  const [sQuery, setSQuery] = useState("");                             // study-panel search
  const [sCaps, setSCaps] = useState<Set<string>>(() => new Set());                  // study-panel capability filters
  const [exStudies, setExStudies] = useState<string[]>([...DEFAULT_EXPLORE_STUDIES]); // studies being explored (checkboxes)
  const [exPanelOpen, setExPanelOpen] = useState(false);                // study panel expanded?
  const exSel = useRef<string[]>([...DEFAULT_EXPLORE_STUDIES]);                   // current selection (ref: immune to state races)
  const exFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);                                    // debounce for multi-toggle refetch
  const exFetchSeq = useRef(0);
  /** facets from the last UNNARROWED response — the bar is always computed from these */
  const exFullAttrsRef = useRef<{ attribute: string; studyCount: number }[]>([]);                                         // stale-response guard for explore fetches
  /**
   * Clinical attribute order, pinned from the last response with NO facet
   * selection applied. The server sorts attributes by priority then by
   * coverage WITHIN the current draft (lib/explore.ts) — so two attributes
   * with similar coverage overall can swap places the moment a selection
   * changes who is being counted, and the whole page reshuffles under the
   * reader even though no number is wrong. This is the reference point that
   * stops that: it only moves when the draft is empty (a real re-scoping —
   * changing studies, or clearing filters), never as a side effect of a
   * click. Keyed by `per|attribute` to match the `data-attr` the DOM uses.
   */
  const attrOrderRef = useRef<string[] | null>(null);
  const [qaAttr, setQaAttr] = useState("");                             // creator quick-add: attribute
  const [qaVal, setQaVal] = useState("");                               // creator quick-add: numeric threshold
  const [qaGene, setQaGene] = useState("");                             // creator quick-add: gene
  const [geneRowLimit, setGeneRowLimit] = useState(12);                 // rows shown per gene table
  const [attrLimit, setAttrLimit] = useState(20);
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
  /** derived facets beyond the fixed three, switched on from "show more derivations" */
  const [exExtraDerived, setExExtraDerived] = useState<{ metric: "lines" | "treatmentSpan"; eventType: string; lineGap?: number }[]>([]);
  const exExtraDerivedRef = useRef<typeof exExtraDerived>([]);   // fetchExplore reads this, not the closure
  const [geneChartInput, setGeneChartInput] = useState("");
  /** the header lists selected studies as chips; past a handful it is summarised */
  const [studyChipsOpen, setStudyChipsOpen] = useState(false);
  const [geneFilter, setGeneFilter] = useState<Record<string, string>>({});   // per-table gene box, client-side
  const [clinFilter, setClinFilter] = useState("");                            // matches an attribute name OR one of its values
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

  /**
   * Saved workspaces. A workspace IS the analysis document — several views,
   * their notes, and any template parameters — so persistence is deliberately
   * schemaless: the whole document is stored verbatim under a name, exactly as
   * saved cohorts already are. Nothing is normalised, so a document written by a
   * newer build still loads, and anything the app cannot interpret survives a
   * round trip instead of being dropped.
   *
   * Both this and saved cohorts now live in the shared Postgres artifact store
   * (lib/artifacts.ts) rather than localStorage — server-side, so a save
   * outlives the browser that made it, but SHARED: there is no per-user
   * ownership yet (see HANDOFF.local.md), so anyone using the app can see,
   * rename or delete anything saved here. Naming stays the identity a person
   * types (upsert by name, matching the old localStorage behaviour); the real
   * identity is the server-assigned id, kept alongside it.
   */
  type Workspace = { id: string; doc: AnalysisDoc; savedAt: string };
  const [spaces, setSpaces] = useState<Record<string, Workspace>>({});
  const [wsName, setWsName] = useState("");
  const [wsError, setWsError] = useState<string | null>(null);
  const wsDialog = useRef<HTMLDialogElement | null>(null);

  // ---- editing a cohort's name/note (the gear menu's "edit…") -------------
  const [cohortEditing, setCohortEditing] = useState<string | null>(null); // the name AS IT IS in doc.cohorts right now
  const [ceName, setCeName] = useState("");
  const [ceNotes, setCeNotes] = useState("");
  const [ceError, setCeError] = useState<string | null>(null);
  const cohortEditDialog = useRef<HTMLDialogElement | null>(null);

  // ---- editing a view's note (the gear menu's "add note…" / "edit note…") -
  const [viewNoteEditing, setViewNoteEditing] = useState<number | null>(null); // index into doc.views / result.views
  const [vnText, setVnText] = useState("");
  // what the text dialogs' fields hold while being typed in (see DraftText), a generation
  // bumped on every open so each field starts fresh, and whether the gating field is non-empty
  const saveDraft = useRef(""), wsDraft = useRef(""), ceNameDraft = useRef(""), ceNotesDraft = useRef(""), vnDraft = useRef("");
  const [draftGen, setDraftGen] = useState(0);
  const [draftFilled, setDraftFilled] = useState(false);
  const viewNoteDialog = useRef<HTMLDialogElement | null>(null);

  /** Postgres timestamptz -> the same "YYYY-MM-DD HH:MM" the app has always shown. */
  const fmtDate = (iso: string) => iso.slice(0, 16).replace("T", " ");

  async function apiSaveArtifact(kind: "cohort" | "workspace", existingId: string | undefined, name: string, definition: unknown) {
    const res = existingId
      ? await fetch("/api/artifacts/" + existingId, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, definition }) })
      : await fetch("/api/artifacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, name, definition }) });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || res.statusText);
    return j.artifact as { id: string; name: string; definition: unknown; updatedAt: string };
  }
  async function apiDeleteArtifact(id: string) {
    const res = await fetch("/api/artifacts/" + id, { method: "DELETE" });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || res.statusText); }
  }

  const persistSpaces = async (name: string, docToSave: AnalysisDoc) => {
    const a = await apiSaveArtifact("workspace", spaces[name]?.id, name, docToSave);
    setSpaces(prev => ({ ...prev, [name]: { id: a.id, doc: a.definition as AnalysisDoc, savedAt: fmtDate(a.updatedAt) } }));
  };
  const removeSpace = async (name: string) => {
    const id = spaces[name]?.id;
    if (id) await apiDeleteArtifact(id);
    setSpaces(prev => { const nx = { ...prev }; delete nx[name]; return nx; });
  };

  const persist = async (name: string, def: CohortDef, lastEval: { count: number; text?: string } | null) => {
    const a = await apiSaveArtifact("cohort", saved[name]?.id, name, def);
    setSaved(prev => ({ ...prev, [name]: { id: a.id, def: a.definition as CohortDef, savedAt: fmtDate(a.updatedAt), lastEval } }));
  };
  const removeSaved = async (name: string) => {
    const id = saved[name]?.id;
    if (id) await apiDeleteArtifact(id);
    setSaved(prev => { const nx = { ...prev }; delete nx[name]; return nx; });
  };

  const run = async (d: AnalysisDoc = doc) => {
    if (!Object.keys(d.cohorts || {}).length) { setBusy(false); setResult(null); return; }
    setBusy(true); setError(null);
    try {
      const payload = { study: d.study || study, ...d };
      // the page draws its own oncoprints from the binary contract, so the run returns
      // a spec for each one instead of a server-rendered SVG
      const res = await fetch("/api/analysis?oncoprint=spec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      // aligned with `d`, the document THIS run actually sent — not `doc`,
      // which may already hold a further edit by the time this resolves
      resultViewKeys.current = (d.views || []).map((v: any) => keyFor(v));
      setResult(j);
      syncUrl(undefined, d);
    } catch (e) { setError(String((e as Error)?.message || e)); }
    setBusy(false);
  };

  /**
   * Recompute ONE view instead of the whole document. `runAnalysis` doesn't
   * care how many views it's given — it just loops over `doc.views` — so a
   * request carrying only `view` still re-evaluates the cohorts (cheap, and
   * kept authoritative rather than trusting a client-cached count) but skips
   * every OTHER view's queries entirely. That's a real cost saved, not just
   * a cosmetic one: a full run() re-hits ClickHouse for every cohort AND
   * every other view on the page, every time, because nothing in
   * runAnalysis is cached across calls.
   *
   * Deliberately does NOT touch the global `busy` flag — that's what made
   * Survival/Cox show a spinner for edits to a completely different view,
   * since both read `busy` for their own "recomputing" indicator. This sets
   * `pendingKeys` instead, scoped to just this view's stable key.
   *
   * The response is spliced into `result.views` by KEY, found via
   * `resultViewKeys.current` at the moment the response lands — not the
   * index captured when the request was made. addView/patchView/updateView
   * all keep `resultViewKeys.current` in lockstep with `doc.views`
   * synchronously, before this fetch even starts, so this finds the right
   * slot even if another view was added, removed or reordered while this
   * one was still in flight. If the key is gone (the view was removed
   * before its answer came back), the response is just discarded.
   */
  const runViewDelta = async (d: AnalysisDoc, view: any) => {
    const key = keyFor(view);
    const gen = (deltaGen.current.get(key) ?? 0) + 1;
    deltaGen.current.set(key, gen);
    setPendingKeys(prev => new Set(prev).add(key));
    const applyToSlot = (vr: unknown) => setResult(prev => {
      if (!prev) return prev;
      const idx = resultViewKeys.current.indexOf(key);
      if (idx < 0) return prev; // removed before this delta came back
      const views = [...prev.views];
      views[idx] = vr as typeof views[number];
      return { ...prev, views };
    });
    try {
      const payload = { ...d, views: [view] };
      const res = await fetch("/api/analysis?oncoprint=spec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (deltaGen.current.get(key) !== gen) return; // superseded by a later edit to this same view
      if (j.error) throw new Error(j.error);
      const vr = j.views && j.views[0];
      if (!vr) throw new Error("no result for this view");
      applyToSlot(vr);
    } catch (e) {
      if (deltaGen.current.get(key) !== gen) return;
      applyToSlot({ kind: view.kind, error: String((e as Error)?.message || e) });
    } finally {
      if (deltaGen.current.get(key) === gen) setPendingKeys(prev => { if (!prev.has(key)) return prev; const nx = new Set(prev); nx.delete(key); return nx; });
    }
  };

  useEffect(() => {
    fetch("/api/artifacts?kind=cohort").then(r => r.json()).then(j => {
      const map: typeof saved = {};
      for (const a of j.artifacts || []) map[a.name] = { id: a.id, def: a.definition, savedAt: fmtDate(a.updatedAt), lastEval: null };
      setSaved(map);
    }).catch(() => {});
    fetch("/api/artifacts?kind=workspace").then(r => r.json()).then(j => {
      const map: typeof spaces = {};
      for (const a of j.artifacts || []) map[a.name] = { id: a.id, doc: a.definition, savedAt: fmtDate(a.updatedAt) };
      setSpaces(map);
    }).catch(() => {});
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
    // tab itself is already correct from the initial render (see initialTab()) — this
    // only needs to fetch what that landing tab needs and hydrate a shared ?doc= link.
    // A ?doc= link's study must land in exSel BEFORE fetchExplore reads it: doing
    // that fetch first sent it out scoped to the hardcoded default studies, so
    // every facet on screen — cardinality included, hence a table rendering where
    // a pie belonged — reflected the wrong population until the next click
    // quietly re-scoped everything and the shapes changed under the reader.
    try {
      const b64 = new URLSearchParams(window.location.search).get("doc");
      if (b64) {
        const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0))));
        if (d.study) { setStudy(d.study); setExStudies([d.study]); exSel.current = [d.study]; }
        setDoc(d); setDocText(JSON.stringify(d, null, 2));
        if (tabRef.current === "explore") fetchExplore();
        run(d);
      } else if (tabRef.current === "explore") fetchExplore();
    } catch (e) { setBusy(false); setError("bad ?doc= link: " + String((e as Error)?.message || e)); }
  }, []); // eslint-disable-line

  /**
   * Keep the URL describing where you are, so a refresh (or a shared link)
   * lands on the same tab. `doc` and `tab` are written together — writing one
   * with a bare "?tab=…" would drop the other.
   */
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
    try { await persist(name, r.def, r.ev); }
    catch (e) { setCPreview({ error: "could not save: " + String((e as Error)?.message || e) }); }
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
    // Named from the draft, not from cName: that field lives on the Cohorts tab
    // and is invisible here, so inheriting it made the analysis arrive under a
    // name with no on-screen explanation.
    const name = barDefaultName();
    const nextStudy = exSel.current[0] || study;
    const nd: AnalysisDoc = { study: nextStudy, cohorts: { [name]: d }, views: DEFAULT_VIEWS };
    setStudy(nextStudy);
    setDoc(nd); setDocText(JSON.stringify(nd, null, 2));
    setResult(null); setError(null);     // never leave the previous run's numbers on screen
    goTab("analysis");
    run(nd);
  };
  /**
   * Saving asks for a name when you ask to save, rather than keeping a field in
   * the bar. The bar's job is Analyze; a permanent name box next to it implied
   * Analyze wanted one too.
   */
  const openSaveDialog = () => {
    if (!barDef()) { setExMsg("select at least one study first"); return; }
    setExMsg(null);
    setSaveName(cName.trim() || barDefaultName());
    setDraftFilled(!!(cName.trim() || barDefaultName()).trim()); setDraftGen((g) => g + 1);
    saveDialog.current?.showModal();
  };
  const confirmSave = async () => {
    const name = saveDraft.current.trim();
    const def = barDef();
    if (!name || !def) return;
    saveDialog.current?.close();
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
    const by = new Map<string, { canonical: string; label: string; n: number }>();
    for (const e of raw) {
      const c = String(e.type).trim().toLowerCase();
      if (!c) continue;
      const cur = by.get(c);
      if (cur) { cur.n += e.n; if (e.n > 0 && e.type.length < cur.label.length) cur.label = e.type; }
      else by.set(c, { canonical: c, label: e.type, n: e.n });
    }
    return [...by.values()].sort((a, b) => b.n - a.n);
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
        : "this study records no treatment events, so there are no lines of therapy to sequence" }
  ];

  /**
   * Whether this view's own block renders its header (and with it the remove/move controls).
   * Most kinds only draw theirs once they have data, so a view that came back with only an error
   * would otherwise be a bare red box the reader can't remove without editing the JSON.
   */
  const drawsOwnHead = (v: any): boolean =>
    v.kind === "cox" || v.kind === "plot" ||
    (v.kind === "compare" && !!v.rows) || (v.kind === "hotspots" && !!v.hotspots) ||
    (v.kind === "coexpression" && !!v.coexpression) || (v.kind === "clinical" && !!v.clinical) ||
    (v.kind === "cooccurrence" && !!v.pairs) || (v.kind === "survival" && !!v.curves) ||
    ((v.kind === "sequence" || v.kind === "course") && !!v.svg) || (v.kind === "oncoprint" && !!v.spec);

  /** Drop one view from the document. Removing a view can't change any OTHER
   *  view's answer — each view's result depends only on its own definition
   *  and the cohort definitions it draws from, neither of which removal
   *  touches — so this splices `result.views` locally instead of re-running
   *  everything, the same way moveView (below) already does. */
  const removeView = (i: number) => {
    const views = (doc.views || []).filter((_: any, j: number) => j !== i);
    const d = { ...doc, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    syncUrl(undefined, d);
    if (!views.length) { setResult(null); return; }   // nothing left to show
    setResult(prev => prev ? { ...prev, views: prev.views.filter((_, j) => j !== i) } : prev);
    resultViewKeys.current = resultViewKeys.current.filter((_, j) => j !== i);
  };

  /** Swap a view with its neighbour. Order is cosmetic — the computed result for
   *  each view is unchanged, so this reorders `result.views` too rather than
   *  re-running the document just to move a card. */
  const moveView = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    const views = [...(doc.views || [])];
    if (j < 0 || j >= views.length) return;
    [views[i], views[j]] = [views[j], views[i]];
    const d = { ...doc, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    syncUrl(undefined, d);
    if (result) {
      const rviews = [...result.views];
      [rviews[i], rviews[j]] = [rviews[j], rviews[i]];
      setResult({ ...result, views: rviews });
      const rk = [...resultViewKeys.current];
      [rk[i], rk[j]] = [rk[j], rk[i]];
      resultViewKeys.current = rk;
    }
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
      : { kind, genes };
    const d = { ...doc, views: [v, ...(doc.views || [])] };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    syncUrl(undefined, d);
    // No prior result to keep the OTHER cards from — a fresh analysis's
    // very first view has nothing to diff against, so it needs a real run().
    if (!result) { run(d); return; }
    // Otherwise: every existing card already has a valid answer that adding
    // one more view doesn't change, so only the new view goes to the server.
    // resultViewKeys.current is kept in lockstep with doc.views right here,
    // synchronously, before the request even starts — see runViewDelta's
    // comment for why that matters once the response comes back.
    const key = keyFor(v);
    resultViewKeys.current = [key, ...resultViewKeys.current];
    setResult(prev => prev ? { ...prev, views: [{ kind: v.kind, pending: true } as any, ...prev.views] } : prev);
    runViewDelta(d, v);
  };

  const parseDraft = () => { try { const d = JSON.parse(cDefText); return d.all && d.all.length ? d : null; } catch { return null; } };

  /** attributes meeting a coverage bar, from the last unnarrowed response */
  /**
   * Which clinical facets are on screen. ONE definition, because this was two
   * copies — one computing the header's count, one filtering the render — and
   * they disagreed the moment a search box was added: the header read
   * "8 attributes" while all 20 were still drawn.
   *
   * The search matches an attribute's name AND the values inside it, so "lung"
   * finds Cancer Type by its contents when the reader does not know the
   * attribute's name. With 805 values in Cancer Type Detailed, scanning was the
   * weakest part of this page next to the portal's per-chart search.
   */
  const visibleClinical = (list: { attribute: string; displayName?: string; kind: string; studyCount?: number; values?: { v: string }[] }[]): typeof list => {
    const q = clinFilter.trim().toLowerCase();
    const coverageOk = (c: { studyCount?: number }) =>
      attrCoverage === 0 || (c.studyCount ?? 1) >= Math.ceil(attrCoverage * exStudies.length);
    const textOk = (c: { attribute: string; displayName?: string; kind: string; values?: { v: string }[] }) => !q ||
      (c.attribute || "").toLowerCase().includes(q) ||
      (c.displayName || "").toLowerCase().includes(q) ||
      (c.kind === "cat" && (c.values || []).some((v) => String(v.v).toLowerCase().includes(q)));
    return list.filter((c) => coverageOk(c) && textOk(c));
  };

  const attrsForBar = (bar: number, studiesOverride?: string[] | string): string[] => {
    if (bar <= 0 || !exFullAttrsRef.current.length) return [];
    const n = (studiesOverride ? (Array.isArray(studiesOverride) ? studiesOverride : [studiesOverride]) : exSel.current).length;
    return exFullAttrsRef.current.filter(a => a.studyCount >= Math.ceil(bar * n)).map(a => a.attribute);
  };

  const fetchExplore = async (draftOverride?: CohortDef | null, studiesOverride?: string[] | string, attrsOverride?: string[]) => {
    // Several independent triggers can ask for the same facets at once (a
    // ?tab=explore deep link, the tab button, and the catalog resolving the
    // default study selection all fire on load). exFetchSeq supersedes stale
    // RESULTS but does not stop duplicate REQUESTS, and each one is a full
    // faceting pass over ClickHouse — so identical work already in flight is
    // skipped rather than run twice and thrown away.
    const inflightKey = JSON.stringify([
      studiesOverride ?? exSel.current,
      draftOverride !== undefined ? draftOverride : parseDraft(),
      attrsOverride ?? attrsForBar(attrCoverage, studiesOverride),
      geneChartsRef.current,
      exExtraDerivedRef.current
    ]);
    if (exInflight.current === inflightKey) return;
    exInflight.current = inflightKey;
    // Ticking a facet makes the previous answer irrelevant, so stop paying for it. Discarding
    // the RESULT (exFetchSeq, below) was never enough: the abandoned pass kept running all
    // ~30 of its ClickHouse queries, and the answer the reader is waiting for queued behind
    // them. Measured at four clicks 250ms apart, that doubled the wait for the last one.
    exAbort.current?.abort();
    const ac = new AbortController();
    exAbort.current = ac;
    const seq = ++exFetchSeq.current; // a later call (or an emptied selection) supersedes this one
    setExploreBusy(true);
    try {
      const list = studiesOverride ? (Array.isArray(studiesOverride) ? studiesOverride : [studiesOverride]) : exSel.current;
      if (!list.length) { setExplore(null); exInflight.current = null; setExploreBusy(false); return; }
      const draft = draftOverride !== undefined ? draftOverride : parseDraft();
      const res = await fetch("/api/explore", { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studies: list, draft,
          // Narrow the server's work to the attributes that will actually be
          // shown. Only sent once a previous result has told us which those are.
          ...((attrsOverride ?? attrsForBar(attrCoverage, studiesOverride)).length
            ? { attributes: attrsOverride ?? attrsForBar(attrCoverage, studiesOverride) } : {}),
          ...(geneChartsRef.current.length ? { geneCharts: geneChartsRef.current } : {}),
          ...(exExtraDerivedRef.current.length ? { extraDerived: exExtraDerivedRef.current } : {}) }) });
      // 499 is this request being superseded server-side; it carries no body, and a newer
      // request already owns the page. Never parse it as JSON.
      if (res.status === 499 || seq !== exFetchSeq.current) return;
      const j = await res.json();
      if (seq !== exFetchSeq.current) return; // superseded while in flight — discard
      if (!j.error) {
        // Pin attribute order to the last selection-free response; see
        // attrOrderRef's own comment for why the server's live order can't
        // be trusted as-is once any facet is selected.
        const noSelection = !draft || !Array.isArray(draft.all) || !draft.all.length;
        if (noSelection) {
          attrOrderRef.current = (j.clinical || []).map((c: { per: string; attribute: string }) => c.per + "|" + c.attribute);
        } else if (attrOrderRef.current && j.clinical) {
          const order = attrOrderRef.current;
          const rank = (c: { per: string; attribute: string }) => {
            const i = order.indexOf(c.per + "|" + c.attribute);
            return i === -1 ? order.length : i;
          };
          j.clinical = [...j.clinical].sort((a: any, b: any) => rank(a) - rank(b));
        }
        setExplore(j);
        // only a response that was NOT narrowed can define the full vocabulary
        if (!(attrsOverride ?? []).length && !(attrCoverage > 0))
          exFullAttrsRef.current = (j.clinical || [])
            .map((c: { attribute: string; studyCount?: number }) => ({ attribute: c.attribute, studyCount: c.studyCount ?? 1 }));
      } else setError(j.error);
    } catch (e) {
      // An abort is this code superseding itself, not a failure to report.
      if ((e as Error)?.name !== "AbortError" && seq === exFetchSeq.current)
        setError(String((e as Error)?.message || e));
    } finally {
      // `finally`, because the early returns above leave through the middle of the try — a 499
      // on the newest request would otherwise leave the spinner running forever. Guarded on
      // seq so an abandoned pass never clears the flags out from under its replacement.
      if (seq === exFetchSeq.current) { exInflight.current = null; setExploreBusy(false); }
    }
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

  /** timeline event types this study's Explore facets actually have, folded by case */
  const exploreEventTypes = (): { canonical: string; label: string; n: number }[] => {
    const raw: { type: string; n: number }[] = (explore && explore.events) || [];
    const by = new Map<string, { canonical: string; label: string; n: number }>();
    for (const e of raw) {
      const c = String(e.type).trim().toLowerCase();
      if (!c) continue;
      const cur = by.get(c);
      if (cur) { cur.n += e.n; if (e.n > 0 && e.type.length < cur.label.length) cur.label = e.type; }
      else by.set(c, { canonical: c, label: e.type, n: e.n });
    }
    return [...by.values()].sort((a, b) => b.n - a.n);
  };
  /** the study's own best guess at "a therapy" — the same heuristic addView's sequence default uses */
  const treatmentEventType = (): { canonical: string; label: string } | null =>
    exploreEventTypes().find((e) => /treat|therap|regimen|drug|medicat/.test(e.canonical)) || null;

  // "lines" is not offered here: it is added automatically (see the effect
  // below) once a treatment-like event is detected, because it is cheap
  // enough to always compute (measured ~0-700ms on top of an Explore fetch
  // that already takes 0.7-3s) and answers exactly what the "Derived timeline
  // filters" card wants to show by default. "treatmentSpan" is a second,
  // separate query with a narrower audience, so it stays opt-in.
  const EXTRA_DERIVED_KINDS: { metric: "lines" | "treatmentSpan"; label: (name: string) => string }[] = [
    { metric: "treatmentSpan", label: (name) => "Time in '" + name + "' records" }
  ];
  const extraDerivedOn = (metric: string) => exExtraDerived.some((x) => x.metric === metric);
  const toggleExtraDerived = (metric: "lines" | "treatmentSpan") => {
    const tx = treatmentEventType();
    if (!tx) return;
    const next = extraDerivedOn(metric)
      ? exExtraDerived.filter((x) => x.metric !== metric)
      : [...exExtraDerived, { metric, eventType: tx.label, ...(metric === "lines" ? { lineGap: 90 } : {}) }];
    exExtraDerivedRef.current = next;
    setExExtraDerived(next);
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

  /**
   * The real, per-study "lines" bucket counts the "Derived timeline filters"
   * card shows are just the existing "lines" derived metric — the same one
   * "show more derivations" used to offer manually — kept in sync here
   * instead: the study's own event vocabulary (and so `treatmentEventType()`)
   * is only known once the FIRST Explore response lands, so this fires once
   * that response reveals a treatment-like event, and again whenever it
   * changes (switching studies). It is a no-op once `exExtraDerived` already
   * matches, so it does not loop and does not refetch on every narrowing
   * click — only on the transitions that actually change what "lines" means.
   */
  useEffect(() => {
    if (!explore) return;
    const tx = treatmentEventType();
    const current = exExtraDerivedRef.current;
    const inSync = tx
      ? current.some((x) => x.metric === "lines" && x.eventType === tx.label)
      : !current.some((x) => x.metric === "lines");
    if (inSync) return;
    const next = current.filter((x) => x.metric !== "lines");
    if (tx) next.push({ metric: "lines", eventType: tx.label, lineGap: 90 });
    exExtraDerivedRef.current = next;
    setExExtraDerived(next);
    fetchExplore();
  }, [explore]); // eslint-disable-line

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
    if (!ids.length) { exFetchSeq.current++; exAbort.current?.abort(); exInflight.current = null; setExplore(null); setExploreBusy(false); setExPanelOpen(true); return; } // empty selection: clear facets (and stop any in-flight fetch), keep the picker open
    exFetchTimer.current = setTimeout(() => fetchExplore(d.all!.length ? d : null, ids), 350);
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
    const key = studies.join(",");
    if (trackAttrs.key === key || trackAttrsWant.current === key) return;
    trackAttrsWant.current = key;
    setTrackAttrsLoading(true);
    Promise.all(studies.map(s =>
      fetch("/api/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ study: s }) })
        .then(r => r.json()).catch(() => null)))
      .then(js => {
        const seen = new Map<string, { kind: string; patients: number }>(); // attribute -> kind + how many carry it
        const profs = new Set<string>(); // continuous molecular profiles (for heatmap tracks)
        for (const j of js) if (j) {
          if (j.clinical) for (const a of j.clinical) {
            const prev = seen.get(a.attribute);
            seen.set(a.attribute, { kind: prev?.kind || a.kind, patients: (prev?.patients || 0) + (a.patients || 0) });
          }
          for (const p of j.profiles || []) if (p !== "cna") profs.add(p); // discrete cna isn't a heatmap
        }
        // most-covered first, the way the portal orders its picker
        if (trackAttrsWant.current !== key) return; // a newer study set was asked for meanwhile
        setTrackAttrs({ key, attrs: [...seen.entries()].map(([attribute, v]) => ({ attribute, ...v }))
          .sort((x, y) => y.patients - x.patients || (x.attribute < y.attribute ? -1 : 1)), profiles: [...profs].sort() });
      })
      .finally(() => { if (trackAttrsWant.current === key) setTrackAttrsLoading(false); });
  }, [result]); // eslint-disable-line

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

  /** Rewrite one view in the document and recompute just that one (see
   *  runViewDelta) — editing this view's settings can't change any OTHER
   *  view's answer, only its own. */
  const patchView = (i: number, patch: Record<string, unknown>) => {
    const views = (doc.views || []).map((v: any, j: number) => {
      if (j !== i) return v;
      const nv = { ...v, ...patch };
      // see updateView's comment: keyFor() is by object identity, and this always
      // makes a new object, so the edited view's own key must be carried over by
      // hand or the card being edited is the one that remounts.
      const k = viewKeys.current.get(v);
      if (k != null) viewKeys.current.set(nv, k);
      return nv;
    });
    for (const v of views as any[]) if (v.anchor == null) delete v.anchor;   // null means "study baseline"
    const d = { ...doc, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    syncUrl(undefined, d);
    runViewDelta(d, views[i]);
  };

  // the creator's quick-add row needs the study catalog even before Explore is visited
  useEffect(() => {
    if (tab === "cohorts" && !explore && !exploreBusy && exStudies.length) fetchExplore(null);
  }, [tab, study, explore]); // eslint-disable-line

  const updateView = (vi: number, patch: (v: any) => any) => {
    const views = (doc.views || []).map((v, i: number) => {
      if (i !== vi) return v;
      const nv = patch(v);
      // keyFor() looks up a view by object identity, and `patch` always returns a
      // new object — carry the old one's key over, or every edit (a checkbox, a
      // gene, an anchor) would read as "this view is gone, a new one appeared" and
      // remount the very card being edited: closing any open menu on it, and
      // dropping the oncoprint canvas it had already drawn.
      const k = viewKeys.current.get(v);
      if (k != null) viewKeys.current.set(nv, k);
      return nv;
    });
    const d = { ...doc, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    syncUrl(undefined, d);
    runViewDelta(d, views[vi]);
  };

  /**
   * A view change the browser can apply itself — how the oncoprint is drawn, not what it
   * draws. The document and the URL still record it, so the link, the server SVG, the CLI
   * and the Python package reproduce the same figure; only the round trip is skipped.
   */
  const updateViewLocal = (vi: number, patch: (v: any) => any) => {
    const views = (doc.views || []).map((v, i: number) => i === vi ? patch(v) : v);
    const d = { ...doc, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); syncUrl(undefined, d);
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
    // Only ever prefills with the workspace's OWN name, if it already has
    // one — never a cohort name or a generic fallback standing in for a
    // real name, which read as though the app had already named it for you.
    // An untitled workspace opens to an empty field with just the
    // placeholder text.
    setWsName(doc.title || "");
    setDraftFilled(!!(doc.title || "").trim()); setDraftGen((g) => g + 1);
    wsDialog.current?.showModal();
  };
  const confirmWorkspaceSave = async () => {
    const name = wsDraft.current.trim();
    if (!name) return;
    wsDialog.current?.close();
    const d = { ...doc, title: name };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    setWsError(null);
    try {
      await persistSpaces(name, d);
    } catch (e) { setWsError("could not save: " + String((e as Error)?.message || e)); }
  };
  const openWorkspace = (name: string) => {
    const w = spaces[name];
    if (!w) return;
    const d = w.doc;
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    setResult(null); setError(null);
    if (d.study) setStudy(d.study);
    goTab("analysis");
    run(d);
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
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); run(d);
  };
  /** Change one parameter and re-run — the whole point of a template. */
  const setParam = (key: string, value: unknown) => {
    const d = { ...doc, params: { ...(doc.params || {}), [key]: value } };
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); run(d);
  };
  const setNotes = (text: string) => {
    const d = { ...doc, notes: text };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));   // no re-run: prose changes no numbers
  };

  const openGenes = (vi: number) => { setGenesFor(vi); genesDialog.current?.showModal(); };
  /**
   * Which cohorts a view draws. Absent means all of them, so ticking every cohort removes the
   * field rather than freezing today's list into the document.
   */
  const setViewCohorts = (vi: number, names: string[], all: string[]) => updateView(vi, (v: any) => {
    const next = { ...v };
    if (names.length && names.length < all.length) next.cohorts = all.filter((n) => names.includes(n));
    else delete next.cohorts;
    return next;
  });
  const setViewAttrs = (vi: number, attributes: string[]) => updateView(vi, (v: any) => ({ ...v, attributes }));

  const setViewGenes = (vi: number, genes: GeneTrackSpec[]) =>
    updateView(vi, v => pruneSort({ ...v, genes }));

  /** replace a merged row with its members, in place — the figure's "expand", written to the document */
  const splitGeneTrack = (vi: number, label: string) => {
    const list = (((doc.views || [])[vi] || {}) as any).genes || [];
    const out: GeneTrackSpec[] = [];
    for (const e of list) {
      const members = e && typeof e === "object" ? (e.genes || []).map((g: string) => String(g).toUpperCase()) : null;
      if (members && geneRowLabel(e) === label) out.push(...members); else out.push(e);
    }
    // the same gene may already be drawn on its own; expanding must not create two rows with one name
    setViewGenes(vi, out.filter((e, i) => typeof e !== "string" || out.indexOf(e) === i));
  };

  function GeneEditor({ vi }: { vi: number }) {
    const [add, setAdd] = useState("");
    const [text, setText] = useState<string | null>(null);
    const [textErr, setTextErr] = useState<string | null>(null);
    // Read the DOCUMENT's view, never the result. A ViewResult also has a
    // `genes` field, but it holds {gene, driverPct, anyPct} objects for the
    // oncoprint and nothing at all for compare — reading it left the editor
    // empty and made "add" replace the real list rather than extend it.
    const spec: any = (doc.views || [])[vi] || {};
    const list: GeneTrackSpec[] = spec.genes || [];
    // a list that cannot be read is still editable as text, which is how it gets fixed
    let rows: { label: string; members: string[] }[] = [];
    let listErr: string | null = null;
    try { rows = normalizeGeneTracks(list).tracks; } catch (e) { listErr = String((e as Error).message || e); }
    const symbols = geneSymbols(list);
    // Co-occurrence and co-expression are pairwise: one gene yields no pairs, so
    // the last two cannot be removed without the view becoming an error.
    const floor = (spec.kind === "cooccurrence" || spec.kind === "coexpression") ? 2 : 1;
    // merged rows are an oncoprint idea; every other view flattens them to their members
    const merges = spec.kind === "oncoprint";
    const drop = (label: string) => setViewGenes(vi, list.filter((e) =>
      (typeof e === "string" ? e.toUpperCase() : (e.label || (e.genes || []).join(" / "))) !== label));
    const commit = () => {
      const g = add.trim().toUpperCase();
      if (!g || symbols.includes(g)) { setAdd(""); return; }
      setViewGenes(vi, [...list, g]);
      setAdd("");
    };
    const applyText = () => {
      try { setViewGenes(vi, parseGeneList(text || "")); setTextErr(null); setText(null); }
      catch (e) { setTextErr(String((e as Error).message || e)); }
    };
    return (
      <div className="setcol">
        <span className="meta">{rows.length} of 12 rows{merges && symbols.length !== rows.length ? " · " + symbols.length + " genes" : ""} — click one to remove it</span>
        {listErr && <span className="mark">{listErr}</span>}
        <div className="pillwrap">
          {rows.map(r => (
            <span key={r.label} className={r.members.length > 1 ? "pill-merged" : undefined}>
              <button type="button" className="pill" disabled={busy || rows.length <= floor}
                title={rows.length <= floor
                  ? (floor === 2 ? "this view compares pairs, so it needs at least two genes" : "a view needs at least one gene")
                  : r.members.length > 1 ? "remove this merged row (" + r.members.join(", ") + ")" : "remove " + r.label}
                onClick={() => drop(r.label)}>
                {r.label} <span aria-hidden="true">×</span>
              </button>
              {merges && r.members.length > 1 && (
                <button type="button" className="linklike" disabled={busy} style={{ fontSize: "var(--t-sm)", marginLeft: "0.2rem" }}
                  title="draw each of these genes as its own row" onClick={() => splitGeneTrack(vi, r.label)}>split</button>
              )}
            </span>
          ))}
        </div>
        <div className="setrow">
          <input list="view-genes" placeholder="add a gene…" value={add} disabled={busy || rows.length >= 12}
            onChange={e => setAdd(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
          <button type="button" className="facet" disabled={busy || !add.trim() || rows.length >= 12}
            onClick={commit}>add</button>
        </div>
        {merges && (
          <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && text === null) setText(formatGeneList(list)); }}>
            <summary className="meta">edit as text — cBioPortal&apos;s gene list, where <code>[TP53 MDM2]</code> is one merged row</summary>
            <div className="setcol" style={{ marginTop: "0.3rem" }}>
              <textarea value={text ?? formatGeneList(list)} spellCheck={false} rows={3} disabled={busy}
                onChange={(e) => setText(e.target.value)} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: "var(--t-md)" }} />
              <div className="setrow">
                <button type="button" className="facet" disabled={busy} onClick={applyText}>apply</button>
                <button type="button" className="linklike" onClick={() => { setText(formatGeneList(list)); setTextErr(null); }}>reset</button>
                <span className="meta">a label is optional: <code>[&quot;TP53 pathway&quot; TP53 MDM2]</code></span>
              </div>
              {textErr && <span className="mark">{textErr}</span>}
            </div>
          </details>
        )}
      </div>
    );
  }

  /**
 * One axis of a plot. The source decides what else is asked for: a clinical attribute, a gene
 * in a molecular profile, or a gene's alterations. It is the same vocabulary the engine uses,
 * so what the reader picks is what the document says.
 */
function AxisPicker({ side, axis, attrs, profiles, busy, loading, onChange, allowNone, categorical }: {
  side: string; axis: any; busy?: boolean;
  attrs: { attribute: string; kind: string }[]; profiles: string[];
  /** the attribute/profile catalog is still being fetched: its select waits with a loader */
  loading?: boolean;
  onChange: (a: any) => void;
  /** a colour is optional in a way an axis is not */
  allowNone?: boolean;
  /** colours come from categories, so a molecular value is not on offer */
  categorical?: boolean;
}) {
  const a = axis || {};
  const src = axis ? (a.source || "clinical") : "none";
  const set = (next: any) => onChange(next);
  return (
    <span className="axispick">
      <span className="tbl">{side}</span>
      <select value={src} disabled={busy} title="what this axis measures"
        onChange={(e) => {
          const s = e.target.value;
          // Keep whatever this axis last held for each source (spreading `a` rather than
          // starting fresh), so switching away and back round-trips instead of always
          // reverting to the catalog's first entry — a molecular axis already did this for
          // its gene; clinical's attribute and molecular's profile now do too.
          set(s === "none" ? undefined
            : s === "clinical" ? { ...a, source: "clinical", attribute: a.attribute || (attrs[0] || {}).attribute || "" }
            : s === "molecular" ? { ...a, source: "molecular", profileType: a.profileType || profiles[0] || "", gene: a.gene || "TP53" }
            : { ...a, source: "alteration", gene: a.gene || "TP53", by: a.by || "mutationType" });
        }}>
        {allowNone && <option value="none">none</option>}
        <option value="clinical">clinical</option>
        {!categorical && <option value="molecular">molecular</option>}
        <option value="alteration">alteration</option>
      </select>
      {src === "clinical" && loading && !attrs.length && <Waiting what="attributes" />}
      {src === "clinical" && !(loading && !attrs.length) && (
        <select value={a.attribute || ""} disabled={busy} title="which clinical attribute"
          onChange={(e) => set({ ...a, attribute: e.target.value })}>
          {!attrs.some((x) => x.attribute === a.attribute) && <option value={a.attribute || ""}>{a.attribute || "(none)"}</option>}
          {attrs.map((x) => <option key={x.attribute} value={x.attribute}>{x.attribute}{x.kind === "num" ? "" : " (categorical)"}</option>)}
        </select>
      )}
      {src === "molecular" && <>
        {loading && !profiles.length ? <Waiting what="profiles" /> :
        <select value={a.profileType || ""} disabled={busy} title="which molecular profile"
          onChange={(e) => set({ ...a, profileType: e.target.value })}>
          {!profiles.includes(a.profileType || "") && <option value={a.profileType || ""}>{a.profileType || "(none)"}</option>}
          {profiles.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
        </select>}
        <GeneInput gene={a.gene || ""} busy={busy} onCommit={(gene) => set({ ...a, gene })} />
      </>}
      {src === "alteration" && <>
        <GeneInput gene={a.gene || ""} busy={busy} onCommit={(gene) => set({ ...a, gene })} />
        <select value={a.by || "mutationType"} disabled={busy} title="how the gene's alterations are grouped"
          onChange={(e) => set({ ...a, by: e.target.value })}>
          <option value="mutationType">mutation type</option>
          <option value="mutated">mutated vs not</option>
          <option value="cna">copy number</option>
        </select>
      </>}
    </span>
  );
}

/**
 * A gene name typed into a plot axis, debounced before it reaches the document/URL. Committing
 * on every keystroke (as the rest of this axis picker does for selects) meant an in-progress
 * edit — including the empty string between deleting the old gene and typing the new one —
 * briefly became the shareable link, which the compiler then rejects ("a molecular axis needs
 * one gene"). A short pause before committing keeps that mid-edit state local to the input.
 */
function GeneInput({ gene, busy, onCommit }: { gene: string; busy?: boolean; onCommit: (gene: string) => void }) {
  const [draft, setDraft] = useState(gene);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(gene), [gene]);
  const commit = (v: string) => { if (timer.current) clearTimeout(timer.current); onCommit(v); };
  return (
    <input className="axisgene" value={draft} disabled={busy} placeholder="gene"
      onChange={(e) => {
        const v = e.target.value.toUpperCase();
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onCommit(v), 500);
      }}
      onBlur={() => commit(draft)} />
  );
}

/**
 * A gearmenu's open/closed state, keyed by a caller-chosen id, read from a
 * store the page keeps in a ref (see `menuOpenRef` in AnalysisPage) rather
 * than in this module's own top-level state. An edit to the very view a menu
 * belongs to (ticking a cohort, changing an anchor — anything that runs
 * updateView/patchView) makes Next.js re-evaluate this whole module — a
 * plain module-level Map would be a fresh, empty one on the next read, same
 * as every function declared here, ViewHead and PickMenu included, being a
 * new object each time. A `useRef` on the page's own component survives
 * that (its hooks live on the fiber, not on this module), which is also why
 * `doc`/`result`/etc. were never at risk — only bindings that live at this
 * module's top level are.
 *
 * A native `<details>` has no memory of its own across a remount like that,
 * so without this it silently reopens closed the moment you interact with
 * something inside it. This restores it synchronously before the browser
 * paints, so the close is never visible, and stays current on every
 * open/close however it happens — a click on the summary, or
 * PopoverAutoClose's outside-click/Escape handler, both fire the same
 * native "toggle" event this listens for.
 */
function useGearmenuOpen(id: string, store: Map<string, boolean>) {
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (store.get(id) && ref.current) ref.current.open = true;
  }, [id, store]);
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => store.set(id, e.currentTarget.open);
  return { ref, onToggle };
}

/**
 * A checkbox menu in a view's header: which cohorts it uses, which attributes it compares.
 * One component, because these were the settings you could only reach by editing the JSON.
 */
function PickMenu({ label, title, options, chosen, onChange, min, max, busy, loading, menuId, menuStore }: {
  label: string; title: string; busy?: boolean; min?: number; max?: number; menuId: string; menuStore: Map<string, boolean>;
  /** the options are still being fetched */
  loading?: boolean;
  options: { value: string; label: string; hint?: string }[];
  chosen: string[]; onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    const has = chosen.includes(v);
    if (has && min != null && chosen.length <= min) return;
    onChange(has ? chosen.filter((x) => x !== v) : [...chosen, v]);
  };
  const { ref, onToggle } = useGearmenuOpen(menuId, menuStore);
  return (
    <details className="gearmenu" ref={ref} onToggle={onToggle}>
      <summary className="tbbtn" title={title}>{label} ({chosen.length}){loading && !options.length && <span className="spinner" />}</summary>
      <div className="gearmenu-items">
        {options.length === 0 && (loading ? <Waiting what={label} /> : <span className="meta">nothing to choose from</span>)}
        {options.map((o) => {
          const on = chosen.includes(o.value);
          const stuck = on ? (min != null && chosen.length <= min) : (max != null && chosen.length >= max);
          return (
            <label key={o.value} className="chk" title={stuck ? (on ? "a view needs at least " + min : "at most " + max) : undefined}>
              <input type="checkbox" checked={on} disabled={busy || stuck} onChange={() => toggle(o.value)} />
              {o.label}{o.hint && <span className="meta"> — {o.hint}</span>}
            </label>
          );
        })}
      </div>
    </details>
  );
}

/**
 * Every view's header, with one anatomy: the title and what it is, then the actions that
 * belong to this view, then its status chips, then the controls that reorder and remove it.
 * Before this each view kind built its own, so the timing chip landed in a different place
 * in each card.
 */
function ViewHead({ v, title, sub, actions, chips, cohorts, onMoveUp, onMoveDown, onRemove, onEditNote, menuStore }: {
  v: any; title: string; sub?: React.ReactNode; actions?: React.ReactNode; chips?: React.ReactNode;
  onMoveUp?: () => void; onMoveDown?: () => void; onRemove?: () => void; onEditNote?: () => void; menuStore: Map<string, boolean>;
  /** which cohorts this view draws; absent when the document has only one */
  cohorts?: { chosen: string[]; all: string[]; max?: number; busy?: boolean; viewKey: number | string; onChange: (n: string[]) => void };
}) {
  const menuKey = cohorts?.viewKey ?? "vh";
  return (
    <>
      <div className="vhead">
        <h2 className="vtitle">{title}{sub != null && <span className="plain"> — {sub}</span>}</h2>
        <div className="vmeta">
          {cohorts && cohorts.all.length > 1 && (
            <PickMenu label="cohorts" title="which cohorts this view draws; all of them unless you say otherwise"
              options={cohorts.all.map((n) => ({ value: n, label: n }))} chosen={cohorts.chosen}
              onChange={cohorts.onChange} min={1} max={cohorts.max} busy={cohorts.busy} menuId={"pick:" + menuKey} menuStore={menuStore} />
          )}
          {actions}
          {chips}
          <Latency v={v} />
          <Participation p={v.participation} />
          {(onMoveUp || onMoveDown || onRemove || onEditNote) && (
            <ViewMenu menuId={"reorder:" + menuKey} menuStore={menuStore} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
              onRemove={onRemove} onEditNote={onEditNote} hasNote={!!v.annotationNote} />
          )}
        </div>
      </div>
      {/* The analyst's own one-line annotation (doc.views[i].note, echoed
          through as v.annotationNote) — below the title, not above: it's a
          reader's aside about the figure ViewHead just named, not something
          that competes with the title for the first thing read. Plain text
          by design, see .viewnote in globals.css for why it's never markdown. */}
      {v.annotationNote && <p className="viewnote">{v.annotationNote}</p>}
    </>
  );
}

/** The gear at the end of every card's header: reorder this view, or drop it. */
function ViewMenu({ menuId, menuStore, onMoveUp, onMoveDown, onRemove, onEditNote, hasNote }: {
  menuId: string; menuStore: Map<string, boolean>; onMoveUp?: () => void; onMoveDown?: () => void; onRemove?: () => void;
  onEditNote?: () => void; hasNote?: boolean;
}) {
  const { ref, onToggle } = useGearmenuOpen(menuId, menuStore);
  return (
    <details className="gearmenu" ref={ref} onToggle={onToggle}>
      <summary className="tbbtn" title="reorder or remove this view" aria-label="reorder or remove this view">⋯</summary>
      <div className="gearmenu-items">
        <button className="linklike" disabled={!onMoveUp} onClick={onMoveUp}>move up</button>
        <button className="linklike" disabled={!onMoveDown} onClick={onMoveDown}>move down</button>
        {/* a note belongs to a saved analysis, as a cohort's edits do (see CohortEditMenu), so the
            item only exists once there is a saved analysis for it to belong to */}
        {onEditNote && analysisSaved && <>
          <hr />
          <button className="linklike" onClick={onEditNote}>{hasNote ? "edit note…" : "add note…"}</button>
        </>}
        {onRemove && <>
          <hr />
          <button className="linklike" onClick={onRemove}>remove</button>
        </>}
      </div>
    </details>
  );
}

/**
 * The gear at the top-right of a cohort box: rename it, note it, or drop it
 * from the analysis — "edit…" opens a small dialog for the name and note
 * together (see cohortEditDialog), rather than a form crammed into this
 * dropdown. "edit…" is left OUT of the menu entirely (not just disabled)
 * until the workspace itself is saved: a rename/note on a cohort inside a
 * document that isn't saved anywhere yet has nothing to attach to, and a
 * greyed-out option in an otherwise-live menu reads as broken rather than
 * as "do something else first". Editing the FILTERS themselves isn't here
 * yet — a cohort's clauses come from Explore or hand-typed JSON, and
 * neither has a form this menu could hold; see the comment above the
 * "Cohorts" heading for why that is deliberately a separate, unscoped piece
 * of work.
 */
function CohortEditMenu({ busy, canEdit, onEdit, onRemove, menuId, menuStore }: {
  busy?: boolean; canEdit: boolean; onEdit: () => void; onRemove: () => void;
  menuId: string; menuStore: Map<string, boolean>;
}) {
  const { ref, onToggle } = useGearmenuOpen(menuId, menuStore);
  return (
    <details className="gearmenu cohortgear" ref={ref} onToggle={onToggle}>
      <summary className="tbbtn" title="edit this cohort" aria-label="edit this cohort">⋯</summary>
      <div className="gearmenu-items">
        {canEdit && <>
          <button className="linklike" disabled={busy} onClick={onEdit}>edit…</button>
          <hr />
        </>}
        <button className="linklike" disabled={busy} onClick={onRemove}>remove this cohort</button>
      </div>
    </details>
  );
}

/** the server-side wall clock for one view, and what that number does and does not include */
function Latency({ v }: { v: any }) {
  if (v.ms == null) return null;
  return (
    <span className="lat" title={
      "Server-side wall-clock for this view. Its queries run concurrently, so this is not their sum, and it excludes rendering in your browser." +
      (v.renderMs != null ? "\n\n" + (v.ms - v.renderMs).toLocaleString() + "ms querying · " + v.renderMs.toLocaleString() + "ms drawing the SVG on the server." : "")}>
      {v.ms.toLocaleString()}ms
      {v.renderMs != null && <span className="latsplit"> ({(v.ms - v.renderMs).toLocaleString()} + {v.renderMs.toLocaleString()} draw)</span>}
    </span>
  );
}

  /** the document's view at vi, whatever its kind */
  const docView = (vi: number): any => ((doc.views || [])[vi] || {});

  /** what a view's cohort picker needs: today's choice, everything on offer, and where to write it */
  const cohortChoice = (vi: number, v: any, max?: number) => {
    const all = Object.keys((result && result.cohorts) || doc.cohorts || {});
    const chosen: string[] = Array.isArray(v.cohorts) && v.cohorts.length ? v.cohorts.filter((n: string) => all.includes(n)) : all;
    return { chosen, all, max, busy, viewKey: resultViewKeys.current[vi] ?? vi, onChange: (next: string[]) => setViewCohorts(vi, next, all) };
  };

  /** the view at index vi, read as an oncoprint view (its editor only renders there) */
  const ocView = (vi: number): OncoprintView => ((doc.views || [])[vi] || {}) as OncoprintView;

  const heatmapLabels = (v: any): string[] => (v.heatmap || []).flatMap((h: any) =>
    (h.genes && h.genes.length ? h.genes : v.genes || []).map((g: any) => heatmapTrackLabel(String(g).toUpperCase(), h.profileType)));

  // a sort key as the <select> spells it: "label" / "-label" / "genomic"
  const sortKeyText = (k: any): string =>
    k == null ? "genomic" : typeof k === "string" ? k : (k.dir === "desc" ? "-" : "") + String(k.track || "genomic");
  const pruneSort = (v: any) => {
    // drop sort keys whose track no longer exists
    const keep = new Set(["genomic", "id", "Study", ...(v.clinical || []), ...heatmapLabels(v)]);
    const sort = (v.sort || []).filter((s: any) => keep.has(sortKeyText(s).replace(/^-/, "")));
    if (sort.length) v.sort = sort; else delete v.sort;
    return v;
  };

  const setViewClinical = (vi: number, attrs: string[]) => updateView(vi, v => pruneSort({ ...v, clinical: attrs }));

  const setViewHeatmap = (vi: number, entries: any[]) => updateView(vi, v => {
    const next = { ...v };
    if (entries.length) next.heatmap = entries; else delete next.heatmap;
    return pruneSort(next);
  });

  /** the figure sorts in the browser, so this records the choice without re-running */
  const setViewSort = (vi: number, keys: string[]) => updateViewLocal(vi, v => {
    if (!keys.length) { const { sort, ...rest } = v; return rest; }
    return { ...v, sort: keys.slice(0, 4) };
  });

  /** how many rows a view's gene list draws, for the button that opens the editor */
  const geneRowCount = (v: any): number => { try { return normalizeGeneTracks(v.genes || []).tracks.length; } catch { return (v.genes || []).length; } };

  /** the row a gene-list entry draws, which is the label the figure sends back */
  const geneRowLabel = (e: GeneTrackSpec): string => typeof e === "string" ? e.toUpperCase()
    : (e.label || (e.genes || []).map((g) => String(g).toUpperCase()).join(" / "));

  /**
   * A track's label back to the thing that produced it. Gene tracks are the view's genes,
   * heatmap tracks belong to a profile, everything else is a clinical attribute.
   */
  const trackOwner = (v: any, label: string): "genes" | "clinical" | "heatmap" | null => {
    if ((v.genes || []).some((g: GeneTrackSpec) => geneRowLabel(g) === label)) return "genes";
    if ((v.clinical || []).includes(label)) return "clinical";
    if (heatmapLabels(v).includes(label)) return "heatmap";
    return null;
  };
  const moveTrack = (vi: number, label: string, dir: -1 | 1) => updateView(vi, (v: any) => {
    const owner = trackOwner(v, label);
    if (!owner) return v;
    const list = owner === "genes" ? (v.genes || []).map((g: string) => String(g)) : owner === "clinical" ? [...(v.clinical || [])] : null;
    if (!list) return v;   // heatmap tracks follow their profile's gene list
    const i = list.findIndex((x: string) => (owner === "genes" ? geneRowLabel(x) : x) === label);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return v;
    [list[i], list[j]] = [list[j], list[i]];
    return owner === "genes" ? { ...v, genes: list } : { ...v, clinical: list };
  });
  const removeTrack = (vi: number, label: string) => updateView(vi, (v: any) => {
    const owner = trackOwner(v, label);
    if (owner === "genes") {
      const genes = (v.genes || []).filter((g: GeneTrackSpec) => geneRowLabel(g) !== label);
      return genes.length ? pruneSort({ ...v, genes }) : v;   // a figure needs at least one gene
    }
    if (owner === "clinical") return pruneSort({ ...v, clinical: (v.clinical || []).filter((a: string) => a !== label) });
    if (owner === "heatmap") {
      const heatmap = (v.heatmap || []).filter((h: any) => !heatmapLabels({ ...v, heatmap: [h] }).includes(label));
      const next = { ...v }; if (heatmap.length) next.heatmap = heatmap; else delete next.heatmap;
      return pruneSort(next);
    }
    return v;
  });

  /** set or clear one display option on a view, keeping the document free of defaults */
  const setDisplayKey = (v: any, key: string, value: unknown) => {
    const display: any = { ...(v.display || {}) };
    if (value === undefined) delete display[key]; else display[key] = value;
    const next = { ...v };
    if (Object.keys(display).length) next.display = display; else delete next.display;
    return next;
  };

  /** viewing options as the figure wants them, defaulted from the document */
  const figureDisplay = (v: any): FigureDisplay => ({ ...DEFAULT_FIGURE_DISPLAY, ...(v.display || {}) });
  /** which display keys the figure owns, and therefore writes back without a re-run */
  const FIGURE_KEYS = new Set(["showUnaltered", "whitespace", "gaps", "colorByType", "colors", "whiteBackground"]);
  const setViewDisplay = (vi: number, d: FigureDisplay) => updateViewLocal(vi, v => {
    // keep the document tidy: only options that differ from the default are written down
    const display: any = { ...(v.display || {}) };
    for (const k of FIGURE_KEYS) {
      const val = (d as any)[k], dflt = (DEFAULT_FIGURE_DISPLAY as any)[k];
      if (val === undefined || val === dflt) delete display[k]; else display[k] = val;
    }
    const next = { ...v };
    if (Object.keys(display).length) next.display = display; else delete next.display;
    return next;
  });

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
      const res = await fetch("/api/oncoprint/patients-of", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study: one, samples: ids }) });
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
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    run(d);
  };

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

  const openCohortEdit = (name: string) => {
    setCohortEditing(name);
    setCeName(name);
    setCeNotes(doc.cohorts?.[name]?.notes || "");
    setDraftFilled(!!name.trim()); setDraftGen((g) => g + 1);
    setCeError(null);
    cohortEditDialog.current?.showModal();
  };

  /** Rename a cohort and/or change its note, from the gear menu's "edit…" dialog.
   *  Renaming rewrites every `view.cohorts` reference too, so a view already
   *  scoped to this cohort keeps drawing it under its new name — and since
   *  the server keys everything (result.cohorts, every row/curve) by name,
   *  a rename needs a real run(), unlike a note-only edit, which changes no
   *  number and so never re-runs (matching what a plain note edit did before
   *  this had its own dialog). */
  const confirmCohortEdit = () => {
    if (!cohortEditing) return;
    const oldName = cohortEditing;
    const newName = ceNameDraft.current.trim();
    if (!newName) return;
    if (newName !== oldName && doc.cohorts?.[newName]) {
      setCeError("a cohort named “" + newName + "” already exists");
      return;
    }
    cohortEditDialog.current?.close();
    const nextCohorts: Record<string, CohortDef> = {};
    for (const [k, v] of Object.entries(doc.cohorts || {})) {
      nextCohorts[k === oldName ? newName : k] = k === oldName ? { ...v, notes: ceNotesDraft.current } : v;
    }
    if (newName === oldName) {
      // a note-only edit re-runs nothing, so nothing else would put it in the shareable link
      const d = { ...doc, cohorts: nextCohorts };
      setDoc(d); setDocText(JSON.stringify(d, null, 2)); syncUrl(undefined, d);
      return;
    }
    const views = (doc.views || []).map(v => Array.isArray(v.cohorts)
      ? { ...v, cohorts: v.cohorts.map(c => c === oldName ? newName : c) }
      : v);
    const d = { ...doc, cohorts: nextCohorts, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    run(d);
  };

  /** the analysis exists as a saved workspace — what a view's note, like a cohort's, belongs to */
  const analysisSaved = !!(doc.title && spaces[doc.title]);
  const openViewNoteEdit = (vi: number) => {
    if (!analysisSaved) return;
    setViewNoteEditing(vi);
    setVnText((doc.views || [])[vi]?.note || "");
    setDraftGen((g) => g + 1);
    viewNoteDialog.current?.showModal();
  };

  /** A view's note is exactly like a cohort's or the workspace's: prose the
   *  server never computes anything from, so this never re-runs — it patches
   *  `doc.views[vi].note` (what gets saved/shared) AND mirrors the same text
   *  straight into `result.views[vi].annotationNote` (what ViewHead actually
   *  reads to display it), since nothing else would otherwise tell the
   *  already-rendered card that its own annotation changed. */
  const confirmViewNoteEdit = () => {
    if (viewNoteEditing == null) return;
    const vi = viewNoteEditing;
    viewNoteDialog.current?.close();
    const trimmed = vnDraft.current.trim();
    const views = (doc.views || []).map((v: any, i: number) => {
      if (i !== vi) return v;
      const nv = { ...v };
      if (trimmed) nv.note = trimmed; else delete nv.note;
      const k = viewKeys.current.get(v);
      if (k != null) viewKeys.current.set(nv, k);
      return nv;
    });
    const d = { ...doc, views };
    // no re-run follows, so the link has to be told here or the note is lost on refresh/share
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); syncUrl(undefined, d);
    setResult(prev => {
      if (!prev || !prev.views[vi]) return prev;
      const rviews = [...prev.views];
      rviews[vi] = { ...rviews[vi], annotationNote: trimmed || undefined };
      return { ...prev, views: rviews };
    });
  };

  /**
   * The "split by gene" shortcut for cumulative-incidence/KM-by-genotype: define the two
   * cohorts an analyst would otherwise hand-write (mutant, and its DSL complement) and point
   * the given survival view at them, replacing whatever cohorts it named before.
   */
  const splitSurvivalByGene = (vi: number, gene: string) => {
    const taken = new Set(Object.keys(doc.cohorts || {}));
    const uniq = (base: string) => { let n = base, i = 2; while (taken.has(n)) n = base + " " + i++; taken.add(n); return n; };
    const mutName = uniq(gene + "-mutant"), wtName = uniq(gene + "-wildtype");
    const cohorts = { ...doc.cohorts,
      [mutName]: { all: [{ kind: "oql", q: gene + ": MUT" } as const] },
      [wtName]: { all: [{ not: { kind: "oql", q: gene + ": MUT" } } as const] } };
    const views = (doc.views || []).map((v: any, j: number) => j === vi ? { ...v, cohorts: [mutName, wtName] } : v);
    const d = { ...doc, cohorts, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2));
    run(d);
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
    // refused rather than cut to the first sixteen: the reader ticked these, so analysing some
    // of them without saying which would answer a different question than the one asked
    if (chosen.length > 16) {
      setError("an analysis takes at most 16 cohorts; " + chosen.length + " are ticked — untick " + (chosen.length - 16) + " and analyse again");
      return;
    }
    const nd: AnalysisDoc = { study, cohorts: Object.fromEntries(chosen), views: DEFAULT_VIEWS };
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

  // Accepts the authored form: this only serialises, and a template is exactly
  // what you want to share when the point is that it can be re-pointed.
  const docLink = (d: AnalysisDoc | TemplateDoc): string =>
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
    const lastEval = ev && ev.count != null ? { count: ev.count } : null;
    try { await persist(ex.name, ex.def, lastEval); } catch { /* the Examples tab has no error banner of its own */ }
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


  return (
    <>
      <header>
        <h1>cbio-lab</h1>
        <span className="sub">analysis documents — cohorts and views over one declarative object</span>
        <span className="spacer" />
        <a href="/rationale" style={{ color: "var(--accent-ink)", fontSize: "var(--t-md)" }}>rationale</a>
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
        {/* The workspace editor: name, parameters, notes, and what to do with
            it, all behind the "Save workspace" button on the Analysis tab.
            Used to be a permanent card there; a dialog is read when setting
            the workspace up, not while reading the figures it describes. */}
        <dialog ref={wsDialog} className="namedialog wsdialog"
          onClose={() => setWsName("")}
          onClick={e => { if (e.target === wsDialog.current) wsDialog.current?.close(); }}>
          <form method="dialog" onSubmit={e => { e.preventDefault(); confirmWorkspaceSave(); }}>
            <h3>{doc.title && spaces[doc.title] ? "Workspace" : "Save workspace"}</h3>
            <p className="meta">
              {(doc.views || []).length} view{(doc.views || []).length === 1 ? "" : "s"}
              {doc.params ? " · " + Object.keys(doc.params).length + " parameter" + (Object.keys(doc.params).length === 1 ? "" : "s") : ""}
              {!doc.title || !spaces[doc.title]
                ? " · not saved yet"
                : JSON.stringify(spaces[doc.title].doc) !== JSON.stringify(doc)
                  ? " · unsaved changes"
                  : " · saved " + spaces[doc.title].savedAt}
            </p>
            <DraftText key={draftGen} draft={wsDraft} initial={wsName} onFilled={setDraftFilled} autoFocus placeholder="workspace name…" />

            {doc.params && Object.keys(doc.params).length > 0 ? (
              <div className="params" style={{ marginTop: "0.7rem" }}>
                <div className="row" style={{ alignItems: "baseline" }}>
                  <strong style={{ fontSize: "var(--t-md)" }}>Parameters</strong>
                  <span className="meta">— change one here and every view that uses it re-runs</span>
                </div>
                {Object.entries(doc.params).map(([k, v]) => (
                  <ParamRow key={k} name={k} value={v} busy={busy} onChange={val => setParam(k, val)} />
                ))}
                {result?.unusedParams?.length ? (
                  <p className="note" style={{ margin: "0.3rem 0 0" }}>
                    Declared but never used: {result.unusedParams.map(x => "$" + x).join(", ")} — usually a
                    rename that missed a reference.
                  </p>
                ) : null}
              </div>
            ) : (doc.views || []).length > 0 && (
              <p className="note" style={{ margin: "0.7rem 0 0" }}>
                No parameters yet — “make a template” beside the document lifts the study and a
                shared gene list out, so this workup can be re-pointed in one edit.
              </p>
            )}

            <label className="wslabel" htmlFor="wsnotes" style={{ marginTop: "0.7rem", display: "block" }}>Notes</label>
            <textarea id="wsnotes" value={doc.notes || ""} spellCheck
              placeholder="What is this analysis for? What should a reader look at first?"
              onChange={e => setNotes(e.target.value)} />

            <div className="row" style={{ marginTop: "0.7rem", justifyContent: "space-between", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
              <div className="row" style={{ gap: "0.4rem" }}>
                {doc.title && spaces[doc.title] && (
                  <button type="button" className="linklike" disabled={busy}
                    title={"delete the saved workspace “" + doc.title + "”"}
                    onClick={() => deleteWorkspace(doc.title!)}>delete</button>
                )}
              </div>
              <div className="row" style={{ gap: "0.4rem", alignItems: "center" }}>
                <button type="button" className="linklike" onClick={() => wsDialog.current?.close()}>cancel</button>
                <button className="primary" type="submit" disabled={!draftFilled}>
                  {doc.title && spaces[doc.title] ? "Save changes" : "Save"}
                </button>
              </div>
            </div>
            {wsError && <p className="error" style={{ marginTop: "0.4rem" }}>{wsError}</p>}
          </form>
        </dialog>
        {/* The cohort gear menu's "edit…": name and note together, since
            renaming is the one cohort-level edit this app supports without
            reopening Explore or the JSON editor. */}
        <dialog ref={cohortEditDialog} className="namedialog cohortdialog"
          onClose={() => { setCohortEditing(null); setCeError(null); }}
          onClick={e => { if (e.target === cohortEditDialog.current) cohortEditDialog.current?.close(); }}>
          <form method="dialog" onSubmit={e => { e.preventDefault(); confirmCohortEdit(); }}>
            <h3>Edit cohort</h3>
            <label className="wslabel" htmlFor="cename">Name</label>
            <DraftText key={"n" + draftGen} draft={ceNameDraft} initial={ceName} onFilled={setDraftFilled} id="cename" autoFocus />
            <label className="wslabel" htmlFor="cenotes" style={{ marginTop: "0.6rem", display: "block" }}>Note</label>
            <DraftText multiline key={"t" + draftGen} draft={ceNotesDraft} initial={ceNotes} id="cenotes" spellCheck
              placeholder="What is this cohort? Why is it defined this way?" />
            <div className="row" style={{ marginTop: "0.7rem", justifyContent: "flex-end", alignItems: "center", gap: "0.4rem" }}>
              <button type="button" className="linklike" onClick={() => cohortEditDialog.current?.close()}>cancel</button>
              <button className="primary" type="submit" disabled={!draftFilled}>Save</button>
            </div>
            {ceError && <p className="error" style={{ marginTop: "0.4rem" }}>{ceError}</p>}
          </form>
        </dialog>
        {/* A view's gear menu's "add note…" / "edit note…": one line of prose
            drawn below its title (see ViewHead) — what this figure shows, or
            what to read first, not a second title. */}
        <dialog ref={viewNoteDialog} className="namedialog cohortdialog"
          onClose={() => setViewNoteEditing(null)}
          onClick={e => { if (e.target === viewNoteDialog.current) viewNoteDialog.current?.close(); }}>
          <form method="dialog" onSubmit={e => { e.preventDefault(); confirmViewNoteEdit(); }}>
            <h3>View note</h3>
            <label className="wslabel" htmlFor="vntext">Note</label>
            <DraftText multiline key={draftGen} draft={vnDraft} initial={vnText} id="vntext" autoFocus spellCheck
              placeholder="What does this figure show? What should a reader look at first?" />
            <div className="row" style={{ marginTop: "0.7rem", justifyContent: "flex-end", alignItems: "center", gap: "0.4rem" }}>
              <button type="button" className="linklike" onClick={() => viewNoteDialog.current?.close()}>cancel</button>
              <button className="primary" type="submit">Save</button>
            </div>
          </form>
        </dialog>
        <dialog ref={genesDialog} className="genedialog"
          onClose={() => setGenesFor(null)}
          onClick={e => { if (e.target === genesDialog.current) genesDialog.current?.close(); }}>
          {genesFor != null && (
            <>
              <h3>Genes <span className="plain">— {String(((doc.views || [])[genesFor] as any)?.kind || "view")}</span></h3>
              <GeneEditor vi={genesFor} />
              <div className="row" style={{ marginTop: "0.8rem", justifyContent: "flex-end" }}>
                <button className="primary" onClick={() => genesDialog.current?.close()}>Done</button>
              </div>
            </>
          )}
        </dialog>
        <div className="tabs">
          <button className={tab === "explore" ? "active" : ""} onClick={() => { goTab("explore"); if (!explore) fetchExplore(); }}>Explore</button>
          <button className={tab === "cohorts" ? "active" : ""} onClick={() => goTab("cohorts")}>Cohorts</button>
          <button className={tab === "saved" ? "active" : ""} onClick={() => goTab("saved")}>Saved</button>
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
                  <strong style={{ fontSize: "var(--t-md)" }}>
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
                  {/* Naming is asked for on demand rather than sitting in the bar:
                      Analyze needs no name, so a permanent field implied one was
                      required for both. */}
                  <button onClick={openSaveDialog} disabled={!ready}
                    title={ready ? "keep this definition in the Cohorts tab without running anything" : "select a study first"}>
                    Save as a Cohort
                  </button>
                  {clauses > 0 && <button className="linklike" onClick={clearDraft}>clear</button>}
                </div>
                {clauses > 0 && (
                  <div className="row" style={{ marginTop: "0.4rem" }}>
                    {(() => { const dr = parseDraft(); return dr && <CohortPills def={dr} onRemoveClause={removeDraftClause} />; })()}
                  </div>
                )}
                {exMsg && <p className="note" style={{ margin: "0.35rem 0 0" }}>{exMsg}</p>}
                {/* A native <dialog> so Esc, focus trapping and the backdrop come
                    from the platform rather than being re-implemented. */}
                <dialog ref={saveDialog} className="namedialog savedialog"
                  onClose={() => setSaveName("")}
                  onClick={e => { if (e.target === saveDialog.current) saveDialog.current?.close(); }}>
                  <form method="dialog" onSubmit={e => { e.preventDefault(); confirmSave(); }}>
                    <h3>Save as a cohort</h3>
                    <p className="meta">{clauses ? clauses + (clauses === 1 ? " filter" : " filters") + " on " + exStudies.length + " stud" + (exStudies.length === 1 ? "y" : "ies") : "every patient in " + (exStudies.length === 1 ? exStudies[0] : exStudies.length + " selected studies")}</p>
                    <DraftText key={draftGen} draft={saveDraft} initial={saveName} onFilled={setDraftFilled} autoFocus placeholder="cohort name…" />
                    <div className="row" style={{ marginTop: "0.7rem", justifyContent: "flex-end", alignItems: "center", gap: "0.4rem" }}>
                      <button type="button" className="linklike" onClick={() => saveDialog.current?.close()}>cancel</button>
                      <button className="primary" type="submit" disabled={!draftFilled}>Save</button>
                    </div>
                  </form>
                </dialog>
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
            // Two toggles on purpose. The chips in the header are an edit to a
            // selection the reader has already committed, so they apply at once.
            // The checkboxes below are them composing a new one, so they stage.
            const toggle = (id: any) => {
              const cur = exSel.current;
              setExploreStudies(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
            };
            const staged = exDraftStudies ?? exStudies;
            const toggleStaged = (id: string) =>
              setExDraftStudies(staged.includes(id) ? staged.filter(x => x !== id) : [...staged, id]);
            const dirty = exDraftStudies != null &&
              (staged.length !== exStudies.length || staged.some(x => !exStudies.includes(x)));
            const applyStaged = () => {
              setExDraftStudies(null);
              setExPanelOpen(false);
              setExploreStudies(staged);
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
                    // While a fetch is in flight the PREVIOUS result's totals are
                    // not this selection's. Submitting 560 studies takes about a
                    // minute, and showing the old 267,816 as though it described
                    // the new set is worse than showing the study list's own sum
                    // and saying it is still counting.
                    (exploreBusy || !explore?.totals
                      ? selPts.toLocaleString() + " patients" + (exploreBusy ? " · counting…" : "")
                      : explore.totals.patients.toLocaleString() + " patients · " + explore.totals.samples.toLocaleString() + " samples") +
                    (exStudies.length > 1 ? " (overlap not deduplicated)" : "")}</span></h2>
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
                            <button className="linklike" style={{ marginLeft: "0.3rem" }}
                              title={"remove " + id + " from the selection"}
                              onClick={() => toggle(id)}>×</button>
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
                  <button onClick={() => {
                    if (exPanelOpen) { setExDraftStudies(null); setExPanelOpen(false); }   // close discards
                    else { setExDraftStudies(exStudies); setExPanelOpen(true); }           // open seeds
                  }}>{exPanelOpen ? "cancel" : "add / change studies"}</button>
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
                    {/* "all matches", not "all 200 drawn": the list renders the
                        200 largest, and a button that silently selected only
                        those would disagree with the count beside it. The number
                        is on the button because selecting 546 studies is a
                        minutes-long query, and that should be a decision rather
                        than a surprise. */}
                    <button className="facet" disabled={!hits.length}
                      title={"adds the " + hits.length + " studies matching the current search to the staged set, keeping what is already staged — use clear first to replace"}
                      onClick={() => setExDraftStudies([...new Set([...staged, ...hits.map(h => h.id)])])}>
                      add all {hits.length.toLocaleString()} match{hits.length === 1 ? "" : "es"}
                    </button>
                    <button className="facet" disabled={!staged.length}
                      onClick={() => setExDraftStudies([])}>clear</button>
                  </div>
                  <div className="row applybar" style={{ alignItems: "center", gap: "0.5rem" }}>
                    <strong>{staged.length.toLocaleString()}</strong>
                    <span className="meta">
                      {staged.length === 1 ? "study staged" : "studies staged"}
                      {staged.length ? " · " + staged.reduce((n: number, id: string) => n + (byId.get(id)?.patients ?? 0), 0).toLocaleString() + " patients" : ""}
                      {dirty ? " · not queried yet" : " · matches what is shown"}
                    </span>
                    <span className="spacer" />
                    <button className="primary" disabled={!dirty || !staged.length} onClick={applyStaged}
                      title={staged.length ? "run the facets for these " + staged.length + " studies" : "stage at least one study"}>
                      submit
                    </button>
                  </div>
                  {!studies.length && <div className="loading-block"><span className="spinner" /> Loading studies…</div>}
                  <div style={{ maxHeight: "22rem", overflowY: "auto" }}>
                    {hits.slice(0, 200).map(s => (
                      <label key={s.id} title={s.name} className={"study-row" + (staged.includes(s.id) ? " sel" : "")}>
                        <input type="checkbox" checked={staged.includes(s.id)} onChange={() => toggleStaged(s.id)} />
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
          {/* A facet click starts a recount, and a second click before it lands
              would race it — so the facets themselves greyscale until it does.
              The study picker above stays live: choosing studies is a staged,
              separately-submitted action, not an immediate filter. */}
          <div className={exploreBusy ? "busy" : undefined} aria-busy={exploreBusy}>
          {exStudies.length === 0 && <div className="card"><p className="note" style={{ fontSize: "var(--t-md)", margin: 0 }}>
            No studies selected — check one or more above to explore.</p></div>}
          {!explore && exStudies.length > 0 && <div className="card"><div className="loading-block"><span className="spinner" /> Building study facets…</div></div>}
          {/* Per-gene alteration facets — the portal's "EGFR: Somatic mutations"
              and "EGFR: Copy-number alterations". Filterable, and counted in
              PATIENTS because that is the unit a click selects in; the gene
              tables on the right count samples and say so. */}
          {explore && (
            <div className="card">
              <div className="row" style={{ alignItems: "baseline", gap: "0.5rem" }}>
                <h2 style={{ margin: 0 }}>Gene status <span className="plain">— alteration state per gene, click to filter</span></h2>
                <span className="spacer" />
                <input className="genesearch" type="search" placeholder="chart a gene (e.g. EGFR)"
                  value={geneChartInput} disabled={exploreBusy}
                  onChange={e => setGeneChartInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") chartGene(geneChartInput); }} />
                <button disabled={!geneChartInput.trim() || exploreBusy} onClick={() => chartGene(geneChartInput)}>add</button>
              </div>
              {!geneCharts.length && (
                <p className="note" style={{ margin: "0.4rem 0 0" }}>
                  Name a gene to see how many patients are altered, unaltered, or <strong>never tested</strong> for
                  it. The third is the one a frequency cannot show: in GENIE public, 86,353 patients are on no panel
                  covering EGFR copy number.
                </p>
              )}
              {geneCharts.map(g => (
                <span key={g} className="qchip" style={{ marginRight: "0.3rem" }}>
                  {g}
                  <button className="linklike" style={{ marginLeft: "0.3rem" }} title={"stop charting " + g}
                    onClick={() => unchartGene(g)}>×</button>
                </span>
              ))}
              {(explore.geneFacets || []).map(f => {
                const max = Math.max(...f.states.map(x => x.n), 1);
                return (
                  <div key={f.gene + f.type} data-genefacet={f.gene + "|" + f.type}
                    style={{ borderTop: "1px solid var(--line)", padding: "0.45rem 0", marginTop: "0.4rem" }}>
                    <div style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>
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
                          <span className="vpct">{f.total ? (Math.round(1000 * st.n / f.total) / 10) + "%" : ""}</span>
                        </button>
                      ))}
                    </div>
                    {f.overlap ? (
                      <p className="note" style={{ margin: "0.25rem 0 0" }}>
                        {f.overlap.toLocaleString()} patient{f.overlap === 1 ? " is" : "s are"} counted in both
                        Amplified and Deleted — amplified in one sample, deleted in another — so these rows
                        over-sum the cohort by that much.
                      </p>
                    ) : null}
                    {f.alteredUnprofiled ? (
                      <p className="note" style={{ margin: "0.25rem 0 0" }}>
                        {f.alteredUnprofiled.toLocaleString()} patient{f.alteredUnprofiled === 1 ? " has" : "s have"} a
                        call for {f.gene} but sit on no panel covering it — a contradiction in the source data. They are
                        counted as not profiled.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {explore && explore.derived && explore.derived.length > 0 && (
            <div className="card">
              <div className="row" style={{ alignItems: "baseline" }}>
                <h2 style={{ margin: 0 }}>Derived <span className="plain">— computed from the data's shape, so these mean the same thing in any study</span></h2>
                <span className="spacer" />
                <details className="gearmenu" ref={moreDerivedMenu.ref} onToggle={moreDerivedMenu.onToggle}>
                  <summary className="tbbtn" title="more ways to derive a facet from this study's own timeline">show more derivations</summary>
                  <div className="gearmenu-items">
                    <span className="meta">from this study's own timeline events</span>
                    {(() => {
                      const tx = treatmentEventType();
                      return EXTRA_DERIVED_KINDS.map((k) => (
                        <label key={k.metric} className="chk"
                          title={tx ? "based on '" + tx.label + "' events" : "this study records no treatment-like timeline events, so this can't be derived here"}>
                          <input type="checkbox" checked={extraDerivedOn(k.metric)} disabled={!tx}
                            onChange={() => toggleExtraDerived(k.metric)} />
                          {tx ? k.label(tx.label) : k.label("a treatment event")}
                          {!tx && <span className="meta"> — not available for this study</span>}
                        </label>
                      ));
                    })()}
                  </div>
                </details>
              </div>
              <div className="derivedgrid">
                {/* "lines" is excluded here — it shows in its own "Derived timeline
                    filters" card below (with the treatment-naive example and the
                    custom builder alongside it) rather than twice on the page. */}
                {explore.derived.filter(d => d.metric !== "lines").map(d => {
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
                      <div style={{ fontSize: "var(--t-md)", fontWeight: 600 }} title={d.note}>
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
          {explore && explore.events.length > 0 && (() => {
            const tx = treatmentEventType();
            const dr = parseDraft();
            const leaves = ((dr && dr.all) || []);
            const linesFacet = tx && explore.derived
              ? explore.derived.find((d) => d.metric === "lines" && d.eventType === tx.label) : null;
            const naiveFirst = (): any => tx && ({ kind: "event",
              a: { eventType: tx.label, occurrence: "FIRST" }, rel: { type: "NONE" }, priorGuard: true });
            const isNaiveFirst = tx && leaves.some((c: any) => c && c.kind === "event" &&
              c.a?.eventType === tx.label && c.a?.occurrence === "FIRST" && c.priorGuard === true);
            const isLineBucket = (b: { gte?: number; lt?: number }) => tx && leaves.some((c: any) => c && c.kind === "derived" &&
              c.metric === "lines" && c.eventType === tx.label && (c.range || {}).gte === b.gte && (c.range || {}).lt === b.lt);
            return (
              <div className="card">
                <div className="row" style={{ alignItems: "baseline" }}>
                  <h2 style={{ margin: 0 }}>Derived timeline filters <span className="plain">— found from a sequence of events, not a single recorded fact</span></h2>
                </div>
                {!tx && (
                  <p className="note" style={{ margin: "0.3rem 0" }}>This study records no treatment-like timeline events, so there is no generic "lines" example to offer — build a custom sequence below instead.</p>
                )}
                {tx && !linesFacet && (
                  <p className="note" style={{ margin: "0.3rem 0" }}>computing this study's line-count breakdown…</p>
                )}
                {tx && linesFacet && (() => {
                  const max = Math.max(...linesFacet.buckets.map((b) => b.n), 1);
                  return (
                    <div style={{ margin: "0.3rem 0" }}>
                      <span className="meta">{linesFacet.label} <span title={linesFacet.note}>· {linesFacet.covered.toLocaleString()} patients</span></span>
                      <div className="vallist">
                        {linesFacet.buckets.map((b) => (
                          <button key={b.label} className={isLineBucket(b) ? "valrow on" : "valrow"}
                            title={linesFacet.note + " — click to filter"}
                            onClick={() => addClause({ kind: "derived", metric: "lines", eventType: tx!.label, lineGap: linesFacet.lineGap,
                              range: { ...(b.gte != null ? { gte: b.gte } : {}), ...(b.lt != null ? { lt: b.lt } : {}) } })}>
                            <span className="vname">{b.label} line{b.label === "1" ? "" : "s"}</span>
                            <span className="vbar"><i style={{ width: Math.max(2, Math.round(100 * b.n / max)) + "%" }} /></span>
                            <span className="vn">{b.n.toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                      <button className={isNaiveFirst ? "facet on" : "facet"} style={{ marginTop: "0.4rem" }}
                        title={"first '" + tx.label + "' event, with no treatment recorded before it — exact count shown once added"}
                        onClick={() => addClause(naiveFirst())}>first '{tx.label}', treatment-naive</button>
                    </div>
                  );
                })()}
                <details className="gearmenu inline" ref={seqFilterMenu.ref} onToggle={seqFilterMenu.onToggle}>
                  <summary title="build any A/B temporal relationship — followed-by, during, not-followed-by — with a duration constraint">custom…</summary>
                  <div className="gearmenu-items wide">
                    <span className="meta">one event, or two related in time — built from this study's own timeline</span>
                    <div className="setrow">
                      <span className="meta">event</span>
                      <select value={seq.aType} onChange={e => setSeq(s => ({ ...s, aType: e.target.value }))}>
                        <option value="">choose…</option>
                        {tx && <option value={LINE_TYPE}>Treatment line (derived)</option>}
                        {[...explore.events].sort((x, y) => y.n - x.n).map(e => (
                          <option key={e.type} value={e.type}>{e.type} ({e.n.toLocaleString()})</option>
                        ))}
                      </select>
                      {seq.aType === LINE_TYPE ? (
                        <>
                          <select value={seq.aLineOp} onChange={e => setSeq(s => ({ ...s, aLineOp: e.target.value as any }))}>
                            <option value="=">line #</option>
                            <option value=">=">line ≥</option>
                            <option value="<=">line ≤</option>
                          </select>
                          <input type="number" min={1} placeholder="n" value={seq.aLineNo}
                            onChange={e => setSeq(s => ({ ...s, aLineNo: e.target.value }))} style={{ width: "3.6rem" }} />
                        </>
                      ) : seq.aType && (
                        <select value={seq.aOcc} onChange={e => setSeq(s => ({ ...s, aOcc: e.target.value as any }))}>
                          <option value="ANY">any occurrence</option>
                          <option value="FIRST">first</option>
                          <option value="LAST">last</option>
                        </select>
                      )}
                    </div>
                    <div className="setrow">
                      <span className="meta">relationship</span>
                      <select value={seq.rel} onChange={e => setSeq(s => ({ ...s, rel: e.target.value as any }))}>
                        <option value="NONE">just has this event</option>
                        <option value="BEFORE">→ followed by, within</option>
                        <option value="DURING">happens during</option>
                        <option value="NOT_FOLLOWED_BY">not followed by, within</option>
                      </select>
                      {(seq.rel === "BEFORE" || seq.rel === "NOT_FOLLOWED_BY") && (
                        <>
                          <input type="number" min={1} value={seq.days}
                            onChange={e => setSeq(s => ({ ...s, days: e.target.value }))} style={{ width: "4rem" }} />
                          <span className="meta">days</span>
                        </>
                      )}
                    </div>
                    {seq.rel !== "NONE" && (
                      <div className="setrow">
                        <span className="meta">{seq.rel === "DURING" ? "during" : "second event"}</span>
                        <select value={seq.bType} onChange={e => setSeq(s => ({ ...s, bType: e.target.value }))}>
                          <option value="">choose…</option>
                          {tx && <option value={LINE_TYPE}>Treatment line (derived)</option>}
                          {[...explore.events].sort((x, y) => y.n - x.n).map(e => (
                            <option key={e.type} value={e.type}>{e.type} ({e.n.toLocaleString()})</option>
                          ))}
                        </select>
                        {seq.bType === LINE_TYPE ? (
                          <>
                            <select value={seq.bLineOp} onChange={e => setSeq(s => ({ ...s, bLineOp: e.target.value as any }))}>
                              <option value="=">line #</option>
                              <option value=">=">line ≥</option>
                              <option value="<=">line ≤</option>
                            </select>
                            <input type="number" min={1} placeholder="n" value={seq.bLineNo}
                              onChange={e => setSeq(s => ({ ...s, bLineNo: e.target.value }))} style={{ width: "3.6rem" }} />
                          </>
                        ) : seq.bType && (
                          <select value={seq.bOcc} onChange={e => setSeq(s => ({ ...s, bOcc: e.target.value as any }))}>
                            <option value="ANY">any occurrence</option>
                            <option value="FIRST">first</option>
                            <option value="LAST">last</option>
                          </select>
                        )}
                      </div>
                    )}
                    {(seq.aType === LINE_TYPE || seq.bType === LINE_TYPE) && (
                      <div className="setrow">
                        <span className="meta">new line after</span>
                        <select value={String(seq.lineGap)} onChange={e => setSeq(s => ({ ...s, lineGap: Number(e.target.value) }))}>
                          {[30, 60, 90, 120, 180].map(g => <option key={g} value={g}>{g} days</option>)}
                        </select>
                      </div>
                    )}
                    <label className="chk" title="restricts the first event to patients with no treatment recorded before it">
                      <input type="checkbox" checked={seq.priorGuard}
                        onChange={e => setSeq(s => ({ ...s, priorGuard: e.target.checked }))} />
                      treatment-naive before the first event
                    </label>
                    <hr />
                    <button className="facet" disabled={!seqReady} onClick={addSeqFilter}>add filter</button>
                  </div>
                </details>
              </div>
            );
          })()}
          {explore && <div className="two-col" style={{ alignItems: "start" }}>
            <div>
              <div className="card">
                {(() => {
                  const visible = visibleClinical(explore.clinical as never) as unknown as typeof explore.clinical;
                  const shown = Math.min(visible.length, attrLimit);
                  return (
                    <div className="row" style={{ alignItems: "baseline" }}>
                      <h2 style={{ margin: 0 }}>Clinical <span className="plain">— counted in each attribute's own unit, as the portal does</span></h2>
                      <span className="spacer" />
                      <input className="genesearch" type="search" placeholder="find attribute or value" value={clinFilter}
                        title="matches an attribute's name or any of its values"
                        onChange={e => setClinFilter(e.target.value)} />
                      <span className="meta">{shown < visible.length
                        ? "showing " + shown + " of " + visible.length + " attributes"
                        : visible.length + " attributes"}
                        {attrCoverage > 0 && visible.length < explore.clinical.length
                          ? " (" + (explore.clinical.length - visible.length) + " hidden as study-specific)" : ""}</span>
                      {exStudies.length > 1 && (
                        <select value={String(attrCoverage)} disabled={exploreBusy}
                          title="attributes carried by only one study are that study's own vocabulary, not something the selection shares"
                          onChange={e => {
                            const v = Number(e.target.value);
                            setAttrCoverage(v);
                            // Refetch UNNARROWED so the bar can be lowered again
                            // later; the filtering below is what the reader sees,
                            // and subsequent fetches narrow the server's work.
                            setTimeout(() => fetchExplore(undefined, undefined, []), 0);
                          }}>
                          <option value="0">every attribute</option>
                          <option value="0.5">in most studies</option>
                          <option value="1">in every study</option>
                        </select>
                      )}
                    </div>
                  );
                })()}
                {(visibleClinical(explore.clinical as never) as unknown as typeof explore.clinical)
                  .slice(0, attrLimit).map(c => (
                  /* data-attr / data-shape make the facet identifiable from outside
                     React — the e2e suite asserts that an attribute's shape does not
                     change when the draft does. */
                  <div key={c.per + c.attribute} data-attr={c.per + "|" + c.attribute}
                    data-shape={c.kind === "cat" ? (PIE_ATTRIBUTES.has(c.attribute) ? "pie" : "list") : c.kind}
                    style={{ borderTop: "1px solid var(--line)", padding: "0.45rem 0" }}>
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
                        <div style={{ fontSize: "var(--t-md)", fontWeight: 600 }}
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
                      // slice geometry: cumulative angles over the returned values.
                      // The shape comes from PIE_ATTRIBUTES, a fixed allowlist — see
                      // its own comment for why cardinality (the study's, or worse,
                      // the draft's) can't be trusted to decide this.
                      const asList = !PIE_ATTRIBUTES.has(c.attribute);
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
                            {c.values.map((v: any, i: number) => (
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
                                <span className="vpct">{(Math.round(1000 * v.n / total) / 10) + "%"}</span>
                              </button>
                            ))}
                            {(c.distinct ?? 0) > c.values.length && (
                              <span className="meta" style={{ padding: "0.1rem 0.3rem" }}>
                                showing {c.values.length.toLocaleString()} of {c.distinct!.toLocaleString()} values
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
                {explore.clinical.length > attrLimit && (
                  <button className="linklike" style={{ marginTop: "0.5rem" }}
                    onClick={() => setAttrLimit(attrLimit + 20)}>
                    show {Math.min(20, explore.clinical.length - attrLimit)} more attributes
                  </button>
                )}
              </div>
            </div>
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
                          <span className="gbar"><i style={{ width: Math.max(2, Math.round(100 * dt.n / max)) + "%" }} /></span>
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
                  <div className="card" key={kind}>
                    <div className="row" style={{ alignItems: "baseline", gap: "0.5rem" }}>
                      <h2 style={{ margin: 0 }}>{meta.title} <span className="plain">— samples, panel-aware frequency</span></h2>
                      <span className="spacer" />
                      <span className="meta">{needle
                        ? rows.length.toLocaleString() + " of " + all.length.toLocaleString() + " loaded match"
                        : "showing " + Math.min(rows.length, geneRowLimit).toLocaleString() +
                          " of " + (meta.total || rows.length).toLocaleString()}</span>
                      <input className="genesearch" type="search" placeholder="find gene" value={geneFilter[kind] || ""}
                        title={"filters the " + all.length + " genes loaded for this table, not all " + (meta.total || all.length)}
                        onChange={e => setGeneFilter({ ...geneFilter, [kind]: e.target.value })} />
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
                            const total = explore.totals?.samples ?? g.profiled;
                            const wild = Math.max(0, g.profiled - g.altered);
                            const unprofiled = Math.max(0, total - g.profiled);
                            const sum = g.altered + wild + unprofiled || 1;
                            const w = (n: number) => (100 * n / sum) + "%";
                            return (
                              <span className="gsplit" aria-hidden="true"
                                title={g.altered.toLocaleString() + " altered · " + wild.toLocaleString() +
                                  " profiled and unaltered · " + unprofiled.toLocaleString() + " not profiled for " + g.gene}>
                                <i className="s-alt" style={{ width: w(g.altered) }} />
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
                          <span className="gfreq">{g.freqPct != null ? g.freqPct + "%" : "—"}</span>
                          <span className="gcount">{g.altered.toLocaleString()}<span className="meta">/{g.profiled.toLocaleString()}</span></span>
                        </button>
                      ))}
                    </div>
                    {needle && !rows.length && (
                      <p className="note" style={{ margin: "0.4rem 0 0" }}>
                        No match among the {all.length.toLocaleString()} genes loaded for this table
                        {meta.total && meta.total > all.length ? " (of " + meta.total.toLocaleString() + " altered in this cohort)" : ""}.
                      </p>
                    )}
                    {!needle && rows.length > geneRowLimit && (
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
            </div>
          </div>}
          </div>
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
                <select value={qaAttr} onChange={e => { setQaAttr(e.target.value); setQaVal(""); }} style={{ fontSize: "var(--t-md)", maxWidth: "14rem" }}>
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
                      <input placeholder="≥" value={qaVal} onChange={e => setQaVal(e.target.value)} style={{ width: "4.5rem", fontSize: "var(--t-md)" }} />
                      <button className="facet" disabled={!Number.isFinite(Number(qaVal)) || qaVal === ""}
                        onClick={() => { addClause({ kind: "clinical", attribute: a.attribute, range: { gte: Number(qaVal) }, ...perExtra }); setQaVal(""); }}>add ≥</button>
                      <button className="facet" disabled={!Number.isFinite(Number(qaVal)) || qaVal === ""}
                        onClick={() => { addClause({ kind: "clinical", attribute: a.attribute, range: { lt: Number(qaVal) }, ...perExtra }); setQaVal(""); }}>add &lt;</button>
                    </>
                  );
                  return (
                    <select value="" onChange={e => { if (e.target.value !== "") addClause({ kind: "clinical", attribute: a.attribute, op: "=", value: e.target.value, ...perExtra }); }}
                      style={{ fontSize: "var(--t-md)", maxWidth: "14rem" }}>
                      <option value="">value… (patients)</option>
                      {a.values.map(v => <option key={v.v} value={v.v}>{v.v} ({v.n.toLocaleString()})</option>)}
                    </select>
                  );
                })()}
                <input list="qa-genes" placeholder="gene → OQL" value={qaGene} onChange={e => setQaGene(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && qaGene.trim()) { addClause({ kind: "oql", q: qaGene.trim().toUpperCase() + ":" }); setQaGene(""); } }}
                  style={{ width: "9rem", fontSize: "var(--t-md)" }} />
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
                  : picked.length + " selected" + (picked.length > 16 ? " — untick some first, an analysis takes at most 16" : "")}
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
            <h2 style={{ marginTop: "1.2rem" }}>
              Saved cohorts <span className="plain">— tick any to include below; manage (rename, delete) on the <button className="linklike" onClick={() => goTab("saved")}>Saved tab</button></span>
            </h2>
            {Object.keys(saved).length === 0 && <p className="note">Nothing saved yet — save an example above, create one on the left, or ask chat.</p>}
            {Object.entries(saved).map(([n, s2]) => (
              <div key={n} style={{ borderTop: "1px solid var(--line)", padding: "0.55rem 0" }}>
                <label className="pick">
                  <input type="checkbox" checked={picked.includes("saved:" + n)} onChange={() => togglePick("saved:" + n)} />
                  <strong>{n}</strong>
                  {s2.lastEval && <span className="meta">{s2.lastEval.count.toLocaleString()} pts</span>}
                </label>
                <div style={{ marginTop: "0.25rem" }}><CohortPills def={s2.def} /></div>
              </div>
            ))}
          </div>
        </div>}

        {/* ================= Saved tab ================= */}
        {tab === "saved" && <div className="grid2">
          <div className="card">
            <h2>Saved cohorts <span className="plain">— shared with everyone using this app; no per-user ownership yet</span></h2>
            {Object.keys(saved).length === 0 && <p className="note">Nothing saved yet — build one on the Cohorts tab, or save an example there.</p>}
            {Object.entries(saved)
              .sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))
              .map(([n, s2]) => (
                <div key={n} style={{ borderTop: "1px solid var(--line)", padding: "0.55rem 0" }}>
                  <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong>{n}</strong>
                    {s2.lastEval && <span className="meta">{s2.lastEval.count.toLocaleString()} pts</span>}
                    <span className="meta">saved {s2.savedAt}</span>
                    <span className="spacer" />
                    <button className="linklike"
                      onClick={() => { setCName(n); setCDefText(JSON.stringify(s2.def, null, 2)); setCPreview(s2.lastEval || null); goTab("cohorts"); }}>
                      edit
                    </button>
                    <button className="linklike" onClick={() => removeSaved(n)}>delete</button>
                  </div>
                  <div style={{ marginTop: "0.25rem" }}><CohortPills def={s2.def} /></div>
                </div>
              ))}
          </div>
          <div className="card">
            <h2>Saved workspaces <span className="plain">— shared with everyone using this app; no per-user ownership yet</span></h2>
            {Object.keys(spaces).length === 0 && <p className="note">Nothing saved yet — build an analysis with at least one view, then "Save workspace" on the Analysis tab.</p>}
            {Object.entries(spaces)
              .sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))
              .map(([n, w]) => (
                <div key={n} style={{ borderTop: "1px solid var(--line)", padding: "0.55rem 0" }}>
                  <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong>{n}</strong>
                    <span className="meta">{(w.doc.views || []).length} view{(w.doc.views || []).length === 1 ? "" : "s"}</span>
                    <span className="meta">saved {w.savedAt}</span>
                    <span className="spacer" />
                    <button className="linklike" onClick={() => openWorkspace(n)}>open</button>
                    <button className="linklike" onClick={() => deleteWorkspace(n)}>delete</button>
                  </div>
                </div>
              ))}
            {wsError && <p className="error" style={{ marginTop: "0.4rem" }}>{wsError}</p>}
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
            {/* Cohorts, bare: each is its own labelled, bordered box, with no
                enclosing card — they ARE the leftbar, not a section within it.
                Each box's gear menu (CohortEditMenu) covers a note and
                removing the cohort. It deliberately does NOT cover the
                cohort's own filters yet: those are pills built from Explore's
                facets or hand-typed JSON, and editing them in place would mean
                either Explore or the JSON editor opening ON TOP of an
                analysis already in progress (a modal, most likely) — a bigger
                piece of work than this pass, and not yet scoped. */}
            <h2 className="vtitle" style={{ marginBottom: "0.9rem" }}>
              Cohorts{busy && <span className="spinner" style={{ marginLeft: "0.5rem" }} />}
            </h2>
            <div className="cohortlist">
              {busy && !result
                ? Array.from({ length: Math.max(1, Object.keys(doc.cohorts || {}).length) }).map((_, i) => (
                    <div key={i} className="skeleton skeleton-cohort" />
                  ))
                : result && Object.entries(result.cohorts).map(([n, c], i) => (
                    <div key={n} className="cohortbox">
                      <CohortEditMenu busy={busy} canEdit={!!(doc.title && spaces[doc.title])}
                        onEdit={() => openCohortEdit(n)} onRemove={() => removeCohort(n)}
                        menuId={"cohort:" + n} menuStore={menuOpenRef.current} />
                      <div className="cohortbox-head">
                        <span className="qchip"><span className="qletter" style={{ color: CAT_COLORS[i % CAT_COLORS.length] }}>■</span>{n}</span>
                        <strong>{c.count.toLocaleString()}</strong> <span className="meta">patients</span>
                      </div>
                      {doc.cohorts && doc.cohorts[n] && <CohortPills def={doc.cohorts[n]} />}
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
                  ))}
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
            <textarea id="docjson" value={docText} onChange={e => setDocText(e.target.value)} spellCheck={false}
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
                <button className="linklike" onClick={() => docDialog.current?.showModal()}
                  title="open the document's raw JSON — edit it, run it, or view generated SQL">
                  show document json
                </button>
              </div>
            </div>
            {busy && !result && <div className="skeleton skeleton-addview" />}
            {busy && !result && Array.from({ length: Math.max(1, (doc.views || []).length) }).map((_, i) => (
              <div key={i} className="skeleton skeleton-view" />
            ))}
            {!busy && !result && (
              <div className="card">
                <h2>Nothing here yet</h2>
                <p className="note" style={{ fontSize: "var(--t-md)" }}>
                  The analysis document is empty. Add cohorts from the <button className="linklike" onClick={() => goTab("cohorts")}>Cohorts tab</button>,
                  ask chat above (e.g. “compare STK11-driver vs wild-type immunotherapy patients”), or open <button className="linklike" onClick={() => docDialog.current?.showModal()}>show document json</button> and paste one in.
                </p>
              </div>
            )}
            {result && !result.views.length && (
              <div className="card">
                <h2>Cohorts evaluated — no views defined</h2>
                <p className="note" style={{ fontSize: "var(--t-md)" }}>
                  Add a views array to the document (e.g. <code>{`{"kind":"survival"}`}</code>),{" "}
                  <button className="linklike" onClick={() => { const d = { ...doc, views: DEFAULT_VIEWS }; setDoc(d); setDocText(JSON.stringify(d, null, 2)); run(d); }}>add the default views</button>, or ask chat.
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
              <div className="card viewcard" key={resultViewKeys.current[vi] ?? vi}>
                {/* recomputing this view (a settings change), or the whole document */}
                {!(v as any).pending && (busy || pendingKeys.has(resultViewKeys.current[vi])) && <Updating />}
                {/* addView's placeholder for a brand-new view that has no prior
                    result to keep showing while its own delta request is in
                    flight (see addView) — every v.kind===… block below is
                    already guarded on a kind-specific data field, so this
                    placeholder object just falls through all of them silently;
                    this is the only thing that needs to render for it. */}
                {(v as any).pending && <div className="skeleton skeleton-view" />}
                {v.kind === "compare" && v.rows && <>
                  <ViewHead menuStore={menuOpenRef.current} v={v} title="Compare" cohorts={cohortChoice(vi, docView(vi))} sub={<>alteration frequencies · {v.annotation}</>} onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                    actions={<button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>} />
                  {v.note && <p className="note" title={(v.studies || []).join(", ") || undefined}
                    style={v.studies && v.studies.length > 2 ? { cursor: "help", textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "var(--t-md)", width: "100%" }}>
                      <thead><tr>
                        <th style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>gene</th>
                        {v.cohorts!.map((n, i: number) => <th key={n} style={{ textAlign: "right", padding: "0.3rem 0.6rem", color: CAT_COLORS[i] }}>{n}<br /><span style={{ fontWeight: 400, color: "var(--muted)" }}>driver / any</span></th>)}
                        {v.rows![0] && v.rows![0].pAny != null && <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>p (any)</th>}
                        {v.rows![0] && v.rows![0].qAny != null && <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>q (any)</th>}
                      </tr></thead>
                      <tbody>{v.rows.map(r => (
                        <tr key={r.gene} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: "0.3rem 0.6rem", fontWeight: 600 }}>{r.gene}</td>
                          {r.cells.map(c => <td key={c.cohort} style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums" }}>{c.driverPct}% / {c.anyPct}%</td>)}
                          {r.pAny != null && <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", fontWeight: r.pAny < 0.001 ? 600 : 400 }}>{r.pAny < 1e-4 ? r.pAny.toExponential(1) : r.pAny.toFixed(3)}</td>}
                          {r.qAny != null && <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", fontVariantNumeric: "tabular-nums", fontWeight: r.qAny < 0.05 ? 600 : 400 }}>{r.qAny < 1e-4 ? r.qAny.toExponential(1) : r.qAny.toFixed(3)}</td>}
                        </tr>))}
                      </tbody>
                    </table>
                  </div>
                </>}
                {v.kind === "hotspots" && v.hotspots && <>
                  <ViewHead menuStore={menuOpenRef.current} v={v} title="Mutations" cohorts={cohortChoice(vi, docView(vi))} sub="lollipop by protein position, as the portal's mutation tab draws it" onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                    actions={<button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>} />
                  {/* one renderer (lib/view-svg.ts) for this figure everywhere: the app, chat and MCP;
                      the caption under it carries the note, so it isn't repeated above */}
                  {v.svg
                    ? <div className="viewfig" dangerouslySetInnerHTML={{ __html: v.svg }} />
                    : <p className="note">{v.note || "no mutations in these genes for this cohort"}</p>}
                </>}
                {v.kind === "coexpression" && v.coexpression && <>
                  <ViewHead menuStore={menuOpenRef.current} v={v} title="Co-expression" cohorts={cohortChoice(vi, docView(vi))} sub="Pearson correlation from per-site sums" onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                    actions={<>
                      <label className="tbfield" title="the molecular profile the correlation is computed over">profile <select
                        value={docView(vi).profileType || ""} disabled={busy}
                        onChange={(e) => updateView(vi, (vv: any) => ({ ...vv, profileType: e.target.value }))}>
                        {!((explore && explore.profiles) || []).includes(docView(vi).profileType || "") &&
                          <option value={docView(vi).profileType || ""}>{docView(vi).profileType || "(none)"}</option>}
                        {((explore && explore.profiles) || []).map((pt: string) => <option key={pt} value={pt}>{pt}</option>)}
                      </select></label>
                      <button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>
                    </>} />
                  {v.note && <p className="note">{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "var(--t-md)", width: "100%" }}>
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
                  <ViewHead menuStore={menuOpenRef.current} v={v} title="Clinical comparison" cohorts={cohortChoice(vi, docView(vi))} sub="attribute distributions across cohorts" onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                    actions={<PickMenu label="attributes" title="which clinical attributes this view compares" busy={busy}
                      menuId={"attrs:" + (resultViewKeys.current[vi] ?? vi)} menuStore={menuOpenRef.current} loading={attrsLoading()}
                      options={catalogAttrs().map((a) => ({ value: a.attribute, label: a.attribute, hint: a.kind }))}
                      chosen={(docView(vi).attributes || []).map(String)} min={1} max={20}
                      onChange={(next) => setViewAttrs(vi, next)} />} />
                  {v.note && <p className="note">{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "var(--t-md)", width: "100%" }}>
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
                  <ViewHead menuStore={menuOpenRef.current} v={v} title="Co-occurrence" cohorts={cohortChoice(vi, docView(vi))} sub="pairwise, among patients profiled for both genes" onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                    actions={<button className="linklike genesbtn" disabled={busy} title="choose the genes this view uses" onClick={() => openGenes(vi)}>genes</button>} />
                  {v.note && <p className="note">{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "var(--t-md)", width: "100%" }}>
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
                {v.kind === "survival" && v.curves && <>
                  <ViewHead menuStore={menuOpenRef.current} v={v} title="Survival" cohorts={cohortChoice(vi, docView(vi))} onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                    sub={<>Kaplan–Meier, {v.endpoint && v.endpoint !== "OS" ? v.endpoint : "overall survival"}{v.anchoredTo && <> — from {v.anchoredTo}</>}</>}
                    chips={v.truncated ? <span className="trunc" title={
                      "Delayed entry is applied: a patient joins the risk set when the study could first observe them, not at the anchor." +
                      (v.entryMonths ? "\n\nMedian " + v.entryMonths.median + " months from anchor to entry; 90th percentile "
                        + v.entryMonths.p90 + "; longest " + v.entryMonths.max + "." : "")}>left-truncated</span> : null} />
                  {(() => {
                    // The basis of a survival analysis — which endpoint, and what
                    // the clock starts from — is the thing people most want to
                    // change, so it is a control rather than a JSON edit.
                    const sv: any = (doc.views || [])[vi] || {};
                    const a = sv.anchor || null;
                    const eps: string[] = (cat && cat.survivalEndpoints) || [];
                    const types: string[] = ((cat && cat.types) || []).map((t: any) => t.t);
                    const keys: string[] = (cat && a && cat.keys && cat.keys[a.eventType]) || [];
                    const vals: string[] = (cat && a && a.key && cat.values && cat.values[a.eventType]
                      && cat.values[a.eventType][a.key]) || [];
                    return (
                      <div className="basis">
                        <span className="meta">endpoint</span>
                        <select value={sv.endpoint || "OS"} disabled={busy}
                          onChange={e => patchView(vi, { endpoint: e.target.value })}>
                          {(eps.length ? eps : [sv.endpoint || "OS"]).map(x => <option key={x} value={x}>{x}</option>)}
                        {!cat && <option disabled>loading…</option>}
                        </select>
                        {catLoading && !cat && <Waiting what="endpoints" />}
                        <span className="meta">measured from</span>
                        <select value={a ? a.eventType : ""} disabled={busy}
                          onChange={e => patchView(vi, { anchor: e.target.value
                            ? { eventType: e.target.value, occurrence: "FIRST" } : null })}>
                          <option value="">study baseline (day 0)</option>
                          {!cat && <option disabled>loading this study's events…</option>}
                          {types.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {a && <>
                          <select value={a.occurrence || "FIRST"} disabled={busy}
                            onChange={e => patchView(vi, { anchor: { ...a, occurrence: e.target.value } })}>
                            <option value="FIRST">first</option><option value="LAST">last</option>
                          </select>
                          <span className="meta">where</span>
                          <select value={a.key || ""} disabled={busy}
                            onChange={e => patchView(vi, { anchor: e.target.value
                              ? { ...a, key: e.target.value, value: (cat.values[a.eventType] || {})[e.target.value]?.[0] ?? "" }
                              : { eventType: a.eventType, occurrence: a.occurrence || "FIRST" } })}>
                            <option value="">(any)</option>
                            {keys.map(k => <option key={k} value={k}>{k}</option>)}
                          </select>
                          {a.key && (
                            <select value={a.value ?? ""} disabled={busy}
                              onChange={e => patchView(vi, { anchor: { ...a, value: e.target.value } })}>
                              {vals.map(x => <option key={x} value={x}>{x}</option>)}
                            </select>
                          )}
                        </>}
                        <span className="meta">display</span>
                        <select value={sv.display === "incidence" ? "incidence" : "survival"} disabled={busy}
                          onChange={e => patchView(vi, { display: e.target.value === "incidence" ? "incidence" : undefined })}>
                          <option value="survival">survival</option>
                          <option value="incidence">cumulative incidence</option>
                        </select>
                        <span className="meta">ticks</span>
                        <select value={sv.tickMonths || ""} disabled={busy}
                          onChange={e => patchView(vi, { tickMonths: e.target.value ? Number(e.target.value) : undefined })}>
                          <option value="">auto</option>
                          {[6, 12, 24, 60].map(m => <option key={m} value={m}>{m}mo</option>)}
                        </select>
                        <span className="meta">cutoff</span>
                        <input type="number" min={1} placeholder="none" disabled={busy}
                          value={sv.cutoffMonths ?? ""} style={{ width: "5rem" }}
                          onChange={e => patchView(vi, { cutoffMonths: e.target.value ? Number(e.target.value) : undefined })} />
                        <span className="meta">mo</span>
                        <span className="meta">split by gene</span>
                        <GeneSplitControl busy={busy} onSplit={(gene) => splitSurvivalByGene(vi, gene)} />
                      </div>
                    );
                  })()}
                  <KMChart curves={v.curves!} cutoffMonths={v.cutoffMonths} tickMonths={v.tickMonths} incidence={v.display === "incidence"} />
                  <div style={{ display: "flex", gap: "1.2rem", fontSize: "var(--t-sm)", color: "var(--muted)", marginTop: "0.4rem", flexWrap: "wrap" }}>
                    {v.curves!.map((c, i: number) => <span key={c.cohort}><span style={{ display: "inline-block", width: 10, height: 10, background: CAT_COLORS[i], borderRadius: 2, marginRight: 5 }} />{c.cohort}: {v.display === "incidence" ? "50% incidence by " : "median "}{c.median ? c.median.toFixed(1) + "mo" : "not reached"} (n={c.n}, {c.events} events)</span>)}
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
                {v.kind === "cox" && <>
                  <ViewHead menuStore={menuOpenRef.current} v={v} title="Cox regression" cohorts={cohortChoice(vi, docView(vi))} onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                    sub={<>Multivariate Cox, {v.endpoint && v.endpoint !== "OS" ? v.endpoint : "overall survival"}</>} />
                  {(() => {
                    const sv: any = (doc.views || [])[vi] || {};
                    const covariates: any[] = Array.isArray(sv.covariates) ? sv.covariates : [];
                    const eps: string[] = (cat && cat.survivalEndpoints) || [];
                    const setCovariate = (ci: number, next: any) => {
                      const nc = covariates.map((c, j) => j === ci ? next : c);
                      patchView(vi, { covariates: nc });
                    };
                    const removeCovariate = (ci: number) => patchView(vi, { covariates: covariates.filter((_, j) => j !== ci) });
                    const addCovariate = () => patchView(vi, { covariates: [...covariates, { source: "clinical", attribute: (trackAttrs.attrs[0] || {}).attribute || "" }] });
                    return (
                      <div className="basis" style={{ flexWrap: "wrap" }}>
                        <span className="meta">endpoint</span>
                        <select value={sv.endpoint || "OS"} disabled={busy}
                          onChange={e => patchView(vi, { endpoint: e.target.value })}>
                          {(eps.length ? eps : [sv.endpoint || "OS"]).map(x => <option key={x} value={x}>{x}</option>)}
                          {!cat && <option disabled>loading…</option>}
                        </select>
                        {catLoading && !cat && <Waiting what="endpoints" />}
                        <span className="meta">cutoff</span>
                        <input type="number" min={1} placeholder="none" disabled={busy}
                          value={sv.cutoffMonths ?? ""} style={{ width: "5rem" }}
                          onChange={e => patchView(vi, { cutoffMonths: e.target.value ? Number(e.target.value) : undefined })} />
                        <span className="meta">mo</span>
                        <label className="chk" title="fit a separate baseline hazard per study instead of pooling them">
                          <input type="checkbox" checked={!!sv.stratifyByStudy} disabled={busy}
                            onChange={e => patchView(vi, { stratifyByStudy: e.target.checked || undefined })} />
                          stratify by study
                        </label>
                        <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.3rem" }}>
                          {covariates.map((c, ci) => (
                            <span key={ci} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                              <AxisPicker side={"covariate " + (ci + 1)} axis={c} attrs={catalogAttrs()}
                                profiles={profileOptions()} loading={attrsLoading()} busy={busy}
                                onChange={(next) => setCovariate(ci, next)} />
                              <button type="button" className="tbbtn" disabled={busy} title="remove this covariate"
                                onClick={() => removeCovariate(ci)}>remove</button>
                            </span>
                          ))}
                          <button type="button" className="tbbtn" disabled={busy} style={{ alignSelf: "flex-start" }}
                            onClick={addCovariate}>+ add covariate</button>
                        </div>
                      </div>
                    );
                  })()}
                  {v.svg
                    ? <div className="viewfig" dangerouslySetInnerHTML={{ __html: v.svg }} />
                    : !v.error && <p className="note">nothing to draw</p>}
                </>}
                {v.kind === "sequence" && !v.svg && v.error && v.sequence && v.sequence.keyOptions && v.sequence.keyOptions.length > 0 && (
                  <div className="basis">
                    <span className="meta">label lines by</span>
                    <select value={v.sequence.labelKey} disabled={busy}
                      onChange={e => patchView(vi, { labelKey: e.target.value })}>
                      {v.sequence.keyOptions.map(k => (
                        <option key={k.key} value={k.label}>{k.label} — {k.values} value{k.values === 1 ? "" : "s"}</option>
                      ))}
                    </select>
                  </div>
                )}
                {v.kind === "plot" && <>
                  <ViewHead menuStore={menuOpenRef.current} v={v} title="Plot" cohorts={cohortChoice(vi, docView(vi), 1)} onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                    sub={v.plot ? <>{v.plot.shape === "scatter" ? "density" : v.plot.shape === "box" ? "box" : "contingency"} · {v.plot.n.toLocaleString()} {(docView(vi).unit || "patient")}s</> : "two axes over the same cases"} />
                  {/* Every control here changes what is DRAWN and costs a query, so there is one
                      zone and it says so — the same toolbar the oncoprint uses. */}
                  <div className="viewtb">
                    <div className="tbz">
                      <span className="tbl" title="these change what is drawn, and re-run the query">data</span>
                      <AxisPicker side="x" axis={docView(vi).x} attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()} busy={busy}
                        onChange={(a) => updateView(vi, (vv: any) => ({ ...vv, x: a }))} />
                    </div>
                    <div className="tbz">
                      <AxisPicker side="y" axis={docView(vi).y} attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()} busy={busy}
                        onChange={(a) => updateView(vi, (vv: any) => ({ ...vv, y: a }))} />
                    </div>
                    {/* colour/ring only affect a box plot's violin — a scatter's density and a
                        contingency table have no per-case colour to split, so the controls would
                        sit there doing nothing until a box shape is actually on screen */}
                    {v.plot?.shape === "box" && <div className="tbz">
                      <span className="tbl" title="colours each group's violin by a category">colour</span>
                      <AxisPicker side="fill" axis={docView(vi).colorBy} allowNone categorical
                        attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()} busy={busy}
                        onChange={(a) => updateView(vi, (vv: any) => { const n = { ...vv }; if (a) n.colorBy = a; else delete n.colorBy; return n; })} />
                      <AxisPicker side="ring" axis={docView(vi).ringBy} allowNone categorical
                        attrs={catalogAttrs()} profiles={profileOptions()} loading={attrsLoading()} busy={busy}
                        onChange={(a) => updateView(vi, (vv: any) => { const n = { ...vv }; if (a) n.ringBy = a; else delete n.ringBy; return n; })} />
                    </div>}
                    <div className="tbz">
                      <label className="tbfield" title="what a point is; patient mode averages a patient's samples">unit <select
                        value={docView(vi).unit || "patient"} disabled={busy}
                        onChange={(e) => updateView(vi, (vv: any) => ({ ...vv, unit: e.target.value }))}>
                        <option value="patient">patients</option><option value="sample">samples</option>
                      </select></label>
                      {/* a box plot is always drawn categories-on-x, values-on-y regardless of
                          which axis is which in the document (lib/federation.ts's box branch
                          routes by kind, not by x/y) — swapping which is "x" changes nothing a
                          reader can see, so the button is disabled rather than pretending to act */}
                      <button className="tbbtn" disabled={busy || v.plot?.shape === "box"}
                        title={v.plot?.shape === "box" ? "a box plot is always drawn by category, whichever axis holds it — nothing to swap"
                          : "put the x axis on y and the y axis on x"}
                        onClick={() => updateView(vi, (vv: any) => ({ ...vv, x: vv.y, y: vv.x }))}>swap</button>
                    </div>
                  </div>
                  {v.svg
                    ? <div className="viewfig" dangerouslySetInnerHTML={{ __html: v.svg }} />
                    : <p className="note">{v.plot?.note || "nothing to draw"}</p>}
                </>}
                {v.kind === "sequence" && v.svg && <>
                  <div className="vhead">
                    <h2 className="vtitle">Treatment sequence <span className="plain">
                      — lines of therapy by {v.sequence ? v.sequence.labelKey : ""}
                      {v.sequence ? " · " + v.sequence.lineGap + "-day line gap" : ""}</span></h2>
                    <div className="vmeta">
                      <PickMenu label="cohorts" title="which cohorts this view draws" busy={busy}
                        menuId={"pick:" + (resultViewKeys.current[vi] ?? vi)} menuStore={menuOpenRef.current}
                        options={Object.keys((result && result.cohorts) || {}).map((n) => ({ value: n, label: n }))}
                        chosen={cohortChoice(vi, docView(vi)).chosen} min={1} max={1}
                        onChange={(next) => setViewCohorts(vi, next, Object.keys((result && result.cohorts) || {}))} />
                    {v.sequence && v.sequence.keyOptions && v.sequence.keyOptions.length > 0 && (
                      <details className="gearmenu inline">
                        <summary title="treatment sequence options">settings</summary>
                        {/* Label granularity is the choice that most changes this chart, and
                            the keys are not interchangeable: in MSK-CHORD SUBTYPE has 10
                            values, AGENT hundreds, TREATMENT_TYPE exactly one. So each option
                            carries its value count rather than leaving the reader to discover
                            a useless key by picking it. */}
                        <div className="gearmenu-items wide">
                          <div className="setrow">
                            <span className="meta">label lines by</span>
                            <select value={v.sequence.labelKey} disabled={busy}
                              onChange={e => patchView(vi, { labelKey: e.target.value })}>
                              {v.sequence.keyOptions.map(k => (
                                <option key={k.key} value={k.label}>
                                  {k.label} — {k.values} value{k.values === 1 ? "" : "s"}
                                  {k.values === 1 ? " (unusable)" : k.values > 60 ? " (very granular)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="setrow">
                            <span className="meta">new line after</span>
                            <select value={String(v.sequence.lineGap)} disabled={busy}
                              onChange={e => patchView(vi, { lineGap: Number(e.target.value) })}>
                              {[30, 60, 90, 120, 180].map(g => <option key={g} value={g}>{g} days</option>)}
                            </select>
                          </div>
                          <div className="setrow">
                            <span className="meta">lines shown</span>
                            <select value={String(v.sequence.steps)} disabled={busy}
                              onChange={e => patchView(vi, { maxSteps: Number(e.target.value) })}>
                              {[2, 3, 4, 5].map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                        </div>
                      </details>
                    )}
                    <Latency v={v} /><Participation p={v.participation} />
                    <ViewMenu menuId={"reorder:" + (resultViewKeys.current[vi] ?? vi)} menuStore={menuOpenRef.current} onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)} hasNote={!!v.annotationNote} />
                    </div>
                  </div>
                  {v.annotationNote && <p className="viewnote">{v.annotationNote}</p>}
                  <div style={{ overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: v.svg }} />
                </>}
                {v.kind === "course" && v.svg && <>
                  <div className="vhead">
                    <h2 className="vtitle">Clinical course <span className="plain">
                      — {[...new Set((v.course || []).map(c => c.eventType))].join(", ")}
                      {v.anchoredTo ? "" : ""} · {v.courseAxis ? v.courseAxis.binMonths + "-month bins" : ""}</span></h2>
                    <div className="vmeta">
                      <PickMenu label="cohorts" title="which cohorts this view draws" busy={busy}
                        menuId={"pick:" + (resultViewKeys.current[vi] ?? vi)} menuStore={menuOpenRef.current}
                        options={Object.keys((result && result.cohorts) || {}).map((n) => ({ value: n, label: n }))}
                        chosen={cohortChoice(vi, docView(vi)).chosen} min={1}
                        onChange={(next) => setViewCohorts(vi, next, Object.keys((result && result.cohorts) || {}))} />
                    <details className="gearmenu inline">
                      <summary title="clinical course options">settings</summary>
                      {/* Every parameter of this chart is a choice, and the defaults are only a
                        guess at a good one — so all of them are settable. They live behind
                        the gear rather than above the figure because they are read when
                        setting a chart up and rarely after. Each event type shows the two
                        structural facts that decide whether it is worth plotting: how often
                        it recurs, and whether it carries a duration. */}
                  {v.eventOptions && v.eventOptions.length > 0 && (() => {
                    const cv: any = (doc.views || [])[vi] || {};
                    const chosen: string[] = (cv.eventTypes || []).map((x: string) => String(x).trim().toLowerCase());
                    const anchor = cv.anchor || null;
                    const toggle = (canon: string) => {
                      const next = chosen.includes(canon) ? chosen.filter(x => x !== canon) : [...chosen, canon];
                      if (next.length && next.length <= 6) patchView(vi, { eventTypes: next });
                    };
                    return (
                      <div className="gearmenu-items wide">
                        <div className="setcol"><span className="meta">measuring</span><div className="pillwrap">
                        {v.eventOptions.map(e => (
                          <button key={e.canonical} type="button" disabled={busy || (!chosen.includes(e.canonical) && chosen.length >= 6)}
                            className={"pill" + (chosen.includes(e.canonical) ? " on" : "")}
                            onClick={() => toggle(e.canonical)}
                            title={(!chosen.includes(e.canonical) && chosen.length >= 6 ? "a course view measures at most 6 event types — drop one first. " : "") +
                              e.patients.toLocaleString() + " patients · " + e.perPatient + " events each · " +
                              (e.hasDurations ? "carries durations, so it is drawn as a state patients are IN"
                                : e.perPatient < 1.5 ? "about one per patient and no duration — likely a filing record rather than a clinical course"
                                : "no durations, so it is drawn as an event that HAPPENED")}>
                            {e.label}{e.hasDurations ? " ⏱" : ""}
                          </button>
                        ))}
                        </div></div>
                        <hr />
                        <div className="setrow"><span className="meta">aligned on</span>
                        <select value={anchor ? String(anchor.eventType).trim().toLowerCase() : ""} disabled={busy}
                          onChange={e => patchView(vi, { anchor: e.target.value
                            ? { eventType: e.target.value, occurrence: anchor ? anchor.occurrence || "FIRST" : "FIRST" } : null })}>
                          <option value="">study day 0 (single study only)</option>
                          {v.eventOptions.map(e => <option key={e.canonical} value={e.canonical}>{e.label}</option>)}
                        </select>
                        {anchor && (
                          <select style={{ flex: "none" }} value={anchor.occurrence || "FIRST"} disabled={busy}
                            onChange={e => patchView(vi, { anchor: { ...anchor, occurrence: e.target.value } })}>
                            <option value="FIRST">first</option>
                            <option value="LAST">last</option>
                          </select>
                        )}
                        </div>
                        <div className="setrow"><span className="meta">bins</span>
                        <select value={String(v.courseAxis ? v.courseAxis.binMonths : 3)} disabled={busy}
                          onChange={e => patchView(vi, { binMonths: Number(e.target.value) })}>
                          {[1, 3, 6, 12].map(b => <option key={b} value={b}>{b} month{b === 1 ? "" : "s"}</option>)}
                        </select>
                        </div>
                        <div className="setrow"><span className="meta">window</span>
                        <select value={String(v.courseAxis ? v.courseAxis.from : -12)} disabled={busy}
                          onChange={e => patchView(vi, { fromMonths: Number(e.target.value) })}>
                          {[0, -6, -12, -24, -60].map(f => <option key={f} value={f}>{f === 0 ? "the anchor" : f + "mo"}</option>)}
                        </select>
                        <span className="meta" style={{ minWidth: 0 }}>to</span>
                        <select value={String(v.courseAxis ? v.courseAxis.to : 60)} disabled={busy}
                          onChange={e => patchView(vi, { toMonths: Number(e.target.value) })}>
                          {[12, 24, 60, 120, 240].map(t => <option key={t} value={t}>+{t}mo</option>)}
                        </select>
                        </div>
                      </div>
                    );
                  })()}
                    </details>
                    <Latency v={v} /><Participation p={v.participation} />
                    <ViewMenu menuId={"reorder:" + (resultViewKeys.current[vi] ?? vi)} menuStore={menuOpenRef.current} onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)} hasNote={!!v.annotationNote} />
                    </div>
                    </div>
                  {v.annotationNote && <p className="viewnote">{v.annotationNote}</p>}
                  {/* The same SVG the chat and MCP clients receive \u2014 one renderer,
                      so the figure cannot differ between surfaces. */}
                  <div style={{ overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: v.svg }} />
                </>}
                {v.kind === "oncoprint" && v.spec && (() => {
                  const c = contracts[JSON.stringify(v.spec)];
                  const vNames = ocView(vi).cohorts || Object.keys(result.cohorts);
                  const vStudies = [...new Set(vNames.flatMap(n => (result.cohorts[n] && result.cohorts[n].studies) || []))];
                  return <>
                    <ViewHead menuStore={menuOpenRef.current} v={{ ...v, ms: c ? c.stats.ms : v.ms }} title="Oncoprint" onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined} onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined} onRemove={() => removeView(vi)} onEditNote={() => openViewNoteEdit(vi)}
                      cohorts={cohortChoice(vi, docView(vi), 4)}
                      sub={c ? <>{c.stats.nColumns.toLocaleString()} {c.unit}s · {c.conventions.annotation}</> : "loading…"} />
                    <OncoprintFigure
                      spec={v.spec}
                      display={figureDisplay(ocView(vi))}
                      sortKeys={(ocView(vi).sort || []).map(sortKeyText)}
                      onDisplay={(d) => setViewDisplay(vi, d)}
                      onSortKeys={(keys) => setViewSort(vi, keys)}
                      onMoveTrack={(label, dir) => moveTrack(vi, label, dir)}
                      onRemoveTrack={(label) => removeTrack(vi, label)}
                      onExpandTrack={(label) => splitGeneTrack(vi, label)}
                      onContract={(ct) => { const k = JSON.stringify(v.spec); setContracts((m) => m[k] === ct ? m : { ...m, [k]: ct }); }}
                      onCreateCohort={(sel) => cohortFromSelection(sel, (c ? c.studies : vStudies) || vStudies)}
                      busy={busy}
                      controls={<>
                        <button className="tbbtn genesbtn" disabled={busy}
                          title="choose the genes this oncoprint draws" onClick={() => openGenes(vi)}>genes ({geneRowCount(ocView(vi))})</button>
                        <label className="tbfield" title="a cohort selects patients; sample mode draws every sample of those patients">columns <select
                          value={ocView(vi).unit || "patient"} disabled={busy}
                          onChange={(e) => updateView(vi, (vv: any) => { const n = { ...vv }; if (e.target.value === "sample") n.unit = "sample"; else delete n.unit; return n; })}>
                          <option value="patient">patients</option><option value="sample">samples</option>
                        </select></label>
                        <label className="tbfield" title="driver calls come from the version-pinned OncoKB store">annotate <select
                          value={(ocView(vi).display as any)?.annotate || "oncokb"} disabled={busy}
                          onChange={(e) => updateView(vi, (vv: any) => setDisplayKey(vv, "annotate", e.target.value === "none" ? "none" : undefined))}>
                          <option value="oncokb">OncoKB</option><option value="none">none</option>
                        </select></label>
                        <label className="chk tbchk" title="drop alterations the annotation source does not call drivers — this changes the percentages too, so it re-runs">
                          <input type="checkbox" checked={!!(ocView(vi).display as any)?.hideVUS} disabled={busy}
                            onChange={(e) => updateView(vi, (vv: any) => setDisplayKey(vv, "hideVUS", e.target.checked || undefined))} /> drivers only</label>
                      </>}
                      tracksMenu={<TracksMenu
                        attrs={trackAttrs.attrs} profiles={trackAttrs.profiles} loading={trackAttrsLoading}
                        clinical={ocView(vi).clinical || []} heatmap={ocView(vi).heatmap || []}
                        cohorts={Object.keys(result.cohorts)} derivedCohorts={ocView(vi).derivedCohorts || []}
                        busy={busy}
                        onClinical={(next) => setViewClinical(vi, next)}
                        onHeatmap={(next) => setViewHeatmap(vi, next)}
                        onDerived={(next) => updateView(vi, (vv: any) => { const n = { ...vv }; if (next.length) n.derivedCohorts = next; else delete n.derivedCohorts; return n; })} />}
                      footer={<>
                        {v.note && <p className="note" title={(v.studies || []).join(", ") || undefined}
                          style={v.studies && v.studies.length > 2 ? { cursor: "help", textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>{v.note}</p>}
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
                  </>;
                })()}
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
                {v.error && !drawsOwnHead(v) && <ViewHead menuStore={menuOpenRef.current} v={v}
                  title={(VIEW_KINDS.find((k) => k.kind === v.kind) || { label: v.kind }).label}
                  onMoveUp={vi > 0 ? () => moveView(vi, -1) : undefined}
                  onMoveDown={vi < result.views.length - 1 ? () => moveView(vi, 1) : undefined}
                  onRemove={() => removeView(vi)} />}
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

/**
 * What a figure can draw, chosen from what the involved studies actually hold. Two tabs
 * because clinical attributes and molecular profiles are picked differently; a search box
 * because a study can declare sixty attributes; the count of cases carrying each one, most
 * first, because that is what decides whether a track is worth a row.
 */
function TracksMenu({ attrs, profiles, clinical, heatmap, cohorts, derivedCohorts, busy, loading, onClinical, onHeatmap, onDerived }: {
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
  const [tab, setTab] = useState<"clinical" | "heatmap" | "cohorts">("clinical");
  const [q, setQ] = useState("");
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const heatOptions = ["VAF", ...profiles];
  const chosen = tab === "clinical" ? clinical : tab === "heatmap" ? heatmap.map((h) => h.profileType) : derivedCohorts;
  const shown = (tab === "clinical" ? attrs.map((a) => a.attribute) : tab === "heatmap" ? heatOptions : cohorts).filter(match);
  const cap = tab === "clinical" ? 8 : tab === "heatmap" ? 4 : 3;
  const toggle = (name: string) => {
    if (tab === "clinical") onClinical(clinical.includes(name) ? clinical.filter((x) => x !== name) : clinical.length < 8 ? [...clinical, name] : clinical);
    else if (tab === "heatmap") onHeatmap(chosen.includes(name) ? heatmap.filter((h) => h.profileType !== name) : heatmap.length < 4 ? [...heatmap, { profileType: name }] : heatmap);
    else onDerived(derivedCohorts.includes(name) ? derivedCohorts.filter((x) => x !== name) : derivedCohorts.length < 3 ? [...derivedCohorts, name] : derivedCohorts);
  };
  const setHeatGenes = (profileType: string, text: string) => {
    const genes = text.split(/[\s,]+/).map((g) => g.trim().toUpperCase()).filter(Boolean).slice(0, 12);
    onHeatmap(heatmap.map((h) => h.profileType === profileType ? (genes.length ? { ...h, genes } : { profileType }) : h));
  };
  return (
    <details className="gearmenu">
      <summary className="tbbtn" title="add or remove tracks">tracks{chosen.length ? " (" + chosen.length + ")" : ""}</summary>
      <div className="gearmenu-items wide" style={{ minWidth: 340 }}>
        <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
          <button className="linklike" style={{ fontWeight: tab === "clinical" ? 600 : 400 }} onClick={() => setTab("clinical")}>Clinical {attrs.length ? "(" + attrs.length + ")" : ""}</button>
          <button className="linklike" style={{ fontWeight: tab === "heatmap" ? 600 : 400 }} onClick={() => setTab("heatmap")}>Heatmap ({heatOptions.length})</button>
          <button className="linklike" style={{ fontWeight: tab === "cohorts" ? 600 : 400 }} onClick={() => setTab("cohorts")}>Cohort rows ({cohorts.length})</button>
          <span className="spacer" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" style={{ fontSize: "var(--t-md)", width: 120 }} />
        </div>
        <span className="meta">{chosen.length} of {cap} chosen{
          tab === "clinical" ? " · cases with data, most first"
          : tab === "heatmap" ? " · a profile draws one row per gene; leave the genes blank to follow the figure"
          : " · any cohort in this document can be a binary row (patients only, one study)"}</span>
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: "0.3rem" }}>
          {!shown.length && (loading && !attrs.length ? <Waiting what="tracks" />
            : <span className="meta">{q.trim() ? "nothing matches" : "nothing to choose from"}</span>)}
          {shown.map((name) => {
            const on = chosen.includes(name);
            const a = tab === "clinical" ? attrs.find((x) => x.attribute === name) : undefined;
            const h = tab === "heatmap" && on ? heatmap.find((x) => x.profileType === name) : undefined;
            return (
              <div key={name}>
                <label className="meta" style={{ display: "flex", gap: "0.4rem", alignItems: "baseline", padding: "0.1rem 0" }}>
                  <input type="checkbox" checked={on} disabled={busy || (!on && chosen.length >= cap)} onChange={() => toggle(name)} />
                  <span style={{ flex: 1 }}>{name === "VAF" ? "VAF (mutation allele fraction)" : name}{a?.kind === "num" ? " (numeric)" : ""}</span>
                  {a && <span style={{ fontVariantNumeric: "tabular-nums" }}>{a.patients.toLocaleString()}</span>}
                </label>
                {h && <input defaultValue={(h.genes || []).join(" ")} placeholder="genes for this profile — blank follows the figure"
                  disabled={busy} onBlur={(e) => setHeatGenes(name, e.target.value)}
                  style={{ fontSize: "var(--t-sm)", width: "100%", margin: "0 0 0.3rem 1.4rem" }} />}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
