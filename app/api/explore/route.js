import { buildExplore, buildExploreFederated } from "../../../lib/explore.js";
import { studyProfiles, resolveStudy } from "../../../lib/analysis.js";
import { chQuery } from "../../../lib/ch.js";

export const maxDuration = 60;

async function oncokbPin() {
  try {
    const r = await chQuery("SELECT oncokb_version FROM oncokb_annotation.variant_annotation GROUP BY oncokb_version ORDER BY max(resolved_at) DESC LIMIT 1");
    return r.data[0]?.oncokb_version || null;
  } catch { return null; }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const requested = Array.isArray(body.studies) && body.studies.length
      ? body.studies : [body.study];
    const studies = [];
    for (const s of requested) studies.push(await resolveStudy(s));
    const pin = process.env.ONCOKB_PIN || await oncokbPin();
    const profilesByStudy = new Map();
    for (const s of studies) profilesByStudy.set(s, await studyProfiles(s));
    if (studies.length === 1) {
      const { profiles, gaProfiles } = profilesByStudy.get(studies[0]);
      return Response.json(await buildExplore({ study: studies[0], draft: body.draft || null, oncokbPin: pin, profiles, gaProfiles }));
    }
    return Response.json(await buildExploreFederated({ studies, draft: body.draft || null, oncokbPin: pin, profilesByStudy }));
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
