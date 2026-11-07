// The signatures view's rules, pure: which signature profiles a study holds and which type is shown
// first, how a patient's rows become the table's signatures and a sample's spectrum, and the order
// and classes of a spectrum's channels. Ported from cbioportal-frontend's
// shared/lib/GenericAssayUtils/MutationalSignaturesUtils.tsx, PatientViewPageStore.ts
// (mutationalSignatureDataGroupByVersion) and MutationalSignatureBarChartUtils.ts. Browser-safe.
import type { SignatureRow, SpectrumChannel } from "./types.ts";
import { STYLE, type Style } from "../../oncoprint-style.ts";

/**
 * A mutational-signature profile type as cBioPortal names it (MutationalSignaturesUtils.tsx): what it
 * holds — each signature's contribution, its p-value, or the mutations counted per channel — and,
 * after the last "_", its signature type (the portal's "version": SBS, DBS, ID, v2, v3).
 */
export const SIGNATURE_PROFILE = /^mutational_signatures?_(contribution|pvalue|counts)_([A-Za-z0-9.]+)$/;
export type SignatureProfileRole = "contribution" | "pvalue" | "counts";

/** the portal's significance threshold (MUTATIONAL_SIGNATURES_SIGNIFICANT_PVALUE_THRESHOLD) */
export const SIGNIFICANT_P = 0.05;

/** One signature type's profiles in a study. */
export interface SignatureFamily { version: string; contribution: string | null; pvalue: string | null; counts: string | null }

/** A study's signature profiles by type, from its generic-assay profile types; sorted by type. */
export function signatureFamilies(gaProfiles: string[]): SignatureFamily[] {
  const by = new Map<string, SignatureFamily>();
  for (const pt of gaProfiles) {
    const m = SIGNATURE_PROFILE.exec(pt);
    if (!m) continue;
    const f = by.get(m[2]) || { version: m[2], contribution: null, pvalue: null, counts: null };
    f[m[1] as SignatureProfileRole] = pt;
    by.set(m[2], f);
  }
  return [...by.values()].sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * The type shown first, as the portal picks it (retrieveMutationalSignatureVersionFromData): v3 when
 * both v2 and v3 are there, else SBS when there, else the first.
 */
export function defaultVersion(versions: string[]): string | null {
  if (versions.includes("v3") && versions.includes("v2")) return "v3";
  if (versions.includes("SBS")) return "SBS";
  return versions[0] ?? null;
}

/** "SBS" → "Single base substitutions (SBS)", as the portal names the types it knows. */
export function versionLabel(v: string): string {
  return v === "SBS" ? "Single base substitutions (SBS)" : v === "DBS" ? "Double base substitutions (DBS)" : v === "ID" ? "Small insertions and deletions (ID)"
    : /^v\d/.test(v) ? "COSMIC " + v + " signatures" : v;
}

/** the mutations a type's spectrum counts, for its axis */
export const spectrumUnit = (v: string) => v === "SBS" ? "single base substitutions" : v === "DBS" ? "double base substitutions" : v === "ID" ? "indels" : "mutations";

/** natural order: SBS2 before SBS10a */
export const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * A pair list as ClickHouse returns `groupArray(tuple(sid, x))` in JSON — arrays, or objects keyed
 * "1", "2" — as sample → value (null where the value is not a number).
 */
export function pairsOf(raw: unknown): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const t of (Array.isArray(raw) ? raw : []) as unknown[]) {
    const a = Array.isArray(t) ? t : Object.values((t ?? {}) as Record<string, unknown>);
    const x = a[1];
    out.set(String(a[0]), x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
  }
  return out;
}

/** a signature's key across its contribution and p-value entities: the last "_" part of its id, as the portal pairs them */
const pairKey = (entity: string) => entity.split("_").pop() || entity;

/**
 * The table's signatures: every entity of the contribution profile with a value in some profiled
 * sample, its p-value from the p-value entity with the same key in the same sample, values aligned
 * with `profiled`. Ordered as the portal's table opens: the first profiled sample's contribution,
 * highest first (missing last), then by name.
 */
export function signatureRows(rows: { entity: string; name: string; description: string; url: string; vals: Map<string, number | null> }[],
  pvalues: { entity: string; vals: Map<string, number | null> }[], profiled: string[]): SignatureRow[] {
  const pv = new Map(pvalues.map((r) => [pairKey(r.entity), r.vals]));
  const out = rows.filter((r) => profiled.some((s) => r.vals.get(s) != null)).map((r) => {
    const p = pv.get(pairKey(r.entity));
    return { entity: r.entity, name: r.name || r.entity, description: r.description, url: r.url,
      values: profiled.map((s) => ({ value: r.vals.get(s) ?? null, p: p?.get(s) ?? null })) };
  });
  const first = (r: SignatureRow) => r.values[0]?.value ?? -Infinity;
  return out.sort((a, b) => first(b) - first(a) || natural(a.name, b.name));
}

