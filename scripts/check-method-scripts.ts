// Method-record gate, run by `npm run check:methods` and, sharing one run of the examples with
// docs:check, by `npm run check:examples` (scripts/gate.sh):
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
import { methodFiles } from "../lib/method-data.ts";
import { PYTHON_PINS } from "../lib/method-notebook.ts";
import type { ViewResult } from "../lib/types.ts";
import { RESULT_MARKER, type MethodRecord } from "../lib/method.ts";
import { runExamples, isMain, type ExampleRun } from "./examples-run.ts";
import { PREVIEW_KINDS } from "../lib/preview-kinds.ts";

/** View kinds without a method record yet, and why. Shrink this list; never grow it quietly. */
const EXEMPT: Record<string, string> = {
  oncoprint: "a picture of alterations per patient: nothing is computed beyond the counts its own provenance page shows",
  hotspots: "a lollipop of mutation counts per position: no statistic",
  plot: "a scatter/density plot of two axes: no statistic",
  // preview kinds carry their Preview badge until their record lands (lib/preview-kinds.ts)
  ...Object.fromEntries(Object.entries(PREVIEW_KINDS).map(([k, why]) => [k, "preview: " + why])),
};

/** The Python environment the scripts are checked in — the versions the golden fixtures pin. */
const PINS = Object.entries(PYTHON_PINS).map(([pkg, version]) => pkg + "==" + version);
const PARALLEL = 4;

let failed = 0;
const report = (ok: boolean, label: string, extra = "") => {
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + " " + label + (extra ? "  [" + extra + "]" : ""));
};

type View = { kind: string; error?: string; method?: MethodRecord; queries?: { study: string; label: string; sql: string }[]; cohorts?: string[] };

/** The files a script reads that are not embedded in it, built from the view's own queries. */
async function materialize(v: View, dir: string): Promise<string | null> {
  let built;
  try { built = await methodFiles(v as unknown as ViewResult); }
  catch (e) { return (e as Error).message; }
  const { files, missing } = built;
  for (const [name, csv] of Object.entries(files)) writeFileSync(join(dir, name), csv);
  return missing.length ? "reads " + missing.join(", ") + ", which this check cannot build for a " + v.kind + " view" : null;
}

function runPython(dir: string): Promise<{ code: number | null; out: string; err: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = ["run", "--no-project", "--quiet", ...PINS.flatMap((p) => ["--with", p]), "python", "script.py"];
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

/** Reports every check above for these runs of the examples; answers how many failed. */
export async function checkMethods(runs: ExampleRun[]): Promise<number> {
  failed = 0;
  try { execSync("uv --version", { stdio: "ignore" }); }
  catch { report(false, "uv is not on the PATH — the method scripts cannot be run"); return failed; }
  const jobs: Job[] = [];
  for (const { ex, result, error } of runs) {
    if (!result) { report(false, "example “" + ex.title + "” runs", String(error).slice(0, 200)); continue; }
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
  return failed;
}

// METHOD_CHECK_ONLY=<text> runs just the examples whose title contains it, while iterating
const only = process.env.METHOD_CHECK_ONLY;
if (isMain(import.meta.url)) process.exit(await checkMethods(await runExamples(EXAMPLES.filter((e) => !only || e.title.includes(only)))) ? 1 : 0);
