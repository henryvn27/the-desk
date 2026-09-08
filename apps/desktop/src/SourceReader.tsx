import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Command,
  SearchResult,
  Snapshot,
  Source,
} from "../../../packages/domain/contracts";
import {
  ensureNoteDocument,
  insertNoteBlock,
  sourceExcerptBlock,
} from "../../../packages/canvas/notes";
import { sourceProvenance } from "../../../packages/sources/provenance";
import {
  sourceAnchorLabel,
  sourceExcerpt,
  sourceSearch,
  sourceSections,
  type SourceMatch,
} from "../../../packages/sources/reader";
import { userError } from "./errors";

type ReaderLocation = SearchResult["location"];

const formatLabels: Record<NonNullable<Source["format"]>, string> = {
  text: "Text",
  pdf: "PDF",
  slides: "Slides",
  transcript: "Transcript",
  web: "Web capture",
};

function textOffsetInElement(element: Element, node: Node, offset: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
  }
  return total;
}

function renderMatchText(
  text: string,
  section: { startOffset: number; endOffset: number },
  matches: SourceMatch[],
) {
  const ranges = matches
    .filter(
      (match) =>
        match.startOffset < section.endOffset &&
        match.endOffset > section.startOffset,
    )
    .map((match) => ({
      start: Math.max(0, match.startOffset - section.startOffset),
      end: Math.min(text.length, match.endOffset - section.startOffset),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return text;
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.start > cursor) pieces.push(text.slice(cursor, range.start));
    pieces.push(<mark key={`${range.start}-${index}`}>{text.slice(range.start, range.end)}</mark>);
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return pieces;
}

export default function SourceReader({
  source,
  data,
  initialLocation,
  close,
  saveCommand,
  openCanvas,
}: {
  source: Source;
  data: Snapshot;
  initialLocation?: ReaderLocation;
  close: () => void;
  saveCommand: (command: Command) => Promise<Snapshot | undefined>;
  openCanvas: (taskId: string, canvasId?: string, blockId?: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [currentSource, setCurrentSource] = useState(source);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [selection, setSelection] = useState<{
    text: string;
    startOffset: number;
    endOffset: number;
  }>();
  const [comment, setComment] = useState("");
  const [targetCanvasId, setTargetCanvasId] = useState("");
  const [targetTaskId, setTargetTaskId] = useState(source.taskIds[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const sections = useMemo(() => sourceSections(currentSource.text), [currentSource.text]);
  const matches = useMemo(
    () => sourceSearch(currentSource.text, query),
    [currentSource.text, query],
  );
  const linkedCanvases = useMemo(
    () => data.canvases.filter((canvas) => canvas.taskId !== null && currentSource.taskIds.includes(canvas.taskId)),
    [currentSource.taskIds, data.canvases],
  );
  const sourceRevision = currentSource.revision ?? 0;

  useEffect(() => {
    setCurrentSource(source);
  }, [source]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter" && document.activeElement === searchInput.current && matches.length) {
        event.preventDefault();
        jumpToMatch(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
  useEffect(() => {
    if (initialLocation?.startOffset === undefined) return;
    const section = sections.find(
      (candidate) =>
        candidate.startOffset <= initialLocation.startOffset! &&
        candidate.endOffset >= initialLocation.startOffset!,
    );
    if (section) {
      window.setTimeout(() => {
        document.getElementById(section.id)?.scrollIntoView({ block: "center" });
      }, 0);
    }
  }, [initialLocation, sections]);

  function jumpToMatch(delta = 1) {
    if (!matches.length) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    const match = matches[next];
    if (!match) return;
    const section = sections.find(
      (candidate) =>
        candidate.startOffset <= match.startOffset && candidate.endOffset >= match.startOffset,
    );
    if (section) document.getElementById(section.id)?.scrollIntoView({ block: "center" });
  }

  function handleSelection() {
    const current = window.getSelection();
    if (!current || current.isCollapsed || !content.current || !current.rangeCount) return;
    const range = current.getRangeAt(0);
    const container = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const segment = container?.closest<HTMLElement>("[data-source-segment]");
    if (!segment || !content.current.contains(segment)) return;
    const start = Number(segment.dataset.startOffset);
    const selectedStart = start + textOffsetInElement(segment, range.startContainer, range.startOffset);
    const selectedEnd = start + textOffsetInElement(segment, range.endContainer, range.endOffset);
    const startOffset = Math.max(start, Math.min(selectedStart, selectedEnd));
    const endOffset = Math.min(Number(segment.dataset.endOffset), Math.max(selectedStart, selectedEnd));
    const text = sourceExcerpt(currentSource.text, startOffset, endOffset).trim();
    if (!text || endOffset <= startOffset) return;
    setSelection({ text, startOffset, endOffset });
    setMessage("");
    setError("");
  }

  async function addSelectionToNote() {
    if (!selection) return;
    if (selection.text.length > 20_000) {
      setError("Select a shorter passage before adding it to a Note.");
      return;
    }
    if (!targetTaskId) {
      setError("Link this source to an assignment before adding a passage to a Note.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const annotated = await saveCommand({
        type: "source.annotate",
        sourceId: currentSource.id,
        input: {
          sourceRevision,
          text: selection.text,
          comment,
          location: {
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
          },
        },
      });
      const nextSource = annotated?.sources.find((candidate) => candidate.id === currentSource.id);
      if (!nextSource) throw Error("The source annotation could not be saved.");
      setCurrentSource(nextSource);
      const annotation = nextSource.annotations?.at(-1);
      if (!annotation) throw Error("The source annotation could not be read back.");

      let canvasMeta = targetCanvasId
        ? data.canvases.find((canvas) => canvas.id === targetCanvasId)
        : linkedCanvases[0];
      let snapshot = annotated ?? data;
      if (!canvasMeta) {
        const created = await saveCommand({ type: "canvas.create", taskId: targetTaskId });
        snapshot = created ?? snapshot;
        canvasMeta = snapshot.canvases.find((canvas) => canvas.taskId === targetTaskId);
      }
      if (!canvasMeta) throw Error("Create a Note for the linked assignment before adding this passage.");
      const record = await window.desk.canvas(canvasMeta.id);
      const document = ensureNoteDocument(record.scene.document);
      const provenance = sourceProvenance.parse({
        sourceId: nextSource.id,
        sourceRevision: annotation.sourceRevision,
        excerpt: annotation.text,
        location: annotation.location,
        annotationId: annotation.id,
      });
      const block = sourceExcerptBlock(annotation.text, provenance);
      const nextDocument = insertNoteBlock(document, document.blocks.at(-1)?.id ?? null, block);
      const sourceIds = [...new Set([...(record.scene.sourceIds ?? []), nextSource.id])];
      await saveCommand({
        type: "canvas.save",
        id: record.id,
        revision: record.revision,
        scene: {
          ...record.scene,
          sourceIds,
          document: {
            ...nextDocument,
            provenance: {
              ...nextDocument.provenance,
              origin: nextDocument.provenance?.origin ?? "enhanced",
              sourceIds,
              basis: nextDocument.provenance?.basis ?? "Source passage linked from Library",
            },
          },
        },
      });
      setTargetCanvasId(canvasMeta.id);
      setComment("");
      setSelection(undefined);
      setMessage(`Added to ${canvasMeta.title}. The exact source passage is linked.`);
      if (targetTaskId) await openCanvas(targetTaskId, canvasMeta.id, block.id);
    } catch (cause) {
      setError(userError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="source-reader" onCancel={close} aria-labelledby="source-reader-title">
      <header className="source-reader-header">
        <div>
          <div className="eyebrow">{formatLabels[currentSource.format ?? "text"]} · Revision {sourceRevision}</div>
          <h2 id="source-reader-title">{currentSource.title}</h2>
          <p className="muted">{currentSource.authority === "user-provided-text" ? "Saved in your Library" : currentSource.authority}</p>
        </div>
        <div className="actions">
          {currentSource.sourceUrl && (
            <a className="button-link" href={currentSource.sourceUrl} target="_blank" rel="noreferrer">Open original</a>
          )}
          <button type="button" onClick={close}>Close</button>
        </div>
      </header>
      <div className="source-reader-toolbar">
        <label className="source-reader-search">
          <span className="sr-only">Search this source</span>
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMatchIndex(0);
            }}
            placeholder="Search this source"
            aria-label="Search this source"
          />
        </label>
        <button type="button" onClick={() => jumpToMatch(-1)} disabled={!matches.length}>Previous</button>
        <button type="button" onClick={() => jumpToMatch(1)} disabled={!matches.length}>Next</button>
        <span className="source-reader-count">{query.trim() ? `${matches.length ? matchIndex + 1 : 0} of ${matches.length}` : "⌘/Ctrl F"}</span>
      </div>
      <div className="source-reader-layout">
        <aside className="source-reader-outline" aria-label="Source outline">
          <div className="eyebrow">Outline</div>
          {sections.filter((section) => section.level <= 2).map((section) => (
            <button
              key={section.id}
              type="button"
              className={`outline-level-${section.level}`}
              onClick={() => document.getElementById(section.id)?.scrollIntoView({ block: "center" })}
            >
              {section.title}
            </button>
          ))}
          {!sections.some((section) => section.level <= 2) && <p className="muted">Captured text</p>}
        </aside>
        <main ref={content} className="source-reader-content" onMouseUp={handleSelection}>
          {sections.map((section) => (
            <article
              className={`source-segment source-segment-level-${section.level}`}
              id={section.id}
              data-source-segment
              data-start-offset={section.startOffset}
              data-end-offset={section.endOffset}
              key={section.id}
            >
              {section.level <= 2 ? <h3>{section.title}</h3> : <p>{renderMatchText(section.text, section, matches)}</p>}
            </article>
          ))}
        </main>
        <aside className="source-reader-sidecar">
          <section className="reader-panel">
            <div className="eyebrow">Selected passage</div>
            {selection ? (
              <>
                <blockquote>{selection.text}</blockquote>
                <p className="muted">{sourceAnchorLabel({ startOffset: selection.startOffset })}</p>
                <label>
                  Comment (optional)
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={5_000} placeholder="Why does this matter?" />
                </label>
                <label>
                  Add to Note
                  <select value={targetCanvasId} onChange={(event) => setTargetCanvasId(event.target.value)}>
                    <option value="">{linkedCanvases.length ? `Latest Note · ${linkedCanvases[0]!.title}` : "Create a Note for this assignment"}</option>
                    {linkedCanvases.map((canvas) => <option key={canvas.id} value={canvas.id}>{canvas.title}</option>)}
                  </select>
                </label>
                {!targetCanvasId && currentSource.taskIds.length > 1 && (
                  <label>
                    Assignment
                    <select value={targetTaskId} onChange={(event) => setTargetTaskId(event.target.value)}>
                      {currentSource.taskIds.map((taskId) => <option key={taskId} value={taskId}>{data.tasks.find((task) => task.id === taskId)?.title ?? taskId}</option>)}
                    </select>
                  </label>
                )}
                <button className="primary" type="button" onClick={() => void addSelectionToNote()} disabled={busy}>{busy ? "Adding…" : "Add to Note"}</button>
              </>
            ) : <p className="muted">Highlight text in the reader to annotate it or add it to a Note.</p>}
            {message && <p className="reader-success" role="status">{message}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </section>
          <section className="reader-panel">
            <div className="eyebrow">Annotations · {currentSource.annotations?.length ?? 0}</div>
            {(currentSource.annotations ?? []).slice().reverse().map((annotation) => {
              const stale = annotation.sourceRevision !== sourceRevision || (annotation.location.startOffset !== undefined && sourceExcerpt(currentSource.text, annotation.location.startOffset, annotation.location.endOffset ?? annotation.location.startOffset + annotation.text.length).trim() !== annotation.text.trim());
              return (
                <article className={`reader-annotation${stale ? " is-stale" : ""}`} key={annotation.id}>
                  <button type="button" onClick={() => {
                    if (annotation.location.startOffset === undefined) return;
                    const section = sections.find((candidate) => candidate.startOffset <= annotation.location.startOffset! && candidate.endOffset >= annotation.location.startOffset!);
                    if (section) document.getElementById(section.id)?.scrollIntoView({ block: "center" });
                  }}>
                    <strong>{sourceAnchorLabel(annotation.location)}</strong>
                    <span>{annotation.text}</span>
                  </button>
                  {annotation.comment && <p>{annotation.comment}</p>}
                  {stale && <small>Source changed since this annotation. Review before relying on its anchor.</small>}
                  {!!annotation.noteRefs.length && <small>Used in {annotation.noteRefs.length} Note{annotation.noteRefs.length === 1 ? "" : "s"}.</small>}
                  {annotation.noteRefs.map((ref) => {
                    const canvas = data.canvases.find((candidate) => candidate.id === ref.canvasId);
                    const taskId = canvas?.taskId ?? currentSource.taskIds[0];
                    return taskId && canvas ? <button className="reader-backlink" type="button" key={`${ref.canvasId}-${ref.blockId}`} onClick={() => void openCanvas(taskId, ref.canvasId, ref.blockId)}>Open {canvas.title}</button> : null;
                  })}
                </article>
              );
            })}
            {!currentSource.annotations?.length && <p className="muted">Your highlights and comments will stay attached to this revision.</p>}
          </section>
          {!!currentSource.revisionHistory?.length && (
            <details className="reader-panel">
              <summary>Previous revisions · {currentSource.revisionHistory.length}</summary>
              {currentSource.revisionHistory.slice().reverse().map((revision) => <p key={`${revision.revision}-${revision.textHash}`}><strong>Revision {revision.revision}</strong><br /><span className="muted">{new Date(revision.capturedAt).toLocaleString()} · {revision.textLength.toLocaleString()} characters</span></p>)}
            </details>
          )}
        </aside>
      </div>
    </dialog>
  );
}
