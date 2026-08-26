"use client";
import { useEffect, useRef, useState } from "react";
import CohortPills, { normalizeDef } from "./pills";

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
  { name: "STK11-driver in IMPACT-50k", desc: "cross-study: same definition, another study",
    def: { study: "msk_impact_50k_2026", all: [{ kind: "oql", q: "STK11: DRIVER" }] } },
  { name: "TP53-mut across CHORD + MET", desc: "cross-study union (overlap not deduplicated)",
    def: { studies: ["msk_chord_2024", "msk_met_2021"], all: [{ kind: "oql", q: "TP53: MUT" }] } },
  { name: "EGFR-driver pan-MSK", desc: "union across three MSK studies",
    def: { studies: ["msk_chord_2024", "msk_met_2021", "msk_impact_50k_2026"], all: [{ kind: "oql", q: "EGFR: DRIVER" }] } },
  { name: "ERBB2 over-expressed (TCGA BRCA)", desc: "cross-study: OQL EXP>2 where mRNA exists",
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
  const [cDefText, setCDefText] = useState(JSON.stringify(EXAMPLES[1].def, null, 2));
  const [cPreview, setCPreview] = useState(null);
  const [cBusy, setCBusy] = useState(false);
  const [exEvals, setExEvals] = useState({});
  const [studies, setStudies] = useState([]);
  const [study, setStudy] = useState("msk_chord_2024");

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
        if (d.study) setStudy(d.study);
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

  const switchStudy = (id) => {
    setStudy(id);
    const d = { study: id, cohorts: {}, views: [] };
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); setResult(null); setCPreview(null); setExEvals({});
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
        <div className="row" style={{ marginBottom: "0.8rem", alignItems: "center" }}>
          <label style={{ margin: 0 }}>Study</label>
          <select value={study} onChange={e => switchStudy(e.target.value)} style={{ maxWidth: "34rem" }}>
            {!studies.length && <option value={study}>{study}</option>}
            {studies.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.patients.toLocaleString()} pts{s.timelinePatients ? " · timeline" : ""}
              </option>
            ))}
          </select>
          <span className="meta">switching studies starts a fresh document (vocabularies differ)</span>
        </div>

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
          <button className={tab === "cohorts" ? "active" : ""} onClick={() => setTab("cohorts")}>Cohorts</button>
          <button className={tab === "analysis" ? "active" : ""} onClick={() => setTab("analysis")}>Analysis</button>
        </div>
        {error && <div className="error">{error}</div>}

        {/* ================= Cohorts tab ================= */}
        {tab === "cohorts" && <div className="grid2">
          <div className="card">
            <h2>Create a cohort</h2>
            <label>Name</label>
            <input style={{ width: "100%" }} value={cName} onChange={e => setCName(e.target.value)} placeholder="e.g. KRAS-driver never-smokers" />
            <label>Definition</label>
            <textarea value={cDefText} onChange={e => setCDefText(e.target.value)} spellCheck={false}
              style={{ width: "100%", height: "16rem", font: "0.72rem 'IBM Plex Mono',monospace", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "0.6rem" }} />
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
                    <strong>{c.count.toLocaleString()}</strong> patients
                  </p>
                  {doc.cohorts && doc.cohorts[n] && <CohortPills def={doc.cohorts[n]} />}
                </div>
              ))}
              <textarea value={docText} onChange={e => setDocText(e.target.value)} spellCheck={false}
                style={{ width: "100%", height: "20rem", font: "0.72rem 'IBM Plex Mono',monospace", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "0.6rem" }} />
              <div className="row" style={{ marginTop: "0.6rem" }}>
                <button className="primary" disabled={busy} onClick={applyText}>{busy && <span className="spinner onprimary" />}{busy ? "Running…" : "Run document"}</button>
                {result && <span className="meta">{result.stats.ms}ms · OncoKB {result.oncokbPin}</span>}
              </div>
              <p className="note">Views: <code>{`{"kind":"compare","genes":[…]}`}</code> · <code>{`{"kind":"survival"}`}</code> · <code>{`{"kind":"oncoprint","genes":[…]}`}</code></p>
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
                  {v.note && <p className="note">{v.note}</p>}
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
                  <h2>Oncoprint <span className="plain">— {v.nColumns.toLocaleString()} patients · {v.annotation}</span></h2>
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
