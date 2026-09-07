import type {
  Assessment,
  Attempt,
  Concept,
  Mistake,
  Snapshot,
  StudySession,
  Task,
  TeacherEvidence,
} from "../domain/contracts";

/**
 * The Student Model is a read-only interpretation layer over V1 evidence.
 * Attempts, mistakes, sessions and teacher records remain the source of truth;
 * every value here can be recomputed from a Snapshot without a new table.
 */
export type StudentModelInput = {
  concepts: readonly Concept[];
  attempts: readonly Attempt[];
  mistakes: readonly Mistake[];
  sessions: readonly StudySession[];
  assessments?: readonly Assessment[];
  teacherEvidence?: readonly TeacherEvidence[];
  tasks?: readonly Task[];
};

export type DimensionLabel = "insufficient" | "low" | "medium" | "high";
export type DimensionScore = {
  value: number | null;
  label: DimensionLabel;
  evidenceCount: number;
};

export type MemoryState = {
  algorithm: "fsrs-inspired";
  difficulty: number | null;
  stabilityDays: number | null;
  retrievability: number | null;
  lapses: number;
  lastReviewedAt: string | null;
  lastSuccessfulAt: string | null;
  reviewDue: string | null;
  reviewSource: "explicit" | "derived" | "none";
};

export type CalibrationState = {
  status:
    | "insufficient-evidence"
    | "underconfident"
    | "calibrated"
    | "overconfident";
  bias: number | null;
  meanAbsoluteError: number | null;
  observations: number;
  explanation: string;
};

export type MistakePattern = {
  key:
    | "sign-error"
    | "algebra-slip"
    | "wrong-formula"
    | "prerequisite-failure"
    | "other";
  label: string;
  count: number;
  persistence: "single-incident" | "repeated";
  confidence: "low" | "medium" | "high";
  mistakeIds: string[];
  evidence: string[];
};

export type PrerequisiteGap = {
  conceptId: string;
  name: string;
  preparedness: Concept["preparedness"];
  competence: number | null;
  retrievability: number | null;
  path: string[];
  reason: string;
};

export type ConceptState = {
  conceptId: string;
  classId: string;
  name: string;
  recordedStatus: Concept["status"];
  recordedPreparedness: Concept["preparedness"];
  preparedness: Concept["preparedness"];
  competence: DimensionScore;
  retrievability: DimensionScore;
  evidenceConfidence: DimensionScore;
  transferDepth: DimensionScore;
  calibration: CalibrationState;
  memory: MemoryState;
  unresolvedMistakes: number;
  mistakePatterns: MistakePattern[];
  prerequisiteGaps: PrerequisiteGap[];
  attemptIds: string[];
  why: string[];
  evidence: {
    scoredAttempts: number;
    unaidedAttempts: number;
    unaidedCorrect: number;
    uniqueTaskCount: number;
    hintCount: number;
    teacherEvidenceCount: number;
    source: "attempts" | "concept-counters" | "none";
  };
};

export type ReviewDue = {
  conceptId: string;
  dueAt: string | null;
  status: "no-evidence" | "scheduled" | "due";
  source: "explicit" | "derived" | "none";
  reason: string;
};

export type AssessmentReadiness = {
  assessmentId: string;
  state: Concept["preparedness"];
  conceptStates: ConceptState[];
  evidenceGaps: string[];
  why: string[];
};

export type StateExplanation = {
  conceptId: string;
  title: string;
  state: Concept["preparedness"];
  why: string[];
  dimensions: Pick<
    ConceptState,
    "competence" | "retrievability" | "evidenceConfidence" | "transferDepth" | "calibration"
  >;
  evidenceIds: string[];
};

export type ConfidenceEvidenceRequest = {
  sessionId: string;
  rating: number;
  conceptIds?: string[];
};

export type ConfidenceEvidenceObservation = {
  conceptId: string;
  attemptIds: string[];
  predicted: number;
  actual: number;
  error: number;
};

export type ConfidenceEvidenceResult = {
  accepted: boolean;
  reason: string;
  observations: ConfidenceEvidenceObservation[];
};

export type LearningObjectiveScope = {
  classId?: string;
  taskId?: string;
  assessmentId?: string;
};

export type LearningObjective = {
  conceptId: string;
  title: string;
  reason: string;
  priority: number;
  state: ConceptState;
};

const DAY = 24 * 60 * 60 * 1000;
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

function finiteDate(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(+date) ? date : null;
}

function ageDays(value: string | null | undefined, now: Date) {
  const date = finiteDate(value);
  return date ? Math.max(0, (+now - +date) / DAY) : Infinity;
}

