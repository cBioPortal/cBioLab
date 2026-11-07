// Where a gene lies on hg19 or hg38: the span of its RefSeq mRNAs in IGV's refGene annotation
// (lib/gene-loci-data.ts, written by scripts/gen-gene-loci.ts). The warehouse records a gene's
// chromosome and cytoband but not its coordinates, so this is the one place a view finds them.
// Decoded on first use, per build.
import { GENE_LOCI_DATA } from "./gene-loci-data.ts";

export interface GeneLocus { gene: string; chrom: string; start: number; end: number }

const decoded = new Map<string, Map<string, GeneLocus>>();

/** a build's encoded table, decoded: per chromosome line, "SYMBOL,startDelta,length" in hex */
export function decodeLoci(text: string): Map<string, GeneLocus> {
  const out = new Map<string, GeneLocus>();
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const chrom = line.slice(0, colon);
    let pos = 0;
    for (const entry of line.slice(colon + 1).split(";")) {
      const [gene, d, len] = entry.split(",");
      if (!gene || d == null || len == null) continue;
      pos += parseInt(d, 16);
      out.set(gene.toUpperCase(), { gene, chrom, start: pos, end: pos + parseInt(len, 16) });
    }
  }
  return out;
}

/** `gene`'s span on `build` (0-based start, end exclusive, as refGene gives them), or null when refGene has no mRNA for it */
export function geneLocus(gene: string, build: "hg19" | "hg38"): GeneLocus | null {
  let m = decoded.get(build);
  if (!m) { m = decodeLoci(GENE_LOCI_DATA[build]); decoded.set(build, m); }
  return m.get(String(gene).trim().toUpperCase()) || null;
}
