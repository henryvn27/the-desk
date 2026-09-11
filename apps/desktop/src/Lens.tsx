import { useEffect, useRef, useState } from "react";
import { userError } from "./errors";
import type {
  LensHistoryTurn,
  LensOverlayMark,
  LensResponse,
  LensSelection,
} from "../../../packages/intelligence/lens-provider";
import {
  initialLensInteractionState,
  type LensInteractionState,
} from "../../../packages/intelligence/lens-interaction";
import { selectionBounds } from "../../../packages/intelligence/lens-selection";
import type { Command, Snapshot, Source } from "../../../packages/domain/contracts";
import type { BrowserBridgeMessage } from "../../../packages/integrations/browser-bridge";
import {
  lensAnswerCanvasScene,
  lensAnswerMemoryInput,
  lensAnswerMistakeInput,
  lensAnswerSourceInput,
  lensFollowUpTaskInput,
} from "../../../packages/intelligence/lens-actions";
import { type StudyActivityKind } from "../../../packages/study/activities";
import { IconButton, Textarea } from "./components/base";
import { XClose } from "@untitledui/icons";

type Point = { x: number; y: number };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
  }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function Lens({
  title,
  className,
  taskId,
  classId,
  taskResource,
  browserContext,
  clearBrowserContext,
  save,
  initialActivity,
  sources,
}: {
  title: string;
  className: string;
  classId?: string;
  taskId?: string;
  taskResource?: string;
  browserContext: BrowserBridgeMessage | null;
  clearBrowserContext: () => Promise<void>;
  save: (command: Command) => Promise<Snapshot | undefined>;
  initialActivity?: StudyActivityKind;
  sources: Source[];
}) {
  const [interaction, setInteraction] = useState<LensInteractionState>(
    initialLensInteractionState,
  );
  const [paths, setPaths] = useState<Point[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState<LensResponse | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [marks, setMarks] = useState<LensOverlayMark[]>([]);
  const [visibleMarks, setVisibleMarks] = useState<LensOverlayMark[]>([]);
  const [history, setHistory] = useState<LensHistoryTurn[]>([]);
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [activity, setActivity] = useState<StudyActivityKind>(initialActivity ?? "check");
  const [actionBusy, setActionBusy] = useState(false);
  const [showMistake, setShowMistake] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechTextRef = useRef("");
  const speechFinalTextRef = useRef("");
  const questionRef = useRef("");
  const submittedQuestionRef = useRef("");
  const activeModeRef = useRef<LensInteractionState["mode"]>(null);
  const previousPhaseRef = useRef<LensInteractionState["phase"] | null>(null);
  const hasSentFallbackKeyUp = useRef(false);
  const scopedSources = sources.filter((source) => scopeIds.includes(source.id));
  const selecting = interaction.phase === "voice-selecting" || interaction.phase === "typed-selecting";
  const inputVisible = interaction.phase === "typed-input";
  const answerVisible = interaction.phase === "answer";
  const hasSelection = paths.some((path) => path.length > 0);

  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  function stopPresentation() {
    if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
    setVisibleMarks([]);
    setMarks([]);
  }

  function speakExplanation(explanation: string) {
    if (activeModeRef.current !== "voice" || typeof window.speechSynthesis === "undefined") return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(explanation.slice(0, 1_200));
    utterance.rate = 1.04;
    utterance.pitch = 1;
    utterance.volume = 0.86;
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    const applyContext = (context: { question?: string; activityKind?: StudyActivityKind; sourceIds?: string[] } | null) => {
      if (!context) return;
      if (context.question) setQuestion(context.question);
      if (context.activityKind) setActivity(context.activityKind);
      if (context.sourceIds) setScopeIds([...new Set(context.sourceIds)]);
    };
    const unsubscribe = window.desk.onLensContext(applyContext);
    void window.desk.lensContext().then(applyContext).catch(() => undefined);
    return unsubscribe;
  }, []);

  useEffect(() => {
    void window.desk.lensInteractionState().then(setInteraction).catch(() => undefined);
    const unsubscribe = window.desk.onLensInteraction((next) => {
      const previousPhase = previousPhaseRef.current;
      previousPhaseRef.current = next.phase;
      activeModeRef.current = next.mode;
      if (
        (next.phase === "arming" || next.phase === "voice-selecting" || next.phase === "typed-selecting") &&
        (previousPhase === "answer" || previousPhase === "submitting")
      ) {
        stopPresentation();
        setPaths([]);
        setAnswer(null);
        setQuestion("");
        setTranscript("");
        speechTextRef.current = "";
        speechFinalTextRef.current = "";
        setError("");
        setStatus("");
      }
      setInteraction(next);
      if (next.phase === "voice-selecting") {
        setStatus("Listening");
        setError("");
      } else if (next.phase === "typed-selecting") {
        setStatus("Select");
        setError("");
      } else if (next.phase === "typed-input") {
        setStatus("");
        setBusy(false);
      } else if (next.phase === "submitting") {
        setBusy(true);
        setStatus("");
      } else if (next.phase === "answer") {
        setBusy(false);
      }
    });
    const answerUnsubscribe = window.desk.onLensAnswer((response) => {
      setAnswer(response);
      setError("");
      setBusy(false);
      setQuestion("");
      setTranscript("");
      speechTextRef.current = "";
      speechFinalTextRef.current = "";
      setMarks(response.overlays);
      speakExplanation(response.explanation);
      const submittedQuestion = submittedQuestionRef.current || questionRef.current;
      setHistory((turns) => [
        ...turns,
        ...(submittedQuestion.trim() ? [{ role: "user" as const, content: submittedQuestion.trim() }] : []),
        { role: "assistant" as const, content: response.explanation.slice(0, 4_000) },
      ].slice(-8));
      submittedQuestionRef.current = "";
    });
    const errorUnsubscribe = window.desk.onLensError((message) => {
      setError(userError(new Error(message)));
      setBusy(false);
    });
    return () => {
      unsubscribe();
      answerUnsubscribe();
      errorUnsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!answerVisible || marks.length === 0) {
      setVisibleMarks([]);
      return;
    }
    const ordered = marks
      .map((mark, index) => ({ mark, index }))
      .filter(({ mark }) => mark.confidence == null || mark.confidence >= 0.45)
      .sort((left, right) => (left.mark.sequence ?? left.index) - (right.mark.sequence ?? right.index));
    setVisibleMarks([]);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [index, item] of ordered.entries()) {
      const delay = Math.min(3_000, index * 320);
      timers.push(setTimeout(() => {
        setVisibleMarks((current) => [...current, item.mark]);
      }, delay));
      const duration = Math.max(300, Math.min(12_000, item.mark.durationMs ?? 4_800));
      timers.push(setTimeout(() => {
        setVisibleMarks((current) => current.filter((mark) => mark !== item.mark));
      }, delay + duration));
    }
    return () => timers.forEach(clearTimeout);
  }, [answerVisible, marks]);

  useEffect(() => {
    if (!selecting && !inputVisible) return;
    const selection: LensSelection = { paths: paths.map((points) => ({ points })) };
    void window.desk.lensDraft(selection, transcript).catch(() => undefined);
  }, [paths, transcript, selecting, inputVisible]);

  useEffect(() => {
    if (!inputVisible) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("#lens-question")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [inputVisible]);

  useEffect(() => {
    if (interaction.phase !== "voice-selecting") {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      return;
    }
    let stream: MediaStream | null = null;
    let active = true;
    const browserWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const recognitionConstructor = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Error("unavailable");
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active) return;
        if (!recognitionConstructor) {
          setStatus("Listening · microphone ready. Type a question after release if needed.");
          return;
        }
        const recognition = new recognitionConstructor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = navigator.language || "en-US";
        recognition.onresult = (event) => {
          let finalText = speechFinalTextRef.current;
          let interimText = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const value = result?.[0]?.transcript?.trim() ?? "";
            if (result?.isFinal && value) finalText = `${finalText} ${value}`.trim();
            else if (value) interimText = `${interimText} ${value}`.trim();
          }
          speechFinalTextRef.current = finalText.slice(0, 4_000);
          speechTextRef.current = `${speechFinalTextRef.current} ${interimText}`.trim().slice(0, 4_000);
          setTranscript(speechTextRef.current);
        };
        recognition.onerror = (event) => {
          if (event.error === "not-allowed" || event.error === "service-not-allowed")
            setStatus("Microphone permission is off. Release to type a question instead.");
          else setStatus("Microphone unavailable. Release to type a question instead.");
        };
        recognition.onend = () => {
          if (active && interaction.phase === "voice-selecting") {
            try { recognition.start(); } catch { /* browser already stopped */ }
          }
        };
        recognitionRef.current = recognition;
        try { recognition.start(); } catch { setStatus("Microphone unavailable. Release to type a question instead."); }
      } catch {
        setStatus("Microphone permission is unavailable. Release to type a question instead.");
      }
    };
    speechFinalTextRef.current = transcript;
    speechTextRef.current = transcript;
    void start();
    return () => {
      active = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [interaction.phase]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stopPresentation();
        void window.desk.dismiss();
        return;
      }
      if (event.code === "Space" && event.altKey && interaction.phase === "voice-selecting" && !hasSentFallbackKeyUp.current) {
        hasSentFallbackKeyUp.current = true;
        void window.desk.lensKeyUp().catch(() => undefined);
      }
    };
    window.addEventListener("keyup", onKeyUp);
    return () => window.removeEventListener("keyup", onKeyUp);
  }, [interaction.phase]);

  useEffect(() => {
    if (interaction.phase !== "voice-selecting") hasSentFallbackKeyUp.current = false;
  }, [interaction.phase]);

  function point(event: React.PointerEvent): Point {
    return {
      x: Math.max(0, Math.min(1, event.clientX / Math.max(1, window.innerWidth))),
      y: Math.max(0, Math.min(1, event.clientY / Math.max(1, window.innerHeight))),
    };
  }

  function updatePath(event: React.PointerEvent) {
    if (!drawing) return;
    const next = point(event);
    setPaths((all) => all.map((path, index) => index === all.length - 1 && path.length < 1_500 ? [...path, next] : path));
  }

  async function submit() {
    const value = question.trim() || transcript.trim();
    if (!value || busy) return;
    submittedQuestionRef.current = value;
    setBusy(true);
    setError("");
    try {
      const result = await window.desk.lensSubmit({
        question: value,
        transcript,
        selection: { paths: paths.map((points) => ({ points })) },
        ...(history.length ? { history } : {}),
        ...(scopeIds.length ? { sourceIds: scopeIds } : {}),
        activityKind: activity,
      });
      if ("needsQuestion" in result) {
        setBusy(false);
        setStatus(result.message);
        return;
      }
      setAnswer(result);
      setMarks(result.overlays);
      setQuestion("");
      setTranscript("");
    } catch (e) {
      setBusy(false);
      setError(userError(e));
    }
  }

  async function saveAnswerToNotes(origin: "lens" | "enhanced" = "lens") {
    if (!classId || !taskId || !answer) return;
    setActionBusy(true);
    setError("");
    try {
      const withSource = await save({ type: "source.create", input: lensAnswerSourceInput(answer.explanation, classId, taskId) });
      const source = withSource?.sources.at(-1);
      if (!source) throw Error("Lens source was not saved.");
      const withCanvas = await save({ type: "canvas.create", taskId });
      const canvas = withCanvas?.canvases.at(-1);
      if (!canvas) throw Error("Lens Notes workspace was not created.");
      await save({ type: "canvas.save", id: canvas.id, revision: canvas.revision, scene: lensAnswerCanvasScene(answer.explanation, source.id, origin) });
      setStatus(origin === "enhanced" ? "Enhanced Notes saved with source provenance." : "Lens answer saved to Notes with its source.");
    } catch (value) {
      setError(userError(value));
    } finally {
      setActionBusy(false);
    }
  }

  const bounds = selectionBounds({ paths: paths.map((points) => ({ points })) });
  const inputStyle = bounds
    ? { left: `${Math.min(70, Math.max(2, bounds.x * 100))}%`, top: `${Math.min(78, Math.max(2, (bounds.y + bounds.height) * 100 + 2))}%` }
    : { right: "24px", bottom: "24px" };
  const answerToRight = bounds ? bounds.x + bounds.width <= 0.64 : true;
  const answerAbove = bounds ? bounds.y > 0.58 : false;
  const answerStyle = bounds
    ? {
        left: `${Math.min(96, Math.max(4, (answerToRight ? bounds.x + bounds.width + 0.015 : bounds.x - 0.015) * 100))}%`,
        top: `${Math.min(96, Math.max(4, bounds.y * 100))}%`,
        transform: `${answerToRight ? "" : "translateX(-100%)"}${answerAbove ? " translateY(-100%)" : ""}`.trim() || undefined,
      }
    : { right: "24px", top: "24px" };
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);

  function renderMark(mark: LensOverlayMark, index: number) {
    const x = mark.x * viewportWidth;
    const y = mark.y * viewportHeight;
    const x2 = (mark.x2 ?? mark.x) * viewportWidth;
    const y2 = (mark.y2 ?? mark.y) * viewportHeight;
    const key = `${mark.type}-${index}-${mark.sequence ?? 0}`;
    if (mark.type === "point")
      return <circle key={key} className="lens-mark lens-mark-point" cx={x} cy={y} r={5} />;
    if (mark.type === "arrow")
      return <line key={key} className="lens-mark lens-mark-arrow" x1={x} y1={y} x2={x2} y2={y2} markerEnd="url(#lens-arrowhead)" />;
    if (mark.type === "underline")
      return <line key={key} className="lens-mark lens-mark-underline" x1={x} y1={y} x2={x2} y2={y2} />;
    if (mark.type === "circle") {
      const rx = Math.max(14, Math.abs(x2 - x) / 2);
      const ry = Math.max(14, Math.abs(y2 - y) / 2);
      return <ellipse key={key} className="lens-mark lens-mark-circle" cx={(x + x2) / 2} cy={(y + y2) / 2} rx={rx} ry={ry} />;
    }
    if (mark.type === "highlight") {
      const left = Math.min(x, x2);
      const top = Math.min(y, y2);
      return <rect key={key} className="lens-mark lens-mark-highlight" x={left} y={top} width={Math.max(18, Math.abs(x2 - x))} height={Math.max(14, Math.abs(y2 - y))} rx={5} />;
    }
    const label = mark.text?.slice(0, 160) ?? "";
    if (!label) return null;
    const labelX = Math.min(Math.max(8, x), Math.max(8, viewportWidth - 188));
    const labelY = Math.min(Math.max(22, y), Math.max(22, viewportHeight - 12));
    return (
      <g key={key} className="lens-mark lens-mark-label">
        <rect x={labelX - 7} y={labelY - 19} width={Math.min(188, Math.max(44, label.length * 6.5 + 16))} height={25} rx={8} />
        <text x={labelX} y={labelY - 2}>{label}</text>
      </g>
    );
  }

  return (
    <main className={`lens lens-${interaction.phase}`} data-selection={hasSelection ? "ready" : "waiting"}>
      {selecting && <span className="lens-live-region" role="status" aria-live="polite">{status || "Lens ready"}</span>}
      {inputVisible && (
        <div className="lens-input-popover" style={inputStyle}>
          <Textarea
            id="lens-question"
            aria-label="Ask Lens"
            value={question}
            onChange={(event) => setQuestion(event.target.value.slice(0, 4_000))}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                void window.desk.dismiss();
              } else if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={2}
            maxLength={4_000}
            placeholder="Ask about this…"
          />
          <div className="lens-input-hint">Enter to ask · Shift+Enter for a new line · Esc to cancel</div>
        </div>
      )}
      {(selecting || inputVisible || answerVisible) && (
        <svg
          className={`lens-selection-surface${answerVisible ? " lens-answer-overlay" : ""}`}
          aria-label={answerVisible ? "Lens visual explanation" : "Draw a freeform Lens selection"}
          aria-hidden={answerVisible ? true : undefined}
          viewBox={`0 0 ${viewportWidth} ${viewportHeight}`}
          preserveAspectRatio="none"
          onPointerDown={(event) => {
            if (!selecting || paths.length >= 8) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrawing(true);
            setPaths((all) => [...all, [point(event)]]);
          }}
          onPointerMove={updatePath}
          onPointerUp={() => {
            setDrawing(false);
            if (interaction.phase === "typed-selecting") void window.desk.lensSelectionFinished();
          }}
          onPointerCancel={() => setDrawing(false)}
        >
          {paths.map((path, index) => (
            <path
              key={index}
              data-lens-selection-path="true"
              d={path.map((value, pointIndex) => `${pointIndex ? "L" : "M"} ${value.x * window.innerWidth} ${value.y * window.innerHeight}`).join(" ")}
              fill="none"
              stroke="#E8A47C"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          <defs>
            <marker id="lens-arrowhead" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 9 4.5 L 0 9 z" />
            </marker>
          </defs>
          {(answerVisible ? visibleMarks : []).map(renderMark)}
        </svg>
      )}
      {answerVisible && (
        <section className="lens-answer-surface" style={answerStyle} aria-live="polite">
          <header className="lens-answer-header">
            <div>
              <div className="eyebrow">Lens{className ? ` · ${className}` : ""}</div>
              <strong>{error ? "Lens needs attention" : "Answer"}</strong>
            </div>
          <IconButton className="lens-close" label="Dismiss Lens" icon={XClose} onPress={() => { stopPresentation(); void window.desk.dismiss(); }} />
          </header>
          <div className="lens-answer-text">{error || answer?.explanation || "Lens could not complete this request."}</div>
          {answer && (
            <details className="lens-answer-details">
              <summary>Save or continue</summary>
              {(scopedSources.length > 0 || browserContext) && (
                <div className="lens-answer-context">
                  {scopedSources.length > 0 && <span>{scopedSources.length} Library source{scopedSources.length === 1 ? "" : "s"} in scope</span>}
                  {browserContext && <span>{browserContext.context.title || "Browser context"}</span>}
                  {browserContext && <button type="button" onClick={() => void clearBrowserContext()}>Clear browser context</button>}
                </div>
              )}
              <div className="lens-actions" aria-label="Lens actions">
                {classId && <button type="button" disabled={actionBusy} onClick={async () => { setActionBusy(true); try { await save({ type: "source.create", input: lensAnswerSourceInput(answer.explanation, classId, taskId ?? null) }); setStatus("Lens answer saved as a source."); } catch (value) { setError(userError(value)); } finally { setActionBusy(false); } }}>Save as source</button>}
                {classId && <button type="button" disabled={actionBusy} onClick={async () => { setActionBusy(true); try { await save({ type: "memory.create", input: lensAnswerMemoryInput(answer.explanation, classId) }); setStatus("Lens answer saved as a note."); } catch (value) { setError(userError(value)); } finally { setActionBusy(false); } }}>Save as note</button>}
                {classId && taskId && <button type="button" disabled={actionBusy} onClick={() => void saveAnswerToNotes()}>Save to Notes</button>}
                {classId && taskId && <button type="button" disabled={actionBusy} onClick={() => void saveAnswerToNotes("enhanced")}>Enhance Notes</button>}
                {classId && <button type="button" aria-expanded={showMistake} disabled={actionBusy} onClick={() => setShowMistake((value) => !value)}>Save as mistake</button>}
                {classId && <button type="button" disabled={actionBusy} onClick={async () => { setActionBusy(true); try { await save({ type: "task.create", input: lensFollowUpTaskInput(answer.explanation, classId, taskResource ?? null) }); setStatus(taskResource ? "Lens resource review prepared." : "Lens follow-up task created."); } catch (value) { setError(userError(value)); } finally { setActionBusy(false); } }}>{taskResource ? "Prepare review" : "Create follow-up"}</button>}
                {taskId && taskResource && <button type="button" disabled={actionBusy} onClick={async () => { setActionBusy(true); try { await window.desk.openResource(taskId); setStatus("Opened task resource."); } catch (value) { setError(userError(value)); } finally { setActionBusy(false); } }}>Open resource</button>}
              </div>
              {showMistake && classId && <form className="lens-mistake" onSubmit={async (event) => { event.preventDefault(); setActionBusy(true); try { const values = new FormData(event.currentTarget); await save({ type: "mistake.create", input: lensAnswerMistakeInput(answer.explanation, classId, taskId ?? null, { concept: String(values.get("concept")), originalAttempt: String(values.get("originalAttempt")), whatWentWrong: String(values.get("whatWentWrong")) }) }); setShowMistake(false); setStatus("Mistake saved for review."); } catch (value) { setError(userError(value)); } finally { setActionBusy(false); } }}><label>Concept<input name="concept" required maxLength={300} defaultValue={title} /></label><label>What I tried<textarea name="originalAttempt" required maxLength={5000} /></label><label>What went wrong<textarea name="whatWentWrong" required maxLength={5000} /></label><button type="submit" disabled={actionBusy}>Save mistake</button></form>}
            </details>
          )}
          {status && <p className="lens-status" role="status">{status}</p>}
        </section>
      )}
      {!selecting && !inputVisible && !answerVisible && error && <p className="lens-status" role="alert">{error}</p>}
    </main>
  );
}
