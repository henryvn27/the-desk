import { z } from "zod";
import { sourceProvenance, type SourceProvenance } from "../sources/provenance";

// Notes is a presentation layer over the shipped Canvas scene.  The block
// envelope is deliberately small: freeform work still belongs to Excalidraw,
// while keyboard authored material gets stable ids and predictable structure.
const blockId = z.string().min(1).max(120);
const text = z.string().max(200_000);
const indent = z.number().int().min(0).max(8).default(0);

const base = {
  id: blockId,
  /** Passage-level evidence survives inside the Note block that used it. */
  provenance: z.array(sourceProvenance).max(20).optional(),
};
const flowText = z.object({ ...base, type: z.literal("paragraph"), text });
const heading = z.object({
  ...base,
  type: z.literal("heading"),
  level: z.number().int().min(1).max(3),
  text: z.string().max(20_000),
});
const list = z.object({
  ...base,
  type: z.literal("list"),
  ordered: z.boolean(),
  indent,
  text: z.string().max(20_000),
});
const checkbox = z.object({
  ...base,
  type: z.literal("checkbox"),
  checked: z.boolean(),
  indent,
  text: z.string().max(20_000),
});
const code = z.object({
  ...base,
  type: z.literal("code"),
  language: z.string().trim().max(40).default("text"),
  text,
});
const mathResult = z.object({
  value: z.number().finite(),
  unit: z.string().trim().max(80).optional(),
  expression: z.string().trim().max(2_000),
});
const math = z.object({
  ...base,
  type: z.literal("math"),
  latex: z.string().trim().min(1).max(2_000),
  display: z.boolean(),
  expression: z.string().trim().max(2_000).optional(),
  suggestionMode: z.enum(["suggest", "insert", "off"]).default("suggest"),
  result: mathResult.optional(),
});
const tableCell = z.union([z.string().max(20_000), z.number().finite(), z.null()]);
const calculatedColumn = z.object({
  id: blockId,
  name: z.string().trim().min(1).max(200),
  expression: z.string().trim().min(1).max(2_000),
});
const table = z.object({
  ...base,
  type: z.literal("table"),
  columns: z.array(z.string().max(200)).min(1).max(50),
  rows: z.array(z.array(tableCell).max(50)).max(2_000),
});
const media = z.object({
  ...base,
  type: z.enum(["image", "file"]),
  fileId: z.string().min(1).max(120),
  name: z.string().trim().max(255),
  caption: z.string().max(2_000).optional(),
  captureId: blockId.optional(),
});

const noteCapture = z.object({
  id: blockId,
  kind: z.literal("paper"),
  originalFileId: blockId,
  cleanedFileId: blockId.optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  crop: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }).optional(),
  annotations: z.array(z.object({ id: blockId, text: z.string().trim().max(2_000) })).max(200).optional(),
  ocrText: text.optional(),
  handwritingText: text.optional(),
  mathExpressions: z.array(z.string().trim().max(2_000)).max(100).optional(),
  sourceId: blockId.optional(),
  capturedAt: z.string().datetime().optional(),
}).superRefine((capture, context) => {
  if (capture.crop && (capture.crop.x + capture.crop.width > 1 || capture.crop.y + capture.crop.height > 1))
    context.addIssue({ code: "custom", path: ["crop"], message: "A capture region must stay within the original page." });
});
export type NoteCapture = z.infer<typeof noteCapture>;

