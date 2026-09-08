"use client";
// Paste tables, get an oncoprint. The portal's Oncoprinter, on this engine: the same
// interactive figure the analysis page draws, over data that never touches the database.
import { useMemo, useState } from "react";
import OncoprintFigure, { DEFAULT_FIGURE_DISPLAY, type FigureDisplay } from "../../_oncoprint/OncoprintFigure.tsx";

export default function ImportOncoprint({ sample }: { sample: { events: string; clinical: string; coverage: string } }) {
  const [events, setEvents] = useState(sample.events);
  const [clinical, setClinical] = useState(sample.clinical);
  const [coverage, setCoverage] = useState(sample.coverage);
  const [groupBy, setGroupBy] = useState("");
  const [draw, setDraw] = useState(0);          // bumping this is what re-reads the boxes
  const [display, setDisplay] = useState<FigureDisplay>(DEFAULT_FIGURE_DISPLAY);
  const [sortKeys, setSortKeys] = useState<string[]>([]);

  // the figure refetches when this changes, so it is rebuilt only when Draw is pressed
  const spec = useMemo(() => ({
    events, clinical: clinical.trim() || undefined, coverage: coverage.trim() || undefined,
    groupBy: groupBy || undefined, sort: sortKeys.length ? sortKeys : undefined, display, study: "pasted data"
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [draw, sortKeys.join(" "), JSON.stringify(display)]);

  const attrs = useMemo(() => {
    const head = clinical.split(/\r?\n/)[0] || "";
    return head.split("\t").slice(1).map((h) => h.replace(/\((number|string|lognumber)\)\s*$/i, "").trim()).filter(Boolean);
  }, [clinical]);

  const box = (label: string, hint: string, value: string, set: (v: string) => void, rows: number) => (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", flex: 1, minWidth: 260 }}>
      <span className="meta"><strong>{label}</strong> — {hint}</span>
      <textarea value={value} spellCheck={false} onChange={(e) => set(e.target.value)} rows={rows}
        style={{ font: "12px/1.4 'IBM Plex Mono', monospace", background: "var(--code-bg)", color: "var(--ink)",
          border: "1px solid var(--line)", borderRadius: 6, padding: "0.4rem", resize: "vertical" }} />
    </label>
  );

  return (
    <>
      <div className="card">
        <div className="row" style={{ gap: "0.8rem", alignItems: "stretch", flexWrap: "wrap" }}>
          {box("events", "patient · gene · alteration · type", events, setEvents, 12)}
          {box("clinical", "patient · one column per attribute (optional)", clinical, setClinical, 12)}
          {box("coverage", "patient · genes the panel covers (optional)", coverage, setCoverage, 12)}
        </div>
        <div className="row" style={{ marginTop: "0.6rem", alignItems: "center", gap: "0.6rem" }}>
          <label className="meta">group by <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} style={{ fontSize: "0.78rem" }}>
            <option value="">nothing</option>
            {attrs.map((a) => <option key={a} value={a}>{a}</option>)}
          </select></label>
          <span className="spacer" />
          <span className="meta">type is MISSENSE · TRUNC · INFRAME · SPLICE · PROMOTER · OTHER · FUSION · AMP · HOMDEL, with an optional _DRIVER suffix</span>
          <button className="linklike" onClick={() => setDraw((n) => n + 1)}>Draw</button>
        </div>
      </div>
      <div className="card">
        <OncoprintFigure endpoint="/api/oncoprint/local" spec={spec}
          display={display} sortKeys={sortKeys} onDisplay={setDisplay} onSortKeys={setSortKeys}
          heading={<h2 style={{ margin: 0 }}>Pasted data <span className="plain">— no database, no cohort; the same figure the analysis page draws</span></h2>} />
      </div>
    </>
  );
}
