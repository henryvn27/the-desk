import { useState } from "react";
import type {
  CaptureInboxItem,
  Command,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";
export function CaptureInbox({
  items,
  busy,
  review,
  change,
}: {
  items: CaptureInboxItem[];
  busy: boolean;
  review: (item: CaptureInboxItem) => void;
  change: (command: Command) => Promise<unknown>;
}) {
  const [view, setView] = useState<CaptureInboxItem["status"]>("pending");
  const [error, setError] = useState("");
  const visible = items.filter((i) => i.status === view);
  return (
    <section>
      <h1>Capture Inbox</h1>
      <p>
        Pending captures wait for your review. Filed captures are assignments
        and follow your planning preferences.
      </p>
      <div className="actions">
        {(["pending", "archived", "accepted"] as const).map((status) => (
          <button
            key={status}
            aria-pressed={view === status}
            onClick={() => setView(status)}
          >
            {status === "pending"
              ? "Pending"
              : status === "archived"
                ? "Archived"
                : "Filed"}{" "}
            ({items.filter((i) => i.status === status).length})
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {!visible.length && (
        <p>
          {view === "archived"
            ? "No archived captures."
            : view === "accepted"
              ? "No filed captures yet."
              : "Nothing waiting for review."}
        </p>
      )}
      {visible.map((item) => (
        <article key={item.id} className="card">
          <h2>{item.draft.title || "Untitled capture"}</h2>
          <p className="muted">
            Pasted text ·{" "}
            {new Date(item.draft.provenance.capturedAt).toLocaleString()}
          </p>
          {view === "accepted" ? (
            <p>
              {item.filing?.action === "auto-file"
                ? item.filing.reason
                : "Reviewed and filed as an assignment."}
            </p>
          ) : item.draft.uncertainties.length > 0 ? (
            <ul>
              {item.draft.uncertainties.map((u, n) => (
                <li key={n}>{u.message}</li>
              ))}
            </ul>
          ) : (
            <p>
              {item.filing?.reason ??
                "Extracted fields are ready for your confirmation."}
            </p>
          )}
          <details>
            <summary>Source text</summary>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {item.draft.provenance.sourceText}
            </p>
          </details>
          <div className="actions">
            {view === "pending" && (
              <button disabled={busy} onClick={() => review(item)}>
                Review capture
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => {
                setError("");
                void change(
                  view === "accepted" && item.taskId
                    ? { type: "task.undo", id: item.taskId }
                    : {
                        type: "inbox.archive",
                        id: item.id,
                        revision: item.revision,
                        archived: view !== "archived",
                      },
                ).catch((e) => setError(userError(e)));
              }}
            >
              {view === "accepted"
                ? "Undo filing"
                : view === "archived"
                  ? "Restore capture"
                  : "Archive capture"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
