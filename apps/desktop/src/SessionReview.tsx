import { SessionCorrection } from "./SessionCorrection";
import { useState } from "react";
import type {
  Command,
  Concept,
  ConfidenceCaptureInput,
  Snapshot,
  SessionAttemptInput,
  StudySession,
  Task,
} from "../../../packages/domain/contracts";
import {
  confidenceCaptureInput,
  sessionAttemptInput,
} from "../../../packages/domain/contracts";
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
  const [confidenceOpen, setConfidenceOpen] = useState(false);
  const [error, setError] = useState("");
  async function confirm(
    notes: string,
    remainingMinutes: number | null,
    attempts: SessionAttemptInput[] = [],
    confidence?: ConfidenceCaptureInput,
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
          confidence,
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
      {session.summary && (
        <details className="session-summary" open>
          <summary>What this session established</summary>
          <p>
            {session.summary.completedActivityCount} of {session.summary.activityCount} planned moves completed · {session.summary.checkedAttemptCount} checked attempt{session.summary.checkedAttemptCount === 1 ? "" : "s"} · {session.summary.hintCount} hint{session.summary.hintCount === 1 ? "" : "s"} logged.
          </p>
          <p>
            Next: {session.summary.nextAction.replaceAll("-", " ")}. Evidence is {session.summary.evidenceQuality}.
          </p>
          <ul>
            {session.summary.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
          </ul>
        </details>
      )}
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
            let confidence: ConfidenceCaptureInput | undefined;
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
            if (confidenceOpen) {
              try {
                confidence = confidenceCaptureInput.parse({
                  rating: Number(f.get("confidenceRating")),
                  conceptIds: f.getAll("confidenceConceptIds").map(String),
                });
              } catch (caught) {
                setError(userError(caught));
                return;
              }
            }
            void confirm(
              String(f.get("notes")),
              remaining ? Number(remaining) : null,
              attempts,
              confidence,
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
          {concepts.length > 0 && (
            <div className="actions">
              <button
                type="button"
                onClick={() => setConfidenceOpen((open) => !open)}
              >
                {confidenceOpen ? "Remove confidence check" : "Add confidence check"}
              </button>
            </div>
          )}
          {confidenceOpen && concepts.length > 0 && (
            <fieldset>
              <legend>Confidence check · optional</legend>
              <p className="muted">
                Predict how well you can perform the selected concepts, then
                compare it with a checked attempt later.
              </p>
              <label>
                Confidence (1 low – 5 high)
                <select name="confidenceRating" defaultValue="3">
                  <option value="1">1 · Not confident</option>
                  <option value="2">2 · Slightly confident</option>
                  <option value="3">3 · Unsure</option>
                  <option value="4">4 · Confident</option>
                  <option value="5">5 · Very confident</option>
                </select>
              </label>
              <label>
                Concepts involved
                <select
                  name="confidenceConceptIds"
                  multiple
                  size={Math.min(5, Math.max(2, concepts.length))}
                  defaultValue={concepts.map((concept) => concept.id)}
                >
                  {concepts.map((concept) => (
                    <option key={concept.id} value={concept.id}>
                      {concept.name}
                    </option>
                  ))}
                </select>
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
