"use client";
// The enrichment view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { useMemo, useState } from "react";
import { Badge, type Col, PortalTable } from "../portal-bodies.tsx";
import { DrawAtWidth, ViewFigure } from "../figure.tsx";
import { Checkbox } from "../../_ui/checkbox";
import { Button } from "../../_ui/button";
import { ALTERATION_EVENTS, EVENT_TREE, normalizeEvents, type AlterationEvent, type EventNode } from "../../../lib/alteration-events.ts";
import type { ProfileInfo } from "../../../lib/profile-catalog.ts";
import type { DrawnResultOf, ViewResultOf } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { enrichmentChartsSvg, withEveryRow } from "../../../lib/views/enrichment/figure.ts";
import { portalAlteredPct, portalPMin } from "../../../lib/chart/format.ts";
import { seriesStyle } from "../../../lib/chart/style";

// ---- Genomic Alterations: the three charts, then the table -------------------------------------

type EnRow = NonNullable<ViewResultOf<"enrichment">["enrichment"]>["rows"][number];

function EnrichmentBody({ v }: { v: DrawnResultOf<"enrichment"> }) {
  // every listed gene, as the portal's table and charts hold them
  const r = useMemo(() => withEveryRow(v.enrichment), [v.enrichment]);
  const two = r.groups.length === 2;
  const color = (g: string) => seriesStyle(Math.max(0, r.groups.indexOf(g))).color;
  const sig = (g: EnRow) => g.q < 0.05;
  // p and q as the portal writes them (toConditionalPrecisionWithMinimum(x, 3, 0.01, -10)), bold where q < 0.05
  const pq = (g: EnRow, x: number) => { const t = portalPMin(x);
    return <span style={{ fontWeight: sig(g) ? 700 : 400 }}>{t.startsWith("< 10^") ? <>&lt; 10<sup>{t.slice(5)}</sup></> : t}</span>; };
  const cols: Col<EnRow>[] = [
    { key: "gene", label: "Gene", value: (g) => g.gene, render: (g) => <strong>{g.gene}</strong> },
    { key: "cytoband", label: "Cytoband", value: (g) => g.cytoband || null },
    ...r.groups.map((name, i): Col<EnRow> => ({ key: "g" + i, label: name, num: true, title: "altered / profiled in " + name,
      // "a (x.xx%)", the share to 2 decimals as the portal's (EnrichmentsUtil, toFixed(2))
      value: (g) => g.cells[i].pct, render: (g) => <>{g.cells[i].altered.toLocaleString()} ({g.cells[i].profiled ? portalAlteredPct(g.cells[i].altered / g.cells[i].profiled) : "—"})</> })),
    ...(two ? [{ key: "lr", label: "Log2 Ratio", num: true, value: (g: EnRow) => g.log2Ratio ?? (g.cells[0].altered ? 99 : -99),
      render: (g: EnRow) => g.log2Ratio == null ? (g.cells[0].altered ? ">10" : "<-10") : g.log2Ratio.toFixed(2) }] : []),
    { key: "p", label: "p-Value", num: true, value: (g) => g.p, render: (g) => pq(g, g.p), title: two ? "Derived from two-sided Fisher Exact test" : "Derived from Chi-squared test" },
    { key: "q", label: "q-Value", num: true, value: (g) => g.q, render: (g) => pq(g, g.q), title: "Derived from Benjamini-Hochberg procedure" },
    { key: "in", label: two ? "Enriched in" : "Most enriched in", value: (g) => g.enrichedIn, render: (g) => <Badge text={g.enrichedIn} color={g.q < 0.05 ? color(g.enrichedIn) : null} /> },
  ];
  return (
    <div className="pb">
      <DrawAtWidth draw={(width) => enrichmentChartsSvg(r, { width })} deps={[r]} />
      <PortalTable rows={r.rows} cols={cols} initialSort={{ key: "q" }} search={(g) => g.gene + " " + (g.cytoband || "")}
        filters={[{ label: "Significant only", test: (g) => g.q < 0.05 }]}
        note={r.hidden ? r.hidden.toLocaleString() + " of " + r.tested.toLocaleString() + " genes tested have under " + r.minAltered + " altered samples and are not listed"
          : r.tested > r.rows.length ? "the " + r.rows.length + " most significant of " + r.tested.toLocaleString() + " genes tested" : undefined} />
    </div>
  );
}


// ---- the portal's alteration-type tree (CMM-AT-1…3) ---------------------------------------------

/** the tree's top rows the study has a profile for (CMM-TAB-2); all three before the catalog is known */
function treeRoots(catalog: ProfileInfo[] | undefined): EventNode[] {
  if (!catalog?.length) return [EVENT_TREE.mutation, EVENT_TREE.sv, EVENT_TREE.cna];
  return [
    catalog.some((p) => p.type === "MUTATION_EXTENDED") && EVENT_TREE.mutation,
    catalog.some((p) => p.type === "STRUCTURAL_VARIANT") && EVENT_TREE.sv,
    catalog.some((p) => p.type === "COPY_NUMBER_ALTERATION" && p.datatype === "DISCRETE") && EVENT_TREE.cna,
  ].filter((x): x is EventNode => !!x);
}

