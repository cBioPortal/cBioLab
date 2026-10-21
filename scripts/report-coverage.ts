// Unit-test coverage, run by `npm run report:coverage` (report-only, in CI's reports job): runs
// `npm test`'s suites under node's built-in coverage and writes quality-report/coverage.lcov and
// quality-report/coverage.md, which CI also shows as the job summary.
//
// Two things node's own numbers hide, so the report says them: a file no test imports is left out
// of node's totals altogether (listed here as "never loaded"), and node counts comment and
// type-only lines as covered lines, so branch and function coverage are the honest columns. The
// database-backed checks (docs:check, check:methods, check:portal, the e2e suites) cover much of
// lib/views and app/ and are not measured here.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const outDir = join(root, "quality-report");
mkdirSync(outDir, { recursive: true });
const lcovPath = join(outDir, "coverage.lcov");
const AREAS = ["lib", "app", "mcp"];

const run = spawnSync(process.execPath, [
  "--test", "--experimental-test-coverage",
  ...AREAS.map((a) => "--test-coverage-include=" + a + "/**"),
  "--test-reporter=dot", "--test-reporter-destination=stdout",
  "--test-reporter=lcov", "--test-reporter-destination=" + lcovPath,
  "test/**/*.test.ts",
], { cwd: root, stdio: ["ignore", "inherit", "inherit"] });

interface Counts { LF: number; LH: number; BRF: number; BRH: number; FNF: number; FNH: number }
const zero = (): Counts => ({ LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 });
const files = new Map<string, Counts>();
let cur: Counts | null = null;
for (const line of readFileSync(lcovPath, "utf8").split("\n")) {
  if (line.startsWith("SF:")) { cur = zero(); files.set(relative(root, line.slice(3)), cur); continue; }
  const [k, v] = line.split(":");
  if (cur && k in cur) cur[k as keyof Counts] = Number(v);
}

const pct = (hit: number, found: number) => found ? (100 * hit / found).toFixed(1) + "%" : "–";
const sum = (fs: Counts[]) => fs.reduce((t, c) => { for (const k of Object.keys(t) as (keyof Counts)[]) t[k] += c[k]; return t; }, zero());
const row = (name: string, c: Counts, extra = "") => "| " + name + " | " + pct(c.LH, c.LF) + " | " + pct(c.BRH, c.BRF) + " | " + pct(c.FNH, c.FNF) + " |" + extra;

const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts") ? [join(dir, e.name)] : []);

const md: string[] = ["## Unit-test coverage", "",
  run.status === 0 ? "" : "**The unit tests failed (exit " + run.status + "); these numbers are from a failing run.**", "",
  "Node counts comment and type-only lines as lines, so branches and functions are the honest columns. Files no unit test loads are not in node's totals; they are counted apart.", "",
  "| area | lines | branches | functions | files loaded |", "|---|---|---|---|---|"];
const neverLoaded: string[] = [];
for (const area of [...AREAS, "lib/views", "lib/figures"]) {
  const all = walk(area);
  const loaded = all.filter((f) => files.has(f));
  if (AREAS.includes(area)) neverLoaded.push(...all.filter((f) => !files.has(f)));
  md.push(row(area, sum(loaded.map((f) => files.get(f)!)), " " + loaded.length + " of " + all.length + " |"));
}
const libFiles = [...files].filter(([f, c]) => f.startsWith("lib/") && c.BRF + c.FNF > 0);
const weakest = libFiles.sort(([, a], [, b]) => a.BRH / Math.max(1, a.BRF) - b.BRH / Math.max(1, b.BRF)).slice(0, 20);
md.push("", "### Least-covered lib modules, by branches", "", "| module | lines | branches | functions |", "|---|---|---|---|",
  ...weakest.map(([f, c]) => row(f, c)));
md.push("", "### Never loaded by a unit test (" + neverLoaded.filter((f) => f.startsWith("lib/")).length + " in lib/)", "",
  ...neverLoaded.filter((f) => f.startsWith("lib/")).map((f) => "- " + f),
  "", neverLoaded.filter((f) => !f.startsWith("lib/")).length + " more in app/ and mcp/ (the pages, covered by the e2e suites).");

const report = md.join("\n") + "\n";
writeFileSync(join(outDir, "coverage.md"), report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log("\n" + report);
