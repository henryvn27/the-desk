import assert from "node:assert/strict";
import { DeskStore } from "../domain/store";
import type { Class, Task } from "../domain/contracts";
import { decideCapture } from "./capture-policy";
import {
  interpretCapture,
  type CaptureObjectType,
} from "./capture";

export type CaptureEvaluationObjectType = CaptureObjectType;

export type CaptureEvaluationCase = {
  id: string;
  modality: string;
  sourceName?: string;
  contextClassName?: string;
  text: string;
  expected: {
    objectType: CaptureEvaluationObjectType;
    className: string | null;
    dueDate: string | null;
    shouldAutoFile: boolean;
  };
};

export const captureEvaluationCorpus: CaptureEvaluationCase[] = [
  {
    id: "typed-assignment",
    modality: "typed assignment",
    text: "AP Physics C: Problem Set 4 due 2026-09-08T22:00:00Z, 45 minutes",
    expected: { objectType: "assignment", className: "AP Physics C", dueDate: "2026-09-08", shouldAutoFile: true },
  },
  {
    id: "syllabus-pdf",
    modality: "syllabus PDF",
    sourceName: "physics-syllabus.pdf",
    text: "AP Physics C Syllabus\nUnits: Mechanics, Electricity\nTests are announced in class. Office hours Thursday.",
    expected: { objectType: "syllabus", className: "AP Physics C", dueDate: null, shouldAutoFile: false },
  },
  {
    id: "worksheet-pdf",
    modality: "worksheet PDF",
    sourceName: "forces-worksheet.pdf",
    text: "AP Physics C Worksheet: Forces practice problems 1–20. Submit by 2026-09-12T22:00:00Z, 60 minutes.",
    expected: { objectType: "worksheet", className: "AP Physics C", dueDate: "2026-09-12", shouldAutoFile: false },
  },
  {
    id: "bad-phone-photo",
    modality: "bad phone photo",
    sourceName: "IMG_1042.jpg",
    text: "[photo OCR uncertain] AP Physics C handwritten problem set due ??? glare shadow",
    expected: { objectType: "handwritten-note", className: "AP Physics C", dueDate: null, shouldAutoFile: false },
  },
  {
    id: "whiteboard",
    modality: "whiteboard",
    sourceName: "whiteboard.jpg",
    contextClassName: "AP Physics C",
    text: "[whiteboard capture] Newton's laws and free body diagrams; erase after class",
    expected: { objectType: "handwritten-note", className: "AP Physics C", dueDate: null, shouldAutoFile: false },
  },
  {
    id: "handwritten-notes",
    modality: "handwritten notes",
    sourceName: "notebook-page.png",
    text: "[handwriting] AP Physics C class notes: friction, normal force, μk",
    expected: { objectType: "handwritten-note", className: "AP Physics C", dueDate: null, shouldAutoFile: false },
  },
  {
    id: "screenshot",
    modality: "screenshot",
    sourceName: "Screenshot 2026-09-07.png",
    text: "Google Classroom · AP Physics C\nProblem Set 4\nDue Sep 8 at 10:00 PM",
    expected: { objectType: "assignment", className: "AP Physics C", dueDate: "2026-09-08", shouldAutoFile: false },
  },
  {
    id: "timetable",
    modality: "timetable",
    sourceName: "fall-timetable.pdf",
    text: "Fall timetable\nPeriod 2 · AP Physics C · Room 204 · Monday 9:00",
    expected: { objectType: "timetable", className: "AP Physics C", dueDate: null, shouldAutoFile: false },
  },
  {
    id: "graded-test",
    modality: "graded test",
    sourceName: "unit-2-test.jpg",
    text: "AP Physics C Unit 2 Test\nScore 42/50\nTeacher marks: show your free-body diagram; question 4 incorrect",
    expected: { objectType: "graded-assessment", className: "AP Physics C", dueDate: null, shouldAutoFile: false },
  },
  {
    id: "teacher-email",
    modality: "teacher email",
    sourceName: "teacher-email.txt",
    text: "From Dr. Rivera\nAP Physics C\nPlease submit the lab report by 2026-09-14T22:00:00Z, about 90 minutes.",
    expected: { objectType: "teacher-message", className: "AP Physics C", dueDate: "2026-09-14", shouldAutoFile: false },
  },
  {
    id: "website",
    modality: "website",
    sourceName: "web-capture.txt",
    text: "Course resources · AP Physics C\nRead the external explanation at https://example.edu/forces",
    expected: { objectType: "web-page", className: "AP Physics C", dueDate: null, shouldAutoFile: false },
  },
  {
    id: "google-classroom",
    modality: "Google Classroom page",
    sourceName: "classroom-page.txt",
    text: "Google Classroom · AP Physics C\nAssignment: Lab report\nDue 2026-09-14T22:00:00Z",
    expected: { objectType: "assignment", className: "AP Physics C", dueDate: "2026-09-14", shouldAutoFile: false },
  },
  {
    id: "spoken-assignment",
    modality: "spoken assignment transcript",
    text: "Hey, for AP Physics C, finish the momentum problems and turn them in Friday at 10 PM, about 30 minutes.",
    expected: { objectType: "assignment", className: "AP Physics C", dueDate: "2026-09-11", shouldAutoFile: false },
  },
  {
    id: "ambiguous-image",
    modality: "ambiguous random image",
    sourceName: "IMG_9999.jpg",
    text: "[image OCR uncertain] 7 3 ? blue mark maybe page 2",
    expected: { objectType: "unknown", className: null, dueDate: null, shouldAutoFile: false },
  },
  {
    id: "duplicate-assignment",
    modality: "duplicate worksheet PDF",
    sourceName: "forces-worksheet-copy.pdf",
    text: "AP Physics C Worksheet: Forces practice problems 1–20. Submit by 2026-09-12T22:00:00Z, 60 minutes.",
    expected: { objectType: "worksheet", className: "AP Physics C", dueDate: "2026-09-12", shouldAutoFile: false },
  },
];

