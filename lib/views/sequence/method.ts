// The sequence view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { SYSTEMIC_LINE_CLASSES, CLASS_KEYS } from "../../treatment-lines.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface SequenceTrace {
  eventType: string;
  labelKey: string;
  lineGap: number;
  maxSteps: number;
  topN: number;
  classes: "systemic" | "all" | string[];
  exclude: string[];
  truncated: boolean;
  rowLimit: number;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  /** treatment records set aside before lines were built, by class and reason */
  setAside: { cohort: string; cls: string; reason: string; records: number }[];
  /** per cohort, summed over its studies: patients per (line, from, to, fate) */
  flows: { cohort: string; step: number; from: string; to: string; fate: number; n: number }[];
  foldedLabels: number;
  /** what the view reported — for the script check */
  results: { cohort: string; started: number; censored: number; nodes: { column: number; kind: string; label: string; n: number }[] }[];
}

export function sequenceMethod(t: SequenceTrace): MethodRecord {
  const classText = t.classes === "all" ? "every " + t.eventType + " record"
    : Array.isArray(t.classes) ? t.eventType + " records whose class is one of " + t.classes.join(", ")
    : t.eventType + " records whose class is systemic therapy (" + SYSTEMIC_LINE_CLASSES.join(", ") + ")";
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Build lines and count what follows what",
    detail: "The treatmentSequence query above builds every patient's lines in the database and returns, per line number, how many patients went from one regimen to the next, stopped, or were lost to follow-up — counts only — plus how many records it set aside.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
  }));
  const byReason = (reason: string) => {
    const m = new Map<string, number>();
    for (const r of t.setAside.filter((x) => x.reason === reason)) m.set(r.cls, (m.get(r.cls) || 0) + r.records);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const notLine = byReason("#not a line class"), excluded = byReason("#excluded by the document");
  steps.push({ kind: "transform", title: "Choose the records that form lines",
    detail: "The one definition every line count shares (lib/treatment-lines.ts): " + classText + ". A record's class is its SUBTYPE, or its TREATMENT_TYPE where it has none; names and values match ignoring case." +
      (t.exclude.length ? " Records labelled " + t.exclude.join(", ") + " are left out by this document." : ""),
    params: [
      ...notLine.slice(0, 12).map(([c, n]) => [c, n.toLocaleString() + " records set aside: not a line class"] as [string, string]),
      ...(notLine.length > 12 ? [["…", (notLine.length - 12) + " more classes, " + notLine.slice(12).reduce((k, [, n]) => k + n, 0).toLocaleString() + " records"] as [string, string]] : []),
      ...excluded.map(([c, n]) => [c, n.toLocaleString() + " records excluded by the document"] as [string, string]),
    ] });
  steps.push({ kind: "transform", title: "Group records into lines",
    detail: "Per patient, by start date: a record starting more than " + t.lineGap + " days after every earlier one has stopped begins a new line; anything closer — overlapping, or a switch within the gap — is the same line. A line is named by its sorted combination of " +
      (CLASS_KEYS.includes(t.labelKey.toLowerCase() as never) ? "classes" : t.labelKey + " values") + " ('A + B'); the label never decides which records form a line." });
  steps.push({ kind: "transform", title: "Decide how each path ends",
    detail: "A patient's last line ends in 'no further line' only if they were observed for at least " + t.lineGap + " days after it — their last contact being the later of their last recorded event of any type and their OS follow-up (OS_MONTHS × 30.4375 days) — and in 'record ends here' otherwise. Lines are followed up to line " + t.maxSteps + "." });
  steps.push({ kind: "transform", title: "Keep the " + t.topN + " most common regimens",
    detail: "Flows are summed across studies, then regimens ranked by the patients leaving them (or, for one seen only as a destination, arriving), ties by name, across every panel so a regimen keeps one identity; the rest are drawn as 'other'." +
      (t.truncated ? " A study's answer reached the " + t.rowLimit + "-flow limit, so its rarest flows are missing." : ""),
    params: [["regimens folded into 'other'", String(t.foldedLabels)]] });
  const python = [
    "# Recompute the diagram from the flows: the top-" + t.topN + " folding, node sizes, and who started and was censored.",
    "import io",
    "import pandas as pd",
    "",
    RESULT_INIT,
    ...pyTable("flows", "Per cohort (summed over its studies): patients per (line, from, to, fate); fate 0 another line, 1 no further line, 2 record ends",
      ["cohort", "step", "from_", "to", "fate", "n"], t.flows.map((f) => [f.cohort, f.step, f.from, f.to, f.fate, f.n]), "sequence_flows.csv"),
    "flows[\"to\"] = flows[\"to\"].fillna(\"\")",
    "out_w = flows.groupby(\"from_\")[\"n\"].sum()",
    "in_w = flows[(flows[\"fate\"] == 0) & (flows[\"to\"] != \"\")].groupby(\"to\")[\"n\"].sum()",
    "weight = {**{k: v for k, v in in_w.items() if k not in out_w}, **out_w.to_dict()}",
    "keep = {label for label, _ in sorted(weight.items(), key=lambda x: (-x[1], x[0]))[:" + t.topN + "]}",
    "fold = lambda label: label if label in keep else \"other\"",
    "kind = {0: \"regimen\", 1: \"stopped\", 2: \"censored\"}",
    "print(len(weight) - len(keep), \"regimens folded into 'other'\")",
    "for cohort, g in flows.groupby(\"cohort\", sort=False):",
    "    out_n, in_n, started, censored = {}, {}, 0, 0",
    "    for r in g.itertuples():",
    "        k = kind[r.fate]",
    "        src, dst = (r.step, \"regimen\", fold(r.from_)), (r.step + 1, k, fold(r.to) if k == \"regimen\" else \"\")",
    "        out_n[src] = out_n.get(src, 0) + r.n",
    "        in_n[dst] = in_n.get(dst, 0) + r.n",
    "        started += r.n if r.step == 1 else 0",
    "        censored += r.n if k == \"censored\" else 0",
    "    print(f\"{cohort}: {started} with a first line, {censored} paths end censored\")",
    "    RESULT[f\"sequence:{cohort}:started\"], RESULT[f\"sequence:{cohort}:censored\"] = started, censored",
    "    for node in set(out_n) | set(in_n):",
    "        RESULT[f\"sequence:{cohort}:{node[0]}:{node[1]}:{node[2]}:n\"] = out_n.get(node, in_n.get(node))",
  ].join("\n") + "\n";
  return {
    steps,
    implementation: { functions: [], file: "lib/treatment-lines.ts, lib/views/sequence/run.ts", commit: BUILD_COMMIT },
    python: withResult(python),
    check: Object.assign({}, ...t.results.map((p) => ({
      ["sequence:" + p.cohort + ":started"]: { v: p.started, abs: 0 },
      ["sequence:" + p.cohort + ":censored"]: { v: p.censored, abs: 0 },
      ...checks("sequence:" + p.cohort + ":", p.nodes, (nd) => nd.column + ":" + nd.kind + ":" + nd.label, [["n", "n", { abs: 0 }]]),
    }))),
  };
}
