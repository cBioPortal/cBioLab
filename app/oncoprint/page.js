"use client";
import { useEffect, useRef, useState } from "react";

const LINE2 = { a: { eventType: "Treatment line (derived)", attrs: [{ key: "LINE_NO", value: "2" }] }, rel: { type: "NONE" } };
const IMMUNO = { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] };
const PROG = { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] };

const PRESETS = [
  { name: "Immuno: progressed ≤180d vs not (2 groups)",
    layout: { groupBy: { kind: "cohorts", groups: [
      { name: "progressed ≤180d", dsl: { a: IMMUNO, b: PROG, rel: { type: "BEFORE", minDays: 0, maxDays: 180 } } },
      { name: "no progression ≤180d (observed)", dsl: { a: IMMUNO, b: PROG, rel: { type: "NOT_FOLLOWED_BY", withinDays: 180, observed: true } } }
    ] } } },
  { name: "Immuno-treated patients", cohort: { dsl: { a: IMMUNO, rel: { type: "NONE" } } } },
  { name: "True 1L immuno, guarded (prior-med restricted)",
    cohort: { dsl: { a: { ...IMMUNO, occurrence: "FIRST" }, rel: { type: "NONE" }, priorGuard: true } } },
  { name: "All patients", cohort: null }
];

// Okabe–Ito, CVD-safe
const CAT_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#F0E442", "#999999"];
const BITS = { MISSENSE: 1, TRUNCATING: 2, INFRAME: 4, SPLICE: 8, OTHER_MUT: 16, SV: 32, AMP: 64, HOMDEL: 128 };
const BIT_LABELS = [
  [BITS.AMP, "Amplification"], [BITS.HOMDEL, "Deep deletion"], [BITS.SV, "Structural variant"],
  [BITS.MISSENSE, "Missense"], [BITS.TRUNCATING, "Truncating"], [BITS.INFRAME, "In-frame"],
  [BITS.SPLICE, "Splice"], [BITS.OTHER_MUT, "Other mutation"]
];

function palette(dark) {
  return {
    unaltered: dark ? "#262d32" : "#e8ecee",
    np1: dark ? "#1b2126" : "#f4f6f7", np2: dark ? "#2c343a" : "#dfe4e7",
    amp: "#e41a1c", homdel: "#2166ac", sv: "#8e24aa",
    missense: "#2e7d32", truncating: dark ? "#f0f0f0" : "#111111",
    inframe: "#b8860b", splice: "#ff8c00", otherMut: "#9467bd",
    derived: dark ? "#45b8c2" : "#0f86a1",
    text: dark ? "#e4eaee" : "#1f2933", muted: dark ? "#93a3ad" : "#5b6b76",
    grid: dark ? "#2a353c" : "#dde4e8"
  };
}

const ROW_H = 20, ROW_GAP = 3, GUTTER = 168, GROUP_GAP = 10, HEADER_H = 20;

