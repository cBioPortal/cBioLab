// The warehouse's gene catalog, for the gene query dialog: is a symbol a gene (HUGO), an alias of
// one, or neither; genes and gene sets matching what is being typed; a gene set's members.
// Reference data only — no patient, sample or study is read here.
import { chQuery, DB } from "./ch.ts";
import { sq } from "./compiler.ts";

export type GeneStatus = "gene" | "alias" | "unknown";
export interface GeneCheck {
  symbol: string; status: GeneStatus;
  /** the HUGO symbol(s) an alias stands for; one, mostly */
  hugo?: string[];
  type?: string;
}
export interface GeneHit { symbol: string; type: string; aliasOf?: string }
export interface GeneSetHit { name: string; size: number; description: string }

/** symbols a request may check at once; a gene query names at most 32 */
export const MAX_CHECK = 64;
/** the largest gene set offered whole: an OQL query takes 30 entries, a gene list 32 symbols */
export const MAX_SET_GENES = 30;

const SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

export async function checkGenes(symbols: string[]): Promise<GeneCheck[]> {
  const asked = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  if (asked.length > MAX_CHECK) throw new Error("a request checks at most " + MAX_CHECK + " symbols; this has " + asked.length);
  const bad = asked.filter((s) => !SYMBOL_RE.test(s));
  const ok = asked.filter((s) => SYMBOL_RE.test(s));
  if (!ok.length) return bad.map((symbol) => ({ symbol, status: "unknown" }));
  const list = ok.map(sq).join(", ");
  const [genes, aliases] = await Promise.all([
    chQuery<{ s: string; type: string }>(
      "SELECT upper(hugo_gene_symbol) AS s, any(ifNull(type, '')) AS type FROM " + DB + ".gene\n" +
      "WHERE upper(hugo_gene_symbol) IN (" + list + ") AND entrez_gene_id > 0 GROUP BY s"),
    chQuery<{ a: string; hugo: string[] }>(
      "SELECT upper(a.gene_alias) AS a, groupUniqArray(g.hugo_gene_symbol) AS hugo FROM " + DB + ".gene_alias a\n" +
      "JOIN " + DB + ".gene g ON g.entrez_gene_id = a.entrez_gene_id\n" +
      "WHERE upper(a.gene_alias) IN (" + list + ") AND a.entrez_gene_id > 0 GROUP BY a"),
  ]);
  const isGene = new Map(genes.data.map((r) => [r.s, r.type]));
  const aliasOf = new Map(aliases.data.map((r) => [r.a, r.hugo.slice().sort()]));
  return asked.map((symbol): GeneCheck => {
    if (isGene.has(symbol)) return { symbol, status: "gene", type: isGene.get(symbol) || undefined };
    const hugo = aliasOf.get(symbol);
    if (hugo?.length) return { symbol, status: "alias", hugo };
    return { symbol, status: "unknown" };
  });
}

/** genes whose symbol (or an alias) starts with `q`, protein-coding first; gene sets whose name holds it */
export async function searchGenes(q0: string): Promise<{ genes: GeneHit[]; sets: GeneSetHit[] }> {
  const q = q0.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._ -]{0,39}$/.test(q)) return { genes: [], sets: [] };
  const sym = q.replace(/[ _]/g, "");
  const [genes, aliases, sets] = await Promise.all([
    SYMBOL_RE.test(sym) ? chQuery<{ s: string; type: string }>(
      "SELECT hugo_gene_symbol AS s, any(ifNull(type, '')) AS type FROM " + DB + ".gene\n" +
      "WHERE startsWith(upper(hugo_gene_symbol), " + sq(sym) + ") AND entrez_gene_id > 0 GROUP BY s\n" +
      "ORDER BY type = 'protein-coding' DESC, length(s), s LIMIT 10") : Promise.resolve({ data: [] }),
    SYMBOL_RE.test(sym) ? chQuery<{ a: string; s: string }>(
      "SELECT any(a.gene_alias) AS a, g.hugo_gene_symbol AS s FROM " + DB + ".gene_alias a\n" +
      "JOIN " + DB + ".gene g ON g.entrez_gene_id = a.entrez_gene_id\n" +
      "WHERE upper(a.gene_alias) = " + sq(sym) + " AND a.entrez_gene_id > 0 GROUP BY s LIMIT 3") : Promise.resolve({ data: [] }),
    q.length >= 3 ? chQuery<{ name: string; size: string; description: string }>(
      "SELECT s.name AS name, count() AS size, any(s.description) AS description FROM " + DB + ".geneset s\n" +
      "JOIN " + DB + ".geneset_gene sg ON sg.geneset_id = s.id\n" +
      "WHERE positionCaseInsensitive(s.name, " + sq(q.replace(/ /g, "_")) + ") > 0 GROUP BY name\n" +
      "ORDER BY size <= " + MAX_SET_GENES + " DESC, length(name), name LIMIT 8") : Promise.resolve({ data: [] }),
  ]);
  const out: GeneHit[] = aliases.data.filter((r) => r.s.toUpperCase() !== sym).map((r) => ({ symbol: r.s, type: "", aliasOf: r.a }));
  for (const r of genes.data) if (!out.some((h) => h.symbol === r.s)) out.push({ symbol: r.s, type: r.type });
  return { genes: out, sets: sets.data.map((r) => ({ name: r.name, size: Number(r.size), description: r.description })) };
}

/** a gene set's member symbols, refused past MAX_SET_GENES with the limit named */
export async function geneSetMembers(name: string): Promise<string[]> {
  const r = await chQuery<{ s: string }>(
    "SELECT DISTINCT g.hugo_gene_symbol AS s FROM " + DB + ".geneset s\n" +
    "JOIN " + DB + ".geneset_gene sg ON sg.geneset_id = s.id\n" +
    "JOIN " + DB + ".gene g ON g.entrez_gene_id = sg.entrez_gene_id\n" +
    "WHERE s.name = " + sq(name) + " ORDER BY s");
  if (!r.data.length) throw new Error("no gene set named “" + name + "”");
  if (r.data.length > MAX_SET_GENES)
    throw new Error("“" + name + "” has " + r.data.length + " genes; a query takes at most " + MAX_SET_GENES + " — add the ones you want one by one");
  return r.data.map((x) => x.s);
}