/** A share as the portal's table writes it (getMutationalSignaturePercentage): "<1%" below one percent, else whole percent. */
export function pctText(v: number | null): string {
  if (v == null) return "NA";
  return 100 * v < 1 ? "<1%" : Math.round(100 * v) + "%";
}

const SBS_CLASSES = ["C>A", "C>G", "C>T", "T>A", "T>C", "T>G"];
const ID_CLASSES = ["1bp deletion", "1bp insertion", ">1bp deletion", ">1bp insertion", "Microhomology"];

/**
 * A spectrum channel's class (what colours it, as the portal's colorMap does) and its sort key in
 * COSMIC's order: SBS by substitution then 5′ and 3′ base; DBS by reference dinucleotide; ID by
 * 1bp deletion C/T, 1bp insertion C/T, longer deletions and insertions by length, then microhomology
 * deletions by length, each by its repeat or homopolymer count. A name in no known form is "other".
 */
export function channelClass(name: string): { group: string; key: (string | number)[] } {
  let m = /^([ACGT])\[([CT]>[ACGT])\]([ACGT])$/.exec(name);
  if (m) return { group: m[2], key: [0, SBS_CLASSES.indexOf(m[2]), m[1], m[3]] };
  m = /^([ACGT]{2})>([ACGT]{2})$/.exec(name);
  if (m) return { group: m[1] + ">NN", key: [1, m[1], m[2]] };
  m = /^(\d+):(Del|Ins):([CTRM]):(\d+)$/.exec(name);
  if (m) {
    const len = Number(m[1]), del = m[2] === "Del", t = m[3];
    const group = t === "M" ? "Microhomology" : len === 1 ? (del ? "1bp deletion" : "1bp insertion") : del ? ">1bp deletion" : ">1bp insertion";
    // within a class: by length, then (1bp) base C before T, then the count
    return { group, key: [2, ID_CLASSES.indexOf(group), len, t === "T" ? 1 : 0, Number(m[4])] };
  }
  return { group: "other", key: [3, name] };
}

const cmpKey = (a: (string | number)[], b: (string | number)[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x == null) return -1;
    if (y == null) return 1;
    return typeof x === "number" && typeof y === "number" ? x - y : natural(String(x), String(y));
  }
  return 0;
};

/** One sample's spectrum from the counts profile's rows: a channel per entity with a count, in COSMIC's order. */
export function spectrumOf(rows: { entity: string; name: string; vals: Map<string, number | null> }[], sample: string): { total: number; channels: SpectrumChannel[] } {
  const ch = rows.flatMap((r) => {
    const count = r.vals.get(sample);
    if (count == null) return [];
    const label = r.name || r.entity.split("_matrix_").pop() || r.entity;
    const c = channelClass(label);
    return [{ ch: { entity: r.entity, label, group: c.group, count }, key: c.key }];
  }).sort((a, b) => cmpKey(a.key, b.key));
  return { total: ch.reduce((n, x) => n + x.ch.count, 0), channels: ch.map((x) => x.ch) };
}

// ---- the spectrum chart as the portal draws it (MutationalSignatureBarChart.tsx, MutationalSignaturesContainer.tsx)

/** the header's name for a type's mutations, as the portal writes it before "count:" */
export function countLabel(v: string): string {
  return v === "SBS" ? "Single Base Substitution (SBS)" : v === "DBS" ? "Double Base Substitution (DBS)" : v === "ID" ? "Small insertions and deletions (ID)" : v;
}
/** the spectrum's y-axis title, as the portal's (updateYaxisLabel) */
export function spectrumAxisTitle(v: string, scale: "percent" | "count"): string {
  return (v === "SBS" ? "Single Base Substitution" : v === "DBS" ? "Double Base Substitutions" : "Indels") + (scale === "percent" ? " (%)" : " (#)");
}
/** the type selector's option text, as the portal's getVersionOption */
export const typeOption = (v: string) => "Mutational Signature " + v.toUpperCase();
/** the header's info tip, the portal's words */
export const COUNT_TIP = "Mutation count may include silent, noncoding and other types of mutations that may not be shown elsewhere in cBioPortal.";
/** the line above the signature table, the portal's words */
export const ROW_CLICK_HINT = "Click on a mutational signature to update reference plot";

