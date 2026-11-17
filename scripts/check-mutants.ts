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
 * The bugs live in scripts/mutants/, one file per area (scripts/mutants/types.ts gives their shape):
 * a change adds its bugs to its own area's file, so pull requests never edit one shared list.
 * With MUTANT_CHANGED set to a file listing changed paths, one per line (a pull request's diff, as CI
 * gives it), only the bugs that diff could affect are planted: those in a changed file, those whose
 * guard's own files changed, and those an edited area file defines or guards. A diff that touches
 * this script, scripts/mutants/types.ts, the workflow or the dependencies plants every bug, as does
 * a run without MUTANT_CHANGED (master, the merge queue, and locally).
 * With RECORD=1 (npm run verify) it writes docs/verification/mutants.json, which /verification reads
 * (or REPORT_DIR/mutants.json when REPORT_DIR is set, as in CI).
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { GuardCommands, Mutant } from "./mutants/types.ts";

const ROOT = new URL("..", import.meta.url).pathname;
/** the report's folder: docs/verification/ (what the page shows), or REPORT_DIR (what CI uploads) */
const OUT = join(process.env.REPORT_DIR || join(ROOT, "docs/verification"), "mutants.json");

/** the guards every area may use; an area file defines any other guard its bugs need */
const CORE_GUARDS: GuardCommands = {
  "unit": ["npm", "test"],
  "cohort-logic": ["node", "--env-file=.env.local", "scripts/check-cohort-logic.ts"],
  "portal-parity": ["node", "--env-file=.env.local", "scripts/check-portal-parity.ts"],
};

/** a planted bug and the area file that defines it */
type Planted = Mutant & { source: string };

/**
 * Every scripts/mutants/<area>.ts but types.ts: its `guards` and its `mutants`. One file per area,
 * so a pull request adds its bugs beside its own and never edits a list another one edits. A
 * duplicate id, a guard defined twice or a bug naming no defined guard stops the run here.
 */
const MUTANT_DIR = join(ROOT, "scripts", "mutants");
const GUARD_CMD: GuardCommands = { ...CORE_GUARDS };
const GUARD_SOURCE: Record<string, string> = {};
const MUTANTS: Planted[] = [];
for (const f of readdirSync(MUTANT_DIR).filter((n) => n.endsWith(".ts") && n !== "types.ts").sort()) {
  const source = "scripts/mutants/" + f;
  const area = await import(pathToFileURL(join(MUTANT_DIR, f)).href) as { guards?: GuardCommands; mutants?: Mutant[] };
  if (!Array.isArray(area.mutants)) throw new Error(source + " exports no `mutants` array");
  for (const [g, cmd] of Object.entries(area.guards || {})) {
    if (GUARD_CMD[g]) throw new Error(`guard "${g}" is defined twice: in ${source} and ${GUARD_SOURCE[g] || "scripts/check-mutants.ts"}`);
    GUARD_CMD[g] = cmd;
    GUARD_SOURCE[g] = source;
  }
  for (const m of area.mutants) MUTANTS.push({ ...m, source });
}
{
  const seen = new Map<string, string>();
  for (const m of MUTANTS) {
    if (seen.has(m.id)) throw new Error(`planted bug id "${m.id}" is used twice: in ${seen.get(m.id)} and ${m.source}`);
    seen.set(m.id, m.source);
    if (!GUARD_CMD[m.guard]) throw new Error(`${m.id} (${m.source}) names guard "${m.guard}", which no file defines; defined: ${Object.keys(GUARD_CMD).join(", ")}`);
  }
}

/**
 * The unit suites that import `file` themselves: what a planted bug there runs against, rather than
 * all of `npm test` (the baseline runs all of it). A bug only a suite further away would catch
 * shows as SURVIVED, a failure, never as a pass.
 */
function suitesImporting(dir: string, file: string): string[] {
  // a static import, or a dynamic one: a suite that sets the environment before loading the module awaits import()
  const imports = new RegExp("(from |import\\()\"(\\.\\./)+" + file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"");
  const suites = readdirSync(join(dir, "test")).filter((f) => f.endsWith(".test.ts"))
    .filter((f) => imports.test(readFileSync(join(dir, "test", f), "utf8"))).map((f) => "test/" + f);
  // `node --test` given no files runs every suite, which would hide that none guards this one
  if (!suites.length) throw new Error("no unit suite imports " + file + "; give its planted bugs another guard");
  return suites;
}

