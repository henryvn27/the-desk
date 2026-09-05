import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasScene } from "./scene";

const stroke = {
  id: "stroke-1",
  type: "freedraw",
  x: 42,
  y: 27,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "hachure",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  width: 36,
  height: 18,
  angle: 0,
  seed: 12345,
  version: 3,
  versionNonce: 67890,
  index: "a0",
  isDeleted: false,
  groupIds: [],
  frameId: null,
  boundElements: null,
  updated: 1_788_648_000_000,
  link: null,
  locked: false,
  points: [
    [0, 0],
    [12, 8],
    [36, 18],
  ],
  pressures: [0.2, 0.6, 0.4],
  simulatePressure: false,
  lastCommittedPoint: [36, 18],
  customData: { source: "pencil", preserved: true },
};

const image = {
  id: "image-1",
  type: "image",
  x: 120,
  y: 80,
  strokeColor: "transparent",
  backgroundColor: "transparent",
  fillStyle: "hachure",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  width: 320,
  height: 180,
  angle: 0,
  seed: 9876,
  version: 1,
  versionNonce: 54321,
  index: "a1",
  isDeleted: false,
  groupIds: [],
  frameId: null,
  boundElements: null,
  updated: 1_788_648_000_000,
  link: null,
  locked: false,
  fileId: "file-1",
  status: "saved",
  scale: [1, 1],
  crop: null,
};

const scene = {
  engine: "excalidraw",
  version: 1,
  elements: [stroke, image],
  files: {
    "file-1": {
      id: "file-1",
      mimeType: "image/png",
      dataURL: "data:image/png;base64,iVBORw0KGgo=",
      created: 1_788_648_000_000,
      lastRetrieved: 1_788_648_100_000,
      version: 2,
    },
  },
  viewBackgroundColor: "#ffffff",
} as const;

test("accepts and exactly preserves an Excalidraw stroke and image scene", () => {
  assert.deepEqual(canvasScene.parse(scene), scene);
});

test("rejects malformed elements and unsafe or transient element types", () => {
  assert.equal(
    canvasScene.safeParse({
      ...scene,
      elements: [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
    }).success,
    false,
  );

  for (const type of ["iframe", "embeddable", "magicframe", "selection"]) {
    assert.equal(
      canvasScene.safeParse({
        ...scene,
        elements: [
          { id: `${type}-1`, type, x: 0, y: 0, width: 10, height: 10 },
        ],
      }).success,
      false,
      `${type} should be rejected`,
    );
  }
});

test("rejects missing or non-finite base geometry", () => {
  for (const malformed of [
    { ...image, x: Number.POSITIVE_INFINITY },
    { ...image, y: Number.NaN },
    { ...image, width: "wide" },
    { ...image, height: null },
  ]) {
    assert.equal(
      canvasScene.safeParse({ ...scene, elements: [malformed] }).success,
      false,
    );
  }
});

test("rejects malformed image files", () => {
  for (const file of [
    {
      ...scene.files["file-1"],
      mimeType: "image/svg+xml",
      dataURL: "data:image/svg+xml;base64,PHN2Zz4=",
    },
    {
      ...scene.files["file-1"],
      dataURL: "data:image/jpeg;base64,iVBORw0KGgo=",
    },
    {
      ...scene.files["file-1"],
      dataURL: "data:image/png;base64,notbase64",
    },
    {
      ...scene.files["file-1"],
      id: "different-file-id",
    },
  ]) {
    assert.equal(
      canvasScene.safeParse({ ...scene, files: { "file-1": file } }).success,
      false,
    );
  }
});

test("bounds element count and the serialized scene to 20 MB", () => {
  assert.equal(
    canvasScene.safeParse({
      ...scene,
      elements: Array.from({ length: 10_001 }, (_, index) => ({
        id: `element-${index}`,
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      })),
    }).success,
    false,
  );

  assert.equal(
    canvasScene.safeParse({
      ...scene,
      viewBackgroundColor: "x".repeat(20 * 1024 * 1024),
    }).success,
    false,
  );
});
