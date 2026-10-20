// The environment variables a page may read in the browser. PUBLIC_ENV names them (comma-separated);
// unset, it is DEFAULT_PUBLIC_ENV. They are read on each request and written into the page
// (app/_env/public-env.tsx), not baked in at build, so one image serves every deployment.
// Anything named here is visible to every reader of the page, so a name that looks like a secret is
// refused rather than published.

export const DEFAULT_PUBLIC_ENV = ["EXAMPLES_URL", "RESULTS_MAX_STUDIES", "CROSS_STUDY_EXPRESSION"];
const NAME = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_LIKE = /PASSWORD|SECRET|KEY|TOKEN|CREDENTIAL/;

/** The names PUBLIC_ENV lists; throws on a malformed one or one that looks like a secret. */
export function publicEnvNames(raw: string | undefined = process.env.PUBLIC_ENV): string[] {
  if (raw == null || !raw.trim()) return DEFAULT_PUBLIC_ENV;
  const names = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  for (const n of names) {
    if (!NAME.test(n)) throw new Error("PUBLIC_ENV: '" + n.slice(0, 80) + "' is not an environment variable name");
    if (SECRET_LIKE.test(n)) throw new Error("PUBLIC_ENV: '" + n + "' looks like a secret, so it is not sent to the browser");
  }
  return names;
}

/** The listed variables that are set, by name. */
export function publicEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of publicEnvNames(env.PUBLIC_ENV)) {
    const v = env[n];
    if (v != null && v !== "") out[n] = v;
  }
  return out;
}
