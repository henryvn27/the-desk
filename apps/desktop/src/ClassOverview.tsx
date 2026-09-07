import type { Command, Snapshot, Task } from "../../../packages/domain/contracts";
import {
  deriveClassExperience,
  type ClassAssessmentView,
  type ClassLearningView,
  type ClassUnitView,
} from "../../../packages/domain/class-experience";
import { sourceKindLabels } from "../../../packages/intelligence/source-kind";
import { Gradebook } from "./Gradebook";

const assessmentLabels: Record<ClassAssessmentView["kind"], string> = {
  quiz: "Quiz",
  test: "Test",
  exam: "Exam",
  final: "Final",
  midterm: "Midterm",
  project: "Project",
  essay: "Essay",
  lab: "Lab",
  presentation: "Presentation",
  "standardized-test": "Standardized test",
  other: "Assessment",
};

const preparednessLabels: Record<string, string> = {
  "not-ready": "Not ready",
  developing: "Developing",
  "mostly-ready": "Mostly ready",
  ready: "Ready",
  strong: "Strong",
};

const statusLabels: Record<ClassLearningView["recordedStatus"], string> = {
  "not-started": "Not started",
  learning: "Learning",
  developing: "Developing",
  strong: "Strong",
  "review-due": "Review due",
};

const formatLabels: Record<string, string> = {
  text: "Text",
  pdf: "PDF",
  slides: "Slides",
  transcript: "Transcript",
  web: "Web capture",
};

