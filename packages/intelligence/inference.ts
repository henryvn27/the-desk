import { z } from "zod";
import type { Assessment, Class, Task, Snapshot } from "../domain/contracts";
import { sourceLocation, type SourceLocation } from "../sources/provenance";
import {
  classifyCaptureText,
  interpretCapture,
  type CaptureConfidence,
  type CaptureDraft,
  type CaptureObjectType,
} from "./capture";

/** Bump when the deterministic extraction contract changes. */
export const INFERENCE_VERSION = "desk-inference-v1" as const;

export const inferenceSourceKind = z.enum([
  "capture",
  "source",
  "note",
  "browser",
  "session",
  "lens",
  "ai",
]);
export type InferenceSourceKind = z.infer<typeof inferenceSourceKind>;

export const inferenceConfidence = z.enum(["high", "medium", "low"]);
export type InferenceConfidence = z.infer<typeof inferenceConfidence>;

export const inferenceRequestSchema = z
  .object({
    sourceKind: inferenceSourceKind,
    sourceId: z.string().trim().min(1).max(200).optional(),
    sourceRevision: z.number().int().nonnegative().optional(),
    title: z.string().trim().max(500).optional(),
    text: z.string().trim().min(1).max(200_000),
    capturedAt: z.iso.datetime().optional(),
    location: sourceLocation.optional(),
    classId: z.string().uuid().optional(),
  })
  .strict();
export type InferenceRequest = z.infer<typeof inferenceRequestSchema>;

export type InferenceProvenance = {
  sourceKind: InferenceSourceKind;
  sourceId?: string;
  sourceRevision?: number;
  location?: SourceLocation;
  excerpt: string;
  capturedAt: string;
  authority: "user-provided" | "teacher-reported" | "desk-inference";
};

export type InferenceField<T> = {
  value: T | null;
  confidence: InferenceConfidence;
  provenance: InferenceProvenance[];
  basis: string[];
  inferredAt: string;
  inferenceVersion: typeof INFERENCE_VERSION;
  userConfirmed: boolean;
};

export type InferenceConflict = {
  field: "classId" | "dueAt" | "title" | "objectType";
  candidates: string[];
  reason: string;
};

export type AcademicInference = {
  version: typeof INFERENCE_VERSION;
  input: Pick<InferenceRequest, "sourceKind" | "sourceId" | "sourceRevision">;
  fields: {
    objectType: InferenceField<CaptureObjectType>;
    title: InferenceField<string>;
    classId: InferenceField<string>;
    dueAt: InferenceField<string>;
    concepts: InferenceField<string[]>;
    unit: InferenceField<string>;
    teacher: InferenceField<string>;
    assessmentKind: InferenceField<Assessment["kind"]>;
    resourceUrls: InferenceField<string[]>;
  };
  conflicts: InferenceConflict[];
  overallConfidence: InferenceConfidence;
  needsReview: boolean;
  explanation: string[];
  provider?: {
    attempted: boolean;
    applied: boolean;
    model?: string;
    reason?: string;
  };
};

export type InferenceContext = {
  classes: readonly Class[];
  now: Date;
  timeZone: string;
};

export type ProviderInferencePatch = {
  title?: string;
  className?: string;
  dueAt?: string | null;
  objectType?: CaptureObjectType;
  concepts?: string[];
  unit?: string;
  teacher?: string;
  assessmentKind?: Assessment["kind"];
};

const OBJECT_TYPES = new Set<CaptureObjectType>([
  "assignment",
  "syllabus",
  "worksheet",
  "graded-assessment",
  "rubric",
  "lecture-slide",
  "handwritten-note",
  "timetable",
  "teacher-message",
  "web-page",
  "unknown",
]);

const assessmentKinds = new Set<Assessment["kind"]>([
  "quiz",
  "test",
  "exam",
  "final",
  "midterm",
  "project",
  "essay",
  "lab",
  "presentation",
  "standardized-test",
  "other",
]);

function excerpt(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 1_200);
}

function nowIso(now: Date) {
  if (!Number.isFinite(+now)) throw new RangeError("Invalid inference time.");
  return now.toISOString();
}

