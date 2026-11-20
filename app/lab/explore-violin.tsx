"use client";
// The Study View's clinical violin table (STS-VI-1…7): a categorical attribute against a numeric
// one, added from Add chart › X vs Y. A row per category: its mirrored curve and box across the
// numeric attribute's range, # with a checkbox that filters on the category, and its quartiles.
// The numbers come from lib/study-view-violin.ts over the counts Explore returns (violinFacets).
import { useMemo, useState } from "react";
import { ChartMenu } from "./partitions.tsx";
import { Input } from "../_ui/input.tsx";
import { linear } from "../../lib/chart/scale.ts";
import { fmtInt } from "../../lib/chart/format.ts";
import { PORTAL_VIOLIN } from "../../lib/chart/style.ts";
import type { ViolinFacet } from "../../lib/types.ts";
import { MUTATION_COUNT } from "../../lib/study-view-density.ts";
import {
  VIOLIN_HEIGHT, VIOLIN_MIN_N, violinLog, violinNumber, violinPairKey, violinPath, violinRows, violinTable, violinTitle, violinX, type ViolinRow
} from "../../lib/study-view-violin.ts";

type SortKey = "category" | "n" | "median" | "q1" | "q3";
const PAD = 5;

/** the column's grid: round values of the data's range, or on Log Scale round counts placed at ln(1 + count) */
function gridTicks(axis: [number, number], log: boolean): { at: number; label: string }[] {
  if (!(axis[1] > axis[0])) return [];
  if (!log) { const s = linear(axis[0], axis[1], 0, 1, { nice: false, count: 4 }); return s.ticks.map((t) => ({ at: t, label: s.fmt(t) })); }
  const out: { at: number; label: string }[] = [];
  for (let t = 1; violinLog(t) <= axis[1]; t *= 10) if (violinLog(t) >= axis[0]) out.push({ at: violinLog(t), label: fmtInt(t) });
  return out;
}

