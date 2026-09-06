import {
  taskInput,
  type CapturePolicy,
  type Task,
  type TaskInput,
} from "../domain/contracts";
import type { CaptureDraft } from "./capture";
export type CaptureDecision =
  | { action: "review"; reason: string }
  | { action: "auto-file"; reason: string; input: TaskInput };
/** Only complete literal evidence can bypass review. This never edits existing tasks. */
export function decideCapture(
  draft: CaptureDraft,
  mode: CapturePolicy,
  tasks: readonly Task[],
  now: Date,
): CaptureDecision {
  const review = (reason: string): CaptureDecision => ({
    action: "review",
    reason,
  });
  if (mode === "conservative")
    return review("Conservative mode asks you to review every capture.");
  if (draft.uncertainties.length)
    return review("Some details need your review.");
  if (
    Object.entries(draft.confidence).some(
      ([field, value]) =>
        value !== "high" &&
        !(mode === "autopilot" && field === "classId" && value === "medium"),
    )
  )
    return review(
      "The extracted fields do not meet this mode's confidence threshold.",
    );
  if (!draft.deadline?.instant || draft.deadline.requiresConfirmation)
    return review("Confirm the deadline and time zone before filing.");
  if (Date.parse(draft.deadline.instant) <= +now)
    return review("The stated deadline has passed. Review the next step.");
  if (draft.resources.length > 1)
    return review("Choose the primary resource before filing.");
  if (/\b(?:quiz|test|exam|assessment|midterm|final)\b/i.test(draft.title))
    return review(
      "Review the work type and preparation needed for this assessment.",
    );
  const normalized = (text: string) =>
    text
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("en-US");
  if (
    tasks.some(
      (task) =>
        task.classId === draft.classId &&
        normalized(task.title) === normalized(draft.title),
    )
  )
    return review(
      "An assignment with this title already exists in this class. Review possible duplicates or updates.",
    );
  const parsed = taskInput.safeParse({
    title: draft.title,
    classId: draft.classId,
    dueAt: draft.deadline.instant,
    minutes: draft.minutes,
    resource: draft.resources[0] ?? null,
    notes: draft.provenance.sourceText,
    deadlineConfirmed: true,
    workKind: "assignment",
    importance: "normal",
  });
  if (!parsed.success)
    return review(
      "Some assignment details are missing or outside supported limits.",
    );
  return {
    action: "auto-file",
    input: parsed.data,
    reason:
      mode === "autopilot" && draft.confidence.classId === "medium"
        ? "Autopilot filed complete text with a unique partial class match and an explicit timestamp."
        : "Complete high-confidence text with an explicit timestamp met your capture policy.",
  };
}