/** a channel's colour, the portal's (STYLE.signatures) */
export function channelColor(label: string, S: Style = STYLE): string {
  const c = S.signatures;
  let m = /^[ACGT]\[([CT]>[ACGT])\][ACGT]$/.exec(label);
  if (m) return c.sbs[m[1]] ?? c.unknown;
  m = /^([ACGT]{2})>[ACGT]{2}$/.exec(label);
  if (m) return c.dbs[m[1]] ?? c.unknown;
  m = /^(\d+):(Del|Ins):([CTRM]):\d+$/.exec(label);
  if (m) return c.id[Math.min(5, Number(m[1])) + ":" + m[2] + ":" + m[3]] ?? c.unknown;
  return c.unknown;
}

/**
 * A channel's label under the bars, and which of its letters is drawn in its class's colour: SBS the
 * trinucleotide with the mutated (middle) base coloured (A[C>A]A → ACA, the C); DBS the dinucleotide
 * it becomes (AC>CA → CA); ID the repeat or homopolymer count on COSMIC's scale — a deletion's count
 * from 1 (the stored 0 is 1, 5 is 6+), an insertion's and a microhomology's from 0 (5 is 5+).
 */
export function channelTick(label: string): { text: string; colored: number | null } {
  let m = /^([ACGT])\[([CT])>[ACGT]\]([ACGT])$/.exec(label);
  if (m) return { text: m[1] + m[2] + m[3], colored: 1 };
  m = /^[ACGT]{2}>([ACGT]{2})$/.exec(label);
  if (m) return { text: m[1], colored: null };
  m = /^\d+:(Del|Ins):([CTRM]):(\d+)$/.exec(label);
  if (m) {
    const n = Number(m[3]);
    const text = m[1] === "Del" && m[2] !== "M" ? (n >= 5 ? "6+" : String(n + 1)) : n >= 5 ? "5+" : String(n);
    return { text, colored: null };
  }
  return { text: label, colored: null };
}

/**
 * An indel channel's sub-class, the coloured box it sits in under its class: the base of a 1bp
 * indel (C, T), else the indel's length (2, 3, 4, 5+); and the axis title under that class's boxes,
 * the portal's words. null for SBS and DBS channels.
 */
export function indelBox(label: string): { box: string; title: string } | null {
  const m = /^(\d+):(Del|Ins):([CTRM]):\d+$/.exec(label);
  if (!m) return null;
  const len = Number(m[1]);
  return { box: len === 1 ? m[3] : len >= 5 ? "5+" : String(len),
    title: m[3] === "M" ? "Microhomology" : len === 1 ? "Homopolymer length" : "Number of repeat units" };
}

/** the Y-axis Max slider: a whole percent from 1 to 100, 100 drawing the whole axis */
export const YMAX_MIN = 1, YMAX_MAX = 100;

/**
 * The spectrum's axis maximum in percent for the slider's value, as the portal's domainMaxPercentage:
 * 1 at or under 1, 80 between 80 and 100, else up to the next multiple of 20.
 */
export function percentAxisMax(ymax: number): number {
  let perc = ymax;
  if (perc < 100 && perc > 80) perc = 80;
  return perc <= 1 ? 1 : Math.ceil(perc / 20) * 20 || 100;
}
/** the count axis's maximum: the largest channel's count scaled by the slider's share, up to a multiple of 10 (10 when every channel is 0) */
export function countAxisMax(largest: number, ymax: number): number {
  return largest !== 0 ? Math.ceil((largest * percentAxisMax(ymax)) / 100 / 10) * 10 : 10;
}
/** the reference's axis maximum, always in percent: the slider's value up to a multiple of 10 on the percent scale, 100 on the count scale */
export function referenceAxisMax(scale: "percent" | "count", ymax: number): number {
  return scale === "percent" ? Math.ceil(ymax / 10) * 10 : 100;
}
/** a spectrum tick, the portal's: whole numbers only; the top one "≥" when bars may run past it (not 100 on the percent axis) */
export function spectrumTick(v: number, max: number, scale: "percent" | "count"): string {
  if (!Number.isInteger(v)) return "";
  if (v >= max) return scale === "percent" && v === 100 ? "100" : ">=" + v;
  return String(v);
}
/** a reference tick: whole percents; the bottom one "≥" below 100 */
export function referenceTick(v: number, max: number): string {
  if (!Number.isInteger(v)) return "";
  return (v >= max && v < 100 ? ">=" : "") + v + "%";
}
