import assert from "node:assert/strict";
import test from "node:test";
import { DeskStore } from "./store";

test("capture and text import use the saved profile zone for relative deadlines", () => {
  const store = new DeskStore(":memory:");
  try {
    store.execute({
      type: "user.create",
      input: { displayName: "Student", email: null, timeZone: "America/New_York" },
    });
    store.execute({ type: "class.create", name: "AP Physics C" });
    const now = new Date("2026-09-08T02:30:00.000Z");
    const text = "AP Physics C problem set due tomorrow at 9 PM";
    const profileTimeZone = store.snapshot().user?.timeZone ?? "UTC";
    const captured = store.execute(
      { type: "inbox.capture", text, timeZone: profileTimeZone },
      now,
    );
    const imported = store.execute(
      {
        type: "inbox.import",
        files: [{ name: "assignment.txt", text }],
        timeZone: profileTimeZone,
      },
      now,
    );
    const capturedDraft = captured.captureInbox.at(-1)!.draft;
    const importedDraft = imported.captureInbox.at(-1)!.draft;
    assert.equal(capturedDraft.deadline?.date, "2026-09-08");
    assert.equal(capturedDraft.deadline?.time, "21:00");
    assert.equal(capturedDraft.deadline?.timeZone, "America/New_York");
    assert.deepEqual(importedDraft.deadline, capturedDraft.deadline);
  } finally {
    store.close();
  }
});
