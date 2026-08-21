/** @type {import('next').NextConfig} */
const nextConfig = {
  // ship the bundled font (and its dir) inside the serverless function for the MCP route,
  // so SVG->PNG rasterization has a font on Vercel (no system fonts in functions)
  outputFileTracingIncludes: {
    "/api/[transport]": ["./assets/fonts/**"]
  }
};

export default nextConfig;
