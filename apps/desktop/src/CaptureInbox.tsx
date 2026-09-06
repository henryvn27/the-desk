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
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const visible = items.filter(
    (i) => i.status === (archived ? "archived" : "pending"),
  );
  return (
    <section>
      <h1>Capture Inbox</h1>
      <p>
        Saved for review. These items are not assignments and do not reserve
        study time yet.
      </p>
      <div className="actions">
        <button aria-pressed={!archived} onClick={() => setArchived(false)}>
          Pending ({items.filter((i) => i.status === "pending").length})
        </button>
        <button aria-pressed={archived} onClick={() => setArchived(true)}>
          Archived ({items.filter((i) => i.status === "archived").length})
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!visible.length && (
        <p>
          {archived ? "No archived captures." : "Nothing waiting for review."}
        </p>
      )}
      {visible.map((item) => (
        <article key={item.id} className="card">
          <h2>{item.draft.title || "Untitled capture"}</h2>
          <p className="muted">
            Pasted text ·{" "}
            {new Date(item.draft.provenance.capturedAt).toLocaleString()}
          </p>
          {item.draft.uncertainties.length > 0 ? (
            <ul>
              {item.draft.uncertainties.map((u, n) => (
                <li key={n}>{u.message}</li>
              ))}
            </ul>
          ) : (
            <p>Extracted fields are ready for your confirmation.</p>
          )}
          <details>
            <summary>Source text</summary>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {item.draft.provenance.sourceText}
            </p>
          </details>
          <div className="actions">
            {!archived && (
              <button disabled={busy} onClick={() => review(item)}>
                Review capture
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => {
                setError("");
                void change({
                  type: "inbox.archive",
                  id: item.id,
                  revision: item.revision,
                  archived: !archived,
                }).catch((e) => setError(userError(e)));
              }}
            >
              {archived ? "Restore capture" : "Archive capture"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
