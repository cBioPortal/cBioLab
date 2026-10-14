// Which model the chat sidebar talks to (lib/chat-model.ts): none outside a dev server, none
// unless the deployment names a provider, each provider's own id for the default model, and a
// loud refusal of a setting it does not know rather than a silent fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatConfig, chatProviderOptions } from "../lib/chat-model.ts";

const DEV = { NODE_ENV: "development" };

test("a built deployment has no chat, whatever it sets", () => {
  for (const NODE_ENV of ["production", "test", undefined])
    assert.equal(chatConfig({ NODE_ENV, CHAT_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x" }), null);
});

test("no provider, no chat", () => {
  assert.equal(chatConfig(DEV), null);
  assert.equal(chatConfig({ ...DEV, CHAT_PROVIDER: "  " }), null);
});
test("each provider defaults to Opus 5.5 under its own id, at medium effort", () => {
  assert.deepEqual(chatConfig({ ...DEV, CHAT_PROVIDER: "anthropic" }), { provider: "anthropic", model: "claude-opus-5-5", effort: "medium" });
  assert.deepEqual(chatConfig({ ...DEV, CHAT_PROVIDER: "Bedrock" }), { provider: "bedrock", model: "anthropic.claude-opus-5-5", effort: "medium" });
});
test("CHAT_MODEL and CHAT_EFFORT override the defaults", () => {
  assert.deepEqual(chatConfig({ ...DEV, CHAT_PROVIDER: "bedrock", CHAT_MODEL: "us.anthropic.claude-sonnet-5-5", CHAT_EFFORT: "high" }),
    { provider: "bedrock", model: "us.anthropic.claude-sonnet-5-5", effort: "high" });
});
test("an unknown provider or effort is refused, not ignored", () => {
  assert.throws(() => chatConfig({ ...DEV, CHAT_PROVIDER: "openai" }), /CHAT_PROVIDER/);
  assert.throws(() => chatConfig({ ...DEV, CHAT_PROVIDER: "anthropic", CHAT_EFFORT: "extreme" }), /CHAT_EFFORT/);
});
test("thinking blocks survive a change of page; the refusal fallback is Anthropic's API only", () => {
  const a = chatProviderOptions({ provider: "anthropic", model: "claude-opus-5-5", effort: "medium" }).anthropic;
  const b = chatProviderOptions({ provider: "bedrock", model: "anthropic.claude-opus-5-5", effort: "medium" }).anthropic;
  for (const o of [a, b]) assert.deepEqual(o.thinking.blockBinding, { prefixMismatchBehavior: "drop_block" });
  assert.equal(a.fallbacks, "default");
  assert.equal("fallbacks" in b, false);
});
