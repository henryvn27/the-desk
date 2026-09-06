import { durationMemories } from "../../../packages/learning/memory";
import { useEffect, useState } from "react";
import {
  memoryCategory,
  type AcademicMemory,
  type Command,
  type Snapshot,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";
const labels = {
  preference: "Preference",
  "teacher-policy": "Teacher policy",
  "target-grade": "Target grade",
  duration: "Typical duration",
  planning: "Planning pattern",
  other: "Other",
};
export function Memory({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<AcademicMemory | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [learningEnabled, setLearningEnabled] = useState(
    data.inference.enabled,
  );
  useEffect(
    () => setLearningEnabled(data.inference.enabled),
    [data.inference.enabled],
  );
  async function change(command: Command) {
    setBusy(true);
    setError("");
    try {
      await save(command);
      setEditing(undefined);
      return true;
    } catch (error) {
      setError(userError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h1>What The Desk Knows</h1>
      <p>
        Notes you have saved and patterns you have confirmed. Tutoring can use
        them for context; planning settings are managed in Settings.
      </p>
      <h2>Learning from sessions</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={learningEnabled}
          disabled={busy || editing !== undefined}
          onChange={async (e) => {
            const enabled = e.target.checked;
            setLearningEnabled(enabled);
            if (!(await change({ type: "memory.inference", enabled })))
              setLearningEnabled(data.inference.enabled);
          }}
        />
        Learn from reviewed sessions
      </label>
      <p className="muted">
        Patterns need repeated evidence and your confirmation before saving.
        Turning learning off pauses learned estimates and inferred notes in
        tutoring.
      </p>
      <button
        disabled={busy || editing !== undefined}
        onClick={() => void change({ type: "memory.clear-inferred" })}
      >
        Clear inferred memories
      </button>
      <p className="muted">
        Clearing keeps your explicit notes and session history, but excludes
        past sessions from new learning.
      </p>
      {durationMemories(data).map((candidate) => (
        <article className="source" key={candidate.key}>
          <h3>Pattern to review</h3>
          <p>{candidate.text}</p>
          <p className="muted">
            Based on {candidate.evidence.samples} reviewed, unchanged tasks
            finished in one session. This estimate may change with more
            evidence.
          </p>
          <button
            disabled={busy || editing !== undefined}
            onClick={() =>
              void change({
                type: "memory.confirm",
                classId: candidate.classId,
                workKind: candidate.workKind,
                basis: candidate.basis,
              })
            }
          >
            Confirm memory
          </button>
        </article>
      ))}
      <h2>Saved memories</h2>
      <button
        onClick={() => {
          setEditing(null);
          setError("");
        }}
        disabled={busy}
      >
        Remember something
      </button>
      {error && <p role="alert">{error}</p>}
      {editing !== undefined && (
        <form
          key={editing?.id ?? "new"}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const input = {
              text: String(form.get("text")),
              category: memoryCategory.parse(form.get("category")),
              classId: String(form.get("classId")) || null,
            };
            void change(
              editing
                ? {
                    type: "memory.update",
                    id: editing.id,
                    revision: editing.revision,
                    input,
                  }
                : { type: "memory.create", input },
            );
          }}
        >
          <h2>{editing ? "Edit memory" : "New memory"}</h2>
          <label>
            Memory note
            <textarea
              aria-label="Memory note"
              name="text"
              required
              maxLength={2000}
              defaultValue={editing?.text ?? ""}
            />
          </label>
          <label>
            Category
            <select
              name="category"
              aria-label="Memory category"
              defaultValue={editing?.category ?? "preference"}
            >
              {memoryCategory.options.map((category) => (
                <option key={category} value={category}>
                  {labels[category]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Applies to
            <select
              name="classId"
              aria-label="Memory class"
              defaultValue={editing?.classId ?? ""}
            >
              <option value="">All classes</option>
              {data.classes.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Save memory
            </button>
          </div>
        </form>
      )}
      {!data.memories.length && <p className="muted">No saved memories yet.</p>}
      {data.memories.map((memory) => (
        <article className="source" key={memory.id}>
          <p className="muted">
            {labels[memory.category]} ·{" "}
            {data.classes.find((c) => c.id === memory.classId)?.name ??
              "All classes"}{" "}
            ·{" "}
            {memory.origin === "explicit"
              ? "Stated by you"
              : "Confirmed pattern"}
          </p>
          <p className="source-text">{memory.text}</p>
          {memory.evidence && (
            <details>
              <summary>
                Evidence · {memory.evidence.samples} reviewed tasks
              </summary>
              {memory.evidence.sessionIds.map((id) => {
                const session = data.sessions.find((s) => s.id === id);
                const task = data.tasks.find((t) => t.id === session?.taskId);
                return (
                  <p key={id}>
                    {task?.title ?? "Original task unavailable"} ·{" "}
                    {session?.actualMinutes ?? "Unknown"} minutes recorded
                  </p>
                );
              })}
            </details>
          )}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditing(memory);
                setError("");
              }}
            >
              Edit memory
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "memory.forget",
                  id: memory.id,
                  revision: memory.revision,
                })
              }
            >
              Forget memory
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
