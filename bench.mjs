// Benchmark: contract engine at increasing cohort sizes
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { buildContract } = await import("./lib/oncoprint.js");
const GENES = ["TP53","KRAS","STK11","KEAP1","EGFR","ARID1A","MSH3"];
const IMMUNO = { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] };
const PROG = { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] };
const CASES = [
  ["two-group immuno (2,946)", { genes: GENES, clinical: ["OS_STATUS"], derivedEvents: [],
    layout: { groupBy: { kind: "cohorts", groups: [
      { name: "prog", dsl: { a: IMMUNO, b: PROG, rel: { type: "BEFORE", minDays: 0, maxDays: 180 } } },
      { name: "noprog", dsl: { a: IMMUNO, b: PROG, rel: { type: "NOT_FOLLOWED_BY", withinDays: 180, observed: true } } } ] } } }],
  ["immuno cohort (3,341)", { genes: GENES, clinical: ["OS_STATUS"], derivedEvents: [], cohort: { dsl: { a: IMMUNO, rel: { type: "NONE" } } } }],
  ["all patients (24,950)", { genes: GENES, clinical: ["OS_STATUS"], derivedEvents: [], cohort: null }],
];
for (const [name, spec] of CASES) {
  for (let run = 0; run < 3; run++) {
    const t0 = Date.now();
    const c = await buildContract(spec);
    const json = JSON.stringify(c);
    console.log(`${name} run${run}: total=${Date.now()-t0}ms engine=${c.stats.ms}ms cols=${c.stats.nColumns} tracks=${c.tracks.length} json=${(json.length/1024/1024).toFixed(2)}MB`);
  }
}
