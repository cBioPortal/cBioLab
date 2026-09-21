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
import { OQL_MODIFIERS, OQL_PCHANGE_CLASSES } from "./dsl-completions.ts";

export interface QuickFilterContext {
  genes?: string[];
  attributes?: string[];
  eventTypes?: string[];
  /** eventType -> its attrs keys (from GET /api/catalog's `keys`) */
  eventKeys?: Record<string, string[]>;
  /** eventType -> key -> known values (from GET /api/catalog's `values`) */
  eventValues?: Record<string, Record<string, string[]>>;
  /** attribute -> known categorical values (numeric attributes have none) */
  attributeValues?: Record<string, string[]>;
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

/**
 * Suggestions for OQL text after a gene, handling ";"-separated multi-gene
 * entries the same way lib/oql.ts's own grammar does: "TP53: MUT; KRAS<cursor>"
 * suggests a SECOND gene, not a continuation of TP53's modifier.
 */
function suggestOqlAfterGene(text: string, ctx: QuickFilterContext): Suggestion[] {
  const entries = text.split(/[;\n]/);
  const current = entries[entries.length - 1];
  const base = text.slice(0, text.length - current.length);
  const colon = current.indexOf(":");

  if (colon < 0) {
    const partial = current.replace(/^\s+/, "");
    const lead = base + current.slice(0, current.length - partial.length);
    const exact = (ctx.genes || []).find((g) => g.toLowerCase() === partial.toLowerCase());
    if (exact) {
      // A complete gene: the qualifier this app's docs lead with, plus the
      // one thing typing a bare gene can't express on its own — a second one.
      return [
        ...OQL_MODIFIERS.map((m) => ({ label: ": " + m, apply: lead + exact + ": " + m, type: "oql" as const, detail: "OQL modifier" })),
        { label: exact + ";", apply: lead + exact + "; ", type: "oql" as const, detail: "OR another gene" }
      ];
    }
    if (!partial) return [];
    return byPrefix(ctx.genes || [], partial).slice(0, 20).map((g) => ({ label: g, apply: lead + g, type: "gene" as const }));
  }

  const afterColon = current.slice(colon + 1);
  const m = /([A-Za-z0-9=<>._-]*)$/.exec(afterColon);
  const partial = m ? m[1] : "";
  const lead = text.slice(0, text.length - partial.length);
  if (/^MUT=/i.test(partial)) {
    const rest = partial.slice(4);
    return byPrefix(OQL_PCHANGE_CLASSES, rest).map((o) => ({ label: o, apply: lead + "MUT=" + o, type: "keyword" as const }));
  }
  if (!partial) return [];
  return byPrefix(OQL_MODIFIERS, partial).map((o) => ({ label: o, apply: lead + o, type: "keyword" as const, detail: "OQL modifier" }));
}

export function suggestToken(raw: string, ctx: QuickFilterContext = {}): Suggestion[] {
  const negMatch = /^(!\s*|not\s+)/i.exec(raw);
  const prefix = negMatch ? negMatch[0] : "";
  const text = raw.slice(prefix.length);
  if (!text) return [];
  // apply-strings below are built relative to `text` (negation already
  // stripped); reattach it here so picking a suggestion never silently drops
  // a "!"/"NOT " the user already typed.
  const withPrefix = (list: Suggestion[]): Suggestion[] => (prefix ? list.map((s) => ({ ...s, apply: prefix + s.apply })) : list);

  // Inside an event's filter clause (after "EventType:"), OR after a gene's
  // colon (OQL modifier) — same delimiter, disambiguated by which kind of
  // real name precedes it.
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
        return withPrefix(byPrefix(values, valPartial).slice(0, 20).map((v) => ({ label: v, apply: base + key + "=" + v, type: "value" })));
      }
      const keys = (ctx.eventKeys || {})[eventType] || [];
      return withPrefix(byPrefix(keys, lastTok).slice(0, 20).map((k) => ({ label: k, apply: base + k + "=", type: "key" })));
    }
    if (GENE_RE.test(typeWord)) return withPrefix(suggestOqlAfterGene(text, ctx));
    return [];
  }

  // A ";" is OQL-only syntax (multiple genes, ORed) — an unambiguous signal
  // to route into the entry-aware OQL suggester even before the new entry
  // has grown its OWN colon yet, i.e. while still typing the second gene's
  // NAME ("TP53: MUT; KRA") rather than its modifier.
  if (text.includes(";")) return withPrefix(suggestOqlAfterGene(text, ctx));

  // A relation keyword already typed: nothing further to suggest here — the
  // right-hand event and the day window are free text.
  if (REL_WORDS.some(({ re }) => re.test(text))) return [];

  // Composing a clinical predicate already past the attribute name + operator?
  for (const attr of ctx.attributes || []) {
    const re = new RegExp("^" + attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(!=|>=|<=|=|>|<)\\s*(.*)$", "i");
    const m = re.exec(text);
    if (!m) continue;
    const [, , valPartial] = m;
    const values = (ctx.attributeValues || {})[attr] || [];
    if (!values.length) return []; // numeric attribute: nothing to suggest for a typed-in number
    return withPrefix(byPrefix(values, valPartial).slice(0, 25).map((v) => ({ label: v, apply: attr + " = " + v, type: "value" })));
  }

  // Bare word so far: an EXACT match on a known attribute or gene jumps
  // straight to "what comes next" (values, or OQL qualifiers) instead of
  // just re-listing the one word already typed.
  const bare = text.replace(/^(first|last)\s+/i, "");
  const bareLead = text.slice(0, text.length - bare.length);
  const exactAttr = (ctx.attributes || []).find((a) => a.toLowerCase() === bare.toLowerCase());
  if (exactAttr) {
    const values = (ctx.attributeValues || {})[exactAttr] || [];
    if (values.length)
      return withPrefix(values.slice(0, 25).map((v) => ({ label: "= " + v, apply: bareLead + exactAttr + " = " + v, type: "value" })));
    return withPrefix(CLIN_OPS.map((op) => ({ label: exactAttr + " " + op, apply: bareLead + exactAttr + " " + op + " ", type: "attribute", detail: "operator" })));
  }
  const exactGene = (ctx.genes || []).find((g) => g.toLowerCase() === bare.toLowerCase());
  if (exactGene) {
    return withPrefix([
      ...OQL_MODIFIERS.map((m) => ({ label: ": " + m, apply: bareLead + exactGene + ": " + m, type: "oql" as const, detail: "OQL modifier" })),
      { label: exactGene + ";", apply: bareLead + exactGene + "; ", type: "oql" as const, detail: "OR another gene" }
    ]);
  }

  // No exact match yet: mix event types, attribute names and genes — the
  // same "any facet could start here" list a Datadog-style bar shows. Each
  // label carries the symbol that qualifies it (":" for an event or gene,
  // " =" for an attribute) so the list itself says "there's more after
  // this" — apply still only completes the word, not the symbol: typing it
  // is what the exact-match branches above are watching for, and jumping
  // straight to "TP53: " here would skip past the OQL-modifier suggestions
  // that showing the bare, complete gene name triggers on the next keystroke.
  const events = byPrefix(ctx.eventTypes || [], bare).map((t) => ({ label: t + ":", apply: bareLead + t + ": ", type: "event", detail: "timeline event" }));
  const attrs = byPrefix(ctx.attributes || [], bare).map((a) => ({ label: a + " =", apply: bareLead + a, type: "attribute", detail: "clinical attribute" }));
  const genes = byPrefix(ctx.genes || [], bare).map((g) => ({ label: g + ":", apply: bareLead + g, type: "gene", detail: "gene" }));
  return withPrefix([...events, ...attrs, ...genes].slice(0, 30));
}