function resultScore(result: Attempt["result"]): number | null {
  if (result === "correct") return 1;
  if (result === "partial") return 0.55;
  if (result === "incorrect") return 0;
  return null;
}

function dimension(value: number | null, evidenceCount: number): DimensionScore {
  if (value === null || evidenceCount <= 0)
    return { value: null, label: "insufficient", evidenceCount: 0 };
  return {
    value: clamp(value),
    label:
      value >= 0.78 ? "high" : value >= 0.55 ? "medium" : "low",
    evidenceCount,
  };
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function optionalAttemptMetadata(attempt: Attempt) {
  const record = asRecord(attempt);
  const metadata = asRecord(record.metadata);
  return {
    difficulty:
      typeof record.difficulty === "number"
        ? record.difficulty
        : typeof metadata.difficulty === "number"
          ? metadata.difficulty
          : null,
    transferDistance:
      typeof record.transferDistance === "number"
        ? record.transferDistance
        : typeof metadata.transferDistance === "number"
          ? metadata.transferDistance
          : null,
    latencyMs:
      typeof record.latencyMs === "number"
        ? record.latencyMs
        : typeof metadata.latencyMs === "number"
          ? metadata.latencyMs
          : null,
    externallyGraded:
      record.externallyGraded === true || metadata.externallyGraded === true,
    responseMode:
      typeof record.responseMode === "string"
        ? record.responseMode
        : typeof metadata.responseMode === "string"
          ? metadata.responseMode
          : null,
  };
}

function normalizedState(input: StudentModelInput): StudentModelInput {
  return {
    concepts: input.concepts ?? [],
    attempts: input.attempts ?? [],
    mistakes: input.mistakes ?? [],
    sessions: input.sessions ?? [],
    assessments: input.assessments ?? [],
    teacherEvidence: input.teacherEvidence ?? [],
    tasks: input.tasks ?? [],
  };
}

function mistakeBelongsTo(mistake: Mistake, concept: Concept) {
  return mistake.classId === concept.classId && normalize(mistake.concept) === normalize(concept.name);
}

function mistakeResolved(mistake: Mistake, attempts: readonly Attempt[]) {
  const after = finiteDate(mistake.updatedAt ?? mistake.createdAt);
  return attempts.some(
    (attempt) =>
      attempt.unaided &&
      attempt.result === "correct" &&
      (!after || (finiteDate(attempt.attemptedAt)?.getTime() ?? 0) > +after),
  );
}

function classifyMistake(mistake: Mistake): MistakePattern["key"] {
  const text = normalize(
    `${mistake.concept} ${mistake.originalAttempt} ${mistake.whatWentWrong} ${mistake.correction}`,
  );
  if (/sign|negative|positive|direction|component|plus minus|subtrac/.test(text))
    return "sign-error";
  if (/algebra|equation|factor|expand|distribut|exponent|rearrang|isolat|solve for/.test(text))
    return "algebra-slip";
  if (/wrong formula|incorrect formula|used the wrong|formula choice|equation choice/.test(text))
    return "wrong-formula";
  if (/prerequisite|forgot|definition|fundamental|basic|prior concept|unit conversion/.test(text))
    return "prerequisite-failure";
  return "other";
}

function mistakeLabel(key: MistakePattern["key"]) {
  return {
    "sign-error": "Sign or direction error",
    "algebra-slip": "Algebra slip",
    "wrong-formula": "Formula selection error",
    "prerequisite-failure": "Prerequisite gap",
    other: "Unclassified mistake",
  }[key];
}

function mistakePatterns(
  concept: Concept,
  state: StudentModelInput,
): MistakePattern[] {
  const attempts = state.attempts.filter((attempt) =>
    attempt.conceptIds.includes(concept.id),
  );
  const mistakes = state.mistakes.filter((mistake) => mistakeBelongsTo(mistake, concept));
  const groups = new Map<MistakePattern["key"], Mistake[]>();
  for (const mistake of mistakes) {
    const key = classifyMistake(mistake);
    groups.set(key, [...(groups.get(key) ?? []), mistake]);
  }
  return [...groups.entries()]
    .map(([key, records]) => {
      const repeated = records.length >= 2;
      const evidence = records.flatMap((record) => {
        const snippets = [record.source, record.whatWentWrong].filter(Boolean);
        return snippets.length ? snippets : [record.originalAttempt];
      });
      return {
        key,
        label: mistakeLabel(key),
        count: records.length,
        persistence: repeated ? "repeated" : "single-incident",
        confidence: repeated ? "high" : "low",
        mistakeIds: records.map((record) => record.id),
        evidence: [
          ...evidence,
          ...(attempts.length ? [`${attempts.length} linked checked attempt${attempts.length === 1 ? "" : "s"}`] : []),
        ],
      } satisfies MistakePattern;
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function confidenceObservations(
  concept: Concept,
  state: StudentModelInput,
  sessionId?: string,
): ConfidenceEvidenceObservation[] {
  const observations: ConfidenceEvidenceObservation[] = [];
  for (const session of state.sessions) {
    if (sessionId && session.id !== sessionId) continue;
    const capture = session.review?.confidence;
    if (!capture || !capture.conceptIds.includes(concept.id)) continue;
    const attempts = state.attempts.filter(
      (attempt) =>
        attempt.conceptIds.includes(concept.id) &&
        session.evidenceAttemptIds?.includes(attempt.id),
    );
    const scores = attempts.map((attempt) => resultScore(attempt.result)).filter(
      (score): score is number => score !== null,
    );
    if (!scores.length) continue;
    const actual = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const predicted = clamp((capture.rating - 1) / 4);
    observations.push({
      conceptId: concept.id,
      attemptIds: attempts.map((attempt) => attempt.id),
      predicted,
      actual,
      error: predicted - actual,
    });
  }
  return observations;
}

function calibrationFor(concept: Concept, state: StudentModelInput): CalibrationState {
  const observations = confidenceObservations(concept, state);
  if (!observations.length)
    return {
      status: "insufficient-evidence",
      bias: null,
      meanAbsoluteError: null,
      observations: 0,
      explanation: "No confidence prediction is paired with a checked outcome yet.",
    };
  const bias = observations.reduce((sum, observation) => sum + observation.error, 0) / observations.length;
  const meanAbsoluteError = observations.reduce((sum, observation) => sum + Math.abs(observation.error), 0) / observations.length;
  const status =
    bias >= 0.12 ? "overconfident" : bias <= -0.12 ? "underconfident" : "calibrated";
  return {
    status,
    bias,
    meanAbsoluteError,
    observations: observations.length,
    explanation:
      status === "overconfident"
        ? "Predicted confidence has been higher than checked performance."
        : status === "underconfident"
          ? "Checked performance has been stronger than predicted confidence."
          : "Predicted confidence has tracked checked performance closely.",
  };
}

type AttemptEvidence = {
  attempts: Attempt[];
  scored: Array<{ attempt: Attempt; score: number; weight: number }>;
  weightedAccuracy: number | null;
  effectiveEvidence: number;
  uniqueTaskCount: number;
  hintCount: number;
  unaidedAttempts: number;
  unaidedCorrect: number;
  latest: Attempt | null;
  latestSuccessful: Attempt | null;
  source: "attempts" | "concept-counters" | "none";
};

function attemptEvidence(concept: Concept, state: StudentModelInput, now: Date): AttemptEvidence {
  const attempts = state.attempts
    .filter((attempt) => attempt.classId === concept.classId && attempt.conceptIds.includes(concept.id))
    .sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt) || a.id.localeCompare(b.id));
  const occurrences = new Map<string, number>();
  const scored: AttemptEvidence["scored"] = [];
  let hintCount = 0;
  let unaidedAttempts = 0;
  let unaidedCorrect = 0;
  for (const attempt of attempts) {
    hintCount += attempt.hintCount;
    const score = resultScore(attempt.result);
    if (score === null) continue;
    if (attempt.unaided) {
      unaidedAttempts += 1;
      if (attempt.result === "correct") unaidedCorrect += 1;
    }
    const taskKey = attempt.taskId ?? "unlinked";
    const occurrence = (occurrences.get(taskKey) ?? 0) + 1;
    occurrences.set(taskKey, occurrence);
    const metadata = optionalAttemptMetadata(attempt);
    const recency = 0.65 + 0.35 * Math.pow(0.5, ageDays(attempt.attemptedAt, now) / 120);
    const aid = attempt.unaided
      ? 1
      : Math.max(0.25, 0.72 / (1 + attempt.hintCount * 0.25));
    const repetition = 1 / Math.sqrt(occurrence);
    const difficulty = metadata.difficulty === null ? 1 : 0.85 + 0.3 * clamp(metadata.difficulty);
    const source = metadata.externallyGraded ? 1.1 : 1;
    const latency =
      metadata.latencyMs === null
        ? 1
        : clamp(
            1 - Math.max(0, metadata.latencyMs - 30_000) / 180_000 * 0.25,
            0.75,
            1,
          );
    const responseMode = metadata.responseMode === "multiple-choice" ? 0.9 : 1;
    const weight = recency * aid * repetition * difficulty * source * latency * responseMode;
    scored.push({ attempt, score, weight });
  }
  const uniqueTaskCount = new Set(
    scored
      .map(({ attempt }) => attempt.taskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  ).size;
  if (!scored.length && concept.unaidedTotal > 0) {
    return {
      attempts,
      scored,
      weightedAccuracy: clamp(concept.unaidedCorrect / Math.max(1, concept.unaidedTotal)),
      effectiveEvidence: Math.min(3, concept.unaidedTotal),
      uniqueTaskCount: concept.taskIds.length,
      hintCount: concept.hintCount,
      unaidedAttempts: concept.unaidedTotal,
      unaidedCorrect: concept.unaidedCorrect,
      latest: null,
      latestSuccessful: null,
      source: "concept-counters",
    };
  }
  const totalWeight = scored.reduce((sum, item) => sum + item.weight, 0);
  const weightedAccuracy = totalWeight
    ? scored.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : null;
  const latest = attempts.at(-1) ?? null;
  const latestSuccessful = [...attempts]
    .reverse()
    .find((attempt) => attempt.unaided && attempt.result === "correct") ?? null;
  return {
    attempts,
    scored,
    weightedAccuracy,
    effectiveEvidence: Math.min(4, totalWeight),
    uniqueTaskCount,
    hintCount,
    unaidedAttempts,
    unaidedCorrect,
    latest,
    latestSuccessful,
    source: scored.length ? "attempts" : "none",
  };
}

function teacherCount(concept: Concept, state: StudentModelInput) {
  return (state.teacherEvidence ?? []).filter(
    (evidence) =>
      evidence.classId === concept.classId &&
      evidence.includeInTeacherModeling &&
      evidence.conceptIds.includes(concept.id),
  ).length;
}

function memoryFor(
  concept: Concept,
  evidence: AttemptEvidence,
  now: Date,
): MemoryState {
  const scored = evidence.scored;
  const lastReviewedAt =
    evidence.latest?.attemptedAt ?? concept.lastReviewedAt ?? null;
  const explicitDue = concept.reviewDue;
  if (!lastReviewedAt && !explicitDue)
    return {
      algorithm: "fsrs-inspired",
      difficulty: null,
      stabilityDays: null,
      retrievability: null,
      lapses: 0,
      lastReviewedAt: null,
      lastSuccessfulAt: null,
      reviewDue: null,
      reviewSource: "none",
    };
  let stability = concept.retentionMode === "long-term" ? 14 : 7;
  let lapses = 0;
  let previousSuccess: Date | null = null;
  for (const item of scored) {
    const date = finiteDate(item.attempt.attemptedAt);
    if (!date) continue;
    if (item.score >= 0.75) {
      const interval = previousSuccess ? Math.max(0, (+date - +previousSuccess) / DAY) : 0;
      stability *= 1.2 + Math.min(0.9, interval / Math.max(1, stability) * 0.18);
      if (!item.attempt.unaided) stability *= 1.03;
      previousSuccess = date;
    } else {
      if (previousSuccess) lapses += 1;
      stability *= item.score > 0 ? 0.72 : 0.55;
    }
    stability = clamp(stability, 1, concept.retentionMode === "long-term" ? 365 : 180);
  }
  const latest = finiteDate(lastReviewedAt);
  const latestOutcome = evidence.latest ? resultScore(evidence.latest.result) : null;
  const outcomeFactor = latestOutcome === null ? 0.5 : latestOutcome >= 0.75 ? 0.95 : latestOutcome > 0 ? 0.6 : 0.35;
  const retrievability = latest
    ? clamp(outcomeFactor * Math.pow(2, -ageDays(lastReviewedAt, now) / Math.max(1, stability)))
    : null;
  const difficulty = evidence.weightedAccuracy === null
    ? null
    : clamp(
        0.25 +
          (1 - evidence.weightedAccuracy) * 0.5 +
          (evidence.scored.length ? evidence.hintCount / evidence.scored.length : 0) * 0.18 +
          lapses * 0.04,
        0.1,
        0.95,
      );
  const target = concept.retentionMode === "long-term" ? 0.88 : 0.82;
  const derivedDue = latest
    ? new Date(+latest + stability * Math.max(0.35, Math.log2(1 / target)) * DAY).toISOString()
    : null;
  const reviewDue = explicitDue ?? derivedDue;
  return {
    algorithm: "fsrs-inspired",
    difficulty,
    stabilityDays: stability,
    retrievability,
    lapses,
    lastReviewedAt,
    lastSuccessfulAt: evidence.latestSuccessful?.attemptedAt ?? previousSuccess?.toISOString() ?? null,
    reviewDue,
    reviewSource: explicitDue ? "explicit" : derivedDue ? "derived" : "none",
  };
}

function readinessRank(value: Concept["preparedness"]) {
  return {
    "not-ready": 0,
    developing: 1,
    "mostly-ready": 2,
    ready: 3,
    strong: 4,
  }[value];
}

function readinessFromRank(value: number): Concept["preparedness"] {
  return (["not-ready", "developing", "mostly-ready", "ready", "strong"] as const)[
    Math.max(0, Math.min(4, Math.round(value)))
  ]!;
}

function deriveConceptState(
  concept: Concept,
  state: StudentModelInput,
  now: Date,
  cache: Map<string, ConceptState>,
): ConceptState {
  const cached = cache.get(concept.id);
  if (cached) return cached;
  const evidence = attemptEvidence(concept, state, now);
  const teachers = teacherCount(concept, state);
  const sample = evidence.scored.length
    ? Math.min(1, evidence.scored.length / 4)
    : evidence.source === "concept-counters"
      ? Math.min(1, evidence.effectiveEvidence / 3) * 0.55
      : 0;
  const breadth = Math.min(1, evidence.uniqueTaskCount / 3);
  const unaidedRate = evidence.scored.length
    ? evidence.unaidedAttempts / evidence.scored.length
    : evidence.source === "concept-counters"
      ? 1
      : 0;
  const confidenceValue = evidence.weightedAccuracy === null
    ? null
    : clamp(0.1 + sample * 0.48 + breadth * 0.22 + unaidedRate * 0.12 + (teachers ? 0.08 : 0));
  const transferValue = evidence.scored.length
    ? clamp(
        breadth * 0.75 +
          (evidence.scored
            .map(({ attempt }) => optionalAttemptMetadata(attempt).transferDistance)
            .filter((value): value is number => value !== null)
            .reduce((sum, value, _, values) => sum + clamp(value) / values.length, 0) || 0),
      )
    : null;
  const memory = memoryFor(concept, evidence, now);
  const retrievabilityValue = memory.retrievability;
  const patterns = mistakePatterns(concept, state);
  const relevantAttempts = state.attempts.filter((attempt) => attempt.conceptIds.includes(concept.id));
  const unresolvedMistakes = state.mistakes.filter(
    (mistake) => mistakeBelongsTo(mistake, concept) && !mistakeResolved(mistake, relevantAttempts),
  ).length;
  const calibration = calibrationFor(concept, state);
  const prerequisiteGaps = getPrerequisiteGapsInternal(concept.id, state, now, cache);
  const competenceValue = evidence.weightedAccuracy;
  let preparedness: Concept["preparedness"];
  if (competenceValue === null) preparedness = "not-ready";
  else if (competenceValue < 0.45 || prerequisiteGaps.length > 0) preparedness = "developing";
  else if (
    confidenceValue === null ||
    confidenceValue < 0.42 ||
    evidence.scored.length < 2
  ) preparedness = "developing";
  else if (retrievabilityValue !== null && retrievabilityValue < 0.45) preparedness = "developing";
  else if (
    competenceValue >= 0.84 &&
    (retrievabilityValue ?? 0) >= 0.76 &&
    (transferValue ?? 0) >= 0.62 &&
    confidenceValue >= 0.7 &&
    unresolvedMistakes === 0
  ) preparedness = "strong";
  else if (
    competenceValue >= 0.72 &&
    (retrievabilityValue ?? 0) >= 0.58 &&
    (transferValue ?? 0) >= 0.45
  ) preparedness = "ready";
  else preparedness = "mostly-ready";
  const why: string[] = [];
  if (!evidence.scored.length && evidence.source === "none")
    why.push("No checked attempts are linked to this concept.");
  if (evidence.scored.length) {
    const incorrectUnaided = evidence.scored.filter(
      ({ attempt }) => attempt.unaided && attempt.result !== "correct",
    ).length;
    if (incorrectUnaided)
      why.push(`${incorrectUnaided} unaided attempt${incorrectUnaided === 1 ? "" : "s"} was not fully correct.`);
    if (evidence.hintCount)
      why.push(`${evidence.hintCount} hint${evidence.hintCount === 1 ? "" : "s"} recorded across the checked work.`);
    if (evidence.uniqueTaskCount > 1)
      why.push(`Correct work spans ${evidence.uniqueTaskCount} tasks, giving transfer evidence.`);
    else why.push("Evidence is from one task; transfer is still untested.");
    const guessed = evidence.scored.some(({ attempt }) => /\bguess(?:ed|ing)?\b|lucky/.test(normalize(attempt.notes)));
    if (guessed) why.push("A checked attempt was marked as a guess, so confidence is limited.");
  }
  if (unresolvedMistakes)
    why.push(`${unresolvedMistakes} unresolved mistake${unresolvedMistakes === 1 ? "" : "s"} still needs a new checked attempt.`);
  if (memory.reviewDue && finiteDate(memory.reviewDue) && +finiteDate(memory.reviewDue)! <= +now)
    why.push("Retrievability is due for review; competence is kept separate from recall today.");
  if (prerequisiteGaps.length)
    why.push(`Prerequisite gap: ${prerequisiteGaps.map((gap) => gap.name).join(", ")}.`);
  if (confidenceValue !== null && confidenceValue < 0.55)
    why.push("Evidence confidence is limited by sample size or breadth.");
  if (calibration.status === "overconfident" || calibration.status === "underconfident")
    why.push(calibration.explanation);
  if (!why.length) why.push("Recent checked work supports this state.");
  const result: ConceptState = {
    conceptId: concept.id,
    classId: concept.classId,
    name: concept.name,
    recordedStatus: concept.status,
    recordedPreparedness: concept.preparedness,
    preparedness,
    competence: dimension(competenceValue, evidence.scored.length || (evidence.source === "concept-counters" ? evidence.unaidedAttempts : 0)),
    retrievability: dimension(retrievabilityValue, evidence.scored.length || (memory.lastReviewedAt ? 1 : 0)),
    evidenceConfidence: dimension(confidenceValue, evidence.scored.length || (evidence.source === "concept-counters" ? evidence.unaidedAttempts : 0)),
    transferDepth: dimension(transferValue, evidence.scored.length),
    calibration,
    memory,
    unresolvedMistakes,
    mistakePatterns: patterns,
    prerequisiteGaps,
    attemptIds: evidence.attempts.map((attempt) => attempt.id),
    why,
    evidence: {
      scoredAttempts: evidence.scored.length,
      unaidedAttempts: evidence.unaidedAttempts,
      unaidedCorrect: evidence.unaidedCorrect,
      uniqueTaskCount: evidence.uniqueTaskCount,
      hintCount: evidence.hintCount,
      teacherEvidenceCount: teachers,
      source: evidence.source,
    },
  };
  cache.set(concept.id, result);
  return result;
}

function getPrerequisiteGapsInternal(
  conceptId: string,
  state: StudentModelInput,
  now: Date,
  cache: Map<string, ConceptState>,
  pathIds: string[] = [],
  pathNames: string[] = [],
): PrerequisiteGap[] {
  const concept = state.concepts.find((item) => item.id === conceptId);
  if (!concept) return [];
  const gaps: PrerequisiteGap[] = [];
  for (const prerequisiteId of concept.prerequisiteConceptIds ?? []) {
    if (pathIds.includes(prerequisiteId) || prerequisiteId === conceptId) continue;
    const prerequisite = state.concepts.find((item) => item.id === prerequisiteId);
    if (!prerequisite) continue;
    const prerequisiteState = deriveConceptState(prerequisite, state, now, cache);
    const nextPath = [...pathNames, concept.name, prerequisite.name];
    const nextPathIds = [...pathIds, conceptId, prerequisiteId];
    if (readinessRank(prerequisiteState.preparedness) < readinessRank("ready"))
      gaps.push({
        conceptId: prerequisite.id,
        name: prerequisite.name,
        preparedness: prerequisiteState.preparedness,
        competence: prerequisiteState.competence.value,
        retrievability: prerequisiteState.retrievability.value,
        path: nextPath,
        reason: prerequisiteState.why[0] ?? "Prerequisite evidence is not ready.",
      });
    gaps.push(
      ...getPrerequisiteGapsInternal(
        prerequisite.id,
        state,
        now,
        cache,
        nextPathIds,
        nextPath,
      ),
    );
  }
  return gaps.filter((gap, index, all) => all.findIndex((item) => item.conceptId === gap.conceptId) === index);
}

function modelInputFromSnapshot(snapshot: Snapshot): StudentModelInput {
  return snapshot;
}

export type StudentModelService = ReturnType<typeof createStudentModel>;

export function createStudentModel(input: StudentModelInput | Snapshot, now = new Date()) {
  const state = normalizedState(input);
  const current = finiteDate(now) ?? new Date();
  const cache = new Map<string, ConceptState>();
  const get = (conceptId: string) => {
    const concept = state.concepts.find((item) => item.id === conceptId);
    return concept ? deriveConceptState(concept, state, current, cache) : null;
  };
  const getReview = (conceptId: string): ReviewDue => {
    const concept = state.concepts.find((item) => item.id === conceptId);
    const derived = get(conceptId);
    if (!concept || !derived)
      return { conceptId, dueAt: null, status: "no-evidence", source: "none", reason: "Concept was not found." };
    const dueAt = derived.memory.reviewDue;
    if (!dueAt)
      return { conceptId, dueAt: null, status: "no-evidence", source: "none", reason: "No checked evidence is available for a review date." };
    const due = finiteDate(dueAt)! <= current;
    return {
      conceptId,
      dueAt,
      status: due ? "due" : "scheduled",
      source: derived.memory.reviewSource,
      reason: due
        ? derived.memory.reviewSource === "explicit"
          ? "The recorded review date has arrived."
          : "Retrievability has fallen below the retention target."
        : derived.memory.reviewSource === "explicit"
          ? "The recorded review date is upcoming."
          : "Next review is derived from checked retrieval history.",
    };
  };
  const getGaps = (conceptId: string) => getPrerequisiteGapsInternal(conceptId, state, current, cache);
  const explain = (conceptId: string): StateExplanation | null => {
    const derived = get(conceptId);
    if (!derived) return null;
    return {
      conceptId,
      title: derived.name,
      state: derived.preparedness,
      why: [...derived.why],
      dimensions: {
        competence: derived.competence,
        retrievability: derived.retrievability,
        evidenceConfidence: derived.evidenceConfidence,
        transferDepth: derived.transferDepth,
        calibration: derived.calibration,
      },
      evidenceIds: [...derived.attemptIds],
    };
  };
  const patterns = (conceptId: string) => {
    const concept = state.concepts.find((item) => item.id === conceptId);
    return concept ? mistakePatterns(concept, state) : [];
  };
  const confidence = (request: ConfidenceEvidenceRequest): ConfidenceEvidenceResult => {
    if (!Number.isInteger(request.rating) || request.rating < 1 || request.rating > 5)
      return { accepted: false, reason: "Confidence must be a whole-number rating from 1 to 5.", observations: [] };
    const session = state.sessions.find((item) => item.id === request.sessionId);
    if (!session?.review?.confidence)
      return { accepted: false, reason: "This session has no saved confidence capture.", observations: [] };
    if (request.rating !== session.review.confidence.rating)
      return {
        accepted: false,
        reason: "The requested rating does not match the saved confidence capture.",
        observations: [],
      };
    const requested = request.conceptIds?.length ? new Set(request.conceptIds) : null;
    const observations = state.concepts
      .filter((concept) => !requested || requested.has(concept.id))
      .flatMap((concept) => confidenceObservations(concept, state, request.sessionId));
    if (!observations.length)
      return { accepted: false, reason: "Confidence is kept as a reflection until a checked outcome is linked to it.", observations: [] };
    return { accepted: true, reason: "Confidence is paired with checked performance.", observations };
  };
  const assessment = (assessmentId: string): AssessmentReadiness | null => {
    const record = state.assessments?.find((item) => item.id === assessmentId);
    if (!record) return null;
    const taskIds = new Set(record.taskIds);
    const concepts = state.concepts.filter(
      (concept) =>
        concept.classId === record.classId &&
        (concept.taskIds.some((taskId) => taskIds.has(taskId)) ||
          state.attempts.some((attempt) => attempt.conceptIds.includes(concept.id) && attempt.taskId !== null && taskIds.has(attempt.taskId))),
    );
    const conceptStates = concepts.map((concept) => get(concept.id)!).filter(Boolean);
    if (!conceptStates.length)
      return {
        assessmentId,
        state: "not-ready",
        conceptStates: [],
        evidenceGaps: ["No concepts are linked to the assessment preparation tasks."],
        why: ["Link concepts and record checked attempts before calling this assessment ready."],
      };
    const weakest = Math.min(...conceptStates.map((item) => readinessRank(item.preparedness)));
    const evidenceGaps = conceptStates
      .filter((item) => item.evidenceConfidence.label === "insufficient")
      .map((item) => item.name);
    return {
      assessmentId,
      state: readinessFromRank(weakest),
      conceptStates,
      evidenceGaps,
      why: conceptStates.flatMap((item) => item.why.slice(0, 2).map((why) => `${item.name}: ${why}`)),
    };
  };
  const objective = (scope: LearningObjectiveScope = {}): LearningObjective | null => {
    const assessmentRecord = scope.assessmentId ? state.assessments?.find((item) => item.id === scope.assessmentId) : null;
    const taskIds = new Set(assessmentRecord?.taskIds ?? (scope.taskId ? [scope.taskId] : []));
    const candidates = state.concepts
      .filter((concept) => {
        if (scope.classId && concept.classId !== scope.classId) return false;
        if (assessmentRecord && concept.classId !== assessmentRecord.classId) return false;
        if (!taskIds.size) return true;
        return concept.taskIds.some((taskId) => taskIds.has(taskId)) || state.attempts.some((attempt) => attempt.conceptIds.includes(concept.id) && attempt.taskId !== null && taskIds.has(attempt.taskId));
      })
      .map((concept) => get(concept.id)!)
      .filter(Boolean);
    if (!candidates.length) return null;
    const scored = candidates.map((item) => {
      const priority =
        (item.prerequisiteGaps.length ? 4 : 0) +
        (item.preparedness === "not-ready" ? 3 : item.preparedness === "developing" ? 2 : 0) +
        (item.memory.reviewDue && finiteDate(item.memory.reviewDue)! <= current ? 2 : 0) +
        (item.transferDepth.value !== null && item.transferDepth.value < 0.5 ? 1 : 0) +
        (item.calibration.status === "overconfident" ? 1 : 0);
      return { item, priority };
    });
    scored.sort((a, b) => b.priority - a.priority || readinessRank(a.item.preparedness) - readinessRank(b.item.preparedness) || a.item.name.localeCompare(b.item.name));
    const chosen = scored[0]!;
    const title = chosen.item.prerequisiteGaps.length
      ? `Rebuild ${chosen.item.prerequisiteGaps[0]!.name} before applying ${chosen.item.name}`
      : chosen.item.retrievability.value !== null && chosen.item.retrievability.value < 0.58
        ? `Retrieve ${chosen.item.name} unaided`
        : chosen.item.transferDepth.value !== null && chosen.item.transferDepth.value < 0.5
          ? `Apply ${chosen.item.name} in a mixed problem`
          : `Check a new ${chosen.item.name} problem unaided`;
    return {
      conceptId: chosen.item.conceptId,
      title,
      reason: chosen.item.why.slice(0, 3).join(" "),
      priority: chosen.priority,
      state: chosen.item,
    };
  };
  return {
    getConceptState: get,
    getReviewDue: getReview,
    getPrerequisiteGaps: getGaps,
    getAssessmentReadiness: assessment,
    explainState: explain,
    getLikelyMistakePatterns: patterns,
    recordConfidenceEvidence: confidence,
    recommendLearningObjective: objective,
  };
}

export function getConceptState(input: StudentModelInput | Snapshot, conceptId: string, now = new Date()) {
  return createStudentModel(input, now).getConceptState(conceptId);
}
export function getReviewDue(input: StudentModelInput | Snapshot, conceptId: string, now = new Date()) {
  return createStudentModel(input, now).getReviewDue(conceptId);
}
export function getPrerequisiteGaps(input: StudentModelInput | Snapshot, conceptId: string, now = new Date()) {
  return createStudentModel(input, now).getPrerequisiteGaps(conceptId);
}
export function getAssessmentReadiness(input: StudentModelInput | Snapshot, assessmentId: string, now = new Date()) {
  return createStudentModel(input, now).getAssessmentReadiness(assessmentId);
}
export function explainState(input: StudentModelInput | Snapshot, conceptId: string, now = new Date()) {
  return createStudentModel(input, now).explainState(conceptId);
}
export function getLikelyMistakePatterns(input: StudentModelInput | Snapshot, conceptId: string, now = new Date()) {
  return createStudentModel(input, now).getLikelyMistakePatterns(conceptId);
}
export function recordConfidenceEvidence(input: StudentModelInput | Snapshot, request: ConfidenceEvidenceRequest, now = new Date()) {
  return createStudentModel(input, now).recordConfidenceEvidence(request);
}
export function recommendLearningObjective(input: StudentModelInput | Snapshot, scope: LearningObjectiveScope = {}, now = new Date()) {
  return createStudentModel(input, now).recommendLearningObjective(scope);
}

export function studentModelInput(snapshot: Snapshot): StudentModelInput {
  return modelInputFromSnapshot(snapshot);
}
