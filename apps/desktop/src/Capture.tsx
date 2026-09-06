import { durationSuggestion } from "../../../packages/learning/duration";
import { userError } from "./errors";
import { useEffect, useRef, useState } from "react";
import type {
  Class,
  GradeCategory,
  TaskInput,
  Task,
  StudySession,
} from "../../../packages/domain/contracts";
import {
  interpretCapture,
  type CaptureDraft,
} from "../../../packages/intelligence/capture";
export function Capture({
  classes,
  gradeCategories,
  tasks,
  sessions,
  busy,
  onSave,
  onClose,
  existing,
  initialDraft,
  onQueue,
}: {
  initialDraft?: CaptureDraft;
  onQueue?: (text: string) => Promise<void>;
  classes: Class[];
  gradeCategories: GradeCategory[];
  tasks: Task[];
  sessions: StudySession[];
  busy: boolean;
  onSave: (
    input: TaskInput,
    deadlineChangeApproved: boolean,
  ) => Promise<boolean>;
  existing?: Task;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [manual, setManual] = useState(Boolean(existing));
  const [paste, setPaste] = useState("");
  const [drafts, setDrafts] = useState<CaptureDraft[]>(
    initialDraft ? [initialDraft] : [],
  );
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const draft = drafts[index];
  const formKey = index + ":" + (draft?.title ?? "manual");
  const [estimateInput, setEstimateInput] = useState<{
    key: string;
    classId: string;
    workKind: TaskInput["workKind"];
    minutes: number;
    applied: boolean;
  }>();
  const estimate =
    estimateInput?.key === formKey
      ? estimateInput
      : {
          classId:
            existing?.classId ??
            draft?.classId ??
            (draft ? "" : (classes[0]?.id ?? "")),
          workKind: existing?.workKind ?? "assignment",
          minutes: existing?.minutes ?? draft?.minutes ?? 30,
          applied: false,
        };
  const suggestion = durationSuggestion(tasks, sessions, estimate);
  const instantValue = existing?.dueAt ?? draft?.deadline?.instant;
  const instant = instantValue ? new Date(instantValue) : null;
  const two = (n: number) => String(n).padStart(2, "0");
  const localDate = instant
    ? `${instant.getFullYear()}-${two(instant.getMonth() + 1)}-${two(instant.getDate())}`
    : (draft?.deadline?.date ?? "");
  const localTime = instant
    ? `${two(instant.getHours())}:${two(instant.getMinutes())}:${two(instant.getSeconds())}`
    : (draft?.deadline?.time ?? "");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function interpret() {
    setError("");
    if (onQueue) {
      void onQueue(paste).catch((e) => setError(userError(e)));
      return;
    }
    try {
      setDrafts(
        interpretCapture(paste, {
          classes,
          now: new Date(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      );
      setIndex(0);
    } catch (e) {
      setError(userError(e));
    }
  }
  return (
    <dialog ref={dialog} aria-labelledby="capture-title" onCancel={onClose}>
      <h2 id="capture-title">
        {existing ? "Edit assignment" : "Capture an assignment"}
      </h2>
      {!draft && !manual && (
        <section>
          <label>
            Paste an assignment or a few clear assignment lines
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              maxLength={20000}
            />
          </label>
          <button
            type="button"
            disabled={busy || !paste.trim()}
            onClick={interpret}
          >
            Interpret text
          </button>
          <button type="button" onClick={() => setManual(true)}>
            Enter manually
          </button>
          <p className="muted">
            Interpreted text is saved to Capture Inbox for review. Manual
            assignments are saved only when you confirm.
          </p>
        </section>
      )}
      {draft && (
        <>
          <p>
            Review {index + 1} of {drafts.length}
          </p>
          {draft.uncertainties.length > 0 && (
            <details open>
              <summary>Details to check</summary>
              <ul>
                {draft.uncertainties.map((u, i) => (
                  <li key={i}>{u.message}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(draft || manual) && (
        <form
          key={formKey}
          onChange={(e) => {
            const target = e.target;
            if (
              !(target instanceof HTMLInputElement) &&
              !(target instanceof HTMLSelectElement)
            )
              return;
            if (!["classId", "workKind", "minutes"].includes(target.name))
              return;
            const f = new FormData(e.currentTarget);
            setEstimateInput({
              key: formKey,
              classId: String(f.get("classId")),
              workKind: String(f.get("workKind")) as TaskInput["workKind"],
              minutes: Number(f.get("minutes")),
              applied: false,
            });
          }}
          onInput={() => setError("")}
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            const f = new FormData(e.currentTarget);
            const date = String(f.get("date")),
              time = String(f.get("time"));
            const confirmed = f.get("confirmed") === "on";
            if (date && !time && confirmed) {
              setError(
                "Choose a due time to confirm this date. Desk will not invent one.",
              );
              return;
            }
            const dateTime = date && time ? new Date(`${date}T${time}`) : null;
            if (dateTime && !Number.isFinite(+dateTime)) {
              setError("Check the due date and time.");
              return;
            }
            void onSave(
              {
                title: String(f.get("title")),
                gradeContext: f.get("gradeCategory")
                  ? {
                      categoryId: String(f.get("gradeCategory")),
                      possiblePoints: Number(f.get("possiblePoints")),
                    }
                  : null,
                workKind: String(f.get("workKind")) as TaskInput["workKind"],
                importance: String(
                  f.get("importance"),
                ) as TaskInput["importance"],
                classId: String(f.get("classId")),
                minutes: Number(f.get("minutes")),
                dueAt: dateTime?.toISOString() ?? null,
                deadlineConfirmed: confirmed,
                resource: String(f.get("resource")) || null,
                notes: String(f.get("notes")),
                ...(draft
                  ? {
                      captureEvidence: {
                        originalText: draft.provenance.originalText,
                        sourceText: draft.provenance.sourceText,
                        capturedAt: draft.provenance.capturedAt,
                        authority: draft.provenance.authority,
                        confidence: draft.confidence,
                        candidateDates: draft.deadline?.candidates ?? [],
                        uncertainties: draft.uncertainties.map(
                          (u) => u.message,
                        ),
                      },
                    }
                  : {}),
              },
              f.get("approveChange") === "on",
            )
              .then((saved) => {
                if (saved) {
                  if (index + 1 < drafts.length) setIndex(index + 1);
                  else onClose();
                }
              })
              .catch((e) => setError(userError(e)));
          }}
        >
          <label>
            What needs doing?
            <input
              name="title"
              required
              maxLength={500}
              defaultValue={existing?.title ?? draft?.title ?? ""}
            />
          </label>
          <label>
            Class
            <select
              name="classId"
              aria-label="Class"
              required
              defaultValue={
                existing?.classId ??
                draft?.classId ??
                (draft ? "" : (classes[0]?.id ?? ""))
              }
            >
              <option value="" disabled>
                Choose a class
              </option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {!classes.length && <p>Add a class in the sidebar first.</p>}
          <div className="fields">
            <label>
              Due date
              <input type="date" name="date" defaultValue={localDate} />
            </label>
            <label>
              Due time (local)
              <input
                type="time"
                step="1"
                name="time"
                defaultValue={localTime}
              />
            </label>
          </div>
          <div className="fields">
            <label>
              Work type
              <select
                name="workKind"
                aria-label="Work type"
                defaultValue={existing?.workKind ?? "assignment"}
              >
                <option value="assignment">Required assignment</option>
                <option value="assessment">Assessment preparation</option>
                <option value="optional-review">Optional review</option>
              </select>
            </label>
            <label>
              Importance
              <select
                name="importance"
                aria-label="Importance"
                defaultValue={existing?.importance ?? "normal"}
              >
                <option value="low">Lower</option>
                <option value="normal">Normal</option>
                <option value="high">Higher</option>
              </select>
            </label>
          </div>
          {!!gradeCategories.length && (
            <details>
              <summary>Grade context (optional)</summary>
              <p>
                Link the category and possible points for an upcoming item not
                already recorded in the gradebook. These are inputs to a
                points-weighted model, not predicted score gains.
              </p>
              <label>
                Assignment grade category
                <select
                  aria-label="Assignment grade category"
                  name="gradeCategory"
                  defaultValue={existing?.gradeContext?.categoryId ?? ""}
                >
                  <option value="">Not linked</option>
                  {gradeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {classes.find((course) => course.id === c.classId)?.name}{" "}
                      · {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Item possible points
                <input
                  name="possiblePoints"
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  defaultValue={existing?.gradeContext?.possiblePoints ?? ""}
                />
              </label>
            </details>
          )}
          <label>
            Estimated minutes
            <input
              name="minutes"
              type="number"
              min="5"
              max="2400"
              defaultValue={existing?.minutes ?? draft?.minutes ?? 30}
              required
            />
          </label>
          {suggestion && suggestion.minutes !== estimate.minutes && (
            <section aria-label="Duration suggestion">
              <p>
                Similar work took {suggestion.ratio.toFixed(1)}× the starting
                estimate across {suggestion.samples} reviewed tasks in this
                class and work type. Each was finished in one session. Timing
                varies.
              </p>
              <button
                type="button"
                disabled={estimate.applied}
                onClick={(e) => {
                  const input = e.currentTarget.form?.elements.namedItem(
                    "minutes",
                  ) as HTMLInputElement | null;
                  if (!input) return;
                  input.value = String(suggestion.minutes);
                  setEstimateInput({
                    ...estimate,
                    key: formKey,
                    applied: true,
                  });
                }}
              >
                {estimate.applied
                  ? "Suggested estimate applied"
                  : `Use ${suggestion.minutes} min estimate`}
              </button>
              <p className="muted">
                Optional adjustment to your estimate; no changes are saved until
                you confirm.
              </p>
            </section>
          )}
          <label className="check">
            <input
              type="checkbox"
              name="confirmed"
              defaultChecked={existing?.deadlineConfirmed ?? false}
            />
            I have confirmed this deadline, or this work has no deadline.
          </label>
          {existing?.deadlineConfirmed && (
            <label className="check">
              <input type="checkbox" name="approveChange" />
              Approve any change to the confirmed deadline
            </label>
          )}
          <details>
            <summary>Source and resource</summary>
            <label>
              Resource link
              <input
                type="url"
                name="resource"
                defaultValue={existing?.resource ?? draft?.resources[0] ?? ""}
                placeholder="https://…"
              />
            </label>
            <label>
              Original text or notes
              <textarea
                name="notes"
                maxLength={20000}
                defaultValue={
                  existing?.notes ?? draft?.provenance.sourceText ?? ""
                }
              />
            </label>
          </details>
          <div className="actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy || !classes.length}>
              {existing
                ? "Save changes"
                : drafts.length > 1
                  ? "Save and continue"
                  : "Save assignment"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
