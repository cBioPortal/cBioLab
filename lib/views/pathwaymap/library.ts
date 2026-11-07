// PathwayMapper's pathway library (library-data.ts, vendored) read the way PathwayMapper reads it
// (SaveLoadUtility.parseGraph in pathway-mapper 2.3.0): each pathway's nodes with their positions and
// sizes, its edges, and the gene nodes that matching and frequencies are about. Browser-safe: the
// figure draws from it, and the page lists the pathways from it.
import { PATHWAY_MAPPER_LIBRARY } from "./library-data.ts";

export type NodeType = "GENE" | "FAMILY" | "COMPLEX" | "COMPARTMENT" | "PROCESS";
export type EdgeType = "ACTIVATES" | "INHIBITS" | "INDUCES" | "REPRESSES" | "BINDS" | "NONE";

export interface PathwayNode {
  id: string; name: string; type: NodeType;
  /** the compound node (family, complex, compartment) it sits in, or null */
  parent: string | null;
  /** its centre and size in the diagram's own units, as PathwayMapper stores them */
  x: number; y: number; w: number; h: number;
}
export interface PathwayEdge { id: string; source: string; target: string; type: EdgeType }
export interface Pathway {
  name: string; description: string;
  /** one of the ten pathways of the TCGA PanCanAtlas (Sanchez-Vega et al. 2018), which the portal lists by default */
  pancan: boolean;
  nodes: PathwayNode[]; edges: PathwayEdge[];
  /** the names of its GENE nodes, once each, in the order they are listed — what a query gene matches and what a percentage ranking divides by */
  genes: string[];
}

/** PathwayMapper's TCGA_PANCAN_PATHWAY_NAMES (Ranking.tsx): the pathways its "TCGA PanCancer Atlas pathways only" box keeps */
export const PANCAN_PATHWAYS = ["Cell Cycle", "HIPPO", "MYC", "NOTCH", "NRF2", "PI3K", "RTK-RAS", "TGF-Beta", "TP53", "WNT"];

const NODE_TYPES = new Set<string>(["GENE", "FAMILY", "COMPLEX", "COMPARTMENT", "PROCESS"]);
const EDGE_TYPES = new Set<string>(["ACTIVATES", "INHIBITS", "INDUCES", "REPRESSES", "BINDS", "NONE"]);

/**
 * One pathway's lines, read as parseGraph reads them: the title on the first line, the description
 * up to the node table's header, nodes until a blank line, then (after the edge header) edges until
 * the next blank line. A node without its own size is 150 × 52, a process as wide as its name.
 */
export function parsePathway(lines: string[]): Pathway {
  const name = lines[0];
  let i = lines.findIndex((l) => l.includes("--NODE_NAME"));
  if (i < 0) throw new Error("pathway “" + name + "” has no node table");
  const description = lines.slice(2, i).filter((l) => l.trim()).join("\n");
  const nodes: PathwayNode[] = [];
  for (i++; i < lines.length && lines[i] !== ""; i++) {
    const f = lines[i].split("\t");
    const type = f[2];
    if (!NODE_TYPES.has(type)) throw new Error("pathway “" + name + "”: unknown node type " + type);
    const sized = f.length > 7;
    nodes.push({
      id: f[1], name: f[0], type: type as NodeType, parent: f[3] && f[3] !== "-1" ? f[3] : null,
      x: Number.parseInt(f[4] ?? "0", 10), y: Number.parseInt(f[5] ?? "0", 10),
      w: sized ? Number(f[6]) : type === "PROCESS" ? f[0].length * 6 + 24 : 150,
      h: sized ? Number(f[7]) : type === "PROCESS" ? 24 : 52,
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.parent && !ids.has(n.parent)) n.parent = null;
  const edges: PathwayEdge[] = [];
  for (i += 2; i < lines.length && lines[i] !== ""; i++) {
    const f = lines[i].split("\t");
    if (!EDGE_TYPES.has(f[3])) throw new Error("pathway “" + name + "”: unknown edge type " + f[3]);
    if (ids.has(f[1]) && ids.has(f[2])) edges.push({ id: f[0], source: f[1], target: f[2], type: f[3] as EdgeType });
  }
  const genes = [...new Set(nodes.filter((n) => n.type === "GENE").map((n) => n.name))];
  return { name, description, pancan: PANCAN_PATHWAYS.includes(name), nodes, edges, genes };
}

/** every pathway of the library, in its own order */
export const PATHWAYS: Pathway[] = Object.values(PATHWAY_MAPPER_LIBRARY).map(parsePathway);
export const PATHWAY_NAMES: string[] = PATHWAYS.map((p) => p.name);
const BY_NAME = new Map(PATHWAYS.map((p) => [p.name, p]));
export const pathwayNamed = (name: string): Pathway | undefined => BY_NAME.get(name);

/** a gene symbol as the warehouse spells them; a gene node named otherwise ("NF-kB", "WNT ligands") is a label, not a gene */
export const GENE_SYMBOL = /^[A-Z0-9][A-Z0-9-]{0,19}$/;

/**
 * Gene node names spelled like symbols that name no gene in cBioPortal's gene table (checked against
 * cbioportal.org's /api/genes on 2026-11-07, as the portal checks a pathway's genes before fetching
 * their data): families and complexes drawn as one node (AKT, PI3K, RAF, WNT), retired symbols
 * (FAM123B, GNB2L1, NOV), a misspelling (MALM3) and viral genes (HPVE6). The portal draws them without
 * data, and so does this view.
 */
const NOT_GENES = new Set(["4E-BP1", "ACTIVIN", "AKT", "AMPK", "E2F", "FAM123B", "FGFR", "FOXO", "GNB2L1", "HES-X", "HEY-X", "HPVE6", "HPVE7",
  "MALM3", "NOTCH", "NOV", "NTR1", "NTR2", "NTR3", "PI3K", "RAF", "SFRP3", "TAZ", "TGF-B", "TNFR", "WNT"]);

/** whether a gene node names a gene the view can count, rather than a group or a name no gene table has */
export const isGene = (name: string): boolean => GENE_SYMBOL.test(name) && !NOT_GENES.has(name);

/** every gene node name of every pathway that names a gene, sorted: what the view counts */
export const LIBRARY_GENES: string[] = [...new Set(PATHWAYS.flatMap((p) => p.genes))].filter(isGene).sort();
