"use client";
// The ctdna view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the ctdna view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const choosing = !!(spec.genes && spec.genes.length);
  const csv = (x: any, d: string[]) => (Array.isArray(x) && x.length ? x : d).join(", ");
  const parse = (t: string) => t.split(",").map((y) => y.trim()).filter(Boolean);
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" data-tip="the sample attribute's values that mark a plasma (cfDNA) sample; comma-separated">
          plasma <DraftInput value={csv(spec.plasma, ["cfDNA", "ctDNA"])} disabled={busy} width="7rem" onCommit={(t) => patch({ plasma: parse(t).length ? parse(t) : undefined })} />
        </label>
        <label className="tbfield" data-tip="the values that mark a tissue sample">
          tissue <DraftInput value={csv(spec.tissue, ["Tumor"])} disabled={busy} width="6rem" onCommit={(t) => patch({ tissue: parse(t).length ? parse(t) : undefined })} />
        </label>
        <label className="tbfield" data-tip="test the genes you chose, or the most altered in the paired patients">
          genes <OptionSelect value={choosing ? "chosen" : "top"} disabled={busy}
            onValueChange={(v) => patch(v === "top" ? { genes: undefined } : { genes: ["EGFR", "KRAS", "TP53", "PIK3CA", "BRAF"], top: undefined })}>
            <option value="chosen">chosen</option><option value="top">most altered</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="pair only samples the timeline dates within this many days of each other">
          drawn within <OptionSelect value={spec.withinDays == null ? "" : String(spec.withinDays)} disabled={busy} onValueChange={(v) => patch({ withinDays: v === "" ? undefined : Number(v) })}>
            {[...new Set(["", "30", "90", "365", spec.withinDays == null ? "" : String(spec.withinDays)])].map((d) => <option key={d} value={d}>{d === "" ? "any time" : d + " days"}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="any alteration, or only those OncoKB calls oncogenic">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
            <option value="any">any alteration</option><option value="driver">oncogenic only</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const ctdnaUi: KindUi<"ctdna"> = {
  kind: "ctdna",
  label: "ctDNA vs tissue (plasma against tissue, OS by ctDNA detected)",
  category: "clinical",
  title: "ctDNA vs tissue",
  genes: true,
  maxCohorts: 3,
  defaults: (known) => known.genes.length ? { kind: "ctdna", genes: known.genes.slice(0, 10) } : { kind: "ctdna" },
  sub: (spec) => "plasma " + (spec.attribute || "SAMPLE_CLASS") + " = " + (spec.plasma || ["cfDNA", "ctDNA"]).join("/") + " vs tissue " + (spec.tissue || ["Tumor"]).join("/") +
    (spec.measure === "driver" ? ", oncogenic only" : ", any alteration") + (spec.withinDays != null ? ", drawn within " + spec.withinDays + " days" : "") +
    (spec.chFilter ? ", clonal haematopoiesis filtered" : "") +
    (spec.genes && spec.genes.length ? "" : ", the most altered genes"),
  Controls,
};
