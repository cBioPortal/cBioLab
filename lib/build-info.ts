// The commit this server was built from, set by next.config.mjs at build (and dev-server start)
// time. "+dirty" means tracked files differed from that commit. Null outside Next — the stdio
// MCP server, the CLI and tests — where nothing sets it.
export const BUILD_COMMIT: string | null = process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null;
