// View kinds shown as previews: drawn and usable, but not yet held to invariant 12 (no method
// record, no golden test of their statistic). Each entry says what is pending. The view header
// marks these with a Preview badge, and scripts/check-method-scripts.ts exempts them by this list,
// so a kind leaves both the moment its descriptor's `preview` is removed. Browser-safe.
import { KINDS } from "./views/kinds.ts";
export const PREVIEW_KINDS: Record<string, string> = Object.fromEntries(
  Object.values(KINDS).flatMap((k) => k.preview ? [[k.kind, k.preview]] : []));

/** what a preview kind still lacks, or null for a kind held to the full checks */
export const previewPending = (kind: unknown): string | null =>
  Object.prototype.hasOwnProperty.call(PREVIEW_KINDS, String(kind)) ? PREVIEW_KINDS[String(kind)] : null;
