"use client";
// The molsubtype view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the molsubtype view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const by = spec.by || "";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="a patient attribute to cross the subtypes with">
          by <OptionSelect value={by} disabled={busy} onValueChange={(v) => patch({ by: v || undefined })}>
            <option value="">nothing</option>
            {by && !cats.includes(by) && <option value={by}>{by}</option>}
            {cats.map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="an abnormal p53: an OncoKB-driver TP53 mutation, or any protein-changing one">
          p53 <OptionSelect value={spec.p53 === "nonsynonymous" ? "nonsynonymous" : "driver"} disabled={busy} onValueChange={(v) => patch({ p53: v === "driver" ? undefined : v })}>
            <option value="driver">OncoKB driver</option><option value="nonsynonymous">any protein-changing</option>
          </OptionSelect>
        </label>
        <label className="chk" title="draw overall survival by subtype">
          <Checkbox checked={spec.survival !== false} disabled={busy} onCheckedChange={(x) => patch({ survival: x === true ? undefined : false })} /> OS by subtype
        </label>
      </div>
    </div>
  );
}

export const molsubtypeUi: KindUi<"molsubtype"> = {
  kind: "molsubtype",
  label: "Molecular subtypes (endometrial POLE / MMRd / p53abn / NSMP)",
  title: "Molecular subtypes",
  maxCohorts: 6,
  sub: (spec) => "endometrial molecular classification per patient (POLE, MMRd, p53abn, NSMP)" + (spec.by ? " · by " + spec.by : "") +
    (spec.survival === false ? "" : " · OS by subtype"),
  Controls,
};
