import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type NotificationListener = (message: JsonRpcMessage) => void;

export type CodexAccount = {
  plan?: string;
  label?: string;
};

export type CodexLimit = {
  id: string;
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
};

export type CodexStatus = {
  available: boolean;
  connected: boolean;
  account?: CodexAccount;
  limits?: CodexLimit[];
  model?: string;
  message?: string;
};

export type CodexTextRequest = {
  prompt: string;
  cwd: string;
};

export type CodexTextResponse = {
  text: string;
  model: string;
};

const RPC_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 90_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

/**
 * Small, capability-limited client for the official Codex app-server protocol.
 * It never reads or stores Codex credentials. The Codex runtime owns auth.
 */
export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private nextId = 1;
  private initialized = false;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<NotificationListener>();
  private selectedModel: string | undefined;

  async status(): Promise<CodexStatus> {
    try {
      await this.ensureInitialized();
      let accountValue: unknown;
      try {
        const account = await this.request("account/read", { refreshToken: false });
        accountValue = record(account)?.account;
      } catch {
        // The official runtime is still usable when no ChatGPT account is
        // connected; account/read can legitimately reject in that state.
        accountValue = undefined;
      }
      let limits: unknown = null;
      try {
        limits = await this.request("account/rateLimits/read", null);
      } catch {
        // Limits are optional status information, never a reason to hide the
        // official runtime or prevent an explicit login attempt.
      }
      const selected = (await this.model()).selected;
      const result: CodexStatus = {
        available: true,
        connected: Boolean(accountValue && record(accountValue)?.type === "chatgpt"),
        ...(accountValue ? { account: accountSummary(accountValue) } : {}),
        limits: parseLimits(limits),
        ...(selected ? { model: selected } : {}),
      };
      return result;
    } catch {
      const result: CodexStatus = {
        available: false,
        connected: false,
        message: "The official Codex runtime is unavailable on this Mac.",
      };
      return result;
    }
  }

  async connect(openExternal: (url: string) => Promise<void>): Promise<CodexStatus> {
    await this.ensureInitialized();
    const response = record(
      await this.request("account/login/start", { type: "chatgpt" }, LOGIN_TIMEOUT_MS),
    );
    const authUrl = stringValue(response?.authUrl);
    const loginId = stringValue(response?.loginId);
    if (!authUrl || !loginId)
      throw Error("The official ChatGPT login did not return an authorization link.");
    const completed = await this.waitForNotification(
      (message) =>
        message.method === "account/login/completed" &&
        (stringValue(record(message.params)?.loginId) ?? loginId) === loginId,
      LOGIN_TIMEOUT_MS,
    );
    await openExternal(authUrl);
    const params = record(completed.params);
    if (params?.success !== true)
      throw Error("ChatGPT login was canceled or could not be completed.");
    return this.status();
  }

  async disconnect(): Promise<CodexStatus> {
    await this.ensureInitialized();
    await this.request("account/logout", null);
    return this.status();
  }

  async ask(request: CodexTextRequest): Promise<CodexTextResponse> {
    await this.ensureInitialized();
    const model = (await this.model()).selected;
    const thread = record(
      await this.request("thread/start", {
        approvalPolicy: "never",
        cwd: request.cwd,
        developerInstructions:
          "You are The Desk's academic assistant. Answer only the supplied student question and evidence. Do not use tools, inspect files, change files, or take actions. Be concise, honest about uncertainty, and preserve the student's agency.",
        ephemeral: true,
        environments: [],
        model: model ?? null,
        runtimeWorkspaceRoots: [],
        sandbox: "read-only",
      }),
    );
    const threadId = stringValue(record(thread?.thread)?.id);
    if (!threadId) throw Error("The Codex runtime did not create a private thread.");

    const completed = this.waitForNotification(
      (message) => {
        if (message.method !== "turn/completed") return false;
        const params = record(message.params);
        const turn = record(params?.turn);
        return params?.threadId === threadId && typeof turn?.id === "string";
      },
      TURN_TIMEOUT_MS,
    );
    const started = record(
      await this.request("turn/start", {
        environments: [],
        effort: "max",
        input: [{ type: "text", text: request.prompt }],
        model: model ?? null,
        threadId,
      }),
    );
    const startedTurnId = stringValue(record(started?.turn)?.id);
    const completedMessage = record((await completed).params);
    const completedTurn = record(completedMessage?.turn);
    if (startedTurnId && stringValue(completedTurn?.id) !== startedTurnId)
      throw Error("The Codex runtime completed an unexpected turn.");
    if (completedTurn?.status !== "completed")
      throw Error("The Codex runtime could not complete this request.");
    const items = Array.isArray(completedTurn.items) ? completedTurn.items : [];
    const messages = items
      .filter((item): item is Record<string, unknown> => record(item)?.type === "agentMessage")
      .map((item) => stringValue(item.text))
      .filter((item): item is string => Boolean(item?.trim()));
    const text = messages.at(-1)?.trim();
    if (!text) throw Error("The Codex runtime returned no answer.");
    const resolvedModel = stringValue(record(thread)?.model) ?? model ?? "gpt-5.6-luna";
    this.selectedModel = resolvedModel;
    return { text, model: resolvedModel };
  }

  dispose() {
    this.lines?.close();
    this.lines = null;
    this.child?.kill();
    this.child = null;
    this.initialized = false;
    const error = Error("The Codex runtime stopped.");
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async model(): Promise<{ selected?: string }> {
    if (this.selectedModel) return { selected: this.selectedModel };
    try {
      const result = record(await this.request("model/list", { includeHidden: false, limit: 100 }));
      const models = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result?.models)
          ? result.models
          : [];
      const names = models
        .map((item) => stringValue(record(item)?.model) ?? stringValue(record(item)?.id))
        .filter((item): item is string => Boolean(item));
      this.selectedModel =
        names.find((name) => /gpt[-.]?5\.6[-.]?luna/i.test(name)) ??
        names.find((name) => /gpt[-.]?5/i.test(name));
      return { ...(this.selectedModel ? { selected: this.selectedModel } : {}) };
    } catch {
      return {};
    }
  }

  private async ensureInitialized() {
    if (!this.child || this.child.killed) await this.start();
    if (this.initialized) return;
    await this.request("initialize", {
      capabilities: null,
      clientInfo: {
        name: "the-desk",
        title: "The Desk",
        version: "1.0.0-alpha",
      },
    });
    this.send({ method: "initialized", params: {} });
    this.initialized = true;
  }

  private async start() {
    const executable = findCodexExecutable();
    const env = { ...process.env };
    for (const key of [
      "OPENROUTER_API_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ANON_KEY",
      "DESK_MANAGED_AI_KEY",
    ]) delete env[key];
    const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    child.stderr.on("data", () => undefined);
    child.on("error", () => this.dispose());
    child.on("exit", () => {
      if (this.child === child) this.dispose();
    });
  }

  private send(message: Record<string, unknown>) {
    if (!this.child || !this.child.stdin.writable)
      throw Error("The Codex runtime is not available.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("The Codex runtime timed out."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : Error("The Codex runtime is unavailable."));
      }
    });
  }

  private receive(line: string) {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error)
        pending.reject(Error("The Codex runtime rejected the request."));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  private waitForNotification(
    predicate: (message: JsonRpcMessage) => boolean,
    timeoutMs: number,
  ): Promise<JsonRpcMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(Error("The Codex runtime timed out."));
      }, timeoutMs);
      const listener = (message: JsonRpcMessage) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message);
      };
      this.listeners.add(listener);
    });
  }
}

