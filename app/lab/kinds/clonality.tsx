"use client";
// The clonality view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the clonality view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="OncoKB driver mutations only, or every mutation call">
          count <OptionSelect value={spec.measure === "any" ? "any" : "driver"} disabled={busy} onValueChange={(v) => patch({ measure: v === "any" ? "any" : undefined })}>
            <option value="driver">driver mutations</option><option value="any">every mutation</option>
          </OptionSelect>
        </label>
        <label className="chk" title="use only samples whose FACETS_QC is Pass">
          <Checkbox checked={spec.qc !== false} disabled={busy} onCheckedChange={(on) => patch({ qc: (on === true) ? undefined : false })} /> FACETS QC pass only
        </label>
      </div>
    </div>
  );
}

export const clonalityUi: KindUi<"clonality"> = {
  kind: "clonality",
  label: "Clonality (FACETS)",
  category: "evolution",
  title: "Clonality",
  genes: true,
  maxCohorts: 3,
  defaults: (known) => ({ kind: "clonality", genes: known.genes.length ? known.genes.slice(0, 8) : ["TP53", "KRAS", "APC", "PIK3CA", "SMAD4", "CDH1"] }),
  sub: (spec) => "FACETS allele-specific copy number" + (spec.measure === "any" ? ", every mutation" : ", driver mutations") + (spec.qc === false ? ", all samples" : ", QC-passing samples"),
  Controls,
};
