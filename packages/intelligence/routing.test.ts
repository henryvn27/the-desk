import { test } from "node:test";
import assert from "node:assert/strict";
import { inferenceRoute, routingTier, APPROVED_MODELS, CANONICAL_MODELS } from "./routing";
import { askLens, LENS_MODEL, LensProviderError } from "./lens-provider";

test("Desk owns each approved tier with privacy constraints and no fallback", () => {
  const models = routingTier.options.map((tier) => {
    const route = inferenceRoute(tier);
    assert.equal(route.provider.allow_fallbacks, false);
    assert.equal(route.provider.require_parameters, true);
    assert.equal(route.provider.data_collection, "deny");
    assert.equal(route.provider.zdr, true);
    assert.equal(route.provider.only.length, 1);
    assert.deepEqual(route.provider.only, route.provider.order);
    return route.model;
  });
  assert.deepEqual(models, APPROVED_MODELS);
  assert.throws(() => inferenceRoute("openrouter/auto" as never));
});
test("normal text uses one Terra request, rejects model substitution and never invents cost", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init!.body));
    assert.equal(body.model, LENS_MODEL);
    assert.deepEqual(body.provider.only, ["azure"]);
    assert.equal(body.max_completion_tokens, 4096);
    assert.equal(body.models, undefined);
    return new Response(
      JSON.stringify({
        model: LENS_MODEL,
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({ explanation: "A hint.", overlays: [] }),
            },
          },
        ],
      }),
    );
  };
  assert.equal(
    (
      await askLens({ question: "A hint?" }, "synthetic-test-key", {
        fetch: fetcher,
      })
    ).cost,
    null,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    askLens({ question: "A hint?" }, "synthetic-test-key", {
      fetch: async () =>
        new Response(
          JSON.stringify({ model: "unapproved/model", choices: [] }),
        ),
    }),
    (error: unknown) =>
      error instanceof LensProviderError && error.code === "malformed_response",
  );
});


test("approved dated identity is accepted without changing Desk's requested tier", async () => {
  const result = await askLens({ question: "A hint?" }, "synthetic-test-key", {
    fetch: async () => new Response(JSON.stringify({
      model: CANONICAL_MODELS[LENS_MODEL],
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ explanation: "A hint.", overlays: [] }) } }],
    })),
  });
  assert.equal(result.model, LENS_MODEL);
  assert.equal(result.resolvedModel, CANONICAL_MODELS[LENS_MODEL]);
});
