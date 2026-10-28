"use client";
// The predictive view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the predictive view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const ex = spec.exposure || { eventType: "Treatment" };
  const types = c.events.map((x) => x.label);
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">exposure</span>
        <label className="tbfield" data-tip="patients with an event of this type are exposed, the rest unexposed">
          had <OptionSelect value={ex.eventType || ""} disabled={busy} onValueChange={(v) => patch({ exposure: { ...ex, eventType: v } })}>
            {!types.includes(ex.eventType) && <option value={ex.eventType || ""}>{ex.eventType || "choose…"}</option>}
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="only events with this attribute (e.g. SUBTYPE, AGENT); empty for any">
          where <DraftInput value={ex.key || ""} disabled={busy} width="6rem" placeholder="attribute"
            onCommit={(t) => patch({ exposure: { eventType: ex.eventType, ...(t.trim() ? { key: t.trim(), value: ex.value || "" } : {}) } })} />
        </label>
        <label className="tbfield" data-tip="the value that attribute must take (e.g. Immuno)">
          = <DraftInput value={ex.value || ""} disabled={busy} width="7rem" placeholder="value"
            onCommit={(t) => patch({ exposure: { ...ex, value: t } })} />
        </label>
      </div>
    </div>
  );
}

export const predictiveUi: KindUi<"predictive"> = {
  kind: "predictive",
  label: "Predictive biomarkers (gene × treatment interaction)",
  category: "outcomes",
  title: "Predictive biomarkers",
  genes: true,
  maxCohorts: 2,
  why: (k) => k.events.some((e) => /treat|therap|drug|medicat/i.test(e.canonical)) ? null : "this study records no treatment timeline events to define an exposure",
  defaults: (known) => {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind: "predictive", exposure: { eventType: tx ? tx.label : "Treatment", key: "SUBTYPE", value: "Immuno" }, genes: known.genes.length ? known.genes.slice(0, 8) : ["STK11", "KEAP1", "KRAS", "TP53", "EGFR"] };
  },
  sub: (spec) => {
    const ex = spec.exposure || {};
    return "gene × " + (ex.eventType || "?") + (ex.key ? " [" + ex.key + "=" + ex.value + "]" : "") + " on " + (spec.endpoint || "OS") +
      (spec.covariates?.length ? " + " + spec.covariates.length + " covariate" + (spec.covariates.length === 1 ? "" : "s") : "") + " · Cox per gene";
  },
  Controls,
};
