import { safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import {
  sessionFromAuthResponse,
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

export class SupabaseAccount {
  private readonly sessionPath: string;
  private readonly config: SupabaseConfig | null;

  constructor(directory: string, developmentPath?: string) {
    this.sessionPath = join(directory, "supabase-session.enc");
    this.config = readConfig(developmentPath);
  }

  status(): SupabaseAccountStatus {
    const session = this.activeSession();
    return {
      configured: this.config !== null,
      authenticated: session !== null,
      email: session?.email ?? null,
      userId: session?.userId ?? null,
      secureStorage: safeStorage.isEncryptionAvailable(),
      source: this.config?.source ?? null,
    };
  }

  syncContext(): SupabaseSyncContext | null {
    const session = this.activeSession();
    if (!session || !this.config) return null;
    return {
      url: this.config.url,
      publishableKey: this.config.publishableKey,
      accessToken: session.accessToken,
      userId: session.userId,
    };
  }

  async signIn(email: unknown, password: unknown): Promise<SupabaseAccountResult> {
    const credentials = parseCredentials(email, password);
    const response = await this.request(
      "token?grant_type=password",
      credentials,
      supabaseAuthResponse,
    );
    this.saveSession(sessionFromAuthResponse(response));
    return { ...this.status(), message: "Signed in to the Desk account." };
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
      return { ...this.status(), message: "Desk account created and signed in." };
    }
    return {
      ...this.status(),
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
    return { ...this.status(), message: "Desk account signed out." };
  }

  private async request<T extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    schema: T,
    accessToken?: string,
  ): Promise<z.infer<T>> {
    if (!this.config)
      throw Error("Cloud account is not configured in this build.");
    if (!safeStorage.isEncryptionAvailable())
      throw Error("Secure local storage is unavailable for the account session.");
    const headers: Record<string, string> = {
      apikey: this.config.publishableKey,
      "content-type": "application/json",
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const response = await fetch(supabaseAuthUrl(this.config.url, path), {
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
    if (!response.ok) throw Error(authError(parsed, response.status));
    return schema.parse(parsed);
  }

  private readSession(): SupabaseSession | null {
    if (!existsSync(this.sessionPath) || !safeStorage.isEncryptionAvailable())
      return null;
    try {
      return storedSession.parse(
        JSON.parse(safeStorage.decryptString(readFileSync(this.sessionPath))),
      );
    } catch {
      return null;
    }
  }

  private activeSession(): SupabaseSession | null {
    const session = this.readSession();
    return session && (session.expiresAt === null || session.expiresAt > Date.now())
      ? session
      : null;
  }

  private saveSession(session: SupabaseSession) {
    const temporary = `${this.sessionPath}.tmp`;
    writeFileSync(
      temporary,
      safeStorage.encryptString(JSON.stringify(session)),
      { mode: 0o600 },
    );
    renameSync(temporary, this.sessionPath);
  }

  private removeSession() {
    if (existsSync(this.sessionPath)) unlinkSync(this.sessionPath);
  }
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

function authError(payload: unknown, status: number) {
  const message = z
    .object({ error_description: z.string().optional(), msg: z.string().optional() })
    .safeParse(payload);
  return message.success && (message.data.error_description || message.data.msg)
    ? `Account request failed: ${message.data.error_description ?? message.data.msg}`
    : `Account request failed (HTTP ${status}).`;
}
