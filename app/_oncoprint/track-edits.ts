// The oncoprint's track edits on a view (the document): pure functions, each returning the next view.
import { portalFreq } from "../../lib/chart/format.ts";
import { normalizeGeneTracks, geneRowKeys, type GeneTrackSpec } from "../../lib/gene-tracks.ts";
import { heatmapTrackLabel, assayTrackLabel, STUDY_TRACK } from "../../lib/profile-names.ts";

type V = Record<string, any>;

/** a sort key as the figure spells it: "label" / "-label" / "genomic" */
export const sortKeyText = (k: unknown): string =>
  k == null ? "genomic" : typeof k === "string" ? k : ((k as { dir?: string }).dir === "desc" ? "-" : "") + String((k as { track?: string }).track || "genomic");

export const heatmapLabels = (v: V): string[] => (v.heatmap || []).flatMap((h: V) =>
  h.entities && h.entities.length ? h.entities.map((e: unknown) => assayTrackLabel(String(e), h.profileType))
    : (h.genes && h.genes.length ? h.genes : v.genes || []).map((g: unknown) => heatmapTrackLabel(String(g).toUpperCase(), h.profileType)));

/** drop sort keys whose track no longer exists; a cluster key lives as long as its heatmap profile */
export const pruneSort = (v: V): V => {
  const keep = new Set(["genomic", "id", STUDY_TRACK, ...(v.clinical || []), ...heatmapLabels(v),
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
export const trackOwner = (v: V, label: string): "genes" | "clinical" | "heatmap" | null => {
  if (rowKeys(v).includes(label)) return "genes";
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
export interface TrackAttr { attribute: string; kind: string; patients: number; displayName?: string; per?: "patient" | "sample"; priority?: number }

/**
 * The Tracks menu's attributes from an Explore result: every attribute the studies declare, as
 * the portal lists them (ResultsViewPageStore clinicalAttributes), with the selection's count
 * (0 where it has no value) and the attribute's stored priority; then any the facets hold that
 * no study declares.
 */
export function trackAttrs(r: {
  clinical: { attribute: string; kind?: string; patients?: number; displayName?: string; per?: "patient" | "sample"; priority?: number }[];
  declaredAttributes?: { attribute: string; per: "patient" | "sample"; displayName?: string; priority: number }[];
}): TrackAttr[] {
  const facet = new Map(r.clinical.map((c) => [c.attribute, c]));
  const declared = (r.declaredAttributes || []).map((d): TrackAttr => {
    const f = facet.get(d.attribute);
    return { attribute: d.attribute, kind: f?.kind || "cat", patients: f?.patients || 0, per: f?.per || d.per, priority: d.priority,
      ...(d.displayName || f?.displayName ? { displayName: d.displayName || f?.displayName } : {}) };
  });
  const known = new Set(declared.map((d) => d.attribute));
  return [...declared, ...r.clinical.filter((c) => !known.has(c.attribute)).map((c): TrackAttr => ({ attribute: c.attribute, kind: c.kind || "cat",
    patients: c.patients || 0, ...(c.displayName ? { displayName: c.displayName } : {}), ...(c.per ? { per: c.per } : {}),
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
    const of = !totals ? 0 : a.per === "sample" ? totals.samples : totals.patients;
    const pct = of ? Math.min(100, 100 * a.patients / of) : null;
    return { ...a, label: a.displayName || a.attribute, pct, unit: a.per === "sample" ? "samples" as const : "patients" as const };
  }).sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1) || (y.priority ?? 0) - (x.priority ?? 0) || byCodeUnit(x.label.toLowerCase(), y.label.toLowerCase()));
}
/** lodash sortBy's order of strings: by UTF-16 code unit, not locale */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
