import { test } from "node:test";
import assert from "node:assert/strict";
import { DeskStore } from "./store";
const now = new Date("2026-09-06T12:00:00Z");
test("file batch retains source boundaries and applies policy atomically", () => {
  const store = new DeskStore(":memory:");
  try {
    store.execute({ type: "class.create", name: "Physics" });
    const first = "Physics: Forces due 2026-09-10T20:00:00Z, 30 minutes";
    const state = store.execute(
      {
        type: "inbox.import",
        timeZone: "UTC",
        files: [
          { name: "teacher-notes.md", text: first },
          { name: "homework.txt", text: "- Read chapter 3\n- Review vectors" },
        ],
      },
      now,
    );
    assert.equal(state.captureInbox.length, 3);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.captureInbox[0]!.draft.provenance.source, "text-file");
    assert.equal(
      state.captureInbox[1]!.draft.provenance.sourceName,
      "homework.txt",
    );
    assert.equal(
      state.captureInbox[2]!.draft.provenance.originalText,
      "- Read chapter 3\n- Review vectors",
    );
    assert.equal(
      state.tasks[0]!.captureEvidence!.sourceName,
      "teacher-notes.md",
    );
    assert.equal(state.tasks[0]!.captureEvidence!.originalText, first);
    assert.throws(() =>
      store.execute(
        {
          type: "inbox.import",
          timeZone: "UTC",
          files: [
            { name: "valid.md", text: first },
            {
              name: "too-many.txt",
              text: Array.from({ length: 51 }, (_, i) => `- Problem ${i}`).join(
                "\n",
              ),
            },
          ],
        },
        now,
      ),
    );
    assert.deepEqual(store.snapshot(), state);
  } finally {
    store.close();
  }
});
