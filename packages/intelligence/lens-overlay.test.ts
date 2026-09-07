import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapLensOverlayMarkToViewport,
} from "./lens-overlay";

test("maps cropped semantic marks back to the selected virtual desktop region", () => {
  const mark = mapLensOverlayMarkToViewport(
    {
      type: "arrow",
      x: 0.1,
      y: 0.2,
      x2: 0.9,
      y2: 0.8,
      text: null,
      sequence: 1,
      durationMs: 2_000,
      confidence: 0.9,
    },
    { x: 0.25, y: 0.1, width: 0.5, height: 0.6 },
  );

  assert.equal(mark.x, 0.3);
  assert.equal(mark.y, 0.22);
  assert.equal(mark.x2, 0.7);
  assert.equal(mark.y2, 0.58);
});
test("preserves point-only marks and clamps mapped coordinates", () => {
  const mark = mapLensOverlayMarkToViewport(
    { type: "point", x: 0.8, y: 0.9, x2: null, y2: null, text: null },
    { x: 0.8, y: 0.8, width: 0.5, height: 0.5 },
  );

  assert.equal(mark.x, 1);
  assert.equal(mark.y, 1);
  assert.equal(mark.x2, null);
  assert.equal(mark.y2, null);
});
