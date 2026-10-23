// What a view kind is to every page and agent, apart from how it runs (run.ts, server-only): its
// figure, its title, its part of the results text, its help, what federation needs of it, and its
// marks. Each kind's lib/views/<kind>/kind.ts is one of these; lib/views/kinds.ts lists them.
// Browser-safe.
import type { ViewKind, ViewResult, ViewResultOf, DrawnResultOf } from "../types.ts";
import type { SvgOpts } from "../svg-kit.ts";
import type { ViewHelp } from "../view-help.ts";
import type { Need } from "../view-coverage.ts";

/** What a kind's text has to hand (lib/result-text.ts builds one per analysis). */
export interface TextContext {
  /** the text so far: a kind pushes its own paragraph */
  out: string[];
  pFmt: (x: number) => string;
  /** the engine's caveat, as the model is to pass it on */
  caveatOf: (v: { caveat?: string }) => string;
  /** the author's note and the engine's own */
  noteOf: (v: { annotationNote?: string; note?: string }) => string;
  /** what a plot's point is, from the view as authored */
  plotUnit: (v: ViewResult) => string;
  /** the steps its method record took, for a kind that says them inside its own paragraph */
  methodOf: (v: ViewResult) => string;
}

export interface ViewKindDef<K extends ViewKind> {
  kind: K;
  /** its figure from a drawn result, or null when there is nothing to draw (lib/view-svg.ts) */
  figure?: (v: DrawnResultOf<K>, o: SvgOpts) => string | null;
  /** a one-line title for its figure, for alt text and chat captions; the kind's name without one */
  title?: (v: ViewResultOf<K>) => string;
  /** its paragraph of the results text; false when it has none for this result (lib/result-text.ts) */
  text?: (v: DrawnResultOf<K>, t: TextContext) => void | false;
  /** the plain-language "What is this?" in its header */
  help: ViewHelp;
  /** what it needs of every study it draws (lib/view-coverage.ts); counts only without one */
  need?: Need;
  /** what a preview kind still lacks before it is held to the full checks (lib/preview-kinds.ts) */
  preview?: string;
  /** cBioPortal has no counterpart for it (lib/new-in-lab.ts) */
  isNew?: boolean;
}
