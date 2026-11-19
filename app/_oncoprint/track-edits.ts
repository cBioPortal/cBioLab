// The oncoprint's track edits on a view (the document): pure functions, each returning the next view.
import { portalFreq } from "../../lib/chart/format.ts";
import { attributeLabel } from "../../lib/custom-data-names.ts";
import { normalizeGeneTracks, geneRowKeys, type GeneTrackSpec } from "../../lib/gene-tracks.ts";
import { heatmapTrackLabel, assayTrackLabel, isAutoTrack, AUTO_TRACKS, SPECTRUM_TRACK, SPECTRUM_NAME } from "../../lib/profile-names.ts";

type V = Record<string, any>;

/** a sort key as the figure spells it: "label" / "-label" / "genomic" */
export const sortKeyText = (k: unknown): string =>
  k == null ? "genomic" : typeof k === "string" ? k : ((k as { dir?: string }).dir === "desc" ? "-" : "") + String((k as { track?: string }).track || "genomic");

export const heatmapLabels = (v: V): string[] => (v.heatmap || []).flatMap((h: V) =>
  h.entities && h.entities.length ? h.entities.map((e: unknown) => assayTrackLabel(String(e), h.profileType))
    : (h.genes && h.genes.length ? h.genes : v.genes || []).map((g: unknown) => heatmapTrackLabel(String(g).toUpperCase(), h.profileType)));

/**
 * A sort key only the engine can apply, so a figure sorted by it keeps the order it was given: a
 * clustering (from values the browser never receives) and the case list order (from the cohort's
 * typed list, which the contract does not carry).
 */
export const isEngineSortKey = (k: string): boolean => { const t = k.replace(/^-/, ""); return t.startsWith("cluster:") || t === "caseList"; };

/** drop sort keys whose track no longer exists; a cluster key lives as long as its heatmap profile, the case-list order as long as the cohort (the engine refuses it without a typed list) */
export const pruneSort = (v: V): V => {
  const hidden: string[] = v.hideTracks || [];
  const keep = new Set(["genomic", "id", "caseList", ...AUTO_TRACKS.filter((l) => !hidden.includes(l)), ...(v.clinical || []), ...heatmapLabels(v),
    ...(v.heatmap || []).map((h: V) => "cluster:" + h.profileType)]);
  const sort = (v.sort || []).filter((s: unknown) => keep.has(sortKeyText(s).replace(/^-/, "")));
  const next = { ...v };
  if (sort.length) next.sort = sort; else delete next.sort;
  return next;
};

/** each gene-list entry's row key (lib/gene-tracks.ts), which is what the figure sends back for a gene row */
const rowKeys = (v: V): (string | null)[] => { try { return geneRowKeys(v.genes || []); } catch { return []; } };

/** how many rows a view's gene list draws */
export const geneRowCount = (v: V): number => { try { return normalizeGeneTracks(v.genes || []).tracks.length; } catch { return (v.genes || []).length; } };

/** a track's label back to what produced it: the genes, a heatmap profile, or a clinical attribute */
export const trackOwner = (v: V, label: string): "genes" | "clinical" | "heatmap" | "auto" | null => {
  if (rowKeys(v).includes(label)) return "genes";
  if (isAutoTrack(label)) return "auto";
  if ((v.clinical || []).includes(label)) return "clinical";
  if (heatmapLabels(v).includes(label)) return "heatmap";
  return null;
};

export const withGenes = (v: V, genes: GeneTrackSpec[]): V => pruneSort({ ...v, genes });
export const withClinical = (v: V, attrs: string[]): V => pruneSort({ ...v, clinical: attrs });
export const withHeatmap = (v: V, entries: unknown[]): V => { const n = { ...v }; if (entries.length) n.heatmap = entries; else delete n.heatmap; return pruneSort(n); };
export const withDerived = (v: V, names: string[]): V => { const n = { ...v }; if (names.length) n.derivedCohorts = names; else delete n.derivedCohorts; return n; };

export const moveTrack = (v: V, label: string, dir: -1 | 1): V => {
  const owner = trackOwner(v, label);
  const list = owner === "genes" ? (v.genes || []).map((g: string) => g) : owner === "clinical" ? [...(v.clinical || [])] : null;
  if (!list) return v;   // heatmap tracks follow their profile's gene list
  const i = owner === "genes" ? rowKeys(v).indexOf(label) : list.indexOf(label), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return v;
  [list[i], list[j]] = [list[j], list[i]];
  return owner === "genes" ? { ...v, genes: list } : { ...v, clinical: list };
};

export const removeTrack = (v: V, label: string): V => {
  const owner = trackOwner(v, label);
  if (owner === "genes") {
    const keys = rowKeys(v);
    const genes = (v.genes || []).filter((_: GeneTrackSpec, i: number) => keys[i] !== label);
    return genes.length ? pruneSort({ ...v, genes }) : v;   // a figure needs at least one gene
  }
  if (owner === "clinical") return pruneSort({ ...v, clinical: (v.clinical || []).filter((a: string) => a !== label) });
  if (owner === "heatmap") return withHeatmap(v, (v.heatmap || []).filter((h: V) => !heatmapLabels({ ...v, heatmap: [h] }).includes(label)));
  if (owner === "auto") return (v.hideTracks || []).includes(label) ? v : pruneSort({ ...v, hideTracks: [...(v.hideTracks || []), label] });
  return v;
};

