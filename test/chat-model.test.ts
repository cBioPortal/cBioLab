// Which model the chat sidebar talks to (lib/chat-model.ts): on a built deployment only when it
// opts in and is not on Vercel, and then behind a sign-in; none unless the deployment names a
// provider; each provider's own id for the default model; and a loud refusal of a setting it does
// not know rather than a silent fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText } from "ai";
import { chatConfig, chatModel, chatProviderOptions } from "../lib/chat-model.ts";

const DEV = { NODE_ENV: "development" };

test("a built deployment has no chat unless it opts in", () => {
  for (const NODE_ENV of ["production", "test", undefined])
    assert.equal(chatConfig({ NODE_ENV, CHAT_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x" }), null);
});
test("a deployment that opts in has chat behind a sign-in, except on Vercel", () => {
  const env = { NODE_ENV: "production", CHAT_PROVIDER: "bedrock", CHAT_ON_DEPLOYMENT: "1" };
  assert.deepEqual(chatConfig(env), { provider: "bedrock", model: "anthropic.claude-sonnet-5-5", effort: "medium", signIn: true });
  assert.equal(chatConfig({ ...env, CHAT_ON_DEPLOYMENT: "true" }), null);
  for (const VERCEL of ["1", "true"]) assert.equal(chatConfig({ ...env, VERCEL }), null);
});

test("no provider, no chat", () => {
  assert.equal(chatConfig(DEV), null);
  assert.equal(chatConfig({ ...DEV, CHAT_PROVIDER: "  " }), null);
});
test("each provider defaults to Sonnet 5.5 under its own id, at medium effort", () => {
  assert.deepEqual(chatConfig({ ...DEV, CHAT_PROVIDER: "anthropic" }), { provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium", signIn: false });
  assert.deepEqual(chatConfig({ ...DEV, CHAT_PROVIDER: "Bedrock" }), { provider: "bedrock", model: "anthropic.claude-sonnet-5-5", effort: "medium", signIn: false });
});
test("CHAT_MODEL and CHAT_EFFORT override the defaults", () => {
  assert.deepEqual(chatConfig({ ...DEV, CHAT_PROVIDER: "bedrock", CHAT_MODEL: "us.anthropic.claude-sonnet-5-5", CHAT_EFFORT: "high" }),
    { provider: "bedrock", model: "us.anthropic.claude-sonnet-5-5", effort: "high", signIn: false });
});
test("an unknown provider or effort is refused, not ignored", () => {
  assert.throws(() => chatConfig({ ...DEV, CHAT_PROVIDER: "openai" }), /CHAT_PROVIDER/);
  assert.throws(() => chatConfig({ ...DEV, CHAT_PROVIDER: "anthropic", CHAT_EFFORT: "extreme" }), /CHAT_EFFORT/);
});
test("thinking blocks survive a change of page; the refusal fallback is Anthropic's API only", () => {
  const a = chatProviderOptions({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium", signIn: false }).anthropic;
  const b = chatProviderOptions({ provider: "bedrock", model: "anthropic.claude-sonnet-5-5", effort: "medium", signIn: false }).anthropic;
  for (const o of [a, b]) assert.deepEqual(o.thinking.blockBinding, { prefixMismatchBehavior: "drop_block" });
  assert.equal(a.fallbacks, "default");
  assert.equal("fallbacks" in b, false);
});

test("Bedrock signs each request with the credentials file as it is then, so a refresh needs no restart", async () => {
  const home = mkdtempSync(join(tmpdir(), "chat-aws-"));
  mkdirSync(join(home, ".aws"));
  const write = (key: string) => writeFileSync(join(home, ".aws", "credentials"),
    `[default]\naws_access_key_id = ${key}\naws_secret_access_key = secret-${key}\naws_session_token = token\n`);
  const saved = { HOME: process.env.HOME, AWS_REGION: process.env.AWS_REGION, fetch: globalThis.fetch };
  const signedWith: string[] = [];
  process.env.HOME = home;
  process.env.AWS_REGION = "us-east-1";
  for (const k of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_BEARER_TOKEN_BEDROCK", "AWS_SHARED_CREDENTIALS_FILE"]) delete process.env[k];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    signedWith.push(new Headers(init?.headers).get("authorization")?.match(/Credential=([^/]+)/)?.[1] ?? "unsigned");
    return new Response(JSON.stringify({ message: "stub" }), { status: 403 });
  }) as typeof fetch;
  try {
    const model = chatModel({ provider: "bedrock", model: "anthropic.claude-sonnet-5-5", effort: "medium", signIn: true });
    const call = () => generateText({ model, prompt: "hi", maxRetries: 0 }).catch(() => undefined);
    write("AKIAFIRST");
    await call();
    write("AKIASECOND");
    await call();
    assert.deepEqual(signedWith, ["AKIAFIRST", "AKIASECOND"]);
  } finally {
    globalThis.fetch = saved.fetch;
    process.env.HOME = saved.HOME;
    if (saved.AWS_REGION === undefined) delete process.env.AWS_REGION; else process.env.AWS_REGION = saved.AWS_REGION;
  }
});