function drawContract(canvas, contract, dark, hover) {
  const P = palette(dark);
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const nTracks = contract.tracks.length;
  const cssH = HEADER_H + nTracks * (ROW_H + ROW_GAP) + 6;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  canvas.style.height = cssH + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.font = "11px 'IBM Plex Sans', sans-serif";

  const plotW = cssW - GUTTER - (contract.groups.length - 1) * GROUP_GAP;
  const n = contract.columns.length;
  const colW = plotW / n;
  // LOD: px buckets per group when columns are sub-pixel
  const groupX = [];
  let gx = GUTTER;
  for (const g of contract.groups) { groupX.push(gx); gx += g.count * colW + GROUP_GAP; }

  // group headers
  ctx.fillStyle = P.muted;
  contract.groups.forEach((g, gi) => {
    const w = g.count * colW;
    const label = g.name + " (" + g.count.toLocaleString() + ")";
    ctx.fillText(label, groupX[gi], 12, Math.max(60, w));
  });

  const bucketOf = (cells, from, count, pxW) => {
    // returns array of {x0,w,code} merged per device pixel when colW < 1
    const out = [];
    if (colW >= 1) {
      for (let i = 0; i < count; i++) out.push({ x0: i * colW, w: colW, code: cells[from + i], first: from + i });
      return out;
    }
    const buckets = Math.max(1, Math.floor(pxW));
    for (let b = 0; b < buckets; b++) {
      const i0 = Math.floor(b * count / buckets), i1 = Math.max(i0 + 1, Math.floor((b + 1) * count / buckets));
      let code = -1, sawAny = false;
      for (let i = i0; i < i1; i++) {
        const c = cells[from + i];
        if (c === -1) continue;
        sawAny = true;
        code = (code === -1 ? 0 : code) | (c > 0 ? c : 0);
      }
      out.push({ x0: b * pxW / buckets, w: pxW / buckets, code: sawAny ? code : -1, first: from + i0 });
    }
    return out;
  };

  contract.tracks.forEach((t, ti) => {
    const y = HEADER_H + ti * (ROW_H + ROW_GAP);
    // gutter label
    ctx.fillStyle = P.text;
    ctx.fillText(t.label.length > 17 ? t.label.slice(0, 16) + "…" : t.label, 4, y + 14);
    if (t.freqPct != null) {
      ctx.fillStyle = P.muted;
      ctx.textAlign = "right";
      ctx.fillText(t.freqPct + "%", GUTTER - 8, y + 14);
      ctx.textAlign = "left";
    }
    contract.groups.forEach((g, gi) => {
      const x0 = groupX[gi], pxW = g.count * colW;
      for (const b of bucketOf(t.cells, g.start, g.count, pxW)) {
        const x = x0 + b.x0, w = Math.max(b.w, 0.5);
        if (t.kind === "gene") {
          if (b.code === -1) { // not profiled: striped
            ctx.fillStyle = P.np1; ctx.fillRect(x, y, w, ROW_H);
            ctx.fillStyle = P.np2;
            ctx.fillRect(x, y + ROW_H * 0.4, w, ROW_H * 0.2);
          } else {
            ctx.fillStyle = b.code & BITS.AMP ? P.amp : b.code & BITS.HOMDEL ? P.homdel : P.unaltered;
            ctx.fillRect(x, y, w, ROW_H);
            if (b.code & BITS.SV) { ctx.fillStyle = P.sv; ctx.fillRect(x, y + ROW_H * 0.15, w, ROW_H * 0.7); }
            const mutBit = b.code & BITS.MISSENSE ? "missense" : b.code & BITS.TRUNCATING ? "truncating"
              : b.code & BITS.INFRAME ? "inframe" : b.code & BITS.SPLICE ? "splice" : b.code & BITS.OTHER_MUT ? "otherMut" : null;
            if (mutBit) { ctx.fillStyle = P[mutBit]; ctx.fillRect(x, y + ROW_H * 0.3, w, ROW_H * 0.4); }
          }
        } else if (t.kind === "derivedEvent") {
          ctx.fillStyle = b.code > 0 ? P.derived : P.unaltered;
          ctx.fillRect(x, y, w, ROW_H);
        } else { // clinical
          ctx.fillStyle = b.code === -1 ? P.np1 : CAT_COLORS[b.code % CAT_COLORS.length];
          ctx.fillRect(x, y, w, ROW_H);
        }
      }
    });
  });

  // hover crosshair
  if (hover) {
    ctx.strokeStyle = P.text; ctx.globalAlpha = 0.35;
    ctx.strokeRect(hover.x - 0.5, HEADER_H, 1, nTracks * (ROW_H + ROW_GAP) - ROW_GAP);
    ctx.globalAlpha = 1;
  }
  return { colW, groupX, cssH };
}

function decode(code) {
  if (code === -1) return ["not profiled"];
  if (code === 0) return ["no alteration"];
  return BIT_LABELS.filter(([b]) => code & b).map(([, l]) => l);
}

