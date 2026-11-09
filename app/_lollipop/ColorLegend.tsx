"use client";
// The portal's "Legend" panel above a lollipop (LegendColorCodes): what each circle colour means,
// word for word, a putative-driver and an unknown-significance line per mutation type.
import React from "react";
import { IMPACT_COLORS, type ImpactType } from "../../lib/lollipop.ts";

const WHAT: Partial<Record<ImpactType, string>> = {
  truncating: "Nonsense, Nonstop, Frameshift deletion, Frameshift insertion, Splice site",
  inframe: "Inframe deletion, Inframe insertion",
  other: "All other types of mutations",
};
const ORDER: ImpactType[] = ["missense", "truncating", "inframe", "splice", "fusion", "other"];

export function ColorLegend({ fusions = true }: { fusions?: boolean }) {
  const types = ORDER.filter((k) => fusions || k !== "fusion");
  return (
    <div className="lp-legend" data-test="lollipop-legend">
      <strong>Color Codes</strong>
      <p>
        Mutation diagram circles are colored with respect to the corresponding mutation types. In case of different mutation
        types at a single position, color of the circle is determined with respect to the most frequent mutation type.
      </p>
      <div className="mt-2">
        Mutation types and corresponding color codes are as follows:
        <ul>
          {types.flatMap((k) => (k === "fusion" ? [true] : [true, false]).map((drv) => (
            <li key={k + drv}>
              <strong style={{ color: drv ? IMPACT_COLORS[k].driver : IMPACT_COLORS[k].vus }}>{IMPACT_COLORS[k].label} Mutations</strong>
              {k !== "fusion" && <span> ({drv ? "putative driver" : "unknown significance"})</span>}
              {WHAT[k] && <>: {WHAT[k]}</>}
            </li>
          )))}
        </ul>
      </div>
    </div>
  );
}
