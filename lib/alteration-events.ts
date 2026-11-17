// The Genomic Alterations tab's alteration types, as cBioPortal's checkbox tree offers them
// (ComparisonStoreUtils.ts, AlterationEnrichmentTypeSelector.tsx; CMM-AT-1). Each unit is a set of
// lower-case mutation_type values the tree switches on and off together; a parent's own values (the
// Inframe, Truncating and Frameshift rows' generic types) move only with the parent.

export const MUTATION_UNITS = {
  missense: ["missense", "missense_mutation", "missense_variant"],
  inframe: ["indel", "nonframeshift", "inframe"],
  inframe_del: ["inframe_del", "inframe_deletion", "in_frame_del", "in_frame_deletion", "nonframeshift_deletion"],
  inframe_ins: ["inframe_ins", "inframe_insertion", "in_frame_ins", "in_frame_insertion", "nonframeshift_insertion"],
  truncating: ["truncating", "feature_truncation"],
  nonsense: ["nonsense_mutation", "nonsense", "stopgain_snv", "stop_gained"],
  frameshift: ["frameshift", "frameshift_variant"],
  frameshift_del: ["frame_shift_del", "frameshift_deletion"],
  frameshift_ins: ["frame_shift_ins", "frameshift_insertion"],
  nonstart: ["translation_start_site", "initiator_codon_variant", "start_codon_snp", "start_codon_del", "de_novo_start_outofframe"],
  nonstop: ["nonstop_mutation", "stop_lost"],
  splice: ["splice_site", "splice", "splicing", "splice_site_snp", "splice_site_del", "splice_site_indel", "splice_region_variant", "splice_region"],
  other: ["silent", "synonymous_variant", "targeted_region", "other"],
} as const satisfies Record<string, readonly string[]>;

export type MutationUnit = keyof typeof MUTATION_UNITS;
export type AlterationEvent = MutationUnit | "sv" | "amp" | "homdel";

export const MUTATION_UNIT_LIST = Object.keys(MUTATION_UNITS) as MutationUnit[];
/** every unit, in the order the portal's URL lists them: mutations, then copy number, then structural variants */
export const ALTERATION_EVENTS: AlterationEvent[] = [...MUTATION_UNIT_LIST, "amp", "homdel", "sv"];

/** One row of the tree: its label, and the units it switches (a leaf, one; a parent, every unit under it). */
export interface EventNode { label: string; units: AlterationEvent[]; children?: EventNode[] }

const leaf = (label: string, u: AlterationEvent): EventNode => ({ label, units: [u] });
const parent = (label: string, own: AlterationEvent[], children: EventNode[]): EventNode =>
  ({ label, units: [...own, ...children.flatMap((c) => c.units)], children });

/** The tree as the portal draws it: Mutations, Structural Variants / Fusions, Copy Number Alterations. */
export const EVENT_TREE: { mutation: EventNode; sv: EventNode; cna: EventNode } = {
  mutation: parent("Mutations", [], [
    leaf("Missense", "missense"),
    parent("Inframe", ["inframe"], [leaf("Inframe Insertion", "inframe_ins"), leaf("Inframe Deletion", "inframe_del")]),
    parent("Truncating", ["truncating"], [
      leaf("Nonsense", "nonsense"),
      parent("Frameshift", ["frameshift"], [leaf("Frameshift Insertion", "frameshift_ins"), leaf("Frameshift Deletion", "frameshift_del")]),
      leaf("Nonstart", "nonstart"), leaf("Nonstop", "nonstop"), leaf("Splice", "splice"),
    ]),
    leaf("Other", "other"),
  ]),
  sv: leaf("Structural Variants / Fusions", "sv"),
  cna: parent("Copy Number Alterations", [], [leaf("Amplification", "amp"), leaf("Deletion", "homdel")]),
};

/** the events in canonical order, without repeats or unknown names; null when one is not a known event */
export function normalizeEvents(events: readonly string[]): AlterationEvent[] | null {
  const set = new Set(events);
  if ([...set].some((e) => !(ALTERATION_EVENTS as string[]).includes(e))) return null;
  return ALTERATION_EVENTS.filter((e) => set.has(e));
}

/**
 * How the selected mutation units filter mutation_type, by the portal's backend rule (AlterationFilter,
 * ClickhouseAlterationFilterMapper.xml): every unit → no filter, so types outside the tree (5'Flank,
 * Intron, Fusion) count; Other selected → every type but the unselected units' (unknown types count);
 * Other not selected → only the selected units' types. null when no mutation unit is selected.
 */
export function mutationTypeFilter(events: readonly AlterationEvent[]): { op: "all" } | { op: "in" | "not in"; types: string[] } | null {
  const on = MUTATION_UNIT_LIST.filter((u) => events.includes(u));
  if (!on.length) return null;
  if (on.length === MUTATION_UNIT_LIST.length) return { op: "all" };
  if (on.includes("other")) return { op: "not in", types: MUTATION_UNIT_LIST.filter((u) => !on.includes(u)).flatMap((u) => [...MUTATION_UNITS[u]]) };
  return { op: "in", types: on.flatMap((u) => [...MUTATION_UNITS[u]]) };
}

/** the profile types the selection draws on: a type none of whose events is selected is left out of profiled too */
export function eventProfileTypes(events: readonly AlterationEvent[]): string[] {
  return [
    ...(MUTATION_UNIT_LIST.some((u) => events.includes(u)) ? ["MUTATION_EXTENDED"] : []),
    ...(events.includes("amp") || events.includes("homdel") ? ["COPY_NUMBER_ALTERATION"] : []),
    ...(events.includes("sv") ? ["STRUCTURAL_VARIANT"] : []),
  ];
}

/** the selection in words, for a title and the caption */
export function eventsWord(events: readonly AlterationEvent[]): string {
  const mut = mutationTypeFilter(events);
  const parts: string[] = [];
  if (mut) parts.push(mut.op === "all" ? "mutation" : "mutation (" + MUTATION_UNIT_LIST.filter((u) => events.includes(u)).map(unitLabel).join(", ") + ")");
  if (events.includes("amp") && events.includes("homdel")) parts.push("amplification or deep deletion");
  else if (events.includes("amp")) parts.push("amplification");
  else if (events.includes("homdel")) parts.push("deep deletion");
  if (events.includes("sv")) parts.push("structural variant");
  return parts.length > 1 ? parts.slice(0, -1).join(", ") + " or " + parts[parts.length - 1] : parts[0] || "nothing";
}

const UNIT_LABEL: Record<MutationUnit, string> = {
  missense: "missense", inframe: "other inframe", inframe_del: "inframe deletion", inframe_ins: "inframe insertion",
  truncating: "other truncating", nonsense: "nonsense", frameshift: "other frameshift", frameshift_del: "frameshift deletion",
  frameshift_ins: "frameshift insertion", nonstart: "nonstart", nonstop: "nonstop", splice: "splice", other: "other",
};
const unitLabel = (u: MutationUnit) => UNIT_LABEL[u];
