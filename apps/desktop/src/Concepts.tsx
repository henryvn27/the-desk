import { useState } from "react";
import {
  conceptInput,
  type Command,
  type Concept,
  type ConceptInput,
  type Snapshot,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

const statusLabels: Record<Concept["status"], string> = {
  "not-started": "Not started",
  learning: "Learning",
  developing: "Developing",
  strong: "Strong",
  "review-due": "Review due",
};
const preparednessLabels: Record<Concept["preparedness"], string> = {
  "not-ready": "Not ready",
  developing: "Developing",
  "mostly-ready": "Mostly ready",
  ready: "Ready",
  strong: "Strong",
};

function localDateTime(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}

function percentage(concept: Concept) {
  return concept.unaidedTotal
    ? String(
        Math.round((concept.unaidedCorrect / concept.unaidedTotal) * 100),
      ) + "%"
    : "No unaided attempts";
}

export function Concepts({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Concept | null | undefined>();
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
  const ordered = [...data.concepts].sort(
    (a, b) =>
      (a.reviewDue ? Date.parse(a.reviewDue) : Infinity) -
        (b.reviewDue ? Date.parse(b.reviewDue) : Infinity) ||
      a.name.localeCompare(b.name),
  );
  return (
    <section>
      <h1>Concepts &amp; preparedness</h1>
      <p>
        Keep explicit evidence about what you are learning, how ready you feel,
        and what should be reviewed. This record supports planning without
        claiming completion or mastery automatically.
      </p>
      <button
        disabled={busy || editing !== undefined}
        onClick={() => {
          setEditing(null);
          setError("");
        }}
      >
        Add concept
      </button>
      {error && <p role="alert">{error}</p>}
      {editing !== undefined && (
        <ConceptForm
          data={data}
          existing={editing}
          busy={busy}
          close={() => setEditing(undefined)}
          submit={(input) =>
            void change(
              editing
                ? {
                    type: "concept.update",
                    id: editing.id,
                    revision: editing.revision,
                    input,
                  }
                : { type: "concept.create", input },
            )
          }
        />
      )}
      {!ordered.length && <p className="muted">No concepts recorded yet.</p>}
      {ordered.map((concept) => (
        <article className="source" key={concept.id}>
          <h2>{concept.name}</h2>
          <p className="muted">
            {data.classes.find((course) => course.id === concept.classId)
              ?.name ?? "Unknown class"}{" "}
            · Status {statusLabels[concept.status]} · Preparedness{" "}
            {preparednessLabels[concept.preparedness]} · Retention{" "}
            {concept.retentionMode === "long-term" ? "Long-term" : "Course"}
          </p>
          <p>
            <strong>Review:</strong>{" "}
            {concept.reviewDue
              ? new Date(concept.reviewDue).toLocaleString()
              : "When ready"}
            {" · "}
            <strong>Evidence:</strong> {concept.attempts} attempts,{" "}
            {percentage(concept)}, {concept.hintCount} hints
          </p>
          {concept.lastReviewedAt && (
            <p className="muted">
              Last reviewed {new Date(concept.lastReviewedAt).toLocaleString()}
            </p>
          )}
          {concept.evidenceNote && <p>{concept.evidenceNote}</p>}
          {!!concept.taskIds.length && (
            <p className="muted">
              Linked assignments:{" "}
              {concept.taskIds
                .map((id) => data.tasks.find((task) => task.id === id)?.title)
                .filter(Boolean)
                .join("; ")}
            </p>
          )}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditing(concept);
                setError("");
              }}
            >
              Edit concept
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "concept.forget",
                  id: concept.id,
                  revision: concept.revision,
                })
              }
            >
              Forget concept
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function ConceptForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: Concept | null;
  busy: boolean;
  close: () => void;
  submit: (input: ConceptInput) => void;
}) {
  const [classId, setClassId] = useState(
    existing?.classId ?? data.classes[0]?.id ?? "",
  );
  const tasks = data.tasks.filter((task) => task.classId === classId);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const review = String(values.get("reviewDue"));
        const lastReviewed = String(values.get("lastReviewedAt"));
        submit(
          conceptInput.parse({
            classId: String(values.get("classId")),
            taskIds: values.getAll("taskIds").map(String),
            name: String(values.get("name")),
            status: String(values.get("status")),
            preparedness: String(values.get("preparedness")),
            retentionMode: String(values.get("retentionMode")),
            reviewDue: review ? new Date(review).toISOString() : null,
            attempts: Number(values.get("attempts")),
            unaidedCorrect: Number(values.get("unaidedCorrect")),
            unaidedTotal: Number(values.get("unaidedTotal")),
            hintCount: Number(values.get("hintCount")),
            lastReviewedAt: lastReviewed
              ? new Date(lastReviewed).toISOString()
              : null,
            evidenceNote: String(values.get("evidenceNote")),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit concept" : "Add concept"}</h2>
      <label>
        Concept class
        <select
          name="classId"
          aria-label="Concept class"
          required
          value={classId}
          onChange={(event) => setClassId(event.currentTarget.value)}
        >
          {data.classes.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Concept assignments
        <select
          name="taskIds"
          aria-label="Concept assignments"
          multiple
          size={Math.min(6, Math.max(2, tasks.length))}
          defaultValue={existing?.taskIds ?? []}
        >
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Concept name
        <input
          name="name"
          aria-label="Concept name"
          required
          maxLength={300}
          defaultValue={existing?.name ?? ""}
        />
      </label>
      <label>
        Concept status
        <select
          name="status"
          aria-label="Concept status"
          defaultValue={existing?.status ?? "not-started"}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Concept preparedness
        <select
          name="preparedness"
          aria-label="Concept preparedness"
          defaultValue={existing?.preparedness ?? "not-ready"}
        >
          {Object.entries(preparednessLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Concept retention
        <select
          name="retentionMode"
          aria-label="Concept retention"
          defaultValue={existing?.retentionMode ?? "course"}
        >
          <option value="course">Course</option>
          <option value="long-term">Long-term</option>
        </select>
      </label>
      <label>
        Concept review due
        <input
          type="datetime-local"
          name="reviewDue"
          aria-label="Concept review due"
          defaultValue={localDateTime(existing?.reviewDue ?? null)}
        />
      </label>
      <label>
        Concept attempts
        <input
          type="number"
          name="attempts"
          aria-label="Concept attempts"
          min={0}
          max={10000}
          defaultValue={existing?.attempts ?? 0}
        />
      </label>
      <label>
        Unaided correct
        <input
          type="number"
          name="unaidedCorrect"
          aria-label="Unaided correct"
          min={0}
          max={10000}
          defaultValue={existing?.unaidedCorrect ?? 0}
        />
      </label>
      <label>
        Unaided attempts
        <input
          type="number"
          name="unaidedTotal"
          aria-label="Unaided attempts"
          min={0}
          max={10000}
          defaultValue={existing?.unaidedTotal ?? 0}
        />
      </label>
      <label>
        Hint count
        <input
          type="number"
          name="hintCount"
          aria-label="Hint count"
          min={0}
          max={10000}
          defaultValue={existing?.hintCount ?? 0}
        />
      </label>
      <label>
        Concept last reviewed
        <input
          type="datetime-local"
          name="lastReviewedAt"
          aria-label="Concept last reviewed"
          defaultValue={localDateTime(existing?.lastReviewedAt ?? null)}
        />
      </label>
      <label>
        Concept evidence note
        <textarea
          name="evidenceNote"
          aria-label="Concept evidence note"
          maxLength={2000}
          defaultValue={existing?.evidenceNote ?? ""}
        />
      </label>
      <div className="actions">
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          Save concept
        </button>
      </div>
    </form>
  );
}
