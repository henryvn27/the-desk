import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInstant,
  formatInstantTime,
  formatInstantWithOptions,
  formatDateTimeLocal,
  parseDateTimeLocal,
  resolveTimeZone,
} from "./time-zone";

test("datetime-local uses the persisted profile zone instead of the host zone", () => {
  const instant = "2026-09-08T09:00:00.000Z";
  assert.equal(formatDateTimeLocal(instant, "America/New_York"), "2026-09-08T05:00");
  assert.equal(parseDateTimeLocal("2026-09-08T05:00", "America/New_York"), instant);
  assert.equal(parseDateTimeLocal("2026-09-08T09:00", "UTC"), instant);
});

test("profile-zone round trips remain stable across DST transitions", () => {
  const beforeSpring = "2026-03-08T06:30:00.000Z";
  const afterSpring = "2026-03-08T07:30:00.000Z";
  assert.equal(formatDateTimeLocal(beforeSpring, "America/New_York"), "2026-03-08T01:30");
  assert.equal(formatDateTimeLocal(afterSpring, "America/New_York"), "2026-03-08T03:30");
  assert.equal(parseDateTimeLocal("2026-03-08T01:30", "America/New_York"), beforeSpring);
  assert.equal(parseDateTimeLocal("2026-03-08T03:30", "America/New_York"), afterSpring);
  assert.equal(
    parseDateTimeLocal("2026-11-01T01:30", "America/New_York"),
    "2026-11-01T05:30:00.000Z",
  );
});

test("invalid profile zones use the explicit UTC fallback", () => {
  assert.equal(resolveTimeZone("Not/AZone"), "UTC");
  const instant = "2026-09-08T09:00:00.000Z";
  assert.equal(formatDateTimeLocal(instant, "Not/AZone"), "2026-09-08T09:00");
  assert.equal(parseDateTimeLocal("2026-09-08T09:00", "Not/AZone"), instant);
});

test("datetime-local validation rejects impossible wall clocks", () => {
  assert.throws(() => parseDateTimeLocal("2026-02-30T09:00", "UTC"), /Invalid local date-time/);
});

test("academic display formatting stays in the saved profile zone", () => {
  const instant = "2026-09-08T01:00:00.000Z";
  assert.equal(formatInstant(instant, "America/New_York"), "Mon, Sep 7");
  assert.equal(formatInstantTime(instant, "America/New_York"), "9:00 PM");
  assert.equal(
    formatInstantWithOptions(instant, "America/New_York", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    "Monday, September 7",
  );
  assert.equal(formatInstantTime(instant, "Not/AZone"), "1:00 AM");
});
