// Method-record gate, run by `npm run check:methods` and by scripts/gate.sh:
//   1. Every view in every documented example carries a method record (lib/method.ts), unless
//      its kind is on EXEMPT below with the reason — a new view cannot ship without one.
//   2. Every record's Python script is run, with the library versions our statistics are tested
//      against, and must reproduce the numbers the view reported (the record's `check`, within
//      each number's tolerance). This is what keeps a record honest when the code changes: a change
//      to how a view computes that is not mirrored in its script fails here, before commit.
// Scripts whose inputs are not embedded (patient-level rows; tables too large to inline) are fed
// what a reader would export: the output of the view's own recorded queries.
// Needs DB credentials (`node --env-file=.env.local`) and `uv` on the PATH. METHOD_CHECK_ONLY=<text>
// restricts it to the examples whose title contains <text>.
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, execSync } from "child_process";
import { EXAMPLES } from "../lib/dsl-reference.ts";
import { runAnalysis } from "../lib/analysis.ts";
import { chQuery, PRIMARY } from "../lib/ch.ts";
import { studyRouting } from "../lib/federation.ts";
import { RESULT_MARKER, type MethodRecord } from "../lib/method.ts";
import { withRequestCustomData } from "../lib/custom-data-server.ts";

/** View kinds without a method record yet, and why. Shrink this list; never grow it quietly. */
const EXEMPT: Record<string, string> = {
  oncoprint: "a picture of alterations per patient: nothing is computed beyond the counts its own provenance page shows",
  hotspots: "a lollipop of mutation counts per position: no statistic",
  plot: "a scatter/density plot of two axes: no statistic",
};

/** The Python environment the scripts are checked in — the versions the golden fixtures pin. */
const PYTHON_PINS = ["lifelines==0.30.3", "statsmodels==0.15.0", "scipy==1.18.1", "numpy==2.5.3", "pandas==2.3.3"];
const PARALLEL = 4;

let failed = 0;
const report = (ok: boolean, label: string, extra = "") => {
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + " " + label + (extra ? "  [" + extra + "]" : ""));
};

try { execSync("uv --version", { stdio: "ignore" }); }
catch { console.log("FAIL uv is not on the PATH — the method scripts cannot be run"); process.exit(1); }

type View = { kind: string; error?: string; method?: MethodRecord; queries?: { study: string; label: string; sql: string }[]; cohorts?: string[] };

const csvField = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s; };
const toCsv = (rows: Record<string, unknown>[], cols: string[]) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvField(r[c])).join(","))].join("\n") + "\n";

async function runSql(study: string, sql: string): Promise<Record<string, unknown>[]> {
  const conn = (await studyRouting()).get(study) || PRIMARY;
  return (await chQuery(sql, conn)).data as Record<string, unknown>[];
}

