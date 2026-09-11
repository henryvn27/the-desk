import {
  studyArtifactType,
  studyEngineStatusSchema,
  studyFlashcardsPayloadSchema,
  studyQuizPayloadSchema,
  studyMediaPayloadSchema,
  type StudyArtifactType,
  type StudyEngineStatus,
  type StudyFlashcardsPayload,
  type StudyGenerationOptions,
  type StudyMaterialSet,
  type StudyMediaPayload,
  type StudyQuizPayload,
} from "./notebook-types";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_STRUCTURED_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_RESPONSE_BYTES = 50 * 1024 * 1024;

export type StudyMaterialContent = {
  id: string;
  title: string;
  text: string;
  kind: "source" | "note";
};

export type StudyEngineMaterial = StudyMaterialSet & {
  content: StudyMaterialContent[];
};

export type StudyGenerationResult = {
  status: "ready" | "generating" | "failed";
  externalNotebookId?: string;
  externalArtifactId?: string;
  payload?: StudyQuizPayload | StudyFlashcardsPayload | StudyMediaPayload;
  error?: string;
};

export interface NotebookStudyEngine {
  status(): Promise<StudyEngineStatus>;
  ensureMaterialSet(material: StudyEngineMaterial): Promise<Pick<StudyGenerationResult, "externalNotebookId"> & { externalSourceIds?: Record<string, string>; externalSourceFingerprints?: Record<string, string> }>;
  generate(
    material: StudyEngineMaterial,
    type: StudyArtifactType,
    options: StudyGenerationOptions,
  ): Promise<StudyGenerationResult>;
  /** Poll an external generation and, when complete, hydrate a Desk payload. */
  poll?(
    material: StudyEngineMaterial,
    type: StudyArtifactType,
    externalArtifactId: string,
  ): Promise<StudyGenerationResult>;
}

function status(value: StudyEngineStatus) {
  return studyEngineStatusSchema.parse(value);
}

function sourceExcerpt(material: StudyEngineMaterial, index: number) {
  const source = material.content[index % Math.max(1, material.content.length)];
  const text = source?.text.trim() || "the selected material";
  return text.slice(0, 240).replace(/\s+/g, " ");
}

function contentFingerprint(item: StudyEngineMaterial["content"][number]) {
  return createHash("sha256")
    .update(`${item.kind}\0${item.title}\0${item.text}`)
    .digest("hex");
}

/** Deterministic adapter used by unit/smoke tests and offline development. */
export class FakeNotebookStudyEngine implements NotebookStudyEngine {
  private counter = 0;

  async status() {
    return status({
      available: true,
      connected: true,
      experimental: true,
      message: "Using the deterministic local study engine.",
      capabilities: { quiz: true, flashcards: true, audio: true, video: true },
    });
  }

  async ensureMaterialSet(material: StudyEngineMaterial) {
    return {
      externalNotebookId: material.externalNotebookId ?? `fake-notebook-${material.id}`,
      externalSourceIds: Object.fromEntries(material.content.map((item) => [item.id, `fake-source-${item.id}`])),
      externalSourceFingerprints: Object.fromEntries(material.content.map((item) => [item.id, contentFingerprint(item)])),
    };
  }

  async generate(material: StudyEngineMaterial, type: StudyArtifactType, options: StudyGenerationOptions) {
    this.counter += 1;
    const notebookId = material.externalNotebookId ?? `fake-notebook-${material.id}`;
    if (type === "quiz") {
      const count = Math.min(50, Math.max(1, options.questionCount ?? 5));
      const questions = Array.from({ length: count }, (_, index) => ({
        id: `fake-q-${this.counter}-${index + 1}`,
        prompt: `Which statement is best supported by the selected material (${index + 1})?`,
        choices: [
          `The material mentions ${sourceExcerpt(material, index)}.`,
          "The material does not provide enough evidence for this claim.",
          "The material explicitly rejects every related idea.",
          "The material only discusses an unrelated topic.",
        ],
        answerIndex: 0,
        explanation: `This answer is grounded in ${material.content[index % material.content.length]?.title ?? "the selected material"}.`,
        sourceIds: material.content.filter((item) => item.kind === "source").slice(0, 3).map((item) => item.id),
        conceptIds: [],
      }));
      return {
        status: "ready" as const,
        externalNotebookId: notebookId,
        externalArtifactId: `fake-quiz-${this.counter}`,
        payload: studyQuizPayloadSchema.parse({
          kind: "quiz",
          questions,
          answers: [],
          currentIndex: 0,
          completedAt: null,
          score: null,
        }),
      };
    }
    if (type === "flashcards") {
      const count = Math.min(100, Math.max(1, options.questionCount ?? 12));
      const cards = Array.from({ length: count }, (_, index) => ({
        id: `fake-card-${this.counter}-${index + 1}`,
        front: `What should you remember from ${material.content[index % material.content.length]?.title ?? "this material"}?`,
        back: sourceExcerpt(material, index),
        sourceIds: material.content.filter((item) => item.kind === "source").slice(0, 3).map((item) => item.id),
        conceptIds: [],
      }));
      return {
        status: "ready" as const,
        externalNotebookId: notebookId,
        externalArtifactId: `fake-flashcards-${this.counter}`,
        payload: studyFlashcardsPayloadSchema.parse({
          kind: "flashcards",
          cards,
          reviews: [],
          currentIndex: 0,
          revealed: false,
          completedAt: null,
        }),
      };
    }
    return {
      status: "ready" as const,
      externalNotebookId: notebookId,
      externalArtifactId: `fake-${type}-${this.counter}`,
      payload: studyMediaPayloadSchema.parse({
        kind: type,
        localPath: null,
        mimeType: type === "audio" ? "audio/mp4" : "video/mp4",
        durationMs: null,
        sizeBytes: null,
      }),
    };
  }

