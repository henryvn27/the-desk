import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data = await mkdtemp(join(tmpdir(), "desk-provider-live-"));
const output = resolve("artifacts/openrouter-live");
await mkdir(output, { recursive: true });
let app;
const evidence = { startedAt: new Date().toISOString(), requests: [] };
try {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
      DESK_ENABLE_DEVELOPMENT_KEY: "1",
    },
  });
  let page;
  await waitFor(
    () =>
      Boolean((page = app.windows().find((p) => p.url().endsWith("#main")))),
    "Main window did not open",
  );
  const status = await page.evaluate(() => window.desk.providerStatus());
  assert.equal(status.source, "development-env");
  await page.evaluate(() => window.desk.lens());
  let lens;
  await waitFor(
    () =>
      Boolean((lens = app.windows().find((p) => p.url().endsWith("#lens")))),
    "Lens did not open",
  );
  // Draw only synthetic geometry offscreen. No desktop capture is requested.
  const image = await lens.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const x = c.getContext("2d");
    x.fillStyle = "white";
    x.fillRect(0, 0, 320, 240);
    x.fillStyle = "#1658d4";
    x.beginPath();
    x.arc(160, 120, 65, 0, Math.PI * 2);
    x.fill();
    return c.toDataURL("image/png");
  });
  await writeFile(
    join(output, "synthetic-blue-circle.png"),
    Buffer.from(image.split(",")[1], "base64"),
  );
  for (const input of [
    {
      question:
        "In one short sentence, explain why 2 + 3 = 5. Return no overlays.",
    },
    {
      question:
        "What color is the circle in this synthetic image? Answer in one short sentence and return no overlays.",
      imageDataUrl: image,
    },
  ]) {
    const expected = input.imageDataUrl
      ? "google/gemini-3.8-flash"
      : "openai/gpt-5.6-terra";
    try {
      const reply = await lens.evaluate(
        (input) => window.desk.askLens(input),
        input,
      );
      assert.equal(reply.model, expected);
      assert.ok(reply.explanation.length > 0);
      if (input.imageDataUrl) assert.match(reply.explanation, /blue/i);
      else assert.match(reply.explanation, /five|5/);
      evidence.requests.push({
        model: reply.model,
        resolvedModel: reply.resolvedModel,
        success: true,
        usage: reply.usage,
        cost: reply.cost,
        syntheticAnswerChecked: true,
      });
    } catch (error) {
      // The app writes content-free telemetry; never emit raw provider errors here.
      const message = error instanceof Error ? error.message : "";
      const known = [
        "unexpected model",
        "timed out",
        "could not reach",
        "rejected the API credentials",
        "rate-limited",
        "invalid Lens explanation",
        "no completed Lens explanation",
      ];
      const reason =
        known.find((reason) => message.includes(reason)) ??
        message.match(/OpenRouter returned HTTP [0-9]{3}/)?.[0] ??
        "unclassified";
      evidence.requests.push({ model: expected, success: false, reason });
    }
  }
  const { DatabaseSync } = await import("node:sqlite");
  const telemetry = (() => {
    const db = new DatabaseSync(join(data, "desk.sqlite"), { readOnly: true });
    try {
      return db
        .prepare("SELECT data FROM ai_runs")
        .all()
        .map((r) => {
          const event = JSON.parse(r.data);
          return {
            model: event.model,
            success: event.success,
            httpStatus: event.httpStatus,
            errorCode: event.errorCode,
            usage: event.usage,
            cost: event.cost,
          };
        });
    } finally {
      db.close();
    }
  })();
  evidence.telemetry = telemetry;
  assert.equal(evidence.requests.length, 2);
  console.log(JSON.stringify(evidence));
  assert.ok(
    evidence.requests.every((request) => request.success),
    "One or more bounded live checks failed; see sanitized telemetry.",
  );
} finally {
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(evidence, null, 2),
  );
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
