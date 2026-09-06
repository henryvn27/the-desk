import { useState } from "react";
import {
  mistakeInput,
  type Command,
  type Mistake,
  type MistakeInput,
  type Snapshot,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

function localDateTime(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}

export function Mistakes({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Mistake | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(command: Command) {
    setBusy(true);
    setError("");
    try {
      await save(command);
      setEditing(undefined);
    } catch (caught) {
      setError(userError(caught));
    } finally {
      setBusy(false);
    }
  }
  const ordered = [...data.mistakes].sort(
    (a, b) =>
      (a.reviewDue ? Date.parse(a.reviewDue) : Infinity) -
        (b.reviewDue ? Date.parse(b.reviewDue) : Infinity) ||
      a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <section>
      <h1>Mistakes</h1>
      <p>
        Durable study notes for what went wrong. They can prioritize future
        planning and generate a practice task, while remaining separate from
        completion or mastery claims.
      </p>
      <button
        disabled={busy || editing !== undefined}
        onClick={() => {
          setEditing(null);
          setError("");
        }}
      >
        Record a mistake
      </button>
      {error && <p role="alert">{error}</p>}
      {editing !== undefined && (
        <MistakeForm
          data={data}
          existing={editing}
          busy={busy}
          close={() => setEditing(undefined)}
          submit={(input) =>
            void change(
              editing
                ? {
                    type: "mistake.update",
                    id: editing.id,
                    revision: editing.revision,
                    input,
                  }
                : { type: "mistake.create", input },
            )
          }
        />
      )}
      {!ordered.length && <p className="muted">No mistakes recorded yet.</p>}
      {ordered.map((mistake) => (
        <article className="source" key={mistake.id}>
          <h2>{mistake.concept}</h2>
          <p className="muted">
            {data.classes.find((course) => course.id === mistake.classId)
              ?.name ?? "Unknown class"}{" "}
            · Confidence {mistake.confidence} · Review{" "}
            {mistake.reviewDue
              ? new Date(mistake.reviewDue).toLocaleString()
              : "when ready"}
          </p>
          <p>
            <strong>Source:</strong> {mistake.source}
          </p>
          <p>
            <strong>Original attempt:</strong> {mistake.originalAttempt}
          </p>
          <p>
            <strong>What went wrong:</strong> {mistake.whatWentWrong}
          </p>
          <p>
            <strong>Correction:</strong> {mistake.correction}
          </p>
          <p>
            <strong>Help used:</strong> {mistake.helpUsed || "None recorded"}
          </p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditing(mistake);
                setError("");
              }}
            >
              Edit mistake
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "mistake.practice",
                  id: mistake.id,
                  revision: mistake.revision,
                })
              }
            >
              Generate practice
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "mistake.forget",
                  id: mistake.id,
                  revision: mistake.revision,
                })
              }
            >
              Forget mistake
            </button>
          </div>
          {!!mistake.practiceTaskIds.length && (
            <p className="muted">
              Practice tasks:{" "}
              {mistake.practiceTaskIds
                .map((id) => data.tasks.find((task) => task.id === id)?.title)
                .filter(Boolean)
                .join("; ")}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}

function MistakeForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: Mistake | null;
  busy: boolean;
  close: () => void;
  submit: (input: MistakeInput) => void;
}) {
  const [classId, setClassId] = useState(
    existing?.classId ?? data.classes[0]?.id ?? "",
  );
  const [taskId, setTaskId] = useState(existing?.taskId ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const review = String(values.get("reviewDue"));
        submit(
          mistakeInput.parse({
            classId: String(values.get("classId")),
            taskId: String(values.get("taskId")) || null,
            concept: String(values.get("concept")),
            source: String(values.get("source")),
            originalAttempt: String(values.get("originalAttempt")),
            whatWentWrong: String(values.get("whatWentWrong")),
            correction: String(values.get("correction")),
            helpUsed: String(values.get("helpUsed")),
            confidence: String(values.get("confidence")),
            reviewDue: review ? new Date(review).toISOString() : null,
          }),
        );
      }}
    >
      <h2>{existing ? "Edit mistake" : "Record a mistake"}</h2>
      <label>
        Class
        <select
          name="classId"
          aria-label="Mistake class"
          required
          value={classId}
          onChange={(event) => {
            setClassId(event.currentTarget.value);
            setTaskId("");
          }}
        >
          {data.classes.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked assignment (optional)
        <select
          name="taskId"
          aria-label="Mistake assignment"
          value={taskId}
          onChange={(event) => setTaskId(event.currentTarget.value)}
        >
          <option value="">No linked assignment</option>
          {data.tasks
            .filter((task) => task.classId === classId)
            .map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
        </select>
      </label>
      {(
        [
          ["concept", "Concept", existing?.concept ?? ""],
          ["source", "Source", existing?.source ?? ""],
          [
            "originalAttempt",
            "Original attempt",
            existing?.originalAttempt ?? "",
          ],
          ["whatWentWrong", "What went wrong", existing?.whatWentWrong ?? ""],
          ["correction", "Correction", existing?.correction ?? ""],
          ["helpUsed", "Help used", existing?.helpUsed ?? ""],
        ] as const
      ).map(([name, label, value]) => (
        <label key={name}>
          {label}
          <textarea
            name={name}
            aria-label={label}
            required={name !== "helpUsed"}
            maxLength={
              name === "helpUsed" ? 2000 : name === "concept" ? 300 : 5000
            }
            defaultValue={value}
          />
        </label>
      ))}
      <label>
        Confidence
        <select
          name="confidence"
          aria-label="Mistake confidence"
          defaultValue={existing?.confidence ?? "medium"}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label>
        Review due
        <input
          type="datetime-local"
          name="reviewDue"
          aria-label="Mistake review due"
          defaultValue={localDateTime(existing?.reviewDue ?? null)}
        />
      </label>
      <div className="actions">
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          Save mistake
        </button>
      </div>
    </form>
  );
}
