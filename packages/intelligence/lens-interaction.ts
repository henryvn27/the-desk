/**
 * The global Lens gesture is deliberately modelled as one small state
 * machine.  Timers live at the Electron boundary; this module only decides
 * what a key/drawing/input event means, which keeps double-tap and hold
 * behaviour deterministic and easy to test.
 */
export const LENS_HOLD_THRESHOLD_MS = 260;
export const LENS_DOUBLE_TAP_WINDOW_MS = 300;

export type LensInteractionPhase =
  | "idle"
  | "arming"
  | "tap-pending"
  | "voice-selecting"
  | "typed-selecting"
  | "typed-input"
  | "submitting"
  | "answer";

export type LensInteractionMode = "voice" | "typed" | null;

export type LensInteractionState = {
  phase: LensInteractionPhase;
  mode: LensInteractionMode;
  selectionReady: boolean;
  questionReady: boolean;
  requestCount: number;
  tapStartedAt: number | null;
  lastError: string | null;
};

export type LensInteractionEvent =
  | { type: "key-down"; at: number }
  | { type: "hold-elapsed"; at: number }
  | { type: "key-up"; at: number }
  | { type: "double-timeout"; at: number }
  | { type: "open-typed" }
  | { type: "selection-finished"; hasSelection: boolean }
  | { type: "selection-updated"; hasSelection: boolean }
  | { type: "question-changed"; hasQuestion: boolean }
  | { type: "submit" }
  | { type: "request-succeeded" }
  | { type: "request-failed"; message: string }
  | { type: "escape" }
  | { type: "dismiss" };

export const initialLensInteractionState = (): LensInteractionState => ({
  phase: "idle",
  mode: null,
  selectionReady: false,
  questionReady: false,
  requestCount: 0,
  tapStartedAt: null,
  lastError: null,
});

export function reduceLensInteraction(
  state: LensInteractionState,
  event: LensInteractionEvent,
): LensInteractionState {
  switch (event.type) {
    case "open-typed":
      return {
        ...initialLensInteractionState(),
        phase: "typed-selecting",
        mode: "typed",
      };
    case "key-down":
      // While an answer is visible (or a request is still in flight), a new
      // invocation is a fresh Lens question. The Electron boundary aborts the
      // request; the reducer immediately arms the next hold without waiting
      // for the previous response to settle.
      if (state.phase === "answer" || state.phase === "submitting")
        return {
          ...initialLensInteractionState(),
          phase: "arming",
          tapStartedAt: event.at,
        };
      if (state.phase === "idle")
        return { ...state, phase: "arming", tapStartedAt: event.at, lastError: null };
      if (
        state.phase === "tap-pending" &&
        state.tapStartedAt !== null &&
        event.at - state.tapStartedAt <= LENS_DOUBLE_TAP_WINDOW_MS
      )
        return {
          ...state,
          phase: "typed-selecting",
          mode: "typed",
          tapStartedAt: null,
          lastError: null,
        };
      return state;
    case "hold-elapsed":
      if (state.phase !== "arming") return state;
      return {
        ...state,
        phase: "voice-selecting",
        mode: "voice",
        tapStartedAt: null,
        lastError: null,
      };
    case "key-up":
      if (state.phase === "arming")
        return {
          ...state,
          phase: "tap-pending",
          tapStartedAt: event.at,
        };
      if (state.phase === "voice-selecting")
        return state.selectionReady || state.questionReady
          ? {
              ...state,
              phase: "submitting",
              requestCount: state.requestCount + 1,
            }
          : {
              ...state,
              phase: "typed-input",
              mode: "voice",
              questionReady: false,
            };
      return state;
    case "double-timeout":
      return state.phase === "tap-pending"
        ? initialLensInteractionState()
        : state;
    case "selection-finished":
      if (state.phase !== "typed-selecting") return state;
      return {
        ...state,
        phase: "typed-input",
        selectionReady: event.hasSelection,
      };
    case "selection-updated":
      return { ...state, selectionReady: event.hasSelection };
    case "question-changed":
      return { ...state, questionReady: event.hasQuestion };
    case "submit":
      if (
        (state.phase !== "typed-input" && state.phase !== "voice-selecting") ||
        !state.questionReady
      )
        return state;
      return {
        ...state,
        phase: "submitting",
        requestCount: state.requestCount + 1,
      };
    case "request-succeeded":
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "answer" };
    case "request-failed":
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "answer", lastError: event.message };
    case "escape":
    case "dismiss":
      return initialLensInteractionState();
    default:
      return state;
  }
}
