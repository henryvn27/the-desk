import type { TutoringMode } from "../../../packages/intelligence/tutoring";
import { userError } from "./errors";
import { useState } from "react";
import type {
  LensOverlayMark,
  LensHistoryTurn,
} from "../../../packages/intelligence/lens-provider";
import type { Command } from "../../../packages/domain/contracts";
import type { Snapshot } from "../../../packages/domain/contracts";
import {
  lensAnswerCanvasScene,
  lensAnswerMemoryInput,
  lensAnswerMistakeInput,
  lensAnswerSourceInput,
  lensFollowUpTaskInput,
} from "../../../packages/intelligence/lens-actions";
type Point = { x: number; y: number };
export function Lens({
  title,
  className,
  tutoringMode,
  saveTutoringMode,
  classId,
  taskId,
  taskResource,
  save,
}: {
  tutoringMode: TutoringMode;
  saveTutoringMode: (mode: TutoringMode) => Promise<unknown>;
  title: string;
  className: string;
  classId?: string;
  taskId?: string;
  taskResource?: string;
  save: (command: Command) => Promise<Snapshot | undefined>;
}) {
  const [savingMode, setSavingMode] = useState(false);
  const [paths, setPaths] = useState<Point[][]>([]),
    [drawing, setDrawing] = useState(false),
    [mode, setMode] = useState<"freehand" | "box" | "click">("freehand");
  const [status, setStatus] = useState(""),
    [image, setImage] = useState<string>(),
    [share, setShare] = useState(false),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState(""),
    [marks, setMarks] = useState<LensOverlayMark[]>([]),
    [history, setHistory] = useState<LensHistoryTurn[]>([]),
    [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [showMistake, setShowMistake] = useState(false);
  const width = window.innerWidth,
    height = window.innerHeight;
  const point = (e: React.PointerEvent): Point => ({
    x: Math.max(0, Math.min(1, e.clientX / width)),
    y: Math.max(0, Math.min(1, e.clientY / height)),
  });
  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const p = point(e);
    setPaths((all) =>
      all.map((path, i) => {
        if (i !== all.length - 1) return path;
        if (mode === "box") {
          const first = path[0]!;
          return [
            first,
            { x: p.x, y: first.y },
            p,
            { x: first.x, y: p.y },
            first,
          ];
        }
        if (mode === "click") return [p];
        return path.length < 1500 ? [...path, p] : path;
      }),
    );
  }
  async function ask() {
    setBusy(true);
    setStatus("");
    const q = question;
    try {
      const result = await window.desk.askLens({
        question: q,
        ...(share && image ? { imageDataUrl: image } : {}),
        selection: { paths: paths.map((points) => ({ points })) },
        history,
      });
      setAnswer(result.explanation);
      setMarks(share && image ? result.overlays : []);
      setHistory(
        (h) =>
          [
            ...h,
            { role: "user", content: q },
            { role: "assistant", content: result.explanation.slice(0, 4000) },
          ].slice(-8) as LensHistoryTurn[],
      );
      setQuestion("");
    } catch (e) {
      setStatus(userError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lens">
      <svg
        aria-label="Draw a freehand selection"
        onPointerDown={(e) => {
          if (paths.length >= 8) {
            setStatus("Clear a selection before adding another.");
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrawing(true);
          setPaths((p) => [...p, [point(e)]]);
        }}
        onPointerMove={move}
        onPointerUp={() => setDrawing(false)}
        onPointerCancel={() => setDrawing(false)}
      >
        <defs>
          <marker
            id="arrow-tip"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8" fill="#50705A" />
          </marker>
        </defs>
        {paths.map((p, i) =>
          p.length === 1 ? (
            <circle
              key={i}
              cx={p[0]!.x * width}
              cy={p[0]!.y * height}
              r="8"
              fill="none"
              stroke="#9D4E31"
              strokeWidth="3"
            />
          ) : (
            <path
              key={i}
              d={p
                .map(
                  (v, j) => `${j ? "L" : "M"} ${v.x * width} ${v.y * height}`,
                )
                .join(" ")}
              fill="none"
              stroke="#9D4E31"
              strokeWidth="3"
            />
          ),
        )}
        {marks.map((m, i) => {
          const x = m.x * width,
            y = m.y * height,
            x2 = (m.x2 ?? m.x) * width,
            y2 = (m.y2 ?? m.y) * height;
          return (
            <g key={i} stroke="#50705A" strokeWidth="3">
              {m.type === "arrow" ? (
                <line
                  x1={x}
                  y1={y}
                  x2={x2}
                  y2={y2}
                  markerEnd="url(#arrow-tip)"
                />
              ) : m.type === "circle" ? (
                <ellipse
                  cx={(x + x2) / 2}
                  cy={(y + y2) / 2}
                  rx={Math.abs(x2 - x) / 2}
                  ry={Math.abs(y2 - y) / 2}
                  fill="none"
                />
              ) : m.type === "highlight" ? (
                <rect
                  x={Math.min(x, x2)}
                  y={Math.min(y, y2)}
                  width={Math.abs(x2 - x)}
                  height={Math.abs(y2 - y)}
                  fill="#E8C66A"
                  fillOpacity=".35"
                  stroke="none"
                />
              ) : null}
              {m.text && (
                <text
                  x={x}
                  y={y}
                  stroke="#FFFDFA"
                  strokeWidth="4"
                  paintOrder="stroke"
                  fill="#1F2326"
                  fontSize="18"
                >
                  {m.text}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <section className="lens-panel">
        <div className="eyebrow">Lens · {className}</div>
        <h2>{title}</h2>
        <p>Circle one or more areas, or ask about your current task.</p>
        <div className="actions" aria-label="Selection mode">
          {(["freehand", "box", "click"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === "freehand"
                ? "Circle"
                : m === "box"
                  ? "Rectangle"
                  : "Point"}
            </button>
          ))}
          <button
            onClick={() => {
              setPaths([]);
              setMarks([]);
            }}
          >
            Clear selection
          </button>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void window.desk
              .captureScreen()
              .then((c) => {
                setImage(c.image);
                setShare(false);
                setHistory([]);
                setAnswer("");
                setMarks([]);
                setStatus(
                  "Screen captured for this interaction only. Review it before sharing.",
                );
              })
              .catch((e) => setStatus(userError(e)))
          }
        >
          Capture this screen
        </button>
        {image && (
          <>
            <details>
              <summary>Review captured screen</summary>
              <img
                className="capture-preview"
                src={image}
                alt="Screen captured for this Lens interaction"
              />
            </details>
            <label className="check">
              <input
                type="checkbox"
                checked={share}
                onChange={(e) => setShare(e.target.checked)}
              />
              Include this captured screen with my question
            </label>
          </>
        )}
        {answer && (
          <div className="lens-answer" aria-live="polite">
            <div className="lens-answer-text">{answer}</div>
            <div className="lens-actions" aria-label="Lens actions">
              {classId && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={async () => {
                    setActionBusy(true);
                    setStatus("");
                    try {
                      await save({
                        type: "source.create",
                        input: lensAnswerSourceInput(
                          answer,
                          classId,
                          taskId ?? null,
                        ),
                      });
                      setStatus("Lens answer saved as a source.");
                    } catch (error) {
                      setStatus(userError(error));
                    } finally {
                      setActionBusy(false);
                    }
                  }}
                >
                  Save answer as source
                </button>
              )}
              {classId && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={async () => {
                    setActionBusy(true);
                    setStatus("");
                    try {
                      await save({
                        type: "memory.create",
                        input: lensAnswerMemoryInput(answer, classId),
                      });
                      setStatus("Lens answer saved as a note.");
                    } catch (error) {
                      setStatus(userError(error));
                    } finally {
                      setActionBusy(false);
                    }
                  }}
                >
                  Save answer as note
                </button>
              )}
              {classId && taskId && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={async () => {
                    setActionBusy(true);
                    setStatus("");
                    try {
                      const withSource = await save({
                        type: "source.create",
                        input: lensAnswerSourceInput(answer, classId, taskId),
                      });
                      const source = withSource?.sources.at(-1);
                      if (!source) throw Error("Lens source was not saved.");
                      const withCanvas = await save({
                        type: "canvas.create",
                        taskId,
                      });
                      const canvas = withCanvas?.canvases.at(-1);
                      if (!canvas) throw Error("Lens Canvas was not created.");
                      await save({
                        type: "canvas.save",
                        id: canvas.id,
                        revision: canvas.revision,
                        scene: lensAnswerCanvasScene(answer, source.id),
                      });
                      setStatus("Lens answer saved to Canvas with its source.");
                    } catch (error) {
                      setStatus(userError(error));
                    } finally {
                      setActionBusy(false);
                    }
                  }}
                >
                  Save answer to Canvas
                </button>
              )}
              {classId && (
                <button
                  type="button"
                  aria-expanded={showMistake}
                  disabled={actionBusy}
                  onClick={() => setShowMistake((shown) => !shown)}
                >
                  Save as mistake
                </button>
              )}
              {classId && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={async () => {
                    setActionBusy(true);
                    setStatus("");
                    try {
                      await save({
                        type: "task.create",
                        input: lensFollowUpTaskInput(
                          answer,
                          classId,
                          taskResource ?? null,
                        ),
                      });
                      setStatus(
                        taskResource
                          ? "Lens resource review prepared."
                          : "Lens follow-up task created.",
                      );
                    } catch (error) {
                      setStatus(userError(error));
                    } finally {
                      setActionBusy(false);
                    }
                  }}
                >
                  {taskResource
                    ? "Prepare resource review"
                    : "Create follow-up task"}
                </button>
              )}
              {taskId && taskResource && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() =>
                    void window.desk
                      .openResource(taskId)
                      .catch((error) => setStatus(userError(error)))
                  }
                >
                  Open task resource
                </button>
              )}
            </div>
            {showMistake && classId && (
              <form
                className="lens-mistake"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setActionBusy(true);
                  setStatus("");
                  try {
                    const values = new FormData(event.currentTarget);
                    await save({
                      type: "mistake.create",
                      input: lensAnswerMistakeInput(
                        answer,
                        classId,
                        taskId ?? null,
                        {
                          concept: String(values.get("concept")),
                          originalAttempt: String(
                            values.get("originalAttempt"),
                          ),
                          whatWentWrong: String(values.get("whatWentWrong")),
                        },
                      ),
                    });
                    setShowMistake(false);
                    setStatus("Mistake saved at low confidence for review.");
                  } catch (error) {
                    setStatus(userError(error));
                  } finally {
                    setActionBusy(false);
                  }
                }}
              >
                <p>
                  Describe what happened. Lens will save its answer as a
                  low-confidence correction for you to review.
                </p>
                <label>
                  Concept
                  <input
                    name="concept"
                    required
                    maxLength={300}
                    defaultValue={title}
                  />
                </label>
                <label>
                  What I tried
                  <textarea name="originalAttempt" required maxLength={5000} />
                </label>
                <label>
                  What went wrong
                  <textarea name="whatWentWrong" required maxLength={5000} />
                </label>
                <button type="submit" disabled={actionBusy}>
                  Save mistake
                </button>
              </form>
            )}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <label>
            Tutoring mode
            <select
              aria-label="Tutoring mode"
              value={tutoringMode}
              disabled={busy || savingMode}
              onChange={async (e) => {
                setSavingMode(true);
                setStatus("");
                try {
                  await saveTutoringMode(e.target.value as TutoringMode);
                  setStatus("Tutoring mode saved.");
                } catch (error) {
                  setStatus(userError(error));
                } finally {
                  setSavingMode(false);
                }
              }}
            >
              <option value="guide">Guide me</option>
              <option value="balanced">Balanced</option>
              <option value="direct">Explain directly</option>
            </select>
          </label>
          <label>
            Ask The Desk
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
              maxLength={4000}
              placeholder="Why does friction point this way?"
            />
          </label>
          <div className="actions">
            <button
              className="primary"
              disabled={busy || savingMode || !question.trim()}
            >
              {busy ? "Thinking…" : "Ask"}
            </button>
            <button type="button" onClick={() => void window.desk.dismiss()}>
              Dismiss · Esc
            </button>
          </div>
        </form>
        {status && <p role="status">{status}</p>}
      </section>
    </div>
  );
}
