import { useState } from "react";
import type {
  Command,
  RebalancePreview,
  Snapshot,
  Block,
} from "../../../packages/domain/contracts";
import { userError } from "./errors";
export function Rebalance({
  data,
  save,
}: {
  data: Snapshot;
  save: (c: Command) => Promise<unknown>;
}) {
  const [preview, setPreview] = useState<RebalancePreview>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const label = (b: Block) =>
    `${data.tasks.find((t) => t.id === b.taskId)?.title ?? "Assignment"} · ${new Date(b.start).toLocaleString()} · ${b.minutes} min`;
  return (
    <section>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setStatus("");
          void window.desk
            .previewRebalance()
            .then(setPreview)
            .catch((e) => setStatus(userError(e)))
            .finally(() => setBusy(false));
        }}
      >
        Preview rebalance
      </button>
      <p className="muted">
        Reconsider future unlocked reservations around your deadlines and
        available time. Locked and imminent blocks stay in place.
      </p>
      {preview && (
        <form
          key={preview.id}
          onSubmit={(e) => {
            e.preventDefault();
            const approved = new FormData(e.currentTarget).has("approved");
            setBusy(true);
            setStatus("");
            void save({
              type: "planning.rebalance",
              previewId: preview.id,
              approved,
            })
              .then(() => {
                setPreview(undefined);
                setStatus(
                  "Rebalance applied. Review the change history below.",
                );
              })
              .catch((e) => setStatus(userError(e)))
              .finally(() => setBusy(false));
          }}
        >
          <h2>Review proposed changes</h2>
          <p>
            This preview expires at{" "}
            {new Date(preview.expiresAt).toLocaleTimeString()}. No assignment
            will be deleted or marked complete.
          </p>
          <h3>Release {preview.replaced.length} unlocked reservations</h3>
          {preview.replaced.map((b) => (
            <p key={b.id}>{label(b)}</p>
          ))}
          <h3>Add {preview.added.length} study blocks</h3>
          {preview.added.map((b) => (
            <p key={b.id}>
              {label(b)}
              <br />
              <small>{b.why}</small>
            </p>
          ))}
          <h3>Keep {preview.kept.length} existing blocks</h3>
          {preview.kept.map((b) => (
            <p key={b.id}>
              {label(b)}
              {b.locked ? " · Locked" : " · Already started or imminent"}
            </p>
          ))}
          {!!preview.unscheduled.length && (
            <>
              <h3>Still needs time</h3>
              {preview.unscheduled.map((b) => (
                <p key={b.taskId}>
                  {data.tasks.find((t) => t.id === b.taskId)?.title} ·{" "}
                  {b.minutes} min · {b.reason}
                </p>
              ))}
            </>
          )}
          <label>
            <input type="checkbox" name="approved" /> I approve these changes to
            my study commitments
          </label>
          <div className="actions">
            <button disabled={busy}>Apply rebalance</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              Dismiss preview
            </button>
          </div>
        </form>
      )}
      <p role="status">{status}</p>
      {!!data.planChanges.length && (
        <details>
          <summary>Rebalance history</summary>
          {data.planChanges.map((change) => (
            <details key={change.id}>
              <summary>
                {new Date(change.appliedAt).toLocaleString()} ·{" "}
                {change.replaced.length} released, {change.added.length} added
              </summary>
              <h3>Released</h3>
              {change.replaced.map((b) => (
                <p key={b.id}>{label(b)}</p>
              ))}
              <h3>Added</h3>
              {change.added.map((b) => (
                <p key={b.id}>{label(b)}</p>
              ))}
            </details>
          ))}
        </details>
      )}
    </section>
  );
}