const confidenceProbability: Record<string, number> = {
  high: 0.95,
  medium: 0.65,
  low: 0.25,
};

function fallbackObjectType(draft: unknown): CaptureEvaluationObjectType {
  const type = (draft as { objectType?: unknown }).objectType;
  return typeof type === "string" && type.length > 0
    ? (type as CaptureEvaluationObjectType)
    : "assignment";
}

function expectedFieldCorrect(caseItem: CaptureEvaluationCase, draft: ReturnType<typeof interpretCapture>[number], objectType: CaptureEvaluationObjectType) {
  return {
    objectType: objectType === caseItem.expected.objectType,
    classId: caseItem.expected.className === null
      ? draft.classId === null
      : Boolean(draft.classId),
    deadline: caseItem.expected.dueDate === null
      ? draft.deadline === null || draft.deadline.date === null
      : draft.deadline?.date === caseItem.expected.dueDate,
  };
}

export function evaluateCaptureCorpus({
  classes,
  now,
  timeZone,
  baseline = false,
}: {
  classes: Class[];
  now: Date;
  timeZone: string;
  baseline?: boolean;
}) {
  const tasks: Task[] = [];
  const cases = captureEvaluationCorpus.map((caseItem) => {
    if (caseItem.id === "duplicate-assignment") {
      const reference = captureEvaluationCorpus.find(
        (candidate) => candidate.id === "worksheet-pdf",
      );
      if (reference) {
        tasks.push({
          id: "00000000-0000-4000-8000-000000000099",
          title: "Forces worksheet",
          classId: classes[0]!.id,
          dueAt: null,
          minutes: 60,
          resource: null,
          notes: "",
          completed: false,
          revision: 0,
          createdAt: now.toISOString(),
          workKind: "assignment",
          importance: "normal",
          deadlineConfirmed: true,
          captureEvidence: {
            source: "text-file",
            sourceName: reference.sourceName,
            originalText: reference.text,
            sourceText: reference.text,
            capturedAt: now.toISOString(),
            authority: "user-provided-text",
            confidence: {},
            candidateDates: [reference.expected.dueDate!],
            uncertainties: [],
          },
        } as Task);
      }
    }
    const started = performance.now();
    const [draft] = interpretCapture(caseItem.text, {
      classes,
      now,
      timeZone,
      sourceName: caseItem.sourceName,
      ...(caseItem.contextClassName && !baseline
        ? {
            contextClassId: classes.find(
              (item) => item.name === caseItem.contextClassName,
            )?.id,
          }
        : {}),
    });
    const parseMs = performance.now() - started;
    assert.ok(draft, `Corpus case ${caseItem.id} produced no draft`);
    const objectType = baseline ? "assignment" : fallbackObjectType(draft);
    const decision = decideCapture(draft, "balanced", tasks, now);
    if (decision.action === "auto-file") {
      tasks.push({
        ...decision.input,
        id: `synthetic-${caseItem.id}`,
        completed: false,
        revision: 0,
        createdAt: now.toISOString(),
      } as Task);
    }
    const correct = expectedFieldCorrect(caseItem, draft, objectType);
    const confidence = {
      objectType: baseline ? 0.5 : confidenceProbability[draft.confidence.objectType ?? "low"]!,
      classId: confidenceProbability[draft.confidence.classId]!,
      deadline: confidenceProbability[draft.confidence.deadline]!,
    };
    const brier = Object.entries(correct).reduce((sum, [field, value]) => {
      const probability = confidence[field as keyof typeof confidence];
      return sum + (probability - (value ? 1 : 0)) ** 2;
    }, 0) / Object.keys(correct).length;
    return {
      id: caseItem.id,
      modality: caseItem.modality,
      objectType,
      expectedObjectType: caseItem.expected.objectType,
      className: caseItem.expected.className,
      predictedClass: classes.find((item) => item.id === draft.classId)?.name ?? null,
      predictedDueDate: draft.deadline?.date ?? null,
      expectedDueDate: caseItem.expected.dueDate,
      action: decision.action,
      expectedAction: caseItem.expected.shouldAutoFile ? "auto-file" : "review",
      uncertainties: draft.uncertainties.length,
      parseMs: Number(parseMs.toFixed(3)),
      brier: Number(brier.toFixed(4)),
      originalTextLength: draft.provenance.originalText.length,
      duplicateDetected: decision.reason.toLocaleLowerCase().includes("already exists") || decision.reason.toLocaleLowerCase().includes("same captured"),
    };
  });
  const accuracy = (field: "objectType" | "className" | "dueDate") => {
    const correct = cases.filter((item) =>
      field === "objectType"
        ? item.objectType === item.expectedObjectType
        : field === "className"
          ? item.predictedClass === item.className
          : item.predictedDueDate === item.expectedDueDate,
    ).length;
    return Number((correct / cases.length).toFixed(4));
  };
  return {
    corpusSize: cases.length,
    cases,
    metrics: {
      objectTypeAccuracy: accuracy("objectType"),
      classRoutingAccuracy: accuracy("className"),
      dueDateAccuracy: accuracy("dueDate"),
      autoFilePrecision: (() => {
        const auto = cases.filter((item) => item.action === "auto-file");
        return Number((auto.filter((item) => item.expectedAction === "auto-file").length / Math.max(auto.length, 1)).toFixed(4));
      })(),
      reviewRate: Number((cases.filter((item) => item.action === "review").length / cases.length).toFixed(4)),
      meanParseMs: Number((cases.reduce((sum, item) => sum + item.parseMs, 0) / cases.length).toFixed(3)),
      meanBrier: Number((cases.reduce((sum, item) => sum + item.brier, 0) / cases.length).toFixed(4)),
      duplicateDetected: cases.find((item) => item.id === "duplicate-assignment")?.duplicateDetected ?? false,
      originalTextRecovered: cases.every((item) => item.originalTextLength > 0),
    },
  };
}

