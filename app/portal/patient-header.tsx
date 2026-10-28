"use client";
// The Patient page's header, as cBioPortal's patient view has it (PatientViewPageHeader,
// PatientHeader, SampleSummaryList): a Patient row — the id, then its attributes inline — and a
// Samples row, one line per sample with its numbered marker, its id and its attributes. Hovering an
// id lists every attribute. A sample's id opens the sample view in place (with a modifier key, in
// a new tab, as a link does); the patient's id opens the patient view. In the sample view the
// header shows that sample only, with a button to show all the patient's samples.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../lab/api.ts";
import { Button } from "../_ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../_ui/popover";
import { sampleMarks, type SampleMark } from "../../lib/timeline-tracks.ts";
import type { PatientEvent, PatientSample } from "../../lib/types";
import { cleanAndDerive, inlineAttributes, liftCommon, type Attrs } from "./patient-attrs.ts";

/** an attribute's id and display name, and its value */
type Field = { id: string; name: string; value: string };
interface SampleRecord { id: string; fields: Field[] }
export interface PatientRecord { id: string; fields: Field[]; samples: SampleRecord[]; marks: Map<string, SampleMark> }

const HEADER_COHORT = "Header";
const ROWS_MAX = 1000;
type TableJson = { columns: { id: string; name: string }[]; rows: { patient: string; sample: string; values: (string | number | null)[] }[] };

/**
 * The patient's attributes, every sample's own attributes (a sample row carries its patient's too,
 * which are left to the patient), and the samples numbered as the timeline numbers them.
 */
export function usePatientRecord(study: string, patient: string | null): { record: PatientRecord | null; error: string | null } {
  const [out, setOut] = useState<{ record: PatientRecord | null; error: string | null }>({ record: null, error: null });
  useEffect(() => {
    if (!study || !patient) return;
    setOut({ record: null, error: null });
    let live = true;
    const cohort = { study, all: [{ kind: "patientList" as const, ids: [study + ":" + patient] }] };
    api.analysis({ study, cohorts: { [HEADER_COHORT]: cohort }, views: [
      { kind: "table", unit: "patient", cohorts: [HEADER_COHORT] },
      { kind: "table", unit: "sample", cohorts: [HEADER_COHORT], rows: ROWS_MAX },
      { kind: "timeline", cohorts: [HEADER_COHORT] },
    ] })
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        const [pv, sv, tv] = j.views || [];
        if (j.error || pv?.error || sv?.error) { setOut({ record: null, error: j.error || pv?.error || sv?.error }); return; }
        const pt = pv.table as TableJson, st = sv.table as TableJson;
        const fieldsOf = (t: TableJson, row: TableJson["rows"][number], skip: Set<string>) =>
          t.columns.map((c, i) => ({ id: c.id, name: c.name, value: row.values[i] == null ? "" : String(row.values[i]) }))
            .filter((f) => !skip.has(f.id) && f.value !== "");
        const prow = pt.rows[0];
        if (!prow) { setOut({ record: null, error: "no patient " + patient + " in " + study }); return; }
        const patientCols = new Set(pt.columns.map((c) => c.id));
        const samples = st.rows.map((row) => ({ id: row.sample, fields: fieldsOf(st, row, new Set([...patientCols, "sample"])) }));
        // a study without a timeline still has its samples: they are numbered by type, then id
        const tl = !tv?.error ? tv?.timeline?.patient as { samples: PatientSample[]; events: PatientEvent[] } | undefined : undefined;
        const typed = samples.map((s) => ({ id: s.id, type: s.fields.find((f) => f.id === "SAMPLE_TYPE")?.value || "" }));
        setOut({ record: { id: patient, fields: fieldsOf(pt, prow, new Set(["patient", "samples"])), samples,
          marks: sampleMarks(tl?.samples.length ? tl.samples : typed, tl?.events || []) }, error: null });
      })
      .catch((e) => { if (live) setOut({ record: null, error: String(e) }); });
    return () => { live = false; };
  }, [study, patient]);
  return out;
}

const attrsOf = (fields: Field[]): Attrs => Object.fromEntries(fields.map((f) => [f.id, f.value]));

