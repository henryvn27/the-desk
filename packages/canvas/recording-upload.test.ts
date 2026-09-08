import assert from "node:assert/strict";
import { test } from "node:test";
import { RecordingChunkQueue } from "./recording-upload";

test("recording chunks retry transient failure without changing order", async () => {
  const calls: Array<{ index: number; data: number[] }> = [];
  let firstAttempt = true;
  const queue = new RecordingChunkQueue(
    0,
    async (index, data) => {
      calls.push({ index, data: [...data] });
      if (firstAttempt) {
        firstAttempt = false;
        throw Error("temporary disk failure");
      }
      return { chunkIndex: index, chunkCount: index + 1 };
    },
    { retryDelayMs: 0, sleep: async () => undefined },
  );

  queue.enqueue(new Uint8Array([1, 2]));
  queue.enqueue(new Uint8Array([3, 4]));
  const result = await queue.flush();

  assert.deepEqual(result, { chunkCount: 2 });
  assert.deepEqual(calls.map((call) => call.index), [0, 0, 1]);
  assert.deepEqual(calls[0]?.data, [1, 2]);
  assert.deepEqual(calls.at(-1)?.data, [3, 4]);
});

test("persistent recording loss stops later chunks and reports the durable prefix", async () => {
  const calls: number[] = [];
  const queue = new RecordingChunkQueue(
    0,
    async (index) => {
      calls.push(index);
      if (index === 1) throw Error("disk is full");
      return { chunkIndex: index, chunkCount: index + 1 };
    },
    { maxAttempts: 3, retryDelayMs: 0, sleep: async () => undefined },
  );

  queue.enqueue(new Uint8Array([1]));
  queue.enqueue(new Uint8Array([2]));
  queue.enqueue(new Uint8Array([3]));
  const result = await queue.flush();

  assert.equal(result.chunkCount, 1);
  assert.deepEqual(result.failure, {
    chunkIndex: 1,
    attempts: 3,
    message: "disk is full",
  });
  assert.deepEqual(calls, [0, 1, 1, 1]);
});

test("non-contiguous recording commits fail closed", async () => {
  const queue = new RecordingChunkQueue(
    4,
    async (index) => ({ chunkIndex: index + 1, chunkCount: index + 2 }),
    { maxAttempts: 1, retryDelayMs: 0, sleep: async () => undefined },
  );
  queue.enqueue(new Uint8Array([9]));
  const result = await queue.flush();
  assert.equal(result.chunkCount, 4);
  assert.equal(result.failure?.chunkIndex, 4);
  assert.match(result.failure?.message ?? "", /non-contiguous/);
});
