import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  SupabaseSyncClient,
  supabaseSyncUrl,
  syncPayloadEqual,
} from "./supabase-sync";

test("Supabase sync URLs and payload comparison stay bounded", () => {
  assert.equal(
    supabaseSyncUrl("https://desk.example.test/", "entity_id=eq.class"),
    "https://desk.example.test/rest/v1/desk_sync_operations?entity_id=eq.class",
  );
  assert.throws(() => supabaseSyncUrl("http://remote.example.test"));
  assert.equal(syncPayloadEqual('{"entityId":"class"}', { entityId: "class" }), true);
  assert.equal(syncPayloadEqual("not-json", {}), false);
});

test("Supabase sync client reads and appends through the authenticated REST boundary", async () => {
  const calls: Array<{ method: string; path: string; authorization: string; body: string }> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization ?? "",
      body,
    });
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
      return;
    }
    response.writeHead(201);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new SupabaseSyncClient({
    url: `http://127.0.0.1:${address.port}`,
    publishableKey: "test-publishable-key",
    accessToken: "test-access-token",
    userId: "00000000-0000-4000-8000-000000000010",
  });
  try {
    assert.equal(await client.latest("class-id"), null);
    await client.append({
      id: "00000000-0000-4000-8000-000000000020",
      entityId: "class-id",
      operation: "class.create",
      createdAt: "2026-09-06T12:00:00.000Z",
      status: "retrying",
      attempts: 1,
      lastAttemptAt: "2026-09-06T12:00:00.000Z",
      lastError: null,
      payload: '{"entityId":"class-id"}',
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.method, "GET");
    assert.match(calls[0]?.path ?? "", /desk_sync_operations/);
    assert.match(
      calls[0]?.path ?? "",
      /account_id=eq\.00000000-0000-4000-8000-000000000010/,
    );
    assert.equal(calls[0]?.authorization, "Bearer test-access-token");
    assert.equal(calls[1]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), {
      operation_id: "00000000-0000-4000-8000-000000000020",
      account_id: "00000000-0000-4000-8000-000000000010",
      entity_id: "class-id",
      operation: "class.create",
      payload: { entityId: "class-id" },
      created_at: "2026-09-06T12:00:00.000Z",
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Supabase sync client lists account-scoped remote operations with a bounded cursor", async () => {
  const calls: string[] = [];
  const accountId = "00000000-0000-4000-8000-000000000010";
  const server = createServer((request, response) => {
    calls.push(request.url ?? "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify([
        {
          operation_id: "00000000-0000-4000-8000-000000000020",
          account_id: accountId,
          entity_id: "class-id",
          operation: "class.create",
          payload: { entityId: "class-id" },
          created_at: "2026-09-06T12:00:00.000Z",
        },
      ]),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new SupabaseSyncClient({
    url: `http://127.0.0.1:${address.port}`,
    publishableKey: "test-publishable-key",
    accessToken: "test-access-token",
    userId: accountId,
  });
  try {
    const operations = await client.list("2026-09-06T11:00:00.000Z", 500);
    assert.equal(operations[0]?.account_id, accountId);
    assert.match(calls[0] ?? "", /account_id=eq\.00000000-0000-4000-8000-000000000010/);
    assert.match(calls[0] ?? "", /created_at=gt\.2026-09-06T11%3A00%3A00\.000Z/);
    assert.match(calls[0] ?? "", /limit=100/);
    await assert.rejects(
      () => client.list("not-a-cursor"),
      /Sync cursor must be an ISO timestamp/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Supabase sync client rejects a remote operation from another account", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify([
        {
          operation_id: "00000000-0000-4000-8000-000000000020",
          account_id: "00000000-0000-4000-8000-000000000011",
          entity_id: "class-id",
          operation: "class.create",
          payload: {},
          created_at: "2026-09-06T12:00:00.000Z",
        },
      ]),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new SupabaseSyncClient({
    url: `http://127.0.0.1:${address.port}`,
    publishableKey: "test-publishable-key",
    accessToken: "test-access-token",
    userId: "00000000-0000-4000-8000-000000000010",
  });
  try {
    await assert.rejects(
      () => client.list(),
      /different account's operation/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Supabase sync client rejects empty non-success responses", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(401);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new SupabaseSyncClient({
    url: `http://127.0.0.1:${address.port}`,
    publishableKey: "test-publishable-key",
    accessToken: "test-access-token",
    userId: "00000000-0000-4000-8000-000000000010",
  });
  try {
    await assert.rejects(() => client.latest("class-id"), /HTTP 401/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Supabase sync client reconciles a duplicate operation after an interrupted upload", async () => {
  const remote: Array<Record<string, unknown>> = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(remote));
      return;
    }
    const operation = JSON.parse(body) as Record<string, unknown>;
    if (remote.some((item) => item.operation_id === operation.operation_id)) {
      response.writeHead(409);
      response.end();
      return;
    }
    remote.push(operation);
    response.writeHead(201);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new SupabaseSyncClient({
    url: `http://127.0.0.1:${address.port}`,
    publishableKey: "test-publishable-key",
    accessToken: "test-access-token",
    userId: "00000000-0000-4000-8000-000000000010",
  });
  const envelope = {
    id: "00000000-0000-4000-8000-000000000020",
    entityId: "class-id",
    operation: "class.create",
    createdAt: "2026-09-06T12:00:00.000Z",
    status: "retrying" as const,
    attempts: 1,
    lastAttemptAt: "2026-09-06T12:00:00.000Z",
    lastError: null,
    payload: '{"entityId":"class-id"}',
  };
  try {
    await client.append(envelope);
    await client.append(envelope);
    assert.equal(remote.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
