import { buildContract } from "../../../lib/oncoprint";

export async function POST(req) {
  try {
    const spec = await req.json();
    const contract = await buildContract(spec);
    return Response.json(contract);
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
