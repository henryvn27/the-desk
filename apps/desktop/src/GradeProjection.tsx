import { useState } from "react";
import type {
  GradeCategory,
  GradeEntry,
} from "../../../packages/domain/contracts";
import { projectGrade, type GradeScenario } from "../../../packages/grades";
import { userError } from "./errors";
export function GradeProjection({
  categories,
  entries,
}: {
  categories: GradeCategory[];
  entries: GradeEntry[];
}) {
  const [scenario, setScenario] = useState<GradeScenario>();
  const [error, setError] = useState("");
  const projection = scenario
    ? projectGrade(categories, entries, scenario)
    : null;
  return (
    <details>
      <summary>Explore an upcoming score</summary>
      <p>
        Try a possible score range for one additional item. This does not save a
        score.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const next = {
            categoryId: String(f.get("category")),
            possible: Number(f.get("possible")),
            low: Number(f.get("low")),
            high: Number(f.get("high")),
          };
          try {
            projectGrade(categories, entries, next);
            setScenario(next);
            setError("");
          } catch (e) {
            setScenario(undefined);
            setError(userError(e));
          }
        }}
      >
        <label>
          Projection category
          <select
            aria-label="Projection category"
            name="category"
            defaultValue={categories[0]?.id}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="fields">
          <label>
            Upcoming possible points
            <input
              name="possible"
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              required
            />
          </label>
          <label>
            Lower expected points
            <input
              name="low"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              required
            />
          </label>
          <label>
            Upper expected points
            <input
              name="high"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              required
            />
          </label>
        </div>
        <button>Calculate scenario</button>
      </form>
      <p role="status">{error}</p>
      {scenario && projection && (
        <section aria-label="Grade scenario result">
          <h3>
            What-if range: {projection.lower.toFixed(1)}–
            {projection.upper.toFixed(1)}%
          </h3>
          <p>
            If the additional{" "}
            {categories.find((c) => c.id === scenario.categoryId)?.name} item
            earns {scenario.low}–{scenario.high} of {scenario.possible} points.
          </p>
          <p>
            All recorded scores and category weights stay fixed. Other unscored
            weight ranges from 0–100%. This is a scenario, not a predicted or
            official grade.
          </p>
        </section>
      )}
    </details>
  );
}
