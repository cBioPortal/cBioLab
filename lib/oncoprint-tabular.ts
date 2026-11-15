// Contract -> the portal's "Tabular" download (tabularDownload.ts getTabularDownloadData) and its
// order file (ResultsViewOncoprint.tsx). A row per track and kind of data, a column per case drawn:
// CLINICAL rows, then each gene's CNA, MUTATIONS, MRNA, PROTEIN and STRUCTURAL_VARIANT rows, then a
// group per heatmap profile kind ("HEATMAP MRNA_EXPRESSION Z-SCORE"), then ours alone, DERIVED.
import { BITS, NOT_PROFILED } from "./oncoprint-assemble.ts";
import { STYLE, numericValue } from "./oncoprint-style.ts";
import { fmtFloat32 } from "./chart/format.ts";
import type { Contract, Track } from "./types.ts";

type Unit = Contract["unit"];
type CellTrack = Omit<Track, "cells" | "values"> & { cells: ArrayLike<number>; values?: ArrayLike<number> };
/** a contract, or one unpacked from the binary transport (its columns read lazily) */
export interface TabularSource {
  unit?: Unit;
  columns: string[] | (() => string[]);
  tracks: CellTrack[];
  display?: { annotate?: string; showUnaltered?: boolean };
}

const GENETIC = ["CNA", "MUTATIONS", "MRNA", "PROTEIN", "STRUCTURAL_VARIANT"] as const;

// the portal's texts per mutation class (tabularDownload.ts mutationMap); splice and other, which
// it leaves as raw codes ("splice_rec"), are named the same way
const MUTATION_TEXT: Record<string, string> = {
  TRUNCATING: "Truncating mutation", SPLICE: "Splice Mutation", INFRAME: "Inframe Mutation",
  PROMOTER: "Promoter Mutation", MISSENSE: "Missense Mutation", OTHER_MUT: "Other Mutation"
};
const DRIVER = " (putative driver)", PASSENGER = " (putative passenger)";

/** a gene cell's text in one genetic group; "" when it has none of that kind or was not profiled */
export function geneticText(code: number, group: typeof GENETIC[number], annotated: boolean): string {
  if (code === NOT_PROFILED || code <= 0) return "";
  if (group === "MUTATIONS") {
    // the class drawn: a cell holds only its driver mutations' classes when it has one
    const m = STYLE.glyph.mutation.priority.find((p) => code & BITS[p.bit as keyof typeof BITS]);
    if (!m) return "";
    const text = MUTATION_TEXT[m.bit];
    return !annotated || m.bit === "PROMOTER" ? text : text + (code & BITS.MUT_DRIVER ? DRIVER : PASSENGER);
  }
  if (group === "CNA") {
    const text = code & BITS.AMP ? "Amplification" : code & BITS.HOMDEL ? "Deep Deletion" : "";
    return text && annotated && code & BITS.CNA_DRIVER ? text + DRIVER : text;
  }
  if (group === "STRUCTURAL_VARIANT")
    return code & BITS.SV ? "Structural Variant" + (annotated && code & BITS.SV_DRIVER ? DRIVER : "") : "";
  if (group === "MRNA") return code & BITS.MRNA_HIGH ? "mRNA High" : code & BITS.MRNA_LOW ? "mRNA Low" : "";
  return code & BITS.PROT_HIGH ? "Protein High" : code & BITS.PROT_LOW ? "Protein Low" : "";
}

function clinicalText(t: CellTrack, i: number): string {
  const c = t.cells[i];
  if (t.numeric) {
    if (c === -1) return "";
    const x = t.values ? t.values[i] : undefined;
    return x != null && !Number.isNaN(x) ? fmtFloat32(x) : String(Math.round(numericValue(t as Track, c) * 100) / 100);
  }
  if (c === -1) return t.profiledFor ? STYLE.glyph.profiled.no : "";
  return (t.categories && t.categories[c]) ?? "Other";
}

/**
 * The Tabular download. `order` is the columns as drawn (the page's sort, Show unaltered), as
 * indices into the contract's columns; without it, the contract's order, less the unaltered
 * columns when its display hides them.
 */
export function contractToTsv(contract: TabularSource, order?: ArrayLike<number>): string {
  const all = typeof contract.columns === "function" ? contract.columns() : contract.columns;
  const genesOf = contract.tracks.filter((t) => t.kind === "gene");
  const idx = order ? Array.from(order) : all.map((_, i) => i)
    .filter((i) => contract.display?.showUnaltered !== false || genesOf.some((t) => t.cells[i] > 0));
  const annotated = (contract.display?.annotate ?? "none") !== "none";
  const lines: string[] = ["track_name\ttrack_type\t" + idx.map((i) => all[i]).join("\t")];
  const row = (name: string, type: string, val: (i: number) => string) =>
    lines.push(name + "\t" + type + "\t" + idx.map(val).join("\t"));

  for (const t of contract.tracks) {
    if (t.kind !== "clinical") continue;
    const name = t.name || t.label;
    if (t.stack && t.values) {
      // one row per category, "<name> (C>A)", its counts
      const k = t.stack.length, v = t.values;
      t.stack.forEach((cat, j) => row(name + " (" + cat + ")", "CLINICAL", (i) => t.cells[i] === -1 ? "" : String(v[t.cells[i] * k + j])));
    } else row(name, "CLINICAL", (i) => clinicalText(t, i));
  }

  // the same gene twice (two tracks with one label) is one row per group, its values joined
  const genes = new Map<string, CellTrack[]>();
  for (const t of contract.tracks) if (t.kind === "gene") genes.set(t.label, [...(genes.get(t.label) || []), t]);
  for (const group of GENETIC)
    for (const [label, ts] of genes)
      row(label, group, (i) => {
        const texts: string[] = [];
        for (const t of ts) { const s = geneticText(t.cells[i], group, annotated); if (s && !texts.includes(s)) texts.push(s); }
        return texts.join(", ");
      });

  const heat = new Map<string, CellTrack[]>();
  for (const t of contract.tracks) if (t.kind === "heatmap") {
    const type = "HEATMAP " + (t.profileKind || t.profileType || "");
    heat.set(type, [...(heat.get(type) || []), t]);
  }
  for (const [type, ts] of heat)
    for (const t of ts) row(t.gene || t.label, type, (i) => {
      const x = t.values ? t.values[i] : NaN;
      return t.cells[i] === -1 || x == null || Number.isNaN(x) ? "" : fmtFloat32(x);
    });

  for (const t of contract.tracks) if (t.kind === "derivedEvent") row(t.label, "DERIVED", (i) => t.cells[i] > 0 ? "yes" : "no");
  return lines.join("\n") + "\n";
}

const caseWord = (unit: Unit): string => unit === "sample" ? "Sample" : "Patient";
export const tabularFileName = (unit: Unit): string => (unit === "sample" ? "SAMPLE" : "PATIENT") + "_DATA_oncoprint.tsv";
export const orderFileName = (unit: Unit): string => "OncoPrint" + caseWord(unit) + "s.txt";
export const orderFileText = (unit: Unit, ids: string[]): string =>
  caseWord(unit) + " order in the Oncoprint is:\n" + ids.map((id) => id + "\n").join("");
