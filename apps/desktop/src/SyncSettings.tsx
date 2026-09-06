import type {
  Command,
  OutboxOperation,
  SyncConflict,
} from "../../../packages/domain/contracts";
import type { DeskSyncStatus } from "../../../packages/integrations/supabase-sync";
import { useState } from "react";
import { userError } from "./errors";

export function SyncSettings({
  outbox,
  conflicts,
  save,
  status,
  syncNow,
}: {
  outbox: OutboxOperation[];
  conflicts: SyncConflict[];
  save: (command: Command) => Promise<unknown>;
  status: DeskSyncStatus;
  syncNow: () => Promise<DeskSyncStatus>;
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
  async function runSync() {
    setError("");
    try {
      await syncNow();
    } catch (caught) {
      setError(userError(caught));
    }
  }
  async function keepRemote(id: string) {
    setError("");
    try {
      await save({ type: "sync.conflict.resolve", id, resolution: "keep-remote" });
      await save({ type: "sync.conflict.apply-remote", id });
    } catch (caught) {
      setError(userError(caught));
    }
  }
  let cloudLabel = status.authenticated
    ? "Cloud sync: connected"
    : "Cloud sync: not connected";
  if (status.phase === "syncing") cloudLabel = "Cloud sync: syncing";
  if (status.phase === "synced") cloudLabel = "Cloud sync: ready";
  if (status.phase === "conflict") cloudLabel = "Cloud sync: conflict review";
  if (status.phase === "error") cloudLabel = "Cloud sync: unavailable";
  return (
    <section>
      <h2>Local sync boundary</h2>
      <p>
        SQLite is the authoritative store on this computer. Desk records local
        change intent in an outbox and uploads it asynchronously only after a
        signed-in account and the approved Supabase table policy are available.
      </p>
      <div className="sync-status" role="status">
        <strong>{cloudLabel}</strong>
        <span>
          {waiting.length === 0
            ? "No local operations are waiting."
            : `${waiting.length} local operation${waiting.length === 1 ? "" : "s"} waiting for a future sync.`}
        </span>
        {status.lastSyncedAt && (
          <span>Last synced {new Date(status.lastSyncedAt).toLocaleString()}.</span>
        )}
        {status.uploaded > 0 && <span>{status.uploaded} operation(s) uploaded this run.</span>}
      </div>
      <div className="actions">
        <button
          disabled={waiting.length === 0}
          onClick={() => void change({ type: "sync.retry", id: null })}
        >
          Retry queued operations
        </button>
        <button
          disabled={!status.authenticated || waiting.length === 0 || status.phase === "syncing"}
          onClick={() => void runSync()}
        >
          Sync now
        </button>
      </div>
      {status.lastError && <p role="status">{status.lastError}</p>}
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
                  Both copies are retained. Applying a remote copy is a separate
                  explicit step and is replay-safe.
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
                      onClick={() => void keepRemote(conflict.id)}
                    >
                      Keep remote copy
                    </button>
                  </div>
                )}
                {conflict.resolution === "keep-remote" && (
                  <button
                    onClick={() =>
                      void change({ type: "sync.conflict.apply-remote", id: conflict.id })
                    }
                  >
                    Apply remote copy locally
                  </button>
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
