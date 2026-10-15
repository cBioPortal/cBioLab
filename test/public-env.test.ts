// What reaches the browser: only the environment variables PUBLIC_ENV names, never a secret-shaped
// one, and the examples' site only as an http(s) URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicEnv, publicEnvNames, DEFAULT_PUBLIC_ENV } from "../lib/public-env.ts";
import { parseExamplesUrl } from "../lib/site.ts";

test("unset PUBLIC_ENV exposes the default names only", () => {
  assert.deepEqual(publicEnvNames(undefined), DEFAULT_PUBLIC_ENV);
  assert.deepEqual(publicEnv({ EXAMPLES_URL: "https://cbiolab.vercel.app", CLICKHOUSE_PASSWORD: "x", PORTAL_URL: "p" }),
    { EXAMPLES_URL: "https://cbiolab.vercel.app" });
});

test("PUBLIC_ENV names exactly what is sent, and leaves out what is unset", () => {
  assert.deepEqual(publicEnv({ PUBLIC_ENV: "PORTAL_URL, EXAMPLES_URL", PORTAL_URL: "https://www.cbioportal.org", CLICKHOUSE_URL: "u" }),
    { PORTAL_URL: "https://www.cbioportal.org" });
});

test("a secret-shaped name is refused, not sent", () => {
  for (const n of ["CLICKHOUSE_PASSWORD", "AUTH_SESSION_SECRET", "ANTHROPIC_API_KEY", "GH_TOKEN", "AWS_CREDENTIALS"])
    assert.throws(() => publicEnv({ PUBLIC_ENV: "EXAMPLES_URL," + n, [n]: "shh" }), /looks like a secret/);
  assert.throws(() => publicEnvNames("EXAMPLES_URL,not a name"), /not an environment variable name/);
});

test("EXAMPLES_URL is an http(s) URL without a trailing slash, or nothing", () => {
  assert.equal(parseExamplesUrl(undefined), null);
  assert.equal(parseExamplesUrl("  "), null);
  assert.equal(parseExamplesUrl("https://cbiolab.vercel.app/"), "https://cbiolab.vercel.app");
  assert.equal(parseExamplesUrl("https://example.org/lab-root/"), "https://example.org/lab-root");
  assert.throws(() => parseExamplesUrl("ftp://x"), /http\(s\)/);
  assert.throws(() => parseExamplesUrl("cbiolab"), /not a URL/);
});
