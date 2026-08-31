import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";

const client = new Client({ name: "test", version: "1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3201/mcp")));

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map(t => t.name).join(", "));

const r1 = await client.callTool({ name: "describe_study", arguments: {} });
console.log("\n== describe_study (first 400 chars):\n" + (r1.content as any[])[0].text.slice(0, 400));

const r2 = await client.callTool({ name: "query_cohort", arguments: {
  a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] },
  b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] },
  rel: { type: "BEFORE", minDays: 0, maxDays: 180 }
}});
console.log("\n== query_cohort:\n" + (r2.content as any[])[0].text.slice(0, 500));

const r3 = await client.callTool({ name: "derive_treatment_lines", arguments: { gap: 90, guard: true } });
console.log("\n== derive_treatment_lines:\n" + (r3.content as any[])[0].text.slice(0, 400));

const r4 = await client.callTool({ name: "render_oncoprint", arguments: {
  genes: ["TP53", "KRAS", "STK11", "MSH3"],
  groups: [
    { name: "progressed ≤180d", dsl: { a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] },
      b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "BEFORE", minDays: 0, maxDays: 180 } } },
    { name: "no progression", dsl: { a: { eventType: "Treatment", attrs: [{ key: "SUBTYPE", value: "Immuno" }] },
      b: { eventType: "Diagnosis", attrs: [{ key: "PROGRESSION", value: "Y" }] }, rel: { type: "NOT_FOLLOWED_BY", withinDays: 180, observed: true } } }
  ],
  derivedEventTracks: [{ label: "Reached 2L", expression: { a: { eventType: "Treatment line (derived)", attrs: [{ key: "LINE_NO", value: "2" }] }, rel: { type: "NONE" } } }],
  clinical: ["OS_STATUS"]
}});
const img = (r4.content as any[]).find(c => c.type === "image");
const txt = (r4.content as any[]).find(c => c.type === "text");
fs.writeFileSync("/home/ubuntu/cohort-lab-next/mcp-oncoprint.png", Buffer.from(img.data, "base64"));
console.log("\n== render_oncoprint: image " + Math.round(img.data.length * 3 / 4 / 1024) + " KB, saved. Text:\n" + txt.text);
await client.close();