/** The files a script reads that are not embedded in it, built from the view's own queries. */
async function materialize(v: View, dir: string): Promise<string | null> {
  const wanted = [...v.method!.python!.matchAll(/pd\.read_csv\("([^"]+)"/g)].map((m) => m[1]);
  if (!wanted.length) return null;
  const qs = v.queries || [];
  if (v.kind === "cox") {
    // one file per fitted cohort ("cox_rows.csv", or "cox_rows_<cohort>.csv" per cohort); the fetch
    // steps list the queries' cohorts in the order they ran
    const fetches = v.method!.steps.filter((s) => s.kind === "fetch");
    const rowsQs = qs.filter((q) => q.label.startsWith("coxRows:"));
    if (fetches.length !== rowsQs.length) return "the cox fetch steps and queries do not line up";
    const byFile = new Map<string, Record<string, unknown>[]>();
    for (let i = 0; i < rowsQs.length; i++) {
      const scope = fetches[i].scope || "";
      const cohort = scope.includes(" · ") ? scope.split(" · ")[0] : "";
      const file = "cox_rows" + (cohort ? "_" + cohort.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") : "") + ".csv";
      const rows = (await runSql(rowsQs[i].study, rowsQs[i].sql)).map((r) => ({ study: rowsQs[i].study, ...r }));
      byFile.set(file, [...(byFile.get(file) || []), ...rows]);
    }
    for (const [f, rows] of byFile) writeFileSync(join(dir, f), toCsv(rows, Object.keys(rows[0] || { study: 1 })));
  } else if (v.kind === "logistic") {
    const rows: Record<string, unknown>[] = [];
    for (const q of qs.filter((q) => q.label === "logisticRows")) rows.push(...(await runSql(q.study, q.sql)).map((r) => ({ study: q.study, ...r })));
    writeFileSync(join(dir, "logistic_rows.csv"), toCsv(rows, Object.keys(rows[0] || { study: 1 })));
  } else if (v.kind === "diffexpr") {
    const sums = new Map<string, { cohort: string; gene: string; n: number; sx: number; sxx: number }>();
    for (const q of qs.filter((q) => q.label.startsWith("diffexpr:moments:"))) {
      const cohort = q.label.slice("diffexpr:moments:".length);
      for (const r of await runSql(q.study, q.sql)) {
        const k = cohort + "\t" + r.gene, cur = sums.get(k) || { cohort, gene: String(r.gene), n: 0, sx: 0, sxx: 0 };
        cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx); sums.set(k, cur);
      }
    }
    writeFileSync(join(dir, "diffexpr_moments.csv"), toCsv([...sums.values()], ["cohort", "gene", "n", "sx", "sxx"]));
  } else if (v.kind === "enrichment") {
    // altered and panel-profiled samples per (cohort, gene), plus each cohort's whole-exome samples,
    // assembled exactly as the view assembles them
    const altered = new Map<string, number>(), panel = new Map<string, number>(), wes = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) || 0) + n);
    for (const q of qs) {
      const [, part, cohort] = /^enrichment:(altered|panels|wes):(.*)$/.exec(q.label) || [];
      if (!part) continue;
      for (const r of await runSql(q.study, q.sql)) {
        if (part === "altered") add(altered, cohort + "\t" + r.gene, Number(r.altered));
        else if (part === "panels") add(panel, cohort + "\t" + r.gene, Number(r.profiled));
        else add(wes, cohort, Number(r.n));
      }
    }
    const rows: Record<string, unknown>[] = [];
    for (const k of new Set([...altered.keys()])) {
      const [cohort, gene] = k.split("\t");
      const alt = altered.get(k) || 0;
      rows.push({ cohort, gene, altered: alt, profiled: Math.max(alt, (panel.get(k) || 0) + (wes.get(cohort) || 0)) });
    }
    // a cohort with no altered sample in a gene is still profiled for it
    const cohortsSeen = [...new Set([...wes.keys(), ...rows.map((r) => String(r.cohort))])];
    const genesSeen = new Set(rows.map((r) => String(r.gene)));
    for (const gene of genesSeen) for (const cohort of cohortsSeen) {
      const k = cohort + "\t" + gene;
      if (!altered.has(k)) rows.push({ cohort, gene, altered: 0, profiled: (panel.get(k) || 0) + (wes.get(cohort) || 0) });
    }
    writeFileSync(join(dir, "enrichment_counts.csv"), toCsv(rows, ["cohort", "gene", "altered", "profiled"]));
  } else if (v.kind === "assays") {
    // per (cohort, entity) moments, or per (cohort, entity, called value) counts, summed across studies
    const numeric = new Map<string, { cohort: string; entity: string; n: number; sx: number; sxx: number }>();
    const counts = new Map<string, { cohort: string; entity: string; value: string; n: number }>();
    for (const q of qs) {
      const [, part, cohort] = /^assays:(moments|values):(.*)$/.exec(q.label) || [];
      if (!part) continue;
      for (const r of await runSql(q.study, q.sql)) {
        if (part === "moments") {
          const k = cohort + "\t" + r.entity, cur = numeric.get(k) || { cohort, entity: String(r.entity), n: 0, sx: 0, sxx: 0 };
          cur.n += Number(r.n); cur.sx += Number(r.sx); cur.sxx += Number(r.sxx); numeric.set(k, cur);
        } else {
          const value = String(r.value ?? "").trim();
          if (["", "NA", "N/A", "NaN", "nan", "null", "NULL"].includes(value)) continue;
          const k = cohort + "\t" + r.entity + "\t" + value, cur = counts.get(k) || { cohort, entity: String(r.entity), value, n: 0 };
          cur.n += Number(r.n); counts.set(k, cur);
        }
      }
    }
    if (wanted.includes("assays_moments.csv")) writeFileSync(join(dir, "assays_moments.csv"), toCsv([...numeric.values()], ["cohort", "entity", "n", "sx", "sxx"]));
    if (wanted.includes("assays_counts.csv")) writeFileSync(join(dir, "assays_counts.csv"), toCsv([...counts.values()], ["cohort", "entity", "value", "n"]));
  } else {
    return "reads " + wanted.join(", ") + ", which this check cannot build for a " + v.kind + " view";
  }
  return null;
}

