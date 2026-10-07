import type { OncoprintSpec } from "../../../../lib/types.ts";
import { parseBody, OncoprintDetailRequest } from "../../../../lib/api-schemas.ts";
import { columnDetail } from "../../../../lib/oncoprint-detail";

export const maxDuration = 30;

// POST { spec, column } -> what that one column carries. The tooltip's second half: the
// contract ships bitmasks for every column, this ships specifics for the one being read.
export async function POST(req: Request) {
  try {
    const { spec, column } = parseBody(OncoprintDetailRequest, await req.json());
    return Response.json(await columnDetail(spec as unknown as OncoprintSpec, column));
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
