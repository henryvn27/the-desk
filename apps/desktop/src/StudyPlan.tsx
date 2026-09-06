import { useState } from "react";
import type {
  Block,
  Command,
  Snapshot,
  StudyBlock,
} from "../../../packages/domain/contracts";
import type { planWeek } from "../../../packages/planner";
import { userError } from "./errors";
function localInput(value: string) {
  const d = new Date(value);
  return new Date(+d - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function StudyPlan({
  data,
  week,
  save,
}: {
  data: Snapshot;
  week: ReturnType<typeof planWeek>;
  save: (c: Command) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Block | StudyBlock>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const label = (b: Block) =>
    data.tasks.find((t) => t.id === b.taskId)?.title ?? "Assignment";
  const row = (b: Block, saved: boolean) => (
    <section
      className="row"
      key={"id" in b ? String(b.id) : b.taskId + b.start}
    >
      <div>
        <strong>{label(b)}</strong>
        <p>
          {new Date(b.start).toLocaleString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          · {b.minutes} minutes
        </p>
        <small>
          {saved
            ? "locked" in b && b.locked
              ? "Locked · "
              : "Saved · "
            : "Suggested · "}
          {b.why}
        </small>
        {saved && +new Date(b.end) < Date.now() && (
          <p>
            Time has passed. Review the assignment’s remaining work; this block
            does not mark it complete.
          </p>
        )}
      </div>
      <button
        disabled={busy}
        onClick={() => {
          setEditing(b);
          setStatus("");
        }}
      >
        {saved ? "Edit block" : "Reserve time"}
      </button>
    </section>
  );
  return (
    <>
      <h1>Your plan</h1>
      <p className="muted">
        Next seven days · {data.planning.studyStart}–{data.planning.sleepCutoff}{" "}
        local time · {data.planning.bufferPercent}% breathing room
      </p>
      <p>
        Saved blocks stay where you put them. Suggestions use the time around
        them.
      </p>
      {editing && (
        <section>
          <h2>{"id" in editing ? "Edit saved block" : "Reserve study time"}</h2>
          <p>{label(editing)}</p>
          <form
            key={"id" in editing ? editing.id : editing.taskId + editing.start}
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setStatus("");
              const input = {
                start: new Date(String(form.get("start"))).toISOString(),
                minutes: Number(form.get("minutes")),
              };
              const beyondDeadlineApproved = form.has("deadline");
              const c: Command =
                "id" in editing
                  ? {
                      type: "block.update",
                      id: editing.id,
                      revision: editing.revision,
                      input,
                      locked: form.has("locked"),
                      lockedChangeApproved: form.has("approveLock"),
                      beyondDeadlineApproved,
                    }
                  : {
                      type: "block.create",
                      taskId: editing.taskId,
                      input,
                      beyondDeadlineApproved,
                    };
              void save(c)
                .then(() => {
                  setEditing(undefined);
                  setStatus("Study block saved.");
                })
                .catch((e) => setStatus(userError(e)))
                .finally(() => setBusy(false));
            }}
          >
            <div className="fields">
              <label>
                Start time
                <input
                  name="start"
                  type="datetime-local"
                  required
                  defaultValue={localInput(
                    "id" in editing
                      ? editing.start
                      : new Date(
                          Math.max(
                            +new Date(editing.start),
                            Date.now() + 120000,
                          ),
                        ).toISOString(),
                  )}
                />
              </label>
              <label>
                Minutes
                <input
                  name="minutes"
                  type="number"
                  min="5"
                  max="2400"
                  required
                  defaultValue={editing.minutes}
                />
              </label>
            </div>
            {"id" in editing && (
              <label>
                <input
                  name="locked"
                  type="checkbox"
                  defaultChecked={editing.locked}
                />{" "}
                Lock this block
              </label>
            )}
            {"id" in editing && editing.locked && (
              <label>
                <input name="approveLock" type="checkbox" /> I approve moving or
                unlocking this locked block
              </label>
            )}
            <label>
              <input name="deadline" type="checkbox" /> Allow this block to end
              after the assignment deadline
            </label>
            <div className="actions">
              <button disabled={busy}>Save block</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      <p role="status">{status}</p>
      <h2>Saved blocks</h2>
      {data.studyBlocks.length ? (
        data.studyBlocks.map((b) => row(b, true))
      ) : (
        <p>No saved blocks yet. Reserve a suggestion to keep its place.</p>
      )}
      <h2>Suggested time</h2>
      {week.blocks.length ? (
        week.blocks.map((b) => row(b, false))
      ) : (
        <p>No additional study blocks fit in the next seven days.</p>
      )}
      {!!week.unscheduled.length && (
        <section>
          <h2>Still needs time</h2>
          {week.unscheduled.map((u) => (
            <p key={u.taskId}>
              {data.tasks.find((t) => t.id === u.taskId)?.title} · {u.minutes}{" "}
              min · {u.reason}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
