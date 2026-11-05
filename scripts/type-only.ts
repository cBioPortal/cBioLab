// Whether a TypeScript file holds only types: nothing is left once its types and comments are
// stripped. Such a file never runs, so no test can load it, and the coverage report and rules
// (scripts/report-coverage.ts, scripts/check-coverage.ts) leave it out.
import { stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

export function isTypeOnly(path: string): boolean {
  let code: string;
  try { code = stripTypeScriptTypes(readFileSync(path, "utf8")); } catch { return false; }
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\bexport\s*\{\s*\}\s*;?/g, "").trim() === "";
}
