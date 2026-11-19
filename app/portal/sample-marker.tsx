// A sample's marker: its number in the patient's sample order, in its type's colour (the portal's SampleLabel).
import type { SampleMark } from "../../lib/timeline-tracks.ts";

export function SampleMarker({ mark, className = "mr-1 shrink-0" }: { mark: Pick<SampleMark, "label" | "color"> | undefined; className?: string }) {
  if (!mark) return null;
  return (
    <svg width="14" height="14" aria-hidden="true" className={className}>
      <circle cx="7" cy="7" r="7" fill={mark.color} />
      <text x="7" y="7" dy=".33em" textAnchor="middle" fontSize="9" fill="white">{mark.label}</text>
    </svg>
  );
}

/**
 * The portal's "Sample(s) ⟨markers⟩ not profiled for …" alert (SampleNotProfiledAlert): each sample
 * outside the profile by its marker, named in its tip. `period` ends the sentence, as the Patient
 * tables do when some samples are profiled.
 */
export function NotProfiledNote({ marks, what, period = false }: { marks: (Pick<SampleMark, "label" | "color"> & { id: string; type?: string | null })[]; what: string; period?: boolean }) {
  if (!marks.length) return null;
  return (
    <p className="note flex flex-wrap items-center gap-1" role="status" data-test="partialProfileAlert">
      Sample{marks.length === 1 ? "" : "s"} {marks.map((m) => <span key={m.id} role="img" aria-label={m.id} data-tip={m.id + (m.type ? " — " + m.type : "")}>
        <SampleMarker mark={m} className="" />
      </span>)} not profiled for {what}{period ? "." : ""}
    </p>
  );
}
