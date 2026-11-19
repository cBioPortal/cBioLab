// Where each oncoprint track's row sits: the portal's track groups (Oncoprint.tsx
// CLINICAL_TRACK_GROUP_INDEX 0, GENETIC_TRACK_GROUP_INDEX 1, a group per heatmap profile after),
// a gap after each (oncoprintjs modelutils calculateTrackAndHeaderTops, track_group_padding).

/** what decides a track's group */
export interface RowTrack { kind: string; profileType?: string }
export interface RowGeometry { header: number; rowH: number; rowGap: number; trackGroupGap: number }

/** the track's group: clinical (with the Profiled rows), genetic (genes and derived events), or its heatmap's profile */
export function trackGroupKey(t: RowTrack): string {
  return t.kind === "clinical" ? "clinical" : t.kind === "heatmap" ? "heatmap:" + (t.profileType ?? "") : "genetic";
}

/** each track's top, then where the last row ends: one more entry than tracks */
export function trackTops(tracks: readonly RowTrack[], g: RowGeometry): number[] {
  const out: number[] = [];
  let y = g.header;
  tracks.forEach((t, i) => {
    if (i > 0 && trackGroupKey(t) !== trackGroupKey(tracks[i - 1])) y += g.trackGroupGap;
    out.push(y);
    y += g.rowH + g.rowGap;
  });
  out.push(y);
  return out;
}

/** the track whose row holds this y, or -1 (a row gap or a group gap holds none) */
export function trackAtY(y: number, tops: readonly number[], rowH: number): number {
  let lo = 0, hi = tops.length - 2;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (y < tops[m]) hi = m - 1;
    else if (y > tops[m] + rowH) lo = m + 1;
    else return m;
  }
  return -1;
}
