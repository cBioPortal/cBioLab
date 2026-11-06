// A stored id set's withdrawal (db/migrations/0011_id_set_withdrawal.sql, docs/LINKS.md): what its
// owner said, and the refusal everyone opening something that names it is given. Pure and
// browser-safe: the store (lib/id-set-store.ts) refuses with it, the Id lists tab checks a note's
// length with it before sending.
/** What a set's owner said when withdrawing it (db/migrations/0011_id_set_withdrawal.sql). */
export interface IdSetWithdrawal {
  set: string;
  name: string;
  /** who withdrew it: its owner's email */
  by: string;
  /** ISO timestamp */
  at: string;
  note: string | null;
  /** the set its owner points readers to instead, when they named one */
  replacedBy: { id: string; name: string } | null;
}

/** The longest note a withdrawal keeps. */
export const WITHDRAWAL_NOTE_MAX = 1000;

/** A withdrawal note as stored: trimmed, null when empty; refused past the limit. */
export function withdrawalNote(x: unknown): string | null {
  if (x == null) return null;
  if (typeof x !== "string") throw new Error("a withdrawal note must be text");
  const s = x.trim();
  if (s.length > WITHDRAWAL_NOTE_MAX) throw new Error("a withdrawal note holds at most " + WITHDRAWAL_NOTE_MAX + " characters; this one has " + s.length);
  return s || null;
}

/**
 * The refusal a reader sees for a document naming a withdrawn set: which set, who withdrew it,
 * when, why, and where its owner points instead.
 */
export function withdrawnMessage(w: IdSetWithdrawal): string {
  return "stored id set “" + w.name + "” was withdrawn by its owner" + (w.by ? " (" + w.by + ")" : "") + " on " + w.at.slice(0, 10) +
    (w.note ? ": " + w.note.replace(/[.\s]+$/, "") : "") + "." +
    (w.replacedBy ? " Its owner points to “" + w.replacedBy.name + "” (set " + w.replacedBy.id + ") instead." : "");
}
