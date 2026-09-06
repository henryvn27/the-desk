import { useState } from "react";
import {
  teacherInput,
  type Command,
  type Snapshot,
  type Teacher,
  type TeacherInput,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function Teachers({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Teacher | null | undefined>();
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
  return (
    <section>
      <h1>Teachers</h1>
      <p>
        Keep teacher identity separate from teacher-reported evidence and Desk
        inference. A teacher can be linked to multiple classes and referenced by
        evidence without implying any inferred grading pattern.
      </p>
      <button
        disabled={busy || editing !== undefined}
        onClick={() => {
          setEditing(null);
          setError("");
        }}
      >
        Add teacher
      </button>
      {error && <p role="alert">{error}</p>}
      {editing !== undefined && (
        <TeacherForm
          data={data}
          existing={editing}
          busy={busy}
          close={() => setEditing(undefined)}
          submit={(input) =>
            void change(
              editing
                ? {
                    type: "teacher.update",
                    id: editing.id,
                    revision: editing.revision,
                    input,
                  }
                : { type: "teacher.create", input },
            )
          }
        />
      )}
      {!data.teachers.length && (
        <p className="muted">No teachers recorded yet.</p>
      )}
      {data.teachers.map((teacher) => {
        const evidenceCount = data.teacherEvidence.filter(
          (evidence) => evidence.teacherId === teacher.id,
        ).length;
        return (
          <article className="source" key={teacher.id}>
            <h2>{teacher.name}</h2>
            <p className="muted">
              {teacher.classIds
                .map(
                  (classId) =>
                    data.classes.find((course) => course.id === classId)?.name,
                )
                .filter(Boolean)
                .join(" · ")}
              {teacher.email && ` · ${teacher.email}`}
            </p>
            {teacher.notes && <p>{teacher.notes}</p>}
            <p className="muted">
              {evidenceCount} linked teacher-evidence record
              {evidenceCount === 1 ? "" : "s"}. Desk pattern inference remains
              separate.
            </p>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(teacher);
                  setError("");
                }}
              >
                Edit teacher
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void change({
                    type: "teacher.forget",
                    id: teacher.id,
                    revision: teacher.revision,
                  })
                }
              >
                Forget teacher
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function TeacherForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: Teacher | null;
  busy: boolean;
  close: () => void;
  submit: (input: TeacherInput) => void;
}) {
  return (
    <form
      key={existing?.id ?? "new-teacher"}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        submit(
          teacherInput.parse({
            name: String(values.get("name")),
            email: String(values.get("email")).trim() || null,
            notes: String(values.get("notes")),
            classIds: values.getAll("classIds").map(String),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit teacher" : "Add teacher"}</h2>
      <label>
        Teacher name
        <input
          name="name"
          aria-label="Teacher name"
          required
          maxLength={200}
          defaultValue={existing?.name ?? ""}
        />
      </label>
      <label>
        Email (optional)
        <input
          name="email"
          aria-label="Teacher email"
          type="email"
          maxLength={500}
          defaultValue={existing?.email ?? ""}
        />
      </label>
      <fieldset>
        <legend>Classes</legend>
        {data.classes.map((course) => (
          <label className="check" key={course.id}>
            <input
              type="checkbox"
              name="classIds"
              value={course.id}
              defaultChecked={existing?.classIds.includes(course.id)}
            />
            {course.name}
          </label>
        ))}
      </fieldset>
      <label>
        Notes
        <textarea
          name="notes"
          aria-label="Teacher notes"
          maxLength={5000}
          defaultValue={existing?.notes ?? ""}
        />
      </label>
      <div className="actions">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy || !data.classes.length}>
          Save teacher
        </button>
      </div>
    </form>
  );
}
