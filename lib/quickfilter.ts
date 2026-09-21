// The Cohorts tab's quick-filter bar: type one short, human-typed token, hit
// Enter, get a pill — a Datadog-style filter entry rather than hand-typed
// JSON, since nobody actually wants to write the latter (see git history for
// the abandoned lib/dsl-completions.ts JSON-typeahead attempt this replaces
// as the primary entry surface; that stays as the "advanced" raw-JSON escape
// hatch, not the everyday path).
//
// Three token shapes, disambiguated using REAL catalog data (never guessed):
//   OQL          "TP53" | "TP53: MUT" | "STK11: DRIVER"     — exactly lib/oql.ts's own grammar
//   clinical     "SEX = Female" | "CURRENT_AGE_DEID > 65"   — ATTR must be a real attribute name
//   event        "Treatment" | "first Diagnosis" |
//                "Treatment: SUBTYPE=Immunotherapy RESULT>100"
//   event, related  "Diagnosis before Treatment <=90d"
//                    "Treatment during Diagnosis"
//                    "Treatment not_followed_by Progression <=180d"
// Any of the above may be prefixed with "!" or "NOT " to negate ({not: leaf}).
//
// Disambiguation order matters and is deliberate: a relation keyword is
// structurally distinctive enough to try first; clinical needs BOTH a real
// attribute-name match AND an inline operator; event presence needs a real
// event-type match; OQL is the fallback, since GENE_RE accepts almost any
// short alphanumeric token and would otherwise swallow a mistyped event type
// or attribute name as a nonsense gene symbol.
import type { Clause, Leaf, EventSelector, EventRel, ClinicalOp } from "./types.ts";

export interface QuickFilterContext {
  genes?: string[];
  attributes?: string[];
  eventTypes?: string[];
  /** eventType -> its attrs keys (from GET /api/catalog's `keys`) */
  eventKeys?: Record<string, string[]>;
  /** eventType -> key -> known values (from GET /api/catalog's `values`) */
  eventValues?: Record<string, Record<string, string[]>>;
}

export interface Suggestion {
  label: string;
  /** text that replaces the WHOLE current draft when picked */
  apply: string;
  type: string;
  detail?: string;
}

const GENE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;
const OQL_ENTRY_RE = /^([A-Za-z0-9.-]+)\s*(?::\s*(.*))?$/;
const CLIN_OPS: ClinicalOp[] = ["!=", ">=", "<=", "=", ">", "<"]; // longest first so "!=" wins over "="
const REL_WORDS: { re: RegExp; type: "BEFORE" | "DURING" | "NOT_FOLLOWED_BY" }[] = [
  { re: /\bnot[\s_]followed[\s_]by\b/i, type: "NOT_FOLLOWED_BY" },
  { re: /\bbefore\b/i, type: "BEFORE" },
  { re: /\bduring\b/i, type: "DURING" }
];

function findAttr(word: string, attributes: string[]): string | null {
  const hit = attributes.find((a) => a.toLowerCase() === word.toLowerCase());
  return hit ?? null;
}
function findEventType(word: string, eventTypes: string[]): string | null {
  const hit = eventTypes.find((t) => t.toLowerCase() === word.toLowerCase());
  return hit ?? null;
}

/** "KEY=VALUE" / "KEY>NUM" tokens, respecting "double-quoted values with spaces". */
function tokenizeFilters(text: string): string[] {
  const out: string[] = [];
  const re = /"[^"]*"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}

function parseEventFilters(text: string, eventType: string, ctx: QuickFilterContext): { attrs?: { key: string; value: string }[]; numeric?: { key: string; op: ClinicalOp; value: number } } {
  const attrs: { key: string; value: string }[] = [];
  let numeric: { key: string; op: ClinicalOp; value: number } | undefined;
  const knownKeys = (ctx.eventKeys || {})[eventType] || [];
  for (const tok of tokenizeFilters(text)) {
    const m = /^([A-Za-z0-9_]+)(!=|>=|<=|=|>|<)(.+)$/.exec(tok);
    if (!m) throw new Error("can't read '" + tok + "' — expected KEY=VALUE or KEY>NUMBER");
    const [, key, op, rawVal] = m;
    const val = rawVal.replace(/^"|"$/g, "");
    const isKnownAttr = knownKeys.some((k) => k.toLowerCase() === key.toLowerCase());
    if (op === "=" && (isKnownAttr || knownKeys.length === 0)) {
      attrs.push({ key, value: val });
      continue;
    }
    const n = Number(val);
    if (!Number.isFinite(n)) throw new Error("'" + key + op + val + "' needs a number (or drop the operator for a text match with '=')");
    if (numeric) throw new Error("only one numeric filter is allowed per event (already have " + numeric.key + numeric.op + numeric.value + ")");
    numeric = { key, op: op as ClinicalOp, value: n };
  }
  return { attrs: attrs.length ? attrs : undefined, numeric };
}