function run(dir: string, guard: string, file?: string): { ok: boolean; failures: number; firstFailure: string } {
  const [cmd, ...args] = guard === "unit" && file ? ["node", "--test", ...suitesImporting(dir, file)] : GUARD_CMD[guard];
  // a guard run against a planted bug must never write a report; the portal's answers are kept
  // between runs (PORTAL_CACHE in check-portal-parity.ts), since a planted bug cannot change them,
  // and so are the warehouse's (CH_RUN_CACHE in lib/ch.ts): a bug that changes a statement asks
  // the warehouse anew, and one that changes only what is done with the answer gets the same answer.
  // Never the unit guard's: its tests answer statements with stubs, which would be kept as the warehouse's.
  const { RECORD, REPORT_DIR, CH_RUN_CACHE, ...rest } = process.env;
  const env = { ...rest, PORTAL_CACHE: process.env.PORTAL_CACHE || join(dir, ".portal-cache"),
    ...(guard === "unit" ? {} : { CH_RUN_CACHE: CH_RUN_CACHE || join(dir, ".ch-cache") }) };
  const r = spawnSync(cmd, args, { cwd: dir, env, encoding: "utf8", maxBuffer: 64 << 20, timeout: 600_000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const fail = lines.find((l) => /^FAIL |^not ok /.test(l) && !/ # (TODO|SKIP)\b/.test(l))
    || (r.status !== 0 ? "stopped with an error: " + (lines.find((l) => /Error/.test(l)) || lines[lines.length - 1] || "") : "");
  const unitFails = Number(lines.find((l) => /^# fail \d+/.test(l))?.slice(7) || 0);
  const failures = unitFails || lines.filter((l) => /^FAIL /.test(l)).length;
  return { ok: r.status === 0, failures, firstFailure: fail.slice(0, 240) };
}

// --list: the bugs each area file defines, once the checks above pass; nothing is planted or run
if (process.argv.includes("--list")) {
  const per = new Map<string, number>();
  for (const m of MUTANTS) per.set(m.source, (per.get(m.source) || 0) + 1);
  for (const [source, n] of per) console.log(`${String(n).padStart(4)}  ${source}`);
  console.log(`${MUTANTS.length} planted bugs, ${Object.keys(GUARD_CMD).length} guards`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "cohort-lab-mutants-"));
const ONLY = process.env.MUTANT_ONLY;

/**
 * A change to any of these can change every planted bug's outcome. An area file is not among them:
 * a diff that adds or edits scripts/mutants/<area>.ts plants that file's bugs, and the bugs that
 * use a guard it defines.
 */
const PLANT_ALL_ON = ["scripts/check-mutants.ts", "scripts/mutants/types.ts", ".github/workflows/verify.yml", "package.json", "package-lock.json"];

/** the files a guard runs from: its script, or for the unit guard the suites that import the bug's file */
function guardFiles(m: Planted): string[] {
  if (m.guard !== "unit") return GUARD_CMD[m.guard].filter((a) => a.startsWith("scripts/"));
  // a bug no suite imports is reported, with every other unplantable one, before any guard runs
  try { return suitesImporting(ROOT, m.file); } catch { return []; }
}

/** the bugs to plant, and why: all of them, or those MUTANT_CHANGED's diff could affect */
function selection(): { mutants: Planted[]; changed: number | null; reason: string } {
  const list = process.env.MUTANT_CHANGED;
  if (!list) return { mutants: MUTANTS, changed: null, reason: "every bug (no MUTANT_CHANGED)" };
  const changed = new Set(readFileSync(list, "utf8").split("\n").map((l) => l.trim()).filter(Boolean));
  const all = PLANT_ALL_ON.filter((f) => changed.has(f));
  if (all.length) return { mutants: MUTANTS, changed: changed.size, reason: "every bug (the diff changes " + all.join(", ") + ")" };
  const mutants = MUTANTS.filter((m) => changed.has(m.file) || changed.has(m.source)
    || (GUARD_SOURCE[m.guard] != null && changed.has(GUARD_SOURCE[m.guard])) || guardFiles(m).some((f) => changed.has(f)));
  return { mutants, changed: changed.size, reason: "the bugs in, or guarded by, the " + changed.size + " changed files" };
}
/** every planted bug run against its guard in the copy at `dir`; the exit code */
function plantAll(): number {
  const SKIP = new Set(["node_modules", ".git", ".next", ".next-gate", ".gate-cache", ".venv"]);
  cpSync(ROOT, dir, { recursive: true, filter: (src) => !SKIP.has(src.split("/").pop()!) });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, "docs/verification"), { recursive: true });
  mkdirSync(join(dir, ".ch-cache"));

  const sel = selection();
  const planted = sel.mutants.filter((m) => !ONLY || m.id === ONLY);
  console.log(`Planting ${planted.length} of ${MUTANTS.length} bugs: ${sel.reason}`);
  if (!planted.length) console.log("No planted bug is in, or guarded by, a changed file: nothing to plant.");

  // what can be known without running anything is checked before the guards' baselines, which take minutes
  const unplantable = planted.flatMap((m) => {
    const hits = readFileSync(join(dir, m.file), "utf8").split(m.find).length - 1;
    const site = hits === 1 ? [] : [`${m.id}: expected the bug's site exactly once in ${m.file}, found ${hits}`];
    if (m.guard !== "unit") return site;
    try { suitesImporting(dir, m.file); return site; } catch (e) { return [...site, `${m.id}: ${(e as Error).message}`]; }
  });
  if (unplantable.length) {
    for (const u of unplantable) console.log("FAIL " + u);
    return 1;
  }

  const guards = [...new Set(planted.map((m) => m.guard))];
  for (const g of guards) {
    const base = run(dir, g);
    console.log(`${base.ok ? "PASS" : "FAIL"} baseline: ${g} passes on the unmodified code`);
    if (!base.ok) { console.log("  " + base.firstFailure); return 1; }
  }

  const results = [];
  for (const m of planted) {
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
    ...(sel.changed == null ? {} : { selection: { changedFiles: sel.changed, of: MUTANTS.length, reason: sel.reason } }),
    mutants: results,
  }, null, 1) + "\n");
  console.log(`\n${caught} of ${results.length} planted bugs caught`);
  return caught === results.length ? 0 : 1;
}

// the copy is removed before exiting: process.exit() inside the try would skip the finally
let exitCode: number;
try {
  exitCode = plantAll();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(exitCode);
