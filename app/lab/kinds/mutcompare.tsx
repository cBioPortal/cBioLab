"use client";
// The mutcompare view on the analysis page and the Comparison page's Mutations tab, laid out as
// cBioPortal's group-comparison Mutations tab: the gene picker with the "Highest Frequency" genes,
// the two cohorts' lollipops mirrored about the protein with the y-axis % / # switch and each
// cohort's alteration badges beside them, the Fisher line for the gene, then the table of protein
// changes. The gene re-runs the view; the axis, the hidden cells and the selected codons are drawn in
// the browser from the whole result (app/_oncoprint/view-display.ts dataPart), the table's filters
// are this browser's (invariant 9).
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../../_ui/button";
import { TB } from "../../_ui/toolbar.ts";
import { cn } from "../../../lib/cn";
import { GroupFilter } from "../pick-volcano.tsx";
import { Badge, type Col, PortalTable } from "../portal-bodies.tsx";
import { DrawAtWidth } from "../figure.tsx";
import { DraftInput } from "./parts.tsx";
import { useStemClicks } from "../../_lollipop/use-stem-clicks.ts";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import type { DrawnResultOf } from "../../../lib/types";
import { IMPACT_COLORS, cellOf, clickCodon, type ImpactType } from "../../../lib/lollipop.ts";
import { AlterationGrid, classesOf } from "../../_lollipop/AlterationGrid.tsx";
import { TranscriptSummary } from "../../_lollipop/TranscriptSummary.tsx";
import { ColorLegend } from "../../_lollipop/ColorLegend.tsx";
import { LollipopTools } from "../../_lollipop/LollipopTools.tsx";
import { MUTCOMPARE_MID_Y, mutcompareSvg, ordinalName } from "../../../lib/views/mutcompare/figure.ts";
import type { MutcompareRow, MutcompareResult } from "../../../lib/views/mutcompare/types.ts";
import { portalP } from "../../../lib/chart/format.ts";
import { seriesStyle } from "../../../lib/chart/style";

/** the portal's two-decimal log ratio, past ±10 (or a share of zero) written as a bound */
function ratio(r: MutcompareRow): string {
  if (r.log2Ratio == null) return r.pct[0] > 0 ? ">10" : r.pct[1] > 0 ? "<-10" : "NaN";
  return r.log2Ratio < -10 ? "<-10" : r.log2Ratio > 10 ? ">10" : r.log2Ratio.toFixed(2);
}
/** the log ratio as a number to sort by: a share of zero sorts past the bounds */
const ratioValue = (r: MutcompareRow) => r.log2Ratio ?? (r.pct[0] > 0 ? 11 : r.pct[1] > 0 ? -11 : 0);

/** One group's badge selector, the group's name beside it as the portal writes it; a click acts on both groups' plots, as the portal's. */
function GroupBadges({ m, i, classes, hide, onHide }: { m: MutcompareResult; i: number; classes: ImpactType[]; hide: Set<string>; onHide: (next: string[]) => void }) {
  const name = ordinalName(i, m.groups[i].name);
  return (
    <div className="flex items-center gap-2" data-test={"mutcompare-badges-" + i}>
      <AlterationGrid tally={m.groups[i].lollipop.tally} classes={classes} hide={hide} onHide={onHide} of={m.groups[i].name} note="the plots of both groups" />
      <span className="meta font-semibold [writing-mode:vertical-rl] rotate-180 max-h-36 truncate" data-tip={name}>{name}</span>
    </div>
  );
}

/**
 * Lines the side panel up on the mirror: the line between the two groups' badge selectors at the
 * protein's vertical centre (MUTCOMPARE_MID_Y in the figure). Whichever starts higher is padded down:
 * the side when group A's block is shorter than the figure's top half, the figure when it is taller.
 * Nothing is padded when the side has wrapped below the figure.
 */
