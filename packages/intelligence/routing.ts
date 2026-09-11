import { z } from "zod";

// Exact model IDs verified against OpenRouter's public catalog, 2026-09-06.
export const APPROVED_MODELS = [
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-sol",
  "google/gemini-3.8-flash",
  "anthropic/claude-sonnet-5",
] as const;
export const routingTier = z.enum([
  "FAST",
  "STANDARD",
  "DEEP",
  "MULTIMODAL",
  "VERIFY",
]);
export type RoutingTier = z.infer<typeof routingTier>;
const routes = {
  // OpenAI's current endpoints honor the no-collection policy but do not
  // advertise Zero Data Retention for these models. Keep the provider
  // explicit and opt into ZDR only on routes where OpenRouter supports it.
  FAST: { model: APPROVED_MODELS[0], provider: "openai", zdr: false },
  STANDARD: { model: APPROVED_MODELS[1], provider: "openai", zdr: false },
  DEEP: { model: APPROVED_MODELS[2], provider: "openai", zdr: false },
  MULTIMODAL: {
    model: APPROVED_MODELS[3],
    provider: "google-vertex/global",
    zdr: true,
  },
  VERIFY: {
    model: APPROVED_MODELS[4],
    provider: "amazon-bedrock/global",
    zdr: false,
  },
} as const;
export function inferenceRoute(tier: RoutingTier) {
  const route = routes[routingTier.parse(tier)];
  return {
    model: route.model,
    provider: {
      only: [route.provider],
      order: [route.provider],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: "deny" as const,
      zdr: route.zdr,
    },
  };
}

export const CANONICAL_MODELS = {
  "openai/gpt-5.6-luna": "openai/gpt-5.6-luna-20260709",
  "openai/gpt-5.6-terra": "openai/gpt-5.6-terra-20260709",
  "openai/gpt-5.6-sol": "openai/gpt-5.6-sol-20260709",
  "google/gemini-3.8-flash": "google/gemini-3.8-flash-20260902",
  "anthropic/claude-sonnet-5": "anthropic/claude-sonnet-5-20260630",
} as const;
