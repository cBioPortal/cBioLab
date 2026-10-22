"use client";
// The lollipop as the app shows it: each gene's plot, with the portal's gene summary beside it
// (transcript ids, somatic mutation frequency) and the Driver/VUS × alteration class grid as a
// control. The grid's selection — the cells hidden — is the view's `hide`, applied here from the
// whole result (lib/lollipop.ts filterHotspotGene), so a click redraws at once and re-runs nothing.
// The figure itself (lib/view-svg.ts) is the plot alone; a figure that travels without the app
// carries the summary and the selection in its caption instead.
import React, { useMemo } from "react";
import type { HotspotGene, ViewResultOf } from "../../lib/types.ts";
import { IMPACT_COLORS, IMPACT_TYPES, filterHotspotGene, cellOf, type AlterationCell, type ImpactType } from "../../lib/lollipop.ts";
import { lollipopPanelsSvg } from "../../lib/lollipop-svg.ts";
import { DrawAtWidth } from "../lab/figure.tsx";
import { fmtShare } from "../../lib/chart/format.ts";
import { X } from "lucide-react";
import { Button } from "../_ui/button";
import { TB } from "../_ui/toolbar.ts";

type Col = "driver" | "vus";
const COLS: Col[] = ["driver", "vus"];
const cell = (k: ImpactType, c: Col): AlterationCell => cellOf(k, c === "driver");

/** The classes a gene's grid lists: the portal's five, and "Other" only when there is some. */
function classesOf(genes: HotspotGene[]): ImpactType[] {
  return IMPACT_TYPES.filter((k) => k !== "other" || genes.some((g) => g.tally.other.driver || g.tally.other.vus));
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
    <button type="button" className={"lp-badge" + (shown ? "" : " off")} onClick={onClick} title={title} aria-pressed={shown} aria-label={label}
      style={shown ? { background: color, borderColor: color } : { color, borderColor: color }}>
      {n.toLocaleString()}
    </button>
  );
}

/** The grid: rows by alteration class, Driver and VUS columns; each cell a count that shows or hides its mutations. */
function AlterationGrid({ g, classes, hide, onHide }: { g: HotspotGene; classes: ImpactType[]; hide: Set<string>; onHide: (next: string[]) => void }) {
  const total = (c: Col) => classes.reduce((n, k) => n + g.tally[k][c], 0);
  const colCells = (c: Col) => classes.map((k) => cell(k, c));
  const rowCells = (k: ImpactType) => COLS.map((c) => cell(k, c));
  const every = classes.flatMap(rowCells);
  const only = (keep: AlterationCell[]) => onHide(every.filter((c) => !keep.includes(c)));
  const colShown = (c: Col) => colCells(c).some((x) => !hide.has(x));
  return (
    <table className="lp-grid">
      <thead><tr>
        <th />
        {COLS.map((c) => (
          <th key={c}>
            <span className="lp-head">
              <button type="button" className="lp-colname" onClick={() => onHide(toggled(hide, colCells(c)))}
                title={(colShown(c) ? "hide" : "show") + " every " + (c === "driver" ? "putative driver" : "VUS")}>{c === "driver" ? "Driver" : "VUS"}</button>
              <Badge n={total(c)} color={c === "driver" ? "#000000" : "#696969"} shown={colShown(c)} onClick={() => onHide(toggled(hide, colCells(c)))}
                title={(colShown(c) ? "hide" : "show") + " every " + (c === "driver" ? "putative driver" : "VUS")} label={(c === "driver" ? "drivers" : "VUS") + " total"} />
              <button type="button" className="lp-only" onClick={() => only(colCells(c))} title={"show only " + (c === "driver" ? "putative drivers" : "VUS")}>only</button>
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
                    onClick={() => onHide(toggled(hide, rowCells(k)))} title={(rowShown ? "hide" : "show") + " every " + c.label.toLowerCase() + " mutation"}>{c.label}</button>
                  <button type="button" className="lp-only" onClick={() => only(rowCells(k))} title={"show only " + c.label.toLowerCase() + " mutations"}>only</button>
                </span>
              </th>
              {COLS.map((col) => {
                const x = cell(k, col), on = !hide.has(x);
                return (
                  <td key={col}>
                    <Badge n={g.tally[k][col]} color={col === "driver" ? c.driver : c.vus} shown={on} onClick={() => onHide(toggled(hide, [x]))}
                      title={(on ? "hide " : "show ") + c.label.toLowerCase() + " " + (col === "driver" ? "putative drivers" : "VUS") + " (" + g.tally[k][col].toLocaleString() + " mutation rows)"}
                      label={c.label + " " + (col === "driver" ? "driver" : "VUS")} />
                  </td>);
              })}
            </tr>);
        })}
      </tbody>
    </table>
  );
}

