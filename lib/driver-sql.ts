// The driver rule of lib/driver-settings.ts as SQL over genomic_event_derived rows, for the views
// that classify in the database (a plot's Driver-vs-VUS axis), and the germline test the oncoprint
// reads its events with. Server-side: it reaches the OncoKB store's SQL in lib/oql.ts.
import { mutationStudySql, sq } from "./compiler.ts";
import { driverEventSql } from "./oql.ts";
import { PUTATIVE_DRIVER, type ResolvedDrivers } from "./driver-settings.ts";
import type { VariantPins } from "./variant-annotation.ts";

/**
 * The same rule as SQL over a genomic_event_derived row (`g` names its table, "" for unqualified
 * columns). OncoKB needs the pin and Cancer Hotspots the SQL of its keys (lib/hotspots.ts
 * hotspotKeysSql); without one that source calls nothing, and the caller says so. `where`: the
 * database and studies whose structural variants OncoKB's pair calls are read for (driverEventSql).
 */
export function driverCondSql(s: ResolvedDrivers, pin: string | null | undefined, g = "", hotspotKeys?: string | null,
  where: { db?: string; studies?: string[] } = {}): string {
  const c = g ? g + "." : "";
  const or: string[] = [];
  if (s.custom) or.push(c + "driver_filter = " + sq(PUTATIVE_DRIVER));
  if (s.tiers === null) or.push(c + "driver_tiers_filter != ''");
  else if (s.tiers.length) or.push(c + "driver_tiers_filter IN (" + s.tiers.map(sq).join(", ") + ")");
  if (s.oncokb && pin) or.push(driverEventSql(pin, g, where));
  if (s.hotspots && hotspotKeys)
    or.push("(" + c + "variant_type = 'mutation' AND (" + c + "hugo_gene_symbol, " + c + "mutation_variant, " + c + "mutation_type) IN (\n" + hotspotKeys + "))");
  return or.length ? "(" + or.join("\n   OR ") + ")" : "0";
}

/** a genomic_event_derived row is a germline mutation, as SQL */
export const germlineCondSql = (g = ""): string =>
  "(" + (g ? g + "." : "") + "variant_type = 'mutation' AND positionCaseInsensitive(" + (g ? g + "." : "") + "mutation_status, 'germline') > 0)";

/**
 * The page's driver sources as a view can read them: OncoKB only at a pin, Cancer Hotspots only with
 * Genome Nexus pins (the portal's sources the deployment offers). `sure`: one of those is on, so the
 * mutations are annotated whatever the study holds.
 */
export function offeredSources(d: ResolvedDrivers, pin: string | null, hotspotPins: VariantPins | null): { oncokb: boolean; hotspots: boolean; sure: boolean } {
  const oncokb = d.oncokb && !!pin, hotspots = d.hotspots && !!hotspotPins && Object.values(hotspotPins).some(Boolean);
  return { oncokb, hotspots, sure: oncokb || hotspots };
}

/**
 * Whether the study's mutations are told apart as driver or VUS, as SQL ("1", "0" or a condition): a
 * source in `sure`, or the study's own calls where it holds any — the portal offers its custom-driver
 * box only when the study's report has binary calls (customDriverAnnotationReport.hasBinary) and a tier
 * box only for a tier the study has, so with OncoKB and hotspots off a study without them is not
 * annotated at all (driversAnnotated false). Judged over the whole study, as that report is.
 */
export function annotatingSql(d: ResolvedDrivers, sure: boolean, db: string, study: string): string {
  if (sure) return "1";
  const any = (cond: string) => "(SELECT count() > 0 FROM " + db + ".mutation_derived WHERE " + mutationStudySql(study) + " AND " + cond + ")";
  const or: string[] = [];
  if (d.custom) or.push(any("ifNull(driverFilter, '') != ''"));
  if (d.tiers === null) or.push(any("ifNull(driverTiersFilter, '') != ''"));
  else if (d.tiers.length) or.push(any("ifNull(driverTiersFilter, '') IN (" + d.tiers.map(sq).join(", ") + ")"));
  return or.length ? "(" + or.join(" OR ") + ")" : "0";
}

/** `driver`, a row's call under the settings, as filed when nothing annotates: every row in its class's one cell */
export const unannotatedOrSql = (annotating: string, driver: string): string =>
  annotating === "1" ? driver : annotating === "0" ? "toUInt8(1)" : "if(" + annotating + ", " + driver + ", toUInt8(1))";
