import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasScene, type CanvasScene } from "./scene";
import {
  startNotebook,
  addNotebookPage,
  selectNotebookPage,
  replaceNotebookPage,
  activeNotebookPage,
} from "./notebook";

const first = "d10f6c1c-4bdf-4a37-a09a-4b159d021405";
const second = "e357621e-d211-4d40-b42b-b4ab145056de";
const stroke = {
  id: "original-ink",
  type: "freedraw" as const,
  x: 24,
  y: 16,
  width: 100,
  height: 20,
  points: [
    [0, 0],
    [100, 20],
  ],
  customData: { original: true },
};
const scene: CanvasScene = {
  engine: "excalidraw",
  version: 1,
  elements: [stroke],
  files: {},
  viewBackgroundColor: "#ffffff",
  sourceIds: [first],
};

test("starting a notebook preserves original ink and sources without mutating the canvas", () => {
  const book = startNotebook(scene, first);
  assert.deepEqual(activeNotebookPage(book).elements, scene.elements);
  assert.deepEqual(book.sourceIds, scene.sourceIds);
  assert.deepEqual(book.files, scene.files);
  assert.deepEqual(book.elements, []);
  assert.equal(scene.elements.length, 1);
  assert.equal(scene.notebook, undefined);
  assert.throws(() => startNotebook(book, second));
});

test("page addition, selection and edits retain other pages exactly", () => {
  const original = startNotebook(scene, first);
  const added = addNotebookPage(original, second);
  assert.equal(added.notebook?.activePageId, second);
  assert.deepEqual(added.notebook?.pages[0], original.notebook?.pages[0]);
  assert.deepEqual(activeNotebookPage(added).elements, []);
  const edited = replaceNotebookPage(added, second, [
    { ...stroke, id: "second-ink" },
  ]);
  const selected = selectNotebookPage(edited, first);
  assert.deepEqual(activeNotebookPage(selected).elements, [stroke]);
  assert.equal(selected.notebook?.pages[1]?.elements[0]?.id, "second-ink");
  assert.throws(
    () => replaceNotebookPage(selected, second, []),
    /page changed/,
  );
  assert.throws(() =>
    selectNotebookPage(selected, "cf61a2dc-59b0-4730-82cc-63aebc06d8f5"),
  );
});

test("notebook validation rejects ambiguous ownership, duplicate pages and duplicate elements", () => {
  const book = startNotebook(scene, first);
  assert.equal(
    canvasScene.safeParse({ ...book, elements: [stroke] }).success,
    false,
  );
  assert.throws(() => addNotebookPage(book, first));
  const added = addNotebookPage(book, second);
  assert.throws(() => replaceNotebookPage(added, second, [stroke]));
  for (const width of [0, -1, Infinity, 2401]) {
    assert.equal(
      canvasScene.safeParse({
        ...book,
        notebook: {
          ...book.notebook,
          pages: [{ ...book.notebook!.pages[0], width }],
        },
      }).success,
      false,
    );
  }
});

test("notebook limits apply across pages, including the shared scene byte budget", () => {
  const book = startNotebook(scene, first);
  const pages = Array.from({ length: 101 }, (_, i) => ({
    ...book.notebook!.pages[0],
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    elements: [],
  }));
  assert.equal(
    canvasScene.safeParse({
      ...book,
      notebook: { activePageId: pages[0]!.id, pages },
    }).success,
    false,
  );
  const elements = Array.from({ length: 6000 }, (_, i) => ({
    ...stroke,
    id: `ink-${i}`,
  }));
  const tooMany = {
    ...book,
    notebook: {
      activePageId: first,
      pages: [
        { ...book.notebook!.pages[0], elements },
        {
          ...book.notebook!.pages[0],
          id: second,
          elements: elements.map((e) => ({ ...e, id: `other-${e.id}` })),
        },
      ],
    },
  };
  assert.equal(canvasScene.safeParse(tooMany).success, false);
  assert.equal(
    canvasScene.safeParse({
      ...book,
      notebook: {
        ...book.notebook,
        pages: [
          {
            ...book.notebook!.pages[0],
            elements: [
              { ...stroke, originalText: "x".repeat(20 * 1024 * 1024) },
            ],
          },
        ],
      },
    }).success,
    false,
  );
});
