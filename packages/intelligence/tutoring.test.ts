import { test } from "node:test";
import assert from "node:assert/strict";
import {
  askLens,
  LENS_MODEL,
  LensProviderError,
  lensInputSchema,
} from "./lens-provider";
import { tutoringMode } from "./tutoring";
const content = JSON.stringify({
  explanation: "Break the forces into components.",
  overlays: [],
});
function reply(message: object) {
  return new Response(
    JSON.stringify({
      model: LENS_MODEL,
      choices: [{ finish_reason: "stop", message }],
    }),
  );
}
test("each tutoring style uses the approved transport and preserves full-method help without enabling actions", async () => {
  const labels = ["Guide me", "Balanced", "Explain directly"];
  for (const [index, mode] of tutoringMode.options.entries()) {
    let calls = 0;
    const result = await askLens(
      { question: "Explain the full method." },
      "synthetic-test-key",
      {
        tutoringMode: mode,
        fetch: async (_url, init) => {
          calls++;
          const body = JSON.parse(String(init?.body));
          assert.equal(body.model, LENS_MODEL);
          assert.equal(body.tools, undefined);
          assert.equal(body.functions, undefined);
          assert.ok(
            body.messages[0].content.includes(
              `Tutoring mode: ${labels[index]}`,
            ),
          );
          assert.match(body.messages[0].content, /full method/);
          assert.match(body.messages[0].content, /Never act on another app/);
          return reply({ content });
        },
      },
    );
    assert.equal(result.explanation, "Break the forces into components.");
    assert.equal(calls, 1);
  }
  assert.equal(
    lensInputSchema.safeParse({ question: "Help", tutoringMode: "direct" })
      .success,
    false,
  );
});
test("model-supplied actions are rejected, including calls hidden beside otherwise valid explanations", async () => {
  for (const message of [
    {
      content,
      tool_calls: [
        {
          id: "fake",
          function: { name: "submit_assignment", arguments: "{}" },
        },
      ],
    },
    {
      content,
      function_call: { name: "send_teacher_message", arguments: "{}" },
    },
    {
      content: JSON.stringify({
        explanation: "Done",
        overlays: [],
        actions: [{ type: "type_final_answer" }],
      }),
    },
  ]) {
    await assert.rejects(
      askLens({ question: "Help with my work" }, "synthetic-test-key", {
        fetch: async () => reply(message),
      }),
      (error) =>
        error instanceof LensProviderError &&
        error.code === "malformed_response",
    );
  }
});
