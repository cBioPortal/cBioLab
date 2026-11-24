/**
 * The Study View's grid as the portal lays it out (STS-LY-1…3): a cell of 195 × 170 px with 7 px
 * between cells (the portal's 5, and 2 more), as many columns as the width holds, each chart a whole number of cells by its
 * kind, placed in priority order into the first free spot (`calculateLayout` / `findSpot`,
 * `StudyViewUtils.tsx`).
 */

/** one cell, as the portal's (`StudyViewConfig.ts` layout), and the gap between cells and around the
 * grid: 7 px, the portal's 5 and 2 more by the user's choice (2026-11-24) */
export const GRID_CELL = { w: 195, h: 170, margin: 7 } as const;

/** the grid's width in px for `cols` columns: cols·195 + (cols+1)·7 */
export const gridWidth = (cols: number): number => cols * GRID_CELL.w + (cols + 1) * GRID_CELL.margin;

/** the columns for a window `windowWidth` px wide, as the portal counts them, with our gap: floor((window − 40) / (195 + 7)), at least one */
export function gridCols(windowWidth: number): number {
  return Math.max(1, Math.floor((windowWidth - 40) / (GRID_CELL.w + GRID_CELL.margin)));
}

/** what a card draws, as far as its size goes (STS-LY-2) */
export type CardKind =
  | "pie"            // a categorical chart drawn as a pie
  | "survival"
  | "bar"            // a numeric chart's histogram
  | "list"           // a categorical chart drawn as a table of values (the portal's pie-as-table)
  | "table"          // gene, treatment, frequency, case-list, data-type and study tables
  | "density"
  | "violin";

/**
 * A card's size in cells, w × h, as the portal's defaults: a pie or survival chart 1×1, a bar
 * chart 2×1, a table, the density and the violin 2×2; a categorical chart drawn as a table is
 * 2×1 up to 4 rows and 2×2 past that (`StudyViewPageStore.ts:9152-9167`).
 */
export function chartCells(kind: CardKind, rows = 0): { w: number; h: number } {
  switch (kind) {
    case "pie": case "survival": return { w: 1, h: 1 };
    case "bar": return { w: 2, h: 1 };
    case "list": return rows <= 4 ? { w: 2, h: 1 } : { w: 2, h: 2 };
    default: return { w: 2, h: 2 };
  }
}

/** a card to lay out: its key, its size in cells, and its rank (`priority` absent: a chart the reader added) */
export type CardSpec = { key: string; w: number; h: number; name: string; priority?: number };

/**
 * The portal's first-load order (STS-LY-3): the ranked cards by priority, highest first, then by
 * name A–Z; then the cards the reader added, in the order they were added.
 */
export function orderCards<T extends CardSpec>(cards: T[]): T[] {
  const ranked = cards.filter((c) => c.priority != null).sort((a, b) => b.priority! - a.priority! || a.name.localeCompare(b.name));
  return [...ranked, ...cards.filter((c) => c.priority == null)];
}

/**
 * Each card, in order, in the first spot it fits: rows top to bottom, then left to right
 * (`findSpot`). A card wider than the grid is narrowed to it.
 */
export function findSpotLayout(cards: { key: string; w: number; h: number }[], cols: number): { i: string; x: number; y: number; w: number; h: number }[] {
  const taken: boolean[][] = [];
  const free = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (taken[r]?.[c]) return false;
    return true;
  };
  return cards.map(({ key, w: w0, h }) => {
    const w = Math.min(w0, cols);
    let y = 0;
    for (;; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (!free(x, y, w, h)) continue;
        for (let r = y; r < y + h; r++) { taken[r] ??= []; for (let c = x; c < x + w; c++) taken[r][c] = true; }
        return { i: key, x, y, w, h };
      }
    }
  });
}

/**
 * A survival chart's title, as the portal's (STS-KM-1): "KM Plot: " + its status attribute's name
 * without "status" or "survival" + " (months)", e.g. "KM Plot: Overall (months)".
 */
export function kmPlotTitle(statusName: string): string {
  return "KM Plot: " + statusName.replace(/\b(status|survival)\b/gi, " ").replace(/\s+/g, " ").trim() + " (months)";
}
