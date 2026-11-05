// Stored links: a page's long URL parameters kept on the server under a short id, so a link stays
// short enough to reload, paste and email however much it carries — the role legacy cBioPortal's
// session service plays for its `session_id`. docs/LINKS.md is the design; this module is its pure
// part (no I/O, browser-safe), so every rule here is unit-tested without a server or a browser.
//
// A page's URL is `?<params>`. When its query string grows past `linkUrlMax()`, the page stores
// its LONG parameters (each longer than LONG_PARAM, e.g. ?doc=, ?changes=, ?cohort=) and its URL
// becomes `?s=<id>` plus the short ones (?tab=, ?study=, ...), which stay readable and editable in
// the address bar. Reading a page's parameters (`effectiveParams`) puts the stored ones back.
//
// - The id is a hash of the stored parameters (lib/link-store.ts), so the same parameters always
//   get the same id, and an id always means the same parameters: a stored link never changes.
// - Storing or reading one needs no sign-in, as a ?doc= link needs none.
// - A parameter written in the URL beside `s` wins over the stored one of the same name: the page
//   wrote it after the link was opened.

/** The URL parameter naming a stored link. */
export const LINK_PARAM = "s";

/** A stored link's id: 22 base64url characters, 132 bits of a SHA-256. */
export const LINK_ID = /^[A-Za-z0-9_-]{22}$/;

/** A parameter longer than this is stored; a shorter one stays in the URL beside `s`. */
export const LONG_PARAM = 256;

/**
 * The query string length (encoded characters, "?" included) past which a page stores its link.
 * Node refuses a request line past 16 KB, and mail clients and chat tools cut links well before
 * that; ?doc= links up to this length stay self-contained, as they always were.
 */
export const LINK_URL_MAX = 8000;

/** The most one stored link holds, in characters of parameter names and values. */
export const LINK_STORE_MAX = 2_000_000;

/** A stored link's parameters: name → value, as in a URL. */
export type LinkParams = Record<string, string>;

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The threshold a page uses: LINK_URL_MAX unless the deployment (or a test) sets a smaller or larger one. */
export function linkUrlMax(override?: string | number | null): number {
  const n = Number(override);
  return override != null && override !== "" && Number.isInteger(n) && n >= 64 ? n : LINK_URL_MAX;
}

/** Parameters as a client sent them, checked: names, string values, size. Throws saying what is wrong. */
export function validateLinkParams(x: unknown): LinkParams {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("a stored link's params must be an object of name → text");
  const out: LinkParams = {};
  let size = 0;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!NAME.test(k)) throw new Error("a stored link's parameter name must be letters, digits and _ (got " + JSON.stringify(k.slice(0, 80)) + ")");
    if (k === LINK_PARAM) throw new Error("a stored link cannot hold another stored link (?" + LINK_PARAM + "=)");
    if (typeof v !== "string") throw new Error("a stored link's parameter " + k + " must be text");
    size += k.length + v.length;
    out[k] = v;
  }
  if (!Object.keys(out).length) throw new Error("a stored link must hold at least one parameter");
  if (size > LINK_STORE_MAX) throw new Error("a stored link holds at most " + LINK_STORE_MAX.toLocaleString("en-US") + " characters; this one has " + size.toLocaleString("en-US"));
  return out;
}

/** The parameters as hashed and stored: keys sorted, so the order a page wrote them in does not matter. */
export function canonicalLinkJson(p: LinkParams): string {
  return JSON.stringify(Object.fromEntries(Object.keys(p).sort().map((k) => [k, p[k]])));
}

const toParams = (search: string | URLSearchParams): URLSearchParams =>
  typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(search.toString());

const toSearch = (q: URLSearchParams): string => { const s = q.toString(); return s ? "?" + s : ""; };

/**
 * A page's parameters as they mean: the URL's own, with a stored link's put back where the URL
 * names one whose parameters are `known` (absent ones are left out: the page waits for them).
 * `s` itself is dropped once it is known.
 */
export function effectiveParams(search: string | URLSearchParams, known: (id: string) => LinkParams | undefined): URLSearchParams {
  const q = toParams(search);
  const id = q.get(LINK_PARAM);
  const stored = id ? known(id) : undefined;
  if (!stored) return q;
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(stored)) if (!q.has(k)) out.set(k, v);
  for (const [k, v] of q) if (k !== LINK_PARAM) out.append(k, v);
  return out;
}

/** What a page should write: `search` with a known stored link it still names folded back in, so nothing it held is lost. */
export function resolveWrite(search: string, known: (id: string) => LinkParams | undefined): string {
  const q = toParams(search);
  const id = q.get(LINK_PARAM);
  if (!id || !known(id)) return toSearch(q);
  return toSearch(effectiveParams(q, known));
}

/**
 * How to shorten `search`, or null when it fits under `max` or has nothing long to store:
 * `stored` holds its long parameters, `kept` the rest, in the order the page wrote them.
 */
export function planLink(search: string, max: number): { stored: LinkParams; kept: [string, string][] } | null {
  if (search.length <= max) return null;
  const q = toParams(search);
  const stored: LinkParams = {}, kept: [string, string][] = [];
  for (const [k, v] of q) {
    if (k !== LINK_PARAM && v.length > LONG_PARAM && !(k in stored)) stored[k] = v;
    else kept.push([k, v]);
  }
  return Object.keys(stored).length ? { stored, kept } : null;
}

/** The short URL: `?s=<id>` first, then the parameters that stayed. */
export function shortSearch(id: string, kept: [string, string][]): string {
  const q = new URLSearchParams([[LINK_PARAM, id], ...kept.filter(([k]) => k !== LINK_PARAM)]);
  return "?" + q.toString();
}