function confidence(value: CaptureConfidence | undefined): InferenceConfidence {
  return value ?? "low";
}

function field<T>(
  value: T | null,
  confidenceValue: InferenceConfidence,
  provenance: InferenceProvenance,
  basis: string[],
  inferredAt: string,
  userConfirmed = false,
): InferenceField<T> {
  return {
    value,
    confidence: confidenceValue,
    provenance: [provenance],
    basis,
    inferredAt,
    inferenceVersion: INFERENCE_VERSION,
    userConfirmed,
  };
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2));
}

function rankClasses(text: string, classes: readonly Class[]) {
  const input = normalize(text);
  const inputTokens = tokens(text);
  return classes
    .map((course) => {
      const name = normalize(course.name);
      const nameTokens = [...tokens(course.name)];
      const overlap = nameTokens.filter((token) => inputTokens.has(token)).length;
      const score = input.includes(name)
        ? 1_000 + name.length
        : nameTokens.length && overlap / nameTokens.length >= 0.5
          ? overlap / nameTokens.length
          : 0;
      return { course, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.course.name.localeCompare(b.course.name));
}

function extractConcepts(text: string) {
  const values = new Set<string>();
  const add = (value: string) => {
    const cleaned = value.replace(/^[\s:#-]+|[\s,.;]+$/g, "").trim();
    if (cleaned.length >= 2 && cleaned.length <= 140) values.add(cleaned);
  };
  for (const match of text.matchAll(/\b(?:concept|topic|topics|chapter|unit|module)\s*[:-]\s*([^\n]+)/gi))
    add(match[1] ?? "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(?:#{1,3}\s+|\d+(?:\.\d+)*[.)]\s+|[A-Z][A-Z\s&/-]{4,})/.test(trimmed))
      add(trimmed.replace(/^#{1,3}\s+|^\d+(?:\.\d+)*[.)]\s+/, ""));
  }
  return [...values].slice(0, 12);
}

function extractUnit(text: string) {
  const match = /\b(?:unit|module|chapter)(?:\s*(?:\d+[A-Za-z]?|[A-Z][A-Za-z0-9-]*))?\s*[:-]\s*([^\n,.;]{2,100})/i.exec(text);
  return match?.[1]?.trim() ?? null;
}

function extractTeacher(text: string) {
  const match = /\b(?:teacher|professor|instructor|from)\s*[:-]?\s*([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3})/u.exec(text);
  return match?.[1]?.trim() ?? null;
}

function extractAssessmentKind(text: string, objectType: CaptureObjectType): Assessment["kind"] | null {
  const normalized = text.toLocaleLowerCase("en-US");
  if (objectType === "graded-assessment" || /\bgraded\s+(?:test|quiz|exam)\b/.test(normalized)) {
    if (/\bfinal\b/.test(normalized)) return "final";
    if (/\bmidterm\b/.test(normalized)) return "midterm";
    if (/\bexam\b/.test(normalized)) return "exam";
    if (/\btest\b/.test(normalized)) return "test";
    return "quiz";
  }
  for (const kind of ["final", "midterm", "exam", "test", "quiz", "project", "essay", "lab", "presentation"] as const)
    if (new RegExp(`\\b${kind}\\b`, "i").test(normalized)) return kind;
  return null;
}

function overall(fields: AcademicInference["fields"]): InferenceConfidence {
  const values = Object.values(fields);
  if (values.every((item) => item.confidence === "high" || item.value === null)) return "high";
  if (values.some((item) => item.confidence === "low" && item.value !== null)) return "low";
  return "medium";
}

function provenanceFor(request: InferenceRequest, capturedAt: string): InferenceProvenance {
  return {
    sourceKind: request.sourceKind,
    ...(request.sourceId ? { sourceId: request.sourceId } : {}),
    ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}),
    ...(request.location ? { location: request.location } : {}),
    excerpt: excerpt(request.text),
    capturedAt,
    authority: request.sourceKind === "session" ? "teacher-reported" : "user-provided",
  };
}

/** Deterministic first pass shared by Capture, browser context, Notes and Lens. */
export function inferAcademic(
  rawRequest: InferenceRequest,
  context: InferenceContext,
): AcademicInference {
  const request = inferenceRequestSchema.parse(rawRequest);
  const capturedAt = request.capturedAt ?? nowIso(context.now);
  const provenance = provenanceFor(request, capturedAt);
  const fullText = [request.title, request.text].filter(Boolean).join("\n");
  const object = classifyCaptureText(fullText, request.sourceId);
  const drafts = interpretCapture(request.text, {
    classes: context.classes,
    now: context.now,
    timeZone: context.timeZone,
    ...(request.title ? { sourceName: request.title } : {}),
    ...(request.classId ? { contextClassId: request.classId } : {}),
  });
  const draft = drafts[0];
  const ranked = rankClasses(fullText, context.classes);
  const bestClass = request.classId
    ? context.classes.find((course) => course.id === request.classId)
    : ranked[0]?.course;
  const tiedClasses = ranked.filter((candidate) => candidate.score === ranked[0]?.score);
  const classConflict = tiedClasses.length > 1;
  const classConfidence = request.classId
    ? "high"
    : bestClass && !classConflict
      ? ranked[0]!.score >= 1_000
        ? "high"
        : "medium"
      : "low";
  const dueAt = draft?.deadline?.instant ?? null;
  const dueConfidence = draft?.deadline
    ? draft.deadline.requiresConfirmation || !draft.deadline.instant
      ? "medium"
      : "high"
    : "low";
  const title = draft?.title || request.title?.trim() || null;
  const concepts = extractConcepts(request.text);
  const unit = extractUnit(request.text);
  const teacher = extractTeacher(request.text);
  const assessmentKind = extractAssessmentKind(request.text, draft?.objectType ?? object.type);
  const urls = [...request.text.matchAll(/https?:\/\/[^\s<>"]+/gi)].map((match) => match[0]!.replace(/[),.;]+$/, "")).slice(0, 20);
  const fields = {
    objectType: field(object.type, confidence(object.confidence), provenance, [`Matched ${object.type} markers in the title and text.`], capturedAt),
    title: field(title, title ? "high" : "low", provenance, title ? ["Derived from the first actionable line."] : ["No stable title was present."], capturedAt),
    classId: field(classConflict ? null : bestClass?.id ?? null, classConfidence, provenance, bestClass && !classConflict ? [`Matched ${bestClass.name} against the capture.`] : ["No unique class match was found."], capturedAt),
    dueAt: field(dueAt, dueConfidence, provenance, dueAt ? [draft?.deadline?.sourceText.join(" ") ?? "Explicit deadline evidence."] : ["No canonical timestamp was present."], capturedAt),
    concepts: field(concepts, concepts.length ? "medium" : "low", provenance, concepts.length ? ["Extracted headings and explicit topic labels."] : ["No explicit concept labels were found."], capturedAt),
    unit: field(unit, unit ? "medium" : "low", provenance, unit ? ["Matched a unit, module, or chapter label."] : ["No unit label was found."], capturedAt),
    teacher: field(teacher, teacher ? "medium" : "low", provenance, teacher ? ["Matched a teacher or instructor label."] : ["No teacher label was found."], capturedAt),
    assessmentKind: field(assessmentKind, assessmentKind ? "medium" : "low", provenance, assessmentKind ? ["Matched an assessment marker."] : ["No assessment marker was found."], capturedAt),
    resourceUrls: field(urls, urls.length ? "high" : "low", provenance, urls.length ? ["Extracted HTTPS resource links without fetching them."] : ["No resource link was present."], capturedAt),
  } satisfies AcademicInference["fields"];
  const conflicts: InferenceConflict[] = [];
  if (classConflict) conflicts.push({ field: "classId", candidates: tiedClasses.map((candidate) => candidate.course.name), reason: "Multiple classes matched equally; no class was silently selected." });
  if (draft?.deadline?.candidates && draft.deadline.candidates.length > 1)
    conflicts.push({ field: "dueAt", candidates: draft.deadline.candidates, reason: "The source contains more than one plausible deadline." });
  const explanation = [
    ...fields.objectType.basis,
    fields.classId.value ? `Class link is ${fields.classId.confidence}-confidence.` : "Class routing needs review.",
    fields.dueAt.value ? `Deadline evidence is ${fields.dueAt.confidence}-confidence and remains source-relative.` : "No deadline was invented.",
  ];
  const result: AcademicInference = {
    version: INFERENCE_VERSION,
    input: {
      sourceKind: request.sourceKind,
      ...(request.sourceId ? { sourceId: request.sourceId } : {}),
      ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}),
    },
    fields,
    conflicts,
    overallConfidence: overall(fields),
    needsReview:
      conflicts.length > 0 ||
      [fields.objectType, fields.title, fields.classId, fields.dueAt].some(
        (item) => item.value === null || item.confidence === "low",
      ),
    explanation,
  };
  return result;
}

/** Expensive inference is reserved for ambiguity the deterministic pass cannot resolve. */
export function shouldEscalateInference(result: AcademicInference) {
  return result.conflicts.length > 0 || [result.fields.classId, result.fields.dueAt, result.fields.objectType]
    .some((item) => item.value === null || item.confidence === "low");
}

function chooseClass(className: string | undefined, classes: readonly Class[]) {
  if (!className) return null;
  const ranked = rankClasses(className, classes);
  return ranked.length === 1 || ranked[0]?.score !== ranked[1]?.score ? ranked[0]?.course ?? null : null;
}

function replaceField<T>(base: InferenceField<T>, value: T, confidenceValue: InferenceConfidence, basis: string, provenance: InferenceProvenance) {
  if (base.userConfirmed || (base.value !== null && base.confidence === "high")) return base;
  return { ...base, value, confidence: confidenceValue, basis: [...base.basis, basis], provenance: [...base.provenance, provenance], userConfirmed: false };
}

/** Applies only non-conflicting, non-authoritative model suggestions. */
export function applyProviderPatch(
  base: AcademicInference,
  patch: ProviderInferencePatch,
  request: InferenceRequest,
  classes: readonly Class[],
  model = "openrouter",
): AcademicInference {
  const provider: InferenceProvenance = {
    sourceKind: "ai",
    ...(request.sourceId ? { sourceId: request.sourceId } : {}),
    ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}),
    excerpt: `AI suggestion from ${model}`,
    capturedAt: new Date().toISOString(),
    authority: "desk-inference",
  };
  const fields = { ...base.fields };
  if (patch.title?.trim()) fields.title = replaceField(fields.title, patch.title.trim(), "medium", "AI clarified the title; confirm before filing.", provider);
  if (patch.objectType && OBJECT_TYPES.has(patch.objectType)) fields.objectType = replaceField(fields.objectType, patch.objectType, "medium", "AI classified an ambiguous object; confirm before filing.", provider);
  const classMatch = chooseClass(patch.className, classes);
  if (classMatch) fields.classId = replaceField(fields.classId, classMatch.id, "medium", `AI matched the class name ${classMatch.name}; confirm the route.`, provider);
  if (patch.dueAt !== undefined && patch.dueAt !== null && Number.isFinite(Date.parse(patch.dueAt))) fields.dueAt = replaceField(fields.dueAt, patch.dueAt, "medium", "AI proposed a timestamp from ambiguous text; confirm the source evidence.", provider);
  if (patch.concepts?.length) fields.concepts = replaceField(fields.concepts, [...new Set(patch.concepts.map((value) => value.trim()).filter(Boolean))].slice(0, 12), "medium", "AI proposed concept labels for search and study linking; they do not create new concepts.", provider);
  if (patch.unit?.trim()) fields.unit = replaceField(fields.unit, patch.unit.trim(), "medium", "AI proposed a unit label; it does not create a new Unit.", provider);
  if (patch.teacher?.trim()) fields.teacher = replaceField(fields.teacher, patch.teacher.trim(), "medium", "AI proposed a teacher label; it does not create a new Teacher.", provider);
  if (patch.assessmentKind && assessmentKinds.has(patch.assessmentKind)) fields.assessmentKind = replaceField(fields.assessmentKind, patch.assessmentKind, "medium", "AI proposed an assessment kind; confirm against the source.", provider);
  const conflicts = base.conflicts.filter((conflict) => {
    if (conflict.field === "classId" && classMatch) return false;
    if (conflict.field === "dueAt" && patch.dueAt !== undefined) return false;
    return true;
  });
  return {
    ...base,
    fields,
    conflicts,
    overallConfidence: overall(fields),
    needsReview: true,
    explanation: [...base.explanation, "AI suggestions are marked as Desk inference and never overwrite high-confidence or user-confirmed evidence."],
    provider: {
      attempted: true,
      applied: JSON.stringify(fields) !== JSON.stringify(base.fields),
      model,
    },
  };
}

export function mergeInferenceIntoCaptureDraft(draft: CaptureDraft, result: AcademicInference): CaptureDraft {
  const classId = result.fields.classId.value;
  const dueAt = result.fields.dueAt.value;
  const deadline = dueAt
    ? {
        date: dueAt.slice(0, 10),
        time: dueAt.slice(11, 16),
        instant: dueAt,
        timeZone: draft.deadline?.timeZone ?? "UTC",
        candidates: [...(draft.deadline?.candidates ?? []), dueAt],
        sourceText: [...(draft.deadline?.sourceText ?? []), "Desk AI suggestion"],
        requiresConfirmation: true,
      }
    : draft.deadline;
  const nextUncertainties = [...draft.uncertainties];
  if (result.provider?.applied) nextUncertainties.push({ field: "title", message: "Desk AI suggestions were added. Confirm them before filing." });
  return {
    ...draft,
    title: draft.title || result.fields.title.value || "",
    classId: draft.classId ?? classId,
    objectType: draft.objectType === "unknown" ? result.fields.objectType.value ?? draft.objectType : draft.objectType,
    deadline,
    confidence: {
      ...draft.confidence,
      classId: draft.classId ? draft.confidence.classId : result.fields.classId.confidence,
      deadline: draft.deadline?.instant ? draft.confidence.deadline : result.fields.dueAt.confidence,
      objectType: draft.objectType !== "unknown" ? draft.confidence.objectType : result.fields.objectType.confidence,
    },
    uncertainties: nextUncertainties,
  };
}

export function inferenceFingerprint(result: AcademicInference) {
  // This fingerprint is for local reconciliation/deduplication, not security.
  // Keep the shared inference module browser-safe because Capture imports it.
  const input = JSON.stringify(result);
  const seeds = [
    0x811c9dc5,
    0x9e3779b1,
    0x85ebca6b,
    0xc2b2ae35,
    0x27d4eb2f,
    0x165667b1,
    0xd3a2646c,
    0xfd7046c5,
  ];
  return seeds
    .map((seed) => {
      let hash = seed >>> 0;
      for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    })
    .join("");
}

/** Existing user fields remain authoritative; this is a proposal, never a silent mutation. */
export function reconcileTaskInference(task: Task, result: AcademicInference) {
  const proposed: Partial<Pick<Task, "title" | "classId" | "dueAt" | "resource">> = {};
  const review: string[] = [];
  if (!task.title.trim() && result.fields.title.value) proposed.title = result.fields.title.value;
  if (!task.classId && result.fields.classId.value) proposed.classId = result.fields.classId.value;
  if (!task.dueAt && result.fields.dueAt.value) proposed.dueAt = result.fields.dueAt.value;
  if (!task.resource && result.fields.resourceUrls.value?.[0]) proposed.resource = result.fields.resourceUrls.value[0];
  if (proposed.dueAt) review.push("A new deadline was inferred; confirm it before changing the task.");
  if (proposed.classId) review.push("A class link was inferred; confirm the routing before saving.");
  if (result.needsReview || result.conflicts.length) review.push(...result.explanation, ...result.conflicts.map((conflict) => conflict.reason));
  return { proposed, requiresReview: review.length > 0, review: [...new Set(review)] };
}

/** Avoid importing the whole store in consumers that only need a bounded pass. */
export function inferenceForSnapshot(snapshot: Snapshot, request: InferenceRequest, now = new Date()) {
  return inferAcademic(request, { classes: snapshot.classes, now, timeZone: "UTC" });
}
