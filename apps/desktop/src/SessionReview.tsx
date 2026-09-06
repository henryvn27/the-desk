import { SessionCorrection } from "./SessionCorrection";
import { useState } from "react";
import type {
  Command,
  Concept,
  Snapshot,
  SessionAttemptInput,
  StudySession,
  Task,
} from "../../../packages/domain/contracts";
import { sessionAttemptInput } from "../../../packages/domain/contracts";
import { userError } from "./errors";

export function SessionReview({
  session,
  task,
  concepts,
  save,
  busy,
  canCorrect,
}: {
  session: StudySession;
  task: Task;
  concepts: Concept[];
  save: (
    command: Command,
    reportToCaller: boolean,
  ) => Promise<Snapshot | undefined>;
  busy: boolean;
  canCorrect: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [error, setError] = useState("");
  async function confirm(
    notes: string,
    remainingMinutes: number | null,
    attempts: SessionAttemptInput[] = [],
  ) {
    setError("");
    try {
      await save(
        {
          type: "session.review",
          id: session.id,
          notes,
          remainingMinutes,
          attempts,
        },
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
      {!!session.checklistAtEnd?.length && (
        <p>
          {session.checklistAtEnd.filter((item) => item.completed).length} of{" "}
          {session.checklistAtEnd.length} steps were checked when this session
          ended.
        </p>
      )}
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
            let attempts: SessionAttemptInput[] = [];
            try {
              if (evidenceOpen)
                attempts = [
                  sessionAttemptInput.parse({
                    conceptIds: f.getAll("evidenceConceptIds").map(String),
                    result: String(f.get("evidenceResult")),
                    unaided: f.get("evidenceUnaided") === "on",
                    hintCount: Number(f.get("evidenceHints")),
                    notes: String(f.get("evidenceNotes")),
                  }),
                ];
            } catch (caught) {
              setError(userError(caught));
              return;
            }
            void confirm(String(f.get("notes")), remaining ? Number(remaining) : null, attempts);
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
            <button
              type="button"
              onClick={() => setEvidenceOpen((open) => !open)}
            >
              {evidenceOpen ? "Remove learning evidence" : "Record a checked attempt"}
            </button>
          </div>
          {evidenceOpen && (
            <fieldset>
              <legend>Learning evidence · optional</legend>
              <p className="muted">
                This records what you checked. It does not claim mastery or
                submission.
              </p>
              <label>
                Concepts involved
                <select
                  name="evidenceConceptIds"
                  multiple
                  size={Math.min(5, Math.max(2, concepts.length))}
                >
                  {concepts.map((concept) => (
                    <option key={concept.id} value={concept.id}>
                      {concept.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Result
                <select name="evidenceResult" defaultValue="unknown">
                  <option value="correct">Correct</option>
                  <option value="partial">Partially correct</option>
                  <option value="incorrect">Incorrect</option>
                  <option value="unknown">Not yet checked</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  name="evidenceUnaided"
                  defaultChecked
                />{" "}
                Solved without a hint
              </label>
              <label>
                Hints used
                <input name="evidenceHints" type="number" min={0} max={10000} defaultValue={0} />
              </label>
              <label>
                Evidence note
                <textarea name="evidenceNotes" maxLength={5000} />
              </label>
            </fieldset>
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
