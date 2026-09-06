import { useState } from "react";
import {
  authorityClaimInput,
  type AuthorityClaim,
  type AuthorityClaimInput,
  type Command,
  type Snapshot,
} from "../../../packages/domain/contracts";
import {
  authorityKind,
  authorityKindLabels,
  authorityPriority,
} from "../../../packages/intelligence/authority";
import { userError } from "./errors";

function localDateTime(value: string | null | undefined) {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}

function displayDue(value: string | null) {
  return value ? new Date(value).toLocaleString() : "No due date recorded";
}

export function Authority({
  data,
  save,
}: {
  data: Snapshot;
  save: (command: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<AuthorityClaim | null | undefined>();
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

  const grouped = data.tasks
    .map((task) => ({
      task,
      claims: data.authorityClaims
        .filter((claim) => claim.taskId === task.id)
        .sort(
          (a, b) =>
            authorityPriority(a.authorityKind) -
              authorityPriority(b.authorityKind) ||
            b.capturedAt.localeCompare(a.capturedAt) ||
            a.id.localeCompare(b.id),
        ),
    }))
    .filter(({ claims }) => claims.length > 0);

  return (
    <section>
      <h1>Authority &amp; conflicts</h1>
      <p>
        Keep competing due-date reports visible. Desk recommends a contextual
        order, but it never changes an important deadline until you choose a
        claim.
      </p>
      <button
        disabled={busy || editing !== undefined}
        onClick={() => {
          setEditing(null);
          setError("");
        }}
      >
        Add due-date claim
      </button>
      {error && <p role="alert">{error}</p>}
      {editing !== undefined && (
        <AuthorityForm
          data={data}
          existing={editing}
          busy={busy}
          close={() => setEditing(undefined)}
          submit={(input) =>
            void change(
              editing
                ? {
                    type: "authority.claim.update",
                    id: editing.id,
                    revision: editing.revision,
                    input,
                  }
                : { type: "authority.claim.create", input },
            )
          }
        />
      )}
      {!grouped.length && (
        <p className="muted">No authority claims recorded yet.</p>
      )}
      {grouped.map(({ task, claims }) => {
        const resolution = data.authorityResolutions.find(
          (item) => item.taskId === task.id && item.fact === "due-date",
        );
        const conflict =
          new Set(claims.map((claim) => claim.value ?? "")).size > 1;
        return (
          <article className="source" key={task.id}>
            <h2>{task.title}</h2>
            <p className="muted">
              {data.classes.find((course) => course.id === task.classId)?.name}{" "}
              · Current assignment due: {displayDue(task.dueAt)}
            </p>
            {conflict && (
              <p role="alert">
                Conflicting due dates are preserved. Choose one claim to apply;
                Desk will not silently resolve this disagreement.
              </p>
            )}
            {resolution && (
              <p role="status">
                Applied by explicit choice from the selected claim at{" "}
                {new Date(resolution.resolvedAt).toLocaleString()}.
              </p>
            )}
            {claims.map((claim) => (
              <div className="row" key={claim.id}>
                <div>
                  <strong>{claim.sourceLabel}</strong>
                  <div className="muted">
                    {authorityKindLabels[claim.authorityKind]} · confidence{" "}
                    {claim.confidence} · captured{" "}
                    {new Date(claim.capturedAt).toLocaleDateString()}
                  </div>
                  <div>{displayDue(claim.value)}</div>
                  {claim.details && <div>{claim.details}</div>}
                </div>
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      void change({
                        type: "authority.resolve",
                        taskId: task.id,
                        claimId: claim.id,
                        claimRevision: claim.revision,
                        taskRevision: task.revision ?? 0,
                        resolutionApproved: true,
                      });
                    }}
                  >
                    {resolution?.claimId === claim.id
                      ? "Applied"
                      : "Use this due date"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(claim);
                      setError("");
                    }}
                  >
                    Edit claim
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void change({
                        type: "authority.claim.forget",
                        id: claim.id,
                        revision: claim.revision,
                      })
                    }
                  >
                    Forget claim
                  </button>
                </div>
              </div>
            ))}
          </article>
        );
      })}
    </section>
  );
}

