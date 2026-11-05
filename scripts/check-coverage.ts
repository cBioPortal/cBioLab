// The unit-test coverage rules, run after `npm run report:coverage` (which writes the lcov this reads):
// `npm run check:coverage`. Fails on any of:
//
// 1. Changed lines poorly covered. Of the lines in lib/ and mcp/ changed since the merge base with
//    COVERAGE_BASE (default origin/master; the working tree counts), at least PATCH_LINES% of the
//    executable ones and PATCH_BRANCHES% of the branches on them must run under `npm test`. A patch
//    with fewer than MIN_COUNTED of either is too small to hold to a percentage.
// 2. A new file in lib/ or mcp/ that no unit test loads. Node leaves such a file out of its totals
//    altogether, so it would never show up in rule 1.
// 3. An area's branch or function coverage below its floor in test/fixtures/coverage-floor.json, by
//    more than FLOOR_SLACK points. UPDATE_COVERAGE_FLOOR=1 rewrites the floors from this run, which
//    the change then shows: raise them when coverage rises; lowering one is a decision for review.
//
// Node counts comment and type-only lines as covered lines, so line percentages read high; the
// branch rule is the stricter one. Generated data (a kind's doc.ts) is left out of rule 1.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const lcovPath = join(root, "quality-report", "coverage.lcov");
const floorPath = join(root, "test", "fixtures", "coverage-floor.json");
const PATCH_LINES = 80, PATCH_BRANCHES = 70, MIN_COUNTED = 10, FLOOR_SLACK = 0.25;
const PATCH_SCOPE = (f: string) => /^(lib|mcp)\/.*\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !/^lib\/views\/[^/]+\/doc\.ts$/.test(f);
const AREAS = ["lib", "app", "mcp"];

if (!existsSync(lcovPath)) { console.error("no " + relative(root, lcovPath) + ": run `npm run report:coverage` first"); process.exit(2); }

interface FileCov { lines: Map<number, number>; branches: Map<number, number[]>; BRF: number; BRH: number; FNF: number; FNH: number }
const cov = new Map<string, FileCov>();
let cur: FileCov | null = null;
for (const line of readFileSync(lcovPath, "utf8").split("\n")) {
  if (line.startsWith("SF:")) {
    cur = { lines: new Map(), branches: new Map(), BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
    cov.set(relative(root, join(root, line.slice(3))), cur);
  } else if (!cur) continue;
  else if (line.startsWith("DA:")) { const [n, c] = line.slice(3).split(",").map(Number); cur.lines.set(n, c); }
  else if (line.startsWith("BRDA:")) {
    const [n, , , c] = line.slice(5).split(",");
    cur.branches.set(Number(n), [...(cur.branches.get(Number(n)) ?? []), c === "-" ? 0 : Number(c)]);
  } else {
    const [k, v] = line.split(":");
    if (k === "BRF" || k === "BRH" || k === "FNF" || k === "FNH") cur[k] = Number(v);
  }
}

const out: string[] = ["## Coverage rules", ""];
const failures: string[] = [];
const pct = (h: number, n: number) => n ? 100 * h / n : 100;
const fmt = (x: number) => x.toFixed(1) + "%";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 << 20 });

