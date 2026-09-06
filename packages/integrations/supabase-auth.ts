import { z } from "zod";

export const supabaseEmail = z.string().trim().email().max(320);
export const supabasePassword = z.string().min(8).max(200);

export const supabaseAuthResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  token_type: z.string().optional(),
  user: z
    .object({
      id: z.string().uuid(),
      email: z.string().email().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const supabaseSignupResponse = z.object({
  access_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  token_type: z.string().optional(),
  user: z
    .object({
      id: z.string().uuid(),
      email: z.string().email().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type SupabaseSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string | null;
  expiresAt: number | null;
};

export type SupabaseAccountStatus = {
  configured: boolean;
  authenticated: boolean;
  email: string | null;
  userId: string | null;
  secureStorage: boolean;
  source: "development-env" | "process-env" | null;
};

export type SupabaseAccountResult = SupabaseAccountStatus & {
  message?: string;
};

export function supabaseAuthUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" && base.hostname !== "localhost")
    throw Error("Supabase URL must use HTTPS.");
  return new URL(`/auth/v1/${path.replace(/^\//, "")}`, base).toString();
}

export function sessionFromAuthResponse(
  response: z.infer<typeof supabaseAuthResponse>,
): SupabaseSession {
  if (!response.user?.id) throw Error("Supabase did not return an account identity.");
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    userId: response.user.id,
    email: response.user.email ?? null,
    expiresAt: response.expires_in
      ? Date.now() + response.expires_in * 1000
      : null,
  };
}
