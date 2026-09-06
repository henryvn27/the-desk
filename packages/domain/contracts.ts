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
  title: z.string().trim().min(1).max(500),
  text: z.string().min(1).max(200000),
  classIds: z.array(id).max(100),
  taskIds: z.array(id).max(500),
});
export type SourceInput = z.infer<typeof sourceInput>;
export type Source = SourceInput & {
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
export type Snapshot = {
  capturePolicy: CapturePolicy;
  captureInbox: CaptureInboxItem[];
  planningMode: PlanningMode;
  gradeCategories: GradeCategory[];
  gradeEntries: GradeEntry[];
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
  z.object({ type: z.literal("source.create"), input: sourceInput }),
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