const recordingEvent = z.object({
  id: blockId,
  atMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  blockId: blockId.optional(),
  label: z.string().trim().max(200).optional(),
});
const transcriptSegment = z.object({
  id: blockId,
  startMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  endMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  text: z.string().max(20_000),
  blockId: blockId.optional(),
}).superRefine((segment, context) => {
  if (segment.endMs < segment.startMs)
    context.addIssue({ code: "custom", path: ["endMs"], message: "Transcript segments must be ordered." });
});
const noteRecording = z.object({
  id: blockId,
  status: z.enum(["recording", "complete", "interrupted", "failed"]),
  sessionId: blockId.optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  chunkCount: z.number().int().min(0).max(100_000),
  mimeType: z.string().trim().max(80).default("audio/webm"),
  transcript: z.array(transcriptSegment).max(10_000).optional(),
  events: z.array(recordingEvent).max(10_000).optional(),
  error: z.string().trim().max(500).optional(),
});
export type NoteRecording = z.infer<typeof noteRecording>;
const freeform = z.object({
  ...base,
  type: z.literal("freeform"),
  regionId: z.string().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  collapsed: z.boolean(),
});
const graphExpression = z.object({
  id: blockId,
  expression: z.string().trim().min(1).max(2_000),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  visible: z.boolean(),
});
const graph = z.object({
  ...base,
  type: z.literal("graph"),
  sourceBlockId: blockId.optional(),
  expressions: z.array(graphExpression).min(1).max(12),
  scope: z.record(z.string().trim().min(1).max(80), z.number().finite()).optional(),
  viewport: z.object({
    xMin: z.number().finite(),
    xMax: z.number().finite(),
    yMin: z.number().finite(),
    yMax: z.number().finite(),
  }),
  traceX: z.number().finite().nullable(),
}).superRefine((value, context) => {
  if (value.viewport.xMax <= value.viewport.xMin)
    context.addIssue({ code: "custom", path: ["viewport", "xMax"], message: "Graph x range must increase." });
  if (value.viewport.yMax <= value.viewport.yMin)
    context.addIssue({ code: "custom", path: ["viewport", "yMax"], message: "Graph y range must increase." });
  if (value.traceX !== null && (value.traceX < value.viewport.xMin || value.traceX > value.viewport.xMax))
    context.addIssue({ code: "custom", path: ["traceX"], message: "Trace x must stay inside the graph viewport." });
});
const data = z.object({
  ...base,
  type: z.literal("data"),
  columns: z.array(z.string().max(200)).min(1).max(50),
  rows: z.array(z.array(tableCell).max(50)).max(10_000),
  chart: z.enum(["scatter", "line", "histogram", "boxplot", "summary", "regression"]),
  calculatedColumns: z.array(calculatedColumn).max(20).optional(),
  xColumn: z.number().int().min(0).nullable(),
  yColumn: z.number().int().min(0).nullable(),
}).superRefine((value, context) => {
  for (const [index, row] of value.rows.entries())
    if (row.length !== value.columns.length)
      context.addIssue({ code: "custom", path: ["rows", index], message: "Each data row must match the column count." });
  const calculated = value.calculatedColumns ?? [];
  if (new Set(calculated.map((column) => column.id)).size !== calculated.length)
    context.addIssue({ code: "custom", path: ["calculatedColumns"], message: "Calculated column IDs must be unique." });
  const columnCount = value.columns.length + calculated.length;
  for (const [key, column] of [["xColumn", value.xColumn], ["yColumn", value.yColumn]] as const)
    if (column !== null && column >= columnCount)
      context.addIssue({ code: "custom", path: [key], message: "Choose an existing data column." });
});
const noteProvenance = z.object({
  origin: z.enum(["student", "capture", "recording", "lens", "enhanced"]).default("student"),
  sourceIds: z.array(blockId).max(100).optional(),
  recordingIds: z.array(blockId).max(100).optional(),
  createdAt: z.string().datetime().optional(),
  basis: z.string().trim().max(500).optional(),
});

export const noteBlock = z.discriminatedUnion("type", [
  flowText,
  heading,
  list,
  checkbox,
  code,
  math,
  table,
  media,
  freeform,
  graph,
  data,
]);
export type NoteBlock = z.infer<typeof noteBlock>;
export type NoteBlockProvenance = SourceProvenance;

export function sourceExcerptBlock(
  excerpt: string,
  provenance: SourceProvenance,
): Extract<NoteBlock, { type: "paragraph" }> {
  return noteBlock.parse({
    id: crypto.randomUUID(),
    type: "paragraph",
    text: excerpt,
    provenance: [provenance],
  }) as Extract<NoteBlock, { type: "paragraph" }>;
}

export const noteDocument = z.object({
  version: z.literal(1),
  blocks: z.array(noteBlock).max(2_000),
  provenance: noteProvenance.optional(),
  captures: z.array(noteCapture).max(200).optional(),
  recordings: z.array(noteRecording).max(200).optional(),
});
export type NoteDocument = z.infer<typeof noteDocument>;

export const emptyNoteDocument = (): NoteDocument => ({
  version: 1,
  blocks: [{ id: crypto.randomUUID(), type: "paragraph", text: "" }],
});

export function ensureNoteDocument(value: unknown): NoteDocument {
  const parsed = noteDocument.safeParse(value);
  return parsed.success ? parsed.data : emptyNoteDocument();
}

export function updateNoteBlock(
  document: NoteDocument,
  id: string,
  update: Partial<NoteBlock>,
): NoteDocument {
  const blocks = document.blocks.map((block) =>
    block.id === id
      ? noteBlock.parse({ ...block, ...update })
      : block,
  );
  if (!blocks.some((block) => block.id === id))
    throw Error("The note block no longer exists.");
  return noteDocument.parse({ ...document, blocks });
}

