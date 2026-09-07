import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceAnchorLabel, sourceExcerpt, sourceSearch, sourceSections } from "./reader";

test("source sections preserve exact offsets and expose a useful outline", () => {
  const text = "# Motion\n\n1. Acceleration\nF = ma\n";
  const sections = sourceSections(text);
  assert.equal(sections[0]!.text, "# Motion");
  assert.equal(text.slice(sections[1]!.startOffset, sections[1]!.endOffset), "1. Acceleration");
  assert.equal(sections[1]!.level, 1);
  assert.equal(sections[2]!.text, "F = ma");
});

test("source search returns bounded exact offsets and excerpts", () => {
  const text = "alpha beta\nBeta gamma\nbeta";
  const matches = sourceSearch(text, "beta");
  assert.deepEqual(matches.map((match) => [match.startOffset, match.endOffset]), [[6, 10], [11, 15], [22, 26]]);
  assert.equal(sourceExcerpt(text, matches[1]!.startOffset, matches[1]!.endOffset), "Beta");
  assert.equal(sourceSearch(text, "").length, 0);
});

test("source anchors prefer explicit page, time and offset labels", () => {
  assert.equal(sourceAnchorLabel({ page: 12 }), "Page 12");
  assert.equal(sourceAnchorLabel({ startMs: 65_000 }), "1:05");
  assert.equal(sourceAnchorLabel({ startOffset: 40 }), "Character 40");
});
