import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteBlock, NoteCapture, NoteDocument, NoteRecording } from "../../../packages/canvas/notes";
import {
  insertNoteBlock,
  markdownShortcut,
  noteHeadings,
  appendNoteEditEvent,
  removeNoteBlock,
  updateNoteRecording,
  updateNoteBlock,
} from "../../../packages/canvas/notes";
import { evaluateExpression, evaluateExpressions } from "../../../packages/canvas/semantic-math";
import { graphPath, intersections, panViewport, roots, sampleGraph, zoomViewport } from "../../../packages/canvas/graph";
import { boxplot, calculatedRows, dataColumnAliases, histogram, linearRegression, numericColumn, summarize } from "../../../packages/canvas/data";
import { RecordingChunkQueue } from "../../../packages/canvas/recording-upload";
import { RecordingSessionRegistry } from "../../../packages/canvas/recording-session";

const newId = () => crypto.randomUUID();
const paragraph = (): Extract<NoteBlock, { type: "paragraph" }> => ({ id: newId(), type: "paragraph", text: "" });

function insertFor(type: string): NoteBlock {
  const id = newId();
  switch (type) {
    case "heading": return { id, type: "heading", level: 2, text: "" };
    case "list": return { id, type: "list", ordered: false, indent: 0, text: "" };
    case "checkbox": return { id, type: "checkbox", checked: false, indent: 0, text: "" };
    case "code": return { id, type: "code", language: "text", text: "" };
    case "math": return { id, type: "math", latex: "x^2", display: true, suggestionMode: "suggest" };
    case "table": return { id, type: "table", columns: ["Column 1", "Column 2"], rows: [["", ""]] };
    case "graph": return { id, type: "graph", expressions: [{ id: newId(), expression: "x^2", color: "#c45f45", visible: true }], viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, traceX: null };
    case "data": return { id, type: "data", columns: ["x", "y"], rows: [[1, 1], [2, 4], [3, 9]], chart: "scatter", xColumn: 0, yColumn: 1 };
    case "freeform": return { id, type: "freeform", regionId: newId(), title: "Freeform workspace", collapsed: true };
    default: return paragraph();
  }
}

