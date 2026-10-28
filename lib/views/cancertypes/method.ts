// The cancertypes view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import type { MethodRecord, MethodStep } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface CancertypesTrace {
  genes: string[]; groupBy: string; measure: "driver" | "any"; oncokbPin: string | null; minSamples: number;
  unit: "patient" | "sample";
  perSite: { cohort: string; study: string; groups: number; profiled: number }[];
  panels: { cohort: string; groups: number; pooled: number; profiled: number; altered: number }[];
}

export function cancertypesMethod(t: CancertypesTrace): MethodRecord {
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count " + t.unit + "s per " + t.groupBy + " group",
    detail: "The cancertypes queries above. Per group, for the genes together and for each gene: the " + t.unit + "s profiled for it, and of those the " + t.unit + "s with " +
      (t.measure === "driver" ? "an OncoKB driver (" + t.oncokbPin + ")" : "any mutation, amplification, deep deletion or structural variant") +
      ", split by kind (one kind only, or more than one); and the whole cohort's, each " + t.unit + " once." +
      (t.unit === "patient" ? " A patient counts in each group one of their samples in the cohort is in, profiled if any of those samples is, altered if any is." : "") +
      " Per group too, how many were profiled for mutations, copy number and structural variants at all. Counts only.",
    scope: s.cohort + " · " + s.study, rowsOut: s.groups,
    params: [["genes", t.genes.join(", ")], ["profiled " + t.unit + "s", s.profiled.toLocaleString("en-US")]],
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length)
    steps.push({ kind: "transform", title: "Add each group's counts across studies", detail: "Groups are matched by their folded value; the counts add exactly." });
  for (const p of t.panels) steps.push({
    kind: "transform", title: "Pool the small groups", scope: p.cohort,
    detail: p.pooled ? p.pooled + " group" + (p.pooled === 1 ? "" : "s") + " with fewer than " + t.minSamples + " profiled " + t.unit + "s drawn as one pooled bar; " + p.groups + " drawn on their own."
      : "Every group has at least " + t.minSamples + " profiled " + t.unit + "s; none pooled.",
    params: [["profiled", p.profiled.toLocaleString("en-US")], ["altered", p.altered.toLocaleString("en-US")]],
  });
  return { steps, implementation: { functions: [], file: "lib/views/cancertypes/run.ts", commit: BUILD_COMMIT } };
}
