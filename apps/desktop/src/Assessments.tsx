import { useState } from "react";
import {
  assessmentInput,
  type Assessment,
  type AssessmentInput,
  type Command,
  type Snapshot,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

const kindLabels: Record<Assessment["kind"], string> = {
  quiz: "Quiz",
  test: "Test",
  exam: "Exam",
  final: "Final",
  midterm: "Midterm",
  project: "Project",
  essay: "Essay",
  lab: "Lab",
  presentation: "Presentation",
  "standardized-test": "Standardized test",
  other: "Other",
};

function localDateTime(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}

export function Assessments({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Assessment | null | undefined>();
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
  const ordered = [...data.assessments].sort(
    (a, b) =>
      (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
        (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  return (
    <section>
      <h1>Assessments</h1>
      <p>
        Keep quizzes, tests, exams and other graded work distinct from their
        assignments. Link preparation tasks and record only evidence you can
        support.
      </p>
      <button
        disabled={busy || editing !== undefined}
        onClick={() => {
          setEditing(null);
          setError("");
        }}
      >
        Add assessment
      </button>
      {error && <p role="alert">{error}</p>}
      {editing !== undefined && (
        <AssessmentForm
          data={data}
          existing={editing}
          busy={busy}
          close={() => setEditing(undefined)}
          submit={(input) =>
            void change(
              editing
                ? {
                    type: "assessment.update",
                    id: editing.id,
                    revision: editing.revision,
                    input,
                  }
                : { type: "assessment.create", input },
            )
          }
        />
      )}
      {!ordered.length && <p className="muted">No assessments recorded yet.</p>}
      {ordered.map((assessment) => (
        <article className="source" key={assessment.id}>
          <h2>{assessment.title}</h2>
          <p className="muted">
            {kindLabels[assessment.kind]} ·{" "}
            {assessment.dueAt
              ? new Date(assessment.dueAt).toLocaleString()
              : "No date recorded"}
          </p>
          <p>
            {assessment.taskIds.length
              ? `${assessment.taskIds.length} preparation task${assessment.taskIds.length === 1 ? "" : "s"}`
              : "No preparation tasks linked"}
            {assessment.gradeCategoryId && " · linked grade category"}
          </p>
          {assessment.notes && <p>{assessment.notes}</p>}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditing(assessment);
                setError("");
              }}
            >
              Edit assessment
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "assessment.forget",
                  id: assessment.id,
                  revision: assessment.revision,
                })
              }
            >
              Forget assessment
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function AssessmentForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: Assessment | null;
  busy: boolean;
  close: () => void;
  submit: (input: AssessmentInput) => void;
}) {
  const [classId, setClassId] = useState(
    existing?.classId ?? data.classes[0]?.id ?? "",
  );
  const tasks = data.tasks.filter((task) => task.classId === classId);
  const categories = data.gradeCategories.filter(
    (category) => category.classId === classId,
  );
  return (
    <form
      key={existing?.id ?? "new-assessment"}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const due = String(values.get("dueAt"));
        submit(
          assessmentInput.parse({
            classId: String(values.get("classId")),
            title: String(values.get("title")),
            kind: String(values.get("kind")),
            taskIds: values.getAll("taskIds").map(String),
            dueAt: due ? new Date(due).toISOString() : null,
            gradeCategoryId: String(values.get("gradeCategoryId")) || null,
            notes: String(values.get("notes")),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit assessment" : "Add assessment"}</h2>
      <label>
        Assessment class
        <select
          name="classId"
          aria-label="Assessment class"
          required
          value={classId}
          disabled={!!existing}
          onChange={(event) => setClassId(event.currentTarget.value)}
        >
          {data.classes.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
        {existing && <input type="hidden" name="classId" value={classId} />}
      </label>
      <label>
        Assessment title
        <input
          name="title"
          aria-label="Assessment title"
          required
          maxLength={500}
          defaultValue={existing?.title ?? ""}
        />
      </label>
      <label>
        Assessment type
        <select
          name="kind"
          aria-label="Assessment type"
          defaultValue={existing?.kind ?? "test"}
        >
          {Object.entries(kindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assessment tasks
        <select
          name="taskIds"
          aria-label="Assessment tasks"
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
        Assessment due
        <input
          name="dueAt"
          aria-label="Assessment due"
          type="datetime-local"
          defaultValue={localDateTime(existing?.dueAt ?? null)}
        />
      </label>
      <label>
        Assessment grade category
        <select
          name="gradeCategoryId"
          aria-label="Assessment grade category"
          defaultValue={existing?.gradeCategoryId ?? ""}
        >
          <option value="">No linked grade category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assessment notes
        <textarea
          name="notes"
          aria-label="Assessment notes"
          maxLength={5000}
          defaultValue={existing?.notes ?? ""}
        />
      </label>
      <button disabled={busy}>Save assessment</button>{" "}
      <button type="button" disabled={busy} onClick={close}>
        Cancel
      </button>
    </form>
  );
}