// A fixed illustrative set, used only when live catalog data isn't loaded
// yet (so the panel is never empty on first paint) — every real example
// below prefers actual data instead. Deliberately covers the full grammar,
// not just the two or three most common shapes — this panel is the
// documentation, so it should read like a tour, not a teaser.
const STATIC_EXAMPLES: Suggestion[] = [
  { label: "TP53: MUT", apply: "TP53: MUT", type: "example", detail: "gene mutated" },
  { label: "STK11: DRIVER", apply: "STK11: DRIVER", type: "example", detail: "OncoKB driver call" },
  { label: "EGFR: AMP", apply: "EGFR: AMP", type: "example", detail: "amplified" },
  { label: "TP53: MUT; KRAS: MUT", apply: "TP53: MUT; KRAS: MUT", type: "example", detail: "either gene (OR)" },
  { label: "SEX = Female", apply: "SEX = Female", type: "example", detail: "clinical attribute" },
  { label: "CURRENT_AGE_DEID > 65", apply: "CURRENT_AGE_DEID > 65", type: "example", detail: "numeric attribute" },
  { label: "Treatment", apply: "Treatment", type: "example", detail: "has this event" },
  { label: "first Diagnosis", apply: "first Diagnosis", type: "example", detail: "first occurrence" },
  { label: "Diagnosis before Treatment <=90d", apply: "Diagnosis before Treatment <=90d", type: "example", detail: "A, then B within 90 days" },
  { label: "Treatment during Diagnosis", apply: "Treatment during Diagnosis", type: "example", detail: "A falls within B's span" },
  { label: "Treatment not_followed_by Progression <=180d", apply: "Treatment not_followed_by Progression <=180d", type: "example", detail: "A, with no B after" },
  { label: "!TP53: MUT", apply: "!TP53: MUT", type: "example", detail: "negated" }
];

