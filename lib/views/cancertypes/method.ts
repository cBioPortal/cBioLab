// The cancertypes view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import type { MethodRecord, MethodStep } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface CancertypesTrace {
  genes: string[]; groupBy: string; measure: "driver" | "any"; oncokbPin: string | null; minAltered: number; show: "frequency" | "count";
  /** the query's OQL lines, when the view follows them */
  oql?: string[];
  unit: "patient" | "sample";
  /** the view set no groupBy: how the portal's default was reached (several studies; else one study's distinct cancer types) */
  byDefault?: { studies: number; cancerTypes?: number };
  perSite: { cohort: string; study: string; groups: number; profiled: number }[];
  panels: { cohort: string; groups: number; categories: number; minSamples: number; profiled: number; altered: number }[];
}

/** how a sample's group value is read, when the portal reads it its own way (extendSamplesWithCancerType) */
const FALLBACK: Record<string, string> = {
  CANCER_TYPE: " A sample without a CANCER_TYPE takes its study's type of cancer (else \"Unknown\").",
  CANCER_TYPE_DETAILED: " A sample without a CANCER_TYPE_DETAILED takes its CANCER_TYPE, else its study's type of cancer (else \"Unknown\").",
  study: " Each study's group is labelled by its name, cut as the portal's shortenStudyName cuts it.",
};

export function cancertypesMethod(t: CancertypesTrace): MethodRecord {
  const choose: MethodStep[] = t.byDefault ? [{
    kind: "transform", title: "Choose the category",
    detail: "The view names no groupBy, so the portal's default applies (CancerSummaryContainer groupAlterationsBy): the study when the cohorts span more than one study; " +
      "otherwise CANCER_TYPE_DETAILED when the cohort's samples have exactly one CANCER_TYPE (a sample without one counted as its study's type of cancer), else CANCER_TYPE. " +
      (t.byDefault.cancerTypes === undefined ? t.byDefault.studies + " studies: grouped by study."
        : "One study; the cancertypes:default query above counts " + t.byDefault.cancerTypes + " distinct CANCER_TYPE value" + (t.byDefault.cancerTypes === 1 ? "" : "s") + ": grouped by " + t.groupBy + "."),
    params: [["category", t.groupBy]],
  }] : [];
  const steps: MethodStep[] = [...choose, ...t.perSite.map((s): MethodStep => ({
    kind: "fetch" as const, title: "Count " + t.unit + "s per " + t.groupBy + " group",
    detail: "The cancertypes queries above. Per group, for the genes together and for each gene: the " + t.unit + "s profiled for it, and of those the " + t.unit + "s with " +
      (t.oql ? "an alteration one of the query's OQL lines matches, each line under its gene (" + t.oql.join("; ") + ")"
        : t.measure === "driver" ? "an OncoKB driver (" + t.oncokbPin + ")" : "any mutation, amplification, deep deletion or structural variant") +
      ", split by kind (one kind only — an amplification and a deep deletion are one copy-number kind, named by the first the portal meets, " + (t.unit === "patient" ? "the patient's samples by id and each sample's genes" : "the genes") + " in query order, as mRNA and protein high / low are — or more than one); and the whole cohort's, each " + t.unit + " once." +
      (t.unit === "patient" ? " A patient counts in each group one of their samples in the cohort is in, profiled if any of those samples is, altered if any is." : "") +
      " Per group and gene too, the " + t.unit + "s profiled for each alteration type (mutation, copy number, structural variant, and mRNA / protein for an EXP / PROT line): the gene on a sample's panel for a profile of that type; for the genes together, any of them. Counts only." + (FALLBACK[t.groupBy] || ""),
    scope: s.cohort + " · " + s.study, rowsOut: s.groups,
    params: [["genes", t.genes.join(", ")], ["profiled " + t.unit + "s", s.profiled.toLocaleString("en-US")]],
  }))];
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length)
    steps.push({ kind: "transform", title: "Add each group's counts across studies", detail: "Groups are matched by their folded value; the counts add exactly." });
  for (const p of t.panels) steps.push({
    kind: "transform", title: "Filter the groups", scope: p.cohort,
    detail: p.groups + " of " + p.categories + " groups drawn: those with at least " + Math.max(1, p.minSamples) + " profiled " + t.unit + (Math.max(1, p.minSamples) === 1 ? "" : "s") +
      (t.minAltered > 0 ? " and " + (t.show === "count" ? "at least " + t.minAltered + " altered" : "at least " + t.minAltered + "% altered") : "") + ".",
    params: [["profiled", p.profiled.toLocaleString("en-US")], ["altered", p.altered.toLocaleString("en-US")]],
  });
  return { steps, implementation: { functions: [], file: "lib/views/cancertypes/run.ts", commit: BUILD_COMMIT } };
}
