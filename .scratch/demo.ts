import { runAnalysis } from "../lib/analysis.ts";
import { resolverFor } from "../lib/federation.ts";
import { studyProfiles } from "../lib/analysis.ts";
import { kaplanMeier, logRank } from "../lib/stats.ts";
import { expandSurvivalCounts } from "../lib/federation.ts";

const S = "msk_chord_2024";
const NSCLC = { kind: "clinical" as const, attribute: "CANCER_TYPE", values: ["Non-Small Cell Lung Cancer"], per: "sample" as const };
const IMMUNO = { kind: "event" as const, a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] }, rel: { type: "NONE" as const } };
const cohorts = {
  "STK11-mutant": { all: [NSCLC, IMMUNO, { kind: "oql" as const, q: "STK11: MUT" }] },
  "STK11 wild-type": { all: [NSCLC, IMMUNO, { not: { kind: "oql" as const, q: "STK11:" } }, { kind: "profiled" as const, type: "MUTATION" }] }
};
const anchor = { eventType: "Treatment", key: "SUBTYPE", value: "Immuno", occurrence: "FIRST" as const };

const line = (l: string, v: any) => console.log(l.padEnd(30) +
  v.curves.map((c: any) => `${c.cohort}: ${c.median == null ? "not reached" : c.median.toFixed(1) + "mo"} (n=${c.n})`).join("   ") +
  "   log-rank p=" + (v.logrank ? (v.logrank.p === 0 ? "<1e-300" : v.logrank.p.toExponential(1)) : "-"));

const fromSeq = await runAnalysis({ study: S, cohorts, views: [{ kind: "survival" as const }] });
line("from sequencing (day 0)", fromSeq.views[0]);
const anchored = await runAnalysis({ study: S, cohorts, views: [{ kind: "survival" as const, anchor }] });
line("from 1st immunotherapy", anchored.views[0]);
console.log("   entry distribution:", JSON.stringify(anchored.views[0].entryMonths));

// what the SAME anchored data would say if we ignored delayed entry — the bias
const { profiles, gaProfiles } = await studyProfiles(S);
const res = await resolverFor(S, { profiles, gaProfiles });
console.log("\nthe bias left truncation removes:");
for (const [name, def] of Object.entries(cohorts)) {
  const rows = await res.survivalCounts(def as any, "OS", anchor);
  const honest = kaplanMeier(expandSurvivalCounts(rows));
  const naive = kaplanMeier(expandSurvivalCounts(rows).map(({ t, event }) => ({ t, event })));
  console.log("  " + name.padEnd(18) + "truncated median " + (honest.median == null ? "NR" : honest.median.toFixed(1)) +
    "mo   vs  naive " + (naive.median == null ? "NR" : naive.median.toFixed(1)) + "mo   (overstated by " +
    (naive.median != null && honest.median != null ? (naive.median - honest.median).toFixed(1) : "?") + "mo)");
}
const doc = { study: S, cohorts, views: [{ kind: "survival", anchor }, { kind: "compare", genes: ["STK11","KEAP1","TP53","EGFR"] }] };
console.log("\n?doc= " + Buffer.from(JSON.stringify(doc)).toString("base64url"));
