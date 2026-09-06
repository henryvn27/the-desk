import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lensAnswerCanvasScene,
  lensAnswerMemoryInput,
  lensAnswerMistakeInput,
  lensAnswerSourceInput,
  lensFollowUpTaskInput,
} from "./lens-actions";
import { DeskStore } from "../domain/store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Lens answer memory action creates an explicit class-scoped note payload", () => {
  const result = lensAnswerMemoryInput(
    "The normal force balances the perpendicular component.",
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(result.category, "other");
  assert.equal(result.classId, "00000000-0000-4000-8000-000000000001");
  assert.equal(
    result.text,
    "The normal force balances the perpendicular component.",
  );
});

test("Lens answer action creates a user-linked source payload", () => {
  const result = lensAnswerSourceInput(
    "The normal force balances the perpendicular component.",
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  );
  assert.equal(result.kind, "unspecified");
  assert.deepEqual(result.classIds, ["00000000-0000-4000-8000-000000000001"]);
  assert.deepEqual(result.taskIds, ["00000000-0000-4000-8000-000000000002"]);
  assert.equal(result.title, "Lens answer");
});

test("Lens follow-up action creates an explicit optional-review task payload", () => {
  const result = lensFollowUpTaskInput(
    "Review the sign of each component.",
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(result.title, "Review Lens answer");
  assert.equal(result.workKind, "optional-review");
  assert.equal(result.minutes, 15);
  assert.equal(result.dueAt, null);
  assert.equal(result.notes, "Review the sign of each component.");
});

test("Lens follow-up can prepare the active task's validated HTTPS resource", () => {
  const result = lensFollowUpTaskInput(
    "Review the sign of each component.",
    "00000000-0000-4000-8000-000000000001",
    "https://example.edu/force-balance",
  );
  assert.equal(result.resource, "https://example.edu/force-balance");
  assert.throws(() =>
    lensFollowUpTaskInput(
      "Review the sign of each component.",
      "00000000-0000-4000-8000-000000000001",
      "file:///tmp/answer.txt",
    ),
  );
});

test("explicit Lens mistake and Canvas artifact actions persist across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-lens-actions-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Force balance",
        classId,
        dueAt: null,
        minutes: 20,
        resource: "https://example.edu/force-balance",
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!;
    const answer = "Resolve each force into components before adding them.";
    store.execute({
      type: "mistake.create",
      input: lensAnswerMistakeInput(answer, classId, task.id, {
        concept: "Force components",
        originalAttempt: "I added the force magnitudes directly.",
        whatWentWrong: "I mixed horizontal and vertical components.",
      }),
    });
    const withSource = store.execute({
      type: "source.create",
      input: lensAnswerSourceInput(answer, classId, task.id),
    });
    const source = withSource.sources.at(-1)!;
    const withCanvas = store.execute({
      type: "canvas.create",
      taskId: task.id,
    });
    const canvas = withCanvas.canvases.at(-1)!;
    store.execute({
      type: "canvas.save",
      id: canvas.id,
      revision: canvas.revision,
      scene: lensAnswerCanvasScene(answer, source.id),
    });
    store.close();
    store = new DeskStore(path);

    const snapshot = store.snapshot();
    assert.equal(snapshot.mistakes[0]!.taskId, task.id);
    assert.equal(
      snapshot.mistakes[0]!.originalAttempt,
      "I added the force magnitudes directly.",
    );
    assert.equal(snapshot.mistakes[0]!.correction, answer);
    assert.equal(snapshot.mistakes[0]!.confidence, "low");
    const savedCanvas = store.canvas(canvas.id);
    assert.deepEqual(savedCanvas.scene.sourceIds, [source.id]);
    assert.equal(savedCanvas.scene.elements[0]!.type, "text");
    assert.equal(savedCanvas.scene.elements[0]!.originalText, answer);
    assert.equal(source.text, answer);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
