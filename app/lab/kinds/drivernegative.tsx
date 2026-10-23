"use client";
// The drivernegative view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the drivernegative view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const drv: string[] = Array.isArray(spec.drivers) ? spec.drivers : [];
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="the canonical drivers, comma-separated; empty for the NSCLC set (EGFR, KRAS, ALK, ROS1, BRAF, MET, RET, ERBB2, NTRK1–3)">
          drivers <DraftInput value={drv.join(", ")} disabled={busy} width="16rem" placeholder="NSCLC set"
            onCommit={(t) => { const l = t.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean); patch({ drivers: l.length ? l : undefined }); }} />
        </label>
        <label className="tbfield" title="what is compared between the two groups">
          compare <OptionSelect value={spec.alteration || "mutation"} disabled={busy} onValueChange={(v) => patch({ alteration: v === "mutation" ? undefined : v })}>
            <option value="mutation">mutations</option><option value="sv">structural variants</option><option value="cna">amp or deep deletion</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="count every alteration, or only OncoKB drivers">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
            <option value="any">any</option><option value="driver">drivers</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const drivernegativeUi: KindUi<"drivernegative"> = {
  kind: "drivernegative",
  label: "Driver-negative analysis (genes enriched without a canonical driver)",
  title: "Driver-negative analysis",
  maxCohorts: 1,
  sub: (spec) => (spec.alteration === "sv" ? "structural variants" : spec.alteration === "cna" ? "copy-number alterations" : "mutations") +
    " without vs with a driver in " + (spec.drivers?.length ? spec.drivers.length + " genes" : "the NSCLC set") + ", per patient",
  Controls,
};
