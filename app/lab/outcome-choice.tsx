"use client";
// Choosing a survival or incidence outcome on a card: the study's own endpoints, an upload's time and
// status columns (found by name, app/lab/outcome-pairs.ts), or any two columns picked by hand.
import { useState } from "react";
import { Choice } from "../_ui/choice.tsx";
import { attributeLabel } from "../../lib/custom-data-names.ts";
import {
  COMPETING_STATUS, OTHER_COLUMNS, SURVIVAL_STATUS, endpointName, pairValue, parsePairValue, uploadedOutcomePairs, type OutcomePair
} from "./outcome-pairs.ts";

type Attr = { attribute: string; kind: string };
type Patch = (p: Record<string, unknown>) => void;

const columnsOf = (spec: any): { months: string; status: string } | null =>
  spec.monthsAttribute && spec.statusAttribute ? { months: String(spec.monthsAttribute), status: String(spec.statusAttribute) } : null;
const pairLabel = (months: string, status: string) => attributeLabel(status, "short") + " over " + attributeLabel(months, "short");
/** the endpoint name for two columns picked by hand: the time column's, without _TIME/_MONTHS */
const nameFor = (months: string) => endpointName(attributeLabel(months, "short").replace(/_(TIME|MONTHS)$/i, ""));

/** a time column and a status column; reports the pair once both are chosen */
function ColumnPickers({ cols, attrs, busy, statusTip, onPick }: {
  cols: { months: string; status: string } | null; attrs: Attr[]; busy: boolean; statusTip: string;
  onPick: (months: string, status: string) => void;
}) {
  const [months, setMonths] = useState(cols?.months ?? "");
  const [status, setStatus] = useState(cols?.status ?? "");
  const pick = (m: string, s: string) => { setMonths(m); setStatus(s); if (m && s) onPick(m, s); };
  return <>
    <span className="meta">time</span>
    <Choice size="ctl" value={months} disabled={busy} placeholder="time column" title="the time column, in months"
      options={attrs.filter((a) => a.kind === "num").map((a) => [a.attribute, attributeLabel(a.attribute)] as const)}
      onChange={(v) => pick(v, status)} />
    <span className="meta">status</span>
    <Choice size="ctl" value={status} disabled={busy} placeholder="status column" title={statusTip}
      options={attrs.map((a) => [a.attribute, attributeLabel(a.attribute)] as const)}
      onChange={(v) => pick(months, v)} />
  </>;
}

/**
 * The endpoint of a survival-type view: one the study declares (<X>_MONTHS/<X>_STATUS), an upload's
 * <X>_TIME with <X>_EVENT / _STATUS / _EVENT_CAUSE_SPECIFIC, or two columns picked by hand. Choosing
 * a study endpoint clears the columns, so the chooser always shows what the view reads.
 */
export function EndpointChoice({ spec, endpoints, attrs, busy, pending, onPatch }: {
  spec: any; endpoints: string[]; attrs: Attr[]; busy: boolean; pending?: string; onPatch: Patch;
}) {
  const [picking, setPicking] = useState(false);
  const pairs = uploadedOutcomePairs(attrs, SURVIVAL_STATUS);
  const cols = columnsOf(spec);
  const handPicked = !!cols && !pairs.some((p) => p.months === cols.months && p.status === cols.status);
  const studyEps = endpoints.length ? endpoints : [cols ? "OS" : String(spec.endpoint || "OS")];
  const value = picking ? OTHER_COLUMNS : cols ? pairValue(cols.months, cols.status) : String(spec.endpoint || "OS");
  const choose = (v: string) => {
    if (v === OTHER_COLUMNS) { setPicking(true); return; }
    setPicking(false);
    const p = parsePairValue(v);
    if (!p) { onPatch({ endpoint: v, monthsAttribute: undefined, statusAttribute: undefined }); return; }
    const pair = pairs.find((x) => x.months === p.months && x.status === p.status);
    onPatch({ endpoint: pair ? pair.name : nameFor(p.months), monthsAttribute: p.months, statusAttribute: p.status });
  };
  return <>
    <Choice size="ctl" value={value} disabled={busy} onChange={choose} pending={pending}
      title="the survival endpoint: one the study declares, or a time and status column of an upload"
      options={[
        ...studyEps.map((e) => [e, e] as const),
        ...pairs.map((p: OutcomePair) => [pairValue(p.months, p.status), p.label] as const),
        ...(handPicked ? [[pairValue(cols!.months, cols!.status), pairLabel(cols!.months, cols!.status)] as const] : []),
        [OTHER_COLUMNS, "other columns…"] as const,
      ]} />
    {(picking || handPicked) && <ColumnPickers cols={cols} attrs={attrs} busy={busy}
      statusTip="the status column: a code of 1 (or 1:…) is the event, anything else censored"
      onPick={(months, status) => { setPicking(false); onPatch({ endpoint: nameFor(months), monthsAttribute: months, statusAttribute: status }); }} />}
  </>;
}

/** what an incidence view models: a timeline event, or a recorded time and a 0/1/2 competing-risks status */
export function IncidenceOutcomeChoice({ spec, attrs, events, busy, onPatch }: {
  spec: any; attrs: Attr[]; events: string[]; busy: boolean; onPatch: Patch;
}) {
  const [picking, setPicking] = useState(false);
  const pairs = uploadedOutcomePairs(attrs, COMPETING_STATUS);
  const cols = columnsOf(spec);
  const handPicked = !!cols && !pairs.some((p) => p.months === cols.months && p.status === cols.status);
  const EVENT = "\u0000event";
  const value = picking ? OTHER_COLUMNS : cols ? pairValue(cols.months, cols.status) : EVENT;
  const choose = (v: string) => {
    if (v === OTHER_COLUMNS) { setPicking(true); return; }
    setPicking(false);
    const p = parsePairValue(v);
    if (!p) { onPatch({ monthsAttribute: undefined, statusAttribute: undefined, label: undefined, event: spec.event || { eventType: events[0] || "" } }); return; }
    onPatch({ event: undefined, anchor: undefined, label: undefined, monthsAttribute: p.months, statusAttribute: p.status });
  };
  return <>
    <Choice size="ctl" value={value} disabled={busy} onChange={choose}
      title="what to estimate the incidence of: a timeline event (death competing), or an upload's time with a status coded 0 censored, 1 event, 2 competing"
      options={[
        [EVENT, "a timeline event"] as const,
        ...pairs.map((p) => [pairValue(p.months, p.status), p.label] as const),
        ...(handPicked ? [[pairValue(cols!.months, cols!.status), pairLabel(cols!.months, cols!.status)] as const] : []),
        [OTHER_COLUMNS, "other columns…"] as const,
      ]} />
    {(picking || handPicked) && <ColumnPickers cols={cols} attrs={attrs} busy={busy}
      statusTip="the status column, coded 0 censored, 1 the event, 2 a competing event"
      onPick={(months, status) => { setPicking(false); onPatch({ event: undefined, anchor: undefined, label: undefined, monthsAttribute: months, statusAttribute: status }); }} />}
  </>;
}
