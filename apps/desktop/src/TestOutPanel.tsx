import { useState } from "react";
import type { Command } from "../../../packages/domain/contracts";
import type { TestOutPlan } from "../../../packages/intelligence/learning-loop";
import { userError } from "./errors";

type Outcome = "correct" | "partial" | "incorrect";

export function TestOutPanel({
  plan,
  classId,
  save,
  onDone,
}: {
  plan: TestOutPlan;
  classId: string;
  save: (command: Command) => Promise<unknown>;
  onDone: () => void;
}) {
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit() {
    setError("");
    if (plan.prompts.some((prompt) => !outcomes[prompt.id])) {
      setError("Mark each check after reviewing your work.");
      return;
    }
    setSaving(true);
    try {
      for (const prompt of plan.prompts) {
        const result = outcomes[prompt.id]!;
        await save({
          type: "attempt.create",
          input: {
            classId,
            taskId: plan.taskId ?? null,
            conceptIds: [prompt.conceptId],
            result,
            unaided: true,
            hintCount: 0,
            notes: notes[prompt.id]?.trim() || `Test-out check: ${prompt.prompt}`,
            attemptedAt: new Date().toISOString(),
            activityId: `${plan.id}:${prompt.id}`,
            activityKind: "quiz",
            responseMode: "free-response",
            difficulty: prompt.difficulty === "transfer" ? 0.7 : 0.45,
            transferDistance: prompt.difficulty === "transfer" ? 0.8 : 0.35,
          },
        });
      }
      setSaved(true);
    } catch (value) {
      setError(userError(value));
    } finally {
      setSaving(false);
    }
  }

  const correct = plan.prompts.filter((prompt) => outcomes[prompt.id] === "correct").length;
  const allCorrect = saved && correct === plan.prompts.length;
  return (
    <section className="test-out-panel" aria-label="Test out">
      <div className="eyebrow">Test out</div>
      <h3>{plan.conceptName}</h3>
      <p className="muted">{plan.reason} Mark the result after checking your own work. Desk records the attempt, not the answer.</p>
      <ol className="test-out-prompts">
        {plan.prompts.map((prompt) => (
          <li key={prompt.id}>
            <strong>{prompt.prompt}</strong>
            <small>{prompt.rationale}{prompt.sourceIds.length ? " Grounded in linked class material." : ""}</small>
            <label>
              Result
              <select
                value={outcomes[prompt.id] ?? ""}
                onChange={(event) => setOutcomes((current) => ({ ...current, [prompt.id]: event.target.value as Outcome }))}
                disabled={saved}
              >
                <option value="">Choose…</option>
                <option value="correct">Correct</option>
                <option value="partial">Partially correct</option>
                <option value="incorrect">Incorrect</option>
              </select>
            </label>
            <label>
              What did you notice? <span className="muted">optional</span>
              <textarea
                value={notes[prompt.id] ?? ""}
                onChange={(event) => setNotes((current) => ({ ...current, [prompt.id]: event.target.value }))}
                maxLength={5000}
                disabled={saved}
              />
            </label>
          </li>
        ))}
      </ol>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && (
        <p role="status">
          {allCorrect
            ? `Mastery evidence recorded for ${plan.conceptName}; the next plan will re-evaluate this concept.`
            : `Checked evidence recorded (${correct}/${plan.prompts.length} fully correct). Desk will keep the remaining risk visible.`}
        </p>
      )}
      <div className="actions">
        {!saved ? (
          <button className="primary" type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? "Recording…" : `Record ${plan.prompts.length} checks`}
          </button>
        ) : null}
        <button type="button" onClick={onDone}>{saved ? "Done" : "Cancel"}</button>
      </div>
    </section>
  );
}

