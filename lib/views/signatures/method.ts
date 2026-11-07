// The signatures view's method record: what was read and computed, step by step (lib/method.ts).
import { type TableLists, type MethodRecord, tableSteps, pyTable, withResult, RESULT_INIT } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";
import type { SpectrumChannel } from "./types.ts";

export function signaturesMethod(t: { cohorts: string[]; queryText: string; sortName: string | null; desc: boolean; shown: number;
  lists: TableLists; excluded: { study: string; reason: string; patients: number }[]; instances: number;
  patient: { study: string; id: string }; version: string; profiles: { contribution: string; pvalue: string | null; counts: string | null };
  profiled: string[]; signatures: number; spectrum: { sample: string; total: number; channels: SpectrumChannel[] } | null }): MethodRecord {
  const steps = tableSteps({ label: "signatures", what: "patients", queryText: t.queryText, shown: t.shown, lists: t.lists, instances: t.instances, excluded: t.excluded,
    source: "every patient of each cohort with a numeric value in one of the study's mutational-signature contribution profiles, with their sample count, how many of those samples have a value, and the signature types they have values in.",
    order: t.sortName ? "by " + t.sortName + (t.desc ? " descending" : "") + " with missing values last, then patient id" : "most profiled samples first, then by patient id" });
  steps.push({
    kind: "fetch" as const, title: "Read " + t.patient.id + "'s samples and signature values",
    detail: "signatures:samples (the patient's samples, numbered in sample order) and signatures:values: every entity of each of the study's mutational-signature profiles with the patient's value in each sample, " +
      "and the entity's name, description and link. The table lists " + t.profiles.contribution + " as stored (a value that is not a number is NA)" +
      (t.profiles.pvalue ? ", each value marked significant where the same signature's value in " + t.profiles.pvalue + " for that sample is under 0.05" : "") + ".",
    params: [["type", t.version], ["profiled samples", t.profiled.join(", ")], ["signatures with a value", String(t.signatures)]],
  });
  if (t.spectrum) steps.push({
    kind: "transform" as const, title: t.spectrum.sample + "'s spectrum",
    detail: "Each channel's count in " + t.profiles.counts + " for " + t.spectrum.sample + ", and its share of the sample's total over every channel, in percent.",
    params: [["total", t.spectrum.total.toLocaleString("en-US")], ["channels", String(t.spectrum.channels.length)]],
  });
  const sp = t.spectrum;
  const python = sp ? withResult([
    "import io",
    "import pandas as pd",
    "",
    RESULT_INIT,
    ...pyTable("counts", sp.sample + "'s mutations per channel, from the signatures:values query (" + t.profiles.counts + ")", ["channel", "count"], sp.channels.map((c) => [c.label, c.count]), "signature_counts.csv"),
    "total = counts[\"count\"].sum()",
    "counts[\"percent\"] = 100 * counts[\"count\"] / total if total else 0.0",
    "print(\"total\", total)",
    "print(counts.sort_values(\"count\", ascending=False).head(10).to_string(index=False))",
    "RESULT[\"signatures:total\"] = total",
    "for r in counts.itertuples():",
    "    RESULT[f\"signatures:{r.channel}:percent\"] = r.percent",
  ].join("\n") + "\n") : undefined;
  const check = sp ? {
    "signatures:total": { v: sp.total },
    ...Object.fromEntries(sp.channels.map((c) => ["signatures:" + c.label + ":percent", { v: sp.total ? 100 * c.count / sp.total : 0, rel: 1e-9, abs: 1e-12 }])),
  } : undefined;
  return { steps, implementation: { functions: ["runSignatures", "signaturePatientsSource", "signatureValuesSource", "signatureRows", "spectrumOf", "pageSql", "countsSql", "rankSql"],
    file: "lib/views/signatures/run.ts, lib/views/signatures/sql.ts, lib/views/signatures/data.ts, lib/table-query.ts", commit: BUILD_COMMIT },
    verification: sp ? "The contributions are listed as the study stores them; the spectrum's shares are each channel's count over the sample's total, which the script recomputes."
      : "A listing of the study's stored contributions: nothing is computed, so there is no script — the queries are the numbers.",
    ...(python ? { python, check } : {}) };
}
