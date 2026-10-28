// The pathways view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, driverMeaning, ALTERED_MEANING, type MethodStep, VERIFIED, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";

export interface PathwaysTrace {
  measure: "driver" | "any";
  oncokbPin: string | null;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  sets: { name: string; source: string; genes: string[] }[];
  cohorts: string[];
  setCounts: { cohort: string; set: string; profiled: number; altered: number }[];
  geneCounts: { cohort: string; gene: string; profiled: number; altered: number }[];
  /** what the view reported (two cohorts only): each pathway's p and q, and the q of each top gene — for the script check */
  results: { pathways: { name: string; p?: number; q?: number }[]; genes: { gene: string; q: number }[] };
}

export function pathwaysMethod(t: PathwaysTrace): MethodRecord {
  const two = t.cohorts.length === 2;
  const what = t.measure === "driver" ? driverMeaning(t.oncokbPin).replace(/^driver: /, "") : ALTERED_MEANING.replace(/^altered: /, "");
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count samples altered per pathway and per gene",
    detail: "The geneCounts and pathways:sets queries above, over the cohort's samples. Per pathway: samples profiled for at least one member gene (the denominator) and of those, samples with " + what +
      " in at least one member. Per member gene: the same over the samples profiled for that gene. Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
    params: [["pathways / sets", t.sets.map((x) => x.name + " (" + x.genes.length + ")").join(", ")]],
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's counts across its studies", detail: "The counts add exactly." });
  if (two) {
    steps.push({ kind: "statistic", title: "Fisher's exact test per pathway and per member gene", detail: "Two-sided, altered vs not among the profiled, between the two cohorts." });
    steps.push({ kind: "statistic", title: "Benjamini–Hochberg", detail: "Across the pathways drawn, and separately across every member gene tested, each gene once even when it sits in two pathways." });
  }
  const python = [
    "# Recompute" + (two ? " with scipy " + VERIFIED.fisher.version + " and statsmodels " + VERIFIED.bh.version + ", the versions our code is tested against" : "") + ".",
    "import io",
    "import pandas as pd",
    ...(two ? ["from scipy.stats import fisher_exact", "from statsmodels.stats.multitest import multipletests"] : []),
    "",
    RESULT_INIT,
    ...pyTable("sets", "Per cohort and pathway: samples profiled for at least one member gene, and altered in at least one", ["cohort", "set", "profiled", "altered"],
      t.setCounts.map((r) => [r.cohort, r.set, r.profiled, r.altered]), "pathway_counts.csv"),
    ...pyTable("genes", "Per cohort and member gene: samples profiled for it, and altered in it", ["cohort", "gene", "profiled", "altered"],
      t.geneCounts.map((r) => [r.cohort, r.gene, r.profiled, r.altered]), "gene_counts.csv"),
    "cohorts = " + JSON.stringify(t.cohorts),
    "for name, table in ((\"pathway\", sets.groupby([\"set\", \"cohort\"]).sum()), (\"gene\", genes.groupby([\"gene\", \"cohort\"]).sum())):",
    "    table[\"pct\"] = 100 * table[\"altered\"] / table[\"profiled\"]",
    ...(two ? [
      "    rows = []",
      "    for key in table.index.get_level_values(0).unique():",
      "        t = table.loc[key].reindex(cohorts).fillna(0)",
      "        if (t[\"profiled\"] > 0).all():",
      "            (a, pa), (b, pb) = [(r.altered, r.profiled) for r in t.itertuples()]",
      "            rows.append((key, fisher_exact([[a, pa - a], [b, pb - b]]).pvalue))",
      "    res = pd.DataFrame(rows, columns=[name, \"p\"])",
      "    res[\"q\"] = multipletests(res[\"p\"], method=\"fdr_bh\")[1]",
      "    print(res.sort_values(\"p\").to_string(index=False))",
      "    for r in res.itertuples():",
      "        RESULT[f\"pathways:{name}:{getattr(r, name)}:p\"], RESULT[f\"pathways:{name}:{getattr(r, name)}:q\"] = r.p, r.q",
    ] : ["    print(table.to_string())"]),
  ].join("\n") + "\n";
  return { steps, implementation: { functions: two ? ["fisherExact", "benjaminiHochberg"] : [], file: "lib/stats.ts", commit: BUILD_COMMIT },
    ...(two ? { verification: "Fisher's exact test matches scipy " + VERIFIED.fisher.version + " fisher_exact and Benjamini–Hochberg statsmodels multipletests, to a relative 1e-6 (test/tables-golden.test.ts)." } : {}),
    python: withResult(python),
    check: { ...checks("pathways:pathway:", t.results.pathways, (r) => r.name, [["p", "p"], ["q", "q"]]),
      ...checks("pathways:gene:", t.results.genes, (r) => r.gene, [["q", "q"]]) } };
}
