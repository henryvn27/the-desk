import { useState } from "react";
import {
  evidenceKind,
  evidenceSource,
  teacherEvidenceInput,
  type Command,
  type Snapshot,
  type TeacherEvidence,
  type TeacherEvidenceInput,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

const kindLabels: Record<TeacherEvidence["kind"], string> = {
  "graded-work": "Graded work",
  "teacher-feedback": "Teacher feedback",
  rubric: "Rubric",
  other: "Other",
};
const sourceLabels: Record<TeacherEvidence["source"], string> = {
  manual: "Manual report",
  "text-import": "Imported text",
  "image-import": "Imported image (metadata only)",
};

function localDateTime(value: string) {
  return new Date(value).toISOString().slice(0, 16);
}

export function Evidence({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<TeacherEvidence | null | undefined>();
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
  const ordered = [...data.teacherEvidence].sort(
    (a, b) =>
      Date.parse(b.capturedAt) - Date.parse(a.capturedAt) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  return (
    <section>
      <h1>Teacher evidence</h1>
      <p>
        Keep teacher-reported scores, feedback and rubrics separate from Desk
        inference. This record preserves what the evidence supports; image and
        OCR extraction remain unavailable until an approved provider path is
        ready.
      </p>
      <button
        disabled={busy || editing !== undefined}
        onClick={() => {
          setEditing(null);
          setError("");
        }}
      >
        Add teacher evidence
      </button>
      {error && <p role="alert">{error}</p>}
      {editing !== undefined && (
        <EvidenceForm
          data={data}
          existing={editing}
          busy={busy}
          close={() => setEditing(undefined)}
          submit={(input) =>
            void change(
              editing
                ? {
                    type: "evidence.update",
                    id: editing.id,
                    revision: editing.revision,
                    input,
                  }
                : { type: "evidence.create", input },
            )
          }
        />
      )}
      {!ordered.length && (
        <p className="muted">No teacher evidence recorded yet.</p>
      )}
      {ordered.map((evidence) => (
        <article className="source" key={evidence.id}>
          <h2>{evidence.title}</h2>
          <p className="muted">
            {data.classes.find((course) => course.id === evidence.classId)
              ?.name ?? "Unknown class"}{" "}
            · {kindLabels[evidence.kind]} · {sourceLabels[evidence.source]} ·{" "}
            {new Date(evidence.capturedAt).toLocaleString()}
          </p>
          <p>
            {evidence.teacherId
              ? `Teacher: ${data.teachers.find((teacher) => teacher.id === evidence.teacherId)?.name ?? "Unknown"}`
              : "No teacher linked"}
            {" · "}
            {evidence.assessmentId
              ? `Assessment: ${data.assessments.find((assessment) => assessment.id === evidence.assessmentId)?.title ?? "Unknown"}`
              : "No assessment linked"}
            {evidence.taskId &&
              ` · Task: ${data.tasks.find((task) => task.id === evidence.taskId)?.title ?? "Unknown"}`}
          </p>
          {evidence.scoreEarned !== null && evidence.scorePossible !== null && (
            <p>
              <strong>Score:</strong> {evidence.scoreEarned}/
              {evidence.scorePossible}
            </p>
          )}
          {evidence.teacherComments && (
            <p>
              <strong>Teacher comments:</strong> {evidence.teacherComments}
            </p>
          )}
          {evidence.rubric && (
            <p>
              <strong>Rubric:</strong> {evidence.rubric}
            </p>
          )}
          {evidence.observations && <p>{evidence.observations}</p>}
          <p className="muted">
            {evidence.includeInTeacherModeling
              ? "Included in future teacher-pattern review"
              : "Excluded from future teacher-pattern review"}
          </p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditing(evidence);
                setError("");
              }}
            >
              Edit evidence
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void change({
                  type: "evidence.forget",
                  id: evidence.id,
                  revision: evidence.revision,
                })
              }
            >
              Forget evidence
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function EvidenceForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: TeacherEvidence | null;
  busy: boolean;
  close: () => void;
  submit: (input: TeacherEvidenceInput) => void;
}) {
  const [classId, setClassId] = useState(
    existing?.classId ?? data.classes[0]?.id ?? "",
  );
  const tasks = data.tasks.filter((task) => task.classId === classId);
  const assessments = data.assessments.filter(
    (assessment) => assessment.classId === classId,
  );
  const concepts = data.concepts.filter(
    (concept) => concept.classId === classId,
  );
  const teachers = data.teachers.filter((teacher) =>
    teacher.classIds.includes(classId),
  );
  return (
    <form
      key={existing?.id ?? "new-evidence"}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const earned = String(values.get("scoreEarned"));
        const possible = String(values.get("scorePossible"));
        submit(
          teacherEvidenceInput.parse({
            classId: String(values.get("classId")),
            teacherId: String(values.get("teacherId")) || null,
            assessmentId: String(values.get("assessmentId")) || null,
            taskId: String(values.get("taskId")) || null,
            title: String(values.get("title")),
            kind: String(values.get("kind")),
            source: String(values.get("source")),
            scoreEarned: earned ? Number(earned) : null,
            scorePossible: possible ? Number(possible) : null,
            teacherComments: String(values.get("teacherComments")),
            rubric: String(values.get("rubric")),
            observations: String(values.get("observations")),
            conceptIds: values.getAll("conceptIds").map(String),
            includeInTeacherModeling:
              values.get("includeInTeacherModeling") === "on",
            capturedAt: new Date(
              String(values.get("capturedAt")),
            ).toISOString(),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit teacher evidence" : "Add teacher evidence"}</h2>
      <label>
        Evidence class
        <select
          name="classId"
          aria-label="Evidence class"
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
        Evidence title
        <input
          name="title"
          aria-label="Evidence title"
          required
          maxLength={500}
          defaultValue={existing?.title ?? ""}
        />
      </label>
      <label>
        Evidence type
        <select
          name="kind"
          aria-label="Evidence type"
          defaultValue={existing?.kind ?? evidenceKind.enum["graded-work"]}
        >
          {Object.entries(kindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Evidence source
        <select
          name="source"
          aria-label="Evidence source"
          defaultValue={existing?.source ?? evidenceSource.enum.manual}
        >
          {Object.entries(sourceLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Teacher (optional)
        <select
          name="teacherId"
          aria-label="Evidence teacher"
          defaultValue={existing?.teacherId ?? ""}
        >
          <option value="">No linked teacher</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked assessment
        <select
          name="assessmentId"
          aria-label="Evidence assessment"
          defaultValue={existing?.assessmentId ?? ""}
        >
          <option value="">No linked assessment</option>
          {assessments.map((assessment) => (
            <option key={assessment.id} value={assessment.id}>
              {assessment.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked task
        <select
          name="taskId"
          aria-label="Evidence task"
          defaultValue={existing?.taskId ?? ""}
        >
          <option value="">No linked task</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Score earned (optional)
        <input
          name="scoreEarned"
          aria-label="Score earned"
          type="number"
          min="0"
          step="any"
          defaultValue={existing?.scoreEarned ?? ""}
        />
      </label>
      <label>
        Score possible (optional)
        <input
          name="scorePossible"
          aria-label="Score possible"
          type="number"
          min="0.01"
          step="any"
          defaultValue={existing?.scorePossible ?? ""}
        />
      </label>
      <label>
        Teacher comments
        <textarea
          name="teacherComments"
          aria-label="Teacher comments"
          maxLength={10000}
          defaultValue={existing?.teacherComments ?? ""}
        />
      </label>
      <label>
        Rubric
        <textarea
          name="rubric"
          aria-label="Evidence rubric"
          maxLength={10000}
          defaultValue={existing?.rubric ?? ""}
        />
      </label>
      <label>
        Observed questions, markings and patterns
        <textarea
          name="observations"
          aria-label="Evidence observations"
          maxLength={10000}
          defaultValue={existing?.observations ?? ""}
        />
      </label>
      <label>
        Evidence concepts
        <select
          name="conceptIds"
          aria-label="Evidence concepts"
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
        Captured at
        <input
          name="capturedAt"
          aria-label="Evidence captured at"
          type="datetime-local"
          required
          defaultValue={localDateTime(
            existing?.capturedAt ?? new Date().toISOString(),
          )}
        />
      </label>
      <label>
        <input
          name="includeInTeacherModeling"
          aria-label="Include in teacher modeling"
          type="checkbox"
          defaultChecked={existing?.includeInTeacherModeling ?? true}
        />{" "}
        Include this evidence in future teacher-pattern review
      </label>
      <button disabled={busy}>Save teacher evidence</button>{" "}
      <button type="button" disabled={busy} onClick={close}>
        Cancel
      </button>
    </form>
  );
}
