import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("local user profile persists, updates by revision and can be forgotten", () => {
  const store = new DeskStore(":memory:");
  try {
    const created = store.execute({
      type: "user.create",
      input: {
        displayName: "Henry",
        email: "henry@example.edu",
        timeZone: "America/New_York",
      },
    }).user!;
    assert.equal(created.revision, 0);
    assert.equal(created.authority, "user-entered");
    assert.throws(
      () =>
        store.execute({
          type: "user.create",
          input: {
            displayName: "Second profile",
            email: null,
            timeZone: "UTC",
          },
        }),
      /already exists/,
    );
    const updated = store.execute({
      type: "user.update",
      id: created.id,
      revision: created.revision,
      input: {
        displayName: "Henry V.",
        email: null,
        timeZone: "UTC",
      },
    }).user!;
    assert.equal(updated.revision, 1);
    assert.equal(updated.displayName, "Henry V.");
    assert.throws(
      () =>
        store.execute({
          type: "user.update",
          id: updated.id,
          revision: 0,
          input: {
            displayName: "Stale",
            email: null,
            timeZone: "UTC",
          },
        }),
      /changed elsewhere/,
    );
    const pathless = store.snapshot();
    assert.equal(pathless.user?.timeZone, "UTC");
  } finally {
    store.close();
  }
});

test("local user profile survives restart and forget clears only the profile", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-user-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const profile = store.execute({
      type: "user.create",
      input: { displayName: "Student", email: null, timeZone: "UTC" },
    }).user!;
    store.execute({ type: "class.create", name: "Physics" });
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().user?.id, profile.id);
    store.execute({
      type: "user.forget",
      id: profile.id,
      revision: profile.revision,
    });
    assert.equal(store.snapshot().user, null);
    assert.equal(store.snapshot().classes.length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
