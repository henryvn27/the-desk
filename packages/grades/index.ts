import type { GradeCategory, GradeEntry } from "../domain/contracts";
/** Point-weighted scores within each category; no silent renormalization of missing weights. */
export function gradeSummary(
  categories: GradeCategory[],
  entries: GradeEntry[],
) {
  const rows = categories.map((category) => {
    const scores = entries.filter((e) => e.categoryId === category.id);
    const earned = scores.reduce((sum, e) => sum + e.earned, 0);
    const possible = scores.reduce((sum, e) => sum + e.possible, 0);
    return {
      ...category,
      earned,
      possible,
      percent: possible ? (earned / possible) * 100 : null,
    };
  });
  const configuredWeight = rows.reduce((sum, c) => sum + c.weight, 0);
  const scoredWeight = rows
    .filter((c) => c.percent !== null)
    .reduce((sum, c) => sum + c.weight, 0);
  const weightedPoints = rows.reduce(
    (sum, c) => sum + ((c.percent ?? 0) * c.weight) / 100,
    0,
  );
  return {
    rows,
    configuredWeight,
    scoredWeight,
    lower: weightedPoints,
    upper: weightedPoints + Math.max(0, 100 - scoredWeight),
  };
}

export type GradeScenario = {
  categoryId: string;
  possible: number;
  low: number;
  high: number;
};
/** Hypothetical additional work. Original entries are never mutated or persisted. */
export function projectGrade(
  categories: GradeCategory[],
  entries: GradeEntry[],
  scenario: GradeScenario,
) {
  if (!categories.some((c) => c.id === scenario.categoryId))
    throw Error("Choose a grade category for this class.");
  const { possible, low, high } = scenario;
  if (
    ![possible, low, high].every(Number.isFinite) ||
    possible <= 0 ||
    possible > 1000000 ||
    low < 0 ||
    high < low ||
    high > possible
  )
    throw Error(
      "Use a score range from zero to possible points, with the lower score first.",
    );
  const hypothetical = (earned: number): GradeEntry => ({
    id: "hypothetical",
    categoryId: scenario.categoryId,
    title: "What-if",
    earned,
    possible,
    revision: 0,
    recordedAt: "",
    updatedAt: "",
    authority: "user-entered",
  });
  const lower = gradeSummary(categories, [...entries, hypothetical(low)]);
  const upper = gradeSummary(categories, [...entries, hypothetical(high)]);
  return {
    lower: lower.lower,
    upper: upper.upper,
    scoredWeight: lower.scoredWeight,
  };
}