/** "[first|last] EVENTTYPE[: filters]" -> EventSelector, or null if EVENTTYPE isn't real. */
function tryParseEventPresence(text: string, ctx: QuickFilterContext): EventSelector | null {
  let s = text.trim();
  let occurrence: EventSelector["occurrence"];
  const occ = /^(first|last)\s+/i.exec(s);
  if (occ) { occurrence = occ[1].toUpperCase() as "FIRST" | "LAST"; s = s.slice(occ[0].length); }

  const colon = s.indexOf(":");
  const typeWord = (colon >= 0 ? s.slice(0, colon) : s).trim();
  // Never accept a bare word as "an event" without checking it against the
  // study's real event types — an empty/not-yet-loaded catalog must mean "no
  // event types are known yet", not "anything typed here is one".
  if (!typeWord) return null;
  const eventType = findEventType(typeWord, ctx.eventTypes || []);
  if (!eventType) return null;

  const sel: EventSelector = { eventType };
  if (occurrence) sel.occurrence = occurrence;
  if (colon >= 0) {
    const { attrs, numeric } = parseEventFilters(s.slice(colon + 1).trim(), eventType, ctx);
    if (attrs) sel.attrs = attrs;
    if (numeric) sel.numeric = numeric;
  }
  return sel;
}

const WINDOW_RE = /\s+(?:(\d+)-)?(?:<=\s*)?(\d+)\s*d\s*$/i;

function tryParseEventRelation(text: string, ctx: QuickFilterContext): Leaf | null {
  for (const { re, type } of REL_WORDS) {
    const parts = text.split(re);
    if (parts.length !== 2) continue;
    let [left, right] = parts;
    let minDays: number | undefined, days: number | undefined;
    const wm = WINDOW_RE.exec(right);
    if (wm) { if (wm[1]) minDays = Number(wm[1]); days = Number(wm[2]); right = right.slice(0, wm.index); }

    const leftSel = tryParseEventPresence(left, ctx);
    const rightSel = tryParseEventPresence(right, ctx);
    if (!leftSel || !rightSel) continue; // not really two events — let the caller try something else

    let rel: EventRel;
    let a = leftSel, b = rightSel;
    if (type === "DURING") {
      if (days != null) throw new Error("DURING has no day window — remove the '" + (minDays != null ? minDays + "-" : "") + days + "d'");
      rel = { type: "DURING" };
      // The compiler's a/b convention is "b falls within a's span" (a is the
      // container), but English "X during Y" names the CONTAINED event
      // first — "chemo during hospitalization" means chemo is the one
      // nested inside hospitalization's window. Typed left-to-right order
      // must flip to match, or the compiled cohort silently means the
      // opposite of what was typed.
      a = rightSel; b = leftSel;
    } else if (type === "BEFORE") {
      if (days == null) throw new Error("BEFORE needs a day window, e.g. '" + left.trim() + " before " + right.trim() + " <=90d'");
      rel = { type: "BEFORE", maxDays: days, ...(minDays != null ? { minDays } : {}) };
    } else {
      if (days == null) throw new Error("not_followed_by needs a day window, e.g. '" + left.trim() + " not_followed_by " + right.trim() + " <=180d'");
      // observed:true always — an absence with no observability guard silently
      // conflates "didn't happen" with "we stopped watching", which is exactly
      // what this app's own docs/chat prompt warn against everywhere else.
      rel = { type: "NOT_FOLLOWED_BY", withinDays: days, observed: true };
    }
    return { kind: "event", a, b, rel } as Leaf;
  }
  return null;
}

