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
export const taskInput = z.object({
  captureEvidence: z
    .object({
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
export type Task = TaskInput & {
  id: string;
  completed: boolean;
  createdAt: string;
};
export type StudySession = {
  id: string;
  taskId: string;
  startedAt: string;
  pausedAt: string | null;
  pausedMs: number;
  endedAt: string | null;
  actualMinutes: number | null;
  completionReported?: boolean;
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
export type Snapshot = {
  canvases: Omit<CanvasRecord, "scene">[];
  sources: Source[];
  classes: Class[];
  tasks: Task[];
  sessions: StudySession[];
  planning: PlanningPreferences;
};
export const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("canvas.create"), taskId: id }),
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
  onEdit(listener: (action: "undo" | "redo") => void): () => void;
  closeWindow(): Promise<void>;
  exportCanvas(id: string, png: Uint8Array): Promise<boolean>;
  canvas(id: string): Promise<CanvasRecord>;
  askLens(input: Omit<LensInput, "context">): Promise<LensResponse>;
  providerStatus(): Promise<{ configured: boolean; secureStorage: boolean }>;
  saveProviderKey(key: string): Promise<void>;
  removeProviderKey(): Promise<void>;
  captureScreen(): Promise<LensCapture>;
  snapshot(): Promise<Snapshot>;
  command(value: Command): Promise<Snapshot>;
  openResource(taskId: string): Promise<void>;
  lens(): Promise<void>;
  dismiss(): Promise<void>;
}
