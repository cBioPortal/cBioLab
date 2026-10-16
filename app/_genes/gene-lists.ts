"use client";
// The gene queries this browser has used (recent, kept automatically) and the ones the reader named
// (saved), for the gene query dialog. Browser storage on purpose for now: a convenience per reader,
// never part of a document, and the page works the same when storage is blocked.
import { useCallback, useSyncExternalStore } from "react";
import type { GeneQueryMode } from "../../lib/gene-query.ts";

export interface GeneList { text: string; mode: GeneQueryMode; name?: string; at: number }
interface Store { recent: GeneList[]; saved: GeneList[] }

const KEY = "cbio-lab:gene-lists:v1";
const RECENT_KEPT = 10;
const EMPTY: Store = { recent: [], saved: [] };

let cache: Store | null = null;
const listeners = new Set<() => void>();

function read(): Store {
  if (cache) return cache;
  try {
    const j = JSON.parse(window.localStorage.getItem(KEY) || "null");
    cache = j && Array.isArray(j.recent) && Array.isArray(j.saved) ? j : EMPTY;
  } catch { cache = EMPTY; }
  return cache!;
}
function write(next: Store) {
  cache = next;
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: kept for this page only */ }
  listeners.forEach((l) => l());
}
const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toUpperCase() === b.replace(/\s+/g, " ").trim().toUpperCase();

export function useGeneLists() {
  const store = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, read, () => EMPTY);
  /** a query that was applied: first in recent, once */
  const remember = useCallback((text: string, mode: GeneQueryMode) => {
    if (!text.trim()) return;
    const s = read();
    write({ ...s, recent: [{ text: text.trim(), mode, at: Date.now() }, ...s.recent.filter((r) => !(r.mode === mode && same(r.text, text)))].slice(0, RECENT_KEPT) });
  }, []);
  const save = useCallback((name: string, text: string, mode: GeneQueryMode) => {
    const s = read();
    write({ ...s, saved: [{ name: name.trim(), text: text.trim(), mode, at: Date.now() }, ...s.saved.filter((r) => r.name !== name.trim())] });
  }, []);
  const unsave = useCallback((name: string) => { const s = read(); write({ ...s, saved: s.saved.filter((r) => r.name !== name) }); }, []);
  const forget = useCallback((at: number) => { const s = read(); write({ ...s, recent: s.recent.filter((r) => r.at !== at) }); }, []);
  return { recent: store.recent, saved: store.saved, remember, save, unsave, forget };
}
