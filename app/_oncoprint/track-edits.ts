// The oncoprint's track edits on a view (the document): pure functions, each returning the next view.
import { normalizeGeneTracks, type GeneTrackSpec } from "../../lib/gene-tracks.ts";
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

/** the row a gene-list entry draws, which is the label the figure sends back */
export const geneRowLabel = (e: GeneTrackSpec): string => typeof e === "string" ? e.toUpperCase()
  : (e.label || (e.genes || []).map((g) => String(g).toUpperCase()).join(" / "));

/** how many rows a view's gene list draws */
export const geneRowCount = (v: V): number => { try { return normalizeGeneTracks(v.genes || []).tracks.length; } catch { return (v.genes || []).length; } };

/** a track's label back to what produced it: the genes, a heatmap profile, or a clinical attribute */
export const trackOwner = (v: V, label: string): "genes" | "clinical" | "heatmap" | null => {
  if ((v.genes || []).some((g: GeneTrackSpec) => geneRowLabel(g) === label)) return "genes";
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
  const i = list.findIndex((x: GeneTrackSpec) => (owner === "genes" ? geneRowLabel(x) : x) === label), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return v;
  [list[i], list[j]] = [list[j], list[i]];
  return owner === "genes" ? { ...v, genes: list } : { ...v, clinical: list };
};

export const removeTrack = (v: V, label: string): V => {
  const owner = trackOwner(v, label);
  if (owner === "genes") {
    const genes = (v.genes || []).filter((g: GeneTrackSpec) => geneRowLabel(g) !== label);
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
  for (const e of (v.genes || []) as GeneTrackSpec[]) {
    const members = e && typeof e === "object" ? (e.genes || []).map((g) => String(g).toUpperCase()) : null;
    if (members && geneRowLabel(e) === label) out.push(...members); else out.push(e);
  }
  // the same gene may already be drawn on its own; expanding must not create two rows with one name
  return withGenes(v, out.filter((e, i) => typeof e !== "string" || out.indexOf(e) === i));
};