function AuthorityForm({
  data,
  existing,
  busy,
  close,
  submit,
}: {
  data: Snapshot;
  existing: AuthorityClaim | null;
  busy: boolean;
  close: () => void;
  submit: (input: AuthorityClaimInput) => void;
}) {
  const [classId, setClassId] = useState(
    existing?.classId ?? data.classes[0]?.id ?? "",
  );
  const tasks = data.tasks.filter((task) => task.classId === classId);
  const selectedTaskId = existing?.taskId ?? tasks[0]?.id ?? "";
  const linkedSources = data.sources.filter(
    (source) =>
      source.classIds.includes(classId) ||
      source.taskIds.includes(selectedTaskId),
  );
  const linkedEvidence = data.teacherEvidence.filter(
    (evidence) =>
      evidence.classId === classId &&
      (!evidence.taskId || evidence.taskId === selectedTaskId),
  );
  return (
    <form
      key={existing?.id ?? "new-authority-claim"}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const value = String(values.get("value"));
        submit(
          authorityClaimInput.parse({
            classId: String(values.get("classId")),
            taskId: String(values.get("taskId")),
            fact: "due-date",
            value: value ? new Date(value).toISOString() : null,
            authorityKind: String(values.get("authorityKind")),
            confidence: String(values.get("confidence")),
            sourceLabel: String(values.get("sourceLabel")),
            details: String(values.get("details")),
            sourceId: String(values.get("sourceId")) || null,
            evidenceId: String(values.get("evidenceId")) || null,
            capturedAt: new Date(
              String(values.get("capturedAt")),
            ).toISOString(),
          }),
        );
      }}
    >
      <h2>{existing ? "Edit due-date claim" : "Add due-date claim"}</h2>
      <label>
        Claim class
        <select
          name="classId"
          aria-label="Claim class"
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
        Claim assignment
        <select
          name="taskId"
          aria-label="Claim assignment"
          required
          defaultValue={selectedTaskId}
          disabled={!!existing}
        >
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
        {existing && (
          <input type="hidden" name="taskId" value={selectedTaskId} />
        )}
      </label>
      <label>
        Authority class
        <select
          name="authorityKind"
          aria-label="Authority class"
          defaultValue={existing?.authorityKind ?? "teacher-update"}
        >
          {authorityKind.options.map((kind) => (
            <option key={kind} value={kind}>
              {authorityKindLabels[kind]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        This order is a recommendation. It does not decide conflicts for you.
      </p>
      <label>
        Reported due date
        <input
          name="value"
          aria-label="Reported due date"
          type="datetime-local"
          defaultValue={localDateTime(existing?.value)}
        />
      </label>
      <label>
        Confidence
        <select
          name="confidence"
          aria-label="Claim confidence"
          defaultValue={existing?.confidence ?? "medium"}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label>
        Source label
        <input
          name="sourceLabel"
          aria-label="Claim source label"
          required
          maxLength={500}
          defaultValue={existing?.sourceLabel ?? ""}
          placeholder="e.g. Classroom announcement"
        />
      </label>
      <label>
        Details
        <textarea
          name="details"
          aria-label="Claim details"
          maxLength={10000}
          defaultValue={existing?.details ?? ""}
        />
      </label>
      <label>
        Linked source (optional)
        <select
          name="sourceId"
          aria-label="Claim source"
          defaultValue={existing?.sourceId ?? ""}
        >
          <option value="">No linked source</option>
          {linkedSources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked teacher evidence (optional)
        <select
          name="evidenceId"
          aria-label="Claim teacher evidence"
          defaultValue={existing?.evidenceId ?? ""}
        >
          <option value="">No linked teacher evidence</option>
          {linkedEvidence.map((evidence) => (
            <option key={evidence.id} value={evidence.id}>
              {evidence.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Captured at
        <input
          name="capturedAt"
          aria-label="Claim captured at"
          type="datetime-local"
          required
          defaultValue={
            localDateTime(existing?.capturedAt) ||
            localDateTime(new Date().toISOString())
          }
        />
      </label>
      <div className="actions">
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button className="primary" disabled={busy || !tasks.length}>
          Save claim
        </button>
      </div>
    </form>
  );
}