// 1 and 2: the patch
const base = process.env.COVERAGE_BASE || "origin/master";
let mergeBase = "";
try { mergeBase = git("merge-base", "HEAD", base).trim(); } catch { out.push("No merge base with " + base + "; the patch rules are skipped.", ""); }
if (mergeBase) {
  const changed = new Map<string, Set<number>>();
  let file = "";
  for (const l of git("diff", "-U0", "--no-color", "--no-ext-diff", mergeBase, "--", "lib", "mcp").split("\n")) {
    if (l.startsWith("+++ ")) { file = l.startsWith("+++ b/") ? l.slice(6) : ""; continue; }
    const m = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (!m || !file || !PATCH_SCOPE(file)) continue;
    const start = Number(m[1]), n = m[2] === undefined ? 1 : Number(m[2]);
    const set = changed.get(file) ?? new Set<number>();
    for (let i = start; i < start + n; i++) set.add(i);
    changed.set(file, set);
  }
  const added = new Set(git("diff", "--name-only", "--diff-filter=A", mergeBase, "--", "lib", "mcp").split("\n").filter(PATCH_SCOPE));
  for (const f of git("ls-files", "--others", "--exclude-standard", "--", "lib", "mcp").split("\n").filter(PATCH_SCOPE)) {
    added.add(f);
    changed.set(f, new Set(readFileSync(join(root, f), "utf8").split("\n").map((_, i) => i + 1)));
  }

  let lh = 0, ln = 0, bh = 0, bn = 0;
  const rows: string[] = [], unloadedNew: string[] = [], unloadedOld: string[] = [];
  for (const [f, set] of [...changed].sort()) {
    const c = cov.get(f);
    if (!c) { (added.has(f) ? unloadedNew : unloadedOld).push(f); continue; }
    let flh = 0, fln = 0, fbh = 0, fbn = 0;
    const missed: number[] = [];
    for (const n of set) {
      const hits = c.lines.get(n);
      if (hits !== undefined) { fln++; if (hits > 0) flh++; else missed.push(n); }
      for (const b of c.branches.get(n) ?? []) { fbn++; if (b > 0) fbh++; }
    }
    lh += flh; ln += fln; bh += fbh; bn += fbn;
    if (fln) rows.push("| " + f + " | " + flh + "/" + fln + " | " + fbh + "/" + fbn + " | " + ranges(missed) + " |");
  }
  out.push("### Changed lines (lib/, mcp/) since " + base + " (" + mergeBase.slice(0, 9) + ")", "",
    "Lines " + lh + "/" + ln + " (" + fmt(pct(lh, ln)) + ", needs " + PATCH_LINES + "%), branches " + bh + "/" + bn + " (" + fmt(pct(bh, bn)) + ", needs " + PATCH_BRANCHES + "%).", "");
  if (ln >= MIN_COUNTED && pct(lh, ln) < PATCH_LINES) failures.push("changed lines covered " + fmt(pct(lh, ln)) + " < " + PATCH_LINES + "%");
  if (bn >= MIN_COUNTED && pct(bh, bn) < PATCH_BRANCHES) failures.push("branches on changed lines covered " + fmt(pct(bh, bn)) + " < " + PATCH_BRANCHES + "%");
  if (rows.length) out.push("| file | lines | branches | changed lines not run |", "|---|---|---|---|", ...rows, "");
  for (const f of unloadedNew) failures.push("new file " + f + " is loaded by no unit test");
  if (unloadedOld.length) out.push("Changed, but loaded by no unit test (existing files, not counted): " + unloadedOld.join(", "), "");
}

// 3: the floors
const areaTotals = Object.fromEntries(AREAS.map((a) => {
  const t = { BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
  for (const [f, c] of cov) if (f.startsWith(a + "/")) { t.BRF += c.BRF; t.BRH += c.BRH; t.FNF += c.FNF; t.FNH += c.FNH; }
  return [a, { branches: Number(pct(t.BRH, t.BRF).toFixed(2)), functions: Number(pct(t.FNH, t.FNF).toFixed(2)) }];
}));
if (process.env.UPDATE_COVERAGE_FLOOR) {
  writeFileSync(floorPath, JSON.stringify(areaTotals, null, 2) + "\n");
  out.push("Floors rewritten in " + relative(root, floorPath) + ".", "");
}
const floors = existsSync(floorPath) ? JSON.parse(readFileSync(floorPath, "utf8")) as typeof areaTotals : {};
out.push("### Floors", "", "| area | branches | floor | functions | floor |", "|---|---|---|---|---|");
for (const a of AREAS) {
  const now = areaTotals[a], fl = floors[a];
  out.push("| " + a + " | " + fmt(now.branches) + " | " + (fl ? fmt(fl.branches) : "–") + " | " + fmt(now.functions) + " | " + (fl ? fmt(fl.functions) : "–") + " |");
  if (!fl) { failures.push("no floor for " + a + " in " + relative(root, floorPath)); continue; }
  for (const m of ["branches", "functions"] as const)
    if (now[m] < fl[m] - FLOOR_SLACK) failures.push(a + " " + m + " coverage " + fmt(now[m]) + " fell below its floor " + fmt(fl[m]));
}
const risen = AREAS.filter((a) => floors[a] && (areaTotals[a].branches > floors[a].branches + 1 || areaTotals[a].functions > floors[a].functions + 1));
if (risen.length) out.push("", "Coverage of " + risen.join(", ") + " is a point or more above its floor: raise it with `UPDATE_COVERAGE_FLOOR=1 npm run check:coverage`.");

out.push("", failures.length ? "**Failed:**\n" + failures.map((f) => "- " + f).join("\n") : "**Passed.**", "");
const report = out.join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report);
process.exit(failures.length ? 1 : 0);

/** 3,4,5,9 → "3–5, 9" */
function ranges(ns: number[]): string {
  const s = [...ns].sort((a, b) => a - b), r: string[] = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    r.push(j > i ? s[i] + "–" + s[j] : String(s[i]));
    i = j + 1;
  }
  return r.length > 12 ? r.slice(0, 12).join(", ") + ", …" : r.join(", ");
}
