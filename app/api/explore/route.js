import { buildExplore } from "../../../lib/explore.js";
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
    const study = await resolveStudy(body.study);
    const { profiles, gaProfiles } = await studyProfiles(study);
    const pin = process.env.ONCOKB_PIN || await oncokbPin();
    return Response.json(await buildExplore({ study, draft: body.draft || null, oncokbPin: pin, profiles, gaProfiles }));
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
