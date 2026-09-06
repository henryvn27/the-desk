import assert from "node:assert/strict";
import test from "node:test";
import { studyBlocksToIcs } from "./calendar";

const task = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Forces, friction; review",
  classId: "00000000-0000-4000-8000-000000000002",
  dueAt: null,
  minutes: 30,
  resource: "https://school.example/forces",
  notes: "Bring graph\nand corrections.",
  deadlineConfirmed: true,
  completed: false,
  createdAt: "2026-09-06T10:00:00.000Z",
};
const block = {
  id: "00000000-0000-4000-8000-000000000003",
  taskId: task.id,
  start: "2026-09-07T18:00:00.000Z",
  end: "2026-09-07T18:30:00.000Z",
  minutes: 30,
  why: "Deadline; keep a buffer",
  locked: false,
  revision: 1,
  createdAt: "2026-09-06T10:00:00.000Z",
  updatedAt: "2026-09-06T10:05:00.000Z",
};

test("calendar export contains explicit saved blocks and escaped text", () => {
  const ics = studyBlocksToIcs(
    [block],
    [task],
    [{ id: task.classId, name: "AP Physics", color: "#50705A" }],
  );
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:Forces\\, friction\\; review · AP Physics\r\n/);
  assert.match(ics, /DESCRIPTION:Deadline\\; keep a buffer\\n\\nBring graph\\nand corrections\./);
  assert.match(ics, /DTSTART:20260907T180000Z\r\nDTEND:20260907T183000Z/);
  assert.match(ics, /URL:https:\/\/school\.example\/forces/);
  assert.match(ics, /X-THE-DESK-BLOCK-ID:/);
});

test("calendar export excludes cancelled or orphaned blocks", () => {
  const ics = studyBlocksToIcs(
    [
      { ...block, cancelledAt: "2026-09-06T11:00:00.000Z" },
      { ...block, id: "00000000-0000-4000-8000-000000000004", taskId: "00000000-0000-4000-8000-000000000005" },
    ],
    [task],
    [],
  );
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test("calendar export rejects invalid block dates", () => {
  assert.throws(() => studyBlocksToIcs([{ ...block, start: "bad" }], [task], []), /invalid date/i);
});
