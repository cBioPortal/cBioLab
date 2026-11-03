// Signing in to a connector (lib/chat-connector-oauth.ts): the standard MCP OAuth flow end to end
// against a stub authorization server run in the test — discovery, dynamic client registration, the
// authorization URL with its PKCE challenge, and the code traded for a token — and what the flow
// leaves on the server (nothing), in the cookie (no token) and on the callback page (the token only
// for this browser's storage, escaped).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  OAUTH_COOKIE, begin, clearedCookie, doneHtml, failedHtml, finish, flowCookie, originOf, readFlow, registrationFor, safeReturnTo
} from "../lib/chat-connector-oauth.ts";
import type { Connector } from "../lib/chat-connectors.ts";

let server: http.Server, base = "";
const log: { path: string; body?: string }[] = [];
/** a server like mcp.cbioportal.org: confidential clients only, and registration must ask for both grants */
const mode = { confidential: false };

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      log.push({ path: req.url || "", body });
      const json = (o: object, code = 200) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(o));
      if (req.url === "/.well-known/oauth-authorization-server") return json({
        issuer: base, authorization_endpoint: base + "/authorize", token_endpoint: base + "/token", registration_endpoint: base + "/register",
        response_types_supported: ["code"], code_challenge_methods_supported: ["S256"],
        grant_types_supported: mode.confidential ? ["authorization_code", "refresh_token"] : ["authorization_code"],
        token_endpoint_auth_methods_supported: mode.confidential ? ["client_secret_post"] : ["none"]
      });
      if (req.url === "/register") {
        const m = JSON.parse(body);
        if (mode.confidential && (m.grant_types?.join() !== "authorization_code,refresh_token" || m.token_endpoint_auth_method !== "client_secret_post"))
          return json({ error: "invalid_client_metadata", error_description: "grant_types must be authorization_code and refresh_token" }, 400);
        return json({ ...m, client_id: "client-1", ...(mode.confidential ? { client_secret: "CS-secret" } : {}) }, 201);
      }
      if (req.url === "/token") {
        const p = new URLSearchParams(body);
        if (p.get("code") !== "the-code" || !p.get("code_verifier")) return json({ error: "invalid_grant" }, 400);
        if (mode.confidential && p.get("client_secret") !== "CS-secret") return json({ error: "invalid_client" }, 401);
        return json({ access_token: "AT-secret", token_type: "Bearer", expires_in: 3600, refresh_token: "RT-secret" });
      }
      json({ error: "not found" }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(() => { server.closeAllConnections(); server.close(); });

const conn = (): Connector => ({ id: "cb", name: "CB", url: base + "/mcp", auth: "oauth", what: "w", sendsFreeText: false });

describe("the sign-in flow", () => {
  test("begin registers this app, and sends the reader to the server's page with state and a PKCE challenge", async () => {
    const { authUrl, flow } = await begin(conn(), "https://lab.example", "/portal/patient?study=s");
    const u = new URL(authUrl);
    assert.equal(u.origin + u.pathname, base + "/authorize");
    assert.equal(u.searchParams.get("client_id"), "client-1");
    assert.equal(u.searchParams.get("redirect_uri"), "https://lab.example/api/chat/connectors/oauth/callback");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(u.searchParams.get("code_challenge"));
    assert.equal(u.searchParams.get("state"), flow.state);
    assert.equal(flow.returnTo, "/portal/patient?study=s");
    assert.ok(flow.verifier && flow.client);
    const reg = JSON.parse(log.find((l) => l.path === "/register")!.body!);
    assert.equal(reg.token_endpoint_auth_method, "none", "a public client where the server allows one");
    assert.deepEqual(reg.redirect_uris, ["https://lab.example/api/chat/connectors/oauth/callback"]);
  });
  test("finish trades the code for a token, with the verifier; the refresh token is not kept", async () => {
    const { flow } = await begin(conn(), "https://lab.example", "/");
    const t = await finish(conn(), "https://lab.example", flow, "the-code");
    assert.equal(t.token, "AT-secret");
    assert.ok(t.expiresAt! > Date.now() + 3_000_000 && t.expiresAt! < Date.now() + 3_700_000);
    assert.ok(!JSON.stringify(t).includes("RT-secret"));
  });
  test("a server that takes only confidential clients and both grants is registered as such, and the secret is used to trade the code", async () => {
    mode.confidential = true;
    try {
      const { authUrl, flow } = await begin(conn(), "https://lab.example", "/");
      assert.ok(authUrl.includes("client_id=client-1"));
      assert.equal(flow.client && "client_secret" in flow.client ? flow.client.client_secret : null, "CS-secret");
      const t = await finish(conn(), "https://lab.example", flow, "the-code");
      assert.equal(t.token, "AT-secret");
      assert.ok(!JSON.stringify(t).includes("CS-secret"), "the secret does not go to the browser");
    } finally { mode.confidential = false; }
  });
  test("what to register is read from what the server advertises", () => {
    assert.deepEqual(registrationFor(undefined), { grants: ["authorization_code"], method: "none" });
    assert.deepEqual(registrationFor({ grant_types_supported: ["authorization_code", "refresh_token", "x"], token_endpoint_auth_methods_supported: ["client_secret_post"] }), { grants: ["authorization_code", "refresh_token"], method: "client_secret_post" });
    assert.equal(registrationFor({ token_endpoint_auth_methods_supported: ["client_secret_basic"] }).method, "client_secret_basic");
    assert.equal(registrationFor({ token_endpoint_auth_methods_supported: ["client_secret_post", "none"] }).method, "none", "a public client where the server allows one");
  });
  test("a wrong code gives no token, and says so", async () => {
    const { flow } = await begin(conn(), "https://lab.example", "/");
    await assert.rejects(finish(conn(), "https://lab.example", flow, "other"), /invalid_grant|grant/i);
  });
  test("the origin is the browser's, behind a proxy too", () => {
    assert.equal(originOf(new Request("http://internal:3000/x")), "http://internal:3000");
    assert.equal(originOf(new Request("http://internal:3000/x", { headers: { "x-forwarded-host": "lab.example", "x-forwarded-proto": "https, http" } })), "https://lab.example");
  });
});

describe("what the flow leaves behind", () => {
  test("the cookie holds the flow (no token), is httpOnly and short-lived, and reads back", async () => {
    const { flow } = await begin(conn(), "https://lab.example", "/a");
    const c = flowCookie(flow, true);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Max-Age=600/);
    assert.match(c, /Secure/);
    assert.ok(!flowCookie(flow, false).includes("Secure"));
    assert.deepEqual(readFlow(c.split(";")[0] + "; other=1"), flow);
    assert.match(clearedCookie(false), /Max-Age=0/);
  });
  test("a missing, damaged or odd cookie is no flow", () => {
    assert.equal(readFlow(null), null);
    assert.equal(readFlow("a=b"), null);
    assert.equal(readFlow(OAUTH_COOKIE + "=%%%"), null);
    assert.equal(readFlow(OAUTH_COOKIE + "=" + Buffer.from('{"id":1}').toString("base64url")), null);
  });
  test("a return address is a path on this site, never another", () => {
    assert.equal(safeReturnTo("/portal/patient?a=1"), "/portal/patient?a=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "", null, undefined, "/a\r\nSet-Cookie: x=1"])
      assert.equal(safeReturnTo(bad), "/", String(bad));
    assert.equal(readFlow(OAUTH_COOKIE + "=" + Buffer.from(JSON.stringify({ id: "a", state: "s", returnTo: "//evil.example" })).toString("base64url"))!.returnTo, "/");
  });
});

describe("the callback page", () => {
  test("writes the token to this browser's connector state and returns to the page", () => {
    const h = doneHtml({ id: "cb", name: "CB" }, { token: "AT-secret", expiresAt: 5 }, "/portal/patient");
    assert.match(h, /var k="cohortlab\.chat\.connectors"/);
    assert.match(h, /localStorage\.setItem\(k,/);
    assert.match(h, /s\.tokens\["cb"\]=\{"token":"AT-secret","expiresAt":5\}/);
    assert.match(h, /location\.replace\("\/portal\/patient"\)/);
  });
  test("a value cannot end the script early or send the reader elsewhere", () => {
    const h = doneHtml({ id: "cb", name: "<b>CB</b>" }, { token: "</script><script>alert(1)</script>" }, "//evil.example");
    assert.ok(!h.includes("</script><script>alert"));
    assert.match(h, /location\.replace\("\/"\)/);
    assert.ok(!h.includes("<b>CB</b>"));
    assert.ok(!failedHtml("<img src=x onerror=alert(1)>", "/").includes("<img"));
  });
  test("a failed sign-in goes back with its reason as a note, and no token", () => {
    const h = failedHtml("The sign-in was not completed: access_denied", "/lab");
    assert.match(h, /sessionStorage\.setItem\("cohortlab\.chat\.connectors\.note"/);
    assert.match(h, /location\.replace\("\/lab"\)/);
    assert.ok(!h.includes("tokens"));
  });
});
