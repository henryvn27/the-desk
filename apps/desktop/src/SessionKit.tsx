import { TaskChecklist } from "./TaskChecklist";
import type {
  Command,
  Snapshot,
  Task,
} from "../../../packages/domain/contracts";
import { sessionKit } from "../../../packages/study/kit";

export function SessionKit({
  task,
  data,
  openResource,
  save,
}: {
  save: (command: Command) => Promise<unknown>;
  task: Task;
  data: Snapshot;
  openResource: (id: string) => Promise<void>;
}) {
  const kit = sessionKit(task, data);
  return (
    <section aria-label="Session kit">
      <h3>Session kit</h3>
      <TaskChecklist task={task} save={save} />
      {task.resource && (
        <button onClick={() => void openResource(task.id)}>
          Open assignment resource
        </button>
      )}
      {task.notes && (
        <details>
          <summary>Assignment notes</summary>
          <p className="source-text">{task.notes}</p>
        </details>
      )}
      {kit.linkedSources.length > 0 && (
        <div>
          <h4>Linked to this assignment</h4>
          {kit.linkedSources.map((source) => (
            <details key={source.id}>
              <summary>{source.title}</summary>
              <p className="muted">
                Saved text · {new Date(source.createdAt).toLocaleDateString()}
              </p>
              <p className="source-text">{source.text}</p>
            </details>
          ))}
        </div>
      )}
      {kit.classSources.length > 0 && (
        <details>
          <summary>Class reference ({kit.classSources.length})</summary>
          <p className="muted">
            Saved for this class; not specifically linked to this assignment.
          </p>
          {kit.classSources.map((source) => (
            <details key={source.id}>
              <summary>{source.title}</summary>
              <p className="source-text">{source.text}</p>
            </details>
          ))}
        </details>
      )}
      {kit.previousReviews.length > 0 && (
        <div>
          <h4>From your previous sessions</h4>
          <p className="muted">Your latest review notes for this assignment.</p>
          {kit.previousReviews.map((session) => (
            <details key={session.id}>
              <summary>
                {new Date(session.endedAt!).toLocaleString()} ·{" "}
                {Math.round(session.actualMinutes ?? 0)} min tracked
              </summary>
              <p className="source-text">{session.review!.notes}</p>
            </details>
          ))}
        </div>
      )}
      {kit.mistakes.length > 0 && (
        <div>
          <h4>Previous mistakes</h4>
          <p className="muted">
            Review notes from this class; they do not claim mastery or
            completion.
          </p>
          {kit.mistakes.map((mistake) => (
            <details key={mistake.id}>
              <summary>
                {mistake.concept} · Confidence {mistake.confidence}
              </summary>
              <p>
                <strong>Source:</strong> {mistake.source}
              </p>
              <p>
                <strong>What went wrong:</strong> {mistake.whatWentWrong}
              </p>
              <p>
                <strong>Correction:</strong> {mistake.correction}
              </p>
            </details>
          ))}
        </div>
      )}
      {kit.concepts.length > 0 && (
        <div>
          <h4>Concepts to review</h4>
          <p className="muted">
            Explicit preparedness evidence for this class; it does not claim
            mastery or completion.
          </p>
          {kit.concepts.map((concept) => (
            <details key={concept.id}>
              <summary>
                {concept.name} · {concept.preparedness.replace("-", " ")}
              </summary>
              <p>
                <strong>Status:</strong> {concept.status.replace("-", " ")}
              </p>
              <p>
                <strong>Retention:</strong>{" "}
                {concept.retentionMode === "long-term" ? "Long-term" : "Course"}
              </p>
              {concept.evidenceNote && (
                <p>
                  <strong>Evidence:</strong> {concept.evidenceNote}
                </p>
              )}
            </details>
          ))}
        </div>
      )}
      {!task.resource &&
        !task.notes &&
        !kit.linkedSources.length &&
        !kit.classSources.length &&
        !kit.previousReviews.length &&
        !kit.mistakes.length &&
        !kit.concepts.length && (
          <p className="muted">
            No materials saved yet. Add assignment notes or link a saved source
            in Library.
          </p>
        )}
    </section>
  );
}
