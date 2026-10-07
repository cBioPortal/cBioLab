import { createCampaign, listCampaigns } from "../../../lib/campaign.ts";
import { requirePrincipal, AccessError } from "../../../lib/auth.ts";

// Reading campaigns is open; starting one needs the login (lib/auth.ts), as saving does.

export async function GET() {
  try { return Response.json({ campaigns: await listCampaigns() }); }
  catch (e) { return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 }); }
}

export async function POST(req: Request) {
  try {
    requirePrincipal(req, "start a campaign");
    const { question, study } = await req.json();
    return Response.json({ campaign: await createCampaign(String(question || ""), String(study || "msk_chord_2024")) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: e instanceof AccessError ? e.status : 400 });
  }
}
