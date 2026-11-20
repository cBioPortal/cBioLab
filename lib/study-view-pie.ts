/**
 * The Study View's pie chart as the portal draws it (STS-PIE-2, STS-PIE-3, STS-PIE-7): its size in
 * its cell, which slices carry their count, and how a filtered chart greys the values it leaves out.
 */
import { GRID_CELL } from "./study-view-layout.ts";

/** a 1 × 1 card's chart area: the cell less its border, and less the 20 px header in height */
export const PIE_AREA = { w: GRID_CELL.w - 2, h: GRID_CELL.h - 20 } as const;

/** the pie's radius: min(w, h) / 2 − 20 */
export const pieRadius = (w: number, h: number): number => Math.min(w, h) / 2 - 20;

/** the pie is drawn 12 px above the area's centre */
export const PIE_LIFT = 12;

/**
 * Whether a slice shows its count: always past a quarter of the pie; a smaller one only where the
 * label fits, |tan(π·ratio/2)|·(r/5)·2 ≥ the label's width.
 */
export function pieLabelFits(ratio: number, radius: number, labelWidth: number): boolean {
  return ratio > 0.25 || Math.abs(Math.tan((Math.PI * ratio) / 2)) * (radius / 5) * 2 >= labelWidth;
}

/** an unselected value while the chart has a filter: grey at half opacity (selected ones keep their colour) */
export const PIE_UNSELECTED = { fill: "#D3D3D3", opacity: 0.5 } as const;
/** a selected value's outline while the chart has a filter */
export const PIE_SELECTED_STROKE = { color: "#cccccc", width: 3 } as const;
