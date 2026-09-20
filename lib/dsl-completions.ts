// Typeahead for hand-typed DSL JSON and OQL strings — a pure function of
// (text, cursor position, live context) to a list of suggestions, kept
// deliberately independent of any editor widget so it is unit-testable on
// its own and reusable wherever a person types raw DSL (today: the Cohorts
// tab's definition box).
//
// This is intentionally NOT a full JSON parser walking a syntax tree: cursor
// position is classified by matching a handful of regexes against the text
// immediately before the cursor. That covers the common, useful cases (I'm
// typing a "kind" value, I'm starting a new clause object, I'm inside a "q"
// string) without the cost of a real incremental parser — see dsl-reference.ts
// for the grammar this mirrors; if the DSL gains a leaf kind, add it to
// LEAF_SNIPPETS too, the same parallel-source-of-truth trade this codebase
// already makes for pills.tsx's KIND_META.
export interface Suggestion {
  label: string;
  /** text actually inserted, if different from label (e.g. a full snippet) */
  apply?: string;
  detail?: string;
  type?: string;
}
export interface CompletionResult {
  /** offset where the replacement starts */
  from: number;
  options: Suggestion[];
}
export interface DslContext {
  /** gene symbols worth suggesting for this study/cohort — a shortlist, not a whitelist */
  genes?: string[];
  /** clinical attribute names this study actually has */
  attributes?: string[];
}

const LEAF_SNIPPETS: { kind: string; detail: string; snippet: string }[] = [
  { kind: "oql", detail: "genomic status (portal OQL)", snippet: '"kind": "oql", "q": "GENE: MUT"' },
  { kind: "clinical", detail: "clinical attribute predicate", snippet: '"kind": "clinical", "attribute": "", "op": "=", "value": ""' },
  { kind: "event", detail: "timeline sub-DSL", snippet: '"kind": "event", "a": {"eventType": ""}, "rel": {"type": "NONE"}' },
  { kind: "sampleList", detail: "explicit, cross-study sample id list", snippet: '"kind": "sampleList", "ids": []' },
  { kind: "patientList", detail: "explicit, cross-study patient id list", snippet: '"kind": "patientList", "ids": []' },
  { kind: "profiled", detail: "profiled for a data type", snippet: '"kind": "profiled", "type": "MUTATION"' },
  { kind: "caseList", detail: "portal sample list", snippet: '"kind": "caseList", "id": "sequenced"' },
  { kind: "genomicData", detail: "continuous per-gene values", snippet: '"kind": "genomicData", "gene": "", "profileType": "", "range": {}' },
  { kind: "genericAssay", detail: "generic assay values", snippet: '"kind": "genericAssay", "profileType": "", "entity": "", "range": {}' },
  { kind: "derived", detail: "computed from the data's shape", snippet: '"kind": "derived", "metric": "followupMonths", "range": {}' }
];

const OP_VALUES = ["=", "!=", ">", ">=", "<", "<="];
const PER_VALUES = ["patient", "sample"];
const PROFILED_TYPES = ["MUTATION", "CNA", "SV"];
const DERIVED_METRICS = ["followupMonths", "historyMonths", "alteredGenes", "lines", "treatmentSpan"];

// lib/oql.ts's exact accepted vocabulary — kept in sync by hand since that
// file has no exported token list of its own (parseSpec branches on string
// literals inline). A token offered here that parseOql would reject is worse
// than no suggestion, so this must never drift ahead of what actually compiles.
const OQL_MODIFIERS = [
  "MUT", "MUT=", "MISSENSE", "NONSENSE", "TRUNC", "INFRAME", "SPLICE",
  "AMP", "HOMDEL", "CNA", "FUSION", "DRIVER",
  "EXP>", "EXP<", "EXP>=", "EXP<=", "PROT>", "PROT<", "PROT>=", "PROT<="
];
const OQL_PCHANGE_CLASSES = ["MISSENSE", "NONSENSE", "TRUNC", "INFRAME", "SPLICE"];

function byPrefix(candidates: string[], prefix: string): string[] {
  const p = prefix.toUpperCase();
  return candidates.filter((c) => c.toUpperCase().startsWith(p));
}

/**
 * Cursor is inside `"q": "..."` — find the OQL entry (between `;`s) the
 * cursor is in and suggest a gene (before the first `:`) or a modifier
 * token (after it), mirroring lib/oql.ts's own grammar.
 */