function findCodexExecutable() {
  const requested = process.env.DESK_CODEX_PATH?.trim();
  if (requested) return requested;
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const found = execFileSync(command, ["codex"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (found) return found;
  } catch {
    // The packaged app may not inherit the user's shell PATH.
  }
  return process.platform === "win32" ? "codex.exe" : "codex";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function accountSummary(value: unknown): CodexAccount | undefined {
  const account = record(value);
  if (!account) return undefined;
  const plan = stringValue(account.planType);
  const label = stringValue(account.email);
  return plan || label ? { ...(plan ? { plan } : {}), ...(label ? { label } : {}) } : undefined;
}

function parseLimits(value: unknown): CodexLimit[] {
  const result = record(value);
  const byId = record(result?.rateLimitsByLimitId);
  if (!byId) return [];
  return Object.entries(byId).flatMap(([id, raw]) => {
    const bucket = record(raw);
    if (!bucket) return [];
    const primary = record(bucket.primary);
    const used = typeof primary?.usedPercent === "number" && Number.isFinite(primary.usedPercent)
      ? Math.max(0, Math.min(100, primary.usedPercent))
      : null;
    const resets = typeof primary?.resetsAt === "number" && Number.isFinite(primary.resetsAt)
      ? new Date(primary.resetsAt * 1000).toISOString()
      : null;
    const label = stringValue(bucket.limitName) ?? id;
    return [{ id, label, usedPercent: used, resetsAt: resets }];
  });
}
