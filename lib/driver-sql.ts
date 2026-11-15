// The driver rule of lib/driver-settings.ts as SQL over genomic_event_derived rows, for the views
// that classify in the database (a plot's Driver-vs-VUS axis), and the germline test the oncoprint
// reads its events with. Server-side: it reaches the OncoKB store's SQL in lib/oql.ts.
import { sq } from "./compiler.ts";
import { driverEventSql } from "./oql.ts";
import { PUTATIVE_DRIVER, type ResolvedDrivers } from "./driver-settings.ts";

/**
 * The same rule as SQL over a genomic_event_derived row (`g` names its table, "" for unqualified
 * columns). OncoKB needs the pin and Cancer Hotspots the SQL of its keys (lib/hotspots.ts
 * hotspotKeysSql); without one that source calls nothing, and the caller says so.
 */
export function driverCondSql(s: ResolvedDrivers, pin: string | null | undefined, g = "", hotspotKeys?: string | null): string {
  const c = g ? g + "." : "";
  const or: string[] = [];
  if (s.custom) or.push(c + "driver_filter = " + sq(PUTATIVE_DRIVER));
  if (s.tiers === null) or.push(c + "driver_tiers_filter != ''");
  else if (s.tiers.length) or.push(c + "driver_tiers_filter IN (" + s.tiers.map(sq).join(", ") + ")");
  if (s.oncokb && pin) or.push(driverEventSql(pin, g));
  if (s.hotspots && hotspotKeys)
    or.push("(" + c + "variant_type = 'mutation' AND (" + c + "hugo_gene_symbol, " + c + "mutation_variant, " + c + "mutation_type) IN (\n" + hotspotKeys + "))");
  return or.length ? "(" + or.join("\n   OR ") + ")" : "0";
}

/**
 * A mutation status is germline, as SQL: it contains "germline" in any case, as the portal's
 * GERMLINE_REGEXP (/germline/i, cbioportal-frontend MutationUtils.tsx) tests it — "Germline",
 * "GERMLINE", "germline" alike. A Nullable column is wrapped in ifNull(…, '') by the caller, so that
 * a NULL status is not germline, as the regexp finds no "germline" in "null".
 */
export const germlineStatusSql = (col: string): string => "positionCaseInsensitive(" + col + ", 'germline') > 0";

/** a genomic_event_derived row is a germline mutation, as SQL */
export const germlineCondSql = (g = ""): string =>
  "(" + (g ? g + "." : "") + "variant_type = 'mutation' AND " + germlineStatusSql((g ? g + "." : "") + "mutation_status") + ")";
