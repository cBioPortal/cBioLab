"use client";
// The labs view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the labs view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const an = spec.anchor || { eventType: "" };
  const types = c.events.map((x) => x.label);
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">test</span>
        <span className="tbfield">
          <DraftInput value={spec.test || ""} disabled={busy} width="7rem" title="the lab test, as its timeline attribute names it (e.g. PSA, CEA, CA_19-9)" onCommit={(t) => patch({ test: t.trim() })} />
        </span>
        <label className="tbfield" data-tip="a responder's best fall from baseline, in percent">
          responder <OptionSelect value={String(spec.responseDrop ?? 50)} disabled={busy} onValueChange={(v) => patch({ responseDrop: Number(v) })}>
            {[30, 50, 90].map((d) => <option key={d} value={d}>fell ≥{d}%</option>)}
          </OptionSelect>
        </label>
      </div>
      <div className="tbz"><span className="tbl">clock</span>
        <label className="tbfield" data-tip="the treatment start the course is read from">
          from first <OptionSelect value={an.eventType || ""} disabled={busy} onValueChange={(v) => patch({ anchor: { ...an, eventType: v } })}>
            {!types.includes(an.eventType) && <option value={an.eventType || ""}>{an.eventType || "choose…"}</option>}
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="only anchor events with this attribute (e.g. SUBTYPE); empty for any">
          where <DraftInput value={an.key || ""} disabled={busy} width="6rem" placeholder="attribute"
            onCommit={(t) => patch({ anchor: { eventType: an.eventType, ...(t.trim() ? { key: t.trim(), value: an.value || "" } : {}) } })} />
        </label>
        <label className="tbfield" data-tip="the value that attribute must take (e.g. Hormone)">
          = <DraftInput value={an.value || ""} disabled={busy} width="6rem" placeholder="value"
            onCommit={(t) => patch({ anchor: { ...an, value: t } })} />
        </label>
        <label className="tbfield" data-tip="how far after the start to follow">
          to <OptionSelect value={String(spec.toWeeks ?? 52)} disabled={busy} onValueChange={(v) => patch({ toWeeks: Number(v) })}>
            {[12, 26, 52, 104].map((w) => <option key={w} value={w}>{w} weeks</option>)}
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const labsUi: KindUi<"labs"> = {
  kind: "labs",
  label: "Lab course and response (e.g. PSA50)",
  category: "treatment",
  title: "Lab course",
  maxCohorts: 4,
  why: (k) => k.events.some((e) => /lab/i.test(e.canonical)) ? null : "this study records no lab-test timeline events",
  defaults: (known) => {
    const tx = known.events.find((e) => /treat|therap|drug|medicat/i.test(e.canonical));
    return { kind: "labs", test: "PSA", anchor: { eventType: tx ? tx.label : "Treatment" } };
  },
  sub: (spec) => {
    const an = spec.anchor || {};
    return (spec.test || "no test chosen") + " from first " + (an.eventType || "?") + (an.key ? " [" + an.key + "=" + an.value + "]" : "") +
      " · responders fell ≥" + (spec.responseDrop ?? 50) + "%";
  },
  Controls,
};
