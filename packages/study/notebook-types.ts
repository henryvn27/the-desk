import { z } from "zod";

const uuid = z.string().uuid();

export const studyArtifactType = z.enum(["quiz", "flashcards", "audio", "video"]);
export type StudyArtifactType = z.infer<typeof studyArtifactType>;

export const studyArtifactStatus = z.enum([
  "queued",
  "syncing-sources",
  "generating",
  "ready",
  "failed",
  "stale",
]);
export type StudyArtifactStatus = z.infer<typeof studyArtifactStatus>;

export const studyArtifactProvider = z.enum(["fake", "notebooklm"]);
export type StudyArtifactProvider = z.infer<typeof studyArtifactProvider>;

export const studyMaterialSetSchema = z
  .object({
    id: uuid,
    title: z.string().trim().min(1).max(500),
    classId: uuid.nullable(),
    assessmentId: uuid.nullable(),
    taskId: uuid.nullable(),
    sourceIds: z.array(uuid).max(100),
    noteIds: z.array(uuid).max(100),
    sourceFingerprint: z.string().trim().min(1).max(128),
    externalNotebookId: z.string().trim().max(500).nullable(),
    externalSourceIds: z.record(uuid, z.string().trim().min(1).max(500)),
    externalSourceFingerprints: z.record(uuid, z.string().trim().min(1).max(128)).default({}),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type StudyMaterialSet = z.infer<typeof studyMaterialSetSchema>;

const provenanceSourceIds = z.array(uuid).max(100);

export const studyQuizQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(10_000),
    choices: z.array(z.string().trim().min(1).max(2_000)).min(2).max(8),
    answerIndex: z.number().int().min(0).max(7),
    explanation: z.string().trim().max(4_000).nullable(),
    sourceIds: provenanceSourceIds,
    conceptIds: z.array(uuid).max(20),
  })
  .strict()
  .superRefine((question, ctx) => {
    if (question.answerIndex >= question.choices.length)
      ctx.addIssue({
        code: "custom",
        path: ["answerIndex"],
        message: "The answer must point to one of the question choices.",
      });
  });
export type StudyQuizQuestion = z.infer<typeof studyQuizQuestionSchema>;

export const studyQuizAnswerSchema = z
  .object({
    questionId: z.string().trim().min(1).max(160),
    choiceIndex: z.number().int().min(0).max(7),
    result: z.enum(["correct", "incorrect"]),
    hintCount: z.number().int().min(0).max(100).default(0),
    answeredAt: z.iso.datetime(),
  })
  .strict();
export type StudyQuizAnswer = z.infer<typeof studyQuizAnswerSchema>;

export const studyQuizPayloadSchema = z
  .object({
    kind: z.literal("quiz"),
    questions: z.array(studyQuizQuestionSchema).min(1).max(100),
    answers: z.array(studyQuizAnswerSchema).max(100),
    currentIndex: z.number().int().min(0).max(99),
    completedAt: z.iso.datetime().nullable(),
    score: z.number().int().min(0).max(100).nullable(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const questions = new Map(payload.questions.map((question) => [question.id, question]));
    if (payload.currentIndex >= payload.questions.length) {
      ctx.addIssue({
        code: "custom",
        path: ["currentIndex"],
        message: "The current question must point to an existing question.",
      });
    }
    for (const [index, answer] of payload.answers.entries()) {
      const question = questions.get(answer.questionId);
      if (!question) {
        ctx.addIssue({
          code: "custom",
          path: ["answers", index, "questionId"],
          message: "The answer must point to an existing question.",
        });
        continue;
      }
      if (answer.choiceIndex >= question.choices.length) {
        ctx.addIssue({
          code: "custom",
          path: ["answers", index, "choiceIndex"],
          message: "The answer must point to one of the question choices.",
        });
      }
    }
  });
export type StudyQuizPayload = z.infer<typeof studyQuizPayloadSchema>;

export const studyFlashcardSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    front: z.string().trim().min(1).max(4_000),
    back: z.string().trim().min(1).max(8_000),
    sourceIds: provenanceSourceIds,
    conceptIds: z.array(uuid).max(20),
  })
  .strict();
export type StudyFlashcard = z.infer<typeof studyFlashcardSchema>;

export const studyFlashcardReviewSchema = z
  .object({
    cardId: z.string().trim().min(1).max(160),
    result: z.enum(["again", "got-it"]),
    reviewedAt: z.iso.datetime(),
  })
  .strict();
