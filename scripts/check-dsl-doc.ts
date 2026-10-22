// Doc-sync gate, run by `npm run docs:check` and, sharing one run of the examples with
// check:methods, by `npm run check:examples` (scripts/gate.sh):
//   1. docs/dsl.md must equal a fresh regeneration from lib/dsl-reference.ts
//      (fail => someone edited the doc by hand, or changed the reference
//      without running `npm run docs:gen`).
//   2. Every example in the reference is executed against the live compiler
//      via runAnalysis — a broken example (DSL drift) fails the check.
//   3. Every example's cohort counts must equal the numbers pinned in
//      test/fixtures/example-counts.json. Running is not the same as being
//      right: a semantic regression that halves a cohort still "runs".
//      `npm run docs:counts` re-pins them after an intentional change.
// Needs DB credentials in the environment: run with `node --env-file=.env.local`.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { renderDslMarkdown, EXAMPLES } from "../lib/dsl-reference.ts";
import { runExamples, isMain, type ExampleRun } from "./examples-run.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = (ok: boolean, label: string, extra = "") =>
  console.log((ok ? "PASS" : "FAIL") + " " + label + (extra ? "  [" + extra + "]" : ""));
const n = (x: number) => x.toLocaleString("en-US");

/**
 * The expected answer for every documented example, per cohort. Pinned against a fixed
 * warehouse snapshot and a fixed annotation version, both recorded here so a legitimate
 * move (a study reload, a new OncoKB pin) is distinguishable from a regression.
 */
interface Pins { note?: string; oncokbPin?: string | null; generated?: string; examples: Record<string, Record<string, number>> }

/** Reports every check above for these runs of EXAMPLES; answers how many failed. */
export function checkDocs(runs: ExampleRun[]): number {
  let failed = 0;
  // 1. committed doc matches the reference
  const committed = readFileSync(join(root, "docs", "dsl.md"), "utf8");
  const fresh = renderDslMarkdown();
  if (committed === fresh) report(true, "docs/dsl.md matches lib/dsl-reference.ts");
  else { failed++; report(false, "docs/dsl.md is stale — run `npm run docs:gen` and commit the result"); }

  // ---- pinned cohort counts -------------------------------------------------
  const PINS_PATH = join(root, "test", "fixtures", "example-counts.json");
  const UPDATE = !!process.env.UPDATE_COUNTS;
  const pins: Pins = existsSync(PINS_PATH) ? JSON.parse(readFileSync(PINS_PATH, "utf8")) : { examples: {} };
  const fresh_pins: Record<string, Record<string, number>> = {};
  const pinnedFrom: string | null | undefined = pins.oncokbPin;
  let runPin: string | null = null;

  // 2 + 3. every documented example runs, and gives the same answer as last time
  for (const { ex, result: r, error } of runs) {
    try {
      if (!r) throw new Error(error);
      runPin = r.oncokbPin;
      // A partition's child may honestly be empty (nobody unprofiled for the gene); an authored
      // cohort may not. Every partition must add up to its parent.
      const children = new Set(Object.values(r.splits || {}).flatMap((p) => p.children.map((c) => c.name)));
      const bad = Object.entries(r.cohorts).filter(([nm, c]) => !c.count && !children.has(nm)).map(([nm]) => nm);
      const leaky = Object.entries(r.splits || {}).filter(([, p]) => !p.conserved)
        .map(([nm, p]) => nm + " (" + n(p.sum) + " of " + n(p.parentCount) + ")");
      const viewErr = r.views.find(v => v.error);
      const actual: Record<string, number> = {};
      for (const [nm, c] of Object.entries(r.cohorts)) actual[nm] = c.count;
      fresh_pins[ex.title] = actual;
      const shown = Object.entries(actual).map(([nm, c]) => nm + "=" + n(c)).join(", ") + " · " + r.stats.ms + "ms";

      if (bad.length) { failed++; report(false, "example “" + ex.title + "”: empty cohort(s) " + bad.join(", ")); continue; }
      if (viewErr) { failed++; report(false, "example “" + ex.title + "”: view error: " + viewErr.error); continue; }
      if (leaky.length) { failed++; report(false, "example “" + ex.title + "”: partition children do not add up: " + leaky.join(", ")); continue; }
      if (UPDATE) { report(true, "example “" + ex.title + "” pinned", shown); continue; }

      const want = pins.examples[ex.title];
      if (!want) {
        failed++;
        report(false, "example “" + ex.title + "” has no pinned counts — review " + shown + ", then `npm run docs:counts`");
        continue;
      }
      // a renamed cohort is as much a change of answer as a different number
      const names = [...new Set([...Object.keys(want), ...Object.keys(actual)])].sort();
      const diffs = names.filter((nm) => want[nm] !== actual[nm]).map((nm) =>
        nm + " " + (want[nm] === undefined ? "(not pinned)" : n(want[nm])) + " → " +
        (actual[nm] === undefined ? "(gone)" : n(actual[nm])) +
        (want[nm] !== undefined && actual[nm] !== undefined
          ? " (" + (actual[nm] > want[nm] ? "+" : "") + n(actual[nm] - want[nm]) + ")" : ""));
      if (diffs.length) {
        failed++;
        const pinNote = pinnedFrom !== undefined && pinnedFrom !== r.oncokbPin
          ? " · annotation pin moved " + (pinnedFrom ?? "none") + " → " + (r.oncokbPin ?? "none") : "";
        report(false, "example “" + ex.title + "” gives a different answer: " + diffs.join("; ") + pinNote +
          " — if this is intended, `npm run docs:counts`");
      } else report(true, "example “" + ex.title + "” runs", shown);
    } catch (e) {
      failed++; report(false, "example “" + ex.title + "”: " + String((e as Error)?.message || e));
    }
  }

  // pins for examples that no longer exist are dead weight, and hide a rename
  const stale = Object.keys(pins.examples).filter((t) => !EXAMPLES.some((e) => e.title === t));
  if (UPDATE) {
    const out: Pins = {
      note: "Expected cohort counts for every example in lib/dsl-reference.ts, asserted by npm run docs:check. " +
        "Regenerate with `npm run docs:counts` ONLY after reviewing why a number moved.",
      oncokbPin: runPin, generated: new Date().toISOString().slice(0, 10),
      examples: Object.fromEntries(EXAMPLES.filter((e) => fresh_pins[e.title]).map((e) => [e.title, fresh_pins[e.title]]))
    };
    writeFileSync(PINS_PATH, JSON.stringify(out, null, 2) + "\n");
    report(true, "pinned counts written", Object.keys(out.examples).length + " examples · pin " + (runPin ?? "none") +
      (stale.length ? " · dropped " + stale.length + " stale" : ""));
  } else if (stale.length) {
    failed++;
    report(false, "pinned counts for examples that no longer exist: " + stale.join(", ") + " — `npm run docs:counts`");
  }

  return failed;
}

if (isMain(import.meta.url)) process.exit(checkDocs(await runExamples()) ? 1 : 0);
