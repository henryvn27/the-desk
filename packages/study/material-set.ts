import { createHash } from "node:crypto";
import type { CanvasRecord, Snapshot, Source } from "../domain/contracts";
import type { CanvasScene } from "../canvas/scene";
import { noteDocumentText } from "../canvas/notes";
import {
  studyMaterialRequestSchema,
  studyMaterialSetSchema,
  type StudyMaterialRequest,
  type StudyMaterialSet,
} from "./notebook-types";

type NoteRecord = Pick<CanvasRecord, "id" | "classId" | "taskId" | "title" | "revision" | "scene">;

function noteText(scene: CanvasScene) {
  const chunks: string[] = [];
  if (scene.document) chunks.push(noteDocumentText(scene.document));
  for (const page of scene.notebook?.pages ?? []) {
    for (const element of page.elements) {
      if (element.type === "text" && typeof element.text === "string") chunks.push(element.text);
      const math = element.customData?.deskMath;
      if (math && typeof math === "object" && "latex" in math && typeof math.latex === "string") chunks.push(math.latex);
    }
  }
  return chunks.join("\n").replace(/\s+/g, " ").trim();
}

function stableFingerprint(sources: Source[], notes: NoteRecord[]) {
  const material = [
    ...sources
      .map((source) => `${source.id}:${source.revision ?? 0}:${createHash("sha256").update(source.text).digest("hex")}`)
      .sort(),
    ...notes
      .map((note) => `${note.id}:${note.revision}:${createHash("sha256").update(noteText(note.scene)).digest("hex")}`)
      .sort(),
  ].join("|");
  return createHash("sha256").update(material || "empty").digest("hex");
}

function sourceScore(source: Source, request: StudyMaterialRequest, classId: string | null, taskIds: Set<string>) {
  let score = 0;
  if (request.sourceIds?.includes(source.id)) score += 100;
  if (source.taskIds.some((id) => taskIds.has(id))) score += 40;
  if (classId && source.classIds.includes(classId)) score += 20;
  if (classId && source.kind === "class-material") score += 4;
  return score;
}

/**
 * Resolve a small, explainable set over canonical Desk material. The resolver
 * deliberately returns references and a fingerprint; it never copies content
 * into a second persistent store.
 */
export function resolveStudyMaterialSet(
  snapshot: Snapshot,
  request: StudyMaterialRequest,
  notes: NoteRecord[] = [],
): Omit<StudyMaterialSet, "id" | "createdAt" | "updatedAt" | "revision"> {
  const parsed = studyMaterialRequestSchema.parse(request);
  const assessment = parsed.assessmentId
    ? snapshot.assessments.find((candidate) => candidate.id === parsed.assessmentId)
    : undefined;
  if (parsed.assessmentId && !assessment) throw Error("That assessment is no longer available.");
  const task = parsed.taskId ? snapshot.tasks.find((candidate) => candidate.id === parsed.taskId) : undefined;
  if (parsed.taskId && !task) throw Error("That assignment is no longer available.");
  const classId = parsed.classId ?? assessment?.classId ?? task?.classId ?? null;
  if (classId && !snapshot.classes.some((course) => course.id === classId)) throw Error("That class is no longer available.");
  if (assessment && classId !== assessment.classId) throw Error("The assessment does not belong to the selected class.");
  if (task && classId !== task.classId) throw Error("The assignment does not belong to the selected class.");

  const assessmentTaskIds = new Set([...(assessment?.taskIds ?? []), ...(task ? [task.id] : [])]);
  const requestedSources = new Set(parsed.sourceIds ?? []);
  const sourceCandidates = parsed.sourceIds?.length
    ? snapshot.sources.filter((source) => requestedSources.has(source.id))
    : snapshot.sources.filter((source) => sourceScore(source, parsed, classId, assessmentTaskIds) > 0);
  const sourceIds = sourceCandidates
    .sort((a, b) => sourceScore(b, parsed, classId, assessmentTaskIds) - sourceScore(a, parsed, classId, assessmentTaskIds) || a.title.localeCompare(b.title))
    .slice(0, 100)
    .map((source) => source.id);
  for (const sourceId of requestedSources) {
    if (!snapshot.sources.some((source) => source.id === sourceId)) throw Error("One selected Source is no longer available.");
  }

  const explicitNotes = new Set(parsed.noteIds ?? []);
  const noteCandidates = parsed.noteIds?.length
    ? notes.filter((note) => explicitNotes.has(note.id))
    : notes.filter((note) => Boolean(
        (classId && note.classId === classId) ||
        (assessmentTaskIds.size && note.taskId && assessmentTaskIds.has(note.taskId)),
      ));
  const noteIds = noteCandidates
    .sort((a, b) => Number(explicitNotes.has(b.id)) - Number(explicitNotes.has(a.id)) || a.title.localeCompare(b.title))
    .slice(0, 100)
    .map((note) => note.id);
  for (const noteId of explicitNotes) {
    if (!notes.some((note) => note.id === noteId)) throw Error("One selected Note is no longer available.");
  }

  const selectedSources = sourceIds.map((id) => snapshot.sources.find((source) => source.id === id)!).filter(Boolean);
  const selectedNotes = noteIds.map((id) => notes.find((note) => note.id === id)!).filter(Boolean);
  if (!selectedSources.length && !selectedNotes.length) throw Error("Add a Source or Note before generating study material.");
  const title = parsed.title?.trim() || assessment?.title || task?.title || (classId ? snapshot.classes.find((course) => course.id === classId)?.name : undefined) || "Desk study set";
  return {
    title,
    classId,
    assessmentId: assessment?.id ?? null,
    taskId: task?.id ?? (assessment?.taskIds[0] ?? null),
    sourceIds,
    noteIds,
    sourceFingerprint: stableFingerprint(selectedSources, selectedNotes),
    externalNotebookId: null,
    externalSourceIds: {},
    externalSourceFingerprints: {},
  };
}

export function materialSetFromInput(
  input: Omit<StudyMaterialSet, "id" | "createdAt" | "updatedAt" | "revision">,
  id: string,
  now = new Date(),
): StudyMaterialSet {
  return studyMaterialSetSchema.parse({
    ...input,
    id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 0,
  });
}

export function noteTextForStudy(note: NoteRecord) {
  return noteText(note.scene);
}
