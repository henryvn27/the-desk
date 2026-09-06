import { useRef, useState, useEffect } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import type {
  ExcalidrawInitialDataState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { canvasScene, type CanvasScene } from "../../../packages/canvas/scene";
import type { CanvasRecord, Source } from "../../../packages/domain/contracts";
import { userError } from "./errors";
import CanvasMath from "./CanvasMath";

export default function Canvas({
  record,
  sources,
  close,
}: {
  record: CanvasRecord;
  sources: Source[];
  close: () => void;
}) {
  const [status, setStatus] = useState("Saved"),
    [error, setError] = useState("");
  const revision = useRef(record.revision),
    pending = useRef<CanvasScene | null>(null),
    running = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef(JSON.stringify(record.scene));
  const sourceIds = useRef(record.scene.sourceIds ?? []);
  const [showSources, setShowSources] = useState(false);
  const [showMath, setShowMath] = useState(false);
  const [links, setLinks] = useState(sourceIds.current);
  function queueScene(value: unknown) {
    try {
      const scene = canvasScene.parse(value);
      invalid.current = false;
      const serialized = JSON.stringify(scene);
      if (serialized === last.current) return;
      last.current = serialized;
      pending.current = scene;
      setStatus("Unsaved changes");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush().catch(() => {}), 500);
    } catch (e) {
      invalid.current = true;
      setError(userError(e));
      setStatus("Not saved");
    }
  }
  function changeLinks(next: string[]) {
    if (!editor.current) return;
    sourceIds.current = next;
    setLinks(next);
    queueScene({
      engine: "excalidraw",
      version: 1,
      sourceIds: next,
      elements: editor.current.getSceneElementsIncludingDeleted(),
      files: editor.current.getFiles(),
      viewBackgroundColor: editor.current.getAppState().viewBackgroundColor,
    });
  }
  const invalid = useRef(false);
  const closing = useRef(false);
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);
  const [exporting, setExporting] = useState(false);
  function inkTool(highlight: boolean) {
    editor.current?.updateScene({
      appState: {
        currentItemStrokeColor: highlight ? "#ffd43b" : "#1e1e1e",
        currentItemStrokeWidth: highlight ? 8 : 2,
        currentItemOpacity: highlight ? 35 : 100,
      },
    });
    editor.current?.setActiveTool({ type: "freedraw" });
  }
  const [recovering, setRecovering] = useState(false);
  async function recover() {
    if (invalid.current || !pending.current) return;
    setRecovering(true);
    clearTimeout(timer.current);
    try {
      if (running.current) await running.current.catch(() => {});
      const scene = pending.current;
      if (!scene) return;
      await window.desk.command({
        type: "canvas.recover",
        id: record.id,
        scene,
      });
      if (pending.current !== scene) {
        setError("A recovery copy was saved. New edits are still open.");
        return;
      }
      pending.current = null;
      close();
    } catch (e) {
      setError(userError(e));
    } finally {
      setRecovering(false);
    }
  }
  async function exportPNG() {
    if (!editor.current) return;
    setExporting(true);
    setError("");
    try {
      await flush();
      const png = await exportToBlob({
        elements: editor.current.getSceneElements(),
        files: editor.current.getFiles(),
        appState: { ...editor.current.getAppState(), exportBackground: true },
        mimeType: "image/png",
      });
      const saved = await window.desk.exportCanvas(
        record.id,
        new Uint8Array(await png.arrayBuffer()),
      );
      setStatus(saved ? "PNG exported" : "Export canceled");
    } catch (e) {
      setError(userError(e));
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pending.current && !running.current && !invalid.current) return;
      event.preventDefault();
      event.returnValue = "";
      if (closing.current) return;
      closing.current = true;
      clearTimeout(timer.current);
      void flush()
        .then(() => window.desk.closeWindow())
        .catch((e) => setError(userError(e)))
        .finally(() => {
          closing.current = false;
        });
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  });
  async function flush(): Promise<void> {
    if (invalid.current)
      throw Error("Remove unsupported canvas content before saving.");
    if (running.current) await running.current;
    const scene = pending.current;
    if (!scene) return;
    pending.current = null;
    setStatus("Saving…");
    setError("");
    const job = window.desk
      .command({
        type: "canvas.save",
        id: record.id,
        revision: revision.current,
        scene,
      })
      .then(() => {
        revision.current++;
        setStatus("Saved");
      })
      .catch((e) => {
        pending.current = pending.current ?? scene;
        setStatus("Not saved");
        setError(userError(e));
        throw e;
      });
    running.current = job;
    try {
      await job;
    } finally {
      running.current = null;
    }
    if (pending.current) await flush();
  }
  return (
    <div className="canvas-workspace" role="dialog" aria-label="Study canvas">
      <div className="canvas-header">
        <strong>{record.title}</strong>
        <span role="status">{status}</span>
        <button onClick={() => setShowMath(true)}>Math</button>
        <button onClick={() => inkTool(false)}>Pen</button>
        <button onClick={() => inkTool(true)}>Highlighter</button>
        <button
          aria-expanded={showSources}
          onClick={() => setShowSources(!showSources)}
        >
          Sources
        </button>
        <button onClick={() => void flush().catch(() => {})}>
          Save canvas
        </button>
        <button disabled={exporting} onClick={() => void exportPNG()}>
          Export PNG
        </button>
        <button
          onClick={() => {
            clearTimeout(timer.current);
            void flush()
              .then(close)
              .catch(() => {});
          }}
        >
          Close canvas
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          {!invalid.current && pending.current && (
            <button disabled={recovering} onClick={() => void recover()}>
              {recovering
                ? "Saving recovery copy…"
                : "Save recovery copy and close"}
            </button>
          )}
        </div>
      )}
      {showMath && editor.current && (
        <CanvasMath api={editor.current} close={() => setShowMath(false)} />
      )}
      <div className="canvas-body">
        {showSources && (
          <aside className="canvas-sources" aria-label="Canvas sources">
            <h2>Sources</h2>
            <label htmlFor="canvas-source">Link a Library source</label>
            <select
              id="canvas-source"
              value=""
              onChange={(event) => {
                if (event.target.value)
                  changeLinks([...links, event.target.value]);
              }}
            >
              <option value="">Choose a source…</option>
              {sources
                .filter((source) => !links.includes(source.id))
                .map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title}
                  </option>
                ))}
            </select>
            {!links.length && (
              <p>
                No sources linked yet. Save material in Library to use it here.
              </p>
            )}
            {links.map((id) => {
              const source = sources.find((source) => source.id === id);
              return (
                <section key={id}>
                  <h3>{source?.title ?? "Source unavailable"}</h3>
                  <p className="source-text">{source?.text}</p>
                  <button
                    onClick={() =>
                      changeLinks(links.filter((link) => link !== id))
                    }
                  >
                    Unlink {source?.title ?? "source"}
                  </button>
                </section>
              );
            })}
          </aside>
        )}
        <div className="canvas-engine">
          <Excalidraw
            excalidrawAPI={(api) => {
              editor.current = api;
            }}
            name={record.title}
            initialData={
              {
                elements: record.scene.elements,
                files: record.scene.files,
                appState: {
                  viewBackgroundColor: record.scene.viewBackgroundColor,
                },
              } as unknown as ExcalidrawInitialDataState
            }
            handleKeyboardGlobally={!showMath}
            aiEnabled={false}
            validateEmbeddable={false}
            onLinkOpen={(_, event) => event.preventDefault()}
            onChange={(elements, state, files) =>
              queueScene({
                engine: "excalidraw",
                version: 1,
                elements,
                files,
                ...(sourceIds.current.length || record.scene.sourceIds
                  ? { sourceIds: sourceIds.current }
                  : {}),
                viewBackgroundColor: state.viewBackgroundColor,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
