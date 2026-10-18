import { parseBody, LockRequest } from "../../../lib/api-schemas.ts";
import { requirePrincipal, AccessError } from "../../../lib/auth.ts";
import { withRequestCustomData } from "../../../lib/custom-data-server.ts";
import { lockCohorts } from "../../../lib/cohort-lock-server.ts";
import { dataVersion } from "../../../lib/next-cache.ts";

export const maxDuration = 60;

/**
 * Lock cohorts of a document (lib/cohort-lock.ts): `{ doc, cohorts? }`, every cohort when none are
 * named. Answers the moment, the data version, the OncoKB release and each cohort's lock, for the
 * page to write into the document. The members are saved as the reader's stored id sets.
 */
export async function POST(req: Request) {
  try {
    const principal = requirePrincipal(req, "lock cohorts");
    const { customData, customRefs, doc, cohorts } = parseBody(LockRequest, await req.json());
    return Response.json(await withRequestCustomData(customData, () => lockCohorts(principal, { doc, cohorts }, dataVersion), { refs: customRefs, req, uses: doc }));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
