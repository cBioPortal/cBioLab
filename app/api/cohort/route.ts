import { chQuery, STUDY } from "../../../lib/ch";
import { patientLevelConn } from "../../../lib/federation";
import { compileCohort } from "../../../lib/compiler";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const conn = await patientLevelConn(STUDY, "this endpoint lists the matching patients");
    const { countSql, patientsSql, histSql, histBucket } = compileCohort({
      db: conn.db, study: STUDY,
      a: body.a, b: body.b, rel: body.rel, priorGuard: !!body.priorGuard,
      lineGap: body.lineGap
    });
    const cRes = await chQuery(countSql, conn);
    const pRes = await chQuery(patientsSql, conn);
    let hist = null;
    if (histSql) {
      const hRes = await chQuery(histSql, conn);
      hist = hRes.data.map(r => ({ bucket: Number(r.bucket), n: Number(r.n) }));
    }
    return Response.json({
      matched: Number(cRes.data[0].matched),
      denom: Number(cRes.data[0].denom),
      patients: pRes.data.map(r => r.pid),
      hist, histBucket,
      sql: countSql,
      ms: cRes._ms, rowsRead: Number(cRes.statistics?.rows_read)
    });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
