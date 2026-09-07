import assert from "node:assert/strict";
import { test } from "node:test";
import {
  absoluteSelectionBounds,
  selectionBounds,
  selectionHasContent,
} from "./lens-selection";

test("rough freeform selections receive padding and stay clamped", () => {
  const bounds = selectionBounds({
    paths: [{ points: [{ x: 0.01, y: 0.02 }, { x: 0.99, y: 0.98 }] }],
  });
  assert.ok(bounds);
  assert.equal(bounds.x, 0);
  assert.equal(bounds.y, 0);
  assert.equal(bounds.width, 1);
  assert.equal(bounds.height, 1);
});

test("tiny selections become useful bounded regions", () => {
  const bounds = selectionBounds({ points: [{ x: 0.5, y: 0.5 }] }, 0.02);
  assert.ok(bounds);
  assert.ok(bounds.width >= 0.012);
  assert.ok(bounds.height >= 0.012);
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= 1);
  assert.ok(bounds.y + bounds.height <= 1);
});

test("empty selection is distinguishable from a point", () => {
  assert.equal(selectionHasContent(undefined), false);
  assert.equal(selectionHasContent({ paths: [] }), false);
  assert.equal(selectionHasContent({ points: [{ x: 0.2, y: 0.2 }] }), true);
});

test("selection maps across a multi-monitor virtual desktop", () => {
  const bounds = absoluteSelectionBounds(
    { paths: [{ points: [{ x: 0.45, y: 0.25 }, { x: 0.55, y: 0.75 }] }] },
    { x: -1440, y: 0, width: 3360, height: 1440 },
    0,
  );
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.x - 72) < 1e-9);
  assert.ok(Math.abs(bounds.y - 360) < 1e-9);
  assert.ok(Math.abs(bounds.width - 336) < 1e-9);
  assert.ok(Math.abs(bounds.height - 720) < 1e-9);
});
