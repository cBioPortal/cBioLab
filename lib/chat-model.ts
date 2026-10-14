// The model behind the chat sidebar (/api/chat), chosen by the deployment's environment:
//
//   CHAT_PROVIDER=anthropic   ANTHROPIC_API_KEY
//   CHAT_PROVIDER=bedrock     AWS_REGION plus AWS credentials from the standard chain: the
//                             environment, ~/.aws/credentials (re-read on every request, so a
//                             credentials file a job refreshes is picked up without a restart), or
//                             the pod's web identity; or AWS_BEARER_TOKEN_BEDROCK
//   CHAT_MODEL                optional; defaults to Claude Opus 5.5 under the provider's own id
//   CHAT_EFFORT               optional; low | medium | high | xhigh | max (default medium)
//   CHAT_ON_DEPLOYMENT=1      lets a built deployment have chat (never one on Vercel)
//
// A development server (`next dev`) has chat when it names a provider. A built deployment has it
// only when it also sets CHAT_ON_DEPLOYMENT=1 and is not on Vercel, so no public URL spends the
// key; there it needs a signed-in user (signIn), and a deployment that signs nobody in has none.
// With no chat the route answers 404 and the sidebar stays hidden. Both providers speak the
// Anthropic Messages API, so one set of options serves both.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createBedrockAnthropic } from "@ai-sdk/amazon-bedrock/anthropic";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { LanguageModel } from "ai";

export type ChatProvider = "anthropic" | "bedrock";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

export interface ChatConfig {
  provider: ChatProvider; model: string; effort: Effort;
  /** a built deployment: each request needs a signed-in user */
  signIn: boolean;
}

const DEFAULT_MODEL: Record<ChatProvider, string> = {
  anthropic: "claude-opus-5-5",
  bedrock: "anthropic.claude-opus-5-5"
};

/** The configured chat model, or null when this deployment has none. Throws on a malformed setting. */
export function chatConfig(env: Record<string, string | undefined> = process.env): ChatConfig | null {
  const dev = env.NODE_ENV === "development";
  if (!dev && (env.CHAT_ON_DEPLOYMENT !== "1" || env.VERCEL)) return null;
  const p = (env.CHAT_PROVIDER || "").trim().toLowerCase();
  if (!p) return null;
  if (p !== "anthropic" && p !== "bedrock") throw new Error(`CHAT_PROVIDER must be "anthropic" or "bedrock", not "${p}"`);
  const effort = (env.CHAT_EFFORT || "medium").trim().toLowerCase() as Effort;
  if (!EFFORTS.includes(effort)) throw new Error(`CHAT_EFFORT must be one of ${EFFORTS.join(", ")}`);
  return { provider: p, model: (env.CHAT_MODEL || "").trim() || DEFAULT_MODEL[p], effort, signIn: !dev };
}

export function chatModel(c: ChatConfig): LanguageModel {
  if (c.provider === "anthropic") return createAnthropic()(c.model);
  // a fresh chain per call: the default one caches what it read, and a refreshed file would be missed
  const credentialProvider = () => defaultProvider({ ignoreCache: true })();
  return createBedrockAnthropic({ credentialProvider })(c.model);
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
