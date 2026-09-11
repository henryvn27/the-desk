import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeskStore } from "./store";

test("AI provider selection defaults to Desk Managed and persists explicit choices", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desk-provider-selection-"));
  const path = join(directory, "desk.sqlite");
  try {
    const store = new DeskStore(path);
    assert.equal(store.aiProviderMode(), "desk-managed");
    store.execute({ type: "ai.provider.select", mode: "chatgpt-codex" });
    assert.equal(store.aiProviderMode(), "chatgpt-codex");
    store.close();
    const reopened = new DeskStore(path);
    assert.equal(reopened.aiProviderMode(), "chatgpt-codex");
    reopened.execute({ type: "ai.provider.select", mode: "byok" });
    assert.equal(reopened.aiProviderMode(), "byok");
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
