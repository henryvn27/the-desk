import {
  memoryInput,
  mistakeInput,
  sourceInput,
  taskInput,
  type MistakeInput,
  type SourceInput,
  type TaskInput,
  type AcademicMemory,
} from "../domain/contracts";
import { canvasScene, type CanvasScene } from "../canvas/scene";

export const lensMistakeDraftSchema = mistakeInput.pick({
  concept: true,
  originalAttempt: true,
  whatWentWrong: true,
});
export type LensMistakeDraft = ReturnType<typeof lensMistakeDraftSchema.parse>;

export function lensAnswerMemoryInput(
  answer: string,
  classId: string,
): Pick<AcademicMemory, "text" | "category" | "classId"> {
  return memoryInput.parse({
    text: answer,
    category: "other",
    classId,
  });
}

export function lensAnswerSourceInput(
  answer: string,
  classId: string,
  taskId: string | null,
): SourceInput {
  return sourceInput.parse({
    kind: "unspecified",
    title: "Lens answer",
    text: answer,
    classIds: [classId],
    taskIds: taskId ? [taskId] : [],
  });
}

export function lensFollowUpTaskInput(
  answer: string,
  classId: string,
  resource: string | null = null,
): TaskInput {
  return taskInput.parse({
    title: "Review Lens answer",
    classId,
    dueAt: null,
    minutes: 15,
    resource,
    notes: answer,
    deadlineConfirmed: false,
    workKind: "optional-review",
    importance: "normal",
  });
}

export function lensAnswerMistakeInput(
  answer: string,
  classId: string,
  taskId: string | null,
  draft: LensMistakeDraft,
): MistakeInput {
  return mistakeInput.parse({
    ...lensMistakeDraftSchema.parse(draft),
    classId,
    taskId,
    source: "Lens answer",
    correction: answer,
    helpUsed: "Lens explanation",
    confidence: "low",
    reviewDue: null,
  });
}

export function lensAnswerCanvasScene(
  answer: string,
  sourceId: string,
): CanvasScene {
  const text = sourceInput.shape.text.parse(answer);
  return canvasScene.parse({
    engine: "excalidraw",
    version: 1,
    sourceIds: [sourceId],
    elements: [
      {
        id: "lens-answer",
        type: "text",
        x: 64,
        y: 64,
        width: 720,
        height: Math.max(48, Math.ceil(text.length / 60) * 30),
        text,
        originalText: text,
        fontSize: 24,
        fontFamily: 1,
        textAlign: "left",
        verticalAlign: "top",
        lineHeight: 1.25,
        autoResize: true,
        strokeColor: "#1f2326",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        angle: 0,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        containerId: null,
        customData: { createdBy: "lens", sourceId },
      },
    ],
    files: {},
    viewBackgroundColor: "#fffdfa",
  });
}