export function insertNoteBlock(
  document: NoteDocument,
  afterId: string | null,
  block: NoteBlock,
): NoteDocument {
  if (document.blocks.some((item) => item.id === block.id))
    throw Error("Note block IDs must be unique.");
  const index = afterId
    ? document.blocks.findIndex((item) => item.id === afterId)
    : -1;
  if (afterId && index < 0) throw Error("The note block no longer exists.");
  const blocks = [...document.blocks];
  blocks.splice(index + 1, 0, block);
  return noteDocument.parse({ ...document, blocks });
}

export function removeNoteBlock(document: NoteDocument, id: string): NoteDocument {
  const blocks = document.blocks.filter((block) => block.id !== id);
  return noteDocument.parse({
    ...document,
    blocks: blocks.length ? blocks : [{ id: crypto.randomUUID(), type: "paragraph", text: "" }],
  });
}

/** Convert the shortcuts students naturally type at the start of a line. */
export function markdownShortcut(
  block: Extract<NoteBlock, { type: "paragraph" }>,
): NoteBlock {
  const value = block.text;
  const headingMatch = /^(#{1,3})\s+(.+)$/.exec(value);
  if (headingMatch)
    return { id: block.id, type: "heading", level: headingMatch[1]!.length, text: headingMatch[2]! };
  const checkboxMatch = /^\[([ xX])\]\s+(.+)$/.exec(value);
  if (checkboxMatch)
    return { id: block.id, type: "checkbox", checked: checkboxMatch[1]!.toLowerCase() === "x", indent: 0, text: checkboxMatch[2]! };
  const unordered = /^[-*+]\s+(.+)$/.exec(value);
  if (unordered)
    return { id: block.id, type: "list", ordered: false, indent: 0, text: unordered[1]! };
  const ordered = /^(\d+)\.\s+(.+)$/.exec(value);
  if (ordered)
    return { id: block.id, type: "list", ordered: true, indent: 0, text: ordered[2]! };
  if (value.startsWith("```"))
    return { id: block.id, type: "code", language: value.slice(3).trim() || "text", text: "" };
  return block;
}

export function noteDocumentText(document: NoteDocument): string {
  const blocks = document.blocks
    .map((block) => {
      switch (block.type) {
        case "paragraph":
        case "heading":
        case "list":
        case "checkbox":
        case "code":
          return block.text;
        case "math":
          return [block.latex, block.expression, block.result?.expression, block.result?.unit].filter(Boolean).join(" ");
        case "table":
          return [block.columns.join(" "), ...block.rows.flat().map((cell) => cell === null ? "" : String(cell))].join(" ");
        case "data":
          return [block.columns.join(" "), ...(block.calculatedColumns ?? []).flatMap((column) => [column.name, column.expression]), ...block.rows.flat().map((cell) => cell === null ? "" : String(cell))].join(" ");
        case "image":
        case "file":
          return [block.name, block.caption].filter(Boolean).join(" ");
        case "freeform":
          return block.title;
        case "graph":
          return block.expressions.map((item) => item.expression).join(" ");
      }
    })
    .join("\n");
  const captures = (document.captures ?? []).flatMap((capture) => [capture.ocrText, capture.handwritingText, ...(capture.annotations ?? []).map((annotation) => annotation.text), ...(capture.mathExpressions ?? [])]).filter(Boolean).join("\n");
  const transcript = (document.recordings ?? []).flatMap((recording) => (recording.transcript ?? []).map((segment) => segment.text)).join("\n");
  return [blocks, captures, transcript].filter(Boolean).join("\n").trim();
}

export function updateNoteRecording(
  document: NoteDocument,
  id: string,
  update: Partial<NoteRecording>,
): NoteDocument {
  const recordings = (document.recordings ?? []).map((recording) =>
    recording.id === id ? noteRecording.parse({ ...recording, ...update }) : recording,
  );
  if (!recordings.some((recording) => recording.id === id))
    throw Error("The note recording no longer exists.");
  return noteDocument.parse({ ...document, recordings });
}

/** Attach a timestamped edit marker while a Note recording is active. */
export function appendNoteEditEvent(
  document: NoteDocument,
  recordingId: string,
  blockId: string,
  atMs: number,
): NoteDocument {
  const recording = document.recordings?.find((item) => item.id === recordingId);
  if (!recording || recording.status !== "recording" || (recording.events?.length ?? 0) >= 10_000)
    return document;
  return updateNoteRecording(document, recordingId, {
    events: [...(recording.events ?? []), { id: crypto.randomUUID(), atMs, blockId, label: "Note edit" }],
  });
}

export function noteHeadings(document: NoteDocument) {
  return document.blocks.filter(
    (block): block is Extract<NoteBlock, { type: "heading" }> => block.type === "heading",
  );
}
