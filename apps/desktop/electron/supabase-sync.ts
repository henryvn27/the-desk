import { DeskStore } from "../../../packages/domain/store";
import {
  type DeskSyncPhase,
  type DeskSyncStatus,
  SupabaseSyncClient,
  syncPayloadEqual,
} from "../../../packages/integrations/supabase-sync";
import type { SupabaseAccount } from "./supabase";

type SyncAccountBoundary = Pick<SupabaseAccount, "status" | "syncContext">;

export class SupabaseSyncCoordinator {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private phase: DeskSyncPhase = "disabled";
  private lastSyncedAt: string | null = null;
  private lastError: string | null = null;
  private uploaded = 0;

  constructor(
    private readonly getStore: () => DeskStore,
    private readonly account: SyncAccountBoundary,
  ) {}

  schedule() {
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.syncNow();
    }, 250);
  }

  async syncNow(): Promise<DeskSyncStatus> {
    if (this.running) {
      await this.running;
      return this.status();
    }
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
    return this.status();
  }

  status(): DeskSyncStatus {
    const account = this.account.status();
    const store = this.getStore();
    const snapshot = store.snapshot();
    const unresolvedConflicts = snapshot.syncConflicts.filter(
      (conflict) => conflict.resolution === "unresolved",
    ).length;
    const phase =
      account.configured && account.authenticated
        ? unresolvedConflicts > 0 && (this.phase === "disabled" || this.phase === "idle")
          ? "conflict"
          : this.phase
        : "disabled";
    return {
      configured: account.configured,
      authenticated: account.authenticated,
      phase,
      queued: store.syncBatch(100).length,
      unresolvedConflicts,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      uploaded: this.uploaded,
    };
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async run() {
    this.uploaded = 0;
    const context = this.account.syncContext();
    if (!context) {
      this.phase = "disabled";
      this.lastError = null;
      return;
    }
    const store = this.getStore();
    const batch = store.syncBatch(25);
    if (!batch.length) {
      this.phase = "idle";
      this.lastError = null;
      return;
    }
    this.phase = "syncing";
    this.lastError = null;
    const client = new SupabaseSyncClient(context);
    let conflictDetected = false;
    for (const envelope of batch) {
      const attemptedAt = new Date().toISOString();
      store.markSyncAttempt(envelope.id, attemptedAt);
      try {
        const remote = await client.latest(envelope.entityId);
        if (
          remote &&
          remote.operation_id !== envelope.id &&
          !syncPayloadEqual(envelope.payload, remote.payload) &&
          Date.parse(remote.created_at) > Date.parse(envelope.createdAt)
        ) {
          store.recordSyncConflict({
            entityId: envelope.entityId,
            operationId: envelope.id,
            operation: envelope.operation,
            localData: envelope.payload,
            remoteData: JSON.stringify(remote.payload),
          });
          conflictDetected = true;
          continue;
        }
        if (!remote || remote.operation_id !== envelope.id) {
          await client.append(envelope);
        }
        const syncedAt = new Date().toISOString();
        store.markSynced(envelope.id, syncedAt);
        this.lastSyncedAt = syncedAt;
        this.uploaded += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Cloud sync request failed.";
        store.markSyncFailure(envelope.id, new Date().toISOString(), message);
        this.lastError = message;
        this.phase = "error";
        break;
      }
    }
    if (this.phase === "syncing") this.phase = conflictDetected ? "conflict" : "synced";
  }
}