/** Transcript ids as links, and the somatic mutation frequency — the portal's GeneSummary. */
function GeneSummary({ g }: { g: HotspotGene }) {
  const ids = g.ids || {};
  const link = (text: string | undefined, href: string) => text ? <a href={href} target="_blank" rel="noreferrer">{text}</a> : <span>-</span>;
  const freq = g.cohortSamples ? fmtShare(g.somaticSamples / g.cohortSamples) : "–";
  return (
    <div className="lp-summary">
      <div>{link(ids.refseq, "https://www.ncbi.nlm.nih.gov/nuccore/" + (ids.refseq || ""))} | {link(ids.ensembl, "https://grch37.ensembl.org/homo_sapiens/Transcript/Summary?t=" + (ids.ensembl || "").replace(/\.\d+$/, ""))}</div>
      <div>{link(ids.ccds, "https://www.ncbi.nlm.nih.gov/CCDS/CcdsBrowse.cgi?REQUEST=CCDS&DATA=" + (ids.ccds || ""))} | {link(ids.uniprotName || ids.uniprotAccession, "https://www.uniprot.org/uniprot/" + (ids.uniprotAccession || ""))}</div>
      <div className="lp-freq" title={g.somaticSamples.toLocaleString() + " of " + g.cohortSamples.toLocaleString() + " samples carry a somatic mutation in " + g.gene}>
        <span>Somatic Mutation Frequency</span> <b>{freq}</b>
      </div>
    </div>
  );
}

export function HotspotsBody({ v, hide: hideList, onHide }: { v: ViewResultOf<"hotspots">; hide?: string[]; onHide: (next: string[] | undefined) => void }) {
  const genes = useMemo(() => (v.hotspots || []) as HotspotGene[], [v.hotspots]);
  const hide = useMemo(() => new Set(hideList || []), [hideList]);
  const classes = classesOf(genes);
  const set = (next: string[]) => onHide(next.length ? [...next].sort() : undefined);
  const drawn = useMemo(() => genes.map((g) => filterHotspotGene(g, [...hide])), [genes, hide]);
  if (!genes.length) return <p className="note">{v.note || "no mutations in these genes for this cohort"}</p>;
  const shown = drawn.reduce((n, d) => n + d.shown, 0), total = drawn.reduce((n, d) => n + d.total, 0);
  const unclassed = drawn.reduce((n, d) => n + d.unclassed, 0);
  return (
    <div className="lp">
      {hide.size > 0 && (
        <div className="lp-banner" role="status">
          Showing <b>{shown.toLocaleString()}</b> of {total.toLocaleString()} mutations
          {unclassed ? <span className="meta"> ({unclassed.toLocaleString()} from a site that reports no alteration class, drawn regardless)</span> : null}
          <Button type="button" variant="outline" size="sm" className={TB} onClick={() => set([])}><X />remove filter</Button>
        </div>
      )}
      {drawn.map((d, i) => (
        <div key={d.gene.gene} className="lp-gene">
          <div className="lp-plot flex-[1_1_560px]">
            <DrawAtWidth draw={(width) => lollipopPanelsSvg([d.gene], { width }, "")} deps={[d.gene]} />
          </div>
          <div className="lp-side">
            <GeneSummary g={genes[i]} />
            <AlterationGrid g={genes[i]} classes={classes} hide={hide} onHide={set} />
          </div>
        </div>
      ))}
      {v.note && <p className="note">{v.note}</p>}
    </div>
  );
}
