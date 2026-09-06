import { z } from "zod";
import type { SyncEnvelope } from "../domain/contracts";

const remoteOperation = z.object({
  operation_id: z.string().uuid(),
  entity_id: z.string().min(1),
  operation: z.string().min(1),
  payload: z.unknown(),
  created_at: z.iso.datetime(),
});

export type SupabaseSyncContext = {
  url: string;
  publishableKey: string;
  accessToken: string;
  userId: string;
};

export type RemoteSyncOperation = z.infer<typeof remoteOperation>;

export type DeskSyncPhase =
  | "disabled"
  | "idle"
  | "syncing"
  | "synced"
  | "conflict"
  | "error";

export type DeskSyncStatus = {
  configured: boolean;
  authenticated: boolean;
  phase: DeskSyncPhase;
  queued: number;
  unresolvedConflicts: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  uploaded: number;
};

export function supabaseSyncUrl(baseUrl: string, query = "") {
  const base = new URL(baseUrl);
  if (
    base.protocol !== "https:" &&
    base.hostname !== "127.0.0.1" &&
    base.hostname !== "localhost"
  )
    throw Error("Supabase URL must use HTTPS.");
  const url = new URL("/rest/v1/desk_sync_operations", base);
  url.search = query;
  return url.toString();
}

export function syncPayloadEqual(local: string, remote: unknown) {
  try {
    return JSON.stringify(JSON.parse(local)) === JSON.stringify(remote);
  } catch {
    return false;
  }
}

class SupabaseSyncRequestError extends Error {
  constructor(readonly status: number) {
    super(`Cloud sync request failed (HTTP ${status}).`);
  }
}

export class SupabaseSyncClient {
  constructor(private readonly context: SupabaseSyncContext) {}

  async latest(entityId: string): Promise<RemoteSyncOperation | null> {
    const query = new URLSearchParams({
      account_id: `eq.${this.context.userId}`,
      entity_id: `eq.${entityId}`,
      select: "operation_id,entity_id,operation,payload,created_at",
      order: "created_at.desc",
      limit: "1",
    });
    const response = await this.request("GET", query.toString());
    const parsed = z.array(remoteOperation).parse(response);
    return parsed[0] ?? null;
  }

  async append(envelope: SyncEnvelope): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(envelope.payload);
    } catch {
      throw Error("Local sync payload is invalid.");
    }
    try {
      await this.request("POST", "", {
        operation_id: envelope.id,
        account_id: this.context.userId,
        entity_id: envelope.entityId,
        operation: envelope.operation,
        payload,
        created_at: envelope.createdAt,
      });
    } catch (error) {
      if (error instanceof SupabaseSyncRequestError && error.status === 409) {
        const remote = await this.latest(envelope.entityId);
        if (
          remote?.operation_id === envelope.id &&
          syncPayloadEqual(envelope.payload, remote.payload)
        )
          return;
      }
      throw error;
    }
  }

  private async request(
    method: "GET" | "POST",
    query: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await fetch(supabaseSyncUrl(this.context.url, query), {
      method,
      headers: {
        apikey: this.context.publishableKey,
        authorization: `Bearer ${this.context.accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    if (!response.ok) throw new SupabaseSyncRequestError(response.status);
    let parsed: unknown;
    if (!raw) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    return parsed;
  }
}
