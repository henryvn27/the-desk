import { safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import {
  sessionFromAuthResponse,
  sessionFromRefreshResponse,
  supabaseAuthError,
  supabaseAuthResponse,
  supabaseAuthUrl,
  supabaseEmail,
  supabasePassword,
  supabaseSignupResponse,
  type SupabaseAccountResult,
  type SupabaseAccountStatus,
  type SupabaseSession,
} from "../../../packages/integrations/supabase-auth";

const storedSession = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  userId: z.string().uuid(),
  email: z.string().email().nullable(),
  expiresAt: z.number().int().nullable(),
});

type SupabaseConfig = {
  url: string;
  publishableKey: string;
  source: "development-env" | "process-env";
};

export type SupabaseSyncContext = {
  url: string;
  publishableKey: string;
  accessToken: string;
  userId: string;
};

export type SupabaseSessionStore = {
  available(): boolean;
  read(): SupabaseSession | null;
  write(session: SupabaseSession): void;
  remove(): void;
};

export type SupabaseAccountOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  refreshSkewMs?: number;
  sessionStore?: SupabaseSessionStore;
};

export class SupabaseSessionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly reauthRequired: boolean,
  ) {
    super(message);
    this.name = "SupabaseSessionError";
  }
}

class SupabaseAuthRequestError extends Error {
  constructor(readonly status: number) {
    super(supabaseAuthError({}, status));
    this.name = "SupabaseAuthRequestError";
  }
}

export class SupabaseAccount {
  private readonly sessionPath: string;
  private readonly config: SupabaseConfig | null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private readonly sessionStore: SupabaseSessionStore;
  private refreshPromise: Promise<SupabaseSession> | undefined;

  constructor(
    directory: string,
    developmentPath?: string,
    options: SupabaseAccountOptions = {},
  ) {
    this.sessionPath = join(directory, "supabase-session.enc");
    this.config = readConfig(developmentPath);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = Math.max(0, Math.trunc(options.refreshSkewMs ?? 30_000));
    this.sessionStore = options.sessionStore ?? createEncryptedSessionStore(this.sessionPath);
  }

  /**
   * The sync status poll runs during every local-first launch. Do not touch
   * macOS Keychain merely to report that no account session exists; probing
   * safeStorage can open an OS authority prompt before the student asks to
   * connect an account. Settings and auth operations pass true when they need
   * an authoritative secure-storage capability check. A stored session remains
   * authenticated while an access token is expired because the trusted sync
   * path can refresh it without asking the student to sign in again.
   */
  status(probeSecureStorage = false): SupabaseAccountStatus {
    const session = this.readSession();
    return {
      configured: this.config !== null,
      authenticated: session !== null,
      email: session?.email ?? null,
      userId: session?.userId ?? null,
      secureStorage:
        probeSecureStorage || session !== null
          ? this.sessionStore.available()
          : false,
      source: this.config?.source ?? null,
    };
  }

  syncContext(): SupabaseSyncContext | null {
    const session = this.activeSession();
    if (!session || !this.config) return null;
    return this.contextFor(session);
  }

  /**
   * Return a usable sync context, refreshing the persisted session when the
   * access token is expired or close to expiry. This is intentionally separate
   * from status(): status is a side-effect-free UI poll, while this method is
   * called only from the trusted sync path.
   */
  async syncContextAsync(): Promise<SupabaseSyncContext | null> {
    if (!this.config) return null;
    const session = this.readSession();
    if (!session) return null;
    if (
      session.expiresAt === null ||
      session.expiresAt > this.now() + this.refreshSkewMs
    )
      return this.contextFor(session);

    if (!this.refreshPromise) {
      const refresh = this.refreshExpiredSession(session);
      this.refreshPromise = refresh;
      void refresh.then(
        () => {
          if (this.refreshPromise === refresh) this.refreshPromise = undefined;
        },
        () => {
          if (this.refreshPromise === refresh) this.refreshPromise = undefined;
        },
      );
    }
    return this.contextFor(await this.refreshPromise);
  }

  async signIn(email: unknown, password: unknown): Promise<SupabaseAccountResult> {
    const credentials = parseCredentials(email, password);
    const response = await this.request(
      "token?grant_type=password",
      credentials,
      supabaseAuthResponse,
    );
    this.saveSession(sessionFromAuthResponse(response));
    return {
      ...this.status(true),
      message: "Signed in to the Desk account.",
    };
  }

  async signUp(email: unknown, password: unknown): Promise<SupabaseAccountResult> {
    const credentials = parseCredentials(email, password);
    const response = await this.request("signup", credentials, supabaseSignupResponse);
    if (response.access_token && response.refresh_token) {
      this.saveSession(
        sessionFromAuthResponse(
          supabaseAuthResponse.parse({
            ...response,
            access_token: response.access_token,
            refresh_token: response.refresh_token,
          }),
        ),
      );
      return {
        ...this.status(true),
        message: "Desk account created and signed in.",
      };
    }
    return {
      ...this.status(true),
      message: "Account created. Check your email to confirm it, then sign in.",
    };
  }

