import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LENS_DOUBLE_TAP_WINDOW_MS,
  LENS_HOLD_THRESHOLD_MS,
  initialLensInteractionState,
  reduceLensInteraction,
} from "./lens-interaction";

test("a sustained press decisively enters voice selection", () => {
  let state = initialLensInteractionState();
  state = reduceLensInteraction(state, { type: "key-down", at: 100 });
  state = reduceLensInteraction(state, {
    type: "hold-elapsed",
    at: 100 + LENS_HOLD_THRESHOLD_MS,
  });
  assert.equal(state.phase, "voice-selecting");
  assert.equal(state.mode, "voice");
  state = reduceLensInteraction(state, { type: "key-up", at: 500 });
  assert.equal(state.phase, "typed-input");
  assert.equal(state.requestCount, 0);
});

test("a quick first tap waits without flashing voice mode", () => {
  let state = reduceLensInteraction(initialLensInteractionState(), {
    type: "key-down",
    at: 0,
  });
  state = reduceLensInteraction(state, { type: "key-up", at: 80 });
  assert.equal(state.phase, "tap-pending");
  state = reduceLensInteraction(state, {
    type: "double-timeout",
    at: LENS_DOUBLE_TAP_WINDOW_MS + 80,
  });
  assert.equal(state.phase, "idle");
});

test("a second quick tap enters typed selection and never voice submission", () => {
  let state = initialLensInteractionState();
  state = reduceLensInteraction(state, { type: "key-down", at: 0 });
  state = reduceLensInteraction(state, { type: "key-up", at: 60 });
  state = reduceLensInteraction(state, {
    type: "key-down",
    at: 60 + LENS_DOUBLE_TAP_WINDOW_MS - 1,
  });
  assert.equal(state.phase, "typed-selecting");
  assert.equal(state.mode, "typed");
  state = reduceLensInteraction(state, { type: "key-up", at: 200 });
  assert.equal(state.phase, "typed-selecting");
});

test("typed selection and Enter submit exactly once", () => {
  let state = reduceLensInteraction(initialLensInteractionState(), {
    type: "open-typed",
  });
  state = reduceLensInteraction(state, {
    type: "selection-finished",
    hasSelection: true,
  });
  state = reduceLensInteraction(state, {
    type: "question-changed",
    hasQuestion: true,
  });
  state = reduceLensInteraction(state, { type: "submit" });
  state = reduceLensInteraction(state, { type: "submit" });
  assert.equal(state.phase, "submitting");
  assert.equal(state.requestCount, 1);
});

test("Escape cancels every pre-submit phase", () => {
  for (const phaseEvent of [
    { type: "key-down", at: 0 } as const,
    { type: "open-typed" } as const,
    { type: "open-typed" } as const,
  ]) {
    let state = reduceLensInteraction(initialLensInteractionState(), phaseEvent);
    if (state.phase === "arming")
      state = reduceLensInteraction(state, { type: "hold-elapsed", at: 300 });
    if (state.phase === "typed-selecting")
      state = reduceLensInteraction(state, {
        type: "selection-finished",
        hasSelection: true,
      });
    state = reduceLensInteraction(state, { type: "escape" });
    assert.deepEqual(state, initialLensInteractionState());
  }
});

test("a new invocation interrupts an answer and arms the next Lens question", () => {
  const state = reduceLensInteraction(
    {
      ...initialLensInteractionState(),
      phase: "answer",
      mode: "voice",
      requestCount: 1,
    },
    { type: "key-down", at: 1_000 },
  );

  assert.equal(state.phase, "arming");
  assert.equal(state.mode, null);
  assert.equal(state.tapStartedAt, 1_000);
});