  async poll(material: StudyEngineMaterial, type: StudyArtifactType, externalArtifactId: string) {
    return this.generate(material, type, { instructions: `Resume ${externalArtifactId}` });
  }
}

type RestOptions = { baseUrl: string; token: string; downloadDir?: string; requestTimeoutMs?: number; maxMediaBytes?: number };

function safeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw Error("Notebook engine URL must use HTTP(S).");
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") throw Error("Notebook engine must use a loopback URL.");
  return url.toString().replace(/\/$/, "");
}

async function jsonResponse(response: Response, maxBytes = MAX_STRUCTURED_RESPONSE_BYTES) {
  const length = response.headers.get("content-length");
  if (length && Number.isFinite(Number(length)) && Number(length) > maxBytes)
    throw Error("The study engine response is too large.");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw Error("The study engine response is too large.");
  let value: unknown;
  try { value = text ? JSON.parse(text) : null; } catch { value = null; }
  if (!response.ok) {
    const message = typeof value === "object" && value && "error" in value && typeof value.error === "object" && value.error && "message" in value.error && typeof value.error.message === "string"
      ? value.error.message
      : `Notebook engine request failed (${response.status}).`;
    throw Error(message);
  }
  return value;
}

function externalStatus(value: unknown) {
  return typeof value === "string" ? value.toLocaleLowerCase() : "pending";
}

function nestedValue(value: unknown, ...keys: string[]) {
  let current = value as Record<string, unknown> | null;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    const next = current[key];
    current = next && typeof next === "object" ? next as Record<string, unknown> : null;
    if (next === undefined) return undefined;
  }
  return current;
}

function rawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeQuiz(value: unknown, material: StudyEngineMaterial): StudyQuizPayload {
  const root = rawRecord(value);
  const rows = Array.isArray(root.questions)
    ? root.questions
    : Array.isArray(root.data) ? root.data : Array.isArray(value) ? value : [];
  const questions = rows.map((row, index) => {
    const item = rawRecord(row);
    const choices = Array.isArray(item.choices)
      ? item.choices
      : Array.isArray(item.options) ? item.options : [];
    const answer = item.answerIndex ?? item.correctIndex ?? item.correct_answer;
    const answerIndex = typeof answer === "number"
      ? answer
      : typeof answer === "string" && choices.indexOf(answer) >= 0
        ? choices.indexOf(answer)
        : -1;
    if (typeof item.prompt !== "string" || choices.length < 2 || answerIndex < 0)
      throw Error("The study engine returned an unstructured quiz export.");
    return {
      id: typeof item.id === "string" ? item.id : `external-q-${index + 1}`,
      prompt: item.prompt,
      choices: choices.map(String),
      answerIndex,
      explanation: typeof item.explanation === "string" ? item.explanation : null,
      sourceIds: material.sourceIds,
      conceptIds: [],
    };
  });
  return studyQuizPayloadSchema.parse({ kind: "quiz", questions, answers: [], currentIndex: 0, completedAt: null, score: null });
}

