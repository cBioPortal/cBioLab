// Driver annotation settings: which sources call an alteration a putative driver, and which
// alterations a view leaves out because of that call or because the mutation is germline — the
// Results page's "Annotate Data" / "Filter Data" menu in cBioPortal (shared/alterationFiltering).
//
// One object, held in each view that honours it (`drivers`), so a saved analysis or a link draws
// the same calls. This module is the one place the rule lives — the per-event test the oncoprint
// runs over fetched rows — and has no server imports, so the settings menu can use it;
// lib/driver-sql.ts is the same test as SQL, for views that classify in the database.

/** What a document says; every field optional, defaults as cBioPortal's server config sets them. */
export interface DriverSettings {
  /** the version-pinned OncoKB store (default true) */
  oncokb?: boolean;
  /** Cancer Hotspots (default false): no hotspot data is loaded in this warehouse, so true is refused */
  hotspots?: boolean;
  /** the study's own driver calls, `cbp_driver` = "Putative_Driver" (default true) */
  custom?: boolean;
  /** the `cbp_driver_tiers` values that count as driver; omitted means every tier, [] none */
  tiers?: string[];
  /** leave out alterations no source calls a driver — the portal's "Show only drivers" (default false) */
  hideVus?: boolean;
  /** leave out germline mutations — the portal's "Show only somatic" (default false) */
  hideGermline?: boolean;
}

/** The settings with every default filled in. */
export interface ResolvedDrivers {
  oncokb: boolean; custom: boolean;
  /** null: every tier counts */
  tiers: string[] | null;
  /** some source is on, so alterations are told apart as driver or VUS */
  annotated: boolean;
  /** only when `annotated`: with no source on there is nothing to hide (the portal disables the box) */
  hideVus: boolean;
  hideGermline: boolean;
}

/** the value of `cbp_driver` that marks a putative driver; Putative_Passenger and Unknown call nothing */
export const PUTATIVE_DRIVER = "Putative_Driver";

const KEYS = ["oncokb", "hotspots", "custom", "tiers", "hideVus", "hideGermline"] as const;
const TIER_CAP = 50;

const HOTSPOTS_REFUSAL = "drivers.hotspots: Cancer Hotspots is not loaded in this warehouse, so no mutation can be called a hotspot. " +
  "The driver sources available are oncokb (the version-pinned OncoKB store), custom (the study's cbp_driver column) and tiers (its cbp_driver_tiers column)";

/** Defaults filled in; an unknown key or a value of the wrong type is refused, never ignored. */
export function resolveDrivers(d: DriverSettings | undefined | null): ResolvedDrivers {
  if (d != null && (typeof d !== "object" || Array.isArray(d))) throw new Error("drivers must be an object like {oncokb: true, hideVus: false}");
  const src = (d || {}) as Record<string, unknown>;
  for (const k of Object.keys(src))
    if (!(KEYS as readonly string[]).includes(k)) throw new Error("drivers: unknown setting '" + k.slice(0, 40) + "' (accepted: " + KEYS.join(", ") + ")");
  const bool = (k: string, dflt: boolean): boolean => {
    const v = src[k];
    if (v === undefined) return dflt;
    if (typeof v !== "boolean") throw new Error("drivers." + k + " must be true or false");
    return v;
  };
  if (bool("hotspots", false)) throw new Error(HOTSPOTS_REFUSAL);
  let tiers: string[] | null = null;
  if (src.tiers !== undefined) {
    if (!Array.isArray(src.tiers) || src.tiers.some((t) => typeof t !== "string" || !t || t.length > 100))
      throw new Error("drivers.tiers is a list of cbp_driver_tiers values, e.g. [\"Tier 1\", \"Tier 2\"]");
    if (src.tiers.length > TIER_CAP) throw new Error("drivers.tiers takes at most " + TIER_CAP + " tiers; this names " + src.tiers.length);
    tiers = [...new Set(src.tiers as string[])];
  }
  const oncokb = bool("oncokb", true), custom = bool("custom", true);
  const annotated = oncokb || custom || tiers === null || tiers.length > 0;
  return { oncokb, custom, tiers, annotated, hideVus: annotated && bool("hideVus", false), hideGermline: bool("hideGermline", false) };
}

