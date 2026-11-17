// The Genomic Evolution line chart's Group by, as the portal's VAF chart groups samples
// (VAFChartControls, VAFChartWrapper, VAFChartUtils.splitMutationsBySampleGroup).
import { clinicalColor } from "../../oncoprint-style.ts";
import type { EvolutionGroup, EvolutionSample } from "./types.ts";

/**
 * The attributes the chart can be grouped by: the study's sample attributes that some sample of the
 * patient has a value for, in the study's order (the portal's clinicalAttributeListForSamples lists
 * the attributes its samples carry).
 */
export function groupOptions(columns: { id: string; name: string }[], bySample: Record<string, [string, string][]>, samples: EvolutionSample[]): { id: string; name: string }[] {
  const held = new Set(samples.flatMap((s) => (bySample[s.id] || []).map(([id]) => id)));
  return columns.filter((c) => held.has(c.id));
}

/**
 * The samples grouped by their value of `attribute`: a group per value, in the order of its first
 * sample (clinicalValueToSamplesMap), then the samples without a value as one group, unlabelled and
 * last. Each value takes the portal's next unique colour (makeUniqueColorGetter, STYLE's clinical
 * list) when there is more than one group; the group without a value, or a lone group, keeps the
 * default ink (null), as the portal's groupColor falls back to black.
 */
export function sampleGroups(samples: EvolutionSample[], bySample: Record<string, [string, string][]>, attribute: string): EvolutionGroup[] {
  const valueOf = (s: EvolutionSample) => (bySample[s.id] || []).find(([id]) => id === attribute)?.[1] ?? "";
  const byValue = new Map<string, number[]>();
  const none: number[] = [];
  samples.forEach((s, i) => {
    const v = valueOf(s);
    if (!v) { none.push(i); return; }
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(i);
  });
  const n = byValue.size + (none.length ? 1 : 0);
  const out: EvolutionGroup[] = [...byValue].map(([value, idx], k) => ({ value, color: n > 1 ? clinicalColor(k) : null, samples: idx }));
  if (none.length) out.push({ value: "", color: null, samples: none });
  return out;
}

/**
 * The document patch that moves the view to another patient (or, with null, back to the list's
 * first): Group by is cleared, as the portal's starts over on each patient's page, so an attribute
 * of one patient's samples is never carried to another's.
 */
export function patientPatch(to: { study: string; id: string } | null): { patient: { study: string; id: string } | undefined; groupBy: undefined } {
  return { patient: to ?? undefined, groupBy: undefined };
}
