import { parseBody, BiomarkersRequest } from "../../../lib/api-schemas.ts";
import { chQuery } from "../../../lib/ch.ts";
import { studyRouting } from "../../../lib/federation.ts";
import { oncokbPin } from "../../../lib/annotation.ts";
import { biomarkerCallsSql, studyCancerTypeSql, type BiomarkerCall } from "../../../lib/biomarkers.ts";

// OncoKB's stored TMB-H / MSI-H calls at the pin for one tumour type (lib/biomarkers.ts), for the
// Patient page header: reference data, no patient rows. A tumour type of null is the study's.
// Without a pin, or for a study this instance does not hold, there are no calls.
export async function POST(req: Request) {
  try {
    const body = parseBody(BiomarkersRequest, await req.json());
    const pin = await oncokbPin();
    if (!pin || !body.alterations.length) return Response.json({ pin, calls: [] });
    let tumorType = body.tumorType;
    if (tumorType == null) {
      const conn = (await studyRouting()).get(body.study);
      if (!conn) return Response.json({ pin, calls: [] });
      tumorType = (await chQuery<{ name: string }>(studyCancerTypeSql(conn.db, body.study), conn)).data[0]?.name || "";
    }
    const calls = (await chQuery<BiomarkerCall>(biomarkerCallsSql(pin, tumorType, body.alterations))).data;
    return Response.json({ pin, calls });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
