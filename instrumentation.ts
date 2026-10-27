// Runs once when the Next server starts: administrators' setting overrides (lib/settings.ts) apply
// to this server. The CLI, the stdio MCP server and the tests never load this file, so they read the
// environment alone.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  (await import("./lib/settings.ts")).enableSettingOverrides();
}
