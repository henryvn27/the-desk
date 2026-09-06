import { setTimeout } from "node:timers/promises";

// Poll asynchronous IPC results in Node, where the condition is explicitly
// awaited. A Promise must never be mistaken for a satisfied condition.
export async function waitFor(check, message, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await setTimeout(50);
  }
  throw Error(message);
}