/** whether removeTrack would change the view: not the last gene row, not a track the view does not own */
export const canRemoveTrack = (v: V, label: string): boolean => removeTrack(v, label) !== v;

/** replace a merged row with its members, in place — the figure's "expand" */
export const splitGeneTrack = (v: V, label: string): V => {
  const out: GeneTrackSpec[] = [];
  const keys = rowKeys(v);
  ((v.genes || []) as GeneTrackSpec[]).forEach((e, i) => {
    const members = e && typeof e === "object" ? (e.genes || []).map((g) => String(g).toUpperCase()) : null;
    if (members && keys[i] === label) out.push(...members); else out.push(e);
  });
  // the same gene may already be drawn on its own; expanding must not create two rows with one name
  return withGenes(v, out.filter((e, i) => typeof e !== "string" || out.indexOf(e) === i));
};

/** a clinical attribute as the Tracks menu lists it: `n` is counted at its own level (`per`) */
export interface TrackAttr { attribute: string; kind: string; patients: number; displayName?: string; per?: "patient" | "sample"; priority?: number;
  /** a patient-level attribute: the queried samples whose patient has a value, which the portal's Freq counts */
  samples?: number }

/**
 * The Tracks menu's attributes from an Explore result: every attribute the studies declare, as
 * the portal lists them (ResultsViewPageStore clinicalAttributes), with the selection's count
 * (0 where it has no value) and the attribute's stored priority; then any the facets hold that
 * no study declares.
 */
export function trackAttrs(r: {
  clinical: { attribute: string; kind?: string; patients?: number; displayName?: string; per?: "patient" | "sample"; priority?: number; samples?: number }[];
  declaredAttributes?: { attribute: string; per: "patient" | "sample"; displayName?: string; priority: number }[];
}): TrackAttr[] {
  const facet = new Map(r.clinical.map((c) => [c.attribute, c]));
  const declared = (r.declaredAttributes || []).map((d): TrackAttr => {
    const f = facet.get(d.attribute);
    return { attribute: d.attribute, kind: f?.kind || "cat", patients: f?.patients || 0, per: f?.per || d.per, priority: d.priority,
      ...(f?.samples != null ? { samples: f.samples } : {}),
      ...(d.displayName || f?.displayName ? { displayName: d.displayName || f?.displayName } : {}) };
  });
  const known = new Set(declared.map((d) => d.attribute));
  return [...declared, ...r.clinical.filter((c) => !known.has(c.attribute)).map((c): TrackAttr => ({ attribute: c.attribute, kind: c.kind || "cat",
    patients: c.patients || 0, ...(c.displayName ? { displayName: c.displayName } : {}), ...(c.per ? { per: c.per } : {}),
    ...(c.samples != null ? { samples: c.samples } : {}),
    ...(c.priority != null ? { priority: c.priority } : {}) }))];
}

/**
 * The Clinical tab's "Select all (N)" as the portal's (FixedHeaderTable): N counts every row the
 * search leaves listed; it adds those not on yet that have data (a 0% row cannot be ticked), up to
 * `cap`; and it is not offered once every listed row is on.
 */
export function selectAll(listed: string[], on: string[], pct: (name: string) => number | null | undefined, cap: number) {
  return { n: listed.length, offered: listed.some((x) => !on.includes(x)),
    next: [...on, ...listed.filter((x) => !on.includes(x) && (pct(x) ?? 1) > 0)].slice(0, cap) };
}

/** the portal's Tracks-menu frequency: its Study View getFrequencyStr, "NA" with no denominator */
export const trackFreqText = (pct: number | null): string => pct == null ? "NA" : portalFreq(pct);

/**
 * The Clinical tab's rows (ONC-TR-1, ONC-STM-4): each attribute's share of the queried cases with
 * a value — a sample-level one over the queried samples, as the portal counts it; a patient-level
 * one over the queried patients (the portal counts its samples) — most first, then by stored
 * priority, then by name (TracksMenu, lodash sortBy).
 */