/** "Alteration Types": a row is ticked when any type under it is, and a click sets every type under it
 *  to the opposite; the choice applies on [Select], which waits until it differs from the view's. */
function EventTree({ c }: { c: KindCardCtx }) {
  const applied = normalizeEvents(c.spec.events ?? ALTERATION_EVENTS) || [...ALTERATION_EVENTS];
  const roots = treeRoots(c.catalog);
  const offered = new Set(roots.flatMap((r) => r.units));
  const [staged, setStaged] = useState<AlterationEvent[] | null>(null);
  // a change made elsewhere (undo, a link, an agent) replaces what was staged against the old selection
  const appliedKey = applied.join(",");
  const [stagedFor, setStagedFor] = useState(appliedKey);
  if (stagedFor !== appliedKey) { setStagedFor(appliedKey); setStaged(null); }
  const cur = staged ?? applied;
  const on = (n: EventNode) => n.units.some((u) => cur.includes(u));
  const toggle = (n: EventNode) => {
    const next = on(n) ? cur.filter((u) => !n.units.includes(u)) : [...cur, ...n.units];
    setStaged(normalizeEvents(next));
  };
  const key = (xs: AlterationEvent[]) => xs.filter((u) => offered.has(u)).join(",");
  const changed = staged != null && key(staged) !== key(applied);
  const none = !cur.some((u) => offered.has(u));
  const row = (n: EventNode, depth: number): React.ReactNode => (
    <li key={n.label} className="mt-1">
      <label className="flex items-center gap-1.5 cursor-pointer" style={{ paddingLeft: depth * 14 }}>
        <Checkbox checked={on(n)} disabled={c.busy} onCheckedChange={() => toggle(n)} aria-label={n.label}
          data-tip={c.busy ? "waiting for the table to update" : undefined} />
        <span className={depth ? "" : "font-semibold"}>{n.label}</span>
      </label>
      {n.children && <ul className="list-none m-0 p-0">{n.children.map((k) => row(k, depth + 1))}</ul>}
    </li>);
  const apply = () => {
    const sel = cur.filter((u) => offered.has(u));
    // every offered type is the default, so the document leaves events out
    c.patch({ events: sel.length === offered.size ? undefined : sel });
    setStaged(null);
  };
  return (
    <div className="enrich-types text-sm" style={{ minWidth: 190 }}>
      <div className="font-semibold mb-1">Alteration Types</div>
      <ul className="list-none m-0 p-0 flex flex-col gap-1">{roots.map((r) => row(r, 0))}</ul>
      <span data-tip={c.busy ? "waiting for the table to update" : none ? "select at least one alteration type" : !changed ? "the table shows this selection" : "apply the selection"}>
        <Button size="sm" className="mt-2" disabled={c.busy || !changed || none} onClick={apply}>Select</Button>
      </span>
    </div>
  );
}

/** alteration "any": the tree at the left, the charts and table (or why there are none) beside it, as the portal lays the tab out */
function AnyBody({ c }: { c: KindCardCtx }) {
  return (
    <div className="pb-row">
      <EventTree c={c} />
      <div className="min-w-0 flex-1">{c.v.enrichment ? <EnrichmentBody v={c.v} /> : <ViewFigure v={c.v} error={c.v.error} />}</div>
    </div>
  );
}

/** the enrichment view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="which alteration to compare across every gene">
          alteration <OptionSelect value={spec.alteration || "mutation"} disabled={busy} onValueChange={(v) => patch({ alteration: v === "mutation" ? undefined : v, events: undefined })}>
            <option value="any">any type</option><option value="mutation">mutation</option><option value="cna">amp or deep deletion</option><option value="amp">amplification</option>
            <option value="homdel">deep deletion</option><option value="sv">structural variant</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="count every alteration, or only OncoKB drivers">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : "any" })}>
            <option value="any">any</option><option value="driver">drivers</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="genes altered in fewer samples than this across the cohorts are tested, and counted in the q-values, but not listed">
          list genes altered in ≥ <OptionSelect value={String(spec.minAltered ?? 5)} disabled={busy} onValueChange={(v) => patch({ minAltered: Number(v) })}>
            {[1, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const enrichmentUi: KindUi<"enrichment"> = {
  kind: "enrichment",
  label: "Alteration enrichment (all genes)",
  category: "alterations",
  title: "Alteration enrichment",
  maxCohorts: 6,
  minCohorts: 2,
  sub: (spec) => ({ any: "alterations", mutation: "mutations", cna: "copy-number alterations", amp: "amplifications", homdel: "deep deletions", sv: "structural variants" } as Record<string, string>)[spec.alteration || "mutation"] +
    (spec.measure === "driver" ? " (drivers)" : "") + " in every gene, per sample",
  Controls,
  body: (c) => c.spec.alteration === "any" ? <AnyBody c={c} /> : c.v.enrichment ? <EnrichmentBody v={c.v} /> : null,
};
