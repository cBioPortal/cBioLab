import { createCampaign, listCampaigns } from "../../../lib/campaign.ts";

export async function GET() {
  try { return Response.json({ campaigns: await listCampaigns() }); }
  catch (e) { return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 }); }
}

export async function POST(req: Request) {
  try {
    const { question, study } = await req.json();
    return Response.json({ campaign: await createCampaign(String(question || ""), String(study || "msk_chord_2024")) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 });
  }
}
