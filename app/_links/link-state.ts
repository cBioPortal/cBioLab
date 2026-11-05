// The page's side of stored links (docs/LINKS.md; the rules are lib/links.ts, the store
// lib/link-store.ts). Every page that keeps state in its URL reads and writes it through here:
//
//   linkParams()         the page's parameters as they mean, a stored link's put back
//   useLinkParams()      the same, for a component (use-link.ts, with the other hooks)
//   writeSearch(s, push) write the URL; past linkUrlMax() its long parameters are stored and the
//                        address bar becomes ?s=<id> plus the short ones
//   openLink(id)         read a stored link (LinkGate does, before the page renders)
//
// A link's parameters are remembered in this tab (`known`) and in the history entry that names it
// (history.state), so Back, Forward and a reload never wait for the server once a link was read.
// The server is reached only through /api/links (POST to store, GET /api/links/<id> to read), one
// place a browser test can intercept or hold. No React here: test/link-state.test.ts drives it with
// a stand-in history, location and fetch.
import { LINK_PARAM, LINK_ID, effectiveParams, linkUrlMax, planLink, resolveWrite, shortSearch, type LinkParams } from "../../lib/links.ts";

const STATE_KEY = "cbioLink";
const known = new Map<string, LinkParams>();

/** A stored link's parameters if this tab has read or written it. */
export function knownLink(id: string): LinkParams | undefined {
  const hit = known.get(id);
  if (hit) return hit;
  try {
    const s = (history.state as Record<string, unknown> | null)?.[STATE_KEY] as { id?: string; params?: LinkParams } | undefined;
    if (s?.id === id && s.params) { known.set(id, s.params); return s.params; }
  } catch { /* no history: nothing remembered */ }
  return undefined;
}

/** The page's parameters as they mean: `search` (the address bar's by default) with a known stored link put back. */
export function linkParams(search: string = typeof location === "undefined" ? "" : location.search): URLSearchParams {
  return effectiveParams(search, knownLink);
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

/** Store parameters; their id. */
export async function storeLink(params: LinkParams): Promise<string> {
  const res = await fetch("/api/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params }) });
  const j = await res.json().catch(() => ({ error: res.status + " " + res.statusText }));
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  known.set(j.id, params);
  return j.id;
}

// ---------------------------------------------------------------------------------------------
// The threshold, and what the page is told when a link could not be stored
// ---------------------------------------------------------------------------------------------

let configured: string | undefined;
/** The deployment's LINK_URL_MAX (LinkGate passes it from the public environment). */
export function configureLinks(urlMax: string | undefined): void { configured = urlMax; }
/** The query string length past which a page stores its link; a browser test may set `window.__cbioLinkUrlMax`. */
export function currentLinkUrlMax(): number {
  const test = typeof window === "undefined" ? undefined : (window as { __cbioLinkUrlMax?: number }).__cbioLinkUrlMax;
  return linkUrlMax(test ?? configured);
}

export type LinkProblem = { length: number; error: string } | null;
const listeners = new Set<(p: LinkProblem) => void>();
/** Hear when the address bar is too long and could not be stored (and when that is over). */
export function onLinkProblem(fn: (p: LinkProblem) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
const tell = (p: LinkProblem) => { for (const fn of listeners) fn(p); };

// ---------------------------------------------------------------------------------------------
// Writing the URL
// ---------------------------------------------------------------------------------------------

/** history.state without a stored link's entry, for a URL that no longer names it. */
const stateWithout = (): Record<string, unknown> => {
  const s = { ...((history.state as Record<string, unknown> | null) || {}) };
  delete s[STATE_KEY];
  return s;
};

/**
 * Write the page's URL (`search` is "?…"): a new history entry when `push`, else over the current
 * one. A known stored link the URL still names is folded back in first, so nothing it held is lost;
 * past linkUrlMax() the long parameters are then stored and the entry rewritten to the short form,
 * once the server has them, and only if the page has not written another URL meanwhile. `state`
 * is merged into the entry's history.state.
 */
export function writeSearch(search: string, opts: { push?: boolean; state?: Record<string, unknown> } = {}): void {
  try {
    const full = resolveWrite(search, knownLink);
    const url = location.pathname + full + location.hash;
    const state = { ...stateWithout(), ...(opts.state || {}) };
    if (opts.push) history.pushState(state, "", url); else history.replaceState(state, "", url);
    void shorten(full);
  } catch { /* URL state is a convenience, never a failure */ }
}

async function shorten(full: string): Promise<void> {
  const plan = planLink(full, currentLinkUrlMax());
  if (!plan) { tell(null); return; }
  let id: string;
  try { id = await storeLink(plan.stored); }
  catch (e) { if (location.search === full) tell({ length: full.length, error: String((e as Error)?.message || e) }); return; }
  if (location.search !== full) return;   // the page has written again; that write stores its own
  try {
    history.replaceState({ ...((history.state as Record<string, unknown> | null) || {}), [STATE_KEY]: { id, params: plan.stored } }, "",
      location.pathname + shortSearch(id, plan.kept) + location.hash);
    tell(null);
  } catch { /* as above */ }
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
