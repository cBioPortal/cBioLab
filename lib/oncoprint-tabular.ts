// Contract -> tab-separated table, the portal's "Tabular" download shape:
// one row per track (track_name, track_type, then one column per case in oncoprint order).
import { BITS, NOT_PROFILED } from "./oncoprint-assemble.ts";
import type { Contract } from "./types.ts";

export function geneCellLabel(code: number): string {
  if (code === NOT_PROFILED) return "not profiled";
  if (code <= 0) return "";
  const drv = code & BITS.DRIVER ? " (putative driver)" : " (unknown significance)";
  const parts: string[] = [];
  if (code & BITS.MISSENSE) parts.push("Missense Mutation" + drv);
  if (code & BITS.TRUNCATING) parts.push("Truncating Mutation" + drv);
  if (code & BITS.INFRAME) parts.push("Inframe Mutation" + drv);
  if (code & BITS.SPLICE) parts.push("Splice Mutation" + drv);
  if (code & BITS.OTHER_MUT) parts.push("Other Mutation" + drv);
  if (code & BITS.SV) parts.push("Structural Variant" + drv);
  if (code & BITS.AMP) parts.push("Amplification");
  if (code & BITS.HOMDEL) parts.push("Deep Deletion");
  return parts.join(", ");
}

export function contractToTsv(contract: Contract): string {
  const lines: string[] = ["track_name\ttrack_type\t" + contract.columns.join("\t")];
  for (const t of contract.tracks) {
    const cells = t.cells as ArrayLike<number>;
    const vals: string[] = new Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (t.kind === "gene") vals[i] = geneCellLabel(c);
      else if (t.kind === "derivedEvent") vals[i] = c > 0 ? "yes" : "no";
      else if (t.numeric) vals[i] = c === -1 ? "" : String(Math.round(((t.min ?? 0) + (c / 255) * ((t.max ?? 1) - (t.min ?? 0))) * 100) / 100);
      else vals[i] = c === -1 ? "" : (t.categories && t.categories[c]) ?? "Other";
    }
    const type = t.kind === "gene" ? "GENE" : t.kind === "heatmap" ? "HEATMAP " + (t.profileType || "") : t.kind === "derivedEvent" ? "DERIVED" : "CLINICAL";
    lines.push(t.label + "\t" + type + "\t" + vals.join("\t"));
  }
  return lines.join("\n") + "\n";
}
