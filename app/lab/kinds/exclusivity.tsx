"use client";
// The exclusivity view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the exclusivity view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="estimate the background within each value of this sample attribute, so that subtypes with different drivers do not read as exclusivity">
          stratify by <OptionSelect value={spec.stratifyBy || ""} disabled={busy} onValueChange={(v) => patch({ stratifyBy: v || undefined })}>
            <option value="">none</option>
            {spec.stratifyBy && !cats.includes(spec.stratifyBy) && <option value={spec.stratifyBy}>{spec.stratifyBy}</option>}
            {cats.map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="any alteration, or only those OncoKB calls oncogenic">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
            <option value="any">any alteration</option><option value="driver">oncogenic only</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const exclusivityUi: KindUi<"exclusivity"> = {
  kind: "exclusivity",
  label: "Mutual exclusivity (DISCOVER, burden-aware)",
  title: "Mutual exclusivity",
  genes: true,
  maxCohorts: 1,
  cohortInHeader: true,
  defaults: (known) => ({ kind: "exclusivity", genes: known.genes.length >= 2 ? known.genes.slice(0, 8) : ["KRAS", "EGFR", "BRAF", "STK11", "KEAP1", "TP53"] }),
  sub: (spec, v) => {
    const cohort = Array.isArray(v.cohorts) && v.cohorts[0] ? String(v.cohorts[0]).split(" / ").join(" › ") : null;
    return <>{cohort && <><strong>{cohort}</strong> · </>}{(spec.measure === "driver" ? "oncogenic alterations" : "any alteration") + ", background from each tumour's burden" +
      (spec.stratifyBy ? ", within " + spec.stratifyBy : "")}</>;
  },
  Controls,
};
