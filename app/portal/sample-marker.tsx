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
