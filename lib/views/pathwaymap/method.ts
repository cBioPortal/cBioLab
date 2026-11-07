// The pathwaymap view's method record: what was computed from its queries' rows, step by step (lib/method.ts).
import { type MethodRecord, type MethodStep, ALTERED_MEANING, RESULT_INIT, pyTable, withResult, checks } from "../../method.ts";
import { BUILD_COMMIT } from "../../build-info.ts";
import { round2, type RankedPathway, type RankSettings } from "./rank.ts";

export interface PathwayMapTrace {
  cohorts: string[];
  query: string[];
  queryFrom: "genes" | "altered";
  settings: RankSettings;
  perSite: { cohort: string; study: string; cohortPatients: number }[];
  /** what each study's geneCounts query returned (the combined "any" row), leaving out genes with nothing profiled or altered */
  counts: { cohort: string; study: string; gene: string; profiled: number; altered: number }[];
  /** how many genes were asked about */
  genes: number;
  /** the pathways ranked, with the settings' score — for the script check */
  ranked: RankedPathway[];
  /** the pathways the ranking considered, with their gene nodes */
  pathways: { name: string; genes: string[] }[];
  /** the drawn pathway's gene nodes that are gene symbols, whose % the figure shows — for the script check */
  drawn: string[];
}

const SCORE_WORDS: Record<string, string> = {
  "count": "the number of query genes among its gene nodes",
  "percent": "100 × that number ÷ its gene nodes",
  "count+f": "the sum of the matched genes' altered %",
  "percent+f": "matched genes × the sum of their altered % ÷ its gene nodes (PathwayMapper's formula)",
};

export function pathwayMapMethod(t: PathwayMapTrace): MethodRecord {
  const mode = t.settings.rank + (t.settings.byFrequency ? "+f" : "");
  const steps: MethodStep[] = t.perSite.map((s) => ({
    kind: "fetch" as const, title: "Count profiled and altered samples per gene",
    detail: "The geneCounts query above, for every gene PathwayMapper's library names as a gene symbol and every query gene. Per gene: samples on a panel that covers it (profiled — the denominator, so a sample whose panel omits the gene is not counted as unaltered) and of those, " + ALTERED_MEANING.replace(/^altered: /, "") + ". Counts only.",
    scope: s.cohort + " · " + s.study, rowsIn: s.cohortPatients,
    params: [["genes", String(t.genes)]],
  }));
  if (new Set(t.perSite.map((s) => s.cohort)).size < t.perSite.length) steps.push({ kind: "transform", title: "Add each cohort's counts across its studies", detail: "The counts add exactly; a gene's % is then altered ÷ profiled." });
  steps.push({ kind: "transform", title: "Rank the pathways",
    detail: "For each " + (t.settings.pancanOnly ? "of the ten TCGA PanCanAtlas pathways" : "pathway of the library") + ": " + SCORE_WORDS[mode] +
      (t.settings.byFrequency ? ", each gene's % rounded to 2 decimals" + (t.cohorts.length > 1 ? " and the highest across the cohorts" : "") + ", a gene profiled nowhere adding 0" : "") +
      ". Best first; equal scores by the matched genes' summed % and then by name.",
    params: [["query genes", t.queryFrom === "genes" ? t.query.join(" ") : t.query.length + " altered library genes"]] });
  const python = [
    "import io",
    "import math",
    "import pandas as pd",
    "",
    RESULT_INIT,
    ...pyTable("counts", "What the geneCounts query returned for each cohort and study: samples profiled for and altered in each gene (genes with neither left out)",
      ["cohort", "study", "gene", "profiled", "altered"], t.counts.map((r) => [r.cohort, r.study, r.gene, r.profiled, r.altered]), "gene_counts.csv"),
    ...pyTable("members", "Each ranked pathway's gene nodes", ["pathway", "gene"], t.pathways.flatMap((p) => p.genes.map((g) => [p.name, g])), "pathway_genes.csv"),
    "cohorts = " + JSON.stringify(t.cohorts),
    "query = " + JSON.stringify(t.query),
    "per = counts.groupby([\"gene\", \"cohort\"])[[\"profiled\", \"altered\"]].sum()",
    "r2 = lambda x: math.floor(x * 100 + 0.5) / 100  # to 2 decimals, halves up (as JavaScript's Math.round)",
    "per[\"pct\"] = [r2(100 * a / p) if p else float(\"nan\") for a, p in zip(per[\"altered\"], per[\"profiled\"])]",
    "pct = per[\"pct\"].groupby(level=0).max()  # a gene's % for ranking: the highest across the cohorts",
    "for (gene, cohort), r in per.iterrows():",
    "    RESULT[f\"pathwaymap:{gene}:{cohort}:pct\"] = r[\"pct\"]",
    "rows = []",
    "for name, g in members.groupby(\"pathway\", sort=False):",
    "    nodes = list(dict.fromkeys(g[\"gene\"]))",
    "    matched = [q for q in query if q in nodes]",
    "    f = r2(sum(r2(float(pct[q])) if q in pct.index and pd.notna(pct[q]) else 0.0 for q in matched))",
    "    score = " + ({ "count": "len(matched)", "percent": "100 * len(matched) / len(nodes)", "count+f": "f", "percent+f": "len(matched) * f / len(nodes)" } as Record<string, string>)[mode],
    "    rows.append((name, score, f))",
    "    RESULT[f\"pathwaymap:{name}:score\"] = score",
    "ranked = pd.DataFrame(rows, columns=[\"pathway\", \"score\", \"frequency_sum\"]).sort_values([\"score\", \"frequency_sum\", \"pathway\"], ascending=[False, False, True])",
    "print(ranked.to_string(index=False))",
  ].join("\n") + "\n";
  const pcts: { key: string; pct: number }[] = [];
  const sum = new Map<string, { profiled: number; altered: number }>();
  for (const r of t.counts) {
    const k = r.gene + ":" + r.cohort, cur = sum.get(k) || { profiled: 0, altered: 0 };
    cur.profiled += r.profiled; cur.altered += r.altered; sum.set(k, cur);
  }
  for (const g of t.drawn) for (const c of t.cohorts) {
    const s = sum.get(g + ":" + c);
    if (s && s.profiled) pcts.push({ key: g + ":" + c, pct: round2(100 * s.altered / s.profiled) });
  }
  return {
    steps,
    implementation: { functions: ["rankPathways", "scorePathway"], file: "lib/views/pathwaymap/rank.ts", commit: BUILD_COMMIT },
    python: withResult(python),
    check: {
      ...checks("pathwaymap:", t.ranked.map((r) => ({ name: r.name, score: r.score })), (r) => r.name, [["score", "score", { abs: 1e-9 }]]),
      ...checks("pathwaymap:", pcts, (r) => r.key, [["pct", "pct", { abs: 1e-9 }]]),
    },
  };
}