function runPython(dir: string): Promise<{ code: number | null; out: string; err: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = ["run", "--no-project", "--quiet", ...PYTHON_PINS.flatMap((p) => ["--with", p]), "python", "script.py"];
    const p = spawn("uv", args, { cwd: dir });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => p.kill("SIGKILL"), 30 * 60 * 1000);
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - t0 }); });
  });
}

function compare(check: MethodRecord["check"], result: Record<string, number | null>): string[] {
  const bad: string[] = [];
  for (const [k, c] of Object.entries(check || {})) {
    if (!(k in result)) { bad.push(k + ": the script did not report it"); continue; }
    const got = result[k], want = c.v;
    if (want == null || got == null) { if (want !== got) bad.push(k + ": view " + want + ", script " + got); continue; }
    // a value below 1e-300 is zero for every purpose here, and subnormal arithmetic is not exact
    const tol = Math.max(c.abs ?? 1e-300, (c.rel ?? (c.abs != null ? 0 : 1e-6)) * Math.abs(want));
    if (!(Math.abs(got - want) <= tol)) bad.push(k + ": view " + want + ", script " + got + " (tolerance " + tol.toExponential(1) + ")");
  }
  return bad;
}

interface Job { label: string; view: View }
const jobs: Job[] = [];
// METHOD_CHECK_ONLY=<text> runs just the examples whose title contains it, while iterating
const only = process.env.METHOD_CHECK_ONLY;
for (const ex of EXAMPLES.filter((e) => !only || e.title.includes(only))) {
  let result;
  // an example's bundled demo data travels with it, exactly as the page sends it
  try { result = await withRequestCustomData(ex.customData, () => runAnalysis(ex.doc)); }
  catch (e) { report(false, "example “" + ex.title + "” runs", String((e as Error).message).slice(0, 200)); continue; }
  (result.views as View[]).forEach((v, i) => {
    const label = "“" + ex.title + "” view " + (i + 1) + " (" + v.kind + ")";
    if (v.error) return;   // an errored view has nothing to record; the docs gate owns errors
    if (!v.method) {
      if (EXEMPT[v.kind]) return;
      report(false, label + " has a method record", "no record, and " + v.kind + " is not on the exempt list");
      return;
    }
    if (!v.method.python) return;   // the queries' counts are the numbers
    if (!v.method.check || !Object.keys(v.method.check).length) { report(false, label + " says what its script must reproduce", "no check values"); return; }
    jobs.push({ label, view: v });
  });
}

let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { label, view } = jobs[next++];
    const dir = mkdtempSync(join(tmpdir(), "method-check-"));
    try {
      writeFileSync(join(dir, "script.py"), view.method!.python!);
      const why = await materialize(view, dir);
      if (why) { report(false, label + " script runs", why); continue; }
      const r = await runPython(dir);
      const line = r.out.split("\n").reverse().find((l) => l.startsWith(RESULT_MARKER));
      if (r.code !== 0 || !line) { report(false, label + " script runs", "exit " + r.code + ": " + r.err.trim().split("\n").slice(-3).join(" | ").slice(0, 300)); continue; }
      const bad = compare(view.method!.check, JSON.parse(line.slice(RESULT_MARKER.length)));
      report(!bad.length, label + " script reproduces the view",
        bad.length ? bad.slice(0, 3).join("; ") + (bad.length > 3 ? " … and " + (bad.length - 3) + " more" : "")
          : Object.keys(view.method!.check!).length + " numbers · " + Math.round(r.ms / 1000) + "s");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));

console.log(failed ? "\n" + failed + " method check(s) FAILED" : "\nall method records present and every script reproduces its view");
process.exit(failed ? 1 : 0);
