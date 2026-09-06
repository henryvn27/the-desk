import { sourceInput, type SourceInput } from "../domain/contracts";

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
