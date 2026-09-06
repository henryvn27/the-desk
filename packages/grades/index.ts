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
