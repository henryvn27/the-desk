import { useRef, useState, useEffect } from "react";
import {
  Excalidraw,
  exportToBlob,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawInitialDataState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { canvasScene, type CanvasScene } from "../../../packages/canvas/scene";
import { appendNoteEditEvent, ensureNoteDocument, insertNoteBlock, updateNoteBlock, type NoteDocument } from "../../../packages/canvas/notes";
import type { CanvasRecord, Source } from "../../../packages/domain/contracts";
import { userError } from "./errors";
import CanvasMath from "./CanvasMath";
import {
  activeNotebookPage,
  addNotebookPage,
  selectNotebookPage,
  replaceNotebookPage,
} from "../../../packages/canvas/notebook";
import {
  makePageFrame,
  fitElementsToPage,
  pageNeedsRepair,
} from "./notebook-renderer";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import NotesFlow from "./NotesFlow";

export default function Canvas({
  record,
  sources,
  close,
  initialBlockId,
  autoFocus = false,
}: {
  record: CanvasRecord;
  sources: Source[];
  close: () => void;
  initialBlockId?: string;
  autoFocus?: boolean;
}) {
  const [status, setStatus] = useState("Saved"),
    [error, setError] = useState("");
  const revision = useRef(record.revision),
    pending = useRef<CanvasScene | null>(null),
    running = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const documentScene = useRef(record.scene);
  const [activePageId, setActivePageId] = useState(
    record.scene.notebook?.activePageId,
  );
  const [changingPage, setChangingPage] = useState(false);
  const page = documentScene.current.notebook
    ? activeNotebookPage(documentScene.current)
    : undefined;
  const [pageFrame, setPageFrame] = useState(() =>
    record.scene.notebook
      ? makePageFrame(activeNotebookPage(record.scene))
      : undefined,
  );
  const last = useRef(JSON.stringify(record.scene));
  const sourceIds = useRef(record.scene.sourceIds ?? []);
  const [showSources, setShowSources] = useState(false);
  const [showMath, setShowMath] = useState(false);
  const [links, setLinks] = useState(sourceIds.current);
  const [view, setView] = useState<"notes" | "canvas">("notes");
  const [noteDocument, setNoteDocument] = useState(() =>
    ensureNoteDocument(record.scene.document),
  );
  const freeformBlockId = useRef<string | undefined>(undefined);
  const lastFreeformEdit = useRef<{ recordingId: string; atMs: number } | undefined>(undefined);
  function queueDocument(value: unknown, syncDocument = true) {
    try {
      const scene = canvasScene.parse(value);
      invalid.current = false;
      documentScene.current = scene;
      if (syncDocument)
        setNoteDocument((current) => scene.document ?? current);
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
  function queueScene(value: unknown) {
    try {
      const visible = canvasScene.parse(value);
      const markFreeformEdit = (scene: CanvasScene) => {
        const blockId = freeformBlockId.current;
        const recording = scene.document?.recordings?.find((item) => item.status === "recording");
        const startedAt = recording ? Date.parse(recording.startedAt) : NaN;
        if (!blockId || !recording || !Number.isFinite(startedAt)) return { scene, syncDocument: false };
        const atMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Date.now() - startedAt));
        const previous = lastFreeformEdit.current;
        if (previous && previous.recordingId === recording.id && atMs - previous.atMs < 750)
          return { scene, syncDocument: false };
        lastFreeformEdit.current = { recordingId: recording.id, atMs };
        return { scene: { ...scene, document: appendNoteEditEvent(scene.document!, recording.id, blockId, atMs) }, syncDocument: true };
      };
      if (!documentScene.current.notebook) {
        const marked = markFreeformEdit({
          ...visible,
          ...(documentScene.current.document
            ? { document: documentScene.current.document }
            : {}),
        });
        return queueDocument(marked.scene, marked.syncDocument);
      }
      if (activePageId !== documentScene.current.notebook.activePageId) return;
      const elements = visible.elements
        .filter((element) => element.id !== pageFrame?.id)
        .map((element) => ({ ...element, frameId: null }));
      const marked = markFreeformEdit(replaceNotebookPage(
          {
            ...documentScene.current,
            files: visible.files,
            sourceIds: visible.sourceIds,
          },
          activePageId!,
          elements,
        ));
      queueDocument(marked.scene, marked.syncDocument);
    } catch (e) {
      invalid.current = true;
      setError(userError(e));
      setStatus("Not saved");
    }
  }
  async function changePage(id?: string) {
    if (id && id === documentScene.current.notebook?.activePageId) return;
    setChangingPage(true);
    try {
      await flush();
      const next = id
        ? selectNotebookPage(documentScene.current, id)
        : addNotebookPage(documentScene.current, crypto.randomUUID());
      queueDocument(next);
      editor.current = null;
      setShowMath(false);
      setPageFrame(makePageFrame(activeNotebookPage(next)));
      setActivePageId(next.notebook!.activePageId);
    } catch (e) {
      setError(userError(e));
    } finally {
      setChangingPage(false);
    }
  }
  function changeLinks(next: string[]) {
    sourceIds.current = next;
    setLinks(next);
    if (!editor.current) {
      queueDocument({ ...documentScene.current, sourceIds: next });
      return;
    }
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
    if (view !== "canvas") return;
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
    if (view !== "canvas" || !editor.current) return;
    setExporting(true);
    setError("");
    try {
      await flush();
      const png = await exportToBlob({
        elements: editor.current.getSceneElements(),
        files: editor.current.getFiles(),
        appState: { ...editor.current.getAppState(), exportBackground: true },
        mimeType: "image/png",
        exportingFrame: pageFrame,
        ...(pageFrame ? { exportPadding: 0 } : {}),
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
  function changeNoteDocument(next: import("../../../packages/canvas/notes").NoteDocument) {
    queueDocument({ ...documentScene.current, document: next });
  }
  function openFreeform(block: Extract<import("../../../packages/canvas/notes").NoteBlock, { type: "freeform" }>) {
    freeformBlockId.current = block.id;
    if (block.collapsed)
      queueDocument({ ...documentScene.current, document: updateNoteBlock(noteDocument, block.id, { collapsed: false }) });
    setView("canvas");
  }
  async function addNoteFiles(input: File[]) {
    const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
    const files = input.filter((file) => allowed.has(file.type));
    if (!files.length) {
      setError("Import a PNG, JPEG, WebP, GIF or PDF file.");
      return;
    }
    if (files.some((file) => file.size > 12 * 1024 * 1024) || files.reduce((total, file) => total + file.size, 0) > 16 * 1024 * 1024) {
      setError("Keep each paper or file under 12 MB and the batch under 16 MB.");
      return;
    }
    try {
      const encoded = await Promise.all(files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return { file, dataURL: `data:${file.type};base64,${btoa(binary)}` };
      }));
      const currentScene = documentScene.current;
      const currentFiles = { ...currentScene.files };
      let nextDocument: NoteDocument = currentScene.document ?? noteDocument;
      let afterId = nextDocument.blocks.at(-1)?.id ?? null;
      const captures = [...(nextDocument.captures ?? [])];
      for (const { file, dataURL } of encoded) {
        const fileId = crypto.randomUUID();
        currentFiles[fileId] = {
          id: fileId,
          mimeType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf",
          dataURL,
          created: Date.now(),
        };
        const captureId = crypto.randomUUID();
        captures.push({ id: captureId, kind: "paper", originalFileId: fileId, capturedAt: new Date().toISOString() });
        nextDocument = insertNoteBlock(nextDocument, afterId, {
          id: crypto.randomUUID(),
          type: file.type === "application/pdf" ? "file" : "image",
          fileId,
          name: file.name,
          caption: "Original capture preserved. Add a cleaned derivative or OCR in the linked source.",
          captureId,
        });
        afterId = nextDocument.blocks.at(-1)?.id ?? afterId;
      }
      queueDocument({ ...currentScene, files: currentFiles, document: { ...nextDocument, captures } });
      setError("");
      setStatus(files.length === 1 ? "Paper capture inserted" : `${files.length} paper captures inserted`);
    } catch (e) {
      setError(userError(e));
    }
  }
  async function addCaptureDerivative(captureId: string, file: File) {
    const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
    if (!allowed.has(file.type) || file.size > 12 * 1024 * 1024) {
      setError("Keep a cleaned derivative to PNG, JPEG, WebP, GIF or PDF under 12 MB.");
      return;
    }
    const capture = documentScene.current.document?.captures?.find((item) => item.id === captureId);
    if (!capture) {
      setError("This paper capture no longer exists.");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const fileId = crypto.randomUUID();
      const files = { ...documentScene.current.files, [fileId]: {
        id: fileId,
        mimeType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf",
        dataURL: `data:${file.type};base64,${btoa(binary)}`,
        created: Date.now(),
      } };
      const document = documentScene.current.document!;
      const captures = document.captures!.map((item) => item.id === captureId ? { ...item, cleanedFileId: fileId } : item);
      queueDocument({ ...documentScene.current, files, document: { ...document, captures } });
      setError("");
      setStatus("Cleaned derivative attached; original paper is preserved.");
    } catch (e) {
      setError(userError(e));
    }
  }
  async function createCaptureSource(captureId: string, text: string) {
    const value = text.trim();
    if (!value) return;
    const capture = documentScene.current.document?.captures?.find((item) => item.id === captureId);
    if (!capture) {
      setError("This paper capture no longer exists.");
      return;
    }
    try {
      const next = await window.desk.command({
        type: "source.create",
        input: {
          kind: "class-material",
          title: `${record.title} paper capture`,
          text: value,
          classIds: record.classId ? [record.classId] : [],
          taskIds: record.taskId ? [record.taskId] : [],
        },
      });
      const source = next.sources.at(-1);
      if (!source) throw Error("The paper source could not be saved.");
      const document = documentScene.current.document!;
      const captures = document.captures!.map((item) => item.id === captureId ? { ...item, sourceId: source.id } : item);
      queueDocument({ ...documentScene.current, document: { ...document, captures } });
      setError("");
      setStatus("Paper semantic layer linked to Sources.");
    } catch (e) {
      setError(userError(e));
    }
  }
  function studyCapture(captureId: string) {
    if (!captureId) return;
    void window.desk.lens()
      .then(() => setStatus("Lens opened for the paper capture. Draw the precise area to study."))
      .catch((e) => setError(userError(e)));
  }
  return (
    <div className="canvas-workspace" role="dialog" aria-label="Study notes">
      <div className="canvas-header">
        <strong>{record.title}</strong>
        <span role="status">{status}</span>
        <div className="notes-view-toggle" role="group" aria-label="Notes views">
          <button type="button" aria-pressed={view === "notes"} onClick={() => { setShowMath(false); editor.current = null; setView("notes"); }}>Notes</button>
          <button type="button" aria-pressed={view === "canvas"} onClick={() => setView("canvas")}>Freeform canvas</button>
        </div>
        {view === "canvas" && <>
          <button onClick={() => setShowMath(true)}>Math</button>
          <button onClick={() => inkTool(false)}>Pen</button>
          <button onClick={() => inkTool(true)}>Highlighter</button>
        </>}
        <button
          aria-expanded={showSources}
          onClick={() => setShowSources(!showSources)}
        >
          Sources
        </button>
        <button onClick={() => void flush().catch(() => {})}>
          Save notes
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
          Close notes
        </button>
      </div>
      {page && (
        <nav className="notebook-pages" aria-label="Notebook pages">
          <label htmlFor="notebook-page">Page</label>
          <select
            id="notebook-page"
            value={activePageId}
            disabled={changingPage}
            onChange={(event) => void changePage(event.target.value)}
          >
            {documentScene.current.notebook!.pages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <button
            disabled={
              changingPage ||
              documentScene.current.notebook!.pages.length >= 100
            }
            onClick={() => void changePage()}
          >
            Add page
          </button>
          <button
            onClick={() => {
              if (pageFrame)
                editor.current?.scrollToContent(pageFrame, {
                  fitToViewport: true,
                  viewportZoomFactor: 0.72,
                });
            }}
          >
            Fit page
          </button>
          <span>Portrait page · PNG exports this page</span>
        </nav>
      )}
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
      {showMath && view === "canvas" && editor.current && (
        <CanvasMath api={editor.current} close={() => setShowMath(false)} />
      )}
      <div className="canvas-body">
        {showSources && (
          <aside className="canvas-sources" aria-label="Notes sources">
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
        {view === "notes" ? (
          <NotesFlow
            document={noteDocument}
            files={documentScene.current.files}
            canvasId={record.id}
            autoFocus={autoFocus}
            onChange={changeNoteDocument}
            openFreeform={openFreeform}
            initialBlockId={initialBlockId}
            onAddFiles={(files) => void addNoteFiles(files)}
            onAddCaptureDerivative={(captureId, file) => void addCaptureDerivative(captureId, file)}
            onCreateCaptureSource={(captureId, text) => void createCaptureSource(captureId, text)}
            onStudyCapture={studyCapture}
            onStudySelection={(text) => void window.desk.lens({
              question: `Check this Note block:\n\n${text}`,
              activityKind: "check",
            }).catch((e) => setError(userError(e)))}
          />
        ) : (
          <div
            className="canvas-engine"
            style={changingPage ? { pointerEvents: "none" } : undefined}
          >
          <Excalidraw
            key={`${activePageId ?? "infinite"}-canvas`}
            excalidrawAPI={(api) => {
              editor.current = api;
              if (pageFrame)
                requestAnimationFrame(() =>
                  api.scrollToContent(pageFrame, {
                    fitToViewport: true,
                    viewportZoomFactor: 0.72,
                  }),
                );
            }}
            name={record.title}
            initialData={
              {
                elements:
                  pageFrame && page
                    ? fitElementsToPage(
                        page.elements as unknown as ExcalidrawElement[],
                        pageFrame,
                      )
                    : documentScene.current.elements,
                files: documentScene.current.files,
                appState: {
                  viewBackgroundColor: record.scene.viewBackgroundColor,
                },
              } as unknown as ExcalidrawInitialDataState
            }
            handleKeyboardGlobally={!showMath}
            aiEnabled={false}
            validateEmbeddable={false}
            onLinkOpen={(_, event) => event.preventDefault()}
            onChange={(elements, state, files) => {
              if (activePageId !== documentScene.current.notebook?.activePageId)
                return;
              if (pageFrame && pageNeedsRepair(elements, pageFrame)) {
                const api = editor.current;
                queueMicrotask(() => {
                  if (api && editor.current === api)
                    api.updateScene({
                      elements: fitElementsToPage(elements, pageFrame),
                      captureUpdate: CaptureUpdateAction.NEVER,
                    });
                });
              }
              queueScene({
                engine: "excalidraw",
                version: 1,
                elements,
                files,
                ...(sourceIds.current.length || record.scene.sourceIds
                  ? { sourceIds: sourceIds.current }
                  : {}),
                viewBackgroundColor: state.viewBackgroundColor,
              });
            }}
          />
          </div>
        )}
      </div>
    </div>
  );
}
