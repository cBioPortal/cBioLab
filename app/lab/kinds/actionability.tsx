"use client";
// The actionability view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { Checkbox } from "../../_ui/checkbox";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the actionability view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const cats = c.attrs.filter((a) => a.kind !== "num").map((a) => a.attribute);
  const by = spec.groupBy || "";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="split each cohort by a categorical attribute; the largest groups are drawn and the rest pooled into Other">
          by <OptionSelect value={by} disabled={busy} onValueChange={(v) => patch({ groupBy: v || undefined })}>
            <option value="">cohort only</option>
            <option value="CANCER_TYPE">cancer type</option>
            {by && by !== "CANCER_TYPE" && !cats.includes(by) && <option value={by}>{by}</option>}
            {cats.filter((a) => a !== "CANCER_TYPE").map((a) => <option key={a} value={a}>{a}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="how many of the largest groups are drawn">
          top <OptionSelect value={String(spec.top ?? 8)} disabled={busy || !by} onValueChange={(v) => patch({ top: v === "8" ? undefined : Number(v) })}>
            {[...new Set([4, 8, 12, 20, spec.top ?? 8])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
          </OptionSelect>
        </label>
        <label className="chk" title="compare each patient's highest level between their primary and metastatic samples (SAMPLE_TYPE)">
          <Checkbox checked={spec.pairBy !== null} disabled={busy} onCheckedChange={(on) => patch({ pairBy: on === true ? undefined : null })} /> primary vs metastasis
        </label>
      </div>
    </div>
  );
}

export const actionabilityUi: KindUi<"actionability"> = {
  kind: "actionability",
  label: "Clinical actionability (OncoKB levels, primary vs metastasis)",
  title: "Clinical actionability",
  maxCohorts: 4,
  defaults: () => ({ kind: "actionability", groupBy: "CANCER_TYPE" }),
  sub: (spec) => "highest OncoKB level per patient, any cancer type" + (spec.groupBy ? " · by " + spec.groupBy : "") +
    (spec.pairBy === null ? "" : " · " + (spec.pairBy?.attribute || "SAMPLE_TYPE") + " concordance"),
  Controls,
};
