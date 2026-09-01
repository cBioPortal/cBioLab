import { buildExplore, buildExploreFederated } from "../../../lib/explore.ts";
import { studyRouting, carriesPatientIds, instanceForStudy } from "../../../lib/federation.ts";
import { PRIMARY } from "../../../lib/ch.ts";
import { studyProfiles, resolveStudy } from "../../../lib/analysis.ts";
import { chQuery } from "../../../lib/ch.ts";

export const maxDuration = 60;

async function oncokbPin() {
  try {
    const r = await chQuery("SELECT oncokb_version FROM oncokb_annotation.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1");
    return r.data[0]?.oncokb_version || null;
  } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const requested = Array.isArray(body.studies) && body.studies.length
      ? body.studies : [body.study];
    const studies = [];
    for (const s of requested) studies.push(await resolveStudy(s));
    const pin = process.env.ONCOKB_PIN || await oncokbPin();
    const profilesByStudy = new Map();
    for (const s of studies) profilesByStudy.set(s, await studyProfiles(s));
    const routing = await studyRouting();
    // A study held only by a remote MCP peer has no local connection. Explore is
    // not yet federated over MCP (the analysis views are), so refuse rather than
    // silently query the primary database and report zeroes for someone else's study.
    const unreachable = studies.filter((s) => !routing.has(s));
    if (unreachable.length)
      return Response.json({ error: "Explore cannot reach " + unreachable.join(", ") +
        " — held by a remote peer, and faceting is not yet federated over MCP (compare/survival views are). Deselect it to continue." }, { status: 400 });
    const connByStudy = new Map(studies.map((s) => [s, routing.get(s) || PRIMARY]));
    // An explicit patient list must not be compiled into SQL for an instance that
    // is not entitled to patient-level data — the ids would cross the boundary
    // inside the query text (and, being study-scoped, could never match there).
    if (carriesPatientIds(body.draft)) {
      for (const s of studies) {
        const inst = await instanceForStudy(s);
        if (inst.mode !== "patient-level")
          return Response.json({ error: "this draft contains an explicit patient list, which cannot be sent to " + inst.label + "; remove that clause or deselect " + s }, { status: 400 });
      }
    }
    if (studies.length === 1) {
      const { profiles, gaProfiles } = profilesByStudy.get(studies[0]);
      return Response.json(await buildExplore({ study: studies[0], draft: body.draft || null, oncokbPin: pin, profiles, gaProfiles, conn: connByStudy.get(studies[0]) }));
    }
    return Response.json(await buildExploreFederated({ studies, draft: body.draft || null, oncokbPin: pin, profilesByStudy, connByStudy }));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
