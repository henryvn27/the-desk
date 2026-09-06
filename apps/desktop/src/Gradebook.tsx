import { useState } from "react";
import type {
  Command,
  GradeCategory,
  GradeEntry,
  Snapshot,
} from "../../../packages/domain/contracts";
import { gradeSummary } from "../../../packages/grades";
import { userError } from "./errors";
export function Gradebook({
  data,
  classId,
  save,
}: {
  data: Snapshot;
  classId: string;
  save: (c: Command) => Promise<unknown>;
}) {
  const [category, setCategory] = useState<GradeCategory>();
  const [entry, setEntry] = useState<GradeEntry>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const categories = data.gradeCategories.filter((c) => c.classId === classId);
  const entries = data.gradeEntries.filter((e) =>
    categories.some((c) => c.id === e.categoryId),
  );
  const summary = gradeSummary(categories, entries);
  async function submit(c: Command) {
    setBusy(true);
    setStatus("");
    try {
      await save(c);
      setCategory(undefined);
      setEntry(undefined);
      setStatus("Grade information saved.");
    } catch (e) {
      setStatus(userError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="gradebook">
      <summary>Gradebook</summary>
      <h2>Recorded-score model</h2>
      {summary.scoredWeight ? (
        <p>
          <strong>
            {summary.lower.toFixed(1)}
            {summary.scoredWeight < 100 ? `–${summary.upper.toFixed(1)}` : ""}%
          </strong>{" "}
          · scored categories cover {summary.scoredWeight.toFixed(1)}% of the
          course weight.
        </p>
      ) : (
        <p>Add category weights and scores to see a model.</p>
      )}
      <p className="muted">
        Uses points within each category. Assumes scored category averages stay
        as entered and unscored weight ranges from 0–100%. Future scores, drop
        rules and extra credit are not included. This is not an official grade.
      </p>
      <p>Configured weight: {summary.configuredWeight.toFixed(1)}% of 100%.</p>
      {summary.rows.map((c) => (
        <div className="row" key={c.id}>
          <div>
            <strong>{c.name}</strong>
            <p>
              {c.weight}% weight ·{" "}
              {c.percent === null
                ? "No scores entered"
                : `${c.percent.toFixed(1)}% from ${c.earned}/${c.possible} points`}
            </p>
          </div>
          <button disabled={busy} onClick={() => setCategory(c)}>
            Edit category
          </button>
        </div>
      ))}
      <form
        key={category?.id ?? "new-category"}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void submit({
            type: "grade.category",
            id: category?.id,
            revision: category?.revision,
            input: {
              classId,
              name: String(f.get("name")),
              weight: Number(f.get("weight")),
            },
          });
        }}
      >
        <h3>{category ? "Edit category" : "Add category"}</h3>
        <div className="fields">
          <label>
            Category name
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={category?.name ?? ""}
            />
          </label>
          <label>
            Category weight (%)
            <input
              name="weight"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              required
              defaultValue={category?.weight ?? ""}
            />
          </label>
        </div>
        <button disabled={busy}>Save category</button>
        {category && (
          <button type="button" onClick={() => setCategory(undefined)}>
            Cancel category edit
          </button>
        )}
      </form>
      {!!categories.length && (
        <form
          key={entry?.id ?? "new-score"}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void submit({
              type: "grade.entry",
              id: entry?.id,
              revision: entry?.revision,
              input: {
                categoryId: String(f.get("category")),
                title: String(f.get("title")),
                earned: Number(f.get("earned")),
                possible: Number(f.get("possible")),
              },
            });
          }}
        >
          <h3>{entry ? "Correct score" : "Add score"}</h3>
          <label>
            Score title
            <input
              name="title"
              required
              maxLength={300}
              defaultValue={entry?.title ?? ""}
            />
          </label>
          <label>
            Score category
            <select
              aria-label="Score category"
              name="category"
              defaultValue={entry?.categoryId ?? categories[0]!.id}
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
              Earned points
              <input
                name="earned"
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                required
                defaultValue={entry?.earned ?? ""}
              />
            </label>
            <label>
              Possible points
              <input
                name="possible"
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                required
                defaultValue={entry?.possible ?? ""}
              />
            </label>
          </div>
          <button disabled={busy}>Save score</button>
          {entry && (
            <button type="button" onClick={() => setEntry(undefined)}>
              Cancel score edit
            </button>
          )}
        </form>
      )}
      <p role="status">{status}</p>
      {entries.map((e) => (
        <div className="row" key={e.id}>
          <div>
            <strong>{e.title}</strong>
            <p>
              {e.earned}/{e.possible} ·{" "}
              {categories.find((c) => c.id === e.categoryId)?.name}
            </p>
            <small>
              Entered by you · {new Date(e.updatedAt).toLocaleString()}
            </small>
          </div>
          <button disabled={busy} onClick={() => setEntry(e)}>
            Correct score
          </button>
        </div>
      ))}
    </details>
  );
}
