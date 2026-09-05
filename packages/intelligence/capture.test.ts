import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretCapture } from "./capture";
import type { Class } from "../domain/contracts";

const classes: Class[] = [
  { id: "physics", name: "AP Physics C", color: "#123456" },
  { id: "english", name: "English 12", color: "#654321" },
  { id: "stats", name: "AP Statistics", color: "#abcdef" },
];
const context = {
  classes,
  now: new Date("2026-09-05T23:30:00Z"),
  timeZone: "America/New_York",
};

test("vague weekday becomes a timezone-anchored candidate requiring confirmation", () => {
  const [draft] = interpretCapture(
    "AP Physics C test Tuesday, about 45 minutes",
    context,
  );
  assert.equal(draft!.deadline?.date, "2026-09-08");
  assert.equal(draft!.deadline?.time, null);
  assert.equal(draft!.deadline?.requiresConfirmation, true);
  assert.match(
    draft!.uncertainties.find((item) => item.field === "deadline")!.message,
    /Confirm.*Tuesday.*2026-09-08/,
  );
});

test("explicit ISO date stays date-only and does not invent a deadline time", () => {
  const [draft] = interpretCapture(
    "English 12 essay due 2026-09-11, 2 hours",
    context,
  );
  assert.deepEqual(draft!.deadline, {
    date: "2026-09-11",
    time: null,
    instant: null,
    timeZone: "America/New_York",
    candidates: ["2026-09-11"],
    sourceText: ["2026-09-11"],
    requiresConfirmation: false,
  });
  assert.equal(draft!.minutes, 120);
  assert.equal(draft!.title, "English 12 essay");
});

test("an explicit ISO timestamp preserves its stated time, offset, and instant", () => {
  const [draft] = interpretCapture(
    "AP Statistics quiz due 2026-09-09T23:59:00-0400, 30 min",
    context,
  );
  assert.equal(draft!.deadline?.date, "2026-09-09");
  assert.equal(draft!.deadline?.time, "23:59");
  assert.equal(draft!.deadline?.timeZone, "-04:00");
  assert.equal(draft!.deadline?.instant, "2026-09-10T03:59:00.000Z");
  assert.equal(draft!.title, "AP Statistics quiz");
});

test("conflicting dates are surfaced instead of silently selecting one", () => {
  const [draft] = interpretCapture(
    "English essay due 2026-09-10; teacher update says 2026-09-11",
    context,
  );
  assert.equal(draft!.deadline?.date, null);
  assert.deepEqual(draft!.deadline?.candidates, ["2026-09-10", "2026-09-11"]);
  assert.equal(draft!.deadline?.requiresConfirmation, true);
  assert.match(
    draft!.uncertainties.find((item) => item.field === "deadline")!.message,
    /conflicting dates/i,
  );
});

test("class matching prefers a full class name and reports an unknown class", () => {
  const [matched] = interpretCapture(
    "AP Statistics chapter 2 problems due 2026-09-09, 30 min",
    context,
  );
  assert.equal(matched!.classId, "stats");
  assert.equal(matched!.confidence.classId, "high");

  const [unknown] = interpretCapture("Biology lab due tomorrow", context);
  assert.equal(unknown!.classId, null);
  assert.match(
    unknown!.uncertainties.find((item) => item.field === "classId")!.message,
    /don't know/,
  );
});

test("clear list lines produce separate assignment drafts", () => {
  const input = [
    "- AP Physics C problem set due Tuesday, 45 min",
    "- English 12 essay due 2026-09-11, 2 hours",
  ].join("\n");
  const drafts = interpretCapture(input, context);
  assert.equal(drafts.length, 2);
  assert.deepEqual(
    drafts.map((draft) => [draft.classId, draft.title, draft.minutes]),
    [
      ["physics", "AP Physics C problem set", 45],
      ["english", "English 12 essay", 120],
    ],
  );
  assert.deepEqual(
    drafts.map((draft) => draft.provenance.lineNumber),
    [1, 2],
  );
});

test("only valid HTTPS resources are retained", () => {
  const [draft] = interpretCapture(
    "AP Physics C worksheet 30 min https://school.example/a.pdf http://unsafe.example/a.pdf",
    context,
  );
  assert.deepEqual(draft!.resources, ["https://school.example/a.pdf"]);
  assert.match(
    draft!.uncertainties.find((item) => item.field === "resources")!.message,
    /non-HTTPS/,
  );
});

test("unknown fields stay unknown and the exact original paste is preserved", () => {
  const input = "  Finish the review packet when I can.  ";
  const [draft] = interpretCapture(input, context);
  assert.equal(draft!.classId, null);
  assert.equal(draft!.deadline, null);
  assert.equal(draft!.minutes, null);
  assert.equal(draft!.provenance.originalText, input);
  assert.deepEqual(draft!.uncertainties.map((item) => item.field).sort(), [
    "classId",
    "deadline",
    "minutes",
  ]);
});
