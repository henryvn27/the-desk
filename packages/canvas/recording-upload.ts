export type RecordingChunkCommit = {
  chunkIndex: number;
  chunkCount: number;
};

export type RecordingChunkSender = (
  chunkIndex: number,
  data: Uint8Array,
) => Promise<RecordingChunkCommit>;

export type RecordingChunkFailure = {
  chunkIndex: number;
  attempts: number;
  message: string;
};

export type RecordingChunkQueueResult = {
  chunkCount: number;
  failure?: RecordingChunkFailure;
};

type RecordingChunkQueueOptions = {
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

/**
 * Serializes recording chunks and stops on a known loss.
 *
 * A failed chunk is retried a small, bounded number of times. If it still
 * cannot be persisted, later chunks are deliberately not sent with a reused
 * index. The caller can then finalize the durable prefix as failed rather than
 * presenting a corrupt stream as complete.
 */
export class RecordingChunkQueue {
  private chain = Promise.resolve();
  private nextEnqueueIndex: number;
  private committedCount: number;
  private failure: RecordingChunkFailure | undefined;
  private readonly sender: RecordingChunkSender;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    initialChunkCount: number,
    sender: RecordingChunkSender,
    options: RecordingChunkQueueOptions = {},
  ) {
    if (!Number.isInteger(initialChunkCount) || initialChunkCount < 0)
      throw new RangeError("A recording queue needs a non-negative chunk count.");
    this.nextEnqueueIndex = initialChunkCount;
    this.committedCount = initialChunkCount;
    this.sender = sender;
    this.maxAttempts = Math.max(1, Math.min(5, Math.trunc(options.maxAttempts ?? 3)));
    this.retryDelayMs = Math.max(0, Math.min(2_000, Math.trunc(options.retryDelayMs ?? 100)));
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  enqueue(data: Uint8Array): void {
    if (!(data instanceof Uint8Array) || data.byteLength < 1)
      throw new TypeError("A recording chunk must contain audio bytes.");
    const chunkIndex = this.nextEnqueueIndex;
    this.nextEnqueueIndex += 1;
    const retained = new Uint8Array(data);
    this.chain = this.chain.then(async () => {
      if (this.failure) return;
      let lastError: unknown;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const result = await this.sender(chunkIndex, retained);
          if (result.chunkIndex !== chunkIndex || result.chunkCount !== chunkIndex + 1)
            throw Error("The recording store returned a non-contiguous chunk result.");
          this.committedCount = result.chunkCount;
          return;
        } catch (error) {
          lastError = error;
          if (attempt < this.maxAttempts)
            await this.sleep(this.retryDelayMs * attempt);
        }
      }
      this.failure = {
        chunkIndex,
        attempts: this.maxAttempts,
        message: lastError instanceof Error ? lastError.message : "The recording chunk could not be saved.",
      };
    });
  }

  async flush(): Promise<RecordingChunkQueueResult> {
    await this.chain;
    return {
      chunkCount: this.committedCount,
      ...(this.failure ? { failure: this.failure } : {}),
    };
  }
}