export function evaluateDurableCapture({
  classes,
  now,
  timeZone,
}: {
  classes: Class[];
  now: Date;
  timeZone: string;
}) {
  const singleCaptureMs = (() => {
    const latencyStore = new DeskStore(":memory:");
    try {
      for (const item of classes)
        latencyStore.execute({ type: "class.create", name: item.name }, now);
      const started = performance.now();
      latencyStore.execute(
        {
          type: "inbox.capture",
          text: captureEvaluationCorpus[0]!.text,
          timeZone,
        },
        now,
      );
      return Number((performance.now() - started).toFixed(3));
    } finally {
      latencyStore.close();
    }
  })();
  const store = new DeskStore(":memory:");
  try {
    for (const item of classes) store.execute({ type: "class.create", name: item.name }, now);
    const started = performance.now();
    for (let index = 0; index < captureEvaluationCorpus.length; index += 10) {
      store.execute({
        type: "inbox.import",
        timeZone,
        files: captureEvaluationCorpus.slice(index, index + 10).map((item) => ({
          name: item.sourceName ?? `${item.id}.txt`,
          text: item.text,
        })),
      }, now);
    }
    const state = store.snapshot();
    return {
      singleCaptureMs,
      storeMs: Number((performance.now() - started).toFixed(3)),
      inboxItems: state.captureInbox.length,
      originalTextRecovered: state.captureInbox.every((item) => item.draft.provenance.originalText.length > 0),
      taskCount: state.tasks.length,
    };
  } finally {
    store.close();
  }
}
