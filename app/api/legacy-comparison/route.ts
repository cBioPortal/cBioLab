// Saves the Comparison page's groups to cBioPortal's session service and answers with the link to
// that comparison there (lib/legacy-comparison.ts). The groups' sample ids go from this server to the
// portal that serves the same study, and only for a study it serves (portalHold); the browser gets
// the link alone.
import { z } from "zod";
import { parseBody } from "../../../lib/api-schemas.ts";
import { chQuery, PORTAL, PRIMARY, studiesChangeWhileRunning } from "../../../lib/ch.ts";
import { patientLevelConn, restrictedByName } from "../../../lib/federation.ts";
import { compileCohortDef } from "../../../lib/cohort2.ts";
import { studyProfiles } from "../../../lib/analysis.ts";
import { oncokbPin } from "../../../lib/annotation.ts";
import { portalHold } from "../../../lib/legacy-link.ts";
import { comparisonSession, comparisonHref, SESSION_MAX_GROUPS } from "../../../lib/legacy-comparison.ts";

export const maxDuration = 60;

const Body = z.object({
  study: z.string().min(1),
  cohorts: z.record(z.string(), z.unknown()).refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= SESSION_MAX_GROUPS,
    "1 to " + SESSION_MAX_GROUPS + " cohorts"),
  tab: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const { study, cohorts, tab } = parseBody(Body, await req.json());
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
    const res = await fetch(hold.portal + "/api/session/comparison_session", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(comparisonSession(s, groups)),
    });
    if (!res.ok) throw new Error("cBioPortal's session service answered " + res.status + ": " + (await res.text()).slice(0, 200));
    const { id } = await res.json() as { id?: string };
    if (!id) throw new Error("cBioPortal's session service saved the session but returned no id");
    return Response.json({ href: comparisonHref(hold.portal, id, tab), groups: groups.map((g) => ({ name: g.name, samples: g.samples.length })) });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
