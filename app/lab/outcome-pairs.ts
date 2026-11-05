// The outcomes a survival or incidence card can offer beyond the study's own <X>_MONTHS/<X>_STATUS:
// an upload's time and status columns, found by their names, and any two columns chosen by hand.
// Pure: the cards (app/lab/outcome-choice.tsx) read and write the view through these.
import { parseCustomAttr, attributeLabel } from "../../lib/custom-data-names.ts";

export interface OutcomePair {
  /** the endpoint's name: the columns' shared prefix, as `endpoint` takes it */
  name: string;
  months: string;
  status: string;
  label: string;
}

/** time columns an upload names <X>_TIME or <X>_MONTHS */
const TIME_RE = /^(.+?)_(TIME|MONTHS)$/;

/** a status column's suffix after the shared prefix: what a survival curve reads, and what incidence reads */
export const SURVIVAL_STATUS = ["EVENT", "STATUS", "EVENT_CAUSE_SPECIFIC"] as const;
export const COMPETING_STATUS = ["EVENTCR", "EVENT_CR"] as const;

/**
 * An upload's outcome pairs: a <X>_TIME (or <X>_MONTHS) column beside a <X>_<suffix> column of the
 * same dataset, for each suffix asked for, in the attributes' order.
 */
export function uploadedOutcomePairs(attrs: readonly { attribute: string }[], suffixes: readonly string[]): OutcomePair[] {
  const byDataset = new Map<string, Set<string>>();
  for (const a of attrs) {
    const p = parseCustomAttr(a.attribute);
    if (p) (byDataset.get(p.dataset) ?? byDataset.set(p.dataset, new Set()).get(p.dataset)!).add(p.column);
  }
  const out: OutcomePair[] = [];
  for (const [dataset, cols] of byDataset) {
    for (const col of cols) {
      const m = TIME_RE.exec(col);
      if (!m) continue;
      for (const suffix of suffixes) {
        const status = m[1] + "_" + suffix;
        if (!cols.has(status)) continue;
        const months = "custom:" + dataset + "/" + col, st = "custom:" + dataset + "/" + status;
        out.push({ name: endpointName(m[1]), months, status: st, label: status + " over " + col + " (custom: " + dataset + ")" });
      }
    }
  }
  return out;
}

/** a prefix as `endpoint` takes it: upper case, letters, digits and _, starting with a letter */
export function endpointName(prefix: string): string {
  const n = prefix.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^[^A-Z]+/, "").slice(0, 40);
  return n || "CUSTOM";
}

/** the value a chooser shows for a column pair, and back */
const COLS = "\u0000cols:";
export const pairValue = (months: string, status: string): string => COLS + months + "\n" + status;
export function parsePairValue(v: string): { months: string; status: string } | null {
  if (!v.startsWith(COLS)) return null;
  const [months, status] = v.slice(COLS.length).split("\n");
  return months && status ? { months, status } : null;
}
/** the chooser's "pick two columns" entry */
export const OTHER_COLUMNS = "\u0000other";

/** the endpoint a view reads, as its subtitle says it: its columns' name when it reads columns, else <endpoint> (default OS) */
export function endpointText(spec: { endpoint?: unknown; monthsAttribute?: unknown; statusAttribute?: unknown }): string {
  if (spec.monthsAttribute || spec.statusAttribute)
    return String(spec.endpoint || attributeLabel(String(spec.statusAttribute || spec.monthsAttribute), "short"));
  return String(spec.endpoint || "OS");
}
