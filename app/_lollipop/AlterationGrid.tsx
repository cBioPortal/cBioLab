"use client";
// The portal's mutation-type badge selector beside a lollipop: rows by alteration class, Driver and
// VUS columns, each cell a count that hides or shows its mutations; a column's total or a row's name
// toggles all of it, and "only" keeps just it. The selection is the view's `hide` (lib/lollipop.ts
// cellOf). Drawn once per gene on the Results tab and once per group on the Comparison tab.
import React from "react";
import { IMPACT_COLORS, IMPACT_TYPES, cellOf, type AlterationCell, type ImpactType } from "../../lib/lollipop.ts";
import type { HotspotGene } from "../../lib/views/hotspots/types.ts";

type Col = "driver" | "vus";
type Tally = HotspotGene["tally"];
const COLS: Col[] = ["driver", "vus"];
const cell = (k: ImpactType, c: Col): AlterationCell => cellOf(k, c === "driver");

/** The classes a grid lists: the portal's five, and "Other" only when some tally has one. */
export function classesOf(tallies: Tally[]): ImpactType[] {
  return IMPACT_TYPES.filter((k) => k !== "other" || tallies.some((t) => t.other.driver || t.other.vus));
}

/** The next selection after a click: a cell toggles; a row or a column hides all of it, or shows all of it again. */
function toggled(hide: Set<string>, cells: AlterationCell[]): string[] {
  const next = new Set(hide);
  const allShown = cells.every((c) => !next.has(c));
  for (const c of cells) if (allShown) next.add(c); else next.delete(c);
  return [...next];
}

function Badge({ n, color, shown, onClick, title, label }: { n: number; color: string; shown: boolean; onClick: () => void; title: string; label: string }) {
  return (
    <button type="button" className={"lp-badge" + (shown ? "" : " off")} onClick={onClick} data-tip={title} aria-pressed={shown} aria-label={label}
      style={shown ? { background: color, borderColor: color } : { color, borderColor: color }}>
      {n.toLocaleString()}
    </button>
  );
}

/**
 * The grid for one tally. `of` names whose mutations they are (a comparison group) in each tooltip
 * and label; `note` is added to each tooltip (e.g. that a click acts on both groups).
 */
export function AlterationGrid({ tally, classes, hide, onHide, of, note }: {
  tally: Tally; classes: ImpactType[]; hide: Set<string>; onHide: (next: string[]) => void; of?: string; note?: string;
}) {
  const where = of ? " in " + of : "", tail = note ? "; " + note : "";
  const total = (c: Col) => classes.reduce((n, k) => n + tally[k][c], 0);
  const colCells = (c: Col) => classes.map((k) => cell(k, c));
  const rowCells = (k: ImpactType) => COLS.map((c) => cell(k, c));
  const every = classes.flatMap(rowCells);
  const only = (keep: AlterationCell[]) => onHide(every.filter((c) => !keep.includes(c)));
  const colShown = (c: Col) => colCells(c).some((x) => !hide.has(x));
  const colWord = (c: Col) => c === "driver" ? "putative driver" : "VUS";
  return (
    <table className="lp-grid">
      <thead><tr>
        <th />
        {COLS.map((c) => (
          <th key={c}>
            <span className="lp-head">
              <button type="button" className="lp-colname" onClick={() => onHide(toggled(hide, colCells(c)))}
                data-tip={(colShown(c) ? "hide" : "show") + " every " + colWord(c) + tail}>{c === "driver" ? "Driver" : "VUS"}</button>
              <Badge n={total(c)} color={c === "driver" ? "#000000" : "#696969"} shown={colShown(c)} onClick={() => onHide(toggled(hide, colCells(c)))}
                title={(colShown(c) ? "hide" : "show") + " every " + colWord(c) + " (" + total(c).toLocaleString() + " mutation rows" + where + ")" + tail}
                label={(c === "driver" ? "drivers" : "VUS") + " total" + where} />
              <button type="button" className="lp-only" onClick={() => only(colCells(c))} data-tip={"show only " + (c === "driver" ? "putative drivers" : "VUS") + tail}>only</button>
            </span>
          </th>))}
      </tr></thead>
      <tbody>
        {classes.map((k) => {
          const c = IMPACT_COLORS[k];
          const rowShown = rowCells(k).some((x) => !hide.has(x));
          return (
            <tr key={k}>
              <th scope="row">
                <span className="lp-head">
                  <button type="button" className={"lp-rowname" + (rowShown ? "" : " off")} style={{ color: k === "truncating" ? undefined : c.driver }}
                    onClick={() => onHide(toggled(hide, rowCells(k)))} data-tip={(rowShown ? "hide" : "show") + " every " + c.label.toLowerCase() + " mutation" + tail}>{c.label}</button>
                  <button type="button" className="lp-only" onClick={() => only(rowCells(k))} data-tip={"show only " + c.label.toLowerCase() + " mutations" + tail}>only</button>
                </span>
              </th>
              {COLS.map((col) => {
                const x = cell(k, col), on = !hide.has(x);
                return (
                  <td key={col}>
                    <Badge n={tally[k][col]} color={col === "driver" ? c.driver : c.vus} shown={on} onClick={() => onHide(toggled(hide, [x]))}
                      title={(on ? "hide " : "show ") + c.label.toLowerCase() + " " + (col === "driver" ? "putative drivers" : "VUS") + " (" + tally[k][col].toLocaleString() + " mutation rows" + where + ")" + tail}
                      label={c.label + " " + (col === "driver" ? "driver" : "VUS") + where} />
                  </td>);
              })}
            </tr>);
        })}
      </tbody>
    </table>
  );
}
