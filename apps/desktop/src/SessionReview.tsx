import { SessionCorrection } from "./SessionCorrection";
import { useState } from "react";
import type {
  AttemptInput,
  Command,
  Concept,
  MistakeInput,
  Snapshot,
  StudySession,
  Task,
} from "../../../packages/domain/contracts";
import { attemptInput, mistakeInput } from "../../../packages/domain/contracts";
import { userError } from "./errors";

const resultLabels: Record<AttemptInput["result"], string> = {
  correct: "Correct",
  incorrect: "Incorrect",
  partial: "Partially correct",
  unknown: "Not yet checked",
};

type AttemptDraft = AttemptInput & { id: string };
type MistakeDraft = {
  concept: string;
  originalAttempt: string;
  whatWentWrong: string;
  correction: string;
  helpUsed: string;
  confidence: MistakeInput["confidence"];
  reviewDue: string;
};

let nextDraftId = 0;

function emptyAttempt(task: Task, conceptId = ""): AttemptDraft {
  return {
    id: `session-attempt-${++nextDraftId}`,
    classId: task.classId,
    taskId: task.id,
    conceptIds: conceptId ? [conceptId] : [],
    result: "unknown",
    unaided: true,
    hintCount: 0,
    notes: "",
    attemptedAt: new Date().toISOString(),
  };
}

