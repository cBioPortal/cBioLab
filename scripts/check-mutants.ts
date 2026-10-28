/**
 * Can the checks fail? Each entry below is a realistic bug, planted one at a time into a copy of
 * the code, and the checks that guard that part of the code are run against it. A planted bug the
 * checks do not notice ("survived") means the checks would also miss that bug if it were real.
 *
 * The bugs are the kinds that produce plausible-looking numbers rather than errors: censored
 * patients counted as deaths, a denominator that counts samples on panels without the gene, "and"
 * computed as "or". One of them is a bug this project actually shipped and later caught.
 *
 * The copy lives in a temporary directory (node_modules linked, .env.local copied for the
 * database checks), so the working tree and its dev server are never touched.
 *
 * Run: npm run check:mutants (about three minutes).
 * With RECORD=1 (npm run verify) it writes docs/verification/mutants.json, which /verification reads
 * (or REPORT_DIR/mutants.json when REPORT_DIR is set, as in CI).
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
/** the report's folder: docs/verification/ (what the page shows), or REPORT_DIR (what CI uploads) */
const OUT = join(process.env.REPORT_DIR || join(ROOT, "docs/verification"), "mutants.json");

type Guard = "unit" | "cohort-logic" | "portal-parity";
const GUARD_CMD: Record<Guard, string[]> = {
  "unit": ["npm", "test"],
  "cohort-logic": ["node", "--env-file=.env.local", "scripts/check-cohort-logic.ts"],
  "portal-parity": ["node", "--env-file=.env.local", "scripts/check-portal-parity.ts"],
};

interface Mutant {
  id: string;
  layer: "statistics" | "cohorts" | "counts";
  /** what the bug would do to a result, in words a reader of the result understands */
  effect: string;
  file: string;
  find: string;
  replace: string;
  guard: Guard;
  /** set when this bug actually shipped once */
  history?: string;
}

