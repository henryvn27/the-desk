import { z } from "zod";

/** The only provider choices the Desk product exposes. */
export const aiProviderMode = z.enum([
  "desk-managed",
  "chatgpt-codex",
  "byok",
]);
export type AIProviderMode = z.infer<typeof aiProviderMode>;

export const aiProviderAvailability = z.enum([
  "ready",
  "connecting",
  "offline",
  "limited",
  "error",
]);
export type AIProviderAvailability = z.infer<typeof aiProviderAvailability>;

export const aiProviderSource = z.enum([
  "development-env",
  "managed-gateway",
  "saved-user-key",
  "codex-app-server",
]);
export type AIProviderSource = z.infer<typeof aiProviderSource>;

export const aiProviderLimit = z.object({
  id: z.string().trim().min(1).max(160),
  label: z.string().trim().min(1).max(240),
  usedPercent: z.number().finite().min(0).max(100).nullable(),
  resetsAt: z.string().datetime().nullable(),
});
export type AIProviderLimit = z.infer<typeof aiProviderLimit>;

export const aiProviderStatus = z.object({
  selectedProvider: aiProviderMode,
  /** Providers that can be selected without another setup step. */
  availableProviders: z.array(aiProviderMode).max(3),
  availability: aiProviderAvailability,
  providerLabel: z.string().trim().min(1).max(120),
  configured: z.boolean(),
  secureStorage: z.boolean(),
  source: aiProviderSource.nullable(),
  account: z
    .object({
      plan: z.string().trim().min(1).max(80).optional(),
      label: z.string().trim().min(1).max(320).optional(),
    })
    .optional(),
  limits: z.array(aiProviderLimit).max(20).optional(),
  capabilities: z.object({
    text: z.boolean(),
    image: z.boolean(),
    structuredOutput: z.boolean(),
  }),
  model: z.string().trim().min(1).max(160).optional(),
  message: z.string().trim().min(1).max(500).optional(),
});
export type AIProviderStatus = z.infer<typeof aiProviderStatus>;

export const DEFAULT_AI_PROVIDER: AIProviderMode = "desk-managed";