export function clinicalTrackRows(attrs: TrackAttr[], totals?: { patients: number; samples: number }) {
  return attrs.map((a) => {
    // a patient attribute in its patients' samples when Explore counted them, as the portal does
    const inSamples = a.per === "sample" || a.samples != null;
    const of = !totals ? 0 : inSamples ? totals.samples : totals.patients;
    const pct = of ? Math.min(100, 100 * (a.per !== "sample" && a.samples != null ? a.samples : a.patients) / of) : null;
    return { ...a, label: a.displayName || a.attribute, pct, unit: inSamples ? "samples" as const : "patients" as const };
  }).sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1) || (y.priority ?? 0) - (x.priority ?? 0) || byCodeUnit(x.label.toLowerCase(), y.label.toLowerCase()));
}
/** lodash sortBy's order of strings: by UTF-16 code unit, not locale */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The Clinical tab's rows in the portal's order (TracksMenu 185-213): Study of origin, then the
 * mutation spectrum, then the "Profiled for" rows, then the rest (attributes and # Samples per
 * Patient) by Freq, priority and name. The automatic rows count every queried sample (100%), the
 * spectrum the queried samples profiled for mutations (ResultsViewPageStore 1300-1316).
 * `autoTracks` are the rows the figure draws by itself (the contract's conventions.autoTracks).
 */
export function tracksMenuRows({ attrs, totals, spectrum, sequenced, autoTracks }: {
  attrs: TrackAttr[]; totals?: { patients: number; samples: number }; spectrum?: boolean; sequenced?: number; autoTracks: string[];
}) {
  type Row = TrackAttr & { label: string; pct: number | null; unit: "patients" | "samples" };
  const auto = (l: string): Row => ({ attribute: l, kind: "auto", patients: 0, label: l, pct: 100, unit: "samples" });
  const group = (r: Row) => r.attribute === "Study of origin" ? 0 : r.kind === "spectrum" ? 1 : r.attribute.startsWith("Profiled for ") ? 2 : 3;
  const rows: Row[] = [
    ...autoTracks.filter(isAutoTrack).map(auto),
    ...(spectrum ? [{ attribute: SPECTRUM_TRACK, kind: "spectrum", patients: 0, label: SPECTRUM_NAME, unit: "samples" as const,
      pct: totals?.samples && sequenced != null ? Math.min(100, 100 * sequenced / totals.samples) : null }] : []),
    ...clinicalTrackRows(attrs, totals),
  ];
  return rows.sort((a, b) => group(a) - group(b) || (b.pct ?? -1) - (a.pct ?? -1) || (b.priority ?? 0) - (a.priority ?? 0) ||
    byCodeUnit(a.label.toLowerCase(), b.label.toLowerCase()));
}

/**
 * The view after Update tracks (or Select / Deselect all) on the Clinical tab: the ticked
 * attributes become `clinical`, in the order given; the automatic rows left unticked become
 * `hideTracks`, in the figure's order.
 */
export function withClinicalTab(v: V, ticked: string[], autoTracks: string[]): V {
  const hidden = [...autoTracks.filter((l) => !ticked.includes(l)),
    ...(v.hideTracks || []).filter((l: string) => !autoTracks.includes(l) && !ticked.includes(l))];
  const next: V = { ...v, clinical: ticked.filter((n) => !isAutoTrack(n)) };
  if (hidden.length) next.hideTracks = hidden; else delete next.hideTracks;
  return pruneSort(next);
}

const isClusterKey = (k: string) => k.replace(/^-/, "").startsWith("cluster:");

/** the heatmap profile the sort clusters by, wherever its key sits (the engine clusters on the first one), or null */
export function clusteredProfile(keys: string[]): string | null {
  const k = keys.find(isClusterKey);
  return k ? k.replace(/^-/, "").slice("cluster:".length) : null;
}

/**
 * The sort keys after a heatmap profile's "Cluster" (on) or "Don't cluster" (off), from one of that
 * profile's rows (ResultsViewOncoprintUtils makeTrackGroupHeader): clustering is one profile at a time,
 * its key first; "Don't cluster" drops that profile's key and leaves another profile's clustering alone.
 */
export function clusterSort(keys: string[], profileType: string, on: boolean): string[] {
  const rest = keys.filter((k) => !isEngineSortKey(k));
  return on ? ["cluster:" + profileType, ...rest].slice(0, 4) : keys.filter((k) => k.replace(/^-/, "") !== "cluster:" + profileType);
}

/**
 * The sort keys after a track's "Sort a-Z" ("" ), "Sort Z-a" ("-") or "Don't sort by this" (null): a
 * direction makes the track the first key and ends heatmap clustering and the case list order, as the portal's sortByData does
 * (ResultsViewOncoprint onTrackSortDirectionChange); "Don't sort by this" only drops the track's key.
 */
export function trackSort(keys: string[], label: string, dir: "" | "-" | null): string[] {
  const others = keys.filter((x) => x.replace(/^-/, "") !== label);
  return dir === null ? others : [dir + label, ...others.filter((k) => !isEngineSortKey(k))].slice(0, 4);
}

/** the sort keys after the sort select picks a primary key ("" for the engine's order): any pick ends heatmap clustering and the case list order, as sortByData */
export function selectSort(keys: string[], v: string): string[] {
  const rest = keys.slice(1).filter((k) => !isEngineSortKey(k));
  return v ? [v, ...rest].slice(0, 4) : rest;
}

/**
 * A Tracks menu item's text: the attribute's display name alone, numeric or not, as the portal's
 * TracksMenu lists it; a generic-assay profile and the VAF row are named for what they are.
 */
export function tracksMenuText(name: string, o: { tab: string; rowLabel?: string; assayName?: string }): string {
  if (name === "VAF") return "VAF (mutation allele fraction)";
  if (o.assayName) return o.assayName + " (generic assay)";
  return o.rowLabel ?? attributeLabel(name, o.tab === "custom" ? "short" : "long");
}
