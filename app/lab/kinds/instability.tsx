"use client";
// The instability view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the instability view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="the |log2 segment mean| at or past which a segment counts as gained or lost">
          threshold <OptionSelect value={String(spec.threshold ?? 0.2)} disabled={busy} onValueChange={(v) => patch({ threshold: v === "0.2" ? undefined : Number(v) })}>
            {[...new Set([0.1, 0.2, 0.3, 0.5, Number(spec.threshold ?? 0.2)])].sort((x, y) => x - y).map((t) => <option key={t} value={t}>±{t}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="an arm is gained or lost when more than this share of its length is past the threshold">
          arm call <OptionSelect value={String(spec.armShare ?? 0.5)} disabled={busy} onValueChange={(v) => patch({ armShare: v === "0.5" ? undefined : Number(v) })}>
            {[...new Set([0.5, 0.75, 0.8, Number(spec.armShare ?? 0.5)])].sort((x, y) => x - y).map((t) => <option key={t} value={t}>&gt;{Math.round(t * 100)}% of arm</option>)}
          </OptionSelect>
        </label>
        <label className="chk" data-tip="chromosome X's log ratio mostly records sex against the reference, so it is off by default">
          <Checkbox checked={spec.includeX === true} disabled={busy} onCheckedChange={(on) => patch({ includeX: (on === true) || undefined })} /> chrX
        </label>
      </div>
    </div>
  );
}

export const instabilityUi: KindUi<"instability"> = {
  kind: "instability",
  label: "Genomic instability (aneuploidy score, FGA, arm-level calls)",
  category: "copynumber",
  title: "Genomic instability",
  maxCohorts: 6,
  sub: (spec) => "from hg19 segments, ±" + (spec.threshold ?? 0.2) + ", arm called past " + Math.round(100 * (spec.armShare ?? 0.5)) + "% of its length" + (spec.includeX ? ", with chrX" : ""),
  Controls,
};
