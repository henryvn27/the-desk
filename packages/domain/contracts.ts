import type { DurationObservation } from "../learning/duration";
import { sourceKind } from "../intelligence/source-kind";
import {
  authorityConfidence,
  authorityFact,
  authorityKind,
} from "../intelligence/authority";
import { tutoringMode, type TutoringMode } from "../intelligence/tutoring";
import type { CaptureDraft } from "../intelligence/capture";
import type { LensInput, LensResponse } from "../intelligence/lens-provider";
import { z } from "zod";
import { canvasScene, type CanvasScene } from "../canvas/scene";
export type CanvasRecord = {
  id: string;
  taskId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  scene: CanvasScene;
};
const id = z.string().uuid();
export const sourceInput = z.object({
  kind: sourceKind.optional(),
  title: z.string().trim().min(1).max(500),
  text: z.string().min(1).max(200000),
  classIds: z.array(id).max(100),
  taskIds: z.array(id).max(500),
});
export type SourceInput = z.infer<typeof sourceInput>;
export type Source = SourceInput & {
  revision?: number;
  id: string;
  createdAt: string;
  authority: "user-provided-text";
};
export const gradeCategoryInput = z.object({
  classId: id,
  name: z.string().trim().min(1).max(100),
  weight: z.number().min(0.01).max(100),
});
export type GradeCategory = z.infer<typeof gradeCategoryInput> & {
  id: string;
  revision: number;
};
export const gradeEntryInput = z
  .object({
    categoryId: id,
    title: z.string().trim().min(1).max(300),
    earned: z.number().min(0).max(1000000),
    possible: z.number().positive().max(1000000),
  })
  .refine(
    (v) => v.earned <= v.possible,
    "Earned points cannot exceed possible points in this grade model.",
  );
export type GradeEntry = z.infer<typeof gradeEntryInput> & {
  id: string;
  revision: number;
  recordedAt: string;
  updatedAt: string;
  authority: "user-entered";
};
export const assessmentKind = z.enum([
  "quiz",
  "test",
  "exam",
  "final",
  "midterm",
  "project",
  "essay",
  "lab",
  "presentation",
  "standardized-test",
  "other",
]);
export const assessmentInput = z.object({
  classId: id,
  title: z.string().trim().min(1).max(500),
  kind: assessmentKind,
  taskIds: z.array(id).max(100),
  dueAt: z.iso.datetime().nullable(),
  gradeCategoryId: id.nullable(),
  notes: z.string().trim().max(5000),
});
export type AssessmentInput = z.infer<typeof assessmentInput>;
export type Assessment = AssessmentInput & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export const academicPeriodKind = z.enum([
  "semester",
  "trimester",
  "quarter",
  "year",
  "summer",
  "other",
]);
export const academicPeriodInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: academicPeriodKind,
    startsOn: z.iso.date().nullable(),
    endsOn: z.iso.date().nullable(),
    notes: z.string().trim().max(5000),
    classIds: z.array(id).max(100),
  })
  .superRefine((input, ctx) => {
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn)
      ctx.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "The academic period must end on or after it starts.",
      });
  });
