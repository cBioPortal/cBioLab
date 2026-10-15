// Where the gallery examples run. The examples (lib/dsl-reference.ts EXAMPLES) are written against
// the public cBioPortal warehouse's studies, so an instance on another database cannot run them.
// Such an instance sets EXAMPLES_URL to a deployment that holds those studies (e.g.
// https://cbiolab.vercel.app) and its Examples tab opens them there; unset, they run here.

/** EXAMPLES_URL without a trailing slash, or null when unset; a value that is not an http(s) URL throws. */
export function examplesUrl(): string | null {
  const raw = (process.env.EXAMPLES_URL || "").trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("EXAMPLES_URL is not a URL: " + raw.slice(0, 200)); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("EXAMPLES_URL must be an http(s) URL, not " + u.protocol);
  return (u.origin + u.pathname).replace(/\/+$/, "");
}
