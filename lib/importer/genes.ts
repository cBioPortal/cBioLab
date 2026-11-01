// Gene resolution, as the legacy importer does it (notes/legacy-java-importer.md §G). The rules
// differ by file type and those differences decide which rows survive, so each caller picks its
// rule by name rather than sharing one "resolve" that would be right for none of them.
import { query, type WriteConn } from "./ch-write.ts";

export interface Gene { entrez: number; hugo: string; type: string | null; entityId: number }

// The legacy disambiguation file (cbioportal-core gene_symbol_disambiguation.txt); keys are
// matched case-sensitively, and only by the MAF/SV/MutSig/GISTIC path.
const DISAMBIGUATION: Record<string, number> = { MLL2: 8085, CDC2: 983 };

export class GeneResolver {
  private readonly byEntrez = new Map<number, Gene>();
  private readonly byHugo = new Map<string, Gene>();
  private readonly byAlias = new Map<string, Gene[]>();
  private byEntityId: Map<number, Gene> | null = null;

  static async load(conn: WriteConn): Promise<GeneResolver> {
    const genes = await query<{ e: number; h: string; t: string | null; g: number }>(conn,
      "SELECT entrez_gene_id AS e, hugo_gene_symbol AS h, type AS t, genetic_entity_id AS g FROM gene");
    const aliases = await query<{ e: number; a: string }>(conn, "SELECT entrez_gene_id AS e, gene_alias AS a FROM gene_alias");
    return GeneResolver.fromRows(genes.map((g) => ({ entrez: Number(g.e), hugo: g.h, type: g.t, entityId: Number(g.g) })),
      aliases.map((a) => ({ entrez: Number(a.e), alias: a.a })));
  }

  static fromRows(genes: Gene[], aliases: { entrez: number; alias: string }[]): GeneResolver {
    const r = new GeneResolver();
    for (const gene of genes) {
      r.byEntrez.set(gene.entrez, gene);
      r.byHugo.set(gene.hugo.toUpperCase(), gene);
    }
    for (const a of aliases) {
      const gene = r.byEntrez.get(a.entrez);
      if (!gene) continue;
      const key = a.alias.toUpperCase();
      const list = r.byAlias.get(key);
      if (!list) r.byAlias.set(key, [gene]);
      else if (!list.includes(gene)) list.push(gene);
    }
    return r;
  }

  entrez(id: number): Gene | null { return this.byEntrez.get(id) ?? null; }

  /** The gene whose genetic entity id this is. */
  byEntity(entityId: number): Gene | null {
    if (!this.byEntityId || !this.byEntityId.has(entityId)) this.byEntityId = new Map([...this.byEntrez.values()].map((g) => [g.entityId, g]));
    return this.byEntityId.get(entityId) ?? null;
  }

  /** `DaoGeneOptimized.getGene(symbol)`: the gene with this Hugo symbol, ignoring case; aliases are not searched. */
  hugo(symbol: string): Gene | null { return this.byHugo.get(symbol.toUpperCase()) ?? null; }

  /** The lowest Entrez id in use: genes made by an import (phosphoproteins) count down from below it. */
  lowestEntrez(): number { let m = 0; for (const e of this.byEntrez.keys()) if (e < m) m = e; return m; }

  /** Adds a gene the import has just written to the database, with its aliases. */
  add(gene: Gene, aliases: string[]): void {
    this.byEntrez.set(gene.entrez, gene);
    this.byHugo.set(gene.hugo.toUpperCase(), gene);
    for (const a of aliases) {
      const list = this.byAlias.get(a.toUpperCase());
      if (!list) this.byAlias.set(a.toUpperCase(), [gene]);
      else if (!list.includes(gene)) list.push(gene);
    }
  }

  /** Every gene a symbol names: the Hugo match alone if there is one, else every alias match. */
  candidates(symbol: string): Gene[] {
    const key = symbol.toUpperCase();
    const hugo = this.byHugo.get(key);
    if (hugo) return [hugo];
    return this.byAlias.get(key) ?? [];
  }

  /**
   * `getNonAmbiguousGene`: a numeric string is an Entrez id; then Hugo; then a unique alias; then
   * the disambiguation file. Used by mutations, SVs and the gene panel matrix's lookups.
   */
  nonAmbiguous(symbol: string): Gene | null {
    if (/^\d+$/.test(symbol)) return this.entrez(Number(symbol));
    const c = this.candidates(symbol);
    if (c.length === 1) return c[0];
    if (c.length > 1 && DISAMBIGUATION[symbol] !== undefined) return this.entrez(DISAMBIGUATION[symbol]);
    return null;
  }

  /**
   * MAF rows: a present, non-zero Entrez id is the authority, and an unknown or non-numeric one
   * (including `NA`) drops the row (no Hugo fallback). Empty or 0 falls back to the symbol.
   * `Unknown` with no Entrez is dropped.
   */
  forMaf(hugo: string, entrezText: string): Gene | null {
    const e = entrezText.trim();
    if (e && e !== "0") {
      if (!/^\d+$/.test(e)) return null;
      return this.entrez(Number(e));
    }
    if (!hugo || hugo === "Unknown") return null;
    return this.nonAmbiguous(hugo);
  }

  /**
   * Tab-delimited profiles (CNA, expression, ...): a non-numeric Entrez drops the line, an
   * unknown numeric one falls back to the symbol; `///` or `---` drops it, `|` truncates it, and
   * an ambiguous alias drops it (no disambiguation file on this path).
   */
  forMatrix(hugo: string, entrezText: string): Gene | null {
    const e = entrezText.trim();
    if (hugo.includes("///") || hugo.includes("---")) return null;
    if (e && e.toUpperCase() !== "NA") {
      if (!/^-?\d+$/.test(e)) return null;
      const g = this.entrez(Number(e));
      if (g) return g;
    }
    const sym = hugo.split("|")[0].trim();
    if (!sym) return null;
    const c = this.candidates(sym);
    return c.length === 1 ? c[0] : null;
  }

  /** Gene panel definitions: numeric is Entrez, otherwise the first candidate wins. */
  forPanel(symbol: string): Gene | null {
    if (/^\d+$/.test(symbol)) return this.entrez(Number(symbol));
    return this.candidates(symbol)[0] ?? null;
  }
}
