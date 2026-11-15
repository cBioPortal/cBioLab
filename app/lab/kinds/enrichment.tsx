"use client";
// The enrichment view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Badge, type Col, PortalTable } from "../portal-bodies.tsx";
import { DrawAtWidth } from "../figure.tsx";
import type { DrawnResultOf, ViewResultOf } from "../../../lib/types";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { enrichmentChartsSvg } from "../../../lib/views/enrichment/figure.ts";
import { portalAlteredPct, portalPMin } from "../../../lib/chart/format.ts";
import { seriesStyle } from "../../../lib/chart/style";

// ---- Genomic Alterations: the three charts, then the table -------------------------------------

type EnRow = NonNullable<ViewResultOf<"enrichment">["enrichment"]>["rows"][number];

function EnrichmentBody({ v }: { v: DrawnResultOf<"enrichment"> }) {
  const r = v.enrichment;
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
        note={r.tested > r.rows.length ? "the " + r.rows.length + " most significant of " + r.tested.toLocaleString() + " genes tested" +
          (r.hidden ? " (" + r.hidden.toLocaleString() + " under " + r.minAltered + " altered samples not listed)" : "") : undefined} />
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
          alteration <OptionSelect value={spec.alteration || "mutation"} disabled={busy} onValueChange={(v) => patch({ alteration: v === "mutation" ? undefined : v })}>
            <option value="mutation">mutation</option><option value="cna">amp or deep deletion</option><option value="amp">amplification</option>
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
  sub: (spec) => ({ mutation: "mutations", cna: "copy-number alterations", amp: "amplifications", homdel: "deep deletions", sv: "structural variants" } as Record<string, string>)[spec.alteration || "mutation"] +
    (spec.measure === "driver" ? " (drivers)" : "") + " in every gene, per sample",
  Controls,
  body: (c) => c.v.enrichment ? <EnrichmentBody v={c.v} /> : null,
};
