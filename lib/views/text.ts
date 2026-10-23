// What several kinds' results text shares (lib/views/<kind>/kind.ts): how a table view lists its rows.

/** a timeline's events listed in text (MCP); the figure draws every one */
export const TIMELINE_TEXT_EVENTS = 400;

/** A table view's first rows, shown columns only, tab-separated — the web app's view pages and downloads every row. */
export function tableText(t: { columns: { id: string }[]; shown: string[]; rows: { cohort: string; values: unknown[] }[]; total: number }): string {
  const idx = t.shown.map((id) => t.columns.findIndex((c) => c.id === id)).filter((i) => i >= 0);
  const shown = t.rows.slice(0, 50);
  return `the first ${shown.length}, tab-separated (the web app's view pages and downloads every row, with every column):\n` +
    [["cohort", ...idx.map((i) => t.columns[i].id)], ...shown.map((r) => [r.cohort, ...idx.map((i) => r.values[i])])]
      .map((xs) => "  " + xs.map((x) => String(x ?? "").replace(/[\t\n]+/g, " ")).join("\t")).join("\n") +
    (t.total > shown.length ? `\n  … ${(t.total - shown.length).toLocaleString()} more rows` : "");
}
