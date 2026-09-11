import { test } from "node:test";
import assert from "node:assert/strict";
import { studyFlashcardsPayloadSchema, studyQuizPayloadSchema } from "./notebook-types";

const question = {
  id: "question-1",
  prompt: "What is the force law?",
  choices: ["F = ma", "F = m/a"],
  answerIndex: 0,
  explanation: null,
  sourceIds: [],
  conceptIds: [],
};

test("study payload validation rejects answers that do not belong to the generated activity", () => {
  const result = studyQuizPayloadSchema.safeParse({
    kind: "quiz",
    questions: [question],
    answers: [{
      questionId: "missing-question",
      choiceIndex: 0,
      result: "correct",
      hintCount: 0,
      answeredAt: "2026-09-08T12:00:00.000Z",
    }],
    currentIndex: 0,
    completedAt: null,
    score: null,
  });
  assert.equal(result.success, false);
});

test("study payload validation rejects out-of-range answer choices and cursor positions", () => {
  const result = studyQuizPayloadSchema.safeParse({
    kind: "quiz",
    questions: [question],
    answers: [{
      questionId: "question-1",
      choiceIndex: 2,
      result: "incorrect",
      hintCount: 0,
      answeredAt: "2026-09-08T12:00:00.000Z",
    }],
    currentIndex: 1,
    completedAt: null,
    score: null,
  });
  assert.equal(result.success, false);
});

test("flashcard payload validation rejects reviews for unknown cards", () => {
  const result = studyFlashcardsPayloadSchema.safeParse({
    kind: "flashcards",
    cards: [{ id: "card-1", front: "Force", back: "F = ma", sourceIds: [], conceptIds: [] }],
    reviews: [{ cardId: "missing-card", result: "again", reviewedAt: "2026-09-08T12:00:00.000Z" }],
    currentIndex: 0,
    revealed: false,
    completedAt: null,
  });
  assert.equal(result.success, false);
});
