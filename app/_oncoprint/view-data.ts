// What of a view decides its answer, apart from what the figure applies in the browser: the test
// for whether an edit re-runs it. Kept apart from view-display.ts so a test can load it.
import { sortKeyText } from "./track-edits.ts";

/** the display keys the figure owns — written back without a re-run */
export const FIGURE_KEYS = new Set(["showUnaltered", "whitespace", "gaps", "colorByType", "colorByGermline", "colors", "whiteBackground",
  "sortByMutationType", "sortByDrivers", "sortIgnoreVUS"]);

/** the view without what the figure applies in the browser — what decides whether a re-run is needed */
export function dataPart(v: Record<string, unknown>): Record<string, unknown> {
  // the lollipop's alteration grid and its selected codons are applied in the browser, from the whole result
  if (v.kind === "hotspots") { const { hide, codons, ...rest } = v; void hide; void codons; return rest; }
  // the two-group lollipop's axis, alteration badges and selected codons likewise
  if (v.kind === "mutcompare") { const { hide, positions, axis, ...rest } = v; void hide; void positions; void axis; return rest; }
  // the timeline's folded tracks and its gap cuts are drawn in the browser, from the whole result
  if (v.kind === "timeline") { const { collapsed, expandGaps, ...rest } = v; void collapsed; void expandGaps; return rest; }
  // the risk model's volcano labels are chosen in the browser, from the whole result
  // the expression volcano's picked gene is ringed in the browser, its box plot a request of its own
  if (v.kind === "diffexpr") { const { gene, ...rest } = v; void gene; return rest; }
  // the generic-assay tab's picked entity likewise: its box plot is a request of its own
  if (v.kind === "assays") { const { entity, ...rest } = v; void entity; return rest; }
  if (v.kind === "riskmodel") { const { labelAbove, ...rest } = v; void labelAbove; return rest; }
  // the pathway map's pathway and ranking are applied in the browser, from every library gene's counts
  if (v.kind === "pathwaymap") { const { pathway, rank, byFrequency, pancanOnly, ...rest } = v; void pathway; void rank; void byFrequency; void pancanOnly; return rest; }
  if (v.kind !== "oncoprint") return v;
  const { sort, display, ...rest } = v;
  // a sort is applied in the browser, except a clustering: only the engine has the values to compute it
  const cluster = ((sort || []) as unknown[]).map(sortKeyText).filter((k) => k.replace(/^-/, "").startsWith("cluster:"));
  const d = Object.fromEntries(Object.entries((display || {}) as Record<string, unknown>).filter(([k]) => !FIGURE_KEYS.has(k)));
  return { ...rest, ...(Object.keys(d).length ? { display: d } : {}), ...(cluster.length ? { cluster } : {}) };
}