/**
 * The settings over data whose tiers are known: "every tier" counts as a source only where the
 * data has a tier, as the portal's tier boxes exist only for tiers in the data — so with OncoKB and
 * custom calls off, and no tier in the data, nothing is told apart and there is nothing to hide.
 */
export function forData(s: ResolvedDrivers, hasTiers: boolean): ResolvedDrivers {
  if (s.tiers !== null || hasTiers || s.oncokb || s.custom) return s;
  return { ...s, annotated: false, hideVus: false };
}

/** the settings a document would write for `r`: only what differs from the defaults; undefined when nothing does */
export function compactDrivers(r: DriverSettings): DriverSettings | undefined {
  const out: DriverSettings = {};
  if (r.oncokb === false) out.oncokb = false;
  if (r.custom === false) out.custom = false;
  if (r.tiers) out.tiers = r.tiers;
  if (r.hideVus) out.hideVus = true;
  if (r.hideGermline) out.hideGermline = true;
  return Object.keys(out).length ? out : undefined;
}

/** the columns an event carries for this rule, beside those OncoKB matches on */
export interface DriverFields {
  /** `cbp_driver`, as loaded */
  df?: string | null;
  /** `cbp_driver_tiers`, as loaded */
  dt?: string | null;
  /** the mutation is germline (its mutation_status contains "germline", in any case) */
  germ?: boolean | number | null;
}

/** cBioPortal's test: mutation_status matches /Germline/i (MutationUtils.isNotGermlineMutation) */
export const isGermlineStatus = (status: string | null | undefined): boolean => /germline/i.test(status || "");

/**
 * The one rule: a putative driver when ANY switched-on source says so — OncoKB, the study's own
 * Putative_Driver call, or a tier that counts. A Putative_Passenger call does not overrule OncoKB,
 * as it does not in the portal (evaluatePutativeDriverInfo).
 */
export function isDriverEvent(r: DriverFields, s: ResolvedDrivers, oncokb: () => boolean): boolean {
  if (s.custom && r.df === PUTATIVE_DRIVER) return true;
  if (r.dt && (s.tiers === null || s.tiers.includes(r.dt))) return true;
  return s.oncokb && oncokb();
}

/** What a caption or a result says the calls came from. */
export function driverSourceText(s: ResolvedDrivers, oncokbSource: string | null): string {
  if (!s.annotated) return "none — no driver source is switched on, so nothing is called a driver";
  const parts: string[] = [];
  if (s.oncokb) parts.push(oncokbSource || "OncoKB");
  if (s.custom) parts.push("the study's custom driver calls (cbp_driver = " + PUTATIVE_DRIVER + ")");
  if (s.tiers === null) parts.push("every custom driver tier (cbp_driver_tiers)");
  else if (s.tiers.length) parts.push("custom driver tiers " + s.tiers.join(", "));
  return parts.join(" + ");
}

/**
 * The view's driver settings, the older display spellings (`annotate: "none"`, `hideVUS`) read
 * into them as the engine reads them (normalizeDisplay), so the menu shows what is drawn.
 */
export const driversOf = (v: { display?: unknown; drivers?: unknown }): DriverSettings | undefined => {
  const d = (v.display || {}) as { annotate?: string; hideVUS?: boolean };
  const older: DriverSettings = { ...(d.annotate === "none" ? { oncokb: false, custom: false, tiers: [] } : {}), ...(d.hideVUS ? { hideVus: true } : {}) };
  return compactDrivers({ ...older, ...((v.drivers || {}) as DriverSettings) });
};

/** the view with these driver settings, written as `drivers` alone (the older display keys dropped) */
export const withDrivers = <V extends { display?: unknown; drivers?: unknown }>(v: V, d: DriverSettings | undefined): V => {
  const display = { ...((v.display || {}) as Record<string, unknown>) };
  delete display.annotate; delete display.hideVUS;
  const next = { ...v } as V & { display?: unknown; drivers?: unknown };
  if (Object.keys(display).length) next.display = display; else delete next.display;
  if (d) next.drivers = d; else delete next.drivers;
  return next;
};