function useMirrorAlign(result: unknown) {
  const gene = useRef<HTMLDivElement>(null), fig = useRef<HTMLDivElement>(null), side = useRef<HTMLDivElement>(null), above = useRef<HTMLDivElement>(null);
  const [pad, setPad] = useState({ plot: 0, side: 0 });
  const padRef = useRef(pad);
  useLayoutEffect(() => {
    const measure = () => {
      const [g, f, sd, a] = [gene.current, fig.current, side.current, above.current];
      if (!g || !f || !sd || !a) return;
      const wrapped = sd.getBoundingClientRect().top >= f.getBoundingClientRect().bottom - 1;
      const figTop = f.getBoundingClientRect().top - g.getBoundingClientRect().top - padRef.current.plot;
      const mid = figTop + MUTCOMPARE_MID_Y, h = a.getBoundingClientRect().height;
      const next = wrapped ? { plot: 0, side: 0 } : h <= mid ? { plot: 0, side: Math.round(mid - h) } : { plot: Math.round(h - mid), side: 0 };
      if (next.plot !== padRef.current.plot || next.side !== padRef.current.side) { padRef.current = next; setPad(next); }
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [gene.current, fig.current, above.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [result]);
  return { gene, fig, side, above, pad };
}

function Plot({ v, positions, onPositions, figRef }: { v: DrawnResultOf<"mutcompare">; positions: number[]; onPositions: (next: number[]) => void; figRef: React.RefObject<HTMLDivElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  useStemClicks(box, {
    pick: (codon, multi) => onPositions(clickCodon(positions, codon, multi)),
    clear: () => { if (positions.length) onPositions([]); },
  });
  return (
    <div ref={box} data-test="mutcompare-plot">
      <div ref={figRef}><DrawAtWidth draw={(width) => mutcompareSvg(v, { width }, "")} deps={[v]} /></div>
    </div>
  );
}

function MutcompareBody({ c }: { c: KindCardCtx }) {
  const base = c.v as DrawnResultOf<"mutcompare">;
  const m0 = base.mutcompare;
  // what the browser applies from the document: the axis, the hidden cells, the selected codons
  const axis: MutcompareResult["axis"] = c.spec.axis === "count" ? "count" : "percent";
  const hideKey = Array.isArray(c.spec.hide) ? (c.spec.hide as string[]).join(",") : "";
  const posKey = Array.isArray(c.spec.positions) ? (c.spec.positions as number[]).join(",") : "";
  const hideList = useMemo(() => hideKey ? hideKey.split(",") : [], [hideKey]);
  const positions = useMemo(() => posKey ? posKey.split(",").map(Number) : [], [posKey]);
  const m = useMemo(() => ({ ...m0, axis }), [m0, axis]);
  const v = useMemo(() => ({ ...base, mutcompare: m, hide: hideList, positions }), [base, m, hideList, positions]);
  const hide = useMemo(() => new Set(hideList), [hideList]);
  // the portal leaves fusions out of the comparison's selectors
  const classes = classesOf(m.groups.map((g) => g.lollipop.tally)).filter((k) => k !== "fusion");
  const [A, B] = m.groups;
  const names = [A.name, B.name];
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [legend, setLegend] = useState(false);
  const align = useMirrorAlign(m0);
  const shown = useMemo(() => new Set(names.filter((g) => !hidden.has(g))), [hidden, A.name, B.name]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setHide = (next: string[]) => c.patch({ hide: next.length ? [...next].sort() : undefined });
  const setPositions = (next: number[]) => c.patch({ positions: next.length ? next : undefined });
  const rows = useMemo(() => m.rows.filter((r) => shown.has(r.enrichedIn) && (!positions.length || (r.pos != null && positions.includes(r.pos)))), [m, shown, positions]);
  const color = (g: string) => seriesStyle(Math.max(0, names.indexOf(g))).color;
  const lockedGene = (c.locked || []).includes("gene");
  const top10 = m.ranking.slice(0, 10);
  const pct = (x: number) => x.toFixed(2) + "%";
  // the portal's columns and their header tips, word for word
  const cols: Col<MutcompareRow>[] = [
    { key: "change", label: "Protein Change", value: (r) => r.change, render: (r) => <strong>{r.change}</strong>, title: "Protein Change" },
    { key: "annotation", label: "Annotation", value: (r) => r.driver ? 1 : 0, title: m.annotated ? "OncoKB: putative driver (oncogenic) or not" : "no OncoKB pin: no driver calls",
      render: (r) => m.annotated && r.driver ? <Badge text="Oncogenic" color={seriesStyle(4).color} /> : null },
    { key: "type", label: "Mutation Type", value: (r) => IMPACT_COLORS[r.impact as ImpactType]?.label || r.impact, title: "Mutation Type",
      render: (r) => <span style={{ color: IMPACT_COLORS[r.impact as ImpactType]?.driver }}>{IMPACT_COLORS[r.impact as ImpactType]?.label || r.impact}</span> },
    ...m.groups.map((g, i): Col<MutcompareRow> => ({ key: "g" + i, label: ordinalName(i, g.name), num: true, value: (r) => r.n[i],
      render: (r) => <span className="tabular-nums">{r.n[i].toLocaleString()} ({pct(r.pct[i])})</span>,
      title: ordinalName(i, g.name) + ": Number (percentage) of patients in " + ordinalName(i, g.name) + " that have a mutation in the selected gene for the listed protein change" })),
    { key: "lr", label: "Log2 Ratio", num: true, value: ratioValue, render: ratio, title: "Log2 based ratio of (pct in " + ordinalName(0, A.name) + "/ pct in " + ordinalName(1, B.name) + ")" },
    { key: "p", label: "p-Value", num: true, value: (r) => r.p, render: (r) => <span style={{ fontWeight: r.q < 0.05 ? 700 : 400 }}>{portalP(r.p)}</span>, title: "Derived from two-sided Fisher Exact test" },
    { key: "q", label: "q-Value", num: true, value: (r) => r.q, render: (r) => <span style={{ fontWeight: r.q < 0.05 ? 700 : 400 }}>{portalP(r.q)}</span>, title: "Derived from Benjamini-Hochberg procedure" },
    { key: "in", label: "Enriched in", value: (r) => r.enrichedIn, render: (r) => <Badge text={r.enrichedIn} color={r.q < 0.05 ? color(r.enrichedIn) : null} />,
      title: "Log ratio > 0: Enriched in " + ordinalName(0, A.name) + "\nLog ratio <= 0: Enriched in " + ordinalName(1, B.name) + "\nq-Value < 0.05: Significant association" },
  ];
  const drawnN = (i: number) => m.groups[i].lollipop.positions.filter((q) => q.changes.some((x) => !hide.has(cellOf(x.impact || "other", !!x.driver)))).length;
  const filtered = hide.size > 0 || positions.length > 0;
  const share = (g: { mutated: number; profiled: number }) => g.profiled ? (100 * g.mutated / g.profiled).toFixed(1) : "0";
  return (
    <div className="pb" data-test="mutcompare-body">
      {!lockedGene && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="tbfield" data-tip="any gene symbol; the list offers the 200 genes with the highest mutated share, as the portal's">
            gene <DraftInput value={m.gene} disabled={c.busy} width="7rem" placeholder="Search genes" title="gene" onCommit={(t) => { const g = t.trim().toUpperCase(); c.patch({ gene: g || undefined, positions: undefined }); }} />
          </label>
          <span className="meta">Highest Frequency:</span>
          {top10.map((g) => (
            <Button key={g.gene} type="button" size="sm" variant={g.gene === m.gene ? "default" : "outline"} className={cn(TB, "rounded-full")} disabled={c.busy}
              data-tip={g.gene + ": mutated in " + g.pct.toFixed(1) + "% of profiled samples in one of the groups"} aria-pressed={g.gene === m.gene}
              onClick={() => g.gene !== m.gene && c.patch({ gene: g.gene, positions: undefined })}>{g.gene}</Button>
          ))}
        </div>
      )}
      <h3 className="mt-2 text-lg font-semibold">{m.gene} mutations: {ordinalName(0, A.name)} vs {ordinalName(1, B.name)}</h3>
      {m.empty ? <p className="note">{m.empty}</p> : <>
        <div className="viewtb">
          <div className="tbz"><span className="tbl">Y-Axis:</span>
            {(["percent", "count"] as const).map((a) => (
              <Button key={a} type="button" size="sm" variant={axis === a ? "default" : "outline"} className={TB} aria-pressed={axis === a}
                data-tip={a === "percent" ? "each stem as a share of the group's profiled patients" : "each stem as a number of patients"}
                onClick={() => c.patch({ axis: a === "percent" ? undefined : "count" })}>{a === "percent" ? "%" : "#"}</Button>
            ))}
          </div>
        </div>
        {filtered ? (
          <div className="lp-banner flex-wrap" role="status">
            Showing {rows.length.toLocaleString()} of {m.rows.length.toLocaleString()} protein changes
            {positions.length > 0 && <span className="meta"> · codon{positions.length === 1 ? "" : "s"} {positions.join(", ")} (Shift click to select multiple residues)</span>}
            {hide.size > 0 && <span className="meta"> · {drawnN(0) + drawnN(1)} stems drawn</span>}
            <Button type="button" variant="outline" size="sm" className={TB} onClick={() => c.patch({ hide: undefined, positions: undefined })}><X />Remove filter</Button>
          </div>
        ) : <p className="meta">Click a lollipop to select its codon and filter the table to it; shift-click to select several. Click the plot elsewhere to clear.</p>}
        <div className="lp-gene" ref={align.gene}>
          <div className="lp-plot flex-[1_1_560px]" style={{ paddingTop: align.pad.plot }}>
            <div className="flex justify-end">
              <LollipopTools legend={legend} onLegend={setLegend} filename={m.gene + "_mutation_diagram"}
                svg={() => { const w = align.fig.current?.getBoundingClientRect().width; return w ? mutcompareSvg(v, { width: Math.round(w), theme: "light" }, "") : null; }} />
            </div>
            {legend && <ColorLegend fusions={false} />}
            <Plot v={v} positions={positions} onPositions={setPositions} figRef={align.fig} />
          </div>
          <div className="lp-side !gap-0" ref={align.side} style={{ paddingTop: align.pad.side }}>
            <div ref={align.above} className="flex flex-col gap-2 pb-2">
              <TranscriptSummary ids={A.lollipop.ids} gene={m.gene} />
              <GroupBadges m={m} i={0} classes={classes} hide={hide} onHide={setHide} />
            </div>
            <hr className="m-0 h-0 border-0 border-t border-[var(--ink)]" />
            <div className="pt-2"><GroupBadges m={m} i={1} classes={classes} hide={hide} onHide={setHide} /></div>
          </div>
        </div>
        <p className="meta" data-test="mutcompare-fisher">
          Fisher Exact Two-Sided Test p-value for all mutations - {ordinalName(0, A.name)} vs {ordinalName(1, B.name)}: <b>{portalP(m.geneP)}</b>{" "}
          <span className="meta" data-tip={m.gene + " mutations in:\n" + m.groups.map((g, i) => ordinalName(i, g.name) + ": " + g.mutated.toLocaleString() + " of " +
            g.profiled.toLocaleString() + " profiled patients (" + share(g) + "%)").join("\n")}>
            ({m.groups.map((g, i) => ordinalName(i, g.name).slice(0, 3) + " " + g.mutated.toLocaleString() + " of " + g.profiled.toLocaleString() + " profiled patients, " + share(g) + "%").join("; ")})
          </span>
        </p>
      </>}
      <PortalTable wide rows={rows} cols={cols} initialSort={{ key: "p" }} pageSize={25} search={(r) => r.change + " " + r.enrichedIn}
        filters={[{ label: "Significant only", test: (r) => r.q < 0.05 }]}
        bar={<GroupFilter groups={names} shown={shown} onShown={(s) => setHidden(new Set(names.filter((g) => !s.has(g))))} prefix="Enriched in"
          tip="list the protein changes enriched in these groups" />} />
    </div>
  );
}

export const mutcompareUi: KindUi<"mutcompare"> = {
  kind: "mutcompare",
  label: "Mutations compared (two-group lollipop)",
  category: "alterations",
  title: "Mutations",
  maxCohorts: 2,
  minCohorts: 2,
  defaults: () => ({ kind: "mutcompare" }),
  sub: (spec, v) => (v.mutcompare?.gene || spec.gene || "highest-frequency gene") + " · two cohorts mirrored about the protein, and every protein change tested",
  body: (c) => c.v.mutcompare ? <MutcompareBody c={c} /> : null,
};
