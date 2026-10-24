"use client";
// The cutpoint view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the cutpoint view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const nums = c.attrs.filter((a) => a.kind === "num").map((a) => a.attribute);
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const attr = spec.attribute || "TMB_NONSYNONYMOUS";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the numeric marker whose cut-point is searched">
          marker <OptionSelect value={attr} disabled={busy} onValueChange={(v) => patch({ attribute: v })}>
            {!nums.includes(attr) && <option value={attr}>{attr}</option>}
            {nums.map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="a cut-point per value of this attribute (its largest values), as a table">
          per <OptionSelect value={spec.stratifyBy || ""} disabled={busy} onValueChange={(v) => patch({ stratifyBy: v || undefined })}>
            <option value="">(no strata)</option>
            {spec.stratifyBy && !cats.includes(spec.stratifyBy) && <option value={spec.stratifyBy}>{spec.stratifyBy}</option>}
            {cats.map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="seeded permutations of the marker for the corrected p">
          permutations <OptionSelect value={String(spec.permutations ?? 1000)} disabled={busy} onValueChange={(v) => patch({ permutations: Number(v) })}>
            {[200, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const cutpointUi: KindUi<"cutpoint"> = {
  kind: "cutpoint",
  label: "Biomarker cut-point (best split of a number for OS)",
  title: "Cut-point",
  maxCohorts: 1,
  why: (k) => k.attrs.some((a) => a.kind === "num") ? null : "this study has no numeric clinical attribute to find a cut-point of",
  defaults: (known) => {
    const num = known.attrs.find((a) => a.attribute === "TMB_NONSYNONYMOUS") || known.attrs.find((a) => a.kind === "num");
    return { kind: "cutpoint", attribute: num ? num.attribute : "TMB_NONSYNONYMOUS" };
  },
  sub: (spec) => (spec.attribute || "TMB_NONSYNONYMOUS") + " on " + (spec.endpoint || "OS") + " · best log-rank cut, " + (spec.permutations ?? 1000) + " permutations" +
    (spec.stratifyBy ? " · per " + spec.stratifyBy : ""),
  Controls,
};
