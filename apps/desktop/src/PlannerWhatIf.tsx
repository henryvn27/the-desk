import { useState } from "react";
import type { Snapshot } from "../../../packages/domain/contracts";
import { evaluatePlannerWhatIf, type PlannerWhatIfResult } from "../../../packages/planner/what-if";
import type { planWeek } from "../../../packages/planner";
import { userError } from "./errors";

export function PlannerWhatIf({
  data,
  week,
}: {
  data: Snapshot;
  week: ReturnType<typeof planWeek>;
}) {
  const [taskId, setTaskId] = useState(data.tasks.find((task) => !task.completed)?.id ?? "");
  const [minutes, setMinutes] = useState("60");
  const [result, setResult] = useState<PlannerWhatIfResult>();
  const [status, setStatus] = useState("");
  const activeTasks = data.tasks.filter((task) => !task.completed);
  function run(change: Parameters<typeof evaluatePlannerWhatIf>[1]) {
    try {
      setStatus("");
      setResult(evaluatePlannerWhatIf({
        tasks: data.tasks,
        now: new Date(),
        preferences: data.planning,
        commitments: data.studyBlocks,
        grades: data,
      }, change));
    } catch (error) {
      setResult(undefined);
      setStatus(userError(error));
    }
  }
  return (
    <section className="planner-what-if" aria-label="What-if planning">
      <h2>What if?</h2>
      <p className="muted">Test a disruption or extra work against the same deterministic planner. Nothing is saved.</p>
      <div className="fields">
        <label>
          Assignment
          <select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
            {activeTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
        <label>
          Extra minutes
          <input type="number" min="5" max="2400" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button type="button" onClick={() => run({ kind: "add-minutes", taskId, minutes: Number(minutes) })}>Add an hour</button>
        <button type="button" onClick={() => run({ kind: "skip-date", date: new Date().toISOString() })}>Skip tonight</button>
        <button type="button" onClick={() => run({ kind: "stop-at", time: "22:00" })}>Stop at 10:00 PM</button>
      </div>
      {result && (
        <div className="planner-what-if-result" role="status">
          <strong>{result.impact.deadlineRisk === "unchanged" ? "No added deadline risk" : `${result.impact.deadlineRisk === "increased" ? "Higher" : "Lower"} deadline risk`}</strong>
          <p>{result.impact.explanation}</p>
          <small>{result.scenario.blocks.length} blocks · {result.scenario.unscheduled.reduce((sum, item) => sum + item.minutes, 0)} minutes still need time · {result.impact.movedTaskCount} task{result.impact.movedTaskCount === 1 ? "" : "s"} moved.</small>
        </div>
      )}
      {status && <p role="alert">{status}</p>}
      <small className="muted">Current plan: {week.blocks.length} suggested blocks · {week.unscheduled.reduce((sum, item) => sum + item.minutes, 0)} minutes still need time.</small>
    </section>
  );
}
