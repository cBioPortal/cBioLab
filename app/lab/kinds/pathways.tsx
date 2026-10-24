"use client";
// The pathways view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the pathways view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="count only OncoKB-annotated drivers (as the paper counted curated oncogenic events), or every alteration">
          count <OptionSelect value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onValueChange={(v) => patch({ measure: v === "any" ? "any" : undefined })}>
            <option value="driver">drivers</option><option value="any">any alteration</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="how many of each pathway's most-altered genes to draw; the rest are pooled and counted, never dropped">
          genes shown <OptionSelect value={String(spec.topGenes ?? 6)} disabled={busy} onValueChange={(v) => patch({ topGenes: Number(v) })}>
            {[3, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const pathwaysUi: KindUi<"pathways"> = {
  kind: "pathways",
  label: "Oncogenic pathways",
  category: "alterations",
  title: "Oncogenic signalling pathways",
  maxCohorts: 4,
  sub: (spec) => (spec.measure === "any" ? "any alteration" : "OncoKB drivers") + ", Sanchez-Vega et al. 2018",
  Controls,
};
