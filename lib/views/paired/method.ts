// The paired view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, driverMeaning, ALTERED_MEANING, type MethodStep, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface PairedTrace {
  pairBy: { attribute: string; a: string[]; b: string[] };
  /** each study's own sides, when they differ from `pairBy` */
  perStudy?: Record<string, { attribute: string; a: string[]; b: string[] }>;
  labels?: { a: string; b: string };
  measure: "driver" | "any";
  oncokbPin: string | null;
  /** present when every altered gene was tested and the `top` most one-sided drawn */
  scan?: { top: number };
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  panels: { cohort: string; patients: number; tested?: number }[];
  counts: { cohort: string; study: string; gene: string; pairs: number; both: number; aOnly: number; bOnly: number }[];
  /** what the view reported per cohort and gene — for the script check */
  results: { cohort: string; gene: string; p: number; q?: number }[];
}

export function pairedMethod(t: PairedTrace): MethodRecord {
  const aL = t.labels?.a ?? t.pairBy.a.join("/"), bL = t.labels?.b ?? t.pairBy.b.join("/");
  const what = t.measure === "driver" ? driverMeaning(t.oncokbPin).replace(/^driver: /, "") : ALTERED_MEANING.replace(/^altered: /, "");
  const steps: MethodStep[] = t.perSite.map((s) => {
    const sp = t.perStudy?.[s.study] || t.pairBy;
    return {
      kind: "fetch" as const, title: "Count each gene's state in paired samples",
      detail: "The paired:patients and paired:genes queries above. Patients with both, among the cohort's samples, a " + sp.attribute + " = " + sp.a.join("/") + " sample (" + aL + ") and a " +
        sp.attribute + " = " + sp.b.join("/") + " sample (" + bL + "); per gene" + (t.scan ? " — every gene altered (" + what + ") in some such patient" : "") +
        ", among those profiled for it on both sides by each side's own panels: altered (" + what + ") on both sides, on the " + aL +
        " side only, or the " + bL + " side only. A patient with several samples on one side counts as altered there if any is. Counts only.",
      scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
    };
  });
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's counts across its studies", detail: "The counts add exactly." });
  steps.push({ kind: "statistic", title: "Exact McNemar test per gene",
    detail: "Only the discordant patients carry information about direction: of the " + aL + "-only and " + bL + "-only patients, each is a fair coin under the null, so p is twice the smaller binomial tail (capped at 1). Concordance is both ÷ altered anywhere.",
    params: t.panels.map((p) => [p.cohort, p.patients.toLocaleString() + " patients with both kinds of sample"] as [string, string]) });
  steps.push({ kind: "statistic", title: "Benjamini–Hochberg across genes, per cohort", detail: "q-values over the genes with at least one discordant patient, separately for each cohort." +
    (t.scan ? " In a scan that is every such gene, not only the ones drawn." : "") });
  if (t.scan) steps.push({ kind: "transform", title: "Draw the " + t.scan.top + " most one-sided genes",
    detail: "Of the genes with a discordant patient, ordered by McNemar p, then by the size of the imbalance between " + aL + "-only and " + bL +
      "-only patients, then by the number of discordant patients, then by name; the first " + t.scan.top + " are drawn and reported.",
    params: t.panels.map((p) => [p.cohort, (p.tested ?? 0).toLocaleString() + " genes tested"] as [string, string]) });
  const python = [
    "# Recompute with statsmodels " + VERIFIED.mcnemar.version + ", the version our code is tested against.",
    "import io",
    "import pandas as pd",
    "from statsmodels.stats.contingency_tables import mcnemar",
    "from statsmodels.stats.multitest import multipletests",
    "",
    RESULT_INIT,
    ...pyTable("counts", "What the paired:genes queries returned per cohort and study: patients altered on both sides, on the " + aL + " side only, on the " + bL + " side only, of those profiled on both",
      ["cohort", "study", "gene", "pairs", "both", "a_only", "b_only"], t.counts.map((r) => [r.cohort, r.study, r.gene, r.pairs, r.both, r.aOnly, r.bOnly]), "paired_counts.csv"),
    "g = counts.groupby([\"cohort\", \"gene\"], sort=False)[[\"pairs\", \"both\", \"a_only\", \"b_only\"]].sum().reset_index()",
    "g[\"concordance\"] = g[\"both\"] / (g[\"both\"] + g[\"a_only\"] + g[\"b_only\"])",
    "g[\"p\"] = [mcnemar([[r.both, r.a_only], [r.b_only, 0]], exact=True).pvalue if r.a_only + r.b_only else 1.0 for r in g.itertuples()]",
    "for cohort, c in g.groupby(\"cohort\", sort=False):",
    "    tested = c[c[\"a_only\"] + c[\"b_only\"] > 0]",
    "    g.loc[tested.index, \"q\"] = multipletests(tested[\"p\"], method=\"fdr_bh\")[1] if len(tested) else []",
    "print(g.to_string(index=False))",
    "for r in g.itertuples():",
    "    RESULT[f\"paired:{r.cohort}:{r.gene}:p\"] = r.p",
    "    if r.a_only + r.b_only:",
    "        RESULT[f\"paired:{r.cohort}:{r.gene}:q\"] = r.q",
  ].join("\n") + "\n";
  return { steps, implementation: { functions: ["mcnemarExact", "benjaminiHochberg"], file: "lib/stats.ts", commit: BUILD_COMMIT },
    verification: "The exact McNemar test matches statsmodels " + VERIFIED.mcnemar.version + " mcnemar(exact=True) and Benjamini–Hochberg multipletests, to a relative 1e-6 (test/tables-golden.test.ts).",
    python: withResult(python),
    check: checks("paired:", t.results, (r) => r.cohort + ":" + r.gene, [["p", "p"], ["q", "q"]]) };
}
