"use client";
// The lab's wrapper around the shared figure: viewing options in local state, the timings
// panel on, and window.__onco exposed so headless runs can drive it.
import { useState } from "react";
import OncoprintFigure, { DEFAULT_FIGURE_DISPLAY, type FigureDisplay } from "../_oncoprint/OncoprintFigure.tsx";

export default function OncoprintLab({ spec }: { spec: Record<string, unknown> }) {
  const [display, setDisplay] = useState<FigureDisplay>(DEFAULT_FIGURE_DISPLAY);
  const [sortKey, setSortKey] = useState("");
  return (
    <div className="card" style={{ position: "relative" }}>
      <OncoprintFigure spec={spec} display={display} sortKey={sortKey} onDisplay={setDisplay} onSortKey={setSortKey} timings instrument />
    </div>
  );
}
