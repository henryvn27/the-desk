import { z } from "zod";

/**
 * User-reported authority classes for important claims. The ordering is a
 * contextual recommendation only; a higher-ranked claim never overwrites a
 * lower-ranked claim without an explicit user choice.
 */
export const authorityKind = z.enum([
  "teacher-update",
  "live-lms",
  "syllabus",
  "teacher-email",
  "board-photo",
  "desk-inference",
  "student-report",
]);
export type AuthorityKind = z.infer<typeof authorityKind>;

export const authorityKindLabels: Record<AuthorityKind, string> = {
  "teacher-update": "Explicit teacher update",
  "live-lms": "Current live LMS",
  syllabus: "Syllabus",
  "teacher-email": "Teacher email",
  "board-photo": "Board / photo",
  "desk-inference": "Desk inference",
  "student-report": "Student report",
};

const authorityOrder: AuthorityKind[] = [
  "teacher-update",
  "live-lms",
  "syllabus",
  "teacher-email",
  "board-photo",
  "desk-inference",
  "student-report",
];

export function authorityPriority(kind: AuthorityKind): number {
  return authorityOrder.indexOf(authorityKind.parse(kind));
}

export const authorityConfidence = z.enum(["low", "medium", "high"]);
export type AuthorityConfidence = z.infer<typeof authorityConfidence>;

export const authorityFact = z.literal("due-date");
export type AuthorityFact = z.infer<typeof authorityFact>;

export function authorityClaimsConflict(
  claims: ReadonlyArray<{ value: string | null }>,
): boolean {
  return new Set(claims.map((claim) => claim.value ?? "")).size > 1;
}
