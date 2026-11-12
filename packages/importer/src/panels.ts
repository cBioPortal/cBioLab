// Gene panel definitions (`data_gene_panel_*.txt`). Panels are global, as in cBioPortal: a study
// names a panel by stable id, and a panel already in the database is kept as it is.
// Legacy rule (notes/legacy-java-importer.md P5): a panel with any gene that does not resolve, or
// that resolves twice, is not imported at all.
import { insertAll, query, sq, type WriteConn } from "./ch-write.ts";
import type { GeneResolver } from "./genes.ts";
import { parseMeta } from "./study.ts";

export async function importGenePanel(conn: WriteConn, genes: GeneResolver, text: string): Promise<{ id?: string; warning?: string }> {
  const meta = parseMeta(text);
  const id = meta.stable_id;
  if (!id) return { warning: "no stable_id" };
  const exists = await query(conn, "SELECT 1 FROM gene_panel WHERE stable_id = " + sq(id) + " LIMIT 1");
  if (exists.length) return { id };
  const symbols = (meta.gene_list || "").split("\t").map((s) => s.trim()).filter(Boolean);
  const entrez = new Set<number>();
  const unresolved: string[] = [];
  for (const s of symbols) {
    const g = genes.forPanel(s);
    if (!g) unresolved.push(s);
    else entrez.add(g.entrez);
  }
  if (unresolved.length || entrez.size !== symbols.length)
    return { warning: "panel " + id + " not imported: " + (unresolved.length ? "unknown genes " + unresolved.slice(0, 10).join(", ") : "a gene is listed twice") };
  const next = await query<{ m: number }>(conn, "SELECT max(internal_id) AS m FROM gene_panel");
  const internalId = Number(next[0]?.m ?? 0) + 1;
  await insertAll(conn, "gene_panel", [{ internal_id: internalId, stable_id: id, description: meta.description ?? null }]);
  await insertAll(conn, "gene_panel_list", [...entrez].map((e) => ({ internal_id: internalId, gene_id: e })));
  return { id };
}
