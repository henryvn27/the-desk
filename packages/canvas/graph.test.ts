import assert from "node:assert/strict";
import test from "node:test";
import { graphPath, intersections, panViewport, roots, sampleGraph, zoomViewport } from "./graph";

const viewport = { xMin: -2, xMax: 2, yMin: -2, yMax: 2 };

test("graph sampling and roots are deterministic for a linked expression", () => {
  const points = sampleGraph("x^2 - 1", viewport, 32);
  assert.equal(points.length, 32);
  assert.ok(points.some((point) => point && Math.abs(point.y) < 0.2));
  assert.deepEqual(roots("x^2 - 1", viewport).map((value) => Math.round(value)), [-1, 1]);
  assert.match(graphPath(points, viewport, 400, 240), /^M/);
});

test("linked graph helpers keep viewport changes and intersections deterministic", () => {
  assert.deepEqual(roots("x^2 - 1", viewport).map((value) => Math.round(value)), [-1, 1]);
  assert.deepEqual(intersections("x", "-x", viewport).map((point) => [Math.round(point.x), Math.round(point.y)]), [[0, 0]]);
  assert.deepEqual(panViewport(viewport, 1, -2), { xMin: -1, xMax: 3, yMin: -4, yMax: 0 });
  assert.deepEqual(zoomViewport(viewport, 0.5), { xMin: -1, xMax: 1, yMin: -1, yMax: 1 });
});
