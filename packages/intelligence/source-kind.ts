import { z } from "zod";
export const sourceKind = z.enum([
  "class-material",
  "assigned-textbook",
  "educational-reference",
  "general-web",
  "unspecified",
]);
export type SourceKind = z.infer<typeof sourceKind>;
export const sourceKindLabels: Record<SourceKind, string> = {
  "class-material": "Teacher / class material",
  "assigned-textbook": "Assigned textbook",
  "educational-reference": "Educational reference",
  "general-web": "General web",
  unspecified: "Unspecified",
};
export function sourcePriority(kind: SourceKind = "unspecified"): number {
  return sourceKind.options.indexOf(sourceKind.parse(kind));
}
