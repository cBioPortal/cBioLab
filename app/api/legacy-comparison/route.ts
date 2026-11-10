// The Comparison page's groups as a cBioPortal comparison session, for the reader's browser to save
// to the portal's session service (lib/legacy-comparison.ts): a session saved from a server is not
// found by the portal's readers. The groups' sample ids go to the browser only for a study the portal
// serves (portalHold), whose ids it already publishes, and only from a patient-level instance.
import { z } from "zod";
import { parseBody } from "../../../lib/api-schemas.ts";
import { chQuery, PORTAL, PRIMARY, studiesChangeWhileRunning } from "../../../lib/ch.ts";
import { patientLevelConn, restrictedByName } from "../../../lib/federation.ts";
import { compileCohortDef } from "../../../lib/cohort2.ts";
import { studyProfiles } from "../../../lib/analysis.ts";
import { oncokbPin } from "../../../lib/annotation.ts";
import { portalHold } from "../../../lib/legacy-link.ts";
import { comparisonSession, SESSION_MAX_GROUPS } from "../../../lib/legacy-comparison.ts";

export const maxDuration = 60;

const Body = z.object({
  study: z.string().min(1),
  cohorts: z.record(z.string(), z.unknown()).refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= SESSION_MAX_GROUPS,
    "1 to " + SESSION_MAX_GROUPS + " cohorts"),
});

export async function POST(req: Request) {
  try {
    const { study, cohorts } = parseBody(Body, await req.json());
    const s = study.replace(/[^A-Za-z0-9._-]/g, "");
    const conn = await patientLevelConn(s, "saving the groups to cBioPortal sends their sample ids");
    const hold = portalHold({ id: s, instance: conn.id, instanceLabel: conn.label },
      { portal: PORTAL, primary: PRIMARY.id, local: studiesChangeWhileRunning(), restricted: restrictedByName(s) });
    if ("why" in hold) throw new Error(hold.why);
    const { profiles, gaProfiles } = await studyProfiles(s);
    const pin = process.env.ONCOKB_PIN || await oncokbPin();
    const groups = await Promise.all(Object.entries(cohorts).map(async ([name, def]) => {
      const sql = compileCohortDef(def as Parameters<typeof compileCohortDef>[0], { study: s, db: conn.db, profiles, gaProfiles, oncokbPin: pin });
      const { data } = await chQuery<{ sid: string }>("SELECT DISTINCT sid FROM (" + sql + ") ORDER BY sid", conn);
      return { name, samples: data.map((r) => r.sid) };
    }));
    return Response.json({ portal: hold.portal, session: comparisonSession(s, groups) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
