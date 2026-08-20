"use client";
import { useEffect, useState, useCallback, useId } from "react";

const EMPTY_SEL = { eventType: "", attrs: [{ key: "", value: "" }], occurrence: "ANY", minDurationDays: "", numKey: "", numOp: ">", numVal: "" };

const RECIPES = [
  { name: "Progression ≤180d after immuno",
    a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] },
    b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
    rel: { type: "BEFORE", minDays: 0, maxDays: 180 } },
  { name: "Progression while ON chemo",
    a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Chemo" }] },
    b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
    rel: { type: "DURING" } },
  { name: "Hormone therapy ≥1 year",
    a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Hormone" }], minDurationDays: 365 },
    rel: { type: "NONE" } },
  { name: "PSA >10 within 90d before first hormone",
    a: { eventType: "Lab_Test", attrs: [{ key: "TEST", value: "PSA" }], numKey: "RESULT", numOp: ">", numVal: "10" },
    b: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Hormone" }], occurrence: "FIRST" },
    rel: { type: "BEFORE", minDays: 0, maxDays: 90 } },
  { name: "First chemo, NO progression in 1y (observed)",
    a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Chemo" }], occurrence: "FIRST" },
    b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
    rel: { type: "NOT_FOLLOWED_BY", withinDays: 365, observed: true } },
  { name: "Surgery then radiation ≤90d",
    a: { eventType: "Surgery", attrs: [{ key: "SUBTYPE", value: "PROCEDURE" }] },
    b: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Radiation Therapy" }] },
    rel: { type: "BEFORE", minDays: 0, maxDays: 90 } },
  { name: "Sample acquired after progression",
    a: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
    b: { eventType: "Sample acquisition", attrs: [] },
    rel: { type: "BEFORE", minDays: 0, maxDays: 100000 } },
  { name: "ECOG ≥2 then immuno ≤90d",
    desc: "Poor performance status (ECOG ≥ 2) followed by an immunotherapy start within 90 days",
    a: { eventType: "Diagnosis", attrs: [{ key: "SUBTYPE", value: "Performance Status" }], numKey: "ECOG", numOp: ">=", numVal: "2" },
    b: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] },
    rel: { type: "BEFORE", minDays: 0, maxDays: 90 } },
  { name: "CEA >100 while ON chemo",
    desc: "A CEA lab value over 100 recorded during a chemo treatment interval",
    a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Chemo" }] },
    b: { eventType: "Lab_Test", attrs: [{ key: "TEST", value: "CEA" }], numKey: "RESULT", numOp: ">", numVal: "100" },
    rel: { type: "DURING" } },
  { name: "PD-L1 positive then immuno ≤180d",
    desc: "PD-L1-positive pathology result followed by immunotherapy within 6 months",
    a: { eventType: "Pathology", attrs: [{ key: "PDL1_POSITIVE", value: "Yes" }] },
    b: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] },
    rel: { type: "BEFORE", minDays: 0, maxDays: 180 } },
  { name: "Primary dx, never chemo in 2y",
    desc: "First primary diagnosis with no chemotherapy in the following two years, observed past the window",
    a: { eventType: "Diagnosis", attrs: [{ key: "SUBTYPE", value: "Primary" }], occurrence: "FIRST" },
    b: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Chemo" }] },
    rel: { type: "NOT_FOLLOWED_BY", withinDays: 730, observed: true } },
  { name: "True 1L immuno, progression-free 1y",
    desc: "First immunotherapy with no progression within a year — restricted to “No prior medications” patients, so line 1 really is line 1",
    a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }], occurrence: "FIRST" },
    b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
    rel: { type: "NOT_FOLLOWED_BY", withinDays: 365, observed: true },
    priorGuard: true },
  { name: "Progression ≤180d after starting 2L",
    desc: "Progression called within 180 days of starting second-line therapy — uses the derived treatment-line events (90-day gap rule)",
    a: { eventType: "Treatment line (derived)", attrs: [{ key: "LINE_NO", value: "2" }] },
    b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
    rel: { type: "BEFORE", minDays: 0, maxDays: 180 } },
  { name: "3+ lines of therapy",
    desc: "Patients who reached at least a third derived line of systemic therapy",
    a: { eventType: "Treatment line (derived)", attrs: [], numKey: "LINE_NO", numOp: ">=", numVal: "3" },
    rel: { type: "NONE" } }
];

function normSel(s) {
  return { ...EMPTY_SEL, ...s,
    attrs: (s.attrs && s.attrs.length ? s.attrs : [{ key: "", value: "" }]),
    minDurationDays: s.minDurationDays || "",
    numKey: s.numKey || "", numOp: s.numOp || ">", numVal: s.numVal || "" };
}