export type StudyFlashcardReview = z.infer<typeof studyFlashcardReviewSchema>;

export const studyFlashcardsPayloadSchema = z
  .object({
    kind: z.literal("flashcards"),
    cards: z.array(studyFlashcardSchema).min(1).max(200),
    reviews: z.array(studyFlashcardReviewSchema).max(200),
    currentIndex: z.number().int().min(0).max(199),
    revealed: z.boolean(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const cardIds = new Set(payload.cards.map((card) => card.id));
    if (payload.currentIndex >= payload.cards.length) {
      ctx.addIssue({
        code: "custom",
        path: ["currentIndex"],
        message: "The current card must point to an existing card.",
      });
    }
    for (const [index, review] of payload.reviews.entries()) {
      if (!cardIds.has(review.cardId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviews", index, "cardId"],
          message: "The review must point to an existing card.",
        });
      }
    }
  });
export type StudyFlashcardsPayload = z.infer<typeof studyFlashcardsPayloadSchema>;

export const studyMediaPayloadSchema = z
  .object({
    kind: z.enum(["audio", "video"]),
    localPath: z.string().trim().max(4_000).nullable(),
    mimeType: z.string().trim().max(120).nullable(),
    durationMs: z.number().int().min(0).nullable(),
    sizeBytes: z.number().int().min(0).nullable(),
  })
  .strict();
export type StudyMediaPayload = z.infer<typeof studyMediaPayloadSchema>;

export const studyArtifactPayloadSchema = z.union([
  studyQuizPayloadSchema,
  studyFlashcardsPayloadSchema,
  studyMediaPayloadSchema,
]);
export type StudyArtifactPayload = z.infer<typeof studyArtifactPayloadSchema>;

export const studyArtifactSchema = z
  .object({
    id: uuid,
    type: studyArtifactType,
    title: z.string().trim().min(1).max(500),
    materialSetId: uuid,
    provider: studyArtifactProvider,
    status: studyArtifactStatus,
    externalNotebookId: z.string().trim().max(500).nullable(),
    externalArtifactId: z.string().trim().max(500).nullable(),
    sourceFingerprint: z.string().trim().min(1).max(128),
    payload: studyArtifactPayloadSchema.nullable(),
    playbackPositionMs: z.number().int().min(0),
    completed: z.boolean(),
    generationOptions: z.record(z.string(), z.unknown()),
    error: z.string().trim().max(2_000).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type StudyArtifact = z.infer<typeof studyArtifactSchema>;

export const studyArtifactUpdateSchema = z
  .object({
    status: studyArtifactStatus.optional(),
    payload: studyArtifactPayloadSchema.nullable().optional(),
    externalNotebookId: z.string().trim().max(500).nullable().optional(),
    externalArtifactId: z.string().trim().max(500).nullable().optional(),
    playbackPositionMs: z.number().int().min(0).optional(),
    completed: z.boolean().optional(),
    error: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();
export type StudyArtifactUpdate = z.infer<typeof studyArtifactUpdateSchema>;

export const studyGenerationOptionsSchema = z
  .object({
    questionCount: z.number().int().min(1).max(50).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    focus: z.string().trim().max(1_000).optional(),
    instructions: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type StudyGenerationOptions = z.infer<typeof studyGenerationOptionsSchema>;

export const studyMaterialRequestSchema = z
  .object({
    title: z.string().trim().max(500).optional(),
    classId: uuid.optional(),
    assessmentId: uuid.optional(),
    taskId: uuid.optional(),
    sourceIds: z.array(uuid).max(100).optional(),
    noteIds: z.array(uuid).max(100).optional(),
  })
  .strict();
export type StudyMaterialRequest = z.infer<typeof studyMaterialRequestSchema>;

export const studyGenerationRequestSchema = z
  .object({
    type: studyArtifactType,
    material: studyMaterialRequestSchema,
    options: studyGenerationOptionsSchema.optional(),
  })
  .strict();
export type StudyGenerationRequest = z.infer<typeof studyGenerationRequestSchema>;

export const studyEngineStatusSchema = z
  .object({
    available: z.boolean(),
    connected: z.boolean(),
    experimental: z.boolean(),
    message: z.string().trim().max(500),
    capabilities: z.object({
      quiz: z.boolean(),
      flashcards: z.boolean(),
      audio: z.boolean(),
      video: z.boolean(),
    }),
  })
  .strict();
export type StudyEngineStatus = z.infer<typeof studyEngineStatusSchema>;
