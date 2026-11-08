// A browser-only channel between one patient's cards: a click on an alteration table's row asks the
// genomic overview to zoom to its gene (the portal's onMutationTableRowClick / onCnaTableRowClick),
// and the overview's Reset View clears the table's selected row (onResetViewClick). Keyed by the
// patient, so two patients' cards on one page do not hear each other. Nothing here is in the
// document: what is zoomed and what is selected are this browser's (invariant 9).

export type LocusEvent = { kind: "gene"; gene: string } | { kind: "reset" };
type Listener = (e: LocusEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export const patientKey = (study: string, patient: string): string => study + "\u0000" + patient;

/** listen for one patient's events; returns the unsubscribe */
export function onLocus(key: string, fn: Listener): () => void {
  const set = listeners.get(key) ?? new Set<Listener>();
  set.add(fn); listeners.set(key, set);
  return () => { set.delete(fn); if (!set.size) listeners.delete(key); };
}

export function emitLocus(key: string, e: LocusEvent): void {
  for (const fn of [...(listeners.get(key) ?? [])]) fn(e);
}
