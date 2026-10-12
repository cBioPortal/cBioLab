// The commit this server was built from, set by next.config.mjs at build time. "+dirty" means
// tracked files differed from that commit; "dev" means a `next dev` server, which serves the
// working tree as it changes. Null outside Next — the stdio MCP server, the CLI and tests — and
// for a build that could find no commit (a Docker build given no GIT_COMMIT build argument).
export const BUILD_COMMIT: string | null = process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null;

const REPO = "https://github.com/cBioPortal/cohort-lab";

export type BuildInfo = {
  /** the full stamp as built, or null when the build could not tell */
  commit: string | null;
  /** what to show: a short id (with "+dirty"), "dev", or "unknown" */
  label: string;
  /** the commit on GitHub, when the stamp names one */
  url: string | null;
};

/** What a build stamp says, for people: an unknown commit reads "unknown" rather than blank. */
export function describeCommit(raw: string | null | undefined): BuildInfo {
  const commit = raw?.trim() || null;
  if (!commit) return { commit: null, label: "unknown", url: null };
  const m = /^([0-9a-f]{7,40})(\+dirty)?$/i.exec(commit);
  if (!m) return { commit, label: commit, url: null };
  return { commit, label: m[1].slice(0, 7) + (m[2] || ""), url: REPO + "/commit/" + m[1] };
}

export const BUILD_INFO: BuildInfo = describeCommit(BUILD_COMMIT);
