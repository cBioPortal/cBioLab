// The model behind the chat sidebar (/api/chat), chosen by the deployment's environment:
//
//   CHAT_PROVIDER=anthropic   ANTHROPIC_API_KEY
//   CHAT_PROVIDER=bedrock     AWS_REGION plus AWS credentials (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
//                             [/AWS_SESSION_TOKEN], or AWS_BEARER_TOKEN_BEDROCK)
//   CHAT_MODEL                optional; defaults to Claude Opus 5.5 under the provider's own id
//   CHAT_EFFORT               optional; low | medium | high | xhigh | max (default medium)
//
// Chat runs only on a development server (`next dev`): a built deployment — Vercel production or
// preview, the Docker image — has none, whatever it sets, so no public URL spends the key. Without
// CHAT_PROVIDER a dev server has none either. With no chat the route answers 404 and the sidebar
// stays hidden. Both providers speak the Anthropic Messages API, so one set of options serves both.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createBedrockAnthropic } from "@ai-sdk/amazon-bedrock/anthropic";
import type { LanguageModel } from "ai";

export type ChatProvider = "anthropic" | "bedrock";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

export interface ChatConfig { provider: ChatProvider; model: string; effort: Effort }

const DEFAULT_MODEL: Record<ChatProvider, string> = {
  anthropic: "claude-opus-5-5",
  bedrock: "anthropic.claude-opus-5-5"
};

/** The configured chat model, or null when this deployment has none. Throws on a malformed setting. */
export function chatConfig(env: Record<string, string | undefined> = process.env): ChatConfig | null {
  if (env.NODE_ENV !== "development") return null;
  const p = (env.CHAT_PROVIDER || "").trim().toLowerCase();
  if (!p) return null;
  if (p !== "anthropic" && p !== "bedrock") throw new Error(`CHAT_PROVIDER must be "anthropic" or "bedrock", not "${p}"`);
  const effort = (env.CHAT_EFFORT || "medium").trim().toLowerCase() as Effort;
  if (!EFFORTS.includes(effort)) throw new Error(`CHAT_EFFORT must be one of ${EFFORTS.join(", ")}`);
  return { provider: p, model: (env.CHAT_MODEL || "").trim() || DEFAULT_MODEL[p], effort };
}

export function chatModel(c: ChatConfig): LanguageModel {
  return c.provider === "anthropic" ? createAnthropic()(c.model) : createBedrockAnthropic()(c.model);
}

/**
 * Request options for either provider. Thinking is summarized so the sidebar can show it. The
 * page's tool set changes when the assistant opens another page, which fails the API's check that
 * a thinking block's conversation is unchanged; `drop_block` drops those blocks instead of
 * refusing the turn. The server-side refusal fallback exists only on Anthropic's own API.
 */
export function chatProviderOptions(c: ChatConfig) {
  return {
    anthropic: {
      thinking: { type: "adaptive" as const, display: "summarized" as const, blockBinding: { prefixMismatchBehavior: "drop_block" as const } },
      effort: c.effort,
      ...(c.provider === "anthropic" ? { fallbacks: "default" as const } : {})
    }
  };
}
