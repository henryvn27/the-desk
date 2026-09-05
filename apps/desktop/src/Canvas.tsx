import { useRef, useState, useEffect } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import type {
  ExcalidrawInitialDataState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { canvasScene, type CanvasScene } from "../../../packages/canvas/scene";
import type { CanvasRecord } from "../../../packages/domain/contracts";
import { userError } from "./errors";

export default function Canvas({
  record,
  close,
}: {
  record: CanvasRecord;
  close: () => void;
}) {
  const [status, setStatus] = useState("Saved"),
    [error, setError] = useState("");
  const revision = useRef(record.revision),
    pending = useRef<CanvasScene | null>(null),
    running = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef(JSON.stringify(record.scene));
  const invalid = useRef(false);
  const closing = useRef(false);
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);
  const [exporting, setExporting] = useState(false);
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
        <p role="alert" className="error">
          {error}
        </p>
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
          aiEnabled={false}
          validateEmbeddable={false}
          onLinkOpen={(_, event) => event.preventDefault()}
          onChange={(elements, state, files) => {
            try {
              const scene = canvasScene.parse({
                engine: "excalidraw",
                version: 1,
                elements,
                files,
                viewBackgroundColor: state.viewBackgroundColor,
              });
              invalid.current = false;
              const serialized = JSON.stringify(scene);
              if (serialized === last.current) return;
              last.current = serialized;
              pending.current = scene;
              setStatus("Unsaved changes");
              clearTimeout(timer.current);
              timer.current = setTimeout(
                () => void flush().catch(() => {}),
                500,
              );
            } catch (e) {
              invalid.current = true;
              setError(userError(e));
              setStatus("Not saved");
            }
          }}
        />
      </div>
    </div>
  );
}
