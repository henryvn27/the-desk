import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sessionFromAuthResponse,
  supabaseAuthError,
  supabaseAuthResponse,
  supabaseAuthUrl,
  supabaseEmail,
  supabasePassword,
} from "./supabase-auth";

test("Supabase auth failures discard untrusted provider error details", () => {
  const secret = "synthetic-password-material";
  const message = supabaseAuthError(
    { error_description: `Invalid password: ${secret}` },
    401,
  );
  assert.equal(message, "Account request failed (HTTP 401).");
  assert.equal(message.includes(secret), false);
});

test("Supabase account boundary validates credentials and keeps auth URLs bounded", () => {
  assert.equal(
    supabaseAuthUrl("https://desk.example.test/", "token?grant_type=password"),
    "https://desk.example.test/auth/v1/token?grant_type=password",
  );
  assert.equal(supabaseEmail.parse("student@example.edu"), "student@example.edu");
  assert.equal(supabasePassword.parse("long-enough-password"), "long-enough-password");
  assert.throws(() => supabaseEmail.parse("not-an-email"));
  assert.throws(() => supabasePassword.parse("short"));
  assert.throws(() => supabaseAuthUrl("http://remote.example.test", "signup"));
});

test("Supabase auth responses become a renderer-safe session summary", () => {
  const response = supabaseAuthResponse.parse({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "student@example.edu",
    },
  });
  const session = sessionFromAuthResponse(response);
  assert.equal(session.userId, "00000000-0000-4000-8000-000000000001");
  assert.equal(session.email, "student@example.edu");
  assert.equal(session.accessToken, "access-token");
  assert.equal(session.refreshToken, "refresh-token");
  assert.ok(session.expiresAt);
});
