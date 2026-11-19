// The Genomic Evolution table's browser-side filter: the portal's "Show only selected mutations".
import type { TableRows } from "../../types.ts";
import { EVOLUTION_KEY_COLUMNS, evolutionKey } from "./figure.ts";

/**
 * The mutation table as the portal's "Show only selected mutations" leaves it (PTB-GE-TB-1,
 * showOnlySelectedMutationsInTable): of `all`, every row the table's query keeps in its order, those
 * whose mutation is picked, on one page; with none picked, the table as it is.
 */
export function selectedRows<V, T extends TableRows<V>>(t: T, all: T["rows"], keys: ReadonlySet<string>): T {
  if (!keys.size) return t;
  const at = EVOLUTION_KEY_COLUMNS.map((id) => t.columns.findIndex((c) => c.id === id));
  const rows = all.filter((r) => keys.has(evolutionKey(at.map((i) => i < 0 ? null : r.values[i] as string | number | null))));
  return { ...t, rows, offset: 0, pageSize: Math.max(1, rows.length), total: rows.length };
}
