import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-chat-provider-"));
let app;
try {
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, DESK_DATA_DIR: data, DESK_ENABLE_DEVELOPMENT_KEY: "1" },
  });
  const page = await app.firstWindow();
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  await app.evaluate(() => {
    globalThis.deskChatRequests = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      globalThis.deskChatRequests.push(body);
      return new Response(JSON.stringify({
        model: "openai/gpt-5.6-luna",
        choices: [{
          finish_reason: "stop",
          message: { content: JSON.stringify({ explanation: "2 + 3 = 5.", overlays: [] }) },
        }],
        usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48, cost: 0.0001 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  });
  const input = page.getByLabel("Ask The Desk", { exact: true });
  await input.fill("What is 2 + 3?");
  await input.press("Meta+Enter");
  await page.getByText("2 + 3 = 5.", { exact: true }).waitFor();
  const request = await app.evaluate(() => globalThis.deskChatRequests?.[0]);
  assert.ok(request);
  assert.equal(request.model, "openai/gpt-5.6-luna");
  assert.equal(request.max_tokens, 4096);
  assert.equal(request.max_completion_tokens, undefined);
  assert.equal(request.messages[0].content.includes("Study activity contract"), false);
  console.log(JSON.stringify({ result: "PASS", flows: ["general Chat answer", "Luna route", "no Study check contract leaked into Chat"] }));
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
