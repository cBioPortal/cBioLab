"use client";
// The lollipop stem under the pointer, shared with the page's mutation table, which highlights that
// codon's rows as the portal's table does (MUT-LP-11). A hover is browser state (invariant 9): it
// lives here, never in the document.
import { useSyncExternalStore } from "react";
import type { StemHover } from "../../lib/lollipop.ts";

let current: StemHover | null = null;
const listeners = new Set<() => void>();

/** the stem now under the pointer, or null when it left the heads */
export function setStemHover(next: StemHover | null): void {
  if (next === current || (next && current && next.gene === current.gene && next.codon === current.codon)) return;
  current = next;
  for (const f of listeners) f();
}

export function useStemHover(): StemHover | null {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => current, () => null);
}
