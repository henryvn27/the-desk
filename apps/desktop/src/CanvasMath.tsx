import { useEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { mathSource } from "../../../packages/canvas/scene";
import { userError } from "./errors";

export default function CanvasMath({
  api,
  close,
}: {
  api: ExcalidrawImperativeAPI;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [latex, setLatex] = useState(
    String.raw`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
  );
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const equations = api
    .getSceneElements()
    .filter(
      (element) => mathSource.safeParse(element.customData?.deskMath).success,
    );
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const { renderMath } = await import("../../../packages/canvas/math");
      const rendered = renderMath(latex);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`;
      await image.decode();
      const bitmap = document.createElement("canvas");
      bitmap.width = rendered.width * 2;
      bitmap.height = rendered.height * 2;
      const context = bitmap.getContext("2d");
      if (!context) throw Error("Unable to render this equation.");
      context.drawImage(image, 0, 0, bitmap.width, bitmap.height);
      const file: BinaryFileData = {
        id: crypto.randomUUID() as BinaryFileData["id"],
        mimeType: "image/png",
        dataURL: bitmap.toDataURL("image/png") as BinaryFileData["dataURL"],
        created: Date.now(),
      };
      const elements = api.getSceneElementsIncludingDeleted();
      const old = elements.find(
        (element) => element.id === editing && !element.isDeleted,
      );
      if (editing && (!old || old.type !== "image"))
        throw Error("This equation no longer exists.");
      const state = api.getAppState();
      const customData = {
        ...old?.customData,
        deskMath: { latex: rendered.latex },
      };
      const element =
        old?.type === "image"
          ? {
              ...old,
              fileId: file.id,
              customData,
              height: (old.width * rendered.height) / rendered.width,
              version: old.version + 1,
              versionNonce: Math.floor(Math.random() * 2 ** 31),
              updated: Date.now(),
            }
          : convertToExcalidrawElements([
              {
                type: "image",
                fileId: file.id,
                width: rendered.width,
                height: rendered.height,
                x:
                  state.width / 2 / state.zoom.value -
                  state.scrollX -
                  rendered.width / 2,
                y:
                  state.height / 2 / state.zoom.value -
                  state.scrollY -
                  rendered.height / 2,
                customData,
              },
            ])[0];
      if (!element) throw Error("Unable to insert this equation.");
      api.addFiles([file]);
      api.updateScene({
        elements: old
          ? elements.map((item) => (item.id === old.id ? element : item))
          : [...elements, element],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        appState: { selectedElementIds: { [element.id]: true } },
      });
      api.setActiveTool({ type: "selection" });
      close();
    } catch (e) {
      setError(userError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else close();
      }}
      aria-labelledby="canvas-math-title"
    >
      <h2 id="canvas-math-title">Math block</h2>
      <p>Enter LaTeX. The equation stays editable after saving.</p>
      <label htmlFor="math-existing">Equation</label>
      <select
        id="math-existing"
        value={editing}
        disabled={busy}
        onChange={(event) => {
          setEditing(event.target.value);
          const source = equations.find(
            (element) => element.id === event.target.value,
          )?.customData?.deskMath;
          if (source) setLatex(mathSource.parse(source).latex);
          setError("");
        }}
      >
        <option value="">New equation</option>
        {equations.map((element) => (
          <option key={element.id} value={element.id}>
            {mathSource.parse(element.customData?.deskMath).latex}
          </option>
        ))}
      </select>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor="math-latex">LaTeX equation</label>
        <textarea
          id="math-latex"
          value={latex}
          onChange={(event) => setLatex(event.target.value)}
          maxLength={2000}
          disabled={busy}
          autoFocus
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button disabled={busy}>
            {busy
              ? "Rendering…"
              : editing
                ? "Update equation"
                : "Insert equation"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
