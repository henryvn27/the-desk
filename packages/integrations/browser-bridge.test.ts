import assert from "node:assert/strict";
import test from "node:test";
import {
  browserContextForLens,
  parseBrowserBridgeMessage,
} from "./browser-bridge";

const valid = {
  version: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  type: "page-context",
  context: {
    browser: "chrome",
    tabId: "tab-7",
    url: "https://classroom.google.com/c/physics",
    title: "Physics assignment",
    selectionText: "Read pages 12–15",
    visibleText: "Due Friday. Complete the force diagram.",
    capturedAt: "2026-09-06T19:00:00.000Z",
    adapter: "classroom",
  },
} as const;

test("browser bridge validates and formats explicit page evidence", () => {
  const message = parseBrowserBridgeMessage(valid);
  assert.equal(message.context.adapter, "classroom");
  assert.match(browserContextForLens(message), /Selected text:\nRead pages 12–15/);
  assert.match(browserContextForLens(message), /Page URL: https:\/\/classroom.google.com/);
});

test("browser bridge rejects non-web URLs and unknown message fields", () => {
  assert.throws(() =>
    parseBrowserBridgeMessage({
      ...valid,
      extra: "execute this",
    }),
  );
  assert.throws(() =>
    parseBrowserBridgeMessage({
      ...valid,
      context: { ...valid.context, url: "file:///tmp/secret" },
    }),
  );
});

test("browser bridge applies bounded empty-field defaults", () => {
  const message = parseBrowserBridgeMessage({
    ...valid,
    context: {
      ...valid.context,
      selectionText: undefined,
      visibleText: undefined,
      adapter: undefined,
    },
  });
  assert.equal(message.context.selectionText, "");
  assert.equal(message.context.visibleText, "");
  assert.equal(message.context.adapter, "generic");
});