export type AcademicPeriodInput = z.infer<typeof academicPeriodInput>;
export type AcademicPeriod = AcademicPeriodInput & {
  id: string;
  revision: number;
  authority: "user-entered";
  createdAt: string;
  updatedAt: string;
};
export const spaceKind = z.enum(["school", "program", "workspace", "other"]);
export const spaceInput = z.object({
  name: z.string().trim().min(1).max(200),
  kind: spaceKind,
  notes: z.string().trim().max(5000),
  classIds: z.array(id).max(100),
});
export type SpaceInput = z.infer<typeof spaceInput>;
export type Space = SpaceInput & {
  id: string;
  revision: number;
  authority: "user-entered";
  createdAt: string;
  updatedAt: string;
};
export const trackInput = z.object({
  classId: id,
  name: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(5000),
});
export type TrackInput = z.infer<typeof trackInput>;
export type Track = TrackInput & {
  id: string;
  revision: number;
  authority: "user-entered";
  createdAt: string;
  updatedAt: string;
};
export const unitInput = z.object({
  classId: id,
  trackId: id.nullable(),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["unit", "module"]),
  sequence: z.number().int().min(0).max(10000),
  notes: z.string().trim().max(5000),
  taskIds: z.array(id).max(100),
});
export type UnitInput = z.infer<typeof unitInput>;
export type Unit = UnitInput & {
  id: string;
  revision: number;
  authority: "user-entered";
  createdAt: string;
  updatedAt: string;
};
export const teacherInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(500).nullable(),
  notes: z.string().trim().max(5000),
  classIds: z.array(id).min(1).max(100),
});
export type TeacherInput = z.infer<typeof teacherInput>;
export type Teacher = TeacherInput & {
  id: string;
  revision: number;
  authority: "user-entered";
  createdAt: string;
  updatedAt: string;
};
export const evidenceKind = z.enum([
  "graded-work",
  "teacher-feedback",
  "rubric",
  "other",
]);
export const evidenceSource = z.enum(["manual", "text-import", "image-import"]);
export const teacherEvidenceInput = z
  .object({
    classId: id,
    teacherId: id.nullable().optional(),
    assessmentId: id.nullable(),
    taskId: id.nullable(),
    title: z.string().trim().min(1).max(500),
    kind: evidenceKind,
    source: evidenceSource,
    scoreEarned: z.number().min(0).max(1000000).nullable(),
    scorePossible: z.number().positive().max(1000000).nullable(),
    teacherComments: z.string().trim().max(10000),
    rubric: z.string().trim().max(10000),
    observations: z.string().trim().max(10000),
    conceptIds: z.array(id).max(100),
    includeInTeacherModeling: z.boolean(),
    capturedAt: z.iso.datetime(),
  })
  .superRefine((input, ctx) => {
    if (
      (input.scoreEarned === null) !== (input.scorePossible === null) ||
      (input.scoreEarned !== null &&
        input.scorePossible !== null &&
        input.scoreEarned > input.scorePossible)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["scoreEarned"],
        message:
          "Enter both score values with earned points no greater than possible points.",
      });
    }
  });
