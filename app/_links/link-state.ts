// The page's side of stored links (docs/LINKS.md; the rules are lib/links.ts, the store
// lib/link-store.ts). Every page that keeps state in its URL reads and writes it through here:
//
//   linkParams()         the page's parameters as they mean, a stored link's or held ones put back
//   useLinkParams()      the same, for a component (use-link.ts, with the other hooks)
//   writeSearch(s, push) write the URL; past linkUrlMax() its long parameters are held in the
//                        history entry and the address says `long=<mark>` instead of carrying them
//   copyLink()           a short link to the page as it is: its long parameters stored, `?s=<id>`
//   openLink(id)         read a stored link (LinkGate does, before the page renders)
//
// Nothing is stored while a page is worked on: a link is stored only when someone asks for one
// (copyLink, or linkTo for a page opening another). A link's parameters are remembered in this tab
// (`known`) and in the history entry that names it (history.state), so Back, Forward and a reload
// never wait for the server once a link was read; held parameters live only in history.state, which
// a reload keeps. The server is reached only through /api/links (POST to store, GET /api/links/<id>
// to read), one place a browser test can intercept or hold. No React here: test/link-state.test.ts
// drives it with a stand-in history, location and fetch.
import { LINK_PARAM, LINK_ID, HELD_PARAM, canonicalLinkJson, effectiveParams, heldMark, heldSearch, linkUrlMax, planLink, resolveWrite,
  shortSearch, type LinkParams } from "../../lib/links.ts";

const STATE_KEY = "cbioLink";
const known = new Map<string, LinkParams>();

type Entry = { id?: string; params?: LinkParams; mark?: string; held?: LinkParams };
const entry = (): Entry | undefined => {
  try { return (history.state as Record<string, unknown> | null)?.[STATE_KEY] as Entry | undefined; }
  catch { return undefined; }   // no history: nothing remembered
};

/** A stored link's parameters if this tab has read or written it. */
export function knownLink(id: string): LinkParams | undefined {
  const hit = known.get(id);
  if (hit) return hit;
  const s = entry();
  if (s?.id === id && s.params) { known.set(id, s.params); return s.params; }
  return undefined;
}

/** The long parameters this history entry holds, when `search` says it holds them (its `long=` mark matches). */
export function heldParams(search: string = typeof location === "undefined" ? "" : location.search): LinkParams | undefined {
  const mark = new URLSearchParams(search).get(HELD_PARAM);
  const s = entry();
  return mark && s?.held && s.mark === mark ? s.held : undefined;
}

/** The address says its long parameters are held, but this tab does not hold them: it was copied from another browser. */
export const heldElsewhere = (search: string): boolean => new URLSearchParams(search).has(HELD_PARAM) && !heldParams(search);

/** The page's parameters as they mean: `search` (the address bar's by default) with a known stored link, or held parameters, put back. */
export function linkParams(search: string = typeof location === "undefined" ? "" : location.search): URLSearchParams {
  return effectiveParams(search, knownLink, heldParams(search));
}

/** The stored link the address bar names, if any. */
export const linkIdOf = (search: string): string | null => {
  const id = new URLSearchParams(search).get(LINK_PARAM);
  return id && LINK_ID.test(id) ? id : null;
};

/** Read a stored link; remembered for the rest of this tab. Throws the server's refusal. */
export async function openLink(id: string): Promise<LinkParams> {
  const hit = knownLink(id);
  if (hit) return hit;
  const res = await fetch("/api/links/" + encodeURIComponent(id));
  const j = await res.json().catch(() => ({ error: res.status + " " + res.statusText }));
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  known.set(id, j.params);
  return j.params;
}

/** The id these parameters are already stored under, if this tab knows it. */
function knownIdOf(params: LinkParams): string | undefined {
  const want = canonicalLinkJson(params);
  for (const [id, p] of known) if (canonicalLinkJson(p) === want) return id;
  const s = entry();
  return s?.id && s.params && canonicalLinkJson(s.params) === want ? s.id : undefined;
}

