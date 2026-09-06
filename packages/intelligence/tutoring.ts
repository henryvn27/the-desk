import { z } from "zod";
export const tutoringMode = z.enum(["guide", "balanced", "direct"]);
export type TutoringMode = z.infer<typeof tutoringMode>;
export function teachingInstructions(mode: TutoringMode): string {
  const instructions = {
    guide:
      "Tutoring mode: Guide me. Start from the student's attempt. If no attempt is supplied, invite a brief attempt or offer a small hint. Progress through a larger hint, explanation, analogous example, then a check of the new attempt as needed. Do not force an attempt or withhold the full method when the student explicitly asks for it.",
    balanced:
      "Tutoring mode: Balanced. Give a focused explanation or useful hint appropriate to the question, then invite the next step or check an attempt where useful. Use the hint-to-explanation-to-analogous-example progression when the student is stuck. Explain the full method when explicitly requested; do not be artificially obstructive.",
    direct:
      "Tutoring mode: Explain directly. Explain the full method clearly with reasoning and useful steps. Use an analogous worked example when it helps and distinguish it from the student's original problem. Check any supplied attempt and explain corrections. Avoid forcing a hint ladder before answering a direct request for explanation.",
  };
  return instructions[tutoringMode.parse(mode)];
}
