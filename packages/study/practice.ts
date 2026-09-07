import { z } from "zod";
import type { Mistake, Task, TaskInput } from "../domain/contracts";

export const practiceTaskMetadata = z
  .object({
    origin: z.literal("mistake"),
    mistakeIds: z.array(z.string().trim().min(1).max(160)).min(1).max(10),
    conceptIds: z.array(z.string().trim().min(1).max(160)).max(20),
    intendedDifficulty: z.enum(["core", "transfer", "challenge"]),
    variationKey: z.string().trim().min(1).max(160),
    answerValidation: z.enum(["deterministic", "unit-aware", "manual-review", "rejected"]),
    validatorNotes: z.string().trim().max(600),
    answer: z.string().trim().max(2_000).optional(),
    unit: z.string().trim().max(80).optional(),
  })
  .strict();
export type PracticeTaskMetadata = z.infer<typeof practiceTaskMetadata>;

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export type PracticeQuality = {
  accepted: boolean;
  checks: {
    promptPresent: boolean;
    correctionPresent: boolean;
    duplicate: boolean;
    answerValidated: boolean;
  };
  issues: string[];
};

function tokenSimilarity(left: string, right: string) {
  const a = new Set(normalize(left).split(" ").filter(Boolean));
  const b = new Set(normalize(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

/** Deterministic comparison for numeric or symbolic answers; no model arithmetic. */
export function validateDeterministicAnswer(input: {
  expected: string | number;
  actual: string | number;
  expectedUnit?: string;
  actualUnit?: string;
  tolerance?: number;
}) {
  const expectedUnit = input.expectedUnit?.trim().toLocaleLowerCase() ?? "";
  const actualUnit = input.actualUnit?.trim().toLocaleLowerCase() ?? "";
  if (expectedUnit && expectedUnit !== actualUnit)
    return { valid: false, reason: "Units do not match." } as const;
  if (typeof input.expected === "number" && typeof input.actual === "number") {
    const tolerance = input.tolerance ?? Math.max(1e-9, Math.abs(input.expected) * 1e-6);
    return Math.abs(input.expected - input.actual) <= tolerance
      ? { valid: true, reason: "Numeric answer and units match." } as const
      : { valid: false, reason: "Numeric answer is outside the allowed tolerance." } as const;
  }
  return normalize(String(input.expected)) === normalize(String(input.actual))
    ? { valid: true, reason: "Normalized answer matches." } as const
    : { valid: false, reason: "Answer does not match the expected value." } as const;
}

export function validatePracticeCandidate(
  candidate: Pick<TaskInput, "title" | "notes" | "practice">,
  existingTasks: readonly Task[],
): PracticeQuality {
  const metadata = candidate.practice;
  const candidateText = `${candidate.title} ${candidate.notes}`;
  const duplicate = existingTasks.some((task) => {
    if (!task.practice || !metadata) return false;
    return task.practice.mistakeIds.some((id) => metadata.mistakeIds.includes(id)) && tokenSimilarity(`${task.title} ${task.notes}`, candidateText) >= 0.82;
  });
  const promptPresent = candidate.title.trim().length >= 8 && candidate.notes.trim().length >= 20;
  const correctionPresent = /correction:/i.test(candidate.notes) && /what went wrong:/i.test(candidate.notes);
  const ambiguous = /\b(?:maybe|not sure|or maybe|either)\b/i.test(candidate.notes);
  const answerValidated = metadata?.answerValidation === "deterministic" || metadata?.answerValidation === "unit-aware"
    ? Boolean(metadata.answer?.trim()) && (metadata.answerValidation !== "unit-aware" || Boolean(metadata.unit?.trim()))
    : metadata?.answerValidation === "manual-review";
  const issues = [
    !promptPresent ? "Practice prompt is too thin to be useful." : undefined,
    !correctionPresent ? "Practice must preserve the original mistake and correction." : undefined,
    duplicate ? "A near-duplicate practice variation already exists for this mistake." : undefined,
    ambiguous ? "Practice wording is ambiguous; clarify the intended method before generating it." : undefined,
    !answerValidated ? "This candidate needs an explicit student check before it can count as validated." : undefined,
  ].filter((value): value is string => Boolean(value));
  return {
    accepted: !duplicate && !ambiguous && promptPresent && correctionPresent,
    checks: { promptPresent, correctionPresent, duplicate, answerValidated },
    issues,
  };
}

export function metadataForMistake(mistake: Mistake): PracticeTaskMetadata {
  const intendedDifficulty = mistake.confidence === "low" ? "core" : mistake.confidence === "medium" ? "transfer" : "challenge";
  return {
    origin: "mistake",
    mistakeIds: [mistake.id],
    conceptIds: [],
    intendedDifficulty,
    variationKey: `${normalize(mistake.concept).replace(/[^a-z0-9]+/g, "-")}-v${mistake.practiceTaskIds.length + 1}`,
    answerValidation: "manual-review",
    validatorNotes: "Free-form mistake records do not contain a machine-checkable answer; require a checked student attempt before updating the Student Model.",
  };
}
