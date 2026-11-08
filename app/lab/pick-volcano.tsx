"use client";
// The interactive parts of cBioPortal's group-comparison enrichment tabs, shared by the cards that
// reproduce them (diffexpr's expression tabs, assays' generic-assay tabs): a volcano whose points are
// picked by a click and selected by dragging a box over them, and the "High … in" group filter
// over the table. Which points are selected, and which groups listed, are this browser's (invariant 9).
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../_ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "../_ui/dropdown-menu";
import { DrawAtWidth } from "./figure.tsx";
import { TB } from "../_ui/toolbar.ts";
import { cn } from "../../lib/cn";

/**
 * A volcano drawn by `draw` (its points `circle[data-key]`), picked and selected as the portal's:
 * a click on a point picks its key, a drag over points selects theirs, and a click off the points
 * clears the selection.
 */
export function PickVolcano({ draw, deps, onPick, onSelect }: {
  draw: (width: number) => string; deps: unknown[];
  onPick: (key: string) => void; onSelect: (keys: Set<string> | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const at = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = at(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => { if (drag) { const p = at(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } };
  const up = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4) {
      // a click: on a point picks it, off the points clears the selection
      const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof SVGCircleElement && el.dataset.key) as SVGCircleElement | undefined;
      if (under) onPick(under.dataset.key!);
      else onSelect(null);
      return;
    }
    const r = box.current!.getBoundingClientRect();
    const [lx, hx] = [Math.min(d.x0, d.x1) + r.left, Math.max(d.x0, d.x1) + r.left];
    const [ly, hy] = [Math.min(d.y0, d.y1) + r.top, Math.max(d.y0, d.y1) + r.top];
    const inside = new Set<string>();
    box.current!.querySelectorAll<SVGCircleElement>("circle[data-key]").forEach((c) => {
      const b = c.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      if (cx >= lx && cx <= hx && cy >= ly && cy <= hy) inside.add(c.dataset.key!);
    });
    onSelect(inside.size ? inside : null);
  };
  return (
    <div ref={box} className="relative cursor-crosshair select-none touch-none" data-test="pick-volcano"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
      <DrawAtWidth min={320} draw={draw} deps={deps} />
      {drag && <div className="pointer-events-none absolute border border-[var(--accent)] bg-[var(--accent-soft)] opacity-60"
        style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />}
    </div>
  );
}

/** the groups whose higher rows the table lists, as the portal's "High … in" select (`prefix` its words) */
export function GroupFilter({ groups, shown, onShown, prefix, tip }: { groups: string[]; shown: Set<string>; onShown: (s: Set<string>) => void; prefix: string; tip: string }) {
  const label = shown.size === groups.length ? prefix + ": all groups" : shown.size ? prefix + ": " + [...shown].join(", ") : prefix + " ...";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn(TB, "gap-1 font-normal")} data-tip={tip}>
          {label}<ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {groups.map((g) => (
          // stays open, so several can be ticked in one go
          <DropdownMenuCheckboxItem key={g} checked={shown.has(g)} onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => { const n = new Set(shown); if (n.has(g)) n.delete(g); else n.add(g); onShown(n); }}>{g}</DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