export default function OncoprintPage() {
  const [preset, setPreset] = useState(0);
  const [genes, setGenes] = useState("TP53 KRAS STK11 KEAP1 EGFR ARID1A MSH3");
  const [withDerived, setWithDerived] = useState(true);
  const [busy, setBusy] = useState(false);
  const [contract, setContract] = useState(null);
  const [error, setError] = useState(null);
  const [spec, setSpec] = useState(null);
  const [tip, setTip] = useState(null);
  const canvasRef = useRef(null);
  const geomRef = useRef(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const fn = e => setDark(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const p = PRESETS[preset];
      const s = {
        genes: genes.split(/[\s,]+/).filter(Boolean),
        clinical: ["OS_STATUS", "SMOKING_PREDICTIONS_3_CLASSES"],
        derivedEvents: withDerived ? [{ label: "Reached 2L", expression: LINE2 }] : [],
        cohort: p.cohort !== undefined ? p.cohort : null,
        layout: p.layout || null,
        conventions: { lineGap: 90 }
      };
      setSpec(s);
      const res = await fetch("/api/oncoprint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setContract(j);
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  };

  useEffect(() => { run(); /* initial render */ }, []); // eslint-disable-line

  useEffect(() => {
    if (!contract || !canvasRef.current) return;
    geomRef.current = drawContract(canvasRef.current, contract, dark, null);
    const onResize = () => { geomRef.current = drawContract(canvasRef.current, contract, dark, null); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [contract, dark]);

  const locate = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const g = geomRef.current; if (!g || !contract) return null;
    const ti = Math.floor((y - HEADER_H) / (ROW_H + ROW_GAP));
    if (ti < 0 || ti >= contract.tracks.length) return null;
    for (let gi = 0; gi < contract.groups.length; gi++) {
      const grp = contract.groups[gi], x0 = g.groupX[gi], w = grp.count * g.colW;
      if (x >= x0 && x < x0 + w) {
        const ci = grp.start + Math.min(grp.count - 1, Math.floor((x - x0) / g.colW));
        return { ti, ci, gi, x };
      }
    }
    return null;
  };

  const onMove = (e) => {
    const h = locate(e);
    if (!h) { setTip(null); geomRef.current = drawContract(canvasRef.current, contract, dark, null); return; }
    const t = contract.tracks[h.ti];
    const code = t.cells[h.ci];
    const value = t.kind === "clinical"
      ? (code === -1 ? "n/a" : t.categories[code] || "Other")
      : t.kind === "derivedEvent" ? (code ? "yes" : "no")
      : decode(code).join(" + ");
    setTip({ x: e.clientX, y: e.clientY, pid: contract.columns[h.ci], group: contract.groups[h.gi].name, track: t.label, value });
    geomRef.current = drawContract(canvasRef.current, contract, dark, { x: h.x });
  };

  const onClick = (e) => {
    const h = locate(e);
    if (!h) return;
    window.open("https://www.cbioportal.org/patient?studyId=" + contract.study + "&caseId=" + contract.columns[h.ci], "_blank");
  };

  const P = palette(dark);

  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">oncoprint from a declarative spec — render contract demo</span>
        <span className="spacer" />
        <a href="/" style={{ color: "var(--accent-ink)", fontSize: "0.8rem" }}>← query builder</a>
      </header>
      <main>
        <div className="card">
          <h2>Oncoprint spec</h2>
          <div className="row">
            <div style={{ minWidth: "20rem" }}>
              <label>Cohort / column groups (from the cohort DSL)</label>
              <select style={{ width: "100%" }} value={preset} onChange={e => setPreset(Number(e.target.value))}>
                {PRESETS.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "16rem" }}>
              <label>Gene tracks</label>
              <input style={{ width: "100%" }} value={genes} onChange={e => setGenes(e.target.value)} />
            </div>
            <label className="chk" style={{ marginBottom: "0.4rem" }}>
              <input type="checkbox" checked={withDerived} onChange={e => setWithDerived(e.target.checked)} />
              “Reached 2L” derived track
            </label>
            <button className="primary" id="renderBtn" disabled={busy} onClick={run}>
              {busy && <span className="spinner onprimary" />}{busy ? "Building…" : "Render"}
            </button>
          </div>
          <p className="note">Columns are patients; sorting is the classic staircase within each group. MSH3 is on the newer IMPACT panels only — its striped cells are <em>not profiled</em>, a different statement than “no alteration,” and its frequency uses the panel-aware denominator. Click any column to open that patient in the portal.</p>
        </div>

        {error && <div className="error">{error}</div>}

        {contract && <div className="card">
          <h2>Rendered contract <span className="plain">— {contract.stats.nColumns.toLocaleString()} patients · {contract.tracks.length} tracks · built in {(contract.stats.ms / 1000).toFixed(1)}s</span></h2>
          <div style={{ position: "relative" }}>
            <canvas id="oncoCanvas" ref={canvasRef} style={{ width: "100%", display: "block", cursor: "pointer" }}
              onMouseMove={onMove} onMouseLeave={() => { setTip(null); if (contract) drawContract(canvasRef.current, contract, dark, null); }}
              onClick={onClick} />
            {tip && <div style={{
              position: "fixed", left: tip.x + 12, top: tip.y + 12, zIndex: 10,
              background: "var(--card)", border: "1px solid var(--line)", borderRadius: 6,
              padding: "0.4rem 0.6rem", fontSize: "0.75rem", pointerEvents: "none", maxWidth: "18rem"
            }}>
              <div style={{ fontFamily: "IBM Plex Mono, monospace" }}>{tip.pid}</div>
              <div className="meta">{tip.group}</div>
              <div><strong>{tip.track}</strong>: {tip.value}</div>
            </div>}
          </div>
          <div className="legend-strip" style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", marginTop: "0.8rem", fontSize: "0.74rem", color: "var(--muted)" }}>
            {[["Amplification", P.amp], ["Deep deletion", P.homdel], ["Structural variant", P.sv],
              ["Missense", P.missense], ["Truncating", P.truncating], ["In-frame", P.inframe], ["Splice", P.splice],
              ["Reached 2L", P.derived]].map(([l, c]) => (
              <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ width: 11, height: 11, background: c, borderRadius: 2, display: "inline-block" }} />{l}
              </span>
            ))}
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, display: "inline-block", background: `repeating-linear-gradient(45deg, ${P.np1}, ${P.np1} 2px, ${P.np2} 2px, ${P.np2} 4px)` }} />
              Not profiled
            </span>
            {contract.tracks.filter(t => t.kind === "clinical").map(t => (
              <span key={t.label} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                <strong style={{ color: "var(--ink)" }}>{t.label}:</strong>
                {t.categories.map((c, i) => (
                  <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                    <span style={{ width: 10, height: 10, background: CAT_COLORS[i % CAT_COLORS.length], borderRadius: 2, display: "inline-block" }} />{c}
                  </span>
                ))}
              </span>
            ))}
          </div>
          <details>
            <summary>Spec &amp; contract</summary>
            <pre>{JSON.stringify(spec, null, 2)}</pre>
            <p className="note">Contract: {contract.stats.nColumns.toLocaleString()} columns · conventions: {JSON.stringify(contract.conventions)}</p>
          </details>
        </div>}
      </main>
    </>
  );
}
