"use client";
// The acquired view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput, PAIRED_DEFAULT_GENES } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the acquired view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const an = spec.anchor || { eventType: "Treatment" };
  const types = c.events.map((x) => x.label);
  const scanning = !(spec.genes && spec.genes.length);
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">clock</span>
        <label className="tbfield" title="the treatment start: each patient's first event of this type">
          first <OptionSelect value={an.eventType || ""} disabled={busy} onValueChange={(v) => patch({ anchor: { ...an, eventType: v } })}>
            {!types.includes(an.eventType) && <option value={an.eventType || ""}>{an.eventType || "choose…"}</option>}
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" title="only anchor events with this attribute (e.g. SUBTYPE or AGENT); empty for any">
          where <DraftInput value={an.key || ""} disabled={busy} width="6rem" placeholder="attribute"
            onCommit={(t) => patch({ anchor: { eventType: an.eventType, ...(t.trim() ? { key: t.trim(), value: an.value || "" } : {}) } })} />
        </label>
        <label className="tbfield" title="the value that attribute must take (e.g. Hormone)">
          = <DraftInput value={an.value || ""} disabled={busy} width="6rem" placeholder="value"
            onCommit={(t) => patch({ anchor: { ...an, value: t } })} />
        </label>
        <label className="tbfield" title="the after-sample is the first at least this many days after the start">
          after ≥ <OptionSelect value={String(spec.minGapDays ?? 30)} disabled={busy} onValueChange={(v) => patch({ minGapDays: Number(v) === 30 ? undefined : Number(v) })}>
            {[...new Set([0, 30, 90, 180, 365, Number(spec.minGapDays ?? 30)])].sort((x, y) => x - y).map((d) => <option key={d} value={d}>{d} days</option>)}
          </OptionSelect>
        </label>
      </div>
      <div className="tbz"><span className="tbl">data</span>
        <label className="tbfield" title="test the genes you chose, or scan every gene altered after treatment in at least minPost patients">
          genes <OptionSelect value={scanning ? "scan" : "chosen"} disabled={busy}
            onValueChange={(v) => patch(v === "scan" ? { genes: undefined } : { genes: PAIRED_DEFAULT_GENES, top: undefined })}>
            <option value="chosen">chosen</option><option value="scan">scan all</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="any alteration, or only those OncoKB calls oncogenic">
          count <OptionSelect value={spec.measure === "driver" ? "driver" : "any"} disabled={busy} onValueChange={(v) => patch({ measure: v === "driver" ? "driver" : undefined })}>
            <option value="any">any alteration</option><option value="driver">oncogenic only</option>
          </OptionSelect>
        </label>
        <label className="tbfield" title="leave out plasma mutation calls likely from clonal haematopoiesis: in the canonical CH genes, or seen in the matched white-cell sample">
          clonal haematopoiesis <OptionSelect value={spec.chFilter ? "filter" : "keep"} disabled={busy} onValueChange={(v) => patch({ chFilter: v === "filter" ? (spec.chFilter || true) : undefined })}>
            <option value="keep">kept</option><option value="filter">filtered out</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const acquiredUi: KindUi<"acquired"> = {
  kind: "acquired",
  label: "Acquired under therapy (samples before vs after a treatment start)",
  category: "evolution",
  title: "Acquired under therapy",
  genes: true,
  maxCohorts: 3,
  why: (k) => k.events.some((e) => /treat|therap|drug|medicat/i.test(e.canonical)) ? null : "this study records no treatment timeline events to anchor on",
  defaults: (known) => {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind: "acquired", anchor: { eventType: tx ? tx.label : "Treatment" } };
  },
  sub: (spec) => {
    const an = spec.anchor || { eventType: "Treatment" };
    return "last sample before the first " + (an.eventType || "?") + (an.key ? " [" + an.key + "=" + an.value + "]" : "") + " vs the first ≥" + (spec.minGapDays ?? 30) + " days after" +
      (spec.measure === "driver" ? ", oncogenic only" : ", any alteration") + (spec.genes && spec.genes.length ? "" : ", every gene scanned");
  },
  Controls,
};