const emptyMistake: MistakeDraft = {
  concept: "",
  originalAttempt: "",
  whatWentWrong: "",
  correction: "",
  helpUsed: "",
  confidence: "medium",
  reviewDue: "",
};

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
  const [attempts, setAttempts] = useState<AttemptDraft[]>([]);
  const [recordMistake, setRecordMistake] = useState(false);
  const [mistake, setMistake] = useState<MistakeDraft>(emptyMistake);
  const [error, setError] = useState("");
  const availableConcepts = concepts
    .filter((concept) => {
      if (concept.classId !== task.classId) return false;
      const linked = concept.taskIds.includes(task.id);
      const weak =
        concept.preparedness === "not-ready" ||
        concept.preparedness === "developing" ||
        concept.status === "review-due";
      const due =
        concept.reviewDue !== null &&
        Date.parse(concept.reviewDue) <= Date.now();
      return linked || weak || due;
    })
    .sort(
      (a, b) =>
        Number(b.taskIds.includes(task.id)) -
          Number(a.taskIds.includes(task.id)) ||
        a.name.localeCompare(b.name),
    );
  async function confirm(
    notes: string,
    remainingMinutes: number | null,
    evidenceAttempts: AttemptInput[] = [],
    evidenceMistake: MistakeInput | null = null,
  ) {
    setError("");
    try {
      await save(
        {
          type: "session.evidence",
          id: session.id,
          revision: session.revision ?? 0,
          taskRevision: task.revision ?? 0,
          input: {
            notes,
            remainingMinutes,
            attempts: evidenceAttempts,
            mistake: evidenceMistake,
          },
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
            try {
              const evidenceAttempts = attempts.map((draft) =>
                attemptInput.parse({
                  classId: task.classId,
                  taskId: task.id,
                  conceptIds: draft.conceptIds,
                  result: draft.result,
                  unaided: draft.unaided,
                  hintCount: draft.hintCount,
                  notes: draft.notes,
                  attemptedAt: session.endedAt ?? new Date().toISOString(),
                }),
              );
              const evidenceMistake = recordMistake
                ? mistakeInput.parse({
                    classId: task.classId,
                    taskId: task.id,
                    concept: mistake.concept,
                    source: `Session: ${task.title}`.slice(0, 500),
                    originalAttempt: mistake.originalAttempt,
                    whatWentWrong: mistake.whatWentWrong,
                    correction: mistake.correction,
                    helpUsed: mistake.helpUsed,
                    confidence: mistake.confidence,
                    reviewDue: mistake.reviewDue
                      ? new Date(mistake.reviewDue).toISOString()
                      : null,
                  })
                : null;
              void confirm(
                String(f.get("notes")),
                remaining ? Number(remaining) : null,
                evidenceAttempts,
                evidenceMistake,
              );
            } catch (caught) {
              setError(userError(caught));
            }
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
          <details
            open={evidenceOpen}
            onToggle={(event) => setEvidenceOpen(event.currentTarget.open)}
          >
            <summary>Record learning evidence (optional)</summary>
            <p className="muted">
              Record what you checked, how much help you needed, or one mistake.
              This saves evidence without claiming mastery or completion.
            </p>
            {availableConcepts.length ? (
              attempts.map((attempt, index) => (
                <fieldset key={attempt.id}>
                  <legend>Concept attempt {index + 1}</legend>
                  <label>
                    Concept
                    <select
                      aria-label={`Concept attempt ${index + 1}`}
                      value={attempt.conceptIds[0] ?? ""}
                      onChange={(event) =>
                        setAttempts((current) =>
                          current.map((item) =>
                            item.id === attempt.id
                              ? {
                                  ...item,
                                  conceptIds: event.currentTarget.value
                                    ? [event.currentTarget.value]
                                    : [],
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">Choose a concept</option>
                      {availableConcepts.map((concept) => (
                        <option key={concept.id} value={concept.id}>
                          {concept.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Result
                    <select
                      value={attempt.result}
                      onChange={(event) =>
                        setAttempts((current) =>
                          current.map((item) =>
                            item.id === attempt.id
                              ? {
                                  ...item,
                                  result: event.currentTarget
                                    .value as AttemptInput["result"],
                                }
                              : item,
                          ),
                        )
                      }
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
                      checked={attempt.unaided}
                      onChange={(event) =>
                        setAttempts((current) =>
                          current.map((item) =>
                            item.id === attempt.id
                              ? {
                                  ...item,
                                  unaided: event.currentTarget.checked,
                                }
                              : item,
                          ),
                        )
                      }
                    />{" "}
                    Solved unaided
                  </label>
                  <label>
                    Hints used
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={attempt.hintCount}
                      onChange={(event) =>
                        setAttempts((current) =>
                          current.map((item) =>
                            item.id === attempt.id
                              ? {
                                  ...item,
                                  hintCount: Number(event.currentTarget.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Attempt notes
                    <textarea
                      value={attempt.notes}
                      maxLength={5000}
                      onChange={(event) =>
                        setAttempts((current) =>
                          current.map((item) =>
                            item.id === attempt.id
                              ? { ...item, notes: event.currentTarget.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setAttempts((current) =>
                        current.filter((item) => item.id !== attempt.id),
                      )
                    }
                  >
                    Remove attempt
                  </button>
                </fieldset>
              ))
            ) : (
              <p className="muted">
                No linked concepts are ready for this assignment. You can still
                save a review or record a mistake below.
              </p>
            )}
            <button
              type="button"
              disabled={!availableConcepts.length}
              onClick={() =>
                setAttempts((current) => [
                  ...current,
                  emptyAttempt(task, availableConcepts[0]?.id),
                ])
              }
            >
              Add concept attempt
            </button>
            <label>
              <input
                type="checkbox"
                checked={recordMistake}
                onChange={(event) =>
                  setRecordMistake(event.currentTarget.checked)
                }
              />{" "}
              Record a mistake from this session
            </label>
            {recordMistake && (
              <fieldset>
                <legend>Mistake details</legend>
                {(
                  [
                    ["concept", "Concept", mistake.concept],
                    [
                      "originalAttempt",
                      "Original attempt",
                      mistake.originalAttempt,
                    ],
                    [
                      "whatWentWrong",
                      "What went wrong",
                      mistake.whatWentWrong,
                    ],
                    ["correction", "Correction", mistake.correction],
                    ["helpUsed", "Help used (optional)", mistake.helpUsed],
                  ] as const
                ).map(([field, label, value]) => (
                  <label key={field}>
                    {label}
                    <textarea
                      required={field !== "helpUsed"}
                      maxLength={field === "concept" ? 300 : field === "helpUsed" ? 2000 : 5000}
                      value={value}
                      onChange={(event) =>
                        setMistake((current) => ({
                          ...current,
                          [field]: event.currentTarget.value,
                        }))
                      }
                    />
                  </label>
                ))}
                <label>
                  Confidence
                  <select
                    value={mistake.confidence}
                    onChange={(event) =>
                      setMistake((current) => ({
                        ...current,
                        confidence: event.currentTarget
                          .value as MistakeInput["confidence"],
                      }))
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Review due (optional)
                  <input
                    type="datetime-local"
                    value={mistake.reviewDue}
                    onChange={(event) =>
                      setMistake((current) => ({
                        ...current,
                        reviewDue: event.currentTarget.value,
                      }))
                    }
                  />
                </label>
              </fieldset>
            )}
          </details>
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
          <button
            onClick={() => {
              setEvidenceOpen(true);
              setEditing(true);
            }}
          >
            Record learning evidence
          </button>
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
