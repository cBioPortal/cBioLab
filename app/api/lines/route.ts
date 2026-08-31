import { chQuery, DB, STUDY } from "../../../lib/ch";
import { compileLines } from "../../../lib/compiler";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { histSql, transSql } = compileLines(DB, STUDY, body.gap, !!body.guard);
    const h = await chQuery(histSql);
    const t = await chQuery(transSql);
    return Response.json({
      hist: h.data.map(r => ({ bucket: Number(r.bucket), n: Number(r.n) })),
      transitions: t.data.map(r => ({ line1: r.line1, line2: r.line2, n: Number(r.n) })),
      sql: histSql + "\n\n-- transitions --\n" + transSql,
      ms: (h._ms ?? 0) + (t._ms ?? 0)
    });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
