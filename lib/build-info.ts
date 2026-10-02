// The commit this server was built from, set by next.config.mjs at build time. "+dirty" means
// tracked files differed from that commit; "dev" means a `next dev` server, which serves the
// working tree as it changes. Null outside Next — the stdio MCP server, the CLI and tests.
export const BUILD_COMMIT: string | null = process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null;
