// One log line per federated MCP call, at each end, so a deployment's runtime logs show that a
// study really was answered over MCP: "[federation →]" where this app asks a peer (lib/federation-
// remote.ts), "[federation ←]" where its /api/mcp answers a call (app/api/[transport]/route.ts).
// A line names the tool, the study, the peer or caller, how long and how much — never a patient:
// the arguments are not logged, only the study and, for the patient-level tools, the table.

const kb = (n: number) => (n / 1024).toFixed(1) + " kB";

/** What a call is about, from its arguments: the study, and the table a patient-level call reads. */
function subject(tool: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const study = typeof a.study === "string" ? " study=" + a.study.slice(0, 80) : "";
  const table = typeof a.table === "string" ? " table=" + a.table.slice(0, 40) : "";
  return study + table + (tool.startsWith("federated_patient") ? " (patient-level)" : "");
}

/** A call this app made to a peer. */
export function logOutbound(tool: string, args: unknown, url: string, loopback: boolean, ms: number, outcome: { bytes: number } | { error: string }): void {
  const end = "error" in outcome ? "FAILED: " + outcome.error.slice(0, 200) : "ok " + kb(outcome.bytes);
  console.log("[federation →] " + tool + subject(tool, args) + " peer=" + url + (loopback ? " (this app, as its simulated peer)" : "") + " " + ms + "ms " + end);
}

/** A tool call this app's MCP endpoint answered. */
export function logInbound(tool: string, args: unknown, asPeer: boolean, ms: number, status: number, body: string): void {
  const refused = /"isError"\s*:\s*true/.test(body);
  console.log("[federation ←] " + tool + subject(tool, args) + " caller=" + (asPeer ? "this app (answered as its simulated peer)" : "outside") + " " + ms + "ms HTTP " + status + " " + (refused ? "REFUSED" : "answered " + kb(body.length)));
}
