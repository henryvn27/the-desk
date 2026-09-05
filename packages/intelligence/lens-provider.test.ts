import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LENS_MODEL,
  LensProviderError,
  askLens,
  lensInputSchema,
  lensModelOutputSchema,
  type LensTelemetryEvent,
} from "./lens-provider";

const modelOutput = {
  explanation:
    "The slope is positive because the line rises from left to right.",
  overlays: [
    {
      type: "arrow" as const,
      x: 0.2,
      y: 0.8,
      x2: 0.7,
      y2: 0.3,
      text: null,
    },
  ],
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("sends one strict, stored-disabled Responses request with normalized inputs", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response({ output_text: JSON.stringify(modelOutput) });
  };

  const result = await askLens(
    {
      question: "Why is the slope positive?",
      context: "AP Calculus graph",
      imageDataUrl: "data:image/png;base64,iVBORw==",
      selection: {
        points: [{ x: 0.1, y: 0.2 }],
        paths: [{ points: [{ x: 0.2, y: 0.3 }] }],
      },
      history: [{ role: "user", content: "Look at the graph." }],
    },
    "test-key",
    { fetch: fetcher },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.openai.com/v1/responses");
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.equal(body.model, LENS_MODEL);
  assert.equal(body.store, false);
  assert.equal(body.tools, undefined);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.input.at(-1).content[1].type, "input_image");
  assert.equal(result.explanation, modelOutput.explanation);
  assert.deepEqual(result.overlays, modelOutput.overlays);
  assert.equal(result.usage, null);
  assert.equal(result.cost, null);
});

test("reports actual cached token usage and dated model cost", async () => {
  const events: LensTelemetryEvent[] = [];
  const result = await askLens({ question: "Teach me." }, "test-key", {
    fetch: async () =>
      response({
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: JSON.stringify(modelOutput) },
            ],
          },
        ],
        usage: {
          input_tokens: 1_000,
          input_tokens_details: { cached_tokens: 200 },
          output_tokens: 500,
          total_tokens: 1_500,
        },
      }),
    onTelemetry: async (event) => {
      events.push(event);
    },
  });

  assert.deepEqual(result.usage, {
    inputTokens: 1_000,
    cachedInputTokens: 200,
    outputTokens: 500,
    totalTokens: 1_500,
  });
  assert.equal(result.cost?.estimatedUsd, 0.002865);
  assert.equal(result.cost?.rateDate, "2026-09-05");
  assert.equal(events.length, 1);
  assert.equal(events[0]!.success, true);
  assert.deepEqual(events[0]!.usage, result.usage);
  assert.deepEqual(events[0]!.cost, result.cost);
});

