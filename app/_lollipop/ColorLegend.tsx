"use client";
// The portal's "Legend" panel above a lollipop (LegendColorCodes): what each circle colour means,
// a putative-driver and an unknown-significance line per mutation type (lib/lollipop.ts lollipopLegend).
import React from "react";
import { lollipopLegend } from "../../lib/lollipop.ts";

export function ColorLegend({ fusions = true, drivers = true }: { fusions?: boolean; drivers?: boolean }) {
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
          {lollipopLegend({ drivers, fusions }).map((e) => (
            <li key={e.label}>
              <strong style={{ color: e.color }}>{e.label}</strong>
              {e.items.length > 0 && <>: {e.items.join(", ")}</>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
