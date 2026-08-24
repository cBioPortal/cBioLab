"use client";
import { useEffect, useRef, useState } from "react";

const CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];
const IMMUNO_EVENT = { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" } };

const DEFAULT_DOC = {
  cohorts: {
    "STK11-driver immuno": { all: [{ kind: "alteration", gene: "STK11", driver: "driverOnly" }, IMMUNO_EVENT] },
    "STK11-wt immuno": { all: [{ not: { kind: "alteration", gene: "STK11" } }, IMMUNO_EVENT] }
  },
  views: [
    { kind: "compare", genes: ["TP53", "KRAS", "KEAP1", "SMARCA4", "EGFR", "ARID1A", "MSH3"] },
    { kind: "survival" },
    { kind: "oncoprint", genes: ["STK11", "KEAP1", "KRAS", "TP53", "SMARCA4"] }
  ]
};

function KMChart({ curves }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = 260;
    c.width = W * dpr; c.height = H * dpr; c.style.height = H + "px";
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const ink = dark ? "#e4eaee" : "#1f2933", grid = dark ? "#2a353c" : "#dde4e8", muted = dark ? "#93a3ad" : "#5b6b76";
    const L = 44, R = 10, T = 10, B = 28;
    const tMax = Math.max(12, ...curves.flatMap(cv => cv.points.map(p => p.t)));
    const x = t => L + (W - L - R) * t / tMax, y = s => T + (H - T - B) * (1 - s);
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.font = "10px 'IBM Plex Sans',sans-serif";
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.beginPath(); ctx.moveTo(L, y(s)); ctx.lineTo(W - R, y(s)); ctx.stroke();
      ctx.fillText(Math.round(s * 100) + "%", 8, y(s) + 3);
    }
    const step = tMax > 60 ? 24 : 12;
    for (let t = 0; t <= tMax; t += step) { ctx.fillText(t + "mo", x(t) - 8, H - 10); }
    curves.forEach((cv, i) => {
      ctx.strokeStyle = CAT_COLORS[i % CAT_COLORS.length]; ctx.lineWidth = 2; ctx.beginPath();
      let px = x(0), py = y(1); ctx.moveTo(px, py);
      for (const p of cv.points) { const nx = x(p.t), ny = y(p.s); ctx.lineTo(nx, py); ctx.lineTo(nx, ny); py = ny; }
      ctx.lineTo(x(tMax), py); ctx.stroke();
    });
  }, [curves]);
  return <canvas ref={ref} style={{ width: "100%", display: "block" }} />;
}