test("rejects oversized or unnormalized input before making a request", async () => {
  assert.equal(
    lensInputSchema.safeParse({
      question: "Where?",
      selection: { points: [{ x: 1.01, y: 0 }] },
    }).success,
    false,
  );
  assert.equal(
    lensInputSchema.safeParse({
      question: "Where?",
      history: Array.from({ length: 9 }, () => ({
        role: "user",
        content: "again",
      })),
    }).success,
    false,
  );
  assert.equal(
    lensInputSchema.safeParse({
      question: "Where?",
      selection: {
        paths: Array.from({ length: 9 }, () => ({
          points: [{ x: 0.5, y: 0.5 }],
        })),
      },
    }).success,
    false,
  );
  assert.equal(
    lensInputSchema.safeParse({
      question: "Where?",
      selection: {
        paths: [
          {
            points: Array.from({ length: 1_501 }, () => ({ x: 0.5, y: 0.5 })),
          },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    lensInputSchema.safeParse({
      question: "Where?",
      imageDataUrl: `data:image/png;base64,${"AAAA".repeat(4_194_305)}`,
    }).success,
    false,
  );

  let calls = 0;
  await assert.rejects(
    askLens({ question: "x".repeat(4_001) }, "test-key", {
      fetch: async () => {
        calls += 1;
        return response({});
      },
    }),
    (error: unknown) =>
      error instanceof LensProviderError && error.code === "invalid_input",
  );
  assert.equal(calls, 0);
});

test("classifies refusal, incomplete, and malformed structured output", async (t) => {
  const cases: Array<[string, unknown, string]> = [
    [
      "refusal",
      {
        output: [{ content: [{ type: "refusal", refusal: "I cannot help." }] }],
      },
      "refusal",
    ],
    ["incomplete", { status: "incomplete" }, "incomplete"],
    ["malformed", { output_text: "{broken" }, "malformed_response"],
  ];
  for (const [name, body, expectedCode] of cases)
    await t.test(name, async () => {
      const events: LensTelemetryEvent[] = [];
      await assert.rejects(
        askLens({ question: "Help." }, "test-key", {
          fetch: async () => response(body),
          onTelemetry: (event) => {
            events.push(event);
          },
        }),
        (error: unknown) =>
          error instanceof LensProviderError && error.code === expectedCode,
      );
      assert.equal(events.length, 1);
      assert.equal(events[0]!.success, false);
      assert.equal(events[0]!.errorCode, expectedCode);
    });
});

test("classifies auth and rate-limit errors without leaking request secrets", async (t) => {
  for (const [status, code] of [
    [401, "authentication"],
    [429, "rate_limit"],
  ] as const)
    await t.test(String(status), async () => {
      const secretKey = "sk-secret-key-material";
      const secretPrompt = "private-prompt-material";
      const events: LensTelemetryEvent[] = [];
      let caught: unknown;
      try {
        await askLens({ question: secretPrompt }, secretKey, {
          fetch: async () =>
            response(
              { error: { message: `${secretKey} ${secretPrompt}` } },
              status,
            ),
          onTelemetry: (event) => {
            events.push(event);
          },
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof LensProviderError);
      assert.equal(caught.code, code);
      assert.doesNotMatch(caught.message, /secret-key|private-prompt/);
      assert.deepEqual(events[0], {
        model: LENS_MODEL,
        startedAt: events[0]!.startedAt,
        latencyMs: events[0]!.latencyMs,
        success: false,
        httpStatus: status,
        errorCode: code,
        usage: null,
        cost: null,
      });
      assert.doesNotMatch(
        JSON.stringify(events[0]),
        /secret-key|private-prompt/,
      );
    });
});

test("times out one request without retrying and records the failure", async () => {
  let calls = 0;
  const events: LensTelemetryEvent[] = [];
  await assert.rejects(
    askLens({ question: "Help." }, "test-key", {
      timeoutMs: 5,
      fetch: async (_url, init) => {
        calls += 1;
        return await new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      },
      onTelemetry: (event) => {
        events.push(event);
      },
    }),
    (error: unknown) =>
      error instanceof LensProviderError && error.code === "timeout",
  );
  assert.equal(calls, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.errorCode, "timeout");
});

test("honors caller abort and still emits exactly one failure event", async () => {
  const controller = new AbortController();
  const events: LensTelemetryEvent[] = [];
  const pending = askLens({ question: "Help." }, "test-key", {
    signal: controller.signal,
    fetch: async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
    onTelemetry: (event) => {
      events.push(event);
    },
  });
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof LensProviderError && error.code === "aborted",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]!.errorCode, "aborted");
});

test("does not hide telemetry persistence failures", async () => {
  const storageFailure = new Error("telemetry storage failed");
  await assert.rejects(
    askLens({ question: "Help." }, "test-key", {
      fetch: async () => response({ output_text: JSON.stringify(modelOutput) }),
      onTelemetry: async () => {
        throw storageFailure;
      },
    }),
    storageFailure,
  );
});

test("validates all returned overlay coordinates and mark count", () => {
  assert.equal(
    lensModelOutputSchema.safeParse({
      explanation: "Look here.",
      overlays: [
        { type: "label", x: -0.1, y: 0, x2: null, y2: null, text: "x" },
      ],
    }).success,
    false,
  );
  assert.equal(
    lensModelOutputSchema.safeParse({
      explanation: "Many marks.",
      overlays: Array.from({ length: 13 }, () => ({
        type: "circle",
        x: 0.5,
        y: 0.5,
        x2: null,
        y2: null,
        text: null,
      })),
    }).success,
    false,
  );
});
