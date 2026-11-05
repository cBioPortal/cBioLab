"use client";
// The incidence view on the analysis page: its entry in the add menu, the view a new one starts from, and its card.
import { DraftInput } from "./parts.tsx";
import type { KindCardCtx, KindUi } from "./kind-ui.ts";
import { OptionSelect } from "../../_ui/choice.tsx";
import { IncidenceOutcomeChoice } from "../outcome-choice.tsx";
import { uploadedOutcomePairs, COMPETING_STATUS, endpointText } from "../outcome-pairs.ts";
import { attributeLabel } from "../../../lib/custom-data-names.ts";

/** the incidence view's settings row */
function Controls({ c }: { c: KindCardCtx }) {
  const { spec, busy, patch } = c;
  const types = c.events.map((x) => x.label);
  const outcome = <IncidenceOutcomeChoice spec={spec} attrs={c.attrs} events={types} busy={busy} onPatch={patch} />;
  if (spec.monthsAttribute || spec.statusAttribute) return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">outcome</span>{outcome}
        <span className="meta" data-tip="the status column's codes">0 censored · 1 event · 2 competing</span>
      </div>
    </div>
  );
  const e = spec.event || { eventType: "" }, a0 = (e.attrs || [])[0] || { key: "", value: "" };
  const an = spec.anchor || null;
  const setEvent = (next: any) => patch({ event: next });
  return (
    <div className="viewtb">
      <div className="tbz"><span className="tbl">outcome</span>{outcome}</div>
      <div className="tbz"><span className="tbl">event</span>
        <label className="tbfield" data-tip="the timeline event whose first occurrence after the anchor is counted">
          type <OptionSelect value={e.eventType || ""} disabled={busy} onValueChange={(v) => setEvent({ ...e, eventType: v })}>
            {!types.includes(e.eventType) && <option value={e.eventType || ""}>{e.eventType || "choose…"}</option>}
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </OptionSelect>
        </label>
        <label className="tbfield" data-tip="only events with this attribute (e.g. TUMOR_SITE); leave empty for any">
          where <DraftInput value={a0.key || ""} disabled={busy} width="8rem" placeholder="attribute"
            onCommit={(t) => setEvent({ ...e, attrs: t.trim() ? [{ key: t.trim(), value: a0.value || "" }] : undefined })} />
        </label>
        <label className="tbfield" data-tip="the value that attribute must take">
          = <DraftInput value={a0.value || ""} disabled={busy} width="8rem" placeholder="value"
            onCommit={(t) => setEvent({ ...e, attrs: a0.key ? [{ key: a0.key, value: t }] : undefined })} />
        </label>
      </div>
      <div className="tbz"><span className="tbl">clock</span>
        <label className="tbfield" data-tip="when the clock starts: the study's day 0, or the first event of a type (left truncation applies, as in survival)">
          from <OptionSelect value={an ? an.eventType : ""} disabled={busy}
            onValueChange={(v) => patch({ anchor: v ? { eventType: v, occurrence: "FIRST" } : undefined })}>
            <option value="">day 0</option>
            {types.map((t) => <option key={t} value={t}>first {t}</option>)}
          </OptionSelect>
        </label>
        {an && an.key && <span className="meta" data-tip="set in the document; choosing another clock drops it">where {an.key} = {String(an.value ?? "")}</span>}
      </div>
    </div>
  );
}

export const incidenceUi: KindUi<"incidence"> = {
  kind: "incidence",
  label: "Cumulative incidence (competing risks)",
  category: "outcomes",
  title: "Cumulative incidence",
  maxCohorts: 6,
  why: (k) => k.events.length || uploadedOutcomePairs(k.attrs, COMPETING_STATUS).length ? null
    : "this study records no timeline events to estimate the incidence of, and no upload holds a <X>_TIME with a <X>_EVENTCR status",
  defaults: (known) => {
    const ev = known.events.find((e) => /diagnos|progress|status/i.test(e.canonical)) || known.events[0];
    const pair = uploadedOutcomePairs(known.attrs, COMPETING_STATUS)[0];
    if (!ev && pair) return { kind: "incidence", monthsAttribute: pair.months, statusAttribute: pair.status };
    return { kind: "incidence", event: { eventType: ev ? ev.label : "" } };
  },
  sub: (spec) => {
    if (spec.monthsAttribute || spec.statusAttribute)
      return endpointText(spec) + " over " + attributeLabel(String(spec.monthsAttribute || ""), "short") + ", code 2 competing";
    const e = spec.event || {};
    const an = spec.anchor;
    return (e.label || e.eventType || "no event chosen") +
      (an && an.eventType ? " from first " + an.eventType + (an.key ? " [" + an.key + "=" + an.value + "]" : "") : " from day 0") + ", death competing";
  },
  Controls,
};
