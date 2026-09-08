import assert from "node:assert/strict";
import { test } from "node:test";
import { RecordingSessionRegistry } from "./recording-session";

test("recording ownership rejects overlap and releases only the current session", () => {
  const registry = new RecordingSessionRegistry();
  const first = registry.begin("first", () => {});

  assert.equal(first.isCurrent(), true);
  assert.throws(() => registry.begin("second", () => {}), /already active/);
  assert.equal(first.release(), true);
  assert.equal(first.release(), false);
  assert.equal(registry.hasActive(), false);
});

test("stale cleanup cannot release a replacement session", () => {
  const registry = new RecordingSessionRegistry();
  const cleanups: string[] = [];
  const first = registry.begin("first", () => cleanups.push("first"));
  assert.equal(first.release(), true);
  const second = registry.begin("second", () => cleanups.push("second"));

  assert.equal(first.isCurrent(), false);
  assert.equal(first.release(), false);
  assert.equal(second.isCurrent(), true);
  registry.disposeCurrent();
  assert.deepEqual(cleanups, ["second"]);
  assert.equal(second.isCurrent(), false);
});

test("disposing during teardown is idempotent", () => {
  const registry = new RecordingSessionRegistry();
  let cleanupCount = 0;
  const lease = registry.begin("recording", () => { cleanupCount += 1; });

  registry.disposeCurrent();
  registry.disposeCurrent();

  assert.equal(cleanupCount, 1);
  assert.equal(lease.release(), false);
});
