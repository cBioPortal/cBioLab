"use client";
// The txendpoints view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the txendpoints view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const an = spec.anchor || { eventType: "Treatment" };
  const types = c.events.map((x) => x.label);
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">endpoint</span>
        <label className="tbfield" data-tip="what ends each patient's time: the next treatment line, stopping this treatment, or recorded progression — death ends it too">
          to <OptionSelect value={spec.endpoint || "ttnt"} disabled={busy} onValueChange={(v) => patch({ endpoint: v })}>
            <option value="ttnt">next treatment (TTNT)</option>
            <option value="tot">end of treatment (TOT)</option>
            <option value="rwpfs">progression (rwPFS)</option>
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="days without therapy that start a new treatment line">
          line gap <OptionSelect value={String(spec.lineGap ?? 90)} disabled={busy} onValueChange={(v) => patch({ lineGap: Number(v) })}>
            {[30, 60, 90, 120, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
          </OptionSelect>
        </label>
      </div>
      <div className="tbz"><span className="tbl">clock</span>
        <label className="tbfield" data-tip="the treatment record whose start begins the clock">
          from first <OptionSelect value={an.eventType || ""} disabled={busy} onValueChange={(v) => patch({ anchor: { ...an, eventType: v } })}>
            {!types.includes(an.eventType) && <option value={an.eventType || ""}>{an.eventType || "choose…"}</option>}
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="only treatment records with this attribute (e.g. SUBTYPE, AGENT); empty for any">
          where <DraftInput value={an.key || ""} disabled={busy} width="6rem" placeholder="attribute"
            onCommit={(t) => patch({ anchor: { eventType: an.eventType, ...(an.occurrence ? { occurrence: an.occurrence } : {}), ...(t.trim() ? { key: t.trim(), value: an.value || "" } : {}) } })} />
        </label>
        <label className="tbfield" data-tip="the value that attribute must take (e.g. Immuno, PEMBROLIZUMAB)">
          = <DraftInput value={an.value || ""} disabled={busy} width="7rem" placeholder="value"
            onCommit={(t) => patch({ anchor: { ...an, value: t } })} />
        </label>
      </div>
    </div>
  );
}

export const txendpointsUi: KindUi<"txendpoints"> = {
  kind: "txendpoints",
  label: "Treatment endpoints (TTNT, time on treatment, real-world PFS)",
  category: "treatment",
  title: "Treatment endpoints",
  maxCohorts: 6,
  why: (k) => k.events.some((e) => /treat|therap|drug|medicat/i.test(e.canonical)) ? null : "this study records no treatment timeline events",
  defaults: (known) => {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind: "txendpoints", endpoint: "ttnt", anchor: { eventType: tx ? tx.label : "Treatment", key: "SUBTYPE", value: "Immuno" } };
  },
  sub: (spec) => {
    const an = spec.anchor || {};
    const ep = spec.endpoint === "tot" ? "time on treatment" : spec.endpoint === "rwpfs" ? "real-world PFS" : "time to next treatment";
    return ep + " from " + (an.occurrence === "LAST" ? "last " : "first ") + (an.eventType || "?") + (an.key ? " [" + an.key + "=" + an.value + "]" : "") + ", death an event";
  },
  Controls,
};
