import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { canvasScene, type CanvasScene } from "../../../packages/canvas/scene";
import type { CanvasRecord, Source } from "../../../packages/domain/contracts";
import { userError } from "./errors";
GlobalWorkerOptions.workerSrc = workerUrl;
async function timed<T>(
  promise: Promise<T>,
  cancel: () => void,
  ms = 30000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(
            Error(
              "PDF processing timed out. Try fewer pages or a simpler copy.",
            ),
          );
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
export default function PdfImport({
  taskId,
  close,
  changed,
  ready,
}: {
  taskId: string;
  close: () => void;
  changed: () => void;
  ready: (record: CanvasRecord) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const loading = useRef<PDFDocumentLoadingTask | null>(null);
  const pdf = useRef<PDFDocumentProxy | null>(null);
  const canceled = useRef(false);
  const [source, setSource] = useState<Source>();
  const [count, setCount] = useState(0),
    [first, setFirst] = useState(1),
    [last, setLast] = useState(1);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      canceled.current = true;
      void loading.current?.destroy();
    };
  }, []);
  async function choose() {
    setBusy(true);
    setError("");
    try {
      const imported = await window.desk.importPDF(taskId);
      if (!imported || canceled.current) return;
      changed();
      setSource(imported.source);
      setStatus("Reading PDF…");
      await loading.current?.destroy();
      const base = `${location.origin}/pdfjs/`;
      loading.current = getDocument({
        data: imported.bytes.slice(),
        cMapUrl: `${base}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${base}standard_fonts/`,
        wasmUrl: `${base}wasm/`,
        iccUrl: `${base}iccs/`,
        enableXfa: false,
        stopAtErrors: true,
      });
      pdf.current = await timed(loading.current.promise, () => {
        void loading.current?.destroy();
      });
      if (pdf.current.numPages > 10000)
        throw Error("This PDF has too many pages to annotate here.");
      setCount(pdf.current.numPages);
      setFirst(1);
      setLast(Math.min(pdf.current.numPages, 100));
      setStatus("Original PDF saved in Library.");
    } catch (e) {
      setCount(0);
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!pdf.current || !source) return;
    if (
      !Number.isInteger(first) ||
      !Number.isInteger(last) ||
      first < 1 ||
      last < first ||
      last > count ||
      last - first >= 100
    ) {
      setError("Choose a range of up to 100 pages from this PDF.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const pages: NonNullable<CanvasScene["notebook"]>["pages"] = [];
      const files: CanvasScene["files"] = {};
      for (let number = first; number <= last; number++) {
        if (canceled.current) return;
        setStatus(`Preparing page ${number} of ${count}…`);
        const original = await timed(pdf.current.getPage(number), () => {
          void loading.current?.destroy();
        });
        const unscaled = original.getViewport({ scale: 1 });
        const scale = Math.min(
          4 / 3,
          1600 / unscaled.width,
          2200 / unscaled.height,
        );
        const viewport = original.getViewport({ scale });
        const bitmap = document.createElement("canvas");
        bitmap.width = Math.max(200, Math.ceil(viewport.width));
        bitmap.height = Math.max(200, Math.ceil(viewport.height));
        const context = bitmap.getContext("2d");
        if (!context) throw Error("Unable to render PDF page.");
        const render = original.render({
          canvas: bitmap,
          canvasContext: context,
          viewport,
          background: "white",
        });
        await timed(render.promise, () => render.cancel());
        const fileId = crypto.randomUUID();
        files[fileId] = {
          id: fileId,
          mimeType: "image/png",
          dataURL: bitmap.toDataURL("image/png"),
          created: Date.now(),
        };
        pages.push({
          id: crypto.randomUUID(),
          title: `PDF page ${number}`,
          width: bitmap.width,
          height: bitmap.height,
          elements: [],
          pdf: { sourceId: source.id, pageNumber: number, fileId },
        });
        // Enforce the full notebook budget while rendering, before creating it.
        canvasScene.parse({
          engine: "excalidraw",
          version: 1,
          elements: [],
          files,
          sourceIds: [source.id],
          viewBackgroundColor: "#ffffff",
          notebook: { activePageId: pages[0]!.id, pages },
        });
        original.cleanup();
        bitmap.width = 0;
        bitmap.height = 0;
      }
      if (canceled.current) return;
      const scene = canvasScene.parse({
        engine: "excalidraw",
        version: 1,
        elements: [],
        files,
        sourceIds: [source.id],
        viewBackgroundColor: "#ffffff",
        notebook: { activePageId: pages[0]!.id, pages },
      });
      const state = await window.desk.command({
        type: "canvas.create",
        taskId,
        scene,
      });
      changed();
      const record = await window.desk.canvas(state.canvases.at(-1)!.id);
      if (!canceled.current) ready(record);
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    canceled.current = true;
    void loading.current?.destroy();
    close();
  }
  return (
    <dialog ref={dialog} onCancel={cancel} aria-labelledby="pdf-import-title">
      <h2 id="pdf-import-title">Annotate a PDF</h2>
      <p>
        Your original stays in Library. Drawings are saved in a separate
        notebook.
      </p>
      <button disabled={busy} onClick={() => void choose()}>
        Choose PDF
      </button>
      {source && <p>{source.title}</p>}
      {count > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <p>{count} pages in this PDF. Choose up to 100 pages per notebook.</p>
          <label>
            First page
            <input
              type="number"
              min={1}
              max={count}
              value={first}
              disabled={busy}
              onChange={(event) => setFirst(Number(event.target.value))}
            />
          </label>
          <label>
            Last page
            <input
              type="number"
              min={first}
              max={count}
              value={last}
              disabled={busy}
              onChange={(event) => setLast(Number(event.target.value))}
            />
          </label>
          <button disabled={busy}>Create annotation notebook</button>
        </form>
      )}
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button onClick={cancel}>Cancel</button>
    </dialog>
  );
}
