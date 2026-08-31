"use client";
import { useEffect, useRef, useState } from "react";
import CohortPills, { normalizeDef } from "./pills";
import { heatmapTrackLabel } from "../../lib/profile-names.js";

const CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];
const IMMUNO_EVENT = { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" } };

const EXAMPLES = [
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

function KMChart({ curves }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = 260;
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + "px";
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const grid = dark ? "#2a353c" : "#dde4e8", muted = dark ? "#93a3ad" : "#5b6b76";
    const L = 44, R = 10, T = 10, B = 28;
    const tMax = Math.max(12, ...curves.flatMap(cv => cv.points.map(p => p.t)));
    const x = t => L + (W - L - R) * t / tMax, y = s => T + (H - T - B) * (1 - s);
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.font = "10px 'IBM Plex Sans',sans-serif";
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.beginPath(); ctx.moveTo(L, y(s)); ctx.lineTo(W - R, y(s)); ctx.stroke();
      ctx.fillText(Math.round(s * 100) + "%", 8, y(s) + 3);
    }
    const step = tMax > 60 ? 24 : 12;
    for (let t = 0; t <= tMax; t += step) ctx.fillText(t + "mo", x(t) - 8, H - 10);
    curves.forEach((cv, i) => {
      ctx.strokeStyle = CAT_COLORS[i % CAT_COLORS.length]; ctx.lineWidth = 2; ctx.beginPath();
      let py = y(1); ctx.moveTo(x(0), py);
      for (const p of cv.points) { const nx = x(p.t), ny = y(p.s); ctx.lineTo(nx, py); ctx.lineTo(nx, ny); py = ny; }
      ctx.lineTo(x(tMax), py); ctx.stroke();
    });
  }, [curves]);
  return <canvas ref={ref} style={{ width: "100%", display: "block" }} />;
}

const EMPTY_DOC = { cohorts: {}, views: [] };
const DEFAULT_VIEWS = [
  { kind: "compare", genes: ["TP53", "KRAS", "STK11", "KEAP1", "EGFR", "ARID1A", "MSH3"] },
  { kind: "survival" },
  { kind: "oncoprint", genes: ["TP53", "KRAS", "STK11", "KEAP1", "EGFR"] }
];

