import assert from "node:assert/strict";
import test from "node:test";
import {
  adapterForUrl,
  boundedText,
  browserForUserAgent,
  captureDocumentSnapshot,
  MAX_SELECTION_TEXT,
  MAX_VISIBLE_TEXT,
} from "../src/capture";

test("capture snapshot normalizes and bounds selected and visible text", () => {
  const snapshot = captureDocumentSnapshot({
    url: " https://classroom.google.com/c/physics ",
    title: "  Physics\u00a0assignment  ",
    selectionText: "  Read\tpages 12–15\r\n\r\n\r\n  ",
    visibleText: "x".repeat(MAX_VISIBLE_TEXT + 500),
  });

  assert.equal(snapshot.url, "https://classroom.google.com/c/physics");
  assert.equal(snapshot.title, "Physics assignment");
  assert.equal(snapshot.selectionText, "Read pages 12–15");
  assert.equal(snapshot.visibleText.length, MAX_VISIBLE_TEXT);
  assert.equal(boundedText(" y ".repeat(20), 3), "y y");
});

test("adapter hints are limited to supported host families", () => {
  assert.equal(adapterForUrl("https://classroom.google.com/c/1"), "classroom");
  assert.equal(adapterForUrl("https://docs.google.com/document/d/1"), "docs");
  assert.equal(adapterForUrl("https://drive.google.com/file/d/1"), "drive");
  assert.equal(adapterForUrl("https://www.khanacademy.org/math"), "khan");
  assert.equal(adapterForUrl("https://quizlet.com/123"), "quizlet");
  assert.equal(adapterForUrl("https://example.com"), "generic");
  assert.equal(adapterForUrl("not a URL"), "generic");
});

test("browser selection is reported without exposing user-agent data", () => {
  assert.equal(browserForUserAgent("Mozilla/5.0 Chrome/151.0.0.0"), "chrome");
  assert.equal(browserForUserAgent("Mozilla/5.0 Edg/151.0.0.0"), "edge");
});

test("capture limits are aligned with the bridge contract", () => {
  assert.equal(MAX_SELECTION_TEXT, 20_000);
  assert.equal(MAX_VISIBLE_TEXT, 40_000);
});
