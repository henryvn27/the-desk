/**
 * Small, deterministic evaluation harness for study behavior. It is deliberately
 * policy-level: provider quality still needs a separate human/live evaluation.
 */
export type StudyQualityObservation = {
  scenario: string;
  answerLeakage: boolean;
  hintUseful: boolean;
  diagnosticAccurate: boolean;
  repeatedQuestion: boolean;
  transferQuality: boolean;
  citationAccurate: boolean;
  evidenceCorrect: boolean;
  completed: boolean;
};

export type StudyQualityMetrics = {
  scenarios: number;
  answerLeakageRate: number;
  hintUsefulnessRate: number;
  diagnosticAccuracyRate: number;
  repeatedQuestionRate: number;
  transferQualityRate: number;
  citationAccuracyRate: number;
  evidenceCorrectnessRate: number;
  sessionCompletionRate: number;
};

function rate(values: readonly boolean[]) {
  if (!values.length) return 0;
  return values.filter(Boolean).length / values.length;
}

export function summarizeStudyQuality(observations: readonly StudyQualityObservation[]): StudyQualityMetrics {
  return {
    scenarios: observations.length,
    answerLeakageRate: rate(observations.map((item) => item.answerLeakage)),
    hintUsefulnessRate: rate(observations.map((item) => item.hintUseful)),
    diagnosticAccuracyRate: rate(observations.map((item) => item.diagnosticAccurate)),
    repeatedQuestionRate: rate(observations.map((item) => item.repeatedQuestion)),
    transferQualityRate: rate(observations.map((item) => item.transferQuality)),
    citationAccuracyRate: rate(observations.map((item) => item.citationAccurate)),
    evidenceCorrectnessRate: rate(observations.map((item) => item.evidenceCorrect)),
    sessionCompletionRate: rate(observations.map((item) => item.completed)),
  };
}

export function compareStudyQuality(
  baseline: readonly StudyQualityObservation[],
  postV1: readonly StudyQualityObservation[],
) {
  const before = summarizeStudyQuality(baseline);
  const after = summarizeStudyQuality(postV1);
  return {
    baseline: before,
    postV1: after,
    delta: {
      answerLeakageRate: after.answerLeakageRate - before.answerLeakageRate,
      hintUsefulnessRate: after.hintUsefulnessRate - before.hintUsefulnessRate,
      diagnosticAccuracyRate: after.diagnosticAccuracyRate - before.diagnosticAccuracyRate,
      repeatedQuestionRate: after.repeatedQuestionRate - before.repeatedQuestionRate,
      transferQualityRate: after.transferQualityRate - before.transferQualityRate,
      citationAccuracyRate: after.citationAccuracyRate - before.citationAccuracyRate,
      evidenceCorrectnessRate: after.evidenceCorrectnessRate - before.evidenceCorrectnessRate,
      sessionCompletionRate: after.sessionCompletionRate - before.sessionCompletionRate,
    },
  };
}