/** The configured attributes, inline, as the portal writes them after an id. */
function InlineAttrs({ attrs }: { attrs: Attrs }) {
  return <>{inlineAttributes(attrs).map((a) => (
    <span key={a.key} style={{ color: a.color }} data-attr={a.key}>
      <span className="text-foreground">{a.lead}</span>{a.text}<span className="text-foreground">{a.trail}</span>
    </span>))}</>;
}

/** An id that lists every attribute while hovered or focused, as the portal's tooltip does. */
function HoverCard({ title, fields, children }: { title: string; fields: Field[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className="inline-flex items-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>{children}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[400px] w-auto max-w-[600px] overflow-auto p-3" onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <div className="mb-1.5 font-mono text-sm font-semibold">{title}</div>
        <table className="text-sm"><tbody>
          {fields.map((f) => <tr key={f.id}><th className="pr-3 text-left align-top font-medium text-muted-foreground" data-tip={f.id}>{f.name}</th><td>{f.value}</td></tr>)}
        </tbody></table>
      </PopoverContent>
    </Popover>
  );
}

/** A sample's marker: its number in the patient's sample order, in its type's colour. */
export function SampleMarker({ mark }: { mark: SampleMark | undefined }) {
  if (!mark) return null;
  return (
    <svg width="14" height="14" aria-hidden="true" className="mr-1 shrink-0">
      <circle cx="7" cy="7" r="7" fill={mark.color} />
      <text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{mark.label}</text>
    </svg>
  );
}

export function PatientHeader({ record, sample, hrefFor }: {
  record: PatientRecord;
  /** the sample the page shows, in the sample view; null in the patient view */
  sample: string | null;
  /** the page's link for the patient view (no sample) or a sample's view */
  hrefFor: (to: { patient: string } | { sample: string }) => string;
}) {
  const { common, samples } = useMemo(() => {
    const lifted = liftCommon(record.samples.map((s) => cleanAndDerive(attrsOf(s.fields))));
    return { common: lifted.common, samples: record.samples.map((s, i) => ({ ...s, attrs: lifted.samples[i] })) };
  }, [record]);
  // the patient's attributes and those every sample shares, as the portal joins them
  const patientAttrs = useMemo(() => ({ ...cleanAndDerive(attrsOf(record.fields)), ...common }), [record, common]);
  const order = (id: string) => Number(record.marks.get(id)?.label ?? Infinity);
  const shown = samples.filter((s) => !sample || s.id === sample).sort((a, b) => order(a.id) - order(b.id));
  return (
    <table data-tw className="patient-header mt-3 border-separate border-spacing-x-0 border-spacing-y-1 text-md">
      <tbody>
        <tr>
          <td className="pr-3 align-top font-semibold text-muted-foreground">Patient:</td>
          <td>
            <HoverCard title={record.id} fields={record.fields}>
              <Link href={hrefFor({ patient: record.id })} className="font-mono text-primary hover:underline">{record.id}</Link>
            </HoverCard>
            <InlineAttrs attrs={patientAttrs} />
          </td>
        </tr>
        <tr>
          <td className="pr-3 align-top font-semibold text-muted-foreground">Samples:</td>
          <td>
            {shown.map((s) => (
              <div key={s.id} className="patient-sample flex flex-wrap items-center">
                <HoverCard title={s.id} fields={s.fields}>
                  <SampleMarker mark={record.marks.get(s.id)} />
                  <Link href={hrefFor({ sample: s.id })} className="font-mono text-primary hover:underline">
                    {s.attrs.SAMPLE_DISPLAY_NAME ? s.attrs.SAMPLE_DISPLAY_NAME + " (" + s.id + ")" : s.id}
                  </Link>
                </HoverCard>
                <InlineAttrs attrs={s.attrs} />
              </div>
            ))}
            {sample && record.samples.length > 1 && (
              <Button asChild variant="outline" size="xs" className="mt-1">
                <Link href={hrefFor({ patient: record.id })}>Show all {record.samples.length} samples</Link>
              </Button>
            )}
            {!shown.length && <span className="text-muted-foreground">{sample ? sample + " is not one of " + record.id + "'s samples" : "no samples"}</span>}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export { HEADER_COHORT };
