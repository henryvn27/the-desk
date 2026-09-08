import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldAllowDeskMediaPermission } from "./permission-policy";

const allowed = {
  permission: "media",
  trustedWindow: true,
  isMainFrame: true,
  requestingUrl: "desk://app/index.html#main",
  securityOrigin: "desk://app",
  mediaTypes: ["audio"],
} as const;

test("allows audio only for a trusted Desk main frame", () => {
  assert.equal(shouldAllowDeskMediaPermission(allowed), true);
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, requestingUrl: "desk://app" }), true);
});

test("denies camera, mixed media, and unknown media requests", () => {
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, mediaTypes: ["video"] }), false);
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, mediaTypes: ["audio", "video"] }), false);
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, mediaTypes: undefined }), false);
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, permission: "display-capture" }), false);
});

test("denies untrusted windows, subframes, and non-Desk origins", () => {
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, trustedWindow: false }), false);
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, isMainFrame: false }), false);
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, requestingUrl: "https://example.com/" }), false);
  assert.equal(shouldAllowDeskMediaPermission({ ...allowed, securityOrigin: "https://example.com" }), false);
});