function tryParseClinical(text: string, ctx: QuickFilterContext): Leaf | null {
  const attributes = ctx.attributes || [];
  if (!attributes.length) return null;
  // longest attribute name first, in case one is a prefix of another
  const sorted = [...attributes].sort((a, b) => b.length - a.length);
  for (const attr of sorted) {
    const re = new RegExp("^" + attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(!=|>=|<=|=|>|<)\\s*(.+)$", "i");
    const m = re.exec(text.trim());
    if (!m) continue;
    const [, op, rawVal] = m;
    const val = rawVal.trim().replace(/^"|"$/g, "");
    const num = Number(val);
    const leaf: Leaf = Number.isFinite(num) && val !== "" && /^-?[\d.]+$/.test(val)
      ? { kind: "clinical", attribute: attr, op: op as ClinicalOp, value: num }
      : { kind: "clinical", attribute: attr, op: op as ClinicalOp, value: val };
    return leaf;
  }
  return null;
}

function tryParseOql(text: string): Leaf | null {
  const m = OQL_ENTRY_RE.exec(text.trim());
  if (!m || !GENE_RE.test(m[1])) return null;
  return { kind: "oql", q: text.trim() };
}

export function parseToken(raw: string, ctx: QuickFilterContext = {}): Clause {
  let text = raw.trim();
  if (!text) throw new Error("type something first");
  let negate = false;
  const bang = /^!\s*/.exec(text);
  const notWord = /^not\s+/i.exec(text);
  if (bang) { negate = true; text = text.slice(bang[0].length); }
  else if (notWord) { negate = true; text = text.slice(notWord[0].length); }

  let priorGuard = false;
  const naive = /\s+na[iï]ve\s*$/i.exec(text);
  if (naive) { priorGuard = true; text = text.slice(0, naive.index); }

  let leaf: Leaf | null = null;
  try { leaf = tryParseEventRelation(text, ctx); } catch (e) { throw e; }
  if (!leaf) leaf = tryParseClinical(text, ctx);
  if (!leaf) {
    const pres = tryParseEventPresence(text, ctx);
    if (pres) leaf = { kind: "event", a: pres, rel: { type: "NONE" } } as Leaf;
  }
  if (!leaf) leaf = tryParseOql(text);
  if (!leaf)
    throw new Error(
      "couldn't read '" + text.slice(0, 60) + "' — try a gene (TP53: MUT), " +
      "an attribute (SEX = Female), or an event (Treatment, or Diagnosis before Treatment <=90d)"
    );
  if (priorGuard && "kind" in leaf && leaf.kind === "event") (leaf as Leaf & { priorGuard?: boolean }).priorGuard = true;
  return negate ? { not: leaf } : leaf;
}

// ---------------------------------------------------------------------------
// Typeahead for the single token currently being composed — no cursor math
// needed, since the input holds exactly one not-yet-committed token at a time.
// ---------------------------------------------------------------------------
function byPrefix<T extends string>(candidates: T[], prefix: string): T[] {
  const p = prefix.toLowerCase();
  return candidates.filter((c) => c.toLowerCase().startsWith(p));
}

export function suggestToken(raw: string, ctx: QuickFilterContext = {}): Suggestion[] {
  const text = raw.replace(/^!\s*|^not\s+/i, "");
  if (!text) return [];

  // Inside an event's filter clause (after "EventType:")?
  const colon = text.indexOf(":");
  if (colon >= 0) {
    const typeWord = text.slice(0, colon).replace(/^(first|last)\s+/i, "").trim();
    const eventType = (ctx.eventTypes || []).find((t) => t.toLowerCase() === typeWord.toLowerCase());
    if (eventType) {
      const after = text.slice(colon + 1);
      const lastTok = after.split(/\s+/).pop() || "";
      const eq = /^([A-Za-z0-9_]*)(!=|>=|<=|=|>|<)(.*)$/.exec(lastTok);
      const base = text.slice(0, text.length - lastTok.length);
      if (eq) {
        const [, key, , valPartial] = eq;
        const values = ((ctx.eventValues || {})[eventType] || {})[key] || [];
        return byPrefix(values, valPartial).slice(0, 20).map((v) => ({ label: v, apply: base + key + "=" + v, type: "value" }));
      }
      const keys = (ctx.eventKeys || {})[eventType] || [];
      return byPrefix(keys, lastTok).slice(0, 20).map((k) => ({ label: k, apply: base + k + "=", type: "key" }));
    }
  }

  // A relation keyword already typed: nothing further to suggest here — the
  // right-hand event and the day window are free text.
  if (REL_WORDS.some(({ re }) => re.test(text))) return [];

  // Composing a clinical predicate already past the attribute name?
  const clinMatch = (ctx.attributes || []).find((a) => new RegExp("^" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(!=|>=|<=|=|>|<)", "i").test(text));
  if (clinMatch) return [];

  // Bare word so far: mix event types, attribute names and genes/OQL — the
  // same "any facet could start here" list a Datadog-style bar shows.
  const bare = text.replace(/^(first|last)\s+/i, "");
  const events = byPrefix(ctx.eventTypes || [], bare).map((t) => ({ label: t, apply: t + ": ", type: "event", detail: "timeline event" }));
  const attrs = byPrefix(ctx.attributes || [], bare).map((a) => ({ label: a, apply: a + " = ", type: "attribute", detail: "clinical attribute" }));
  const genes = byPrefix(ctx.genes || [], bare).map((g) => ({ label: g, apply: g + ": ", type: "gene", detail: "gene" }));
  return [...events, ...attrs, ...genes].slice(0, 30);
}
