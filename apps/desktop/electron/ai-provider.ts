import type { DeskStore } from "../../../packages/domain/store";
import {
  aiProviderMode,
  aiProviderStatus,
  type AIProviderMode,
  type AIProviderStatus,
} from "../../../packages/intelligence/ai-provider";
import {
  askAcademicInference,
  type AskInferenceOptions,
  type InferenceProviderResult,
} from "../../../packages/intelligence/inference-provider";
import {
  askLens,
  LENS_MODEL,
  type AskLensOptions,
  type LensInput,
  type LensResponse,
} from "../../../packages/intelligence/lens-provider";
import { activityInstruction } from "../../../packages/study/activities";
import { teachingInstructions, tutoringMode, type TutoringMode } from "../../../packages/intelligence/tutoring";
import { CodexAppServer, type CodexStatus } from "./codex-provider";
import { ProviderCredentials } from "./credentials";

export type AIProviderErrorCode =
  | "unavailable"
  | "limited"
  | "capability"
  | "background-disabled";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  constructor(code: AIProviderErrorCode, message: string) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
  }
}

type ProviderRouterOptions = {
  store: DeskStore;
  credentials: ProviderCredentials;
  codex: CodexAppServer;
  userDataPath: string;
  managedEndpoint?: string;
};

type LensOptions = Pick<AskLensOptions, "tutoringMode" | "tier" | "signal" | "onTelemetry">;
type InferenceOptions = Pick<AskInferenceOptions, "signal" | "tier">;

/**
 * The one trusted provider boundary for interactive and provider-backed Desk
 * intelligence. Renderer features never select a route themselves.
 */
export class AIProviderRouter {
  private readonly store: DeskStore;
  private readonly credentials: ProviderCredentials;
  private readonly codex: CodexAppServer;
  private readonly userDataPath: string;
  private readonly managedEndpoint?: string;

  constructor(options: ProviderRouterOptions) {
    this.store = options.store;
    this.credentials = options.credentials;
    this.codex = options.codex;
    this.userDataPath = options.userDataPath;
    this.managedEndpoint = safeEndpoint(options.managedEndpoint) ?? options.credentials.developmentManagedEndpoint();
  }

  async status(): Promise<AIProviderStatus> {
    const selectedProvider = this.store.aiProviderMode();
    const credentials = this.credentials.status();
    if (selectedProvider === "desk-managed") {
      if (this.managedEndpoint)
        return status({
          selectedProvider,
          availableProviders: availableProviders({ managed: true, byok: credentials.configured }),
          availability: "ready",
          providerLabel: "Desk Managed",
          configured: true,
          secureStorage: true,
          source: "managed-gateway",
          capabilities: { text: true, image: true, structuredOutput: true },
          message: "Built in. No setup required.",
        });
      if (this.credentials.developmentKeyValue())
        return status({
          selectedProvider,
          availableProviders: availableProviders({ managed: true, byok: credentials.configured }),
          availability: "ready",
          providerLabel: "Desk Managed",
          configured: true,
          secureStorage: true,
          source: "development-env",
          capabilities: { text: true, image: true, structuredOutput: true },
          message: "Built in. No setup required.",
        });
      return status({
        selectedProvider,
        availableProviders: availableProviders({ byok: credentials.configured }),
        availability: "offline",
        providerLabel: "Desk Managed",
        configured: false,
        secureStorage: true,
        source: null,
        capabilities: { text: false, image: false, structuredOutput: false },
        message: "Desk AI is unavailable right now. Your local workspace still works.",
      });
    }
    if (selectedProvider === "byok") {
      return status({
        selectedProvider,
        availableProviders: availableProviders({
          managed: Boolean(this.managedEndpoint || this.credentials.developmentKeyValue()),
          byok: credentials.configured,
        }),
        availability: credentials.configured ? "ready" : "error",
        providerLabel: "Bring Your Own Key",
        configured: credentials.configured,
        secureStorage: credentials.secureStorage,
        source: credentials.source === "saved-user-key" || credentials.source === "development-env" ? credentials.source : null,
        capabilities: { text: true, image: true, structuredOutput: true },
        message: credentials.configured
          ? "Uses your configured provider account."
          : "Configure a supported provider key in Settings.",
      });
    }
    const codex = await this.codex.status();
    return status({
      selectedProvider,
      availableProviders: availableProviders({
        managed: Boolean(this.managedEndpoint || this.credentials.developmentKeyValue()),
        byok: credentials.configured,
        chatgpt: codex.connected,
      }),
      availability: codex.connected ? "ready" : codex.available ? "error" : "offline",
      providerLabel: "ChatGPT / Codex",
      configured: codex.connected,
      secureStorage: true,
      source: codex.connected ? "codex-app-server" : null,
      ...(codex.account ? { account: codex.account } : {}),
      ...(codex.limits?.length ? { limits: codex.limits } : {}),
      ...(codex.model ? { model: codex.model } : {}),
      capabilities: { text: codex.connected, image: false, structuredOutput: false },
      message: codex.message ?? (codex.connected ? "Uses your ChatGPT/Codex allowance." : "Connect ChatGPT to use this provider."),
    });
  }

  async select(mode: AIProviderMode): Promise<AIProviderStatus> {
    this.store.execute({ type: "ai.provider.select", mode: aiProviderMode.parse(mode) });
    return this.status();
  }

