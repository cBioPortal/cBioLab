import { execSync } from "node:child_process";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// The commit being built, for the method records views carry (lib/build-info.ts). Vercel
// provides VERCEL_GIT_COMMIT_SHA itself and a Docker build passes GIT_COMMIT; elsewhere ask git,
// and mark a tree whose tracked files differ from the commit, since the record would otherwise
// name code that is not what ran.
function gitCommit() {
  try {
    const sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    let dirty = false;
    try { execSync("git diff --quiet HEAD", { stdio: "ignore" }); } catch { dirty = true; }
    return sha + (dirty ? "+dirty" : "");
  } catch { return ""; }
}

/** @type {(phase: string) => import('next').NextConfig} */
const nextConfig = (phase) => ({
  // `next dev` serves the working tree as it changes, so no commit stamped at startup describes it
  env: { GIT_COMMIT: phase === PHASE_DEVELOPMENT_SERVER ? "dev" : process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || gitCommit() },
  // Where the build output goes. Overridable so a production build can run in a
  // folder whose `next dev` server is live: dev owns `.next`, and a gate build
  // writes `.next-gate` beside it (see scripts/gate.sh). Sharing one directory
  // makes the two fight — and serving a production build from a directory that
  // is also built in is what silently broke the tailnet instance three times.
  // Unset in production, so Vercel builds to `.next` as normal.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // `'use cache: remote'` (lib/next-cache.ts) needs Cache Components
  cacheComponents: true,
  // hosts besides localhost that may load `next dev`'s scripts and HMR socket (e.g. a tailnet
  // proxy in front of a dev server); comma-separated, dev only
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS || "").split(",").map((h) => h.trim()).filter(Boolean),
  // `next dev` otherwise appends its own section to CLAUDE.md on every start
  agentRules: false,
  // ship the bundled font (and its dir) inside the serverless function for the MCP route,
  // so SVG->PNG rasterization has a font on Vercel (no system fonts in functions)
  outputFileTracingIncludes: {
    "/api/[transport]": ["./assets/fonts/**"]
  }
});

export default nextConfig;
