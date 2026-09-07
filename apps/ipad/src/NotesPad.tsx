import { useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { CanvasRecord, Source } from "../../../packages/domain/contracts";
import { canvasScene, type CanvasScene } from "../../../packages/canvas/scene";
import { ensureNoteDocument } from "../../../packages/canvas/notes";
import NotesFlow from "../../desktop/src/NotesFlow";
import "./notes-pad.css";

/**
 * Thin iPad renderer. Persistence, revisions, source links and sync stay in
 * the Desk domain; this surface only supplies touch/Pencil-friendly rendering
 * and hands canonical CanvasScene envelopes back to its host.
 */
export default function NotesPad({ record, sources, onChange }: {
  record: CanvasRecord;
  sources: Source[];
  onChange: (scene: CanvasScene) => void;
}) {
  const [view, setView] = useState<"notes" | "canvas">("notes");
  const [scene, setScene] = useState(() => canvasScene.parse(record.scene));
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);
  function persist(value: CanvasScene) {
    setScene(value);
    onChange(value);
  }
  return <main className="notes-pad" data-input-mode="pencil"><header><div><span className="eyebrow">Notes · Pencil ready</span><h1>{record.title}</h1></div><div className="notes-pad-toggle" role="group" aria-label="Note views"><button type="button" aria-pressed={view === "notes"} onClick={() => setView("notes")}>Notes</button><button type="button" aria-pressed={view === "canvas"} onClick={() => setView("canvas")}>Freeform</button></div></header>{view === "notes" ? <NotesFlow document={ensureNoteDocument(scene.document)} files={scene.files} onChange={(document) => persist({ ...scene, document })} openFreeform={() => setView("canvas")} /> : <section className="notes-pad-canvas" aria-label="Pencil freeform workspace"><Excalidraw excalidrawAPI={(api) => { editor.current = api; }} initialData={{ elements: scene.elements, files: scene.files, appState: { viewBackgroundColor: scene.viewBackgroundColor } } as unknown as ExcalidrawInitialDataState} handleKeyboardGlobally={false} aiEnabled={false} validateEmbeddable={false} onLinkOpen={(_, event) => event.preventDefault()} onChange={(elements, state, files) => persist(canvasScene.parse({ ...scene, elements, files, viewBackgroundColor: state.viewBackgroundColor }))} /></section>}{sources.length > 0 && <p className="notes-pad-sources">{sources.length} linked source{sources.length === 1 ? "" : "s"} · original files and Pencil marks stay in the shared Note</p>}</main>;
}
