// Plain-language explanations of each view kind, for a reader who isn't a scientist — what the
// figure IS and what question it answers, not how it's computed. A different job and a different
// audience from lib/dsl-reference.ts (which documents the DSL's syntax and statistics precisely,
// for someone writing or reading an analysis document, scientist or not). Shown from a "?" button
// in each view's own header (ViewHead in app/lab/page.tsx), so it travels with every view kind
// wherever ViewHead is used — chat, MCP, and the app all share that one component.
import { KINDS } from "./views/kinds.ts";

export interface ViewHelp { title: string; text: string }

/** every kind's explanation, from its descriptor (lib/views/<kind>/kind.ts) */
export const VIEW_HELP: Record<string, ViewHelp> = Object.fromEntries(Object.values(KINDS).map((k) => [k.kind, k.help]));
