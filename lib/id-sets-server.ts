// The request boundary for stored id sets: reading the sets a request names, as its signed-in
// reader, and deciding which connections may receive their ids. Every engine route reaches it
// through withRequestCustomData (lib/custom-data-server.ts), which is given the body it serves.
//
// Kept apart from lib/id-sets.ts because it needs the store and the federation routing, and
// lib/id-sets.ts is imported by lib/ch.ts, which federation itself imports.
import { idSetRefsIn, withIdSets } from "./id-sets.ts";
import { loadIdSetForRequest } from "./id-set-store.ts";
import { requirePrincipal } from "./auth.ts";
import { studyRouting, instanceForStudy } from "./federation.ts";
import { peerForStudy } from "./federation-remote.ts";

/**
 * The most stored sets one request may name: a locked analysis names two per cohort and one per
 * locked arm, and a document holds at most 48 cohorts with their arms.
 */
export const MAX_SETS_PER_REQUEST = 128;

/**
 * Run `fn` with every stored set `body` names read for it (a no-op when it names none). A set
 * names patient-level ids, so its studies' tables may go only to the patient-level instance that
 * holds each study; a study held anywhere else gets none, and a cohort that would need it there
 * is refused by carriesPatientIds before any query is made.
 */
export async function withRequestIdSets<T>(body: unknown, req: Request, fn: () => Promise<T>): Promise<T> {
  const refs = idSetRefsIn(body);
  if (!refs.length) return fn();
  if (refs.length > MAX_SETS_PER_REQUEST)
    throw new Error("a request names at most " + MAX_SETS_PER_REQUEST + " stored id sets; this one names " + refs.length);
  const principal = requirePrincipal(req, "use stored id sets");
  const sets = await Promise.all(refs.map((id) => loadIdSetForRequest(principal, id)));
  const routing = await studyRouting();
  const studyConn = new Map<string, string>();
  for (const study of new Set(sets.flatMap((s) => Object.keys(s.perStudy)))) {
    if (!routing.has(study) || await peerForStudy(study)) continue;
    const inst = await instanceForStudy(study);
    if (inst.mode === "patient-level") studyConn.set(study, inst.conn.id);
  }
  return withIdSets(sets, studyConn, fn);
}
