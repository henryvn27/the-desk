import type { OutboxOperation } from "../../../packages/domain/contracts";

export function SyncSettings({ outbox }: { outbox: OutboxOperation[] }) {
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
          {outbox.length === 0
            ? "No local operations are waiting."
            : `${outbox.length} local operation${outbox.length === 1 ? "" : "s"} recorded for a future sync.`}
        </span>
      </div>
      <p className="muted">
        Offline capture, planning, sessions, sources, and local study history
        continue to use SQLite. No operation is silently discarded or called
        synced before a cloud connection exists.
      </p>
    </section>
  );
}
