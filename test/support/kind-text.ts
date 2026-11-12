// A view kind's paragraphs of the results text (lib/views/<kind>/kind.ts `text`), written with a
// stand-in context: p-values as JavaScript writes them, and no caveat, note, plot unit or method,
// so a test reads exactly what the kind itself says.
import type { TextContext } from "../../lib/views/kind-def.ts";

export function kindText(kind: { text?: (v: never, t: TextContext) => void | false }, v: unknown): string[] {
  const out: string[] = [];
  kind.text!(v as never, { out, pFmt: String, caveatOf: () => "", noteOf: () => "", plotUnit: () => "", methodOf: () => "" });
  return out;
}
