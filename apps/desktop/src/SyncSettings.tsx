import type {
  Command,
  OutboxOperation,
  SyncConflict,
} from "../../../packages/domain/contracts";
import { useState } from "react";
import { userError } from "./errors";

export function SyncSettings({
  outbox,
  conflicts,
  save,
}: {
  outbox: OutboxOperation[];
  conflicts: SyncConflict[];
  save: (command: Command) => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const waiting = outbox.filter(
    (operation) =>
      operation.status === "queued" || operation.status === "retrying",
  );
  async function change(command: Command) {
    setError("");
    try {
      await save(command);
    } catch (caught) {
      setError(userError(caught));
    }
  }
  return (
    <section>
      <h2>Local sync boundary</h2>
      <p>
        SQLite is the authoritative store on this computer. Desk records local
        change intent in an outbox so a future account can sync it; this build
        does not upload those operations anywhere.
      </p>
      <div className="sync-status" role="status">
        <strong>Cloud sync: not connected</strong>
        <span>
          {waiting.length === 0
            ? "No local operations are waiting."
            : `${waiting.length} local operation${waiting.length === 1 ? "" : "s"} waiting for a future sync.`}
        </span>
      </div>
      <div className="actions">
        <button
          disabled={waiting.length === 0}
          onClick={() => void change({ type: "sync.retry", id: null })}
        >
          Retry queued operations
        </button>
      </div>
      {outbox.some((operation) => operation.status === "conflict") && (
        <p className="attention">
          Some local changes are paused because both local and remote copies
          need an explicit decision.
        </p>
      )}
      {conflicts.length > 0 && (
        <div className="sync-conflicts">
          <h3>Preserved conflicts</h3>
          {conflicts.map((conflict) => {
            const resolved = conflict.resolution !== "unresolved";
            return (
              <article className="sync-conflict" key={conflict.id}>
                <div className="connection-card-heading">
                  <div>
                    <div className="eyebrow">{conflict.operation}</div>
                    <h4>{resolved ? "Resolution recorded" : "Needs review"}</h4>
                  </div>
                  <span className="connection-state not-connected">
                    {resolved ? conflict.resolution : "Unresolved"}
                  </span>
                </div>
                <p className="muted">
                  Both copies are retained. Resolution records the choice; this
                  build does not pretend to upload or overwrite local data.
                </p>
                <details>
                  <summary>View preserved local and remote copies</summary>
                  <div className="sync-copy-grid">
                    <div>
                      <strong>Local copy</strong>
                      <pre>{conflict.localData}</pre>
                    </div>
                    <div>
                      <strong>Remote copy</strong>
                      <pre>{conflict.remoteData}</pre>
                    </div>
                  </div>
                </details>
                {!resolved && (
                  <div className="actions">
                    <button
                      onClick={() =>
                        void change({
                          type: "sync.conflict.resolve",
                          id: conflict.id,
                          resolution: "keep-local",
                        })
                      }
                    >
                      Keep local copy
                    </button>
                    <button
                      onClick={() =>
                        void change({
                          type: "sync.conflict.resolve",
                          id: conflict.id,
                          resolution: "keep-remote",
                        })
                      }
                    >
                      Keep remote copy
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {error && <p role="status">{error}</p>}
      <p className="muted">
        Offline capture, planning, sessions, sources, and local study history
        continue to use SQLite. No operation is silently discarded or called
        synced before a cloud connection exists.
      </p>
    </section>
  );
}