const MUTANTS: Mutant[] = [
  { id: "km-censored-as-death", layer: "statistics", guard: "unit", file: "lib/stats.ts",
    effect: "Survival curves count patients who were still alive at last follow-up as deaths, so every curve drops too fast.",
    // kaplanMeier's own tie loop: kmMedianCi and rmst repeat the line, then read the risk set as `n`
    find: "while (i < clean.length && clean[i].t === t) { if (clean[i].event) d++; i++; }\n    const atRisk = atRiskAt(t);",
    replace: "while (i < clean.length && clean[i].t === t) { d++; i++; }\n    const atRisk = atRiskAt(t);" },
  { id: "km-never-leave-risk-set", layer: "statistics", guard: "unit", file: "lib/stats.ts",
    effect: "Patients stay in the at-risk group after they leave the study, so later deaths look rarer and curves sit too high.",
    find: "while (xi < exits.length && exits[xi] < t) { exited++; xi++; }",
    replace: "while (xi < exits.length && exits[xi] < t) { xi++; }" },
  { id: "logrank-variance", layer: "statistics", guard: "unit", file: "lib/stats.ts",
    effect: "The log-rank test overstates its variance when deaths are tied, so survival differences look less significant than they are.",
    find: "v += (d * n1 * n2 * (n - d)) / (n * n * (n - 1));",
    replace: "v += (d * n1 * n2 * n) / (n * n * (n - 1));" },
  { id: "fisher-one-sided", layer: "statistics", guard: "unit", file: "lib/stats.ts",
    effect: "Fisher's exact test only counts tables in one direction, so mutual-exclusivity and enrichment p-values come out too small.",
    find: "for (let x = lo; x <= hi; x++) {",
    replace: "for (let x = a; x <= hi; x++) {" },
  { id: "bh-not-monotone", layer: "statistics", guard: "unit", file: "lib/stats.ts",
    effect: "Multiple-testing correction skips a step, so a gene with a weaker p-value can be reported as more significant than a stronger one.",
    find: "running = Math.min(running, (order[k].p * m) / (k + 1));",
    replace: "running = (order[k].p * m) / (k + 1);" },
  { id: "cox-breslow-ties", layer: "statistics", guard: "unit", file: "lib/stats.ts",
    effect: "Hazard ratios handle patients who die on the same day with a cruder formula than the one the method states (Breslow, not Efron).",
    find: "const frac = l / dCount;",
    replace: "const frac = 0;" },
  { id: "welch-student-df", layer: "statistics", guard: "unit", file: "lib/stats.ts",
    effect: "The t-test assumes both groups have the same spread when they do not, so p-values are wrong for unequal groups.",
    find: "const df = (denom * denom) / ((s1 * s1) / (n1 - 1) + (s2 * s2) / (n2 - 1));",
    replace: "const df = n1 + n2 - 2;" },

  { id: "and-as-or", layer: "cohorts", guard: "cohort-logic", file: "lib/cohort2.ts",
    effect: "A cohort written as \"A and B\" contains everyone with A or B.",
    find: "return clauses.map((c) => \"(\" + clauseSql(c, ctx) + \")\").join(\"\\nINTERSECT DISTINCT\\n\");",
    replace: "return clauses.map((c) => \"(\" + clauseSql(c, ctx) + \")\").join(\"\\nUNION DISTINCT\\n\");" },
  { id: "or-as-and", layer: "cohorts", guard: "cohort-logic", file: "lib/cohort2.ts",
    effect: "A cohort written as \"A or B\" contains only patients with both.",
    find: "return clause.any.map((l: any) => \"(\" + leafSql(l, ctx) + \")\").join(\"\\nUNION DISTINCT\\n\");",
    replace: "return clause.any.map((l: any) => \"(\" + leafSql(l, ctx) + \")\").join(\"\\nINTERSECT DISTINCT\\n\");" },
  { id: "clinical-values-unfolded", layer: "cohorts", guard: "cohort-logic", file: "lib/cohort2.ts",
    effect: "A cohort picked by a clinical value (\"female\", or a facet's \"Female \") misses every patient whose recorded value differs in case or spacing, though the facet that offered the value counted them.",
    find: "leaf.values.slice(0, 50).map(v => clinicalValueFoldSql(sq(String(v)))).join(\",\")",
    replace: "leaf.values.slice(0, 50).map(v => sq(String(v))).join(\",\")" },
  { id: "sample-clause-takes-whole-patient", layer: "cohorts", guard: "cohort-logic", file: "lib/cohort2.ts",
    effect: "A cohort picked by a sample-level condition (non-small cell lung cancer, an alteration) also holds every other sample of those patients — their colorectal or breast samples — so sample counts and gene frequencies count samples the condition never matched.",
    find: "const cond = ids.level === \"sample\" ? sid + \" IN (\" + ids.sql + \")\"",
    replace: "const cond = ids.level === \"sample\" ? pid + \" IN (SELECT \" + pid + \" FROM \" + dbOf(ctx) + \".sample_derived WHERE cancer_study_identifier = \" + sq(ctx.study) + \" AND \" + sid + \" IN (\" + ids.sql + \"))\"" },
  { id: "gene-counts-whole-patient", layer: "counts", guard: "portal-parity", file: "lib/federation.ts",
    effect: "A view's gene frequencies count an alteration found in any sample of a cohort's patients, so a mutation seen only in a patient's colorectal sample is counted toward their lung cancer cohort.",
    find: "\"    AND \" + inCohortSamples(sid) + \"\\n\" +\n    \"  GROUP BY gene, sid, vtype\\n\"",
    replace: "\"    AND \" + inCohortPatients(bareSampleId(\"g.patient_unique_id\", study)) + \"\\n\" +\n    \"  GROUP BY gene, sid, vtype\\n\"" },
  { id: "gene-counts-off-panel", layer: "counts", guard: "portal-parity", file: "lib/federation.ts",
    effect: "A view's gene frequencies count a call in a gene the sample's panel does not cover, and count that sample as profiled, so a gene on no panel reads 100% mutated.",
    history: "Shipped until 2026-10: msk_chord_2024 RTEL1-TNFRSF6B read 126/126 in the compare view; cBioPortal profiles none.",
    find: " AND NOT g.off_panel)\";",
    replace: ")\";" },
  { id: "split-arms-overlap", layer: "cohorts", guard: "cohort-logic", file: "lib/cohort-partitions.ts",
    effect: "Splitting a cohort into arms (KRAS G12C, then other KRAS, then wild-type) puts G12C patients in two arms at once.",
    find: "    S.exclude(arm.where);\n",
    replace: "\n" },

  { id: "denominator-ignores-panel", layer: "counts", guard: "portal-parity", file: "lib/explore.ts",
    effect: "A gene's frequency is divided by samples on the largest panel instead of samples whose panel actually covers that gene, so genes on smaller panels look rarer than they are.",
    find: "const profiled = (panelMap.get(r.g) || 0) + wesN;",
    replace: "const profiled = Math.max(0, ...panelMap.values()) + wesN;" },
  { id: "cna-denominator-double-count", layer: "counts", guard: "portal-parity", file: "lib/explore.ts",
    effect: "Whole-exome samples with two copy-number profiles are counted twice in the denominator, halving every copy-number frequency.",
    history: "Shipped once: brca_tcga MYC amplification read 10.6% where cBioPortal says 21.2%.",
    find: "\"SELECT uniqExact(sample_unique_id) AS n\\n\" +\n        \"FROM \" + db + \".sample_to_gene_panel_derived",
    replace: "\"SELECT count() AS n\\n\" +\n        \"FROM \" + db + \".sample_to_gene_panel_derived" },
  { id: "mutation-includes-cna", layer: "counts", guard: "portal-parity", file: "lib/oql.ts",
    effect: "\"TP53: MUT\" also selects patients whose TP53 has only a copy-number change.",
    find: "conds.push(\"g.variant_type = 'mutation'\");",
    replace: "conds.push(\"g.variant_type IN ('mutation', 'cna')\");" },
  { id: "deletion-includes-amplification", layer: "counts", guard: "portal-parity", file: "lib/oql.ts",
    effect: "\"Deeply deleted\" also selects amplified patients, so a CDKN2A-loss cohort contains CDKN2A-amplified tumours.",
    find: "spec.cna === -2 ? \"g.cna_alteration <= -2\"",
    replace: "spec.cna === -2 ? \"abs(g.cna_alteration) >= 2\"" },
  { id: "position-range-ignored", layer: "counts", guard: "portal-parity", file: "lib/oql.ts",
    effect: "\"APC: TRUNC_(1400-)\" selects every APC truncation, so an N-/C-terminal split puts every truncated patient on the C-terminal side.",
    find: "    if (spec.range) conds.push(rangeCond(spec.range));\n",
    replace: "\n" },
  { id: "trunc-excludes-splice", layer: "counts", guard: "portal-parity", file: "lib/oql.ts",
    effect: "\"TP53: TRUNC\" leaves out splice-site and start-loss mutations, which cBioPortal counts as truncating.",
    history: "Shipped until 2026-10: TRUNC was nonsense, frameshift and nonstop only.",
    find: "\" NOT IN ('missense', 'inframe')\"",
    replace: "\" IN ('nonsense', 'frameshift', 'nonstop')\"" },
  { id: "table1-denominator-ignores-panel", layer: "counts", guard: "unit", file: "lib/views/riskmodel/table1.ts",
    effect: "A risk group's mutation rate in Table 1 divides by every patient in the group, counting those whose panel never covered the gene as unmutated, so the rate reads too low.",
    find: "        if (!covers(p)) continue;\n",
    replace: "\n" },
  { id: "table1-model-rows-in-fdr", layer: "statistics", guard: "unit", file: "lib/views/riskmodel/table1.ts",
    effect: "Table 1's q-values are corrected together with the rows the model was built from, whose tiny p-values are guaranteed, so every other row looks more significant than it is.",
    find: "r.role !== \"in the model\" && r.role !== \"outcome\"",
    replace: "r.role !== \"outcome\"" },
];