function toApiSel(s) {
  return {
    eventType: s.eventType,
    attrs: s.attrs.filter(a => a.key && a.value),
    occurrence: s.occurrence,
    minDurationDays: s.minDurationDays ? Number(s.minDurationDays) : null,
    numeric: s.numKey && s.numVal !== "" ? { key: s.numKey, op: s.numOp, value: Number(s.numVal) } : null
  };
}

function describeSelector(s) {
  const isLine = s.eventType === "Treatment line (derived)";
  const pre = [];
  if (s.occurrence === "FIRST") pre.push("first");
  if (s.occurrence === "LAST") pre.push("last");
  let base = s.eventType.replace(" (derived)", "").replace("Lab_Test", "lab test").toLowerCase();
  const brackets = [];
  for (const a of s.attrs || []) {
    if (!a.key || !a.value) continue;
    if (a.key === "SUBTYPE") pre.push(a.value);
    else if (a.key === "TEST") pre.push(a.value);
    else if (a.key === "PROGRESSION" && a.value === "Y") base = "progression";
    else if (a.key === "LINE_NO" && isLine) base = "treatment line " + a.value;
    else if (a.key === "COMPOSITION" && isLine) pre.push(a.value);
    else if (a.key === "GAP") continue;
    else brackets.push(a.key + "=" + a.value);
  }
  let label = [...pre, base].join(" ");
  if (brackets.length) label += " [" + brackets.join(", ") + "]";
  if (s.numKey && s.numVal !== "") label += " with " + s.numKey + " " + s.numOp + " " + s.numVal;
  if (s.minDurationDays) label += " lasting ≥" + s.minDurationDays + "d";
  return label;
}

function QueryDesc({ result }) {
  const { labelA, labelB, relSnap: rel, guardSnap: guard } = result;
  if (!rel) return null;
  const A = <span className="qchip"><span className="qletter">A:</span>{labelA}</span>;
  const B = labelB ? <span className="qchip"><span className="qletter">B:</span>{labelB}</span> : null;
  let body;
  if (rel.type === "BEFORE") {
    const win = Number(rel.minDays || 0) > 0 ? rel.minDays + "–" + rel.maxDays : "≤ " + rel.maxDays;
    body = <>Patients with {A} followed by {B} within <strong>{win} days</strong></>;
  } else if (rel.type === "DURING") {
    body = <>Patients with {B} during a {A} interval</>;
  } else if (rel.type === "NOT_FOLLOWED_BY") {
    body = <>Patients with {A} <span className="qnot">NOT</span> followed by {B} within <strong>{rel.withinDays} days</strong>{rel.observed ? " (observed past the window)" : ""}</>;
  } else {
    body = <>Patients with {A}</>;
  }
  return <p className="qdesc">{body}{guard ? <span className="qguard">restricted to “No prior medications” patients</span> : null}</p>;
}