export function ViolinCard({ facet, nameOf, selected, onToggle, onRemove }: {
  facet: ViolinFacet;
  nameOf: (attribute: string) => string;
  /** the categories the selection filters on, folded as the facets fold them */
  selected: string[];
  onToggle: (category: string) => void;
  onRemove: () => void;
}) {
  const logOffered = facet.numeric === MUTATION_COUNT;
  const [log, setLog] = useState(false);
  const [showViolin, setShowViolin] = useState(true);
  const [showBox, setShowBox] = useState(true);
  const [minText, setMinText] = useState(String(VIOLIN_MIN_N));
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "n", desc: true });
  const useLog = logOffered && log;
  const table = useMemo(() => violinTable(facet.categories, useLog), [facet, useLog]);
  const minN = Number(minText);
  const rows = useMemo(() => {
    const kept = violinRows(table.rows, Number.isFinite(minN) ? minN : 0);
    if (sort.key === "n" && sort.desc) return kept;
    const val = (r: ViolinRow): number | string => sort.key === "category" ? r.category : sort.key === "n" ? r.n : r.box[sort.key];
    return [...kept].sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return sort.desc ? -c : c; });
  }, [table, minN, sort]);
  const numName = nameOf(facet.numeric), catName = nameOf(facet.categorical);
  const title = violinTitle(numName, catName, useLog);
  const width = 200;
  const ticks = gridTicks(table.axis, useLog);
  const x = (v: number) => violinX(v, table.axis, width - 2 * PAD, PAD);
  // a value as the reader reads it: Log Scale's ln(1 + v) turned back into a count
  const shown = (v: number) => violinNumber(useLog ? Math.exp(v) - 1 : v);
  const fold = (v: string) => v.trim().toLowerCase();
  const isOn = (c: string) => selected.some((s) => fold(s) === fold(c));
  const head = (key: SortKey, label: string, tip: string) => (
    <th scope="col"><button className="vt-sort" data-tip={tip} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "category" }))}>
      {label}{sort.key === key ? (sort.desc ? " ▾" : " ▴") : ""}</button></th>
  );
  return (
    <div className="card xc-card" data-chart="violin" data-pair={violinPairKey(facet)}>
      <div className="xc-head">
        <span className="xc-title" data-tip={title + "\nsample-level"}>{title}</span>
        <ChartMenu label={"the " + title + " chart"} actions={[
          ...(logOffered ? [{ label: "Log Scale", checked: useLog, title: useLog ? "draw " + numName + " on a linear scale" : "draw " + numName + " as ln(1 + count)", onClick: () => setLog(!log) }] : []),
          { label: "Show Violin Plot", checked: showViolin, title: "draw each category's distribution", onClick: () => setShowViolin(!showViolin) },
          { label: "Show Box Plot", checked: showBox, title: "draw each category's quartiles and whiskers", onClick: () => setShowBox(!showBox) },
          { label: "Remove chart", title: "stop drawing " + title, onClick: onRemove }]} />
      </div>
      <div className="xc-body">
        {facet.error ? <p className="note">{facet.error}</p> : !rows.length ? <p className="note">No data.</p> : (
          <table className="vtable">
            <thead>
              <tr>
                {head("category", catName, "sort by " + catName)}
                <th scope="col" className="vt-violin">
                  <button className="vt-sort" data-tip="sort by median" onClick={() => setSort((s) => ({ key: "median", desc: s.key === "median" ? !s.desc : true }))}>{numName}{useLog ? " (log)" : ""}</button>
                  <svg width={width} height={14} aria-hidden="true">
                    {ticks.map((t) => <text key={t.at} x={x(t.at)} y={11} textAnchor="middle" fontSize={9} fill="currentColor">{t.label}</text>)}
                  </svg>
                </th>
                {head("n", "#", "samples in the selection; check a category to filter on it")}
                {head("median", "Median", "sort by median")}
                {head("q1", "Quartile 1", "sort by the first quartile")}
                {head("q3", "Quartile 3", "sort by the third quartile")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.category}>
                  <td className="vt-cat">{r.category}</td>
                  <td className="vt-violin" data-tip={"Median: " + shown(r.box.median) + "\nQuartile 1: " + shown(r.box.q1) + "\nQuartile 3: " + shown(r.box.q3)}>
                    <svg width={width} height={VIOLIN_HEIGHT} role="img" aria-label={r.category + ": median " + shown(r.box.median)}>
                      {ticks.map((t) => <line key={t.at} x1={x(t.at)} x2={x(t.at)} y1={0} y2={VIOLIN_HEIGHT} stroke={PORTAL_VIOLIN.grid} strokeDasharray="3,2" />)}
                      {showViolin && r.curve.length > 0 && <path d={violinPath(r.curve, width - 2 * PAD)} transform={"translate(" + PAD + ",0)"} fill={PORTAL_VIOLIN.curve} />}
                      {showBox && r.curve.length > 0 && <ViolinBox box={r.box} x={x} />}
                      {(showViolin || showBox) && r.points.map((v, i) => <circle key={i} cx={x(v)} cy={VIOLIN_HEIGHT / 2} r={3} fill={PORTAL_VIOLIN.ink} />)}
                    </svg>
                  </td>
                  <td className="vt-n">
                    <label className="vt-check">
                      <input type="checkbox" checked={isOn(r.category)} onChange={() => onToggle(r.category)} aria-label={"filter on " + catName + " " + r.category} />
                      <span>{fmtInt(r.n)}</span>
                    </label>
                  </td>
                  <td className="vt-num">{shown(r.box.median)}</td>
                  <td className="vt-num">{shown(r.box.q1)}</td>
                  <td className="vt-num">{shown(r.box.q3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="vt-foot">
          <label className="vt-min">Hide # &lt;
            <Input className="w-14" inputMode="numeric" value={minText} aria-label="hide categories with fewer samples than"
              onChange={(e) => setMinText(e.target.value.replace(/[^0-9]/g, ""))} />
          </label>
          {table.rows.length > rows.length && <span className="meta">{table.rows.length - rows.length} of {table.rows.length} categories hidden</span>}
          {facet.leftOut && <span className="meta">not counted: {facet.leftOut.join(", ")} (a peer's studies)</span>}
        </div>
      </div>
    </div>
  );
}

/** a row's box as the portal draws it: whiskers, a #dddddd box 10 px tall, the median a line */
function ViolinBox({ box, x }: { box: ViolinRow["box"]; x: (v: number) => number }) {
  const c = VIOLIN_HEIGHT / 2;
  return <>
    <line x1={x(box.whiskerLower)} x2={x(box.whiskerLower)} y1={c - 3} y2={c + 3} stroke={PORTAL_VIOLIN.ink} strokeWidth={0.5} />
    <line x1={x(box.whiskerLower)} x2={x(box.whiskerUpper)} y1={c} y2={c} stroke={PORTAL_VIOLIN.ink} strokeWidth={0.5} />
    <line x1={x(box.whiskerUpper)} x2={x(box.whiskerUpper)} y1={c - 3} y2={c + 3} stroke={PORTAL_VIOLIN.ink} strokeWidth={0.5} />
    <rect x={x(box.q1)} y={c - 5} width={Math.max(0, x(box.q3) - x(box.q1))} height={10} fill={PORTAL_VIOLIN.box} stroke={PORTAL_VIOLIN.ink} strokeWidth={0.2} />
    <line x1={x(box.median)} x2={x(box.median)} y1={c - 5} y2={c + 5} stroke={PORTAL_VIOLIN.ink} />
  </>;
}
