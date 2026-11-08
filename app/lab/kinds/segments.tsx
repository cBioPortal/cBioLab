"use client";
// The segments view on the analysis page: its entry in the add menu, the view a new one starts from, and its card (igv.js, app/lab/segments-igv.tsx).
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { SegmentsIgv } from "../segments-igv.tsx";
import { GenomicOverview } from "../genomic-overview.tsx";

const CHROMS = [...Array.from({ length: 22 }, (_, i) => String(i + 1)), "X", "Y"];

/** the segments view's settings row: where (genome, a chromosome, a gene or a region), how many rows, their order */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch, locked } = c;
  const fixedWhere = !!locked && (locked.includes("gene") || locked.includes("region"));
  const region = typeof spec.region === "string" ? spec.region : "";
  const whole = /^(?:chr)?([0-9]{1,2}|X|Y)$/i.exec(region.trim());
  const where = spec.gene ? "gene" : !region ? "all" : whole ? whole[1].toUpperCase() : "range";
  return (
    <div className="viewtb">
      {!fixedWhere && <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="what the rows run along: the whole genome, one chromosome, a gene's span or a stretch you name">
          where <OptionSelect value={where} disabled={busy} onValueChange={(v) => patch(v === "all" ? { gene: undefined, region: undefined }
            : v === "gene" ? { region: undefined, gene: spec.gene || "TP53" } : v === "range" ? { gene: undefined, region: region && !whole ? region : "chr17:7,000,000-8,000,000" }
            : { gene: undefined, region: v })}>
            <option value="all">whole genome</option>
            {CHROMS.map((ch) => <option key={ch} value={ch}>chromosome {ch}</option>)}
            <option value="gene">a gene</option>
            <option value="range">a region</option>
          </OptionSelect>
        </label>
        {where === "gene" && <label className="tbfield" data-tip="the gene's span in IGV's refGene annotation, 1 kb either side">
          gene <DraftInput value={spec.gene || ""} disabled={busy} width="6rem" placeholder="ERBB2" onCommit={(t) => patch({ gene: t.trim().toUpperCase() || undefined })} />
        </label>}
        {where === "range" && <label className="tbfield" data-tip="a chromosome and stretch of it, e.g. chr17:37,000,000-38,000,000">
          region <DraftInput value={region} disabled={busy} width="13rem" placeholder="chr17:37,000,000-38,000,000" onCommit={(t) => patch({ region: t.trim() || undefined })} />
        </label>}
      </div>}
      <div className="tbz"><span className="tbl">rows</span>
        <label className="tbfield" data-tip="sample rows drawn at most; the view says how many it leaves out">
          at most <OptionSelect value={String(spec.rows ?? 300)} disabled={busy} onValueChange={(v) => patch({ rows: Number(v) === 300 ? undefined : Number(v) })}>
            {[50, 100, 300, 500, 1000, 2000].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="the study's own sample order (for one patient, collection order), or by each sample's mean log2 ratio over what is drawn">
          order <OptionSelect value={spec.sort || "order"} disabled={busy} onValueChange={(v) => patch({ sort: v === "order" ? undefined : v })}>
            <option value="order">sample order</option><option value="gained">most gained first</option><option value="lost">most lost first</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const segmentsUi: KindUi<"segments"> = {
  kind: "segments",
  label: "Copy-number segments (a heat strip per sample, the portal's CN Segments tab)",
  category: "copynumber",
  title: "Copy-number segments",
  maxCohorts: 1,
  sub: (spec, v) => v.segments
    ? v.segments.region.label + " · " + v.segments.samples.length.toLocaleString() + " of " + v.segments.segmented.toLocaleString() + " samples with segments"
    : spec.gene ? "zoomed to " + spec.gene : spec.region ? String(spec.region) : "whole genome",
  Controls,
  body: (c) => c.v.segments ? (c.v.segments.mutations ? <GenomicOverview s={c.v.segments} /> : <SegmentsIgv s={c.v.segments} />) : null,
};