function normalizeFlashcards(value: unknown, material: StudyEngineMaterial): StudyFlashcardsPayload {
  const root = rawRecord(value);
  const rows = Array.isArray(root.cards)
    ? root.cards
    : Array.isArray(root.data) ? root.data : Array.isArray(value) ? value : [];
  const cards = rows.map((row, index) => {
    const item = rawRecord(row);
    const front = item.front ?? item.question;
    const back = item.back ?? item.answer;
    if (typeof front !== "string" || typeof back !== "string")
      throw Error("The study engine returned an unstructured flashcard export.");
    return {
      id: typeof item.id === "string" ? item.id : `external-card-${index + 1}`,
      front,
      back,
      sourceIds: material.sourceIds,
      conceptIds: [],
    };
  });
  return studyFlashcardsPayloadSchema.parse({ kind: "flashcards", cards, reviews: [], currentIndex: 0, revealed: false, completedAt: null });
}

/** Loopback REST adapter for the experimental notebooklm-py server. */
export class NotebookLMRestEngine implements NotebookStudyEngine {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly downloadDir: string;
  private readonly requestTimeoutMs: number;
  private readonly maxMediaBytes: number;
  constructor(options: RestOptions) {
    this.baseUrl = safeBaseUrl(options.baseUrl);
    this.token = options.token;
    this.downloadDir = options.downloadDir ?? join(process.cwd(), ".desk-study-artifacts");
    this.requestTimeoutMs = Math.min(120_000, Math.max(100, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS));
    this.maxMediaBytes = Math.min(250 * 1024 * 1024, Math.max(1_024, options.maxMediaBytes ?? MAX_MEDIA_RESPONSE_BYTES));
  }
  private headers() {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }
  private async request(input: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("The study engine request timed out.", { cause: error });
      throw new Error("The study engine request failed.", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
  async status() {
    try {
      const response = await this.request(`${this.baseUrl}/healthz`, { headers: this.headers() });
      if (!response.ok) throw Error("health check failed");
      const advertised = rawRecord(rawRecord(await jsonResponse(response)).capabilities);
      const hasCapabilities = Object.keys(advertised).some((key) => ["quiz", "flashcards", "audio", "video"].includes(key));
      return status({
        available: true,
        connected: true,
        experimental: true,
        message: "Connected to the experimental local study engine.",
        capabilities: hasCapabilities
          ? {
              quiz: advertised.quiz === true,
              flashcards: advertised.flashcards === true,
              audio: advertised.audio === true,
              video: advertised.video === true,
            }
          : { quiz: true, flashcards: true, audio: true, video: true },
      });
    } catch {
      return status({
        available: false,
        connected: false,
        experimental: true,
        message: "Study generation is temporarily unavailable.",
        capabilities: { quiz: false, flashcards: false, audio: false, video: false },
      });
    }
  }
  async ensureMaterialSet(material: StudyEngineMaterial) {
    let externalNotebookId = material.externalNotebookId ?? undefined;
    const externalSourceIds = { ...material.externalSourceIds };
    const externalSourceFingerprints = { ...material.externalSourceFingerprints };
    const currentIds = new Set(material.content.map((item) => item.id));
    for (const id of Object.keys(externalSourceIds)) {
      if (!currentIds.has(id)) {
        delete externalSourceIds[id];
        delete externalSourceFingerprints[id];
      }
    }
    if (!externalNotebookId) {
      const created = await jsonResponse(await this.request(`${this.baseUrl}/v1/notebooks`, {
        method: "POST", headers: this.headers(), body: JSON.stringify({ title: `Desk · ${material.title}` }),
      })) as { notebook?: { id?: unknown }; id?: unknown };
      const id = created.notebook?.id ?? created.id;
      if (typeof id !== "string" || !id) throw Error("The study engine returned no notebook id.");
      externalNotebookId = id;
    }
    for (const item of material.content) {
      const fingerprint = contentFingerprint(item);
      if (externalSourceIds[item.id] && externalSourceFingerprints[item.id] === fingerprint) continue;
      const created = await jsonResponse(await this.request(`${this.baseUrl}/v1/notebooks/${encodeURIComponent(externalNotebookId)}/sources`, {
        method: "POST", headers: this.headers(), body: JSON.stringify({ title: item.title, text: item.text }),
      })) as { source?: { id?: unknown }; id?: unknown };
      const id = created.source?.id ?? created.id;
      if (typeof id !== "string" || !id) throw Error("The study engine returned no source id.");
      externalSourceIds[item.id] = id;
      externalSourceFingerprints[item.id] = fingerprint;
    }
    return { externalNotebookId, externalSourceIds, externalSourceFingerprints };
  }
  async generate(material: StudyEngineMaterial, type: StudyArtifactType, options: StudyGenerationOptions) {
    const ensured = await this.ensureMaterialSet(material);
    const body: Record<string, unknown> = {
      type: studyArtifactType.parse(type),
      source_ids: material.content.map((item) => ensured.externalSourceIds?.[item.id]).filter(Boolean),
    };
    if (options.instructions || options.focus) body.instructions = [options.instructions, options.focus].filter(Boolean).join("\n");
    if (options.difficulty) body.difficulty = options.difficulty;
    if (options.questionCount) body.quantity = options.questionCount;
    const created = await jsonResponse(await this.request(`${this.baseUrl}/v1/notebooks/${encodeURIComponent(ensured.externalNotebookId)}/artifacts`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(body),
    })) as { task_id?: unknown; artifact_id?: unknown; id?: unknown; status?: unknown; payload?: unknown };
    const externalArtifactId = [created.artifact_id, created.task_id, created.id].find((value): value is string => typeof value === "string" && value.length > 0);
    if (!externalArtifactId) throw Error("The study engine returned no artifact id.");
    // The REST API is intentionally non-blocking. The next poll can hydrate a
    // native Desk payload without keeping the renderer blocked for long media.
    return {
      status: "generating" as const,
      externalNotebookId: ensured.externalNotebookId,
      externalArtifactId,
    };
  }

  async poll(material: StudyEngineMaterial, type: StudyArtifactType, externalArtifactId: string) {
    if (!material.externalNotebookId) throw Error("The study material is not connected to the study engine.");
    const response = await jsonResponse(await this.request(
      `${this.baseUrl}/v1/notebooks/${encodeURIComponent(material.externalNotebookId)}/artifacts/${encodeURIComponent(externalArtifactId)}`,
      { headers: this.headers() },
    ));
    const record = rawRecord(response);
    const state = externalStatus(record.status ?? record.state ?? nestedValue(record, "artifact", "status"));
    if (["pending", "queued", "running", "generating", "processing"].includes(state))
      return { status: "generating" as const, externalNotebookId: material.externalNotebookId, externalArtifactId };
    if (["failed", "error", "cancelled", "canceled"].includes(state))
      return { status: "failed" as const, externalNotebookId: material.externalNotebookId, externalArtifactId, error: typeof record.error === "string" ? record.error : "The study engine could not complete this artifact." };
    if (!["complete", "completed", "done", "ready", "success"].includes(state))
      return { status: "failed" as const, externalNotebookId: material.externalNotebookId, externalArtifactId, error: "The study engine returned an unknown artifact status." };

    const download = await this.request(
      `${this.baseUrl}/v1/notebooks/${encodeURIComponent(material.externalNotebookId)}/artifacts/download`,
      { method: "POST", headers: this.headers(), body: JSON.stringify({ type, artifact_id: externalArtifactId }) },
    );
    if (!download.ok) {
      await jsonResponse(download);
      throw Error("The study engine could not download the completed artifact.");
    }
    if (type === "quiz" || type === "flashcards") {
      const length = download.headers.get("content-length");
      if (length && Number.isFinite(Number(length)) && Number(length) > MAX_STRUCTURED_RESPONSE_BYTES)
        throw Error("The study engine response is too large.");
      const text = await download.text();
      if (new TextEncoder().encode(text).byteLength > MAX_STRUCTURED_RESPONSE_BYTES)
        throw Error("The study engine response is too large.");
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw Error("The study engine returned invalid structured study data."); }
      return {
        status: "ready" as const,
        externalNotebookId: material.externalNotebookId,
        externalArtifactId,
        payload: type === "quiz" ? normalizeQuiz(parsed, material) : normalizeFlashcards(parsed, material),
      };
    }
    const length = download.headers.get("content-length");
    if (length && Number.isFinite(Number(length)) && Number(length) > this.maxMediaBytes)
      throw Error("The generated media is too large to store locally.");
    const bytes = new Uint8Array(await download.arrayBuffer());
    if (bytes.byteLength > this.maxMediaBytes) throw Error("The generated media is too large to store locally.");
    await mkdir(this.downloadDir, { recursive: true });
    const extension = type === "audio" ? "m4a" : "mp4";
    const safeArtifactId = createHash("sha256").update(externalArtifactId).digest("hex").slice(0, 32);
    const localPath = join(this.downloadDir, `${material.id}-${safeArtifactId}.${extension}`);
    await writeFile(localPath, bytes);
    return {
      status: "ready" as const,
      externalNotebookId: material.externalNotebookId,
      externalArtifactId,
      payload: studyMediaPayloadSchema.parse({
        kind: type,
        localPath,
        mimeType: type === "audio" ? "audio/mp4" : "video/mp4",
        durationMs: null,
        sizeBytes: bytes.byteLength,
      }),
    };
  }
}
