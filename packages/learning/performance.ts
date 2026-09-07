import type { StudySession, Task, TaskInput } from "../domain/contracts";

export type PerformanceBucket = "morning" | "afternoon" | "evening" | "night";

export type PerformancePattern = {
  classId: string;
  workKind: NonNullable<TaskInput["workKind"]>;
  preferredBucket: PerformanceBucket;
  samples: number;
  completionRate: number;
  medianRatio: number;
  explanation: string;
};

function bucketFor(value: string): PerformanceBucket {
  const hour = new Date(value).getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

type Observation = {
  bucket: PerformanceBucket;
  ratio: number;
  completed: boolean;
};

/**
 * Finds stable time-of-day evidence from reviewed V1 sessions. It deliberately
 * requires repeated observations and returns no personality inference.
 */
export function derivePerformancePatterns(
  tasks: readonly Task[],
  sessions: readonly StudySession[],
): PerformancePattern[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const grouped = new Map<string, Observation[]>();
  for (const session of sessions) {
    const task = taskById.get(session.taskId);
    const estimate = session.estimateAtStart;
    if (
      !task ||
      !session.endedAt ||
      !session.review ||
      !session.completionReported ||
      !estimate ||
      estimate.classId !== task.classId ||
      estimate.workKind !== (task.workKind ?? "assignment") ||
      !Number.isFinite(session.actualMinutes) ||
      session.actualMinutes === null ||
      session.actualMinutes < 5 ||
      !Number.isFinite(estimate.minutes) ||
      estimate.minutes < 5
    )
      continue;
    const key = `${task.classId}:${task.workKind ?? "assignment"}`;
    const list = grouped.get(key) ?? [];
    list.push({
      bucket: bucketFor(session.startedAt),
      ratio: session.actualMinutes / estimate.minutes,
      completed: session.completionReported === true,
    });
    grouped.set(key, list);
  }
  const patterns: PerformancePattern[] = [];
  for (const [key, observations] of grouped) {
    if (observations.length < 3) continue;
    const byBucket = new Map<PerformanceBucket, Observation[]>();
    for (const observation of observations) {
      const list = byBucket.get(observation.bucket) ?? [];
      list.push(observation);
      byBucket.set(observation.bucket, list);
    }
    const candidates = [...byBucket.entries()]
      .filter(([, list]) => list.length >= 1)
      .map(([bucket, list]) => ({
        bucket,
        list,
        medianRatio: median(list.map((item) => item.ratio)),
        completionRate: list.filter((item) => item.completed).length / list.length,
      }))
      .sort((a, b) =>
        b.completionRate - a.completionRate ||
        a.medianRatio - b.medianRatio ||
        a.bucket.localeCompare(b.bucket),
      );
    const preferred = candidates[0];
    const alternate = candidates[1];
    if (!preferred || preferred.list.length < 2 || !alternate) continue;
    const completionGap = preferred.completionRate - alternate.completionRate;
    const ratioGap = alternate.medianRatio - preferred.medianRatio;
    if (completionGap < 0.2 && ratioGap < 0.2) continue;
    const [classId, workKind] = key.split(":") as [string, NonNullable<TaskInput["workKind"]>];
    patterns.push({
      classId,
      workKind,
      preferredBucket: preferred.bucket,
      samples: preferred.list.length,
      completionRate: preferred.completionRate,
      medianRatio: preferred.medianRatio,
      explanation: `Based on ${preferred.list.length} reviewed ${workKind} sessions, ${preferred.bucket} work has the most reliable completion or shortest overrun.`,
    });
  }
  return patterns;
}

export function performanceFit(
  task: Pick<Task, "classId" | "workKind">,
  start: Date,
  patterns: readonly PerformancePattern[],
) {
  const bucket = bucketFor(start.toISOString());
  return patterns.find(
    (pattern) =>
      pattern.classId === task.classId &&
      pattern.workKind === (task.workKind ?? "assignment"),
  )?.preferredBucket === bucket;
}
