import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeNotebookStudyEngine, NotebookLMRestEngine, type StudyEngineMaterial } from "./notebook-engine";

const material: StudyEngineMaterial = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "AP Physics · Unit 2",
  classId: "00000000-0000-4000-8000-000000000002",
  assessmentId: null,
  taskId: null,
  sourceIds: ["00000000-0000-4000-8000-000000000003"],
  noteIds: [],
  sourceFingerprint: "fingerprint",
  externalNotebookId: null,
  externalSourceIds: {},
  externalSourceFingerprints: {},
  createdAt: "2026-09-07T12:00:00.000Z",
  updatedAt: "2026-09-07T12:00:00.000Z",
  revision: 0,
  content: [{
    id: "00000000-0000-4000-8000-000000000003",
    title: "Forces handout",
    text: "Net force equals mass times acceleration.",
    kind: "source",
  }],
};

test("fake study engine produces Desk-native, provenance-bearing quiz and cards", async () => {
  const engine = new FakeNotebookStudyEngine();
  const status = await engine.status();
  assert.equal(status.available, true);
  assert.equal(status.capabilities.quiz, true);
  const quiz = await engine.generate(material, "quiz", { questionCount: 2 });
  assert.equal(quiz.status, "ready");
  assert.equal(quiz.payload?.kind, "quiz");
  if (quiz.payload?.kind === "quiz") {
    assert.equal(quiz.payload.questions.length, 2);
    assert.deepEqual(quiz.payload.questions[0]?.sourceIds, [material.content[0]!.id]);
  }
  const cards = await engine.generate(material, "flashcards", { questionCount: 1 });
  assert.equal(cards.payload?.kind, "flashcards");
  if (cards.payload?.kind === "flashcards") assert.equal(cards.payload.cards.length, 1);
});

test("media generation remains a native Desk artifact boundary", async () => {
  const engine = new FakeNotebookStudyEngine();
  for (const type of ["audio", "video"] as const) {
    const result = await engine.generate(material, type, {});
    assert.equal(result.status, "ready");
    assert.equal(result.payload?.kind, type);
    assert.equal(result.payload?.localPath, null);
  }
});

test("NotebookLM REST adapter rejects non-loopback endpoints", () => {
  assert.throws(
    () => new NotebookLMRestEngine({ baseUrl: "https://notebooklm.google.com", token: "test" }),
    /loopback/,
  );
});

test("NotebookLM REST adapter reuses unchanged external Sources and refreshes changed content", async () => {
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === "POST" && request.url === "/v1/notebooks/notebook-1/sources") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "refreshed-source" }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const engine = new NotebookLMRestEngine({ baseUrl: `http://127.0.0.1:${address.port}`, token: "test" });
  try {
    const first = await engine.ensureMaterialSet({
      ...material,
      externalNotebookId: "notebook-1",
      externalSourceIds: { [material.content[0]!.id]: "old-source" },
      externalSourceFingerprints: {},
    });
    assert.deepEqual(first.externalSourceIds, { [material.content[0]!.id]: "refreshed-source" });
    assert.equal(requests.length, 1);

    const second = await engine.ensureMaterialSet({
      ...material,
      externalNotebookId: first.externalNotebookId ?? null,
      externalSourceIds: first.externalSourceIds ?? {},
      externalSourceFingerprints: first.externalSourceFingerprints ?? {},
    });
    assert.deepEqual(second.externalSourceIds, first.externalSourceIds);
    assert.equal(requests.length, 1, "unchanged content should not upload a duplicate Source");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("NotebookLM REST status is bounded when the local engine stops responding", async () => {
  const server = createServer(() => {
    // Deliberately leave the request open to exercise the adapter timeout.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const engine = new NotebookLMRestEngine({ baseUrl: `http://127.0.0.1:${address.port}`, token: "test", requestTimeoutMs: 100 });
  try {
    const started = Date.now();
    const result = await engine.status();
    assert.equal(result.available, false);
    assert.ok(Date.now() - started < 2_000);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("NotebookLM REST adapter refuses oversized media before writing a file", async () => {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/notebooks/notebook-1/artifacts/artifact-1") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "ready" }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/notebooks/notebook-1/artifacts/download") {
      const body = Buffer.alloc(2_048, 1);
      response.statusCode = 200;
      response.setHeader("content-length", body.byteLength);
      response.end(body);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const directory = await mkdtemp(join(tmpdir(), "desk-study-media-"));
  const engine = new NotebookLMRestEngine({ baseUrl: `http://127.0.0.1:${address.port}`, token: "test", downloadDir: directory, maxMediaBytes: 1_024 });
  try {
    await assert.rejects(() => engine.poll({ ...material, externalNotebookId: "notebook-1" }, "audio", "artifact-1"), /too large/);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("NotebookLM REST adapter refuses oversized structured exports before parsing", async () => {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/notebooks/notebook-1/artifacts/artifact-1") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "ready" }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/notebooks/notebook-1/artifacts/download") {
      response.statusCode = 200;
      response.setHeader("content-length", 9 * 1024 * 1024);
      response.end("{}");
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const engine = new NotebookLMRestEngine({ baseUrl: `http://127.0.0.1:${address.port}`, token: "test" });
  try {
    await assert.rejects(() => engine.poll({ ...material, externalNotebookId: "notebook-1" }, "quiz", "artifact-1"), /too large/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
