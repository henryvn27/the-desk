import { useState } from "react";
import type {
  Command,
  StudySession,
  Task,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function SessionCorrection({
  session,
  task,
  save,
}: {
  session: StudySession;
  task: Task;
  save: (command: Command) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<{
    completed: boolean;
    revision: number;
    taskRevision: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!draft)
    return (
      <button
        onClick={() => {
          setError("");
          setDraft({
            completed: session.completionReported ?? task.completed,
            revision: session.revision ?? 0,
            taskRevision: task.revision ?? 0,
          });
        }}
      >
        Correct completion
      </button>
    );
  return (
    <form
      aria-label="Correct session completion"
      onSubmit={async (e) => {
        e.preventDefault();
        const values = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await save({
            type: "session.correct",
            id: session.id,
            ...draft,
            remainingMinutes: draft.completed
              ? null
              : Number(values.get("remaining")),
            notes: String(values.get("notes")),
          });
          setDraft(undefined);
        } catch (error) {
          setError(userError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Correct the task’s status and remaining work. Recorded study time is
        retained.
      </p>
      <label>
        Task status
        <select
          aria-label="Task status"
          value={draft.completed ? "finished" : "unfinished"}
          onChange={(e) =>
            setDraft({ ...draft, completed: e.target.value === "finished" })
          }
        >
          <option value="finished">I finished this task</option>
          <option value="unfinished">There is still work to do</option>
        </select>
      </label>
      {!draft.completed && (
        <label>
          Minutes still needed
          <input
            name="remaining"
            type="number"
            min={5}
            max={2400}
            required
            defaultValue={task.minutes}
          />
        </label>
      )}
      <label>
        Session notes
        <textarea
          aria-label="Session notes"
          name="notes"
          maxLength={20000}
          defaultValue={session.review?.notes ?? ""}
        />
      </label>
      <p className="muted">
        Completion is your report; it does not confirm submission or
        understanding.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => setDraft(undefined)}
        >
          Cancel correction
        </button>
        <button className="primary" disabled={busy}>
          Save correction
        </button>
      </div>
    </form>
  );
}