export default function NotesFlow({
  document,
  canvasId,
  onChange,
  openFreeform,
  initialBlockId,
  onAddFiles,
  onAddCaptureDerivative,
  onCreateCaptureSource,
  onStudyCapture,
  onStudySelection,
  files,
  onDropText,
  autoFocus = false,
}: {
  document: NoteDocument;
  canvasId?: string;
  onChange: (document: NoteDocument) => void;
  openFreeform: (block: Extract<NoteBlock, { type: "freeform" }>) => void;
  initialBlockId?: string;
  onAddFiles?: (files: File[]) => void;
  onAddCaptureDerivative?: (captureId: string, file: File) => void;
  onCreateCaptureSource?: (captureId: string, text: string) => void;
  onStudyCapture?: (captureId: string) => void;
  onStudySelection?: (text: string) => void;
  files?: Record<string, { mimeType: string; dataURL: string }>;
  onDropText?: (text: string) => void;
  autoFocus?: boolean;
}) {
  const note = document;
  const [active, setActive] = useState(note.blocks[0]?.id ?? "");
  const [slash, setSlash] = useState<string | null>(null);
  const scrolledBlock = useRef<string | undefined>(undefined);
  const lastEditEvent = useRef<{ recordingId: string; blockId: string; atMs: number } | undefined>(undefined);
  const headings = useMemo(() => noteHeadings(note), [note]);
  const recordingEvents = useMemo(() => (note.recordings ?? []).flatMap((recording) => (recording.events ?? []).filter((event) => event.blockId).map((event) => ({ ...event, recordingId: recording.id }))), [note.recordings]);
  const firstBlockId = note.blocks[0]?.id;
  function navigateToBlock(blockId?: string) {
    if (!blockId || !note.blocks.some((block) => block.id === blockId)) return;
    setActive(blockId);
    requestAnimationFrame(() => {
      globalThis.document.getElementById(`note-block-${blockId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  useEffect(() => {
    if (!initialBlockId || scrolledBlock.current === initialBlockId || !note.blocks.some((block) => block.id === initialBlockId)) return;
    scrolledBlock.current = initialBlockId;
    setActive(initialBlockId);
    requestAnimationFrame(() => {
      globalThis.document.getElementById(`note-block-${initialBlockId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [initialBlockId, note.blocks]);

  useEffect(() => {
    if (!autoFocus || initialBlockId || !firstBlockId) return;
    requestAnimationFrame(() => {
      globalThis.document
        .getElementById(`note-block-${firstBlockId}`)
        ?.querySelector<HTMLElement>("textarea, input")
        ?.focus();
    });
  }, [autoFocus, firstBlockId, initialBlockId]);

  function commit(next: NoteDocument, blockId?: string) {
    let value = next;
    if (blockId) {
      const recording = next.recordings?.find((item) => item.status === "recording");
      const startedAt = recording ? Date.parse(recording.startedAt) : NaN;
      if (recording && Number.isFinite(startedAt) && (recording.events?.length ?? 0) < 10_000) {
        const atMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Date.now() - startedAt));
        const previous = lastEditEvent.current;
        if (!previous || previous.recordingId !== recording.id || previous.blockId !== blockId || atMs - previous.atMs >= 750) {
          value = appendNoteEditEvent(next, recording.id, blockId, atMs);
          lastEditEvent.current = { recordingId: recording.id, blockId, atMs };
        }
      }
    }
    onChange(value);
  }

  function replace(id: string, update: Partial<NoteBlock>) {
    commit(updateNoteBlock(note, id, update), id);
  }
  function insert(afterId: string | null, type = "paragraph") {
    const next = insertNoteBlock(note, afterId, insertFor(type));
    const afterIndex = afterId
      ? next.blocks.findIndex((item) => item.id === afterId)
      : -1;
    const insertedId = next.blocks[afterIndex + 1]?.id ?? next.blocks.at(-1)?.id ?? "";
    commit(next, insertedId || undefined);
    setActive(insertedId);
    setSlash(null);
  }
  function handleKeyDown(event: React.KeyboardEvent, block: NoteBlock) {
    if (event.key === "Tab" && (block.type === "list" || block.type === "checkbox")) {
      event.preventDefault();
      replace(block.id, { indent: Math.max(0, Math.min(8, block.indent + (event.shiftKey ? -1 : 1))) });
      return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.shiftKey && event.currentTarget instanceof HTMLTextAreaElement) {
      const field = event.currentTarget;
      const atBoundary = event.key === "ArrowUp" ? field.selectionStart === 0 : field.selectionEnd === field.value.length;
      if (atBoundary) {
        const index = note.blocks.findIndex((item) => item.id === block.id);
        const target = note.blocks[index + (event.key === "ArrowUp" ? -1 : 1)];
        const focusTarget = target ? globalThis.document.getElementById(`note-block-${target.id}`)?.querySelector<HTMLElement>("textarea, input, button") : undefined;
        if (focusTarget) {
          event.preventDefault();
          focusTarget.focus();
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey && block.type !== "code") {
      event.preventDefault();
      insert(block.id);
    }
    if (event.key === "Backspace" && "text" in block && block.text === "" && note.blocks.length > 1) {
      event.preventDefault();
      commit(removeNoteBlock(note, block.id), note.blocks.find((item) => item.id !== block.id)?.id);
    }
  }
  function handleText(block: Extract<NoteBlock, { type: "paragraph" | "heading" | "list" | "checkbox" | "code" }>, value: string) {
    const next = block.type === "paragraph" ? markdownShortcut({ ...block, text: value }) : { ...block, text: value };
    commit(updateNoteBlock(note, block.id, next), block.id);
    setSlash(next.type === "paragraph" && value === "/" ? block.id : null);
  }
  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    if (files.length && onAddFiles) {
      onAddFiles(files);
      return;
    }
    const text = event.dataTransfer.getData("text/plain").trim();
    if (text) {
      onDropText?.(text);
      if (!onDropText) commit(insertNoteBlock(note, active || null, { ...paragraph(), text }), active || undefined);
    }
  }
  function studyActiveBlock() {
    const block = note.blocks.find((item) => item.id === active);
    if (!block || !onStudySelection) return;
    const text = "text" in block
      ? block.text
      : block.type === "math"
        ? [block.latex, block.expression].filter(Boolean).join("\n")
        : block.type === "table" || block.type === "data"
          ? [block.columns.join(" | "), ...block.rows.slice(0, 20).map((row) => row.join(" | "))].join("\n")
          : "title" in block ? block.title : "";
    if (text.trim()) onStudySelection(text.trim());
  }
  function replaceCapture(id: string, update: Partial<NoteCapture>) {
    const captures = (note.captures ?? []).map((capture) => capture.id === id ? { ...capture, ...update } : capture);
    const blockId = note.blocks.find((block) => (block.type === "image" || block.type === "file") && block.captureId === id)?.id;
    commit({ ...note, captures }, blockId);
  }

  return (
    <div className="notes-flow" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <aside className="notes-outline" aria-label="Note outline">
        <span className="eyebrow">Outline</span>
        {headings.length ? headings.map((heading) => (
          <button key={heading.id} className={`outline-heading level-${heading.level}`} onClick={() => { setActive(heading.id); globalThis.document.getElementById(`note-block-${heading.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
            {heading.text || "Untitled heading"}
          </button>
        )) : <span className="muted">Headings appear here</span>}
      </aside>
      <section className="notes-editor" aria-label="Notes document">
        <div className="notes-toolbar">
          <span className="eyebrow">Document flow</span>
          <button type="button" onClick={() => insert(active || null)}>＋ Block</button>
          <button type="button" onClick={() => insert(active || null, "freeform")}>＋ Freeform</button>
          <button type="button" onClick={() => insert(active || null, "data")}>＋ Data</button>
          {onStudySelection && <button type="button" onClick={studyActiveBlock} disabled={!active}>Study active block</button>}
          {onAddFiles && <label className="notes-import"><input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(event) => { onAddFiles(event.target.files ? [...event.target.files] : []); event.currentTarget.value = ""; }} />＋ Paper or file</label>}
          {canvasId && <RecordingControls canvasId={canvasId} document={note} activeBlockId={active} onChange={commit} onNavigate={navigateToBlock} />}
          <span className="muted">Enter adds a block · Tab indents lists</span>
        </div>
        {note.blocks.map((block) => (
          <NoteBlockView
            key={block.id}
            block={block}
            active={active === block.id}
            slash={slash === block.id}
            onFocus={() => setActive(block.id)}
            onKeyDown={(event) => handleKeyDown(event, block)}
            onText={(value) => handleText(block as Extract<NoteBlock, { type: "paragraph" | "heading" | "list" | "checkbox" | "code" }>, value)}
            onReplace={(update) => replace(block.id, update)}
            insert={(type) => insert(block.id, type)}
            openFreeform={openFreeform}
            capture={block.type === "image" || block.type === "file" ? note.captures?.find((capture) => capture.id === block.captureId) : undefined}
            onCaptureReplace={replaceCapture}
            onAddCaptureDerivative={onAddCaptureDerivative}
            onCreateCaptureSource={onCreateCaptureSource}
            onStudyCapture={onStudyCapture}
            file={block.type === "image" || block.type === "file" ? files?.[block.fileId] : undefined}
            mathBlocks={note.blocks.filter((candidate): candidate is Extract<NoteBlock, { type: "math" }> => candidate.type === "math")}
            recordingEvents={recordingEvents.filter((event) => event.blockId === block.id)}
          />
        ))}
        <button className="notes-add-block" type="button" onClick={() => insert(note.blocks.at(-1)?.id ?? null)}>Continue writing</button>
      </section>
    </div>
  );
}

function RecordingControls({
  canvasId,
  document,
  activeBlockId,
  onChange,
  onNavigate,
}: {
  canvasId: string;
  document: NoteDocument;
  activeBlockId: string;
  onChange: (document: NoteDocument) => void;
  onNavigate: (blockId?: string) => void;
}) {
  const [recordingId, setRecordingId] = useState<string>();
  const [recorder, setRecorder] = useState<MediaRecorder>();
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [audioURL, setAudioURL] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessions = useRef(new RecordingSessionRegistry());
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const startGeneration = useRef(0);
  const documentRef = useRef(document);
  const startedAt = useRef(0);
  documentRef.current = document;
  const current = recordingId ? document.recordings?.find((item) => item.id === recordingId) : undefined;
  useEffect(() => {
    if (!recordingId && document.recordings?.length)
      setRecordingId(document.recordings.at(-1)!.id);
  }, [document.recordings, recordingId]);
  useEffect(() => {
    if (!recordingId) return;
    const next = document.recordings?.find((item) => item.id === recordingId);
    setTranscriptText(next?.transcript?.map((segment) => segment.text).join("\n") ?? "");
    if (next?.status === "complete" || next?.status === "interrupted" || next?.status === "failed") {
      let active = true;
      void window.desk.recordingURL(recordingId)
        .then((url) => { if (active) setAudioURL(url); })
        .catch(() => { if (active) setAudioURL(""); });
      return () => { active = false; };
    }
    setAudioURL("");
  }, [document.recordings, recordingId, current?.status, current?.chunkCount]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startGeneration.current += 1;
      startingRef.current = false;
      sessions.current.disposeCurrent();
    };
  }, []);

  function update(id: string, change: Partial<NoteRecording>) {
    try {
      const next = updateNoteRecording(documentRef.current, id, change);
      documentRef.current = next;
      onChange(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update this recording.");
    }
  }

  async function start() {
    if (startingRef.current || sessions.current.hasActive()) return;
    startingRef.current = true;
    const generation = startGeneration.current + 1;
    startGeneration.current = generation;
    const stillStarting = () => mountedRef.current && startGeneration.current === generation;
    const finishStarting = () => {
      if (startGeneration.current === generation) startingRef.current = false;
      if (stillStarting()) setStarting(false);
    };
    setStarting(true);
    setStatus("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("Audio recording is unavailable in this environment.");
      finishStarting();
      return;
    }
    let localStream: MediaStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("Microphone permission is required to record. No audio was saved.");
      finishStarting();
      return;
    }
    if (!stillStarting()) {
      localStream.getTracks().forEach((track) => track.stop());
      finishStarting();
      return;
    }
    const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/webm";
    let started;
    try {
      started = await window.desk.recordingStart(canvasId, preferred);
    } catch (error) {
      localStream.getTracks().forEach((track) => track.stop());
      setStatus(error instanceof Error ? error.message : "Unable to start recording.");
      finishStarting();
      return;
    }
    if (!stillStarting()) {
      await window.desk.recordingFinish(started.recordingId, "interrupted").catch(() => {});
      localStream.getTracks().forEach((track) => track.stop());
      finishStarting();
      return;
    }
    let nextRecorder: MediaRecorder;
    try {
      nextRecorder = new MediaRecorder(localStream, { mimeType: started.mimeType });
    } catch {
      localStream.getTracks().forEach((track) => track.stop());
      setStatus("This device cannot encode the selected audio format.");
      await window.desk.recordingFinish(started.recordingId, "failed").catch(() => {});
      finishStarting();
      return;
    }
    if (!stillStarting()) {
      await window.desk.recordingFinish(started.recordingId, "interrupted").catch(() => {});
      localStream.getTracks().forEach((track) => track.stop());
      finishStarting();
      return;
    }
    const meta: NoteRecording = { id: started.recordingId, status: "recording", ...(started.sessionId ? { sessionId: started.sessionId } : {}), startedAt: started.startedAt, chunkCount: 0, mimeType: started.mimeType, events: [] };
    documentRef.current = { ...documentRef.current, recordings: [...(documentRef.current.recordings ?? []), meta] };
    onChange(documentRef.current);
    startedAt.current = Date.parse(started.startedAt);
    const queue = new RecordingChunkQueue(
      0,
      (index, bytes) => window.desk.recordingChunk(started.recordingId, index, bytes),
    );
    let resourcesStopped = false;
    const stopResources = () => {
      if (resourcesStopped) return;
      resourcesStopped = true;
      if (nextRecorder.state !== "inactive") nextRecorder.stop();
      localStream.getTracks().forEach((track) => track.stop());
    };
    let lease: ReturnType<RecordingSessionRegistry["begin"]>;
    try {
      lease = sessions.current.begin(started.recordingId, stopResources);
    } catch (error) {
      stopResources();
      await window.desk.recordingFinish(started.recordingId, "interrupted").catch(() => {});
      setStatus(error instanceof Error ? error.message : "Another recording is already active.");
      finishStarting();
      return;
    }
    let pendingData = Promise.resolve();
    let dataReadFailed = false;
    nextRecorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      pendingData = pendingData.then(async () => {
        const value = await event.data.arrayBuffer();
        queue.enqueue(new Uint8Array(value));
        const result = await queue.flush();
        update(started.recordingId, { chunkCount: result.chunkCount });
        if (result.failure)
          setStatus(`Recording is incomplete after chunk ${result.failure.chunkIndex + 1} could not be saved.`);
      }).catch(() => {
        dataReadFailed = true;
        setStatus("A recording chunk could not be read. Earlier chunks remain on this Mac.");
      });
    };
    nextRecorder.onerror = () => setStatus("Recording stopped unexpectedly. Saved audio remains available.");
    nextRecorder.onstop = () => {
      void pendingData.then(() => queue.flush()).then(async (result) => {
        try {
          const failure = result.failure ?? (dataReadFailed ? { chunkIndex: result.chunkCount, attempts: 1, message: "The audio data could not be read." } : undefined);
          const finish = await window.desk.recordingFinish(started.recordingId, failure ? "failed" : "complete");
          const status = failure ? "failed" : "complete";
          update(started.recordingId, { status, endedAt: finish.endedAt, durationMs: Math.max(0, Date.parse(finish.endedAt) - startedAt.current), chunkCount: finish.chunkCount });
          if (lease.isCurrent() || !sessions.current.hasActive())
            setStatus(failure ? `Recording incomplete after chunk ${failure.chunkIndex + 1} could not be saved. Earlier chunks remain on this Mac.` : "Recording saved in timestamped chunks.");
        } catch {
          update(started.recordingId, { status: "interrupted", endedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - startedAt.current) });
          if (lease.isCurrent() || !sessions.current.hasActive())
            setStatus("Recording ended before its manifest could be finalized. Saved chunks remain on this Mac.");
        } finally {
          stopResources();
          const released = lease.release();
          if (released && mountedRef.current) setRecorder(undefined);
        }
      });
    };
    try {
      nextRecorder.start(1000);
    } catch (error) {
      stopResources();
      lease.release();
      await window.desk.recordingFinish(started.recordingId, "failed").catch(() => {});
      update(started.recordingId, { status: "failed", endedAt: new Date().toISOString(), durationMs: 0 });
      setStatus(error instanceof Error ? error.message : "Unable to start recording.");
      finishStarting();
      return;
    }
    setRecordingId(started.recordingId);
    setRecorder(nextRecorder);
    finishStarting();
    setStatus("Recording… audio is saved every second.");
  }

  function stop() {
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    setStatus("Finishing recording…");
  }

  function mark() {
    if (!recordingId || !startedAt.current) return;
    const item = documentRef.current.recordings?.find((recording) => recording.id === recordingId);
    if (!item) return;
    update(recordingId, { events: [...(item.events ?? []), { id: newId(), atMs: Math.max(0, Date.now() - startedAt.current), blockId: activeBlockId, label: "Note marker" }] });
    setStatus("Note marker saved to the recording.");
  }

  function saveTranscript() {
    if (!recordingId) return;
    const item = documentRef.current.recordings?.find((recording) => recording.id === recordingId);
    if (!item) return;
    const value = transcriptText.trim();
    update(recordingId, { transcript: value ? [{ id: newId(), startMs: 0, endMs: item.durationMs ?? Math.max(0, Date.now() - startedAt.current), text: value, blockId: activeBlockId }] : [] });
    setStatus(value ? "Transcript saved with this Note." : "Transcript cleared.");
  }

  function jumpToEvent(event: { atMs: number; blockId?: string }) {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = Math.max(0, event.atMs / 1000);
      void audio.play().catch(() => {});
    }
    onNavigate(event.blockId);
  }

  return (
    <div className="notes-recording" aria-label="Lecture recording">
      <span className="eyebrow">Lecture audio</span>
      {recorder ? (
        <button type="button" onClick={stop}>Stop recording</button>
      ) : (
        <button type="button" onClick={() => void start()} disabled={starting}>{starting ? "Starting…" : "Record lecture"}</button>
      )}
      {document.recordings && document.recordings.length > 0 && (
        <label className="recording-picker">
          Recording
          <select aria-label="Recording" value={recordingId ?? ""} onChange={(event) => setRecordingId(event.target.value)}>
            {document.recordings.map((item, index) => <option key={item.id} value={item.id}>Lecture {index + 1} · {item.status}</option>)}
          </select>
        </label>
      )}
      {recordingId && <button type="button" onClick={mark} disabled={!recorder}>Mark note time</button>}
      <span className="recording-status" role="status">{status || (current ? `${current.chunkCount} audio chunks · ${current.status}` : "Audio stays on this Mac")}</span>
      {audioURL && <audio ref={audioRef} controls preload="metadata" src={audioURL} aria-label="Note lecture recording" />}
      {current?.events?.length ? <span className="recording-markers">{current.events.map((event) => <button type="button" key={event.id} onClick={() => jumpToEvent(event)}>Jump to {event.label ?? "note marker"} · {Math.round(event.atMs / 1000)}s</button>)}</span> : null}
      {current?.transcript?.length ? <span className="recording-transcript-list">{current.transcript.map((segment) => <button type="button" key={segment.id} onClick={() => jumpToEvent({ atMs: segment.startMs, blockId: segment.blockId })}>{segment.text} · {Math.round(segment.startMs / 1000)}s</button>)}</span> : null}
      {recordingId && <label className="recording-transcript">Transcript (optional, paste or type)<textarea value={transcriptText} onChange={(event) => setTranscriptText(event.target.value)} onBlur={saveTranscript} rows={1} placeholder="Add a transcript or key timestamps…" /></label>}
    </div>
  );
}

function NoteBlockView({
  block,
  active,
  slash,
  onFocus,
  onKeyDown,
  onText,
  onReplace,
  insert,
  openFreeform,
  capture,
  onCaptureReplace,
  onAddCaptureDerivative,
  onCreateCaptureSource,
  onStudyCapture,
  file,
  mathBlocks,
  recordingEvents,
}: {
  block: NoteBlock;
  active: boolean;
  slash: boolean;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onText: (value: string) => void;
  onReplace: (update: Partial<NoteBlock>) => void;
  insert: (type: string) => void;
  openFreeform: (block: Extract<NoteBlock, { type: "freeform" }>) => void;
  capture?: NoteCapture;
  onCaptureReplace: (id: string, update: Partial<NoteCapture>) => void;
  onAddCaptureDerivative?: (captureId: string, file: File) => void;
  onCreateCaptureSource?: (captureId: string, text: string) => void;
  onStudyCapture?: (captureId: string) => void;
  file?: { mimeType: string; dataURL: string };
  mathBlocks: Array<Extract<NoteBlock, { type: "math" }>>;
  recordingEvents: Array<{ id: string; recordingId: string; atMs: number; blockId?: string; label?: string }>;
}) {
  function playRecordingAt(atMs: number) {
    const audio = globalThis.document.querySelector<HTMLAudioElement>('audio[aria-label="Note lecture recording"]');
    if (!audio) return;
    audio.currentTime = Math.max(0, atMs / 1000);
    void audio.play().catch(() => {});
  }
  return (
    <article id={`note-block-${block.id}`} className={`note-block note-${block.type}${active ? " is-active" : ""}`} style={{ marginInlineStart: block.type === "list" || block.type === "checkbox" ? `${block.indent * 1.35}rem` : undefined }}>
      {block.type === "heading" ? <textarea className={`note-heading level-${block.level}`} value={block.text} placeholder="Heading" rows={1} onFocus={onFocus} onKeyDown={onKeyDown} onChange={(event) => onText(event.target.value)} /> : block.type === "paragraph" ? <div><textarea className="note-paragraph" value={block.text} placeholder="Start writing, or type / for a block…" rows={Math.max(1, Math.min(8, block.text.split("\n").length))} onFocus={onFocus} onKeyDown={onKeyDown} onChange={(event) => onText(event.target.value)} /><InlineMathPreview text={block.text} /></div> : block.type === "list" ? <label className="note-list"><span aria-hidden="true">{block.ordered ? "1." : "•"}</span><textarea value={block.text} placeholder="List item" rows={1} onFocus={onFocus} onKeyDown={onKeyDown} onChange={(event) => onText(event.target.value)} /></label> : block.type === "checkbox" ? <label className="note-check"><input type="checkbox" checked={block.checked} onChange={(event) => onReplace({ checked: event.target.checked })} /><textarea value={block.text} placeholder="Task or question" rows={1} onFocus={onFocus} onKeyDown={onKeyDown} onChange={(event) => onText(event.target.value)} /></label> : block.type === "code" ? <label className="note-code"><input value={block.language} aria-label="Code language" onFocus={onFocus} onChange={(event) => onReplace({ language: event.target.value })} /><textarea value={block.text} placeholder="Code" rows={4} onFocus={onFocus} onKeyDown={onKeyDown} onChange={(event) => onText(event.target.value)} /></label> : block.type === "math" ? <MathBlock block={block} onFocus={onFocus} onReplace={onReplace} /> : block.type === "table" || block.type === "data" ? <TableBlock block={block} onFocus={onFocus} onReplace={onReplace} /> : block.type === "graph" ? <GraphBlock block={block} mathBlocks={mathBlocks} onFocus={onFocus} onReplace={onReplace} /> : block.type === "freeform" ? <div className="note-freeform"><div><span className="eyebrow">Freeform region</span><input value={block.title} onFocus={onFocus} onChange={(event) => onReplace({ title: event.target.value })} /></div><button type="button" onClick={() => openFreeform(block)}>{block.collapsed ? "Expand workspace" : "Open workspace"}</button></div> : <MediaBlock block={block} file={file} capture={capture} onFocus={onFocus} onReplace={onReplace} onCaptureReplace={onCaptureReplace} onAddCaptureDerivative={onAddCaptureDerivative} onCreateCaptureSource={onCreateCaptureSource} onStudyCapture={onStudyCapture} />}
      {recordingEvents.length > 0 && <div className="note-recording-links" aria-label="Lecture links">{recordingEvents.map((event) => <button key={`${event.recordingId}-${event.id}`} type="button" onClick={() => playRecordingAt(event.atMs)}>Play lecture at {Math.round(event.atMs / 1000)}s</button>)}</div>}
      {slash && <div className="slash-menu" role="menu" aria-label="Insert block"><button type="button" onClick={() => insert("heading")}>Heading</button><button type="button" onClick={() => insert("list")}>List</button><button type="button" onClick={() => insert("checkbox")}>Checkbox</button><button type="button" onClick={() => insert("math")}>Math</button><button type="button" onClick={() => insert("code")}>Code</button><button type="button" onClick={() => insert("table")}>Table</button><button type="button" onClick={() => insert("data")}>Data</button><button type="button" onClick={() => insert("graph")}>Graph</button><button type="button" onClick={() => insert("freeform")}>Freeform</button></div>}
    </article>
  );
}

function MediaBlock({ block, file, capture, onFocus, onReplace, onCaptureReplace, onAddCaptureDerivative, onCreateCaptureSource, onStudyCapture }: { block: Extract<NoteBlock, { type: "image" | "file" }>; file?: { mimeType: string; dataURL: string }; capture?: NoteCapture; onFocus: () => void; onReplace: (update: Partial<NoteBlock>) => void; onCaptureReplace: (id: string, update: Partial<NoteCapture>) => void; onAddCaptureDerivative?: (captureId: string, file: File) => void; onCreateCaptureSource?: (captureId: string, text: string) => void; onStudyCapture?: (captureId: string) => void }) {
  const sourceText = capture ? [capture.ocrText, capture.handwritingText, ...(capture.annotations ?? []).map((annotation) => annotation.text), ...(capture.mathExpressions ?? [])].filter(Boolean).join("\n") : "";
  const annotationText = capture?.annotations?.map((annotation) => annotation.text).join("\n") ?? "";
  const recognizeMath = () => {
    if (!capture) return;
    const candidates = [capture.ocrText, capture.handwritingText]
      .filter(Boolean)
      .flatMap((value) => value!.split(/\r?\n/).map((line) => line.trim()))
      .filter((line) => line.includes("=") && /[A-Za-z0-9]/.test(line));
    const mathExpressions = [...new Set([...(capture.mathExpressions ?? []), ...candidates])].slice(0, 100);
    onCaptureReplace(capture.id, { mathExpressions });
  };
  return <div className="note-media" onFocus={onFocus}><strong>{block.type === "image" ? "Paper image" : "PDF or file"}</strong>{file && (file.mimeType === "application/pdf" ? <object className="note-media-preview" data={file.dataURL} type="application/pdf" aria-label={block.name}><p>PDF preview unavailable. The original remains attached.</p></object> : <img className="note-media-preview" src={file.dataURL} alt={block.caption || block.name} style={{ transform: `rotate(${capture?.rotation ?? 0}deg)` }} />)}<input value={block.name} aria-label="File name" onChange={(event) => onReplace({ name: event.target.value })} /><input value={block.caption ?? ""} aria-label="File caption" placeholder="Caption" onChange={(event) => onReplace({ caption: event.target.value })} /><span>Original bytes stay attached to this Note.</span>{capture && <details><summary>Semantic layer</summary><div className="capture-controls"><label>Rotation<select value={capture.rotation ?? 0} onChange={(event) => onCaptureReplace(capture.id, { rotation: Number(event.target.value) as 0 | 90 | 180 | 270 })}><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>{capture.cleanedFileId && <span className="muted">Cleaned derivative attached.</span>}{onAddCaptureDerivative && <label className="notes-import">{capture.cleanedFileId ? "Replace cleaned derivative" : "Add cleaned derivative"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAddCaptureDerivative(capture.id, file); event.currentTarget.value = ""; }} /></label>}{onStudyCapture && <button type="button" onClick={() => onStudyCapture(capture.id)}>Study selected region</button>}<button type="button" onClick={recognizeMath}>Recognize math</button></div><label>OCR text<textarea value={capture.ocrText ?? ""} placeholder="Paste recognized text without replacing the original" onChange={(event) => onCaptureReplace(capture.id, { ocrText: event.target.value })} /></label><label>Recognized handwriting<textarea value={capture.handwritingText ?? ""} placeholder="Paste handwriting recognition without replacing the original" onChange={(event) => onCaptureReplace(capture.id, { handwritingText: event.target.value })} /></label><label>Annotations<textarea value={annotationText} placeholder="One annotation per line" onChange={(event) => onCaptureReplace(capture.id, { annotations: event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => ({ id: `${capture.id}-annotation-${index + 1}`, text: line })) })} /></label><label>Math expressions<textarea value={(capture.mathExpressions ?? []).join("\n")} placeholder="One recognized expression per line" onChange={(event) => onCaptureReplace(capture.id, { mathExpressions: event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) })} /></label><div className="capture-region"><span className="eyebrow">Lasso region (normalized)</span><label>X<input type="number" min="0" max="1" step="0.01" value={capture.crop?.x ?? 0} onChange={(event) => onCaptureReplace(capture.id, { crop: { x: Number(event.target.value), y: capture.crop?.y ?? 0, width: capture.crop?.width ?? 1, height: capture.crop?.height ?? 1 } })} /></label><label>Y<input type="number" min="0" max="1" step="0.01" value={capture.crop?.y ?? 0} onChange={(event) => onCaptureReplace(capture.id, { crop: { x: capture.crop?.x ?? 0, y: Number(event.target.value), width: capture.crop?.width ?? 1, height: capture.crop?.height ?? 1 } })} /></label><label>Width<input type="number" min="0" max="1" step="0.01" value={capture.crop?.width ?? 1} onChange={(event) => onCaptureReplace(capture.id, { crop: { x: capture.crop?.x ?? 0, y: capture.crop?.y ?? 0, width: Number(event.target.value), height: capture.crop?.height ?? 1 } })} /></label><label>Height<input type="number" min="0" max="1" step="0.01" value={capture.crop?.height ?? 1} onChange={(event) => onCaptureReplace(capture.id, { crop: { x: capture.crop?.x ?? 0, y: capture.crop?.y ?? 0, width: capture.crop?.width ?? 1, height: Number(event.target.value) } })} /></label></div>{onCreateCaptureSource && sourceText.trim() && <button type="button" onClick={() => onCreateCaptureSource(capture.id, sourceText)}>Save semantic layer as source</button>}{capture.sourceId && <span className="muted">Linked source preserved in Library.</span>}</details>}</div>;
}

function MathBlock({ block, onFocus, onReplace }: { block: Extract<NoteBlock, { type: "math" }>; onFocus: () => void; onReplace: (update: Partial<NoteBlock>) => void }) {
  const lines = (block.expression ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const evaluation: ReturnType<typeof evaluateExpressions> = lines.length ? evaluateExpressions(lines) : { values: [], scope: {} };
  const value = evaluation.values.at(-1);
  return <div className="note-math" onFocus={onFocus}><div className="note-math-fields"><label>LaTeX<textarea value={block.latex} rows={2} onChange={(event) => onReplace({ latex: event.target.value })} /></label><label>Semantic expression<textarea value={block.expression ?? ""} placeholder="e.g. m = 5 kg\na = 3 m/s^2\nF = ma" rows={3} onChange={(event) => { const next = event.target.value; const result = evaluateExpressions(next.split(/\r?\n/)).values.at(-1); onReplace({ expression: next, ...(result ? { result: { value: result.value, ...(result.unit ? { unit: result.unit } : {}), expression: result.expression } } : {}) }); }} /></label></div><div className={`note-math-preview${block.display ? "" : " is-inline"}`} aria-live="polite"><MathPreview latex={block.latex} />{block.suggestionMode !== "off" && value && <strong>{block.suggestionMode === "insert" ? "=" : "→"} {value.display}</strong>}</div>{evaluation.error && <p className="muted">{evaluation.error}</p>}<label className="note-math-mode">Layout<select value={block.display ? "display" : "inline"} onChange={(event) => onReplace({ display: event.target.value === "display" })}><option value="display">Display</option><option value="inline">Inline</option></select></label><label className="note-math-mode">Math assistance<select value={block.suggestionMode} onChange={(event) => onReplace({ suggestionMode: event.target.value as "suggest" | "insert" | "off" })}><option value="suggest">Suggest</option><option value="insert">Insert result</option><option value="off">Off</option></select></label></div>;
}

function MathPreview({ latex }: { latex: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let active = true;
    void import("../../../packages/canvas/math")
      .then(({ renderMath }) => {
        const rendered = renderMath(latex);
        if (active) setSvg(rendered.svg);
      })
      .catch(() => {
        if (active) setSvg("");
      });
    return () => {
      active = false;
    };
  }, [latex]);
  return svg ? <span className="note-math-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <code>{latex}</code>;
}

function InlineMathPreview({ text }: { text: string }) {
  const pieces = text.split(/(\$[^$]+\$|\\\([^)]*\\\))/g).filter(Boolean);
  const formulas = pieces.filter((piece) => /^\$[^$]+\$|^\\\([^)]*\\\)$/.test(piece));
  if (!formulas.length) return null;
  return <div className="note-inline-math" aria-label="Inline math preview">{formulas.map((piece, index) => <MathPreview key={index} latex={piece.replace(/^\$|\$$/g, "").replace(/^\\\(|\\\)$/g, "")} />)}</div>;
}

function TableBlock({ block, onFocus, onReplace }: { block: Extract<NoteBlock, { type: "table" | "data" }>; onFocus: () => void; onReplace: (update: Partial<NoteBlock>) => void }) {
  const isData = block.type === "data";
  const updateCell = (row: number, column: number, value: string) => {
    const rows = block.rows.map((item) => [...item]);
    rows[row]![column] = isData && value !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
    onReplace({ rows });
  };
  const addRow = () => onReplace({ rows: [...block.rows, Array.from({ length: block.columns.length }, () => isData ? null : "")] });
  const addColumn = () => onReplace({ columns: [...block.columns, `Column ${block.columns.length + 1}`], rows: block.rows.map((row) => [...row, isData ? null : ""]) });
  const calculatedColumns = isData ? (block.calculatedColumns ?? []) : [];
  const allColumns = isData ? [...block.columns, ...calculatedColumns.map((column) => column.name)] : block.columns;
  const aliases = isData ? dataColumnAliases(block.columns, calculatedColumns) : [];
  const calculatedData = isData ? calculatedRows(block) : block.rows;
  const updateCalculated = (index: number, update: Partial<{ id: string; name: string; expression: string }>) => {
    if (!isData) return;
    onReplace({ calculatedColumns: calculatedColumns.map((column, columnIndex) => columnIndex === index ? { ...column, ...update } : column) });
  };
  const addCalculated = () => {
    if (!isData) return;
    onReplace({ calculatedColumns: [...calculatedColumns, { id: newId(), name: `Calculated ${calculatedColumns.length + 1}`, expression: `${aliases[0] ?? "column_1"} * 2` }] });
  };
  const table = <table><thead><tr>{block.columns.map((column, index) => <th key={index}><input value={column} aria-label={`Column ${index + 1}`} onChange={(event) => { const columns = [...block.columns]; columns[index] = event.target.value; onReplace({ columns }); }} /></th>)}</tr></thead><tbody>{block.rows.map((row, r) => <tr key={r}>{block.columns.map((_, c) => <td key={c}><input value={row[c] === null || row[c] === undefined ? "" : String(row[c])} aria-label={`Row ${r + 1}, column ${c + 1}`} onChange={(event) => updateCell(r, c, event.target.value)} /></td>)}</tr>)}</tbody></table>;
  const dataTable = isData ? <table><thead><tr>{allColumns.map((column, index) => index < block.columns.length ? <th key={index}><input value={column} aria-label={`Column ${index + 1}`} onChange={(event) => { const columns = [...block.columns]; columns[index] = event.target.value; onReplace({ columns }); }} /></th> : <th key={index} className="calculated-column"><input value={column} aria-label={`Calculated column ${index - block.columns.length + 1} name`} onChange={(event) => updateCalculated(index - block.columns.length, { name: event.target.value })} /><small>{aliases[index]}</small></th>)}</tr></thead><tbody>{calculatedData.map((row, r) => <tr key={r}>{allColumns.map((_, c) => c < block.columns.length ? <td key={c}><input value={row[c] === null || row[c] === undefined ? "" : String(row[c])} aria-label={`Row ${r + 1}, column ${c + 1}`} onChange={(event) => updateCell(r, c, event.target.value)} /></td> : <td key={c} className="calculated-cell" aria-label={`Calculated row ${r + 1}, column ${c - block.columns.length + 1}`}>{row[c] === null || row[c] === undefined ? "—" : String(row[c])}</td>)}</tr>)}</tbody></table> : table;
  if (!isData) {
    return <div className="note-table" onFocus={onFocus}>{table}<div className="table-actions"><button type="button" onClick={addRow}>＋ Row</button><button type="button" onClick={addColumn} disabled={block.columns.length >= 50}>＋ Column</button></div></div>;
  }
  const xColumn = Math.min(block.xColumn ?? 0, allColumns.length - 1);
  const yColumn = Math.min(block.yColumn ?? Math.min(1, allColumns.length - 1), allColumns.length - 1);
  const points = calculatedData.flatMap((row) => typeof row[xColumn] === "number" && typeof row[yColumn] === "number" ? [{ x: row[xColumn] as number, y: row[yColumn] as number }] : []);
  const numbers = numericColumn(calculatedData, yColumn);
  const summary = block.chart === "summary" ? summarize(numbers) : null;
  const regression = block.chart === "regression" ? linearRegression(points) : null;
  return <div className="note-table" onFocus={onFocus}>{dataTable}<div className="table-actions"><button type="button" onClick={addRow} disabled={block.rows.length >= 10000}>＋ Row</button><button type="button" onClick={addColumn} disabled={block.columns.length >= 50}>＋ Column</button><button type="button" onClick={addCalculated} disabled={calculatedColumns.length >= 20}>＋ Calculated column</button></div>{calculatedColumns.length > 0 && <div className="calculated-controls"><span className="eyebrow">Calculated columns</span>{calculatedColumns.map((column, index) => <label key={column.id}>{column.name}<input value={column.expression} aria-label={`Formula for ${column.name}`} onChange={(event) => updateCalculated(index, { expression: event.target.value })} /><small>Use aliases: {aliases.slice(0, block.columns.length + index).join(", ")}</small></label>)}</div>}<div className="note-data-controls"><label>Chart<select value={block.chart} onChange={(event) => onReplace({ chart: event.target.value as Extract<NoteBlock, { type: "data" }>["chart"] })}><option value="scatter">Scatter</option><option value="line">Line</option><option value="histogram">Histogram</option><option value="boxplot">Boxplot</option><option value="summary">Summary</option><option value="regression">Regression</option></select></label><label>X column<select value={xColumn} onChange={(event) => onReplace({ xColumn: Number(event.target.value) })}>{allColumns.map((column, index) => <option key={index} value={index}>{column}</option>)}</select></label><label>Y column<select value={yColumn} onChange={(event) => onReplace({ yColumn: Number(event.target.value) })}>{allColumns.map((column, index) => <option key={index} value={index}>{column}</option>)}</select></label>{summary && <span>n={summary.count} · mean={summary.mean?.toFixed(3) ?? "—"} · median={summary.median?.toFixed(3) ?? "—"}</span>}{regression && <span>y={regression.slope.toFixed(3)}x + {regression.intercept.toFixed(3)} · R²={regression.rSquared.toFixed(3)}</span>}{block.chart === "histogram" && <span>{histogram(numbers).map((bin) => `${bin.start.toFixed(1)}–${bin.end.toFixed(1)} (${bin.count})`).join(" · ")}</span>}{block.chart === "boxplot" && <span>{boxplot(numbers) && `min ${boxplot(numbers)!.min} · median ${boxplot(numbers)!.median} · max ${boxplot(numbers)!.max}`}</span>}</div>{block.chart !== "summary" && <DataPlot block={block} points={points} regression={regression} values={numbers} />}</div>;
}

function DataPlot({ block, points, regression, values }: { block: Extract<NoteBlock, { type: "data" }>; points: Array<{ x: number; y: number }>; regression: ReturnType<typeof linearRegression>; values: number[] }) {
  const width = 520, height = 220, pad = 24;
  const finiteX = points.map((point) => point.x).filter(Number.isFinite);
  const finiteY = points.map((point) => point.y).filter(Number.isFinite);
  const xMin = Math.min(...finiteX, 0), xMax = Math.max(...finiteX, 1), yMin = Math.min(...finiteY, 0), yMax = Math.max(...finiteY, 1);
  const sx = (value: number) => pad + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * (width - pad * 2);
  const sy = (value: number) => height - pad - ((value - yMin) / Math.max(1e-9, yMax - yMin)) * (height - pad * 2);
  if (block.chart === "histogram") {
    const bins = histogram(values);
    const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
    return <div className="data-plot"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Histogram"><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />{bins.map((bin, index) => <rect key={index} x={pad + (index / Math.max(1, bins.length)) * (width - pad * 2)} y={height - pad - (bin.count / maxCount) * (height - pad * 2)} width={(width - pad * 2) / Math.max(1, bins.length) - 2} height={(bin.count / maxCount) * (height - pad * 2)} />)}</svg></div>;
  }
  if (block.chart === "boxplot") {
    const box = boxplot(values);
    if (!box) return null;
    const scale = (value: number) => pad + ((value - box.min) / Math.max(1e-9, box.max - box.min)) * (width - pad * 2);
    return <div className="data-plot"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Boxplot"><line x1={scale(box.min)} y1={height / 2} x2={scale(box.max)} y2={height / 2} /><line x1={scale(box.min)} y1={height / 2 - 24} x2={scale(box.min)} y2={height / 2 + 24} /><line x1={scale(box.max)} y1={height / 2 - 24} x2={scale(box.max)} y2={height / 2 + 24} /><rect x={scale(box.q1)} y={height / 2 - 34} width={Math.max(2, scale(box.q3) - scale(box.q1))} height={68} /><line x1={scale(box.median)} y1={height / 2 - 34} x2={scale(box.median)} y2={height / 2 + 34} /></svg></div>;
  }
  const line = points.slice().sort((left, right) => left.x - right.x).map((point) => `${sx(point.x).toFixed(2)},${sy(point.y).toFixed(2)}`).join(" ");
  return <div className="data-plot"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={block.chart === "line" ? "Line plot" : block.chart === "regression" ? "Regression plot" : "Scatterplot"}><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} /><line x1={pad} y1={pad} x2={pad} y2={height - pad} />{block.chart === "line" && <polyline points={line} fill="none" />}{block.chart !== "line" && points.map((point, index) => <circle key={index} cx={sx(point.x)} cy={sy(point.y)} r="4" />)}{regression && <line x1={sx(xMin)} y1={sy(regression.slope * xMin + regression.intercept)} x2={sx(xMax)} y2={sy(regression.slope * xMax + regression.intercept)} />}</svg></div>;
}

function GraphBlock({ block, mathBlocks, onFocus, onReplace }: { block: Extract<NoteBlock, { type: "graph" }>; mathBlocks: Array<Extract<NoteBlock, { type: "math" }>>; onFocus: () => void; onReplace: (update: Partial<NoteBlock>) => void }) {
  const width = 520, height = 260;
  const scope = block.scope ?? {};
  const linkedMath = mathBlocks.find((item) => item.id === block.sourceBlockId);
  const linkedEvaluation = linkedMath?.expression
    ? evaluateExpressions(linkedMath.expression.split(/\r?\n/))
    : { values: [], scope: {} };
  const linkedExpression = linkedEvaluation.values.at(-1)?.expression;
  // A linked graph derives its first expression and variables from the math
  // block on every render. The persisted graph expression remains as a
  // fallback for legacy documents and for graphs without a link.
  const expressions = block.expressions.map((item, index) =>
    index === 0 && linkedExpression ? { ...item, expression: linkedExpression } : item,
  );
  const effectiveScope = { ...linkedEvaluation.scope, ...scope };
  const xAxis = height - ((0 - block.viewport.yMin) / (block.viewport.yMax - block.viewport.yMin)) * height;
  const yAxis = ((0 - block.viewport.xMin) / (block.viewport.xMax - block.viewport.xMin)) * width;
  const trace = block.traceX === null ? [] : expressions.filter((item) => item.visible).map((item) => ({ item, result: evaluateExpression(item.expression, { ...effectiveScope, x: block.traceX }) }));
  const visible = expressions.filter((item) => item.visible);
  const rootValues = visible.length ? roots(visible[0]!.expression, block.viewport, effectiveScope) : [];
  const crossingValues = visible.length > 1 ? intersections(visible[0]!.expression, visible[1]!.expression, block.viewport, effectiveScope) : [];
  function addParameter() {
    const name = ["a", "b", "c", "d"].find((candidate) => !(candidate in scope)) ?? `p${Object.keys(scope).length + 1}`;
    onReplace({ scope: { ...scope, [name]: 1 } });
  }
  return <div className="note-graph" onFocus={onFocus}><div className="graph-plot"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Linked live graph"><line x1={0} y1={Math.max(0, Math.min(height, xAxis))} x2={width} y2={Math.max(0, Math.min(height, xAxis))} /><line x1={Math.max(0, Math.min(width, yAxis))} y1={0} x2={Math.max(0, Math.min(width, yAxis))} y2={height} />{visible.map((item) => <path key={item.id} d={graphPath(sampleGraph(item.expression, block.viewport, 240, effectiveScope), block.viewport, width, height)} stroke={item.color} fill="none" strokeWidth="2" />)}{trace.map(({ item, result }) => result && <circle key={`trace-${item.id}`} cx={((block.traceX! - block.viewport.xMin) / (block.viewport.xMax - block.viewport.xMin)) * width} cy={height - ((result.value - block.viewport.yMin) / (block.viewport.yMax - block.viewport.yMin)) * height} r="4" fill={item.color} />)}</svg></div><div className="graph-expressions">{block.expressions.map((item, index) => <label key={item.id}><input type="color" value={item.color} aria-label={`Color for graph expression ${index + 1}`} onChange={(event) => { const nextExpressions = block.expressions.map((candidate) => candidate.id === item.id ? { ...candidate, color: event.target.value } : candidate); onReplace({ expressions: nextExpressions }); }} /><input value={index === 0 && linkedExpression ? linkedExpression : item.expression} aria-label={`Graph expression ${index + 1}`} readOnly={index === 0 && Boolean(linkedExpression)} onChange={(event) => { const nextExpressions = block.expressions.map((candidate) => candidate.id === item.id ? { ...candidate, expression: event.target.value } : candidate); onReplace({ expressions: nextExpressions }); }} /><input type="checkbox" aria-label={`Show graph expression ${index + 1}`} checked={item.visible} onChange={(event) => { const nextExpressions = block.expressions.map((candidate) => candidate.id === item.id ? { ...candidate, visible: event.target.checked } : candidate); onReplace({ expressions: nextExpressions }); }} /></label>)}{mathBlocks.length > 0 && <label>Linked math<select value={block.sourceBlockId ?? ""} onChange={(event) => { const sourceBlockId = event.target.value || undefined; const expression = mathBlocks.find((item) => item.id === sourceBlockId)?.expression?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1); onReplace({ sourceBlockId, ...(expression ? { expressions: block.expressions.map((item, index) => index === 0 ? { ...item, expression } : item) } : {}) }); }}><option value="">Manual expression</option>{mathBlocks.map((item) => <option key={item.id} value={item.id}>{item.latex.slice(0, 44)}</option>)}</select></label>}{linkedExpression && <span className="muted">linked: {linkedExpression}</span>}<button type="button" onClick={() => onReplace({ expressions: [...block.expressions, { id: newId(), expression: "sin(x)", color: "#50705a", visible: true }] })}>＋ Function</button><label>Trace x<input type="number" value={block.traceX ?? ""} onChange={(event) => onReplace({ traceX: event.target.value === "" ? null : Number(event.target.value) })} /><input type="range" min={block.viewport.xMin} max={block.viewport.xMax} step={(block.viewport.xMax - block.viewport.xMin) / 200} value={block.traceX ?? 0} aria-label="Trace x scrubber" onChange={(event) => onReplace({ traceX: Number(event.target.value) })} /></label><button type="button" onClick={() => onReplace({ viewport: zoomViewport(block.viewport, 0.8) })}>Zoom in</button><button type="button" onClick={() => onReplace({ viewport: zoomViewport(block.viewport, 1.25) })}>Zoom out</button><button type="button" onClick={() => onReplace({ viewport: panViewport(block.viewport, -(block.viewport.xMax - block.viewport.xMin) * 0.1, 0) })}>←</button><button type="button" onClick={() => onReplace({ viewport: panViewport(block.viewport, (block.viewport.xMax - block.viewport.xMin) * 0.1, 0) })}>→</button><button type="button" onClick={() => onReplace({ viewport: panViewport(block.viewport, 0, (block.viewport.yMax - block.viewport.yMin) * 0.1) })}>↑</button><button type="button" onClick={() => onReplace({ viewport: panViewport(block.viewport, 0, -(block.viewport.yMax - block.viewport.yMin) * 0.1) })}>↓</button></div>{Object.keys(scope).length > 0 && <div className="graph-parameters"><span className="eyebrow">Parameters</span>{Object.entries(scope).map(([name, value]) => <label key={name}>{name}<input type="number" value={String(value)} onChange={(event) => onReplace({ scope: { ...scope, [name]: Number(event.target.value) } })} /></label>)}<button type="button" onClick={addParameter}>＋ Parameter</button></div>}{Object.keys(scope).length === 0 && <button type="button" className="graph-add-parameter" onClick={addParameter}>＋ Parameter</button>}{(rootValues.length > 0 || crossingValues.length > 0 || trace.length > 0) && <div className="graph-readout">{rootValues.length > 0 && <span>Roots: {rootValues.join(", ")}</span>}{crossingValues.length > 0 && <span>Intersections: {crossingValues.map((point) => `(${point.x.toFixed(3)}, ${point.y.toFixed(3)})`).join(" · ")}</span>}{trace.filter((item) => item.result).map(({ item, result }) => <span key={`readout-${item.id}`}>x={block.traceX}: {result?.display}</span>)}</div>}</div>;
}