function suggestOql(qTextBeforeCursor: string, fromBase: number, ctx: DslContext): CompletionResult | null {
  const entries = qTextBeforeCursor.split(/[;\n]/);
  const current = entries[entries.length - 1];
  const entryStart = fromBase + qTextBeforeCursor.length - current.length;
  const colon = current.indexOf(":");
  if (colon < 0) {
    // typing the gene: suggest from the study's own gene list, trimmed to what's typed
    const partial = current.replace(/^\s+/, "");
    const from = entryStart + (current.length - partial.length);
    const genes = byPrefix(ctx.genes || [], partial);
    if (!genes.length) return null;
    return { from, options: genes.slice(0, 25).map((g) => ({ label: g, type: "gene" })) };
  }
  // after the colon: modifier tokens, one space-separated word at a time
  const afterColon = current.slice(colon + 1);
  const m = /([A-Za-z0-9=<>._-]*)$/.exec(afterColon);
  const partial = m ? m[1] : "";
  const from = fromBase + qTextBeforeCursor.length - partial.length;
  if (/^MUT=/i.test(partial)) {
    const rest = partial.slice(4);
    const opts = byPrefix(OQL_PCHANGE_CLASSES, rest);
    if (!opts.length) return null;
    return { from: from + 4, options: opts.map((o) => ({ label: o, type: "keyword" })) };
  }
  const opts = byPrefix(OQL_MODIFIERS, partial);
  if (!opts.length) return null;
  return { from, options: opts.map((o) => ({ label: o, type: "keyword" })) };
}

/** Is `pos` inside the string value of a `"q"` key? Cheap, not a real parser: scans
 *  back from `pos` for an unescaped opening quote, then confirms it follows `"q":`. */
function insideQString(text: string, pos: number): { start: number } | null {
  let i = pos - 1;
  while (i >= 0) {
    if (text[i] === '"' && text[i - 1] !== "\\") break;
    if (text[i] === "\n") return null; // JSON strings never span lines
    i--;
  }
  if (i < 0) return null;
  const before = text.slice(0, i);
  if (!/"q"\s*:\s*$/.test(before)) return null;
  return { start: i + 1 };
}

export function suggestAt(text: string, pos: number, ctx: DslContext = {}): CompletionResult | null {
  const q = insideQString(text, pos);
  if (q) return suggestOql(text.slice(q.start, pos), q.start, ctx);

  const head = text.slice(Math.max(0, pos - 200), pos);

  // Starting a brand-new clause object: "{" with nothing but whitespace, or a
  // partial kind name, typed since — offer full leaf snippets (the biggest
  // single time-saver), narrowed as the name is typed. Without narrowing here
  // the popup has nothing to filter against and CodeMirror closes it the
  // moment a second character is typed, since the source stops matching.
  let m = /\{\s*([A-Za-z]*)$/.exec(head);
  if (m) {
    const partial = m[1];
    const opts = partial ? LEAF_SNIPPETS.filter((s) => s.kind.toUpperCase().startsWith(partial.toUpperCase())) : LEAF_SNIPPETS;
    if (!opts.length) return null;
    return {
      from: pos - partial.length,
      options: opts.map((s) => ({ label: s.kind, detail: s.detail, apply: s.snippet, type: "snippet" }))
    };
  }

  // "kind": "<partial>"
  m = /"kind"\s*:\s*"([A-Za-z]*)$/.exec(head);
  if (m) {
    const opts = byPrefix(LEAF_SNIPPETS.map((s) => s.kind), m[1]);
    if (!opts.length) return null;
    return { from: pos - m[1].length, options: opts.map((k) => ({ label: k, type: "keyword" })) };
  }

  // "attribute": "<partial>" — real clinical attribute names for this study
  m = /"attribute"\s*:\s*"([^"]*)$/.exec(head);
  if (m) {
    const opts = byPrefix(ctx.attributes || [], m[1]);
    if (!opts.length) return null;
    return { from: pos - m[1].length, options: opts.map((a) => ({ label: a, type: "property" })) };
  }

  // "gene": "<partial>" — genomicData's single-gene field
  m = /"gene"\s*:\s*"([A-Za-z0-9.*-]*)$/.exec(head);
  if (m) {
    const opts = byPrefix(ctx.genes || [], m[1]);
    if (!opts.length) return null;
    return { from: pos - m[1].length, options: opts.map((g) => ({ label: g, type: "gene" })) };
  }

  // small fixed enums
  m = /"op"\s*:\s*"([^"]*)$/.exec(head);
  if (m) { const o = byPrefix(OP_VALUES, m[1]); return o.length ? { from: pos - m[1].length, options: o.map((v) => ({ label: v })) } : null; }
  m = /"per"\s*:\s*"([^"]*)$/.exec(head);
  if (m) { const o = byPrefix(PER_VALUES, m[1]); return o.length ? { from: pos - m[1].length, options: o.map((v) => ({ label: v })) } : null; }
  m = /"type"\s*:\s*"([A-Za-z]*)$/.exec(head);
  if (m) { const o = byPrefix(PROFILED_TYPES, m[1]); return o.length ? { from: pos - m[1].length, options: o.map((v) => ({ label: v })) } : null; }
  m = /"metric"\s*:\s*"([A-Za-z]*)$/.exec(head);
  if (m) { const o = byPrefix(DERIVED_METRICS, m[1]); return o.length ? { from: pos - m[1].length, options: o.map((v) => ({ label: v })) } : null; }

  return null;
}