export default function AnalysisPage() {
  const [doc, setDoc] = useState(DEFAULT_DOC);
  const [docText, setDocText] = useState(JSON.stringify(DEFAULT_DOC, null, 2));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatReady, setChatReady] = useState(null);
  const [tab, setTab] = useState("analysis");
  const [saved, setSaved] = useState({});          // name -> {def, savedAt, lastEval:{count,text}}
  const [cName, setCName] = useState("");
  const [cDefText, setCDefText] = useState(JSON.stringify({ all: [{ kind: "alteration", gene: "KRAS", driver: "driverOnly" }] }, null, 2));
  const [cPreview, setCPreview] = useState(null);
  const [cBusy, setCBusy] = useState(false);

  const LS_KEY = "cohortlab.savedCohorts";
  const persist = (next) => { setSaved(next); try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {} };

  const previewCohort = async (name, defText) => {
    setCBusy(true); setCPreview(null);
    try {
      const def = JSON.parse(defText);
      const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohorts: { [name || "preview"]: def }, views: [] }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      const c = Object.values(j.cohorts)[0];
      setCPreview({ count: c.count, text: c.text });
      return { def, eval: { count: c.count, text: c.text } };
    } catch (e) { setCPreview({ error: String(e.message || e) }); return null; }
    finally { setCBusy(false); }
  };

  const saveCohort = async () => {
    const name = cName.trim();
    if (!name) { setCPreview({ error: "give the cohort a name" }); return; }
    const r = await previewCohort(name, cDefText);
    if (!r) return;
    persist({ ...saved, [name]: { def: r.def, savedAt: new Date().toISOString().slice(0, 16).replace("T", " "), lastEval: r.eval } });
  };

  const addToAnalysis = (name) => {
    const d = { ...doc, cohorts: { ...doc.cohorts, [name]: saved[name].def } };
    setDoc(d); setDocText(JSON.stringify(d, null, 2)); setTab("analysis"); run(d);
  };

  const run = async (d = doc) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setResult(j);
      try { history.replaceState(null, "", "?doc=" + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")); } catch {}
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  };

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem("cohortlab.savedCohorts") || "{}")); } catch {}
    fetch("/api/chat").then(r => setChatReady(r.status !== 501)).catch(() => setChatReady(false));
    try {
      const b64 = new URLSearchParams(window.location.search).get("doc");
      if (b64) {
        const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0))));
        setDoc(d); setDocText(JSON.stringify(d, null, 2)); run(d); return;
      }
    } catch (e) { setError("bad ?doc= link: " + String(e.message || e)); }
    run(DEFAULT_DOC);
  }, []); // eslint-disable-line

  const applyText = () => {
    try { const d = JSON.parse(docText); setDoc(d); run(d); }
    catch (e) { setError("document JSON: " + String(e.message || e)); }
  };

  const sendChat = async () => {
    const msg = chatInput.trim(); if (!msg || chatBusy) return;
    setChatInput(""); setChatBusy(true);
    const msgs = [...chat, { role: "user", text: msg }];
    setChat(msgs);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })), doc, resultSummary: summarize(result) }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setChat([...msgs, { role: "assistant", text: j.reply }]);
      if (j.doc) {
        setDoc(j.doc); setDocText(JSON.stringify(j.doc, null, 2)); run(j.doc);
      }
    } catch (e) { setChat([...msgs, { role: "assistant", text: "⚠ " + String(e.message || e) }]); }
    setChatBusy(false);
  };

  const summarize = (r) => {
    if (!r) return "no results yet";
    const parts = Object.entries(r.cohorts).map(([n, c]) => `${n}: ${c.count} patients (${c.text})`);
    for (const v of r.views) {
      if (v.kind === "compare" && v.rows) parts.push("compare top: " + v.rows.slice(0, 4).map(x => `${x.gene} ${x.cells[0].anyPct}% vs ${x.cells[1] ? x.cells[1].anyPct : "-"}% p=${x.pAny ? x.pAny.toExponential(1) : "-"}`).join("; "));
      if (v.kind === "survival") parts.push("survival medians: " + v.curves.map(c => `${c.cohort}=${c.median ? c.median.toFixed(1) : ">obs"}mo (n=${c.n})`).join("; "));
    }
    return parts.join(" | ");
  };

  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">analysis document — cohorts, views, and chat over one declarative object</span>
        <span className="spacer" />
        <a href="/oncoprint" style={{ color: "var(--accent-ink)", fontSize: "0.8rem", marginRight: "0.8rem" }}>oncoprint</a>
        <a href="/" style={{ color: "var(--accent-ink)", fontSize: "0.8rem" }}>builder</a>
      </header>
      <main style={{ maxWidth: "96rem" }}>
        <div className="tabs">
          <button className={tab === "analysis" ? "active" : ""} onClick={() => setTab("analysis")}>Analysis</button>
          <button className={tab === "cohorts" ? "active" : ""} onClick={() => setTab("cohorts")}>Cohorts</button>
        </div>
        {error && <div className="error">{error}</div>}

        {tab === "cohorts" && <div className="grid2">
          <div className="card">
            <h2>Create a cohort</h2>
            <label>Name</label>
            <input style={{ width: "100%" }} value={cName} onChange={e => setCName(e.target.value)} placeholder="e.g. KRAS-driver never-smokers" />
            <label>Definition</label>
            <textarea value={cDefText} onChange={e => setCDefText(e.target.value)} spellCheck={false}
              style={{ width: "100%", height: "16rem", font: "0.72rem 'IBM Plex Mono',monospace", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "0.6rem" }} />
            <div className="recipes" style={{ margin: "0.5rem 0" }}>
              <button onClick={() => setCDefText(JSON.stringify({ all: [{ kind: "alteration", gene: "KRAS", driver: "driverOnly" }] }, null, 2))}>alteration</button>
              <button onClick={() => setCDefText(JSON.stringify({ all: [{ kind: "clinical", attribute: "SMOKING_PREDICTIONS_3_CLASSES", op: "=", value: "Never" }] }, null, 2))}>clinical</button>
              <button onClick={() => setCDefText(JSON.stringify({ all: [{ kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "BEFORE", minDays: 0, maxDays: 180 } }] }, null, 2))}>timeline event</button>
              <button onClick={() => setCDefText(JSON.stringify({ all: [{ kind: "alteration", gene: "STK11", driver: "driverOnly" }, { kind: "event", a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" }, priorGuard: true }] }, null, 2))}>combined</button>
            </div>
            <div className="row">
              <button className="primary" disabled={cBusy} onClick={() => previewCohort(cName, cDefText)}>{cBusy && <span className="spinner onprimary" />}Preview</button>
              <button className="primary" disabled={cBusy} onClick={saveCohort}>Save</button>
            </div>
            {cPreview && (cPreview.error
              ? <div className="error">{cPreview.error}</div>
              : <p className="qdesc" style={{ marginTop: "0.6rem" }}><strong>{cPreview.count.toLocaleString()}</strong> patients — {cPreview.text}</p>)}
          </div>
          <div className="card">
            <h2>Saved cohorts <span className="plain">— this browser (localStorage)</span></h2>
            {Object.keys(saved).length === 0 && <p className="note">Nothing saved yet. Create one on the left, or ask chat to define one and save it from the Analysis tab.</p>}
            {Object.entries(saved).map(([n, s2]) => (
              <div key={n} style={{ borderTop: "1px solid var(--line)", padding: "0.55rem 0" }}>
                <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong>{n}</strong>
                  {s2.lastEval && <span className="meta">{s2.lastEval.count.toLocaleString()} pts</span>}
                  <span className="meta">saved {s2.savedAt}</span>
                  <span className="spacer" />
                  <button className="linklike" onClick={() => addToAnalysis(n)}>add to analysis</button>
                  <button className="linklike" onClick={() => { setCName(n); setCDefText(JSON.stringify(s2.def, null, 2)); setCPreview(s2.lastEval || null); }}>edit</button>
                  <button className="linklike" onClick={() => { const nx = { ...saved }; delete nx[n]; persist(nx); }}>delete</button>
                </div>
                {s2.lastEval && <div className="meta" style={{ marginTop: "0.15rem" }}>{s2.lastEval.text}</div>}
              </div>
            ))}
          </div>
        </div>}

        {tab === "analysis" && <div className="ana-grid">

          {/* ---- Define ---- */}
          <div>
            <div className="card">
              <h2>Cohorts &amp; views <span className="plain">— the document</span></h2>
              {result && Object.entries(result.cohorts).map(([n, c], i) => (
                <p key={n} className="qdesc" style={{ marginBottom: "0.5rem" }}>
                  <span className="qchip"><span className="qletter" style={{ color: CAT_COLORS[i % CAT_COLORS.length] }}>■</span>{n}</span>{" "}
                  <strong>{c.count.toLocaleString()}</strong> — {c.text}
                </p>
              ))}
              <textarea value={docText} onChange={e => setDocText(e.target.value)} spellCheck={false}
                style={{ width: "100%", height: "22rem", font: "0.72rem 'IBM Plex Mono',monospace", background: "var(--code-bg)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "0.6rem" }} />
              <div className="row" style={{ marginTop: "0.6rem" }}>
                <button className="primary" disabled={busy} onClick={applyText}>{busy && <span className="spinner onprimary" />}{busy ? "Running…" : "Run document"}</button>
                {result && <span className="meta">{result.stats.ms}ms · OncoKB {result.oncokbPin}</span>}
              </div>
              <p className="note">Clause kinds: <code>alteration</code> (gene, driver), <code>clinical</code> (attribute/op/value), <code>event</code> (timeline DSL), <code>patients</code>; composed with <code>all</code> / <code>any</code> / <code>not</code>. Views: <code>compare</code>, <code>survival</code>, <code>oncoprint</code>.</p>
            </div>
          </div>

          {/* ---- Views ---- */}
          <div>
            {result && result.views.map((v, vi) => (
              <div className="card" key={vi}>
                {v.kind === "compare" && v.rows && <>
                  <h2>Compare <span className="plain">— alteration frequencies · {v.annotation}</span></h2>
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
                  <div className="legend-strip" style={{ display: "flex", gap: "1.2rem", fontSize: "0.76rem", color: "var(--muted)", marginTop: "0.4rem", flexWrap: "wrap" }}>
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
            {!result && <div className="card"><div className="loading-block"><span className="spinner" /> Evaluating analysis document…</div></div>}
          </div>

          {/* ---- Chat ---- */}
          <div className="card ana-chat">
            <h2>Chat <span className="plain">— edits the same document</span></h2>
            {chatReady === false && <p className="note">Chat needs <code>ANTHROPIC_API_KEY</code> in the server environment. The document editor and views work without it.</p>}
            <div style={{ maxHeight: "26rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.6rem" }}>
              {chat.map((m, i) => (
                <div key={i} style={{ fontSize: "0.82rem", background: m.role === "user" ? "var(--accent-soft)" : "var(--code-bg)", borderRadius: 8, padding: "0.45rem 0.65rem", whiteSpace: "pre-wrap" }}>{m.text}</div>
              ))}
              {chatBusy && <div className="loading-block" style={{ padding: "0.2rem 0" }}><span className="spinner" /> thinking…</div>}
            </div>
            <div className="row">
              <input style={{ flex: 1 }} placeholder="e.g. restrict both cohorts to lung… " value={chatInput}
                onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} disabled={chatReady === false} />
              <button className="primary" onClick={sendChat} disabled={chatBusy || chatReady === false}>Send</button>
            </div>
            <p className="note">Try: “why might STK11 patients do worse?” · “add MSH3 and NF1 to the compare view” · “restrict both cohorts to treatment-naïve patients”.</p>
          </div>
        </div>}
      </main>
    </>
  );
}
