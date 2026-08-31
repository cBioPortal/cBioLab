import { buildContract } from "../../../lib/oncoprint";

export async function POST(req: Request) {
  try {
    const spec = await req.json();
    const contract = await buildContract(spec);
    return Response.json(contract);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