function Bars({ rows }) {
  if (!rows || !rows.length) return <span className="meta">no rows</span>;
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div className="bar-row" key={i} title={r.label + ": " + r.n.toLocaleString()}>
          <span className="lbl">{r.label}</span>
          <span className="track"><span className="fill" style={{ width: (100 * r.n / max) + "%" }} /></span>
          <span className="val">{r.n.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function Selector({ tag, sel, setSel, catalog }) {
  const uid = useId();
  const keys = (catalog && catalog.keys[sel.eventType]) || [];
  const values = (catalog && catalog.values[sel.eventType]) || {};
  const setAttr = (i, field, v) => {
    const attrs = sel.attrs.map((a, j) => j === i ? { ...a, [field]: v } : a);
    setSel({ ...sel, attrs });
  };
  return (
    <div className="sel-card">
      <span className="tag">{tag}</span>
      <label>Event type</label>
      <select style={{ width: "100%" }} value={sel.eventType}
        onChange={e => setSel({ ...sel, eventType: e.target.value, attrs: [{ key: "", value: "" }] })}>
        {(catalog ? catalog.types : []).map(t => (
          <option key={t.t} value={t.t}>{t.t} ({Number(t.n_pat).toLocaleString()} pts)</option>
        ))}
      </select>
      <label>Attribute filters</label>
      {sel.attrs.map((a, i) => (
        <div className="attr-row" key={i}>
          <input list={uid + "-k"} placeholder="key" value={a.key} onChange={e => setAttr(i, "key", e.target.value)} />
          <input list={uid + "-v" + i} placeholder="value" value={a.value} onChange={e => setAttr(i, "value", e.target.value)} />
          <datalist id={uid + "-v" + i}>{(values[a.key] || []).map(v => <option key={v} value={v} />)}</datalist>
          <button type="button" className="rm" aria-label="remove filter"
            onClick={() => setSel({ ...sel, attrs: sel.attrs.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <datalist id={uid + "-k"}>{keys.map(k => <option key={k} value={k} />)}</datalist>
      {sel.attrs.length < 3 &&
        <button type="button" className="linklike" onClick={() => setSel({ ...sel, attrs: [...sel.attrs, { key: "", value: "" }] })}>
          + add attribute filter
        </button>}
      <div className="row">
        <div>
          <label>Occurrence</label>
          <select value={sel.occurrence} onChange={e => setSel({ ...sel, occurrence: e.target.value })}>
            <option>ANY</option><option>FIRST</option><option>LAST</option>
          </select>
        </div>
        <div>
          <label>Min duration (days)</label>
          <input type="number" placeholder="–" value={sel.minDurationDays}
            onChange={e => setSel({ ...sel, minDurationDays: e.target.value })} />
        </div>
      </div>
      <label>Numeric predicate (optional)</label>
      <div className="attr-row">
        <input list={uid + "-k"} placeholder="key e.g. RESULT" style={{ flex: 1.4 }} value={sel.numKey}
          onChange={e => setSel({ ...sel, numKey: e.target.value })} />
        <select style={{ width: "4.4rem" }} value={sel.numOp} onChange={e => setSel({ ...sel, numOp: e.target.value })}>
          <option>{">"}</option><option>{">="}</option><option>{"<"}</option><option>{"<="}</option><option>{"="}</option>
        </select>
        <input type="number" placeholder="value" style={{ flex: 1 }} value={sel.numVal}
          onChange={e => setSel({ ...sel, numVal: e.target.value })} />
      </div>
    </div>
  );
}

export default function Page() {
  const [catalog, setCatalog] = useState(null);
  const [catError, setCatError] = useState(null);
  const [selA, setSelA] = useState(normSel(RECIPES[0].a));
  const [selB, setSelB] = useState(normSel(RECIPES[0].b));
  const [rel, setRel] = useState({ type: "BEFORE", minDays: 0, maxDays: 180, withinDays: 365, observed: true });
  const [priorGuard, setPriorGuard] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [runError, setRunError] = useState(null);
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [recipeHint, setRecipeHint] = useState("Click a recipe to fill the cohort definition and run it.");
  const [gap, setGap] = useState("90");
  const [lineGuard, setLineGuard] = useState(false);
  const [linesBusy, setLinesBusy] = useState(false);
  const [lines, setLines] = useState(null);
  const [linesError, setLinesError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt) => {
      try {
        const j = await (await fetch("/api/catalog")).json();
        if (cancelled) return;
        if (j.error) throw new Error(j.error);
        setCatalog(j); setCatError(null);
      } catch (e) {
        if (cancelled) return;
        if (attempt < 3) setTimeout(() => load(attempt + 1), 3000);
        else setCatError(String(e.message || e));
      }
    };
    load(0);
    return () => { cancelled = true; };
  }, []);

  const runCohort = useCallback(async (a = selA, b = selB, r = rel, guard = priorGuard) => {
    setRunning(true); setRunError(null);
    try {
      const payload = { a: toApiSel(a), b: r.type === "NONE" ? null : toApiSel(b), rel: r, priorGuard: guard };
      const res = await fetch("/api/cohort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      j.labelA = describeSelector(a);
      j.labelB = r.type !== "NONE" ? describeSelector(b) : null;
      j.relSnap = { ...r };
      j.guardSnap = guard;
      setResult(j);
    } catch (e) { setRunError(String(e.message || e)); }
    setRunning(false);
  }, [selA, selB, rel, priorGuard]);

  const applyRecipe = (i) => {
    const rc = RECIPES[i];
    const a = normSel(rc.a), b = rc.b ? normSel(rc.b) : normSel({ eventType: catalog ? catalog.types[0].t : "" });
    const r = { ...rel, ...rc.rel, type: rc.rel.type };
    const guard = !!rc.priorGuard;
    setSelA(a); if (rc.b) setSelB(b); setRel(r); setPriorGuard(guard); setActiveRecipe(i);
    if (catalog && !running) {
      setRecipeHint("Applied “" + rc.name + "” — running…");
      runCohort(a, rc.b ? b : selB, r, guard).then(() => setRecipeHint("Applied “" + rc.name + "”."));
      setTimeout(() => {
        const el = document.getElementById("resultCard");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    } else if (running) {
      setRecipeHint("Applied “" + rc.name + "” — a query is still running; hit Run when it finishes.");
    } else {
      setRecipeHint("Applied “" + rc.name + "” — waiting for catalog to load.");
    }
  };

  const runLines = async () => {
    setLinesBusy(true); setLinesError(null);
    try {
      const res = await fetch("/api/lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gap: Number(gap), guard: lineGuard }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setLines(j);
    } catch (e) { setLinesError(String(e.message || e)); }
    setLinesBusy(false);
  };

  const pct = result && result.denom ? (100 * result.matched / result.denom) : 0;
  const histRows = result && result.hist ? result.hist.map(h => ({
    label: h.bucket + "–" + (h.bucket + (result.histBucket || 1) - 1) + "d", n: h.n })) : null;

  return (
    <>
      <header>
        <h1>Cohort Lab</h1>
        <span className="sub">temporal cohort queries over cBioPortal timeline events — live prototype</span>
        <span className="spacer" />
        <span className={"pill" + (catalog ? " on" : "")} id="connPill">
          {catalog || catError ? <span className="dot" /> : <span className="spinner" aria-label="loading" />}
          <span id="connText">{catalog ? catalog.study + " · " + catalog.totalPatients.toLocaleString() + " pts" : (catError ? "backend error" : "loading catalog…")}</span>
        </span>
      </header>
      <main>
        {catError && <div className="error">Backend: {catError}</div>}
        <div className="card">
          <h2>Recipes <span className="plain">— one click runs the full query</span></h2>
          <div className="recipes" id="recipes">
            {RECIPES.map((r, i) => (
              <button key={i} type="button" className={activeRecipe === i ? "active" : ""} data-i={i}
                title={r.desc || r.name} onClick={() => applyRecipe(i)}>{r.name}</button>
            ))}
          </div>
          <p className="note" id="recipeHint">{recipeHint}</p>
        </div>
        <div className="grid2">
          <div>
            <div className="card">
              <h2>Cohort definition</h2>
              <Selector tag="A · anchor event" sel={selA} setSel={setSelA} catalog={catalog} />
              <div className="sel-card">
                <span className="tag">relation</span>
                <label>Type</label>
                <select id="relType" value={rel.type} onChange={e => setRel({ ...rel, type: e.target.value })}>
                  <option value="NONE">A only (no second event)</option>
                  <option value="BEFORE">A then B within window</option>
                  <option value="DURING">B occurs during A&apos;s interval</option>
                  <option value="NOT_FOLLOWED_BY">A NOT followed by B within window</option>
                </select>
                {rel.type === "BEFORE" &&
                  <div className="row">
                    <div><label>Min days after A</label>
                      <input type="number" value={rel.minDays} onChange={e => setRel({ ...rel, minDays: e.target.value })} /></div>
                    <div><label>Max days after A</label>
                      <input type="number" value={rel.maxDays} onChange={e => setRel({ ...rel, maxDays: e.target.value })} /></div>
                  </div>}
                {rel.type === "NOT_FOLLOWED_BY" && <>
                  <div className="row">
                    <div><label>No B within days after A</label>
                      <input type="number" value={rel.withinDays} onChange={e => setRel({ ...rel, withinDays: e.target.value })} /></div>
                  </div>
                  <label className="chk" style={{ marginTop: "0.5rem" }}>
                    <input type="checkbox" checked={rel.observed} onChange={e => setRel({ ...rel, observed: e.target.checked })} />
                    require follow-up past the window (observability guard)
                  </label>
                </>}
              </div>
              {rel.type !== "NONE" && <Selector tag="B · second event" sel={selB} setSel={setSelB} catalog={catalog} />}
              {catalog && catalog.hasPriorMedFlag &&
                <label className="chk">
                  <input type="checkbox" checked={priorGuard} onChange={e => setPriorGuard(e.target.checked)} />
                  restrict to “No prior medications” patients (NLP flag)
                </label>}
              <div className="row" style={{ marginTop: "0.8rem" }}>
                <button className="primary" id="runBtn" disabled={!catalog || running} onClick={() => runCohort()}>
                  {running && <span className="spinner onprimary" />}
                  {running ? "Running…" : "Run cohort query"}
                </button>
              </div>
            </div>
          </div>

          <div className="card" id="resultCard">
            <h2>Result</h2>
            {!result && !runError && !running &&
              <div className="note">Define a cohort (or click a recipe) and run. Every result is computed live; credentials stay on the server.</div>}
            {!result && running &&
              <div className="loading-block"><span className="spinner" /> Running cohort query against ClickHouse…</div>}
            {result && <div id="resultBody" className={running ? "busy" : ""}>
              <div className="stats">
                <div className="stat"><div className="n accent" id="rMatched">{result.matched.toLocaleString()}</div><div className="lbl">patients in cohort</div></div>
                <div className="stat"><div className="n" id="rDenom">{result.denom.toLocaleString()}</div><div className="lbl">anchor-event patients</div></div>
                <div className="stat"><div className="n">{pct.toFixed(1)}%</div><div className="lbl">of anchor patients</div></div>
              </div>
              <div className="ratebar"><div style={{ width: Math.min(100, pct) + "%" }} /></div>
              <QueryDesc result={result} />
              {histRows && <div className="chart" id="histChart">
                <h3>Days from {result.labelA} to {/^(first|last) /.test(result.labelB || "") ? "subsequent " + result.labelB : "first subsequent " + result.labelB} <span className="meta">(patients, by minimum gap)</span></h3>
                <Bars rows={histRows} />
              </div>}
              <div className="chart">
                <h3>Sample patients <span className="meta">(links open the portal patient timeline)</span></h3>
                <div className="patients" id="rPatients">
                  {result.patients.length ? result.patients.map(pid => (
                    <a key={pid} target="_blank" rel="noopener noreferrer"
                      href={(catalog ? catalog.portal : "") + "/patient?studyId=" + encodeURIComponent(catalog ? catalog.study : "") + "&caseId=" + encodeURIComponent(pid)}>
                      {pid}
                    </a>
                  )) : <span className="meta">none</span>}
                </div>
              </div>
              <details>
                <summary>Generated SQL</summary>
                <div className="row" style={{ margin: "0.4rem 0" }}>
                  <button onClick={() => navigator.clipboard.writeText(result.sql)}>Copy</button>
                  <span className="meta">{result.ms} ms · {result.rowsRead.toLocaleString()} rows read</span>
                </div>
                <pre id="rSql">{result.sql}</pre>
              </details>
            </div>}
            {runError && <div className="error">{runError}</div>}
          </div>
        </div>

        <div className="card">
          <h2>Treatment lines explorer <span className="plain">— derived lines (interval merge over systemic-therapy events)</span></h2>
          <div className="row">
            <div>
              <label>New-line gap threshold (days)</label>
              <select id="lineGap" value={gap} onChange={e => setGap(e.target.value)}>
                <option>30</option><option>60</option><option>90</option><option>180</option>
              </select>
            </div>
            <label className="chk" style={{ marginBottom: "0.35rem" }}>
              <input type="checkbox" id="lineGuard" checked={lineGuard} onChange={e => setLineGuard(e.target.checked)} />
              “No prior medications” patients only
            </label>
            <button className="primary" id="linesBtn" disabled={!catalog || linesBusy} onClick={runLines}>
              {linesBusy && <span className="spinner onprimary" />}
              {linesBusy ? "Running…" : "Derive lines"}
            </button>
            {lines && !linesBusy && <span className="meta">{lines.ms} ms total</span>}
          </div>
          {!lines && linesBusy &&
            <div className="loading-block"><span className="spinner" /> Deriving treatment lines…</div>}
          {lines && <div className={"two-col" + (linesBusy ? " busy" : "")} style={{ marginTop: "1rem" }}>
            <div className="chart"><h3>Lines per patient</h3>
              <div id="lineHist"><Bars rows={lines.hist.map(r => ({ label: (r.bucket >= 8 ? "8+" : r.bucket) + (r.bucket === 1 ? " line" : " lines"), n: r.n }))} /></div>
            </div>
            <div className="chart"><h3>Line 1 → Line 2 transitions <span className="meta">(top 12, by regimen composition)</span></h3>
              <div id="lineTrans"><Bars rows={lines.transitions.map(r => ({ label: r.line1 + " → " + r.line2, n: r.n }))} /></div>
            </div>
          </div>}
          {lines && <details><summary>Generated SQL</summary><pre>{lines.sql}</pre></details>}
          {linesError && <div className="error">{linesError}</div>}
          <p className="note">Lines are derived from event sequence only — “line 1” means <em>first line observed in this study</em>. In msk_chord_2024, ~20% of treated patients carry the “Prior medications to MSK” flag and ~20% have no determination; use the guard above for true first-line questions.</p>
        </div>
      </main>
    </>
  );
}