/**
 * What the empty input shows before anyone types — real, clickable examples
 * built from THIS study's own catalog wherever possible, so every one of
 * them is guaranteed to actually parse and match something here, not just
 * be illustrative. Falls back to STATIC_EXAMPLES only while that catalog
 * data hasn't loaded yet, and tops up with it too if this study's own data
 * doesn't stretch to cover every shape (e.g. too few event types for a
 * relation example) — a shorter but still-real list beats padding with
 * invented ones, but a mostly-empty panel teaches nothing.
 */
export function exampleSuggestions(ctx: QuickFilterContext = {}): Suggestion[] {
  const genes = ctx.genes || [];
  const attributes = ctx.attributes || [];
  const eventTypes = ctx.eventTypes || [];
  const catAttr = attributes.find((a) => ((ctx.attributeValues || {})[a] || []).length > 0);
  const catVal = catAttr ? (ctx.attributeValues || {})[catAttr][0] : undefined;
  const numAttr = attributes.find((a) => !((ctx.attributeValues || {})[a] || []).length);
  const ev1 = eventTypes[0];
  const ev2 = eventTypes.find((e) => e !== ev1);
  const ev3 = eventTypes.find((e) => e !== ev1 && e !== ev2);
  const evWithKey = eventTypes.find((e) => ((ctx.eventKeys || {})[e] || []).length > 0);
  const key = evWithKey ? (ctx.eventKeys || {})[evWithKey][0] : undefined;
  const val = evWithKey && key ? ((ctx.eventValues || {})[evWithKey] || {})[key]?.[0] : undefined;

  const out: Suggestion[] = [];
  if (genes[0]) out.push({ label: genes[0] + ": MUT", apply: genes[0] + ": MUT", type: "example", detail: "gene mutated" });
  if (genes[1]) out.push({ label: genes[1] + ": DRIVER", apply: genes[1] + ": DRIVER", type: "example", detail: "OncoKB driver call" });
  if (genes[2]) out.push({ label: genes[2] + ": AMP", apply: genes[2] + ": AMP", type: "example", detail: "amplified" });
  if (genes[0] && genes[1]) out.push({ label: genes[0] + ": MUT; " + genes[1] + ": MUT", apply: genes[0] + ": MUT; " + genes[1] + ": MUT", type: "example", detail: "either gene (OR)" });
  // Kept right after the other gene examples (not appended at the end):
  // genes and clinical attributes both load from the one `explore` fetch,
  // but event types load from a separate, later `cat` fetch. If this stayed
  // last, it would visibly jump further down the list the moment events
  // arrive — new rows should only ever append below, never reorder one
  // that's already on screen while someone's looking at it.
  if (genes[0]) out.push({ label: "!" + genes[0] + ": MUT", apply: "!" + genes[0] + ": MUT", type: "example", detail: "negated" });
  if (catAttr && catVal) out.push({ label: catAttr + " = " + catVal, apply: catAttr + " = " + catVal, type: "example", detail: "clinical attribute" });
  if (numAttr) out.push({ label: numAttr + " > 50", apply: numAttr + " > 50", type: "example", detail: "numeric attribute" });
  if (ev1) out.push({ label: ev1, apply: ev1, type: "example", detail: "has this event" });
  if (ev1) out.push({ label: "first " + ev1, apply: "first " + ev1, type: "example", detail: "first occurrence" });
  if (evWithKey && key && val) out.push({ label: evWithKey + ": " + key + "=" + val, apply: evWithKey + ": " + key + "=" + val, type: "example", detail: "event with a filter" });
  if (ev1 && ev2) out.push({ label: ev1 + " before " + ev2 + " <=90d", apply: ev1 + " before " + ev2 + " <=90d", type: "example", detail: "A, then B within 90 days" });
  if (ev1 && ev2) out.push({ label: ev2 + " during " + ev1, apply: ev2 + " during " + ev1, type: "example", detail: "A falls within B's span" });
  if (ev1 && (ev3 || ev2)) {
    const other = ev3 || ev2!;
    out.push({ label: ev1 + " not_followed_by " + other + " <=180d", apply: ev1 + " not_followed_by " + other + " <=180d", type: "example", detail: "A, with no B after" });
  }

  // Top up with STATIC_EXAMPLES only when there's no real data at all —
  // mixing in a hardcoded "Diagnosis"/"Treatment"/"STK11" once ctx is
  // PARTIALLY loaded would risk showing an example that doesn't actually
  // exist in THIS study, breaking the one guarantee this list makes. A
  // shorter but entirely real list is correct; a longer one that lies isn't.
  return out.length ? out : STATIC_EXAMPLES;
}
