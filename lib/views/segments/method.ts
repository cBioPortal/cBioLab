// The segments view's method record: what was read and how its rows were chosen (lib/method.ts).
import type { MethodRecord } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export function segmentsMethod(t: { build: string; region: string; sort: string; order: string; rows: number; cohortSamples: number; segmented: number;
  drawn: number; leftOut: number; segments: number; noSegment: number; otherChrom: number; studies: string[] }): MethodRecord {
  const n = (x: number) => x.toLocaleString("en-US");
  return {
    steps: [
      { kind: "fetch", title: "List the cohort's samples with segments",
        detail: "The segments:samples query above, per study: every sample of the cohort with any copy-number segment (finite segment mean), " +
          "its segments in the region drawn (" + t.region + ", " + t.build + "), and its mean log2 ratio over that region — each segment's mean weighted by the bases of it inside the region. " +
          "Ordered " + t.order + ", and cut to the row limit (" + t.rows + ").",
        params: [["cohort samples", n(t.cohortSamples)], ["with segments", n(t.segmented)], ["drawn", n(t.drawn)], ["left out by the row limit", n(t.leftOut)]] },
      { kind: "fetch", title: "Read the drawn samples' segments",
        detail: "The segments:segments query above: the drawn samples' segments in the region, as stored (chromosome 23/24 and a \"chr\" prefix folded to X/Y). " +
          "Each is drawn at its start and end, coloured by its mean on IGV's segment scale (white within ±0.1, red to +1.5, blue to −1.5).",
        params: [["segments drawn", n(t.segments)], ["drawn samples with no segment in the region", n(t.noSegment)],
          ...(t.otherChrom ? [["segments off chromosomes 1–22, X, Y (not drawn)", n(t.otherChrom)] as [string, string]] : [])] },
    ],
    implementation: { functions: ["runSegments", "segmentSamplesRows", "segmentRows", "geneLocus", "segmentColor"],
      file: "lib/views/segments/run.ts, lib/views/segments/sql.ts, lib/gene-loci.ts, lib/chart/style.ts", commit: BUILD_COMMIT },
    verification: "A drawing of stored segments: each segment mean is drawn as the database holds it, and the only number computed (a row's mean over the region, for sort) is a base-weighted average in the query — so there is no script; the queries are the numbers.",
  };
}
