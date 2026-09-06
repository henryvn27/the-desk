import {
  memoryInput,
  sourceInput,
  taskInput,
  type SourceInput,
  type TaskInput,
  type AcademicMemory,
} from "../domain/contracts";

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
): TaskInput {
  return taskInput.parse({
    title: "Review Lens answer",
    classId,
    dueAt: null,
    minutes: 15,
    resource: null,
    notes: answer,
    deadlineConfirmed: false,
    workKind: "optional-review",
    importance: "normal",
  });
}
