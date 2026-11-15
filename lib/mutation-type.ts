// The mutation table's cell rules, as cBioPortal's Mutations tab draws them (cbioportal-frontend
// e9d70fb): the Mutation Type label, colour and tooltip (getCanonicalMutationType.ts 69-166,
// MutationTypeColumnFormatter.tsx 22-184), Variant Type's colour and tooltip
// (VariantTypeColumnFormatter.tsx 20-149), Copy # (DiscreteCNAColumnFormatter.tsx 159-271), Validation
// Status (ValidationStatusColumnFormatter.tsx 13-91) and the Exon cell (ExonColumnFormatter.tsx 46-92,
// the Results View's showTotalNumberOfExons = false). Pure: the table's SQL mirrors the label
// (mutationTypeLabelSql) so search, filters and sort read what the cell shows.
import { CANONICAL } from "./lollipop.ts";

/** the label of each canonical type (MAIN_MUTATION_TYPE_MAP's displayValue); 'other' has none */
const LABEL: Record<string, string> = {
  missense: "Missense", nonsense: "Nonsense", frame_shift_del: "FS del", frame_shift_ins: "FS ins", frameshift: "FS",
  splice_site: "Splice", nonstart: "Nonstart", nonstop: "Nonstop", in_frame_del: "IF del", in_frame_ins: "IF ins", inframe: "IF",
  truncating: "Truncating", fusion: "Fusion", silent: "Silent",
};
const GREEN = "#008000", BLACK = "#000000", SPLICE = "#e5802b", BROWN = "#8b4513", PURPLE = "#8b00c9", PINK = "#cf58bc";
const COLOR: Record<string, string> = {
  missense: GREEN, nonsense: BLACK, frame_shift_del: BLACK, frame_shift_ins: BLACK, frameshift: BLACK, nonstart: BLACK, nonstop: BLACK,
  truncating: BLACK, splice_site: SPLICE, in_frame_del: BROWN, in_frame_ins: BROWN, inframe: BROWN, fusion: PURPLE, silent: PINK,
};
const canonical = (raw: string) => CANONICAL[raw.toLowerCase()] || "other";

/** The cell's text: the canonical type's label, or the stored text where it has none; '' for no type. */
export function mutationTypeLabel(raw: string | null | undefined): string {
  const r = raw ?? "";
  return r === "" ? "" : LABEL[canonical(r)] ?? r;
}
/** The label's colour; the 'other' colour for a type with no label. */
export const mutationTypeColor = (raw: string | null | undefined): string => COLOR[canonical(raw ?? "")] ?? PINK;
/** The stored text as the cell's tooltip, only where it differs from the label other than by case. */
export function mutationTypeTip(raw: string | null | undefined): string | null {
  const r = raw ?? "", label = mutationTypeLabel(r);
  return r && r.toLowerCase() !== label.toLowerCase() ? r : null;
}

/** The same label in SQL over a column of stored types, generated from the one map. */
export function mutationTypeLabelSql(col: string): string {
  const keys = Object.keys(CANONICAL).filter((k) => LABEL[CANONICAL[k]]);
  const quote = (x: string) => "'" + x.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  return "transform(lowerUTF8(ifNull(" + col + ", '')), [" + keys.map(quote).join(", ") + "], [" +
    keys.map((k) => quote(LABEL[CANONICAL[k]])).join(", ") + "], ifNull(" + col + ", ''))";
}

const VARIANT_TIP: Record<string, string> = {
  SNP: "Single Nucleotide Polymorphism", DNP: "Di-Nucleotide Polymorphism", TNP: "Tri-Nucleotide Polymorphism",
  ONP: "Oligo-Nucleotide Polymorphism", INS: "Insertion", DEL: "Deletion",
};
/** Variant Type's colour: SNP/DNP/TNP/ONP green, INS brown, DEL purple, anything else black. */
export function variantTypeColor(v: string | null | undefined): string {
  const u = (v ?? "").toUpperCase();
  return ["SNP", "DNP", "TNP", "ONP"].includes(u) ? GREEN : u === "INS" ? BROWN : u === "DEL" ? PURPLE : BLACK;
}
/** Variant Type's tooltip for the six types it names; none otherwise. */
export const variantTypeTip = (v: string | null | undefined): string | null => VARIANT_TIP[(v ?? "").toUpperCase()] ?? null;

const CN: Record<string, [string, string, string]> = {
  "2": ["Amp", "red", "High-level amplification"], "1": ["Gain", "red", "Low-level gain"], "0": ["Diploid", "black", "Diploid / normal"],
  "-1": ["ShallowDel", "blue", "Shallow deletion"], "-2": ["DeepDel", "blue", "Deep deletion"],
};
/** Copy #'s text for a discrete call; any other number is drawn as DeepDel (the formatter's final else); '' for none. */
export const copyNumberLabel = (n: number | null | undefined): string => n == null ? "" : CN[String(n)]?.[0] ?? "DeepDel";
export const copyNumberColor = (n: number | null | undefined): string => n == null ? "" : CN[String(n)]?.[1] ?? "blue";
export const copyNumberTip = (n: number | null | undefined): string | null => n == null ? "CNA data is not available for this gene." : CN[String(n)]?.[2] ?? null;

/** Each Validation Status cell class's colours (validationStatus.module.scss): the badge's background, or the other text's colour */
export const VALIDATION_STATUS_STYLE: Record<string, { background?: string; color?: string }> = {
  valid: { background: "#ccffcc", color: BLACK }, wildtype: {}, unknown: { background: "#e0e0e0", color: BLACK }, other: { color: "#9d9d9d" },
};

/** The Validation Status cell: V, W or U with the stored text as tooltip, any other text as is, grey. */
export function validationStatusCell(raw: string | null | undefined): { text: string; className: string; tip: string | null } {
  const r = raw ?? "", l = r.toLowerCase();
  if (!r) return { text: "", className: "", tip: null };
  if (l === "valid" || l === "validated") return { text: "V", className: "valid", tip: r };
  if (l === "wildtype") return { text: "W", className: "wildtype", tip: r };
  if (["unknown", "not_tested", "not tested", "none", "na", "n/a"].includes(l)) return { text: "U", className: "unknown", tip: r };
  return { text: r, className: "other", tip: null };
}

/** The Exon cell: the exon number before "/" ("8/11" → "8"). */
export const exonCell = (raw: string | null | undefined): string => (raw ?? "").split("/")[0];
