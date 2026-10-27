// One log line per federation call, at each end, so a deployment's runtime logs show that a study
// really was answered by a peer: "[federation →]" where this app asks a peer (lib/federation-
// remote.ts), "[federation ←]" where its federation API answers a call (app/api/federation/v1/[op]).
// A line names the op, the study, the peer or caller, how long and how much — never a patient:
// the arguments are not logged, only the study and, for the patient-level ops, the table.

const kb = (n: number) => (n / 1024).toFixed(1) + " kB";

/** What a call is about, from its arguments: the study, and the table a patient-level call reads. */
function subject(op: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const study = typeof a.study === "string" ? " study=" + a.study.slice(0, 80) : "";
  const table = typeof a.table === "string" ? " table=" + a.table.slice(0, 40) : "";
  return study + table + (op.startsWith("patient-") || op === "plot-cases" ? " (patient-level)" : "");
}

/** A call this app made to a peer. */
export function logOutbound(op: string, args: unknown, url: string, loopback: boolean, ms: number, outcome: { bytes: number } | { error: string }): void {
  const end = "error" in outcome ? "FAILED: " + outcome.error.slice(0, 200) : "ok " + kb(outcome.bytes);
  console.log("[federation →] " + op + subject(op, args) + " peer=" + url + (loopback ? " (this app, as its simulated peer)" : "") + " " + ms + "ms " + end);
}

/** A call this app's federation API answered. */
export function logInbound(op: string, args: unknown, asPeer: boolean, ms: number, status: number, bytes: number): void {
  console.log("[federation ←] " + op + subject(op, args) + " caller=" + (asPeer ? "this app (answered as its simulated peer)" : "outside") + " " + ms + "ms HTTP " + status + " " + (status === 200 ? "answered " + kb(bytes) : "REFUSED"));
}
