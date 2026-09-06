import { useState } from "react";
import {
  attemptInput,
  type Attempt,
  type AttemptInput,
  type Command,
  type Snapshot,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

const resultLabels: Record<Attempt["result"], string> = {
  correct: "Correct",
  incorrect: "Incorrect",
  partial: "Partially correct",
  unknown: "Not yet checked",
};

function localDateTime(value: string) {
  return new Date(value).toISOString().slice(0, 16);
}

export function Attempts({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Attempt | null | undefined>();
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
  const ordered = [...data.attempts].sort(
    (a, b) =>
      Date.parse(b.attemptedAt) - Date.parse(a.attemptedAt) ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <section>
      <h1>Attempts</h1>
      <p>
        Record checked work as evidence. An attempt can update linked concept
        counters while keeping completion, submission, mastery and preparedness
        distinct.
      </p>
      <button
        disabled={busy || editing !== undefined}
        onClick={() => {
          setEditing(null);
          setError("");
        }}
      >
        Record attempt
      </button>
      {error && <p role="alert">{error}</p>}
      {editing !== undefined && (
        <AttemptForm
          data={data}
          existing={editing}
          busy={busy}
          close={() => setEditing(undefined)}
          submit={(input) =>
            void change(
              editing
                ? {
                    type: "attempt.update",
                    id: editing.id,
                    revision: editing.revision,
                    input,
                  }
                : { type: "attempt.create", input },
            )
          }
        />
      )}
      {!ordered.length && <p className="muted">No attempts recorded yet.</p>}
      {ordered.map((attempt) => (
        <article className="source" key={attempt.id}>
          <h2>{resultLabels[attempt.result]}</h2>
          <p className="muted">
            {data.classes.find((course) => course.id === attempt.classId)
              ?.name ?? "Unknown class"}{" "}
            ·{" "}
            {attempt.taskId
              ? (data.tasks.find((task) => task.id === attempt.taskId)?.title ??
                "Unknown assignment")
              : "No linked assignment"}{" "}
            · {new Date(attempt.attemptedAt).toLocaleString()}
          </p>
          <p>
            {attempt.unaided ? "Unaided" : "Aided"} · {attempt.hintCount} hints
            {attempt.conceptIds.length > 0 && (
              <>
                {" · "}
                {attempt.conceptIds
                  .map(
                    (id) =>
                      data.concepts.find((concept) => concept.id === id)?.name,
                  )
                  .filter(Boolean)
                  .join("; ")}
              </>
            )}
          </p>
          {attempt.notes && <p>{attempt.notes}</p>}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditing(attempt);
                setError("");
              }}
            >
              Edit attempt
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "attempt.forget",
                  id: attempt.id,
                  revision: attempt.revision,
                })
              }
            >
              Forget attempt
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function AttemptForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: Attempt | null;
  busy: boolean;
  close: () => void;
  submit: (input: AttemptInput) => void;
}) {
  const [classId, setClassId] = useState(
    existing?.classId ?? data.classes[0]?.id ?? "",
  );
  const [taskId, setTaskId] = useState(existing?.taskId ?? "");
  const tasks = data.tasks.filter((task) => task.classId === classId);
  const concepts = data.concepts.filter(
    (concept) => concept.classId === classId,
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        submit(
          attemptInput.parse({
            classId: String(values.get("classId")),
            taskId: String(values.get("taskId")) || null,
            conceptIds: values.getAll("conceptIds").map(String),
            result: String(values.get("result")),
            unaided: values.get("unaided") === "on",
            hintCount: Number(values.get("hintCount")),
            notes: String(values.get("notes")),
            attemptedAt: new Date(
              String(values.get("attemptedAt")),
            ).toISOString(),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit attempt" : "Record attempt"}</h2>
      <label>
        Attempt class
        <select
          name="classId"
          aria-label="Attempt class"
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
        Attempt assignment
        <select
          name="taskId"
          aria-label="Attempt assignment"
          value={taskId}
          onChange={(event) => setTaskId(event.currentTarget.value)}
        >
          <option value="">No linked assignment</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Attempt concepts
        <select
          name="conceptIds"
          aria-label="Attempt concepts"
          multiple
          size={Math.min(6, Math.max(2, concepts.length))}
          defaultValue={existing?.conceptIds ?? []}
        >
          {concepts.map((concept) => (
            <option key={concept.id} value={concept.id}>
              {concept.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Attempt result
        <select
          name="result"
          aria-label="Attempt result"
          defaultValue={existing?.result ?? "unknown"}
        >
          {Object.entries(resultLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          name="unaided"
          aria-label="Attempt unaided"
          defaultChecked={existing?.unaided ?? true}
        />{" "}
        Solved unaided
      </label>
      <label>
        Attempt hint count
        <input
          type="number"
          name="hintCount"
          aria-label="Attempt hint count"
          min={0}
          max={10000}
          defaultValue={existing?.hintCount ?? 0}
        />
      </label>
      <label>
        Attempt notes
        <textarea
          name="notes"
          aria-label="Attempt notes"
          maxLength={5000}
          defaultValue={existing?.notes ?? ""}
        />
      </label>
      <label>
        Attempted at
        <input
          type="datetime-local"
          name="attemptedAt"
          aria-label="Attempted at"
          required
          defaultValue={localDateTime(
            existing?.attemptedAt ?? new Date().toISOString(),
          )}
        />
      </label>
      <div className="actions">
        <button type="button" disabled={busy} onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          Save attempt
        </button>
      </div>
    </form>
  );
}