/**
 * The unit suites that import `file` themselves: what a planted bug there runs against, rather than
 * all of `npm test` (the baseline runs all of it). A bug only a suite further away would catch
 * shows as SURVIVED, a failure, never as a pass.
 */
function suitesImporting(dir: string, file: string): string[] {
  const imports = new RegExp("from \"(\\.\\./)+" + file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"");
  const suites = readdirSync(join(dir, "test")).filter((f) => f.endsWith(".test.ts"))
    .filter((f) => imports.test(readFileSync(join(dir, "test", f), "utf8"))).map((f) => "test/" + f);
  // `node --test` given no files runs every suite, which would hide that none guards this one
  if (!suites.length) throw new Error("no unit suite imports " + file + "; give its planted bugs another guard");
  return suites;
}

function run(dir: string, guard: Guard, file?: string): { ok: boolean; failures: number; firstFailure: string } {
  const [cmd, ...args] = guard === "unit" && file ? ["node", "--test", ...suitesImporting(dir, file)] : GUARD_CMD[guard];
  // a guard run against a planted bug must never write a report; the portal's answers are kept
  // between runs (PORTAL_CACHE in check-portal-parity.ts), since a planted bug cannot change them
  const { RECORD, REPORT_DIR, ...rest } = process.env;
  const env = { ...rest, PORTAL_CACHE: join(dir, ".portal-cache") };
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: "utf8", maxBuffer: 64 << 20, timeout: 600_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const fail = lines.find((l) => /^FAIL |^not ok /.test(l))
    || (r.status !== 0 ? "stopped with an error: " + (lines.find((l) => /Error/.test(l)) || lines[lines.length - 1] || "") : "");
  const unitFails = Number(lines.find((l) => /^# fail \d+/.test(l))?.slice(7) || 0);
  const failures = unitFails || lines.filter((l) => /^FAIL /.test(l)).length;
  return { ok: r.status === 0, failures, firstFailure: fail.slice(0, 240) };
}

const dir = mkdtempSync(join(tmpdir(), "cohort-lab-mutants-"));
const ONLY = process.env.MUTANT_ONLY;
try {
  const SKIP = new Set(["node_modules", ".git", ".next", ".next-gate", ".venv"]);
  cpSync(ROOT, dir, { recursive: true, filter: (src) => !SKIP.has(src.split("/").pop()!) });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "docs/verification"), { recursive: true });

  const guards = [...new Set(MUTANTS.map((m) => m.guard))];
  for (const g of guards) {
    const base = run(dir, g);
    console.log(`${base.ok ? "PASS" : "FAIL"} baseline: ${g} passes on the unmodified code`);
    if (!base.ok) { console.log("  " + base.firstFailure); process.exit(1); }
  }

  const results = [];
  for (const m of MUTANTS.filter((m) => !ONLY || m.id === ONLY)) {
    const path = join(dir, m.file);
    const original = readFileSync(path, "utf8");
    const hits = original.split(m.find).length - 1;
    if (hits !== 1) throw new Error(`${m.id}: expected the bug's site exactly once in ${m.file}, found ${hits}`);
    writeFileSync(path, original.replace(m.find, m.replace));
    const t0 = Date.now();
    const r = run(dir, m.guard, m.file);
    writeFileSync(path, original);
    const caught = !r.ok;
    console.log(`${caught ? "CAUGHT  " : "SURVIVED"} ${m.id} (${m.guard}, ${r.failures} failing, ${((Date.now() - t0) / 1000).toFixed(0)}s)${caught ? "  " + r.firstFailure : ""}`);
    results.push({ id: m.id, layer: m.layer, effect: m.effect, file: m.file, guard: m.guard, history: m.history,
      caught, failures: r.failures, evidence: r.firstFailure });
  }

  const caught = results.filter((r) => r.caught).length;
  if (!ONLY && process.env.RECORD) mkdirSync(dirname(OUT), { recursive: true });
  if (!ONLY && process.env.RECORD) writeFileSync(OUT, JSON.stringify({
    ranAt: new Date().toISOString(),
    commit: execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(),
    total: results.length, caught,
    mutants: results,
  }, null, 1) + "\n");
  console.log(`\n${caught} of ${results.length} planted bugs caught`);
  process.exit(caught === results.length ? 0 : 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
