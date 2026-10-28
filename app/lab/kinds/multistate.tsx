"use client";
// The multistate view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";

/** the multistate view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const pr = spec.progression || {};
  const types = c.events.map((x) => x.label);
  const et = pr.eventType || "Diagnosis";
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">progression</span>
        <label className="tbfield" data-tip="the timeline event that records progression">
          event <OptionSelect value={et} disabled={busy} onValueChange={(v) => patch({ progression: { ...pr, eventType: v } })}>
            {!types.includes(et) && <option value={et}>{et}</option>}
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="the event's attribute that says progression (values Y / Yes by default)">
          key <DraftInput value={pr.key || "PROGRESSION"} disabled={busy} width="8rem" placeholder="PROGRESSION"
            onCommit={(t) => patch({ progression: { ...pr, key: t.trim() || "PROGRESSION" } })} />
        </label>
      </div>
      <div className="tbz"><span className="tbl">day 0</span>
        <label className="tbfield" data-tip="patients whose first progression is on or before day 0">
          progressed by then <OptionSelect value={spec.prevalent === "exclude" ? "exclude" : "include"} disabled={busy} onValueChange={(v) => patch({ prevalent: v })}>
            <option value="include">start progressed</option>
            <option value="exclude">left out</option>
          </OptionSelect>
        </label>
      </div>
    </div>
  );
}

export const multistateUi: KindUi<"multistate"> = {
  kind: "multistate",
  label: "Multistate model (progression, then death)",
  category: "outcomes",
  title: "Multistate model",
  maxCohorts: 4,
  why: (k) => k.events.some((e) => /diagnos|progress/i.test(e.canonical)) ? null : "this study records no diagnosis or progression timeline events",
  defaults: (known) => {
    const dx = known.events.find((e) => /diagnos/i.test(e.canonical));
    return { kind: "multistate", progression: { eventType: dx ? dx.label : "Diagnosis", key: "PROGRESSION", values: ["Y", "Yes"] } };
  },
  sub: (spec) => {
    const pr = spec.progression || {};
    return "start → progression → death, months from day 0 · progression = " + (pr.eventType || "Diagnosis") + " " + (pr.key || "PROGRESSION") +
      (spec.prevalent === "exclude" ? " · progressed by day 0 left out" : "");
  },
  Controls,
};