export type TeacherEvidenceInput = z.infer<typeof teacherEvidenceInput>;
export type TeacherEvidence = TeacherEvidenceInput & {
  id: string;
  revision: number;
  authority: "teacher-reported";
  createdAt: string;
  updatedAt: string;
};
export const authorityClaimInput = z.object({
  classId: id,
  taskId: id,
  fact: authorityFact,
  value: z.iso.datetime().nullable(),
  authorityKind,
  confidence: authorityConfidence,
  sourceLabel: z.string().trim().min(1).max(500),
  details: z.string().trim().max(10000),
  sourceId: id.nullable(),
  evidenceId: id.nullable(),
  capturedAt: z.iso.datetime(),
});
export type AuthorityClaimInput = z.infer<typeof authorityClaimInput>;
export type AuthorityClaim = AuthorityClaimInput & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type AuthorityResolution = {
  id: string;
  taskId: string;
  fact: "due-date";
  claimId: string;
  claimRevision: number;
  resolvedAt: string;
  revision: number;
  authority: "user-resolved";
};
export const taskInput = z.object({
  gradeContext: z
    .object({
      categoryId: id,
      possiblePoints: z.number().positive().max(1000000),
    })
    .nullable()
    .optional(),
  workKind: z.enum(["assignment", "assessment", "optional-review"]).optional(),
  importance: z.enum(["low", "normal", "high"]).optional(),
  captureEvidence: z
    .object({
      source: z.enum(["pasted-text", "text-file"]).optional(),
      sourceName: z.string().max(255).optional(),
      originalText: z.string().max(20000),
      sourceText: z.string().max(20000),
      capturedAt: z.iso.datetime(),
      authority: z.literal("user-provided-text"),
      confidence: z
        .record(z.string(), z.enum(["high", "medium", "low"]))
        .optional(),
      candidateDates: z.array(z.string()).max(100),
      uncertainties: z.array(z.string()).max(100),
    })
    .optional(),
  title: z.string().trim().min(1).max(500),
  classId: id,
  dueAt: z.iso.datetime().nullable(),
  minutes: z.number().int().min(5).max(2400),
  resource: z
    .url()
    .max(2048)
    .refine((v) => new URL(v).protocol === "https:", "Use an HTTPS resource")
    .nullable(),
  notes: z.string().max(20000),
  deadlineConfirmed: z.boolean(),
});
export type TaskInput = z.infer<typeof taskInput>;
export type Class = { id: string; name: string; color: string };
export type ChecklistItem = {
  id: string;
  title: string;
  completed: boolean;
  archived: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Task = TaskInput & {
  checklist?: ChecklistItem[];
  autoPlanPending?: boolean;
  revision?: number;
  id: string;
  completed: boolean;
  createdAt: string;
};
export type StudySession = {
  checklistAtEnd?: Pick<ChecklistItem, "id" | "title" | "completed">[];
  revision?: number;
  corrections?: Array<{
    correctedAt: string;
    fromCompleted: boolean | null;
    toCompleted: boolean;
    previousReview: StudySession["review"] | null;
    remainingMinutes: number | null;
  }>;
  id: string;
  taskId: string;
  startedAt: string;
  pausedAt: string | null;
  pausedMs: number;
  endedAt: string | null;
  actualMinutes: number | null;
  completionReported?: boolean;
  estimateAtStart?: {
    minutes: number;
    classId: string;
    workKind: NonNullable<TaskInput["workKind"]>;
    taskRevision: number;
  };
  review?: {
    reviewedAt: string;
    notes: string;
    remainingMinutes: number | null;
  };
};
export type Block = {
  taskId: string;
  start: string;
  end: string;
  minutes: number;
  why: string;
};
export const studyBlockTime = z.object({
  start: z.iso.datetime(),
  minutes: z.number().int().min(5).max(2400),
});
export type StudyBlock = Block & {
  origin?: "auto-plan" | "manual";
  cancelledAt?: string;
  id: string;
  locked: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type RebalancePreview = {
  id: string;
  createdAt: string;
  expiresAt: string;
  replaced: StudyBlock[];
  added: StudyBlock[];
  kept: StudyBlock[];
  unscheduled: { taskId: string; minutes: number; reason: string }[];
};
export type PlanChange = RebalancePreview & {
  appliedAt: string;
  reason?: string;
};
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const planningPreferences = z
  .object({
    studyStart: localTime,
    sleepCutoff: localTime,
    studyDays: z.array(z.number().int().min(0).max(6)).max(7),
    bufferPercent: z.number().int().min(5).max(50),
  })
  .refine(
    (p) => p.studyStart < p.sleepCutoff,
    "Study time must start before the same-day sleep cutoff.",
  );
export type PlanningPreferences = z.infer<typeof planningPreferences>;
export const defaultPlanningPreferences: PlanningPreferences = {
  studyStart: "08:00",
  sleepCutoff: "22:00",
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  bufferPercent: 15,
};
export type PlanningMode = "suggest" | "auto-plan";
export const capturePolicy = z.enum(["conservative", "balanced", "autopilot"]);
export type CapturePolicy = z.infer<typeof capturePolicy>;
export type CaptureInboxItem = {
  filing?: {
    policy: CapturePolicy;
    action: "review" | "auto-file";
    reason: string;
  };
  id: string;
  revision: number;
  status: "pending" | "archived" | "accepted";
  taskId: string | null;
  draft: CaptureDraft;
  updatedAt: string;
};
export const memoryCategory = z.enum([
  "preference",
  "teacher-policy",
  "target-grade",
  "duration",
  "planning",
  "other",
]);
export const memoryInput = z.object({
  text: z.string().trim().min(1).max(2000),
  category: memoryCategory,
  classId: id.nullable(),
});
export type AcademicMemory = z.infer<typeof memoryInput> & {
  id: string;
  revision: number;
  origin: "explicit" | "inferred";
  inferenceKey?: string;
  evidence?: {
    sessionIds: string[];
    ratio: number;
    samples: number;
    observations?: DurationObservation[];
  };
  createdAt: string;
  updatedAt: string;
};
export const mistakeInput = z.object({
  classId: id,
  taskId: id.nullable(),
  concept: z.string().trim().min(1).max(300),
  source: z.string().trim().min(1).max(500),
  originalAttempt: z.string().trim().min(1).max(5000),
  whatWentWrong: z.string().trim().min(1).max(5000),
  correction: z.string().trim().min(1).max(5000),
  helpUsed: z.string().trim().max(2000),
  confidence: z.enum(["low", "medium", "high"]),
  reviewDue: z.iso.datetime().nullable(),
});
export type MistakeInput = z.infer<typeof mistakeInput>;
export type Mistake = MistakeInput & {
  id: string;
  revision: number;
  practiceTaskIds: string[];
  createdAt: string;
  updatedAt: string;
};
export const conceptStatus = z.enum([
  "not-started",
  "learning",
  "developing",
  "strong",
  "review-due",
]);
export const preparednessState = z.enum([
  "not-ready",
  "developing",
  "mostly-ready",
  "ready",
  "strong",
]);
export const retentionMode = z.enum(["course", "long-term"]);
export const conceptInput = z
  .object({
    classId: id,
    taskIds: z.array(id).max(100),
    name: z.string().trim().min(1).max(300),
    status: conceptStatus,
    preparedness: preparednessState,
    retentionMode,
    reviewDue: z.iso.datetime().nullable(),
    attempts: z.number().int().min(0).max(10000),
    unaidedCorrect: z.number().int().min(0).max(10000),
    unaidedTotal: z.number().int().min(0).max(10000),
    hintCount: z.number().int().min(0).max(10000),
    lastReviewedAt: z.iso.datetime().nullable(),
    evidenceNote: z.string().trim().max(2000),
  })
  .superRefine((input, ctx) => {
    if (input.unaidedCorrect > input.unaidedTotal)
      ctx.addIssue({
        code: "custom",
        path: ["unaidedCorrect"],
        message: "Unaided correct cannot exceed unaided attempts.",
      });
  });
export type ConceptInput = z.infer<typeof conceptInput>;
export type Concept = ConceptInput & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export const attemptResult = z.enum([
  "correct",
  "incorrect",
  "partial",
  "unknown",
]);
export const attemptInput = z
  .object({
    classId: id,
    taskId: id.nullable(),
    conceptIds: z.array(id).max(100),
    result: attemptResult,
    unaided: z.boolean(),
    hintCount: z.number().int().min(0).max(10000),
    notes: z.string().trim().max(5000),
    attemptedAt: z.iso.datetime(),
  })
  .superRefine((input, ctx) => {
    if (!input.unaided && input.hintCount === 0)
      ctx.addIssue({
        code: "custom",
        path: ["hintCount"],
        message: "Record at least one hint when an attempt was aided.",
      });
  });
export type AttemptInput = z.infer<typeof attemptInput>;
export type Attempt = AttemptInput & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Snapshot = {
  mistakes: Mistake[];
  memories: AcademicMemory[];
  inference: { enabled: boolean; excludedSessionIds: string[] };
  tutoringMode: TutoringMode;
  capturePolicy: CapturePolicy;
  captureInbox: CaptureInboxItem[];
  planningMode: PlanningMode;
  gradeCategories: GradeCategory[];
  gradeEntries: GradeEntry[];
  assessments: Assessment[];
  academicPeriods: AcademicPeriod[];
  spaces: Space[];
  tracks: Track[];
  units: Unit[];
  teachers: Teacher[];
  teacherEvidence: TeacherEvidence[];
  authorityClaims: AuthorityClaim[];
  authorityResolutions: AuthorityResolution[];
  concepts: Concept[];
  attempts: Attempt[];
  planChanges: PlanChange[];
  studyBlocks: StudyBlock[];
  canvases: Omit<CanvasRecord, "scene">[];
  sources: Source[];
  classes: Class[];
  tasks: Task[];
  sessions: StudySession[];
  planning: PlanningPreferences;
};
export const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tutor.mode"), mode: tutoringMode }),
  z.object({ type: z.literal("capture.policy"), mode: capturePolicy }),
  z.object({
    type: z.literal("inbox.import"),
    files: z
      .array(
        z.object({
          name: z
            .string()
            .min(1)
            .max(255)
            .refine((value) => !/[\\/]/.test(value)),
          text: z
            .string()
            .min(1)
            .max(20000)
            .refine((value) => value.trim().length > 0),
        }),
      )
      .min(1)
      .max(10),
    timeZone: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal("inbox.capture"),
    text: z
      .string()
      .min(1)
      .max(20000)
      .refine((value) => value.trim().length > 0, "Paste some text first."),
    timeZone: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal("inbox.archive"),
    id,
    revision: z.number().int().nonnegative(),
    archived: z.boolean(),
  }),
  z.object({
    type: z.literal("inbox.accept"),
    id,
    revision: z.number().int().nonnegative(),
    input: taskInput,
  }),
  z.object({
    type: z.literal("checklist.add"),
    taskId: id,
    title: z.string().trim().min(1).max(500),
  }),
  z.object({
    type: z.literal("checklist.update"),
    taskId: id,
    id,
    revision: z.number().int().nonnegative(),
    input: z.object({
      title: z.string().trim().min(1).max(500),
      completed: z.boolean(),
      archived: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("planning.mode"),
    mode: z.enum(["suggest", "auto-plan"]),
  }),
  z.object({
    type: z.literal("grade.category"),
    id: id.optional(),
    revision: z.number().int().nonnegative().optional(),
    input: gradeCategoryInput,
  }),
  z.object({
    type: z.literal("grade.entry"),
    id: id.optional(),
    revision: z.number().int().nonnegative().optional(),
    input: gradeEntryInput,
  }),
  z.object({ type: z.literal("assessment.create"), input: assessmentInput }),
  z.object({
    type: z.literal("assessment.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: assessmentInput,
  }),
  z.object({
    type: z.literal("assessment.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("period.create"), input: academicPeriodInput }),
  z.object({
    type: z.literal("period.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: academicPeriodInput,
  }),
  z.object({
    type: z.literal("period.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("space.create"), input: spaceInput }),
  z.object({
    type: z.literal("space.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: spaceInput,
  }),
  z.object({
    type: z.literal("space.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("track.create"), input: trackInput }),
  z.object({
    type: z.literal("track.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: trackInput,
  }),
  z.object({
    type: z.literal("track.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("unit.create"), input: unitInput }),
  z.object({
    type: z.literal("unit.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: unitInput,
  }),
  z.object({
    type: z.literal("unit.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("teacher.create"), input: teacherInput }),
  z.object({
    type: z.literal("teacher.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: teacherInput,
  }),
  z.object({
    type: z.literal("teacher.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("evidence.create"), input: teacherEvidenceInput }),
  z.object({
    type: z.literal("evidence.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: teacherEvidenceInput,
  }),
  z.object({
    type: z.literal("evidence.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("authority.claim.create"),
    input: authorityClaimInput,
  }),
  z.object({
    type: z.literal("authority.claim.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: authorityClaimInput,
  }),
  z.object({
    type: z.literal("authority.claim.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("authority.resolve"),
    taskId: id,
    claimId: id,
    claimRevision: z.number().int().nonnegative(),
    taskRevision: z.number().int().nonnegative(),
    resolutionApproved: z.boolean(),
  }),
  z.object({
    type: z.literal("planning.rebalance"),
    previewId: id,
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal("block.cancel"),
    id,
    revision: z.number().int().nonnegative(),
    cancellationApproved: z.boolean(),
  }),
  z.object({
    type: z.literal("block.create"),
    taskId: id,
    input: studyBlockTime,
    beyondDeadlineApproved: z.boolean(),
  }),
  z.object({
    type: z.literal("block.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: studyBlockTime,
    locked: z.boolean(),
    lockedChangeApproved: z.boolean(),
    beyondDeadlineApproved: z.boolean(),
  }),

  z.object({
    type: z.literal("canvas.create"),
    taskId: id,
    notebook: z.boolean().optional(),
  }),
  z.object({ type: z.literal("canvas.recover"), id, scene: canvasScene }),
  z.object({
    type: z.literal("canvas.save"),
    id,
    revision: z.number().int().nonnegative(),
    scene: canvasScene,
  }),
  z.object({ type: z.literal("memory.inference"), enabled: z.boolean() }),
  z.object({ type: z.literal("memory.clear-inferred") }),
  z.object({
    type: z.literal("memory.confirm"),
    classId: id,
    workKind: z.enum(["assignment", "assessment", "optional-review"]),
    basis: z.string().max(100000),
  }),
  z.object({ type: z.literal("memory.create"), input: memoryInput }),
  z.object({
    type: z.literal("memory.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: memoryInput,
  }),
  z.object({
    type: z.literal("memory.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("mistake.create"), input: mistakeInput }),
  z.object({
    type: z.literal("mistake.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: mistakeInput,
  }),
  z.object({
    type: z.literal("mistake.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("mistake.practice"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("concept.create"), input: conceptInput }),
  z.object({
    type: z.literal("concept.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: conceptInput,
  }),
  z.object({
    type: z.literal("concept.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("attempt.create"), input: attemptInput }),
  z.object({
    type: z.literal("attempt.update"),
    id,
    revision: z.number().int().nonnegative(),
    input: attemptInput,
  }),
  z.object({
    type: z.literal("attempt.forget"),
    id,
    revision: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("source.create"), input: sourceInput }),
  z.object({
    type: z.literal("source.classify"),
    id,
    revision: z.number().int().nonnegative(),
    kind: sourceKind,
  }),
  z.object({
    type: z.literal("planning.preferences"),
    input: planningPreferences,
  }),
  z.object({
    type: z.literal("class.create"),
    name: z.string().trim().min(1).max(100),
  }),
  z.object({ type: z.literal("task.create"), input: taskInput }),
  z.object({ type: z.literal("task.undo"), id }),
  z.object({
    type: z.literal("task.update"),
    id,
    input: taskInput,
    deadlineChangeApproved: z.boolean(),
  }),
  z.object({ type: z.literal("session.start"), taskId: id }),
  z.object({ type: z.literal("session.pause") }),
  z.object({ type: z.literal("session.resume") }),
  z.object({ type: z.literal("session.end"), completed: z.boolean() }),
  z.object({
    type: z.literal("session.correct"),
    id,
    revision: z.number().int().nonnegative(),
    taskRevision: z.number().int().nonnegative(),
    completed: z.boolean(),
    notes: z.string().trim().max(20000),
    remainingMinutes: z.number().int().min(5).max(2400).nullable(),
  }),
  z.object({
    type: z.literal("session.review"),
    id,
    notes: z.string().trim().max(20000),
    remainingMinutes: z.number().int().min(5).max(2400).nullable(),
  }),
]);
export type Command = z.infer<typeof command>;
export type LensCapture = {
  image: string;
  width: number;
  height: number;
  displayId: string;
  capturedAt: string;
};
export interface DeskAPI {
  previewRebalance(): Promise<RebalancePreview>;
  onEdit(listener: (action: "undo" | "redo") => void): () => void;
  closeWindow(): Promise<void>;
  exportCanvas(id: string, png: Uint8Array): Promise<boolean>;
  canvas(id: string): Promise<CanvasRecord>;
  askLens(input: Omit<LensInput, "context">): Promise<LensResponse>;
  providerStatus(): Promise<{
    configured: boolean;
    secureStorage: boolean;
    source: "development-env" | "saved-user-key" | null;
  }>;
  importProviderKey(): Promise<boolean>;
  importCaptureFiles(): Promise<Snapshot | null>;
  removeProviderKey(): Promise<void>;
  captureScreen(): Promise<LensCapture>;
  snapshot(): Promise<Snapshot>;
  command(value: Command): Promise<Snapshot>;
  openResource(taskId: string): Promise<void>;
  lens(): Promise<void>;
  dismiss(): Promise<void>;
}