function dateLabel(value: string | null | undefined) {
  if (!value) return "Date not recorded";
  return new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "Date not recorded";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function unitProgress(unit: ClassUnitView) {
  if (!unit.taskCount) return "No linked assignments yet";
  if (unit.completedTaskCount === unit.taskCount) return "Complete";
  return `${unit.completedTaskCount} of ${unit.taskCount} assignments complete`;
}

function stageLabel(stage: "past" | "current" | "upcoming") {
  return stage[0]!.toUpperCase() + stage.slice(1);
}

export function ClassOverview({
  data,
  classId,
  openCanvas,
  openSource,
  editTask,
  startTask,
  navigate,
  saveGrade,
}: {
  data: Snapshot;
  classId: string;
  openCanvas: (taskId: string, canvasId?: string, blockId?: string) => Promise<void>;
  openSource: (sourceId: string) => void;
  editTask: (task: Task) => void;
  startTask: (taskId: string) => void;
  navigate: (page: string) => void;
  saveGrade: (command: Command) => Promise<unknown>;
}) {
  const projection = deriveClassExperience(data, classId);
  if (!projection) return null;
  const teacherNames = projection.teachers.map((teacher) => teacher.name);
  const context = [...projection.periods, ...projection.spaces];
  const learning = projection.learning.slice(0, 6);
  const sources = projection.sources.slice(0, 4);
  const notes = projection.notes.slice(0, 4);
  return (
    <section className="class-overview" aria-labelledby="class-overview-title">
      <section className="class-hero">
        <div>
          <div className="eyebrow">Class workspace</div>
          <h1 id="class-overview-title">{projection.classRecord.name}</h1>
          <p className="class-hero-summary">
            {context.length ? context.join(" · ") : "Your student-owned view of this class"}
          </p>
          <div className="class-meta-line">
            <span>{teacherNames.length ? teacherNames.join(" · ") : "Teacher not recorded"}</span>
            {projection.grade.scoredWeight > 0 && (
              <span>{projection.grade.scoredWeight.toFixed(0)}% of recorded grading weight has scores</span>
            )}
          </div>
        </div>
        <div className="actions class-hero-actions">
          <button type="button" onClick={() => navigate("Units")}>Manage progression</button>
          <button type="button" onClick={() => navigate("Teachers")}>Teacher details</button>
        </div>
      </section>

      {!!projection.attention.length && (
        <section className="class-attention" aria-labelledby="class-attention-title">
          <div className="eyebrow" id="class-attention-title">Review before relying on this class view</div>
          {projection.attention.map((item) => (
            <div className="class-attention-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              {item.kind === "authority-conflict" ? (
                <button type="button" onClick={() => navigate("Authority")}>Review authority</button>
              ) : item.taskId ? (
                <button type="button" onClick={() => {
                  const task = projection.tasks.find((candidate) => candidate.id === item.taskId);
                  if (task) editTask(task);
                }}>Review</button>
              ) : (
                <button type="button" onClick={() => navigate("Units")}>Add units</button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="class-next class-panel" aria-labelledby="class-next-title">
        <div className="eyebrow" id="class-next-title">What’s next</div>
        {projection.next ? (
          <>
            <h2>{projection.next.title}</h2>
            <p className="class-next-meta">
              {projection.next.minutes} minutes · {projection.next.kind === "planned" ? "planned" : projection.next.kind === "needs-confirmation" ? "needs deadline confirmation" : "not in an executable block"}
              {projection.next.dueAt && ` · due ${dateLabel(projection.next.dueAt)}`}
            </p>
            {(projection.next.unitName || projection.next.assessmentTitle) && (
              <p className="muted">
                {[projection.next.unitName, projection.next.assessmentTitle].filter(Boolean).join(" · ")}
              </p>
            )}
            <details>
              <summary>Why this is next</summary>
              <p>{projection.next.why}</p>
            </details>
            <div className="actions">
              {projection.next.kind === "planned" ? (
                <button className="primary" type="button" onClick={() => startTask(projection.next!.taskId)}>Start next study</button>
              ) : (
                <button type="button" onClick={() => {
                  const task = projection.tasks.find((candidate) => candidate.id === projection.next!.taskId);
                  if (task) editTask(task);
                }}>Review assignment</button>
              )}
              <button type="button" onClick={() => {
                const task = projection.tasks.find((candidate) => candidate.id === projection.next!.taskId);
                if (task) editTask(task);
              }}>Open assignment</button>
            </div>
          </>
        ) : (
          <>
            <h2>No unfinished class work is waiting.</h2>
            <p className="muted">New assignments and sources will appear here when they are connected to this class.</p>
          </>
        )}
      </section>

      <section className="class-panel" aria-labelledby="class-progression-title">
        <div className="eyebrow" id="class-progression-title">Where are we?</div>
        <div className="class-stage-grid">
          {(["past", "current", "upcoming"] as const).map((stage) => {
            const items = projection.units[stage];
            return (
              <section className={`class-stage class-stage-${stage}`} key={stage} aria-label={`${stageLabel(stage)} units`}>
                <div className="class-stage-label">{stageLabel(stage)}</div>
                {items.length ? items.map((unit) => (
                  <article className="class-unit" key={unit.id}>
                    <div>
                      <strong>{unit.sequence}. {unit.name}</strong>
                      <p>{unitProgress(unit)}{unit.remainingMinutes ? ` · ${unit.remainingMinutes} min left` : ""}</p>
                      {unit.conceptNames.length > 0 && <small>{unit.conceptNames.slice(0, 3).join(" · ")}</small>}
                    </div>
                  </article>
                )) : <p className="muted">No units here yet.</p>}
              </section>
            );
          })}
        </div>
      </section>

      <div className="class-overview-grid">
        <section className="class-panel" aria-labelledby="class-learning-title">
          <div className="eyebrow" id="class-learning-title">What matters for learning</div>
          {learning.length ? learning.map((concept) => (
            <article className="class-learning-row" key={concept.id}>
              <div>
                <strong>{concept.name}</strong>
                <p>{preparednessLabels[concept.preparedness]} · {concept.evidenceConfidence} evidence confidence{concept.unresolvedMistakes ? ` · ${concept.unresolvedMistakes} open mistake${concept.unresolvedMistakes === 1 ? "" : "s"}` : ""}</p>
              </div>
              <span className={`status-pill status-${concept.preparedness}`}>Recorded: {statusLabels[concept.recordedStatus]}</span>
            </article>
          )) : <p className="muted">No checked concept evidence is linked to this class yet.</p>}
          {projection.learning.length > learning.length && <button type="button" onClick={() => navigate("Concepts")}>See all learning evidence</button>}
        </section>

        <section className="class-panel class-grade-panel" aria-labelledby="class-grade-title">
          <div className="eyebrow" id="class-grade-title">Grade evidence</div>
          {projection.grade.scoredWeight ? (
            <>
              <h2>{projection.grade.lower.toFixed(1)}{projection.grade.scoredWeight < 100 ? `–${projection.grade.upper.toFixed(1)}` : ""}%</h2>
              <p>{projection.grade.scoredWeight.toFixed(0)}% of configured weight is represented by scores.</p>
              {projection.grade.unknownCategories.length > 0 && <p className="muted">Still unknown: {projection.grade.unknownCategories.join(" · ")}</p>}
            </>
          ) : <p className="muted">No scored grade evidence yet. Category weights can be recorded without turning this into an anxiety dashboard.</p>}
          <Gradebook data={data} classId={classId} save={saveGrade} />
        </section>
      </div>

      <section className="class-panel" aria-labelledby="class-assessments-title">
        <div className="class-section-header">
          <div className="eyebrow" id="class-assessments-title">Assessments</div>
          <button type="button" onClick={() => navigate("Assessments")}>Manage assessments</button>
        </div>
        {projection.assessments.length ? projection.assessments.map((assessment) => (
          <article className="class-assessment" key={assessment.id}>
            <div>
              <strong>{assessment.title}</strong>
              <p>{assessmentLabels[assessment.kind]} · {dateLabel(assessment.dueAt)}{assessment.gradeCategoryName ? ` · ${assessment.gradeCategoryName}` : ""}</p>
              <small>
                {assessment.unitNames.length ? `Units: ${assessment.unitNames.join(" · ")}` : "No unit linked"}
                {assessment.conceptNames.length ? ` · Concepts: ${assessment.conceptNames.slice(0, 3).join(" · ")}` : ""}
              </small>
              <small>
                {assessment.plannedMinutes ? `${assessment.plannedMinutes} min planned` : "No preparation block planned"} · {assessment.sourceTitles.length ? `${assessment.sourceTitles.length} source${assessment.sourceTitles.length === 1 ? "" : "s"}` : "No linked sources"} · {assessment.mistakeCount} related mistake{assessment.mistakeCount === 1 ? "" : "s"}
              </small>
              {assessment.preparedness && <p className="class-assessment-readiness"><strong>Preparedness:</strong> {preparednessLabels[assessment.preparedness] ?? assessment.preparedness}. {assessment.readinessWhy.slice(0, 2).join(" ")}</p>}
            </div>
          </article>
        )) : <p className="muted">No assessments are linked to this class yet.</p>}
      </section>

      <div className="class-overview-grid">
        <section className="class-panel" aria-labelledby="class-teacher-title">
          <div className="class-section-header">
            <div className="eyebrow" id="class-teacher-title">Teacher context</div>
            <button type="button" onClick={() => navigate("Teachers")}>Manage teachers</button>
          </div>
          {projection.teachers.length ? projection.teachers.map((teacher) => (
            <article className="class-teacher" key={teacher.id}>
              <strong>{teacher.name}</strong>
              <p>{teacher.email ?? "Email not recorded"}{teacher.notes ? ` · ${teacher.notes}` : ""}</p>
              {teacher.recordedEmphasis.length > 0 && <p><strong>Recorded emphasis:</strong> {teacher.recordedEmphasis.map((item) => `${item.name}${item.count > 1 ? ` (${item.count})` : ""}`).join(" · ")}</p>}
              {teacher.recentEvidence.slice(0, 2).map((evidence) => <p className="muted" key={evidence.id}>{evidence.title}{evidence.score ? ` · ${evidence.score}` : ""}{evidence.comments ? ` · ${evidence.comments}` : ""}</p>)}
            </article>
          )) : <p className="muted">No teacher details are linked yet.</p>}
          {projection.teachers.some((teacher) => teacher.evidenceCount > 0) && <small className="muted">Recorded evidence is shown separately from Desk inference.</small>}
        </section>

        <section className="class-panel" aria-labelledby="class-material-title">
          <div className="eyebrow" id="class-material-title">Recent class material</div>
          {sources.length ? sources.map((source) => (
            <div className="class-material-row" key={source.id}>
              <div>
                <strong>{source.title}</strong>
                <small>{formatLabels[source.format] ?? source.format} · {sourceKindLabels[source.kind as keyof typeof sourceKindLabels] ?? source.kind} · revision {source.revision}{source.annotationCount ? ` · ${source.annotationCount} annotation${source.annotationCount === 1 ? "" : "s"}` : ""}</small>
              </div>
              <button type="button" onClick={() => openSource(source.id)}>Read</button>
            </div>
          )) : <p className="muted">No class sources are linked yet.</p>}
          {notes.length > 0 && <>
            <div className="eyebrow class-subsection-label">Recent Notes</div>
            {notes.map((note) => (
              <div className="class-material-row" key={note.id}>
                <div>
                  <strong>{note.title}</strong>
                  <small>{note.taskTitle} · updated {dateTimeLabel(note.updatedAt)}</small>
                </div>
                <button type="button" onClick={() => void openCanvas(note.taskId, note.id, note.blockId)}>Open</button>
              </div>
            ))}
          </>}
        </section>
      </div>
    </section>
  );
}
