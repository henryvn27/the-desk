import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionCapabilities } from "./catalog";

test("connection catalog states the ladder without claiming fake sync", () => {
  const capabilities = connectionCapabilities();
  assert.deepEqual(
    capabilities.map(({ id }) => id),
    [
      "google-calendar",
      "gmail",
      "google-classroom",
      "google-drive",
      "khan-academy",
      "quizlet",
      "generic-web",
      "gemini-notebook",
    ],
  );
  assert.equal(
    capabilities.find(({ id }) => id === "generic-web")?.state,
    "available",
  );
  assert.ok(
    capabilities
      .filter(({ id }) => id !== "generic-web")
      .every(({ state }) => state !== "available"),
  );
  assert.ok(
    capabilities.every(
      ({ summary, fallback }) => summary.length > 0 && fallback.length > 0,
    ),
  );
});
