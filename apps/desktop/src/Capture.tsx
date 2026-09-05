import { userError } from "./errors";
import { useEffect, useRef, useState } from "react";
import type { Class, TaskInput } from "../../../packages/domain/contracts";
import {
  interpretCapture,
  type CaptureDraft,
} from "../../../packages/intelligence/capture";
export function Capture({
  classes,
  busy,
  onSave,
  onClose,
}: {
  classes: Class[];
  busy: boolean;
  onSave: (input: TaskInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [paste, setPaste] = useState("");
  const [drafts, setDrafts] = useState<CaptureDraft[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const draft = drafts[index];
  const instant = draft?.deadline?.instant
    ? new Date(draft.deadline.instant)
    : null;
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
      <h2 id="capture-title">Capture an assignment</h2>
      {!draft && (
        <section>
          <label>
            Paste an assignment or a few clear assignment lines
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              maxLength={20000}
            />
          </label>
          <button type="button" disabled={!paste.trim()} onClick={interpret}>
            Interpret text
          </button>
          <p className="muted">
            Or enter it below. Nothing is saved until you confirm.
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
      <form
        key={index + ":" + (draft?.title ?? "manual")}
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
          void onSave({
            title: String(f.get("title")),
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
                    uncertainties: draft.uncertainties.map((u) => u.message),
                  },
                }
              : {}),
          }).then((saved) => {
            if (saved) {
              if (index + 1 < drafts.length) setIndex(index + 1);
              else onClose();
            }
          });
        }}
      >
        <label>
          What needs doing?
          <input
            name="title"
            required
            maxLength={500}
            defaultValue={draft?.title ?? ""}
          />
        </label>
        <label>
          Class
          <select
            name="classId"
            required
            defaultValue={
              draft?.classId ?? (draft ? "" : (classes[0]?.id ?? ""))
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
            <input type="time" step="1" name="time" defaultValue={localTime} />
          </label>
        </div>
        <label>
          Estimated minutes
          <input
            name="minutes"
            type="number"
            min="5"
            max="2400"
            defaultValue={draft?.minutes ?? 30}
            required
          />
        </label>
        <label className="check">
          <input type="checkbox" name="confirmed" />I have confirmed this
          deadline, or this work has no deadline.
        </label>
        <label>
          Resource link
          <input
            type="url"
            name="resource"
            defaultValue={draft?.resources[0] ?? ""}
            placeholder="https://…"
          />
        </label>
        <label>
          Original text or notes
          <textarea
            name="notes"
            maxLength={20000}
            defaultValue={draft?.provenance.sourceText ?? ""}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !classes.length}>
            {drafts.length > 1 ? "Save and continue" : "Save assignment"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
