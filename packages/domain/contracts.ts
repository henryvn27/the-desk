import type { LensInput, LensResponse } from "../intelligence/lens-provider";
import { z } from "zod";
const id = z.string().uuid();
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
};
export type Block = {
  taskId: string;
  start: string;
  end: string;
  minutes: number;
  why: string;
};
export type Snapshot = {
  classes: Class[];
  tasks: Task[];
  sessions: StudySession[];
};
export const command = z.discriminatedUnion("type", [
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
