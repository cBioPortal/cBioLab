// Doc-sync gate, run by `npm run docs:check` and by e2e.cjs:
//   1. docs/dsl.md must equal a fresh regeneration from lib/dsl-reference.js
//      (fail => someone edited the doc by hand, or changed the reference
//      without running `npm run docs:gen`).
//   2. Every example in the reference is executed against the live compiler
//      via runAnalysis — a broken example (DSL drift) fails the check.
// Needs DB credentials in the environment: run with `node --env-file=.env.local`.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { renderDslMarkdown, EXAMPLES } from "../lib/dsl-reference.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const report = (ok, label, extra = "") =>
  console.log((ok ? "PASS" : "FAIL") + " " + label + (extra ? "  [" + extra + "]" : ""));

// 1. committed doc matches the reference
const committed = readFileSync(join(root, "docs", "dsl.md"), "utf8");
const fresh = renderDslMarkdown();
if (committed === fresh) report(true, "docs/dsl.md matches lib/dsl-reference.js");
else { failed++; report(false, "docs/dsl.md is stale — run `npm run docs:gen` and commit the result"); }

// 2. every documented example runs
const { runAnalysis } = await import("../lib/analysis.js");
for (const ex of EXAMPLES) {
  try {
    const r = await runAnalysis(ex.doc);
    const bad = Object.entries(r.cohorts).filter(([, c]) => !c.count).map(([n]) => n);
    const viewErr = r.views.find(v => v.error);
    if (bad.length) { failed++; report(false, "example “" + ex.title + "”: empty cohort(s) " + bad.join(", ")); }
    else if (viewErr) { failed++; report(false, "example “" + ex.title + "”: view error: " + viewErr.error); }
    else report(true, "example “" + ex.title + "” runs",
      Object.entries(r.cohorts).map(([n, c]) => n + "=" + c.count.toLocaleString("en-US")).join(", ") + " · " + r.stats.ms + "ms");
  } catch (e) {
    failed++; report(false, "example “" + ex.title + "”: " + String(e.message || e));
  }
}

process.exit(failed ? 1 : 0);