  async signOut(): Promise<SupabaseAccountResult> {
    const session = this.readSession();
    if (session && this.config) {
      try {
        await this.request("logout", undefined, z.object({}), session.accessToken);
      } finally {
        this.removeSession();
      }
    } else {
      this.removeSession();
    }
    return { ...this.status(true), message: "Desk account signed out." };
  }

  private async request<T extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    schema: T,
    accessToken?: string,
  ): Promise<z.infer<T>> {
    if (!this.config)
      throw Error("Cloud account is not configured in this build.");
    if (!this.sessionStore.available())
      throw Error("Secure local storage is unavailable for the account session.");
    const headers: Record<string, string> = {
      apikey: this.config.publishableKey,
      "content-type": "application/json",
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const response = await this.fetcher(supabaseAuthUrl(this.config.url, path), {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) throw new SupabaseAuthRequestError(response.status);
    return schema.parse(parsed);
  }

  private readSession(): SupabaseSession | null {
    return this.sessionStore.read();
  }

  private activeSession(): SupabaseSession | null {
    const session = this.readSession();
    return session && (session.expiresAt === null || session.expiresAt > this.now())
      ? session
      : null;
  }

  private saveSession(session: SupabaseSession) {
    this.sessionStore.write(session);
  }

  private removeSession() {
    this.sessionStore.remove();
  }

  private contextFor(session: SupabaseSession): SupabaseSyncContext {
    if (!this.config) throw Error("Cloud account is not configured in this build.");
    return {
      url: this.config.url,
      publishableKey: this.config.publishableKey,
      accessToken: session.accessToken,
      userId: session.userId,
    };
  }

  private async refreshExpiredSession(
    previous: SupabaseSession,
  ): Promise<SupabaseSession> {
    let response: z.infer<typeof supabaseAuthResponse>;
    try {
      response = await this.request(
        "token?grant_type=refresh_token",
        { refresh_token: previous.refreshToken },
        supabaseAuthResponse,
      );
    } catch (error) {
      if (
        error instanceof SupabaseAuthRequestError &&
        (error.status === 400 || error.status === 401)
      ) {
        this.removeSession();
        throw new SupabaseSessionError(
          "Desk account session expired. Reconnect the Desk account.",
          false,
          true,
        );
      }
      throw new SupabaseSessionError(
        "Desk account refresh is unavailable. Local changes are safe; retry when online.",
        true,
        false,
      );
    }

    let next: SupabaseSession;
    try {
      next = sessionFromRefreshResponse(response, previous, this.now());
    } catch {
      throw new SupabaseSessionError(
        "Desk account refresh returned an invalid session. Reconnect the Desk account.",
        false,
        true,
      );
    }
    this.saveSession(next);
    return next;
  }
}

function createEncryptedSessionStore(sessionPath: string): SupabaseSessionStore {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    read: () => {
      if (!existsSync(sessionPath) || !safeStorage.isEncryptionAvailable()) return null;
      try {
        return storedSession.parse(
          JSON.parse(safeStorage.decryptString(readFileSync(sessionPath))),
        );
      } catch {
        return null;
      }
    },
    write: (session) => {
      const temporary = `${sessionPath}.tmp`;
      writeFileSync(
        temporary,
        safeStorage.encryptString(JSON.stringify(session)),
        { mode: 0o600 },
      );
      renameSync(temporary, sessionPath);
    },
    remove: () => {
      if (existsSync(sessionPath)) unlinkSync(sessionPath);
    },
  };
}

function readConfig(developmentPath?: string): SupabaseConfig | null {
  const fromProcess = parseConfig(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
  if (fromProcess) return { ...fromProcess, source: "process-env" };
  if (!developmentPath || !existsSync(developmentPath)) return null;
  try {
    const values = parseEnv(readFileSync(developmentPath, "utf8"));
    const fromFile = parseConfig(values.SUPABASE_URL, values.SUPABASE_PUBLISHABLE_KEY);
    return fromFile ? { ...fromFile, source: "development-env" } : null;
  } catch {
    return null;
  }
}

function parseConfig(url: string | undefined, publishableKey: string | undefined) {
  if (!url || !publishableKey) return null;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost")
      return null;
    if (publishableKey.trim().length < 8) return null;
    return { url: parsedUrl.toString().replace(/\/$/, ""), publishableKey: publishableKey.trim() };
  } catch {
    return null;
  }
}

function parseCredentials(email: unknown, password: unknown) {
  return {
    email: supabaseEmail.parse(email),
    password: supabasePassword.parse(password),
  };
}
