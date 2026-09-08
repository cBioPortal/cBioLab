import { columnDetail } from "../../../../lib/oncoprint-detail";

export const maxDuration = 30;

// POST { spec, column } -> what that one column carries. The tooltip's second half: the
// contract ships bitmasks for every column, this ships specifics for the one being read.
export async function POST(req: Request) {
  try {
    const { spec, column } = await req.json();
    if (!spec || typeof column !== "string") throw new Error("body must be { spec, column }");
    return Response.json(await columnDetail(spec, column));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