export default function AnalysisPage() {
  const [tab, setTab] = useState("cohorts");
  const [doc, setDoc] = useState(EMPTY_DOC);
  const [docText, setDocText] = useState(JSON.stringify(EMPTY_DOC, null, 2));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatReady, setChatReady] = useState(null);
  const [saved, setSaved] = useState({});
  const [cName, setCName] = useState("");
  const [cDefText, setCDefText] = useState(JSON.stringify({ study: "msk_chord_2024", all: [] }, null, 2));
  const [cPreview, setCPreview] = useState(null);
  const [cBusy, setCBusy] = useState(false);
  const [exEvals, setExEvals] = useState({});
  const [studies, setStudies] = useState([]);
  const [study, setStudy] = useState("msk_chord_2024");
  const [explore, setExplore] = useState(null);
  const [exploreBusy, setExploreBusy] = useState(false);
  const [trackAttrs, setTrackAttrs] = useState({ key: "", attrs: [], profiles: [] }); // track picker options
  const [sQuery, setSQuery] = useState("");                             // study-panel search
  const [sCaps, setSCaps] = useState(() => new Set());                  // study-panel capability filters
  const [exStudies, setExStudies] = useState(["msk_chord_2024"]);       // studies being explored (checkboxes)
  const [exPanelOpen, setExPanelOpen] = useState(false);                // study panel expanded?
  const exSel = useRef(["msk_chord_2024"]);                             // current selection (ref: immune to state races)
  const exFetchTimer = useRef(null);                                    // debounce for multi-toggle refetch
  const exFetchSeq = useRef(0);                                         // stale-response guard for explore fetches
  const [qaAttr, setQaAttr] = useState("");                             // creator quick-add: attribute
  const [qaVal, setQaVal] = useState("");                               // creator quick-add: numeric threshold
  const [qaGene, setQaGene] = useState("");                             // creator quick-add: gene

  const LS_KEY = "cohortlab.savedCohorts";
  const persist = (next) => { setSaved(next); try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {} };

  const run = async (d = doc) => {
    if (!Object.keys(d.cohorts || {}).length) { setResult(null); return; }
    setBusy(true); setError(null);
    try {
      const payload = { study: d.study || study, ...d };
      const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setResult(j);
      try { history.replaceState(null, "", "?doc=" + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")); } catch {}
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  };

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem(LS_KEY) || "{}")); } catch {}
    fetch("/api/chat").then(r => setChatReady(r.status !== 501)).catch(() => setChatReady(false));
    fetch("/api/studies").then(r => r.json()).then(j => setStudies(j.studies || [])).catch(() => {});
    try {
      const b64 = new URLSearchParams(window.location.search).get("doc");
      if (b64) {
        const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0))));
        if (d.study) { setStudy(d.study); setExStudies([d.study]); exSel.current = [d.study]; }
        setDoc(d); setDocText(JSON.stringify(d, null, 2)); setTab("analysis"); run(d);
      }
    } catch (e) { setError("bad ?doc= link: " + String(e.message || e)); }
  }, []); // eslint-disable-line

  const applyText = () => {
    try { const d = JSON.parse(docText); setDoc(d); run(d); }
    catch (e) { setError("document JSON: " + String(e.message || e)); }
  };

  // ---- cohort creator / library -----------------------------------------
  const evalDef = async (name, def) => {
    const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study, cohorts: { [name || "preview"]: def }, views: [] }) });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    const c = Object.values(j.cohorts)[0];
    return { count: c.count, text: c.text };
  };

  const previewCohort = async () => {
    setCBusy(true); setCPreview(null);
    try {
      const def = JSON.parse(cDefText);
      const ev = await evalDef(cName, def);
      setCPreview(ev);
      return { def, ev };
    } catch (e) { setCPreview({ error: String(e.message || e) }); return null; }
    finally { setCBusy(false); }
  };

  const saveCohort = async () => {
    const name = cName.trim();
    if (!name) { setCPreview({ error: "give the cohort a name" }); return; }
    const r = await previewCohort();
    if (!r) return;
    persist({ ...saved, [name]: { def: r.def, savedAt: new Date().toISOString().slice(0, 16).replace("T", " "), lastEval: r.ev } });
  };

  const parseDraft = () => { try { const d = JSON.parse(cDefText); return d.all && d.all.length ? d : null; } catch { return null; } };

  const fetchExplore = async (draftOverride, studiesOverride) => {
    const seq = ++exFetchSeq.current; // a later call (or an emptied selection) supersedes this one
    setExploreBusy(true);
    try {
      const list = studiesOverride ? (Array.isArray(studiesOverride) ? studiesOverride : [studiesOverride]) : exSel.current;
      if (!list.length) { setExplore(null); setExploreBusy(false); return; }
      const res = await fetch("/api/explore", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studies: list, draft: draftOverride !== undefined ? draftOverride : parseDraft() }) });
      const j = await res.json();
      if (seq !== exFetchSeq.current) return; // superseded while in flight — discard
      if (!j.error) setExplore(j); else setError(j.error);
    } catch (e) { if (seq === exFetchSeq.current) setError(String(e.message || e)); }
    if (seq === exFetchSeq.current) setExploreBusy(false);
  };

  const addClause = (clause) => {
    let d; try { d = normalizeDef(JSON.parse(cDefText)); } catch { d = null; }
    if (!d || !Array.isArray(d.all)) d = { all: [] };
    if (clause.kind === "clinical" && clause.op === "=") {
      const same = d.all.find(c => c.kind === "clinical" && c.attribute === clause.attribute && (c.per || "patient") === (clause.per || "patient") && (c.op === "=" || c.values));
      if (same) { // second value on the same attribute becomes an OR list
        const vals = new Set([...(same.values || []), ...(same.op === "=" ? [same.value] : []), clause.value]);
        delete same.op; delete same.value; same.values = [...vals];
        const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d); return;
      }
    }
    if (clause.kind === "oql") {
      const same = d.all.find(c => c.kind === "oql");
      if (same) { same.q += "; " + clause.q; const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d); return; }
    }
    d.all.push(clause);
    const txt = JSON.stringify(d, null, 2); setCDefText(txt); fetchExplore(d);
  };

  const removeDraftClause = (i) => {
    try {
      const d = normalizeDef(JSON.parse(cDefText));
      d.all = d.all.filter((_, j) => j !== i);
      setCDefText(JSON.stringify(d, null, 2));
      fetchExplore(d.all.length ? d : null);
    } catch {}
  };

  // studies-explicit draft scaffold for the current explore selection
  const draftScaffold = (ids) => {
    const d = { all: [] };
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
  const setExploreStudies = (ids) => {
    exSel.current = ids;
    setExStudies(ids);
    if (ids.length) setStudy(ids[0]); // doc-level default for study-less defs (examples, hand edits)
    let d; try { d = normalizeDef(JSON.parse(cDefText)); } catch { d = null; }
    if (!d || !Array.isArray(d.all)) d = { all: [] };
    if (ids.length > 1) { d.studies = ids; delete d.study; }
    else { delete d.studies; if (ids.length === 1) d.study = ids[0]; else delete d.study; }
    setCDefText(JSON.stringify(d, null, 2));
    clearTimeout(exFetchTimer.current);
    if (!ids.length) { exFetchSeq.current++; setExplore(null); setExploreBusy(false); setExPanelOpen(true); return; } // empty selection: clear facets (and void in-flight fetches), keep the picker open
    exFetchTimer.current = setTimeout(() => fetchExplore(d.all.length ? d : null, ids), 350);
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
        const seen = new Map(); // attribute -> kind
        const profs = new Set(); // continuous molecular profiles (for heatmap tracks)
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

  const updateView = (vi, patch) => {
    const views = (doc.views || []).map((v, i) => i === vi ? patch(v) : v);
    const d = { ...doc, views };
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); run(d);
  };

  const heatmapLabels = (v) => (v.heatmap || []).flatMap(h =>
    (h.genes && h.genes.length ? h.genes : v.genes || []).map(g => heatmapTrackLabel(String(g).toUpperCase(), h.profileType)));

  const pruneSort = (v) => {
    // drop sort keys whose track no longer exists
    const keep = new Set(["genomic", "Study", ...(v.clinical || []), ...heatmapLabels(v)]);
    const sort = (v.sort || []).filter(s => keep.has(String(s).replace(/^-/, "")));
    if (sort.length) v.sort = sort; else delete v.sort;
    return v;
  };

  const setViewClinical = (vi, attrs) => updateView(vi, v => pruneSort({ ...v, clinical: attrs }));

  const setViewHeatmap = (vi, entries) => updateView(vi, v => {
    const next = { ...v };
    if (entries.length) next.heatmap = entries; else delete next.heatmap;
    return pruneSort(next);
  });

  const setViewSort = (vi, key) => updateView(vi, v => {
    if (key === "genomic") { const { sort, ...rest } = v; return rest; }
    return { ...v, sort: [key] };
  });

  const removeCohort = (name) => {
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
  };

  const addDefToAnalysis = (name, def) => {
    const d = { ...doc, study, cohorts: { ...doc.cohorts, [name]: def } };
    if (!d.views || !d.views.length) d.views = DEFAULT_VIEWS; // a cohort with nothing to look at is a blank page
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); setTab("analysis"); run(d);
  };

  const previewExample = async (ex) => {
    setExEvals(s => ({ ...s, [ex.name]: { busy: true } }));
    try { const ev = await evalDef(ex.name, ex.def); setExEvals(s => ({ ...s, [ex.name]: ev })); }
    catch (e) { setExEvals(s => ({ ...s, [ex.name]: { error: String(e.message || e) } })); }
  };

  const saveExample = async (ex) => {
    let ev = exEvals[ex.name] && exEvals[ex.name].count != null ? exEvals[ex.name] : null;
    if (!ev) { try { ev = await evalDef(ex.name, ex.def); setExEvals(s => ({ ...s, [ex.name]: ev })); } catch { ev = null; } }
    persist({ ...saved, [ex.name]: { def: ex.def, savedAt: new Date().toISOString().slice(0, 16).replace("T", " "), lastEval: ev } });
  };

  // ---- chat ---------------------------------------------------------------
  const summarize = (r) => {
    if (!r) return "no results yet (document may be empty)";
    const parts = Object.entries(r.cohorts).map(([n, c]) => `${n}: ${c.count} patients (${c.text})`);
    for (const v of r.views) {
      if (v.kind === "compare" && v.rows) parts.push("compare top: " + v.rows.slice(0, 4).map(x => `${x.gene} ${x.cells[0].anyPct}% vs ${x.cells[1] ? x.cells[1].anyPct : "-"}% p=${x.pAny ? x.pAny.toExponential(1) : "-"}`).join("; "));
      if (v.kind === "survival") parts.push("survival medians: " + v.curves.map(c => `${c.cohort}=${c.median ? c.median.toFixed(1) : ">obs"}mo (n=${c.n})`).join("; "));
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
        setDoc(j.doc); setDocText(JSON.stringify(j.doc, null, 2)); setTab("analysis"); run(j.doc);
      }
    } catch (e) { setChat([...msgs, { role: "assistant", text: "⚠ " + String(e.message || e) }]); }
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
          <button className={tab === "explore" ? "active" : ""} onClick={() => { setTab("explore"); if (!explore) fetchExplore(); }}>Explore</button>
          <button className={tab === "cohorts" ? "active" : ""} onClick={() => setTab("cohorts")}>Cohorts</button>
          <button className={tab === "analysis" ? "active" : ""} onClick={() => setTab("analysis")}>Analysis</button>
        </div>
        {error && <div className="error">{error}</div>}

        {/* ================= Explore tab ================= */}
        {tab === "explore" && <div>
          {(() => {
            const CAP_FILTERS = [
              ["timeline", "timeline events", s => s.timelinePatients > 0],
              ["mrna", "mRNA", s => s.caps && s.caps.mrna],
              ["protein", "protein", s => s.caps && s.caps.protein],
              ["ga", "generic assay", s => s.caps && s.caps.ga],
              ["oncokb", "OncoKB-synced", s => s.oncokb]
            ];
            const byId = new Map(studies.map(s => [s.id, s]));
            const selPts = exStudies.reduce((n, id) => n + (byId.get(id) ? byId.get(id).patients : 0), 0);
            const toggle = (id) => {
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
                    exStudies.length + (exStudies.length === 1 ? " study" : " studies") + " · " + selPts.toLocaleString() + " patients" + (exStudies.length > 1 ? " (overlap not deduplicated)" : "")}</span></h2>
                  {exStudies.map(id => (
                    <span key={id} className="qchip" title={byId.get(id) ? byId.get(id).name : id}>
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
              <input placeholder="name this cohort…" value={cName} onChange={e => setCName(e.target.value)} />
              <button className="primary" onClick={saveCohort}>Save</button>
              <button className="primary" onClick={() => { const d = parseDraft(); if (d) addDefToAnalysis(cName.trim() || "explored cohort", d); }}>Add to analysis</button>
              <button onClick={clearDraft}>Clear</button>
            </div>
          </div>
          {exStudies.length === 0 && <div className="card"><p className="note" style={{ fontSize: "0.85rem", margin: 0 }}>
            No studies selected — check one or more above to explore.</p></div>}
          {!explore && exStudies.length > 0 && <div className="card"><div className="loading-block"><span className="spinner" /> Building study facets…</div></div>}
          {explore && <div className="two-col" style={{ alignItems: "start" }}>
            <div>
              <div className="card">
                <h2>Clinical <span className="plain">— patient &amp; sample attributes</span></h2>
                {explore.clinical.map(c => (
                  <div key={c.per + c.attribute} style={{ borderTop: "1px solid var(--line)", padding: "0.45rem 0" }}>
                    <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{c.attribute} <span className="meta">{c.per === "sample" ? "· sample-level" : ""} · {c.patients.toLocaleString()} pts</span></div>
                    {c.kind === "cat" && <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.25rem" }}>
                      {c.values.map(v => {
                        const d = parseDraft();
                        const sel = d && d.all.some(cl => cl.kind === "clinical" && cl.attribute === c.attribute &&
                          ((cl.op === "=" && cl.value === v.v) || (cl.values || []).includes(v.v)));
                        return (
                          <button key={v.v} className={"facet" + (sel ? " on" : "")} onClick={() => addClause({ kind: "clinical", attribute: c.attribute, op: "=", value: v.v, ...(c.per === "sample" ? { per: "sample" } : {}) })}>
                            {v.v.length > 28 ? v.v.slice(0, 27) + "…" : v.v} <span className="meta">{v.n.toLocaleString()}</span>
                          </button>
                        );
                      })}
                    </div>}
                    {c.kind === "num" && <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", marginTop: "0.25rem", flexWrap: "wrap" }}>
                      <span className="meta">min {Math.round(c.min * 10) / 10} · median {Math.round(c.median * 10) / 10} · max {Math.round(c.max * 10) / 10}</span>
                      <button className="facet" onClick={() => addClause({ kind: "clinical", attribute: c.attribute, range: { gte: Math.round(c.median * 10) / 10 }, ...(c.per === "sample" ? { per: "sample" } : {}) })}>≥ median</button>
                      <button className="facet" onClick={() => addClause({ kind: "clinical", attribute: c.attribute, range: { lt: Math.round(c.median * 10) / 10 }, ...(c.per === "sample" ? { per: "sample" } : {}) })}>&lt; median</button>
                    </div>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="card">
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
                <CohortPills def={d} onRemoveClause={(i) => {
                  const nd = normalizeDef(JSON.parse(cDefText));
                  nd.all = nd.all.filter((_, j) => j !== i);
                  setCDefText(JSON.stringify(nd, null, 2)); setCPreview(null);
                }} />
              </div>) : <p className="note">⚠ definition JSON doesn’t parse yet</p>; })()}
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <button className="primary" disabled={cBusy} onClick={previewCohort}>{cBusy && <span className="spinner onprimary" />}Preview</button>
              <button className="primary" disabled={cBusy} onClick={saveCohort}>Save</button>
            </div>
            {cPreview && (cPreview.error
              ? <div className="error">{cPreview.error}</div>
              : <p className="qdesc" style={{ marginTop: "0.6rem" }}><strong>{cPreview.count.toLocaleString()}</strong> patients — {cPreview.text}</p>)}
            <p className="note">Clause kinds: <code>oql</code> (genomic status, portal OQL syntax), <code>clinical</code> (attribute/op/value), <code>event</code> (timeline), <code>patients</code>; composed with <code>all</code> / <code>any</code> / <code>not</code>. Start from an example on the right, or ask chat above.</p>
          </div>
          <div className="card">
            <h2>Examples</h2>
            {EXAMPLES.map(ex => {
              const ev = exEvals[ex.name];
              return (
                <div key={ex.name} style={{ borderTop: "1px solid var(--line)", padding: "0.5rem 0" }}>
                  <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong>{ex.name}</strong>
                    <span className="meta">{ex.desc}</span>
                    {ev && ev.count != null && <span className="meta"><strong>{ev.count.toLocaleString()}</strong> pts</span>}
                    {ev && ev.busy && <span className="spinner" />}
                    <span className="spacer" />
                    <button className="linklike" onClick={() => previewExample(ex)}>preview</button>
                    <button className="linklike" onClick={() => { setCName(ex.name); setCDefText(JSON.stringify(ex.def, null, 2)); setCPreview(null); }}>open in editor</button>
                    <button className="linklike" onClick={() => saveExample(ex)}>save</button>
                    <button className="linklike" onClick={() => addDefToAnalysis(ex.name, ex.def)}>add to analysis</button>
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
                  <strong>{n}</strong>
                  {s2.lastEval && <span className="meta">{s2.lastEval.count.toLocaleString()} pts</span>}
                  <span className="meta">saved {s2.savedAt}</span>
                  <span className="spacer" />
                  <button className="linklike" onClick={() => addDefToAnalysis(n, s2.def)}>add to analysis</button>
                  <button className="linklike" onClick={() => { setCName(n); setCDefText(JSON.stringify(s2.def, null, 2)); setCPreview(s2.lastEval || null); }}>edit</button>
                  <button className="linklike" onClick={() => { const nx = { ...saved }; delete nx[n]; persist(nx); }}>delete</button>
                </div>
                <div style={{ marginTop: "0.25rem" }}><CohortPills def={s2.def} /></div>
              </div>
            ))}
          </div>
        </div>}

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
                  The analysis document is empty. Add cohorts from the <button className="linklike" onClick={() => setTab("cohorts")}>Cohorts tab</button>,
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
            {result && result.views.map((v, vi) => (
              <div className="card" key={vi}>
                {v.kind === "compare" && v.rows && <>
                  <h2>Compare <span className="plain">— alteration frequencies · {v.annotation}</span></h2>
                  {v.note && <p className="note" title={(v.studies || []).join(", ") || undefined}
                    style={v.studies && v.studies.length > 2 ? { cursor: "help", textDecorationLine: "underline", textDecorationStyle: "dotted" } : undefined}>{v.note}</p>}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "0.8rem", width: "100%" }}>
                      <thead><tr>
                        <th style={{ textAlign: "left", padding: "0.3rem 0.6rem" }}>gene</th>
                        {v.cohorts.map((n, i) => <th key={n} style={{ textAlign: "right", padding: "0.3rem 0.6rem", color: CAT_COLORS[i] }}>{n}<br /><span style={{ fontWeight: 400, color: "var(--muted)" }}>driver / any</span></th>)}
                        {v.rows[0] && v.rows[0].pAny != null && <th style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>p (any)</th>}
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
                {v.kind === "survival" && <>
                  <h2>Survival <span className="plain">— Kaplan–Meier, overall survival</span></h2>
                  <KMChart curves={v.curves} />
                  <div style={{ display: "flex", gap: "1.2rem", fontSize: "0.76rem", color: "var(--muted)", marginTop: "0.4rem", flexWrap: "wrap" }}>
                    {v.curves.map((c, i) => <span key={c.cohort}><span style={{ display: "inline-block", width: 10, height: 10, background: CAT_COLORS[i], borderRadius: 2, marginRight: 5 }} />{c.cohort}: median {c.median ? c.median.toFixed(1) + "mo" : "not reached"} (n={c.n}, {c.events} events)</span>)}
                  </div>
                  <p className="note">{v.caveat}</p>
                </>}
                {v.kind === "oncoprint" && v.svg && <>
                  <div className="row" style={{ alignItems: "baseline" }}>
                    <h2 style={{ margin: 0 }}>Oncoprint <span className="plain">— {v.nColumns.toLocaleString()} patients · {v.annotation}</span></h2>
                    <span className="spacer" />
                    <details className="gearmenu">
                      <summary title="oncoprint options">⚙</summary>
                      <div className="gearmenu-items">
                        {(() => {
                          const vNames = (doc.views && doc.views[vi] && doc.views[vi].cohorts) || Object.keys(result.cohorts);
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
                    {((doc.views && doc.views[vi] && doc.views[vi].clinical) || []).map(a => (
                      <button key={a} className="linklike" disabled={busy} title="remove this track"
                        onClick={() => setViewClinical(vi, (doc.views[vi].clinical || []).filter(x => x !== a))}>{a} ✕</button>
                    ))}
                    <select value="" disabled={busy || !trackAttrs.attrs.length}
                      onChange={e => { const a = e.target.value; if (!a) return;
                        const cur = (doc.views && doc.views[vi] && doc.views[vi].clinical) || [];
                        if (!cur.includes(a) && cur.length < 8) setViewClinical(vi, [...cur, a]); }}
                      style={{ fontSize: "0.78rem" }}>
                      <option value="">{trackAttrs.attrs.length ? "add clinical track…" : "loading attributes…"}</option>
                      {trackAttrs.attrs.filter(a => !((doc.views && doc.views[vi] && doc.views[vi].clinical) || []).includes(a.attribute))
                        .map(a => <option key={a.attribute} value={a.attribute}>{a.attribute}{a.kind === "num" ? " (numeric)" : ""}</option>)}
                    </select>
                    <span className="meta">heatmap:</span>
                    {((doc.views && doc.views[vi] && doc.views[vi].heatmap) || []).map((h, hi) => (
                      <button key={h.profileType} className="linklike" disabled={busy} title="remove this heatmap"
                        onClick={() => setViewHeatmap(vi, (doc.views[vi].heatmap || []).filter((_, j) => j !== hi))}>{h.profileType} ✕</button>
                    ))}
                    <select value="" disabled={busy}
                      onChange={e => { const p = e.target.value; if (!p) return;
                        const cur = (doc.views && doc.views[vi] && doc.views[vi].heatmap) || [];
                        if (!cur.some(h => h.profileType === p) && cur.length < 4) setViewHeatmap(vi, [...cur, { profileType: p }]); }}
                      style={{ fontSize: "0.78rem" }}>
                      <option value="">add heatmap…</option>
                      {["VAF", ...(trackAttrs.profiles || [])].filter(p => !((doc.views && doc.views[vi] && doc.views[vi].heatmap) || []).some(h => h.profileType === p))
                        .map(p => <option key={p} value={p}>{p === "VAF" ? "VAF (mutation allele fraction)" : p}</option>)}
                    </select>
                    <span className="meta">sort:</span>
                    <select value={(doc.views && doc.views[vi] && doc.views[vi].sort && doc.views[vi].sort[0]) || "genomic"}
                      disabled={busy} onChange={e => setViewSort(vi, e.target.value)} style={{ fontSize: "0.78rem" }}>
                      <option value="genomic">genomic (staircase)</option>
                      {(result.involvedStudies || []).length > 1 && <option value="Study">Study</option>}
                      {((doc.views && doc.views[vi] && doc.views[vi].clinical) || []).flatMap(a => [
                        <option key={a} value={a}>{a} ↑</option>,
                        <option key={"-" + a} value={"-" + a}>{a} ↓</option>
                      ])}
                      {doc.views && doc.views[vi] && heatmapLabels(doc.views[vi]).flatMap(l => [
                        <option key={l} value={l}>{l} ↑</option>,
                        <option key={"-" + l} value={"-" + l}>{l} ↓</option>
                      ])}
                    </select>
                  </div>
                  <div style={{ overflowX: "auto", background: "#fff", borderRadius: 8, border: "1px solid var(--line)" }} dangerouslySetInnerHTML={{ __html: v.svg }} />
                </>}
                {v.error && <div className="error">{v.kind}: {v.error}</div>}
              </div>
            ))}
          </div>
        </div>}
      </main>
    </>
  );
}
