import { SessionCorrection } from "./SessionCorrection";
import { useState } from "react";
import type {
  Command,
  Snapshot,
  StudySession,
  Task,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function SessionReview({
  session,
  task,
  save,
  busy,
  canCorrect,
}: {
  session: StudySession;
  task: Task;
  save: (
    command: Command,
    reportToCaller: boolean,
  ) => Promise<Snapshot | undefined>;
  busy: boolean;
  canCorrect: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  async function confirm(notes: string, remainingMinutes: number | null) {
    setError("");
    try {
      await save(
        { type: "session.review", id: session.id, notes, remainingMinutes },
        true,
      );
    } catch (e) {
      setError(userError(e));
    }
  }
  return (
    <section className="session" aria-label="Session wrap-up">
      <div className="eyebrow">Session saved</div>
      <h2>{task.title}</h2>
      <p>
        {Math.round(session.actualMinutes ?? 0)} min tracked ·{" "}
        {session.completionReported
          ? "You marked this task finished."
          : "Work remains unfinished."}
      </p>
      {session.estimateAtStart && (
        <p>
          {session.estimateAtStart.minutes} min estimated remaining when you
          started.
        </p>
      )}
      <p className="muted">
        Paused time excluded. Understanding and submission haven’t been
        assessed.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const remaining = String(f.get("remaining") ?? "");
            void confirm(
              String(f.get("notes")),
              remaining ? Number(remaining) : null,
            );
          }}
        >
          <label>
            What did you work on, or what needs another look?
            <textarea name="notes" maxLength={20000} />
          </label>
          {!task.completed && (
            <label>
              Minutes still needed (optional)
              <input name="remaining" type="number" min={5} max={2400} />
            </label>
          )}
          <div className="actions">
            <button type="button" onClick={() => setEditing(false)}>
              Back
            </button>
            <button className="primary" disabled={busy}>
              Save review
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void confirm("", null)}
          >
            Looks right
          </button>
          <button onClick={() => setEditing(true)}>Add details</button>
        </div>
      )}
      {!editing && canCorrect && (
        <SessionCorrection
          session={session}
          task={task}
          save={(command) => save(command, true)}
        />
      )}
    </section>
  );
}
