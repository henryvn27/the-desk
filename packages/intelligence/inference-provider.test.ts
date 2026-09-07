import { test } from "node:test";
import assert from "node:assert/strict";
import { askAcademicInference, InferenceProviderError } from "./inference-provider";

test("structured inference uses the Desk-owned Luna route and privacy provider settings", async () => {
  let request: { body: Record<string, unknown>; authorization: string } | undefined;
  const result = await askAcademicInference(
    { sourceKind: "capture", text: "Homework due Friday" },
    ["AP Physics C"],
    "synthetic-test-key",
    {
      fetch: async (_url, init) => {
        request = {
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          authorization: String(new Headers(init?.headers).get("Authorization")),
        };
        return new Response(JSON.stringify({
          model: "openai/gpt-5.6-luna",
          choices: [{ message: { content: JSON.stringify({ title: "Homework", className: "AP Physics C", objectType: "assignment", concepts: ["Forces"] }) } }],
          usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  );
  assert.equal(result.patch.className, "AP Physics C");
  assert.equal(result.model, "openai/gpt-5.6-luna");
  assert.equal(result.usage?.totalTokens, 32);
  assert.equal(request?.authorization, "Bearer synthetic-test-key");
  assert.deepEqual(request?.body.provider, { only: ["azure"], order: ["azure"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true });
  assert.equal(request?.body.model, "openai/gpt-5.6-luna");
  assert.equal(request?.body.max_completion_tokens, 700);
  assert.equal(request?.body.max_tokens, undefined);
});

test("structured inference rejects an unexpected model and does not retry", async () => {
  let calls = 0;
  await assert.rejects(
    askAcademicInference(
      { sourceKind: "browser", text: "Read this" },
      ["Physics"],
      "synthetic-test-key",
      {
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify({ model: "unknown/model", choices: [{ message: { content: "{}" } }] }), { status: 200 });
        },
      },
    ),
    (error: unknown) => error instanceof InferenceProviderError && error.code === "malformed_response",
  );
  assert.equal(calls, 1);
});

test("structured inference reports malformed fields without exposing provider output", async () => {
  await assert.rejects(
    askAcademicInference(
      { sourceKind: "capture", text: "Ambiguous assignment" },
      ["Physics"],
      "synthetic-test-key",
      {
        fetch: async () =>
          new Response(
            JSON.stringify({
              model: "openai/gpt-5.6-luna",
              choices: [{ message: { content: JSON.stringify({ dueAt: 42 }) } }],
            }),
            { status: 200 },
          ),
      },
    ),
    (error: unknown) =>
      error instanceof InferenceProviderError &&
      error.code === "malformed_response" &&
      !error.message.includes("42"),
  );
});

test("structured inference preserves provider status for malformed 200 responses", async () => {
  await assert.rejects(
    askAcademicInference(
      { sourceKind: "capture", text: "Ambiguous assignment" },
      ["Physics"],
      "synthetic-test-key",
      {
        fetch: async () => new Response(JSON.stringify({ model: "openai/gpt-5.6-luna", choices: [] }), { status: 200 }),
      },
    ),
    (error: unknown) =>
      error instanceof InferenceProviderError &&
      error.code === "malformed_response" &&
      error.status === 200,
  );
});