/** Store parameters; their id. Parameters this tab already stored or read are not sent again. */
export async function storeLink(params: LinkParams): Promise<string> {
  const had = knownIdOf(params);
  if (had) return had;
  const res = await fetch("/api/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params }) });
  const j = await res.json().catch(() => ({ error: res.status + " " + res.statusText }));
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  known.set(j.id, params);
  return j.id;
}

// ---------------------------------------------------------------------------------------------
// The threshold, and what the page is told while its address holds less than the page
// ---------------------------------------------------------------------------------------------

let configured: string | undefined;
/** The deployment's LINK_URL_MAX (LinkGate passes it from the public environment). */
export function configureLinks(urlMax: string | undefined): void { configured = urlMax; }
/** The query string length past which a page holds its long parameters; a browser test may set `window.__cbioLinkUrlMax`. */
export function currentLinkUrlMax(): number {
  const test = typeof window === "undefined" ? undefined : (window as { __cbioLinkUrlMax?: number }).__cbioLinkUrlMax;
  return linkUrlMax(test ?? configured);
}

/** The page's address holds less than the page: how long the full one would be. Null while it holds everything. */
export type Held = { length: number } | null;
const listeners = new Set<(h: Held) => void>();
/** Hear when the page starts or stops holding its long parameters out of its address. */
export function onHeld(fn: (h: Held) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
const tell = (h: Held) => { for (const fn of listeners) fn(h); };

/** Whether the address bar holds less than the page now, and how long the full address would be. */
export function currentHeld(): Held {
  if (typeof location === "undefined") return null;
  const held = heldParams();
  return held ? { length: ("?" + linkParams().toString()).length } : null;
}

// ---------------------------------------------------------------------------------------------
// Writing the URL, and making a link
// ---------------------------------------------------------------------------------------------

/** history.state without a stored link's or held parameters' entry, for a URL that no longer names them. */
const stateWithout = (): Record<string, unknown> => {
  const s = { ...((history.state as Record<string, unknown> | null) || {}) };
  delete s[STATE_KEY];
  return s;
};

/**
 * Write the page's URL (`search` is "?…"): a new history entry when `push`, else over the current
 * one. A stored link or held parameters the URL still names are folded back in first, so nothing is
 * lost. Up to linkUrlMax() the address carries everything. Past it, the long parameters are held in
 * the entry's history.state and the address carries the short ones and `long=<mark>` — unless they
 * are a link this tab already stored or read, when the address is that `?s=<id>`. `state` is merged
 * into the entry's history.state.
 */
export function writeSearch(search: string, opts: { push?: boolean; state?: Record<string, unknown> } = {}): void {
  try {
    const full = resolveWrite(search, knownLink, heldParams());
    const base = { ...stateWithout(), ...(opts.state || {}) };
    let next = full, link: Entry | undefined;
    // long parameters this tab already has a link for stay that link, whatever the length
    const all = planLink(full, 0);
    const id = all ? knownIdOf(all.stored) : undefined;
    if (all && id) { next = shortSearch(id, all.kept); link = { id, params: all.stored }; }
    else {
      const plan = planLink(full, currentLinkUrlMax());
      if (plan) { const mark = heldMark(plan.stored); next = heldSearch(mark, plan.kept); link = { mark, held: plan.stored }; }
    }
    const state = link ? { ...base, [STATE_KEY]: link } : base;
    const url = location.pathname + next + location.hash;
    if (opts.push) history.pushState(state, "", url); else history.replaceState(state, "", url);
    tell(link?.held ? { length: full.length } : null);
  } catch { /* URL state is a convenience, never a failure */ }
}

/**
 * A link to the page as it is now, short however much it holds: its long parameters (any longer
 * than LONG_PARAM, whatever the address's length) are stored and the link is `?s=<id>` plus the
 * short ones; a page with none is linked as it is. The address bar becomes that link too, so what
 * it shows is what was copied. Throws the store's refusal.
 */
export async function copyLink(): Promise<string> {
  const search = "?" + linkParams().toString();
  const plan = planLink(search, 0);
  if (!plan) return location.origin + location.pathname + (search === "?" ? "" : search);
  const id = await storeLink(plan.stored);
  const short = shortSearch(id, plan.kept);
  // the page may have moved on while the link was stored; only an address still meaning the same is rewritten
  if ("?" + linkParams().toString() === search) {
    try {
      history.replaceState({ ...stateWithout(), [STATE_KEY]: { id, params: plan.stored } }, "", location.pathname + short + location.hash);
      tell(null);
    } catch { /* as above */ }
  }
  return location.origin + location.pathname + short;
}

/**
 * A URL for `path` carrying `params`, short however much they hold: past linkUrlMax() its long
 * parameters are stored first (for a page that opens another, e.g. a comparison in a new tab).
 */
export async function linkTo(path: string, params: Record<string, string>): Promise<string> {
  const search = "?" + new URLSearchParams(params).toString();
  const plan = planLink(search, currentLinkUrlMax());
  if (!plan) return path + search;
  return path + shortSearch(await storeLink(plan.stored), plan.kept);
}
