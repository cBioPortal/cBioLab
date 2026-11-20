"use client";
/**
 * The Study View's chart grid, laid out as the portal's (STS-LY-1…3) with the portal's own grid
 * library, react-grid-layout: 195 × 170 px cells 5 px apart, as many columns as the page holds,
 * each card a whole number of cells by its kind, placed in priority order into the first free spot.
 * Cards keep their places: no drag and no resize (decided against, 2026-11-13).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactGridLayout, { useContainerWidth } from "react-grid-layout";
import { absoluteStrategy, verticalCompactor } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import { CARD_PRIORITY } from "../../lib/study-view-config.ts";
import { GRID_CELL, findSpotLayout, gridCols, gridWidth, orderCards, type CardSpec } from "../../lib/study-view-layout.ts";

/** a card on the grid: its place in the layout (`lib/study-view-layout.ts`) and what it draws */
export type GridCard = CardSpec & { node: ReactNode };

/** the portal's rank and name for a card that is not a clinical attribute's (STS-LY-8), by its card's selector */
export function cardRank(selector: string): { name: string; priority: number } {
  const r = CARD_PRIORITY.find((c) => c.selector === selector);
  if (!r) throw new Error("no rank for " + selector);
  return { name: r.name, priority: r.priority };
}

const MARGIN: [number, number] = [GRID_CELL.margin, GRID_CELL.margin];

/** the window's width, followed as it resizes (`fallback` before the first read) */
function useWindowWidth(fallback: number): number {
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setW(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return w ?? fallback;
}

export function StudyViewGrid({ cards }: { cards: GridCard[] }) {
  // measured only to know the page has laid out; the columns follow the window, as the portal's
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const windowWidth = useWindowWidth(width);
  const cols = gridCols(windowWidth);
  const ordered = useMemo(() => orderCards(cards), [cards]);
  const layout = useMemo(() => findSpotLayout(ordered, cols), [ordered, cols]);
  return (
    <div ref={containerRef} className="svgridbox">
      {mounted && (
        <ReactGridLayout className="svgrid" width={gridWidth(cols)} layout={layout} style={{ width: gridWidth(cols) }}
          gridConfig={{ cols, rowHeight: GRID_CELL.h, margin: MARGIN, containerPadding: MARGIN }}
          dragConfig={{ enabled: false }} resizeConfig={{ enabled: false }}
          compactor={verticalCompactor} positionStrategy={absoluteStrategy}>
          {ordered.map((c) => <div key={c.key} className="svcell" data-cell={c.key}>{c.node}</div>)}
        </ReactGridLayout>
      )}
    </div>
  );
}
