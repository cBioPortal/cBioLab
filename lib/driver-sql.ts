// The driver rule of lib/driver-settings.ts as SQL over genomic_event_derived rows, for the views
// that classify in the database (a plot's Driver-vs-VUS axis), and the germline test the oncoprint
// reads its events with. Server-side: it reaches the OncoKB store's SQL in lib/oql.ts.
import { sq } from "./compiler.ts";
import { driverEventSql } from "./oql.ts";
import { PUTATIVE_DRIVER, type ResolvedDrivers } from "./driver-settings.ts";

/**
 * The same rule as SQL over a genomic_event_derived row (`g` names its table, "" for unqualified
 * columns). OncoKB needs the pin; without one that source calls nothing, and the caller says so.
 */
export function driverCondSql(s: ResolvedDrivers, pin: string | null | undefined, g = ""): string {
  const c = g ? g + "." : "";
  const or: string[] = [];
  if (s.custom) or.push(c + "driver_filter = " + sq(PUTATIVE_DRIVER));
  if (s.tiers === null) or.push(c + "driver_tiers_filter != ''");
  else if (s.tiers.length) or.push(c + "driver_tiers_filter IN (" + s.tiers.map(sq).join(", ") + ")");
  if (s.oncokb && pin) or.push(driverEventSql(pin, g));
  return or.length ? "(" + or.join("\n   OR ") + ")" : "0";
}

/** a genomic_event_derived row is a germline mutation, as SQL */
export const germlineCondSql = (g = ""): string =>
  "(" + (g ? g + "." : "") + "variant_type = 'mutation' AND positionCaseInsensitive(" + (g ? g + "." : "") + "mutation_status, 'germline') > 0)";
