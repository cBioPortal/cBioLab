// Contract -> tab-separated table, the portal's "Tabular" download shape:
// one row per track (track_name, track_type, then one column per case in oncoprint order).
import { BITS, NOT_PROFILED } from "./oncoprint-assemble.ts";
import { STYLE, numericValue } from "./oncoprint-style.ts";
import { fmtFloat32 } from "./chart/format.ts";
import type { Contract } from "./types.ts";

export function geneCellLabel(code: number): string {
  if (code === NOT_PROFILED) return "not profiled";
  if (code <= 0) return "";
  // driver status is per glyph, as drawn: the mutation band's and the SV's own bits
  const mut = code & BITS.MUT_DRIVER ? " (putative driver)" : " (unknown significance)";
  const parts: string[] = [];
  if (code & BITS.MISSENSE) parts.push("Missense Mutation" + mut);
  if (code & BITS.TRUNCATING) parts.push("Truncating Mutation" + mut);
  if (code & BITS.INFRAME) parts.push("Inframe Mutation" + mut);
  if (code & BITS.SPLICE) parts.push("Splice Mutation" + mut);
  if (code & BITS.PROMOTER) parts.push("Promoter Mutation" + mut);
  if (code & BITS.OTHER_MUT) parts.push("Other Mutation" + mut);
  if (code & BITS.GERMLINE) parts.push("Germline Mutation");
  if (code & BITS.SV) parts.push("Structural Variant" + (code & BITS.SV_DRIVER ? " (putative driver)" : " (unknown significance)"));
  if (code & BITS.AMP) parts.push("Amplification");
  if (code & BITS.HOMDEL) parts.push("Deep Deletion");
  return parts.join(", ");
}

export function contractToTsv(contract: Contract): string {
  const lines: string[] = ["track_name\ttrack_type\t" + contract.columns.join("\t")];
  for (const t of contract.tracks) {
    const cells = t.cells as ArrayLike<number>;
    if (t.stack && t.values) {
      // one row per category, as the portal writes its mutation spectrum: "<label> (C>A)", the counts
      const k = t.stack.length, v = t.values;
      t.stack.forEach((c, j) => lines.push(t.label + " (" + c + ")\tCLINICAL\t" +
        Array.from(cells, (code) => code === -1 ? "" : String(v[code * k + j])).join("\t")));
      continue;
    }
    const vals: string[] = new Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (t.kind === "gene") vals[i] = geneCellLabel(c);
      else if (t.kind === "derivedEvent") vals[i] = c > 0 ? "yes" : "no";
      else if (t.numeric) {
        const x = t.values ? t.values[i] : undefined;
        vals[i] = c === -1 ? "" : x != null && !Number.isNaN(x) ? fmtFloat32(x) : String(Math.round(numericValue(t, c) * 100) / 100);
      }
      else vals[i] = c === -1 ? (t.profiledFor ? STYLE.glyph.profiled.no : "") : (t.categories && t.categories[c]) ?? "Other";
    }
    const type = t.kind === "gene" ? "GENE" : t.kind === "heatmap" ? "HEATMAP " + (t.profileType || "") : t.kind === "derivedEvent" ? "DERIVED" : "CLINICAL";
    lines.push(t.label + "\t" + type + "\t" + vals.join("\t"));
  }
  return lines.join("\n") + "\n";
}
