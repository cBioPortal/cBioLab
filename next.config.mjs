/** @type {import('next').NextConfig} */
const nextConfig = {
  // Where the build output goes. Overridable so a production build can run in a
  // folder whose `next dev` server is live: dev owns `.next`, and a gate build
  // writes `.next-gate` beside it (see scripts/gate.sh). Sharing one directory
  // makes the two fight — and serving a production build from a directory that
  // is also built in is what silently broke the tailnet instance three times.
  // Unset in production, so Vercel builds to `.next` as normal.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // `'use cache: remote'` (lib/next-cache.ts) needs Cache Components
  cacheComponents: true,
  // `next dev` otherwise appends its own section to CLAUDE.md on every start
  agentRules: false,
  // ship the bundled font (and its dir) inside the serverless function for the MCP route,
  // so SVG->PNG rasterization has a font on Vercel (no system fonts in functions)
  outputFileTracingIncludes: {
    "/api/[transport]": ["./assets/fonts/**"]
  }
};

export default nextConfig;
