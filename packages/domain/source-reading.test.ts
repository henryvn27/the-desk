import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canvasScene } from "../canvas/scene";
import { DeskStore } from "./store";

test("source annotations survive into Notes with exact backlinks and searchable anchors", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-source-reading-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    let snapshot = store.execute({ type: "class.create", name: "Physics" });
    const classId = snapshot.classes[0]!.id;
    snapshot = store.execute({
      type: "task.create",
      input: {
        title: "Kinematics lecture",
        classId,
        dueAt: null,
        minutes: 45,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
    const taskId = snapshot.tasks[0]!.id;
    snapshot = store.execute({
      type: "source.create",
      input: {
        title: "Teacher handout",
        text: "Acceleration is the change in velocity over time.",
        classIds: [classId],
        taskIds: [taskId],
        format: "pdf",
        sourceUrl: "https://example.com/handout.pdf",
      },
    });
    const source = snapshot.sources[0]!;
    snapshot = store.execute({
      type: "source.annotate",
      sourceId: source.id,
      input: {
        sourceRevision: source.revision ?? 0,
        text: "change in velocity",
        comment: "The definition to use in the lab report.",
        location: { page: 2, startOffset: 17, endOffset: 36 },
      },
    });
    const annotation = snapshot.sources[0]!.annotations![0]!;
    snapshot = store.execute({ type: "canvas.create", taskId });
    const canvasMeta = snapshot.canvases[0]!;
    const blockId = "source-block";
    const scene = canvasScene.parse({
      engine: "excalidraw",
      version: 1,
      elements: [],
      files: {},
      viewBackgroundColor: "#ffffff",
      sourceIds: [source.id],
      document: {
        version: 1,
        blocks: [{
          id: blockId,
          type: "paragraph",
          text: annotation.text,
          provenance: [{
            sourceId: source.id,
            sourceRevision: annotation.sourceRevision,
            excerpt: annotation.text,
            location: annotation.location,
            annotationId: annotation.id,
          }],
        }],
      },
    });
    snapshot = store.execute({
      type: "canvas.save",
      id: canvasMeta.id,
      revision: canvasMeta.revision,
      scene,
    });
    const linked = snapshot.sources[0]!.annotations![0]!;
    assert.deepEqual(linked.noteRefs, [{ canvasId: canvasMeta.id, blockId }]);
    const hit = store.search("lab report").find((result) => result.kind === "annotation");
    assert.equal(hit?.sourceId, source.id);
    assert.equal(hit?.annotationId, annotation.id);
    assert.deepEqual(hit?.location, annotation.location);

    snapshot = store.execute({
      type: "source.update",
      id: source.id,
      revision: source.revision ?? 0,
      input: {
        title: source.title,
        text: `${source.text}\nNew revision note.`,
        classIds: [classId],
        taskIds: [taskId],
        format: source.format,
        sourceUrl: source.sourceUrl,
      },
    });
    assert.equal(snapshot.sources[0]!.revision, 1);
    assert.equal(snapshot.sources[0]!.annotations![0]!.sourceRevision, 0);
    assert.equal(snapshot.sources[0]!.revisionHistory![0]!.revision, 0);
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().sources[0]!.annotations![0]!.noteRefs[0]!.blockId, blockId);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