  async connectChatGPT(openExternal: (url: string) => Promise<void>) {
    const connected = await this.codex.connect(openExternal);
    // Connecting is itself an explicit provider choice. Persist the choice
    // only after the official runtime confirms it, so a canceled login leaves
    // the prior provider untouched.
    this.store.execute({ type: "ai.provider.select", mode: "chatgpt-codex" });
    return this.statusFromCodex(connected);
  }

  async disconnectChatGPT() {
    await this.codex.disconnect();
    return this.status();
  }

  async askLens(input: LensInput, options: LensOptions = {}): Promise<LensResponse> {
    const selected = this.store.aiProviderMode();
    if (selected === "chatgpt-codex") {
      if (input.imageDataUrl)
        throw new AIProviderError("capability", "ChatGPT/Codex text mode cannot analyze a Lens image yet. Switch to Desk Managed or BYOK for visual Lens help.");
      const current = await this.codex.status();
      if (!current.connected)
        throw new AIProviderError("unavailable", "Connect ChatGPT in Settings before using this provider.");
      const response = await this.codex.ask({
        cwd: this.userDataPath,
        prompt: codexPrompt(input, options.tutoringMode),
      });
      return {
        explanation: response.text,
        overlays: [],
        model: LENS_MODEL,
        resolvedModel: response.model,
        usage: null,
        cost: null,
      };
    }
    const transport = this.transport(selected);
    return askLens(input, transport.key, {
      ...options,
      ...(transport.endpoint ? { endpoint: transport.endpoint } : {}),
    });
  }

  async askInference(
    input: Parameters<typeof askAcademicInference>[0],
    classes: readonly string[],
    options: InferenceOptions = {},
  ): Promise<InferenceProviderResult> {
    const selected = this.store.aiProviderMode();
    if (selected === "chatgpt-codex")
      throw new AIProviderError(
        "background-disabled",
        "Background academic inference stays local while ChatGPT/Codex is selected. Switch to Desk Managed or BYOK to run provider-backed classification.",
      );
    const transport = this.transport(selected);
    return askAcademicInference(input, classes, transport.key, {
      ...options,
      ...(transport.endpoint ? { endpoint: transport.endpoint } : {}),
    });
  }

  dispose() {
    this.codex.dispose();
  }

  private transport(selected: AIProviderMode) {
    if (selected === "desk-managed") {
      const key = this.credentials.developmentKeyValue();
      if (!this.managedEndpoint && !key)
        throw new AIProviderError("unavailable", "Desk AI is unavailable right now. Your local workspace still works.");
      return { key: key ?? "", ...(this.managedEndpoint ? { endpoint: this.managedEndpoint } : {}) };
    }
    try {
      return { key: this.credentials.read() };
    } catch {
      throw new AIProviderError("unavailable", "Configure a supported provider key in Settings before using BYOK.");
    }
  }

  private statusFromCodex(codex: CodexStatus) {
    return status({
      selectedProvider: "chatgpt-codex",
      availableProviders: availableProviders({
        managed: Boolean(this.managedEndpoint || this.credentials.developmentKeyValue()),
        byok: this.credentials.status().configured,
        chatgpt: codex.connected,
      }),
      availability: codex.connected ? "ready" : "error",
      providerLabel: "ChatGPT / Codex",
      configured: codex.connected,
      secureStorage: true,
      source: codex.connected ? "codex-app-server" : null,
      ...(codex.account ? { account: codex.account } : {}),
      ...(codex.limits?.length ? { limits: codex.limits } : {}),
      ...(codex.model ? { model: codex.model } : {}),
      capabilities: { text: codex.connected, image: false, structuredOutput: false },
      message: codex.connected ? "Uses your ChatGPT/Codex allowance." : "Connect ChatGPT to use this provider.",
    });
  }
}

function status(value: AIProviderStatus): AIProviderStatus {
  return aiProviderStatus.parse(value);
}

function availableProviders(value: {
  managed?: boolean;
  byok?: boolean;
  chatgpt?: boolean;
}): AIProviderMode[] {
  return [
    value.managed ? "desk-managed" : null,
    value.chatgpt ? "chatgpt-codex" : null,
    value.byok ? "byok" : null,
  ].filter((mode): mode is AIProviderMode => mode !== null);
}

function safeEndpoint(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return undefined;
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function codexPrompt(input: LensInput, mode: string | undefined) {
  const teachingMode: TutoringMode = tutoringMode.parse(mode ?? "balanced");
  return [
    "The student is using Lens inside The Desk. Answer the question using only the supplied evidence. Do not claim to see an image when none is provided. Do not take actions or suggest tools.",
    teachingInstructions(teachingMode),
    input.activity ? activityInstruction(input.activity.kind, teachingMode) : "",
    `Question:\n${input.question}`,
    input.context ? `Desk evidence (read-only):\n${input.context}` : "",
    input.sourceIds?.length ? `Source scope: ${input.sourceIds.join(", ")}` : "",
    input.history?.length ? `Conversation:\n${input.history.map((turn) => `${turn.role}: ${turn.content}`).join("\n")}` : "",
    "Return a clear educational answer. Preserve uncertainty and distinguish evidence from explanation.",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 28_000);
}
