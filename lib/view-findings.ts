// Each view result's findings (lib/findings.ts), from its kind's descriptor or, for a kind that names
// none, from its method record's checks. Attached to every result by lib/analysis.ts. Browser-safe.
import { isDrawn, type ViewResult } from "./types.ts";
import { kindOf } from "./views/kinds.ts";
import { FINDINGS_VERSION, checkFindings, type ViewFindings } from "./findings.ts";

/** null for a result with nothing to report: an error, a view waiting for cohorts, or no numbers at all */
export function viewFindings(v: ViewResult): ViewFindings | null {
  if (!isDrawn(v)) return null;
  const own = kindOf(v.kind)?.findings;
  const findings = own ? own(v) : checkFindings(v);
  if (!findings.length) return null;
  return { version: FINDINGS_VERSION, kind: v.kind, source: own ? "kind" : "method-check", findings, ...(v.caveat ? { caveat: v.caveat } : {}) };
}
